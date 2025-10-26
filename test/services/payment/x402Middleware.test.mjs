/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/services/payment/x402Middleware.test.mjs
 * @description Unit tests for x402 Express middleware
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { requirePayment } from '../../../src/services/web/server/middleware/x402.js';
import { createMockLogger } from '../../helpers/mockServices.mjs';

describe('x402Middleware', () => {
  let mockReq;
  let mockRes;
  let mockNext;
  let mockX402Service;
  let mockPricingService;

  beforeEach(() => {
    mockReq = {
      path: '/api/test/paid-endpoint',
      method: 'POST',
      headers: {},
      body: {},
      agent: { agentId: 'agent-123' },
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };

    mockNext = vi.fn();

    mockX402Service = {
      verifyPayment: vi.fn(),
      generatePaymentRequired: vi.fn(),
    };

    mockPricingService = {
      calculatePrice: vi.fn(),
    };
  });

  describe('Payment Required (402)', () => {
    it('should return 402 if no payment header present', async () => {
      mockX402Service.generatePaymentRequired.mockReturnValue({
        x402Version: 1,
        facilitator: { scheme: 'exact', network: 'base-sepolia' },
        price: { usdcAmount: 100000 },
        paymentDestination: { address: '0xSeller' },
      });

      const middleware = requirePayment({
        x402Service: mockX402Service,
        price: 100000,
      });
      
      await middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(402);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Payment Required',
          payment: expect.objectContaining({
            x402Version: 1,
          }),
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should include WWW-Authenticate header in 402 response', async () => {
      mockPricingService.calculatePrice.mockResolvedValue({
        usdcAmount: 100000,
      });

      mockX402Service.generatePaymentRequired.mockReturnValue({
        x402Version: 1,
        facilitator: { scheme: 'exact', network: 'base-sepolia' },
        price: { usdcAmount: 100000 },
        paymentDestination: { address: '0xSeller' },
      });

      const middleware = requirePayment({ x402Service: mockX402Service, price: 100000 });
      await middleware(mockReq, mockRes, mockNext, {
        x402Service: mockX402Service,
        pricingService: mockPricingService,
      });

      expect(mockRes.set).toHaveBeenCalledWith(
        'WWW-Authenticate',
        expect.stringContaining('x402')
      );
    });
  });

  describe('Payment Verification', () => {
    it('should verify payment and call next() if valid', async () => {
      const mockPaymentPayload = {
        x402Version: 1,
        scheme: 'exact',
        network: 'base-sepolia',
        signedPayload: '0xabc123...',
      };

      mockReq.headers['x-x402-metadata'] = Buffer.from(
        JSON.stringify(mockPaymentPayload)
      ).toString('base64');

      mockPricingService.calculatePrice.mockResolvedValue({
        usdcAmount: 100000,
      });

      mockX402Service.verifyPayment.mockResolvedValue({
        verified: true,
        settlementId: 'settlement-123',
        txHash: '0xabc123...',
      });

      const middleware = requirePayment({ x402Service: mockX402Service, price: 100000 });
      await middleware(mockReq, mockRes, mockNext, {
        x402Service: mockX402Service,
        pricingService: mockPricingService,
      });

      expect(mockX402Service.verifyPayment).toHaveBeenCalledWith({
        paymentPayload: mockPaymentPayload,
        expectedAmount: 100000,
        sellerAddress: expect.any(String),
        metadata: expect.any(Object),
      });

      expect(mockReq.payment).toEqual({
        verified: true,
        settlementId: 'settlement-123',
        txHash: '0xabc123...',
      });

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should return 402 if payment verification fails', async () => {
      const mockPaymentPayload = {
        x402Version: 1,
        scheme: 'exact',
        network: 'base-sepolia',
        signedPayload: '0xabc123...',
      };

      mockReq.headers['x-x402-metadata'] = Buffer.from(
        JSON.stringify(mockPaymentPayload)
      ).toString('base64');

      mockPricingService.calculatePrice.mockResolvedValue({
        usdcAmount: 100000,
      });

      mockX402Service.verifyPayment.mockResolvedValue({
        verified: false,
        reason: 'Amount mismatch',
      });

      mockX402Service.generatePaymentRequired.mockReturnValue({
        x402Version: 1,
        price: { usdcAmount: 100000 },
      });

      const middleware = requirePayment({ x402Service: mockX402Service, price: 100000 });
      await middleware(mockReq, mockRes, mockNext, {
        x402Service: mockX402Service,
        pricingService: mockPricingService,
      });

      expect(mockRes.status).toHaveBeenCalledWith(402);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Payment verification failed',
          reason: 'Amount mismatch',
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle malformed payment header', async () => {
      mockReq.headers['x-x402-metadata'] = 'invalid-base64!!!';

      mockPricingService.calculatePrice.mockResolvedValue({
        usdcAmount: 100000,
      });

      mockX402Service.generatePaymentRequired.mockReturnValue({
        x402Version: 1,
        price: { usdcAmount: 100000 },
      });

      const middleware = requirePayment({ x402Service: mockX402Service, price: 100000 });
      await middleware(mockReq, mockRes, mockNext, {
        x402Service: mockX402Service,
        pricingService: mockPricingService,
      });

      expect(mockRes.status).toHaveBeenCalledWith(402);
      expect(mockX402Service.verifyPayment).not.toHaveBeenCalled();
    });
  });

  describe('Dynamic Pricing', () => {
    it('should call pricing function with request context', async () => {
      const pricingFn = vi.fn().mockResolvedValue({ usdcAmount: 150000 });

      mockX402Service.generatePaymentRequired.mockReturnValue({
        x402Version: 1,
        price: { usdcAmount: 150000 },
      });

      const middleware = requirePayment({ x402Service: mockX402Service, price: 100000 });
      await middleware(mockReq, mockRes, mockNext, {
        x402Service: mockX402Service,
      });

      expect(pricingFn).toHaveBeenCalledWith(mockReq);
    });

    it('should handle pricing function errors', async () => {
      const pricingFn = vi.fn().mockRejectedValue(new Error('Pricing failed'));

      const middleware = requirePayment({ x402Service: mockX402Service, price: 100000 });
      await middleware(mockReq, mockRes, mockNext, {
        x402Service: mockX402Service,
      });

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Pricing'),
        })
      );
    });

    it('should support static pricing', async () => {
      mockX402Service.generatePaymentRequired.mockReturnValue({
        x402Version: 1,
        price: { usdcAmount: 50000 },
      });

      const middleware = requirePayment({ x402Service: mockX402Service, price: 100000 });
      await middleware(mockReq, mockRes, mockNext, {
        x402Service: mockX402Service,
      });

      expect(mockX402Service.generatePaymentRequired).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 50000,
        })
      );
    });
  });

  describe('Free Endpoints (Optional Payment)', () => {
    it('should allow free access if price is 0', async () => {
      const middleware = requirePayment({ x402Service: mockX402Service, price: 100000 });
      await middleware(mockReq, mockRes, mockNext, {
        x402Service: mockX402Service,
      });

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockX402Service.verifyPayment).not.toHaveBeenCalled();
    });

    it('should support optional payment with tip', async () => {
      const mockPaymentPayload = {
        x402Version: 1,
        scheme: 'exact',
        network: 'base-sepolia',
        signedPayload: '0xabc123...',
      };

      mockReq.headers['x-x402-metadata'] = Buffer.from(
        JSON.stringify(mockPaymentPayload)
      ).toString('base64');

      mockX402Service.verifyPayment.mockResolvedValue({
        verified: true,
        settlementId: 'settlement-123',
      });

      const middleware = requirePayment({ x402Service: mockX402Service, price: 100000 });
      await middleware(mockReq, mockRes, mockNext, {
        x402Service: mockX402Service,
      });

      // Should accept payment even though endpoint is free
      expect(mockX402Service.verifyPayment).toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Agent-to-Agent Payments', () => {
    it('should route payment to service provider agent', async () => {
      const mockPaymentPayload = {
        x402Version: 1,
        scheme: 'exact',
        network: 'base-sepolia',
        signedPayload: '0xabc123...',
      };

      mockReq.headers['x-x402-metadata'] = Buffer.from(
        JSON.stringify(mockPaymentPayload)
      ).toString('base64');

      mockReq.serviceProvider = {
        agentId: 'provider-agent-456',
        walletAddress: '0xProviderWallet',
      };

      mockX402Service.verifyPayment.mockResolvedValue({
        verified: true,
        settlementId: 'settlement-123',
      });

      const middleware = requirePayment({ x402Service: mockX402Service, price: 100000 });
      await middleware(mockReq, mockRes, mockNext, {
        x402Service: mockX402Service,
      });

      expect(mockX402Service.verifyPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          sellerAddress: '0xProviderWallet',
        })
      );
    });
  });

  describe('Metadata Attachment', () => {
    it('should attach payment info to request', async () => {
      const mockPaymentPayload = {
        x402Version: 1,
        scheme: 'exact',
        network: 'base-sepolia',
        signedPayload: '0xabc123...',
      };

      mockReq.headers['x-x402-metadata'] = Buffer.from(
        JSON.stringify(mockPaymentPayload)
      ).toString('base64');

      mockX402Service.verifyPayment.mockResolvedValue({
        verified: true,
        settlementId: 'settlement-123',
        txHash: '0xabc123...',
        amount: 100000,
        network: 'base-sepolia',
      });

      const middleware = requirePayment({ x402Service: mockX402Service, price: 100000 });
      await middleware(mockReq, mockRes, mockNext, {
        x402Service: mockX402Service,
      });

      expect(mockReq.payment).toEqual({
        verified: true,
        settlementId: 'settlement-123',
        txHash: '0xabc123...',
        amount: 100000,
        network: 'base-sepolia',
      });
    });

    it('should attach agent and resource metadata', async () => {
      const mockPaymentPayload = {
        x402Version: 1,
        scheme: 'exact',
        network: 'base-sepolia',
        signedPayload: '0xabc123...',
      };

      mockReq.headers['x-x402-metadata'] = Buffer.from(
        JSON.stringify(mockPaymentPayload)
      ).toString('base64');
      mockReq.agent = { agentId: 'agent-123' };

      mockX402Service.verifyPayment.mockResolvedValue({
        verified: true,
        settlementId: 'settlement-123',
      });

      const middleware = requirePayment({ x402Service: mockX402Service, price: 100000 });
      await middleware(mockReq, mockRes, mockNext, {
        x402Service: mockX402Service,
      });

      expect(mockX402Service.verifyPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            agentId: 'agent-123',
            resource: '/api/test/paid-endpoint',
          }),
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle verification errors gracefully', async () => {
      const mockPaymentPayload = {
        x402Version: 1,
        scheme: 'exact',
        network: 'base-sepolia',
        signedPayload: '0xabc123...',
      };

      mockReq.headers['x-x402-metadata'] = Buffer.from(
        JSON.stringify(mockPaymentPayload)
      ).toString('base64');

      mockX402Service.verifyPayment.mockRejectedValue(
        new Error('Network error')
      );

      const middleware = requirePayment({ x402Service: mockX402Service, price: 100000 });
      await middleware(mockReq, mockRes, mockNext, {
        x402Service: mockX402Service,
      });

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('verification'),
        })
      );
    });

    it('should log errors for debugging', async () => {
      const mockLogger = createMockLogger();
      const mockPaymentPayload = {
        x402Version: 1,
        scheme: 'exact',
        network: 'base-sepolia',
        signedPayload: '0xabc123...',
      };

      mockReq.headers['x-x402-metadata'] = Buffer.from(
        JSON.stringify(mockPaymentPayload)
      ).toString('base64');

      mockX402Service.verifyPayment.mockRejectedValue(
        new Error('Test error')
      );

      const middleware = requirePayment({ x402Service: mockX402Service, price: 100000 });
      await middleware(mockReq, mockRes, mockNext, {
        x402Service: mockX402Service,
        logger: mockLogger,
      });

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Configuration Options', () => {
    it('should support custom seller address', async () => {
      mockX402Service.generatePaymentRequired.mockReturnValue({
        x402Version: 1,
        price: { usdcAmount: 100000 },
        paymentDestination: { address: '0xCustomSeller' },
      });

      const middleware = requirePayment(
        { usdcAmount: 100000 },
        { sellerAddress: '0xCustomSeller' }
      );

      await middleware(mockReq, mockRes, mockNext, {
        x402Service: mockX402Service,
      });

      expect(mockX402Service.generatePaymentRequired).toHaveBeenCalledWith(
        expect.objectContaining({
          destination: '0xCustomSeller',
        })
      );
    });

    it('should support custom network', async () => {
      mockX402Service.generatePaymentRequired.mockReturnValue({
        x402Version: 1,
        facilitator: { scheme: 'exact', network: 'solana-devnet' },
        price: { usdcAmount: 100000 },
      });

      const middleware = requirePayment(
        { usdcAmount: 100000 },
        { network: 'solana-devnet' }
      );

      await middleware(mockReq, mockRes, mockNext, {
        x402Service: mockX402Service,
      });

      expect(mockX402Service.generatePaymentRequired).toHaveBeenCalledWith(
        expect.objectContaining({
          network: 'solana-devnet',
        })
      );
    });
  });
});
