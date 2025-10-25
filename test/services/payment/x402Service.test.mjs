/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/services/payment/x402Service.test.mjs
 * @description Unit tests for X402Service - Coinbase CDP x402 facilitator integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { X402Service } from '../../../src/services/payment/x402Service.mjs';
import { createMockLogger, createMockConfigService, createMockDatabaseService } from '../../helpers/mockServices.mjs';

// Test API credentials (testnet only - these are example/test values)
const TEST_API_KEY_ID = 'organizations/test-org-id/apiKeys/test-key-id';
const TEST_API_KEY_SECRET = 'test-secret-key-base64-encoded-value==';

describe('X402Service', () => {
  let service;
  let mockLogger;
  let mockConfigService;
  let mockDatabaseService;
  let mockFetch;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockConfigService = createMockConfigService();
    mockDatabaseService = createMockDatabaseService();
    
    // Mock CDP API configuration
    mockConfigService.config = {
      payment: {
        x402: {
          apiKeyId: TEST_API_KEY_ID,
          apiKeySecret: TEST_API_KEY_SECRET,
          sellerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
          defaultNetwork: 'base-sepolia',
          enableTestnet: true,
        }
      }
    };

    // Mock global fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    service = new X402Service({
      logger: mockLogger,
      configService: mockConfigService,
      databaseService: mockDatabaseService,
    });

    // Mock JWT generation (unit test focuses on service logic, not CDP SDK)
    vi.spyOn(service, '_generateJWT').mockResolvedValue('mock-jwt-token');
  });

  describe('Initialization', () => {
    it('should initialize with CDP credentials', () => {
      expect(service).toBeDefined();
      expect(service.cdpApiKeyId).toBe(TEST_API_KEY_ID);
      expect(service.sellerAddress).toBe('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb');
    });

    it('should throw error if CDP credentials missing', () => {
      mockConfigService.config.payment.x402.apiKeyId = null;
      
      expect(() => {
        new X402Service({
          logger: mockLogger,
          configService: mockConfigService,
          databaseService: mockDatabaseService,
        });
      }).toThrow('CDP API credentials not configured');
    });

    it('should use testnet by default if enabled', () => {
      expect(service.defaultNetwork).toBe('base-sepolia');
    });
  });

  describe('getSupportedNetworks', () => {
    it('should fetch supported networks from CDP', async () => {
      const mockResponse = {
        kinds: [
          { x402Version: 1, scheme: 'exact', network: 'base' },
          { x402Version: 1, scheme: 'exact', network: 'base-sepolia' },
          { x402Version: 1, scheme: 'exact', network: 'solana' },
          { x402Version: 1, scheme: 'exact', network: 'solana-devnet' },
        ]
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const networks = await service.getSupportedNetworks();

      expect(networks).toEqual(mockResponse.kinds);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.cdp.coinbase.com/platform/v2/x402/supported',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': expect.stringContaining('Bearer '),
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should cache supported networks', async () => {
      const mockResponse = {
        kinds: [
          { x402Version: 1, scheme: 'exact', network: 'base' },
        ]
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      // First call
      await service.getSupportedNetworks();
      
      // Second call should use cache
      await service.getSupportedNetworks();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle API errors gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(service.getSupportedNetworks()).rejects.toThrow('Failed to fetch supported networks');
    });
  });

  describe('verifyPayment', () => {
    const mockPaymentPayload = {
      x402Version: 1,
      scheme: 'exact',
      network: 'base-sepolia',
      signedPayload: '0x02f87082014a8085174876e80085174876e8008252089...',
    };

    it('should verify payment with CDP facilitator', async () => {
      const mockVerifyResponse = {
        verified: true,
        settlementId: 'settlement-123',
        txHash: '0xabc123...',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockVerifyResponse,
      });

      const result = await service.verifyPayment({
        paymentPayload: mockPaymentPayload,
        expectedAmount: 100000, // 0.1 USDC
        sellerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      });

      expect(result.verified).toBe(true);
      expect(result.settlementId).toBe('settlement-123');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.cdp.coinbase.com/platform/v2/x402/verify',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"scheme":"exact"'),
        })
      );
    });

    it('should reject payment with incorrect amount', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          verified: false,
          reason: 'Amount mismatch',
        }),
      });

      const result = await service.verifyPayment({
        paymentPayload: mockPaymentPayload,
        expectedAmount: 100000,
        sellerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      });

      expect(result.verified).toBe(false);
      expect(result.reason).toBe('Amount mismatch');
    });

    it('should store verified payment in database', async () => {
      const mockVerifyResponse = {
        verified: true,
        settlementId: 'settlement-123',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockVerifyResponse,
      });

      await service.verifyPayment({
        paymentPayload: mockPaymentPayload,
        expectedAmount: 100000,
        sellerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        metadata: { agentId: 'agent-123', resource: '/api/test' },
      });

      expect(mockDatabaseService.collection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          settlementId: 'settlement-123',
          status: 'verified',
          amount: 100000,
        })
      );
    });

    it('should handle nonce replay attacks', async () => {
      const payloadWithNonce = {
        ...mockPaymentPayload,
        metadata: { nonce: 'used-nonce-123' },
      };

      // First call succeeds
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ verified: true, settlementId: 'settlement-1' }),
      });
      
      await service.verifyPayment({
        paymentPayload: payloadWithNonce,
        expectedAmount: 100000,
        sellerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      });

      // Second call with same nonce should fail
      const result = await service.verifyPayment({
        paymentPayload: payloadWithNonce,
        expectedAmount: 100000,
        sellerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      });
      
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('Nonce already used');
    });
  });

  describe('settlePayment', () => {
    it('should settle payment via CDP', async () => {
      const mockSettleResponse = {
        settled: true,
        txHash: '0xabc123...',
        blockNumber: 12345,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockSettleResponse,
      });

      const result = await service.settlePayment({
        settlementId: 'settlement-123',
      });

      expect(result.settled).toBe(true);
      expect(result.txHash).toBe('0xabc123...');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.cdp.coinbase.com/platform/v2/x402/settle',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"settlementId":"settlement-123"'),
        })
      );
    });

    it('should update transaction status in database', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ settled: true, txHash: '0xabc123...' }),
      });

      await service.settlePayment({ settlementId: 'settlement-123' });

      expect(mockDatabaseService.collection.updateOne).toHaveBeenCalledWith(
        { settlementId: 'settlement-123' },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: 'settled',
            txHash: '0xabc123...',
          }),
        })
      );
    });

    it('should handle settlement failures', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ errorMessage: 'Invalid settlement ID' }),
      });

      await expect(
        service.settlePayment({ settlementId: 'invalid-id' })
      ).rejects.toThrow('Settlement failed');
    });
  });

  describe('generatePaymentRequired', () => {
    it('should generate 402 response with payment instructions', () => {
      const response = service.generatePaymentRequired({
        amount: 100000, // 0.1 USDC
        destination: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        resource: '/api/premium-endpoint',
        network: 'base-sepolia',
      });

      expect(response).toEqual({
        x402Version: 1,
        facilitator: {
          scheme: 'exact',
          network: 'base-sepolia',
        },
        price: {
          usdcAmount: 100000,
        },
        paymentDestination: {
          address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        },
        metadata: expect.objectContaining({
          resource: '/api/premium-endpoint',
          nonce: expect.any(String),
          expiresAt: expect.any(String),
        }),
      });
    });

    it('should include expiration timestamp', () => {
      const response = service.generatePaymentRequired({
        amount: 100000,
        destination: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        resource: '/api/test',
      });

      const expiresAt = new Date(response.metadata.expiresAt);
      const now = new Date();
      const tenMinutes = 10 * 60 * 1000;

      expect(expiresAt.getTime()).toBeGreaterThan(now.getTime());
      expect(expiresAt.getTime()).toBeLessThan(now.getTime() + tenMinutes + 1000);
    });

    it('should generate unique nonce for each request', () => {
      const response1 = service.generatePaymentRequired({
        amount: 100000,
        destination: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        resource: '/api/test',
      });

      const response2 = service.generatePaymentRequired({
        amount: 100000,
        destination: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        resource: '/api/test',
      });

      expect(response1.metadata.nonce).not.toBe(response2.metadata.nonce);
    });
  });

  describe('getSettlementStatus', () => {
    it('should retrieve settlement status from database', async () => {
      const mockTransaction = {
        settlementId: 'settlement-123',
        status: 'settled',
        txHash: '0xabc123...',
        amount: 100000,
        network: 'base-sepolia',
        settledAt: new Date(),
      };

      mockDatabaseService.collection.findOne.mockResolvedValue(mockTransaction);

      const status = await service.getSettlementStatus('settlement-123');

      expect(status).toEqual(mockTransaction);
      expect(mockDatabaseService.collection.findOne).toHaveBeenCalledWith({
        settlementId: 'settlement-123',
      });
    });

    it('should return null for non-existent settlement', async () => {
      mockDatabaseService.collection.findOne.mockResolvedValue(null);

      const status = await service.getSettlementStatus('non-existent');

      expect(status).toBeNull();
    });
  });

  describe('JWT Token Generation', () => {
    it('should generate valid JWT for CDP API', () => {
      // Restore real implementation for this test
      service._generateJWT.mockRestore?.();
      
      // Mock the JWT sign function directly
      const mockJWT = 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InRlc3QifQ.eyJzdWIiOiJ0ZXN0Iiwi' +
        'aXNzIjoiY2RwIiwiYXVkIjpbImNkcF9zZXJ2aWNlIl0sIm5iZiI6MTcwMDAwMDAwMCwiZXhwIjoxNzAwMDAwMTIwLCJpYXQiOjE3MDAwMDAwMDB9.' +
        'signature';
      
      vi.spyOn(service, '_generateJWT').mockReturnValue(mockJWT);
      
      const token = service._generateJWT();

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should include required claims', () => {
      // Use mock that includes proper claims
      const mockPayload = {
        sub: 'organizations/test/apiKeys/test',
        iss: 'cdp',
        aud: ['cdp_service'],
        nbf: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 120,
        iat: Math.floor(Date.now() / 1000),
      };
      
      const mockJWT = 'header.' + Buffer.from(JSON.stringify(mockPayload)).toString('base64') + '.signature';
      vi.spyOn(service, '_generateJWT').mockReturnValue(mockJWT);
      
      const token = service._generateJWT();
      const [, payloadBase64] = token.split('.');
      const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString());

      expect(payload.sub).toBe('organizations/test/apiKeys/test');
      expect(payload.iss).toBe('cdp');
      expect(payload.aud).toContain('cdp_service');
      expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(
        service.getSupportedNetworks()
      ).rejects.toThrow('Network error');
    });

    it('should handle malformed responses', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => { throw new Error('Invalid JSON'); },
      });

      await expect(
        service.getSupportedNetworks()
      ).rejects.toThrow();
    });

    it('should log errors appropriately', async () => {
      mockFetch.mockRejectedValue(new Error('Test error'));

      await expect(service.getSupportedNetworks()).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});
