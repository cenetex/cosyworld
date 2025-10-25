/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file src/services/web/server/routes/marketplace.js
 * @description Service marketplace API routes
 */

import express from 'express';
import { requireAgentPayment } from '../middleware/x402.js';

/**
 * Create marketplace routes
 * @param {Object} services - Service container
 * @returns {express.Router}
 */
export default function createMarketplaceRoutes(services) {
  const router = express.Router();
  const {
    logger,
    marketplaceService,
    x402Service,
    agentWalletService,
  } = services;

  if (!marketplaceService) {
    logger.error('[Marketplace Routes] marketplaceService not available');
  }

  /**
   * GET /api/marketplace/services
   * Search and filter services
   */
  router.get('/services', async (req, res) => {
    try {
      const {
        category,
        search,
        maxPrice,
        minRating,
        network,
        providerId,
        sortBy,
        limit,
        page = 1,
      } = req.query;

      const skip = (parseInt(page) - 1) * (parseInt(limit) || 50);

      const results = await marketplaceService.searchServices({
        category,
        search,
        maxPrice: maxPrice ? parseInt(maxPrice) : undefined,
        minRating: minRating ? parseFloat(minRating) : undefined,
        network,
        providerId,
        sortBy,
        limit: parseInt(limit) || 50,
        skip,
      });

      res.json(results);
    } catch (error) {
      logger.error('[Marketplace Routes] GET /services error:', error);
      res.status(500).json({
        error: 'Failed to search services',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/marketplace/services/:serviceId
   * Get service details
   */
  router.get('/services/:serviceId', async (req, res) => {
    try {
      const { serviceId } = req.params;
      const service = await marketplaceService.getService(serviceId);

      if (!service) {
        return res.status(404).json({ error: 'Service not found' });
      }

      // Get recent ratings
      const ratings = await marketplaceService.getServiceRatings(serviceId, {
        limit: 10,
      });

      res.json({
        ...service,
        recentRatings: ratings,
      });
    } catch (error) {
      logger.error('[Marketplace Routes] GET /services/:serviceId error:', error);
      res.status(500).json({
        error: 'Failed to fetch service',
        message: error.message,
      });
    }
  });

  /**
   * POST /api/marketplace/services
   * Register a new service
   */
  router.post('/services', async (req, res) => {
    try {
      const {
        providerId,
        name,
        description,
        category,
        pricing,
        endpoint,
        network,
        metadata,
      } = req.body;

      if (!providerId) {
        return res.status(400).json({ error: 'providerId is required' });
      }

      const service = await marketplaceService.registerService({
        providerId,
        name,
        description,
        category,
        pricing,
        endpoint,
        network,
        metadata,
      });

      res.status(201).json(service);
    } catch (error) {
      logger.error('[Marketplace Routes] POST /services error:', error);
      res.status(400).json({
        error: 'Failed to register service',
        message: error.message,
      });
    }
  });

  /**
   * PUT /api/marketplace/services/:serviceId
   * Update a service
   */
  router.put('/services/:serviceId', async (req, res) => {
    try {
      const { serviceId } = req.params;
      const { providerId, ...updates } = req.body;

      if (!providerId) {
        return res.status(400).json({ error: 'providerId is required' });
      }

      const service = await marketplaceService.updateService(
        serviceId,
        providerId,
        updates
      );

      res.json(service);
    } catch (error) {
      logger.error('[Marketplace Routes] PUT /services/:serviceId error:', error);
      res.status(400).json({
        error: 'Failed to update service',
        message: error.message,
      });
    }
  });

  /**
   * DELETE /api/marketplace/services/:serviceId
   * Deactivate a service
   */
  router.delete('/services/:serviceId', async (req, res) => {
    try {
      const { serviceId } = req.params;
      const { providerId } = req.body;

      if (!providerId) {
        return res.status(400).json({ error: 'providerId is required' });
      }

      await marketplaceService.deleteService(serviceId, providerId);

      res.json({ success: true, message: 'Service deactivated' });
    } catch (error) {
      logger.error('[Marketplace Routes] DELETE /services/:serviceId error:', error);
      res.status(400).json({
        error: 'Failed to delete service',
        message: error.message,
      });
    }
  });

  /**
   * POST /api/marketplace/services/:serviceId/rate
   * Rate a service
   */
  router.post('/services/:serviceId/rate', async (req, res) => {
    try {
      const { serviceId } = req.params;
      const { userId, rating, comment } = req.body;

      if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
      }

      if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'rating must be between 1 and 5' });
      }

      const ratingRecord = await marketplaceService.rateService({
        serviceId,
        userId,
        rating,
        comment,
      });

      res.json(ratingRecord);
    } catch (error) {
      logger.error('[Marketplace Routes] POST /services/:serviceId/rate error:', error);
      res.status(400).json({
        error: 'Failed to rate service',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/marketplace/services/:serviceId/ratings
   * Get service ratings
   */
  router.get('/services/:serviceId/ratings', async (req, res) => {
    try {
      const { serviceId } = req.params;
      const { limit = 50, page = 1 } = req.query;
      
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const ratings = await marketplaceService.getServiceRatings(serviceId, {
        limit: parseInt(limit),
        skip,
      });

      res.json({
        ratings,
        page: parseInt(page),
        limit: parseInt(limit),
      });
    } catch (error) {
      logger.error('[Marketplace Routes] GET /services/:serviceId/ratings error:', error);
      res.status(500).json({
        error: 'Failed to fetch ratings',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/marketplace/providers/:providerId/stats
   * Get provider statistics
   */
  router.get('/providers/:providerId/stats', async (req, res) => {
    try {
      const { providerId } = req.params;
      const stats = await marketplaceService.getProviderStats(providerId);

      res.json(stats);
    } catch (error) {
      logger.error('[Marketplace Routes] GET /providers/:providerId/stats error:', error);
      res.status(500).json({
        error: 'Failed to fetch provider stats',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/marketplace/categories
   * Get available service categories
   */
  router.get('/categories', async (req, res) => {
    try {
      const categories = [
        {
          id: 'ai',
          name: 'AI & Generation',
          description: 'AI-powered content generation, analysis, and processing',
          icon: '🤖',
        },
        {
          id: 'data',
          name: 'Data & Analytics',
          description: 'Data processing, analysis, and insights',
          icon: '📊',
        },
        {
          id: 'compute',
          name: 'Compute & Processing',
          description: 'Computational services and heavy processing',
          icon: '⚡',
        },
        {
          id: 'storage',
          name: 'Storage & Files',
          description: 'File storage, IPFS pinning, and data persistence',
          icon: '💾',
        },
        {
          id: 'social',
          name: 'Social & Communication',
          description: 'Social media posting, messaging, and outreach',
          icon: '📱',
        },
        {
          id: 'utility',
          name: 'Utilities',
          description: 'Miscellaneous utility services',
          icon: '🔧',
        },
      ];

      res.json({ categories });
    } catch (error) {
      logger.error('[Marketplace Routes] GET /categories error:', error);
      res.status(500).json({
        error: 'Failed to fetch categories',
        message: error.message,
      });
    }
  });

  /**
   * POST /api/marketplace/services/:serviceId/call
   * Call a service with automatic payment (agent-to-agent)
   * This is a proxy endpoint that handles payment and forwards to actual service
   */
  router.post(
    '/services/:serviceId/call',
    async (req, res) => {
      try {
        const { serviceId } = req.params;
        
        // Get service details
        const service = await marketplaceService.getService(serviceId);
        
        if (!service) {
          return res.status(404).json({ error: 'Service not found' });
        }

        if (!service.active) {
          return res.status(410).json({ error: 'Service is no longer active' });
        }

        // Set agentId in params for requireAgentPayment middleware
        req.params.agentId = service.providerId;

        // Apply payment middleware dynamically
        const paymentMiddleware = requireAgentPayment({
          x402Service,
          agentWalletService,
          price: service.pricing.amount,
          onPaymentReceived: async (req, payment) => {
            // Record usage
            await marketplaceService.recordUsage(serviceId, payment.amount);
            logger.info(
              `[Marketplace] Service ${serviceId} called, revenue: ${payment.amount / 1e6} USDC`
            );
          },
        });

        // Apply middleware and continue
        paymentMiddleware(req, res, async () => {
          // TODO: Actually call the service endpoint
          // For now, return mock success with payment confirmation
          res.json({
            success: true,
            message: 'Service call executed successfully',
            payment: {
              amount: service.pricing.amount / 1e6,
              currency: 'USDC',
              recipient: service.providerId,
              service: service.name,
            },
            service: {
              id: service.serviceId,
              name: service.name,
              endpoint: service.endpoint,
            },
            payment: req.payment,
          });
        });
      } catch (error) {
        logger.error('[Marketplace Routes] POST /services/:serviceId/call error:', error);
        res.status(500).json({
          error: 'Service call failed',
          message: error.message,
        });
      }
    }
  );

  return router;
}
