/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * UnifiedChatAgent - Platform-agnostic AI chat agent
 * 
 * This service provides the core AI agent functionality that can be used
 * across different platforms (Telegram, Discord, etc.) through platform adapters.
 * 
 * Architecture:
 * - UnifiedChatAgent: Core AI logic, tool definitions, context building, plan execution
 * - PlatformAdapter: Platform-specific message sending, reactions, typing indicators
 * 
 * This eliminates code duplication between telegram and discord chat handlers.
 */

import {
  CORE_CASHTAGS,
  DEFAULT_MODEL,
} from '../social/telegram/constants.mjs';
import { buildConversationContext, buildToolDefinitions, filterToolCalls } from '../social/telegram/index.mjs';
import { filterContent } from '../../utils/contentFilter.mjs';
import { generateTraceId } from '../../utils/tracing.mjs';
import { CacheManager, ConversationManager, ContextManager, PlanManager, MediaManager, MemberManager, MediaGenerationManager } from '../social/telegram/index.mjs';
import { PlanExecutionService } from '../planner/planExecutionService.mjs';
import { actionExecutorRegistry } from '../planner/actionExecutor.mjs';
import { validatePlan, logPlanSummary } from '../social/telegram/index.mjs';
import { KnowledgeBaseService } from '../knowledge/knowledgeBaseService.mjs';

// Timing constants
const TIMING = {
  REPLY_DELAY_MENTIONED_MS: 1500,
  REPLY_DELAY_DEFAULT_MS: 3000,
  TYPING_REFRESH_MS: 4000,
};

/**
 * UnifiedChatAgent - Shared AI agent that works across platforms
 */
