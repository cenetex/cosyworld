/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/services/payment/agentWalletService.test.mjs
 * @description Unit tests for AgentWalletService - agent wallet management
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentWalletService } from '../../../src/services/payment/agentWalletService.mjs';
import { createMockLogger, createMockConfigService, createMockDatabaseService } from '../../helpers/mockServices.mjs';

describe('AgentWalletService', () => {
  let service;
  let mockLogger;
  let mockConfigService;
  let mockDatabaseService;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockConfigService = createMockConfigService();
    mockDatabaseService = createMockDatabaseService();
    
    mockConfigService.config = {
      payment: {
        agentWallets: {
          encryptionKey: 'a'.repeat(64), // 32-byte hex key
          defaultNetwork: 'base-sepolia',
          autoFundThreshold: 10000, // 0.01 USDC
        }
      }
    };

    service = new AgentWalletService({
      logger: mockLogger,
      configService: mockConfigService,
      databaseService: mockDatabaseService,
    });
  });

  describe('Initialization', () => {
    it('should initialize with encryption key', () => {
      expect(service).toBeDefined();
      expect(service.configured).toBe(true);
      expect(service.encryptionKey).toBeDefined();
    });

    it('should not throw error if encryption key missing (log warning instead)', () => {
      const mockConfig = {
        config: {
          payment: {
            agentWallets: {
              encryptionKey: null,
            },
          },
        },
      };
      
      const unconfiguredService = new AgentWalletService({
        logger: mockLogger,
        configService: mockConfig,
        databaseService: mockDatabaseService,
      });
      
      expect(unconfiguredService.configured).toBe(false);
    });

    it('should hash encryption key to correct length', () => {
      const mockConfig = {
        config: {
          payment: {
            agentWallets: {
              encryptionKey: 'any-length-key',
            },
          },
        },
      };
      
      const testService = new AgentWalletService({
        logger: mockLogger,
        configService: mockConfig,
        databaseService: mockDatabaseService,
      });
      
      expect(testService.encryptionKey).toBeDefined();
      expect(testService.encryptionKey.length).toBe(32); // 32 bytes for AES-256
    });
  });

  describe('getOrCreateWallet', () => {
    it('should return existing wallet if found', async () => {
      const existingWallet = {
        agentId: 'agent-123',
        network: 'base',
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        dailyLimit: 100000000,
        createdAt: new Date(),
      };

      mockDatabaseService.collection.findOne.mockResolvedValue(existingWallet);

      const wallet = await service.getOrCreateWallet('agent-123');

      expect(wallet).toEqual({
        agentId: existingWallet.agentId,
        address: existingWallet.address,
        network: existingWallet.network,
        createdAt: existingWallet.createdAt,
        dailyLimit: existingWallet.dailyLimit,
      });
      expect(mockDatabaseService.collection.findOne).toHaveBeenCalledWith({
        agentId: 'agent-123',
      });
    });

    it('should create new wallet if not found', async () => {
      mockDatabaseService.collection.findOne.mockResolvedValue(null);
      mockDatabaseService.collection.insertOne.mockResolvedValue({ insertedId: 'new-id' });

      const wallet = await service.getOrCreateWallet('agent-123');

      expect(wallet.agentId).toBe('agent-123');
      expect(wallet.network).toBe('base'); // Default network
      expect(wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/); // Valid Ethereum address
      expect(mockDatabaseService.collection.insertOne).toHaveBeenCalled();
    });

    it('should encrypt private key before storing', async () => {
      mockDatabaseService.collection.findOne.mockResolvedValue(null);
      mockDatabaseService.collection.insertOne.mockResolvedValue({ insertedId: 'new-id' });

      await service.getOrCreateWallet('agent-123');

      const insertCall = mockDatabaseService.collection.insertOne.mock.calls[0][0];
      
      expect(insertCall.encryptedPrivateKey).toBeDefined();
      expect(insertCall.iv).toBeDefined();
      expect(insertCall.authTag).toBeDefined();
      expect(insertCall.encryptedPrivateKey).not.toMatch(/^0x[a-fA-F0-9]+$/); // Should be encrypted, not plaintext
    });

    it('should initialize dailySpent to zero', async () => {
      mockDatabaseService.collection.findOne.mockResolvedValue(null);
      mockDatabaseService.collection.insertOne.mockResolvedValue({ insertedId: 'new-id' });

      await service.getOrCreateWallet('agent-123');

      const insertCall = mockDatabaseService.collection.insertOne.mock.calls[0][0];
      expect(insertCall.dailySpent).toBe(0);
      expect(insertCall.dailyLimit).toBeGreaterThan(0);
    });

    it('should use default network (base)', async () => {
      mockDatabaseService.collection.findOne.mockResolvedValue(null);
      mockDatabaseService.collection.insertOne.mockResolvedValue({ insertedId: 'new-id' });

      const wallet = await service.getOrCreateWallet('agent-123');

      expect(wallet.network).toBe('base'); // Default is base, not base-sepolia
    });
  });

  describe('getBalance', () => {
    it('should return USDC balance for agent', async () => {
      const mockWallet = {
        agentId: 'agent-123',
        network: 'base-sepolia',
        balance: { usdc: 1000000, lastUpdated: new Date() }, // 1 USDC
      };

      mockDatabaseService.collection.findOne.mockResolvedValue(mockWallet);

      const balance = await service.getBalance('agent-123', 'base-sepolia');

      expect(balance).toBe(1000000);
    });

    it('should return 0 if wallet not found', async () => {
      mockDatabaseService.collection.findOne.mockResolvedValue(null);

      const balance = await service.getBalance('agent-123', 'base-sepolia');

      expect(balance).toBe(0);
    });

    it('should return 0 if balance not set', async () => {
      mockDatabaseService.collection.findOne.mockResolvedValue({
        agentId: 'agent-123',
        network: 'base-sepolia',
        balance: {},
      });

      const balance = await service.getBalance('agent-123', 'base-sepolia');

      expect(balance).toBe(0);
    });
  });

  describe('fundWallet', () => {
    it('should update wallet balance', async () => {
      const mockWallet = {
        agentId: 'agent-123',
        network: 'base-sepolia',
        balance: { usdc: 100000, lastUpdated: new Date() },
      };

      mockDatabaseService.collection.findOne.mockResolvedValue(mockWallet);
      mockDatabaseService.collection.updateOne.mockResolvedValue({ modifiedCount: 1 });

      await service.fundWallet('agent-123', 500000, 'base-sepolia');

      expect(mockDatabaseService.collection.updateOne).toHaveBeenCalledWith(
        { agentId: 'agent-123', network: 'base-sepolia' },
        {
          $inc: { 'balance.usdc': 500000 },
          $set: { 'balance.lastUpdated': expect.any(Date) },
        }
      );
    });

    it('should create wallet if not exists', async () => {
      mockDatabaseService.collection.findOne.mockResolvedValue(null);
      mockDatabaseService.collection.insertOne.mockResolvedValue({ insertedId: 'new-id' });
      mockDatabaseService.collection.updateOne
        .mockResolvedValueOnce({ modifiedCount: 0, matchedCount: 0 }) // First call: wallet doesn't exist
        .mockResolvedValueOnce({ modifiedCount: 1, matchedCount: 1 }); // Second call: wallet exists after creation

      await service.fundWallet('agent-123', 500000, 'base-sepolia');

      expect(mockDatabaseService.collection.insertOne).toHaveBeenCalled();
    });

    it('should reject negative amounts', async () => {
      await expect(
        service.fundWallet('agent-123', -100000, 'base-sepolia')
      ).rejects.toThrow('Amount must be positive');
    });

    it('should log funding transaction', async () => {
      mockDatabaseService.collection.findOne.mockResolvedValue({
        agentId: 'agent-123',
        network: 'base-sepolia',
        balance: { usdc: 0 },
      });
      mockDatabaseService.collection.updateOne.mockResolvedValue({ modifiedCount: 1, matchedCount: 1 });

      await service.fundWallet('agent-123', 500000, 'base-sepolia');

      // Check that info was called with a message containing the expected text
      const calls = mockLogger.info.mock.calls;
      const hasFundingLog = calls.some(call => 
        call[0] && call[0].includes('Funded wallet for agent agent-123')
      );
      expect(hasFundingLog).toBe(true);
    });
  });

  describe('createPayment', () => {
    it('should create signed payment transaction', async () => {
      const testPrivateKey = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const encryptedData = service._encryptPrivateKey(testPrivateKey);
      
      const mockWallet = {
        agentId: 'agent-123',
        network: 'base-sepolia',
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        privateKey: {
          encrypted: encryptedData.encrypted,
          iv: encryptedData.iv,
          authTag: encryptedData.authTag,
        },
        balance: { usdc: 1000000 },
        dailySpent: 0,
        dailyLimit: 10000000,
      };

      mockDatabaseService.collection.findOne.mockResolvedValue(mockWallet);

      const payment = await service.createPayment({
        agentId: 'agent-123',
        amount: 100000,
        destination: '0xRecipientAddress',
        network: 'base-sepolia',
      });

      expect(payment).toEqual({
        x402Version: 1,
        scheme: 'exact',
        network: 'base-sepolia',
        signedPayload: expect.stringMatching(/^0x[a-fA-F0-9]+$/),
        metadata: {
          agentId: 'agent-123',
          nonce: expect.any(String),
        },
      });
    });

    it('should reject payment if insufficient balance', async () => {
      const mockWallet = {
        agentId: 'agent-123',
        balance: { usdc: 50000 }, // Less than requested 100000
      };

      mockDatabaseService.collection.findOne.mockResolvedValue(mockWallet);

      await expect(
        service.createPayment({
          agentId: 'agent-123',
          amount: 100000,
          destination: '0xRecipient',
          network: 'base-sepolia',
        })
      ).rejects.toThrow('Insufficient balance');
    });

    it('should throw if wallet not found', async () => {
      mockDatabaseService.collection.findOne.mockResolvedValue(null);

      await expect(
        service.createPayment({
          agentId: 'agent-123',
          amount: 100000,
          destination: '0xRecipient',
          network: 'base-sepolia',
        })
      ).rejects.toThrow('Wallet not found');
    });

    it('should decrypt private key for signing', async () => {
      const testPrivateKey = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const encryptedData = service._encryptPrivateKey(testPrivateKey);
      
      const mockWallet = {
        agentId: 'agent-123',
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        network: 'base-sepolia',
        privateKey: {
          encrypted: encryptedData.encrypted,
          iv: encryptedData.iv,
          authTag: encryptedData.authTag,
        },
        balance: { usdc: 1000000 },
        dailySpent: 0,
        dailyLimit: 10000000,
      };

      mockDatabaseService.collection.findOne.mockResolvedValue(mockWallet);

      await service.createPayment({
        agentId: 'agent-123',
        amount: 100000,
        destination: '0xRecipient',
        network: 'base-sepolia',
      });

      // Private key should never be exposed in logs or errors
      const logMessages = mockLogger.info.mock.calls.map(call => call[0] || '').join('');
      expect(logMessages).not.toContain(testPrivateKey);
    });
  });

  describe('getTransactionHistory', () => {
    it('should retrieve transaction history for agent', async () => {
      const mockTransactions = [
        { agentId: 'agent-123', amount: 100000, status: 'settled', createdAt: new Date() },
        { agentId: 'agent-123', amount: 50000, status: 'verified', createdAt: new Date() },
      ];

      const mockCursor = {
        toArray: vi.fn().mockResolvedValue(mockTransactions),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
      };

      mockDatabaseService.collection.find.mockReturnValue(mockCursor);

      const history = await service.getTransactionHistory('agent-123', {
        limit: 10,
        offset: 0,
      });

      expect(history).toEqual(mockTransactions);
      expect(mockDatabaseService.collection.find).toHaveBeenCalledWith({
        agentId: 'agent-123',
      });
    });

    it('should support pagination', async () => {
      const mockCursor = {
        toArray: vi.fn().mockResolvedValue([]),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
      };

      mockDatabaseService.collection.find.mockReturnValue(mockCursor);

      await service.getTransactionHistory('agent-123', {
        limit: 20,
        offset: 40,
      });

      expect(mockCursor.limit).toHaveBeenCalledWith(20);
      expect(mockCursor.skip).toHaveBeenCalledWith(40);
      expect(mockCursor.sort).toHaveBeenCalledWith({ createdAt: -1 });
    });

    it('should filter by network', async () => {
      const mockCursor = {
        toArray: vi.fn().mockResolvedValue([]),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
      };

      mockDatabaseService.collection.find.mockReturnValue(mockCursor);

      await service.getTransactionHistory('agent-123', {
        network: 'base-sepolia',
      });

      expect(mockDatabaseService.collection.find).toHaveBeenCalledWith({
        agentId: 'agent-123',
        network: 'base-sepolia',
      });
    });
  });

  describe('Private Key Encryption/Decryption', () => {
    it('should encrypt and decrypt private key correctly', () => {
      const testPrivateKey = '0xaabbccddee1122334455667788990011223344556677889900112233445566';
      
      // Encrypt
      const encrypted = service._encryptPrivateKey(testPrivateKey);
      
      expect(encrypted.encrypted).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.authTag).toBeDefined();
      expect(encrypted.encrypted).not.toBe(testPrivateKey);
      
      // Decrypt
      const decrypted = service._decryptPrivateKey(
        encrypted.encrypted,
        encrypted.iv,
        encrypted.authTag
      );
      
      expect(decrypted).toBe(testPrivateKey);
    });

    it('should use different IV for each encryption', () => {
      const testPrivateKey = '0xaabbccddee112233445566778899001122334455667788990011223344556677';
      
      const encrypted1 = service._encryptPrivateKey(testPrivateKey);
      const encrypted2 = service._encryptPrivateKey(testPrivateKey);
      
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      expect(encrypted1.encrypted).not.toBe(encrypted2.encrypted);
    });

    it('should fail decryption with wrong auth tag', () => {
      const testPrivateKey = '0xaabbccddee112233445566778899001122334455667788990011223344556677';
      
      const encrypted = service._encryptPrivateKey(testPrivateKey);
      
      expect(() => {
        service._decryptPrivateKey(encrypted.encrypted, encrypted.iv, 'wrong-tag');
      }).toThrow();
    });
  });

  describe('Spending Limits', () => {
    it('should check daily spending limit', async () => {
      const mockWallet = {
        agentId: 'agent-123',
        address: '0xabc123',
        dailyLimit: 500000,
        dailySpent: 400000,
        lastResetDate: new Date().toISOString().split('T')[0],
        balance: 1000000,
      };

      mockDatabaseService.collection.findOne.mockResolvedValue(mockWallet);
      mockDatabaseService.collection.updateOne.mockResolvedValue({ matchedCount: 1 });

      // This should succeed (400000 + 50000 < 500000)
      const canSpend1 = await service._checkSpendingLimit('agent-123', 50000);
      expect(canSpend1).toBe(true);

      // This should fail (400000 + 200000 > 500000)
      const canSpend2 = await service._checkSpendingLimit('agent-123', 200000);
      expect(canSpend2).toBe(false);
    });

    it('should reset daily spending at midnight', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const mockWallet = {
        agentId: 'agent-123',
        dailyLimit: 500000,
        dailySpent: 1000000,
        lastResetDate: yesterday.toISOString().split('T')[0],
      };

      mockDatabaseService.collection.findOne.mockResolvedValue(mockWallet);
      mockDatabaseService.collection.updateOne.mockResolvedValue({ matchedCount: 1 });

      await service._checkSpendingLimit('agent-123', 100000);

      // Should reset spending
      expect(mockDatabaseService.collection.updateOne).toHaveBeenCalledWith(
        { agentId: 'agent-123' },
        expect.objectContaining({
          $set: expect.objectContaining({
            dailySpent: 0,
            lastResetDate: expect.any(String),
          }),
        })
      );
    });
  });
});
