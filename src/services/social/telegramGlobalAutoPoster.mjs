/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Global Telegram Auto Poster
 * Listens for internal media generation events and posts via TelegramService.postGlobalMediaUpdate
 * when enabled. Uses GlobalBotService for intelligent, personality-driven posting.
 */
import eventBus from '../../utils/eventBus.mjs';

export function registerTelegramGlobalAutoPoster({ telegramService, aiService, logger, databaseService, globalBotService }) {
  if (!telegramService) return;
  logger?.debug?.('[TelegramGlobalAutoPoster] Initialising (DB-config governed)');

  /**
   * Check if an avatar was recently posted about to prevent duplicates
   * @param {string} avatarId - Avatar ID to check
   * @param {string} type - Type of post (e.g., 'introduction')
   * @param {number} windowHours - Time window in hours (default 24)
   * @returns {Promise<boolean>} - True if recently posted
   */
  const isRecentlyPosted = async (avatarId, type = 'introduction', windowHours = 24) => {
    if (!avatarId || !databaseService) return false;
    try {
      const db = await databaseService.getDatabase();
      const windowMs = windowHours * 60 * 60 * 1000;
      const cutoff = new Date(Date.now() - windowMs);
      
      const recent = await db.collection('social_posts').findOne({
        global: true,
        platform: 'telegram',
        'metadata.avatarId': avatarId,
        'metadata.type': type,
        createdAt: { $gte: cutoff }
      });
      
      return !!recent;
    } catch (e) {
      logger?.warn?.(`[TelegramGlobalAutoPoster] deduplication check failed: ${e.message}`);
      return false;
    }
  };

  const imageHandler = async (payload) => {
    try {
      if (!payload?.imageUrl) return;
      
      // Skip if this is a keyframe/thumbnail for a video
      if (payload.isKeyframe || payload.isThumbnail || payload.type === 'keyframe') {
        logger?.debug?.('[TelegramGlobalAutoPoster] Skipping keyframe/thumbnail image');
        return;
      }
      
      logger?.info?.('[TelegramGlobalAutoPoster] evt MEDIA.IMAGE.GENERATED', { 
        imageUrl: payload.imageUrl,
        source: payload.source,
        avatarName: payload.avatarName 
      });
      
      if (process.env.DEBUG_GLOBAL_TELEGRAM === '1') {
        logger?.debug?.('[TelegramGlobalAutoPoster][diag] image event payload', { 
          keys: Object.keys(payload || {}) 
        });
      }
      
      // Check for recent posts about this avatar
      if (payload.avatarId && payload.source === 'avatar.create') {
        logger?.info?.('[TelegramGlobalAutoPoster] Avatar creation detected, checking deduplication');
        // Use GlobalBotService deduplication if available, otherwise fallback
        const shouldPost = globalBotService 
          ? await globalBotService.shouldPostAboutAvatar(String(payload.avatarId))
          : !(await isRecentlyPosted(String(payload.avatarId), 'introduction', 24));
        
        if (!shouldPost) {
          logger?.info?.(`[TelegramGlobalAutoPoster] Skipping - avatar ${payload.avatarName} recently introduced`);
          return;
        }
        logger?.info?.('[TelegramGlobalAutoPoster] Proceeding with avatar introduction post');
      }
      
      // Enhanced payload with full context
      const enrichedPayload = {
        mediaUrl: payload.imageUrl, 
        type: 'image', 
        text: payload.context || payload.prompt || null,
        guildId: payload.guildId || payload.serverId || null,
        // Avatar context for better AI generation
        avatarId: payload.avatarId || null,
        avatarName: payload.avatarName || null,
        avatarEmoji: payload.avatarEmoji || null,
        source: payload.source || 'media.generation',
        prompt: payload.prompt || null,
        createdAt: payload.createdAt || new Date()
      };
      
      // Use GlobalBotService for intelligent content generation if available
      let contentOverride = null;
      if (globalBotService) {
        try {
          contentOverride = await globalBotService.generateContextualPost(enrichedPayload);
          logger?.debug?.('[TelegramGlobalAutoPoster] Generated content via GlobalBotService');
        } catch (err) {
          logger?.warn?.(`[TelegramGlobalAutoPoster] GlobalBotService generation failed: ${err.message}`);
          // Fall through to default content generation in postGlobalMediaUpdate
        }
      }
      
      // Override text if we got a better version from GlobalBotService
      if (contentOverride) {
        enrichedPayload.text = contentOverride;
      }
      
      const result = await telegramService.postGlobalMediaUpdate(enrichedPayload, { aiService });
      
      // Record post in GlobalBotService memory
      if (result?.messageId && globalBotService) {
        try {
          await globalBotService.recordPost(
            `telegram_${result.messageId}`, 
            enrichedPayload, 
            contentOverride || enrichedPayload.text
          );
        } catch (err) {
          logger?.warn?.(`[TelegramGlobalAutoPoster] Failed to record post in GlobalBotService: ${err.message}`);
        }
      }
    } catch (e) {
      logger?.warn?.(`[TelegramGlobalAutoPoster] image post failed: ${e.message}`);
    }
  };

  const videoHandler = async (payload) => {
    try {
      if (!payload?.videoUrl) {
        logger?.warn?.('[TelegramGlobalAutoPoster] Video event received but no videoUrl in payload');
        return;
      }
      
      logger?.info?.('[TelegramGlobalAutoPoster] evt MEDIA.VIDEO.GENERATED', { 
        videoUrl: payload.videoUrl,
        source: payload.source,
        avatarName: payload.avatarName 
      });
      
      if (process.env.DEBUG_GLOBAL_TELEGRAM === '1') {
        logger?.debug?.('[TelegramGlobalAutoPoster][diag] video event payload', { 
          keys: Object.keys(payload || {}) 
        });
      }
      
      // Check for recent posts about this avatar
      if (payload.avatarId && payload.source === 'avatar.create') {
        const shouldPost = globalBotService 
          ? await globalBotService.shouldPostAboutAvatar(String(payload.avatarId))
          : !(await isRecentlyPosted(String(payload.avatarId), 'introduction', 24));
        
        if (!shouldPost) {
          logger?.info?.(`[TelegramGlobalAutoPoster] Skipping - avatar ${payload.avatarName} recently introduced`);
          return;
        }
      }
      
      // Enhanced payload with full context
      const enrichedPayload = {
        mediaUrl: payload.videoUrl,
        type: 'video',
        text: payload.context || payload.prompt || null,
        guildId: payload.guildId || payload.serverId || null,
        // Avatar context
        avatarId: payload.avatarId || null,
        avatarName: payload.avatarName || null,
        avatarEmoji: payload.avatarEmoji || null,
        source: payload.source || 'media.generation',
        prompt: payload.prompt || null,
        createdAt: payload.createdAt || new Date()
      };
      
      // Use GlobalBotService for content if available
      let contentOverride = null;
      if (globalBotService) {
        try {
          contentOverride = await globalBotService.generateContextualPost(enrichedPayload);
        } catch (err) {
          logger?.warn?.(`[TelegramGlobalAutoPoster] GlobalBotService generation failed: ${err.message}`);
        }
      }
      
      if (contentOverride) {
        enrichedPayload.text = contentOverride;
      }
      
      const result = await telegramService.postGlobalMediaUpdate(enrichedPayload, { aiService });
      
      if (result?.messageId && globalBotService) {
        try {
          await globalBotService.recordPost(
            `telegram_${result.messageId}`, 
            enrichedPayload, 
            contentOverride || enrichedPayload.text
          );
        } catch (err) {
          logger?.warn?.(`[TelegramGlobalAutoPoster] Failed to record post in GlobalBotService: ${err.message}`);
        }
      }
    } catch (e) {
      logger?.warn?.(`[TelegramGlobalAutoPoster] video post failed: ${e.message}`);
    }
  };

  eventBus.on('MEDIA.IMAGE.GENERATED', imageHandler);
  eventBus.on('MEDIA.VIDEO.GENERATED', videoHandler);
}

export default registerTelegramGlobalAutoPoster;
