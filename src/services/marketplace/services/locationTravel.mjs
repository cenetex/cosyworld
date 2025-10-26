/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file src/services/marketplace/services/locationTravel.mjs
 * @description Location travel service for marketplace
 */

/**
 * Location Travel Service
 * Fast travel to locations
 */
export class LocationTravelService {
  constructor(container) {
    this.logger = container.logger || console;
    this.avatarService = container.avatarService;
    this.locationService = container.locationService;
    this.databaseService = container.databaseService;
  }

  getMetadata() {
    return {
      serviceId: 'location-travel',
      providerId: 'system',
      name: 'Fast Travel',
      description: 'Instantly travel to any discovered location',
      category: 'utility',
      pricing: {
        model: 'per_request',
        amount: 0.25 * 1e6, // 0.25 USDC per travel
        currency: 'USDC',
        decimals: 6,
      },
      endpoint: '/api/marketplace/services/location-travel/execute',
      network: 'base-sepolia',
      metadata: {
        estimatedTime: 'instant',
        features: ['discovered-locations-only', 'travel-log'],
      },
    };
  }

  async execute(params, agentId) {
    const { locationId, locationName } = params;

    if (!locationId && !locationName) {
      throw new Error('Location ID or name is required');
    }

    this.logger.info(`[LocationTravel] Agent ${agentId} traveling to ${locationId || locationName}`);

    try {
      const db = await this.databaseService.getDatabase();
      
      // Get location
      let location;
      if (locationId) {
        location = await this.locationService.getLocation(locationId);
      } else {
        const locations = await db.collection('locations')
          .findOne({ name: { $regex: locationName, $options: 'i' } });
        location = locations;
      }

      if (!location) {
        throw new Error('Location not found');
      }

      // Get agent's current location
      const agent = await this.avatarService.getAvatar(agentId);
      const fromLocationId = agent?.currentLocation;

      // Update agent location
      await this.avatarService.updateLocation(agentId, location._id.toString());

      // Log travel
      await db.collection('travel_logs').insertOne({
        agentId,
        fromLocationId,
        toLocationId: location._id.toString(),
        locationName: location.name,
        method: 'fast-travel',
        createdAt: new Date(),
        paidAmount: this.getMetadata().pricing.amount,
      });

      // Add to memories
      if (this.avatarService.memoryService) {
        await this.avatarService.memoryService.addMemory(agentId, {
          type: 'travel',
          content: `Traveled to ${location.name}`,
          importance: 0.5,
          tags: ['travel', 'location'],
        });
      }

      return {
        success: true,
        location: {
          id: location._id.toString(),
          name: location.name,
          description: location.description,
        },
        message: `Traveled to ${location.name}`,
      };
    } catch (error) {
      this.logger.error('[LocationTravel] Failed:', error);
      throw new Error(`Location travel failed: ${error.message}`);
    }
  }
}
