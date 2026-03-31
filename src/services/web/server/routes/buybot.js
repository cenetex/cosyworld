/**
 * @fileoverview BuyBot Events API routes
 * Provides access to token transaction events stored by BuyBot
 * @module routes/buybot
 */

import { Router } from 'express';

const router = Router();

/**
 * Initialize BuyBot routes with database dependency
 * @param {Object} options - Configuration options
 * @param {Object} options.databaseService - Database service instance
 * @returns {Router} Express router
 */
export function createBuybotRouter({ databaseService }) {
  const COLLECTION = 'buybot_token_events';

  /**
   * @route GET /api/buybot/events/:signature
   * @description Get a specific token event by its transaction signature
   * @param {string} signature - Transaction signature
   * @returns {Object} Event details including transaction info, avatars, and token data
   */
  router.get('/events/:signature', async (req, res) => {
    try {
      const { signature } = req.params;
      
      if (!signature) {
        return res.status(400).json({ error: 'Missing signature parameter' });
      }

      const db = await databaseService.getDb();
      const event = await db.collection(COLLECTION).findOne({ signature });

      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      // Format the response with relevant details
      const response = {
        signature: event.signature,
        type: event.type,
        inferredType: event.inferredType,
        tokenAddress: event.tokenAddress,
        tokenSymbol: event.tokenSymbol,
        amount: event.amount,
        amountFormatted: event.amountFormatted,
        decimals: event.decimals,
        from: event.from,
        to: event.to,
        txUrl: event.txUrl,
        timestamp: event.timestamp,
        channelId: event.channelId,
        usdValue: event.usdValue,
        preAmountUi: event.preAmountUi,
        postAmountUi: event.postAmountUi,
        isNewHolder: event.isNewHolder,
        isIncrease: event.isIncrease,
        description: event.description || event.displayDescription,
        createdAt: event.createdAt
      };

      res.json(response);
    } catch (error) {
      console.error('[BuyBot API] Error fetching event:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * @route GET /api/buybot/events
   * @description List recent token events with optional filtering
   * @query {string} [channelId] - Filter by Discord channel ID
   * @query {string} [tokenAddress] - Filter by token address
   * @query {string} [type] - Filter by event type (swap, transfer)
   * @query {number} [limit=20] - Maximum number of events to return (max 100)
   * @query {number} [skip=0] - Number of events to skip for pagination
   * @returns {Object} List of events with pagination info
   */
  router.get('/events', async (req, res) => {
    try {
      const { channelId, tokenAddress, type, limit = 20, skip = 0 } = req.query;

      const query = {};
      if (channelId) query.channelId = channelId;
      if (tokenAddress) query.tokenAddress = tokenAddress;
      if (type) query.type = type;

      const limitNum = Math.min(parseInt(limit, 10) || 20, 100);
      const skipNum = parseInt(skip, 10) || 0;

      const db = await databaseService.getDb();
      
      const [events, total] = await Promise.all([
        db.collection(COLLECTION)
          .find(query)
          .sort({ timestamp: -1 })
          .skip(skipNum)
          .limit(limitNum)
          .toArray(),
        db.collection(COLLECTION).countDocuments(query)
      ]);

      // Format events for response
      const formattedEvents = events.map(event => ({
        signature: event.signature,
        type: event.type,
        tokenAddress: event.tokenAddress,
        tokenSymbol: event.tokenSymbol,
        amount: event.amount,
        amountFormatted: event.amountFormatted,
        from: event.from,
        to: event.to,
        txUrl: event.txUrl,
        timestamp: event.timestamp,
        channelId: event.channelId,
        usdValue: event.usdValue
      }));

      res.json({
        events: formattedEvents,
        pagination: {
          total,
          limit: limitNum,
          skip: skipNum,
          hasMore: skipNum + limitNum < total
        }
      });
    } catch (error) {
      console.error('[BuyBot API] Error listing events:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * @route GET /api/buybot/tokens/:channelId
   * @description List tracked tokens for a specific Discord channel
   * @param {string} channelId - Discord channel ID
   * @returns {Object} List of tracked tokens with their settings
   */
  router.get('/tokens/:channelId', async (req, res) => {
    try {
      const { channelId } = req.params;
      
      if (!channelId) {
        return res.status(400).json({ error: 'Missing channelId parameter' });
      }

      const db = await databaseService.getDb();
      const tokens = await db.collection('buybot_tracked_tokens')
        .find({ channelId })
        .toArray();

      res.json({
        channelId,
        tokens: tokens.map(t => ({
          tokenAddress: t.tokenAddress,
          tokenSymbol: t.tokenSymbol,
          tokenName: t.tokenName,
          tokenImage: t.tokenImage,
          addedAt: t.addedAt,
          lastEventAt: t.lastEventAt,
          lastCheckedAt: t.lastCheckedAt,
          settings: {
            displayEmoji: t.displayEmoji,
            transferEmoji: t.transferEmoji,
            compactMode: t.notifications?.compactMode,
            onlySwapEvents: t.notifications?.onlySwapEvents,
            transferAggregationUsdThreshold: t.notifications?.transferAggregationUsdThreshold
          }
        }))
      });
    } catch (error) {
      console.error('[BuyBot API] Error fetching tracked tokens:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * @route GET /api/buybot/stats/:channelId
   * @description Get trading statistics for a channel
   * @param {string} channelId - Discord channel ID
   * @query {string} [tokenAddress] - Optional filter by specific token
   * @query {string} [period] - Time period: 1h, 24h, 7d (default: 24h)
   * @returns {Object} Trading statistics
   */
  router.get('/stats/:channelId', async (req, res) => {
    try {
      const { channelId } = req.params;
      const { tokenAddress, period = '24h' } = req.query;
      
      if (!channelId) {
        return res.status(400).json({ error: 'Missing channelId parameter' });
      }

      // Calculate time range
      const now = new Date();
      let startTime;
      switch (period) {
        case '1h':
          startTime = new Date(now.getTime() - 60 * 60 * 1000);
          break;
        case '7d':
          startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '24h':
        default:
          startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
      }

      const query = {
        channelId,
        timestamp: { $gte: startTime }
      };
      if (tokenAddress) query.tokenAddress = tokenAddress;

      const db = await databaseService.getDb();
      
      const stats = await db.collection(COLLECTION).aggregate([
        { $match: query },
        {
          $group: {
            _id: {
              tokenAddress: '$tokenAddress',
              type: '$type'
            },
            count: { $sum: 1 },
            totalUsd: { $sum: { $ifNull: ['$usdValue', 0] } },
            uniqueWallets: { $addToSet: '$to' }
          }
        },
        {
          $group: {
            _id: '$_id.tokenAddress',
            events: {
              $push: {
                type: '$_id.type',
                count: '$count',
                totalUsd: '$totalUsd'
              }
            },
            totalEvents: { $sum: '$count' },
            totalVolumeUsd: { $sum: '$totalUsd' },
            uniqueWallets: { $push: '$uniqueWallets' }
          }
        }
      ]).toArray();

      // Flatten unique wallets
      const formattedStats = stats.map(s => ({
        tokenAddress: s._id,
        totalEvents: s.totalEvents,
        totalVolumeUsd: s.totalVolumeUsd,
        uniqueWallets: [...new Set(s.uniqueWallets.flat())].length,
        byType: s.events.reduce((acc, e) => {
          acc[e.type] = { count: e.count, volumeUsd: e.totalUsd };
          return acc;
        }, {})
      }));

      res.json({
        channelId,
        period,
        startTime,
        endTime: now,
        stats: formattedStats
      });
    } catch (error) {
      console.error('[BuyBot API] Error fetching stats:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

export default router;
