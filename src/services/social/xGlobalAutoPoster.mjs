/**
 * Global X Auto Poster
 * Listens for internal media generation events and posts via XService.postGlobalMediaUpdate
 * when enabled. Uses GlobalBotService for intelligent, personality-driven posting.
 */
import eventBus from '../../utils/eventBus.mjs';

export function registerXGlobalAutoPoster({ xService, aiService, logger, databaseService, globalBotService }) {
  if (!xService) return;
  logger?.debug?.('[XGlobalAutoPoster] Initialising (DB-config governed)');
  const IMAGE_AUTOPOST_ENABLED = process.env.X_IMAGE_AUTOPOST_ENABLED === '1';

  const shouldSkipAutoPosting = async () => {
    try {
      if (typeof xService.getGlobalPostingMode !== 'function') return false;
      const mode = await xService.getGlobalPostingMode();
      return mode === 'tool';
    } catch (error) {
      logger?.warn?.('[XGlobalAutoPoster] Failed to determine posting mode:', error?.message || error);
      return false;
    }
  };

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
        'metadata.avatarId': avatarId,
        'metadata.type': type,
        createdAt: { $gte: cutoff }
      });
      
      return !!recent;
    } catch (e) {
      logger?.warn?.(`[XGlobalAutoPoster] deduplication check failed: ${e.message}`);
      return false;
    }
  };

  const imageHandler = async (payload) => {
    try {
      if (await shouldSkipAutoPosting()) {
        logger?.info?.('[XGlobalAutoPoster] Skipping image auto-post because mode=tool');
        return;
      }
      if (!payload?.imageUrl) return;
      
      // Skip if this is a keyframe/thumbnail for a video
      if (payload.isKeyframe || payload.isThumbnail || payload.type === 'keyframe' || payload.purpose === 'keyframe' || payload.purpose === 'thumbnail') {
        logger?.debug?.('[XGlobalAutoPoster] Skipping keyframe/thumbnail image');
        return;
      }
      
      logger?.debug?.('[XGlobalAutoPoster] evt MEDIA.IMAGE.GENERATED', { 
        imageUrl: payload.imageUrl,
        source: payload.source,
        purpose: payload.purpose,
        avatarName: payload.avatarName 
      });
      
      if (process.env.DEBUG_GLOBAL_X === '1') {
        logger?.debug?.('[XGlobalAutoPoster][diag] image event payload', { keys: Object.keys(payload||{}) });
      }
      
      // Check for recent posts about this avatar
      if (payload.avatarId && payload.source === 'avatar.create') {
        // Use GlobalBotService deduplication if available, otherwise fallback
        const shouldPost = globalBotService 
          ? await globalBotService.shouldPostAboutAvatar(String(payload.avatarId))
          : !(await isRecentlyPosted(String(payload.avatarId), 'introduction', 24));
        
        if (!shouldPost) {
          logger?.info?.(`[XGlobalAutoPoster] Skipping - avatar ${payload.avatarName} recently introduced`);
          return;
        }
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
          logger?.debug?.('[XGlobalAutoPoster] Generated content via GlobalBotService');
        } catch (err) {
          logger?.warn?.(`[XGlobalAutoPoster] GlobalBotService generation failed: ${err.message}`);
          // Fall through to default content generation in postGlobalMediaUpdate
        }
      }
      
      // Override text if we got a better version from GlobalBotService
      if (contentOverride) {
        enrichedPayload.text = contentOverride;
      }
      
      const result = await xService.postGlobalMediaUpdate(enrichedPayload, { aiService });
      
      // Record post in GlobalBotService memory
      if (result?.tweetId && globalBotService) {
        try {
          await globalBotService.recordPost(result.tweetId, enrichedPayload, contentOverride || enrichedPayload.text);
        } catch (err) {
          logger?.warn?.(`[XGlobalAutoPoster] Failed to record post in GlobalBotService: ${err.message}`);
        }
      }
    } catch (e) {
      logger?.warn?.(`[XGlobalAutoPoster] image post failed: ${e.message}`);
    }
  };

  const videoHandler = async (payload) => {
    try {
      if (await shouldSkipAutoPosting()) {
        logger?.info?.('[XGlobalAutoPoster] Skipping video auto-post because mode=tool');
        return;
      }
      if (!payload?.videoUrl) return;
      
      logger?.debug?.('[XGlobalAutoPoster] evt MEDIA.VIDEO.GENERATED', { 
        videoUrl: payload.videoUrl,
        source: payload.source,
        avatarName: payload.avatarName 
      });
      
      if (process.env.DEBUG_GLOBAL_X === '1') {
        logger?.debug?.('[XGlobalAutoPoster][diag] video event payload', { keys: Object.keys(payload||{}) });
      }
      
      // Check for recent posts about this avatar
      if (payload.avatarId && payload.source === 'avatar.create') {
        const shouldPost = globalBotService 
          ? await globalBotService.shouldPostAboutAvatar(String(payload.avatarId))
          : !(await isRecentlyPosted(String(payload.avatarId), 'introduction', 24));
        
        if (!shouldPost) {
          logger?.info?.(`[XGlobalAutoPoster] Skipping - avatar ${payload.avatarName} recently introduced`);
          return;
        }
      }
      
      // Enhanced payload with full context
      const enrichedPayload = {
        mediaUrl: payload.videoUrl,
        type: 'video',
        text: payload.context || payload.prompt || null,
        guildId: payload.guildId || payload.serverId || null,
        // NEW: Avatar context
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
          logger?.warn?.(`[XGlobalAutoPoster] GlobalBotService generation failed: ${err.message}`);
        }
      }
      
      if (contentOverride) {
        enrichedPayload.text = contentOverride;
      }
      
      const result = await xService.postGlobalMediaUpdate(enrichedPayload, { aiService });
      
      if (result?.tweetId && globalBotService) {
        try {
          await globalBotService.recordPost(result.tweetId, enrichedPayload, contentOverride || enrichedPayload.text);
        } catch (err) {
          logger?.warn?.(`[XGlobalAutoPoster] Failed to record post in GlobalBotService: ${err.message}`);
        }
      }
    } catch (e) {
      logger?.warn?.(`[XGlobalAutoPoster] video post failed: ${e.message}`);
    }
  };

  if (IMAGE_AUTOPOST_ENABLED) {
    eventBus.on('MEDIA.IMAGE.GENERATED', imageHandler);
  } else {
    logger?.info?.('[XGlobalAutoPoster] Image auto-posting disabled; MEDIA.IMAGE.GENERATED will be ignored');
  }
  eventBus.on('MEDIA.VIDEO.GENERATED', videoHandler);
}
export default registerXGlobalAutoPoster;
