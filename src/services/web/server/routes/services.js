/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file src/services/web/server/routes/services.js
 * @description API routes for marketplace service execution
 */

import express from 'express';
import { requireAgentPayment } from '../middleware/x402.js';

/**
 * Create payment middleware for a marketplace service
 * @param {Object} services - Service container
 * @param {string} serviceId - Service identifier
 * @returns {Function} Express middleware
 */
function createServicePaymentMiddleware(services, serviceId) {
  const { marketplaceServiceRegistry, x402Service, agentWalletService, logger } = services;

  // Get service metadata to extract pricing
  let serviceMetadata;
  try {
    const service = marketplaceServiceRegistry?.getService(serviceId);
    serviceMetadata = service?.getMetadata();
  } catch (error) {
    logger?.error(`[Service Routes] Failed to get metadata for ${serviceId}:`, error);
  }

  if (!serviceMetadata) {
    // Return a middleware that rejects the request if service not found
    return (req, res, next) => {
      res.status(503).json({
        error: 'Service unavailable',
        message: `Service ${serviceId} is not registered`,
      });
    };
  }

  // Create the payment middleware with proper options
  return requireAgentPayment({
    x402Service,
    agentWalletService,
    price: serviceMetadata.pricing.amount,
    currency: serviceMetadata.pricing.currency || 'USDC',
    onPaymentReceived: async (paymentInfo) => {
      logger?.info(`[Service Routes] Payment received for ${serviceId}:`, paymentInfo);
    },
  });
}

/**
 * Create service execution routes
 * @param {Object} services - Service container
 * @returns {express.Router}
 */
