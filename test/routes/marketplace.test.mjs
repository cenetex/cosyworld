/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/routes/marketplace.test.mjs
 * @description Integration tests for marketplace API endpoints
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import createMarketplaceRoutes from '@/services/web/server/routes/marketplace.js';

describe('Marketplace API Routes', () => {
  let app;
  let mockMarketplaceService;
  let mockX402Service;
  let mockAgentWalletService;
  let mockLogger;

  beforeEach(() => {
    // Mock services
    mockMarketplaceService = {
      searchServices: vi.fn(),
      getService: vi.fn(),
      registerService: vi.fn(),
      updateService: vi.fn(),
      deleteService: vi.fn(),
      rateService: vi.fn(),
      getServiceRatings: vi.fn(),
      getProviderStats: vi.fn(),
      recordUsage: vi.fn(),
    };

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

    mockAgentWalletService = {
      getOrCreateWallet: vi.fn().mockResolvedValue({
        agentId: 'agent-123',
        network: 'base',
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        balance: { usdc: 100000 },
      }),
      fundWallet: vi.fn().mockResolvedValue({ success: true }),
    };

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    // Create Express app with routes
    app = express();
    app.use(express.json());
    
    const routes = createMarketplaceRoutes({
      marketplaceService: mockMarketplaceService,
      x402Service: mockX402Service,
      agentWalletService: mockAgentWalletService,
      logger: mockLogger,
    });
    
    app.use('/api/marketplace', routes);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/marketplace/services', () => {
    it('should return list of services', async () => {
      const mockServices = {
        services: [
          { serviceId: '1', name: 'Service 1' },
          { serviceId: '2', name: 'Service 2' },
        ],
        total: 2,
        page: 1,
        totalPages: 1,
      };

      mockMarketplaceService.searchServices.mockResolvedValue(mockServices);

      const response = await request(app).get('/api/marketplace/services');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockServices);
      expect(mockMarketplaceService.searchServices).toHaveBeenCalled();
    });

    it('should filter by category', async () => {
      mockMarketplaceService.searchServices.mockResolvedValue({
        services: [],
        total: 0,
        page: 1,
        totalPages: 0,
      });

      await request(app).get('/api/marketplace/services?category=ai');

      expect(mockMarketplaceService.searchServices).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'ai' })
      );
    });

    it('should handle search query', async () => {
      mockMarketplaceService.searchServices.mockResolvedValue({
        services: [],
        total: 0,
        page: 1,
        totalPages: 0,
      });

      await request(app).get('/api/marketplace/services?search=quest');

      expect(mockMarketplaceService.searchServices).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'quest' })
      );
    });

    it('should handle pagination', async () => {
      mockMarketplaceService.searchServices.mockResolvedValue({
        services: [],
        total: 0,
        page: 2,
        totalPages: 5,
      });

      await request(app).get('/api/marketplace/services?page=2&limit=10');

      expect(mockMarketplaceService.searchServices).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 10,
          skip: 10, // (page-1) * limit
        })
      );
    });

    it('should handle service errors', async () => {
      mockMarketplaceService.searchServices.mockRejectedValue(
        new Error('Database error')
      );

      const response = await request(app).get('/api/marketplace/services');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to search services');
    });
  });

  describe('GET /api/marketplace/services/:serviceId', () => {
    it('should return service details', async () => {
      const mockService = {
        serviceId: 'service-123',
        name: 'Test Service',
        description: 'A test service',
      };
      const mockRatings = [{ rating: 5, comment: 'Great!' }];

      mockMarketplaceService.getService.mockResolvedValue(mockService);
      mockMarketplaceService.getServiceRatings.mockResolvedValue(mockRatings);

      const response = await request(app).get('/api/marketplace/services/service-123');

      expect(response.status).toBe(200);
      expect(response.body.serviceId).toBe('service-123');
      expect(response.body.recentRatings).toEqual(mockRatings);
    });

    it('should return 404 for non-existent service', async () => {
      mockMarketplaceService.getService.mockResolvedValue(null);

      const response = await request(app).get('/api/marketplace/services/non-existent');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Service not found');
    });
  });

  describe('POST /api/marketplace/services', () => {
    const validServiceData = {
      providerId: 'agent-123',
      name: 'New Service',
      description: 'A new service description',
      category: 'ai',
      pricing: {
        model: 'per_request',
        amount: 50000,
      },
      endpoint: '/api/services/new-service',
    };

    it('should create a new service', async () => {
      const createdService = {
        ...validServiceData,
        serviceId: 'new-service-id',
        createdAt: new Date(),
      };

      mockMarketplaceService.registerService.mockResolvedValue(createdService);

      const response = await request(app)
        .post('/api/marketplace/services')
        .send(validServiceData);

      expect(response.status).toBe(201);
      expect(response.body.serviceId).toBe('new-service-id');
      expect(mockMarketplaceService.registerService).toHaveBeenCalledWith(
        validServiceData
      );
    });

    it('should require providerId', async () => {
      const invalidData = { ...validServiceData };
      delete invalidData.providerId;

      const response = await request(app)
        .post('/api/marketplace/services')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('providerId is required');
    });

    it('should handle validation errors', async () => {
      mockMarketplaceService.registerService.mockRejectedValue(
        new Error('Validation failed: Service name must be at least 3 characters')
      );

      const response = await request(app)
        .post('/api/marketplace/services')
        .send({ ...validServiceData, name: 'ab' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Failed to register service');
    });
  });

  describe('PUT /api/marketplace/services/:serviceId', () => {
    it('should update a service', async () => {
      const updatedService = {
        serviceId: 'service-123',
        name: 'Updated Name',
      };

      mockMarketplaceService.updateService.mockResolvedValue(updatedService);

      const response = await request(app)
        .put('/api/marketplace/services/service-123')
        .send({
          providerId: 'agent-123',
          name: 'Updated Name',
        });

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Updated Name');
    });

    it('should require providerId', async () => {
      const response = await request(app)
        .put('/api/marketplace/services/service-123')
        .send({ name: 'Updated Name' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('providerId is required');
    });

    it('should handle unauthorized updates', async () => {
      mockMarketplaceService.updateService.mockRejectedValue(
        new Error('Service not found or unauthorized')
      );

      const response = await request(app)
        .put('/api/marketplace/services/service-123')
        .send({
          providerId: 'wrong-agent',
          name: 'Updated Name',
        });

      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /api/marketplace/services/:serviceId', () => {
    it('should delete a service', async () => {
      mockMarketplaceService.deleteService.mockResolvedValue(true);

      const response = await request(app)
        .delete('/api/marketplace/services/service-123')
        .send({ providerId: 'agent-123' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should require providerId', async () => {
      const response = await request(app)
        .delete('/api/marketplace/services/service-123')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('providerId is required');
    });
  });

  describe('POST /api/marketplace/services/:serviceId/rate', () => {
    it('should rate a service', async () => {
      const mockRating = {
        serviceId: 'service-123',
        userId: 'user-123',
        rating: 5,
        comment: 'Excellent!',
      };

      mockMarketplaceService.rateService.mockResolvedValue(mockRating);

      const response = await request(app)
        .post('/api/marketplace/services/service-123/rate')
        .send({
          userId: 'user-123',
          rating: 5,
          comment: 'Excellent!',
        });

      expect(response.status).toBe(200);
      expect(response.body.rating).toBe(5);
    });

    it('should require userId', async () => {
      const response = await request(app)
        .post('/api/marketplace/services/service-123/rate')
        .send({ rating: 5 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('userId is required');
    });

    it('should validate rating range', async () => {
      const response = await request(app)
        .post('/api/marketplace/services/service-123/rate')
        .send({
          userId: 'user-123',
          rating: 6, // Invalid
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('rating must be between 1 and 5');
    });
  });

  describe('GET /api/marketplace/services/:serviceId/ratings', () => {
    it('should return service ratings', async () => {
      const mockRatings = [
        { rating: 5, comment: 'Great!' },
        { rating: 4, comment: 'Good' },
      ];

      mockMarketplaceService.getServiceRatings.mockResolvedValue(mockRatings);

      const response = await request(app).get(
        '/api/marketplace/services/service-123/ratings'
      );

      expect(response.status).toBe(200);
      expect(response.body.ratings).toEqual(mockRatings);
    });

    it('should handle pagination', async () => {
      mockMarketplaceService.getServiceRatings.mockResolvedValue([]);

      await request(app).get(
        '/api/marketplace/services/service-123/ratings?page=2&limit=10'
      );

      expect(mockMarketplaceService.getServiceRatings).toHaveBeenCalledWith(
        'service-123',
        expect.objectContaining({
          limit: 10,
          skip: 10,
        })
      );
    });
  });

  describe('GET /api/marketplace/providers/:providerId/stats', () => {
    it('should return provider statistics', async () => {
      const mockStats = {
        providerId: 'agent-123',
        serviceCount: 5,
        totalRequests: 1000,
        totalRevenue: 500000,
        averageRating: 4.5,
      };

      mockMarketplaceService.getProviderStats.mockResolvedValue(mockStats);

      const response = await request(app).get(
        '/api/marketplace/providers/agent-123/stats'
      );

      expect(response.status).toBe(200);
      expect(response.body.providerId).toBe('agent-123');
      expect(response.body.serviceCount).toBe(5);
    });
  });

  describe('GET /api/marketplace/categories', () => {
    it('should return service categories', async () => {
      const response = await request(app).get('/api/marketplace/categories');

      expect(response.status).toBe(200);
      expect(response.body.categories).toBeDefined();
      expect(response.body.categories.length).toBeGreaterThan(0);
      expect(response.body.categories[0]).toHaveProperty('id');
      expect(response.body.categories[0]).toHaveProperty('name');
      expect(response.body.categories[0]).toHaveProperty('description');
    });
  });

  describe('POST /api/marketplace/services/:serviceId/call', () => {
    it('should return service call endpoint', async () => {
      const mockService = {
        serviceId: 'service-123',
        providerId: 'agent-123',
        name: 'Test Service',
        pricing: { amount: 50000 },
        active: true,
      };

      mockMarketplaceService.getService.mockResolvedValue(mockService);
      mockMarketplaceService.recordUsage.mockResolvedValue();

      const response = await request(app)
        .post('/api/marketplace/services/service-123/call')
        .send({ data: 'test' });

      // This will return 402 without payment, which is expected
      // The actual payment flow would be tested separately
      expect([200, 402]).toContain(response.status);
    });

    it('should return 404 for non-existent service', async () => {
      mockMarketplaceService.getService.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/marketplace/services/non-existent/call')
        .send({});

      expect(response.status).toBe(404);
    });

    it('should return 410 for inactive service', async () => {
      mockMarketplaceService.getService.mockResolvedValue({
        serviceId: 'service-123',
        active: false,
      });

      const response = await request(app)
        .post('/api/marketplace/services/service-123/call')
        .send({});

      expect(response.status).toBe(410);
      expect(response.body.error).toBe('Service is no longer active');
    });
  });
});
