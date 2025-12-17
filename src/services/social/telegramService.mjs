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
import { filterContent } from '../../utils/contentFilter.mjs';
import { setupBuybotTelegramCommands } from '../commands/buybotTelegramHandler.mjs';
import { PlanExecutionService } from '../planner/planExecutionService.mjs';
import { actionExecutorRegistry } from '../planner/actionExecutor.mjs';
import eventBus from '../../utils/eventBus.mjs';
import { generateTraceId } from '../../utils/tracing.mjs';

// Import modular components
import {
  // Constants
  CONVERSATION_CONFIG,
  REPLY_DELAY_CONFIG,
  MEDIA_LIMITS,
  MEDIA_CONFIG,
  DEFAULT_MODEL,
  // Utilities
  escapeHtml,
  formatTelegramMarkdown,
  includesMention,
  sendImagePreservingFormat,
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
  logPlanSummary,
  validatePlan,
  buildConversationContext,
} from './telegram/index.mjs';
import { KnowledgeBaseService } from '../knowledge/knowledgeBaseService.mjs';

const MAX_REFERENCE_IMAGES = 3;
const VIDEO_LOCK_TIMEOUT_MS = 6 * 60 * 1000; // 6 minutes to cover Veo's SLA

// Process-wide progress tracking: avoids accumulating eventBus listeners when TelegramService is constructed multiple times (e.g. tests).
const videoProgressHandlers = new Map(); // traceId -> { ctx, messageId, lastUpdate, logger }
let videoProgressListenerRegistered = false;

