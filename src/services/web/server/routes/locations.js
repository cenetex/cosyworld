/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * Public Locations API
 * Provides read access to locations for external clients.
 */

import { Router } from 'express';
import { ObjectId } from 'mongodb';

/**
 * @param {import('mongodb').Db} db
 * @param {Object} services
 */
export default function locationsRoutes(db, services = {}) {
  const router = Router();
  const logger = services.logger || console;

  /**
   * GET /api/locations
   * List locations with optional filtering
   */
  router.get('/', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const offset = parseInt(req.query.offset) || 0;
      const { type, channelId, guildId, search } = req.query;

      const filter = {};
      if (type) filter.type = type;
      if (channelId) filter.channelId = channelId;
      if (guildId) filter.guildId = guildId;
      if (search) {
        filter.$or = [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
        ];
      }

      const [locations, total] = await Promise.all([
        db.collection('locations')
          .find(filter)
          .sort({ createdAt: -1 })
          .skip(offset)
          .limit(limit)
          .toArray(),
        db.collection('locations').countDocuments(filter),
      ]);

      res.json({
        data: locations,
        total,
        limit,
        offset,
      });
    } catch (e) {
      logger.error('[locations] GET / failed:', e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/locations/:id
   * Get a single location by ID
   */
  router.get('/:id', async (req, res) => {
    try {
      let id;
      try { id = new ObjectId(req.params.id); } catch {
        return res.status(400).json({ error: 'Invalid ID format' });
      }

      const location = await db.collection('locations').findOne({ _id: id });
      if (!location) {
        return res.status(404).json({ error: 'Location not found' });
      }

      res.json(location);
    } catch (e) {
      logger.error('[locations] GET /:id failed:', e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/locations/by-channel/:channelId
   * Get location by Discord channel ID
   */
  router.get('/by-channel/:channelId', async (req, res) => {
    try {
      const location = await db.collection('locations').findOne({
        channelId: req.params.channelId,
      });

      if (!location) {
        return res.status(404).json({ error: 'Location not found for this channel' });
      }

      res.json(location);
    } catch (e) {
      logger.error('[locations] GET /by-channel/:channelId failed:', e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/locations/:id/items
   * Get all items at a specific location
   */
  router.get('/:id/items', async (req, res) => {
    try {
      let locationId;
      try { locationId = new ObjectId(req.params.id); } catch {
        locationId = req.params.id;
      }

      const items = await db.collection('items')
        .find({ locationId })
        .sort({ createdAt: -1 })
        .limit(100)
        .toArray();

      res.json({ data: items, total: items.length });
    } catch (e) {
      logger.error('[locations] GET /:id/items failed:', e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/locations/:id/avatars
   * Get all avatars at a specific location
   */
  router.get('/:id/avatars', async (req, res) => {
    try {
      let locationId;
      try { locationId = new ObjectId(req.params.id); } catch {
        locationId = req.params.id;
      }

      // Find avatars whose current location matches this location
      const avatars = await db.collection('avatars')
        .find({ 
          $or: [
            { locationId },
            { currentLocationId: locationId },
          ]
        })
        .sort({ lastActiveAt: -1 })
        .limit(100)
        .toArray();

      res.json({ data: avatars, total: avatars.length });
    } catch (e) {
      logger.error('[locations] GET /:id/avatars failed:', e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
