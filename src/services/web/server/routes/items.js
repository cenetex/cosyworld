/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * Public Items API
 * Provides read access to items for external clients.
 */

import { Router } from 'express';
import { ObjectId } from 'mongodb';

/**
 * @param {import('mongodb').Db} db
 * @param {Object} services
 */
export default function itemsRoutes(db, services = {}) {
  const router = Router();
  const logger = services.logger || console;

  /**
   * GET /api/items
   * List items with optional filtering
   */
  router.get('/', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const offset = parseInt(req.query.offset) || 0;
      const { owner, locationId, rarity, type, search } = req.query;

      const filter = {};
      if (owner) {
        try { filter.owner = new ObjectId(owner); } catch { filter.owner = owner; }
      }
      if (locationId) {
        try { filter.locationId = new ObjectId(locationId); } catch { filter.locationId = locationId; }
      }
      if (rarity) filter.rarity = rarity;
      if (type) filter.type = type;
      if (search) {
        filter.$or = [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
        ];
      }

      const [items, total] = await Promise.all([
        db.collection('items')
          .find(filter)
          .sort({ createdAt: -1 })
          .skip(offset)
          .limit(limit)
          .toArray(),
        db.collection('items').countDocuments(filter),
      ]);

      res.json({
        data: items,
        total,
        limit,
        offset,
      });
    } catch (e) {
      logger.error('[items] GET / failed:', e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/items/:id
   * Get a single item by ID
   */
  router.get('/:id', async (req, res) => {
    try {
      let id;
      try { id = new ObjectId(req.params.id); } catch {
        return res.status(400).json({ error: 'Invalid ID format' });
      }

      const item = await db.collection('items').findOne({ _id: id });
      if (!item) {
        return res.status(404).json({ error: 'Item not found' });
      }

      res.json(item);
    } catch (e) {
      logger.error('[items] GET /:id failed:', e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/items/by-location/:locationId
   * Get all items at a specific location
   */
  router.get('/by-location/:locationId', async (req, res) => {
    try {
      let locationId;
      try { locationId = new ObjectId(req.params.locationId); } catch {
        locationId = req.params.locationId;
      }

      const items = await db.collection('items')
        .find({ locationId })
        .sort({ createdAt: -1 })
        .limit(100)
        .toArray();

      res.json({ data: items, total: items.length });
    } catch (e) {
      logger.error('[items] GET /by-location/:locationId failed:', e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/items/by-owner/:ownerId
   * Get all items owned by a specific avatar
   */
  router.get('/by-owner/:ownerId', async (req, res) => {
    try {
      let owner;
      try { owner = new ObjectId(req.params.ownerId); } catch {
        owner = req.params.ownerId;
      }

      const items = await db.collection('items')
        .find({ owner })
        .sort({ createdAt: -1 })
        .limit(100)
        .toArray();

      res.json({ data: items, total: items.length });
    } catch (e) {
      logger.error('[items] GET /by-owner/:ownerId failed:', e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
