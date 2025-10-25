/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file src/services/payment/marketplaceService.mjs
 * @description Service marketplace for agent-to-agent commerce
 * Manages service listings, discovery, ratings, and revenue tracking
 */

import crypto from 'crypto';

/**
 * Marketplace Service
 * Enables agents to offer and discover services
 * 
 * @class
 */
export class MarketplaceService {
  /**
   * Create marketplace service
   * @param {Object} options
   * @param {Object} options.logger - Logger instance
   * @param {Object} options.databaseService - Database service
   * @param {Object} options.agentWalletService - Agent wallet service
   */
  constructor({ logger, databaseService, agentWalletService }) {
    this.logger = logger || console;
    this.databaseService = databaseService;
    this.agentWalletService = agentWalletService;

    this.logger.info('[MarketplaceService] Initialized');
  }

  /**
   * Get database connection
   * @private
   */
  async _getDatabase() {
    return await this.databaseService.getDatabase();
  }

  /**
   * Get service_marketplace collection
   * @private
   */
  async _getServicesCollection() {
    const db = await this._getDatabase();
    return db.collection('service_marketplace');
  }

  /**
   * Get service_ratings collection
   * @private
   */
  async _getRatingsCollection() {
    const db = await this._getDatabase();
    return db.collection('service_ratings');
  }

  /**
   * Generate unique service ID
   * @private
   */
  _generateServiceId() {
    return crypto.randomUUID();
  }

  /**
   * Validate service data
   * @private
   */
  _validateServiceData(data) {
    const errors = [];

    if (!data.name || data.name.trim().length < 3) {
      errors.push('Service name must be at least 3 characters');
    }

    if (!data.description || data.description.trim().length < 10) {
      errors.push('Description must be at least 10 characters');
    }

    if (!data.category || !['ai', 'data', 'compute', 'storage', 'social', 'utility'].includes(data.category)) {
      errors.push('Invalid category. Must be: ai, data, compute, storage, social, or utility');
    }

    if (!data.pricing || typeof data.pricing.amount !== 'number' || data.pricing.amount < 0) {
      errors.push('Pricing amount must be a non-negative number');
    }

    if (!['per_request', 'per_token', 'per_kb', 'subscription'].includes(data.pricing.model)) {
      errors.push('Invalid pricing model. Must be: per_request, per_token, per_kb, or subscription');
    }

    if (!data.endpoint || !data.endpoint.startsWith('/')) {
      errors.push('Endpoint must be a valid path starting with /');
    }

    return errors;
  }

  /**
   * Register a new service
   * @param {Object} options
   * @param {string} options.providerId - Agent ID providing the service
   * @param {string} options.name - Service name
   * @param {string} options.description - Service description
   * @param {string} options.category - Service category
   * @param {Object} options.pricing - Pricing info
   * @param {string} options.endpoint - Service endpoint
   * @param {string} [options.network] - Payment network (default: base)
   * @param {Object} [options.metadata] - Additional metadata
   * @returns {Promise<Object>} Created service
   */
  async registerService({
    providerId,
    name,
    description,
    category,
    pricing,
    endpoint,
    network = 'base',
    metadata = {},
  }) {
    // Validate input
    const errors = this._validateServiceData({
      name,
      description,
      category,
      pricing,
      endpoint,
    });

    if (errors.length > 0) {
      throw new Error(`Validation failed: ${errors.join(', ')}`);
    }

    // Get or create wallet for provider
    const providerWallet = await this.agentWalletService.getOrCreateWallet(providerId);

    const serviceId = this._generateServiceId();
    const servicesCol = await this._getServicesCollection();

    const service = {
      serviceId,
      providerId,
      name: name.trim(),
      description: description.trim(),
      category,
      pricing: {
        model: pricing.model,
        amount: pricing.amount,
        currency: 'USDC',
        discounts: pricing.discounts || [],
      },
      endpoint,
      network,
      paymentDestination: providerWallet.address,
      stats: {
        totalRequests: 0,
        totalRevenue: 0,
        averageRating: 0,
        ratingCount: 0,
        uptime: 1.0,
        lastRequestAt: null,
      },
      metadata: {
        ...metadata,
        tags: metadata.tags || [],
        version: metadata.version || '1.0.0',
      },
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await servicesCol.insertOne(service);

    this.logger.info(
      `[MarketplaceService] Service registered: ${serviceId} by agent ${providerId}`
    );

    return service;
  }

  /**
   * Get a service by ID
   * @param {string} serviceId - Service ID
   * @returns {Promise<Object|null>} Service or null
   */
  async getService(serviceId) {
    const servicesCol = await this._getServicesCollection();
    return await servicesCol.findOne({ serviceId });
  }

  /**
   * Search/filter services
   * @param {Object} options
   * @param {string} [options.category] - Filter by category
   * @param {string} [options.search] - Search in name/description
   * @param {number} [options.maxPrice] - Maximum price in USDC
   * @param {number} [options.minRating] - Minimum average rating
   * @param {string} [options.network] - Filter by network
   * @param {string} [options.providerId] - Filter by provider
   * @param {string} [options.sortBy] - Sort field (price, rating, popularity, created)
   * @param {number} [options.limit] - Max results (default: 50)
   * @param {number} [options.skip] - Skip results (default: 0)
   * @returns {Promise<Object>} Search results
   */
  async searchServices(options = {}) {
    const {
      category,
      search,
      maxPrice,
      minRating,
      network,
      providerId,
      sortBy = 'popularity',
      limit = 50,
      skip = 0,
    } = options;

    const servicesCol = await this._getServicesCollection();
    const query = { active: true };

    // Apply filters
    if (category) {
      query.category = category;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { 'metadata.tags': { $regex: search, $options: 'i' } },
      ];
    }

    if (maxPrice !== undefined) {
      query['pricing.amount'] = { $lte: maxPrice };
    }

    if (minRating !== undefined) {
      query['stats.averageRating'] = { $gte: minRating };
    }

    if (network) {
      query.network = network;
    }

    if (providerId) {
      query.providerId = providerId;
    }

    // Determine sort
    let sort = {};
    switch (sortBy) {
      case 'price':
        sort = { 'pricing.amount': 1 };
        break;
      case 'rating':
        sort = { 'stats.averageRating': -1, 'stats.ratingCount': -1 };
        break;
      case 'popularity':
        sort = { 'stats.totalRequests': -1 };
        break;
      case 'created':
        sort = { createdAt: -1 };
        break;
      default:
        sort = { 'stats.totalRequests': -1 };
    }

    // Execute query
    const [services, total] = await Promise.all([
      servicesCol.find(query).sort(sort).skip(skip).limit(limit).toArray(),
      servicesCol.countDocuments(query),
    ]);

    return {
      services,
      total,
      page: Math.floor(skip / limit) + 1,
      totalPages: Math.ceil(total / limit),
      limit,
    };
  }

