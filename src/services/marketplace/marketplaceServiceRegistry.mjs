/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file src/services/marketplace/marketplaceServiceRegistry.mjs
 * @description Registry of available marketplace services that agents can purchase
 */

import { VideoGenerationService } from './services/videoGeneration.mjs';
import { ImageGenerationService } from './services/imageGeneration.mjs';
import { AgentSummonService } from './services/agentSummon.mjs';
import { CombatService } from './services/combat.mjs';
import { MemoryQueryService } from './services/memoryQuery.mjs';
import { LocationTravelService } from './services/locationTravel.mjs';
import { ItemCraftingService } from './services/itemCrafting.mjs';
import { SocialPostingService } from './services/socialPosting.mjs';

/**
 * Marketplace Service Registry
 * Central registry for all purchasable services in the agentic economy
 */
export class MarketplaceServiceRegistry {
  /**
   * Create service registry
   * @param {Object} options
   * @param {Object} options.logger - Logger instance
   * @param {Object} options.container - Service container with all dependencies
   * @param {Object} options.marketplaceService - Marketplace service for registration
   */
  constructor({ logger, container, marketplaceService }) {
    this.logger = logger || console;
    this.container = container;
    this.marketplaceService = marketplaceService;
    this.services = new Map();
  }

  /**
   * Initialize and register all marketplace services
   */
  async initialize() {
    try {
      this.logger.info('[MarketplaceServiceRegistry] Initializing marketplace services...');

      // Create service instances
      const serviceInstances = [
        new VideoGenerationService(this.container),
        new ImageGenerationService(this.container),
        new AgentSummonService(this.container),
        new CombatService(this.container),
        new MemoryQueryService(this.container),
        new LocationTravelService(this.container),
        new ItemCraftingService(this.container),
        new SocialPostingService(this.container),
      ];

      // Register each service with the marketplace
      for (const service of serviceInstances) {
        const metadata = service.getMetadata();
        
        // Register with marketplace
        await this.marketplaceService.registerService({
          providerId: metadata.providerId,
          name: metadata.name,
          description: metadata.description,
          category: metadata.category,
          pricing: metadata.pricing,
          endpoint: metadata.endpoint,
          network: metadata.network,
          metadata: metadata.metadata,
        });

        // Store instance for internal use
        this.services.set(metadata.serviceId, service);
        
        this.logger.info(`[MarketplaceServiceRegistry] Registered: ${metadata.name}`);
      }

      this.logger.info(`[MarketplaceServiceRegistry] Initialized ${this.services.size} services`);
    } catch (error) {
      this.logger.error('[MarketplaceServiceRegistry] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Get service instance by ID
   * @param {string} serviceId - Service identifier
   * @returns {Object|null} Service instance
   */
  getService(serviceId) {
    return this.services.get(serviceId) || null;
  }

  /**
   * Execute a service
   * @param {string} serviceId - Service identifier
   * @param {Object} params - Service parameters
   * @param {string} agentId - Agent making the request
   * @returns {Promise<Object>} Service result
   */
  async executeService(serviceId, params, agentId) {
    const service = this.getService(serviceId);
    if (!service) {
      throw new Error(`Service not found: ${serviceId}`);
    }

    return await service.execute(params, agentId);
  }

  /**
   * Get all registered services
   * @returns {Array<Object>} Array of service metadata
   */
  getAllServices() {
    return Array.from(this.services.values()).map(service => service.getMetadata());
  }
}
