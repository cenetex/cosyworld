/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { thumbnailService } from '../services/thumbnailService.js';

function toObjectId(id) {
  return ObjectId.isValid(id) ? new ObjectId(id) : id;
}

export default function collectionsRoutes(db) {
  if (!db) throw new Error('Database not connected');
  const router = Router();

  // GET /api/collections
  // List collections with counts and a sample thumbnail
  router.get('/', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const skip = (page - 1) * limit;

      const pipeline = [
        { $addFields: { collKey: { $ifNull: ['$nft.collection', '$collection'] } } },
        { $match: { collKey: { $exists: true, $ne: null } } },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$collKey',
            count: { $sum: 1 },
            sample: { $first: '$$ROOT' },
          },
        },
        { $sort: { count: -1, _id: 1 } },
        { $skip: skip },
        { $limit: limit },
      ];

      const grouped = await db.collection('avatars').aggregate(pipeline).toArray();
      await thumbnailService.ensureThumbnailDir();

      const collections = await Promise.all(
        grouped.map(async (g) => {
          const sampleUrl = g.sample?.thumbnailUrl || g.sample?.imageUrl;
          let thumb = sampleUrl;
          try { thumb = await thumbnailService.generateThumbnail(sampleUrl); } catch {}
          return {
            id: g._id,
            key: g._id,
            name: g._id,
            count: g.count,
            thumbnailUrl: thumb,
            latestAt: g.sample?.createdAt || null,
          };
        })
      );

      // Total distinct collection count
      const totals = await db.collection('avatars').aggregate([
        { $addFields: { collKey: { $ifNull: ['$nft.collection', '$collection'] } } },
        { $match: { collKey: { $exists: true, $ne: null } } },
        { $group: { _id: '$collKey' } },
        { $count: 'total' },
      ]).toArray();
      const total = totals?.[0]?.total || 0;

      res.json({ collections, page, total, totalPages: Math.ceil(total / limit), limit });
    } catch (err) {
      console.error('Collections list error:', err);
      res.status(500).json({ error: 'Failed to fetch collections' });
    }
  });

  // GET /api/collections/:id
  // List avatars in a collection with cursor-based pagination
  router.get('/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const limit = Math.min(parseInt(req.query.limit, 10) || 24, 100);
      const after = req.query.after;
      const thumbs = req.query.thumbs === '1' || req.query.thumbs === 'true';

      const match = {
        $or: [
          { 'nft.collection': id },
          { collection: id },
        ],
      };

      const cursorQuery = after && ObjectId.isValid(after) ? { _id: { $lt: new ObjectId(after) } } : {};

      const docs = await db.collection('avatars')
        .find({ ...match, ...cursorQuery })
        .project({ _id: 1, name: 1, imageUrl: 1, thumbnailUrl: 1, createdAt: 1, emoji: 1, model: 1 })
        .sort({ _id: -1 })
        .limit(limit + 1)
        .toArray();

      let avatars = docs.slice(0, limit);
      if (thumbs) {
        await thumbnailService.ensureThumbnailDir();
        avatars = await Promise.all(
          avatars.map(async (av) => {
            try {
              const url = await thumbnailService.generateThumbnail(av.thumbnailUrl || av.imageUrl);
              return { ...av, thumbnailUrl: url };
            } catch {
              return av;
            }
          })
        );
      }

      const nextCursor = docs.length > limit ? String(docs[limit]._id) : null;
      res.json({ avatars, nextCursor, count: avatars.length, limit });
    } catch (err) {
      console.error('Collection members error:', err);
      res.status(500).json({ error: 'Failed to fetch collection members' });
    }
  });

  return router;
}
