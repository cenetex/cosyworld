/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import express from 'express';
import { ObjectId } from 'mongodb';
import NodeCache from 'node-cache';
import { thumbnailService } from '../services/thumbnailService.js';

const router = express.Router();
const tribesCache = new NodeCache({ stdTTL: 1800, checkperiod: 300 });

export default function(db) {
  if (!db) {
    console.error('Database connection not provided to tribes route');
    throw new Error('Database not connected');
  }

  // Get tribe counts only
  router.get('/counts', async (req, res) => {
    try {
      const cacheKey = 'tribes:counts';
      const cachedCounts = tribesCache.get(cacheKey);
      
      if (cachedCounts) {
        return res.json(cachedCounts);
      }

      // Changed aggregation: project a normalized emoji field (or "Glitch Tribe" if missing)
      const tribes = await db.collection('avatars').aggregate([
        {
          $project: {
            emoji: {
              $cond: [
                { $or: [ { $eq: ["$emoji", null] }, { $eq: ["$emoji", ""] } ] },
                "Glitch Tribe",
                "$emoji"
              ]
            }
          }
        },
        {
          $group: {
            _id: "$emoji",
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } }
      ]).toArray();

      const counts = tribes.map(t => ({ emoji: t._id, count: t.count }));
      tribesCache.set(cacheKey, counts);
      
      res.json(counts);
    } catch (error) {
      console.error('[Tribes Counts Error]:', error);
      res.status(500).json({ error: 'Failed to fetch tribe counts', details: error.message });
    }
  });

  // Get details for a specific tribe
  router.get('/:emoji', async (req, res) => {
    try {
      const { emoji } = req.params;
      const limit = Math.max(parseInt(req.query.limit, 10) || 20, 1);
      const after = req.query.after; // cursor: last _id string
  const thumbs = String(req.query.thumbs || '0') === '1';
      
  const cacheKey = `tribe:${emoji}:after:${after || 'none'}:limit:${limit}:thumbs:${thumbs?'1':'0'}`;
      const cachedTribe = tribesCache.get(cacheKey);

      if (cachedTribe) {
        return res.json(cachedTribe);
      }
      
      // Build match condition based on tribe emoji
      const matchCondition = emoji === "Glitch Tribe" 
        ? { $or: [ { emoji: { $eq: null } }, { emoji: "" }, { emoji: { $exists: false } } ] }
        : { emoji: emoji };

      const idFilter = after ? { _id: { $lt: (() => { try { return new ObjectId(after); } catch { return null; } })() } } : {};
      if (idFilter._id && idFilter._id.$lt === null) {
        return res.status(400).json({ error: 'Invalid cursor' });
      }

      const tribe = await db.collection('avatars').aggregate([
        {
          $match: { ...matchCondition, ...(idFilter._id ? idFilter : {}) }
        },
        // Deterministic order for pagination by _id desc (timestamp)
        { $sort: { _id: -1 } },
        {
          $lookup: {
            from: 'messages',
            let: { avatarName: { $toLower: '$name' } },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: [{ $toLower: '$authorUsername' }, '$$avatarName'] }
                }
              },
              {
                $group: { _id: null, count: { $sum: 1 } }
              }
            ],
            as: 'messageStats'
          }
        },
        {
          $project: {
            name: 1,
            emoji: 1,
            imageUrl: 1,
            messageCount: { $ifNull: [{ $arrayElemAt: ['$messageStats.count', 0] }, 0] }
          }
        },
        { $limit: limit }
      ]).toArray();

      await thumbnailService.ensureThumbnailDir();
      const makeThumb = async (url) => {
        if (!url) return '/images/default-avatar.svg';
        try { return await thumbnailService.generateThumbnail(url); } catch { return '/images/default-avatar.svg'; }
      };
      const members = await Promise.all(
        tribe.map(async (member) => ({
          ...member,
          thumbnailUrl: await makeThumb(member.imageUrl)
        }))
      );

  const nextCursor = members.length === limit ? String(members[members.length - 1]._id) : null;
  const payload = { emoji, members, nextCursor };
      tribesCache.set(cacheKey, payload);
      res.json(payload);
    } catch (error) {
      console.error('[Tribe Details Error]:', error);
      res.status(500).json({ error: 'Failed to fetch tribe details', details: error.message });
    }
  });

  return router;
}
