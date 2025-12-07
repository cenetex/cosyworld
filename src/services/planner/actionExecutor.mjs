/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file src/services/planner/actionExecutor.mjs
 * @description Base ActionExecutor class and concrete executors for plan actions.
 *              Part of Phase 2 refactoring to extract action execution logic.
 */

/**
 * @typedef {Object} ActionContext
 * @property {Object} ctx - Telegram context
 * @property {string} channelId - Channel ID
 * @property {string} userId - User ID
 * @property {string} username - Username
 * @property {string} conversationContext - Conversation context
 * @property {Object} services - Service dependencies
 * @property {Object} logger - Logger instance
 */

/**
 * @typedef {Object} ActionResult
 * @property {boolean} success - Whether the action succeeded
 * @property {string} action - Action type
 * @property {number} stepNum - Step number
 * @property {string} [mediaId] - Generated media ID if applicable
 * @property {string} [error] - Error message if failed
 * @property {number} [durationMs] - Execution duration
 */

/**
 * Base class for action executors
 * @abstract
 */
export class ActionExecutor {
  /**
   * @param {string} actionType - The action type this executor handles
   */
  constructor(actionType) {
    this.actionType = actionType;
  }

  /**
   * Check if this executor can handle the given action
   * @param {string} action - Action type to check
   * @returns {boolean}
   */
  canHandle(action) {
    return action?.toLowerCase() === this.actionType;
  }

  /**
   * Execute the action
   * @abstract
   * @param {Object} _step - Step definition
   * @param {ActionContext} _context - Execution context
   * @returns {Promise<ActionResult>}
   */
  async execute(_step, _context) {
    throw new Error('ActionExecutor.execute() must be implemented by subclass');
  }

  /**
   * Get timeout for this action type (ms)
   * @returns {number}
   */
  getTimeout() {
    return 120000; // 2 minutes default
  }
}

/**
 * Executor for generate_image action
 */
export class GenerateImageExecutor extends ActionExecutor {
  constructor() {
    super('generate_image');
  }

  getTimeout() {
    return 120000; // 2 minutes
  }

  async execute(step, context) {
    const { ctx, conversationContext, userId, username, services, stepNum } = context;
    
    // Extract aspectRatio from step if specified, default to square
    const options = {
      aspectRatio: step.aspectRatio || '1:1'
    };
    
    const record = await services.telegram.executeImageGeneration(
      ctx, step.description, conversationContext, userId, username, options
    );
    
    if (record) {
      return { success: true, action: this.actionType, stepNum, mediaId: record.id };
    }
    return { success: false, action: this.actionType, stepNum };
  }
}

/**
 * Executor for generate_keyframe action
 */
export class GenerateKeyframeExecutor extends ActionExecutor {
  constructor() {
    super('generate_keyframe');
  }

  getTimeout() {
    return 120000; // 2 minutes
  }

  async execute(step, context) {
    const { ctx, conversationContext, userId, username, services, stepNum, logger } = context;
    
    // Keyframes typically use 16:9 for video compatibility, unless specified
    const options = {
      aspectRatio: step.aspectRatio || '16:9'
    };
    
    const record = await services.telegram.executeImageGeneration(
      ctx, step.description, conversationContext, userId, username, options
    );
    
    if (record) {
      // Mark as keyframe in database
      try {
        if (services.database) {
          const db = await services.database.getDatabase();
          await db.collection('telegram_recent_media').updateOne(
            { channelId: record.channelId, id: record.id },
            { $set: { type: 'keyframe', source: 'telegram.generate_keyframe' } }
          );
        }
      } catch (err) {
        logger?.warn?.('[GenerateKeyframeExecutor] Failed to mark media as keyframe:', err.message);
      }
      return { success: true, action: this.actionType, stepNum, mediaId: record.id };
    }
    return { success: false, action: this.actionType, stepNum };
  }
}

/**
 * Executor for edit_image action
 */
export class EditImageExecutor extends ActionExecutor {
  constructor() {
    super('edit_image');
  }

  getTimeout() {
    return 120000; // 2 minutes
  }

  async execute(step, context) {
    const { ctx, conversationContext, userId, username, services, stepNum, latestMediaId } = context;
    
    const sourceMediaId = step.sourceMediaId || latestMediaId;
    if (!sourceMediaId) {
      await ctx.reply('I need an image to edit first! Generate one or provide a reference.');
      return { success: false, action: this.actionType, stepNum, error: 'No source image' };
    }
    
    const record = await services.telegram.executeImageEdit(ctx, {
      prompt: step.description,
      sourceMediaId,
      conversationContext,
      userId,
      username
    });
    
    if (record) {
      return { success: true, action: this.actionType, stepNum, mediaId: record.id };
    }
    return { success: false, action: this.actionType, stepNum };
  }
}

