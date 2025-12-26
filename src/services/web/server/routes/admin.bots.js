/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * Admin Bots API: Manage bot instances, platforms, and assigned avatars.
 */
import express from 'express';

/**
 * Creates the admin bots router
 * @param {object} db - MongoDB database instance
 * @param {object} routeServices - Services container
 * @returns {express.Router} Express router
 */
export default function(db, routeServices = {}) {
  if (!db) throw new Error('Database not connected');
  
  const router = express.Router();
  const { botService, secretsService, logger } = routeServices;
  
  // Helper for async route handlers
  const asyncHandler = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

  // ============================================
  // BOT CRUD OPERATIONS
  // ============================================

  /**
   * GET /api/admin/bots
   * List all bots with optional filters
   */
  router.get('/', asyncHandler(async (req, res) => {
    if (!botService) {
      return res.status(503).json({ error: 'Bot service not available' });
    }

    const { platform, enabled } = req.query;
    const filter = {};
    
    if (platform) {
      filter[`platforms.${platform}.enabled`] = true;
    }
    if (enabled !== undefined) {
      filter.enabled = enabled === 'true';
    }

    const bots = await botService.listBots(filter);
    res.json({ success: true, data: bots });
  }));

  /**
   * POST /api/admin/bots
   * Create a new bot instance
   */
  router.post('/', asyncHandler(async (req, res) => {
    if (!botService) {
      return res.status(503).json({ error: 'Bot service not available' });
    }

    const { name, description } = req.body;
    
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Bot name is required' });
    }

    const bot = await botService.createBot({
      name: name.trim(),
      description: description?.trim() || ''
    });

    logger?.info?.(`[admin.bots] Created bot: ${bot.botId} (${bot.name})`);
    res.status(201).json({ success: true, data: bot });
  }));

  /**
   * GET /api/admin/bots/:botId
   * Get a specific bot by ID
   */
  router.get('/:botId', asyncHandler(async (req, res) => {
    if (!botService) {
      return res.status(503).json({ error: 'Bot service not available' });
    }

    const { botId } = req.params;
    const bot = await botService.getBot(botId);
    
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    res.json({ success: true, data: bot });
  }));

  /**
   * PUT /api/admin/bots/:botId
   * Update a bot's configuration
   */
  router.put('/:botId', asyncHandler(async (req, res) => {
    if (!botService) {
      return res.status(503).json({ error: 'Bot service not available' });
    }

    const { botId } = req.params;
    const updates = req.body;

    // Prevent updating immutable fields
    delete updates._id;
    delete updates.botId;
    delete updates.createdAt;

    const bot = await botService.updateBot(botId, updates);
    
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    logger?.info?.(`[admin.bots] Updated bot: ${botId}`);
    res.json({ success: true, data: bot });
  }));

  /**
   * DELETE /api/admin/bots/:botId
   * Delete a bot instance
   */
  router.delete('/:botId', asyncHandler(async (req, res) => {
    if (!botService) {
      return res.status(503).json({ error: 'Bot service not available' });
    }

    const { botId } = req.params;
    
    // Prevent deleting the default bot
    if (botId === 'default') {
      return res.status(400).json({ error: 'Cannot delete the default bot' });
    }

    const deleted = await botService.deleteBot(botId);
    
    if (!deleted) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    logger?.info?.(`[admin.bots] Deleted bot: ${botId}`);
    res.json({ success: true, message: 'Bot deleted' });
  }));

  /**
   * POST /api/admin/bots/:botId/sync-platforms
   * Sync platform configs from environment/secrets
   */
  router.post('/:botId/sync-platforms', asyncHandler(async (req, res) => {
    if (!botService) {
      return res.status(503).json({ error: 'Bot service not available' });
    }

    const { botId } = req.params;

    try {
      const bot = await botService.syncPlatformConfigsFromEnv(botId);
      logger?.info?.(`[admin.bots] Synced platform configs for bot: ${botId}`);
      res.json({ success: true, data: bot });
    } catch (err) {
      if (err.message === 'Bot not found') {
        return res.status(404).json({ error: 'Bot not found' });
      }
      throw err;
    }
  }));

  // ============================================
  // PLATFORM MANAGEMENT
  // ============================================

  /**
   * POST /api/admin/bots/:botId/platforms/:platform/enable
   * Enable a platform for a bot
   */
  router.post('/:botId/platforms/:platform/enable', asyncHandler(async (req, res) => {
    if (!botService) {
      return res.status(503).json({ error: 'Bot service not available' });
    }

    const { botId, platform } = req.params;
    const config = req.body || {};

    const bot = await botService.enablePlatform(botId, platform, config);
    
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    logger?.info?.(`[admin.bots] Enabled ${platform} for bot: ${botId}`);
    res.json({ success: true, data: bot });
  }));

  /**
   * POST /api/admin/bots/:botId/platforms/:platform/disable
   * Disable a platform for a bot
   */
  router.post('/:botId/platforms/:platform/disable', asyncHandler(async (req, res) => {
    if (!botService) {
      return res.status(503).json({ error: 'Bot service not available' });
    }

    const { botId, platform } = req.params;

    const bot = await botService.disablePlatform(botId, platform);
    
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    logger?.info?.(`[admin.bots] Disabled ${platform} for bot: ${botId}`);
    res.json({ success: true, data: bot });
  }));

  /**
   * PUT /api/admin/bots/:botId/platforms/:platform
   * Update platform configuration for a bot
   */
  router.put('/:botId/platforms/:platform', asyncHandler(async (req, res) => {
    if (!botService) {
      return res.status(503).json({ error: 'Bot service not available' });
    }

    const { botId, platform } = req.params;
    const config = req.body || {};

    const bot = await botService.getBot(botId);
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    // Merge config with existing platform config
    const platformConfig = bot.platforms?.[platform] || {};
    const updatedConfig = { ...platformConfig, ...config };

    const updatedBot = await botService.updateBot(botId, {
      [`platforms.${platform}`]: updatedConfig
    });

    logger?.info?.(`[admin.bots] Updated ${platform} config for bot: ${botId}`);
    res.json({ success: true, data: updatedBot });
  }));

  // ============================================
  // AVATAR MANAGEMENT
  // ============================================

  /**
   * GET /api/admin/bots/:botId/avatars
   * Get avatars assigned to a bot
   */
  router.get('/:botId/avatars', asyncHandler(async (req, res) => {
    if (!botService) {
      return res.status(503).json({ error: 'Bot service not available' });
    }

    const { botId } = req.params;
    const bot = await botService.getBot(botId);
    
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    // Get avatar details from the avatars collection
    const avatarIds = bot.avatars || [];
    const avatars = await db.collection('avatars')
      .find({ _id: { $in: avatarIds.map(id => typeof id === 'string' ? id : id) } })
      .project({ name: 1, emoji: 1, avatar: 1, model: 1, dynamicPersonality: 1 })
      .toArray();

    res.json({ success: true, data: avatars });
  }));

  /**
   * POST /api/admin/bots/:botId/avatars
   * Assign an avatar to a bot
   */
  router.post('/:botId/avatars', asyncHandler(async (req, res) => {
    if (!botService) {
      return res.status(503).json({ error: 'Bot service not available' });
    }

    const { botId } = req.params;
    const { avatarId } = req.body;

    if (!avatarId) {
      return res.status(400).json({ error: 'avatarId is required' });
    }

    const bot = await botService.assignAvatar(botId, avatarId);
    
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    logger?.info?.(`[admin.bots] Assigned avatar ${avatarId} to bot: ${botId}`);
    res.json({ success: true, data: bot });
  }));

  /**
   * DELETE /api/admin/bots/:botId/avatars/:avatarId
   * Remove an avatar from a bot
   */
  router.delete('/:botId/avatars/:avatarId', asyncHandler(async (req, res) => {
    if (!botService) {
      return res.status(503).json({ error: 'Bot service not available' });
    }

    const { botId, avatarId } = req.params;

    const bot = await botService.removeAvatar(botId, avatarId);
    
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    logger?.info?.(`[admin.bots] Removed avatar ${avatarId} from bot: ${botId}`);
    res.json({ success: true, data: bot });
  }));

  // ============================================
  // SECRETS MANAGEMENT
  // ============================================

  /**
   * GET /api/admin/bots/:botId/secrets
   * Get secrets for a bot (masked values)
   */
  router.get('/:botId/secrets', asyncHandler(async (req, res) => {
    if (!secretsService) {
      return res.status(503).json({ error: 'Secrets service not available' });
    }

    const { botId } = req.params;
    const { platform } = req.query;

    const filter = { botId };
    if (platform) {
      filter.platform = platform;
    }

    const secrets = await secretsService.listSecretsForScope('bot', botId, { platform });
    res.json({ success: true, data: secrets });
  }));

  /**
   * POST /api/admin/bots/:botId/secrets
   * Set a secret for a bot
   */
  router.post('/:botId/secrets', asyncHandler(async (req, res) => {
    if (!secretsService) {
      return res.status(503).json({ error: 'Secrets service not available' });
    }

    const { botId } = req.params;
    const { key, value, platform, description } = req.body;

    if (!key || !value) {
      return res.status(400).json({ error: 'key and value are required' });
    }

    await secretsService.set(key, value, { 
      botId,
      platform,
      description 
    });

    logger?.info?.(`[admin.bots] Set secret ${key} for bot: ${botId}`);
    res.json({ success: true, message: 'Secret saved' });
  }));

  /**
   * DELETE /api/admin/bots/:botId/secrets/:key
   * Delete a secret for a bot
   */
  router.delete('/:botId/secrets/:key', asyncHandler(async (req, res) => {
    if (!secretsService) {
      return res.status(503).json({ error: 'Secrets service not available' });
    }

    const { botId, key } = req.params;
    const { platform } = req.query;

    await secretsService.delete(key, { botId, platform });

    logger?.info?.(`[admin.bots] Deleted secret ${key} for bot: ${botId}`);
    res.json({ success: true, message: 'Secret deleted' });
  }));

  // ============================================
  // STATS & STATUS
  // ============================================

  /**
   * GET /api/admin/bots/:botId/stats
   * Get statistics for a bot
   */
  router.get('/:botId/stats', asyncHandler(async (req, res) => {
    if (!botService) {
      return res.status(503).json({ error: 'Bot service not available' });
    }

    const { botId } = req.params;
    const stats = await botService.getBotStats(botId);
    
    if (!stats) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    res.json({ success: true, data: stats });
  }));

  /**
   * GET /api/admin/bots/stats/summary
   * Get summary stats for all bots
   */
  router.get('/stats/summary', asyncHandler(async (req, res) => {
    if (!botService) {
      return res.status(503).json({ error: 'Bot service not available' });
    }

    const bots = await botService.listBots({});
    
    const summary = {
      totalBots: bots.length,
      enabledBots: bots.filter(b => b.enabled).length,
      platformCounts: {
        discord: bots.filter(b => b.platforms?.discord?.enabled).length,
        telegram: bots.filter(b => b.platforms?.telegram?.enabled).length,
        x: bots.filter(b => b.platforms?.x?.enabled).length
      },
      totalAvatars: bots.reduce((sum, b) => sum + (b.avatars?.length || 0), 0)
    };

    res.json({ success: true, data: summary });
  }));

  // ============================================
  // MIGRATION UTILITIES
  // ============================================

  /**
   * POST /api/admin/bots/migrate-legacy
   * Migrate legacy secrets to the default bot
   */
  router.post('/migrate-legacy', asyncHandler(async (req, res) => {
    if (!botService) {
      return res.status(503).json({ error: 'Bot service not available' });
    }

    const result = await botService.migrateLegacySecrets();
    
    logger?.info?.(`[admin.bots] Migrated legacy secrets: ${result.migrated} secrets`);
    res.json({ success: true, data: result });
  }));

  return router;
}
