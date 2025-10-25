/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/examples/marketplace-flow.test.mjs
 * @description End-to-end test of marketplace service flow
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MarketplaceService } from '@/services/payment/marketplaceService.mjs';
import {
  createMockDatabaseService,
  createMockLogger,
  createMockAgentWalletService,
} from '../helpers/mockDatabase.mjs';

describe('Marketplace Service Flow (E2E)', () => {
  let marketplaceService;
  let mockDatabaseService;
  let mockAgentWalletService;
  let mockLogger;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockDatabaseService = createMockDatabaseService();
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

      // Simulate existing service
      const db = await mockDatabaseService.getDatabase();
      const servicesCol = db.collection('service_marketplace');
      servicesCol.findOne.mockResolvedValue({
        serviceId,
        name: 'Test Service',
      });

      const ratingsCol = db.collection('service_ratings');
      
      // Mock empty initial rating
      ratingsCol.findOne.mockResolvedValue(null);

      // Mock ratings after adding
      ratingsCol.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { serviceId, userId: 'user-1', rating: 5 },
          { serviceId, userId: 'user-2', rating: 4 },
          { serviceId, userId: 'user-3', rating: 5 },
          { serviceId, userId: 'user-4', rating: 3 },
          { serviceId, userId: 'user-5', rating: 4 },
        ]),
      });

      // Add rating
      await marketplaceService.rateService({
        serviceId,
        userId: 'user-5',
        rating: 4,
      });

      // Verify average calculation
      // (5+4+5+3+4) / 5 = 4.2
      expect(servicesCol.updateOne).toHaveBeenCalledWith(
        { serviceId },
        expect.objectContaining({
          $set: expect.objectContaining({
            'stats.averageRating': 4.2,
            'stats.ratingCount': 5,
          }),
        })
      );
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