  /**
   * Update a service
   * @param {string} serviceId - Service ID
   * @param {string} providerId - Provider ID (for authorization)
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated service
   */
  async updateService(serviceId, providerId, updates) {
    const servicesCol = await this._getServicesCollection();
    
    // Verify ownership
    const service = await servicesCol.findOne({ serviceId, providerId });
    if (!service) {
      throw new Error('Service not found or unauthorized');
    }

    // Validate updates if pricing is being changed
    if (updates.pricing) {
      const errors = this._validateServiceData({
        name: service.name,
        description: service.description,
        category: service.category,
        pricing: updates.pricing,
        endpoint: service.endpoint,
      });

      if (errors.length > 0) {
        throw new Error(`Validation failed: ${errors.join(', ')}`);
      }
    }

    // Prepare update
    const allowedUpdates = ['name', 'description', 'pricing', 'metadata', 'active'];
    const updateDoc = { $set: { updatedAt: new Date() } };

    for (const key of allowedUpdates) {
      if (updates[key] !== undefined) {
        updateDoc.$set[key] = updates[key];
      }
    }

    await servicesCol.updateOne({ serviceId }, updateDoc);

    this.logger.info(`[MarketplaceService] Service updated: ${serviceId}`);

    return await this.getService(serviceId);
  }

