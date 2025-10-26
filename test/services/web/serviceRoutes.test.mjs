/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/services/web/serviceRoutes.test.mjs
 * @description Tests for marketplace service routes
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import createServiceRoutes from '../../../src/services/web/server/routes/services.js';
import express from 'express';
import request from 'supertest';

describe('Service Routes', () => {
  let app;
  let mockServices;
  let mockMarketplaceServiceRegistry;
  let mockX402Service;
  let mockAgentWalletService;

  beforeEach(() => {
    // Create mock services
    mockMarketplaceServiceRegistry = {
      getService: vi.fn((serviceId) => {
        // Return mock service with metadata
        return {
          getMetadata: () => ({
            serviceId,
            providerId: 'system',
            name: `Test ${serviceId}`,
            description: 'Test service',
            category: 'utility',
            pricing: {
              model: 'per_request',
              amount: 1000000, // 1 USDC
              currency: 'USDC',
              decimals: 6,
            },
            endpoint: `/api/services/${serviceId}/execute`,
          }),
        };
      }),
      executeService: vi.fn().mockResolvedValue({
        success: true,
        result: 'test result',
      }),
      getAllServices: vi.fn().mockReturnValue([
        {
          serviceId: 'video-generation',
          name: 'Video Generation',
          category: 'ai',
        },
      ]),
    };

    mockX402Service = {
      createPaymentRequest: vi.fn().mockResolvedValue({
        paymentId: 'test-payment-id',
        amount: 1000000,
      }),
    };

    mockAgentWalletService = {
      getOrCreateWallet: vi.fn().mockResolvedValue({
        agentId: 'test-agent',
        address: '0xtest',
      }),
    };

    mockServices = {
      logger: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      },
      marketplaceServiceRegistry: mockMarketplaceServiceRegistry,
      x402Service: mockX402Service,
      agentWalletService: mockAgentWalletService,
    };

    // Create Express app with routes
    app = express();
    app.use(express.json());
    app.use('/api/services', createServiceRoutes(mockServices));
  });

  describe('Service Route Registration', () => {
    it('should create routes without throwing errors', () => {
      expect(() => createServiceRoutes(mockServices)).not.toThrow();
    });

    it('should handle missing marketplaceServiceRegistry gracefully', () => {
      const mockLogger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      };
      
      const servicesWithoutRegistry = {
        ...mockServices,
        logger: mockLogger,
        marketplaceServiceRegistry: null,
      };
      
      expect(() => createServiceRoutes(servicesWithoutRegistry)).not.toThrow();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('marketplaceServiceRegistry not available')
      );
    });

    it('should register all marketplace service endpoints', async () => {
      const endpoints = [
        '/video-generation/execute',
        '/image-generation/execute',
        '/agent-summon/execute',
        '/combat/execute',
        '/memory-query/execute',
        '/location-travel/execute',
        '/item-crafting/execute',
        '/social-posting/execute',
      ];

      for (const endpoint of endpoints) {
        // Each endpoint should be registered (we'll get 400 without proper auth, but not 404)
        const response = await request(app)
          .post(`/api/services${endpoint}`)
          .send({});
        
        expect(response.status).not.toBe(404);
      }
    });
  });

  describe('Payment Middleware Integration', () => {
    it('should extract pricing from service metadata', () => {
      const service = mockMarketplaceServiceRegistry.getService('video-generation');
      const metadata = service.getMetadata();
      
      expect(metadata.pricing).toBeDefined();
      expect(metadata.pricing.amount).toBeGreaterThan(0);
      expect(metadata.pricing.model).toBe('per_request');
    });

    it('should handle service not found gracefully', async () => {
      mockMarketplaceServiceRegistry.getService.mockReturnValueOnce(null);
      
      const response = await request(app)
        .post('/api/services/non-existent/execute')
        .send({ agentId: 'test-agent' });
      
      // Should get a proper error, not crash
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('Catalog Endpoint', () => {
    it('should return all available services', async () => {
      const response = await request(app)
        .get('/api/services/catalog');
      
      expect(response.status).toBe(200);
      expect(response.body.services).toBeDefined();
      expect(Array.isArray(response.body.services)).toBe(true);
    });

    it('should handle missing registry gracefully', async () => {
      const servicesWithoutRegistry = {
        ...mockServices,
        marketplaceServiceRegistry: null,
      };
      
      const app2 = express();
      app2.use(express.json());
      app2.use('/api/services', createServiceRoutes(servicesWithoutRegistry));
      
      const response = await request(app2)
        .get('/api/services/catalog');
      
      expect(response.status).toBe(200);
      expect(response.body.services).toEqual([]);
    });
  });

  describe('Service Metadata Validation', () => {
    it('should validate all services have valid pricing', () => {
      const serviceIds = [
        'video-generation',
        'image-generation',
        'agent-summon',
        'combat',
        'memory-query',
        'location-travel',
        'item-crafting',
        'social-posting',
      ];

      serviceIds.forEach(serviceId => {
        const service = mockMarketplaceServiceRegistry.getService(serviceId);
        const metadata = service.getMetadata();
        
        expect(metadata.pricing).toBeDefined();
        expect(typeof metadata.pricing.amount).toBe('number');
        expect(metadata.pricing.amount).toBeGreaterThanOrEqual(0);
        expect(['per_request', 'per_token', 'per_kb', 'subscription']).toContain(
          metadata.pricing.model
        );
      });
    });

    it('should validate all services have valid categories', () => {
      const validCategories = ['ai', 'data', 'compute', 'storage', 'social', 'utility'];
      const serviceIds = [
        'video-generation',
        'image-generation',
        'agent-summon',
        'combat',
        'memory-query',
        'location-travel',
        'item-crafting',
        'social-posting',
      ];

      serviceIds.forEach(serviceId => {
        const service = mockMarketplaceServiceRegistry.getService(serviceId);
        const metadata = service.getMetadata();
        
        expect(validCategories).toContain(metadata.category);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle missing agentId in request', async () => {
      const response = await request(app)
        .post('/api/services/video-generation/execute')
        .send({ prompt: 'test' });
      
      // Should get error response, not crash
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should handle service execution errors', async () => {
      mockMarketplaceServiceRegistry.executeService.mockRejectedValueOnce(
        new Error('Service execution failed')
      );
      
      // Mock the payment middleware to pass through
      mockX402Service.createPaymentRequest.mockResolvedValueOnce({
        paymentId: 'test',
        amount: 1000000,
      });
      
      const response = await request(app)
        .post('/api/services/video-generation/execute')
        .send({ agentId: 'test-agent', prompt: 'test' });
      
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });
});
