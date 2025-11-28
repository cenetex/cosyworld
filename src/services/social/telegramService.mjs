/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Telegram Bot Service
 * Provides utilities for managing Telegram bot integration
 * Supports both global bot and per-avatar bots
 * 
 * PERFORMANCE OPTIMIZATIONS (Oct 2025):
 * - Database indexes on all collections for faster queries
 * - TTL-based caching for bot persona (5min) and buybot context (1min)
 * - Parallel database queries using Promise.all (saves 500-1000ms)
 * - Typing indicators for better perceived performance
 * - Non-blocking conversation history loading
 * - Background database writes (no await on saves)
 * 
 * Expected performance: <2s for simple replies, <5s for complex interactions
 */

import { Telegraf } from 'telegraf';
import { randomUUID } from 'crypto';
import { encrypt } from '../../utils/encryption.mjs';
import { setupBuybotTelegramCommands } from '../commands/buybotTelegramHandler.mjs';
import { MediaGenerationError, RateLimitError, ServiceUnavailableError } from '../../utils/errors.mjs';
import { PlanExecutionService } from '../planner/planExecutionService.mjs';
import { actionExecutorRegistry } from '../planner/actionExecutor.mjs';
import eventBus from '../../utils/eventBus.mjs';
import { generateTraceId } from '../../utils/tracing.mjs';

// Import refactored modules
import {
  // Constants
  CACHE_CONFIG,
  CONVERSATION_CONFIG,
  REPLY_DELAY_CONFIG,
  MEDIA_LIMITS,
  MEDIA_CONFIG,
  PLAN_CONFIG,
  // Utilities
  safeDecrypt,
  formatTelegramMarkdown,
  inferMimeTypeFromUrl,
  generateRequestId,
  includesMention,
  buildCreditInfo,
  // Managers
  CacheManager,
  MemberManager,
  MediaManager,
  MediaGenerationManager,
  PlanManager,
  ConversationManager,
  ContextManager,
  InteractionManager,
  // Tool definitions
  getActionIcon,
  getActionLabel,
  logPlanSummary,
} from './telegram/index.mjs';

const VIDEO_DEFAULTS = Object.freeze({
  STYLE: 'cinematic',
  CAMERA: 'wide tracking shot'
});

const MAX_REFERENCE_IMAGES = 3;
const VIDEO_LOCK_TIMEOUT_MS = 6 * 60 * 1000; // 6 minutes to cover Veo's SLA

class TelegramService {
  constructor({
    logger,
    databaseService,
    configService,
    secretsService,
    aiService,
    globalBotService,
    googleAIService,
    veoService,
    buybotService,
    xService,
    mediaGenerationService,
    mediaIndexService,
  }) {
    this.logger = logger;
    this.databaseService = databaseService;
    this.configService = configService;
    this.secretsService = secretsService;
    this.aiService = aiService;
    this.globalBotService = globalBotService;
    this.googleAIService = googleAIService;
    this.veoService = veoService;
    this.buybotService = buybotService;
    this.xService = xService;
    this.mediaGenerationService = mediaGenerationService;
    this.mediaIndexService = mediaIndexService;
    this.bots = new Map(); // avatarId -> Telegraf instance
    this.globalBot = null;
    
    // Initialize the CacheManager for centralized cache handling
    this.cacheManager = new CacheManager({ logger: this.logger });
    
    // Initialize MemberManager for member tracking and spam prevention
    this.memberManager = new MemberManager({
      logger: this.logger,
      databaseService: this.databaseService,
      cacheManager: this.cacheManager,
    });

    // Initialize ConversationManager for history and active tracking
    this.conversationManager = new ConversationManager({
      logger: this.logger,
      databaseService: this.databaseService,
      cacheManager: this.cacheManager,
    });
    
    // Initialize MediaManager for media storage and retrieval
    this.mediaManager = new MediaManager({
      logger: this.logger,
      databaseService: this.databaseService,
      cacheManager: this.cacheManager,
      mediaIndexService: this.mediaIndexService,
    });

    // Initialize PlanManager for agent plan storage and retrieval
    this.planManager = new PlanManager({
      logger: this.logger,
      databaseService: this.databaseService,
      cacheManager: this.cacheManager,
    });

    // Initialize MediaGenerationManager for media creation logic
    this.mediaGenerationManager = new MediaGenerationManager({
      logger: this.logger,
      aiService: this.aiService,
      googleAIService: this.googleAIService,
      veoService: this.veoService,
      mediaGenerationService: this.mediaGenerationService,
      globalBotService: this.globalBotService
    });
    
    // Initialize ContextManager for persona and buybot context
    this.contextManager = new ContextManager({
      logger: this.logger,
      databaseService: this.databaseService,
      globalBotService: this.globalBotService,
      buybotService: this.buybotService,
      cacheManager: this.cacheManager,
    });
    
    // Backwards compatibility: expose cache data structures through cacheManager
    // These will be deprecated in a future version
    this.pendingReplies = this.cacheManager.pendingReplies;
    this.recentMediaByChannel = this.cacheManager.recentMediaByChannel;
    this.agentPlansByChannel = this.cacheManager.agentPlansByChannel;
    this.telegramSpamTracker = this.cacheManager.spamTracker;
    this._memberCache = this.cacheManager.memberCache;

    this._debounceLocks = this.cacheManager.debounceLocks;
    this._serviceExhausted = this.cacheManager.serviceExhausted;
    
    // Use constants from modules
    this.REPLY_DELAY_MS = REPLY_DELAY_CONFIG.DEFAULT_MS;
    this.HISTORY_LIMIT = CONVERSATION_CONFIG.HISTORY_LIMIT;
    this.mediaGenerationLimits = MEDIA_LIMITS;

    this.BUYBOT_CACHE_TTL = CACHE_CONFIG.BUYBOT_TTL_MS;
    this.REPLY_DELAY_CONFIG = {
      mentioned: REPLY_DELAY_CONFIG.MENTIONED_MS,
      default: REPLY_DELAY_CONFIG.DEFAULT_MS
    };
    this.MEMBER_CACHE_TTL = CACHE_CONFIG.MEMBER_TTL_MS;
    this.RECENT_MEDIA_LIMIT = MEDIA_CONFIG.RECENT_LIMIT;
    this.RECENT_MEDIA_MAX_AGE_MS = MEDIA_CONFIG.MAX_AGE_MS;
    this.MEDIA_ID_PREFIX_MIN_LENGTH = MEDIA_CONFIG.ID_PREFIX_MIN_LENGTH;
    this.AGENT_PLAN_LIMIT = PLAN_CONFIG.LIMIT;
    this.AGENT_PLAN_MAX_AGE_MS = PLAN_CONFIG.MAX_AGE_MS;
    
    // Phase 2: Initialize PlanExecutionService for refactored plan execution
    this.planExecutionService = new PlanExecutionService({
      logger: this.logger,
      executorRegistry: actionExecutorRegistry
    });
    
    // Flag to use new plan execution service (can be toggled for gradual rollout)
    this.USE_PLAN_EXECUTION_SERVICE = true;
    
    // Async video generation: queue jobs instead of blocking the handler
    // Enable this if video generation frequently causes timeout errors
    const asyncVideoEnv = (process.env.TELEGRAM_ASYNC_VIDEO ?? 'true').toString().toLowerCase();
    this.USE_ASYNC_VIDEO_GENERATION = asyncVideoEnv === 'true' || asyncVideoEnv === '1' || asyncVideoEnv === 'yes';

    // Index tracking (ensures TTL/topic indexes exist automatically)
    this._indexesReady = false;
    this._indexSetupPromise = null;

    // Periodic cleanup configuration
    this.CACHE_CLEANUP_INTERVAL_MS = CACHE_CONFIG.CLEANUP_INTERVAL_MS;
    this.MAX_CONVERSATION_HISTORY_PER_CHANNEL = CACHE_CONFIG.MAX_HISTORY_PER_CHANNEL;
    this.MAX_CACHE_ENTRIES = CACHE_CONFIG.MAX_CACHE_ENTRIES;
    this._cleanupInterval = null;
    this.ACTIVE_CONVERSATION_WINDOW_MS = CONVERSATION_CONFIG.ACTIVE_WINDOW_MS;

    // Video progress tracking for streaming updates
    this._videoProgressHandlers = new Map(); // traceId -> { ctx, messageId, lastUpdate }
    this._setupVideoProgressListener();

    // Initialize InteractionManager for UI feedback
    this.interactionManager = new InteractionManager({
      logger: this.logger,
    });

    this._videoGenerationLocks = new Map(); // channelId -> { traceId, expiresAt }
    this.VIDEO_GENERATION_LOCK_MS = VIDEO_LOCK_TIMEOUT_MS;
  }

  /**
   * Set up listener for video generation progress events
   * @private
   */
  _setupVideoProgressListener() {
    eventBus.on('video:progress', async (event) => {
      try {
        await this._handleVideoProgress(event);
      } catch (err) {
        this.logger?.debug?.('[TelegramService] Video progress handler error:', err?.message);
      }
    });
  }

  /**
   * Handle video progress event and update Telegram message
   * @param {Object} event - Progress event from VeoService
   */
  async _handleVideoProgress(event) {
    const { traceId, channelId, status, progress, eta } = event;
    if (!traceId) return;

    const handler = this._videoProgressHandlers.get(traceId);
    if (!handler) return;

    const { ctx, messageId, lastUpdate } = handler;
    
    // Throttle updates to once every 5 seconds
    if (Date.now() - lastUpdate < 5000 && status !== 'complete' && status !== 'error') {
      return;
    }

    // Build progress message
    const statusMessages = {
      starting: '🎬 Starting video generation...',
      submitting: '📤 Submitting to video service...',
      processing: `🎥 Processing video... ${progress}%${eta ? ` (${eta})` : ''}`,
      uploading: '☁️ Uploading video...',
      complete: '✅ Video ready!',
      error: '❌ Video generation failed',
      rate_limited: '⏰ Video generation rate limited, try again later',
      timeout: '⏱️ Video generation timed out'
    };

    const message = statusMessages[status] || `🎬 ${status}... ${progress}%`;

    try {
      if (messageId) {
        // Update existing progress message
        await ctx.telegram.editMessageText(
          channelId || ctx.chat?.id,
          messageId,
          null,
          message
        );
      }
      
      if (channelId) {
        this._refreshVideoGenerationLock(String(channelId), traceId);
      }

      // Update last update time
      handler.lastUpdate = Date.now();
      
      // Clean up on completion
      if (status === 'complete' || status === 'error' || status === 'rate_limited' || status === 'timeout') {
        this._videoProgressHandlers.delete(traceId);
      }
    } catch (err) {
      // Ignore edit errors (message may have been deleted)
      this.logger?.debug?.('[TelegramService] Failed to update progress message:', err?.message);
    }
  }

  /**
   * Register a video generation for progress tracking
   * @param {string} traceId - Trace ID for correlation
   * @param {Object} ctx - Telegram context
   * @param {number} [messageId] - Optional message ID to update
   * @private
   */
  _registerVideoProgress(traceId, ctx, messageId = null) {
    this._videoProgressHandlers.set(traceId, {
      ctx,
      messageId,
      lastUpdate: 0
    });
  }

  /**
   * Start periodic cache cleanup to prevent memory leaks
   * Delegates to CacheManager
   * @private
   */
  _startCacheCleanup() {
    this.cacheManager.startCleanup();
    this.logger?.info?.('[TelegramService] Started periodic cache cleanup');
  }

  /**
   * Stop periodic cache cleanup (call on shutdown)
   * Delegates to CacheManager
   * @private
   */
  _stopCacheCleanup() {
    this.cacheManager.stopCleanup();
    this.logger?.info?.('[TelegramService] Stopped periodic cache cleanup');
  }

  /**
   * Prune all in-memory caches to prevent memory leaks
   * Delegates to CacheManager
   * @private
   */
  _pruneAllCaches() {
    this.cacheManager.pruneAll();
  }

  /**
   * Acquire a lock for a channel to prevent race conditions in debouncing
   * Delegates to CacheManager
   * @private
   * @param {string} channelId - Channel ID
   * @returns {Promise<Function>} - Release function to call when done
   */
  async _acquireChannelLock(channelId) {
    return this.cacheManager.acquireLock(channelId);
  }

  /**
   * Try to acquire a lock without waiting (returns null if lock is held)
   * Delegates to CacheManager
   * @private
   * @param {string} channelId - Channel ID
   * @returns {Function|null} - Release function or null if lock is held
   */
  _tryAcquireChannelLock(channelId) {
    return this.cacheManager.tryAcquireLock(channelId);
  }

  /**
   * Generate a unique request ID for deduplication
   * Delegates to utility function
   * @private
   */
  _generateRequestId(ctx) {
    return generateRequestId(ctx);
  }

  /**
   * Mark a service as exhausted for a duration
   * Delegates to CacheManager
   * @param {string} mediaType - 'video' or 'image'
   * @param {number} durationMs - Duration in ms (default 1 hour)
   */
  _markServiceAsExhausted(mediaType, durationMs = 60 * 60 * 1000) {
    this.cacheManager.markServiceExhausted(mediaType, durationMs);
  }

  /**
   * Wrap an error in appropriate error class based on type
   * @param {Error} error - Original error
   * @param {string} operation - Operation name (e.g., 'image_generation')
   * @param {Object} metadata - Additional metadata
   * @returns {MediaGenerationError|RateLimitError|ServiceUnavailableError}
   */
  _wrapMediaError(error, operation, metadata = {}) {
    const errorMessage = error?.message || String(error);
    const errorCode = error?.code || error?.status;
    
    // Check for rate limit / quota errors
    if (errorCode === 429 || 
        errorCode === 'RESOURCE_EXHAUSTED' ||
        errorMessage.includes('quota') || 
        errorMessage.includes('RESOURCE_EXHAUSTED') ||
        errorMessage.includes('rate limit')) {
      return new RateLimitError(
        `Rate limit exceeded for ${operation}`,
        { operation, originalError: errorMessage, ...metadata }
      );
    }
    
    // Check for service unavailable
    if (errorCode === 503 || 
        errorCode === 502 ||
        errorMessage.includes('unavailable') ||
        errorMessage.includes('temporarily') ||
        errorMessage.includes('overloaded')) {
      return new ServiceUnavailableError(
        `Service unavailable for ${operation}`,
        { operation, originalError: errorMessage, ...metadata }
      );
    }
    
    // Default to MediaGenerationError
    return new MediaGenerationError(
      errorMessage || `Failed to execute ${operation}`,
      { operation, originalError: errorMessage, code: errorCode, ...metadata }
    );
  }

  /**
   * Handle media generation errors uniformly
   * @param {Object} ctx - Telegram context
   * @param {Error} error - The error that occurred
   * @param {string} mediaType - 'image' or 'video'
   * @param {string} userId - User ID for recording response
   * @returns {Promise<null>}
   */
  async _handleMediaError(ctx, error, mediaType, userId) {
    const wrappedError = error instanceof MediaGenerationError ? error : 
                         this._wrapMediaError(error, `${mediaType}_generation`);
    
    this.logger?.error?.(`[TelegramService] ${mediaType} generation failed:`, {
      errorType: wrappedError.constructor.name,
      message: wrappedError.message,
      metadata: wrappedError.metadata
    });
    
    // Handle rate limit errors
    if (wrappedError instanceof RateLimitError) {
      const cooldown = 60 * 60 * 1000; // 1 hour
      this._markServiceAsExhausted(mediaType, cooldown);
      
      await ctx.reply(
        `🚫 My ${mediaType} generation is overheated (API quota reached). ` +
        'I need to rest for a while. Try again in an hour.'
      );
      await this.memberManager.recordBotResponse(String(ctx.chat.id), userId);
      return null;
    }
    
    // Handle service unavailable
    if (wrappedError instanceof ServiceUnavailableError) {
      await ctx.reply(
        `⏳ The ${mediaType} generation service is temporarily busy. ` +
        'Please try again in a few minutes.'
      );
      await this.memberManager.recordBotResponse(String(ctx.chat.id), userId);
      return null;
    }
    
    // Generate natural error message for other errors
    let errorText = `❌ Sorry, I couldn't generate that ${mediaType}. `;
    errorText += mediaType === 'video' 
      ? 'Video generation is complex and sometimes fails! 😅'
      : 'The AI gods weren\'t smiling today! 😅';
    
    if (this.globalBotService) {
      try {
        const errorResponse = await this.aiService.chat([
          { role: 'user', content: `You tried to generate a ${mediaType} but it failed. Give a brief, sympathetic, slightly humorous apology (under 50 words).` }
        ], {
          model: this.globalBotService?.bot?.model || 'anthropic/claude-sonnet-4.5',
          temperature: 0.9
        });
        const naturalError = String(errorResponse || '').trim();
        if (naturalError) {
          errorText = naturalError;
        }
      } catch {
        // Use default error message
      }
    }
    
    await ctx.reply(errorText);
    await this.memberManager.recordBotResponse(String(ctx.chat.id), userId);
    return null;
  }