  /**
   * Delete/deactivate a service
   * @param {string} serviceId - Service ID
   * @param {string} providerId - Provider ID (for authorization)
   * @returns {Promise<boolean>} Success
   */
  async deleteService(serviceId, providerId) {
    const servicesCol = await this._getServicesCollection();
    
    const result = await servicesCol.updateOne(
      { serviceId, providerId },
      {
        $set: {
          active: false,
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      throw new Error('Service not found or unauthorized');
    }

    this.logger.info(`[MarketplaceService] Service deactivated: ${serviceId}`);

    return true;
  }

  /**
   * Record a service usage
   * @param {string} serviceId - Service ID
   * @param {number} revenue - Revenue generated (in USDC, 6 decimals)
   * @returns {Promise<void>}
   */
  async recordUsage(serviceId, revenue) {
    const servicesCol = await this._getServicesCollection();
    
    await servicesCol.updateOne(
      { serviceId },
      {
        $inc: {
          'stats.totalRequests': 1,
          'stats.totalRevenue': revenue,
        },
        $set: {
          'stats.lastRequestAt': new Date(),
        },
      }
    );
  }

  /**
   * Rate a service
   * @param {Object} options
   * @param {string} options.serviceId - Service ID
   * @param {string} options.userId - User/agent ID rating the service
   * @param {number} options.rating - Rating (1-5)
   * @param {string} [options.comment] - Optional comment
   * @returns {Promise<Object>} Rating record
   */
  async rateService({ serviceId, userId, rating, comment = '' }) {
    if (rating < 1 || rating > 5) {
      throw new Error('Rating must be between 1 and 5');
    }

    const ratingsCol = await this._getRatingsCollection();
    const servicesCol = await this._getServicesCollection();

    // Check if service exists
    const service = await servicesCol.findOne({ serviceId });
    if (!service) {
      throw new Error('Service not found');
    }

    // Check if user already rated this service
    const existingRating = await ratingsCol.findOne({ serviceId, userId });

    const ratingDoc = {
      serviceId,
      userId,
      rating,
      comment: comment.trim(),
      createdAt: new Date(),
    };

    if (existingRating) {
      // Update existing rating
      await ratingsCol.updateOne(
        { serviceId, userId },
        { $set: ratingDoc }
      );
    } else {
      // Insert new rating
      await ratingsCol.insertOne({
        ...ratingDoc,
        ratingId: crypto.randomUUID(),
      });
    }

    // Recalculate average rating
    const allRatings = await ratingsCol.find({ serviceId }).toArray();
    const averageRating = allRatings.reduce((sum, r) => sum + r.rating, 0) / allRatings.length;

    await servicesCol.updateOne(
      { serviceId },
      {
        $set: {
          'stats.averageRating': Number(averageRating.toFixed(2)),
          'stats.ratingCount': allRatings.length,
        },
      }
    );

    this.logger.info(
      `[MarketplaceService] Service ${serviceId} rated ${rating}/5 by ${userId}`
    );

    return ratingDoc;
  }

  /**
   * Get ratings for a service
   * @param {string} serviceId - Service ID
   * @param {Object} [options]
   * @param {number} [options.limit] - Max results
   * @param {number} [options.skip] - Skip results
   * @returns {Promise<Array>} Ratings
   */
  async getServiceRatings(serviceId, options = {}) {
    const { limit = 50, skip = 0 } = options;
    const ratingsCol = await this._getRatingsCollection();

    const ratings = await ratingsCol
      .find({ serviceId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    return ratings;
  }

  /**
   * Get provider statistics
   * @param {string} providerId - Provider agent ID
   * @returns {Promise<Object>} Statistics
   */
  async getProviderStats(providerId) {
    const servicesCol = await this._getServicesCollection();

    const services = await servicesCol.find({ providerId }).toArray();
    
    const stats = {
      providerId,
      serviceCount: services.length,
      activeServices: services.filter(s => s.active).length,
      totalRequests: services.reduce((sum, s) => sum + s.stats.totalRequests, 0),
      totalRevenue: services.reduce((sum, s) => sum + s.stats.totalRevenue, 0),
      averageRating: 0,
      totalRatings: 0,
      categories: {},
    };

    // Calculate overall average rating
    const ratedServices = services.filter(s => s.stats.ratingCount > 0);
    if (ratedServices.length > 0) {
      const totalRatingPoints = ratedServices.reduce(
        (sum, s) => sum + s.stats.averageRating * s.stats.ratingCount,
        0
      );
      const totalRatings = ratedServices.reduce((sum, s) => sum + s.stats.ratingCount, 0);
      stats.averageRating = Number((totalRatingPoints / totalRatings).toFixed(2));
      stats.totalRatings = totalRatings;
    }

    // Count by category
    services.forEach(service => {
      stats.categories[service.category] = (stats.categories[service.category] || 0) + 1;
    });

    return stats;
  }

  /**
   * Ensure database indexes
   */
  async ensureIndexes() {
    const db = await this._getDatabase();
    
    const servicesCol = db.collection('service_marketplace');
    await servicesCol.createIndexes([
      { key: { serviceId: 1 }, name: 'service_id', unique: true },
      { key: { providerId: 1, active: 1 }, name: 'provider_active' },
      { key: { category: 1, active: 1 }, name: 'category_active' },
      { key: { 'pricing.amount': 1 }, name: 'price' },
      { key: { 'stats.averageRating': -1 }, name: 'rating' },
      { key: { 'stats.totalRequests': -1 }, name: 'popularity' },
      { key: { createdAt: -1 }, name: 'created' },
      { key: { active: 1, category: 1, 'stats.averageRating': -1 }, name: 'discovery' },
    ]).catch(() => {});

    const ratingsCol = db.collection('service_ratings');
    await ratingsCol.createIndexes([
      { key: { serviceId: 1, userId: 1 }, name: 'service_user', unique: true },
      { key: { serviceId: 1, createdAt: -1 }, name: 'service_recent' },
      { key: { userId: 1 }, name: 'user_ratings' },
    ]).catch(() => {});

    this.logger.info('[MarketplaceService] Database indexes ensured');
  }
}
