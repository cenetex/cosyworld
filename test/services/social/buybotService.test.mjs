/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/services/social/buybotService.test.mjs
 * @description Tests for BuybotService token tracking
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BuybotService } from '../../../src/services/social/buybotService.mjs';

describe('BuybotService', () => {
  let buybotService;
  let mockLogger;
  let mockDatabaseService;
  let mockConfigService;
  let mockDiscordService;
  let mockDb;
  let mockCollection;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    mockCollection = {
      findOne: vi.fn(),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'test-id' }),
      createIndexes: vi.fn().mockResolvedValue({}),
    };

    mockDb = {
      collection: vi.fn().mockReturnValue(mockCollection),
    };

    mockDatabaseService = {
      getDatabase: vi.fn().mockResolvedValue(mockDb),
    };

    mockConfigService = {
      config: {},
    };

    mockDiscordService = {
      sendMessage: vi.fn().mockResolvedValue({}),
    };

    buybotService = new BuybotService({
      logger: mockLogger,
      databaseService: mockDatabaseService,
      configService: mockConfigService,
      discordService: mockDiscordService,
      getTelegramService: () => null,
    });
  });

  describe('Token Address Validation', () => {
    it('should validate correct Solana token addresses', () => {
      const validAddresses = [
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        'So11111111111111111111111111111111111111112', // Wrapped SOL
        'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
        'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
        'Ci6Y1UX8bY4jxn6YiogJmdCxFEu2jmZhCcG65PStpump', // Pump.fun token
      ];

      validAddresses.forEach(address => {
        expect(
          buybotService.isValidSolanaAddress(address),
          `Address ${address} should be valid`
        ).toBe(true);
      });
    });

    it('should reject invalid Solana token addresses', () => {
      const invalidAddresses = [
        '', // Empty
        null, // Null
        undefined, // Undefined
        'short', // Too short
        '0x1234567890123456789012345678901234567890', // Ethereum address
        'not-a-valid-address', // Invalid characters
        'ThisIsWayTooLongToBeAValidSolanaAddress12345678901234567890', // Too long
        '1234567890!@#$%^&*()123456789012345', // Invalid base58 chars
      ];

      invalidAddresses.forEach(address => {
        expect(
          buybotService.isValidSolanaAddress(address),
          `Address "${address}" should be invalid`
        ).toBe(false);
      });
    });

    it('should validate base58 character set', () => {
      // Base58 excludes: 0, O, I, l to avoid confusion
      expect(buybotService.isValidSolanaAddress('0OIl1111111111111111111111111111111')).toBe(false);
      expect(buybotService.isValidSolanaAddress('123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijk')).toBe(true);
    });
  });

  describe('Token Info Fetching', () => {
    it('should handle token not found errors gracefully', async () => {
      buybotService.getPriceFromDexScreener = vi.fn().mockResolvedValue(null);

      // Use a properly formatted but non-existent token address
      const fakeAddress = 'FakE11111111111111111111111111111111111111';
      const tokenInfo = await buybotService.getTokenInfo(fakeAddress);

      expect(tokenInfo).not.toBeNull();
        expect(tokenInfo.warning).toContain('Token not found');
      expect(tokenInfo.address).toBe(fakeAddress);
    });

    it('should return null for invalid addresses', async () => {
      const tokenInfo = await buybotService.getTokenInfo('invalid');

      expect(tokenInfo).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid Solana address format')
      );
    });

    it('should successfully fetch token info for valid tokens', async () => {
      buybotService.getPriceFromDexScreener = vi.fn().mockResolvedValue({
        usdPrice: 0.5,
        marketCap: 1_000_000,
        liquidity: 50_000,
        name: 'Test Token',
        symbol: 'TEST',
        image: 'https://example.com/image.png',
      });

      const tokenInfo = await buybotService.getTokenInfo('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

      expect(tokenInfo).not.toBeNull();
      expect(tokenInfo.name).toBe('Test Token');
      expect(tokenInfo.symbol).toBe('TEST');
      expect(tokenInfo.decimals).toBe(9);
      expect(tokenInfo.usdPrice).toBe(0.5);
      expect(tokenInfo.marketCap).toBe(1_000_000);
      expect(tokenInfo.image).toBe('https://example.com/image.png');
    });
  });

  describe('Error Handling', () => {
    const originalFetch = globalThis.fetch;
    let fetchSpy;

    beforeEach(() => {
      buybotService.db = mockDb;
      buybotService.lambdaEndpoint = 'https://lambda.example.com';
      buybotService.getTokenInfo = vi.fn().mockResolvedValue({
        tokenSymbol: 'TEST',
        tokenDecimals: 9,
        tokenAddress: 'test-token',
        usdPrice: null,
        marketCap: null,
      });
      fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy;
      buybotService.retryWithBackoff = vi.fn(async (fn) => fn());
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('should increment error counter on 404 errors', async () => {
      mockCollection.findOne.mockResolvedValue({
        channelId: 'test-channel',
        tokenAddress: 'test-token',
        errorCount: 2,
        active: true,
      });

      fetchSpy.mockRejectedValue(new Error('could not find account'));

      await buybotService.checkTokenTransactions(
        'test-channel',
        'test-token',
        'discord'
      );

      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { channelId: 'test-channel', tokenAddress: 'test-token' },
        expect.objectContaining({
          $set: expect.objectContaining({
            errorCount: 3,
          }),
        })
      );
    });

    it('should deactivate token after 5 consecutive errors', async () => {
      mockCollection.findOne.mockResolvedValue({
        channelId: 'test-channel',
        tokenAddress: 'test-token',
        errorCount: 4,
        active: true,
      });

      fetchSpy.mockRejectedValue(new Error('Solana error #8100002'));

      buybotService.sendDiscordNotification = vi.fn();
      buybotService.stopPollingToken = vi.fn();

      await buybotService.checkTokenTransactions(
        'test-channel',
        'test-token',
        'discord'
      );

      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { channelId: 'test-channel', tokenAddress: 'test-token' },
        expect.objectContaining({
          $set: expect.objectContaining({
            active: false,
            error: expect.stringContaining('not found or invalid'),
          }),
        })
      );

      expect(buybotService.stopPollingToken).toHaveBeenCalled();
      expect(buybotService.sendDiscordNotification).toHaveBeenCalledWith(
        'test-channel',
        expect.stringContaining('Stopped tracking')
      );
    });
  });

  describe('Tracked Tokens Management', () => {
    it('should retrieve tracked tokens for a channel', async () => {
      const mockTokens = [
        { tokenAddress: 'token1', tokenSymbol: 'TK1', active: true },
        { tokenAddress: 'token2', tokenSymbol: 'TK2', active: true },
      ];

      mockCollection.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue(mockTokens),
      });

      buybotService.db = mockDb;

      const tokens = await buybotService.getTrackedTokens('test-channel');

      expect(tokens).toHaveLength(2);
      expect(mockCollection.find).toHaveBeenCalledWith({
        channelId: 'test-channel',
        active: true,
      });
    });
  });
});