export class UnifiedChatAgent {
  constructor({
    logger,
    databaseService,
    configService,
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
    this.aiService = aiService;
    this.globalBotService = globalBotService;
    this.googleAIService = googleAIService;
    this.veoService = veoService;
    this.buybotService = buybotService;
    this.xService = xService;
    this.mediaGenerationService = mediaGenerationService;
    this.mediaIndexService = mediaIndexService;
    this.wikiService = wikiService;

    // Managers - shared across platforms
    this.cacheManager = new CacheManager({ logger: this.logger });
    
    this.conversationManager = new ConversationManager({
      logger: this.logger,
      databaseService: this.databaseService,
      cacheManager: this.cacheManager,
    });
    
    this.memberManager = new MemberManager({
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

    this.planManager = new PlanManager({
      logger: this.logger,
      databaseService: this.databaseService,
      cacheManager: this.cacheManager,
    });

    this.contextManager = new ContextManager({
      logger: this.logger,
      databaseService: this.databaseService,
      globalBotService: this.globalBotService,
      buybotService: this.buybotService,
      cacheManager: this.cacheManager,
    });

    this.mediaGenerationManager = new MediaGenerationManager({
      logger: this.logger,
      aiService: this.aiService,
      googleAIService: this.googleAIService,
      veoService: this.veoService,
      mediaGenerationService: this.mediaGenerationService,
      globalBotService: this.globalBotService,
    });

    this.knowledgeBaseService = new KnowledgeBaseService({
      logger: this.logger,
      wikiService: this.wikiService,
    });

    this.planExecutionService = new PlanExecutionService({
      logger: this.logger,
      executorRegistry: actionExecutorRegistry,
    });

    // Pending replies tracking
    this.pendingReplies = this.cacheManager.pendingReplies;
  }

  /**
   * Initialize the agent
   */
  async initialize() {
    try {
      if (this.mediaManager.ensureIndexes) {
        await this.mediaManager.ensureIndexes();
      }

      if (this.knowledgeBaseService) {
        await this.knowledgeBaseService.initialize();
      }

      this.cacheManager.startCleanup();
      this.logger?.info?.('[UnifiedChatAgent] Initialized successfully');
      return true;
    } catch (error) {
      this.logger?.error?.('[UnifiedChatAgent] Initialization failed:', error);
      return false;
    }
  }

  /**
   * Resolve content filters with dynamic allowlists
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
        this.logger?.debug?.('[UnifiedChatAgent] Failed to get dynamic token allowlist:', err.message);
      }
    }

    const dynamicSymbols = (dynamicAllowlist.symbols || []).map(s =>
      s.startsWith('$') ? s : `$${s}`
    );

    const allowedCashtags = [
      ...(contentFilters.allowedCashtags || []),
      ...dynamicSymbols,
      ...CORE_CASHTAGS,
    ];

    const allowedAddresses = [
      ...(contentFilters.allowedAddresses || []),
      ...(dynamicAllowlist.addresses || []),
    ];

    return {
      ...contentFilters,
      enabled: true,
      allowedCashtags,
      allowedAddresses,
    };
  }

  /**
   * Check if message content should be filtered
   * @param {string} text - Message text to check
   * @returns {Object} { blocked: boolean, type?: string, reason?: string }
   */
  async checkContentFilter(text) {
    const effectiveFilters = await this._resolveContentFilters();
    if (!effectiveFilters.enabled) {
      return { blocked: false };
    }

    return filterContent(text, {
      logger: this.logger,
      blockCryptoAddresses: effectiveFilters.blockCryptoAddresses !== false,
      blockCashtags: effectiveFilters.blockCashtags !== false,
      allowedCashtags: effectiveFilters.allowedCashtags,
      allowedAddresses: effectiveFilters.allowedAddresses,
    });
  }

  /**
   * Add a message to conversation history
   * @param {string} channelId - Channel identifier (platform-prefixed for uniqueness)
   * @param {Object} message - Message data
   */
  async addToHistory(channelId, message) {
    return this.conversationManager.addMessage(channelId, message, true);
  }

  /**
   * Get or load conversation history for a channel
   * @param {string} channelId - Channel identifier
   */
  async getHistory(channelId) {
    let history = this.conversationManager.getHistory(channelId);
    if (!history || history.length === 0) {
      history = await this.conversationManager.loadConversationHistory(channelId);
    }
    return history;
  }

  /**
   * Check media generation limits
   * @param {string} userId - User ID
   * @param {string} mediaType - 'image' | 'video' | 'tweet'
   */
  async checkMediaLimit(_userId, _mediaType) {
    // Delegate to media manager or use global limits
    // This is simplified - you may want to use the same logic from TelegramService
    return {
      allowed: true,
      hourlyUsed: 0,
      hourlyLimit: 10,
      dailyUsed: 0,
      dailyLimit: 50,
    };
  }

  /**
   * Generate AI response and execute actions
   * @param {Object} params - Parameters for response generation
   * @param {string} params.channelId - Platform-prefixed channel ID (e.g., 'discord:123' or 'telegram:456')
   * @param {Object} params.message - Normalized message object
   * @param {Object} params.adapter - Platform adapter for sending responses
   * @param {boolean} params.isMention - Whether bot was mentioned
   * @param {string} params.triggerType - What triggered this: 'mention', 'reply', 'active_participant', 'gap'
   * @param {Object} params.messageImage - Optional image data from the message
   */
  async generateResponse({
    channelId,
    message,
    adapter,
    isMention = false,
    triggerType = 'general',
    messageImage = null,
  }) {
    const delayMs = isMention ? TIMING.REPLY_DELAY_MENTIONED_MS : TIMING.REPLY_DELAY_DEFAULT_MS;
    
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    const userId = message.userId;
    const stopTyping = await adapter.startTyping();

    try {
      // Gather context in parallel
      const [persona, buybotContext, imageLimitCtx, videoLimitCtx, tweetLimitCtx] = await Promise.all([
        this.contextManager.getPersona(),
        this.contextManager.getBuybotContext(channelId),
        this.checkMediaLimit(userId, 'image'),
        this.checkMediaLimit(userId, 'video'),
        this.checkMediaLimit(userId, 'tweet'),
      ]);

      // Fetch wallet holdings context if the bot has a wallet address
      const walletAddress = persona?.bot?.walletAddress;
      const walletHoldingsContext = walletAddress 
        ? await this.contextManager.getWalletHoldingsContext(walletAddress, { limit: 5 })
        : null;

      // Fetch RAG context
      let ragContext = [];
      if (this.knowledgeBaseService) {
        const query = message.text || '';
        if (query.length > 5) {
          ragContext = await this.knowledgeBaseService.search(query, 3);
        }
      }

      // Get conversation history
      const fullHistory = await this.getHistory(channelId);

      // Get pending context for X error state
      const pendingContext = this.pendingReplies.get(channelId) || {};
      const lastXError = pendingContext.lastXError || null;

      // Build conversation context
      const { systemPrompt, userPrompt, conversationContext, recentMessageIds } = buildConversationContext({
        history: fullHistory,
        currentMessage: {
          text: message.text,
          from: { first_name: message.authorName, username: message.authorUsername },
          reply_to_message: message.replyTo,
        },
        persona,
        credits: {
          image: imageLimitCtx,
          video: videoLimitCtx,
          tweet: tweetLimitCtx,
        },
        plan: await this.planManager.buildPlanContext(channelId, 3),
        media: await this.mediaManager.buildRecentMediaContext(channelId, 5),
        buybot: buybotContext,
        walletHoldings: walletHoldingsContext,
        isMention,
        triggerType,
        rag: ragContext,
        lastXError,
      });

      if (!this.aiService) {
        await adapter.sendMessage("I'm here and listening! 👂 (AI service not configured)");
        return;
      }

      // Build tool definitions
      const tools = buildToolDefinitions();

      const model = this.configService.get('TELEGRAM_BOT_MODEL') ||
                   this.globalBotService?.bot?.model ||
                   DEFAULT_MODEL;

      // Build messages array
      let userMessage;
      if (messageImage?.data) {
        const imageDescription = message.text
          ? `User sent an image with caption: "${message.text}"`
          : 'User sent an image.';
        userMessage = {
          role: 'user',
          content: [
            { type: 'text', text: `${userPrompt}\n\n[${imageDescription} Please describe or respond to this image appropriately.]` },
            { type: 'image_url', image_url: { url: `data:${messageImage.mimeType};base64,${messageImage.data}` } },
          ],
        };
      } else {
        userMessage = { role: 'user', content: userPrompt };
      }

      // Call AI
      const response = await this.aiService.chat([
        { role: 'system', content: systemPrompt },
        userMessage,
      ], {
        model,
        temperature: 0.8,
        tools,
        tool_choice: 'auto',
      });

      const responseObj = (response && typeof response === 'object') ? response : { text: response || '' };

      // Handle tool calls
      if (responseObj.tool_calls && responseObj.tool_calls.length > 0) {
        const acknowledgment = (typeof responseObj.text === 'string' && responseObj.text.trim())
          ? responseObj.text.trim() : '';

        if (acknowledgment) {
          const sent = await adapter.sendMessage(acknowledgment);
          await this.memberManager.recordBotResponse(channelId, userId);
          await this.addToHistory(channelId, {
            from: 'Bot',
            text: acknowledgment,
            date: Math.floor(Date.now() / 1000),
            isBot: true,
            messageId: sent?.id,
          });
        }

        await this.handleToolCalls({
          channelId,
          userId,
          username: message.authorUsername || message.authorName,
          adapter,
          toolCalls: responseObj.tool_calls,
          conversationContext,
          messageImage,
          recentMessageIds,
        });
        return;
      }

      // Send text response
      const responseText = String(responseObj.text || '')
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .trim();

      if (responseText) {
        const sent = await adapter.sendMessage(responseText);
        await this.memberManager.recordBotResponse(channelId, userId);
        await this.addToHistory(channelId, {
          from: 'Bot',
          text: responseText,
          date: Math.floor(Date.now() / 1000),
          isBot: true,
          messageId: sent?.id,
        });
      }

    } catch (error) {
      this.logger?.error?.('[UnifiedChatAgent] Response generation failed:', error);
      await adapter.sendMessage("I'm having trouble forming thoughts right now. 💭");
    } finally {
      stopTyping();
    }
  }

  /**
   * Handle tool calls from AI response
   */
  async handleToolCalls({
    channelId,
    userId,
    username,
    adapter,
    toolCalls,
    conversationContext,
    messageImage,
    recentMessageIds,
  }) {
    const finalToolCalls = filterToolCalls(toolCalls, { logger: this.logger });

    const userReferenceImage = messageImage?.data ? {
      data: messageImage.data,
      mimeType: messageImage.mimeType,
      label: 'user_provided_reference',
    } : null;

    for (const toolCall of finalToolCalls) {
      let functionName = toolCall.function?.name;
      if (functionName && functionName.includes(':')) functionName = functionName.split(':').pop();

      const args = typeof toolCall.function?.arguments === 'string'
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function?.arguments || {};

      this.logger?.info?.(`[UnifiedChatAgent] ⚡ Tool: ${functionName}`, { args, user: username });

      try {
        if (functionName === 'plan_actions') {
          await adapter.sendTyping();
          await this.executePlanActions({
            adapter,
            args,
            channelId,
            userId,
            username,
            conversationContext,
            userReferenceImage,
            recentMessageIds,
          });
        } else if (functionName === 'get_token_stats') {
          await adapter.sendTyping();
          await this.executeTokenStatsLookup(adapter, args.tokenSymbol, channelId);
        } else if (functionName === 'generate_image') {
          await adapter.sendTyping();
          await this.executeImageGeneration({
            adapter,
            prompt: args.prompt,
            conversationContext,
            userId,
            username,
            channelId,
            options: {
              aspectRatio: args.aspectRatio || '1:1',
              referenceImage: userReferenceImage,
            },
          });
        } else if (functionName === 'generate_video') {
          await adapter.sendTyping();
          await this.executeVideoGeneration({
            adapter,
            prompt: args.prompt,
            conversationContext,
            userId,
            username,
            channelId,
            options: {
              aspectRatio: args.aspectRatio || '16:9',
              style: args.style,
              camera: args.camera,
              negativePrompt: args.negativePrompt,
            },
          });
        } else if (functionName === 'post_tweet') {
          await adapter.sendTyping();
          await this.executeTweetPost({
            adapter,
            text: args.text,
            mediaId: args.mediaId,
            channelId,
            userId,
            username,
          });
        } else if (functionName === 'react_to_message') {
          await adapter.react(args.emoji, args.targetMessageId);
        } else if (functionName === 'speak') {
          await adapter.sendTyping();
          const formattedMessage = adapter.formatMessage(args.message || args.text || '');
          if (args.targetMessageId) {
            await adapter.replyToMessage(args.targetMessageId, formattedMessage);
          } else {
            await adapter.sendMessage(formattedMessage);
          }
        } else {
          this.logger?.warn?.(`[UnifiedChatAgent] Unknown tool: ${functionName}`);
        }
      } catch (toolError) {
        this.logger?.error?.(`[UnifiedChatAgent] Tool execution failed (${functionName}):`, toolError);
        await adapter.sendMessage(`⚠️ I had a hiccup trying to ${functionName.replace(/_/g, ' ')}. Continuing...`);
      }
    }
  }

  /**
   * Execute plan actions
   */
  async executePlanActions({
    adapter,
    args,
    channelId,
    userId,
    username,
    conversationContext,
    userReferenceImage,
    recentMessageIds,
  }) {
    const plan = {
      objective: args.objective || 'Respond thoughtfully',
      steps: Array.isArray(args?.steps) ? args.steps : [],
      confidence: args.confidence,
    };

    if (plan.steps.length === 0) {
      await adapter.sendMessage('I need at least one planned step to act on. Try planning again with a specific goal.');
      return;
    }

    const validation = validatePlan(plan);
    if (!validation.valid) {
      const errors = Array.isArray(validation.errors) ? validation.errors : [];
      const bullets = errors.map((err, idx) => `${idx + 1}. ${err}`).slice(0, 5).join('\n');
      await adapter.sendMessage(`🚫 I couldn't execute that plan:\n${bullets}`.trim());
      return;
    }

    logPlanSummary(plan, this.logger);
    await this.planManager.rememberAgentPlan(channelId, plan);

    // Execute each step
    for (const step of plan.steps) {
      try {
        await this.executeStep({
          step,
          adapter,
          channelId,
          userId,
          username,
          conversationContext,
          userReferenceImage,
          recentMessageIds,
        });
      } catch (stepError) {
        this.logger?.warn?.(`[UnifiedChatAgent] Step (${step.action}) failed:`, stepError.message);
      }
    }
  }

  /**
   * Execute a single plan step
   */
  async executeStep({
    step,
    adapter,
    channelId,
    userId,
    username,
    conversationContext,
    userReferenceImage,
    // recentMessageIds reserved for future use
  }) {
    const { action } = step;

    switch (action) {
      case 'speak': {
        const message = step.message || step.text || '';
        if (message) {
          const formatted = adapter.formatMessage(message);
          if (step.targetMessageId) {
            await adapter.replyToMessage(step.targetMessageId, formatted);
          } else {
            await adapter.sendMessage(formatted);
          }
          await this.addToHistory(channelId, {
            from: 'Bot',
            text: message,
            date: Math.floor(Date.now() / 1000),
            isBot: true,
          });
        }
        break;
      }

      case 'react_to_message': {
        const emoji = step.emoji || '👍';
        // Convert to string to preserve precision for Discord Snowflakes
        const targetId = step.targetMessageId ? String(step.targetMessageId) : null;
        if (targetId) {
          await adapter.react(emoji, targetId);
        }
        break;
      }

      case 'generate_image': {
        await this.executeImageGeneration({
          adapter,
          prompt: step.description || step.prompt,
          conversationContext,
          userId,
          username,
          channelId,
          options: {
            aspectRatio: step.aspectRatio || '1:1',
            referenceImage: userReferenceImage,
          },
        });
        break;
      }

      case 'generate_video': {
        await this.executeVideoGeneration({
          adapter,
          prompt: step.description || step.prompt,
          userId,
          channelId,
          options: {
            aspectRatio: step.aspectRatio || '16:9',
            style: step.style,
            camera: step.camera,
            negativePrompt: step.negativePrompt,
          },
        });
        break;
      }

      case 'post_tweet': {
        await this.executeTweetPost({
          adapter,
          text: step.text,
          mediaId: step.mediaId || step.sourceMediaId,
          channelId,
        });
        break;
      }

      case 'wait':
        // Do nothing - valid action
        break;

      default:
        this.logger?.debug?.(`[UnifiedChatAgent] Unhandled action: ${action}`);
    }
  }

  /**
   * Execute token stats lookup
   */
  async executeTokenStatsLookup(adapter, tokenSymbol, _channelId) {
    try {
      if (!this.buybotService) {
        await adapter.sendMessage("Token stats not available - buybot service not configured.");
        return;
      }

      const stats = await this.buybotService.getTokenStats?.(tokenSymbol);
      if (!stats) {
        await adapter.sendMessage(`Couldn't find stats for ${tokenSymbol}. Make sure it's a tracked token.`);
        return;
      }

      const message = `📊 **${tokenSymbol}** Stats:\n` +
        `💰 Price: $${stats.price?.toFixed(6) || 'N/A'}\n` +
        `📈 Market Cap: $${stats.marketCap?.toLocaleString() || 'N/A'}\n` +
        `📊 24h Volume: $${stats.volume24h?.toLocaleString() || 'N/A'}`;

      await adapter.sendMessage(message);
    } catch (error) {
      this.logger?.error?.('[UnifiedChatAgent] Token stats lookup failed:', error);
      await adapter.sendMessage(`Couldn't fetch stats for ${tokenSymbol} right now.`);
    }
  }

  /**
   * Execute image generation
   */
  async executeImageGeneration({ adapter, prompt, conversationContext, userId, username, channelId, options = {} }) {
    try {
      const referenceImages = [];
      if (options.referenceImage?.data) {
        referenceImages.push(options.referenceImage);
        this.logger?.info?.('[UnifiedChatAgent] Using user-provided image as reference');
      }

      const { imageUrl } = await this.mediaGenerationManager.generateImageAsset({
        prompt,
        conversationContext,
        userId,
        username,
        aspectRatio: options.aspectRatio || '1:1',
        source: 'unified_agent.user_request',
        referenceImages,
      });

      // Generate caption
      let caption = null;
      if (this.globalBotService && this.aiService) {
        try {
          const captionPrompt = `Create a brief (under 100 chars), natural caption for this image generated from: "${prompt}". No hashtags/markdown.`;
          const response = await this.aiService.chat([{ role: 'user', content: captionPrompt }]);
          caption = String(response || '').trim().replace(/^["']|["']$/g, '');
        } catch (captionErr) {
          this.logger?.debug?.('[UnifiedChatAgent] Caption generation failed:', captionErr.message);
        }
      }

      const sent = await adapter.sendImage(imageUrl, caption || `🎨 Generated: ${prompt.slice(0, 50)}...`);

      await this.addToHistory(channelId, {
        from: 'Bot',
        text: caption || `[Generated Image: ${prompt}]`,
        date: Math.floor(Date.now() / 1000),
        isBot: true,
        messageId: sent?.id,
      });

      // Remember generated media
      await this.mediaManager.rememberGeneratedMedia?.(channelId, {
        type: 'image',
        mediaUrl: imageUrl,
        prompt,
        caption,
        userId,
        source: 'unified_agent.generate_image',
      });

      return { imageUrl, caption };
    } catch (error) {
      this.logger?.error?.('[UnifiedChatAgent] Image generation failed:', error);
      await adapter.sendMessage('🎨 Image generation ran into an issue. Please try again.');
      return null;
    }
  }

  /**
   * Execute video generation
   */
  async executeVideoGeneration({ adapter, prompt, userId, channelId, options = {} }) {
    try {
      const { aspectRatio = '16:9', style, camera, negativePrompt } = options;
      const traceId = generateTraceId();

      await adapter.sendMessage('🎬 Starting video generation...');

      const charDesign = this.globalBotService?.bot?.globalBotConfig?.characterDesign;

      const videoUrls = await this.mediaGenerationManager.generateVideo({
        prompt,
        config: { aspectRatio, durationSeconds: 8 },
        style,
        camera,
        negativePrompt,
        traceId,
        channelId,
        referenceImages: charDesign?.referenceImageUrl ? [charDesign.referenceImageUrl] : [],
      });

      const videoUrl = videoUrls[0];
      const sent = await adapter.sendVideo(videoUrl, '🎬 Here is your video!');

      await this.addToHistory(channelId, {
        from: 'Bot',
        text: `[Generated Video: ${prompt}]`,
        date: Math.floor(Date.now() / 1000),
        isBot: true,
        messageId: sent?.id,
      });

      await this.mediaManager.rememberGeneratedMedia?.(channelId, {
        type: 'video',
        mediaUrl: videoUrl,
        prompt,
        userId,
        source: 'unified_agent.generate_video',
      });

      return { videoUrl };
    } catch (error) {
      this.logger?.error?.('[UnifiedChatAgent] Video generation failed:', error);
      await adapter.sendMessage('🎬 Video generation ran into an issue. Please try again.');
      return null;
    }
  }

  /**
   * Execute tweet post
   */
  async executeTweetPost({ adapter, text, mediaId, channelId }) {
    try {
      if (!this.xService) {
        await adapter.sendMessage("📱 X/Twitter posting not available - service not configured.");
        return;
      }

      // Get media URL if mediaId provided
      let mediaUrl = null;
      if (mediaId) {
        const mediaRecord = await this.mediaManager.getMediaById?.(channelId, mediaId);
        if (mediaRecord?.mediaUrl) {
          mediaUrl = mediaRecord.mediaUrl;
        }
      }

      const result = await this.xService.postTweet?.({
        text,
        mediaUrl,
      });

      if (result?.success) {
        await adapter.sendMessage(`✅ Posted to X! ${result.tweetUrl || ''}`);
      } else {
        await adapter.sendMessage(`📱 Tweet posting failed: ${result?.error || 'Unknown error'}`);
      }
    } catch (error) {
      this.logger?.error?.('[UnifiedChatAgent] Tweet post failed:', error);
      await adapter.sendMessage('📱 Failed to post tweet. Please try again.');
    }
  }

  /**
   * Shutdown the agent
   */
  async shutdown() {
    this.cacheManager?.stopCleanup?.();
    this.logger?.info?.('[UnifiedChatAgent] Shutdown complete');
  }
}
