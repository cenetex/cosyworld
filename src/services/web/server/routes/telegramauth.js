/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Telegram Authentication and Bot Configuration Routes
 * Handles bot token registration, channel configuration, and avatar-specific bots
 */

import express from 'express';

export default function telegramAuthRoutes(services) {
  const router = express.Router();
  const telegramService = services.telegramService;
  const databaseService = services.databaseService;
  const logger = services.logger;

  const isAdmin = (req) => !!req?.user?.isAdmin;

  /**
   * Get global Telegram bot configuration
   * Admin only
   */
  router.get('/global/config', async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    try {
      const db = await databaseService.getDatabase();
      const config = await db.collection('telegram_post_config').findOne({ _id: 'global' });
      
      // Check for token and channel ID in secrets, fallback to config/env
      let hasGlobalBot = false;
      let hasChannelId = false;
      let channelId = config?.channelId;
      
      if (services.secretsService) {
        try {
          const token = await services.secretsService.getAsync('telegram_global_bot_token');
          hasGlobalBot = !!token;
          
          if (!channelId) {
            channelId = await services.secretsService.getAsync('telegram_global_channel_id');
          }
          hasChannelId = !!channelId;
        } catch (err) {
          // No secrets, fall back to env
          hasGlobalBot = !!services.configService.get('TELEGRAM_GLOBAL_BOT_TOKEN');
          if (!channelId) {
            channelId = services.configService.get('TELEGRAM_GLOBAL_CHANNEL_ID');
          }
          hasChannelId = !!channelId;
        }
      } else {
        hasGlobalBot = !!services.configService.get('TELEGRAM_GLOBAL_BOT_TOKEN');
        if (!channelId) {
          channelId = services.configService.get('TELEGRAM_GLOBAL_CHANNEL_ID');
        }
        hasChannelId = !!channelId;
      }
      
      res.json({
        enabled: config?.enabled ?? false,
        channelId: channelId || '',
        rate: config?.rate || { hourly: 10, minIntervalSec: 180 },
        hasGlobalBot,
        hasChannelId,
        botConfigured: hasGlobalBot && hasChannelId
      });
    } catch (error) {
      logger?.error?.('[TelegramAuth] Failed to get global config:', error);
      res.status(500).json({ error: 'Failed to load configuration' });
    }
  });

  /**
   * Update global Telegram bot configuration
   * Admin only
   */
  router.post('/global/config', async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    try {
      const { enabled, channelId, rate } = req.body;
      
      const update = {};
      if (typeof enabled === 'boolean') update.enabled = enabled;
      if (channelId) update.channelId = channelId.trim();
      if (rate) update.rate = rate;

      await telegramService.updateGlobalPostingConfig(update);

      res.json({ success: true, message: 'Configuration updated' });
    } catch (error) {
      logger?.error?.('[TelegramAuth] Failed to update global config:', error);
      res.status(500).json({ error: 'Failed to update configuration' });
    }
  });

  /**
   * Set global bot token (stored in SecretsService)
   * Admin only
   */
  router.post('/global/token', async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    try {
      const { botToken } = req.body;
      
      if (!botToken || typeof botToken !== 'string') {
        return res.status(400).json({ error: 'Bot token is required' });
      }

      if (!services.secretsService) {
        return res.status(500).json({ error: 'Secrets service not available' });
      }

      // Store token in secrets
      await services.secretsService.set('telegram_global_bot_token', botToken.trim());
      
      // Try to reinitialize the bot with the new token
      const initialized = await telegramService.initializeGlobalBot();
      
      if (!initialized) {
        return res.status(400).json({ 
          error: 'Token saved but failed to initialize bot. Please verify the token is correct.' 
        });
      }

      res.json({ success: true, message: 'Bot token saved and bot initialized' });
    } catch (error) {
      logger?.error?.('[TelegramAuth] Failed to set bot token:', error);
      res.status(500).json({ error: `Failed to save bot token: ${error.message}` });
    }
  });

  /**
   * Set global channel ID (stored in SecretsService)
   * Admin only
   */
  router.post('/global/channel', async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    try {
      const { channelId } = req.body;
      
      if (!channelId || typeof channelId !== 'string') {
        return res.status(400).json({ error: 'Channel ID is required' });
      }

      if (!services.secretsService) {
        return res.status(500).json({ error: 'Secrets service not available' });
      }

      // Store channel ID in secrets
      await services.secretsService.set('telegram_global_channel_id', channelId.trim());

      res.json({ success: true, message: 'Channel ID saved' });
    } catch (error) {
      logger?.error?.('[TelegramAuth] Failed to set channel ID:', error);
      res.status(500).json({ error: `Failed to save channel ID: ${error.message}` });
    }
  });

  /**
   * Test global bot connection
   * Admin only
   */
  router.post('/global/test', async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    try {
      if (!telegramService.globalBot) {
        return res.status(400).json({ 
          error: 'Global bot not initialized. Please configure TELEGRAM_GLOBAL_BOT_TOKEN in environment.' 
        });
      }

      // Try to get bot info
      const botInfo = await telegramService.globalBot.telegram.getMe();
      
      res.json({
        success: true,
        botInfo: {
          id: botInfo.id,
          username: botInfo.username,
          firstName: botInfo.first_name
        }
      });
    } catch (error) {
      logger?.error?.('[TelegramAuth] Bot test failed:', error);
      res.status(500).json({ error: `Bot test failed: ${error.message}` });
    }
  });

  /**
   * Get avatar-specific bot status
   */
  router.get('/avatar/:avatarId/status', async (req, res) => {
    try {
      const { avatarId } = req.params;
      
      // Verify user has access to this avatar
      if (!isAdmin(req) && req.user?.avatarId !== avatarId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const isAuthorized = await telegramService.isTelegramAuthorized(avatarId);
      
      if (!isAuthorized) {
        return res.json({ authorized: false });
      }

      const db = await databaseService.getDatabase();
      const auth = await db.collection('telegram_auth').findOne({ avatarId });
      
      res.json({
        authorized: true,
        botUsername: auth?.botUsername || null,
        channelId: auth?.channelId || null,
        hasChannel: !!auth?.channelId
      });
    } catch (error) {
      logger?.error?.('[TelegramAuth] Status check failed:', error);
      res.status(500).json({ error: 'Failed to check status' });
    }
  });

  /**
   * Register or update bot for an avatar
   */
  router.post('/avatar/:avatarId/register', async (req, res) => {
    try {
      const { avatarId } = req.params;
      const { botToken, channelId } = req.body;

      // Verify user has access to this avatar
      if (!isAdmin(req) && req.user?.avatarId !== avatarId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      if (!botToken) {
        return res.status(400).json({ error: 'Bot token is required' });
      }

      const result = await telegramService.registerAvatarBot(avatarId, botToken, channelId);
      
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({
        success: true,
        botUsername: result.botUsername,
        message: `Bot @${result.botUsername} registered successfully`
      });
    } catch (error) {
      logger?.error?.('[TelegramAuth] Bot registration failed:', error);
      res.status(500).json({ error: 'Failed to register bot' });
    }
  });

  /**
   * Disconnect bot from avatar
   */
  router.post('/avatar/:avatarId/disconnect', async (req, res) => {
    try {
      const { avatarId } = req.params;

      // Verify user has access to this avatar
      if (!isAdmin(req) && req.user?.avatarId !== avatarId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const result = await telegramService.disconnectAvatarBot(avatarId);
      
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({ success: true, message: 'Bot disconnected successfully' });
    } catch (error) {
      logger?.error?.('[TelegramAuth] Bot disconnection failed:', error);
      res.status(500).json({ error: 'Failed to disconnect bot' });
    }
  });

  /**
   * Get global posting metrics
   * Admin only
   */
  router.get('/global/metrics', async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    try {
      const metrics = telegramService.getGlobalPostingMetrics();
      res.json(metrics);
    } catch (error) {
      logger?.error?.('[TelegramAuth] Failed to get metrics:', error);
      res.status(500).json({ error: 'Failed to load metrics' });
    }
  });

  /**
   * List Telegram members for a channel
   * Admin only
   */
  router.get('/members/:channelId', async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { channelId } = req.params;
    const trustLevelParam = typeof req.query.trustLevel === 'string' ? req.query.trustLevel : undefined;
    const trustLevels = trustLevelParam
      ? trustLevelParam.split(',').map((level) => level.trim()).filter(Boolean)
      : undefined;

    try {
      const result = await telegramService.listTelegramMembers(channelId, {
        limit: req.query.limit,
        offset: req.query.offset,
        includeLeft: req.query.includeLeft === 'true',
        search: req.query.search,
        trustLevels
      });

      res.json(result);
    } catch (error) {
      logger?.error?.('[TelegramAuth] Failed to list members:', error);
      res.status(500).json({ error: 'Failed to list members' });
    }
  });

  /**
   * Fetch details for a single Telegram member
   * Admin only
   */
  router.get('/members/:channelId/:userId', async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { channelId, userId } = req.params;

    try {
      const result = await telegramService.getTelegramMember(channelId, userId, {
        includeMessages: req.query.includeMessages !== 'false',
        messageLimit: req.query.messageLimit
      });

      if (!result) {
        return res.status(404).json({ error: 'Member not found' });
      }

      res.json(result);
    } catch (error) {
      logger?.error?.('[TelegramAuth] Failed to fetch member:', error);
      res.status(500).json({ error: 'Failed to fetch member' });
    }
  });

  /**
   * Update a Telegram member's moderation state
   * Admin only
   */
  router.patch('/members/:channelId/:userId', async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { channelId, userId } = req.params;
    const payload = {
      trustLevel: req.body?.trustLevel,
      permanentlyBlacklisted: typeof req.body?.permanentlyBlacklisted === 'boolean' ? req.body.permanentlyBlacklisted : undefined,
      penaltyExpires: Object.prototype.hasOwnProperty.call(req.body || {}, 'penaltyExpires') ? req.body.penaltyExpires : undefined,
      spamStrikes: typeof req.body?.spamStrikes === 'number' ? req.body.spamStrikes : undefined,
      adminNotes: req.body?.adminNotes,
      clearPenalty: req.body?.clearPenalty === true
    };

    try {
      const member = await telegramService.updateTelegramMember(channelId, userId, payload);
      if (!member) {
        return res.status(404).json({ error: 'Member not found' });
      }

      res.json({ success: true, member });
    } catch (error) {
      logger?.error?.('[TelegramAuth] Failed to update member:', error);
      res.status(400).json({ error: error.message || 'Failed to update member' });
    }
  });

  /**
   * Clear permanent ban and penalties for a member
   * Admin only
   */
  router.post('/members/:channelId/:userId/unban', async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { channelId, userId } = req.params;
    const options = {
      trustLevel: req.body?.trustLevel,
      clearStrikes: req.body?.clearStrikes !== false
    };

    try {
      const member = await telegramService.unbanTelegramMember(channelId, userId, options);
      if (!member) {
        return res.status(404).json({ error: 'Member not found' });
      }

      res.json({ success: true, member });
    } catch (error) {
      logger?.error?.('[TelegramAuth] Failed to unban member:', error);
      res.status(400).json({ error: error.message || 'Failed to unban member' });
    }
  });

  /**
   * Get spam statistics for a Telegram channel
   * Admin only
   */
  router.get('/spam-stats/:channelId', async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { channelId } = req.params;

    try {
      const stats = await telegramService.getTelegramSpamStats(channelId);
      res.json(stats);
    } catch (error) {
      logger?.error?.('[TelegramAuth] Failed to fetch spam stats:', error);
      res.status(500).json({ error: 'Failed to fetch spam stats' });
    }
  });

  return router;
}
