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

// Import modular components
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
  escapeHtml,
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
  validatePlan,
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
    this._videoProgressHandlers = new Map(); // traceId -> { ctx, messageId, lastUpdate }
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
      
      this.cacheManager.startCleanup();
      this.startConversationGapPolling();
      
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
   * Handle incoming messages with debouncing and mention detection
   */
  async handleIncomingMessage(ctx) {
    const message = ctx.message;
    const channelId = String(ctx.chat.id);
    const userId = message.from?.id ? String(message.from.id) : null;
    const isPrivateChat = ctx.chat?.type === 'private';
    
    if (message.from.is_bot) return;
    if (message.text && message.text.startsWith('/')) return;

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
      this.conversationManager.loadConversationHistory(channelId).catch(err => 
        this.logger?.error?.('[TelegramService] Background history load failed:', err)
      );
    }
    
    await this.conversationManager.addMessage(channelId, {
      from: message.from.first_name || message.from.username || 'User',
      text: message.text ?? message.caption ?? '',
      date: message.date,
      isBot: false,
      userId
    }, true);

    const botId = this.globalBot?.botInfo?.id || ctx.botInfo?.id;
    const isReplyToBot = message.reply_to_message && botId && message.reply_to_message.from?.id === botId;
    const isActiveParticipant = this.conversationManager.isActiveParticipant(channelId, userId);
    const shouldRespond = isMentioned || isReplyToBot || isActiveParticipant;

    if (shouldRespond) {
      this.conversationManager.updateActiveConversation(channelId, userId);
      
      const releaseLock = this.cacheManager.tryAcquireLock(channelId);
      if (!releaseLock) return;

      const pending = this.pendingReplies.get(channelId) || {};
      if (pending.isProcessing) {
        releaseLock();
        return;
      }

      pending.isProcessing = true;
      pending.requestId = generateRequestId(ctx);
      this.pendingReplies.set(channelId, pending);

      try {
        await this.generateAndSendReply(ctx, channelId, true);
      } finally {
        const updatedPending = this.pendingReplies.get(channelId) || {};
        updatedPending.lastBotResponseTime = Date.now();
        updatedPending.isProcessing = false;
        updatedPending.requestId = null;
        this.pendingReplies.set(channelId, updatedPending);
        releaseLock();
      }
    }
  }

  // ===========================================================================
  // Response Generation & Polling
  // ===========================================================================

  startConversationGapPolling() {
    const POLL_INTERVAL = 30000;
    const GAP_THRESHOLD = 45000;
    
    setInterval(async () => {
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
                date: lastMessage.date
              },
              telegram: this.globalBot.telegram,
              reply: async (text) => this.globalBot.telegram.sendMessage(channelId, text)
            };
            
            await this.generateAndSendReply(mockCtx, channelId, false);
            
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
    }, POLL_INTERVAL);
  }

  async generateAndSendReply(ctx, channelId, isMention) {
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

      let fullHistory = this.conversationManager.getHistory(channelId);
      if (!fullHistory || fullHistory.length === 0) {
        fullHistory = await this.conversationManager.loadConversationHistory(channelId);
      }
      const recentHistory = fullHistory.slice(-20);
      
      let conversationContext = recentHistory.length > 0
        ? recentHistory.map(m => `${m.from}: ${m.text}`).join('\n')
        : `${ctx.message.from.first_name || ctx.message.from.username || 'User'}: ${ctx.message.text}`;

      if (ctx.message?.reply_to_message) {
        const reply = ctx.message.reply_to_message;
        const replyFrom = reply.from?.first_name || reply.from?.username || 'User';
        let replyContent = reply.text || (reply.caption ? `[Media] ${reply.caption}` : '[Media]');
        conversationContext += `\n(User is replying to ${replyFrom}: "${replyContent}")`;
      }

      let botPersonality = 'You are the CosyWorld narrator bot.';
      let botDynamicPrompt = '';
      if (persona?.bot) {
        botPersonality = persona.bot.personality || botPersonality;
        botDynamicPrompt = persona.bot.dynamicPrompt || '';
      }

      const toolCreditContext = `
Tool Credits (global): ${buildCreditInfo(imageLimitCtx, 'Images')} | ${buildCreditInfo(videoLimitCtx, 'Videos')} | ${buildCreditInfo(tweetLimitCtx, 'X posts')}
Rule: Only call tools if credits available. If 0, explain naturally and mention reset time.`;

      const planContext = await this.planManager.buildPlanContext(channelId, 3);
      const recentMediaContext = await this.mediaManager.buildRecentMediaContext(channelId, 5);
      const buybotContextStr = buybotContext ? `\nToken Tracking (Buybot):\n${buybotContext}\n` : '';

      const systemPrompt = `${botPersonality}
${botDynamicPrompt}
Conversation mode: ${isMention ? 'Direct mention' : 'General chat'}
${toolCreditContext}${buybotContextStr}
${planContext.summary}
${recentMediaContext.summary}
CRITICAL: When posting to X, use recent media ID. Don't post old images.`;

      const userPrompt = `Recent conversation:\n${conversationContext}\nRespond naturally.`;

      if (!this.aiService) {
        await ctx.reply('I\'m here and listening! 👂 (AI service not configured)');
        return;
      }

      // Use tool definitions from module
      const tools = (await import('./telegram/toolDefinitions.mjs')).buildToolDefinitions();

      const response = await this.aiService.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], {
        model: this.globalBotService?.bot?.model || 'anthropic/claude-sonnet-4.5',
        temperature: 0.8,
        tools: tools,
        tool_choice: 'auto'
      });

      const responseObj = typeof response === 'object' ? response : { text: response };
      
      if (responseObj.tool_calls && responseObj.tool_calls.length > 0) {
        const acknowledgment = (typeof responseObj.text === 'string' && responseObj.text.trim()) 
          ? responseObj.text.trim() : '';
        
        if (acknowledgment) {
          await ctx.reply(acknowledgment);
          await this.memberManager.recordBotResponse(channelId, userId);
          await this.conversationManager.addMessage(channelId, {
            from: 'Bot', text: acknowledgment, date: Math.floor(Date.now() / 1000), isBot: true
          }, true);
        }
        
        await this.handleToolCalls(ctx, responseObj.tool_calls, conversationContext);
        return;
      }

      const responseText = String(responseObj.text || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      if (responseText) {
        await ctx.reply(formatTelegramMarkdown(responseText), { parse_mode: 'HTML' });
        await this.memberManager.recordBotResponse(channelId, userId);
        await this.conversationManager.addMessage(channelId, {
          from: 'Bot', text: responseText, date: Math.floor(Date.now() / 1000), isBot: true
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

      if (functionName === 'plan_actions') {
        await this.executePlanActions(ctx, args, channelId, userId, username, conversationContext);
      } else if (functionName === 'get_token_stats') {
        await this.executeTokenStatsLookup(ctx, args.tokenSymbol, String(ctx.chat.id));
      } else if (functionName === 'generate_image') {
        const limit = await this.checkMediaGenerationLimit(null, 'image');
        if (!limit.allowed) {
          await ctx.reply('🎨 Image generation charges are fully used up right now.');
          continue;
        }
        await this.executeImageGeneration(ctx, args.prompt, conversationContext, userId, username, { aspectRatio: args.aspectRatio || '1:1' });
      } else if (functionName === 'generate_video') {
        const limit = await this.checkMediaGenerationLimit(null, 'video');
        if (!limit.allowed) {
          await ctx.reply('🎬 Video generation charges are fully used up right now.');
          continue;
        }
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
        await this.executeTweetPost(ctx, { 
          text: args.text, 
          mediaId: args.mediaId, 
          channelId, userId, username 
        });
      }
      // Additional tools (video_from_image, extend_video, etc) follow same pattern...
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

    let progressMessageId = null;
    const updateProgress = async (stepNum, total, action) => {
      const icon = getActionIcon(action);
      const label = getActionLabel(action);
      const message = `${icon} <b>Step ${stepNum}/${total}:</b> ${label}...`;
      progressMessageId = await this.interactionManager.updateProgressMessage(ctx, progressMessageId, message, channelId);
    };

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
        onProgress: updateProgress,
        onStepComplete: async () => {},
        onError: async (err, num, act) => {
          this.logger?.warn?.(`[TelegramService] Step ${num} (${act}) failed:`, err.message);
          await ctx.reply(`⚠️ Step ${num} (${escapeHtml(act)}) failed: ${escapeHtml(err.message)}`);
        }
      });
      
      // Intentionally no success/failure notification to avoid extra spam in chats
    } catch (error) {
      this.logger?.error?.('[TelegramService] executePlanActions error:', error);
      await ctx.reply('Planning fizzled out for a moment—try again and I will map it out.');
    } finally {
      await this.interactionManager.deleteProgressMessage(ctx, progressMessageId, channelId);
    }

    return executionResult;
  }

  // ===========================================================================
  // Media Generation Implementations
  // ===========================================================================

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

      const sentMessage = await ctx.telegram.sendPhoto(ctx.chat.id, imageUrl, {
        caption: caption ? formatTelegramMarkdown(caption) : undefined,
        parse_mode: 'HTML'
      });

      await this.memberManager.recordBotResponse(String(ctx.chat.id), userId);
      if (userId && username) await this._recordMediaUsage(userId, username, 'image');

      const channelId = String(ctx.chat.id);
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
    eventBus.on('video:progress', async (event) => {
      const { traceId, status, progress } = event;
      const handler = this._videoProgressHandlers.get(traceId);
      if (handler && (Date.now() - handler.lastUpdate > 5000 || status === 'complete')) {
        try {
          await handler.ctx.telegram.editMessageText(
            handler.ctx.chat.id, handler.messageId, null, 
            `🎬 ${status}... ${progress}%`
          );
          handler.lastUpdate = Date.now();
        } catch {}
      }
      if (status === 'complete' || status === 'error') this._videoProgressHandlers.delete(traceId);
    });
  }

  _registerVideoProgress(traceId, ctx, messageId) {
    if (messageId) this._videoProgressHandlers.set(traceId, { ctx, messageId, lastUpdate: Date.now() });
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
      return;
    }

    const tweetLimits = await this.checkMediaGenerationLimit(null, 'tweet');
    if (!tweetLimits.allowed) {
      await ctx.reply('🐦 X posting is cooling down. Try again later.');
      return;
    }
    
    const media = await this.mediaManager.findRecentMediaById(channelId, mediaId);
    if (!media || !media.mediaUrl) {
      await ctx.reply('❌ Media not found or expired.');
      return;
    }
    
    if (media.tweetedAt) {
      await ctx.reply('⚠️ Already tweeted.');
      return;
    }
    
    const result = await this.xService.postGlobalMediaUpdate({
      mediaUrl: media.mediaUrl,
      text: text.slice(0, 270),
      type: media.type === 'video' ? 'video' : 'image',
      source: 'telegram.tweet_tool',
      metadata: { telegramChannelId: channelId, telegramMediaId: media.id, requestedBy: userId }
    }, { aiService: this.aiService });
    
    if (result?.tweetId) {
      await this._markMediaAsTweeted(channelId, media.id, { tweetId: result.tweetId });
      const linkText = (result.tweetUrl || '').trim();
      if (linkText) {
        try {
          await ctx.reply(linkText, { disable_web_page_preview: false });
        } catch {
          await ctx.reply('🕊️ Posted to X (link unavailable).');
        }
      } else {
        await ctx.reply('🕊️ Posted to X.');
      }
      if (userId) await this._recordMediaUsage(userId, username, 'tweet');
    } else {
      const reason = result?.error || result?.reason || 'unknown error';
      this.logger?.warn?.('[TelegramService] Tweet post failed:', { channelId, mediaId, reason, result });
      await ctx.reply(`❌ Failed to tweet: ${escapeHtml(reason)}`);
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
      sentMessage = await telegram.sendPhoto(channelId, imageUrl, {
        caption: formattedText || undefined,
        parse_mode: parseMode
      });
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
    if (this.globalBot) await this.globalBot.stop('SIGTERM');
    this.bots.clear();
    this.logger?.info?.('[TelegramService] Shutdown complete');
  }
}

export { TelegramService };
export default TelegramService;