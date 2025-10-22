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
      
      // Skip if this is a keyframe/thumbnail for a video, or a location image
      if (payload.isKeyframe || payload.isThumbnail || payload.type === 'keyframe' || payload.purpose === 'keyframe' || payload.purpose === 'thumbnail') {
        logger?.debug?.('[TelegramGlobalAutoPoster] Skipping keyframe/thumbnail image');
        return;
      }
      
      // NEW: Be more selective - only post avatar introductions and combat posters
      // Skip general scene photos and other random images to reduce spam
      const allowedSources = ['avatar.create', 'combat.poster', 'combat.summary'];
      if (!allowedSources.includes(payload.source)) {
        logger?.debug?.(`[TelegramGlobalAutoPoster] Skipping image - source "${payload.source}" not in whitelist. Only posting: ${allowedSources.join(', ')}`);
        return;
      }
      
      logger?.info?.('[TelegramGlobalAutoPoster] evt MEDIA.IMAGE.GENERATED', { 
        imageUrl: payload.imageUrl,
        source: payload.source,
        purpose: payload.purpose,
        avatarName: payload.avatarName 
      });
      
      if (process.env.DEBUG_GLOBAL_TELEGRAM === '1') {
        logger?.debug?.('[TelegramGlobalAutoPoster][diag] image event payload', { 
          keys: Object.keys(payload || {}) 
        });
      }
      
      // NEW: Read the room before posting
      const roomCheck = await readTheRoom(databaseService, logger);
      if (!roomCheck) {
        logger?.info?.('[TelegramGlobalAutoPoster] Reading the room: skipping image post due to recent activity');
        return;
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
        // Location context for new location posts
        locationName: payload.locationName || null,
        locationDescription: payload.locationDescription || null,
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
      
      // NEW: Read the room before posting video
      const roomCheck = await readTheRoom(databaseService, logger);
      if (!roomCheck) {
        logger?.info?.('[TelegramGlobalAutoPoster] Reading the room: skipping video post due to recent activity');
        return;
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

  // NEW: Listen for X/Twitter posts to share them in Telegram
  const xPostHandler = async (payload) => {
    try {
      if (!payload?.tweetUrl || !payload?.content) {
        logger?.debug?.('[TelegramGlobalAutoPoster] X post event missing required fields');
        return;
      }
      
      logger?.info?.('[TelegramGlobalAutoPoster] evt X.POST.CREATED', {
        tweetUrl: payload.tweetUrl,
        tweetId: payload.tweetId,
        avatarName: payload.avatarName
      });
      
      // Check if this is a global post (not a personal avatar post)
      if (!payload.global) {
        logger?.debug?.('[TelegramGlobalAutoPoster] Skipping non-global X post');
        return;
      }
      
      // Read the room: check recent telegram activity before cross-posting
      const shouldPost = await readTheRoom(databaseService, logger);
      if (!shouldPost) {
        logger?.info?.('[TelegramGlobalAutoPoster] Reading the room: too much recent activity, skipping X post');
        return;
      }
      
      // Build enriched payload for Telegram
      // X posts should be shared with no caption, just the link for preview
      const enrichedPayload = {
        type: 'tweet',
        text: payload.tweetUrl, // Just the URL, no caption
        tweetUrl: payload.tweetUrl,
        tweetId: payload.tweetId,
        imageUrl: payload.imageUrl || null,
        videoUrl: payload.videoUrl || null,
        avatarId: payload.avatarId || null,
        avatarName: payload.avatarName || null,
        avatarEmoji: payload.avatarEmoji || null,
        source: 'x.post',
        createdAt: new Date()
      };
      
      // Post to Telegram (using media if available, otherwise text-only)
      const result = await telegramService.postGlobalMediaUpdate(enrichedPayload, { aiService });
      
      // Record in GlobalBotService
      if (result?.messageId && globalBotService) {
        try {
          await globalBotService.recordPost(
            `telegram_x_${payload.tweetId}`,
            enrichedPayload,
            enrichedPayload.text
          );
        } catch (err) {
          logger?.warn?.(`[TelegramGlobalAutoPoster] Failed to record X post in GlobalBotService: ${err.message}`);
        }
      }
      
      logger?.info?.('[TelegramGlobalAutoPoster] Successfully cross-posted X tweet to Telegram');
    } catch (e) {
      logger?.warn?.(`[TelegramGlobalAutoPoster] X post handler failed: ${e.message}`);
    }
  };

  eventBus.on('MEDIA.IMAGE.GENERATED', imageHandler);
  eventBus.on('MEDIA.VIDEO.GENERATED', videoHandler);
  eventBus.on('X.POST.CREATED', xPostHandler); // NEW: Listen for X posts
}

/**
 * Read the room - check if we should post based on recent activity
 * Returns false if there's been too much posting recently
 * @param {Object} databaseService - Database service
 * @param {Object} logger - Logger instance
 * @returns {Promise<boolean>} - True if we should post
 */
async function readTheRoom(databaseService, logger) {
  try {
    const db = await databaseService.getDatabase();
    
    // Check how many posts we've made in the last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentPostCount = await db.collection('social_posts').countDocuments({
      global: true,
      platform: 'telegram',
      createdAt: { $gte: oneHourAgo }
    });
    
    // If we've posted more than 3 times in the last hour, slow down
    if (recentPostCount >= 3) {
      logger?.debug?.(`[TelegramGlobalAutoPoster] Reading the room: ${recentPostCount} posts in last hour, slowing down`);
      return false;
    }
    
    // Check the last post time - don't post if last post was less than 10 minutes ago
    const lastPost = await db.collection('social_posts')
      .findOne(
        { global: true, platform: 'telegram' },
        { sort: { createdAt: -1 } }
      );
    
    if (lastPost) {
      const minutesSinceLastPost = (Date.now() - lastPost.createdAt.getTime()) / (1000 * 60);
      if (minutesSinceLastPost < 10) {
        logger?.debug?.(`[TelegramGlobalAutoPoster] Reading the room: last post was ${minutesSinceLastPost.toFixed(1)} minutes ago, waiting`);
        return false;
      }
    }
    
    return true;
  } catch (e) {
    logger?.warn?.(`[TelegramGlobalAutoPoster] readTheRoom check failed: ${e.message}`);
    return true; // Fail open
  }
}

export default registerTelegramGlobalAutoPoster;
