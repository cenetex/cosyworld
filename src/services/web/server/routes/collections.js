/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { thumbnailService } from '../services/thumbnailService.js';
import fs from 'fs/promises';
import path from 'path';

function toObjectId(id) {
  return ObjectId.isValid(id) ? new ObjectId(id) : id;
}

export default function collectionsRoutes(db) {
  if (!db) throw new Error('Database not connected');
  const router = Router();

  // Lazy-loaded metadata (optional): data/collections.json
  // Shape can be either an object map { "<id>": { name, description, thumbnailUrl? } }
  // or an array of { id|key, name, description, thumbnailUrl }
  let collectionsMetaCache = null;
  async function loadCollectionsMeta() {
    if (collectionsMetaCache) return collectionsMetaCache;
    try {
      const metaPath = path.join(process.cwd(), 'data', 'collections.json');
      const json = JSON.parse(await fs.readFile(metaPath, 'utf8'));
      /** @type {Record<string, {name?:string, description?:string, thumbnailUrl?:string}>} */
      const map = {};
      if (Array.isArray(json)) {
        for (const it of json) {
          const key = it?.id || it?.key || it?.collection || it?.slug;
          if (!key) continue;
          map[String(key)] = { name: it.name, description: it.description, thumbnailUrl: it.thumbnailUrl };
        }
      } else if (json && typeof json === 'object') {
        for (const [k, v] of Object.entries(json)) {
          map[String(k)] = { name: v?.name, description: v?.description, thumbnailUrl: v?.thumbnailUrl };
        }
      }
      collectionsMetaCache = map;
      return collectionsMetaCache;
    } catch {
      collectionsMetaCache = {};
      return collectionsMetaCache;
    }
  }

  // GET /api/collections
  // List collections with counts and a sample thumbnail
  router.get('/', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const skip = (page - 1) * limit;

      const pipeline = [
        { $match: { 'nft.collection': { $exists: true, $ne: null } } },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$nft.collection',
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

      const meta = await loadCollectionsMeta();

      const collections = await Promise.all(
        grouped.map(async (g) => {
          const sampleUrl = g.sample?.thumbnailUrl || g.sample?.imageUrl;
          let thumb = '/images/default-collection.svg';
          if (sampleUrl) {
            try { thumb = await thumbnailService.generateThumbnail(sampleUrl); } catch { /* keep default */ }
          }
          const m = meta[g._id] || meta[String(g._id)] || null;
          const displayName = m?.name || g.sample?.nft?.collectionName || g.sample?.collectionName || g._id;
          const description = m?.description || g.sample?.nft?.collectionDescription || null;
          const outThumb = m?.thumbnailUrl || thumb;
          return {
            id: g._id,
            key: g._id,
            name: displayName,
            description,
            count: g.count,
            thumbnailUrl: outThumb,
            latestAt: g.sample?.createdAt || null,
          };
        })
      );

      // Total distinct collection count
      const totals = await db.collection('avatars').aggregate([
        { $match: { 'nft.collection': { $exists: true, $ne: null } } },
        { $group: { _id: '$nft.collection' } },
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

      const match = { 'nft.collection': id };

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
            const src = av.thumbnailUrl || av.imageUrl;
            if (!src) return { ...av, thumbnailUrl: '/images/default-avatar.svg' };
            try {
              const url = await thumbnailService.generateThumbnail(src);
              return { ...av, thumbnailUrl: url };
            } catch {
              return { ...av, thumbnailUrl: '/images/default-avatar.svg' };
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
