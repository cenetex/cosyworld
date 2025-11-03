/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/services/payment/marketplaceService.test.mjs
 * @description Tests for MarketplaceService
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MarketplaceService } from '@/services/payment/marketplaceService.mjs';

describe('MarketplaceService', () => {
  let marketplaceService;
  let mockLogger;
  let mockDatabaseService;
  let mockAgentWalletService;
  let mockDb;
  let mockServicesCollection;
  let mockRatingsCollection;

  beforeEach(() => {
    // Mock collections
    mockServicesCollection = {
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'mock-id' }),
      findOne: vi.fn(),
      find: vi.fn(() => ({
        sort: vi.fn(() => ({
          skip: vi.fn(() => ({
            limit: vi.fn(() => ({
              toArray: vi.fn().mockResolvedValue([]),
            })),
          })),
        })),
      })),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1, matchedCount: 1 }),
      countDocuments: vi.fn().mockResolvedValue(0),
      createIndexes: vi.fn().mockResolvedValue(true),
    };

    mockRatingsCollection = {
      findOne: vi.fn(),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'rating-id' }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      find: vi.fn(() => ({
        sort: vi.fn(() => ({
          skip: vi.fn(() => ({
            limit: vi.fn(() => ({
              toArray: vi.fn().mockResolvedValue([]),
            })),
          })),
        })),
        toArray: vi.fn().mockResolvedValue([]),
      })),
      createIndexes: vi.fn().mockResolvedValue(true),
    };

    mockDb = {
      collection: vi.fn((name) => {
        if (name === 'service_marketplace') return mockServicesCollection;
        if (name === 'service_ratings') return mockRatingsCollection;
        return null;
      }),
    };

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    mockDatabaseService = {
      getDatabase: vi.fn().mockResolvedValue(mockDb),
    };

    mockAgentWalletService = {
      isConfigured: vi.fn().mockReturnValue(true),
      getOrCreateWallet: vi.fn().mockResolvedValue({
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        network: 'base',
      }),
    };

    marketplaceService = new MarketplaceService({
      logger: mockLogger,
      databaseService: mockDatabaseService,
      agentWalletService: mockAgentWalletService,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with required dependencies', () => {
      expect(marketplaceService).toBeDefined();
      expect(marketplaceService.logger).toBe(mockLogger);
      expect(marketplaceService.databaseService).toBe(mockDatabaseService);
      expect(marketplaceService.agentWalletService).toBe(mockAgentWalletService);
    });
  });

  describe('registerService', () => {
    const validServiceData = {
      providerId: 'agent-123',
      name: 'Epic Quest Generator',
      description: 'Generate amazing RPG quests using AI',
      category: 'ai',
      pricing: {
        model: 'per_request',
        amount: 50000, // 0.05 USDC
      },
      endpoint: '/api/services/quest-generator',
    };

    it('should register a new service successfully', async () => {
      const service = await marketplaceService.registerService(validServiceData);

      expect(service).toBeDefined();
      expect(service.serviceId).toBeDefined();
      expect(service.name).toBe(validServiceData.name);
      expect(service.category).toBe(validServiceData.category);
      expect(service.pricing.amount).toBe(50000);
      expect(service.active).toBe(true);
      expect(mockServicesCollection.insertOne).toHaveBeenCalled();
    });

    it('should create wallet for provider', async () => {
      await marketplaceService.registerService(validServiceData);

      expect(mockAgentWalletService.getOrCreateWallet).toHaveBeenCalledWith('agent-123');
    });

    it('should validate service name', async () => {
      const invalidData = { ...validServiceData, name: 'ab' }; // Too short

      await expect(
        marketplaceService.registerService(invalidData)
      ).rejects.toThrow('Validation failed');
    });

    it('should validate description', async () => {
      const invalidData = { ...validServiceData, description: 'short' };

      await expect(
        marketplaceService.registerService(invalidData)
      ).rejects.toThrow('Validation failed');
    });

    it('should validate category', async () => {
      const invalidData = { ...validServiceData, category: 'invalid' };

      await expect(
        marketplaceService.registerService(invalidData)
      ).rejects.toThrow('Invalid category');
    });

    it('should validate pricing amount', async () => {
      const invalidData = {
        ...validServiceData,
        pricing: { model: 'per_request', amount: -100 },
      };

      await expect(
        marketplaceService.registerService(invalidData)
      ).rejects.toThrow('Pricing amount must be a non-negative number');
    });

    it('should validate endpoint format', async () => {
      const invalidData = { ...validServiceData, endpoint: 'invalid-endpoint' };

      await expect(
        marketplaceService.registerService(invalidData)
      ).rejects.toThrow('Endpoint must be a valid path');
    });

    it('should initialize stats to zero', async () => {
      const service = await marketplaceService.registerService(validServiceData);

      expect(service.stats.totalRequests).toBe(0);
      expect(service.stats.totalRevenue).toBe(0);
      expect(service.stats.averageRating).toBe(0);
      expect(service.stats.uptime).toBe(1.0);
    });
  });

  describe('getService', () => {
    it('should retrieve service by ID', async () => {
      const mockService = { serviceId: 'service-123', name: 'Test Service' };
      mockServicesCollection.findOne.mockResolvedValue(mockService);

      const service = await marketplaceService.getService('service-123');

      expect(service).toEqual(mockService);
      expect(mockServicesCollection.findOne).toHaveBeenCalledWith({
        serviceId: 'service-123',
      });
    });

    it('should return null for non-existent service', async () => {
      mockServicesCollection.findOne.mockResolvedValue(null);

      const service = await marketplaceService.getService('non-existent');

      expect(service).toBeNull();
    });
  });

  describe('searchServices', () => {
    it('should search services with default parameters', async () => {
      const mockServices = [{ serviceId: '1', name: 'Service 1' }];
      mockServicesCollection.find.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue(mockServices),
      });
      mockServicesCollection.countDocuments.mockResolvedValue(1);

      const result = await marketplaceService.searchServices();

      expect(result.services).toEqual(mockServices);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
    });

    it('should filter by category', async () => {
      mockServicesCollection.find.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([]),
      });

      await marketplaceService.searchServices({ category: 'ai' });

      const call = mockServicesCollection.find.mock.calls[0][0];
      expect(call.category).toBe('ai');
    });

    it('should filter by max price', async () => {
      mockServicesCollection.find.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([]),
      });

      await marketplaceService.searchServices({ maxPrice: 50000 });

      const call = mockServicesCollection.find.mock.calls[0][0];
      expect(call['pricing.amount']).toEqual({ $lte: 50000 });
    });

    it('should filter by min rating', async () => {
      mockServicesCollection.find.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([]),
      });

      await marketplaceService.searchServices({ minRating: 4.0 });

      const call = mockServicesCollection.find.mock.calls[0][0];
      expect(call['stats.averageRating']).toEqual({ $gte: 4.0 });
    });

    it('should search in name and description', async () => {
      mockServicesCollection.find.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([]),
      });

      await marketplaceService.searchServices({ search: 'quest' });

      const call = mockServicesCollection.find.mock.calls[0][0];
      expect(call.$or).toBeDefined();
      expect(call.$or.length).toBeGreaterThan(0);
    });

    it('should handle pagination', async () => {
      mockServicesCollection.find.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([]),
      });
      mockServicesCollection.countDocuments.mockResolvedValue(100);

      const result = await marketplaceService.searchServices({
        limit: 10,
        skip: 20,
      });

      expect(result.page).toBe(3);
      expect(result.totalPages).toBe(10);
    });
  });

  describe('updateService', () => {
    it('should update service by owner', async () => {
      const mockService = {
        serviceId: 'service-123',
        providerId: 'agent-123',
        name: 'Original Name',
      };
      mockServicesCollection.findOne.mockResolvedValue(mockService);

      const updates = { name: 'Updated Name' };
      await marketplaceService.updateService('service-123', 'agent-123', updates);

      expect(mockServicesCollection.updateOne).toHaveBeenCalled();
    });

    it('should reject update from non-owner', async () => {
      mockServicesCollection.findOne.mockResolvedValue(null);

      await expect(
        marketplaceService.updateService('service-123', 'wrong-agent', {})
      ).rejects.toThrow('Service not found or unauthorized');
    });

    it('should validate pricing updates', async () => {
      const mockService = {
        serviceId: 'service-123',
        providerId: 'agent-123',
        name: 'Service',
        description: 'Description',
        category: 'ai',
        endpoint: '/endpoint',
      };
      mockServicesCollection.findOne.mockResolvedValue(mockService);

      const updates = {
        pricing: { model: 'invalid', amount: -100 },
      };

      await expect(
        marketplaceService.updateService('service-123', 'agent-123', updates)
      ).rejects.toThrow('Validation failed');
    });
  });

  describe('deleteService', () => {
    it('should deactivate service', async () => {
      mockServicesCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

      const result = await marketplaceService.deleteService('service-123', 'agent-123');

      expect(result).toBe(true);
      expect(mockServicesCollection.updateOne).toHaveBeenCalledWith(
        { serviceId: 'service-123', providerId: 'agent-123' },
        expect.objectContaining({
          $set: expect.objectContaining({ active: false }),
        })
      );
    });

    it('should reject deletion by non-owner', async () => {
      mockServicesCollection.updateOne.mockResolvedValue({ matchedCount: 0 });

      await expect(
        marketplaceService.deleteService('service-123', 'wrong-agent')
      ).rejects.toThrow('Service not found or unauthorized');
    });
  });

  describe('recordUsage', () => {
    it('should increment usage stats', async () => {
      await marketplaceService.recordUsage('service-123', 50000);

      expect(mockServicesCollection.updateOne).toHaveBeenCalledWith(
        { serviceId: 'service-123' },
        expect.objectContaining({
          $inc: {
            'stats.totalRequests': 1,
            'stats.totalRevenue': 50000,
          },
        })
      );
    });
  });

  describe('rateService', () => {
    it('should add new rating', async () => {
      mockServicesCollection.findOne.mockResolvedValue({ serviceId: 'service-123' });
      mockRatingsCollection.findOne.mockResolvedValue(null);
      mockRatingsCollection.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ rating: 5 }]),
      });

      const rating = await marketplaceService.rateService({
        serviceId: 'service-123',
        userId: 'user-123',
        rating: 5,
        comment: 'Great service!',
      });

      expect(rating.rating).toBe(5);
      expect(mockRatingsCollection.insertOne).toHaveBeenCalled();
    });

    it('should update existing rating', async () => {
      mockServicesCollection.findOne.mockResolvedValue({ serviceId: 'service-123' });
      mockRatingsCollection.findOne.mockResolvedValue({
        serviceId: 'service-123',
        userId: 'user-123',
        rating: 3,
      });
      mockRatingsCollection.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ rating: 5 }]),
      });

      await marketplaceService.rateService({
        serviceId: 'service-123',
        userId: 'user-123',
        rating: 5,
      });

      expect(mockRatingsCollection.updateOne).toHaveBeenCalled();
    });

    it('should validate rating range', async () => {
      mockServicesCollection.findOne.mockResolvedValue({ serviceId: 'service-123' });

      await expect(
        marketplaceService.rateService({
          serviceId: 'service-123',
          userId: 'user-123',
          rating: 6, // Invalid
        })
      ).rejects.toThrow('Rating must be between 1 and 5');
    });

    it('should recalculate average rating', async () => {
      mockServicesCollection.findOne.mockResolvedValue({ serviceId: 'service-123' });
      mockRatingsCollection.findOne.mockResolvedValue(null);
      mockRatingsCollection.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { rating: 4 },
          { rating: 5 },
          { rating: 3 },
        ]),
      });

      await marketplaceService.rateService({
        serviceId: 'service-123',
        userId: 'user-123',
        rating: 4,
      });

      // Should update service with average rating (4+5+3)/3 = 4.0
      expect(mockServicesCollection.updateOne).toHaveBeenCalledWith(
        { serviceId: 'service-123' },
        expect.objectContaining({
          $set: expect.objectContaining({
            'stats.averageRating': 4.0,
            'stats.ratingCount': 3,
          }),
        })
      );
    });
  });

  describe('getProviderStats', () => {
    it('should calculate provider statistics', async () => {
      const mockServices = [
        {
          providerId: 'agent-123',
          category: 'ai',
          active: true,
          stats: {
            totalRequests: 100,
            totalRevenue: 500000,
            averageRating: 4.5,
            ratingCount: 10,
          },
        },
        {
          providerId: 'agent-123',
          category: 'data',
          active: true,
          stats: {
            totalRequests: 50,
            totalRevenue: 250000,
            averageRating: 4.8,
            ratingCount: 5,
          },
        },
      ];

      mockServicesCollection.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue(mockServices),
      });

      const stats = await marketplaceService.getProviderStats('agent-123');

      expect(stats.serviceCount).toBe(2);
      expect(stats.activeServices).toBe(2);
      expect(stats.totalRequests).toBe(150);
      expect(stats.totalRevenue).toBe(750000);
      expect(stats.averageRating).toBeCloseTo(4.6, 1); // Weighted average
      expect(stats.categories.ai).toBe(1);
      expect(stats.categories.data).toBe(1);
    });
  });

  describe('ensureIndexes', () => {
    it('should create database indexes', async () => {
      await marketplaceService.ensureIndexes();

      expect(mockServicesCollection.createIndexes).toHaveBeenCalled();
      expect(mockRatingsCollection.createIndexes).toHaveBeenCalled();
    });
  });
});
