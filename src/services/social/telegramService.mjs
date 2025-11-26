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
import { decrypt, encrypt } from '../../utils/encryption.mjs';
import { setupBuybotTelegramCommands } from '../commands/buybotTelegramHandler.mjs';
import MarkdownIt from 'markdown-it';
import { MediaGenerationError, RateLimitError, ServiceUnavailableError } from '../../utils/errors.mjs';
import { PlanExecutionService } from '../planner/planExecutionService.mjs';
import { actionExecutorRegistry } from '../planner/actionExecutor.mjs';

// Tolerant decrypt: accepts plaintext or legacy formats, falls back to input on failure
function safeDecrypt(value) {
  try {
    if (!value) return '';
    // If value contains our GCM triplet separator, attempt decrypt; else treat as plaintext
    if (typeof value === 'string' && value.includes(':')) {
      return decrypt(value);
    }
    return String(value);
  } catch {
    // If decryption fails (e.g., rotated key), return as-is to allow user to reauth lazily
    return String(value || '');
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const htmlEntityMap = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

const decodeHtmlEntities = (value) => {
  if (!value || typeof value !== 'string') {
    return typeof value === 'undefined' || value === null ? '' : String(value);
  }

  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, entity) => {
    if (!entity) return match;
    const lower = entity.toLowerCase();

    if (lower.startsWith('#x')) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    }

    if (lower.startsWith('#')) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    }

    if (htmlEntityMap[lower]) {
      return htmlEntityMap[lower];
    }

    return match;
  });
};

const md = new MarkdownIt({
  html: false, // Disable HTML tags in source
  breaks: true, // Convert '\n' in paragraphs into <br>
  linkify: true // Autoconvert URL-like text to links
});

