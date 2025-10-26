/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/services/marketplace/marketplaceServiceRegistry.test.mjs
 * @description Tests for marketplace service registry validation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MarketplaceServiceRegistry } from '../../../src/services/marketplace/marketplaceServiceRegistry.mjs';
import { VideoGenerationService } from '../../../src/services/marketplace/services/videoGeneration.mjs';
import { ImageGenerationService } from '../../../src/services/marketplace/services/imageGeneration.mjs';
import { AgentSummonService } from '../../../src/services/marketplace/services/agentSummon.mjs';
import { CombatService } from '../../../src/services/marketplace/services/combat.mjs';
import { MemoryQueryService } from '../../../src/services/marketplace/services/memoryQuery.mjs';
import { LocationTravelService } from '../../../src/services/marketplace/services/locationTravel.mjs';
import { ItemCraftingService } from '../../../src/services/marketplace/services/itemCrafting.mjs';
import { SocialPostingService } from '../../../src/services/marketplace/services/socialPosting.mjs';

describe('MarketplaceServiceRegistry', () => {
  let registry;
  let mockLogger;
  let mockMarketplaceService;
  let mockContainer;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    mockMarketplaceService = {
      registerService: vi.fn().mockResolvedValue({ serviceId: 'test-id' }),
    };

    mockContainer = {
      logger: mockLogger,
      veoService: {},
      replicateService: {},
      s3Service: {},
      databaseService: {},
      xService: {},
      telegramService: {},
      discordService: {},
      agentWalletService: {},
    };

    registry = new MarketplaceServiceRegistry({
      logger: mockLogger,
      container: mockContainer,
      marketplaceService: mockMarketplaceService,
    });
  });

  describe('Service Metadata Validation', () => {
    const validCategories = ['ai', 'data', 'compute', 'storage', 'social', 'utility'];
    const validPricingModels = ['per_request', 'per_token', 'per_kb', 'subscription'];

    it('should validate all service categories are valid', () => {
      const services = [
        new VideoGenerationService(mockContainer),
        new ImageGenerationService(mockContainer),
        new AgentSummonService(mockContainer),
        new CombatService(mockContainer),
        new MemoryQueryService(mockContainer),
        new LocationTravelService(mockContainer),
        new ItemCraftingService(mockContainer),
        new SocialPostingService(mockContainer),
      ];

      services.forEach(service => {
        const metadata = service.getMetadata();
        expect(
          validCategories.includes(metadata.category),
          `Service "${metadata.name}" has invalid category "${metadata.category}". Must be one of: ${validCategories.join(', ')}`
        ).toBe(true);
      });
    });

    it('should validate all service pricing models are valid', () => {
      const services = [
        new VideoGenerationService(mockContainer),
        new ImageGenerationService(mockContainer),
        new AgentSummonService(mockContainer),
        new CombatService(mockContainer),
        new MemoryQueryService(mockContainer),
        new LocationTravelService(mockContainer),
        new ItemCraftingService(mockContainer),
        new SocialPostingService(mockContainer),
      ];

      services.forEach(service => {
        const metadata = service.getMetadata();
        expect(
          validPricingModels.includes(metadata.pricing.model),
          `Service "${metadata.name}" has invalid pricing model "${metadata.pricing.model}". Must be one of: ${validPricingModels.join(', ')}`
        ).toBe(true);
      });
    });

    it('should validate all services have required metadata fields', () => {
      const services = [
        new VideoGenerationService(mockContainer),
        new ImageGenerationService(mockContainer),
        new AgentSummonService(mockContainer),
        new CombatService(mockContainer),
        new MemoryQueryService(mockContainer),
        new LocationTravelService(mockContainer),
        new ItemCraftingService(mockContainer),
        new SocialPostingService(mockContainer),
      ];

      services.forEach(service => {
        const metadata = service.getMetadata();
        
        expect(metadata.serviceId, `Service ${metadata.name} missing serviceId`).toBeDefined();
        expect(metadata.providerId, `Service ${metadata.name} missing providerId`).toBeDefined();
        expect(metadata.name, `Service ${metadata.name} missing name`).toBeDefined();
        expect(metadata.description, `Service ${metadata.name} missing description`).toBeDefined();
        expect(metadata.category, `Service ${metadata.name} missing category`).toBeDefined();
        expect(metadata.pricing, `Service ${metadata.name} missing pricing`).toBeDefined();
        expect(metadata.pricing.model, `Service ${metadata.name} missing pricing.model`).toBeDefined();
        expect(metadata.pricing.amount, `Service ${metadata.name} missing pricing.amount`).toBeDefined();
        expect(metadata.endpoint, `Service ${metadata.name} missing endpoint`).toBeDefined();
        
        // Validate types
        expect(typeof metadata.name).toBe('string');
        expect(metadata.name.length).toBeGreaterThanOrEqual(3);
        expect(typeof metadata.description).toBe('string');
        expect(metadata.description.length).toBeGreaterThanOrEqual(10);
        expect(typeof metadata.pricing.amount).toBe('number');
        expect(metadata.pricing.amount).toBeGreaterThanOrEqual(0);
        expect(metadata.endpoint.startsWith('/')).toBe(true);
      });
    });
  });

  describe('Registry Initialization', () => {
    it('should successfully initialize with valid service metadata', async () => {
      await expect(registry.initialize()).resolves.not.toThrow();
      
      expect(mockMarketplaceService.registerService).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Initialized')
      );
    });

    it('should register all services with marketplace', async () => {
      await registry.initialize();
      
      // Should register 8 services
      expect(mockMarketplaceService.registerService).toHaveBeenCalledTimes(8);
    });

    it('should handle registration errors gracefully', async () => {
      mockMarketplaceService.registerService.mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      await expect(registry.initialize()).rejects.toThrow();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Initialization failed'),
        expect.any(Error)
      );
    });
  });

  describe('Service Retrieval', () => {
    beforeEach(async () => {
      await registry.initialize();
    });

    it('should retrieve service by ID', () => {
      const service = registry.getService('video-generation');
      expect(service).toBeDefined();
      expect(service).toBeInstanceOf(VideoGenerationService);
    });

    it('should return null for non-existent service', () => {
      const service = registry.getService('non-existent');
      expect(service).toBeNull();
    });

    it('should list all services', () => {
      const services = registry.getAllServices();
      expect(services).toHaveLength(8);
      expect(services[0]).toHaveProperty('serviceId');
      expect(services[0]).toHaveProperty('name');
    });
  });

  describe('Category Mapping', () => {
    it('should map media services to ai category', () => {
      const videoService = new VideoGenerationService(mockContainer);
      const imageService = new ImageGenerationService(mockContainer);
      
      expect(videoService.getMetadata().category).toBe('ai');
      expect(imageService.getMetadata().category).toBe('ai');
    });

    it('should map gameplay services to utility category', () => {
      const combatService = new CombatService(mockContainer);
      const itemService = new ItemCraftingService(mockContainer);
      
      expect(combatService.getMetadata().category).toBe('utility');
      expect(itemService.getMetadata().category).toBe('utility');
    });

    it('should map travel services to utility category', () => {
      const travelService = new LocationTravelService(mockContainer);
      
      expect(travelService.getMetadata().category).toBe('utility');
    });
  });

  describe('Pricing Model Validation', () => {
    it('should use underscore format for pricing models', () => {
      const services = [
        new VideoGenerationService(mockContainer),
        new ImageGenerationService(mockContainer),
        new SocialPostingService(mockContainer),
      ];

      services.forEach(service => {
        const metadata = service.getMetadata();
        expect(metadata.pricing.model).not.toContain('-');
        expect(metadata.pricing.model).toMatch(/^per_[a-z]+$/);
      });
    });
  });
});
