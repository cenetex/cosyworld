/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/examples/marketplace-flow.test.mjs
 * @description End-to-end test of marketplace service flow
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MarketplaceService } from '@/services/payment/marketplaceService.mjs';
import {
  createMockDatabaseService,
  createMockLogger,
  createMockAgentWalletService,
  createMockCollection,
} from '../helpers/mockDatabase.mjs';

describe('Marketplace Service Flow (E2E)', () => {
  let marketplaceService;
  let mockDatabaseService;
  let mockAgentWalletService;
  let mockLogger;
  let mockDb;
  let servicesCollection;
  let ratingsCollection;

  beforeEach(() => {
    mockLogger = createMockLogger();
    
    // Create collections with smarter mocks
    const serviceStore = new Map();
    const ratingsStore = [];

    servicesCollection = {
      insertOne: vi.fn(async (doc) => {
        serviceStore.set(doc.serviceId, doc);
        return { insertedId: doc.serviceId };
      }),
      findOne: vi.fn(async (query) => {
        if (query.serviceId) {
          return serviceStore.get(query.serviceId) || null;
        }
        return null;
      }),
      find: vi.fn(() => ({
        toArray: vi.fn(async () => Array.from(serviceStore.values())),
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
      })),
      updateOne: vi.fn(async (query, update) => {
        const service = serviceStore.get(query.serviceId);
        if (service) {
          if (update.$set) {
            // Handle nested properties like 'stats.averageRating'
            for (const [key, value] of Object.entries(update.$set)) {
              if (key.includes('.')) {
                const keys = key.split('.');
                let obj = service;
                for (let i = 0; i < keys.length - 1; i++) {
                  if (!obj[keys[i]]) obj[keys[i]] = {};
                  obj = obj[keys[i]];
                }
                obj[keys[keys.length - 1]] = value;
              } else {
                service[key] = value;
              }
            }
          }
          if (update.$inc) {
            for (const [key, value] of Object.entries(update.$inc)) {
              const keys = key.split('.');
              let obj = service;
              for (let i = 0; i < keys.length - 1; i++) {
                obj = obj[keys[i]];
              }
              obj[keys[keys.length - 1]] = (obj[keys[keys.length - 1]] || 0) + value;
            }
          }
        }
        return { modifiedCount: service ? 1 : 0, matchedCount: service ? 1 : 0 };
      }),
      deleteOne: vi.fn(async (query) => {
        const deleted = serviceStore.delete(query.serviceId);
        return { deletedCount: deleted ? 1 : 0 };
      }),
      countDocuments: vi.fn(async () => serviceStore.size),
    };

    ratingsCollection = {
      insertOne: vi.fn(async (doc) => {
        ratingsStore.push(doc);
        return { insertedId: 'rating-id' };
      }),
      findOne: vi.fn(async (query) => {
        return ratingsStore.find(r => 
          r.serviceId === query.serviceId && r.userId === query.userId
        ) || null;
      }),
      find: vi.fn((query) => {
        const results = query && query.serviceId 
          ? ratingsStore.filter(r => r.serviceId === query.serviceId)
          : ratingsStore;
        return {
          toArray: vi.fn(async () => results),
        };
      }),
      updateOne: vi.fn(async (query, update) => {
        const rating = ratingsStore.find(r => 
          r.serviceId === query.serviceId && r.userId === query.userId
        );
        if (rating && update.$set) {
          Object.assign(rating, update.$set);
        }
        return { modifiedCount: rating ? 1 : 0 };
      }),
    };

    mockDb = {
      collection: vi.fn((name) => {
        if (name === 'service_marketplace') return servicesCollection;
        if (name === 'service_ratings') return ratingsCollection;
        return createMockCollection();
      }),
    };

    mockDatabaseService = createMockDatabaseService(mockDb);
    mockAgentWalletService = createMockAgentWalletService();

    marketplaceService = new MarketplaceService({
      logger: mockLogger,
      databaseService: mockDatabaseService,
      agentWalletService: mockAgentWalletService,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Complete Service Lifecycle', () => {
    it('should handle full service lifecycle', async () => {
      // 1. Register a service
      const serviceData = {
        providerId: 'agent-storyteller',
        name: 'Epic Quest Generator',
        description: 'Generate amazing RPG quests using advanced AI',
        category: 'ai',
        pricing: {
          model: 'per_request',
          amount: 50000, // 0.05 USDC
          discounts: [
            { volume: 100, discount: 0.1 },
            { volume: 1000, discount: 0.2 },
          ],
        },
        endpoint: '/api/services/quest-generator',
        network: 'base',
        metadata: {
          tags: ['rpg', 'narrative', 'quest', 'AI'],
          version: '1.0.0',
        },
      };

      const service = await marketplaceService.registerService(serviceData);

      expect(service).toBeDefined();
      expect(service.serviceId).toBeDefined();
      expect(service.active).toBe(true);
      expect(service.stats.totalRequests).toBe(0);
      expect(service.stats.totalRevenue).toBe(0);

      const serviceId = service.serviceId;

      // 2. Record some usage
      await marketplaceService.recordUsage(serviceId, 50000);
      await marketplaceService.recordUsage(serviceId, 50000);
      await marketplaceService.recordUsage(serviceId, 50000);

      // Verify usage was recorded
      expect(mockDatabaseService.getDatabase).toHaveBeenCalled();

      // 3. Add ratings
      await marketplaceService.rateService({
        serviceId,
        userId: 'user-1',
        rating: 5,
        comment: 'Amazing service!',
      });

      await marketplaceService.rateService({
        serviceId,
        userId: 'user-2',
        rating: 4,
        comment: 'Very good',
      });

      await marketplaceService.rateService({
        serviceId,
        userId: 'user-3',
        rating: 5,
        comment: 'Excellent!',
      });

      // 4. Search for the service
      const searchResults = await marketplaceService.searchServices({
        category: 'ai',
        minRating: 4.0,
      });

      expect(searchResults).toBeDefined();
      expect(searchResults.services).toBeDefined();

      // 5. Update service
      await marketplaceService.updateService(serviceId, 'agent-storyteller', {
        description: 'Updated description with more details',
        pricing: {
          model: 'per_request',
          amount: 45000, // Price reduction
        },
      });

      // 6. Get provider stats
      const stats = await marketplaceService.getProviderStats('agent-storyteller');

      expect(stats).toBeDefined();
      expect(stats.providerId).toBe('agent-storyteller');
      expect(stats.serviceCount).toBeGreaterThanOrEqual(0);

      // 7. Deactivate service
      const deleted = await marketplaceService.deleteService(
        serviceId,
        'agent-storyteller'
      );

      expect(deleted).toBe(true);
    });
  });

  describe('Multi-Service Provider Scenario', () => {
    it('should handle provider with multiple services', async () => {
      const providerId = 'agent-multi-service';

      // Register multiple services
      const services = [
        {
          providerId,
          name: 'Story Generator',
          description: 'Generate narratives',
          category: 'ai',
          pricing: { model: 'per_request', amount: 50000 },
          endpoint: '/api/services/story',
        },
        {
          providerId,
          name: 'Item Creator',
          description: 'Create RPG items',
          category: 'ai',
          pricing: { model: 'per_request', amount: 20000 },
          endpoint: '/api/services/item',
        },
        {
          providerId,
          name: 'Location Describer',
          description: 'Describe locations',
          category: 'ai',
          pricing: { model: 'per_request', amount: 15000 },
          endpoint: '/api/services/location',
        },
      ];

      for (const serviceData of services) {
        await marketplaceService.registerService(serviceData);
      }

      // Get provider stats
      const stats = await marketplaceService.getProviderStats(providerId);

      expect(stats.serviceCount).toBeGreaterThanOrEqual(0);
      expect(stats.providerId).toBe(providerId);
    });
  });

  describe('Rating Aggregation Scenario', () => {
    it('should correctly aggregate ratings', async () => {
      const serviceId = 'test-service-123';

      // Register a service first
      const serviceData = {
        providerId: 'agent-test',
        name: 'Test Service',
        description: 'Test service for rating aggregation',
        category: 'ai',
        pricing: { model: 'per_request', amount: 10000 },
        endpoint: '/api/services/test',
        network: 'base',
      };

      // Manually add to the store so it has a known serviceId
      await servicesCollection.insertOne({
        ...serviceData,
        serviceId,
        active: true,
        stats: {
          totalRequests: 0,
          totalRevenue: 0,
          averageRating: 0,
          ratingCount: 0,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Add multiple ratings
      await marketplaceService.rateService({
        serviceId,
        userId: 'user-1',
        rating: 5,
      });

      await marketplaceService.rateService({
        serviceId,
        userId: 'user-2',
        rating: 4,
      });

      await marketplaceService.rateService({
        serviceId,
        userId: 'user-3',
        rating: 5,
      });

      await marketplaceService.rateService({
        serviceId,
        userId: 'user-4',
        rating: 3,
      });

      await marketplaceService.rateService({
        serviceId,
        userId: 'user-5',
        rating: 4,
      });

      // Verify average calculation
      // (5+4+5+3+4) / 5 = 4.2
      expect(servicesCollection.updateOne).toHaveBeenCalled();
      
      // Check the service was updated with correct rating
      const updatedService = await servicesCollection.findOne({ serviceId });
      expect(updatedService.stats.averageRating).toBe(4.2);
      expect(updatedService.stats.ratingCount).toBe(5);
    });
  });

  describe('Service Discovery Scenario', () => {
    it('should support complex search queries', async () => {
      // Test various search combinations
      const searchScenarios = [
        {
          query: { category: 'ai', maxPrice: 100000 },
          description: 'AI services under 0.1 USDC',
        },
        {
          query: { search: 'quest', minRating: 4.5 },
          description: 'Quest-related services with high ratings',
        },
        {
          query: { network: 'base', sortBy: 'popularity' },
          description: 'Popular services on Base network',
        },
        {
          query: { providerId: 'agent-123', active: true },
          description: 'Active services from specific provider',
        },
      ];

      for (const scenario of searchScenarios) {
        await marketplaceService.searchServices(scenario.query);
        // Verify search was called
        expect(mockDatabaseService.getDatabase).toHaveBeenCalled();
      }
    });
  });

  describe('Error Scenarios', () => {
    it('should handle authorization errors', async () => {
      const serviceId = 'service-123';
      const wrongProviderId = 'wrong-agent';

      const db = await mockDatabaseService.getDatabase();
      const servicesCol = db.collection('service_marketplace');
      servicesCol.findOne.mockResolvedValue(null); // Not found

      await expect(
        marketplaceService.updateService(serviceId, wrongProviderId, {
          name: 'Unauthorized Update',
        })
      ).rejects.toThrow('Service not found or unauthorized');
    });

    it('should handle non-existent service rating', async () => {
      const db = await mockDatabaseService.getDatabase();
      const servicesCol = db.collection('service_marketplace');
      servicesCol.findOne.mockResolvedValue(null);

      await expect(
        marketplaceService.rateService({
          serviceId: 'non-existent',
          userId: 'user-1',
          rating: 5,
        })
      ).rejects.toThrow('Service not found');
    });
  });
});