function ensureVideoProgressListener() {
  if (videoProgressListenerRegistered) return;
  videoProgressListenerRegistered = true;

  eventBus.on('video:progress', async (event) => {
    const { traceId, status, progress } = event || {};
    if (!traceId) return;

    const handler = videoProgressHandlers.get(traceId);
    if (handler && (Date.now() - handler.lastUpdate > 5000 || status === 'complete')) {
      try {
        await handler.ctx.telegram.editMessageText(
          handler.ctx.chat.id,
          handler.messageId,
          null,
          `🎬 ${status}... ${progress}%`
        );
        handler.lastUpdate = Date.now();
      } catch {}
    }

    if (status === 'complete' || status === 'error') {
      videoProgressHandlers.delete(traceId);
    }
  });
}

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
    wikiService,
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
    this.wikiService = wikiService;
    this.bots = new Map(); // avatarId -> Telegraf instance
    this.globalBot = null;
    
    // Startup timestamp - used to skip messages that arrived before bot started
    this._startupTimestamp = Math.floor(Date.now() / 1000);
    this._startupGracePeriodSec = 5; // Extra grace period to avoid edge cases
    this._warmupPeriodSec = 5; // Don't respond to anything for 5 seconds after startup
    this._isWarmedUp = false; // Will be set to true after warmup period
    
    // Channel reply queue - tracks channels needing replies and their priority
    // Map<channelId, { needsReply: boolean, mentionedAt: number|null, lastActivity: number, ctx: object }>
    this._channelReplyQueue = new Map();
    
    // Recent interactors - users who recently mentioned/replied to bot get immediate responses
    // Map<`${channelId}:${userId}`, { interactedAt: number, type: 'mention' | 'reply' }>
    this._recentInteractors = new Map();
    this._recentInteractorWindowMs = 2 * 60 * 1000; // 2 minutes window for immediate responses
    
    // Initialize Managers
    this.cacheManager = new CacheManager({ logger: this.logger });
    this.recentMediaByChannel = this.cacheManager.recentMediaByChannel;
    this.agentPlansByChannel = this.cacheManager.agentPlansByChannel;
    
    this.memberManager = new MemberManager({
      logger: this.logger,
      databaseService: this.databaseService,
      cacheManager: this.cacheManager,
    });

    this.conversationManager = new ConversationManager({
      logger: this.logger,
      databaseService: this.databaseService,
      cacheManager: this.cacheManager,
    });
    
    this.mediaManager = new MediaManager({
      logger: this.logger,
      databaseService: this.databaseService,
      cacheManager: this.cacheManager,
      mediaIndexService: this.mediaIndexService,
    });

    Object.defineProperty(this, '_indexesReady', {
      get: () => this.mediaManager?._indexesReady ?? false,
      set: (value) => {
        if (this.mediaManager) {
          this.mediaManager._indexesReady = value;
        }
      }
    });

    this.RECENT_MEDIA_LIMIT = MEDIA_CONFIG.RECENT_LIMIT;

    this.planManager = new PlanManager({
      logger: this.logger,
      databaseService: this.databaseService,
      cacheManager: this.cacheManager,
    });

    this.mediaGenerationManager = new MediaGenerationManager({
      logger: this.logger,
      aiService: this.aiService,
      googleAIService: this.googleAIService,
      veoService: this.veoService,
      mediaGenerationService: this.mediaGenerationService,
      globalBotService: this.globalBotService
    });

    this.knowledgeBaseService = new KnowledgeBaseService({
      logger: this.logger,
      wikiService: this.wikiService
    });
    
    this.contextManager = new ContextManager({
      logger: this.logger,
      databaseService: this.databaseService,
      globalBotService: this.globalBotService,
      buybotService: this.buybotService,
      cacheManager: this.cacheManager,
    });

    this.interactionManager = new InteractionManager({
      logger: this.logger,
    });
    
    // Backwards compatibility / Direct access for internal logic
    this.pendingReplies = this.cacheManager.pendingReplies;
    this._serviceExhausted = this.cacheManager.serviceExhausted;
    
    // Constants
    this.REPLY_DELAY_MS = REPLY_DELAY_CONFIG.DEFAULT_MS;
    this.HISTORY_LIMIT = CONVERSATION_CONFIG.HISTORY_LIMIT;
    this.mediaGenerationLimits = MEDIA_LIMITS;
    this.RECENT_MEDIA_MAX_AGE_MS = MEDIA_CONFIG.MAX_AGE_MS;
    this.REPLY_DELAY_CONFIG = {
      mentioned: REPLY_DELAY_CONFIG.MENTIONED_MS,
      default: REPLY_DELAY_CONFIG.DEFAULT_MS
    };
    
    // Plan Execution
    this.planExecutionService = new PlanExecutionService({
      logger: this.logger,
      executorRegistry: actionExecutorRegistry
    });
    
    // Async video generation flag
    const asyncVideoEnv = (process.env.TELEGRAM_ASYNC_VIDEO ?? 'true').toString().toLowerCase();
    this.USE_ASYNC_VIDEO_GENERATION = asyncVideoEnv === 'true' || asyncVideoEnv === '1' || asyncVideoEnv === 'yes';

    // Video progress tracking
    this._setupVideoProgressListener();

    this._videoGenerationLocks = new Map(); // channelId -> { traceId, expiresAt }
    this.VIDEO_GENERATION_LOCK_MS = VIDEO_LOCK_TIMEOUT_MS;
  }

  // ===========================================================================
  // Initialization & Setup
  // ===========================================================================

  /**
   * Initialize global Telegram bot if configured
   */
  async initializeGlobalBot() {
    try {
      if (this.mediaManager.ensureIndexes) {
        await this.mediaManager.ensureIndexes();
      }
      
      // Initialize Knowledge Base (RAG)
      if (this.knowledgeBaseService) {
        await this.knowledgeBaseService.initialize();
      }

      if (this.globalBot && this.globalBot.botInfo) {
        this.logger?.warn?.('[TelegramService] Global bot already initialized, skipping');
        return true;
      }

      let token = null;
      if (this.secretsService) {
        try {
          token = await this.secretsService.getAsync('telegram_global_bot_token');
        } catch (e) {
          this.logger?.debug?.('[TelegramService] No token in secrets service:', e.message);
        }
      }
      
      if (!token) {
        token = this.configService.get('TELEGRAM_GLOBAL_BOT_TOKEN') || process.env.TELEGRAM_GLOBAL_BOT_TOKEN;
      }
      
      if (!token) {
        this.logger?.debug?.('[TelegramService] No global bot token configured');
        return false;
      }

      if (this.globalBot) {
        try {
          await this.globalBot.stop('SIGTERM');
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (stopErr) {
          this.logger?.debug?.('[TelegramService] Error stopping existing bot:', stopErr.message);
        }
      }

      this.globalBot = new Telegraf(token, {
        handlerTimeout: 600_000,
      });
      
      this.globalBot.catch((err, ctx) => {
        this.logger?.error?.(`[TelegramService] Global bot error for ${ctx.updateType}:`, err);
      });
      
      if (this.buybotService) {
        setupBuybotTelegramCommands(this.globalBot, {
          buybotService: this.buybotService,
          logger: this.logger,
        });
        await this.registerBuybotCommands();
      }
      
      this.globalBot.help((ctx) => ctx.reply('I\'m the CosyWorld bot! I can chat about our community and answer questions. Just message me anytime!'));
      this.globalBot.command('usage', async (ctx) => {
        try {
          const [imageLimit, videoLimit] = await Promise.all([
            this.checkMediaGenerationLimit(null, 'image'),
            this.checkMediaGenerationLimit(null, 'video')
          ]);
          
          const imageMinutesUntilReset = imageLimit.hourlyUsed >= imageLimit.hourlyLimit
            ? Math.ceil((imageLimit.resetTimes.hourly - new Date()) / 60000) : null;
          const videoMinutesUntilReset = videoLimit.hourlyUsed >= videoLimit.hourlyLimit
            ? Math.ceil((videoLimit.resetTimes.hourly - new Date()) / 60000) : null;
          
          await ctx.reply(
            `📊 Media Generation Usage (Global)\n\n` +
            `🎨 Images:\n` +
            `  Hourly: ${imageLimit.hourlyUsed}/${imageLimit.hourlyLimit} used ${imageMinutesUntilReset ? `(resets in ${imageMinutesUntilReset}m)` : ''}\n` +
            `  Daily: ${imageLimit.dailyUsed}/${imageLimit.dailyLimit} used\n\n` +
            `🎬 Videos:\n` +
            `  Hourly: ${videoLimit.hourlyUsed}/${videoLimit.hourlyLimit} used ${videoMinutesUntilReset ? `(resets in ${videoMinutesUntilReset}m)` : ''}\n` +
            `  Daily: ${videoLimit.dailyUsed}/${videoLimit.dailyLimit} used`
          );
        } catch (error) {
          this.logger?.error?.('[TelegramService] Usage command failed:', error);
          await ctx.reply('Sorry, I couldn\'t fetch usage stats right now. 😅');
        }
      });
      
      this.setupMessageHandlers();
      
      const launchTimeout = 30000;
      const launchPromise = this.globalBot.launch();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Bot launch timeout')), launchTimeout);
      });
      
      try {
        await Promise.race([launchPromise, timeoutPromise]);
        this.logger?.info?.('[TelegramService] Bot launch initiated successfully');
      } catch (launchErr) {
        this.logger?.warn?.('[TelegramService] Bot launch warning:', launchErr.message);
      }
      
      let botInfo = null;
      const maxRetries = 3;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          botInfo = await this.globalBot.telegram.getMe();
          break;
        } catch (err) {
          if (attempt === maxRetries) throw err;
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
      
      this.logger?.info?.(`[TelegramService] Global bot initialized successfully: @${botInfo.username}`);
      
      // Update startup timestamp to now (after successful init) to be more accurate
      this._startupTimestamp = Math.floor(Date.now() / 1000);
      this.logger?.info?.(`[TelegramService] Startup timestamp set - ignoring messages before ${new Date(this._startupTimestamp * 1000).toISOString()}`);
      
      // Start warmup period - bot won't respond for a few seconds
      this._isWarmedUp = false;
      this.logger?.info?.(`[TelegramService] Warmup period started - bot will not respond for ${this._warmupPeriodSec} seconds`);
      setTimeout(() => {
        this._isWarmedUp = true;
        this.logger?.info?.('[TelegramService] Warmup period complete - bot is now ready to respond');
        // Immediately trigger queue processing for any messages that arrived during warmup
        this._processQueuedRepliesAfterWarmup();
      }, this._warmupPeriodSec * 1000);
      
      this.cacheManager.startCleanup();
      this.startConversationGapPolling();
      this.startReplyQueueProcessor();
      
      return true;
    } catch (error) {
      this.logger?.error?.('[TelegramService] Failed to initialize global bot:', error.message);
      return false;
    }
  }

  // ===========================================================================
  // Core Event Handlers
  // ===========================================================================

  setupMessageHandlers() {
    if (!this.globalBot) return;

    this.globalBot.on('text', async (ctx) => {
      try {
        await this.handleIncomingMessage(ctx);
      } catch (error) {
        this.logger?.error?.('[TelegramService] Message handling error:', error);
      }
    });

    this.globalBot.on('new_chat_members', async (ctx) => {
      try {
        if (!ctx?.message?.new_chat_members?.length) return;
        
        // Skip events from before startup
        const messageTimestamp = ctx.message?.date || 0;
        if (messageTimestamp < this._startupTimestamp - this._startupGracePeriodSec) return;
        
        const channelId = String(ctx.chat.id);
        const botUsername = this.globalBot?.botInfo?.username || ctx.botInfo?.username;
        for (const member of ctx.message.new_chat_members) {
          if (member?.id && member.is_bot && botUsername && member.username === botUsername) continue;
          await this.memberManager.trackUserJoin(channelId, member, ctx.message);
        }
      } catch (error) {
        this.logger?.error?.('[TelegramService] new_chat_members handler error:', error);
      }
    });

    this.globalBot.on('left_chat_member', async (ctx) => {
      try {
        const member = ctx?.message?.left_chat_member;
        if (!member?.id || member.is_bot) return;
        
        // Skip events from before startup
        const messageTimestamp = ctx.message?.date || 0;
        if (messageTimestamp < this._startupTimestamp - this._startupGracePeriodSec) return;
        
        await this.memberManager.trackUserLeft(String(ctx.chat.id), String(member.id));
      } catch (error) {
        this.logger?.error?.('[TelegramService] left_chat_member handler error:', error);
      }
    });

    this.globalBot.on('my_chat_member', async (ctx) => {
      try {
        const status = ctx?.myChatMember?.new_chat_member?.status;
        this.logger?.info?.(`[TelegramService] Bot membership status changed in ${ctx.chat?.id}: ${status}`);
      } catch (error) {
        this.logger?.error?.('[TelegramService] my_chat_member handler error:', error);
      }
    });
  }

  /**
   * Resolve content filters merging static config and dynamic allowlists
   */
  async _resolveContentFilters() {
    const contentFilters = this.globalBotService?.bot?.globalBotConfig?.contentFilters || {};
    const filterEnabled = contentFilters.enabled !== false;
    
    if (!filterEnabled) {
      return { enabled: false, allowedCashtags: [], allowedAddresses: [] };
    }

    let dynamicAllowlist = { addresses: [], symbols: [] };
    if (this.buybotService?.getAllTrackedTokensForAllowlist) {
      try {
        dynamicAllowlist = await this.buybotService.getAllTrackedTokensForAllowlist();
      } catch (err) {
        this.logger?.debug?.('[TelegramService] Failed to get dynamic token allowlist:', err.message);
      }
    }
    
    // Ensure symbols have $ prefix for consistent comparison
    const dynamicSymbols = (dynamicAllowlist.symbols || []).map(s => 
      s.startsWith('$') ? s : `$${s}`
    );
    
    // Merge static config with dynamic allowlists
    const allowedCashtags = [
      ...(contentFilters.allowedCashtags || []),
      ...dynamicSymbols,
      '$RATI', '$HISS' // Explicitly allow core tokens
    ];
    
    const allowedAddresses = [
      ...(contentFilters.allowedAddresses || []),
      ...(dynamicAllowlist.addresses || [])
    ];

    return {
      ...contentFilters,
      enabled: true,
      allowedCashtags,
      allowedAddresses
    };
  }

  /**
   * Handle incoming messages with debouncing and mention detection
   */
  async handleIncomingMessage(ctx) {
    const message = ctx.message;
    const channelId = String(ctx.chat.id);
    const userId = message.from?.id ? String(message.from.id) : null;
    const isPrivateChat = ctx.chat?.type === 'private';
    
    // Skip messages that arrived before the bot started (queued while offline)
    const messageTimestamp = message.date || 0;
    const effectiveStartupTime = this._startupTimestamp - this._startupGracePeriodSec;
    if (messageTimestamp < effectiveStartupTime) {
      this.logger?.debug?.(`[TelegramService] Skipping old message from before startup`, {
        messageDate: new Date(messageTimestamp * 1000).toISOString(),
        startupTime: new Date(this._startupTimestamp * 1000).toISOString(),
        channelId,
        userId
      });
      return;
    }
    
    if (message.from.is_bot) return;
    if (message.text && message.text.startsWith('/')) return;
    
    // Resolve content filters
    const effectiveFilters = await this._resolveContentFilters();
    
    if (effectiveFilters.enabled) {
      const messageText = message.text || message.caption || '';
      
      const contentFilter = filterContent(messageText, {
        logger: this.logger,
        blockCryptoAddresses: effectiveFilters.blockCryptoAddresses !== false,
        blockCashtags: effectiveFilters.blockCashtags !== false,
        allowedCashtags: effectiveFilters.allowedCashtags,
        allowedAddresses: effectiveFilters.allowedAddresses
      });
      
      if (contentFilter.blocked) {
        this.logger?.info?.(`[TelegramService] Blocked message (${contentFilter.type}) from ${userId} in ${channelId}: ${contentFilter.reason}`);
        return;
      }
    }

    const botUsername = this.globalBot?.botInfo?.username || ctx.botInfo?.username;
    const isMentioned = Boolean(botUsername) && (
      includesMention(message.text, message.entities, botUsername) ||
      includesMention(message.caption, message.caption_entities, botUsername)
    );

    const shouldProcess = await this.memberManager.shouldProcessUser(ctx, channelId, userId, {
      isMentioned,
      isPrivate: isPrivateChat
    });

    if (!shouldProcess) {
      this.logger?.debug?.(`[TelegramService] Spam prevention skipped message from ${userId || 'unknown'} in ${channelId}`);
      return;
    }

    let history = this.conversationManager.getHistory(channelId);
    if (!history || history.length === 0) {
      // Await the history load to ensure we have context before processing
      try {
        history = await this.conversationManager.loadConversationHistory(channelId);
      } catch (err) {
        this.logger?.error?.('[TelegramService] History load failed:', err);
      }
    }
    
    await this.conversationManager.addMessage(channelId, {
      from: message.from.first_name || message.from.username || 'User',
      text: message.text ?? message.caption ?? '',
      date: message.date,
      isBot: false,
      userId,
      messageId: message.message_id
    }, true);

    const botId = this.globalBot?.botInfo?.id || ctx.botInfo?.id;
    const isReplyToBot = message.reply_to_message && botId && message.reply_to_message.from?.id === botId;
    const isActiveParticipant = this.conversationManager.isActiveParticipant(channelId, userId);
    
    // Check if this user is a recent interactor (mentioned/replied to bot in last 2 minutes)
    const interactorKey = `${channelId}:${userId}`;
    const recentInteraction = this._recentInteractors.get(interactorKey);
    const isRecentInteractor = recentInteraction && 
      (Date.now() - recentInteraction.interactedAt) < this._recentInteractorWindowMs;
    
    // Track new interactions for future immediate responses
    if (isMentioned || isReplyToBot) {
      this._recentInteractors.set(interactorKey, {
        interactedAt: Date.now(),
        type: isMentioned ? 'mention' : 'reply'
      });
      // Inline cleanup when map gets large (primary cleanup is in _pruneRecentInteractors)
      if (this._recentInteractors.size > 50) {
        this._pruneRecentInteractors();
      }
    }
    
    const shouldRespond = isMentioned || isReplyToBot || isActiveParticipant || isRecentInteractor;

    // Queue this channel for reply instead of responding immediately
    // The reply queue processor will handle responses with priority for mentions
    if (shouldRespond) {
      this.conversationManager.updateActiveConversation(channelId, userId);
      
      const existingEntry = this._channelReplyQueue.get(channelId);
      const now = Date.now();
      
      // Recent interactors get immediate priority (like mentions)
      const isImmediatePriority = isMentioned || isReplyToBot || isRecentInteractor;
      
      this._channelReplyQueue.set(channelId, {
        needsReply: true,
        // Keep earliest mention time if already mentioned, or set for recent interactors
        mentionedAt: isImmediatePriority ? (existingEntry?.mentionedAt || now) : existingEntry?.mentionedAt || null,
        // Track if it's a direct reply to bot (higher priority like mention)
        isReplyToBot: isReplyToBot || existingEntry?.isReplyToBot || false,
        // Track if this is a recent interactor for logging
        isRecentInteractor: isRecentInteractor,
        isPrivate: isPrivateChat,
        lastActivity: now,
        ctx: ctx, // Store latest context for replying
        userId: userId
      });
      
      this.logger?.debug?.(`[TelegramService] Queued channel ${channelId} for reply`, {
        isMentioned,
        isReplyToBot,
        isActiveParticipant,
        isRecentInteractor,
        isPrivate: isPrivateChat
      });
    }
  }

  // ===========================================================================
  // Response Generation & Polling
  // ===========================================================================

  startConversationGapPolling() {
    const POLL_INTERVAL = 20000;   // Check every 20 seconds
    const GAP_THRESHOLD = 30000;   // Respond to gaps after 30 seconds of silence
    
    setInterval(async () => {
      // Top-level error boundary to prevent interval from breaking
      try {
      // Prune stale recent interactors on each poll cycle
      this._pruneRecentInteractors();
      
      for (const [channelId, history] of this.conversationManager.getAllHistories()) {
        try {
          if (!history || history.length === 0) continue;
          
          const lastMessage = history[history.length - 1];
          const lastMessageTime = lastMessage.date * 1000;
          
          if (Date.now() - lastMessageTime < GAP_THRESHOLD) continue;
          if (lastMessage.from === 'Bot') continue;
          
          const pending = this.pendingReplies.get(channelId) || {};
          if (pending.lastBotResponseTime && pending.lastBotResponseTime > lastMessageTime) continue;
          if (pending.lastCheckedMessageTime === lastMessageTime) continue;
          
          const releaseLock = this.cacheManager.tryAcquireLock(channelId);
          if (!releaseLock) continue;
          
          const pendingAfterLock = this.pendingReplies.get(channelId) || {};
          if (pendingAfterLock.isProcessing) {
            releaseLock();
            continue;
          }
          
          pendingAfterLock.lastCheckedMessageTime = lastMessageTime;
          pendingAfterLock.isProcessing = true;
          pendingAfterLock.requestId = `gap:${channelId}:${lastMessageTime}`;
          this.pendingReplies.set(channelId, pendingAfterLock);
          
          try {
            if (!this.globalBot) {
              releaseLock();
              continue;
            }
            
            const mockCtx = {
              chat: { id: channelId },
              message: {
                text: lastMessage.text,
                from: { first_name: lastMessage.from, id: lastMessage.userId || undefined },
                date: lastMessage.date,
                message_id: lastMessage.messageId
              },
              telegram: this.globalBot.telegram,
              reply: async (text, extra) => {
                const opts = { ...extra };
                if (lastMessage.messageId) opts.reply_to_message_id = lastMessage.messageId;
                return this.globalBot.telegram.sendMessage(channelId, text, opts);
              }
            };
            
            await this.generateAndSendReply(mockCtx, channelId, false, 'gap');
            
            const updatedPending = this.pendingReplies.get(channelId) || {};
            updatedPending.lastBotResponseTime = Date.now();
            updatedPending.isProcessing = false;
            updatedPending.requestId = null;
            this.pendingReplies.set(channelId, updatedPending);
          } catch (error) {
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
      } catch (outerError) {
        // Catch any unexpected errors to prevent interval from breaking
        this.logger?.error?.('[TelegramService] Gap polling outer error:', outerError);
      }
    }, POLL_INTERVAL);
  }

  /**
   * Processes the channel reply queue with priority for mentions and direct replies.
   * Mentions/replies get processed quickly, regular activity gets normal delay.
   * Recent interactors (users who mentioned/replied in last 2 min) get immediate priority.
   */
  startReplyQueueProcessor() {
    const FAST_POLL_INTERVAL = 1500;  // Check queue every 1.5 seconds for snappier responses
    const IMMEDIATE_DELAY = 1500;     // 1.5 second delay for recent interactors (feels instant)
    const MENTION_DELAY = 3000;       // 3 second delay for mentions/direct replies (responsive)
    const NORMAL_DELAY = 15000;       // 15 second delay for active participants (still engaged)
    
    setInterval(async () => {
      // Don't process if not warmed up yet
      if (!this._isWarmedUp) {
        return;
      }
      
      const now = Date.now();
      
      // Sort queue entries by priority: recent interactors first, then mentions/replies, then by time
      const entries = [...this._channelReplyQueue.entries()]
        .filter(([, entry]) => entry.needsReply)
        .sort((a, b) => {
          const aIsImmediate = a[1].isRecentInteractor;
          const bIsImmediate = b[1].isRecentInteractor;
          const aIsPriority = a[1].mentionedAt || a[1].isReplyToBot || a[1].isPrivate;
          const bIsPriority = b[1].mentionedAt || b[1].isReplyToBot || b[1].isPrivate;
          
          // Recent interactors get highest priority
          if (aIsImmediate && !bIsImmediate) return -1;
          if (!aIsImmediate && bIsImmediate) return 1;
          
          // Then priority items (mentions/replies/private)
          if (aIsPriority && !bIsPriority) return -1;
          if (!aIsPriority && bIsPriority) return 1;
          
          // For same priority level, earlier activity first
          return a[1].lastActivity - b[1].lastActivity;
        });
      
      for (const [channelId, entry] of entries) {
        try {
          const isRecentInteractor = entry.isRecentInteractor;
          const isPriority = entry.mentionedAt || entry.isReplyToBot || entry.isPrivate;
          const requiredDelay = isRecentInteractor ? IMMEDIATE_DELAY : (isPriority ? MENTION_DELAY : NORMAL_DELAY);
          const timeSinceActivity = now - entry.lastActivity;
          
          // Wait for required delay before responding
          if (timeSinceActivity < requiredDelay) {
            continue;
          }
          
          // Try to acquire lock
          const releaseLock = this.cacheManager.tryAcquireLock(channelId);
          if (!releaseLock) continue;
          
          const pending = this.pendingReplies.get(channelId) || {};
          if (pending.isProcessing) {
            releaseLock();
            continue;
          }
          
          // Mark as processing
          pending.isProcessing = true;
          pending.requestId = `queue:${channelId}:${now}`;
          this.pendingReplies.set(channelId, pending);
          
          // Mark queue entry as processing (not needsReply) to prevent double-processing
          // We'll delete it after successful completion
          entry.needsReply = false;
          entry.processing = true;
          
          try {
            const ctx = entry.ctx;
            if (!ctx || !this.globalBot) {
              releaseLock();
              continue;
            }
            
            this.logger?.info?.(`[TelegramService] Processing queued reply for ${channelId}`, {
              isPriority,
              isRecentInteractor,
              timeSinceActivity: Math.round(timeSinceActivity / 1000) + 's',
              isMention: !!entry.mentionedAt,
              isReplyToBot: entry.isReplyToBot,
              isPrivate: entry.isPrivate
            });
            
            // Determine trigger type for context
            const triggerType = entry.mentionedAt ? 'mention' 
              : entry.isReplyToBot ? 'reply' 
              : isRecentInteractor ? 'active_participant' 
              : 'general';
            
            await this.generateAndSendReply(ctx, channelId, isPriority || isRecentInteractor, triggerType);
            
            const updatedPending = this.pendingReplies.get(channelId) || {};
            updatedPending.lastBotResponseTime = Date.now();
            updatedPending.isProcessing = false;
            updatedPending.requestId = null;
            this.pendingReplies.set(channelId, updatedPending);
            
            // Now safe to delete from queue after successful processing
            this._channelReplyQueue.delete(channelId);
          } catch (error) {
            this.logger?.error?.(`[TelegramService] Queue processing error for ${channelId}:`, error);
            const updatedPending = this.pendingReplies.get(channelId) || {};
            updatedPending.isProcessing = false;
            updatedPending.requestId = null;
            this.pendingReplies.set(channelId, updatedPending);
            
            // On error, allow retry by resetting queue entry state
            const queueEntry = this._channelReplyQueue.get(channelId);
            if (queueEntry) {
              queueEntry.processing = false;
              // Don't re-enable needsReply to prevent infinite retry loops
              // Entry will be cleaned up on next cache prune
            }
          } finally {
            releaseLock();
          }
          
          // Only process one channel per tick to avoid overwhelming
          break;
        } catch (error) {
          this.logger?.error?.(`[TelegramService] Reply queue error for ${channelId}:`, error);
        }
      }
    }, FAST_POLL_INTERVAL);
    
    this.logger?.info?.('[TelegramService] Reply queue processor started');
  }

  /**
   * Process any queued replies immediately after warmup period completes.
   * This ensures the bot responds to messages that arrived during startup.
   * @private
   */
  async _processQueuedRepliesAfterWarmup() {
    const queuedCount = [...this._channelReplyQueue.entries()]
      .filter(([, entry]) => entry.needsReply).length;
    
    if (queuedCount === 0) {
      this.logger?.info?.('[TelegramService] No queued messages to process after warmup');
      return;
    }
    
    this.logger?.info?.(`[TelegramService] Processing ${queuedCount} queued messages after warmup`);
    
    // Mark all queued entries as high priority
    // This ensures they get processed immediately by the queue processor
    for (const [channelId, entry] of this._channelReplyQueue.entries()) {
      if (entry.needsReply && !entry.processing) {
        // Set lastActivity to 0 to ensure immediate processing (delay already passed)
        entry.lastActivity = 0;
        // Mark as priority if not already
        if (!entry.mentionedAt && !entry.isReplyToBot) {
          entry.isRecentInteractor = true; // Give them immediate priority
        }
        this.logger?.debug?.(`[TelegramService] Marked channel ${channelId} for immediate processing after warmup`);
      }
    }
  }

  /**
   * Prune expired entries from the recent interactors map to prevent memory leaks.
   * @private
   */
  _pruneRecentInteractors() {
    if (this._recentInteractors.size === 0) return;
    
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this._recentInteractors.entries()) {
      if (now - entry.interactedAt > this._recentInteractorWindowMs) {
        this._recentInteractors.delete(key);
        pruned++;
      }
    }
    
    if (pruned > 0) {
      this.logger?.debug?.(`[TelegramService] Pruned ${pruned} stale recent interactors`);
    }
  }

  /**
   * Generate and send a reply to the channel
   * @param {Object} ctx - Telegraf context
   * @param {string} channelId - Channel ID
   * @param {boolean} isMention - Whether bot was mentioned
   * @param {string} [triggerType='general'] - What triggered this: 'mention', 'reply', 'active_participant', 'gap'
   */
  async generateAndSendReply(ctx, channelId, isMention, triggerType = 'general') {
    const isPrivate = ctx.chat?.type === 'private';
    const delayMs = isMention || isPrivate ? this.REPLY_DELAY_CONFIG.mentioned : this.REPLY_DELAY_CONFIG.default;
    
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    const userId = ctx.message?.from?.id ? String(ctx.message.from.id) : null;
    if (!isPrivate && userId) {
      // Check if user is still in chat to avoid error spam
      try {
        const member = await ctx.telegram.getChatMember(ctx.chat.id, userId);
        if (member && ['left', 'kicked', 'restricted'].includes(member.status)) return;
      } catch (error) {
        if (error?.message?.includes('USER_NOT_PARTICIPANT')) return;
      }
    }

    const typingInterval = setInterval(() => {
      ctx.telegram.sendChatAction(ctx.chat.id, 'typing').catch(() => {});
    }, 4000);

    try {
      const [persona, buybotContext, imageLimitCtx, videoLimitCtx, tweetLimitCtx] = await Promise.all([
        this.contextManager.getPersona(),
        this.contextManager.getBuybotContext(channelId),
        this.checkMediaGenerationLimit(null, 'image'),
        this.checkMediaGenerationLimit(null, 'video'),
        this.checkMediaGenerationLimit(null, 'tweet')
      ]);

      // Fetch RAG context
      let ragContext = [];
      if (this.knowledgeBaseService) {
         const query = ctx.message?.text || ctx.message?.caption || '';
         if (query.length > 5) {
            ragContext = await this.knowledgeBaseService.search(query, 3);
         }
      }

      let fullHistory = this.conversationManager.getHistory(channelId);
      if (!fullHistory || fullHistory.length === 0) {
        fullHistory = await this.conversationManager.loadConversationHistory(channelId);
      }

      const { systemPrompt, userPrompt, conversationContext } = buildConversationContext({
        history: fullHistory,
        currentMessage: ctx.message,
        persona,
        credits: {
          image: imageLimitCtx,
          video: videoLimitCtx,
          tweet: tweetLimitCtx
        },
        plan: await this.planManager.buildPlanContext(channelId, 3),
        media: await this.mediaManager.buildRecentMediaContext(channelId, 5),
        buybot: buybotContext,
        isMention,
        triggerType: isPrivate ? 'private' : triggerType,
        rag: ragContext
      });

      if (!this.aiService) {
        await ctx.reply('I\'m here and listening! 👂 (AI service not configured)');
        return;
      }

      // Use tool definitions from module
      const tools = (await import('./telegram/toolDefinitions.mjs')).buildToolDefinitions();

      const model = this.configService.get('TELEGRAM_BOT_MODEL') || 
                   this.globalBotService?.bot?.model || 
                   DEFAULT_MODEL;

      const response = await this.aiService.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], {
        model,
        temperature: 0.8,
        tools: tools,
        tool_choice: 'auto'
      });

      // Handle null/undefined response - typeof null === 'object' in JS, so check explicitly
      const responseObj = (response && typeof response === 'object') ? response : { text: response || '' };
      
      if (responseObj.tool_calls && responseObj.tool_calls.length > 0) {
        const acknowledgment = (typeof responseObj.text === 'string' && responseObj.text.trim()) 
          ? responseObj.text.trim() : '';
        
        if (acknowledgment) {
          const sent = await ctx.reply(acknowledgment);
          await this.memberManager.recordBotResponse(channelId, userId);
          await this.conversationManager.addMessage(channelId, {
            from: 'Bot', text: acknowledgment, date: Math.floor(Date.now() / 1000), isBot: true, messageId: sent?.message_id
          }, true);
        }
        
        await this.handleToolCalls(ctx, responseObj.tool_calls, conversationContext);
        return;
      }

      const responseText = String(responseObj.text || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      if (responseText) {
        const sent = await ctx.reply(formatTelegramMarkdown(responseText), { parse_mode: 'HTML' });
        await this.memberManager.recordBotResponse(channelId, userId);
        await this.conversationManager.addMessage(channelId, {
          from: 'Bot', text: responseText, date: Math.floor(Date.now() / 1000), isBot: true, messageId: sent?.message_id
        }, true);
      }

    } catch (error) {
      this.logger?.error?.('[TelegramService] Reply generation failed:', error);
      try { await ctx.reply('I\'m having trouble forming thoughts right now. 💭'); } catch {}
    } finally {
      clearInterval(typingInterval);
    }
  }

  // ===========================================================================
  // Tool Execution & Media
  // ===========================================================================

  async handleToolCalls(ctx, toolCalls, conversationContext) {
    // Import helper to filter calls
    const { filterToolCalls } = await import('./telegram/toolDefinitions.mjs');
    const finalToolCalls = filterToolCalls(toolCalls, { logger: this.logger });
    
    const userId = String(ctx.message?.from?.id || ctx.from?.id);
    const username = ctx.message?.from?.username || ctx.from?.username || 'Unknown';
    const channelId = String(ctx.chat?.id || '');

    for (const toolCall of finalToolCalls) {
      let functionName = toolCall.function?.name;
      if (functionName && functionName.includes(':')) functionName = functionName.split(':').pop();
      
      const args = typeof toolCall.function?.arguments === 'string' 
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function?.arguments || {};

      this.logger?.info?.(`[TelegramService] ⚡ Tool: ${functionName}`, { args, user: username });

      try {
        if (functionName === 'plan_actions') {
          await ctx.telegram.sendChatAction(ctx.chat.id, 'typing').catch(() => {});
          await this.executePlanActions(ctx, args, channelId, userId, username, conversationContext);
        } else if (functionName === 'get_token_stats') {
          await ctx.telegram.sendChatAction(ctx.chat.id, 'typing').catch(() => {});
          await this.executeTokenStatsLookup(ctx, args.tokenSymbol, String(ctx.chat.id));
        } else if (functionName === 'generate_image') {
          const limit = await this.checkMediaGenerationLimit(null, 'image');
          if (!limit.allowed) {
            await ctx.reply('🎨 Image generation charges are fully used up right now.');
            continue;
          }
          await ctx.telegram.sendChatAction(ctx.chat.id, 'upload_photo').catch(() => {});
          await this.executeImageGeneration(ctx, args.prompt, conversationContext, userId, username, { aspectRatio: args.aspectRatio || '1:1' });
        } else if (functionName === 'generate_video') {
          const limit = await this.checkMediaGenerationLimit(null, 'video');
          if (!limit.allowed) {
            await ctx.reply('🎬 Video generation charges are fully used up right now.');
            continue;
          }
          await ctx.telegram.sendChatAction(ctx.chat.id, 'upload_video').catch(() => {});
          const videoOptions = {
            aspectRatio: args.aspectRatio || '16:9',
            style: args.style,
            camera: args.camera,
            negativePrompt: args.negativePrompt
          };
          if (this.USE_ASYNC_VIDEO_GENERATION) {
            await this.queueVideoGenerationAsync(ctx, args.prompt, { conversationContext, userId, username, ...videoOptions });
          } else {
            await this.executeVideoGeneration(ctx, args.prompt, conversationContext, userId, username, videoOptions);
          }
        } else if (functionName === 'post_tweet') {
          await ctx.telegram.sendChatAction(ctx.chat.id, 'typing').catch(() => {});
          await this.executeTweetPost(ctx, { 
            text: args.text, 
            mediaId: args.mediaId, 
            channelId, userId, username 
          });
        } else if (functionName === 'react_to_message') {
          await this.executeReaction(ctx, args.emoji, args.messageId);
        }
        // Additional tools (video_from_image, extend_video, etc) follow same pattern...
      } catch (toolError) {
        this.logger?.error?.(`[TelegramService] Tool execution failed (${functionName}):`, toolError);
        await ctx.reply(`⚠️ I had a hiccup trying to ${functionName.replace(/_/g, ' ')}. Continuing...`);
      }
    }
  }

  async executePlanActions(ctx, planEntry, channelId, userId, username, conversationContext) {
    const plan = {
      objective: planEntry.objective || 'Respond thoughtfully',
      steps: Array.isArray(planEntry?.steps) ? planEntry.steps : [],
      confidence: planEntry.confidence
    };

    if (plan.steps.length === 0) {
      await ctx.reply('I need at least one planned step to act on. Try planning again with a specific goal.');
      return;
    }

    const validationFn = typeof this.planExecutionService?.validatePlan === 'function'
      ? this.planExecutionService.validatePlan.bind(this.planExecutionService)
      : validatePlan;
    const validation = validationFn(plan);
    if (!validation.valid) {
      const errors = Array.isArray(validation.errors) ? validation.errors : [];
      const bullets = errors.map((err, idx) => `${idx + 1}. ${err}`).slice(0, 5).join('\n');
      await ctx.reply(`🚫 I couldn't execute that plan:\n${bullets}`.trim());
      return;
    }
    if (Array.isArray(validation.warnings) && validation.warnings.length) {
      this.logger?.warn?.('[TelegramService] Plan validation warnings:', validation.warnings);
    }

    logPlanSummary(plan, this.logger);

    // Save plan
    await this.planManager.rememberAgentPlan(channelId, plan);

    const executionContext = {
      ctx, channelId, userId, username, conversationContext,
      services: {
        telegram: this,
        ai: this.aiService,
        database: this.databaseService,
        globalBot: this.globalBotService,
        x: this.xService
      }
    };

    let executionResult = null;
    try {
      executionResult = await this.planExecutionService.executePlan(plan, executionContext, {
        onProgress: async () => {}, // Silently execute steps without posting to channel
        onStepComplete: async () => {},
        onError: async (err, num, act) => {
          // Log errors but don't spam users with technical details
          this.logger?.warn?.(`[TelegramService] Step ${num} (${act}) failed:`, err.message);
        }
      });
      
      // Intentionally no success/failure notification to avoid extra spam in chats
    } catch (error) {
      this.logger?.error?.('[TelegramService] executePlanActions error:', error);
      await ctx.reply('Planning fizzled out for a moment—try again and I will map it out.');
    }

    return executionResult;
  }

  // ===========================================================================
  // Media Generation Implementations
  // ===========================================================================

  async executeReaction(ctx, emoji, messageId) {
    try {
      const targetMessageId = messageId || ctx.message?.message_id;
      if (!targetMessageId) return;
      
      // Telegram API expects array of reactions
      await ctx.telegram.setMessageReaction(ctx.chat.id, targetMessageId, [{ type: 'emoji', emoji }]);
      this.logger?.info?.(`[TelegramService] Reacted with ${emoji} to message ${targetMessageId}`);
    } catch (error) {
      this.logger?.warn?.(`[TelegramService] Failed to react: ${error.message}`);
    }
  }

  async executeImageGeneration(ctx, prompt, conversationContext = '', userId = null, username = null, options = {}) {
    try {
      const { imageUrl, enhancedPrompt } = await this.mediaGenerationManager.generateImageAsset({
        prompt, conversationContext, userId, username,
        aspectRatio: options.aspectRatio || '1:1',
        source: 'telegram.user_request'
      });

      let caption = null;
      if (this.globalBotService) {
        try {
          const captionPrompt = `Create a brief (under 100 chars), natural caption for this image generated from: "${prompt}". No hashtags/markdown.`;
          const response = await this.aiService.chat([{ role: 'user', content: captionPrompt }]);
          caption = String(response || '').trim().replace(/^["']|["']$/g, '');
        } catch {}
      }

      const sentMessage = await sendImagePreservingFormat(
        ctx.telegram,
        ctx.chat.id,
        imageUrl,
        {
          caption: caption ? formatTelegramMarkdown(caption) : undefined,
          parseMode: 'HTML',
          includeDownloadLink: false
        },
        this.logger
      );

      const channelId = String(ctx.chat.id);
      await this.memberManager.recordBotResponse(channelId, userId);
      if (userId && username) await this._recordMediaUsage(userId, username, 'image');

      // Add to conversation history to prevent duplicate processing
      await this.conversationManager.addMessage(channelId, {
        from: 'Bot', 
        text: caption || `[Generated Image: ${prompt}]`, 
        date: Math.floor(Date.now() / 1000), 
        isBot: true, 
        messageId: sentMessage?.message_id
      }, true);

      const pending = this.pendingReplies.get(channelId) || {};
      pending.lastBotResponseTime = Date.now();
      this.pendingReplies.set(channelId, pending);

      const record = await this._rememberGeneratedMedia(channelId, {
        type: 'image', mediaUrl: imageUrl, prompt, caption,
        messageId: sentMessage?.message_id, userId,
        source: 'telegram.generate_image',
        toolingState: { originalPrompt: prompt, enhancedPrompt, aspectRatio: options.aspectRatio },
        metadata: { requestedBy: userId, requestedByUsername: username }
      });

      return record;
    } catch (error) {
      await this._handleMediaError(ctx, error, 'image', userId);
      return null;
    }
  }

  async executeVideoGeneration(ctx, prompt, _conversationContext = '', userId = null, username = null, options = {}) {
    const { aspectRatio = '16:9', style, camera, negativePrompt } = options;
    const traceId = generateTraceId();
    const channelId = String(ctx.chat.id);
    
    if (!this._acquireVideoGenerationLock(channelId, traceId)) {
      await ctx.reply('🎬 Still rendering previous video—please wait a moment.');
      return;
    }

    try {
      this._registerVideoProgress(traceId, ctx, (await ctx.reply('🎬 Starting video generation...'))?.message_id);
      
      // Get character design for reference
      const charDesign = this.globalBotService?.bot?.globalBotConfig?.characterDesign;
      
      const videoUrls = await this.mediaGenerationManager.generateVideo({
        prompt,
        config: { aspectRatio, durationSeconds: 8 },
        style, camera, negativePrompt, traceId, channelId,
        referenceImages: charDesign?.referenceImageUrl ? [charDesign.referenceImageUrl] : []
      });

      const videoUrl = videoUrls[0];
      const sentMessage = await ctx.telegram.sendVideo(ctx.chat.id, videoUrl, {
        caption: '🎬 Here is your video!',
        supports_streaming: true
      });

      await this.memberManager.recordBotResponse(channelId, userId);
      if (userId && username) await this._recordMediaUsage(userId, username, 'video');

      // Add to conversation history
      await this.conversationManager.addMessage(channelId, {
        from: 'Bot', 
        text: `[Generated Video: ${prompt}]`, 
        date: Math.floor(Date.now() / 1000), 
        isBot: true, 
        messageId: sentMessage?.message_id
      }, true);

      const pending = this.pendingReplies.get(channelId) || {};
      pending.lastBotResponseTime = Date.now();
      this.pendingReplies.set(channelId, pending);

      const record = await this._rememberGeneratedMedia(channelId, {
        type: 'video', mediaUrl: videoUrl, prompt,
        messageId: sentMessage?.message_id, userId,
        source: 'telegram.generate_video',
        toolingState: { originalPrompt: prompt, aspectRatio },
        metadata: { requestedBy: userId }
      });

      return record;
    } catch (error) {
      await this._handleMediaError(ctx, error, 'video', userId);
      return null;
    } finally {
      this._releaseVideoGenerationLock(channelId, traceId);
    }
  }

  async queueVideoGenerationAsync(ctx, prompt, options = {}) {
    const channelId = String(ctx.chat.id);
    const limits = await this.checkMediaGenerationLimit(null, 'video');
    if (!limits.allowed) {
      await ctx.reply('🎬 Video generation charges are fully used up right now.');
      return { queued: false, error: 'rate_limit' };
    }

    const traceId = generateTraceId();
    if (!this._acquireVideoGenerationLock(channelId, traceId)) {
      await ctx.reply('🎬 Still processing previous video.');
      return { queued: false, error: 'in_progress' };
    }

    let keyframeUrl = options.keyframeUrl || null;
    let enhancedPrompt = prompt;
    if (!keyframeUrl) {
      try {
        const keyframe = await this._generateImageAsset({
          prompt,
          conversationContext: options.conversationContext,
          userId: options.userId,
          username: options.username,
          source: 'telegram.video_keyframe_async'
        });
        keyframeUrl = keyframe?.imageUrl || null;
        if (keyframe?.enhancedPrompt) {
          enhancedPrompt = keyframe.enhancedPrompt;
        }
      } catch (err) {
        this.logger?.warn?.('[TelegramService] Async keyframe generation failed:', err?.message || err);
      }
    }

    try {
      const db = await this.databaseService.getDatabase();
      const jobDoc = {
        type: 'telegram-video',
        platform: 'telegram',
        status: 'queued',
        createdAt: new Date(),
        prompt: enhancedPrompt,
        originalPrompt: prompt,
        channelId,
        chatId: ctx.chat.id,
        userId: options.userId,
        username: options.username,
        conversationContext: options.conversationContext || null,
        keyframeUrl,
        config: {
          aspectRatio: options.aspectRatio || '9:16',
          style: options.style,
          camera: options.camera
        },
        lockTraceId: traceId
      };
      
      const result = await db.collection('telegram_video_jobs').insertOne(jobDoc);
      await ctx.reply('🎬 Video queued! It takes 2-5 minutes. I\'ll send it when ready.');
      
      if (options.userId) await this._recordMediaUsage(options.userId, options.username, 'video');
      
      this._processVideoJobAsync(result.insertedId.toString(), ctx).catch(err => 
        this.logger?.error?.('[TelegramService] Async job failed:', err)
      );
      
      return { queued: true, jobId: result.insertedId.toString() };
    } catch (error) {
      this.logger?.error?.('[TelegramService] Queue failed:', error);
      this._releaseVideoGenerationLock(channelId, traceId);
      await ctx.reply('Error queueing video. Please try again soon.');
      return { queued: false, error: error.message };
    }
  }

  async _processVideoJobAsync(jobId, _ctx) {
    const db = await this.databaseService.getDatabase();
    const collection = db.collection('telegram_video_jobs');
    const { ObjectId } = await import('mongodb');
    
    const job = await collection.findOneAndUpdate(
      { _id: new ObjectId(jobId), status: 'queued' },
      { $set: { status: 'processing', startedAt: new Date() } }
    );
    
    if (!job) return;
    const jobData = job; // job is actually the doc before update if returnDocument not set, or verify result

    try {
      // Get character design for reference
      const charDesign = this.globalBotService?.bot?.globalBotConfig?.characterDesign;
      
      const videoUrls = await this.mediaGenerationManager.generateVideo({
        prompt: jobData.prompt,
        config: { ...jobData.config, durationSeconds: 8 },
        style: jobData.config?.style,
        camera: jobData.config?.camera,
        channelId: jobData.channelId,
        traceId: jobData.lockTraceId,
        keyframeImage: jobData.keyframeUrl ? { url: jobData.keyframeUrl } : null,
        referenceImages: charDesign?.referenceImageUrl ? [charDesign.referenceImageUrl] : []
      });
      
      const videoUrl = videoUrls[0];
      const sent = await this.globalBot.telegram.sendVideo(jobData.chatId, videoUrl, {
        caption: '🎬 Your video is ready!',
        supports_streaming: true
      });
      
      await collection.updateOne(
        { _id: new ObjectId(jobId) },
        { $set: { status: 'completed', completedAt: new Date(), result: { videoUrl } } }
      );
      
      await this.mediaManager.rememberGeneratedMedia(jobData.channelId, {
        type: 'video', mediaUrl: videoUrl, prompt: jobData.prompt,
        messageId: sent.message_id, userId: jobData.userId,
        source: 'telegram.generate_video_async'
      });
      
      this._releaseVideoGenerationLock(jobData.channelId, jobData.lockTraceId);
    } catch (error) {
      this.logger?.error?.(`[TelegramService] Job ${jobId} failed:`, error);
      await collection.updateOne(
        { _id: new ObjectId(jobId) },
        { $set: { status: 'failed', lastError: error.message } }
      );
      try {
        await this.globalBot.telegram.sendMessage(jobData.chatId, '❌ Video generation failed.');
      } catch {}
      this._releaseVideoGenerationLock(jobData.channelId, jobData.lockTraceId);
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  async checkMediaGenerationLimit(userId, mediaType) {
    try {
      const db = await this.databaseService.getDatabase();
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
      const limits = this.mediaGenerationLimits[mediaType] || { hourly: 0, daily: 0 };
      const exhausted = this._serviceExhausted.get(mediaType);
      
      if (exhausted && exhausted > now) {
        return { allowed: false, hourlyUsed: limits.hourly, dailyUsed: limits.daily, hourlyLimit: limits.hourly, dailyLimit: limits.daily, resetTimes: { hourly: exhausted, daily: exhausted } };
      }
      
      const usageCol = db.collection('telegram_media_usage');
      const [hourlyUsage, dailyUsage] = await Promise.all([
        usageCol.countDocuments({ mediaType, createdAt: { $gte: oneHourAgo } }),
        usageCol.countDocuments({ mediaType, createdAt: { $gte: oneDayAgo } })
      ]);
      
      return {
        allowed: hourlyUsage < limits.hourly && dailyUsage < limits.daily,
        hourlyUsed: hourlyUsage, dailyUsed: dailyUsage,
        hourlyLimit: limits.hourly, dailyLimit: limits.daily,
        resetTimes: { hourly: new Date(now.getTime() + 60*60*1000), daily: new Date(now.getTime() + 24*60*60*1000) }
      };
    } catch (err) {
      this.logger?.error?.('[TelegramService] checkMediaGenerationLimit failed:', err);
      return { allowed: true, hourlyUsed: 0, dailyUsed: 0, hourlyLimit: 100, dailyLimit: 100 };
    }
  }

  async _recordMediaUsage(userId, username, mediaType) {
    try {
      const db = await this.databaseService.getDatabase();
      await db.collection('telegram_media_usage').insertOne({
        userId, username, mediaType, createdAt: new Date()
      });
    } catch (err) {
      this.logger?.error?.('[TelegramService] _recordMediaUsage failed:', err);
    }
  }

  // Wrappers for video locking
  _acquireVideoGenerationLock(channelId, traceId) {
    if (!channelId) return true;
    const now = Date.now();
    const current = this._videoGenerationLocks.get(channelId);
    if (current && current.expiresAt > now && current.traceId !== traceId) return false;
    this._videoGenerationLocks.set(channelId, { traceId, expiresAt: now + this.VIDEO_GENERATION_LOCK_MS });
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
    if (current && current.traceId === traceId) this._videoGenerationLocks.delete(channelId);
  }

  _setupVideoProgressListener() {
    ensureVideoProgressListener();
  }

  _registerVideoProgress(traceId, ctx, messageId) {
    if (!messageId) return;
    videoProgressHandlers.set(traceId, { ctx, messageId, lastUpdate: Date.now(), logger: this.logger || console });
  }

  async _handleMediaError(ctx, error, type, userId) {
    this.logger?.error?.(`[TelegramService] ${type} error:`, error);
    let msg = `❌ Failed to generate ${type}.`;
    if (error.message?.includes('quota')) {
      msg = `🚫 ${type} generation quota exceeded. Try again later.`;
      this.cacheManager.markServiceExhausted(type, 60*60*1000);
    }
    await ctx.reply(msg);
    await this.memberManager.recordBotResponse(String(ctx.chat.id), userId);
  }

  async _generateImageAsset(params) {
    if (!this.mediaGenerationManager?.generateImageAsset) {
      throw new Error('Image generation unavailable');
    }
    return this.mediaGenerationManager.generateImageAsset(params);
  }

  async _rememberGeneratedMedia(channelId, entry) {
    const record = await this.mediaManager.rememberGeneratedMedia(channelId, entry);
    if (record) {
      const limit = Number.isFinite(this.RECENT_MEDIA_LIMIT)
        ? Math.max(1, Number(this.RECENT_MEDIA_LIMIT))
        : MEDIA_CONFIG.RECENT_LIMIT;
      const cached = (this.recentMediaByChannel.get(record.channelId) || []).slice(0, limit);
      this.recentMediaByChannel.set(record.channelId, cached);
    }
    return record;
  }

  async _getRecentMedia(channelId, limit = MEDIA_CONFIG.RECENT_LIMIT) {
    return this.mediaManager.getRecentMedia(channelId, limit);
  }

  async _markMediaAsTweeted(channelId, mediaId, meta = {}) {
    return this.mediaManager.markMediaAsTweeted(channelId, mediaId, meta);
  }

  async _ensureTelegramIndexes() {
    if (!this.mediaManager) return false;
    await this.mediaManager.ensureIndexes();
    return this._indexesReady;
  }

  _formatTelegramMarkdown(text) {
    return formatTelegramMarkdown(text, this.logger);
  }

  async _recordBotResponse(channelId, userId) {
    if (!channelId) return false;
    return this.memberManager.recordBotResponse(channelId, userId);
  }

  _getGlobalChannelId() {
    return this.configService?.get('TELEGRAM_GLOBAL_CHANNEL_ID') || process.env.TELEGRAM_GLOBAL_CHANNEL_ID;
  }

  /**
   * Update global Telegram posting configuration
   * @param {Object} patch - Configuration updates (enabled, channelId, rate)
   * @returns {Object} Updated configuration
   */
  async updateGlobalPostingConfig(patch) {
    if (!patch || typeof patch !== 'object') throw new Error('patch object required');
    const db = await this.databaseService.getDatabase();
    await db.collection('telegram_post_config').updateOne(
      { _id: 'global' },
      { $set: { ...patch, updatedAt: new Date() } },
      { upsert: true }
    );
    return db.collection('telegram_post_config').findOne({ _id: 'global' });
  }

  async _buildPlanContext(channelId, limit = 3) {
    return this.planManager.buildPlanContext(channelId, limit);
  }

  // Refactored helper for resolving media references (uses MediaManager directly)
  async _collectReferenceImages(channelId, { explicitIds = [], fallbackId = null } = {}) {
    const urls = [];
    const recordIds = [];
    const sources = [];
    const seen = new Set();

    const push = (url, src, id) => {
      if (url && !seen.has(url) && urls.length < MAX_REFERENCE_IMAGES) {
        seen.add(url); urls.push(url); sources.push(src); if (id) recordIds.push(id);
      }
    };

    // Persona reference
    const design = this.globalBotService?.bot?.globalBotConfig?.characterDesign;
    if (design?.enabled && design.referenceImageUrl) {
      push(design.referenceImageUrl, 'persona');
    }

    // Explicit IDs
    for (const id of [...explicitIds, fallbackId].filter(Boolean)) {
      const media = await this.mediaManager.getMediaById(channelId, id);
      if (media?.mediaUrl && ['image', 'keyframe'].includes(media.type)) {
        push(media.mediaUrl, 'history', media.id);
      }
    }

    return { urls, recordIds, sources, personaReferenceUsed: !!design?.enabled };
  }

  // Legacy/Internal helpers
  async registerBuybotCommands() {
    if (this.globalBot) {
      try {
        await this.globalBot.telegram.setMyCommands([
          { command: 'settings', description: '⚙️ Manage buybot settings' },
          { command: 'help', description: '❓ Show help' }
        ]);
      } catch {}
    }
  }

  async executeTokenStatsLookup(ctx, tokenSymbol, channelId) {
    if (!this.buybotService) {
      await ctx.reply('📊 Token tracking not available.');
      return;
    }
    try {
      const db = await this.databaseService.getDatabase();
      const token = await db.collection('buybot_tracked_tokens').findOne({
        channelId, active: true, tokenSymbol: { $regex: new RegExp(`^${tokenSymbol}$`, 'i') }
      });
      
      if (!token) {
        await ctx.reply(`📊 ${tokenSymbol} is not tracked here.`);
        return;
      }
      
      const priceData = await this.buybotService.getTokenPrice(token.tokenAddress);
      await ctx.reply(formatTelegramMarkdown(
        `📊 *${token.tokenSymbol}*\n💰 Price: $${priceData?.price || '?'}\n🔗 \`${token.tokenAddress}\``
      ), { parse_mode: 'HTML' });
    } catch (err) {
      this.logger?.error?.('[TelegramService] Token stats lookup failed:', err);
      await ctx.reply('❌ Failed to fetch stats.');
    }
  }

  async executeTweetPost(ctx, { text, mediaId, channelId, userId, username }) {
    if (!this.xService) {
      await ctx.reply('🚫 X service unavailable.');
      return { success: false, error: 'X service unavailable' };
    }
    
    // Resolve content filters
    const effectiveContentFilters = await this._resolveContentFilters();

    if (effectiveContentFilters.enabled) {
      this.logger?.debug?.('[TelegramService] Effective content filters for X:', { 
        allowedCashtags: effectiveContentFilters.allowedCashtags, 
        text: text?.slice(0, 50) 
      });

      const contentFilter = filterContent(text || '', {
        logger: this.logger,
        blockCryptoAddresses: effectiveContentFilters.blockCryptoAddresses !== false,
        blockCashtags: effectiveContentFilters.blockCashtags !== false,
        allowedCashtags: effectiveContentFilters.allowedCashtags,
        allowedAddresses: effectiveContentFilters.allowedAddresses
      });
      
      if (contentFilter.blocked) {
        this.logger?.info?.(`[TelegramService] Blocked tweet (${contentFilter.type}) from ${userId}: ${contentFilter.reason}`);
        await ctx.reply(`🚫 Cannot post: ${contentFilter.reason}`);
        return { success: false, error: `Content blocked: ${contentFilter.reason}` };
      }
    }

    const tweetLimits = await this.checkMediaGenerationLimit(null, 'tweet');
    if (!tweetLimits.allowed) {
      await ctx.reply('🐦 X posting is cooling down. Try again later.');
      return { success: false, error: 'Rate limited' };
    }
    
    const media = await this.mediaManager.findRecentMediaById(channelId, mediaId);
    if (!media || !media.mediaUrl) {
      await ctx.reply('❌ Media not found or expired.');
      return { success: false, error: 'Media not found or expired' };
    }
    
    if (media.tweetedAt) {
      await ctx.reply('⚠️ Already tweeted.');
      return { success: false, error: 'Already tweeted', alreadyTweeted: true };
    }
    
    const result = await this.xService.postGlobalMediaUpdate({
      mediaUrl: media.mediaUrl,
      text: text.slice(0, 270),
      type: media.type === 'video' ? 'video' : 'image',
      source: 'telegram.tweet_tool',
      metadata: { telegramChannelId: channelId, telegramMediaId: media.id, requestedBy: userId },
      contentFilters: effectiveContentFilters
    }, { aiService: this.aiService });
    
    if (result?.tweetId) {
      await this._markMediaAsTweeted(channelId, media.id, { tweetId: result.tweetId });
      const linkText = (result.tweetUrl || '').trim();
      let sentMessage;
      if (linkText) {
        try {
          sentMessage = await ctx.reply(linkText, { disable_web_page_preview: false });
        } catch {
          sentMessage = await ctx.reply('🕊️ Posted to X (link unavailable).');
        }
      } else {
        sentMessage = await ctx.reply('🕊️ Posted to X.');
      }

      // Add to conversation history
      await this.conversationManager.addMessage(channelId, {
        from: 'Bot', 
        text: linkText || '🕊️ Posted to X.', 
        date: Math.floor(Date.now() / 1000), 
        isBot: true, 
        messageId: sentMessage?.message_id
      }, true);

      const pending = this.pendingReplies.get(channelId) || {};
      pending.lastBotResponseTime = Date.now();
      this.pendingReplies.set(channelId, pending);
      if (userId) await this._recordMediaUsage(userId, username, 'tweet');
      return { success: true, tweetId: result.tweetId, tweetUrl: result.tweetUrl };
    } else {
      const reason = result?.error || result?.reason || 'unknown error';
      this.logger?.warn?.('[TelegramService] Tweet post failed:', { channelId, mediaId, reason, result });
      await ctx.reply(`❌ Failed to tweet: ${escapeHtml(reason)}`);
      return { success: false, error: reason };
    }
  }

  async postGlobalMediaUpdate(payload = {}, { aiService } = {}) {
    const channelId = this._getGlobalChannelId();
    if (!this.globalBot || !channelId) {
      this.logger?.warn?.('[TelegramService] postGlobalMediaUpdate skipped: global bot missing or TELEGRAM_GLOBAL_CHANNEL_ID not set');
      return null;
    }

    const type = (payload.type || '').toLowerCase();
    const isTweetLink = type === 'tweet';
    const videoUrl = payload.videoUrl || (type === 'video' ? payload.mediaUrl : null);
    const imageUrl = !videoUrl ? (payload.mediaUrl || payload.imageUrl || null) : null;
    let text = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!text) {
      text = (payload.caption || payload.prompt || payload.context || '').toString().trim();
    }

    // Optionally let AI polish captions when available and not a raw tweet link
    if (!isTweetLink && !text && typeof aiService?.chat === 'function' && payload.prompt) {
      try {
        const response = await aiService.chat([{ role: 'user', content: `Write a short caption for Telegram about: ${payload.prompt}` }]);
        text = String(response || '').trim();
      } catch (err) {
        this.logger?.debug?.('[TelegramService] postGlobalMediaUpdate caption fallback failed:', err?.message);
      }
    }

    const formattedText = text && !isTweetLink ? formatTelegramMarkdown(text, this.logger) : text;
    const parseMode = formattedText && !isTweetLink ? 'HTML' : undefined;

    let sentMessage = null;
    const telegram = this.globalBot.telegram;
    if (isTweetLink && formattedText) {
      sentMessage = await telegram.sendMessage(channelId, formattedText, { disable_web_page_preview: false });
    } else if (videoUrl) {
      sentMessage = await telegram.sendVideo(channelId, videoUrl, {
        caption: formattedText || undefined,
        parse_mode: parseMode,
        supports_streaming: true
      });
    } else if (imageUrl) {
      sentMessage = await sendImagePreservingFormat(
        telegram,
        channelId,
        imageUrl,
        {
          caption: formattedText || undefined,
          parseMode: parseMode,
          includeDownloadLink: true
        },
        this.logger
      );
    } else if (formattedText) {
      sentMessage = await telegram.sendMessage(channelId, formattedText, parseMode ? { parse_mode: parseMode } : undefined);
    } else {
      throw new Error('postGlobalMediaUpdate requires media or text content');
    }

    try {
      const db = await this.databaseService.getDatabase();
      const metadata = {
        source: payload.source || 'telegram.global_post',
        ...(payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {})
      };
      if (payload.avatarId) {
        metadata.avatarId = String(payload.avatarId);
        metadata.avatarName = payload.avatarName || null;
        metadata.avatarEmoji = payload.avatarEmoji || null;
      }
      if (payload.tweetUrl) metadata.tweetUrl = payload.tweetUrl;
      if (payload.tweetId) metadata.tweetId = payload.tweetId;

      await db.collection('social_posts').insertOne({
        global: true,
        platform: 'telegram',
        mediaType: isTweetLink ? 'tweet' : (videoUrl ? 'video' : (imageUrl ? 'image' : 'text')),
        mediaUrl: videoUrl || imageUrl || null,
        content: text || null,
        channelId: String(channelId),
        messageId: sentMessage?.message_id || null,
        metadata,
        createdAt: new Date()
      });
    } catch (err) {
      this.logger?.warn?.('[TelegramService] Failed to record global Telegram post:', err?.message);
    }

    return {
      messageId: sentMessage?.message_id,
      chatId: sentMessage?.chat?.id,
      message: sentMessage
    };
  }

  async shutdown() {
    this.cacheManager.stopCleanup();
    this.pendingReplies.clear();
    this._recentInteractors.clear();
    this._channelReplyQueue.clear();
    if (this.globalBot) await this.globalBot.stop('SIGTERM');
    this.bots.clear();
    this.logger?.info?.('[TelegramService] Shutdown complete');
  }
}

export { TelegramService };
export default TelegramService;