/**
 * Executor for generate_video action
 */
export class GenerateVideoExecutor extends ActionExecutor {
  constructor() {
    super('generate_video');
  }

  getTimeout() {
    return 300000; // 5 minutes
  }

  async execute(step, context) {
    const { ctx, conversationContext, userId, username, services, stepNum, latestMediaId } = context;
    
    const referenceMediaIds = Array.isArray(step.referenceMediaIds)
      ? step.referenceMediaIds.filter(Boolean)
      : [];

    // Video typically uses 9:16 (vertical) for social media, unless specified
    const options = {
      aspectRatio: step.aspectRatio || '9:16',
      style: step.style,
      camera: step.camera,
      negativePrompt: step.negativePrompt,
      referenceMediaIds,
      fallbackReferenceMediaId: referenceMediaIds.length ? null : latestMediaId
    };
    
    const record = await services.telegram.executeVideoGeneration(
      ctx, step.description, conversationContext, userId, username, options
    );
    
    if (record) {
      return { success: true, action: this.actionType, stepNum, mediaId: record.id };
    }
    return { success: false, action: this.actionType, stepNum };
  }
}

/**
 * Executor for generate_video_from_image action
 */
export class GenerateVideoFromImageExecutor extends ActionExecutor {
  constructor() {
    super('generate_video_from_image');
  }

  getTimeout() {
    return 300000; // 5 minutes
  }

  async execute(step, context) {
    const { ctx, conversationContext, userId, username, services, stepNum, latestMediaId } = context;
    
    // Video typically uses 9:16 (vertical) for social media, unless specified
    const options = {
      aspectRatio: step.aspectRatio || '9:16'
    };
    
    const sourceMediaId = step.sourceMediaId || latestMediaId;
    
    if (!sourceMediaId) {
      // Fall back to text-to-video
      const record = await services.telegram.executeVideoGeneration(
        ctx, step.description, conversationContext, userId, username, options
      );
      if (record) {
        return { success: true, action: this.actionType, stepNum, mediaId: record.id };
      }
      return { success: false, action: this.actionType, stepNum };
    }
    
    // Generate video from source image using mediaManager and mediaGenerationManager
    const channelId = context.channelId || String(ctx.chat.id);
    const telegram = services.telegram;
    
    // Get the source image
    const sourceMedia = await telegram.mediaManager.getMediaById(channelId, sourceMediaId);
    if (!sourceMedia?.mediaUrl) {
      await ctx.reply('❌ Could not find the source image for video generation.');
      return { success: false, action: this.actionType, stepNum, error: 'source_image_not_found' };
    }
    
    // Generate video from image
    const videoUrls = await telegram.mediaGenerationManager.generateVideoFromImage({
      prompt: step.description,
      imageUrl: sourceMedia.mediaUrl,
      config: { aspectRatio: options.aspectRatio, durationSeconds: 8 }
    });
    
    const videoUrl = videoUrls[0];
    const sentMessage = await ctx.telegram.sendVideo(ctx.chat.id, videoUrl, {
      caption: '🎬 Here is your video!',
      supports_streaming: true
    });
    
    await telegram.memberManager.recordBotResponse(channelId, userId);
    if (userId && username) await telegram._recordMediaUsage(userId, username, 'video');
    
    const record = await telegram._rememberGeneratedMedia(channelId, {
      type: 'video',
      mediaUrl: videoUrl,
      prompt: step.description,
      messageId: sentMessage?.message_id,
      userId,
      source: 'telegram.generate_video_from_image',
      toolingState: { 
        originalPrompt: step.description, 
        aspectRatio: options.aspectRatio,
        sourceMediaId,
        sourceImageUrl: sourceMedia.mediaUrl
      },
      metadata: { requestedBy: userId }
    });
    
    if (record) {
      return { success: true, action: this.actionType, stepNum, mediaId: record.id };
    }
    return { success: false, action: this.actionType, stepNum };
  }
}

/**
 * Executor for extend_video action
 */
export class ExtendVideoExecutor extends ActionExecutor {
  constructor() {
    super('extend_video');
  }

  getTimeout() {
    return 300000; // 5 minutes
  }

  async execute(step, context) {
    const { ctx, conversationContext, userId, username, services, stepNum, latestMediaId } = context;
    
    const sourceMediaId = step.sourceMediaId || latestMediaId;
    if (!sourceMediaId) {
      await ctx.reply('I need a video to extend! Generate one first.');
      return { success: false, action: this.actionType, stepNum, error: 'No source video' };
    }
    
    const record = await services.telegram.executeVideoExtension(ctx, {
      prompt: step.description,
      sourceMediaId,
      conversationContext,
      userId,
      username
    });
    
    if (record) {
      return { success: true, action: this.actionType, stepNum, mediaId: record.id };
    }
    return { success: false, action: this.actionType, stepNum };
  }
}