  /**
   * Initialize global Telegram bot if configured
   */
  async initializeGlobalBot() {
    try {
      await this._ensureTelegramIndexes();

      // If bot is already running, don't start another instance
      if (this.globalBot && this.globalBot.botInfo) {
        this.logger?.warn?.('[TelegramService] Global bot already initialized, skipping');
        return true;
      }

      // Try to get token from secrets service first, fallback to config/env
      let token = null;
      
      if (this.secretsService) {
        try {
          token = await this.secretsService.getAsync('telegram_global_bot_token');
        } catch (e) {
          this.logger?.debug?.('[TelegramService] No token in secrets service:', e.message);
        }
      }
      
      // Fallback to config/env for backward compatibility
      if (!token) {
        token = this.configService.get('TELEGRAM_GLOBAL_BOT_TOKEN') || process.env.TELEGRAM_GLOBAL_BOT_TOKEN;
      }
      
      if (!token) {
        this.logger?.debug?.('[TelegramService] No global bot token configured');
        return false;
      }

      // Stop any existing bot instance before creating a new one
      if (this.globalBot) {
        try {
          await this.globalBot.stop('SIGTERM');
          this.logger?.info?.('[TelegramService] Stopped existing bot instance');
          // Give Telegram API a moment to clean up
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (stopErr) {
          this.logger?.debug?.('[TelegramService] Error stopping existing bot:', stopErr.message);
        }
      }

      // Configure Telegraf with extended handler timeout for long-running operations
      // Default is 90s, but video generation can take 2-5 minutes
      this.globalBot = new Telegraf(token, {
        handlerTimeout: 600_000, // 10 minutes - ample time for video generation
      });
      
      // Add global error handler to catch unhandled errors
      this.globalBot.catch((err, ctx) => {
        this.logger?.error?.(`[TelegramService] Global bot error for ${ctx.updateType}:`, err);
      });
      
      // Setup buybot commands FIRST (order matters in Telegraf - first matching handler wins!)
      if (this.buybotService) {
        this.logger?.info?.('[TelegramService] Setting up buybot commands...');
        setupBuybotTelegramCommands(this.globalBot, {
          buybotService: this.buybotService,
          logger: this.logger,
        });
        this.logger?.info?.('[TelegramService] Buybot command handlers registered');
        
        // Register commands with Telegram for autocomplete
        await this.registerBuybotCommands();
      } else {
        this.logger?.warn?.('[TelegramService] Buybot service not available, skipping command setup');
      }
      
      // Set up general bot commands (AFTER buybot so it doesn't override /start)
      this.globalBot.help((ctx) => ctx.reply('I\'m the CosyWorld bot! I can chat about our community and answer questions. Just message me anytime!'));
      this.globalBot.command('usage', async (ctx) => {
        try {
          // Global usage (not per-user)
          const [imageLimit, videoLimit] = await Promise.all([
            this.checkMediaGenerationLimit(null, 'image'),
            this.checkMediaGenerationLimit(null, 'video')
          ]);
          
          const imageMinutesUntilReset = imageLimit.hourlyUsed >= imageLimit.hourlyLimit
            ? Math.ceil((imageLimit.resetTimes.hourly - new Date()) / 60000)
            : null;
          const videoMinutesUntilReset = videoLimit.hourlyUsed >= videoLimit.hourlyLimit
            ? Math.ceil((videoLimit.resetTimes.hourly - new Date()) / 60000)
            : null;
          
          await ctx.reply(
            `📊 Media Generation Usage (Global)\n\n` +
            `🎨 Images:\n` +
            `  Hourly: ${imageLimit.hourlyUsed}/${imageLimit.hourlyLimit} used ${imageMinutesUntilReset ? `(resets in ${imageMinutesUntilReset}m)` : ''}\n` +
            `  Daily: ${imageLimit.dailyUsed}/${imageLimit.dailyLimit} used\n\n` +
            `🎬 Videos:\n` +
            `  Hourly: ${videoLimit.hourlyUsed}/${videoLimit.hourlyLimit} used ${videoMinutesUntilReset ? `(resets in ${videoMinutesUntilReset}m)` : ''}\n` +
            `  Daily: ${videoLimit.dailyUsed}/${videoLimit.dailyLimit} used\n\n` +
            `💡 Tip: Ask me to create images or videos anytime!`
          );
        } catch (error) {
          this.logger?.error?.('[TelegramService] Usage command failed:', error);
          await ctx.reply('Sorry, I couldn\'t fetch usage stats right now. 😅');
        }
      });
      
      // Set up message handlers for conversations (AFTER command handlers)
      this.setupMessageHandlers();
      
      // Launch the bot with timeout protection
      // Telegram will automatically disconnect any other instance using the same token
      const launchTimeout = 30000; // 30 seconds timeout
      const launchPromise = this.globalBot.launch();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Bot launch timeout - this usually means the bot is starting up or there are network issues')), launchTimeout);
      });
      
      try {
        // Race the launch against the timeout
        await Promise.race([launchPromise, timeoutPromise]);
        this.logger?.info?.('[TelegramService] Bot launch initiated successfully');
      } catch (launchErr) {
        // If launch times out or fails, log it but don't fail startup
        // The bot may still work, we'll verify with getMe() call
        this.logger?.warn?.('[TelegramService] Bot launch warning:', launchErr.message);
      }
      
      // Verify bot connection with retry logic (network issues can cause ECONNRESET)
      let botInfo = null;
      const maxRetries = 3;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          botInfo = await this.globalBot.telegram.getMe();
          break; // Success, exit retry loop
        } catch (err) {
          if (attempt === maxRetries) {
            throw err; // Final attempt failed
          }
          this.logger?.warn?.(`[TelegramService] Bot verification attempt ${attempt}/${maxRetries} failed: ${err.message}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
        }
      }
      
      this.logger?.info?.(`[TelegramService] Global bot initialized successfully: @${botInfo.username}`);
      
      // Start periodic cache cleanup
      this._startCacheCleanup();
      
      // Start conversation gap polling
      this.startConversationGapPolling();
      
      return true;
    } catch (error) {
      this.logger?.error?.('[TelegramService] Failed to initialize global bot:', error.message);
      // Bot may still work even if getMe() fails - don't fail startup completely
      return false;
    }
  }

  /**
   * Initialize global bot in webhook mode for production
   * @param {Object} options - Webhook configuration
   * @param {string} options.domain - Domain for webhook (e.g., 'api.example.com')
   * @param {string} [options.path] - Webhook path (default: '/telegram/webhook')
   * @param {string} [options.secretToken] - Secret token for webhook verification
   * @returns {Promise<Object>} - { success, webhookInfo, middleware }
   */
  async initializeWebhookMode(options = {}) {
    const { domain, path = '/telegram/webhook', secretToken } = options;

    if (!domain) {
      throw new Error('Webhook domain is required');
    }

    // Get bot token
    let token = null;
    if (this.secretsService) {
      try {
        token = await this.secretsService.getAsync('telegram_global_bot_token');
      } catch (e) {
        this.logger?.debug?.('[TelegramService] Could not get token from secrets:', e.message);
      }
    }
    token = token || this.configService?.config?.telegram?.globalBotToken || process.env.TELEGRAM_BOT_TOKEN;

    if (!token) {
      this.logger?.warn?.('[TelegramService] No Telegram bot token configured for webhook mode');
      return { success: false, error: 'No bot token configured' };
    }

    try {
      // Create bot instance if not exists
      if (!this.globalBot) {
        // Configure Telegraf with extended handler timeout for long-running operations
        // Default is 90s, but video generation can take 2-5 minutes
        this.globalBot = new Telegraf(token, {
          handlerTimeout: 600_000, // 10 minutes - ample time for video generation
        });
      }

      // Construct webhook URL
      const webhookUrl = `https://${domain}${path}`;
      this.logger?.info?.(`[TelegramService] Setting webhook to: ${webhookUrl}`);

      // Set up all handlers before setting webhook
      await this._setupBotHandlers();

      // Set webhook with Telegram
      const webhookOptions = {};
      if (secretToken) {
        webhookOptions.secret_token = secretToken;
      }

      await this.globalBot.telegram.setWebhook(webhookUrl, webhookOptions);

      // Verify webhook was set
      const webhookInfo = await this.globalBot.telegram.getWebhookInfo();
      this.logger?.info?.('[TelegramService] Webhook info:', {
        url: webhookInfo.url,
        hasCustomCertificate: webhookInfo.has_custom_certificate,
        pendingUpdateCount: webhookInfo.pending_update_count,
        lastErrorDate: webhookInfo.last_error_date,
        lastErrorMessage: webhookInfo.last_error_message
      });

      // Get bot info
      const botInfo = await this.globalBot.telegram.getMe();
      this.logger?.info?.(`[TelegramService] Webhook bot initialized: @${botInfo.username}`);

      // Start cache cleanup
      this._startCacheCleanup();

      // Return middleware for Express
      const middleware = this.globalBot.webhookCallback(path, { secretToken });

      return {
        success: true,
        webhookInfo,
        middleware,
        botInfo,
        path
      };
    } catch (error) {
      this.logger?.error?.('[TelegramService] Failed to set up webhook:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get Express middleware for webhook handling
   * @param {string} [secretToken] - Secret token for verification
   * @returns {Function} - Express middleware
   */
  getWebhookMiddleware(secretToken) {
    if (!this.globalBot) {
      throw new Error('Bot not initialized - call initializeWebhookMode first');
    }
    return this.globalBot.webhookCallback('/telegram/webhook', { secretToken });
  }

  /**
   * Delete webhook and switch to polling mode
   * @returns {Promise<boolean>}
   */
  async deleteWebhook() {
    if (!this.globalBot) {
      return false;
    }

    try {
      await this.globalBot.telegram.deleteWebhook({ drop_pending_updates: false });
      this.logger?.info?.('[TelegramService] Webhook deleted');
      return true;
    } catch (error) {
      this.logger?.error?.('[TelegramService] Failed to delete webhook:', error);
      return false;
    }
  }

  /**
   * Get current webhook status
   * @returns {Promise<Object>}
   */
  async getWebhookStatus() {
    if (!this.globalBot) {
      return { configured: false };
    }

    try {
      const info = await this.globalBot.telegram.getWebhookInfo();
      return {
        configured: !!info.url,
        url: info.url || null,
        pendingUpdates: info.pending_update_count || 0,
        lastError: info.last_error_message || null,
        lastErrorDate: info.last_error_date ? new Date(info.last_error_date * 1000) : null
      };
    } catch (error) {
      return { configured: false, error: error.message };
    }
  }

  /**
   * Internal: Set up all bot handlers (used by both polling and webhook modes)
   * @private
   */
  async _setupBotHandlers() {
    if (!this.globalBot) return;

    // Ensure indexes are ready
    await this._ensureTelegramIndexes();

    // Load global bot service
    if (this.globalBotService?.getOrCreateGlobalBot) {
      this.globalBotService.botId = await this.globalBotService.getOrCreateGlobalBot();
      this.globalBotService.bot = await this.globalBotService.avatarService?.getAvatarById(
        this.globalBotService.botId
      );
    }

    // Set up buybot if available
    if (this.buybotService && setupBuybotTelegramCommands) {
      setupBuybotTelegramCommands(this.globalBot, this.buybotService, this.logger);
    }

    // Set up commands
    this.globalBot.help((ctx) => ctx.reply('I\'m the CosyWorld bot! I can chat about our community and answer questions. Just message me anytime!'));

    // Set up message handlers
    this.setupMessageHandlers();

    this.logger?.debug?.('[TelegramService] Bot handlers configured');
  }

  /**
   * Set up message handlers for the global bot
   */
  setupMessageHandlers() {
    if (!this.globalBot) return;

    // Handle all text messages
    this.globalBot.on('text', async (ctx) => {
      try {
        await this.handleIncomingMessage(ctx);
      } catch (error) {
        this.logger?.error?.('[TelegramService] Message handling error:', error);
      }
    });

    // Track new members joining the group
    this.globalBot.on('new_chat_members', async (ctx) => {
      try {
        await this.handleNewMembers(ctx);
      } catch (error) {
        this.logger?.error?.('[TelegramService] new_chat_members handler error:', error);
      }
    });

    // Track members leaving / being removed from the group
    this.globalBot.on('left_chat_member', async (ctx) => {
      try {
        await this.handleMemberLeft(ctx);
      } catch (error) {
        this.logger?.error?.('[TelegramService] left_chat_member handler error:', error);
      }
    });

    // Track bot membership changes (e.g., kicked / promoted)
    this.globalBot.on('my_chat_member', async (ctx) => {
      try {
        await this.handleBotStatusChange(ctx);
      } catch (error) {
        this.logger?.error?.('[TelegramService] my_chat_member handler error:', error);
      }
    });

    this.logger?.debug?.('[TelegramService] Message handlers configured');
  }

  async _rememberGeneratedMedia(channelId, entry = {}) {
    return this.mediaManager.rememberGeneratedMedia(channelId, entry);
  }

  /**
   * Register buybot commands with Telegram for autocomplete
   * This makes the commands appear in the slash command menu
   */
  async registerBuybotCommands() {
    if (!this.globalBot) return;

    try {
      const commands = [
        { command: 'settings', description: '⚙️ Manage buybot settings' },
        { command: 'help', description: '❓ Show help' },
      ];

      await this.globalBot.telegram.setMyCommands(commands);
      this.logger?.info?.('[TelegramService] Buybot commands registered with Telegram');
    } catch (error) {
      this.logger?.error?.('[TelegramService] Failed to register commands with Telegram:', error);
    }
  }





  async _ensureTelegramIndexes() {
    if (!this.mediaManager?.ensureIndexes) return;
    return this.mediaManager.ensureIndexes();
  }


  async _getRecentMedia(channelId, limit = 5) {
    return this.mediaManager.getRecentMedia(channelId, limit);
  }

  async _getMediaById(channelId, mediaId) {
    return this.mediaManager.getMediaById(channelId, mediaId);
  }

  async _getRecentMediaByType(channelId, type, limit = 5) {
    return this.mediaManager.getRecentMediaByType(channelId, type, limit);
  }

  async _searchMediaByContent(channelId, query, options = {}) {
    return this.mediaManager.searchMediaByContent(channelId, query, options);
  }

  async _findBestMediaForTweet(channelId, tweetContent, options = {}) {
    return this.mediaManager.findBestMediaForTweet(channelId, tweetContent, options);
  }

  async _getDerivedMedia(originMediaId) {
    return this.mediaManager.getDerivedMedia(originMediaId);
  }

  /**
   * Resolve media IDs into usable reference images for follow-up generations
   * Filters out stale or non-image media and limits the total returned records
   * @param {string} channelId - Channel identifier
   * @param {Object} options
   * @param {string[]} [options.explicitIds=[]] - Media IDs explicitly requested
   * @param {string|null} [options.fallbackId=null] - Optional fallback media ID
   * @param {number} [options.max=3] - Maximum number of references to return
   * @returns {Promise<Array>} Array of media records suitable for references
   */
  async _resolveReferenceMedia(channelId, { explicitIds = [], fallbackId = null, max = 3 } = {}) {
    if (!channelId) return [];

    const idQueue = [];
    const seen = new Set();
    const pushId = (id) => {
      if (!id) return;
      const cleanId = String(id).trim();
      if (!cleanId || seen.has(cleanId)) return;
      seen.add(cleanId);
      idQueue.push(cleanId);
    };

    explicitIds.forEach(pushId);
    pushId(fallbackId);

    if (!idQueue.length) {
      return [];
    }

    const references = [];
    for (const mediaId of idQueue) {
      if (references.length >= max) break;
      try {
        const mediaRecord = await this._getMediaById(channelId, mediaId);
        if (!mediaRecord) continue;
        if (!['image', 'keyframe'].includes(mediaRecord.type)) continue;

        const createdAt = new Date(mediaRecord.createdAt || 0).getTime();
        if (!Number.isFinite(createdAt)) continue;
        const ageMs = Date.now() - createdAt;
        if (this.RECENT_MEDIA_MAX_AGE_MS && ageMs > this.RECENT_MEDIA_MAX_AGE_MS) continue;

        references.push(mediaRecord);
      } catch (err) {
        this.logger?.debug?.('[TelegramService] Failed to resolve media reference:', err?.message);
      }
    }

    return references;
  }

  _getCharacterDesignConfig() {
    return this.globalBotService?.bot?.globalBotConfig?.characterDesign || null;
  }

  _getPersonaReferenceUrl() {
    const design = this._getCharacterDesignConfig();
    if (!design?.enabled) return null;
    return design.referenceImageUrl || null;
  }

  async _collectReferenceImages(channelId, { explicitIds = [], fallbackId = null } = {}) {
    const referencesFromHistory = channelId
      ? await this._resolveReferenceMedia(channelId, { explicitIds, fallbackId, max: MAX_REFERENCE_IMAGES })
      : [];

    const personaUrl = this._getPersonaReferenceUrl();
    const urls = [];
    const recordIds = [];
    const sources = [];
    const seen = new Set();

    const pushUrl = (url, sourceLabel, recordId = null) => {
      if (!url || urls.length >= MAX_REFERENCE_IMAGES) return false;
      const trimmed = String(url).trim();
      if (!trimmed || seen.has(trimmed)) return false;
      seen.add(trimmed);
      urls.push(trimmed);
      sources.push(sourceLabel);
      if (recordId) {
        recordIds.push(recordId);
      }
      return true;
    };

    if (personaUrl) {
      pushUrl(personaUrl, 'persona');
    }

    for (const record of referencesFromHistory) {
      pushUrl(record.mediaUrl, 'recent_media', record.id);
    }

    return {
      urls,
      recordIds,
      personaReferenceUsed: Boolean(personaUrl && seen.has(personaUrl)),
      sources
    };
  }

  _acquireVideoGenerationLock(channelId, traceId) {
    if (!channelId) return true;
    const now = Date.now();
    const current = this._videoGenerationLocks.get(channelId);
    if (current && current.expiresAt > now && current.traceId !== traceId) {
      return false;
    }
    this._videoGenerationLocks.set(channelId, {
      traceId,
      expiresAt: now + this.VIDEO_GENERATION_LOCK_MS
    });
    return true;
  }

  _refreshVideoGenerationLock(channelId, traceId) {
    if (!channelId) return;
    const current = this._videoGenerationLocks.get(channelId);
    if (current && current.traceId === traceId) {
      current.expiresAt = Date.now() + this.VIDEO_GENERATION_LOCK_MS;
      this._videoGenerationLocks.set(channelId, current);
    }
  }

  _releaseVideoGenerationLock(channelId, traceId) {
    if (!channelId) return;
    const current = this._videoGenerationLocks.get(channelId);
    if (!current) return;
    if (!traceId || current.traceId === traceId) {
      this._videoGenerationLocks.delete(channelId);
    }
  }

  _pruneAgentPlans(channelId) {
    const cache = this.agentPlansByChannel.get(channelId);
    if (!cache || cache.length === 0) return;
    const now = Date.now();
    const pruned = cache
      .filter(item => item && item.createdAt && (now - new Date(item.createdAt).getTime()) < this.AGENT_PLAN_MAX_AGE_MS)
      .slice(0, this.AGENT_PLAN_LIMIT);
    this.agentPlansByChannel.set(channelId, pruned);
  }

  async _rememberAgentPlan(channelId, entry = {}) {
    try {
      if (!channelId) return null;

      const normalizedSteps = Array.isArray(entry.steps)
        ? entry.steps
            .map(step => ({
              action: typeof step?.action === 'string' ? step.action : null,
              description: typeof step?.description === 'string' ? step.description : null,
              expectedOutcome: typeof step?.expectedOutcome === 'string' ? step.expectedOutcome : null
            }))
            .filter(step => step.description)
        : [];

      const normalized = {
        id: entry.id || randomUUID(),
        channelId: String(channelId),
        objective: entry.objective || 'Respond thoughtfully to the user',
        steps: normalizedSteps,
        confidence: typeof entry.confidence === 'number'
          ? Math.min(1, Math.max(0, entry.confidence))
          : null,
        createdAt: entry.createdAt ? new Date(entry.createdAt) : new Date(),
        userId: entry.userId || null,
        metadata: entry.metadata || null
      };

      const cache = this.agentPlansByChannel.get(normalized.channelId) || [];
      const deduped = cache.filter(item => item.id !== normalized.id);
      deduped.unshift(normalized);
      this.agentPlansByChannel.set(normalized.channelId, deduped.slice(0, this.AGENT_PLAN_LIMIT));
      this._pruneAgentPlans(normalized.channelId);

      this._persistAgentPlanRecord(normalized).catch(err => {
        this.logger?.warn?.('[TelegramService] Failed to persist agent plan:', err?.message || err);
      });

      return normalized;
    } catch (error) {
      this.logger?.warn?.('[TelegramService] _rememberAgentPlan error:', error?.message || error);
      return null;
    }
  }

  async _persistAgentPlanRecord(record) {
    if (!this.databaseService) return;
    try {
      await this._ensureTelegramIndexes();
      const db = await this.databaseService.getDatabase();
      await db.collection('telegram_agent_plans').insertOne({
        channelId: record.channelId,
        id: record.id,
        objective: record.objective,
        steps: record.steps,
        confidence: record.confidence,
        userId: record.userId || null,
        metadata: record.metadata || null,
        createdAt: record.createdAt instanceof Date ? record.createdAt : new Date(record.createdAt)
      });
    } catch (error) {
      this.logger?.warn?.('[TelegramService] Failed to store agent plan:', error?.message || error);
    }
  }

  async _loadRecentPlansFromDb(channelId, limit = this.AGENT_PLAN_LIMIT) {
    if (!this.databaseService) return [];
    try {
      const db = await this.databaseService.getDatabase();
      const items = await db.collection('telegram_agent_plans')
        .find({ channelId: String(channelId) })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
      return items.map(item => ({
        ...item,
        createdAt: item.createdAt instanceof Date ? item.createdAt : new Date(item.createdAt)
      }));
    } catch (error) {
      this.logger?.warn?.('[TelegramService] Failed to load agent plans:', error?.message || error);
      return [];
    }
  }

  async _getRecentPlans(channelId, limit = 3) {
    if (!channelId) return [];
    this._pruneAgentPlans(String(channelId));
    const cache = this.agentPlansByChannel.get(String(channelId));
    if (cache?.length) {
      return cache.slice(0, limit);
    }
    const fromDb = await this._loadRecentPlansFromDb(channelId, Math.max(limit, this.AGENT_PLAN_LIMIT));
    if (fromDb.length) {
      this.agentPlansByChannel.set(String(channelId), fromDb.slice(0, this.AGENT_PLAN_LIMIT));
    }
    return fromDb.slice(0, limit);
  }

  async _buildPlanContext(channelId, limit = 3) {
    const plans = await this._getRecentPlans(channelId, limit);
    if (!plans.length) {
      return {
        summary: 'Planning memory: No recent plans yet. When you anticipate multiple actions (speak, generate, post_tweet), call plan_actions to outline them before proceeding.',
        plans: []
      };
    }
    const summaryLines = plans.map((plan, idx) => {
      const stepsPreview = Array.isArray(plan.steps) && plan.steps.length
        ? plan.steps.slice(0, 2).map(step => `${(step.action || 'speak').toUpperCase()}: ${step.description}`).join(' → ')
        : 'SPEAK: reply naturally';
      const createdAt = plan.createdAt instanceof Date ? plan.createdAt : new Date(plan.createdAt);
      const timeLabel = createdAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return `${idx + 1}. (${timeLabel}) ${plan.objective} — ${stepsPreview}`;
    });
    return {
      summary: `Recent agent plans (most recent first):
${summaryLines.join('\n')}
Always consider calling plan_actions before executing media or tweet tools when multiple steps are needed.`,
      plans
    };
  }

  async _findRecentMediaById(channelId, mediaId) {
    return this.mediaManager.findRecentMediaById(channelId, mediaId);
  }

  async _markMediaAsTweeted(channelId, mediaId, meta = {}) {
    return this.mediaManager.markMediaAsTweeted(channelId, mediaId, meta);
  }

  async _shareTweetResultToTelegram(ctx, {
    tweetUrl,
    tweetText,
    mediaRecord,
    channelId,
    userId
  }) {
    const captionParts = ['🕊️ Posted to X'];
    if (tweetText) {
      captionParts.push(tweetText.slice(0, 500));
    }
    if (tweetUrl) {
      captionParts.push(tweetUrl);
    }
    const caption = captionParts.filter(Boolean).join('\n\n').trim() || '🕊️ Posted to X';

    try {
      let sentMessage = null;
      if (mediaRecord?.mediaUrl && ctx?.telegram) {
        if (mediaRecord.type === 'video' && ctx.telegram.sendVideo) {
          sentMessage = await ctx.telegram.sendVideo(ctx.chat.id, mediaRecord.mediaUrl, {
            caption,
            supports_streaming: true
          });
        } else if (ctx.telegram.sendPhoto) {
          sentMessage = await ctx.telegram.sendPhoto(ctx.chat.id, mediaRecord.mediaUrl, {
            caption
          });
        }
      }

      if (!sentMessage) {
        sentMessage = await ctx.reply(caption);
      }

      if (channelId) {
        await this.memberManager.recordBotResponse(channelId, userId);
        await this.conversationManager.trackBotMessage(channelId, caption);
      }

      return sentMessage;
    } catch (error) {
      this.logger?.warn?.('[TelegramService] Failed to share tweet preview:', error?.message || error);
      const fallback = tweetUrl ? `🕊️ Tweeted! ${tweetUrl}` : '🕊️ Tweeted!';
      try {
        await ctx.reply(fallback);
        if (channelId) {
          await this.memberManager.recordBotResponse(channelId, userId);
          await this.conversationManager.trackBotMessage(channelId, fallback);
        }
      } catch (replyError) {
        this.logger?.error?.('[TelegramService] Fallback tweet confirmation failed:', replyError);
      }
      return null;
    }
  }

  async _buildRecentMediaContext(channelId, limit = 5) {
    return this.mediaManager.buildRecentMediaContext(channelId, limit);
  }

  _invalidateMemberCache(channelId, userId) {
    this.cacheManager.invalidateMember(channelId, userId);
  }

  async handleNewMembers(ctx) {
    try {
      if (!ctx?.message?.new_chat_members?.length) return;
      const channelId = String(ctx.chat.id);
      const botUsername = this.globalBot?.botInfo?.username || ctx.botInfo?.username;
      for (const member of ctx.message.new_chat_members) {
        if (member?.id && member.is_bot && botUsername && member.username === botUsername) {
          continue; // Ignore the bot itself
        }
        await this.memberManager.trackUserJoin(channelId, member, ctx.message);
      }
    } catch (error) {
      this.logger?.error?.('[TelegramService] handleNewMembers error:', error);
    }
  }

  async handleMemberLeft(ctx) {
    try {
      const member = ctx?.message?.left_chat_member;
      if (!member?.id || member.is_bot) return;

      const channelId = String(ctx.chat.id);
      const userId = String(member.id);

      if (!this.databaseService) return;

      await this.memberManager.trackUserLeft(channelId, userId);
    } catch (error) {
      this.logger?.error?.('[TelegramService] handleMemberLeft error:', error);
    }
  }

  async handleBotStatusChange(ctx) {
    try {
      const status = ctx?.myChatMember?.new_chat_member?.status;
      this.logger?.info?.(`[TelegramService] Bot membership status changed in ${ctx.chat?.id}: ${status}`);
    } catch (error) {
      this.logger?.error?.('[TelegramService] handleBotStatusChange error:', error);
    }
  }

  async _updateMemberActivity(channelId, userId, { isMentioned = false } = {}) {
    return this.memberManager.updateMemberActivity(channelId, userId, { isMentioned });
  }

  async _updateUserTrustLevel(channelId, userId) {
    return this.memberManager.updateUserTrustLevel(channelId, userId);
  }

  async _recordBotResponse(channelId, userId) {
    return this.memberManager.recordBotResponse(channelId, userId);
  }

  async _applyReplyDelay(ctx, isMention) {
    const isPrivate = ctx.chat?.type === 'private';
    if (isPrivate) return true;

    const delayMs = isMention ? this.REPLY_DELAY_CONFIG.mentioned : this.REPLY_DELAY_CONFIG.default;
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    const userId = ctx.message?.from?.id ? String(ctx.message.from.id) : null;
    if (!userId) return true;

    try {
      const member = await ctx.telegram.getChatMember(ctx.chat.id, userId);
      if (!member) return true;
      if (['left', 'kicked', 'restricted'].includes(member.status)) {
        this.logger?.info?.(`[TelegramService] Skipping reply - user ${userId} status is ${member.status}`);
        return false;
      }
    } catch (error) {
      const errorMsg = error?.message || '';
      if (errorMsg.includes('USER_NOT_PARTICIPANT') || errorMsg.includes('chat member not found')) {
        this.logger?.info?.(`[TelegramService] Skipping reply - user ${userId} no longer in chat`);
        return false;
      }
      // Other errors - log and continue
      this.logger?.debug?.('[TelegramService] getChatMember check failed (continuing):', errorMsg);
    }

    return true;
  }

  async _shouldProcessTelegramUser(ctx, channelId, userId, { isMentioned = false, isPrivate = false } = {}) {
    return this.memberManager.shouldProcessUser(ctx, channelId, userId, { isMentioned, isPrivate });
  }





  /**
   * Check if user has available charges for media generation
   * @param {string} userId - User ID from Telegram
   * @param {string} mediaType - 'video' or 'image'
   * @returns {Promise<{allowed: boolean, hourlyUsed: number, dailyUsed: number, hourlyLimit: number, dailyLimit: number, resetTimes: {hourly: Date, daily: Date}}>}
   */
  async checkMediaGenerationLimit(userId, mediaType) {
    try {
      const db = await this.databaseService.getDatabase();
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
      const limits = this.mediaGenerationLimits[mediaType];
      if (!limits) {
        throw new Error(`Invalid media type: ${mediaType}`);
      }

      // Check for service exhaustion (API quota)
      const exhaustedUntil = this._serviceExhausted.get(mediaType);
      if (exhaustedUntil && exhaustedUntil > now) {
        return {
          allowed: false,
          hourlyUsed: limits.hourly, // Fake it to look full
          dailyUsed: limits.daily,   // Fake it to look full
          hourlyLimit: limits.hourly,
          dailyLimit: limits.daily,
          resetTimes: { hourly: exhaustedUntil, daily: exhaustedUntil }
        };
      }
      
      // Count usage in last hour and last day
      const usageCol = db.collection('telegram_media_usage');
      
      // GLOBAL: no userId filter
      const [hourlyUsage, dailyUsage] = await Promise.all([
        usageCol.countDocuments({
          mediaType,
          createdAt: { $gte: oneHourAgo }
        }),
        usageCol.countDocuments({
          mediaType,
          createdAt: { $gte: oneDayAgo }
        })
      ]);
      
      const allowed = hourlyUsage < limits.hourly && dailyUsage < limits.daily;
      
      // Calculate reset times
      const oldestHourlyDoc = await usageCol.findOne(
        { mediaType, createdAt: { $gte: oneHourAgo } },
        { sort: { createdAt: 1 } }
      );
      const oldestDailyDoc = await usageCol.findOne(
        { mediaType, createdAt: { $gte: oneDayAgo } },
        { sort: { createdAt: 1 } }
      );
      
      const hourlyResetTime = oldestHourlyDoc 
        ? new Date(oldestHourlyDoc.createdAt.getTime() + 60 * 60 * 1000)
        : now;
      const dailyResetTime = oldestDailyDoc
        ? new Date(oldestDailyDoc.createdAt.getTime() + 24 * 60 * 60 * 1000)
        : now;
      
      return {
        allowed,
        hourlyUsed: hourlyUsage,
        dailyUsed: dailyUsage,
        hourlyLimit: limits.hourly,
        dailyLimit: limits.daily,
        resetTimes: {
          hourly: hourlyResetTime,
          daily: dailyResetTime
        }
      };
    } catch (error) {
      this.logger?.error?.(`[TelegramService] Failed to check media generation limit:`, error);
      // Fail open - allow generation if check fails
      return { 
        allowed: true, 
        hourlyUsed: 0, 
        dailyUsed: 0,
        hourlyLimit: this.mediaGenerationLimits[mediaType]?.hourly || 0,
        dailyLimit: this.mediaGenerationLimits[mediaType]?.daily || 0,
        resetTimes: { hourly: new Date(), daily: new Date() }
      };
    }
  }

  /**
   * Record media generation usage
   * @param {string} userId - User ID from Telegram
   * @param {string} username - Username for logging
   * @param {string} mediaType - 'video' or 'image'
   * @private
   */
  async _recordMediaUsage(userId, username, mediaType) {
    try {
      const db = await this.databaseService.getDatabase();
      await db.collection('telegram_media_usage').insertOne({
        userId,
        username,
        mediaType,
        createdAt: new Date()
      });
      const actionLabel = mediaType === 'tweet' ? 'tweet post' : `${mediaType} generation`;
      this.logger?.info?.(`[TelegramService] Recorded ${actionLabel} for user ${username} (${userId})`);
    } catch (error) {
      this.logger?.error?.(`[TelegramService] Failed to record media usage:`, error);
    }
  }



  /**
   * Handle incoming messages with debouncing and mention detection
   */
  async handleIncomingMessage(ctx) {
    const message = ctx.message;
    const channelId = String(ctx.chat.id);
    const userId = message.from?.id ? String(message.from.id) : null;
    const isPrivateChat = ctx.chat?.type === 'private';
    
    // Ignore messages from the bot itself
    if (message.from.is_bot) {
      return;
    }

    // Ignore commands - they should be handled by command handlers
   
    if (message.text && message.text.startsWith('/')) {
      this.logger?.debug?.(`[TelegramService] Ignoring command in message handler: ${message.text}`);
      return;
    }

    const botUsername = this.globalBot?.botInfo?.username || ctx.botInfo?.username;

    const isMentioned = Boolean(botUsername) && (
      includesMention(message.text, message.entities, botUsername) ||
      includesMention(message.caption, message.caption_entities, botUsername)
    );

    const shouldProcess = await this._shouldProcessTelegramUser(ctx, channelId, userId, {
      isMentioned,
      isPrivate: isPrivateChat
    });

    if (!shouldProcess) {
      this.logger?.debug?.(`[TelegramService] Spam prevention skipped message from ${userId || 'unknown'} in ${channelId}`);
      return;
    }

    // PERFORMANCE OPTIMIZATION: Load history in background if not in memory
    // This prevents blocking message handling on database queries
    let history = this.conversationManager.getHistory(channelId);
    if (!history || history.length === 0) {
      // Load from database in background (don't await)
      this.conversationManager.loadConversationHistory(channelId).catch(err => 
        this.logger?.error?.('[TelegramService] Background history load failed:', err)
      );
    }
    
    // Add message to history (in-memory first, fast operation)
    const normalizedText = message.text ?? message.caption ?? '';
    const messageData = {
      from: message.from.first_name || message.from.username || 'User',
      text: normalizedText,
      date: message.date,
      isBot: false,
      userId
    };
    
    await this.conversationManager.addMessage(channelId, messageData, true);

    this.logger?.debug?.(`[TelegramService] Tracked message in ${channelId}, history: ${history.length} messages`);

    // Check if message is a reply to the bot
    const botId = this.globalBot?.botInfo?.id || ctx.botInfo?.id;
    const isReplyToBot = message.reply_to_message && 
      botId && 
      message.reply_to_message.from?.id === botId;

    // Check if user is in active conversation window
    const isActiveParticipant = this.conversationManager.isActiveParticipant(channelId, userId);

    // Determine if we should respond instantly
    // 1. Direct mention
    // 2. Reply to bot's message
    // 3. Active conversation (user talked to us recently)
    const shouldRespond = isMentioned || isReplyToBot || isActiveParticipant;

    this.logger?.debug?.(`[TelegramService] Message in ${channelId}: mentioned=${isMentioned}, reply=${isReplyToBot}, active=${isActiveParticipant}`);

    // If we should respond, do so immediately
    if (shouldRespond) {
      // Update active conversation status (refresh timer)
      this.conversationManager.updateActiveConversation(channelId, userId);

      // Try to acquire lock without waiting - if lock is held, skip this request
      const releaseLock = this._tryAcquireChannelLock(channelId);
      if (!releaseLock) {
        this.logger?.debug?.(`[TelegramService] Skipping concurrent response in ${channelId} (lock held)`);
        return;
      }

      // Double-check processing flag (belt and suspenders)
      const pending = this.pendingReplies.get(channelId) || {};
      if (pending.isProcessing) {
        releaseLock();
        this.logger?.debug?.(`[TelegramService] Skipping concurrent response in ${channelId} (processing flag)`);
        return;
      }

      // Mark as processing to prevent gap polling from interfering
      pending.isProcessing = true;
      pending.requestId = this._generateRequestId(ctx);
      this.pendingReplies.set(channelId, pending);

      try {
        // Pass true for isMention to ensure fast response (skip long delay)
        await this.generateAndSendReply(ctx, channelId, true);
      } finally {
        // Mark that we've responded to this conversation and clear processing flag
        const updatedPending = this.pendingReplies.get(channelId) || {};
        updatedPending.lastBotResponseTime = Date.now();
        updatedPending.isProcessing = false;
        updatedPending.requestId = null;
        this.pendingReplies.set(channelId, updatedPending);
        releaseLock();
      }
      return;
    }

    // Otherwise, just track the message (don't respond to every message)
    // The polling mechanism will check for conversation gaps
  }

  /**
   * Start polling for conversation gaps and respond when appropriate
   * 
   * NEW BEHAVIOR (less chatty, more selective):
   * - Bot responds INSTANTLY when mentioned (@botname)
   * - Bot responds INSTANTLY after posting images/videos (marks as bot activity)
   * - Bot polls every 30 seconds for conversation gaps
   * - Only responds ONCE per gap (45s of silence)
   * - Does NOT respond to every message during active conversation
   * - Tracks last bot response to avoid duplicate responses
   * 
   * This creates a more natural, less intrusive bot that:
   * - Listens more, talks less
   * - Responds when called upon
   * - Chimes in thoughtfully during pauses
   */
  startConversationGapPolling() {
    const POLL_INTERVAL = 30000; // 30 seconds - how often to check for gaps
    const GAP_THRESHOLD = 45000; // 45 seconds of silence before responding
    
    setInterval(async () => {
      for (const [channelId, history] of this.conversationManager.getAllHistories()) {
        try {
          // Skip if no messages
          if (!history || history.length === 0) continue;
          
          const lastMessage = history[history.length - 1];
          const lastMessageTime = lastMessage.date * 1000; // Convert to milliseconds
          const timeSinceLastMessage = Date.now() - lastMessageTime;
          
          // Check if there's been a gap in conversation
          if (timeSinceLastMessage < GAP_THRESHOLD) continue;
          
          // Check if last message was from bot (don't respond to ourselves)
          if (lastMessage.from === 'Bot') continue;
          
          // Check if we've already responded to this conversation
          const pending = this.pendingReplies.get(channelId) || {};

          if (pending.lastBotResponseTime && pending.lastBotResponseTime > lastMessageTime) {
            // We already responded after this message
            continue;
          }
          
          // Check if we've already marked this gap as handled
          if (pending.lastCheckedMessageTime === lastMessageTime) continue;
          
          // Try to acquire lock - skip if another handler has the lock
          const releaseLock = this._tryAcquireChannelLock(channelId);
          if (!releaseLock) {
            this.logger?.debug?.(`[TelegramService] Gap polling skipped for ${channelId} (lock held)`);
            continue;
          }
          
          // Double-check processing flag after acquiring lock
          const pendingAfterLock = this.pendingReplies.get(channelId) || {};
          if (pendingAfterLock.isProcessing) {
            releaseLock();
            continue;
          }
          
          this.logger?.info?.(`[TelegramService] Conversation gap detected in ${channelId} (${Math.round(timeSinceLastMessage/1000)}s silence)`);
          
          // Mark this message as checked to avoid duplicate responses
          pendingAfterLock.lastCheckedMessageTime = lastMessageTime;
          // Mark as processing to prevent concurrent handling
          pendingAfterLock.isProcessing = true;
          pendingAfterLock.requestId = `gap:${channelId}:${lastMessageTime}`;
          this.pendingReplies.set(channelId, pendingAfterLock);
          
          try {
            // Generate a response to the conversation
            // Create a mock context object for the reply
            if (!this.globalBot) {
              releaseLock();
              continue;
            }
            
            const mockCtx = {
              chat: { id: channelId },
              message: {
                text: lastMessage.text,
                from: { first_name: lastMessage.from, id: lastMessage.userId || undefined },
                date: lastMessage.date
              },
              telegram: this.globalBot.telegram, // CRITICAL: Need this for sendPhoto/sendVideo
              reply: async (text) => {
                return await this.globalBot.telegram.sendMessage(channelId, text);
              }
            };
            
            await this.generateAndSendReply(mockCtx, channelId, false);
            
            // Update pending state after successful reply
            const updatedPending = this.pendingReplies.get(channelId) || {};
            updatedPending.lastBotResponseTime = Date.now();
            updatedPending.isProcessing = false;
            updatedPending.requestId = null;
            this.pendingReplies.set(channelId, updatedPending);
          } catch (error) {
            // Clear processing flag on error
            const updatedPending = this.pendingReplies.get(channelId) || {};
            updatedPending.isProcessing = false;
            updatedPending.requestId = null;
            this.pendingReplies.set(channelId, updatedPending);
            throw error;
          } finally {
            releaseLock();
          }
          
        } catch (error) {
          this.logger?.error?.(`[TelegramService] Gap polling error for ${channelId}:`, error);
        }
      }
    }, POLL_INTERVAL);
    
    this.logger?.info?.('[TelegramService] Started conversation gap polling (30s interval, 45s gap threshold)');
  }

  /**
   * Generate and send a reply using the global bot's personality
   * Now includes tool calling for image and video generation!
   * Uses full conversation history for better context awareness.
   */
  async generateAndSendReply(ctx, channelId, isMention) {
    const proceed = await this._applyReplyDelay(ctx, isMention);
    if (!proceed) {
      this.logger?.info?.('[TelegramService] Reply skipped after delay/user check');
      return;
    }

    // Show typing indicator immediately for better UX
    const typingInterval = setInterval(() => {
      ctx.telegram.sendChatAction(ctx.chat.id, 'typing').catch(() => {});
    }, 4000); // Telegram requires typing indicator refresh every 5s

    try {
      // Parallel data fetching with caching (PERFORMANCE OPTIMIZATION)
      // This reduces database query time by ~500-1000ms
      const [persona, buybotContext, imageLimitCtx, videoLimitCtx, tweetLimitCtx] = await Promise.all([
        this.contextManager.getPersona(),
        this.contextManager.getBuybotContext(channelId),
        this.checkMediaGenerationLimit(null, 'image'),
        this.checkMediaGenerationLimit(null, 'video'),
        this.checkMediaGenerationLimit(null, 'tweet')
      ]);

      // Load conversation history if not already in memory
      let fullHistory = this.conversationManager.getHistory(channelId);
      if (!fullHistory || fullHistory.length === 0) {
        fullHistory = await this.conversationManager.loadConversationHistory(channelId);
      }
      
      // Get full conversation history (last 20 messages for context)
      const recentHistory = fullHistory.slice(-20); // Use last 20 for AI context
      
      // Build rich conversation context from history
      let conversationContext = recentHistory.length > 0
        ? recentHistory.map(m => `${m.from}: ${m.text}`).join('\n')
        : `${ctx.message.from.first_name || ctx.message.from.username || 'User'}: ${ctx.message.text}`;

      // Add reply context if available
      if (ctx.message?.reply_to_message) {
        const reply = ctx.message.reply_to_message;
        const replyFrom = reply.from?.first_name || reply.from?.username || 'User';
        let replyContent = '[Message]';
        
        if (reply.text) replyContent = reply.text;
        else if (reply.caption) replyContent = `[Media with caption] ${reply.caption}`;
        else if (reply.video) replyContent = '[Video]';
        else if (reply.photo) replyContent = '[Image]';
        
        conversationContext += `\n(User is replying to ${replyFrom}: "${replyContent}")`;
      }

      this.logger?.info?.(`[TelegramService] Generating reply with ${recentHistory.length} messages of context`);

      // Get global bot persona (from cache)
      let botPersonality = 'You are the CosyWorld narrator bot, a warm and welcoming guide who shares stories about our AI avatar community.';
      let botDynamicPrompt = 'I\'ve been welcoming interesting souls to CosyWorld.';
      
      if (persona?.bot) {
        botPersonality = persona.bot.personality || botPersonality;
        botDynamicPrompt = persona.bot.dynamicPrompt || botDynamicPrompt;
      }

      // Build compact tool credit context for the AI (using imported utility)
      const toolCreditContext = `
Tool Credits (global): ${buildCreditInfo(imageLimitCtx, 'Images')} | ${buildCreditInfo(videoLimitCtx, 'Videos')} | ${buildCreditInfo(tweetLimitCtx, 'X posts')}
Rule: Only call tools if credits available. If 0, explain naturally and mention reset time.`;

  const planContext = await this._buildPlanContext(channelId, 3);
  const recentMediaContext = await this._buildRecentMediaContext(channelId, 5);

      // Use cached buybot context
      const buybotContextStr = buybotContext ? `

Token Tracking (Buybot):
${buybotContext}
You can discuss token activity naturally when relevant to the conversation.` : '';

      const systemPrompt = `${botPersonality}

${botDynamicPrompt}

Conversation mode: ${isMention ? 'Direct mention - respond to their question' : 'General chat - respond naturally'}
Keep responses brief (2-3 sentences).

${toolCreditContext}${buybotContextStr}

${planContext.summary}
Call plan_actions before big multi-step moves (e.g., SPEAK -> GENERATE_IMAGE -> POST_TWEET) so you can outline the sequence explicitly for later reference.

${recentMediaContext.summary}

CRITICAL MEDIA SELECTION RULES:
1. When posting to X, ALWAYS use the most recently generated image that matches the user's request.
2. Read the image descriptions carefully - each entry shows what the image depicts.
3. If you just generated an image, it will be at position #1 in the list above.
4. Never post an old image unless the user specifically asks for it.
5. Images marked "ALREADY TWEETED" cannot be posted again.
6. Match the content description to what the user asked for before tweeting.

When a user clearly wants to post to X/Twitter, call the tweet tool with the matching media ID from the list above (images/videos only). Never tweet automatically; confirm intent and verify you're using the correct image.
Tool usage: When tools are available and user asks for media, provide natural acknowledgment + tool call together.`;

      const userPrompt = `Recent conversation:
${conversationContext}

Respond naturally to this conversation. Be warm, engaging, and reflect your narrator personality.`;

      // Generate response using AI (with tool calling support)
      if (!this.aiService) {
        await ctx.reply('I\'m here and listening! 👂 (AI service not configured)');
        return;
      }

      // Define available tools for the AI
      const tools = [
        {
          type: 'function',
          function: {
            name: 'plan_actions',
            description: `Outline a plan that lists upcoming actions before executing them.
VIDEO ACTIONS: generate_video, generate_video_with_reference, generate_video_from_image, extend_video, generate_video_interpolation
IMAGE ACTIONS: generate_image, generate_keyframe, edit_image
OTHER: speak, post_tweet, research, wait

CRITICAL: When user requests widescreen/banner/landscape images, you MUST set aspectRatio to '16:9'. When user requests portrait/tall images, set aspectRatio to '9:16'. The description alone does NOT control aspect ratio - you must explicitly set the aspectRatio property!`,
            parameters: {
              type: 'object',
              properties: {
                objective: {
                  type: 'string',
                  description: 'Overall goal or intention for the plan.'
                },
                steps: {
                  type: 'array',
                  minItems: 1,
                  description: 'Ordered steps describing the actions you will take.',
                  items: {
                    type: 'object',
                    properties: {
                      action: {
                        type: 'string',
                        enum: ['speak', 'generate_image', 'generate_keyframe', 'generate_video', 'generate_video_with_reference', 'generate_video_from_image', 'extend_video', 'generate_video_interpolation', 'edit_image', 'post_tweet', 'research', 'wait'],
                        description: 'Action to perform.'
                      },
                      description: {
                        type: 'string',
                        description: 'Detailed prompt or description. For videos, include subject, action, camera, style, audio cues.'
                      },
                      aspectRatio: {
                        type: 'string',
                        enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
                        description: 'CRITICAL for generate_image/video actions! 16:9=widescreen/banner/landscape, 9:16=portrait/tall/vertical/story, 1:1=square. MUST match user intent!'
                      },
                      style: {
                        type: 'string',
                        description: 'For videos: cinematic, animated, documentary, film_noir, dreamlike, stop_motion.'
                      },
                      camera: {
                        type: 'string',
                        description: 'For videos: camera movement (tracking, dolly, aerial, POV, etc).'
                      },
                      sourceMediaId: {
                        type: 'string',
                        description: 'For video_from_image, extend_video: ID of source media.'
                      },
                      referenceMediaIds: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'For video_with_reference: 1-3 reference image IDs for character consistency.'
                      },
                      firstFrameMediaId: {
                        type: 'string',
                        description: 'For video_interpolation: first frame image ID.'
                      },
                      lastFrameMediaId: {
                        type: 'string',
                        description: 'For video_interpolation: last frame image ID.'
                      },
                      negativePrompt: {
                        type: 'string',
                        description: 'Things to avoid in generation.'
                      },
                      expectedOutcome: {
                        type: 'string',
                        description: 'Optional expected result of the step.'
                      }
                    },
                    required: ['action', 'description', 'aspectRatio']
                  }
                },
                confidence: {
                  type: 'number',
                  description: 'Optional confidence score between 0 and 1.'
                }
              },
              required: ['objective', 'steps']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'get_token_stats',
            description: 'Get current market statistics for a tracked Solana token (market cap, price, 24h volume). Use this when users ask about token price, market cap, or stats.',
            parameters: {
              type: 'object',
              properties: {
                tokenSymbol: {
                  type: 'string',
                  description: 'The token symbol (e.g., "RATi", "BONK", "SOL")'
                }
              },
              required: ['tokenSymbol']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'generate_image',
            description: `Generate an image based on a text prompt.
ASPECT RATIO GUIDE:
- 16:9 = widescreen, banner, landscape, cinematic, YouTube thumbnail
- 9:16 = portrait, tall, vertical, story, TikTok, mobile
- 1:1 = square, profile picture, icon
- 6:2 = ultrawide banner, header image
You MUST set aspectRatio explicitly - it controls the actual image dimensions!`,
            parameters: {
              type: 'object',
              properties: {
                prompt: {
                  type: 'string',
                  description: 'A detailed description of the image to generate. Be creative and descriptive.'
                },
                aspectRatio: {
                  type: 'string',
                  enum: ['16:9', '9:16', '1:1', '6:2'],
                  description: 'REQUIRED - 16:9 for widescreen/banner, 9:16 for portrait/story, 1:1 for square, 6:2 for ultrawide banner. Default to 16:9 if unclear.'
                }
              },
              required: ['prompt', 'aspectRatio']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'generate_video',
            description: `Generate a short video (8 seconds) with AI-generated audio using TEXT-TO-VIDEO.
This creates a completely new video from your text description - no source image needed.

PROMPT BEST PRACTICES:
- Include SUBJECT (who/what), ACTION (what they're doing), and STYLE (cinematic, animated, etc.)
- Add CAMERA directions: "tracking shot", "dolly in", "aerial view", "POV shot"
- Add AMBIANCE: "warm sunset lighting", "moody blue tones", "misty atmosphere"
- For DIALOGUE: Use quotes - "Hello there," she said
- For SOUND EFFECTS: Describe explicitly - "footsteps echo on marble floor"

NOTE: If you want to animate an existing image, use generate_video_from_image instead.`,
            parameters: {
              type: 'object',
              properties: {
                prompt: {
                  type: 'string',
                  description: 'Detailed video description. Include subject, action, camera movement, style, and audio cues.'
                },
                aspectRatio: {
                  type: 'string',
                  enum: ['16:9', '9:16'],
                  description: 'REQUIRED - 16:9 (widescreen/cinematic/YouTube) or 9:16 (vertical/TikTok/Stories). Default to 16:9.'
                },
                style: {
                  type: 'string',
                  enum: ['cinematic', 'animated', 'documentary', 'film_noir', 'dreamlike', 'stop_motion'],
                  description: 'Visual style for the video.'
                },
                camera: {
                  type: 'string',
                  description: 'Camera movement/position: tracking, dolly, aerial, POV, close-up, wide shot, etc.'
                },
                negativePrompt: {
                  type: 'string',
                  description: 'Things to avoid in the video (e.g., "blurry, distorted, cartoon").'
                }
              },
              required: ['prompt', 'aspectRatio']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'generate_video_with_reference',
            description: `Generate a video using 1-3 reference images to preserve character/subject appearance. 
Use this when you need to maintain visual consistency with a specific character, person, or product. 
The reference images guide what the subject looks like in the generated video.
Note: Uses 16:9 aspect ratio and 8 second duration.`,
            parameters: {
              type: 'object',
              properties: {
                prompt: {
                  type: 'string',
                  description: 'Detailed video description. Describe the scene and actions, the reference images define appearance.'
                },
                referenceMediaIds: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of 1-3 recent media IDs to use as reference images for character/subject consistency.'
                }
              },
              required: ['prompt', 'referenceMediaIds']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'generate_video_from_image',
            description: `Animate an existing image into a video. The image becomes the starting frame and comes to life.
ONLY use this with images YOU have generated - you can find them in your recent media list.
Perfect for bringing your generated artwork to life with motion and sound.`,
            parameters: {
              type: 'object',
              properties: {
                prompt: {
                  type: 'string',
                  description: 'Describe how to animate the image - what movements, actions, camera motion, and sounds should occur.'
                },
                sourceMediaId: {
                  type: 'string',
                  description: 'ID of YOUR generated image to animate (from your recent media list). Only works with images you created.'
                },
                aspectRatio: {
                  type: 'string',
                  enum: ['16:9', '9:16'],
                  description: 'Should match source image orientation. 16:9 for wide images, 9:16 for tall images.'
                }
              },
              required: ['prompt', 'sourceMediaId', 'aspectRatio']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'extend_video',
            description: `Extend a previously generated video by 7 seconds (up to 20 times, max 141 seconds total).
Continues the action from where the video ended. Great for building longer narratives.`,
            parameters: {
              type: 'object',
              properties: {
                prompt: {
                  type: 'string',
                  description: 'Describe what should happen in the extension. Continues from the video\'s last frame.'
                },
                sourceMediaId: {
                  type: 'string',
                  description: 'ID of the video to extend (from your recent media list). Must be a Veo-generated video.'
                }
              },
              required: ['prompt', 'sourceMediaId']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'generate_video_interpolation',
            description: `Generate a video that transitions from a first frame image to a last frame image.
Creates smooth interpolation between two keyframes. Great for before/after, transformations, or controlled transitions.`,
            parameters: {
              type: 'object',
              properties: {
                prompt: {
                  type: 'string',
                  description: 'Describe the transition/transformation between the two frames.'
                },
                firstFrameMediaId: {
                  type: 'string',
                                   description: 'ID of the image to use as the first frame.'
                },
                lastFrameMediaId: {
                  type: 'string',
                  description: 'ID of the image to use as the last frame.'
                }
              },
              required: ['prompt', 'firstFrameMediaId', 'lastFrameMediaId']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'post_tweet',
            description: 'Post a CosyWorld update to X/Twitter using a recently generated image or video when a user explicitly requests it.',
            parameters: {
              type: 'object',
              properties: {
                text: {
                  type: 'string',
                  description: 'Tweet text under 270 characters. Mention CosyWorld naturally when helpful.'
                },
                mediaId: {
                  type: 'string',
                  description: 'ID of the recent media item to share (from your recent media list).'
                }
              },
              required: ['text', 'mediaId']
            }
          }
        }
      ];

      const response = await this.aiService.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], {
        model: this.globalBotService?.bot?.model || 'anthropic/claude-sonnet-4.5',
        temperature: 0.8,
        tools: tools,
        tool_choice: 'auto'
      });

      // Handle tool calls
      const responseObj = typeof response === 'object' ? response : { text: response };
      
      if (responseObj.tool_calls && responseObj.tool_calls.length > 0) {
        // User requested media generation!
        // The AI should have provided a natural acknowledgment in the text response
        const acknowledgment = (typeof responseObj.text === 'string' && responseObj.text.trim()) 
          ? responseObj.text.trim()
          : (typeof response === 'string' ? response.trim() : '');
        
        if (acknowledgment) {
          // Send the AI's natural acknowledgment first
          await ctx.reply(acknowledgment);
          const ackUserId = ctx.message?.from?.id ? String(ctx.message.from.id) : null;
          await this.memberManager.recordBotResponse(channelId, ackUserId);
          
          // Track in conversation history
          const botMessage = {
            from: 'Bot',
            text: acknowledgment,
            date: Math.floor(Date.now() / 1000),
            isBot: true,
            userId: null
          };
          await this.conversationManager.addMessage(String(ctx.chat.id), botMessage, true);
        }
        
        // Then execute the tools (which generate media)
        await this.handleToolCalls(ctx, responseObj.tool_calls, conversationContext);
        return;
      }

      const responseText = responseObj.text || String(response || '');
      const cleanResponse = String(responseText)
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .trim();

      if (cleanResponse) {
        await ctx.reply(this._formatTelegramMarkdown(cleanResponse), { parse_mode: 'HTML' });
        const replyUserId = ctx.message?.from?.id ? String(ctx.message.from.id) : null;
        await this.memberManager.recordBotResponse(channelId, replyUserId);
        
        // Track bot's reply in conversation history
        const botMessage = {
          from: 'Bot',
          text: cleanResponse,
          date: Math.floor(Date.now() / 1000),
          isBot: true,
          userId: null
        };
        await this.conversationManager.addMessage(channelId, botMessage, true);
        
        this.logger?.info?.(`[TelegramService] Sent ${isMention ? 'mention' : 'debounced'} reply to channel ${channelId}`);
      }

    } catch (error) {
      this.logger?.error?.('[TelegramService] Reply generation failed:', error);
      try {
        await ctx.reply('I\'m having trouble forming thoughts right now. Try again in a moment! 💭');
      } catch (e) {
        this.logger?.error?.('[TelegramService] Failed to send error reply:', e);
      }
    } finally {
      // Clear typing indicator interval
      clearInterval(typingInterval);
    }
  }

  /**
   * Handle tool calls from AI (image/video generation)
   * Enforces cooldown limits before executing
   * @param {Object} ctx - Telegram context
   * @param {Array} toolCalls - Array of tool calls from AI
   * @param {string} conversationContext - Recent conversation for context
   */
  async handleToolCalls(ctx, toolCalls, conversationContext) {
    try {
      const userId = String(ctx.message?.from?.id || ctx.from?.id);
      const username = ctx.message?.from?.username || ctx.from?.username || 'Unknown';
      const channelId = String(ctx.chat?.id || '');
      
      // Check if plan_actions is present - if so, it takes precedence over direct action tools
      // to avoid double execution (e.g. plan says "generate video" AND tool call says "generate video")
      const hasPlan = toolCalls.some(tc => tc.function?.name === 'plan_actions');
      
      // Filter out redundant direct calls if a plan is present
      const effectiveToolCalls = hasPlan 
        ? toolCalls.filter(tc => {
            const name = tc.function?.name;
            // Keep plan_actions and informational tools
            if (name === 'plan_actions' || name === 'get_token_stats' || name === 'research') return true;
            // Filter out action tools that should be in the plan
            if (['generate_image', 'generate_video', 'post_tweet', 'speak', 'wait'].includes(name)) {
              this.logger?.info?.(`[TelegramService] Skipping direct ${name} call in favor of plan_actions`);
              return false;
            }
            return true;
          })
        : toolCalls;

      // Deduplicate tool calls to prevent double execution
      const uniqueToolCalls = [];
      const seenCalls = new Set();
      for (const tc of effectiveToolCalls) {
        // Use a more robust key that includes the arguments to differentiate distinct calls
        // But for generation tools, we want to be aggressive about deduplication if they are identical
        const argsStr = typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function?.arguments || {});
        const key = `${tc.function?.name}:${argsStr}`;
        
        if (!seenCalls.has(key)) {
          seenCalls.add(key);
          uniqueToolCalls.push(tc);
        } else {
          this.logger?.warn?.(`[TelegramService] Skipping duplicate tool call: ${tc.function?.name}`);
        }
      }

      // Additional safety: If we have a plan, ensure we don't also have loose generation calls that slipped through
      // (Some models might output plan_actions AND generate_image with slightly different args)
      const finalToolCalls = hasPlan 
        ? uniqueToolCalls.filter(tc => tc.function?.name === 'plan_actions' || tc.function?.name === 'get_token_stats' || tc.function?.name === 'research')
        : uniqueToolCalls;

      for (const toolCall of finalToolCalls) {
        let functionName = toolCall.function?.name;
        
        // Normalize function name - some models return prefixed names like "default_api:speak"
        if (functionName && functionName.includes(':')) {
          functionName = functionName.split(':').pop();
          this.logger?.debug?.(`[TelegramService] Normalized tool name to: ${functionName}`);
        }
        
        const args = typeof toolCall.function?.arguments === 'string' 
          ? JSON.parse(toolCall.function.arguments)
          : toolCall.function?.arguments || {};

        // Clean tool execution log
        const argsSummary = functionName === 'plan_actions' 
          ? `objective="${(args.objective || '').substring(0, 40)}..." steps=${args.steps?.length || 0}`
          : functionName === 'generate_image' || functionName === 'generate_video'
            ? `prompt="${(args.prompt || '').substring(0, 50)}..."`
            : functionName === 'post_tweet'
              ? `text="${(args.text || '').substring(0, 40)}..."`
              : JSON.stringify(args).substring(0, 80);
        
        this.logger?.info?.(`[TelegramService] ⚡ Tool: ${functionName} | ${argsSummary} | user: ${username || userId}`);

        if (functionName === 'plan_actions') {
          await this.executePlanActions(ctx, args, channelId, userId, username, conversationContext);
        } else if (functionName === 'get_token_stats') {
          // Fetch token stats using buybotService
          await this.executeTokenStatsLookup(ctx, args.tokenSymbol, String(ctx.chat.id));
          
        } else if (functionName === 'generate_image') {
          // Check cooldown limit
          const limit = await this.checkMediaGenerationLimit(null, 'image');
          if (!limit.allowed) {
            const timeUntilReset = limit.hourlyUsed >= limit.hourlyLimit
              ? Math.ceil((limit.resetTimes.hourly - new Date()) / 60000) // minutes
              : Math.ceil((limit.resetTimes.daily - new Date()) / 60000);
            
            await ctx.reply(
              `🎨 Image generation charges are fully used up right now.\n\n` +
              `Hourly: ${limit.hourlyUsed}/${limit.hourlyLimit} used\n` +
              `Daily: ${limit.dailyUsed}/${limit.dailyLimit} used\n\n` +
              `⏰ Next charge available in ${timeUntilReset} minutes`
            );
            await this.memberManager.recordBotResponse(channelId, userId);
            continue;
          }
          
          // Default to square (1:1) if not specified
          const aspectRatio = args.aspectRatio || '1:1';
          await this.executeImageGeneration(ctx, args.prompt, conversationContext, userId, username, { aspectRatio });
          
        } else if (functionName === 'generate_video') {
          // Check cooldown limit
          const limit = await this.checkMediaGenerationLimit(null, 'video');
          if (!limit.allowed) {
            const timeUntilReset = limit.hourlyUsed >= limit.hourlyLimit
              ? Math.ceil((limit.resetTimes.hourly - new Date()) / 60000) // minutes
              : Math.ceil((limit.resetTimes.daily - new Date()) / 60000);
            
            await ctx.reply(
              `🎬 Video generation charges are fully used up right now.\n\n` +
              `Hourly: ${limit.hourlyUsed}/${limit.hourlyLimit} used\n` +
              `Daily: ${limit.dailyUsed}/${limit.dailyLimit} used\n\n` +
              `⏰ Next charge available in ${timeUntilReset} minutes`
            );
            await this.memberManager.recordBotResponse(channelId, userId);
            continue;
          }
          
          // Extract video options from tool arguments
          const videoOptions = {
            aspectRatio: args.aspectRatio || '16:9',
            style: args.style,
            camera: args.camera,
            negativePrompt: args.negativePrompt
          };
          
          // Use async video generation if enabled (avoids handler timeout)
          if (this.USE_ASYNC_VIDEO_GENERATION) {
            await this.queueVideoGenerationAsync(ctx, args.prompt, { conversationContext, userId, username, ...videoOptions });
          } else {
            await this.executeVideoGeneration(ctx, args.prompt, conversationContext, userId, username, videoOptions);
          }

        } else if (functionName === 'generate_video_with_reference') {
          // Video generation with character reference images
          const limit = await this.checkMediaGenerationLimit(null, 'video');
          if (!limit.allowed) {
            await ctx.reply(`🎭 Video generation is on cooldown. Try again later!`);
            await this.memberManager.recordBotResponse(channelId, userId);
            continue;
          }
          
          await this.executeVideoWithReference(ctx, {
            prompt: args.prompt,
            referenceMediaIds: args.referenceMediaIds || [],
            conversationContext,
            userId,
            username,
            style: args.style,
            camera: args.camera
          });

        } else if (functionName === 'generate_video_from_image') {
          // Animate an image into a video
          const limit = await this.checkMediaGenerationLimit(null, 'video');
          if (!limit.allowed) {
            await ctx.reply(`🎥 Video generation is on cooldown. Try again later!`);
            await this.memberManager.recordBotResponse(channelId, userId);
            continue;
          }
          
          await this.executeVideoFromImage(ctx, {
            prompt: args.prompt,
            sourceMediaId: args.sourceMediaId,
            conversationContext,
            userId,
            username,
            aspectRatio: args.aspectRatio || '16:9'
          });

        } else if (functionName === 'extend_video') {
          // Extend an existing video
          const limit = await this.checkMediaGenerationLimit(null, 'video');
          if (!limit.allowed) {
            await ctx.reply(`📹 Video extension is on cooldown. Try again later!`);
            await this.memberManager.recordBotResponse(channelId, userId);
            continue;
          }
          
          await this.executeVideoExtension(ctx, {
            prompt: args.prompt,
            sourceMediaId: args.sourceMediaId,
            conversationContext,
            userId,
            username
          });

        } else if (functionName === 'generate_video') {
          // Video typically uses 9:16 (vertical) for social media, unless specified
          const videoOptions = { 
            aspectRatio: args.aspectRatio || '9:16',
            style: args.style,
            camera: args.camera,
            negativePrompt: args.negativePrompt
          };
          
          // Use async video generation if enabled (avoids handler timeout)
          if (this.USE_ASYNC_VIDEO_GENERATION) {
            await this.queueVideoGenerationAsync(ctx, args.prompt, {
              conversationContext, userId, username, ...videoOptions
            });
          } else {
            await this.executeVideoGeneration(ctx, args.prompt, conversationContext, userId, username, videoOptions);
          }
        }
      }
    } catch (error) {
      this.logger?.error?.('[TelegramService] handleToolCalls error:', error);
    }
  }

  /**
   * Execute a sequence of planned actions
   * @param {Object} ctx - Telegram context
   * @param {Object} planEntry - Plan object with steps
   * @param {string} channelId - Channel ID
   * @param {string} userId - User ID
   * @param {string} username - Username
   * @param {string} conversationContext - Context string
   */
  async executePlanActions(ctx, planEntry, channelId, userId, username, conversationContext) {
    const safeSteps = Array.isArray(planEntry?.steps) ? planEntry.steps : [];
    if (safeSteps.length === 0) {
      this.logger?.info?.('[TelegramService] No steps defined in plan_actions call, skipping execution');
      await ctx.reply('I need at least one planned step to act on. Try planning again with a specific goal.');
      return;
    }

    const plan = {
      objective: planEntry.objective || 'Respond thoughtfully to the user',
      steps: safeSteps,
      confidence: typeof planEntry.confidence === 'number' ? planEntry.confidence : undefined
    };

    logPlanSummary(plan, this.logger);

    const validation = this.planExecutionService.validatePlan(plan);
    if (!validation.valid) {
      const errorText = validation.errors
        .slice(0, 3)
        .map((err, idx) => `${idx + 1}. ${err}`)
        .join('\n');
      await ctx.reply(`🚫 I couldn't execute that plan:
${errorText}`);
      return;
    }

    if (validation.warnings?.length) {
      this.logger?.warn?.('[TelegramService] Plan validation warnings:', validation.warnings);
    }

    const totalSteps = plan.steps.length;
    let progressMessageId = null;

    const updateProgress = async (stepNum, total, action) => {
      const icon = this.planExecutionService.getActionIcon(action);
      const label = this.planExecutionService.getActionLabel(action);
      const message = `${icon} <b>Step ${stepNum}/${total}:</b> ${label}...`;
      progressMessageId = await this.interactionManager.updateProgressMessage(
        ctx,
        progressMessageId,
        message,
        channelId
      );
    };

    const executionContext = {
      ctx,
      channelId,
      userId,
      username,
      conversationContext,
      services: {
        telegram: this,
        ai: this.aiService,
        database: this.databaseService,
        globalBot: this.globalBotService,
        x: this.xService
      }
    };

    const executionOptions = {
      onProgress: (stepNum, total, action) => updateProgress(stepNum, total, action),
      onStepComplete: async (result) => {
        if (!result) return;
        const status = result.success ? '✅' : '⚠️';
        this.logger?.info?.(
          `[TelegramService] Step ${result.stepNum}/${totalSteps} ${status} ${result.action}`
        );
      },
      onError: async (error, stepNum, action, isTimeout) => {
        this.logger?.error?.('[TelegramService] Plan step error:', {
          action,
          stepNum,
          isTimeout,
          message: error?.message
        });
        await ctx.reply(`⚠️ Step ${stepNum} (${action}) hit a snag: ${error.message}`);
      }
    };

    let executionResult;
    try {
      executionResult = await this.planExecutionService.executePlan(plan, executionContext, executionOptions);
    } catch (error) {
      this.logger?.error?.('[TelegramService] executePlanActions error:', error);
      await ctx.reply('Planning fizzled out for a moment—try again and I will map it out.');
      return;
    } finally {
      await this.interactionManager.deleteProgressMessage(ctx, progressMessageId, channelId);
    }

    if (!executionResult) {
      return;
    }

    const summaryEmoji = executionResult.success ? '✅' : '⚠️';
    const durationSeconds = Math.max(1, Math.round((executionResult.durationMs || 0) / 1000));
    const summaryLines = [
      `${summaryEmoji} Plan ${executionResult.success ? 'completed' : 'finished with issues'}.`,
      `Steps succeeded: ${executionResult.successCount}/${executionResult.totalSteps}`,
      `Time elapsed: ${durationSeconds}s`
    ];

    await ctx.reply(summaryLines.join('\n'));
    return executionResult;
  }

  /**
   * Get icon for action type
   * Delegates to utility function
   * @private
   */
  _getActionIcon(action) {
    return getActionIcon(action);
  }

  /**
   * Get human-readable label for action type
   * Delegates to utility function
   * @private
   */
  _getActionLabel(action) {
    return getActionLabel(action);
  }

  /**
   * Apply the configured character design prompt prefix when enabled
   * @param {string} prompt - Original user prompt
   * @param {Object} [overrideDesign] - Optional override character design config
   * @returns {{ prompt: string, charDesign: Object }} - Enhanced prompt and design reference
   */
  _applyCharacterPrompt(prompt, overrideDesign = null) {
    return this.mediaGenerationManager.applyCharacterPrompt(prompt, overrideDesign);
  }

  /**
   * Download an image and provide base64 payload for downstream consumers
   * Delegates to utility function
   * @param {string} imageUrl - Remote image URL (S3, CDN, etc.)
   * @returns {Promise<{ data: string, mimeType: string }|null>}
   */
  async _downloadImageAsBase64(imageUrl) {
    return this.mediaManager.downloadImageAsBase64(imageUrl);
  }

  /**
   * Infer MIME type from URL
   * Delegates to utility function
   * @private
   */
  _inferMimeTypeFromUrl(imageUrl) {
    return inferMimeTypeFromUrl(imageUrl);
  }

  /**
   * Shared image generation helper so we can reuse media for keyframes
   * Routes through MediaGenerationManager for unified retry/circuit breaker handling.
   * @param {Object} params
   * @returns {Promise<{ imageUrl: string, enhancedPrompt: string, binary?: { data: string, mimeType: string } }>} 
   */
  async _generateImageAsset(params) {
    return this.mediaGenerationManager.generateImageAsset(params);
  }

  /**
   * Execute image generation and send to channel
   * @param {Object} ctx - Telegram context
   * @param {string} prompt - Image generation prompt (enhanced by AI)
   * @param {string} conversationContext - Recent conversation history
   * @param {string} userId - User ID for cooldown tracking
   * @param {string} username - Username for logging
   * @param {Object} [options] - Additional options
   * @param {string} [options.aspectRatio='1:1'] - Aspect ratio (1:1, 16:9, 9:16, 4:3, 3:4)
   */
  async executeImageGeneration(ctx, prompt, conversationContext = '', userId = null, username = null, options = {}) {
    const { aspectRatio = '1:1' } = options;
    try {
      // No status message - the AI already sent a natural acknowledgment

      const { imageUrl, enhancedPrompt } = await this._generateImageAsset({
        prompt,
        conversationContext,
        userId,
        username,
        aspectRatio,
        source: 'telegram.user_request'
      });
      this.logger?.info?.('[TelegramService] Image generated successfully:', { imageUrl, aspectRatio });

      // Generate natural caption using AI
      let caption = null;
      if (this.globalBotService) {
        try {
          const captionPrompt = `You're a helpful, friendly narrator bot in CosyWorld. You just generated an image based on this prompt: "${prompt}"

Recent conversation context:
${conversationContext || 'No recent context'}

Create a brief, natural caption for the image. The caption should:
- Be conversational and warm, not mechanical
- Reference what the image shows WITHOUT repeating the technical prompt verbatim
- Be subtle and artistic, hint at the content rather than describing it literally
- Keep it under 100 characters
- Don't use asterisks or markdown

Examples:
- "A glimpse into their world..." 
- "Sometimes the quiet moments speak loudest"
- "Here's what I saw in my mind's eye"
- "A scene from CosyWorld, just for you ✨"

Your caption:`;

          const captionResponse = await this.aiService.chat([
            { role: 'user', content: captionPrompt }
          ], {
            model: this.globalBotService?.bot?.model || 'anthropic/claude-sonnet-4.5',
            temperature: 0.9
          });
          
          caption = String(captionResponse || '').trim().replace(/^["']|["']$/g, '');
        } catch (err) {
          this.logger?.warn?.('[TelegramService] Failed to generate natural caption:', err.message);
        }
      }

      // Send the image with natural caption
      const sentMessage = await ctx.telegram.sendPhoto(ctx.chat.id, imageUrl, {
        caption: caption ? this._formatTelegramMarkdown(caption) : undefined,
        parse_mode: 'HTML'
      });

      await this.memberManager.recordBotResponse(String(ctx.chat.id), userId);
      
      // Record usage for cooldown tracking
      if (userId && username) {
        await this._recordMediaUsage(userId, username, 'image');
      }
      
      // Mark that bot posted media - this counts as bot attention/activity
      const channelId = String(ctx.chat.id);
      const pending = this.pendingReplies.get(channelId) || {};
      pending.lastBotResponseTime = Date.now();
      this.pendingReplies.set(channelId, pending);
      
      // Remember media so the tweet tool can use it later
      // Store both original prompt and enhanced prompt for better content awareness
      const mediaRecord = await this.mediaManager.rememberGeneratedMedia(String(ctx.chat.id), {
        type: 'image',
        mediaUrl: imageUrl,
        prompt,
        caption,
        messageId: sentMessage?.message_id || null,
        userId,
        source: 'telegram.generate_image',
        toolingState: {
          originalPrompt: prompt,
          enhancedPrompt: enhancedPrompt || prompt,
          aspectRatio,
          model: 'gemini-3-pro-image-preview'
        },
        metadata: {
          requestedBy: userId,
          requestedByUsername: username || null,
          aspectRatio,
          // Store a brief description of what the image shows for the AI to reference
          contentDescription: prompt.slice(0, 200),
          // Track which user message triggered this generation
          triggeringMessageId: ctx.message?.message_id || null
        }
      });
      this.logger?.info?.('[TelegramService] Image posted, marked as bot activity', { mediaId: mediaRecord?.id, aspectRatio });
      return mediaRecord;

    } catch (error) {
      return await this._handleMediaError(ctx, error, 'image', userId);
    }
  }

  /**
   * Execute video generation and send to channel
   * @param {Object} ctx - Telegram context
   * @param {string} prompt - Video generation prompt (enhanced by AI)
   * @param {string} conversationContext - Recent conversation history
   * @param {string} userId - User ID for cooldown tracking
   * @param {string} username - Username for logging
   * @param {Object} [options] - Additional options
   * @param {string} [options.aspectRatio='16:9'] - Aspect ratio (16:9 or 9:16)
   * @param {string} [options.style] - Visual style (cinematic, animated, etc)
   * @param {string} [options.camera] - Camera motion/position
   * @param {string} [options.negativePrompt] - Things to avoid
   */
  async executeVideoGeneration(ctx, prompt, conversationContext = '', userId = null, username = null, options = {}) {
    const {
      aspectRatio = '16:9',
      style,
      camera,
      negativePrompt,
      referenceMediaIds = [],
      fallbackReferenceMediaId = null
    } = options;
    const traceId = generateTraceId();
    const channelId = ctx?.chat?.id ? String(ctx.chat.id) : null;
    const lockAcquired = this._acquireVideoGenerationLock(channelId, traceId);

    if (!lockAcquired) {
      await ctx.reply('🎬 I\'m still rendering the last video—give me another minute and I\'ll post it!');
      return null;
    }
    
    try {
      // Send initial progress message and register for updates
      let progressMessageId = null;
      try {
        const progressMsg = await ctx.reply('🎬 Starting video generation...');
        progressMessageId = progressMsg?.message_id;
        this._registerVideoProgress(traceId, ctx, progressMessageId);
      } catch (err) {
        this.logger?.debug?.('[TelegramService] Could not send progress message:', err?.message);
      }

      const referenceContext = await this._collectReferenceImages(channelId, {
        explicitIds: referenceMediaIds,
        fallbackId: fallbackReferenceMediaId
      });
      const effectiveAspectRatio = referenceContext.urls.length ? '16:9' : aspectRatio;
      const resolvedStyle = style || VIDEO_DEFAULTS.STYLE;
      const resolvedCamera = camera || VIDEO_DEFAULTS.CAMERA;

      this.logger?.info?.('[TelegramService] Generating video:', { 
        traceId,
        prompt: prompt.substring(0, 100), 
        userId,
        username,
        aspectRatio: effectiveAspectRatio,
        style: resolvedStyle,
        camera: resolvedCamera,
        referenceCount: referenceContext.urls.length,
        referenceSources: referenceContext.sources
      });
      
      let videoUrl = null;
      let enhancedPrompt = prompt;

      // Use MediaGenerationManager
      const videoUrls = await this.mediaGenerationManager.generateVideo({
        prompt,
        config: { aspectRatio: effectiveAspectRatio, durationSeconds: 8 },
        style: resolvedStyle,
        camera: resolvedCamera,
        negativePrompt,
        traceId,
        channelId,
        referenceImages: referenceContext.urls
      });
      
      if (!videoUrls?.length) {
        throw new Error('Video generation returned no results');
      }
      
      videoUrl = videoUrls[0];
      // Note: enhancedPrompt is not returned by generateVideo array, but we can assume it's handled
      enhancedPrompt = prompt; 
      
      this.logger?.info?.('[TelegramService] Video generated successfully', { 
        traceId,
        videoUrl: videoUrl?.substring(0, 50)
      });

      // Generate natural caption using AI
      let caption = null;
      if (this.globalBotService) {
        try {
          const captionPrompt = `You're a helpful, friendly narrator bot in CosyWorld. You just generated a video based on this prompt: "${prompt}"

Recent conversation context:
${conversationContext || 'No recent context'}

Create a brief, natural caption for the video. The caption should:
- Be conversational and warm, not mechanical
- Reference what the video shows WITHOUT repeating the technical prompt verbatim
- Be subtle and artistic, hint at the content rather than describing it literally
- Keep it under 100 characters
- Don't use asterisks or markdown

Examples:
- "Watch this moment unfold..."
- "A brief glimpse into motion 🎬"
- "Sometimes you need to see it move"
- "Here's what I imagined in motion ✨"

Your caption:`;

          const captionResponse = await this.aiService.chat([
            { role: 'user', content: captionPrompt }
          ], {
            model: this.globalBotService?.bot?.model || 'anthropic/claude-sonnet-4.5',
            temperature: 0.9
          });
          
          caption = String(captionResponse || '').trim().replace(/^["']|["']$/g, '');
        } catch (err) {
          this.logger?.warn?.('[TelegramService] Failed to generate natural caption:', err.message);
        }
      }

      // Send the video with natural caption
      const sentMessage = await ctx.telegram.sendVideo(ctx.chat.id, videoUrl, {
        caption: caption ? this._formatTelegramMarkdown(caption) : undefined,
        supports_streaming: true,
        parse_mode: 'HTML'
      });
      await this.memberManager.recordBotResponse(String(ctx.chat.id), userId);
      
      // Record usage for cooldown tracking
      if (userId && username) {
        await this._recordMediaUsage(userId, username, 'video');
      }
      
      // Mark that bot posted media - this counts as bot attention/activity
      const pending = this.pendingReplies.get(channelId) || {};
      pending.lastBotResponseTime = Date.now();
      this.pendingReplies.set(channelId, pending);
      
      const mediaRecord = await this.mediaManager.rememberGeneratedMedia(String(ctx.chat.id), {
        type: 'video',
        mediaUrl: videoUrl,
        prompt,
        caption,
        messageId: sentMessage?.message_id || null,
        userId,
        source: 'telegram.generate_video',
        toolingState: {
          originalPrompt: prompt,
          enhancedPrompt: enhancedPrompt || prompt,
          aspectRatio: effectiveAspectRatio,
          model: 'veo-3.1-generate-preview',
          referenceMediaIds: referenceContext.recordIds,
          personaReference: referenceContext.personaReferenceUsed
        },
        metadata: {
          requestedBy: userId,
          requestedByUsername: username || null,
          aspectRatio: effectiveAspectRatio,
          contentDescription: prompt.slice(0, 200),
          triggeringMessageId: ctx.message?.message_id || null,
          referenceSources: referenceContext.sources
        }
      });
      this.logger?.info?.('[TelegramService] Video posted, marked as bot activity', {
        mediaId: mediaRecord?.id,
        aspectRatio: effectiveAspectRatio
      });
      return mediaRecord;

    } catch (error) {
      return await this._handleMediaError(ctx, error, 'video', userId);
    } finally {
      this._releaseVideoGenerationLock(channelId, traceId);
    }
  }

  /**
   * Queue video generation asynchronously and return immediately.
   * 
   * This method queues a video generation job to the database and returns immediately,
   * avoiding the 90-second Telegraf handler timeout. The video job worker will process
   * the job and deliver the result when ready.
   * 
   * @param {Object} ctx - Telegram context
   * @param {string} prompt - Video generation prompt
   * @param {Object} options - Additional options
   * @param {string} [options.conversationContext] - Context for prompt enhancement
   * @param {string} [options.userId] - User ID for tracking
   * @param {string} [options.username] - Username for tracking
   * @param {string} [options.keyframeUrl] - Pre-generated keyframe URL
   * @param {string} [options.aspectRatio='9:16'] - Aspect ratio
   * @param {string} [options.style] - Visual style
   * @param {string} [options.camera] - Camera motion
   * @param {string} [options.negativePrompt] - Things to avoid
   * @returns {Promise<Object>} - Job queue result { queued: true, jobId: string }
   */
  async queueVideoGenerationAsync(ctx, prompt, options = {}) {
    const channelId = String(ctx.chat.id);
    const { 
      conversationContext = '', 
      userId = null, 
      username = null, 
      aspectRatio = '9:16',
      style = null,
      camera = null,
      negativePrompt = null,
      referenceMediaIds = [],
      fallbackReferenceMediaId = null
    } = options;
    const traceId = generateTraceId();
    const lockAcquired = this._acquireVideoGenerationLock(channelId, traceId);
    if (!lockAcquired) {
      await ctx.reply('🎬 I\'m still finishing your last video—hang tight and I\'ll deliver it soon.');
      return { queued: false, error: 'in_progress' };
    }
    
    try {
      // Check rate limits before queuing
      if (userId) {
        const limitCheck = await this.checkMediaGenerationLimit(userId, 'video');
        if (!limitCheck.allowed) {
          const timeUntilReset = limitCheck.hourlyUsed >= limitCheck.hourlyLimit
            ? Math.ceil((limitCheck.resetTimes.hourly - new Date()) / 60000)
            : Math.ceil((limitCheck.resetTimes.daily - new Date()) / 60000);
          const message = `🎬 Video generation charges are fully used up right now.\n\n` +
            `Hourly: ${limitCheck.hourlyUsed}/${limitCheck.hourlyLimit} used\n` +
            `Daily: ${limitCheck.dailyUsed}/${limitCheck.dailyLimit} used\n\n` +
            `⏰ Next charge available in ${timeUntilReset} minutes`;
          await ctx.reply(message);
          return { queued: false, error: 'rate_limit', message };
        }
      }

      // Apply Veo prompt enhancement if available
      let enhancedPrompt = prompt;
      if (this.veoService?.enhanceVideoPrompt) {
        const charDesignConfig = this.globalBotService?.bot?.globalBotConfig?.characterDesign;
        enhancedPrompt = this.veoService.enhanceVideoPrompt(prompt, {
          style,
          camera,
          characterDescription: charDesignConfig?.enabled ? charDesignConfig.characterDescription : null
        });
      }
      const referenceContext = await this._collectReferenceImages(channelId, {
        explicitIds: referenceMediaIds,
        fallbackId: fallbackReferenceMediaId
      });
      const effectiveAspectRatio = referenceContext.urls.length ? '16:9' : aspectRatio;
      const resolvedStyle = style || VIDEO_DEFAULTS.STYLE;
      const resolvedCamera = camera || VIDEO_DEFAULTS.CAMERA;

      // Store the video job in the database for async processing
      const db = await this.databaseService.getDatabase();
      const now = new Date();
      
      // Build negative prompt if not provided
      const negativePromptStr = negativePrompt || (this.veoService?.buildNegativePrompt ? this.veoService.buildNegativePrompt([]) : null);
      
      const jobDoc = {
        type: 'telegram-video',
        status: 'queued',
        platform: 'telegram',
        createdAt: now,
        updatedAt: now,
        nextRunAt: now,
        attempts: 0,
        prompt: enhancedPrompt,
        originalPrompt: prompt,
        referenceImageUrls: referenceContext.urls,
        channelId,
        chatId: ctx.chat.id,
        userId,
        username,
        conversationContext: conversationContext.slice(0, 2000), // Limit context size
        aspectRatio: effectiveAspectRatio,
        style: resolvedStyle,
        camera: resolvedCamera,
        negativePrompt: negativePromptStr,
        triggeringMessageId: ctx?.message?.message_id || null,
        config: {
          aspectRatio: effectiveAspectRatio,
          numberOfVideos: 1,
          durationSeconds: 8,
          negativePrompt: negativePromptStr
        },
        referenceSources: referenceContext.sources,
        personaReferenceUsed: referenceContext.personaReferenceUsed,
        lockTraceId: traceId,
        result: null,
        lastError: null,
      };
      
      const result = await db.collection('telegram_video_jobs').insertOne(jobDoc);
      const jobId = result.insertedId?.toString() || 'unknown';
      
      this.logger?.info?.(`[TelegramService] Queued async video job: ${jobId}`, { 
        channelId,
        userId,
        referenceCount: referenceContext.urls.length,
        referenceSources: referenceContext.sources
      });

      // Acknowledge immediately
      await ctx.reply('🎬 Video generation queued! This takes 2-5 minutes. I\'ll send it when ready...');
      
      // Record usage preemptively (will be adjusted if job fails)
      if (userId && username) {
        await this._recordMediaUsage(userId, username, 'video');
      }

      // Kick off the video job processing (fire and forget)
      this._processVideoJobAsync(jobId, ctx).catch(err => {
        this.logger?.error?.('[TelegramService] Background video job failed:', err.message);
      });

      return { queued: true, jobId };
      
    } catch (error) {
      this.logger?.error?.('[TelegramService] Failed to queue video job:', error.message);
      await ctx.reply('Sorry, there was an error queueing your video. Please try again.');
      this._releaseVideoGenerationLock(channelId, traceId);
      return { queued: false, error: error.message };
    }
  }

  /**
   * Process a video job asynchronously (runs outside the Telegraf handler timeout)
   * @private
   * @param {string} jobId - The job ID to process
   * @param {Object} _ctx - Telegram context (unused - we use stored chatId)
   */
  async _processVideoJobAsync(jobId, _ctx) {
    const db = await this.databaseService.getDatabase();
    const collection = db.collection('telegram_video_jobs');
    
    // Claim the job
    const job = await collection.findOneAndUpdate(
      { _id: new (await import('mongodb')).ObjectId(jobId), status: 'queued' },
      { $set: { status: 'processing', startedAt: new Date(), updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    
    if (!job) {
      this.logger?.warn?.(`[TelegramService] Video job ${jobId} not found or already claimed`);
      return;
    }

    const jobData = job;
    
    try {
      this.logger?.info?.(`[TelegramService] Processing video job ${jobId}...`);
      
      // Generate the video
      let videoUrls;
      const referenceUrls = Array.isArray(jobData.referenceImageUrls) ? jobData.referenceImageUrls.filter(Boolean) : [];
      
      if (referenceUrls.length && this.veoService?.generateVideosWithReferenceImages) {
        try {
          const referenceImages = [];
          for (const url of referenceUrls) {
            if (referenceImages.length >= MAX_REFERENCE_IMAGES) break;
            const data = await this._downloadImageAsBase64(url);
            if (data?.data) {
              referenceImages.push({ data: data.data, mimeType: data.mimeType || 'image/png' });
            }
          }
          if (referenceImages.length) {
            const referenceConfig = {
              ...(jobData.config || {}),
              aspectRatio: '16:9',
              durationSeconds: 8
            };
            videoUrls = await this.veoService.generateVideosWithReferenceImages({
              prompt: jobData.prompt,
              referenceImages,
              config: referenceConfig
            });
          }
        } catch (err) {
          this.logger?.warn?.('[TelegramService] Reference video generation failed, falling back:', err.message);
        }
      }
      
      // Fallback to text-to-video
      if (!videoUrls?.length && this.veoService) {
        videoUrls = await this.veoService.generateVideos({
          prompt: jobData.prompt,
          config: jobData.config || { aspectRatio: '16:9', numberOfVideos: 1 }
        });
      }
      
      const videoUrl = videoUrls[0];
      
      // Generate caption
      let caption = null;
      if (this.globalBotService) {
        try {
          const captionPrompt = `You're a helpful, friendly narrator bot in CosyWorld. You just generated a video based on this prompt: "${jobData.prompt}"

Recent conversation context:
${jobData.conversationContext || 'No recent context'}

Create a brief, natural caption for the video. The caption should:
- Be conversational and warm, not mechanical
- Reference what the video shows WITHOUT repeating the technical prompt verbatim
- Be subtle and artistic, hint at the content rather than describing it literally
- Keep it under 100 characters
- Don't use asterisks or markdown

Examples:
- "Watch this moment unfold..."
- "A brief glimpse into motion 🎬"
- "Sometimes you need to see it move"
- "Here's what I imagined in motion ✨"

Your caption:`;

          const captionResponse = await this.aiService.chat([
            { role: 'user', content: captionPrompt }
          ], {
            model: this.globalBotService?.bot?.model || 'anthropic/claude-sonnet-4.5',
            temperature: 0.9
          });
          
          caption = String(captionResponse || '').trim().replace(/^["']|["']$/g, '');
        } catch (err) {
          this.logger?.warn?.('[TelegramService] Failed to generate natural caption:', err.message);
        }
      }

      // Send the video with natural caption
      const sentMessage = await this.globalBot.telegram.sendVideo(jobData.chatId, videoUrl, {
        caption: caption ? this._formatTelegramMarkdown(caption) : '🎬 Here\'s your video!',
        supports_streaming: true,
        parse_mode: 'HTML'
      });
      
      // Mark job as completed
      await collection.updateOne(
        { _id: new (await import('mongodb')).ObjectId(jobId) },
        { 
          $set: { 
            status: 'completed', 
            completedAt: new Date(),
            updatedAt: new Date(),
            result: { videoUrl, messageId: sentMessage.message_id }
          } 
        }
      );
      
      // Store the media record
      await this._rememberGeneratedMedia(jobData.channelId, {
        type: 'video',
        mediaUrl: videoUrl,
        prompt: jobData.prompt,
        caption,
        messageId: sentMessage?.message_id || null,
        userId: jobData.userId,
        source: 'telegram.generate_video_async',
        toolingState: {
          originalPrompt: jobData.prompt,
          enhancedPrompt: jobData.prompt,
          referenceMediaIds: [],
          personaReference: jobData.personaReferenceUsed,
          model: 'veo-3.1-generate-preview'
        },
        metadata: {
          jobId,
          requestedBy: jobData.userId,
          requestedByUsername: jobData.username,
          aspectRatio: jobData.aspectRatio || '16:9',
          referenceSources: jobData.referenceSources || []
        },
        // Enhanced content awareness fields
        contentDescription: `Video generated with character references: ${jobData.prompt?.slice(0, 200) || 'video content'}`,
        triggeringMessageId: jobData.triggeringMessageId || null
      });
      
      this.logger?.info?.(`[TelegramService] Video job ${jobId} completed successfully`);
      this._releaseVideoGenerationLock(jobData.channelId, jobData.lockTraceId);
      
    } catch (error) {
      this.logger?.error?.(`[TelegramService] Video job ${jobId} failed:`, error.message);
      
      // Update job status
      const attempts = (jobData.attempts || 0) + 1;
      const status = attempts >= 3 ? 'failed' : 'queued';
      const nextRunAt = status === 'queued' ? new Date(Date.now() + 60_000 * attempts) : null;
      
      await collection.updateOne(
        { _id: new (await import('mongodb')).ObjectId(jobId) },
        { 
          $set: { 
            status, 
            attempts, 
            lastError: error.message,
            updatedAt: new Date(),
            nextRunAt
          } 
        }
      );
      
      // Notify user of failure (only on final failure)
      if (status === 'failed') {
        try {
          await this.globalBot.telegram.sendMessage(
            jobData.chatId, 
            '❌ Sorry, video generation failed after multiple attempts. Please try again later.'
          );
        } catch {}
        this._releaseVideoGenerationLock(jobData.channelId, jobData.lockTraceId);
      } else {
        this._refreshVideoGenerationLock(jobData.channelId, jobData.lockTraceId);
      }
    }
  }

  /**
   * Execute image editing using Gemini's image editing capabilities
   * @param {Object} ctx - Telegram context
   * @param {Object} opts - Edit options
   * @param {string} opts.prompt - Edit instruction
   * @param {string} opts.sourceMediaId - Source media ID to edit
   * @param {string} [opts.conversationContext] - Conversation context
   * @param {string} [opts.userId] - User ID
   * @param {string} [opts.username] - Username
   * @returns {Promise<Object|null>} - New media record or null
   */
  async executeImageEdit(ctx, { prompt, sourceMediaId, _conversationContext = '', userId = null, username = null }) {
    const channelId = String(ctx.chat.id);
    try {
      // Find the source media
      const sourceMedia = await this._getMediaById(channelId, sourceMediaId);
      if (!sourceMedia) {
        await ctx.reply('I couldn\'t find the image to edit. Try generating a new one first! 🔍');
        await this.memberManager.recordBotResponse(channelId, userId);
        return null;
      }

      if (sourceMedia.type !== 'image' && sourceMedia.type !== 'keyframe') {
        await ctx.reply('I can only edit images, not videos. Let me know if you want to generate a new image instead!');
        await this.memberManager.recordBotResponse(channelId, userId);
        return null;
      }

      this.logger?.info?.('[TelegramService] Editing image:', { sourceMediaId, prompt });

      // Use MediaGenerationManager
      let result;
      try {
        result = await this.mediaGenerationManager.editImage({
          prompt,
          imageUrl: sourceMedia.mediaUrl,
          source: 'telegram.edit_image',
          originalPrompt: sourceMedia.prompt
        });
      } catch (err) {
        this.logger?.warn?.('[TelegramService] Image edit failed:', err.message);
        await ctx.reply('The edit didn\'t work out. Let\'s try something else! 🎨');
        await this.memberManager.recordBotResponse(channelId, userId);
        return null;
      }

      const { imageUrl: editedImageUrl, enhancedPrompt } = result;

      // Generate a natural caption
      let caption = `✏️ Edited: ${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}`;

      // Send the edited image
      const sentMessage = await ctx.telegram.sendPhoto(ctx.chat.id, editedImageUrl, {
        caption: this._formatTelegramMarkdown(caption),
        parse_mode: 'HTML'
      });

      await this.memberManager.recordBotResponse(channelId, userId);

      // Record usage
      if (userId && username) {
        await this._recordMediaUsage(userId, username, 'image');
      }

      // Remember the edited media with origin tracking
      const mediaRecord = await this._rememberGeneratedMedia(channelId, {
        type: 'image',
        mediaUrl: editedImageUrl,
        prompt: prompt,
        caption,
        messageId: sentMessage?.message_id || null,
        userId,
        source: 'telegram.edit_image',
        originMediaId: sourceMediaId,
        derivationDepth: (sourceMedia.derivationDepth || 0) + 1,
        toolingState: {
          originalPrompt: prompt,
          enhancedPrompt,
          referenceMediaIds: [sourceMediaId],
          model: 'gemini-3-pro-image-preview'
        },
        metadata: {
          requestedBy: userId,
          requestedByUsername: username || null,
          editType: 'gemini_compose'
        }
      });

      this.logger?.info?.('[TelegramService] Image edit completed', { mediaId: mediaRecord?.id });
      return mediaRecord;

    } catch (error) {
      this.logger?.error?.('[TelegramService] Image edit failed:', error);
      await ctx.reply('The edit didn\'t work out. Let\'s try something else! 🎨');
      await this.memberManager.recordBotResponse(channelId, userId);
      return null;
    }
  }

  /**
   * Execute video generation from an existing image/keyframe
   * @param {Object} ctx - Telegram context
   * @param {Object} opts - Generation options
   * @param {string} opts.prompt - Video generation prompt
   * @param {string} opts.sourceMediaId - Source image/keyframe ID
   * @param {string} [opts.conversationContext] - Conversation context
   * @param {string} [opts.userId] - User ID
   * @param {string} [opts.username] - Username
   * @param {string} [opts.aspectRatio='16:9'] - Aspect ratio (16:9 or 9:16)
   * @returns {Promise<Object|null>} - New media record or null
   */
  async executeVideoFromImage(ctx, { prompt, sourceMediaId, _conversationContext = '', userId = null, username = null, aspectRatio = '16:9' }) {
    const channelId = String(ctx.chat.id);
    try {
      if (!this.veoService) {
        await ctx.reply('Video generation isn\'t available right now. 🎬');
        await this.memberManager.recordBotResponse(channelId, userId);
        return null;
      }

      // Find the source image
      const sourceMedia = await this._getMediaById(channelId, sourceMediaId);
      if (!sourceMedia) {
        await ctx.reply('I couldn\'t find the image to animate. Try generating a new one first! 🖼️');
        await this.memberManager.recordBotResponse(channelId, userId);
        return null;
      }

      if (sourceMedia.type !== 'image' && sourceMedia.type !== 'keyframe') {
        await ctx.reply('I need an image to create a video from. This looks like a video already!');
        await this.memberManager.recordBotResponse(channelId, userId);
        return null;
      }

      // Check derivation depth limit (max 20 extensions per Veo docs)
      const currentDepth = sourceMedia.derivationDepth || 0;
      if (currentDepth >= 20) {
        await ctx.reply('This video has been animated too many times! Try starting fresh with a new video. 🎬');
        await this.memberManager.recordBotResponse(channelId, userId);
        return null;
      }

      this.logger?.info?.('[TelegramService] Generating video from image:', { sourceMediaId, prompt });

      // Download the source image
      // Note: MediaGenerationManager handles download internally, but we check existence here
      // We can skip the download check if we trust the manager, but keeping it for now
      // to fail fast if the URL is invalid.
      
      // Generate video using MediaGenerationManager
      let videoUrls = [];
      try {
        videoUrls = await this.mediaGenerationManager.generateVideoFromImage({
          prompt,
          imageUrl: sourceMedia.mediaUrl,
          config: {
            numberOfVideos: 1,
            aspectRatio: aspectRatio,
            durationSeconds: 8
          }
        });
      } catch (err) {
        this.logger?.warn?.('[TelegramService] Video from image failed:', err.message);
        // Check for quota exhaustion
        if (err?.message?.includes('quota') || err?.message?.includes('RESOURCE_EXHAUSTED')) {
          this._markServiceAsExhausted('video', 60 * 60 * 1000);
          await ctx.reply('🚫 Video generation quota reached. Try again in an hour!');
          await this.memberManager.recordBotResponse(channelId, userId);
          return null;
        }
      }

      if (!videoUrls || videoUrls.length === 0) {
        await ctx.reply('The video generation didn\'t work out. Let\'s try again! 🎬');
        await this.memberManager.recordBotResponse(channelId, userId);
        return null;
      }

      const videoUrl = videoUrls[0];
      this.logger?.info?.('[TelegramService] Video from image generated:', { videoUrl });

      // Generate caption
      const caption = `🎬 Animated from keyframe: ${prompt.substring(0, 40)}${prompt.length > 40 ? '...' : ''}`;

      // Send the video
      const sentMessage = await ctx.telegram.sendVideo(ctx.chat.id, videoUrl, {
        caption: this._formatTelegramMarkdown(caption),
        supports_streaming: true,
        parse_mode: 'HTML'
      });

      await this.memberManager.recordBotResponse(channelId, userId);

      // Record usage
      if (userId && username) {
        await this._recordMediaUsage(userId, username, 'video');
      }

      // Remember with origin tracking
      const mediaRecord = await this._rememberGeneratedMedia(channelId, {
        type: 'video',
        mediaUrl: videoUrl,
        prompt,
        caption,
        messageId: sentMessage?.message_id || null,
        userId,
        source: 'telegram.video_from_image',
        originMediaId: sourceMediaId,
        derivationDepth: (sourceMedia.derivationDepth || 0) + 1,
        toolingState: {
          originalPrompt: prompt,
          enhancedPrompt: prompt, // MediaGenerationManager handles enhancement internally
          referenceMediaIds: [sourceMediaId],
          model: 'veo-3.1-generate-preview'
        },
        metadata: {
          requestedBy: userId,
          requestedByUsername: username || null,
          sourceImageUrl: sourceMedia.mediaUrl,
          aspectRatio: aspectRatio
        },
        // Enhanced content awareness fields
        contentDescription: `Video generated: ${prompt?.slice(0, 200) || 'video content'}`,
        triggeringMessageId: ctx?.message?.message_id || null
      });

      this.logger?.info?.('[TelegramService] Video from image completed', { mediaId: mediaRecord?.id });
      return mediaRecord;

    } catch (error) {
      this.logger?.error?.('[TelegramService] Video from image failed:', error);
      await ctx.reply('Something went wrong creating the video. Let\'s try again! 🎬');
      await this.memberManager.recordBotResponse(channelId, userId);
      return null;
    }
  }

  /**
   * Execute video extension using Veo
   * @param {Object} ctx - Telegram context
   * @param {Object} opts - Extension options
   * @param {string} opts.prompt - Extension prompt
   * @param {string} opts.sourceMediaId - Source video ID to extend
   * @param {string} [opts.conversationContext] - Conversation context
   * @param {string} [opts.userId] - User ID
   * @param {string} [opts.username] - Username
   * @returns {Promise<Object|null>} - New media record or null
   */
  async executeVideoExtension(ctx, { prompt, sourceMediaId, _conversationContext = '', userId = null, username = null }) {
    const channelId = String(ctx.chat.id);
    try {
      if (!this.veoService?.extendVideo) {
        await ctx.reply('Video extension isn\'t available right now. 🎬');
        await this.memberManager.recordBotResponse(channelId, userId);
        return null;
      }

      // Find the source video
      const sourceMedia = await this._getMediaById(channelId, sourceMediaId);
      if (!sourceMedia) {
        await ctx.reply('I couldn\'t find the video to extend. Try generating one first! 🎬');
        await this.memberManager.recordBotResponse(channelId, userId);
        return null;
      }

      if (sourceMedia.type !== 'video' && sourceMedia.type !== 'clip') {
        await ctx.reply('I can only extend videos, not images. Want me to create a video first?');
        await this.memberManager.recordBotResponse(channelId, userId);
        return null;
      }

      // Check derivation depth limit (max 20 extensions per Veo docs)
      const currentDepth = sourceMedia.derivationDepth || 0;
      if (currentDepth >= 20) {
        await ctx.reply('This video has been extended too many times! Try starting fresh with a new video. 🎬');
        await this.memberManager.recordBotResponse(channelId, userId);
        return null;
      }

      this.logger?.info?.('[TelegramService] Extending video:', { sourceMediaId, prompt, currentDepth });

      // Apply character prompt enhancement
      const { prompt: enhancedPrompt } = this._applyCharacterPrompt(prompt);

      // Extend the video
      let extendedUrls = [];
      try {
        extendedUrls = await this.veoService.extendVideo({
          videoUrl: sourceMedia.mediaUrl,
          prompt: enhancedPrompt,
          config: {
            personGeneration: 'allow_all',
            durationSeconds: 8
          }
        });
      } catch (err) {
        this.logger?.warn?.('[TelegramService] Veo video extension failed:', err.message);
        if (err?.message?.includes('quota') || err?.message?.includes('RESOURCE_EXHAUSTED')) {
          this._markServiceAsExhausted('video', 60 * 60 * 1000);
          await ctx.reply('🚫 Video generation quota reached. Try again in an hour!');
          await this.memberManager.recordBotResponse(channelId, userId);
          return null;
        }
      }

      if (!extendedUrls || extendedUrls.length === 0) {
        await ctx.reply('The video extension didn\'t work out. The original video might not be compatible. 🎬');
        await this.memberManager.recordBotResponse(channelId, userId);
        return null;
      }

      const videoUrl = extendedUrls[0];
      this.logger?.info?.('[TelegramService] Video extended:', { videoUrl });

      // Generate caption
      const caption = `🎬 Extended: ${prompt.substring(0, 40)}${prompt.length > 40 ? '...' : ''} (${currentDepth + 1}/20)`;

      // Send the extended video
      const sentMessage = await ctx.telegram.sendVideo(ctx.chat.id, videoUrl, {
        caption: this._formatTelegramMarkdown(caption),
        supports_streaming: true,
        parse_mode: 'HTML'
      });

      await this.memberManager.recordBotResponse(channelId, userId);

      // Record usage
      if (userId && username) {
        await this._recordMediaUsage(userId, username, 'video');
      }

      // Remember with origin tracking
      const mediaRecord = await this._rememberGeneratedMedia(channelId, {
        type: 'video',
        mediaUrl: videoUrl,
        prompt,
        caption,
        messageId: sentMessage?.message_id || null,
        userId,
        source: 'telegram.extend_video',
        originMediaId: sourceMediaId,
        derivationDepth: currentDepth + 1,
        toolingState: {
          originalPrompt: prompt,
          enhancedPrompt,
          referenceMediaIds: [sourceMediaId],
          model: 'veo-3.1-generate-preview'
        },
        metadata: {
          requestedBy: userId,
          requestedByUsername: username || null,
          sourceVideoUrl: sourceMedia.mediaUrl,
          extensionCount: currentDepth + 1
        },
        // Enhanced content awareness fields
        contentDescription: `Extended video (${currentDepth + 1}/20): ${sourceMedia.contentDescription || sourceMedia.prompt || prompt}`,
        triggeringMessageId: ctx?.message?.message_id || null
      });

      this.logger?.info?.('[TelegramService] Video extension completed', { mediaId: mediaRecord?.id, depth: currentDepth + 1 });
      return mediaRecord;

    } catch (error) {
      this.logger?.error?.('[TelegramService] Video extension failed:', error);
      await ctx.reply('Something went wrong extending the video. Let\'s try again! 🎬');
      await this.memberManager.recordBotResponse(channelId, userId);
      return null;
    }
  }

  /**
   * Execute video generation with reference images for character/subject consistency
   * Uses Veo 3.1's reference image feature to preserve appearance across generations
   * @param {Object} ctx - Telegram context
   * @param {Object} opts - Generation options
   * @param {string} opts.prompt - Video generation prompt
   * @param {string[]} opts.referenceMediaIds - Array of 1-3 media IDs to use as references
   * @param {string} [opts.conversationContext] - Conversation context
   * @param {string} [opts.userId] - User ID
   * @param {string} [opts.username] - Username
   * @param {string} [opts.style] - Visual style
   * @param {string} [opts.camera] - Camera motion/position
   * @returns {Promise<Object|null>} - Media record or null
   */
  async executeVideoWithReference(ctx, { prompt, referenceMediaIds, _conversationContext = '', userId = null, username = null, style = null, camera = null }) {
    const channelId = String(ctx.chat.id);
    try {
      if (!this.veoService?.generateVideosWithReferenceImages) {
        await ctx.reply('Video generation with reference images isn\'t available right now. 🎭');
        await this.memberManager.recordBotResponse(channelId, userId);
        return null;
      }

      if (!Array.isArray(referenceMediaIds) || referenceMediaIds.length === 0 || referenceMediaIds.length > 3) {
        await ctx.reply('I need 1-3 reference images for character consistency. Try again with valid media IDs!');
        await this.memberManager.recordBotResponse(channelId, userId);
        return null;
      }

      // Load reference images
      const referenceImages = [];
      for (const mediaId of referenceMediaIds) {
        const media = await this._getMediaById(channelId, mediaId);
        if (!media || media.type !== 'image') {
          this.logger?.warn?.(`[TelegramService] Reference media ${mediaId} not found or not an image`);
          continue;
        }
        
        try {
          const imageData = await this.s3Service.downloadImage(media.mediaUrl);
          if (imageData) {
            referenceImages.push({
              data: imageData.toString('base64'),
              mimeType: media.mimeType || 'image/png',
              referenceType: 'asset' // Use as character/subject reference
            });
          }
        } catch (err) {
          this.logger?.warn?.(`[TelegramService] Failed to load reference image ${mediaId}:`, err.message);
        }
      }

      if (referenceImages.length === 0) {
        await ctx.reply('I couldn\'t load any of the reference images. Try generating new ones!');
        await this.memberManager.recordBotResponse(channelId, userId);
        return null;
      }

      this.logger?.info?.('[TelegramService] Generating video with reference images:', { 
        prompt, 
        referenceCount: referenceImages.length 
      });

      // Build enhanced prompt using Veo best practices
      let enhancedPrompt = prompt;
      if (this.veoService.enhanceVideoPrompt) {
        const charDesign = this.globalBotService?.bot?.globalBotConfig?.characterDesign;
        enhancedPrompt = this.veoService.enhanceVideoPrompt(prompt, {
          style: style || 'cinematic',
          camera,
          characterDescription: charDesign?.enabled ? charDesign.characterDescription : null
        });
      }

      // Generate video with reference images (requires 16:9, 8s)
      let videoUrls = [];
      try {
        videoUrls = await this.veoService.generateVideosWithReferenceImages({
          prompt: enhancedPrompt,
          referenceImages,
          config: {
            aspectRatio: '16:9', // Required for reference images
            durationSeconds: 8,  // Required for reference images
            numberOfVideos: 1
          }
        });
      } catch (err) {
        this.logger?.warn?.('[TelegramService] Veo reference video failed:', err.message);
        if (err?.message?.includes('quota') || err?.message?.includes('RESOURCE_EXHAUSTED')) {
          this._markServiceAsExhausted('video', 60 * 60 * 1000);
          await ctx.reply('🚫 Video generation quota reached. Try again in an hour!');
          await this.memberManager.recordBotResponse(channelId, userId);
          return null;
        }
      }

      if (!videoUrls || videoUrls.length === 0) {
        await ctx.reply('The video generation with references didn\'t work out. Let\'s try again! 🎭');
        await this.memberManager.recordBotResponse(channelId, userId);
        return null;
      }

      const videoUrl = videoUrls[0];
      this.logger?.info?.('[TelegramService] Video with references generated:', { videoUrl });

      // Generate caption
      const caption = `🎭 Video with character reference: ${prompt.substring(0, 40)}${prompt.length > 40 ? '...' : ''}`;

      // Send the video
      const sentMessage = await ctx.telegram.sendVideo(ctx.chat.id, videoUrl, {
        caption: this._formatTelegramMarkdown(caption),
        supports_streaming: true,
        parse_mode: 'HTML'
      });

      await this.memberManager.recordBotResponse(channelId, userId);

      // Record usage
      if (userId && username) {
        await this._recordMediaUsage(userId, username, 'video');
      }

      // Remember with reference tracking
      const mediaRecord = await this._rememberGeneratedMedia(channelId, {
        type: 'video',
        mediaUrl: videoUrl,
        prompt,
        caption,
        messageId: sentMessage?.message_id || null,
        userId,
        source: 'telegram.video_with_reference',
        toolingState: {
          originalPrompt: prompt,
          enhancedPrompt,
          referenceMediaIds,
          model: 'veo-3.1-generate-preview',
          style,
          camera
        },
        metadata: {
          requestedBy: userId,
          requestedByUsername: username || null,
          referenceCount: referenceImages.length,
          aspectRatio: '16:9'
        },
        // Enhanced content awareness fields
        contentDescription: `Video with ${referenceImages.length} reference image(s): ${prompt?.slice(0, 150) || 'character video'}`,
        triggeringMessageId: ctx?.message?.message_id || null
      });

      this.logger?.info?.('[TelegramService] Video with reference completed', { mediaId: mediaRecord?.id });
      return mediaRecord;

    } catch (error) {
      this.logger?.error?.('[TelegramService] Video with reference failed:', error);
      await ctx.reply('Something went wrong creating the video with references. Let\'s try again! 🎭');
      await this.memberManager.recordBotResponse(channelId, userId);
      return null;
    }
  }

  /**
   * Execute video interpolation between first and last frames
   * Creates a smooth transition video between two keyframe images
   * @param {Object} ctx - Telegram context
   * @param {Object} opts - Interpolation options
   * @param {string} opts.prompt - Description of the transition
   * @param {string} opts.firstFrameMediaId - First frame image ID
   * @param {string} opts.lastFrameMediaId - Last frame image ID
   * @param {string} [opts.conversationContext] - Conversation context
   * @param {string} [opts.userId] - User ID
   * @param {string} [opts.username] - Username
   * @returns {Promise<Object|null>} - Media record or null
   */
  async executeVideoInterpolation(ctx, { prompt, firstFrameMediaId, lastFrameMediaId, _conversationContext = '', userId = null, username = null }) {
    const channelId = String(ctx.chat.id);
    try {
      if (!this.veoService?.generateVideosWithInterpolation) {
        await ctx.reply('Video interpolation isn\'t available right now. 🔄');
        await this.memberManager.recordBotResponse(channelId, userId);
        return null;
      }

      // Load first frame
      const firstFrameMedia = await this._getMediaById(channelId, firstFrameMediaId);
      if (!firstFrameMedia || firstFrameMedia.type !== 'image') {
        await ctx.reply('I couldn\'t find the first frame image. Try generating it first!');
        await this.memberManager.recordBotResponse(channelId, userId);
        return null;
      }

      // Load last frame
      const lastFrameMedia = await this._getMediaById(channelId, lastFrameMediaId);
      if (!lastFrameMedia || lastFrameMedia.type !== 'image') {
        await ctx.reply('I couldn\'t find the last frame image. Try generating it first!');
        await this.memberManager.recordBotResponse(channelId, userId);
        return null;
      }

      // Download both frames
      let firstFrameData, lastFrameData;
      try {
        const [firstBuffer, lastBuffer] = await Promise.all([
          this.s3Service.downloadImage(firstFrameMedia.mediaUrl),
          this.s3Service.downloadImage(lastFrameMedia.mediaUrl)
        ]);
        
        firstFrameData = {
          data: firstBuffer.toString('base64'),
          mimeType: firstFrameMedia.mimeType || 'image/png'
        };
        lastFrameData = {
          data: lastBuffer.toString('base64'),
          mimeType: lastFrameMedia.mimeType || 'image/png'
        };
      } catch (err) {
        this.logger?.warn?.('[TelegramService] Failed to load frame images:', err.message);
        await ctx.reply('I couldn\'t load the frame images. They may have expired. Try generating new ones!');
        await this.memberManager.recordBotResponse(channelId, userId);
        return null;
      }

      this.logger?.info?.('[TelegramService] Generating video interpolation:', { 
        prompt, 
        firstFrameId: firstFrameMediaId,
        lastFrameId: lastFrameMediaId
      });

      // Apply character prompt enhancement
      const { prompt: enhancedPrompt } = this._applyCharacterPrompt(prompt);

      // Generate interpolation video
      let videoUrls = [];
      try {
        videoUrls = await this.veoService.generateVideosWithInterpolation({
          prompt: enhancedPrompt,
          firstFrame: firstFrameData,
          lastFrame: lastFrameData,
          config: {
            durationSeconds: 8,
            personGeneration: 'allow_adult'
          }
        });
      } catch (err) {
        this.logger?.warn?.('[TelegramService] Veo interpolation failed:', err.message);
        if (err?.message?.includes('quota') || err?.message?.includes('RESOURCE_EXHAUSTED')) {
          this._markServiceAsExhausted('video', 60 * 60 * 1000);
          await ctx.reply('🚫 Video generation quota reached. Try again in an hour!');
          await this.memberManager.recordBotResponse(channelId, userId);
          return null;
        }
      }

      if (!videoUrls || videoUrls.length === 0) {
        await ctx.reply('The video interpolation didn\'t work out. Let\'s try again! 🔄');
        await this.memberManager.recordBotResponse(channelId, userId);
        return null;
      }

      const videoUrl = videoUrls[0];
      this.logger?.info?.('[TelegramService] Video interpolation generated:', { videoUrl });

      // Generate caption
      const caption = `🔄 Interpolation: ${prompt.substring(0, 40)}${prompt.length > 40 ? '...' : ''}`;

      // Send the video
      const sentMessage = await ctx.telegram.sendVideo(ctx.chat.id, videoUrl, {
        caption: this._formatTelegramMarkdown(caption),
        supports_streaming: true,
        parse_mode: 'HTML'
      });

      await this.memberManager.recordBotResponse(channelId, userId);

      // Record usage
      if (userId && username) {
        await this._recordMediaUsage(userId, username, 'video');
      }

      // Remember with frame tracking
      const mediaRecord = await this._rememberGeneratedMedia(channelId, {
        type: 'video',
        mediaUrl: videoUrl,
        prompt,
        caption,
        messageId: sentMessage?.message_id || null,
        userId,
        source: 'telegram.video_interpolation',
        toolingState: {
          originalPrompt: prompt,
          enhancedPrompt,
          referenceMediaIds: [firstFrameMediaId, lastFrameMediaId],
          model: 'veo-3.1-generate-preview'
        },
        metadata: {
          requestedBy: userId,
          requestedByUsername: username || null,
          firstFrameUrl: firstFrameMedia.mediaUrl,
          lastFrameUrl: lastFrameMedia.mediaUrl
        },
        contentDescription: `Video interpolation from "${firstFrameMedia.contentDescription || 'frame 1'}" to "${lastFrameMedia.contentDescription || 'frame 2'}": ${prompt?.slice(0, 100) || 'transition'}`,
        triggeringMessageId: ctx?.message?.message_id || null
      });

      this.logger?.info?.('[TelegramService] Video interpolation completed', { mediaId: mediaRecord?.id });
      return mediaRecord;

    } catch (error) {
      this.logger?.error?.('[TelegramService] Video interpolation failed:', error);
      await ctx.reply('Something went wrong with the interpolation. Let\'s try again! 🔄');
      await this.memberManager.recordBotResponse(channelId, userId);
      return null;
    }
  }

  /**
   * Execute tweet posting via XService using a previously generated media item
   * @param {Object} ctx - Telegram context
   * @param {Object} opts - Tweet payload
   * @param {string} opts.text - Tweet content
   * @param {string} opts.mediaId - Recent media identifier supplied by LLM
   * @param {string} opts.channelId - Channel ID
   * @param {string} opts.userId - User ID
   * @param {string} opts.username - Username
   */
  async executeTweetPost(ctx, { text, mediaId, channelId, userId, username }) {
    const normalizedChannelId = channelId ? String(channelId) : (ctx?.chat?.id ? String(ctx.chat.id) : null);
    try {
      if (!this.xService) {
        await ctx.reply('🚫 Tweeting isn\'t available right now.');
        return;
      }

      const tweetLimit = await this.checkMediaGenerationLimit(null, 'tweet');
      if (!tweetLimit.allowed) {
        const timeUntilReset = tweetLimit.hourlyUsed >= tweetLimit.hourlyLimit
          ? Math.ceil((tweetLimit.resetTimes.hourly - new Date()) / 60000)
          : Math.ceil((tweetLimit.resetTimes.daily - new Date()) / 60000);
        await ctx.reply(
          `🕊️ X posting is cooling down right now.\n\n` +
          `Hourly: ${tweetLimit.hourlyUsed}/${tweetLimit.hourlyLimit} used\n` +
          `Daily: ${tweetLimit.dailyUsed}/${tweetLimit.dailyLimit} used\n\n` +
          `⏰ Next post slot in ${timeUntilReset} minutes`
        );
        await this.memberManager.recordBotResponse(channelId, userId);
        return;
      }

      const trimmedText = String(text || '').trim();
      if (!trimmedText) {
        await ctx.reply('I need a short message to share on X. Try again with the caption you want.');
        await this.memberManager.recordBotResponse(channelId, userId);
        return;
      }

      if (!mediaId) {
        await ctx.reply('Please pick an image or video from my recent list (include the ID in brackets).');
        await this.memberManager.recordBotResponse(channelId, userId);
        return;
      }

      const mediaRecord = await this._findRecentMediaById(normalizedChannelId, mediaId);
      if (!mediaRecord) {
        await ctx.reply('I couldn\'t find that media ID anymore. Ask me to regenerate it or choose another one.');
        await this.memberManager.recordBotResponse(channelId, userId);
        return;
      }

      if (mediaRecord.tweetedAt) {
        await ctx.reply('That one\'s already been posted to X. Pick a different image or ask me to make a new one.');
        await this.memberManager.recordBotResponse(channelId, userId);
        return;
      }

      if (!mediaRecord.mediaUrl) {
        await ctx.reply('I lost the download link for that media. Let me create a new one.');
        await this.memberManager.recordBotResponse(channelId, userId);
        return;
      }

      const payload = {
        mediaUrl: mediaRecord.mediaUrl,
        text: trimmedText.slice(0, 270),
        type: mediaRecord.type === 'video' ? 'video' : 'image',
        source: 'telegram.tweet_tool',
        prompt: mediaRecord.prompt,
        context: mediaRecord.caption,
        metadata: {
          telegramChannelId: normalizedChannelId,
          telegramMediaId: mediaRecord.id,
          requestedBy: userId,
          requestedByUsername: username || null
        }
      };

      this.logger?.info?.('[TelegramService] Posting tweet via tool', {
        channelId: normalizedChannelId,
        userId,
        mediaId: mediaRecord.id
      });

      const result = await this.xService.postGlobalMediaUpdate(payload, { aiService: this.aiService });

      if (!result) {
        await ctx.reply('❌ I tried to tweet it but the X service is busy. Let\'s try again later.');
        await this.memberManager.recordBotResponse(normalizedChannelId, userId);
        return;
      }

      await this._markMediaAsTweeted(normalizedChannelId, mediaRecord.id, { tweetId: result.tweetId || null });

      if (result.tweetId && this.xService?.isValidTweetId && !this.xService.isValidTweetId(result.tweetId)) {
        this.logger?.error?.('[TelegramService] X returned an invalid tweet ID', { tweetId: result.tweetId, channelId: normalizedChannelId });
        await ctx.reply('⚠️ I posted the update, but the tweet link looks off. Please check the X account directly.');
        await this.memberManager.recordBotResponse(normalizedChannelId, userId);
        return;
      }

      const tweetUrl = result.tweetUrl || (this.xService?.buildTweetUrl ? this.xService.buildTweetUrl(result.tweetId) : null);
      await this._shareTweetResultToTelegram(ctx, {
        tweetUrl,
        tweetText: trimmedText,
        mediaRecord,
        channelId: normalizedChannelId,
        userId
      });
      await this._recordMediaUsage(userId, username, 'tweet');
    } catch (error) {
      this.logger?.error?.('[TelegramService] Tweet tool failed:', error);
      await ctx.reply('❌ Something went wrong sharing that. I\'ll try again later.');
      await this.memberManager.recordBotResponse(normalizedChannelId, userId);
    }
  }

  /**
   * Execute web research and return results to the conversation
   * Uses OpenRouter's :online suffix for model-agnostic web search grounding
   * @param {Object} ctx - Telegram context
   * @param {Object} options - Research options
   * @param {string} options.query - Search query
   * @param {string} options.conversationContext - Current conversation context for better search targeting
   * @param {string} options.channelId - Channel ID
   * @param {string} options.userId - User ID
   * @param {string} options.username - Username for personalization
   */
  async executeResearch(ctx, { query, conversationContext, channelId, userId, username }) {
    const normalizedChannelId = channelId ? String(channelId) : (ctx?.chat?.id ? String(ctx.chat.id) : null);
    
    try {
      if (!this.aiService) {
        await ctx.reply('🔍 Research capability is not available right now.');
        await this.memberManager.recordBotResponse(normalizedChannelId, userId);
        return null;
      }

      // Send typing indicator
      await ctx.sendChatAction('typing');

      const today = new Date().toISOString().split('T')[0];
      
      // Build context-aware search prompt
      const contextSection = conversationContext 
        ? `\n\nConversation context for better understanding:\n${conversationContext.slice(-1500)}`
        : '';
      
      const userContext = username ? ` (asked by ${username})` : '';
      
      const searchPrompt = `Today is ${today}. Search the web for: "${query}"${userContext}${contextSection}

Based on the search query and conversation context, provide:
1. Key facts and current information directly relevant to the query
2. Cite your sources with URLs where available
3. Any recent developments or breaking news
4. Practical insights the user can act on

Keep the response focused and actionable.`;

      this.logger?.info?.('[TelegramService] Executing research', { 
        query, 
        channelId: normalizedChannelId,
        hasContext: !!conversationContext,
        contextLength: conversationContext?.length || 0
      });

      // Use Perplexity's native web search model
      const response = await this.aiService.chat([
        { role: 'user', content: searchPrompt }
      ], {
        model: 'perplexity/sonar-pro-search', // Native web search model
        temperature: 0.3,
        web_search_options: {
          search_context_size: 'medium'
        }
      });

      if (!response) {
        await ctx.reply('🔍 I couldn\'t find relevant information for that query. Try rephrasing?');
        await this.memberManager.recordBotResponse(normalizedChannelId, userId);
        return null;
      }

      // Format and send the research results
      const formattedResponse = this._formatTelegramMarkdown(
        `🔍 <b>Research Results:</b> ${query}\n\n${response}`
      );

      await ctx.reply(formattedResponse, { parse_mode: 'HTML' });
      await this.memberManager.recordBotResponse(normalizedChannelId, userId);

      // Return the research results so they can be used in subsequent plan actions
      return {
        query,
        results: response,
        timestamp: Date.now()
      };

    } catch (error) {
      this.logger?.error?.('[TelegramService] Research failed:', error);
      await ctx.reply('🔍 Research hit a snag. Let me try a different approach...');
      await this.memberManager.recordBotResponse(normalizedChannelId, userId);
      return null;
    }
  }

  /**
   * Execute token stats lookup and send to channel
   * @param {Object} ctx - Telegram context
   * @param {string} tokenSymbol - Token symbol to look up
   * @param {string} channelId - Channel ID for context
   */
  async executeTokenStatsLookup(ctx, tokenSymbol, channelId) {
    try {
      this.logger?.info?.(`[TelegramService] Looking up stats for ${tokenSymbol}`);
      
      if (!this.buybotService) {
        await ctx.reply('📊 Token tracking service is not available right now.');
        return;
      }

      // Get tracked tokens for this channel
      const db = await this.databaseService.getDatabase();
      const trackedToken = await db.collection('buybot_tracked_tokens')
        .findOne({ 
          channelId, 
          active: true, 
          tokenSymbol: { $regex: new RegExp(`^${tokenSymbol}$`, 'i') }
        });

      if (!trackedToken) {
        await ctx.reply(`📊 ${tokenSymbol} is not currently tracked in this channel.\n\nUse /settings to add it!`);
        await this.memberManager.recordBotResponse(channelId, ctx.message?.from?.id ? String(ctx.message.from.id) : null);
        return;
      }

      // Fetch current price and market data
      const priceData = await this.buybotService.getTokenPrice(trackedToken.tokenAddress);
      
      if (!priceData || !priceData.price) {
        await ctx.reply(`📊 Unable to fetch current stats for ${tokenSymbol}. The token may not have pricing data available.`);
        return;
      }

      // Format numbers for readability
      const formatNumber = (num) => {
        if (!num) return 'N/A';
        if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`;
        if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
        if (num >= 1_000) return `$${(num / 1_000).toFixed(2)}K`;
        return `$${num.toFixed(2)}`;
      };

      const formatPrice = (price) => {
        if (!price) return 'N/A';
        if (price < 0.01) return `$${price.toFixed(6)}`;
        return `$${price.toFixed(4)}`;
      };

      const message = 
        `📊 *${trackedToken.tokenSymbol}* (${trackedToken.tokenName})\n\n` +
        `💰 Price: ${formatPrice(priceData.price)}\n` +
        `📈 Market Cap: ${formatNumber(priceData.marketCap)}\n` +
        `📊 24h Volume: ${formatNumber(priceData.volume24h)}\n\n` +
        `🔗 CA: \`${trackedToken.tokenAddress}\``;

      await ctx.reply(this._formatTelegramMarkdown(message), { parse_mode: 'HTML' });
      await this.memberManager.recordBotResponse(channelId, ctx.message?.from?.id ? String(ctx.message.from.id) : null);
      
      this.logger?.info?.(`[TelegramService] Sent stats for ${tokenSymbol}: price=$${priceData.price}, mcap=$${priceData.marketCap}`);

    } catch (error) {
      this.logger?.error?.('[TelegramService] Token stats lookup failed:', error);
      await ctx.reply(`❌ Sorry, I couldn't fetch stats for ${tokenSymbol}. Please try again later.`);
      await this.memberManager.recordBotResponse(channelId, ctx.message?.from?.id ? String(ctx.message.from.id) : null);
    }
  }

  /**
   * Check if an avatar has Telegram authentication
   */
  async isTelegramAuthorized(avatarId) {
    try {
      const db = await this.databaseService.getDatabase();
      const auth = await db.collection('telegram_auth').findOne({ avatarId });
      return !!auth?.botToken;
    } catch (error) {
      this.logger?.error?.('[TelegramService] Auth check error:', error.message);
      return false;
    }
  }

  /**
   * Get or create bot instance for an avatar
   */
  async getBotForAvatar(avatarId) {
    // Check cache first
    if (this.bots.has(avatarId)) {
      return this.bots.get(avatarId);
    }

    // Load from database
    const db = await this.databaseService.getDatabase();
    const auth = await db.collection('telegram_auth').findOne({ avatarId });
    
    if (!auth?.botToken) {
      return null;
    }

    try {
      const token = safeDecrypt(auth.botToken);
      // Configure Telegraf with extended handler timeout for long-running operations
      const bot = new Telegraf(token, {
        handlerTimeout: 600_000, // 10 minutes for video generation
      });
      
      // Store in cache
      this.bots.set(avatarId, bot);
      
      // Launch if not already running
      if (!bot.botInfo) {
        await bot.launch();
      }
      
      return bot;
    } catch (error) {
      this.logger?.error?.('[TelegramService] Failed to create bot for avatar:', error.message);
      return null;
    }
  }

  /**
   * Register a bot for an avatar
   */
  async registerAvatarBot(avatarId, botToken, channelId = null) {
    try {
      // Validate token by creating a bot instance
      const testBot = new Telegraf(botToken);
      const botInfo = await testBot.telegram.getMe();
      
      const db = await this.databaseService.getDatabase();
      await db.collection('telegram_auth').updateOne(
        { avatarId },
        {
          $set: {
            avatarId,
            botToken: encrypt(botToken),
            channelId: channelId || null,
            botUsername: botInfo.username,
            botId: botInfo.id,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );

      // Clear cache to force reload
      this.bots.delete(avatarId);
      this.logger?.info?.(`[TelegramService] Registered bot @${botInfo.username} for avatar ${avatarId}`);
      return { success: true, botUsername: botInfo.username };
    } catch (error) {
      this.logger?.error?.('[TelegramService] Bot registration failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Disconnect Telegram bot for an avatar
   */
  async disconnectAvatarBot(avatarId) {
    try {
      const db = await this.databaseService.getDatabase();
      const auth = await db.collection('telegram_auth').findOne({ avatarId });
      
      if (!auth) {
        return { success: false, error: 'No bot configured' };
      }

      // Stop the bot if running
      const bot = this.bots.get(avatarId);
      if (bot) {
        try {
          await bot.stop();
        } catch (e) {
          this.logger?.warn?.(`[TelegramService] Error stopping bot:`, e.message);
        }
        this.bots.delete(avatarId);
      }

      // Remove from database
      await db.collection('telegram_auth').deleteOne({ avatarId });

      this.logger?.info?.(`[TelegramService] Disconnected bot for avatar ${avatarId}`);
      return { success: true };
    } catch (error) {
      this.logger?.error?.('[TelegramService] Disconnect failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Post a message with optional media to Telegram
   */
  async postToTelegram(avatar, content, options = {}) {
    try {
      const avatarId = avatar._id.toString();
      const bot = await this.getBotForAvatar(avatarId);
      
      if (!bot) {
        return { success: false, error: 'Telegram bot not configured for this avatar' };
      }

      const db = await this.databaseService.getDatabase();
      const auth = await db.collection('telegram_auth').findOne({ avatarId });
      
      if (!auth?.channelId) {
        return { success: false, error: 'No channel configured for this bot' };
      }

      const channelId = auth.channelId;
      let messageResult;

      // Post with media if provided
      if (options.imageUrl) {
        messageResult = await bot.telegram.sendPhoto(channelId, options.imageUrl, {
          caption: this._formatTelegramMarkdown(content),
          parse_mode: 'HTML',
        });
      } else if (options.videoUrl) {
        messageResult = await bot.telegram.sendVideo(channelId, options.videoUrl, {
          caption: this._formatTelegramMarkdown(content),
          parse_mode: 'HTML',
        });
      } else {
        messageResult = await bot.telegram.sendMessage(channelId, this._formatTelegramMarkdown(content), {
          parse_mode: 'HTML',
        });
      }

      // Store in database
      await db.collection('social_posts').insertOne({
        avatarId: avatar._id,
        platform: 'telegram',
        content,
        imageUrl: options.imageUrl || null,
        videoUrl: options.videoUrl || null,
        messageId: messageResult.message_id,
        channelId,
        timestamp: new Date(),
      });

      return {
        success: true,
        messageId: messageResult.message_id,
        channelId,
      };
    } catch (error) {
      this.logger?.error?.('[TelegramService] Post failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Format text with Markdown for Telegram
   * Delegates to the utility function from telegram/utils.mjs
   * @param {string} text - Text to format
   * @returns {string} - HTML formatted text
   */
  _formatTelegramMarkdown(text) {
    return formatTelegramMarkdown(text, this.logger);
  }

  /**
   * Post to global Telegram channel/group
   * Used for automatic posting of generated media
   */
  async postGlobalMediaUpdate(opts = {}, services = {}) {
    try {
      this.logger?.info?.('[TelegramService][globalPost] attempt', {
        mediaUrl: opts.mediaUrl,
        type: opts.type || 'image',
        source: opts.source,
        avatarName: opts.avatarName,
        hasTweetUrl: !!opts.tweetUrl
      });

      // Initialize metrics if needed
      if (!this._globalPostMetrics) {
        this._globalPostMetrics = {
          attempts: 0,
          posted: 0,
          last: null,
          reasons: {
            posted: 0,
            disabled: 0,
            no_bot: 0,
            no_channel: 0,
            invalid_media_url: 0,
            hourly_cap: 0,
            min_interval: 0,
            error: 0,
          },
        };
      }

      const _bump = (reason, meta = {}) => {
        try {
          this._globalPostMetrics.attempts++;
          if (reason === 'posted') this._globalPostMetrics.posted++;
          if (this._globalPostMetrics.reasons[reason] !== undefined) {
            this._globalPostMetrics.reasons[reason]++;
          }
          this._globalPostMetrics.last = { at: Date.now(), reason, ...meta };
        } catch {}
      };

      // Load config
      const config = await this._loadGlobalPostingConfig();
      const enabled = config?.enabled ?? true;

      if (!enabled) {
        this.logger?.debug?.('[TelegramService][globalPost] skip: disabled');
        _bump('disabled', { mediaUrl: opts.mediaUrl });
        return null;
      }

      // Check for global bot
      if (!this.globalBot) {
        this.logger?.info?.('[TelegramService][globalPost] No global bot configured - skipping post');
        _bump('no_bot', { mediaUrl: opts.mediaUrl });
        return null;
      }
      
      this.logger?.info?.('[TelegramService][globalPost] Global bot is available');

      // Get channel ID from config or secrets
      let channelId = config?.channelId;
      
      if (!channelId && this.secretsService) {
        try {
          channelId = await this.secretsService.getAsync('telegram_global_channel_id');
        } catch {
          this.logger?.debug?.('[TelegramService][globalPost] No channel in secrets');
        }
      }
      
      // Fallback to config/env
      if (!channelId) {
        channelId = this.configService.get('TELEGRAM_GLOBAL_CHANNEL_ID') || process.env.TELEGRAM_GLOBAL_CHANNEL_ID;
      }

      if (!channelId) {
        this.logger?.info?.('[TelegramService][globalPost] No channel ID configured - please configure in admin UI');
        _bump('no_channel', { mediaUrl: opts.mediaUrl });
        return null;
      }
      
      this.logger?.info?.('[TelegramService][globalPost] Using channel:', channelId);

      const { mediaUrl, text, type = 'image' } = opts;
      
      // Initialize rate limiting tracker
      const now = Date.now();
      if (!this._globalRate) this._globalRate = { windowStart: now, count: 0, lastPostedAt: null };
      
      // For tweets (X posts), we just share the text + link, no media re-upload
      if (type === 'tweet' || opts.tweetUrl) {
        this.logger?.info?.('[TelegramService][globalPost] Posting tweet link');
        
        // Ensure text is a string (handle objects/undefined gracefully)
        const tweetText = (typeof text === 'string' && text.trim()) 
          ? text 
          : `Check out this post from CosyWorld!\n\n${opts.tweetUrl}`;
        
        const messageResult = await this.globalBot.telegram.sendMessage(channelId, this._formatTelegramMarkdown(tweetText), {
          parse_mode: 'HTML',
          disable_web_page_preview: false // Show preview
        });
        
        this._globalRate.count++;
        this._globalRate.lastPostedAt = Date.now();
        
        // Store in database
        const db = await this.databaseService.getDatabase();
        
        const metadata = {
          source: opts.source || 'x.post',
          type: opts.source === 'avatar.create' ? 'introduction' : 'general',
          tweetUrl: opts.tweetUrl,
          tweetId: opts.tweetId
        };
        
        if (opts.avatarId) {
          metadata.avatarId = String(opts.avatarId);
          metadata.avatarName = opts.avatarName || null;
          metadata.avatarEmoji = opts.avatarEmoji || null;
        }
        
        await db.collection('social_posts').insertOne({
          global: true,
          platform: 'telegram',
          messageId: messageResult.message_id,
          channelId,
          content: tweetText,
          metadata,
          createdAt: new Date(),
        });
        
        this.logger?.info?.('[TelegramService][globalPost] posted tweet link', {
          messageId: messageResult.message_id,
          channelId,
        });
        
        _bump('posted', { messageId: messageResult.message_id, tweetUrl: opts.tweetUrl });
        
        return {
          messageId: messageResult.message_id,
          channelId,
        };
      }
      
      // For regular media posts (images/videos), continue with existing logic
      if (!mediaUrl || !/^https?:\/\//i.test(mediaUrl)) {
        this.logger?.warn?.('[TelegramService][globalPost] Invalid mediaUrl');
        _bump('invalid_media_url', { mediaUrl });
        return null;
      }

      // Rate limiting (already initialized earlier)
      const hourMs = 3600_000;
      if (now - this._globalRate.windowStart >= hourMs) {
        this._globalRate.windowStart = now;
        this._globalRate.count = 0;
      }

      const hourlyCap = Number(config?.rate?.hourly) || 10;
      const minIntervalSec = Number(config?.rate?.minIntervalSec) || 10; // 60 seconds between posts

      if (this._globalRate.lastPostedAt && (now - this._globalRate.lastPostedAt) < (minIntervalSec * 1000)) {
        const nextInMs = (minIntervalSec * 1000) - (now - this._globalRate.lastPostedAt);
        this.logger?.info?.(`[TelegramService][globalPost] Min-interval gating: wait ${Math.ceil(nextInMs/1000)}s (last posted ${Math.ceil((now - this._globalRate.lastPostedAt)/1000)}s ago, min interval ${minIntervalSec}s)`);
        _bump('min_interval', { mediaUrl, minIntervalSec });
        return null;
      }

      if (this._globalRate.count >= hourlyCap) {
        this.logger?.info?.(`[TelegramService][globalPost] Hourly cap reached (${hourlyCap})`);
        _bump('hourly_cap', { mediaUrl, hourlyCap });
        return null;
      }

      // Generate caption
      let caption = String(text || '').trim();
      
      // Use AI to enhance caption if available
      if (!caption && services.aiService?.analyzeImage && type !== 'video') {
        try {
          let captionPrompt;
          
          if (opts.source === 'avatar.create' && opts.avatarName) {
            captionPrompt = `This is an introduction image for a new character in CosyWorld: ${opts.avatarEmoji || ''} ${opts.avatarName}.
Description: ${opts.prompt || 'A mysterious new arrival'}

Create a warm, welcoming introduction message (max 200 chars) that:
- Captures their essence and personality
- Makes people curious about them
- Uses a friendly, narrator-like tone
- Highlights what makes them unique`;
          } else {
            captionPrompt = 'Analyze this image and create an engaging caption (max 200 chars). Focus on what makes it interesting, unique, or worth sharing.';
          }
          
          const aiCaption = await services.aiService.analyzeImage(
            mediaUrl,
            type === 'image' ? 'image/png' : 'video/mp4',
            captionPrompt
          );
          if (aiCaption) caption = String(aiCaption).trim();
        } catch (e) {
          this.logger?.warn?.('[TelegramService][globalPost] Caption generation failed:', e.message);
        }
      }

      // Ensure hashtag
      if (!/#cosyworld/i.test(caption)) {
        caption = (caption).trim();
      }

      // Truncate to reasonable length
      caption = caption.slice(0, 1024);

      // Post to Telegram
      let messageResult;
      
      if (type === 'video') {
        // For videos, Telegram requires the file to be accessible
        // Send as a URL input - Telegram will fetch and process it
        this.logger?.info?.('[TelegramService][globalPost] Attempting to send video:', mediaUrl);
        try {
          // Add timeout for video uploads (Telegram can be slow to process)
          const videoPromise = this.globalBot.telegram.sendVideo(channelId, mediaUrl, {
            caption: this._formatTelegramMarkdown(caption),
            parse_mode: 'HTML',
            supports_streaming: true, // Enable streaming for better playback
          });
          
          // Set 30 second timeout
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Video send timeout after 30s')), 30000);
          });
          
          messageResult = await Promise.race([videoPromise, timeoutPromise]);
          this.logger?.info?.('[TelegramService][globalPost] Video posted successfully');
        } catch (videoErr) {
          // If video posting fails, try to send the thumbnail as fallback
          this.logger?.error?.('[TelegramService][globalPost] Video post failed:', videoErr.message);
          this.logger?.error?.('[TelegramService][globalPost] Video error details:', JSON.stringify({
            error: videoErr.message,
            code: videoErr.code,
            response: videoErr.response?.body
          }));
          
          // Try sending as document instead of video (bypasses Telegram video processing)
          this.logger?.info?.('[TelegramService][globalPost] Attempting to send as document instead...');
          try {
            messageResult = await this.globalBot.telegram.sendDocument(channelId, mediaUrl, {
              caption: this._formatTelegramMarkdown(caption + '\n\n🎥 Video file'),
              parse_mode: 'HTML',
            });
            this.logger?.info?.('[TelegramService][globalPost] Posted video as document successfully');
          } catch (docErr) {
            this.logger?.error?.('[TelegramService][globalPost] Document fallback also failed:', docErr.message);
            _bump('error', { mediaUrl, error: videoErr.message });
            throw videoErr; // Throw original error
          }
        }
      } else {
        this.logger?.info?.('[TelegramService][globalPost] Attempting to send photo:', mediaUrl);
        messageResult = await this.globalBot.telegram.sendPhoto(channelId, mediaUrl, {
          caption: this._formatTelegramMarkdown(caption),
          parse_mode: 'HTML',
        });
        this.logger?.info?.('[TelegramService][globalPost] Photo posted successfully');
      }

      this._globalRate.count++;
      this._globalRate.lastPostedAt = Date.now();

      // Store in database
      const db = await this.databaseService.getDatabase();
      
      const metadata = {
        source: opts.source || 'media.generation',
        type: opts.source === 'avatar.create' ? 'introduction' : 'general',
      };
      
      if (opts.avatarId) {
        metadata.avatarId = String(opts.avatarId);
        metadata.avatarName = opts.avatarName || null;
        metadata.avatarEmoji = opts.avatarEmoji || null;
      }
      
      if (opts.guildId) {
        metadata.guildId = opts.guildId;
      }

      await db.collection('social_posts').insertOne({
        global: true,
        platform: 'telegram',
        mediaUrl,
        mediaType: type === 'video' ? 'video' : 'image',
        messageId: messageResult.message_id,
        channelId,
        content: caption,
        metadata,
        createdAt: new Date(),
      });

      this.logger?.info?.('[TelegramService][globalPost] posted media', {
        messageId: messageResult.message_id,
        channelId,
      });
      
      _bump('posted', { messageId: messageResult.message_id, mediaUrl });

      return {
        messageId: messageResult.message_id,
        channelId,
      };
    } catch (error) {
      this.logger?.error?.('[TelegramService][globalPost] failed:', error?.message || error);
      try {
        this._globalPostMetrics.attempts++;
        this._globalPostMetrics.reasons.error++;
        this._globalPostMetrics.last = { at: Date.now(), reason: 'error', error: error?.message, mediaUrl: opts.mediaUrl };
      } catch {}
      return null;
    }
  }

  /**
   * Load (and cache briefly) the global posting config document
   */
  async _loadGlobalPostingConfig(force = false) {
    try {
      const ttlMs = 30_000; // 30s cache
      const now = Date.now();
      
      if (!force && this._globalPostCfg && (now - this._globalPostCfg._fetchedAt < ttlMs)) {
        return this._globalPostCfg.data;
      }
      
      const db = await this.databaseService.getDatabase();
      const doc = await db.collection('telegram_post_config').findOne({ _id: 'global' });
      const normalized = doc || null;
      
      this._globalPostCfg = { _fetchedAt: now, data: normalized };
      return normalized;
    } catch (e) {
      this.logger?.warn?.('[TelegramService] load global posting config failed:', e.message);
      return null;
    }
  }

  /**
   * Update global posting configuration
   */
  async updateGlobalPostingConfig(patch) {
    if (!patch || typeof patch !== 'object') {
      throw new Error('patch object required');
    }
    
    const db = await this.databaseService.getDatabase();
    await db.collection('telegram_post_config').updateOne(
      { _id: 'global' },
      { $set: { ...patch, updatedAt: new Date() } },
      { upsert: true }
    );
    
    // Invalidate cache
    this._globalPostCfg = null;
    return this._loadGlobalPostingConfig(true);
  }

  /**
   * Get global posting metrics
   */
  getGlobalPostingMetrics() {
    const m = this._globalPostMetrics || null;
    if (!m) return { initialized: false };
    
    return {
      initialized: true,
      attempts: m.attempts,
      posted: m.posted,
      reasons: { ...m.reasons },
      last: m.last ? { ...m.last } : null,
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    try {
      // Clear all pending reply timeouts
      for (const [channelId, pending] of this.pendingReplies.entries()) {
        if (pending.timeout) {
          clearTimeout(pending.timeout);
          this.logger?.debug?.(`[TelegramService] Cleared pending reply for channel ${channelId}`);
        }
      }
      this.pendingReplies.clear();

      // Stop global bot
      if (this.globalBot) {
        await this.globalBot.stop('SIGTERM');
        this.logger?.info?.('[TelegramService] Global bot stopped');
      }

      // Stop all avatar bots
      for (const [_avatarId, bot] of this.bots.entries()) {
        try {
          await bot.stop('SIGTERM');
        } catch (e) {
          this.logger?.warn?.(`[TelegramService] Error stopping bot:`, e.message);
        }
      }

      this.bots.clear();
      this.logger?.info?.('[TelegramService] All bots stopped');

      // Stop periodic cache cleanup
      this._stopCacheCleanup();

      this.telegramSpamTracker.clear();
      this._memberCache.clear();
    } catch (error) {
      this.logger?.error?.('[TelegramService] Shutdown error:', error.message);
    }
  }
}

export { TelegramService };
export default TelegramService;