// Helper for escaping HTML in code blocks
const escapeHtml = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Custom renderer to ensure Telegram-compatible HTML
// Telegram supports: <b>, <i>, <u>, <s>, <a>, <code>, <pre>
// We need to map markdown to these specific tags
md.renderer.rules.strong_open = () => '<b>';
md.renderer.rules.strong_close = () => '</b>';
md.renderer.rules.em_open = () => '<i>';
md.renderer.rules.em_close = () => '</i>';
md.renderer.rules.s_open = () => '<s>';
md.renderer.rules.s_close = () => '</s>';
md.renderer.rules.code_inline = (tokens, idx) => `<code>${escapeHtml(tokens[idx].content)}</code>`;
md.renderer.rules.code_block = (tokens, idx) => `<pre><code>${escapeHtml(tokens[idx].content)}</code></pre>`;
md.renderer.rules.fence = (tokens, idx) => `<pre><code>${escapeHtml(tokens[idx].content)}</code></pre>`;

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
    this.bots = new Map(); // avatarId -> Telegraf instance
    this.globalBot = null;
    
    // Message debouncing: track pending replies per channel
    this.pendingReplies = new Map(); // channelId -> { timeout, lastMessageTime, messages }
    this.REPLY_DELAY_MS = 10000; // 10 seconds delay between messages
    
    // Conversation history for context
    this.conversationHistory = new Map(); // channelId -> array of recent messages
    this.HISTORY_LIMIT = 50; // Keep last 50 messages per channel for rich context
    
    // Media generation cooldown tracking (per user)
    // Limits: Videos: 2/hour, 4/day | Images: 3/hour, 100/day (Telegram-only counting)
    this.mediaGenerationLimits = {
      video: { hourly: 2, daily: 4 },
      image: { hourly: 3, daily: 100 },
      tweet: { hourly: 3, daily: 12 }
    };
    
    // Performance optimization: caching layer
    this._personaCache = { data: null, expiry: 0, ttl: 300000 }; // 5min TTL
    this._buybotCache = new Map(); // channelId -> { data, expiry }
    this.BUYBOT_CACHE_TTL = 60000; // 1min TTL

    // Spam prevention + membership tracking
    this.telegramSpamTracker = new Map(); // userId -> [timestamps]
    this.USER_PROBATION_MS = 5 * 60 * 1000; // 5 minutes probation window
    this.SPAM_WINDOW_MS = 10_000; // 10 second window for burst detection
    this.SPAM_THRESHOLD = 8; // 8 messages within window -> spam
    this.TELEGRAM_PENALTY_TIERS = [
      { strikes: 1, durationMs: 30_000, notice: 'First warning: please slow down (30s timeout applied).' },
      { strikes: 2, durationMs: 120_000, notice: 'Second warning: take a breather for 2 minutes.' },
      { strikes: 3, durationMs: 600_000, notice: 'Third warning: you are muted for 10 minutes.' },
      { strikes: 4, durationMs: 3_600_000, notice: 'Final warning: 1 hour cooldown before you can chat again.' },
      { strikes: 5, durationMs: Infinity, notice: 'Permanent ban for repeated spam. Contact a moderator to appeal.' }
    ];
    this.REPLY_DELAY_CONFIG = {
      mentioned: 2000, // 2 seconds for direct mentions
      default: 10000 // 10 seconds for gap responses / unsolicited chats
    };
    this.MEMBER_CACHE_TTL = 60000; // 60s cache for membership lookups
    this._memberCache = new Map(); // `${channelId}:${userId}` -> { record, expiry }

    // Media memory cache for tweet tool support
    this.recentMediaByChannel = new Map(); // channelId -> [mediaEntries]
    this.RECENT_MEDIA_LIMIT = 10;
    this.RECENT_MEDIA_MAX_AGE_MS = 72 * 60 * 60 * 1000; // 72h
    this.MEDIA_ID_PREFIX_MIN_LENGTH = 6; // allow short IDs from summaries

    // Agent planning context (for planner tool)
    this.agentPlansByChannel = new Map(); // channelId -> [planEntries]
    this.AGENT_PLAN_LIMIT = 5;
    
    // Phase 2: Initialize PlanExecutionService for refactored plan execution
    this.planExecutionService = new PlanExecutionService({
      logger: this.logger,
      executorRegistry: actionExecutorRegistry
    });
    
    // Flag to use new plan execution service (can be toggled for gradual rollout)
    this.USE_PLAN_EXECUTION_SERVICE = true;
    this.AGENT_PLAN_MAX_AGE_MS = 72 * 60 * 60 * 1000; // 72h
    
    // Async video generation: queue jobs instead of blocking the handler
    // Enable this if video generation frequently causes timeout errors
    const asyncVideoEnv = (process.env.TELEGRAM_ASYNC_VIDEO ?? 'true').toString().toLowerCase();
    this.USE_ASYNC_VIDEO_GENERATION = asyncVideoEnv === 'true' || asyncVideoEnv === '1' || asyncVideoEnv === 'yes';

    // Index tracking (ensures TTL/topic indexes exist automatically)
    this._indexesReady = false;
    this._indexSetupPromise = null;

    // Service exhaustion tracking (for API quotas)
    this._serviceExhausted = new Map(); // mediaType -> Date (expiry)

    // Active conversation tracking (for instant replies)
    this.activeConversations = new Map(); // channelId -> Map<userId, expiry>
    this.ACTIVE_CONVERSATION_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

    // Periodic cleanup configuration
    this.CACHE_CLEANUP_INTERVAL_MS = 60 * 1000; // Run every 60 seconds
    this.MAX_CONVERSATION_HISTORY_PER_CHANNEL = 100;
    this.MAX_CACHE_ENTRIES = 500;
    this._cleanupInterval = null;

    // Debounce lock tracking
    this._debounceLocks = new Map(); // channelId -> Promise (lock)
  }

  /**
   * Start periodic cache cleanup to prevent memory leaks
   * @private
   */
  _startCacheCleanup() {
    if (this._cleanupInterval) return;
    
    this._cleanupInterval = setInterval(() => {
      this._pruneAllCaches();
    }, this.CACHE_CLEANUP_INTERVAL_MS);
    
    this.logger?.info?.('[TelegramService] Started periodic cache cleanup');
  }

  /**
   * Stop periodic cache cleanup (call on shutdown)
   * @private
   */
  _stopCacheCleanup() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
      this.logger?.info?.('[TelegramService] Stopped periodic cache cleanup');
    }
  }

  /**
   * Prune all in-memory caches to prevent memory leaks
   * @private
   */
  _pruneAllCaches() {
    const now = Date.now();
    let totalPruned = 0;

    // 1. Prune conversation history - keep last N messages per channel
    for (const [channelId, history] of this.conversationHistory.entries()) {
      if (history.length > this.MAX_CONVERSATION_HISTORY_PER_CHANNEL) {
        const removed = history.length - this.MAX_CONVERSATION_HISTORY_PER_CHANNEL;
        this.conversationHistory.set(channelId, history.slice(-this.MAX_CONVERSATION_HISTORY_PER_CHANNEL));
        totalPruned += removed;
      }
    }

    // 2. Prune member cache - remove expired entries
    for (const [key, entry] of this._memberCache.entries()) {
      if (now > entry.expiry) {
        this._memberCache.delete(key);
        totalPruned++;
      }
    }

    // 3. Prune buybot cache - remove expired entries
    for (const [channelId, entry] of this._buybotCache.entries()) {
      if (now > entry.expiry) {
        this._buybotCache.delete(channelId);
        totalPruned++;
      }
    }

    // 4. Prune active conversations - remove expired entries
    for (const [channelId, userMap] of this.activeConversations.entries()) {
      for (const [userId, expiry] of userMap.entries()) {
        if (now > expiry) {
          userMap.delete(userId);
          totalPruned++;
        }
      }
      if (userMap.size === 0) {
        this.activeConversations.delete(channelId);
      }
    }

    // 5. Prune service exhaustion - remove expired entries
    for (const [mediaType, expiry] of this._serviceExhausted.entries()) {
      if (now > expiry.getTime()) {
        this._serviceExhausted.delete(mediaType);
        totalPruned++;
      }
    }

    // 6. Prune pending replies - remove stale entries (older than 5 minutes)
    const staleThreshold = now - 5 * 60 * 1000;
    for (const [channelId, pending] of this.pendingReplies.entries()) {
      if (pending.lastMessageTime && pending.lastMessageTime < staleThreshold) {
        if (pending.timeout) clearTimeout(pending.timeout);
        this.pendingReplies.delete(channelId);
        totalPruned++;
      }
    }

    // 7. Limit total cache entries to prevent unbounded growth
    if (this.conversationHistory.size > this.MAX_CACHE_ENTRIES) {
      const toRemove = this.conversationHistory.size - this.MAX_CACHE_ENTRIES;
      const keys = Array.from(this.conversationHistory.keys()).slice(0, toRemove);
      keys.forEach(k => this.conversationHistory.delete(k));
      totalPruned += toRemove;
    }

    if (this.recentMediaByChannel.size > this.MAX_CACHE_ENTRIES) {
      const toRemove = this.recentMediaByChannel.size - this.MAX_CACHE_ENTRIES;
      const keys = Array.from(this.recentMediaByChannel.keys()).slice(0, toRemove);
      keys.forEach(k => this.recentMediaByChannel.delete(k));
      totalPruned += toRemove;
    }

    if (totalPruned > 0) {
      this.logger?.debug?.(`[TelegramService] Cache cleanup: pruned ${totalPruned} entries`);
    }
  }

  /**
   * Acquire a lock for a channel to prevent race conditions in debouncing
   * Uses a promise-based mutex pattern
   * @private
   * @param {string} channelId - Channel ID
   * @returns {Promise<Function>} - Release function to call when done
   */
  async _acquireChannelLock(channelId) {
    // Wait for any existing lock to release
    while (this._debounceLocks.has(channelId)) {
      try {
        await this._debounceLocks.get(channelId);
      } catch {
        // Lock was released (rejected), continue
      }
    }

    // Create a new lock
    let releaseFn;
    let timeoutId;
    const lockPromise = new Promise((resolve) => {
      releaseFn = () => {
        clearTimeout(timeoutId);
        this._debounceLocks.delete(channelId);
        resolve();
      };
      // Auto-release after 60 seconds to prevent deadlocks
      timeoutId = setTimeout(() => {
        if (this._debounceLocks.get(channelId) === lockPromise) {
          this._debounceLocks.delete(channelId);
          this.logger?.warn?.(`[TelegramService] Lock timeout for channel ${channelId}, auto-releasing`);
          resolve(); // Resolve instead of reject to prevent unhandled rejections
        }
      }, 60000);
    });

    this._debounceLocks.set(channelId, lockPromise);
    return releaseFn;
  }

  /**
   * Try to acquire a lock without waiting (returns null if lock is held)
   * @private
   * @param {string} channelId - Channel ID
   * @returns {Function|null} - Release function or null if lock is held
   */
  _tryAcquireChannelLock(channelId) {
    if (this._debounceLocks.has(channelId)) {
      return null; // Lock is held
    }

    let releaseFn;
    let timeoutId;
    const lockPromise = new Promise((resolve) => {
      releaseFn = () => {
        clearTimeout(timeoutId);
        this._debounceLocks.delete(channelId);
        resolve();
      };
      // Auto-release after 60 seconds to prevent deadlocks
      timeoutId = setTimeout(() => {
        if (this._debounceLocks.get(channelId) === lockPromise) {
          this._debounceLocks.delete(channelId);
          this.logger?.warn?.(`[TelegramService] Lock timeout for channel ${channelId}, auto-releasing`);
          resolve(); // Resolve instead of reject to prevent unhandled rejections
        }
      }, 60000);
    });

    this._debounceLocks.set(channelId, lockPromise);
    return releaseFn;
  }

  /**
   * Generate a unique request ID for deduplication
   * @private
   */
  _generateRequestId(ctx) {
    const messageId = ctx?.message?.message_id;
    const updateId = ctx?.update?.update_id;
    const chatId = ctx?.chat?.id;
    return `${chatId}:${messageId || updateId || Date.now()}`;
  }

  /**
   * Mark a service as exhausted for a duration
   * @param {string} mediaType - 'video' or 'image'
   * @param {number} durationMs - Duration in ms (default 1 hour)
   */
  _markServiceAsExhausted(mediaType, durationMs = 60 * 60 * 1000) {
    this._serviceExhausted.set(mediaType, new Date(Date.now() + durationMs));
    this.logger?.warn?.(`[TelegramService] Marked ${mediaType} service as exhausted until ${this._serviceExhausted.get(mediaType).toISOString()}`);
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
      await this._recordBotResponse(String(ctx.chat.id), userId);
      return null;
    }
    
    // Handle service unavailable
    if (wrappedError instanceof ServiceUnavailableError) {
      await ctx.reply(
        `⏳ The ${mediaType} generation service is temporarily busy. ` +
        'Please try again in a few minutes.'
      );
      await this._recordBotResponse(String(ctx.chat.id), userId);
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
    await this._recordBotResponse(String(ctx.chat.id), userId);
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

  /**
   * Save a message to the database for persistence
   * @private
   */
  async _saveMessageToDatabase(channelId, message) {
    try {
      const db = await this.databaseService.getDatabase();
      const asDate = message.date instanceof Date
        ? message.date
        : (typeof message.date === 'number'
          ? new Date(message.date * 1000)
          : new Date());
      await db.collection('telegram_messages').insertOne({
        channelId,
        from: message.from,
        text: message.text,
        date: asDate,
        userId: message.userId || null,
        isBot: message.isBot || false,
        createdAt: new Date()
      });
      this.logger?.debug?.(`[TelegramService] Saved message to database for channel ${channelId}`);
    } catch (error) {
      this.logger?.error?.(`[TelegramService] Failed to save message to database:`, error);
    }
  }

  /**
   * Load conversation history from database for a channel
   * @private
   */
  async _loadConversationHistory(channelId) {
    try {
      const db = await this.databaseService.getDatabase();
      const messages = await db.collection('telegram_messages')
        .find({ channelId })
        .sort({ date: -1 })
        .limit(this.HISTORY_LIMIT)
        .toArray();
      
      // Reverse to get chronological order (oldest first)
      const history = messages.reverse().map(msg => ({
        from: msg.isBot ? 'Bot' : msg.from,
        text: msg.text,
        date: msg.date instanceof Date ? Math.floor(msg.date.getTime() / 1000) : msg.date,
        userId: msg.userId || null
      }));
      
      // Merge with existing in-memory history (which may have new messages)
      const existingHistory = this.conversationHistory.get(channelId) || [];
      const mergedHistory = [...history, ...existingHistory];
      
      // Remove duplicates and keep last N messages
      const uniqueHistory = mergedHistory
        .filter((msg, index, self) => 
          index === self.findIndex(m => m.date === msg.date && m.text === msg.text)
        )
        .slice(-this.HISTORY_LIMIT);
      
      this.conversationHistory.set(channelId, uniqueHistory);
      this.logger?.info?.(`[TelegramService] Loaded ${history.length} messages from database, merged with ${existingHistory.length} in-memory messages for channel ${channelId}`);
      return uniqueHistory;
    } catch (error) {
      this.logger?.error?.(`[TelegramService] Failed to load conversation history:`, error);
      return [];
    }
  }

  async _trackBotMessage(channelId, text) {
    if (!channelId || !text) return;
    const normalizedChannelId = String(channelId);
    const entry = {
      from: 'Bot',
      text,
      date: Math.floor(Date.now() / 1000),
      isBot: true,
      userId: null
    };
    const history = this.conversationHistory.get(normalizedChannelId) || [];
    history.push(entry);
    const trimmed = history.length > this.HISTORY_LIMIT
      ? history.slice(-this.HISTORY_LIMIT)
      : history;
    this.conversationHistory.set(normalizedChannelId, trimmed);
    try {
      await this._saveMessageToDatabase(normalizedChannelId, entry);
    } catch (error) {
      this.logger?.warn?.('[TelegramService] Failed to track bot message:', error?.message || error);
    }
  }

  async _createIndexSafe(collection, fields, options = {}, collectionLabel = 'collection') {
    if (!collection?.createIndex) return;
    try {
      await collection.createIndex(fields, options);
    } catch (error) {
      if (error?.code === 85 || error?.codeName === 'IndexOptionsConflict') {
        this.logger?.debug?.(`[TelegramService] Index already exists on ${collectionLabel}: ${options?.name || JSON.stringify(fields)}`);
      } else {
        throw error;
      }
    }
  }

  async _ensureTelegramIndexes() {
    if (!this.databaseService) return;
    if (this._indexesReady) return;
    if (this._indexSetupPromise) {
      return this._indexSetupPromise;
    }

    this._indexSetupPromise = (async () => {
      let success = false;
      try {
        const db = await this.databaseService.getDatabase();
        const recentMediaCollection = db.collection('telegram_recent_media');
        await this._createIndexSafe(recentMediaCollection, { channelId: 1, createdAt: -1 }, { name: 'channelId_createdAt' }, 'telegram_recent_media');
        await this._createIndexSafe(recentMediaCollection, { createdAt: 1 }, { name: 'createdAt_ttl_recent_media', expireAfterSeconds: 3 * 24 * 60 * 60 }, 'telegram_recent_media');
        await this._createIndexSafe(recentMediaCollection, { channelId: 1, id: 1 }, { name: 'channelId_mediaId', unique: true }, 'telegram_recent_media');
        // Phase 1: Add indexes for type filtering and origin tracking
        await this._createIndexSafe(recentMediaCollection, { channelId: 1, type: 1, createdAt: -1 }, { name: 'channelId_type_createdAt' }, 'telegram_recent_media');
        await this._createIndexSafe(recentMediaCollection, { originMediaId: 1 }, { name: 'originMediaId', sparse: true }, 'telegram_recent_media');

        const agentPlansCollection = db.collection('telegram_agent_plans');
        await this._createIndexSafe(agentPlansCollection, { channelId: 1, createdAt: -1 }, { name: 'channelId_createdAt_agent_plan' }, 'telegram_agent_plans');
        await this._createIndexSafe(agentPlansCollection, { createdAt: 1 }, { name: 'createdAt_ttl_agent_plan', expireAfterSeconds: 3 * 24 * 60 * 60 }, 'telegram_agent_plans');

        success = true;
        if (!this._indexesReady) {
          this.logger?.info?.('[TelegramService] Verified telegram indexes (recent media + agent plans)');
        }
      } catch (error) {
        this.logger?.warn?.('[TelegramService] Failed to ensure telegram indexes:', error?.message || error);
      } finally {
        if (success) {
          this._indexesReady = true;
        }
        this._indexSetupPromise = null;
      }
    })();

    return this._indexSetupPromise;
  }

  _getMemberCacheKey(channelId, userId) {
    return `${channelId}:${userId}`;
  }

  _getCachedMember(channelId, userId) {
    const key = this._getMemberCacheKey(channelId, userId);
    const entry = this._memberCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this._memberCache.delete(key);
      return null;
    }
    return entry.record;
  }

  _cacheMember(channelId, userId, record) {
    const key = this._getMemberCacheKey(channelId, userId);
    if (!record) {
      this._memberCache.delete(key);
      return;
    }
    this._memberCache.set(key, {
      record,
      expiry: Date.now() + this.MEMBER_CACHE_TTL
    });
  }

  _pruneRecentMedia(channelId) {
    const cache = this.recentMediaByChannel.get(channelId);
    if (!cache || cache.length === 0) return;
    const now = Date.now();
    const pruned = cache
      .filter(item => item && item.createdAt && (now - new Date(item.createdAt).getTime()) < this.RECENT_MEDIA_MAX_AGE_MS)
      .slice(0, this.RECENT_MEDIA_LIMIT);
    this.recentMediaByChannel.set(channelId, pruned);
  }

  _normalizeMediaRecord(record = {}) {
    if (!record?.id) return null;
    const normalized = {
      ...record,
      channelId: record.channelId ? String(record.channelId) : null,
      createdAt: record.createdAt instanceof Date
        ? record.createdAt
        : new Date(record.createdAt || Date.now())
    };
    return normalized;
  }

  _cacheRecentMediaRecord(channelId, record) {
    if (!channelId || !record) return null;
    const normalizedChannelId = String(channelId);
    const normalizedRecord = this._normalizeMediaRecord(record);
    if (!normalizedRecord) return null;
    const cache = this.recentMediaByChannel.get(normalizedChannelId) || [];
    const deduped = cache.filter(item => item.id !== normalizedRecord.id);
    deduped.unshift(normalizedRecord);
    this.recentMediaByChannel.set(normalizedChannelId, deduped.slice(0, this.RECENT_MEDIA_LIMIT));
    this._pruneRecentMedia(normalizedChannelId);
    return normalizedRecord;
  }

  async _rememberGeneratedMedia(channelId, entry = {}) {
    try {
      if (!channelId || !entry?.mediaUrl) {
        return null;
      }

      const record = {
        id: entry.id || randomUUID(),
        channelId: String(channelId),
        // Asset type: 'image', 'video', 'clip', 'keyframe'
        type: entry.type || 'image',
        mediaUrl: entry.mediaUrl,
        prompt: entry.prompt || null,
        caption: entry.caption || null,
        createdAt: entry.createdAt || new Date(),
        messageId: entry.messageId || null,
        userId: entry.userId || null,
        tweetedAt: entry.tweetedAt || null,
        source: entry.source || null,
        metadata: entry.metadata || null,
        // Phase 1: Agentic tooling state
        toolingState: {
          // Original prompt before enhancement
          originalPrompt: entry.toolingState?.originalPrompt || entry.prompt || null,
          // Enhanced/composed prompt used for generation
          enhancedPrompt: entry.toolingState?.enhancedPrompt || null,
          // Reference media IDs used as input
          referenceMediaIds: entry.toolingState?.referenceMediaIds || [],
          // Gemini Files API handle for reuse
          geminiFileUri: entry.toolingState?.geminiFileUri || null,
          geminiFileName: entry.toolingState?.geminiFileName || null,
          // Generation parameters
          aspectRatio: entry.toolingState?.aspectRatio || null,
          model: entry.toolingState?.model || null
        },
        // Origin tracking for derived media
        originMediaId: entry.originMediaId || null,
        // Edit/extension depth counter
        derivationDepth: typeof entry.derivationDepth === 'number' ? entry.derivationDepth : 0
      };

      const normalized = this._cacheRecentMediaRecord(record.channelId, record);
      if (!normalized) {
        return null;
      }

      await this._persistRecentMediaRecord(normalized);

      return normalized;
    } catch (error) {
      this.logger?.warn?.('[TelegramService] _rememberGeneratedMedia error:', error?.message || error);
      return null;
    }
  }

  async _persistRecentMediaRecord(record) {
    if (!this.databaseService) return;
    try {
      await this._ensureTelegramIndexes();
      const db = await this.databaseService.getDatabase();
      await db.collection('telegram_recent_media').updateOne(
        { channelId: record.channelId, id: record.id },
        {
          $set: {
            channelId: record.channelId,
            id: record.id,
            type: record.type,
            mediaUrl: record.mediaUrl,
            prompt: record.prompt,
            caption: record.caption,
            messageId: record.messageId || null,
            userId: record.userId || null,
            tweetedAt: record.tweetedAt || null,
            source: record.source || null,
            metadata: record.metadata || null,
            // Phase 1: Persist tooling state
            toolingState: record.toolingState || null,
            originMediaId: record.originMediaId || null,
            derivationDepth: record.derivationDepth || 0,
            createdAt: record.createdAt instanceof Date ? record.createdAt : new Date(record.createdAt)
          }
        },
        { upsert: true }
      );
    } catch (error) {
      this.logger?.warn?.('[TelegramService] Failed to store recent media:', error?.message || error);
    }
  }

  async _loadRecentMediaFromDb(channelId, limit = this.RECENT_MEDIA_LIMIT) {
    if (!this.databaseService) return [];
    try {
      const db = await this.databaseService.getDatabase();
      const items = await db.collection('telegram_recent_media')
        .find({ channelId: String(channelId) })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
      return items
        .map(item => this._normalizeMediaRecord(item))
        .filter(Boolean);
    } catch (error) {
      this.logger?.warn?.('[TelegramService] Failed to load recent media:', error?.message || error);
      return [];
    }
  }

  async _getRecentMedia(channelId, limit = 5) {
    if (!channelId) return [];
    const normalizedChannelId = String(channelId);
    this._pruneRecentMedia(normalizedChannelId);
    const cache = this.recentMediaByChannel.get(normalizedChannelId);
    if (cache?.length) {
      return cache.slice(0, limit);
    }
    const fromDb = await this._loadRecentMediaFromDb(channelId, Math.max(limit, this.RECENT_MEDIA_LIMIT));
    if (fromDb.length) {
      this.recentMediaByChannel.set(normalizedChannelId, fromDb.slice(0, this.RECENT_MEDIA_LIMIT));
    }
    return fromDb.slice(0, limit);
  }

  /**
   * Find a specific media record by ID
   * @param {string} channelId - Channel ID
   * @param {string} mediaId - Media record ID to find
   * @returns {Promise<Object|null>} - Media record or null
   */
  async _getMediaById(channelId, mediaId) {
    if (!channelId || !mediaId) return null;
    const normalizedChannelId = String(channelId);
    
    // Check cache first
    const cache = this.recentMediaByChannel.get(normalizedChannelId) || [];
    const cached = cache.find(m => m.id === mediaId);
    if (cached) return cached;
    
    // Query database
    if (!this.databaseService) return null;
    try {
      const db = await this.databaseService.getDatabase();
      const record = await db.collection('telegram_recent_media').findOne({
        channelId: normalizedChannelId,
        id: mediaId
      });
      return record ? this._normalizeMediaRecord(record) : null;
    } catch (error) {
      this.logger?.warn?.('[TelegramService] _getMediaById error:', error?.message);
      return null;
    }
  }

  /**
   * Get recent media filtered by type
   * @param {string} channelId - Channel ID
   * @param {string} type - Media type: 'image', 'video', 'keyframe', 'clip'
   * @param {number} limit - Max records to return
   * @returns {Promise<Array>}
   */
  async _getRecentMediaByType(channelId, type, limit = 5) {
    if (!channelId || !type) return [];
    const normalizedChannelId = String(channelId);
    
    // Query database with type filter (more efficient than filtering cache)
    if (!this.databaseService) {
      // Fallback to cache filter
      const cache = this.recentMediaByChannel.get(normalizedChannelId) || [];
      return cache.filter(m => m.type === type).slice(0, limit);
    }
    
    try {
      const db = await this.databaseService.getDatabase();
      const items = await db.collection('telegram_recent_media')
        .find({ channelId: normalizedChannelId, type })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
      return items.map(item => this._normalizeMediaRecord(item)).filter(Boolean);
    } catch (error) {
      this.logger?.warn?.('[TelegramService] _getRecentMediaByType error:', error?.message);
      return [];
    }
  }

  /**
   * Get derived media (edits/extensions) from an origin
   * @param {string} originMediaId - Original media ID
   * @returns {Promise<Array>}
   */
  async _getDerivedMedia(originMediaId) {
    if (!originMediaId || !this.databaseService) return [];
    try {
      const db = await this.databaseService.getDatabase();
      const items = await db.collection('telegram_recent_media')
        .find({ originMediaId })
        .sort({ derivationDepth: 1, createdAt: -1 })
        .limit(20)
        .toArray();
      return items.map(item => this._normalizeMediaRecord(item)).filter(Boolean);
    } catch (error) {
      this.logger?.warn?.('[TelegramService] _getDerivedMedia error:', error?.message);
      return [];
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
    if (!channelId || !mediaId) return null;
    const normalizedChannelId = String(channelId);
    const lookupRaw = String(mediaId).trim();
    const lookupLower = lookupRaw.toLowerCase();

    const cache = this.recentMediaByChannel.get(normalizedChannelId);
    if (cache?.length) {
      const foundCache = cache.find(item => {
        if (!item?.id) return false;
        const itemId = String(item.id).toLowerCase();
        return itemId === lookupLower || itemId.startsWith(lookupLower);
      });
      if (foundCache) {
        return foundCache;
      }
    }

    if (!this.databaseService) return null;

    try {
      const db = await this.databaseService.getDatabase();
      const collection = db.collection('telegram_recent_media');

      let foundRecord = await collection.findOne({ channelId: normalizedChannelId, id: lookupRaw });

      if (!foundRecord && lookupRaw.length >= this.MEDIA_ID_PREFIX_MIN_LENGTH) {
        const regex = new RegExp(`^${escapeRegExp(lookupRaw)}`, 'i');
        foundRecord = await collection.findOne(
          { channelId: normalizedChannelId, id: { $regex: regex } },
          { sort: { createdAt: -1 } }
        );
      }

      if (foundRecord) {
        const normalized = this._cacheRecentMediaRecord(normalizedChannelId, foundRecord);
        return normalized || this._normalizeMediaRecord(foundRecord);
      }
    } catch (error) {
      this.logger?.warn?.('[TelegramService] Failed to look up mediaId:', error?.message || error);
    }

    return null;
  }

  async _markMediaAsTweeted(channelId, mediaId, meta = {}) {
    if (!channelId || !mediaId || !this.databaseService) return;
    try {
      const db = await this.databaseService.getDatabase();
      const tweetedAt = new Date();
      await db.collection('telegram_recent_media').updateOne(
        { channelId: String(channelId), id: mediaId },
        { $set: { tweetedAt, tweetMeta: meta } }
      );
      const cache = this.recentMediaByChannel.get(String(channelId));
      if (cache?.length) {
        this.recentMediaByChannel.set(String(channelId), cache.map(item => (
          item.id === mediaId ? { ...item, tweetedAt, tweetMeta: meta } : item
        )));
      }
    } catch (error) {
      this.logger?.warn?.('[TelegramService] Failed to mark media as tweeted:', error?.message || error);
    }
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
        await this._recordBotResponse(channelId, userId);
        await this._trackBotMessage(channelId, caption);
      }

      return sentMessage;
    } catch (error) {
      this.logger?.warn?.('[TelegramService] Failed to share tweet preview:', error?.message || error);
      const fallback = tweetUrl ? `🕊️ Tweeted! ${tweetUrl}` : '🕊️ Tweeted!';
      try {
        await ctx.reply(fallback);
        if (channelId) {
          await this._recordBotResponse(channelId, userId);
          await this._trackBotMessage(channelId, fallback);
        }
      } catch (replyError) {
        this.logger?.error?.('[TelegramService] Fallback tweet confirmation failed:', replyError);
      }
      return null;
    }
  }

  async _buildRecentMediaContext(channelId, limit = 5) {
    const items = await this._getRecentMedia(channelId, limit);
    if (!items.length) {
      return { summary: 'Recent media you generated: none in the last few days.', items: [] };
    }
    const summaryLines = items.map((item, idx) => {
      // Prefer content description, then prompt, then caption for content awareness
      const contentDesc = item.metadata?.contentDescription || item.toolingState?.originalPrompt || item.prompt || item.caption || `${item.type} without description`;
      const ageMs = Date.now() - new Date(item.createdAt).getTime();
      const ageMin = Math.max(1, Math.round(ageMs / 60000));
      const ago = ageMin < 60 ? `${ageMin}m ago` : `${Math.round(ageMin / 60)}h ago`;
      const shortId = String(item.id).slice(0, 8).toUpperCase();
      const tweetedMarker = item.tweetedAt ? ' ⚠️ALREADY TWEETED' : '';
      const aspectRatio = item.toolingState?.aspectRatio || item.metadata?.aspectRatio || '';
      const aspectMarker = aspectRatio ? ` [${aspectRatio}]` : '';
      const msgIdMarker = item.messageId ? ` (msg#${item.messageId})` : '';
      // Include more context about what's in the image
      return `${idx + 1}. [${shortId}] ${item.type}${aspectMarker} — "${contentDesc.slice(0, 150)}" (${ago}${tweetedMarker}${msgIdMarker})\n    full id: ${item.id}`;
    });
    return {
      summary: `Recent media you generated (use the short ID in brackets to reference):\n${summaryLines.join('\n')}\n\nIMPORTANT: Match the media ID to what the user asked for. Check the description to ensure you're posting the right image!`,
      items
    };
  }

  _invalidateMemberCache(channelId, userId) {
    const key = this._getMemberCacheKey(channelId, userId);
    this._memberCache.delete(key);
  }

  _formatMemberRecord(member) {
    if (!member) return null;

    return {
      id: member._id ? String(member._id) : null,
      channelId: member.channelId || null,
      userId: member.userId || null,
      username: member.username || null,
      firstName: member.firstName || null,
      lastName: member.lastName || null,
      displayName: member.displayName || null,
      trustLevel: member.trustLevel || 'new',
      joinedAt: member.joinedAt || null,
      firstMessageAt: member.firstMessageAt || null,
      lastMessageAt: member.lastMessageAt || null,
      leftAt: member.leftAt || null,
      joinedViaLink: Boolean(member.joinedViaLink),
      messageCount: member.messageCount || 0,
      spamStrikes: member.spamStrikes || 0,
      lastSpamStrike: member.lastSpamStrike || null,
      penaltyExpires: member.penaltyExpires || null,
      permanentlyBlacklisted: Boolean(member.permanentlyBlacklisted),
      mentionedBotCount: member.mentionedBotCount || 0,
      receivedResponseCount: member.receivedResponseCount || 0,
      adminNotes: member.adminNotes || null,
      updatedAt: member.updatedAt || null,
    };
  }

  async _fetchMemberRecord(channelId, userId, { force = false } = {}) {
    if (!this.databaseService) return null;
    if (!force) {
      const cached = this._getCachedMember(channelId, userId);
      if (cached) return cached;
    }

    try {
      const db = await this.databaseService.getDatabase();
      const record = await db.collection('telegram_members').findOne({ channelId, userId });
      if (record) {
        this._cacheMember(channelId, userId, record);
      }
      return record;
    } catch (error) {
      this.logger?.error?.('[TelegramService] Failed to fetch telegram member record:', error);
      return null;
    }
  }

  async _trackUserJoin(channelId, member, context = {}) {
    if (!this.databaseService || !member?.id) return;

    const userId = String(member.id);
    const joinedViaLink = Boolean(context?.invite_link);

    let existing = null;
    try {
      existing = await this._fetchMemberRecord(channelId, userId, { force: true });
    } catch (error) {
      this.logger?.debug?.('[TelegramService] Existing member lookup failed (continuing):', error?.message);
    }

    const trustLevel = existing?.permanentlyBlacklisted ? (existing.trustLevel || 'banned') : 'new';

    try {
      const db = await this.databaseService.getDatabase();
      await db.collection('telegram_members').updateOne(
        { channelId, userId },
        {
          $setOnInsert: {
            userId,
            channelId,
            joinedAt: new Date(),
            messageCount: 0,
            spamStrikes: 0,
            permanentlyBlacklisted: false,
            mentionedBotCount: 0,
            receivedResponseCount: 0,
            createdAt: new Date(),
          },
          $set: {
            username: member.username || null,
            firstName: member.first_name || null,
            lastName: member.last_name || null,
            joinedViaLink,
            updatedAt: new Date(),
            leftAt: null, // Clear leftAt on rejoin
            trustLevel
          },
        },
        { upsert: true }
      );

      this._invalidateMemberCache(channelId, userId);
      this.logger?.info?.(`[TelegramService] Tracked Telegram member join: ${userId} in ${channelId}`);
    } catch (error) {
      this.logger?.error?.('[TelegramService] Failed to track member join:', error);
    }
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
        await this._trackUserJoin(channelId, member, ctx.message);
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

      const db = await this.databaseService.getDatabase();
      await db.collection('telegram_members').updateOne(
        { channelId, userId },
        {
          $set: {
            leftAt: new Date(),
            updatedAt: new Date(),
            trustLevel: 'left'
          }
        }
      );

      this._invalidateMemberCache(channelId, userId);
      this.logger?.info?.(`[TelegramService] Member left tracked: ${userId} from ${channelId}`);
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
    if (!this.databaseService || !userId) return;

    try {
      const db = await this.databaseService.getDatabase();
      const incFields = { messageCount: 1 };
      if (isMentioned) {
        incFields.mentionedBotCount = 1;
      }

      await db.collection('telegram_members').updateOne(
        { channelId, userId },
        {
          $set: {
            lastMessageAt: new Date(),
            updatedAt: new Date()
          },
          $setOnInsert: {
            firstMessageAt: new Date()
          },
          $inc: incFields
        },
        { upsert: true }
      );

      this._invalidateMemberCache(channelId, userId);
      await this._updateUserTrustLevel(channelId, userId);
    } catch (error) {
      this.logger?.error?.('[TelegramService] Failed to update member activity:', error);
    }
  }

  async _updateUserTrustLevel(channelId, userId) {
    if (!this.databaseService || !userId) return;

    try {
      const member = await this._fetchMemberRecord(channelId, userId, { force: true });
      if (!member || member.permanentlyBlacklisted) return;

      const now = Date.now();
      const joinedAt = member.joinedAt ? new Date(member.joinedAt).getTime() : now;
      const membershipDuration = now - joinedAt;
      const messageCount = member.messageCount || 0;

      let nextTrust = member.trustLevel || 'new';

      if (membershipDuration >= 30 * 24 * 60 * 60 * 1000 && messageCount >= 50) {
        nextTrust = 'trusted';
      } else if (membershipDuration >= 7 * 24 * 60 * 60 * 1000 && messageCount >= 10) {
        nextTrust = 'probation';
      } else if (membershipDuration >= this.USER_PROBATION_MS) {
        nextTrust = 'new';
      }

      if (nextTrust !== member.trustLevel) {
        const db = await this.databaseService.getDatabase();
        await db.collection('telegram_members').updateOne(
          { channelId, userId },
          {
            $set: {
              trustLevel: nextTrust,
              updatedAt: new Date()
            }
          }
        );
        this._invalidateMemberCache(channelId, userId);
        this.logger?.info?.(`[TelegramService] Updated trust level for ${userId} in ${channelId}: ${member.trustLevel} -> ${nextTrust}`);
      }
    } catch (error) {
      this.logger?.error?.('[TelegramService] Failed to update trust level:', error);
    }
  }

  _checkTelegramSpamWindow(userId) {
    if (!userId) return 0;
    const now = Date.now();
    const timestamps = this.telegramSpamTracker.get(userId) || [];
    const filtered = timestamps.filter(ts => now - ts < this.SPAM_WINDOW_MS);
    filtered.push(now);
    this.telegramSpamTracker.set(userId, filtered);
    return filtered.length;
  }

  _getTelegramPenaltyTier(strikeCount) {
    if (!Array.isArray(this.TELEGRAM_PENALTY_TIERS) || !this.TELEGRAM_PENALTY_TIERS.length) {
      return null;
    }
    const normalized = Math.max(1, Number(strikeCount) || 1);
    return this.TELEGRAM_PENALTY_TIERS.find(tier => normalized <= tier.strikes) || this.TELEGRAM_PENALTY_TIERS[this.TELEGRAM_PENALTY_TIERS.length - 1];
  }

  async _recordTelegramSpamStrike(channelId, userId, strikeCount) {
    if (!this.databaseService || !userId) return;

    try {
      const db = await this.databaseService.getDatabase();
      const tier = this._getTelegramPenaltyTier(strikeCount);
      const penaltyMs = tier?.durationMs ?? 60_000;
      const isPermanent = !Number.isFinite(penaltyMs);
      const penaltyExpires = isPermanent
        ? new Date(8640000000000000)
        : new Date(Date.now() + penaltyMs);

      const update = {
        $set: {
          lastSpamStrike: new Date(),
          penaltyExpires,
          updatedAt: new Date()
        },
        $inc: {
          spamStrikes: 1
        }
      };

      if (isPermanent) {
        update.$set.permanentlyBlacklisted = true;
        update.$set.trustLevel = 'banned';
        this.logger?.error?.(`[TelegramService] User ${userId} permanently blacklisted in ${channelId} (spam)`);
      }

      await db.collection('telegram_members').updateOne({ channelId, userId }, update, { upsert: true });
      this._invalidateMemberCache(channelId, userId);
  this.telegramSpamTracker.set(userId, []);

      const notice = tier?.notice ? ` ${tier.notice}` : '';
      this.logger?.warn?.(`[TelegramService] Spam strike for ${userId} -> ${strikeCount} in ${channelId}. Penalty until ${penaltyExpires.toISOString()}.${notice}`);
    } catch (error) {
      this.logger?.error?.('[TelegramService] Failed to record spam strike:', error);
    }
  }

  async _recordBotResponse(channelId, userId) {
    if (!this.databaseService || !userId) return;

    try {
      const db = await this.databaseService.getDatabase();
      await db.collection('telegram_members').updateOne(
        { channelId, userId },
        {
          $inc: { receivedResponseCount: 1 },
          $set: { updatedAt: new Date() }
        }
      );
      this._invalidateMemberCache(channelId, userId);
    } catch (error) {
      this.logger?.error?.('[TelegramService] Failed to record bot response:', error);
    }
  }

  async listTelegramMembers(channelId, options = {}) {
    if (!this.databaseService) {
      return { total: 0, limit: 0, offset: 0, members: [] };
    }

    const {
      limit = 50,
      offset = 0,
      trustLevels,
      includeLeft = false,
      search = ''
    } = options;

    const parsedLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const parsedOffset = Math.max(0, Number(offset) || 0);

    try {
      const db = await this.databaseService.getDatabase();
      const collection = db.collection('telegram_members');
      const clauses = [{ channelId: String(channelId) }];

      if (!includeLeft) {
        clauses.push({
          $or: [
            { leftAt: { $exists: false } },
            { leftAt: null }
          ]
        });
      }

      if (Array.isArray(trustLevels) && trustLevels.length > 0) {
        clauses.push({ trustLevel: { $in: trustLevels } });
      }

      if (search && typeof search === 'string' && search.trim()) {
        const trimmed = search.trim();
        const regex = new RegExp(escapeRegExp(trimmed), 'i');
        clauses.push({
          $or: [
            { userId: trimmed },
            { userId: regex },
            { username: regex },
            { firstName: regex },
            { lastName: regex }
          ]
        });
      }

      const filter = clauses.length === 1 ? clauses[0] : { $and: clauses };

      const cursor = collection.find(filter)
        .sort({ permanentlyBlacklisted: -1, spamStrikes: -1, updatedAt: -1 })
        .skip(parsedOffset)
        .limit(parsedLimit);

      const [members, total] = await Promise.all([
        cursor.toArray(),
        collection.countDocuments(filter)
      ]);

      return {
        total,
        limit: parsedLimit,
        offset: parsedOffset,
        members: members.map((member) => this._formatMemberRecord(member))
      };
    } catch (error) {
      this.logger?.error?.('[TelegramService] Failed to list telegram members:', error);
      throw error;
    }
  }

  async getTelegramMember(channelId, userId, { includeMessages = true, messageLimit = 20 } = {}) {
    if (!this.databaseService) return null;

    const safeChannelId = String(channelId);
    const safeUserId = String(userId);

    try {
      const db = await this.databaseService.getDatabase();
      const member = await db.collection('telegram_members').findOne({ channelId: safeChannelId, userId: safeUserId });
      if (!member) {
        return null;
      }

      let recentMessages = [];
      if (includeMessages) {
        const limit = Math.max(0, Math.min(100, Number(messageLimit) || 20));
        recentMessages = await db.collection('telegram_messages')
          .find({ channelId: safeChannelId, userId: safeUserId })
          .sort({ date: -1 })
          .limit(limit)
          .project({ _id: 0, text: 1, date: 1, isBot: 1 })
          .toArray();
      }

      return {
        member: this._formatMemberRecord(member),
        recentMessages
      };
    } catch (error) {
      this.logger?.error?.('[TelegramService] Failed to fetch telegram member:', error);
      throw error;
    }
  }

  async updateTelegramMember(channelId, userId, updates = {}) {
    if (!this.databaseService) return null;

    const safeChannelId = String(channelId);
    const safeUserId = String(userId);
    const allowedTrustLevels = new Set(['new', 'probation', 'trusted', 'suspicious', 'banned', 'left']);

    const setFields = { updatedAt: new Date() };
    const unsetFields = {};

    if (typeof updates.trustLevel === 'string') {
      const desired = updates.trustLevel.trim();
      if (!allowedTrustLevels.has(desired)) {
        throw new Error(`Invalid trust level: ${desired}`);
      }
      setFields.trustLevel = desired;
    }

    if (typeof updates.permanentlyBlacklisted === 'boolean') {
      setFields.permanentlyBlacklisted = updates.permanentlyBlacklisted;
      if (updates.permanentlyBlacklisted) {
        setFields.trustLevel = 'banned';
      }
    }

    if ('penaltyExpires' in updates) {
      if (updates.penaltyExpires === null || updates.penaltyExpires === '') {
        unsetFields.penaltyExpires = '';
      } else {
        const penaltyDate = new Date(updates.penaltyExpires);
        if (Number.isNaN(penaltyDate.getTime())) {
          throw new Error('Invalid penaltyExpires value');
        }
        setFields.penaltyExpires = penaltyDate;
      }
    }

    if (updates.clearPenalty) {
      unsetFields.penaltyExpires = '';
      unsetFields.lastSpamStrike = '';
    }

    if (typeof updates.spamStrikes === 'number' && Number.isFinite(updates.spamStrikes)) {
      setFields.spamStrikes = Math.max(0, Math.floor(updates.spamStrikes));
    }

    if (typeof updates.adminNotes === 'string') {
      const trimmed = updates.adminNotes.trim();
      if (trimmed) {
        setFields.adminNotes = trimmed;
      } else {
        unsetFields.adminNotes = '';
      }
    }

    try {
      const db = await this.databaseService.getDatabase();
      const update = { $set: setFields };
      if (Object.keys(unsetFields).length > 0) {
        update.$unset = unsetFields;
      }

      const result = await db.collection('telegram_members').findOneAndUpdate(
        { channelId: safeChannelId, userId: safeUserId },
        update,
        { returnDocument: 'after' }
      );

      const updated = result.value || null;
      if (updated) {
        this._invalidateMemberCache(safeChannelId, safeUserId);
        this.logger?.info?.(`[TelegramService] Updated member ${safeUserId} in ${safeChannelId}`);
        return this._formatMemberRecord(updated);
      }

      return null;
    } catch (error) {
      this.logger?.error?.('[TelegramService] Failed to update telegram member:', error);
      throw error;
    }
  }

  async unbanTelegramMember(channelId, userId, options = {}) {
    if (!this.databaseService) return null;

    const clearStrikes = options.clearStrikes !== false;
    const targetTrustLevel = typeof options.trustLevel === 'string' ? options.trustLevel.trim() : 'probation';

    try {
      const db = await this.databaseService.getDatabase();
      const update = {
        $set: {
          permanentlyBlacklisted: false,
          updatedAt: new Date(),
          trustLevel: ['new', 'probation', 'trusted', 'suspicious'].includes(targetTrustLevel) ? targetTrustLevel : 'probation'
        },
        $unset: {
          penaltyExpires: '',
          lastSpamStrike: ''
        }
      };

      if (clearStrikes) {
        update.$set.spamStrikes = 0;
      }

      const result = await db.collection('telegram_members').findOneAndUpdate(
        { channelId: String(channelId), userId: String(userId) },
        update,
        { returnDocument: 'after' }
      );

      const updated = result.value || null;
      if (updated) {
        this._invalidateMemberCache(String(channelId), String(userId));
        this.logger?.info?.(`[TelegramService] Unbanned member ${userId} in ${channelId}`);
        return this._formatMemberRecord(updated);
      }

      return null;
    } catch (error) {
      this.logger?.error?.('[TelegramService] Failed to unban telegram member:', error);
      throw error;
    }
  }

  async getTelegramSpamStats(channelId) {
    if (!this.databaseService) return null;

    try {
      const db = await this.databaseService.getDatabase();
      const collection = db.collection('telegram_members');
      const channelFilter = { channelId: String(channelId) };
      const activeFilter = {
        channelId: String(channelId),
        $or: [
          { leftAt: { $exists: false } },
          { leftAt: null }
        ]
      };
      const now = new Date();
      const lookback24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const [
        totalMembers,
        activeMembers,
        probationMembers,
        trustedMembers,
        blacklistedMembers,
        penalizedMembers,
        recentJoins,
        recentStrikes
      ] = await Promise.all([
        collection.countDocuments(channelFilter),
        collection.countDocuments(activeFilter),
        collection.countDocuments({ ...channelFilter, trustLevel: { $in: ['new', 'probation'] }, permanentlyBlacklisted: { $ne: true } }),
        collection.countDocuments({ ...channelFilter, trustLevel: 'trusted', permanentlyBlacklisted: { $ne: true } }),
        collection.countDocuments({ ...channelFilter, permanentlyBlacklisted: true }),
        collection.countDocuments({ ...channelFilter, penaltyExpires: { $gt: now } }),
        collection.countDocuments({ ...channelFilter, joinedAt: { $gt: lookback24h } }),
        collection.countDocuments({ ...channelFilter, lastSpamStrike: { $gt: lookback24h } })
      ]);

      return {
        channelId: String(channelId),
        totals: {
          totalMembers,
          activeMembers,
          probationMembers,
          trustedMembers,
          blacklistedMembers,
          penalizedMembers
        },
        recent24h: {
          joins: recentJoins,
          spamStrikes: recentStrikes
        },
        generatedAt: now
      };
    } catch (error) {
      this.logger?.error?.('[TelegramService] Failed to compute spam stats:', error);
      throw error;
    }
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
    if (isPrivate || !userId) {
      return true; // Direct messages or anonymous users handled normally
    }

    if (!this.databaseService) {
      return true; // Fail open if database unavailable
    }

    try {
      let member = await this._fetchMemberRecord(channelId, userId);

      if (!member) {
        await this._trackUserJoin(channelId, ctx.message?.from, ctx.message);
        member = await this._fetchMemberRecord(channelId, userId, { force: true });
      }

      if (!member) {
        return true; // Fail open if we couldn't persist member record
      }

      if (member.permanentlyBlacklisted || member.trustLevel === 'banned') {
        this.logger?.warn?.(`[TelegramService] Ignoring message from blacklisted user ${userId} in ${channelId}`);
        return false;
      }

      const now = Date.now();
      const penaltyUntil = member.penaltyExpires ? new Date(member.penaltyExpires).getTime() : 0;
      if (penaltyUntil && penaltyUntil > now) {
        this.logger?.debug?.(`[TelegramService] User ${userId} under penalty until ${new Date(penaltyUntil).toISOString()} - skipping`);
        return false;
      }

      const joinedAt = member.joinedAt ? new Date(member.joinedAt).getTime() : now;
      const membershipDuration = now - joinedAt;
      const preExistingStrikes = member.spamStrikes || 0;

      await this._updateMemberActivity(channelId, userId, { isMentioned });

      const windowCount = this._checkTelegramSpamWindow(userId);
      if (windowCount > this.SPAM_THRESHOLD) {
        const nextStrike = preExistingStrikes + 1;
        await this._recordTelegramSpamStrike(channelId, userId, nextStrike);
        const tier = this._getTelegramPenaltyTier(nextStrike);
        const warning = tier?.notice ? `⚠️ ${tier.notice}` : '⚠️ Slow down a bit before sending more messages.';
        if (ctx?.reply) {
          try {
            await ctx.reply(warning);
          } catch (warnErr) {
            this.logger?.debug?.('[TelegramService] Failed to send spam warning reply:', warnErr?.message || warnErr);
          }
        }
        return false;
      }

      if (membershipDuration < this.USER_PROBATION_MS && !isMentioned) {
        this.logger?.debug?.(`[TelegramService] User ${userId} in probation (${Math.round(membershipDuration / 1000)}s) - not responding`);
        return false;
      }

      return true;
    } catch (error) {
      this.logger?.error?.('[TelegramService] _shouldProcessTelegramUser failed (failing open):', error);
      return true;
    }
  }

  /**
   * Get buybot context for the current channel
   * Returns summary of tracked tokens and recent activity from Discord channels
   * @private
   */
  async _getBuybotContext(channelId) {
    try {
      if (!this.buybotService) return null;

      const db = await this.databaseService.getDatabase();
      
      // Get tracked tokens for this channel
      const trackedTokens = await db.collection('buybot_tracked_tokens')
        .find({ channelId, active: true })
        .toArray();

      if (trackedTokens.length === 0) return null;

      // Build simple context with token info and contract addresses
      let context = `📊 Tracked Tokens (${trackedTokens.length}):\n`;
      
      for (const token of trackedTokens) {
        context += `\n${token.tokenSymbol} (${token.tokenName})\n`;
        context += `  CA: \`${token.tokenAddress}\`\n`;
      }

      // Get recent activity summaries from Discord channels
      const tokenAddresses = trackedTokens.map(t => t.tokenAddress);
      const recentSummaries = await db.collection('buybot_activity_summaries')
        .find({
          tokenAddresses: { $in: tokenAddresses }
        })
        .sort({ createdAt: -1 })
        .limit(3)  // Last 3 summaries
        .toArray();
      
      if (recentSummaries.length > 0) {
        context += `\n\n💬 Recent Discord Activity:\n`;
        for (const summary of recentSummaries) {
          const timeAgo = Math.floor((Date.now() - summary.createdAt.getTime()) / 60000); // minutes
          const timeStr = timeAgo < 60 ? `${timeAgo}m ago` : `${Math.floor(timeAgo / 60)}h ago`;
          context += `• ${summary.summary} (${timeStr})\n`;
        }
      }

      return context.trim();
    } catch (error) {
      this.logger?.error?.('[TelegramService] Failed to get buybot context:', error);
      return null;
    }
  }

  /**
   * Get cached bot persona to avoid redundant database queries
   * @private
   */
  async _getCachedPersona() {
    const now = Date.now();
    if (this._personaCache.data && now < this._personaCache.expiry) {
      this.logger?.debug?.('[TelegramService] Using cached persona');
      return this._personaCache.data;
    }
    
    try {
      if (!this.globalBotService?.bot) {
        return null;
      }
      
      const persona = await this.globalBotService.getPersona();
      this._personaCache.data = persona;
      this._personaCache.expiry = now + this._personaCache.ttl;
      this.logger?.debug?.('[TelegramService] Fetched and cached fresh persona');
      return persona;
    } catch (e) {
      this.logger?.debug?.('[TelegramService] Could not load bot persona:', e.message);
      return null;
    }
  }

  /**
   * Get cached buybot context to avoid redundant database queries
   * @private
   */
  async _getCachedBuybotContext(channelId) {
    const now = Date.now();
    const cached = this._buybotCache.get(channelId);
    
    if (cached && now < cached.expiry) {
      this.logger?.debug?.(`[TelegramService] Using cached buybot context for ${channelId}`);
      return cached.data;
    }
    
    try {
      const data = await this._getBuybotContext(channelId);
      this._buybotCache.set(channelId, { 
        data, 
        expiry: now + this.BUYBOT_CACHE_TTL 
      });
      this.logger?.debug?.(`[TelegramService] Fetched and cached fresh buybot context for ${channelId}`);
      return data;
    } catch (e) {
      this.logger?.error?.('[TelegramService] Failed to get buybot context:', e);
      return null;
    }
  }

  /**
   * Invalidate persona cache (call when bot persona changes)
   */
  invalidatePersonaCache() {
    this._personaCache.data = null;
    this._personaCache.expiry = 0;
    this.logger?.info?.('[TelegramService] Persona cache invalidated');
  }

  /**
   * Invalidate buybot cache for a channel (call when tokens change)
   */
  invalidateBuybotCache(channelId) {
    if (channelId) {
      this._buybotCache.delete(channelId);
      this.logger?.info?.(`[TelegramService] Buybot cache invalidated for ${channelId}`);
    } else {
      this._buybotCache.clear();
      this.logger?.info?.('[TelegramService] All buybot caches cleared');
    }
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
   * Update active conversation status for a user in a channel
   * @private
   */
  _updateActiveConversation(channelId, userId) {
    if (!channelId || !userId) return;
    if (!this.activeConversations.has(channelId)) {
      this.activeConversations.set(channelId, new Map());
    }
    const channelParticipants = this.activeConversations.get(channelId);
    channelParticipants.set(userId, Date.now() + this.ACTIVE_CONVERSATION_WINDOW_MS);
    
    // Cleanup expired participants
    const now = Date.now();
    for (const [uid, expiry] of channelParticipants.entries()) {
      if (now > expiry) channelParticipants.delete(uid);
    }
  }

  /**
   * Check if a user is in an active conversation window
   * @private
   */
  _isActiveConversation(channelId, userId) {
    if (!channelId || !userId) return false;
    const channelParticipants = this.activeConversations.get(channelId);
    if (!channelParticipants) return false;
    
    const expiry = channelParticipants.get(userId);
    if (!expiry) return false;
    
    if (Date.now() > expiry) {
      channelParticipants.delete(userId);
      return false;
    }
    return true;
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
    const includesMention = (source, entities) => {
      if (!botUsername) return false;
      if (source && source.includes(`@${botUsername}`)) {
        return true;
      }
      if (!source || !entities) return false;
      return entities.some((entity) => {
        if (entity.type !== 'mention') return false;
        if (typeof entity.offset !== 'number' || typeof entity.length !== 'number') return false;
        const fragment = source.substring(entity.offset, entity.offset + entity.length);
        return fragment.includes(botUsername);
      });
    };

    const isMentioned = Boolean(botUsername) && (
      includesMention(message.text, message.entities) ||
      includesMention(message.caption, message.caption_entities)
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
    let history = this.conversationHistory.get(channelId);
    if (!history) {
      // Initialize with empty array immediately
      history = [];
      this.conversationHistory.set(channelId, history);
      
      // Load from database in background (don't await)
      this._loadConversationHistory(channelId).catch(err => 
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
    history.push(messageData);
    
    // Keep only last N messages in memory
    if (history.length > this.HISTORY_LIMIT) {
      this.conversationHistory.set(channelId, history.slice(-this.HISTORY_LIMIT));
    }
    
    // Persist to database asynchronously (don't await to avoid blocking)
    this._saveMessageToDatabase(channelId, messageData).catch(err => 
      this.logger?.error?.('[TelegramService] Background save failed:', err)
    );

    this.logger?.debug?.(`[TelegramService] Tracked message in ${channelId}, history: ${history.length} messages`);

    // Check if message is a reply to the bot
    const botId = this.globalBot?.botInfo?.id || ctx.botInfo?.id;
    const isReplyToBot = message.reply_to_message && 
      botId && 
      message.reply_to_message.from?.id === botId;

    // Check if user is in active conversation window
    const isActiveParticipant = this._isActiveConversation(channelId, userId);

    // Determine if we should respond instantly
    // 1. Direct mention
    // 2. Reply to bot's message
    // 3. Active conversation (user talked to us recently)
    const shouldRespond = isMentioned || isReplyToBot || isActiveParticipant;

    this.logger?.debug?.(`[TelegramService] Message in ${channelId}: mentioned=${isMentioned}, reply=${isReplyToBot}, active=${isActiveParticipant}`);

    // If we should respond, do so immediately
    if (shouldRespond) {
      // Update active conversation status (refresh timer)
      this._updateActiveConversation(channelId, userId);

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
      for (const [channelId, history] of this.conversationHistory.entries()) {
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
        this._getCachedPersona(),
        this._getCachedBuybotContext(channelId),
        this.checkMediaGenerationLimit(null, 'image'),
        this.checkMediaGenerationLimit(null, 'video'),
        this.checkMediaGenerationLimit(null, 'tweet')
      ]);

      // Load conversation history if not already in memory
      if (!this.conversationHistory.has(channelId)) {
        await this._loadConversationHistory(channelId);
      }
      
      // Get full conversation history (last 20 messages for context)
      const fullHistory = this.conversationHistory.get(channelId) || [];
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

      // Build compact tool credit context for the AI
      const buildCreditInfo = (lim, label) => {
        if (!lim) return `${label}: unavailable`;
        const now = Date.now();
        const hLeft = Math.max(0, (lim.hourlyLimit ?? 0) - (lim.hourlyUsed ?? 0));
        const dLeft = Math.max(0, (lim.dailyLimit ?? 0) - (lim.dailyUsed ?? 0));
        const available = hLeft > 0 && dLeft > 0;
        
        if (available) {
          return `${label}: ${Math.min(hLeft, dLeft)} available`;
        }
        
        // No credits - calculate time until next reset
        let nextResetMin = null;
        if (hLeft === 0 && lim.resetTimes?.hourly) {
          const msUntilHourly = lim.resetTimes.hourly.getTime() - now;
          if (msUntilHourly > 0) nextResetMin = Math.ceil(msUntilHourly / 60000);
        }
        if (dLeft === 0 && lim.resetTimes?.daily) {
          const msUntilDaily = lim.resetTimes.daily.getTime() - now;
          if (msUntilDaily > 0) {
            const dailyMin = Math.ceil(msUntilDaily / 60000);
            nextResetMin = nextResetMin ? Math.min(nextResetMin, dailyMin) : dailyMin;
          }
        }
        
        return nextResetMin 
          ? `${label}: 0 left, resets in ${nextResetMin}m`
          : `${label}: 0 left`;
      };
      
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
            description: 'Outline a plan that lists upcoming actions (speak, generate_image, generate_video, post_tweet, research, wait, etc.) before executing them.',
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
                        description: 'Action keyword such as speak, generate_image, generate_video, post_tweet, research, wait.'
                      },
                      description: {
                        type: 'string',
                        description: 'Friendly description of what you will do and why.'
                      },
                      aspectRatio: {
                        type: 'string',
                        enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
                        description: 'For generate_image action: aspect ratio. Use 1:1 (square) by default, 16:9 for wide/landscape, 9:16 for tall/portrait.'
                      },
                      expectedOutcome: {
                        type: 'string',
                        description: 'Optional expected result of the step.'
                      }
                    },
                    required: ['description']
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
            description: 'Generate an image based on a text prompt. Use this when users ask you to create, generate, or make an image or photo. Default to square (1:1) aspect ratio unless user specifies otherwise.',
            parameters: {
              type: 'object',
              properties: {
                prompt: {
                  type: 'string',
                  description: 'A detailed description of the image to generate. Be creative and descriptive.'
                },
                aspectRatio: {
                  type: 'string',
                  enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
                  description: 'Image aspect ratio. Use 1:1 (square) by default. Use 16:9 for wide/landscape, 9:16 for tall/portrait/vertical, 4:3 for standard landscape, 3:4 for standard portrait.'
                }
              },
              required: ['prompt']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'generate_video',
            description: 'Generate a short video based on a text prompt. Use this when users ask you to create, generate, or make a video. Videos are typically vertical (9:16) for social media.',
            parameters: {
              type: 'object',
              properties: {
                prompt: {
                  type: 'string',
                  description: 'A detailed description of the video to generate. Include motion, action, and visual details.'
                },
                aspectRatio: {
                  type: 'string',
                  enum: ['16:9', '9:16'],
                  description: 'Video aspect ratio. Use 9:16 (vertical/portrait) by default for social media. Use 16:9 for wide/landscape videos.'
                }
              },
              required: ['prompt']
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
          await this._recordBotResponse(channelId, ackUserId);
          
          // Track in conversation history
          if (!this.conversationHistory.has(String(ctx.chat.id))) {
            this.conversationHistory.set(String(ctx.chat.id), []);
          }
          const botMessage = {
            from: 'Bot',
            text: acknowledgment,
            date: Math.floor(Date.now() / 1000),
            isBot: true,
            userId: null
          };
          this.conversationHistory.get(String(ctx.chat.id)).push(botMessage);
          
          // Persist to database
          this._saveMessageToDatabase(String(ctx.chat.id), botMessage).catch(err => 
            this.logger?.error?.('[TelegramService] Failed to save bot acknowledgment:', err)
          );
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
        await this._recordBotResponse(channelId, replyUserId);
        
        // Track bot's reply in conversation history
        if (!this.conversationHistory.has(channelId)) {
          this.conversationHistory.set(channelId, []);
        }
        const botMessage = {
          from: 'Bot',
          text: cleanResponse,
          date: Math.floor(Date.now() / 1000),
          isBot: true,
          userId: null
        };
        this.conversationHistory.get(channelId).push(botMessage);
        
        // Persist bot's reply to database
        this._saveMessageToDatabase(channelId, botMessage).catch(err => 
          this.logger?.error?.('[TelegramService] Failed to save bot message:', err)
        );
        
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
        const functionName = toolCall.function?.name;
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
            await this._recordBotResponse(channelId, userId);
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
            await this._recordBotResponse(channelId, userId);
            continue;
          }
          
          // Default to vertical (9:16) for social media if not specified
          const videoAspectRatio = args.aspectRatio || '9:16';
          
          // Use async video generation if enabled (avoids handler timeout)
          if (this.USE_ASYNC_VIDEO_GENERATION) {
            await this.queueVideoGenerationAsync(ctx, args.prompt, { conversationContext, userId, username, aspectRatio: videoAspectRatio });
          } else {
            await this.executeVideoGeneration(ctx, args.prompt, conversationContext, userId, username, { aspectRatio: videoAspectRatio });
          }

        } else if (functionName === 'speak') {
          // Handle 'speak' tool which models sometimes hallucinate from plan_actions
          const text = args.description || args.text || args.message || args.content;
          if (text) {
            await ctx.reply(this._formatTelegramMarkdown(text), { parse_mode: 'HTML' });
            await this._recordBotResponse(channelId, userId);
          }
        } else if (functionName === 'wait') {
           await ctx.reply("⏳ <b>Processing...</b>", { parse_mode: 'HTML' });
           await this._recordBotResponse(channelId, userId);
        } else if (functionName === 'research') {
           await ctx.reply("🔍 <b>Checking my sources...</b>", { parse_mode: 'HTML' });
           await this._recordBotResponse(channelId, userId);

        } else if (functionName === 'post_tweet') {
          const limit = await this.checkMediaGenerationLimit(null, 'tweet');
          if (!limit.allowed) {
            const timeUntilReset = limit.hourlyUsed >= limit.hourlyLimit
              ? Math.ceil((limit.resetTimes.hourly - new Date()) / 60000)
              : Math.ceil((limit.resetTimes.daily - new Date()) / 60000);
            await ctx.reply(
              `🕊️ X posting is on cooldown right now.\n\n` +
              `Hourly: ${limit.hourlyUsed}/${limit.hourlyLimit} used\n` +
              `Daily: ${limit.dailyUsed}/${limit.dailyLimit} used\n\n` +
              `⏰ Next post slot in ${timeUntilReset} minutes`
            );
            await this._recordBotResponse(channelId, userId);
            continue;
          }
          await this.executeTweetPost(ctx, {
            text: args.text,
            mediaId: args.mediaId,
            channelId,
            userId,
            username
          });
          
        } else {
          this.logger?.warn?.(`[TelegramService] Unknown tool: ${functionName}`);
          await ctx.reply(`I tried to use ${functionName} but I don't know how yet! 🤔`);
          await this._recordBotResponse(channelId, userId);
        }
      }
    } catch (error) {
      this.logger?.error?.('[TelegramService] Tool execution failed:', error);
      await ctx.reply('I encountered an error using my powers! 😅 Try again?');
      const channelId = String(ctx.chat?.id || '');
      const userId = ctx.message?.from?.id ? String(ctx.message.from.id) : null;
      await this._recordBotResponse(channelId, userId);
    }
  }

  /**
   * Valid plan actions
   * @private
   */
  static VALID_PLAN_ACTIONS = new Set([
    'generate_image', 'generate_keyframe', 'generate_video', 
    'generate_video_from_image', 'edit_image', 'extend_video',
    'speak', 'post_tweet', 'research', 'wait'
  ]);

  /**
   * Step timeout configuration (ms)
   * @private
   */
  static STEP_TIMEOUTS = {
    generate_image: 120000,      // 2 minutes
    generate_keyframe: 120000,   // 2 minutes
    generate_video: 300000,      // 5 minutes
    generate_video_from_image: 300000, // 5 minutes
    edit_image: 120000,          // 2 minutes
    extend_video: 300000,        // 5 minutes
    speak: 30000,                // 30 seconds
    post_tweet: 60000,           // 1 minute
    research: 30000,             // 30 seconds
    wait: 5000,                  // 5 seconds
    default: 120000              // 2 minutes default
  };

  /**
   * Validate a plan before execution
   * @param {Object} plan - The plan to validate
   * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
   * @private
   */
  _validatePlan(plan) {
    const errors = [];
    const warnings = [];
    
    if (!plan) {
      errors.push('Plan is empty or undefined');
      return { valid: false, errors, warnings };
    }
    
    if (!plan.objective || typeof plan.objective !== 'string') {
      warnings.push('Plan has no objective - execution may lack context');
    }
    
    if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
      errors.push('Plan has no steps to execute');
      return { valid: false, errors, warnings };
    }
    
    if (plan.steps.length > 10) {
      warnings.push(`Plan has ${plan.steps.length} steps - consider breaking into smaller plans`);
    }
    
    let hasMediaGeneration = false;
    
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const stepNum = i + 1;
      const action = step.action?.toLowerCase();
      
      // Check if action is valid
      if (!action) {
        errors.push(`Step ${stepNum}: Missing action type`);
        continue;
      }
      
      if (!TelegramService.VALID_PLAN_ACTIONS.has(action)) {
        errors.push(`Step ${stepNum}: Unknown action "${action}"`);
        continue;
      }
      
      // Check for description
      if (!step.description && !['wait', 'research'].includes(action)) {
        warnings.push(`Step ${stepNum} (${action}): Missing description`);
      }
      
      // Track media generation
      if (['generate_image', 'generate_keyframe', 'generate_video', 'generate_video_from_image'].includes(action)) {
        hasMediaGeneration = true;
      }
      
      // Check dependencies
      if (['edit_image', 'extend_video'].includes(action)) {
        if (!step.sourceMediaId && !hasMediaGeneration) {
          errors.push(`Step ${stepNum} (${action}): Requires prior media generation or sourceMediaId`);
        }
      }
      
      if (action === 'post_tweet') {
        if (!step.sourceMediaId && !hasMediaGeneration) {
          errors.push(`Step ${stepNum} (post_tweet): Requires prior media generation or sourceMediaId`);
        }
      }
      
      if (action === 'generate_video_from_image') {
        if (!step.sourceMediaId && !hasMediaGeneration) {
          warnings.push(`Step ${stepNum} (generate_video_from_image): No prior image - will fall back to text-to-video`);
        }
      }
    }
    
    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Execute a step with timeout
   * @param {Function} stepFn - The step function to execute
   * @param {string} action - Action name for timeout lookup
   * @param {number} stepNum - Step number for logging
   * @returns {Promise<any>}
   * @private
   */
  async _executeStepWithTimeout(stepFn, action, stepNum) {
    const timeoutMs = TelegramService.STEP_TIMEOUTS[action] || TelegramService.STEP_TIMEOUTS.default;
    
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Step ${stepNum} (${action}) timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      
      stepFn()
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(err => {
          clearTimeout(timeoutId);
          reject(err);
        });
    });
  }

  /**
   * Update progress message
   * @param {Object} ctx - Telegram context
   * @param {number|null} messageId - Message ID to edit, or null to send new
   * @param {string} text - Progress text
   * @param {string} channelId - Channel ID
   * @returns {Promise<number>} - Message ID
   * @private
   */
  async _updateProgressMessage(ctx, messageId, text, channelId) {
    try {
      if (messageId) {
        await ctx.telegram.editMessageText(channelId, messageId, null, text, { parse_mode: 'HTML' });
        return messageId;
      } else {
        const msg = await ctx.reply(text, { parse_mode: 'HTML' });
        return msg.message_id;
      }
    } catch (err) {
      // If edit fails (e.g., message unchanged), just log and continue
      this.logger?.debug?.('[TelegramService] Progress message update failed:', err.message);
      return messageId;
    }
  }

  /**
   * Delete progress message
   * @param {Object} ctx - Telegram context  
   * @param {number} messageId - Message ID to delete
   * @param {string} channelId - Channel ID
   * @private
   */
  async _deleteProgressMessage(ctx, messageId, channelId) {
    if (!messageId) return;
    try {
      await ctx.telegram.deleteMessage(channelId, messageId);
    } catch (err) {
      this.logger?.debug?.('[TelegramService] Failed to delete progress message:', err.message);
    }
  }

  /**
   * Execute plan using the refactored PlanExecutionService
   * @private
   */
  async _executePlanWithService(ctx, planEntry, channelId, userId, username, conversationContext) {
    let progressMessageId = null;
    
    try {
      // Build services context for executors
      const services = {
        telegram: this,
        database: this.databaseService,
        ai: this.aiService,
        globalBot: this.globalBotService
      };

      const context = {
        ctx,
        channelId,
        userId,
        username,
        conversationContext,
        services
      };

      // Log plan summary
      this.planExecutionService.logPlanSummary(planEntry);

      // Execute with callbacks for progress updates
      const result = await this.planExecutionService.executePlan(planEntry, context, {
        onProgress: async (stepNum, totalSteps, action) => {
          const progressIcon = this.planExecutionService.getActionIcon(action);
          const progressText = `${progressIcon} <b>Step ${stepNum}/${totalSteps}:</b> ${this.planExecutionService.getActionLabel(action)}...`;
          progressMessageId = await this._updateProgressMessage(ctx, progressMessageId, progressText, channelId);
        },
        onError: async (error, stepNum, action, isTimeout) => {
          if (isTimeout) {
            await ctx.reply(`⏱️ Step ${stepNum} (${this.planExecutionService.getActionLabel(action)}) timed out. Continuing with next step...`);
          }
        }
      });

      // Clean up progress message
      await this._deleteProgressMessage(ctx, progressMessageId, channelId);

      this.logger?.info?.(`[TelegramService] Plan execution complete via service: ${result.successCount}/${result.totalSteps} steps in ${Math.round(result.durationMs / 1000)}s`);
      
      return result;
    } catch (error) {
      this.logger?.error?.('[TelegramService] _executePlanWithService error:', error);
      await this._deleteProgressMessage(ctx, progressMessageId, channelId);
      throw error;
    }
  }

  /**
   * Execute plan_actions directly (no AI involvement)
   * For cases where we want precise control over the action sequence
   */
  async executePlanActions(ctx, args = {}, channelId, userId, username, conversationContext = '') {
    let progressMessageId = null;
    
    try {
      // Use PlanExecutionService for validation (consistent across both paths)
      const validation = this.planExecutionService.validatePlan(args);
      
      if (!validation.valid) {
        const errorList = validation.errors.map(e => `• ${e}`).join('\n');
        await ctx.reply(`⚠️ I can't execute this plan:\n${errorList}\n\nPlease adjust and try again!`);
        this.logger?.warn?.('[TelegramService] Plan validation failed:', validation.errors);
        return;
      }
      
      // Log warnings but continue
      if (validation.warnings.length > 0) {
        this.logger?.info?.('[TelegramService] Plan validation warnings:', validation.warnings);
      }

      const planEntry = await this._rememberAgentPlan(channelId, {
        objective: args.objective,
        steps: args.steps,
        confidence: args.confidence,
        userId,
        metadata: {
          requestedByUsername: username || null
        }
      });

      if (!planEntry) {
        await ctx.reply('🧠 I tried to plan but something went wrong—give me another nudge?');
        return;
      }

      // Log clean plan summary to console (not to Telegram - keep inner thoughts private)
      const planLogLines = [
        '\n╔══════════════════════════════════════════════════════════════╗',
        '║                    🧠 AGENT PLAN SEQUENCE                    ║',
        '╠══════════════════════════════════════════════════════════════╣'
      ];
      
      if (planEntry.objective) {
        planLogLines.push(`║ Objective: ${planEntry.objective.substring(0, 50).padEnd(50)} ║`);
      }
      
      if (planEntry.steps?.length) {
        planLogLines.push('╠──────────────────────────────────────────────────────────────╣');
        planEntry.steps.forEach((step, idx) => {
          const action = (step.action || 'step').toUpperCase().padEnd(20);
          const desc = (step.description || '').substring(0, 35).padEnd(35);
          planLogLines.push(`║ ${(idx + 1).toString().padStart(2)}. [${action}] ${desc} ║`);
        });
      }
      
      if (typeof planEntry.confidence === 'number') {
        planLogLines.push('╠──────────────────────────────────────────────────────────────╣');
        const confidenceBar = '█'.repeat(Math.round(planEntry.confidence * 20)).padEnd(20);
        planLogLines.push(`║ Confidence: [${confidenceBar}] ${Math.round(planEntry.confidence * 100).toString().padStart(3)}%            ║`);
      }
      
      planLogLines.push('╚══════════════════════════════════════════════════════════════╝\n');
      
      this.logger?.info?.(planLogLines.join('\n'));

      // PHASE 2: Use PlanExecutionService when enabled
      // This uses the refactored ActionExecutor pattern for cleaner code
      // Can be toggled off via this.USE_PLAN_EXECUTION_SERVICE = false for rollback
      if (this.USE_PLAN_EXECUTION_SERVICE) {
        try {
          await this._executePlanWithService(ctx, planEntry, channelId, userId, username, conversationContext);
          return;
        } catch (serviceError) {
          // If service execution fails, log and fall back to inline execution
          this.logger?.error?.('[TelegramService] PlanExecutionService failed, falling back to inline:', serviceError.message);
        }
      }

      // LEGACY: Inline execution (fallback or when USE_PLAN_EXECUTION_SERVICE is false)
      this.logger?.info?.(`[TelegramService] Executing ${planEntry.steps?.length || 0} planned steps (inline mode)`);
      
      let latestGeneratedMediaId = null;
      let generationFailed = false;
      const totalSteps = planEntry.steps?.length || 0;
      const executionResults = [];
      const startTime = Date.now();

      if (planEntry.steps && Array.isArray(planEntry.steps)) {
        for (let stepIdx = 0; stepIdx < planEntry.steps.length; stepIdx++) {
          const step = planEntry.steps[stepIdx];
          const action = step.action?.toLowerCase();
          const stepNum = stepIdx + 1;
          
          // Update progress message
          const progressIcon = this._getActionIcon(action);
          const progressText = `${progressIcon} <b>Step ${stepNum}/${totalSteps}:</b> ${this._getActionLabel(action)}...`;
          progressMessageId = await this._updateProgressMessage(ctx, progressMessageId, progressText, channelId);
          
          this.logger?.info?.(`[TelegramService] 📍 Step ${stepNum}/${totalSteps}: ${(action || 'unknown').toUpperCase()} - "${(step.description || '').substring(0, 50)}..."`);
          
          const stepStartTime = Date.now();
          let stepResult = { success: false, action, stepNum };
          
          try {
            if (action === 'generate_image') {
              // Use aspectRatio from step if specified, default to square
              const imageOptions = { aspectRatio: step.aspectRatio || '1:1' };
              const record = await this._executeStepWithTimeout(
                () => this.executeImageGeneration(ctx, step.description, conversationContext, userId, username, imageOptions),
                action, stepNum
              );
              if (record) {
                latestGeneratedMediaId = record.id;
                generationFailed = false;
                stepResult = { success: true, action, stepNum, mediaId: record.id };
              } else {
                generationFailed = true;
              }
            } else if (action === 'generate_keyframe') {
              // Keyframes typically use 16:9 for video compatibility
              const keyframeOptions = { aspectRatio: step.aspectRatio || '16:9' };
              const record = await this._executeStepWithTimeout(
                () => this.executeImageGeneration(ctx, step.description, conversationContext, userId, username, keyframeOptions),
                action, stepNum
              );
              if (record) {
                latestGeneratedMediaId = record.id;
                generationFailed = false;
                stepResult = { success: true, action, stepNum, mediaId: record.id };
                try {
                  if (this.databaseService) {
                    const db = await this.databaseService.getDatabase();
                    await db.collection('telegram_recent_media').updateOne(
                      { channelId: record.channelId, id: record.id },
                      { $set: { type: 'keyframe', source: 'telegram.generate_keyframe' } }
                    );
                  }
                } catch (err) {
                  this.logger?.warn?.('[TelegramService] Failed to mark media as keyframe:', err.message);
                }
              } else {
                generationFailed = true;
              }
            } else if (action === 'edit_image') {
              const sourceMediaId = step.sourceMediaId || latestGeneratedMediaId;
              if (!sourceMediaId) {
                await ctx.reply('I need an image to edit first! Generate one or provide a reference.');
                generationFailed = true;
                stepResult = { success: false, action, stepNum, error: 'No source image' };
                executionResults.push(stepResult);
                continue;
              }
              const record = await this._executeStepWithTimeout(
                () => this.executeImageEdit(ctx, {
                  prompt: step.description,
                  sourceMediaId,
                  conversationContext,
                  userId,
                  username
                }),
                action, stepNum
              );
              if (record) {
                latestGeneratedMediaId = record.id;
                generationFailed = false;
                stepResult = { success: true, action, stepNum, mediaId: record.id };
              } else {
                generationFailed = true;
              }
            } else if (action === 'generate_video_from_image') {
              // Video typically uses 9:16, unless specified
              const videoOptions = { aspectRatio: step.aspectRatio || '9:16' };
              const sourceMediaId = step.sourceMediaId || latestGeneratedMediaId;
              if (!sourceMediaId) {
                // No source image - fall back to text-to-video
                if (this.USE_ASYNC_VIDEO_GENERATION) {
                  const queueResult = await this.queueVideoGenerationAsync(ctx, step.description, {
                    conversationContext, userId, username, aspectRatio: videoOptions.aspectRatio
                  });
                  if (queueResult.queued) {
                    stepResult = { success: true, action, stepNum, queued: true, jobId: queueResult.jobId };
                  } else {
                    generationFailed = true;
                    stepResult = { success: false, action, stepNum, error: queueResult.error };
                  }
                } else {
                  const record = await this._executeStepWithTimeout(
                    () => this.executeVideoGeneration(ctx, step.description, conversationContext, userId, username, videoOptions),
                    action, stepNum
                  );
                  if (record) {
                    latestGeneratedMediaId = record.id;
                    generationFailed = false;
                    stepResult = { success: true, action, stepNum, mediaId: record.id };
                  } else {
                    generationFailed = true;
                  }
                }
              } else {
                const record = await this._executeStepWithTimeout(
                  () => this.executeVideoFromImage(ctx, {
                    prompt: step.description,
                    sourceMediaId,
                    conversationContext,
                    userId,
                    username,
                    aspectRatio: videoOptions.aspectRatio
                  }),
                  action, stepNum
                );
                if (record) {
                  latestGeneratedMediaId = record.id;
                  generationFailed = false;
                  stepResult = { success: true, action, stepNum, mediaId: record.id };
                } else {
                  generationFailed = true;
                }
              }
            } else if (action === 'extend_video') {
              const sourceMediaId = step.sourceMediaId || latestGeneratedMediaId;
              if (!sourceMediaId) {
                await ctx.reply('I need a video to extend! Generate one first.');
                generationFailed = true;
                stepResult = { success: false, action, stepNum, error: 'No source video' };
                executionResults.push(stepResult);
                continue;
              }
              const record = await this._executeStepWithTimeout(
                () => this.executeVideoExtension(ctx, {
                  prompt: step.description,
                  sourceMediaId,
                  conversationContext,
                  userId,
                  username
                }),
                action, stepNum
              );
              if (record) {
                latestGeneratedMediaId = record.id;
                generationFailed = false;
                stepResult = { success: true, action, stepNum, mediaId: record.id };
              } else {
                generationFailed = true;
              }
            } else if (action === 'generate_video') {
              // Video typically uses 9:16 (vertical) for social media, unless specified
              const videoOptions = { aspectRatio: step.aspectRatio || '9:16' };
              
              // Use async video generation if enabled (avoids handler timeout)
              if (this.USE_ASYNC_VIDEO_GENERATION) {
                const queueResult = await this.queueVideoGenerationAsync(ctx, step.description, {
                  conversationContext, userId, username, aspectRatio: videoOptions.aspectRatio
                });
                if (queueResult.queued) {
                  // For async, we don't get a media record immediately
                  // Mark as success since the job is queued
                  stepResult = { success: true, action, stepNum, queued: true, jobId: queueResult.jobId };
                } else {
                  generationFailed = true;
                  stepResult = { success: false, action, stepNum, error: queueResult.error };
                }
              } else {
                const record = await this._executeStepWithTimeout(
                  () => this.executeVideoGeneration(ctx, step.description, conversationContext, userId, username, videoOptions),
                  action, stepNum
                );
                if (record) {
                  latestGeneratedMediaId = record.id;
                  generationFailed = false;
                  stepResult = { success: true, action, stepNum, mediaId: record.id };
                } else {
                  generationFailed = true;
                }
              }
            } else if (action === 'speak') {
              await this._executeStepWithTimeout(async () => {
                const speechPrompt = `You are executing a planned action.
Context: ${conversationContext}
Action Description: ${step.description}

Write the message you should send to the user now to fulfill this action. Keep it natural, brief, and in character.`;

                const response = await this.aiService.chat([
                  { role: 'user', content: speechPrompt }
                ], {
                  model: this.globalBotService?.bot?.model || 'anthropic/claude-sonnet-4.5',
                  temperature: 0.7
                });
                
                const text = String(response || '').trim().replace(/^["']|["']$/g, '');
                if (text) {
                  await ctx.reply(this._formatTelegramMarkdown(text), { parse_mode: 'HTML' });
                  await this._recordBotResponse(channelId, userId);
                }
              }, action, stepNum);
              stepResult = { success: true, action, stepNum };
            } else if (action === 'post_tweet') {
              if (generationFailed) {
                await ctx.reply('Skipping X post because the media generation failed.');
                stepResult = { success: false, action, stepNum, error: 'Prior media generation failed' };
                executionResults.push(stepResult);
                continue;
              }

              let mediaIdToTweet = latestGeneratedMediaId;
              if (!mediaIdToTweet) {
                const recent = await this._getRecentMedia(channelId, 1);
                if (recent && recent.length > 0) mediaIdToTweet = recent[0].id;
              }

              if (mediaIdToTweet) {
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

                  const response = await this.aiService.chat([
                    { role: 'user', content: tweetPrompt }
                  ], {
                    model: this.globalBotService?.bot?.model || 'anthropic/claude-sonnet-4.5',
                    temperature: 0.8
                  });
                  
                  const generatedTweet = String(response || '').trim().replace(/^["']|["']$/g, '');
                  if (generatedTweet) {
                    tweetText = generatedTweet;
                  }
                } catch (err) {
                  this.logger?.warn?.('[TelegramService] Failed to generate tweet caption, falling back to description:', err);
                }

                await this._executeStepWithTimeout(
                  () => this.executeTweetPost(ctx, {
                    text: tweetText,
                    mediaId: mediaIdToTweet,
                    channelId,
                    userId,
                    username
                  }),
                  action, stepNum
                );
                stepResult = { success: true, action, stepNum, mediaId: mediaIdToTweet };
              } else {
                this.logger?.warn?.('[TelegramService] Cannot post_tweet in plan: no recent media found');
                await ctx.reply('I wanted to post to X, but I couldn\'t find the image/video I just made! 🕵️‍♀️');
                stepResult = { success: false, action, stepNum, error: 'No media found' };
              }
            } else if (action === 'wait' || action === 'research') {
              // Acknowledgment actions - just continue
              stepResult = { success: true, action, stepNum };
            } else {
              this.logger?.info?.(`[TelegramService] Skipping unimplemented plan action: ${action}`);
              stepResult = { success: false, action, stepNum, error: 'Unimplemented action' };
            }
          } catch (stepError) {
            const isTimeout = stepError.message?.includes('timed out');
            this.logger?.error?.(`[TelegramService] Step ${stepNum} failed:`, stepError.message);
            
            if (isTimeout) {
              await ctx.reply(`⏱️ Step ${stepNum} (${this._getActionLabel(action)}) timed out. Continuing with next step...`);
            }
            
            stepResult = { success: false, action, stepNum, error: stepError.message };
            generationFailed = true;
          }
          
          stepResult.durationMs = Date.now() - stepStartTime;
          executionResults.push(stepResult);
        }
      }
      
      // Delete progress message on completion
      await this._deleteProgressMessage(ctx, progressMessageId, channelId);
      
      // Log execution summary
      const totalDuration = Date.now() - startTime;
      const successCount = executionResults.filter(r => r.success).length;
      this.logger?.info?.(`[TelegramService] Plan execution complete: ${successCount}/${totalSteps} steps succeeded in ${Math.round(totalDuration / 1000)}s`);
      
    } catch (error) {
      this.logger?.error?.('[TelegramService] executePlanActions error:', error);
      await this._deleteProgressMessage(ctx, progressMessageId, channelId);
      await ctx.reply('Planning fizzled out for a moment—try again and I will map it out.');
    }
  }

  /**
   * Get icon for action type
   * @private
   */
  _getActionIcon(action) {
    const icons = {
      generate_image: '🎨',
      generate_keyframe: '🖼️',
      generate_video: '🎬',
      generate_video_from_image: '🎥',
      edit_image: '✏️',
      extend_video: '📹',
      speak: '💬',
      post_tweet: '🐦',
      research: '🔍',
      wait: '⏳'
    };
    return icons[action] || '⚡';
  }

  /**
   * Get human-readable label for action type
   * @private
   */
  _getActionLabel(action) {
    const labels = {
      generate_image: 'Generating image',
      generate_keyframe: 'Creating keyframe',
      generate_video: 'Generating video',
      generate_video_from_image: 'Creating video from image',
      edit_image: 'Editing image',
      extend_video: 'Extending video',
      speak: 'Composing message',
      post_tweet: 'Posting to X',
      research: 'Researching',
      wait: 'Processing'
    };
    return labels[action] || action;
  }

  /**
   * Apply the configured character design prompt prefix when enabled
   * @param {string} prompt - Original user prompt
   * @param {Object} [overrideDesign] - Optional override character design config
   * @returns {{ prompt: string, charDesign: Object }} - Enhanced prompt and design reference
   */
  _applyCharacterPrompt(prompt, overrideDesign = null) {
    const charDesign = overrideDesign ?? this.globalBotService?.bot?.globalBotConfig?.characterDesign;
    if (!charDesign?.enabled) {
      return { prompt, charDesign };
    }

    let characterPrefix = charDesign.imagePromptPrefix || 'Show {{characterName}} ({{characterDescription}}) in this situation: ';
    characterPrefix = characterPrefix
      .replace(/\{\{characterName\}\}/g, charDesign.characterName || '')
      .replace(/\{\{characterDescription\}\}/g, charDesign.characterDescription || '');

    return { prompt: characterPrefix + prompt, charDesign };
  }

  /**
   * Download an image and provide base64 payload for downstream consumers
   * @param {string} imageUrl - Remote image URL (S3, CDN, etc.)
   * @returns {Promise<{ data: string, mimeType: string }|null>}
   */
  async _downloadImageAsBase64(imageUrl) {
    if (!imageUrl) return null;
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const mimeType = response.headers.get('content-type') || this._inferMimeTypeFromUrl(imageUrl);
      return {
        data: Buffer.from(arrayBuffer).toString('base64'),
        mimeType: mimeType || 'image/png'
      };
    } catch (err) {
      this.logger?.warn?.('[TelegramService] Failed to download image for keyframe:', err.message);
      return null;
    }
  }

  _inferMimeTypeFromUrl(imageUrl) {
    try {
      const urlWithoutQuery = imageUrl.split('?')[0] || imageUrl;
      const ext = urlWithoutQuery.split('.').pop()?.toLowerCase();
      switch (ext) {
        case 'jpg':
        case 'jpeg':
          return 'image/jpeg';
        case 'png':
          return 'image/png';
        case 'webp':
          return 'image/webp';
        case 'gif':
          return 'image/gif';
        default:
          return 'image/png';
      }
    } catch {
      return 'image/png';
    }
  }

  /**
   * Shared image generation helper so we can reuse media for keyframes
   * @param {Object} params
   * @param {string} params.prompt
   * @param {string} [params.conversationContext]
   * @param {string} [params.userId]
   * @param {string} [params.username]
   * @param {boolean} [params.fetchBinary]
   * @param {string} [params.source]
   * @param {string} [params.aspectRatio='1:1'] - Aspect ratio (1:1, 16:9, 9:16, 4:3, 3:4)
   * @returns {Promise<{ imageUrl: string, enhancedPrompt: string, binary?: { data: string, mimeType: string } }>} 
   */
  async _generateImageAsset({
    prompt,
    conversationContext = '',
    userId = null,
    username = null,
    fetchBinary = false,
    source = 'telegram.user_request',
    aspectRatio = '1:1'
  }) {
    this.logger?.info?.('[TelegramService] Generating image asset', { prompt, userId, username, source, aspectRatio });

    let imageUrl = null;
    let enhancedPrompt = prompt;
    const { prompt: promptWithCharacter, charDesign } = this._applyCharacterPrompt(prompt);
    const referenceImages = [];
    if (charDesign?.enabled && charDesign?.referenceImageUrl) {
      referenceImages.push(charDesign.referenceImageUrl);
      this.logger?.info?.('[TelegramService] Character reference image configured', { 
        referenceUrl: charDesign.referenceImageUrl,
        characterName: charDesign.characterName 
      });
    } else {
      this.logger?.debug?.('[TelegramService] No character reference configured', { 
        charDesignEnabled: charDesign?.enabled,
        hasReferenceUrl: !!charDesign?.referenceImageUrl 
      });
    }

    if (this.globalBotService?.generateImage) {
      try {
        this.logger?.info?.('[TelegramService] Calling globalBotService.generateImage', { 
          hasReferenceImages: referenceImages.length > 0,
          referenceCount: referenceImages.length,
          aspectRatio
        });
        imageUrl = await this.globalBotService.generateImage(prompt, {
          source,
          purpose: 'user_generated',
          enhanceWithDirector: true,
          context: conversationContext,
          referenceImages,
          characterDesign: charDesign,
          aspectRatio
        });
      } catch (err) {
        this.logger?.warn?.('[TelegramService] globalBotService image generation failed:', err.message);
      }
    }

    if (!imageUrl) {
      enhancedPrompt = promptWithCharacter;

      if (this.aiService?.generateImage) {
        try {
          imageUrl = await this.aiService.generateImage(enhancedPrompt, referenceImages, {
            source,
            purpose: 'user_generated',
            context: enhancedPrompt,
            aspectRatio
          });
        } catch (err) {
          this.logger?.warn?.('[TelegramService] aiService image generation failed:', err.message);
        }
      }
    }

    if (!imageUrl && this.googleAIService?.generateImage) {
      try {
        // Use composition when reference images are available
        if (referenceImages.length > 0 && this.googleAIService.composeImageWithGemini) {
          const refImageData = await this._downloadImageAsBase64(referenceImages[0]);
          if (refImageData) {
            imageUrl = await this.googleAIService.composeImageWithGemini(
              [{ data: refImageData.data, mimeType: refImageData.mimeType, label: 'character_reference' }],
              enhancedPrompt,
              { source, purpose: 'user_generated', context: enhancedPrompt, aspectRatio, characterReference: true }
            );
          }
        }
        // Fallback to regular generation if composition failed or no refs
        if (!imageUrl) {
          imageUrl = await this.googleAIService.generateImage(enhancedPrompt, aspectRatio, {
            source,
            purpose: 'user_generated',
            context: enhancedPrompt
          });
        }
      } catch (err) {
        this.logger?.warn?.('[TelegramService] googleAIService image generation failed:', err.message);
      }
    }

    if (!imageUrl) {
      throw new Error('All image generation services failed');
    }

    let binary = null;
    if (fetchBinary) {
      binary = await this._downloadImageAsBase64(imageUrl);
    }

    this.logger?.info?.('[TelegramService] Image asset ready', { imageUrl, aspectRatio });
    return { imageUrl, enhancedPrompt, binary };
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

      await this._recordBotResponse(String(ctx.chat.id), userId);
      
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
      const mediaRecord = await this._rememberGeneratedMedia(String(ctx.chat.id), {
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
   * @param {string} [options.aspectRatio='9:16'] - Aspect ratio (16:9 or 9:16)
   */
  async executeVideoGeneration(ctx, prompt, conversationContext = '', userId = null, username = null, options = {}) {
    const { aspectRatio = '9:16' } = options;
    try {
      // No status message - the AI already sent a natural acknowledgment

      this.logger?.info?.('[TelegramService] Generating video:', { prompt, userId, username, aspectRatio });

      // Generate video using VeoService
      if (!this.veoService) {
        throw new Error('Video generation service not available');
      }

      let videoUrls;
      let enhancedPrompt = prompt;
      let keyframeAsset = null;
      const charDesignConfig = this.globalBotService?.bot?.globalBotConfig?.characterDesign;

      try {
        // Use matching aspect ratio for keyframe (compatible with video)
        keyframeAsset = await this._generateImageAsset({
          prompt,
          conversationContext,
          userId,
          username,
          fetchBinary: true,
          source: 'telegram.video_keyframe',
          aspectRatio // Use same aspect ratio as video
        });
        if (keyframeAsset?.enhancedPrompt) {
          enhancedPrompt = keyframeAsset.enhancedPrompt;
        }
        this.logger?.info?.('[TelegramService] Generated keyframe image for video', { imageUrl: keyframeAsset?.imageUrl });
      } catch (err) {
        this.logger?.warn?.('[TelegramService] Keyframe generation failed, falling back to reference assets:', err.message);
        if (charDesignConfig?.enabled) {
          const applied = this._applyCharacterPrompt(prompt, charDesignConfig);
          enhancedPrompt = applied.prompt;
        }
      }

      if (keyframeAsset?.binary?.data) {
        try {
          this.logger?.info?.('[TelegramService] Sending keyframe to Veo for video generation');
          videoUrls = await this.veoService.generateVideosFromImages({
            prompt: enhancedPrompt,
            images: [{
              data: keyframeAsset.binary.data,
              mimeType: keyframeAsset.binary.mimeType || 'image/png'
            }],
            config: {
              numberOfVideos: 1,
              aspectRatio,
              durationSeconds: 8
            }
          });
        } catch (err) {
          this.logger?.warn?.('[TelegramService] Veo image-to-video generation failed, trying fallback:', err.message);
        }
      }

      if ((!videoUrls || videoUrls.length === 0) && charDesignConfig?.enabled && charDesignConfig?.referenceImageUrl && typeof this.veoService.generateVideosWithReferenceImages === 'function') {
        this.logger?.info?.('[TelegramService] Using configured character reference image for Veo');

        try {
          const response = await fetch(charDesignConfig.referenceImageUrl);
          if (!response.ok) throw new Error(`Failed to fetch reference image: ${response.statusText}`);

          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const base64Image = buffer.toString('base64');
          const mimeType = response.headers.get('content-type') || 'image/png';

          videoUrls = await this.veoService.generateVideosWithReferenceImages({
            prompt: enhancedPrompt,
            referenceImages: [{
              data: base64Image,
              mimeType
            }],
            config: {
              numberOfVideos: 1,
              aspectRatio,
              durationSeconds: 8
            }
          });
        } catch (err) {
          this.logger?.warn?.('[TelegramService] Character reference fallback failed, trying text-to-video:', err.message);
        }
      }

      if (!videoUrls || videoUrls.length === 0) {
        // Generate video (returns array of URLs)
        videoUrls = await this.veoService.generateVideos({
          prompt: enhancedPrompt,
          config: {
            numberOfVideos: 1,
            aspectRatio,
            durationSeconds: 8
          },
        });
      }


      if (!videoUrls || videoUrls.length === 0) {
        throw new Error('Video generation returned no results');
      }

      const videoUrl = videoUrls[0];
      this.logger?.info?.('[TelegramService] Video generated successfully:', { videoUrl });

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
      await this._recordBotResponse(String(ctx.chat.id), userId);
      
      // Record usage for cooldown tracking
      if (userId && username) {
        await this._recordMediaUsage(userId, username, 'video');
      }
      
      // Mark that bot posted media - this counts as bot attention/activity
      const channelId = String(ctx.chat.id);
      const pending = this.pendingReplies.get(channelId) || {};
      pending.lastBotResponseTime = Date.now();
      this.pendingReplies.set(channelId, pending);
      
      const mediaRecord = await this._rememberGeneratedMedia(String(ctx.chat.id), {
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
          aspectRatio,
          model: 'veo-3.1-generate-preview'
        },
        metadata: {
          requestedBy: userId,
          requestedByUsername: username || null,
          aspectRatio,
          contentDescription: prompt.slice(0, 200),
          triggeringMessageId: ctx.message?.message_id || null
        }
      });
      this.logger?.info?.('[TelegramService] Video posted, marked as bot activity', { mediaId: mediaRecord?.id, aspectRatio });
      return mediaRecord;

    } catch (error) {
      return await this._handleMediaError(ctx, error, 'video', userId);
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
   * @returns {Promise<Object>} - Job queue result { queued: true, jobId: string }
   */
  async queueVideoGenerationAsync(ctx, prompt, options = {}) {
    const channelId = String(ctx.chat.id);
    const { conversationContext = '', userId = null, username = null, aspectRatio = '9:16' } = options;
    
    try {
      // Check rate limits before queuing
      if (userId) {
        const canGenerate = await this._checkMediaRateLimit(userId, 'video');
        if (!canGenerate.allowed) {
          await ctx.reply(`⏳ ${canGenerate.message}`);
          return { queued: false, error: 'rate_limit', message: canGenerate.message };
        }
      }

      // Generate keyframe image first (this is relatively quick ~30s)
      let keyframeUrl = options.keyframeUrl;
      let enhancedPrompt = prompt;
      
      if (!keyframeUrl) {
        try {
          const keyframeAsset = await this._generateImageAsset({
            prompt,
            conversationContext,
            userId,
            username,
            fetchBinary: false, // Just need the URL for the job
            source: 'telegram.video_keyframe_async'
          });
          
          if (keyframeAsset?.imageUrl) {
            keyframeUrl = keyframeAsset.imageUrl;
            if (keyframeAsset.enhancedPrompt) {
              enhancedPrompt = keyframeAsset.enhancedPrompt;
            }
            this.logger?.info?.('[TelegramService] Generated keyframe for async video job', { keyframeUrl });
          }
        } catch (err) {
          this.logger?.warn?.('[TelegramService] Keyframe generation failed for async job:', err.message);
        }
      }

      // Store the video job in the database for async processing
      const db = await this.databaseService.getDatabase();
      const now = new Date();
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
        keyframeUrl: keyframeUrl || null,
        channelId,
        chatId: ctx.chat.id,
        userId,
        username,
        conversationContext: conversationContext.slice(0, 2000), // Limit context size
        aspectRatio,
        triggeringMessageId: ctx?.message?.message_id || null,
        config: {
          aspectRatio,
          numberOfVideos: 1,
          durationSeconds: 8
        },
        result: null,
        lastError: null,
      };
      
      const result = await db.collection('telegram_video_jobs').insertOne(jobDoc);
      const jobId = result.insertedId?.toString() || 'unknown';
      
      this.logger?.info?.(`[TelegramService] Queued async video job: ${jobId}`, { 
        channelId, userId, hasKeyframe: !!keyframeUrl 
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
      
      if (jobData.keyframeUrl && this.veoService) {
        // Try image-to-video first
        try {
          // Download keyframe as base64
          const response = await fetch(jobData.keyframeUrl);
          const arrayBuffer = await response.arrayBuffer();
          const base64Image = Buffer.from(arrayBuffer).toString('base64');
          const mimeType = response.headers.get('content-type') || 'image/png';
          
          videoUrls = await this.veoService.generateVideosFromImages({
            prompt: jobData.prompt,
            images: [{ data: base64Image, mimeType }],
            config: jobData.config || { aspectRatio: '9:16', numberOfVideos: 1 }
          });
        } catch (err) {
          this.logger?.warn?.('[TelegramService] Keyframe-to-video failed, trying text-to-video:', err.message);
        }
      }
      
      // Fallback to text-to-video
      if (!videoUrls?.length && this.veoService) {
        videoUrls = await this.veoService.generateVideos({
          prompt: jobData.prompt,
          config: jobData.config || { aspectRatio: '9:16', numberOfVideos: 1 }
        });
      }
      
      if (!videoUrls?.length) {
        throw new Error('No video URLs returned from generation');
      }
      
      const videoUrl = videoUrls[0];
      
      // Generate caption
      let caption = null;
      if (this.globalBotService) {
        try {
          const captionPrompt = `You're a helpful narrator bot. You just generated a video based on: "${jobData.originalPrompt || jobData.prompt}"
Write a brief, natural caption for this video (1-2 sentences, no quotes).`;

          const captionResponse = await this.aiService.chat([
            { role: 'user', content: captionPrompt }
          ], {
            model: this.globalBotService?.bot?.model || 'anthropic/claude-sonnet-4.5',
            temperature: 0.7
          });
          
          caption = String(captionResponse || '').trim().replace(/^["']|["']$/g, '');
        } catch (err) {
          this.logger?.warn?.('[TelegramService] Failed to generate video caption:', err.message);
        }
      }
      
      // Send the video to the chat
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
          aspectRatio: jobData.aspectRatio || '9:16',
          model: 'veo-3.1-generate-preview'
        },
        metadata: {
          jobId,
          requestedBy: jobData.userId,
          requestedByUsername: jobData.username,
          aspectRatio: jobData.aspectRatio || '9:16'
        },
        // Enhanced content awareness fields
        contentDescription: `Video generated: ${jobData.prompt?.slice(0, 200) || 'video content'}`,
        triggeringMessageId: jobData.triggeringMessageId || null
      });
      
      this.logger?.info?.(`[TelegramService] Video job ${jobId} completed successfully`);
      
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
  async executeImageEdit(ctx, { prompt, sourceMediaId, conversationContext = '', userId = null, username = null }) {
    const channelId = String(ctx.chat.id);
    try {
      // Find the source media
      const sourceMedia = await this._getMediaById(channelId, sourceMediaId);
      if (!sourceMedia) {
        await ctx.reply('I couldn\'t find the image to edit. Try generating a new one first! 🔍');
        await this._recordBotResponse(channelId, userId);
        return null;
      }

      if (sourceMedia.type !== 'image' && sourceMedia.type !== 'keyframe') {
        await ctx.reply('I can only edit images, not videos. Let me know if you want to generate a new image instead!');
        await this._recordBotResponse(channelId, userId);
        return null;
      }

      this.logger?.info?.('[TelegramService] Editing image:', { sourceMediaId, prompt });

      // Download the source image
      const sourceImageData = await this._downloadImageAsBase64(sourceMedia.mediaUrl);
      if (!sourceImageData) {
        await ctx.reply('I couldn\'t load the original image. It may have expired. Try generating a new one!');
        await this._recordBotResponse(channelId, userId);
        return null;
      }

      // Use Gemini for image editing (if available)
      let editedImageUrl = null;
      const { prompt: enhancedPrompt } = this._applyCharacterPrompt(prompt);

      if (this.googleAIService?.composeImageWithGemini) {
        try {
          editedImageUrl = await this.googleAIService.composeImageWithGemini(
            [{ data: sourceImageData.data, mimeType: sourceImageData.mimeType, label: 'source' }],
            enhancedPrompt,
            {
              source: 'telegram.edit_image',
              purpose: 'user_edit',
              context: conversationContext
            }
          );
        } catch (err) {
          this.logger?.warn?.('[TelegramService] Gemini image edit failed:', err.message);
        }
      }

      // Fallback: generate a new image with the edit instruction if Gemini edit failed
      if (!editedImageUrl) {
        const combinedPrompt = `Edit the following image according to these instructions: ${prompt}. Original image description: ${sourceMedia.prompt || 'No description available'}`;
        const asset = await this._generateImageAsset({
          prompt: combinedPrompt,
          conversationContext,
          userId,
          username,
          source: 'telegram.edit_image_fallback'
        });
        editedImageUrl = asset?.imageUrl;
      }

      if (!editedImageUrl) {
        await ctx.reply('I couldn\'t complete the edit. Try again with different instructions! 🎨');
        await this._recordBotResponse(channelId, userId);
        return null;
      }

      // Generate a natural caption
      let caption = `✏️ Edited: ${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}`;

      // Send the edited image
      const sentMessage = await ctx.telegram.sendPhoto(ctx.chat.id, editedImageUrl, {
        caption: this._formatTelegramMarkdown(caption),
        parse_mode: 'HTML'
      });

      await this._recordBotResponse(channelId, userId);

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
      await this._recordBotResponse(channelId, userId);
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
   * @param {string} [opts.aspectRatio='9:16'] - Aspect ratio (16:9 or 9:16)
   * @returns {Promise<Object|null>} - New media record or null
   */
  async executeVideoFromImage(ctx, { prompt, sourceMediaId, _conversationContext = '', userId = null, username = null, aspectRatio = '9:16' }) {
    const channelId = String(ctx.chat.id);
    try {
      if (!this.veoService) {
        await ctx.reply('Video generation isn\'t available right now. 🎬');
        await this._recordBotResponse(channelId, userId);
        return null;
      }

      // Find the source image
      const sourceMedia = await this._getMediaById(channelId, sourceMediaId);
      if (!sourceMedia) {
        await ctx.reply('I couldn\'t find the source image. Try generating one first! 🖼️');
        await this._recordBotResponse(channelId, userId);
        return null;
      }

      if (sourceMedia.type !== 'image' && sourceMedia.type !== 'keyframe') {
        await ctx.reply('I need an image to create a video from. This looks like a video already!');
        await this._recordBotResponse(channelId, userId);
        return null;
      }

      this.logger?.info?.('[TelegramService] Generating video from image:', { sourceMediaId, prompt });

      // Download the source image
      const sourceImageData = await this._downloadImageAsBase64(sourceMedia.mediaUrl);
      if (!sourceImageData) {
        await ctx.reply('I couldn\'t load the source image. It may have expired. Try generating a new one!');
        await this._recordBotResponse(channelId, userId);
        return null;
      }

      // Apply character prompt enhancement
      const { prompt: enhancedPrompt } = this._applyCharacterPrompt(prompt);

      // Generate video using Veo image-to-video
      let videoUrls = [];
      try {
        videoUrls = await this.veoService.generateVideosFromImages({
          prompt: enhancedPrompt,
          images: [{
            data: sourceImageData.data,
            mimeType: sourceImageData.mimeType || 'image/png'
          }],
          config: {
            numberOfVideos: 1,
            aspectRatio: aspectRatio,
            durationSeconds: 8
          }
        });
      } catch (err) {
        this.logger?.warn?.('[TelegramService] Veo image-to-video failed:', err.message);
        // Check for quota exhaustion
        if (err?.message?.includes('quota') || err?.message?.includes('RESOURCE_EXHAUSTED')) {
          this._markServiceAsExhausted('video', 60 * 60 * 1000);
          await ctx.reply('🚫 Video generation quota reached. Try again in an hour!');
          await this._recordBotResponse(channelId, userId);
          return null;
        }
      }

      if (!videoUrls || videoUrls.length === 0) {
        await ctx.reply('The video generation didn\'t work out. Let\'s try again! 🎬');
        await this._recordBotResponse(channelId, userId);
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

      await this._recordBotResponse(channelId, userId);

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
          enhancedPrompt,
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
        contentDescription: `Video animated from keyframe showing: ${sourceMedia.contentDescription || sourceMedia.prompt || prompt}`,
        triggeringMessageId: ctx?.message?.message_id || null
      });

      this.logger?.info?.('[TelegramService] Video from image completed', { mediaId: mediaRecord?.id });
      return mediaRecord;

    } catch (error) {
      this.logger?.error?.('[TelegramService] Video from image failed:', error);
      await ctx.reply('Something went wrong creating the video. Let\'s try again! 🎬');
      await this._recordBotResponse(channelId, userId);
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
        await this._recordBotResponse(channelId, userId);
        return null;
      }

      // Find the source video
      const sourceMedia = await this._getMediaById(channelId, sourceMediaId);
      if (!sourceMedia) {
        await ctx.reply('I couldn\'t find the video to extend. Try generating one first! 🎬');
        await this._recordBotResponse(channelId, userId);
        return null;
      }

      if (sourceMedia.type !== 'video' && sourceMedia.type !== 'clip') {
        await ctx.reply('I can only extend videos, not images. Want me to create a video first?');
        await this._recordBotResponse(channelId, userId);
        return null;
      }

      // Check derivation depth limit (max 20 extensions per Veo docs)
      const currentDepth = sourceMedia.derivationDepth || 0;
      if (currentDepth >= 20) {
        await ctx.reply('This video has been extended too many times! Try starting fresh with a new video. 🎬');
        await this._recordBotResponse(channelId, userId);
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
          await ctx.reply('🚫 Video extension quota reached. Try again in an hour!');
          await this._recordBotResponse(channelId, userId);
          return null;
        }
      }

      if (!extendedUrls || extendedUrls.length === 0) {
        await ctx.reply('The video extension didn\'t work out. The original video might not be compatible. 🎬');
        await this._recordBotResponse(channelId, userId);
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

      await this._recordBotResponse(channelId, userId);

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
      await this._recordBotResponse(channelId, userId);
      return null;
    }
  }

  /**
   * Execute tweet posting via XService using a previously generated media item
   * @param {Object} ctx - Telegram context
   * @param {Object} opts - Tweet payload
   * @param {string} opts.text - Tweet content
   * @param {string} opts.mediaId - Recent media identifier supplied by LLM
   * @param {string} opts.channelId - Telegram channel id
   * @param {string} opts.userId - Telegram user id requesting the tweet
   * @param {string} opts.username - Telegram username requesting the tweet
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
        await this._recordBotResponse(channelId, userId);
        return;
      }

      const trimmedText = String(text || '').trim();
      if (!trimmedText) {
        await ctx.reply('I need a short message to share on X. Try again with the caption you want.');
        await this._recordBotResponse(channelId, userId);
        return;
      }

      if (!mediaId) {
        await ctx.reply('Please pick an image or video from my recent list (include the ID in brackets).');
        await this._recordBotResponse(channelId, userId);
        return;
      }

      const mediaRecord = await this._findRecentMediaById(normalizedChannelId, mediaId);
      if (!mediaRecord) {
        await ctx.reply('I couldn\'t find that media ID anymore. Ask me to regenerate it or choose another one.');
        await this._recordBotResponse(channelId, userId);
        return;
      }

      if (mediaRecord.tweetedAt) {
        await ctx.reply('That one\'s already been posted to X. Pick a different image or ask me to make a new one.');
        await this._recordBotResponse(channelId, userId);
        return;
      }

      if (!mediaRecord.mediaUrl) {
        await ctx.reply('I lost the download link for that media. Let me create a new one.');
        await this._recordBotResponse(channelId, userId);
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
        await this._recordBotResponse(normalizedChannelId, userId);
        return;
      }

      await this._markMediaAsTweeted(normalizedChannelId, mediaRecord.id, { tweetId: result.tweetId || null });

      if (result.tweetId && this.xService?.isValidTweetId && !this.xService.isValidTweetId(result.tweetId)) {
        this.logger?.error?.('[TelegramService] X returned an invalid tweet ID', { tweetId: result.tweetId, channelId: normalizedChannelId });
        await ctx.reply('⚠️ I posted the update, but the tweet link looks off. Please check the X account directly.');
        await this._recordBotResponse(normalizedChannelId, userId);
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
      await this._recordBotResponse(normalizedChannelId, userId);
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
        await this._recordBotResponse(channelId, ctx.message?.from?.id ? String(ctx.message.from.id) : null);
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
      await this._recordBotResponse(channelId, ctx.message?.from?.id ? String(ctx.message.from.id) : null);
      
      this.logger?.info?.(`[TelegramService] Sent stats for ${tokenSymbol}: price=$${priceData.price}, mcap=$${priceData.marketCap}`);

    } catch (error) {
      this.logger?.error?.('[TelegramService] Token stats lookup failed:', error);
      await ctx.reply(`❌ Sorry, I couldn't fetch stats for ${tokenSymbol}. Please try again later.`);
      await this._recordBotResponse(channelId, ctx.message?.from?.id ? String(ctx.message.from.id) : null);
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
          this.logger?.warn?.('[TelegramService] Error stopping bot:', e.message);
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
   * Escapes special characters but preserves intentional markdown
   * @param {string} text - Text to format
   * @returns {string} - HTML formatted text
   */
  _formatTelegramMarkdown(text) {
    if (!text) return '';
    
    try {
      const normalized = typeof text === 'string' ? text : String(text ?? '');
      const decoded = decodeHtmlEntities(normalized);
      // Convert Markdown to HTML using markdown-it
      // This handles **bold**, *italic*, [links](url), `code` etc.
      let html = md.render(decoded.trim());
      
      // Fix paragraphs: replace </p><p> with double newline
      html = html.replace(/<\/p>\s*<p>/g, '\n\n');
      
      // Remove remaining <p> tags (start and end)
      html = html.replace(/<\/?p>/g, '');
      
      // Replace <br> with newline
      html = html.replace(/<br\s*\/?>\n?/g, '\n');
      
      // Ensure only supported tags are present (basic sanitization)
      // Telegram supports: <b>, <strong>, <i>, <em>, <u>, <ins>, <s>, <strike>, <del>, <a>, <code>, <pre>
      // markdown-it with our custom rules should be safe, but we can do a quick pass if needed.
      // For now, we trust markdown-it configuration.
      
      return html.trim();
    } catch (e) {
      this.logger?.warn?.('[TelegramService] Markdown conversion failed, falling back to plain text:', e);
      return String(text).trim();
    }
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
          type: 'tweet_share',
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
      for (const [avatarId, bot] of this.bots.entries()) {
        try {
          await bot.stop('SIGTERM');
        } catch (e) {
          this.logger?.warn?.(`[TelegramService] Error stopping bot for ${avatarId}:`, e.message);
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