/**
 * Executor for speak action
 */
export class SpeakExecutor extends ActionExecutor {
  constructor() {
    super('speak');
  }

  getTimeout() {
    return 60000; // 60 seconds - AI responses can be slow under load
  }

  async execute(step, context) {
    const { ctx, channelId, conversationContext, userId, services, stepNum } = context;

    // Check for recent bot messages to avoid double-speaking
    try {
      const history = services.telegram.conversationManager.getHistory(channelId);
      if (history && history.length > 0) {
        const lastMsg = history[history.length - 1];
        const now = Date.now();
        // Check if last message is from Bot and is very recent (< 5 seconds)
        // Note: message dates are often in seconds, so we need to be careful with comparison
        const msgTimeMs = (lastMsg.date > 1e10) ? lastMsg.date : lastMsg.date * 1000;
        
        const isMediaMarker = lastMsg.text && (
            lastMsg.text.startsWith('[Generated Image:') || 
            lastMsg.text.startsWith('[Generated Video:')
        );
        
        if (lastMsg.isBot && (now - msgTimeMs) < 5000 && !isMediaMarker) {
           services.logger?.info?.(`[SpeakExecutor] Skipping speak action - bot just spoke at ${new Date(msgTimeMs).toISOString()}`);
           return { success: true, action: this.actionType, stepNum, skipped: true };
        }
      }
    } catch (err) {
      services.logger?.warn?.('[SpeakExecutor] Failed to check history:', err);
    }
    
    const speechPrompt = `You are executing a planned action.
Context: ${conversationContext}
Action Description: ${step.description}

Write the message you should send to the user now to fulfill this action. Keep it natural, brief, and in character.`;

    const response = await services.ai.chat([
      { role: 'user', content: speechPrompt }
    ], {
      model: services.globalBot?.bot?.model || 'anthropic/claude-sonnet-4.5',
      temperature: 0.7
    });
    
    const text = String(response || '').trim().replace(/^["']|["']$/g, '');
    if (text) {
      await ctx.reply(services.telegram._formatTelegramMarkdown(text), { parse_mode: 'HTML' });
      await services.telegram._recordBotResponse(channelId, userId);
    }
    
    return { success: true, action: this.actionType, stepNum };
  }
}

/**
 * Executor for post_tweet action
 */
export class PostTweetExecutor extends ActionExecutor {
  constructor() {
    super('post_tweet');
  }

  getTimeout() {
    return 60000; // 1 minute
  }

  async execute(step, context) {
    const { ctx, channelId, conversationContext, userId, username, services, stepNum, latestMediaId, generationFailed, logger } = context;
    
    if (generationFailed) {
      await ctx.reply('Skipping X post because the media generation failed.');
      return { success: false, action: this.actionType, stepNum, error: 'Prior media generation failed' };
    }

    let mediaIdToTweet = latestMediaId;
    
    // If no explicit media ID, try semantic search based on step description
    if (!mediaIdToTweet && step.description && services.telegram._findBestMediaForTweet) {
      try {
        const matched = await services.telegram._findBestMediaForTweet(channelId, step.description);
        if (matched) {
          mediaIdToTweet = matched.id;
          logger?.info?.('[PostTweetExecutor] Found content-matched media', { 
            mediaId: mediaIdToTweet, 
            description: step.description.substring(0, 50) 
          });
        }
      } catch (err) {
        logger?.debug?.('[PostTweetExecutor] Semantic search failed, falling back:', err?.message);
      }
    }
    
    // Fallback to most recent media
    if (!mediaIdToTweet) {
      const recent = await services.telegram._getRecentMedia(channelId, 1);
      if (recent && recent.length > 0) mediaIdToTweet = recent[0].id;
    }

    if (!mediaIdToTweet) {
      logger?.warn?.('[PostTweetExecutor] Cannot post_tweet: no recent media found');
      await ctx.reply('I wanted to post to X, but I couldn\'t find the image/video I just made! 🕵️‍♀️');
      return { success: false, action: this.actionType, stepNum, error: 'No media found' };
    }

    let tweetText = step.description;
    try {
      const tweetPrompt = `You are managing a social media account for a character in CosyWorld.
Context: ${conversationContext}
Task: ${step.description}

Write a creative, engaging tweet caption (under 280 chars) to accompany the media you just generated.
- Be in character (witty, slightly chaotic, or helpful depending on the persona).
- Do not use quotation marks.
- Do not include "Here is the tweet:" or similar prefixes.
- Make it sound like a real tweet, not a bot command.`;

      const response = await services.ai.chat([
        { role: 'user', content: tweetPrompt }
      ], {
        model: services.globalBot?.bot?.model || 'anthropic/claude-sonnet-4.5',
        temperature: 0.8
      });
      
      const generatedTweet = String(response || '').trim().replace(/^["']|["']$/g, '');
      if (generatedTweet) {
        tweetText = generatedTweet;
      }
    } catch (err) {
      logger?.warn?.('[PostTweetExecutor] Failed to generate tweet caption, falling back to description:', err);
    }

    const tweetResult = await services.telegram.executeTweetPost(ctx, {
      text: tweetText,
      mediaId: mediaIdToTweet,
      channelId,
      userId,
      username
    });
    
    // Check the result from executeTweetPost
    if (!tweetResult?.success) {
      const error = tweetResult?.error || 'Tweet post failed';
      logger?.warn?.('[PostTweetExecutor] Tweet failed:', { error, alreadyTweeted: tweetResult?.alreadyTweeted });
      return { 
        success: false, 
        action: this.actionType, 
        stepNum, 
        error,
        alreadyTweeted: tweetResult?.alreadyTweeted 
      };
    }
    
    return { 
      success: true, 
      action: this.actionType, 
      stepNum, 
      mediaId: mediaIdToTweet,
      tweetId: tweetResult.tweetId,
      tweetUrl: tweetResult.tweetUrl
    };
  }
}

/**
 * Executor for research action (no-op acknowledgment)
 */
export class ResearchExecutor extends ActionExecutor {
  constructor() {
    super('research');
  }

  getTimeout() {
    return 30000; // 30 seconds
  }

  async execute(step, context) {
    // Research is an acknowledgment action - just mark as success
    return { success: true, action: this.actionType, stepNum: context.stepNum };
  }
}

/**
 * Executor for wait action (no-op acknowledgment)
 */
export class WaitExecutor extends ActionExecutor {
  constructor() {
    super('wait');
  }

  getTimeout() {
    return 5000; // 5 seconds
  }

  async execute(step, context) {
    // Wait is an acknowledgment action - just mark as success
    return { success: true, action: this.actionType, stepNum: context.stepNum };
  }
}

/**
 * Executor for react_to_message action
 */
export class ReactToMessageExecutor extends ActionExecutor {
  constructor() {
    super('react_to_message');
  }

  getTimeout() {
    return 10000; // 10 seconds
  }

  async execute(step, context) {
    const { ctx, services, stepNum } = context;
    
    // Extract emoji from description if possible, or default to 👍
    // The description usually contains "React with [emoji]" or just the emoji
    let emoji = '👍';
    const emojiMatch = step.description?.match(/(\p{Emoji_Presentation}|\p{Extended_Pictographic})/u);
    if (emojiMatch) {
      emoji = emojiMatch[0];
    }

    await services.telegram.executeReaction(ctx, emoji);
    return { success: true, action: this.actionType, stepNum };
  }
}

/**
 * Registry of all available action executors
 */
export class ActionExecutorRegistry {
  constructor() {
    this.executors = new Map();
    this._registerDefaultExecutors();
  }

  /**
   * Register default executors
   * @private
   */
  _registerDefaultExecutors() {
    this.register(new GenerateImageExecutor());
    this.register(new GenerateKeyframeExecutor());
    this.register(new EditImageExecutor());
    this.register(new GenerateVideoExecutor());
    this.register(new GenerateVideoFromImageExecutor());
    this.register(new ExtendVideoExecutor());
    this.register(new SpeakExecutor());
    this.register(new PostTweetExecutor());
    this.register(new ResearchExecutor());
    this.register(new WaitExecutor());
    this.register(new ReactToMessageExecutor());
  }

  /**
   * Register an executor
   * @param {ActionExecutor} executor
   */
  register(executor) {
    this.executors.set(executor.actionType, executor);
  }

  /**
   * Get executor for action type
   * @param {string} action
   * @returns {ActionExecutor|null}
   */
  get(action) {
    return this.executors.get(action?.toLowerCase()) || null;
  }

  /**
   * Check if action is supported
   * @param {string} action
   * @returns {boolean}
   */
  isSupported(action) {
    return this.executors.has(action?.toLowerCase());
  }

  /**
   * Get all supported action types
   * @returns {string[]}
   */
  getSupportedActions() {
    return Array.from(this.executors.keys());
  }
}

// Export singleton registry instance
export const actionExecutorRegistry = new ActionExecutorRegistry();

export default ActionExecutor;