export default function createServiceRoutes(services) {
  const router = express.Router();
  const { logger, marketplaceServiceRegistry } = services;

  if (!marketplaceServiceRegistry) {
    logger.warn('[Service Routes] marketplaceServiceRegistry not available');
  }

  /**
   * POST /api/services/video-generation/execute
   * Generate video with payment
   */
  router.post(
    '/video-generation/execute',
    createServicePaymentMiddleware(services, 'video-generation'),
    async (req, res) => {
      try {
        const { prompt, model, duration } = req.body;
        const agentId = req.agentId || req.body.agentId;

        if (!agentId) {
          return res.status(400).json({ error: 'Agent ID required' });
        }

        const result = await marketplaceServiceRegistry.executeService(
          'video-generation',
          { prompt, model, duration },
          agentId
        );

        res.json(result);
      } catch (error) {
        logger.error('[Service Routes] Video generation failed:', error);
        res.status(500).json({ error: error.message });
      }
    }
  );

  /**
   * POST /api/services/image-generation/execute
   * Generate image with payment
   */
  router.post(
    '/image-generation/execute',
    createServicePaymentMiddleware(services, 'image-generation'),
    async (req, res) => {
      try {
        const { prompt, model, width, height, style } = req.body;
        const agentId = req.agentId || req.body.agentId;

        if (!agentId) {
          return res.status(400).json({ error: 'Agent ID required' });
        }

        const result = await marketplaceServiceRegistry.executeService(
          'image-generation',
          { prompt, model, width, height, style },
          agentId
        );

        res.json(result);
      } catch (error) {
        logger.error('[Service Routes] Image generation failed:', error);
        res.status(500).json({ error: error.message });
      }
    }
  );

  /**
   * POST /api/services/agent-summon/execute
   * Summon an agent with payment
   */
  router.post(
    '/agent-summon/execute',
    createServicePaymentMiddleware(services, 'agent-summon'),
    async (req, res) => {
      try {
        const { targetAgentId, locationId, message, action } = req.body;
        const agentId = req.agentId || req.body.agentId;

        if (!agentId) {
          return res.status(400).json({ error: 'Agent ID required' });
        }

        const result = await marketplaceServiceRegistry.executeService(
          'agent-summon',
          { targetAgentId, locationId, message, action },
          agentId
        );

        res.json(result);
      } catch (error) {
        logger.error('[Service Routes] Agent summon failed:', error);
        res.status(500).json({ error: error.message });
      }
    }
  );

  /**
   * POST /api/services/combat/execute
   * Initiate combat with payment
   */
  router.post(
    '/combat/execute',
    createServicePaymentMiddleware(services, 'combat'),
    async (req, res) => {
      try {
        const { opponentId, stakes, useItems } = req.body;
        const agentId = req.agentId || req.body.agentId;

        if (!agentId) {
          return res.status(400).json({ error: 'Agent ID required' });
        }

        const result = await marketplaceServiceRegistry.executeService(
          'combat',
          { opponentId, stakes, useItems },
          agentId
        );

        res.json(result);
      } catch (error) {
        logger.error('[Service Routes] Combat failed:', error);
        res.status(500).json({ error: error.message });
      }
    }
  );

  /**
   * POST /api/services/memory-query/execute
   * Query memories with payment
   */
  router.post(
    '/memory-query/execute',
    createServicePaymentMiddleware(services, 'memory-query'),
    async (req, res) => {
      try {
        const { query, targetAgentId, limit, minImportance } = req.body;
        const agentId = req.agentId || req.body.agentId;

        if (!agentId) {
          return res.status(400).json({ error: 'Agent ID required' });
        }

        const result = await marketplaceServiceRegistry.executeService(
          'memory-query',
          { query, targetAgentId, limit, minImportance },
          agentId
        );

        res.json(result);
      } catch (error) {
        logger.error('[Service Routes] Memory query failed:', error);
        res.status(500).json({ error: error.message });
      }
    }
  );

  /**
   * POST /api/services/location-travel/execute
   * Fast travel with payment
   */
  router.post(
    '/location-travel/execute',
    createServicePaymentMiddleware(services, 'location-travel'),
    async (req, res) => {
      try {
        const { locationId, locationName } = req.body;
        const agentId = req.agentId || req.body.agentId;

        if (!agentId) {
          return res.status(400).json({ error: 'Agent ID required' });
        }

        const result = await marketplaceServiceRegistry.executeService(
          'location-travel',
          { locationId, locationName },
          agentId
        );

        res.json(result);
      } catch (error) {
        logger.error('[Service Routes] Location travel failed:', error);
        res.status(500).json({ error: error.message });
      }
    }
  );

  /**
   * POST /api/services/item-crafting/execute
   * Craft item with payment
   */
  router.post(
    '/item-crafting/execute',
    createServicePaymentMiddleware(services, 'item-crafting'),
    async (req, res) => {
      try {
        const { recipeId, materials, itemName, itemType } = req.body;
        const agentId = req.agentId || req.body.agentId;

        if (!agentId) {
          return res.status(400).json({ error: 'Agent ID required' });
        }

        const result = await marketplaceServiceRegistry.executeService(
          'item-crafting',
          { recipeId, materials, itemName, itemType },
          agentId
        );

        res.json(result);
      } catch (error) {
        logger.error('[Service Routes] Item crafting failed:', error);
        res.status(500).json({ error: error.message });
      }
    }
  );

  /**
   * POST /api/services/social-posting/execute
   * Post to social media with payment
   */
  router.post(
    '/social-posting/execute',
    createServicePaymentMiddleware(services, 'social-posting'),
    async (req, res) => {
      try {
        const { platform, content, mediaUrl, threadId, channelId } = req.body;
        const agentId = req.agentId || req.body.agentId;

        if (!agentId) {
          return res.status(400).json({ error: 'Agent ID required' });
        }

        const result = await marketplaceServiceRegistry.executeService(
          'social-posting',
          { platform, content, mediaUrl, threadId, channelId },
          agentId
        );

        res.json(result);
      } catch (error) {
        logger.error('[Service Routes] Social posting failed:', error);
        res.status(500).json({ error: error.message });
      }
    }
  );

  /**
   * GET /api/services/catalog
   * Get all available services
   */
  router.get('/catalog', async (req, res) => {
    try {
      if (!marketplaceServiceRegistry) {
        return res.json({ services: [] });
      }

      const services = marketplaceServiceRegistry.getAllServices();
      res.json({ services });
    } catch (error) {
      logger.error('[Service Routes] Catalog fetch failed:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
