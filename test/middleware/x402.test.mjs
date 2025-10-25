/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/middleware/x402.test.mjs
 * @description Tests for x402 payment middleware
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { requirePayment } from '@/services/web/server/middleware/x402.js';

describe('x402 Payment Middleware', () => {
  let mockX402Service;
  let mockLogger;
  let mockReq;
  let mockRes;
  let mockNext;
  let middleware;

  beforeEach(() => {
    mockX402Service = {
      generatePaymentRequired: vi.fn().mockReturnValue({
        x402Version: 1,
        facilitator: { scheme: 'exact', network: 'base' },
        price: { usdcAmount: 50000 },
        paymentDestination: { address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb' },
      }),
      verifyPayment: vi.fn().mockResolvedValue({
        verified: true,
        amount: 50000,
        settlementId: 'settlement-123',
      }),
      settlePayment: vi.fn().mockResolvedValue({
        settled: true,
        txHash: '0x...',
      }),
    };

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    mockReq = {
      headers: {},
      path: '/api/test-endpoint',
      log: mockLogger,
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    mockNext = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Missing Payment', () => {
    beforeEach(() => {
      middleware = requirePayment({
        x402Service: mockX402Service,
        price: 50000,
        sellerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      });
    });

    it('should return 402 when payment header is missing', async () => {
      await middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(402);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          x402Version: 1,
          price: expect.objectContaining({ usdcAmount: 50000 }),
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should include payment destination in 402 response', async () => {
      await middleware(mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentDestination: expect.objectContaining({
            address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
          }),
        })
      );
    });
  });

  describe('Payment Verification', () => {
    beforeEach(() => {
      middleware = requirePayment({
        x402Service: mockX402Service,
        price: 50000,
        sellerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      });

      mockReq.headers['x-x402-metadata'] = Buffer.from(
        JSON.stringify({
          x402Version: 1,
          scheme: 'exact',
          network: 'base',
          signedPayload: '0x...',
        })
      ).toString('base64');
    });

    it('should verify payment and call next', async () => {
      await middleware(mockReq, mockRes, mockNext);

      expect(mockX402Service.verifyPayment).toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.payment).toBeDefined();
      expect(mockReq.payment.verified).toBe(true);
    });

    it('should attach payment info to request', async () => {
      await middleware(mockReq, mockRes, mockNext);

      expect(mockReq.payment).toEqual({
        verified: true,
        amount: 50000,
        settlementId: 'settlement-123',
      });
    });

    it('should settle payment in background', async () => {
      await middleware(mockReq, mockRes, mockNext);

      // Wait for async settlement
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockX402Service.settlePayment).toHaveBeenCalledWith({
        settlementId: 'settlement-123',
      });
    });

    it('should handle settlement errors gracefully', async () => {
      mockX402Service.settlePayment.mockRejectedValue(new Error('Settlement failed'));

      await middleware(mockReq, mockRes, mockNext);
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should not affect the response
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Payment Verification Failure', () => {
    beforeEach(() => {
      middleware = requirePayment({
        x402Service: mockX402Service,
        price: 50000,
        sellerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      });

      mockReq.headers['x-x402-metadata'] = Buffer.from(
        JSON.stringify({
          x402Version: 1,
          scheme: 'exact',
          network: 'base',
          signedPayload: '0x...',
        })
      ).toString('base64');
    });

    it('should return 402 for invalid payment', async () => {
      mockX402Service.verifyPayment.mockResolvedValue({
        verified: false,
        reason: 'Invalid signature',
      });

      await middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(402);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Payment verification failed',
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 402 for insufficient amount', async () => {
      mockX402Service.verifyPayment.mockResolvedValue({
        verified: false,
        reason: 'Amount mismatch',
      });

      await middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(402);
    });
  });

  describe('Payment Callback', () => {
    let onPaymentReceived;

    beforeEach(() => {
      onPaymentReceived = vi.fn().mockResolvedValue(undefined);

      middleware = requirePayment({
        x402Service: mockX402Service,
        price: 50000,
        sellerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        onPaymentReceived,
      });

      mockReq.headers['x-x402-metadata'] = Buffer.from(
        JSON.stringify({
          x402Version: 1,
          scheme: 'exact',
          network: 'base',
          signedPayload: '0x...',
        })
      ).toString('base64');
    });

    it('should call payment callback on successful verification', async () => {
      await middleware(mockReq, mockRes, mockNext);

      expect(onPaymentReceived).toHaveBeenCalledWith(
        mockReq,
        expect.objectContaining({
          verified: true,
          amount: 50000,
        })
      );
    });

    it('should handle callback errors gracefully', async () => {
      onPaymentReceived.mockRejectedValue(new Error('Callback error'));

      await middleware(mockReq, mockRes, mockNext);

      // Should still call next even if callback fails
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Dynamic Pricing', () => {
    let pricingFn;

    beforeEach(() => {
      pricingFn = vi.fn().mockResolvedValue({ usdcAmount: 75000 });

      middleware = requirePayment({
        x402Service: mockX402Service,
        priceFn: pricingFn,
        sellerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      });
    });

    it('should call pricing function with request', async () => {
      await middleware(mockReq, mockRes, mockNext);

      expect(pricingFn).toHaveBeenCalledWith(mockReq);
    });

    it('should use dynamic price in 402 response', async () => {
      await middleware(mockReq, mockRes, mockNext);

      expect(mockX402Service.generatePaymentRequired).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 75000,
        })
      );
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      middleware = requirePayment({
        x402Service: mockX402Service,
        price: 50000,
        sellerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      });
    });

    it('should handle invalid payment header format', async () => {
      mockReq.headers['x-x402-metadata'] = 'invalid-base64!!!';

      await middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(402);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Invalid'),
        })
      );
    });

    it('should handle verification service errors', async () => {
      mockReq.headers['x-x402-metadata'] = Buffer.from(
        JSON.stringify({ valid: 'payload' })
      ).toString('base64');

      mockX402Service.verifyPayment.mockRejectedValue(
        new Error('CDP service unavailable')
      );

      await middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(String),
        })
      );
    });
  });

  describe('Configuration Validation', () => {
    it('should throw error if x402Service is missing', () => {
      expect(() => {
        requirePayment({
          price: 50000,
          sellerAddress: '0x...',
        });
      }).toThrow('x402Service is required');
    });

    it('should accept valid configuration', () => {
      expect(() => {
        requirePayment({
          x402Service: mockX402Service,
          price: 50000,
          sellerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        });
      }).not.toThrow();
    });
  });
});
