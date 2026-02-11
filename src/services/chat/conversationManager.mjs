/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { handleCommands } from '../commands/commandHandler.mjs';
import eventBus from '../../utils/eventBus.mjs';

const GUILD_NAME = process.env.GUILD_NAME || 'The Guild';

export class ConversationManager  {
  constructor({
    logger,
    databaseService,
    aiService,
    aiRouterService,
  unifiedAIService,
    openrouterModelCatalogService,
    discordService,
    avatarService,
    memoryService,
    promptService,
    configService,
    knowledgeService,
    mapService,
  toolService,
  presenceService,
  conversationThreadService,
  toolSchemaGenerator,
  toolExecutor,
  toolDecisionService
  }) {
    this.toolService = toolService;
    if (this.toolService?.setConversationManager) {
      this.toolService.setConversationManager(this);
    } else if (this.toolService) {
      this.toolService.conversationManager = this;
    }
    this.logger = logger || console;
    this.databaseService = databaseService;
    this.aiService = aiService;
    this.aiRouterService = aiRouterService || null;
  this.unifiedAIService = unifiedAIService; // optional adapter
    this.openrouterModelCatalogService = openrouterModelCatalogService || null;
    this.discordService = discordService;
    this.avatarService = avatarService;
    this.memoryService = memoryService;
    this.promptService = promptService;
    this.configService = configService;
    this.knowledgeService = knowledgeService;
    this.mapService = mapService;
  this.presenceService = presenceService; // optional; used for bot->bot mention cascades
  this.conversationThreadService = conversationThreadService;
  this.toolSchemaGenerator = toolSchemaGenerator; // Phase 2: LLM tool calling
  this.toolExecutor = toolExecutor; // Phase 2: Tool execution loop
  this.toolDecisionService = toolDecisionService; // Phase 2: Universal tool decisions

    this.GLOBAL_NARRATIVE_COOLDOWN = 60 * 60 * 1000; // 1 hour
    this.lastGlobalNarrativeTime = 0;
    this.channelLastMessage = new Map();
    this.CHANNEL_COOLDOWN = 5 * 1000; // 5 seconds
    this.MAX_RESPONSES_PER_MESSAGE = 2;
    this.channelResponders = new Map();
    
    // Bot rate limiting: Track last bot message time per channel with burst support
    this.channelLastBotMessage = new Map(); // channelId -> timestamp
    this.channelBotBurstCount = new Map(); // channelId -> count of messages in burst window
    this.channelResponseQueue = new Map(); // channelId -> array of {avatar, presetResponse, options, resolve, reject}
    this.BOT_REPLY_COOLDOWN = Number(process.env.BOT_REPLY_COOLDOWN_MS || 10000); // 10 seconds default between bot replies in same channel
    this.BOT_BURST_ALLOWED = Number(process.env.BOT_BURST_ALLOWED || 3); // Allow 3 rapid messages before rate limit kicks in
    this.BOT_BURST_WINDOW_MS = Number(process.env.BOT_BURST_WINDOW_MS || 15000); // 15 second window for burst counting
    this.queueProcessingIntervals = new Map(); // channelId -> setInterval handle
    
    // In-memory cache for channel summaries to reduce expensive AI calls during combat
    this.summaryCacheMap = new Map(); // key: `${avatarId}:${channelId}` -> { summary, timestamp, lastMessageId }
    this.SUMMARY_CACHE_TTL_MS = 60 * 1000; // 60 seconds - summaries are fresh enough for combat
    this.requiredPermissions = ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageWebhooks'];
    
    // Phase 2: Tool calling configuration
    this.enableToolCalling = String(process.env.ENABLE_LLM_TOOL_CALLING || 'false').toLowerCase() === 'true';
    this.useMetaPrompting = String(process.env.TOOL_USE_META_PROMPTING || 'true').toLowerCase() === 'true';
    this.toolFastPathEnabled = String(process.env.TOOL_FAST_PATH_ENABLED || 'true').toLowerCase() === 'true';
    this.skipFinalResponseAfterRespond = String(process.env.SKIP_FINAL_RESPONSE_AFTER_RESPOND_TOOL || 'true').toLowerCase() === 'true';

    // Low-credit fallback settings (for cost control when credit errors occur)
    const fallbackList = String(process.env.AI_LOW_CREDIT_MODEL_FALLBACKS || 'meta-llama/llama-3.2-1b-instruct,google/gemini-2.0-flash-exp:free')
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean);
    this.lowCreditFallbackModels = fallbackList;

    this.creditErrorCodes = new Set([
      'HTTP_402',
      '402',
      'PAYMENT_REQUIRED',
      'INSUFFICIENT_CREDITS',
      'INSUFFICIENT_QUOTA',
      'MODEL_PAYMENT_REQUIRED',
    ]);
  }

  /** Normalize arbitrary AI response into a safe string. Logs when response isn't a plain string. */
  _normalizeToText(response, context = 'response') {
    try {
      if (response == null) return '';
      if (typeof response === 'string') return response;
      if (typeof response === 'object') {
        if (typeof response.text === 'string') return response.text;
        // Common OpenAI-like shapes
        const maybe = response?.choices?.[0]?.message?.content
          || response?.message?.content
          || response?.content;
        if (typeof maybe === 'string') return maybe;
        // As a last resort, log and do not leak object dump to chat
        const keys = Object.keys(response);
        this.logger.warn?.(`[AI][normalize] Non-string ${context}; keys=${keys.join(',') || 'none'}`);
        return '';
      }
      // Numbers/booleans/etc: toString safely
      return String(response);
    } catch (e) {
      this.logger.warn?.(`[AI][normalize] Failed to normalize ${context}: ${e.message}`);
      return '';
    }
  }

  /** Ensure the avatar has a model assigned; persist if we pick one */
  async ensureAvatarModel(avatar) {
    try {
      if (!avatar) return null;

      const providerRaw = this.aiRouterService?.getProviderForAvatar?.(avatar) || avatar?.provider || null;
      const provider = providerRaw ? String(providerRaw).trim().toLowerCase() : null;
      const isSwarm = provider === 'swarm';
      const isOpenRouter = !provider || provider === 'openrouter' || provider === 'open-router';

      const SWARM_FALLBACK_MODEL = process.env.SWARM_MODEL || 'avatar:rati';

      // Use FAST_MODEL for repairs (cost-effective fallback)
      const FAST_MODEL = process.env.FAST_MODEL || 'meta-llama/llama-4-maverick';

      const pickRandomExisting = async () => {
        let picked = await this.aiService?.selectRandomModel?.();
        try {
          if (picked && this.openrouterModelCatalogService?.modelExists) {
            const ok = await this.openrouterModelCatalogService.modelExists(picked);
            if (!ok && this.openrouterModelCatalogService?.pickRandomExistingModel) {
              picked = await this.openrouterModelCatalogService.pickRandomExistingModel();
            }
          }
        } catch {}
        return picked || null;
      };

      // Missing model: assign and persist.
      if (!avatar.model) {
        const picked = isSwarm ? SWARM_FALLBACK_MODEL : await pickRandomExisting();
        if (picked) {
          avatar.model = picked;
          try { await this.avatarService.updateAvatar(avatar); } catch {}
          this.logger.debug?.(`[AI] assigned model='${picked}' to avatar ${avatar?.name || avatar?._id}`);
        }
        return avatar.model;
      }

      // Special case: 'partial' model is a placeholder from incomplete avatar creation
      // Provider-aware repair.
      if (avatar.model === 'partial') {
        const previous = avatar.model;
        avatar.model = isSwarm ? SWARM_FALLBACK_MODEL : FAST_MODEL;
        try { await this.avatarService.updateAvatar(avatar); } catch {}
        this.logger.info?.(`[AI] repaired placeholder model '${previous}' -> '${avatar.model}' for avatar ${avatar?.name || avatar?._id}`);
        return avatar.model;
      }

      // Invalid model: validate against OpenRouter catalog ONLY when provider is OpenRouter.
      // Swarm models like 'avatar:rati' are not expected to exist in OpenRouter catalog.
      try {
        if (isOpenRouter && this.openrouterModelCatalogService?.modelExists) {
          this.logger.debug?.(`[AI] ensureAvatarModel checking if model '${avatar.model}' exists for ${avatar?.name}`);
          const ok = await this.openrouterModelCatalogService.modelExists(avatar.model);
          this.logger.debug?.(`[AI] ensureAvatarModel model '${avatar.model}' exists: ${ok}`);
          if (!ok) {
            const previous = avatar.model;
            // Use FAST_MODEL for repairs instead of random expensive models
            avatar.model = FAST_MODEL;
            try { await this.avatarService.updateAvatar(avatar); } catch {}
            this.logger.warn?.(`[AI] repaired missing model '${previous}' -> '${avatar.model}' for avatar ${avatar?.name || avatar?._id}`);
          }
        }
      } catch {}
    } catch (e) {
      this.logger.warn?.(`[AI] ensureAvatarModel failed: ${e.message}`);
    }
    return avatar?.model;
  }

  async checkChannelPermissions(channel) {
    try {
      if (!channel.guild) {
        this.logger.warn(`Channel ${channel.id} has no associated guild.`);
        return false;
      }
      const member = channel.guild.members.cache.get(this.discordService.client.user.id);
      if (!member) return false;
      const permissions = channel.permissionsFor(member);
      const missingPermissions = this.requiredPermissions.filter(perm => !permissions.has(perm));
      if (missingPermissions.length > 0) {
        this.logger.warn(`Missing permissions in channel ${channel.id}: ${missingPermissions.join(', ')}`);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.error(`Permission check error for channel ${channel.id}: ${error.message}`);
      return false;
    }
  }

  async generateNarrative(avatar) {
    try {
      this.db = await this.databaseService.getDatabase();
      if (!this.db) {
        this.logger.error('DB not initialized yet. Narrative generation aborted.');
        return null;
      }
      if (Date.now() - this.lastGlobalNarrativeTime < this.GLOBAL_NARRATIVE_COOLDOWN) {
        return null;
      }
      await this.ensureAvatarModel(avatar);

      const kgContext = await this.knowledgeService.queryKnowledgeGraph(avatar._id);
      const chatMessages = await this.promptService.getNarrativeChatMessages(avatar);

      // Inject KG context into user prompt
      if (chatMessages && chatMessages.length > 0) {
        const userMsg = chatMessages.find(m => m.role === 'user');
        if (userMsg) {
          userMsg.content = `Knowledge Graph:\n${kgContext}\n\n${userMsg.content}`;
        }
      }

  const aiCtx = this.aiRouterService?.getContextForAvatar?.(avatar);
  const ai = aiCtx?.ai || (this.unifiedAIService || this.aiService);
  const corrId = `narrative:${avatar._id}:${Date.now()}`;
  this.logger.debug?.(`[AI][generateNarrative] model=${avatar.model} provider=${aiCtx?.provider || (this.unifiedAIService ? 'unified' : 'core')} corrId=${corrId}`);
  let narrative = await ai.chat(chatMessages, { model: avatar.model, corrId, returnEnvelope: true });
  
  // Handle model not found fallback
  if (narrative && typeof narrative === 'object' && narrative.error?.code === 'MODEL_NOT_FOUND_FALLBACK') {
    const { fallbackModel, originalModel } = narrative.error;
    this.logger.warn?.(`[ConversationManager] Model '${originalModel}' not found for ${avatar.name} narrative, updating to fallback model '${fallbackModel}'`);
    
    // Update avatar's model to the fallback
    avatar.model = fallbackModel;
    try {
      await this.avatarService.updateAvatar(avatar);
      this.logger.info?.(`[ConversationManager] Updated ${avatar.name}'s model to ${fallbackModel}`);
    } catch (updateError) {
      this.logger.error?.(`[ConversationManager] Failed to update avatar model: ${updateError.message}`);
    }
    
    // Retry the narrative generation with the new model
    this.logger.info?.(`[ConversationManager] Retrying narrative for ${avatar.name} with fallback model ${fallbackModel}`);
    narrative = await ai.chat(chatMessages, { model: fallbackModel, corrId, returnEnvelope: true });
  }
  
  if (narrative && typeof narrative === 'object' && narrative.text) narrative = narrative.text;
  // Scrub any <think> tags that may have leaked from providers
  try { if (typeof narrative === 'string') narrative = narrative.replace(/<think>[\s\S]*?<\/think>/g, '').trim(); } catch {}
      if (!narrative) {
        this.logger.error(`No narrative generated for ${avatar.name}.`);
        return null;
      }

      await this.memoryService.storeNarrative(avatar._id, narrative);
      avatar = await this.memoryService.updateNarrativeHistory(avatar, narrative);
      avatar.prompt = await this.promptService.getFullSystemPrompt(avatar, this.db);
      avatar.dynamicPrompt = narrative;
      await this.avatarService.updateAvatar(avatar);
      this.lastGlobalNarrativeTime = Date.now();

      // Update KG with new narrative
      await this.knowledgeService.updateKnowledgeGraph(avatar._id, narrative);

      return narrative;
    } catch (error) {
      this.logger.error(`Error generating narrative for ${avatar.name}: ${error.message}`);
      throw error;
    }
  }

  async getLastNarrative(avatarId) {
    return this.memoryService.getLastNarrative(avatarId);
  }

  async storeNarrative(avatarId, content) {
    return this.memoryService.storeNarrative(avatarId, content);
  }

  /**
   * Get channel context (wrapper for fetchChannelContext for backward compatibility)
   * @param {string} channelId - Discord channel ID
   * @param {number} limit - Number of messages to fetch (default 50)
   * @returns {Promise<Array>} Array of formatted messages
   */
  async getChannelContext(channelId, limit = 50) {
    return this.fetchChannelContext(channelId, null, limit);
  }

  async fetchChannelContext(channelId, avatar, limit = 10) {
    try {
      this.logger.debug?.(`Fetching channel context for channel ${channelId}`);
      this.db = await this.databaseService.getDatabase();
      if (this.db) {
        try {
          const messagesCollection = this.db.collection('messages');
          const messages = await messagesCollection
            .find({ channelId })
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
          if (messages && messages.length > 0) {
            this.logger.debug(`Retrieved ${messages.length} messages from database for channel ${channelId}`);
            return messages.reverse();
          }
        } catch (dbError) {
          this.logger.error(`Database error fetching messages: ${dbError.message}`);
        }
      }
      const channel = await this.discordService.client.channels.fetch(channelId);
      if (!channel) {
        this.logger.warn(`Channel ${channelId} not found`);
        return [];
      }
      const discordMessages = await channel.messages.fetch({ limit });
      
      // Format messages WITHOUT image analysis for fast context fetching
      const formattedMessages = Array.from(discordMessages.values()).map(msg => {
        // Extract image URLs synchronously without AI analysis
        const hasImages = msg.attachments.some(a => a.contentType?.startsWith('image/')) || msg.embeds.some(e => e.image || e.thumbnail);
        let imageUrls = [];
        let primaryImageUrl = null;
        
        if (hasImages) {
          try {
            const aUrls = Array.from(msg.attachments.values())
              .filter(a => a.contentType?.startsWith('image/'))
              .map(a => a.url);
            const eUrls = msg.embeds.map(e => e?.image?.url || e?.thumbnail?.url).filter(Boolean);
            const all = [...aUrls, ...eUrls].filter(Boolean);
            const seen = new Set();
            imageUrls = all.filter(u => { if (seen.has(u)) return false; seen.add(u); return true; });
            primaryImageUrl = imageUrls[0] || null;
          } catch {}
        }
        
        const formattedMsg = {
          messageId: msg.id,
          channelId: msg.channel.id,
          authorId: msg.author.id,
          authorUsername: msg.author.username,
          content: msg.content,
          hasImages,
          imageDescription: null, // Will be filled by background analyzer
          imageUrls,
          primaryImageUrl,
          timestamp: msg.createdTimestamp,
        };
        
        // Emit event for background image analysis
        if (hasImages && primaryImageUrl) {
          try {
            eventBus.emit('MESSAGE.CREATED', { message: formattedMsg });
          } catch (emitErr) {
            // Non-critical, just log
            this.logger.debug(`[ConversationManager] Event emit failed: ${emitErr.message}`);
          }
        }
        
        return formattedMsg;
      }).sort((a, b) => a.timestamp - b.timestamp);
      
      this.logger.debug(`Retrieved ${formattedMessages.length} messages from Discord API for channel ${channelId}`);
      
      // Store in DB for future fast retrieval
      if (this.db) {
        const messagesCollection = this.db.collection('messages');
        // Use bulk write for better performance
        const bulkOps = formattedMessages.map(msg => ({
          updateOne: {
            filter: { messageId: msg.messageId },
            update: { $set: msg },
            upsert: true
          }
        }));
        
        if (bulkOps.length > 0) {
          try {
            await messagesCollection.bulkWrite(bulkOps, { ordered: false });
          } catch (bulkError) {
            this.logger.warn(`Bulk write error (non-critical): ${bulkError.message}`);
          }
        }
      }
      
      // Optionally enrich with cached image descriptions (non-blocking)
      this.enrichMessagesWithCachedDescriptions(formattedMessages).catch(err => {
        this.logger.debug(`[ConversationManager] Failed to enrich with cached descriptions: ${err.message}`);
      });
      
      return formattedMessages;
    } catch (error) {
      this.logger.error(`Error fetching channel context for channel ${channelId}: ${error.message}`);
      return [];
    }
  }

  /**
   * Enrich messages with cached image descriptions (non-blocking)
   */
  async enrichMessagesWithCachedDescriptions(messages) {
    if (!this.db || !Array.isArray(messages) || messages.length === 0) return;

    try {
      const messagesWithImages = messages.filter(m => m.hasImages && m.primaryImageUrl && !m.imageDescription);
      if (messagesWithImages.length === 0) return;

      // Get URL hashes and check cache
      const crypto = await import('crypto');
      const urlToHash = new Map();
      for (const msg of messagesWithImages) {
        const hash = crypto.createHash('sha256').update(msg.primaryImageUrl).digest('hex');
        urlToHash.set(msg.primaryImageUrl, hash);
      }

      const hashes = Array.from(urlToHash.values());
      const cachedDescriptions = await this.db.collection('image_analysis_cache')
        .find({ urlHash: { $in: hashes }, status: 'completed' })
        .toArray();

      // Map hash -> description
      const hashToDesc = new Map();
      for (const cache of cachedDescriptions) {
        if (cache.description) {
          hashToDesc.set(cache.urlHash, cache.description);
        }
      }

      // Update messages in-place
      for (const msg of messagesWithImages) {
        const hash = urlToHash.get(msg.primaryImageUrl);
        const desc = hashToDesc.get(hash);
        if (desc) {
          msg.imageDescription = desc;
        }
      }
    } catch (err) {
      this.logger.debug(`[ConversationManager] enrichMessagesWithCachedDescriptions failed: ${err.message}`);
    }
  }

  async getChannelSummary(avatarId, channelId) {
    // Check in-memory cache first (critical for combat performance)
    const cacheKey = `${avatarId}:${channelId}`;
    const cached = this.summaryCacheMap.get(cacheKey);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp < this.SUMMARY_CACHE_TTL_MS)) {
      this.logger?.debug?.(`[ConversationManager] Using cached summary for ${cacheKey} (age: ${Math.floor((now - cached.timestamp) / 1000)}s)`);
      return cached.summary;
    }
    
    this.db = await this.databaseService.getDatabase();
    if (!this.db) {
      this.logger.error('DB not initialized. Cannot fetch channel summary.');
      return '';
    }
    const summariesCollection = this.db.collection('channel_summaries');
    const messagesCollection = this.db.collection('messages');
    const summaryDoc = await summariesCollection.findOne({ avatarId, channelId });
    let messagesToSummarize = [];
    if (summaryDoc) {
      const lastUpdated = summaryDoc.lastUpdated;
      messagesToSummarize = await messagesCollection
        .find({ channelId, timestamp: { $gt: lastUpdated } })
        .sort({ timestamp: 1 })
        .toArray();
      if (messagesToSummarize.length < 50) {
        // Cache the existing summary
        this.summaryCacheMap.set(cacheKey, {
          summary: summaryDoc.summary,
          timestamp: now,
          lastMessageId: summaryDoc.lastMessageId
        });
        return summaryDoc.summary;
      }
    } else {
      messagesToSummarize = await messagesCollection
        .find({ channelId })
        .sort({ timestamp: -1 })
        .limit(50)
        .toArray();
      messagesToSummarize.reverse();
    }
    if (messagesToSummarize.length === 0) return summaryDoc ? summaryDoc.summary : '';
  const avatar = await this.avatarService.getAvatarById(avatarId);
    if (!avatar) {
      this.logger.error(`Avatar ${avatarId} not found for summarization.`);
      return summaryDoc ? summaryDoc.summary : '';
    }
  // Ensure avatar has a model before AI call
  await this.ensureAvatarModel(avatar);
    const messagesText = messagesToSummarize.map(msg =>
      `${msg.authorUsername || 'User'}: ${msg.content || '[No content]'}${msg.imageDescription ? ` [Image: ${msg.imageDescription}]` : ''}`
    ).join('\n');
    let prompt;
    if (summaryDoc) {
      prompt = `
  You are ${avatar.name}.
  Previous channel summary:
  ${summaryDoc.summary}
  New conversation:
  ${messagesText}
  Update the summary to incorporate the new conversation, focusing on key events, interactions, and how they relate to you.
      `.trim();
    } else {
      prompt = `
  You are ${avatar.name}.
  Summarize the following conversation from your perspective, focusing on key events, interactions, and how they relate to you.
  Conversation:
  ${messagesText}
      `.trim();
    }
  const aiCtx = this.aiRouterService?.getContextForAvatar?.(avatar);
  const ai = aiCtx?.ai || (this.unifiedAIService || this.aiService);
  const corrId = `summary:${avatar._id}:${channelId}`;
  this.logger.debug?.(`[AI][getChannelSummary] model=${avatar.model} provider=${aiCtx?.provider || (this.unifiedAIService ? 'unified' : 'core')} corrId=${corrId}`);
  let summary = await ai.chat([
      { role: 'system', content: avatar.prompt || `You are ${avatar.name}. ${avatar.personality}` },
      { role: 'user', content: prompt }
  ], { model: avatar.model, corrId, returnEnvelope: true });
  
  // Handle model not found fallback
  if (summary && typeof summary === 'object' && summary.error?.code === 'MODEL_NOT_FOUND_FALLBACK') {
    const { fallbackModel, originalModel } = summary.error;
    this.logger.warn?.(`[ConversationManager] Model '${originalModel}' not found for ${avatar.name} summary, updating to fallback model '${fallbackModel}'`);
    
    // Update avatar's model to the fallback
    avatar.model = fallbackModel;
    try {
      await this.avatarService.updateAvatar(avatar);
      this.logger.info?.(`[ConversationManager] Updated ${avatar.name}'s model to ${fallbackModel}`);
    } catch (updateError) {
      this.logger.error?.(`[ConversationManager] Failed to update avatar model: ${updateError.message}`);
    }
    
    // Retry the summary generation with the new model
    this.logger.info?.(`[ConversationManager] Retrying summary for ${avatar.name} with fallback model ${fallbackModel}`);
    summary = await ai.chat([
      { role: 'system', content: avatar.prompt || `You are ${avatar.name}. ${avatar.personality}` },
      { role: 'user', content: prompt }
    ], { model: fallbackModel, corrId, returnEnvelope: true });
  }
  
  if (summary && typeof summary === 'object' && summary.text) summary = summary.text;
    try { if (typeof summary === 'string') summary = summary.replace(/<think>[\s\S]*?<\/think>/g, '').trim(); } catch {}
    if (!summary) {
      this.logger.error(`Failed to generate summary for avatar ${avatar.name} in channel ${channelId}`);
      return summaryDoc ? summaryDoc.summary : '';
    }
    const lastMessage = messagesToSummarize[messagesToSummarize.length - 1];
    const lastUpdated = lastMessage.timestamp;
    const lastMessageId = lastMessage.messageId;
    if (summaryDoc) {
      await summariesCollection.updateOne(
        { _id: summaryDoc._id },
        { $set: { summary, lastUpdated, lastMessageId } }
      );
    } else {
      await summariesCollection.insertOne({ avatarId, channelId, summary, lastUpdated, lastMessageId });
    }
    
    // Cache the newly generated summary (reuse cacheKey from top of function)
    this.summaryCacheMap.set(cacheKey, {
      summary,
      timestamp: Date.now(),
      lastMessageId
    });
    
    return summary;
  }

  async updateNarrativeHistory(avatar, content) {
    return this.memoryService.updateNarrativeHistory(avatar, content);
  }

  removeAvatarPrefix(response, avatar) {
    if (response == null) return '';
    const text = this._normalizeToText(response, 'prefix');
    const prefixes = [`${avatar.name} ${avatar.emoji}:`, `${avatar.emoji} ${avatar.name}:`, `${avatar.name}:`];
    for (const prefix of prefixes) {
      if (text.startsWith(prefix)) return text.slice(prefix.length).trim();
    }
    return text;
  }

  /**
   * Queue a response to be sent after rate limit expires
   * @param {Object} channel - Discord channel
   * @param {Object} avatar - Avatar to respond
   * @param {string} presetResponse - Preset response text (if any)
   * @param {Object} options - Response options
   * @param {number} delayMs - Milliseconds to delay before sending
   * @returns {Promise<Object|null>} Resolves when message is sent or fails
   */
  async queueResponse(channel, avatar, presetResponse, options, delayMs) {
    return new Promise((resolve) => {
      const channelId = channel.id;
      
      // Initialize queue if needed
      if (!this.channelResponseQueue.has(channelId)) {
        this.channelResponseQueue.set(channelId, []);
      }
      
      const queue = this.channelResponseQueue.get(channelId);
      
      // Add to queue
      queue.push({
        avatar,
        presetResponse,
        options: { ...options, overrideCooldown: false }, // Don't override when processing queue
        addedAt: Date.now(),
        delayMs,
        resolve
      });
      
      this.logger.info?.(`[ConversationManager] Queued response for ${avatar.name} in channel ${channelId} (will send in ${(delayMs / 1000).toFixed(1)}s, queue size: ${queue.length})`);
      
      // Start queue processor if not already running
      if (!this.queueProcessingIntervals.has(channelId)) {
        this.startQueueProcessor(channelId, channel);
      }
    });
  }

  /**
   * Start processing queued responses for a channel
   * @param {string} channelId - Channel ID
   * @param {Object} channel - Discord channel object
   */
  startQueueProcessor(channelId, channel) {
    // Check queue every 2 seconds
    const intervalHandle = setInterval(async () => {
      const queue = this.channelResponseQueue.get(channelId);
      if (!queue || queue.length === 0) {
        return; // Keep interval running in case new items are added
      }
      
      const now = Date.now();
      const lastBotMessageTime = this.channelLastBotMessage.get(channelId) || 0;
      const timeSinceLastBot = now - lastBotMessageTime;
      
      // Check if cooldown has passed
      if (timeSinceLastBot < this.BOT_REPLY_COOLDOWN) {
        return; // Still cooling down
      }
      
      // Get next item from queue
      const queuedItem = queue.shift();
      if (!queuedItem) return;
      
      this.logger.info?.(`[ConversationManager] Processing queued response for ${queuedItem.avatar.name} in channel ${channelId} (queue remaining: ${queue.length})`);
      
      try {
        // Send the response
        const result = await this.sendResponse(channel, queuedItem.avatar, queuedItem.presetResponse, queuedItem.options);
        queuedItem.resolve(result);
      } catch (error) {
        this.logger.error(`[ConversationManager] Error processing queued response for ${queuedItem.avatar.name}: ${error.message}`);
        queuedItem.resolve(null);
      }
      
      // Clean up interval if queue is empty and hasn't been used recently
      if (queue.length === 0 && now - queuedItem.addedAt > 60000) {
        clearInterval(intervalHandle);
        this.queueProcessingIntervals.delete(channelId);
        this.channelResponseQueue.delete(channelId);
        this.logger.debug?.(`[ConversationManager] Stopped queue processor for channel ${channelId}`);
      }
    }, 2000); // Check every 2 seconds
    
    this.queueProcessingIntervals.set(channelId, intervalHandle);
    this.logger.debug?.(`[ConversationManager] Started queue processor for channel ${channelId}`);
  }

  async sendResponse(channel, avatar, presetResponse = null, options = {}) {
  const { overrideCooldown = false, cascadeDepth = 0, tradeContext = null, conversationThread = null } = options || {};
    
    this.logger.info?.(`[ConversationManager] sendResponse called for ${avatar.name} in channel ${channel.id}, overrideCooldown=${overrideCooldown}`);
    this.logger.info?.(`[ConversationManager] Channel object type: ${typeof channel}, has id: ${!!channel?.id}, Avatar object type: ${typeof avatar}, has name: ${!!avatar?.name}`);
    
    // Gate speaking for KO/dead avatars
    try {
      const now = Date.now();
      if (avatar?.status === 'dead') {
        this.logger.info?.(`[ConversationManager] ${avatar.name} cannot respond - status is dead`);
        return null;
      }
      if (avatar?.status === 'knocked_out') {
        this.logger.info?.(`[ConversationManager] ${avatar.name} cannot respond - status is knocked_out`);
        return null;
      }
      if (avatar?.knockedOutUntil && now < avatar.knockedOutUntil) {
        this.logger.info?.(`[ConversationManager] ${avatar.name} cannot respond - knocked out until ${new Date(avatar.knockedOutUntil).toISOString()}`);
        return null;
      }
    } catch (e) {
      this.logger.warn?.(`[ConversationManager] Error checking avatar status for ${avatar.name}: ${e.message}`);
    }
    
    this.logger.info?.(`[ConversationManager] ${avatar.name} passed status checks`);
    this.logger.info?.(`[ConversationManager] About to get database connection for ${avatar.name}`);
    this.db = await this.databaseService.getDatabase();
    this.logger.info?.(`[ConversationManager] Database connection obtained for ${avatar.name}`);

    // Safety: prevent multiple callers from abusing overrideCooldown to create reply storms.
    // If an overrideCooldown is requested but another responder already used the override
    // (or has responded) in this channel within the current message window, deny the override.
    try {
      const respondersNow = this.channelResponders.get(channel.id) || new Set();
      const forceMultiple = options && options.forceOverrideMultiple;
      if (overrideCooldown && !forceMultiple && respondersNow.size > 0) {
        this.logger.info?.(`[ConversationManager] ${avatar.name} denied overrideCooldown because another avatar already responded in channel ${channel.id}`);
        return null;
      }
    } catch (e) {
      this.logger.debug?.(`[ConversationManager] overrideCooldown safety check failed: ${e.message}`);
    }
    
    if (!await this.checkChannelPermissions(channel)) {
      this.logger.warn?.(`[ConversationManager] ${avatar.name} cannot send response - missing permissions in channel ${channel.id}`);
      return null;
    }
    
    // Bot reply rate limiting: Burst-aware with queueing
    // Allow a few rapid messages, then enforce cooldown, with queuing for blocked avatars
    const now = Date.now();
    const lastBotMessageTime = this.channelLastBotMessage.get(channel.id) || 0;
    const timeSinceLastBotMessage = now - lastBotMessageTime;
    
    // Get or initialize burst count
    let burstInfo = this.channelBotBurstCount.get(channel.id) || { count: 0, windowStart: now };
    
    // Reset burst window if it's expired
    if (now - burstInfo.windowStart > this.BOT_BURST_WINDOW_MS) {
      burstInfo = { count: 0, windowStart: now };
      this.channelBotBurstCount.set(channel.id, burstInfo);
    }
    
    // Check if we're within burst allowance
    const withinBurst = burstInfo.count < this.BOT_BURST_ALLOWED;
    const shouldAllow = overrideCooldown || withinBurst || timeSinceLastBotMessage >= this.BOT_REPLY_COOLDOWN;
    
    if (!shouldAllow) {
      const remainingMs = this.BOT_REPLY_COOLDOWN - timeSinceLastBotMessage;
      this.logger.info?.(`[ConversationManager] ${avatar.name} blocked by bot rate limit in channel ${channel.id} - ${(remainingMs / 1000).toFixed(1)}s remaining (burst: ${burstInfo.count}/${this.BOT_BURST_ALLOWED})`);
      
      // Queue the response to be sent after cooldown expires
      return this.queueResponse(channel, avatar, presetResponse, options, remainingMs);
    }
    
    const lastMessageTime = this.channelLastMessage.get(channel.id) || 0;
  if (!overrideCooldown && Date.now() - lastMessageTime < this.CHANNEL_COOLDOWN) {
      this.logger.info?.(`[ConversationManager] ${avatar.name} blocked by channel cooldown in ${channel.id} (${Date.now() - lastMessageTime}ms since last message, cooldown is ${this.CHANNEL_COOLDOWN}ms)`);
      return null;
    }
    if (!this.channelResponders.has(channel.id)) this.channelResponders.set(channel.id, new Set());
    const responders = this.channelResponders.get(channel.id);
    if (responders.size >= this.MAX_RESPONSES_PER_MESSAGE) {
      this.logger.info?.(`[ConversationManager] ${avatar.name} blocked - channel ${channel.id} has reached maximum responses (${responders.size}/${this.MAX_RESPONSES_PER_MESSAGE})`);
      return null;
    }
    if (responders.has(avatar._id)) {
      this.logger.info?.(`[ConversationManager] ${avatar.name} already responded in channel ${channel.id}`);
      return null;
    }
    
    // Start typing indicator to show user the bot is working
    let stopTyping = () => {};
    try {
      stopTyping = await this.discordService.startTyping(channel.id);
    } catch (e) {
      this.logger.debug?.(`[ConversationManager] Failed to start typing indicator: ${e.message}`);
    }
    
    try {
  let response = presetResponse;
  // Capture adapter/provider reasoning to merge into thoughts later
  let resultReasoning = '';
      if (!response) {
  // Ensure avatar has a model before AI call
  await this.ensureAvatarModel(avatar);
  
  // Fetch channel history early (needed for both image-only check and regular response)
  const channelHistory = await this.getChannelContext(channel.id, 50);
  
  // Check if avatar's model is image-ONLY (cannot generate text, only images)
  // If so, route to image generation instead of chat
  if (this.openrouterModelCatalogService) {
    try {
      this.logger.info?.(`[ConversationManager] Checking if ${avatar.name}'s model '${avatar.model}' is image-only`);
      const isImageOnly = await this.openrouterModelCatalogService.isImageOnlyAsync(avatar.model);
      this.logger.info?.(`[ConversationManager] isImageOnly result for '${avatar.model}': ${isImageOnly}`);
      if (isImageOnly) {
        this.logger.info?.(`[ConversationManager] ${avatar.name} has image-only model '${avatar.model}', routing to image generation`);
        
        // Stop typing since we're doing image generation
        stopTyping();
        
        // Generate an image response using the avatar's image model
        const imageResult = await this._generateImageOnlyResponse(avatar, channel, channelHistory);
        if (imageResult) {
          return imageResult;
        }
        // If image generation failed, fall through to reassign model
        this.logger.warn?.(`[ConversationManager] Image generation failed for ${avatar.name}, reassigning model`);
        const newModel = await this.openrouterModelCatalogService.pickRandomExistingModel();
        if (newModel) {
          avatar.model = newModel;
          try { await this.avatarService.updateAvatar(avatar); } catch {}
          this.logger.info?.(`[ConversationManager] Reassigned ${avatar.name} to text-capable model '${newModel}'`);
        }
      }
    } catch (e) {
      this.logger.debug?.(`[ConversationManager] Image-only check failed: ${e.message}`);
    }
  }
  
      const channelSummary = await this.getChannelSummary(avatar._id, channel.id);

      // Multimodal: if the selected model supports vision, pass Discord image URLs directly.
      // Otherwise we rely on existing caption/summary fields (imageDescription/imageDescriptions).
      const imagePromptParts = [];
      try {
        const capSource = this.aiRouterService?.getBaseForAvatar?.(avatar) || (this.unifiedAIService?.base || this.aiService);
        const supportsVision =
          (typeof capSource?.supportsVisionModel === 'function' && capSource.supportsVisionModel(avatar.model)) ||
          (typeof capSource?.modelSupportsVision === 'function' && capSource.modelSupportsVision(avatar.model)) ||
          false;

        if (supportsVision && Array.isArray(channelHistory) && channelHistory.length) {
          const recentWithImages = [...channelHistory].reverse().find(m => m?.hasImages && (m?.imageUrls?.length || m?.primaryImageUrl));
          const urls = Array.isArray(recentWithImages?.imageUrls) && recentWithImages.imageUrls.length
            ? recentWithImages.imageUrls
            : (recentWithImages?.primaryImageUrl ? [recentWithImages.primaryImageUrl] : []);

          const maxImages = Number(process.env.MAX_VISION_IMAGES_PER_TURN || 3);
          for (const url of urls.slice(0, Math.max(1, maxImages))) {
            if (!url) continue;
            imagePromptParts.push({ type: 'image_url', image_url: { url } });
          }
          if (imagePromptParts.length) {
            this.logger.info?.(`[ConversationManager] Passing ${imagePromptParts.length} image(s) to vision model for ${avatar.name}`);
          }
        }
      } catch (e) {
        this.logger.debug?.(`[ConversationManager] multimodal image extraction failed: ${e.message}`);
      }
      
      // Get relationship context for other avatars in recent conversation
      let relationshipContext = '';
      if (this.configService?.services?.avatarRelationshipService && channelHistory.length > 0) {
        try {
          const relationshipService = this.configService.services.avatarRelationshipService;
          const recentAuthors = new Set();
          
          // Get unique avatar IDs from recent messages (last 10)
          for (const msg of channelHistory.slice(0, 10)) {
            if (msg.authorId && msg.authorId !== String(avatar._id) && msg.authorIsBot) {
              recentAuthors.add(msg.authorId);
            }
          }
          
          // Fetch relationship context for each recent avatar (limit to 3 most recent)
          const recentAuthorsList = Array.from(recentAuthors).slice(0, 3);
          for (const authorId of recentAuthorsList) {
            const context = await relationshipService.getRelationshipContext(
              String(avatar._id),
              authorId
            );
            
            if (context) {
              relationshipContext += `\n${context}\n`;
            }
          }
          
          if (relationshipContext) {
            this.logger.debug?.(`[ConversationManager] Loaded relationship context for ${avatar.name} with ${recentAuthorsList.length} avatar(s)`);
          }
        } catch (relErr) {
          this.logger.debug?.(`Failed to load relationship context: ${relErr.message}`);
        }
      }
      
      let chatMessages;
      const useV2 = this.promptService?.promptAssembler && String(process.env.MEMORY_RECALL_ENABLED || 'true') === 'true';
      if (useV2 && typeof this.promptService.getResponseChatMessagesV2 === 'function') {
        chatMessages = await this.promptService.getResponseChatMessagesV2(avatar, channel, channelHistory, channelSummary, this.db);
      } else {
        chatMessages = await this.promptService.getResponseChatMessages(avatar, channel, channelHistory, channelSummary, this.db);
      }
      
      // Inject relationship context if available
      if (relationshipContext) {
        this.logger.info?.(`[ConversationManager] Injecting relationship context for ${avatar.name}`);
        // Find the user message and prepend the relationship context
        const userMsgIndex = chatMessages.findIndex(msg => msg.role === 'user');
        if (userMsgIndex !== -1) {
          const originalContent = typeof chatMessages[userMsgIndex].content === 'string' 
            ? chatMessages[userMsgIndex].content 
            : chatMessages[userMsgIndex].content.find(c => c.type === 'text')?.text || '';
          
          chatMessages[userMsgIndex].content = `[Relationship Context:\n${relationshipContext}]\n\n${originalContent}`;
        }
      }
      
      // Inject referenced message context if available (from Discord message links)
      const referencedMessageContext = channelHistory.find(msg => msg.referencedMessageContext)?.referencedMessageContext;
      if (referencedMessageContext) {
        this.logger.info?.(`[ConversationManager] Injecting referenced message context for ${avatar.name}`);
        // Find the user message and prepend the referenced message context
        const userMsgIndex = chatMessages.findIndex(msg => msg.role === 'user');
        if (userMsgIndex !== -1) {
          const originalContent = typeof chatMessages[userMsgIndex].content === 'string' 
            ? chatMessages[userMsgIndex].content 
            : chatMessages[userMsgIndex].content.find(c => c.type === 'text')?.text || '';
          
          chatMessages[userMsgIndex].content = `${referencedMessageContext}\n\n${originalContent}`;
        }
      }
      
      // Inject trade context if provided
      if (tradeContext) {
        this.logger.info?.(`[ConversationManager] Injecting trade context for ${avatar.name}: ${tradeContext}`);
        // Find the user message and prepend the trade context
        const userMsgIndex = chatMessages.findIndex(msg => msg.role === 'user');
        if (userMsgIndex !== -1) {
          const originalContent = typeof chatMessages[userMsgIndex].content === 'string' 
            ? chatMessages[userMsgIndex].content 
            : chatMessages[userMsgIndex].content.find(c => c.type === 'text')?.text || '';
          
          chatMessages[userMsgIndex].content = `${tradeContext}\n\n${originalContent}`;
        }
      }
      
      let userContent = chatMessages.find(msg => msg.role === 'user').content;
      if (imagePromptParts.length > 0) {
        const userText = typeof userContent === 'string'
          ? userContent
          : (Array.isArray(userContent) ? (userContent.find(c => c?.type === 'text')?.text || '') : String(userContent || ''));
        userContent = [...imagePromptParts, { type: 'text', text: userText }];
        chatMessages = chatMessages.map(msg => msg.role === 'user' ? { role: 'user', content: userContent } : msg);
      }
  const aiCtx = this.aiRouterService?.getContextForAvatar?.(avatar);
  const ai = aiCtx?.ai || (this.unifiedAIService || this.aiService);
  const corrId = `reply:${avatar._id}:${channel.id}:${Date.now()}`;
  this.logger.debug?.(`[AI][sendResponse] model=${avatar.model} provider=${aiCtx?.provider || (this.unifiedAIService ? 'unified' : 'core')} corrId=${corrId} messages=${chatMessages?.length || 0} override=${overrideCooldown} toolsEnabled=${this.enableToolCalling}`);
  
  // Phase 2: Tool calling with universal meta-prompting approach
  let toolCalls = [];
  if (this.enableToolCalling && this.toolSchemaGenerator && this.toolDecisionService) {
    try {
      // Get available tools
      const toolSchemas = await this.toolSchemaGenerator.generateSchemas();
      
      if (toolSchemas.length > 0 && this.useMetaPrompting) {
        // Fast-path optimization: Skip tool decision for obviously conversational messages
        let needsToolDecision = true;
        if (this.toolFastPathEnabled) {
          needsToolDecision = this._shouldCheckForTools(channelHistory);
        }
        
        if (needsToolDecision) {
          // Universal approach: Use meta-prompting to decide tools (works with ANY model)
          const availableTools = this.toolDecisionService.formatToolsForDecision(toolSchemas);
          
          // Build situation context
          const situation = await this._buildSituationContext(avatar, channel);
          
          // Ask decision service what tools to use
          const decisions = await this.toolDecisionService.decideTools({
            avatar,
            messages: channelHistory || [],
            situation,
            availableTools
          });
          
          if (decisions.length > 0) {
            this.logger.debug?.(`[AI][sendResponse][${corrId}] Meta-prompting recommended ${decisions.length} tool(s): ${decisions.map(d => d.toolName).join(', ')}`);
            
            // Filter out special meta-decisions that aren't actual tools
            const actualToolDecisions = decisions.filter(d => 
              d.toolName !== 'none' && 
              d.toolName !== 'respond' && 
              d.toolName !== 'just respond' &&
              d.toolName !== 'reply'
            );
            
            if (actualToolDecisions.length !== decisions.length) {
              this.logger.debug?.(`[AI][sendResponse][${corrId}] Filtered out ${decisions.length - actualToolDecisions.length} non-tool decision(s) (respond/none)`);
            }
            
            // Convert actual tool decisions to tool_calls format
            toolCalls = actualToolDecisions.map((decision, idx) => ({
              id: `meta_${corrId}_${idx}`,
              type: 'function',
              function: {
                name: decision.toolName,
                arguments: JSON.stringify(decision.arguments)
              }
            }));
            
            if (toolCalls.length > 0) {
              this.logger.debug?.(`[AI][sendResponse][${corrId}] Executing ${toolCalls.length} actual tool(s): ${toolCalls.map(tc => tc.function.name).join(', ')}`);
            } else {
              this.logger.debug?.(`[AI][sendResponse][${corrId}] No actual tools to execute, will generate normal response`);
            }
          }
        } else {
          this.logger.debug?.(`[AI][sendResponse][${corrId}] Fast-path: Skipping tool decision for conversational message`);
        }
      } else if (toolSchemas.length > 0) {
        // Native function calling approach (only for compatible models)
        const supportsTools = this._modelSupportsTools(avatar.model);
        
        if (supportsTools) {
          this.logger.debug?.(`[AI][sendResponse][${corrId}] Using native function calling for ${avatar.model}`);
          // Will be handled by model's native tool calling below
        }
      }
    } catch (error) {
      this.logger.warn?.(`[AI][sendResponse][${corrId}] Tool decision failed: ${error.message}`);
    }
  }
  
  // Build chat options
  // returnEnvelope: true allows us to detect and handle model errors (like 404 model not found)
  const chatOptions = {
        model: avatar.model,
        corrId,
        returnEnvelope: true,
      };
  
  // Execute tools if meta-prompting decided on any
  if (toolCalls.length > 0) {
    this.logger.debug?.(`[AI][sendResponse][${corrId}] Executing ${toolCalls.length} tool(s) before response`);
    
    try {
      // Execute tools with multi-step continuation support
      // Construct a synthetic message object that tools expect
      const syntheticMessage = {
        channel,
        author: { id: avatar._id, bot: true },
        content: '',
        guild: channel.guild,
        guildId: channel.guild?.id,
        // Add methods that some tools might try to call
        reply: async (content) => {
          return this.discordService.sendAsWebhook(channel.id, typeof content === 'string' ? content : content?.content || '', avatar);
        },
        react: async () => { /* no-op for AI-initiated calls */ }
      };
      
      const toolExecution = await this.toolExecutor.executeToolCalls(
        toolCalls,
        syntheticMessage,
        avatar,
        {}, // services
        { chatHistory: chatMessages } // Pass chat history for continuation context
      );
      
      // Handle both old array format and new object format
      const toolResults = toolExecution?.results || toolExecution || [];
      const finalDecision = toolExecution?.finalDecision;
      
      this.logger.debug?.(`[AI][sendResponse][${corrId}] ${this.toolExecutor.getSummary(toolExecution)}`);
      
      // Add tool execution context to the conversation
      const toolSummary = toolResults.map(r => 
        `${r.toolName}: ${r.success ? r.result : `Error: ${r.error}`}`
      ).join('\n');
      
      // Post tool results to the channel so they're visible
      // Note: Some tools (like attack/flee in combat, move) already post via webhook internally,
      // so we filter to avoid double-posting. We only post for tools that return pure status messages.
      const toolsWithInternalPosting = new Set(['attack', 'flee', 'defend', 'move']);
      
      let respondToolPosted = false; // Track if respond tool posted
      
      for (const toolResult of toolResults) {
        // Track if respond tool successfully posted
        if (toolResult.toolName === 'respond' && toolResult.success) {
          respondToolPosted = true;
        }
        
        // Skip tools that handle their own posting
        if (toolsWithInternalPosting.has(toolResult.toolName)) {
          this.logger.debug?.(`[AI][sendResponse][${corrId}] Skipping ${toolResult.toolName} (posts internally)`);
          continue;
        }
        
        if (toolResult.success && toolResult.result && typeof toolResult.result === 'string' && toolResult.result.trim()) {
          try {
            // Only post results that contain visible content (not just system messages for internal use)
            // Skip empty results, nulls, or system-only messages
            const resultText = toolResult.result.trim();
            if (resultText && resultText !== 'null' && !resultText.startsWith('[System:')) {
              await this.discordService.sendAsWebhook(channel.id, resultText, avatar);
              this.logger.debug?.(`[AI][sendResponse][${corrId}] Posted ${toolResult.toolName} result to channel`);
            }
          } catch (postError) {
            this.logger.warn?.(`[AI][sendResponse][${corrId}] Failed to post ${toolResult.toolName} result: ${postError.message}`);
          }
        }
      }
      
      // Optimization: Skip final response if respond tool already posted
      if (respondToolPosted && this.skipFinalResponseAfterRespond) {
        this.logger.debug?.(`[AI][sendResponse][${corrId}] Respond tool handled reply, skipping final LLM generation`);
        
        // Still update rate limiting and activity
        this.channelLastBotMessage.set(channel.id, Date.now());
        responders.add(avatar._id);
        
        // Skip activity tracking for synthetic/monster avatars (non-ObjectId IDs)
        const isSynthetic = avatar?.isMonster === true ||
          String(avatar?._id || avatar?.id || '').startsWith('monster_');
        if (!isSynthetic) {
          try {
            await this.avatarService.updateAvatarActivity(channel.id, String(avatar._id));
          } catch (e) {
            this.logger.warn(`Failed to update avatar activity: ${e.message}`);
          }
        }
        
        return null; // Early exit - no final response needed
      }
      
      // Check if continuation service decided no response needed
      if (finalDecision && !finalDecision.shouldRespond) {
        this.logger.debug?.(`[AI][sendResponse][${corrId}] Continuation decided no response needed`);
        this.channelLastBotMessage.set(channel.id, Date.now());
        responders.add(avatar._id);
        return null;
      }
      
      // CRITICAL: Check if avatar moved during tool execution (e.g., MoveTool)
      // If so, redirect the final response to the new channel
      const hadMoveTool = toolResults.some(r => r.toolName === 'move' && r.success);
      if (hadMoveTool) {
        try {
          const freshAvatar = await this.avatarService.getAvatarById(avatar._id || avatar.id);
          if (freshAvatar && String(freshAvatar.channelId) !== String(channel.id)) {
            this.logger.info?.(`[AI][sendResponse][${corrId}] Avatar ${avatar.name} moved to ${freshAvatar.channelId}, redirecting final response`);
            
            // Fetch the new channel for the final response
            const newChannel = await this.discordService.client.channels.fetch(freshAvatar.channelId);
            if (newChannel) {
              // Update references - avatar data and channel for final response
              avatar = freshAvatar;
              channel = newChannel;
            } else {
              this.logger.warn?.(`[AI][sendResponse][${corrId}] Could not fetch new channel ${freshAvatar.channelId}, response will go to original channel`);
            }
          }
        } catch (moveCheckError) {
          this.logger.warn?.(`[AI][sendResponse][${corrId}] Failed to check avatar location after move: ${moveCheckError.message}`);
        }
      }
      
      // Inject tool results into the conversation
      const iterationNote = toolExecution?.iterations > 1 
        ? ` (over ${toolExecution.iterations} steps)` 
        : '';
      chatMessages.push({
        role: 'user',
        content: `[System: You just performed these actions${iterationNote}:\n${toolSummary}\n\nNow respond naturally, incorporating what just happened.]`
      });
      
    } catch (toolError) {
      this.logger.error?.(`[AI][sendResponse][${corrId}] Tool execution failed: ${toolError.message}`);
    }
  }
  
      let result = await ai.chat(chatMessages, chatOptions);
      result = await this._recoverFromAiEnvelope(result, {
        avatar,
        chatMessages,
        chatOptions,
        ai,
        corrId,
      });
      resultReasoning = (result && typeof result === 'object' && result.reasoning) ? String(result.reasoning) : '';

      this.logger.info?.(`[ConversationManager] AI chat returned for ${avatar.name}, result type: ${typeof result}, is null/undefined: ${result == null}`);

      if (result && typeof result === 'object' && result._recovery) {
        const recovery = result._recovery;
        this.logger.info?.(`[ConversationManager] Applied AI recovery for ${avatar.name}`, {
          type: recovery.type,
          fromModel: recovery.from,
          toModel: recovery.to,
          maxTokens: recovery.maxTokens,
        });
      }

      if (result && typeof result === 'object' && result.error) {
        this.logger.error(`[ConversationManager] AI chat failed for ${avatar.name}: ${result.error.message || result.error.code || 'unknown error'}`);
        return null;
      }
      
      // Handle image-only model responses (e.g., FLUX, image generation models)
      // These models return images array instead of/alongside text
      if (result && typeof result === 'object' && Array.isArray(result.images) && result.images.length > 0) {
        this.logger.info?.(`[ConversationManager] Image-only model response for ${avatar.name}: ${result.images.length} image(s)`);
        
        try {
          const imageResult = result.images[0];
          let imageUrl = null;
          
          // Handle base64 data or URL
          if (imageResult.data) {
            // Upload base64 to S3
            const buffer = Buffer.from(imageResult.data, 'base64');
            const s3Key = `chat-images/${avatar._id}_${Date.now()}.png`;
            imageUrl = await this.s3Service?.uploadBuffer?.(buffer, s3Key, 'image/png');
          } else if (imageResult.url) {
            imageUrl = imageResult.url;
          }
          
          if (imageUrl) {
            // Post image to channel using webhook
            const caption = result.text ? result.text.slice(0, 200) : '';
            const embed = {
              description: caption || null,
              image: { url: imageUrl },
              footer: { text: `Generated by ${avatar.name}` }
            };
            
            try {
              await this.discordService.sendEmbedAsWebhook(
                channel.id,
                embed,
                avatar.name,
                avatar.imageUrl
              );
              
              this.logger.info?.(`[ConversationManager] Posted image from ${avatar.name} to channel ${channel.id}`);
              
              // Update tracking
              this.channelLastMessage.set(channel.id, Date.now());
              this.channelLastBotMessage.set(channel.id, Date.now());
              
              // Track burst
              let burstInfo = this.channelBotBurstCount.get(channel.id) || { count: 0, windowStart: Date.now() };
              burstInfo.count++;
              this.channelBotBurstCount.set(channel.id, burstInfo);
              
              responders.add(avatar._id);
              stopTyping();
              
              return { success: true, imageUrl, avatar: avatar.name };
            } catch (postError) {
              this.logger.warn?.(`[ConversationManager] Failed to post image for ${avatar.name}: ${postError.message}`);
            }
          }
        } catch (imageError) {
          this.logger.warn?.(`[ConversationManager] Image handling failed for ${avatar.name}: ${imageError.message}`);
        }
      }
      
      // Log non-string/atypical shapes for diagnostics
      try {
        if (result && typeof result !== 'string') {
          const keys = Object.keys(result || {});
          const preview = (() => { try { return JSON.stringify(result).slice(0, 500); } catch { return '[unstringifiable]'; } })();
          this.logger.debug?.(`[AI][sendResponse][${corrId}] non-string result; keys=${keys.join(',')}; preview=${preview}`);
        }
      } catch {}
      if (result && typeof result === 'object' && result.text) {
        response = result.text;
      } else {
        response = result;
      }
      if (!response) {
        this.logger.error(`[ConversationManager] Empty response generated for ${avatar.name} - ai.chat returned null/empty`);
        try {
          const preview = (() => { try { return JSON.stringify(result).slice(0, 500); } catch { return String(result); } })();
          this.logger.error(`[AI][sendResponse][${corrId}] empty response; rawPreview=${preview}`);
        } catch {}
        return null;
      }
      // Normalize and strip any avatar prefix before processing think tags
      response = this.removeAvatarPrefix(this._normalizeToText(response, 'send.raw'), avatar);
    }

    const finalText = this._normalizeToText(response, 'send.final');
      if (!finalText || finalText === '[object Object]') {
        try {
          const preview = (() => { try { return JSON.stringify(response).slice(0, 300); } catch { return String(response); } })();
      this.logger.warn?.(`[AI][sendResponse] Suppressing non-text output for ${avatar.name}; preview=${preview}`);
        } catch {}
        return null;
      }
      if (finalText && finalText.trim()) {
        const thinkRegex = /<think>(.*?)<\/think>/gs;
        const thoughts = [];
        const cleanedText = finalText.replace(thinkRegex, (match, thought) => {
          thoughts.push(thought.trim());
          return '';
        }).trim();
        // Merge any adapter-provided reasoning
        if (resultReasoning) {
          try {
            const split = resultReasoning.split(/\n+/).map(s => s.trim()).filter(Boolean);
            thoughts.unshift(...split);
          } catch { thoughts.unshift(resultReasoning.trim()); }
        }
        
        if (thoughts.length > 0) {
          // Initialize thoughts array if it doesn't exist
          avatar.thoughts = avatar.thoughts || [];
          const guildName = GUILD_NAME;
          
          // Add new thoughts to the thoughts array
          thoughts.forEach(thought => {
            if (thought) {
              const thoughtData = { 
                content: thought, 
                timestamp: Date.now(), 
                guildName 
              };
              avatar.thoughts.unshift(thoughtData);
            }
          });
          
          // Keep only the most recent 20 thoughts
          avatar.thoughts = avatar.thoughts.slice(0, 20);
          
          // Also maintain backward compatibility by adding to narrativeHistory
          avatar.narrativeHistory = avatar.narrativeHistory || [];
          thoughts.forEach(thought => {
            if (thought) {
              const narrativeData = { timestamp: Date.now(), content: thought, guildName };
              avatar.narrativeHistory.unshift(narrativeData);
            }
          });
          avatar.narrativeHistory = avatar.narrativeHistory.slice(0, 5);
          avatar.narrativesSummary = avatar.narrativeHistory
            .map(r => `[${new Date(r.timestamp).toLocaleDateString()}] ${r.guildName}: ${r.content}`)
            .join('\n\n');
            
          await this.avatarService.updateAvatar(avatar);
        }
        
        // Send the cleaned text (without think tags) if there's any content left
        if (cleanedText) {
          // Ensure content doesn't exceed Discord's 2000 character limit
          let messageToSend = cleanedText;
          if (messageToSend.length > 2000) {
            this.logger.warn(`[ConversationManager] Message for ${avatar.name} exceeds 2000 chars (${messageToSend.length}), truncating...`);
            messageToSend = messageToSend.substring(0, 1997) + '...';
          }
          
          let sentMessage = await this.discordService.sendAsWebhook(channel.id, messageToSend, avatar);
          if (!sentMessage) {
            this.logger.error(`Failed to send message in channel ${channel.id}`);
            return null;
          }
          
          // Update bot message rate limiting timestamp and burst count for this channel
          const now = Date.now();
          this.channelLastBotMessage.set(channel.id, now);
          
          // Update burst count
          let burstInfo = this.channelBotBurstCount.get(channel.id) || { count: 0, windowStart: now };
          if (now - burstInfo.windowStart > this.BOT_BURST_WINDOW_MS) {
            burstInfo = { count: 1, windowStart: now };
          } else {
            burstInfo.count++;
          }
          this.channelBotBurstCount.set(channel.id, burstInfo);
          
          this.logger.debug(`Updated bot rate limit for channel ${channel.id} (burst: ${burstInfo.count}/${this.BOT_BURST_ALLOWED})`);
          
          // V8: Skip activity tracking and command handling for synthetic/monster
          // avatars. Their IDs (e.g. "monster_lintel_warden_...") are not valid
          // MongoDB ObjectIds and cause crashes in updateAvatarActivity and
          // MapService.updateAvatarPosition.
          const isSyntheticAvatar = avatar?.isMonster === true ||
            String(avatar?._id || avatar?.id || '').startsWith('monster_');

          // Update avatar activity for active avatar management
          if (!isSyntheticAvatar) {
            try {
              await this.avatarService.updateAvatarActivity(channel.id, String(avatar._id));
            } catch (e) {
              this.logger.warn(`Failed to update avatar activity: ${e.message}`);
            }
          }
          
          // React with brain emoji if thoughts were detected
          if (thoughts.length > 0) {
            try {
              await this.discordService.reactToMessage(sentMessage, '🧠');
            } catch (error) {
              this.logger.error(`Failed to add brain reaction: ${error.message}`);
            }
          }
          
          let guild = await this.discordService.getGuildByChannelId(channel.id);
          if (!guild) {
            this.logger.error(`Guild not found for channel ${avatar.channelId}`);
            return null;
          }
          sentMessage.guildId = guild.id;
          sentMessage.channel = channel;

          // Skip command handling for synthetic avatars — they don't need
          // position updates or tool command processing.
          if (!isSyntheticAvatar) {
            handleCommands(sentMessage, {
              logger: this.logger,
              mapService: this.mapService,
              toolService: this.toolService,
              avatarService: this.avatarService,
              discordService: this.discordService,
              configService: this.configService
            }, avatar, await this.getChannelContext(channel.id, 50));
          }

          // After successfully sending a visible message, process bot->bot mentions (limited cascade)
          try {
            if (cleanedText && this.presenceService) {
              await this.handleAvatarMentions(channel, avatar, cleanedText, { cascadeDepth });
            }
          } catch (e) {
            this.logger.warn(`bot mention cascade failed: ${e.message}`);
          }
        }
        // If there was only think tags and no other content, still process thoughts but don't send a message
        else if (thoughts.length > 0) {
          // Just log that we processed thoughts without sending a message
          this.logger.debug(`Processed ${thoughts.length} thought(s) for ${avatar.name} without sending a message (think-only).`);
        }
      }
      if (conversationThread && this.conversationThreadService) {
        try {
          const threadId = typeof conversationThread === 'string' ? conversationThread : conversationThread.id;
          if (threadId) {
            await this.conversationThreadService.recordTurn(channel.id, `${avatar._id}`, threadId);
          }
        } catch (err) {
          this.logger.debug?.(`[ConversationManager] Failed to record thread turn: ${err.message}`);
        }
      }
      this.channelLastMessage.set(channel.id, Date.now());
      if (!this.channelResponders.has(channel.id)) this.channelResponders.set(channel.id, new Set());
      this.channelResponders.get(channel.id).add(avatar._id);
      setTimeout(() => this.channelResponders.set(channel.id, new Set()), this.CHANNEL_COOLDOWN);
      return response;
    } catch (error) {
      this.logger.error(`CONVERSATION: Error sending response for ${avatar.name}: ${error.message}`);
      throw error;
    } finally {
      // Always stop typing indicator when done
      stopTyping();
    }
  }

  _isCreditError(error) {
    if (!error) return false;
    const code = String(error.code || '').toUpperCase();
    if (this.creditErrorCodes.has(code)) {
      return true;
    }
    if (code.includes('402')) {
      return true;
    }
    const message = String(error.message || '').toLowerCase();
    return ['payment required', 'insufficient credit', 'insufficient quota', 'requires payment', 'billing'].some(fragment => message.includes(fragment));
  }

  _selectLowCreditModel(currentModel) {
    if (!Array.isArray(this.lowCreditFallbackModels) || this.lowCreditFallbackModels.length === 0) {
      return null;
    }
    const trimmedCurrent = String(currentModel || '').trim();
    const alternative = this.lowCreditFallbackModels.find(model => model && model !== trimmedCurrent);
    return alternative || this.lowCreditFallbackModels[0];
  }

  async _recoverFromAiEnvelope(result, { avatar, chatMessages, chatOptions, ai, corrId } = {}) {
    if (!result || typeof result !== 'object' || !result.error) {
      return result;
    }

    if (result.error.code === 'MODEL_NOT_FOUND_FALLBACK' && result.error.fallbackModel) {
      const { fallbackModel, originalModel } = result.error;
      this.logger.warn?.(`[ConversationManager] Model '${originalModel}' not found for ${avatar?.name}, updating to fallback model '${fallbackModel}'`);

      if (avatar) {
        avatar.model = fallbackModel;
        try {
          await this.avatarService.updateAvatar(avatar);
          this.logger.info?.(`[ConversationManager] Updated ${avatar.name}'s model to ${fallbackModel}`);
        } catch (updateError) {
          this.logger.error?.(`[ConversationManager] Failed to update avatar model: ${updateError.message}`);
        }
      }

      if (ai && chatMessages && chatOptions) {
        const retryOptions = { ...chatOptions, model: fallbackModel };
        this.logger.info?.(`[ConversationManager] Retrying chat for ${avatar?.name} with fallback model ${fallbackModel}`);
        const retried = await ai.chat(chatMessages, retryOptions);
        if (retried && typeof retried === 'object') {
          retried._recovery = {
            type: 'modelFallback',
            from: originalModel || chatOptions?.model,
            to: fallbackModel,
            corrId,
          };
        }
        return retried;
      }
      return result;
    }

    if (this._isCreditError(result.error) && ai && chatMessages && chatOptions) {
      const fallbackModel = this._selectLowCreditModel(chatOptions.model || avatar?.model);
      if (!fallbackModel) {
        return result;
      }

      this.logger.warn?.(`[ConversationManager] Credit guard triggered for ${avatar?.name || 'unknown avatar'} on model ${chatOptions.model}; retrying with ${fallbackModel}`);

      const retryOptions = { ...chatOptions, model: fallbackModel };
      const retried = await ai.chat(chatMessages, retryOptions);
      if (retried && typeof retried === 'object') {
        retried._recovery = {
          type: 'creditFallback',
          from: chatOptions.model,
          to: fallbackModel,
          corrId,
        };
      }
      return retried;
    }

    return result;
  }

  /**
   * Detects when an avatar mentions other avatars and triggers limited immediate replies.
   * Rules:
   * - Only triggers once per originating send (cascadeDepth 0)
   * - Respects MAX_RESPONSES_PER_MESSAGE budget
   * - Uses simple word-boundary / emoji substring matching
   * - Grants a light mention boost (recordMention + optionally grant newSummon turn)
   */
  async handleAvatarMentions(channel, speakingAvatar, text, { cascadeDepth = 0 } = {}) {
    if (cascadeDepth > 0) return; // prevent deep recursion chains
    if (!channel || !speakingAvatar || !text) return;
    const guildId = channel.guild?.id;
    let others = [];
    try {
      others = await this.avatarService.getAvatarsInChannel(channel.id, guildId);
    } catch (e) {
      this.logger.warn(`mention cascade: failed to load avatars: ${e.message}`);
      return;
    }
    if (!Array.isArray(others) || !others.length) return;

    const responders = this.channelResponders.get(channel.id) || new Set();
    const maxPerMessage = this.MAX_RESPONSES_PER_MESSAGE;
    if (responders.size >= maxPerMessage) return;

    const cascadeLimit = Number(process.env.BOT_MENTION_CASCADE_LIMIT ?? 3);
    const mentionCandidates = this.avatarService?.matchAvatarsByContent
      ? this.avatarService.matchAvatarsByContent(text, others, {
          excludeAvatarIds: [speakingAvatar._id],
          limit: cascadeLimit || undefined
        })
      : (() => {
          const lower = text.toLowerCase();
          const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const matches = [];
          for (const av of others) {
            if (!av || av._id === speakingAvatar._id) continue;
            const name = String(av.name || '').trim();
            if (!name) continue;
            const nameLower = name.toLowerCase();
            let matched = false;
            if (/^[\p{L}\p{N}_'-]+$/u.test(name)) {
              const re = new RegExp(`(?:^|[^\p{L}\p{N}])${escapeRegExp(nameLower)}(?:$|[^\p{L}\p{N}])`, 'u');
              matched = re.test(lower);
            } else {
              matched = lower.includes(nameLower);
            }
            if (!matched && av.emoji) {
              const emo = String(av.emoji).trim();
              if (emo && lower.includes(emo.toLowerCase())) matched = true;
            }
            if (matched) matches.push(av);
          }
          return matches;
        })();
    if (!mentionCandidates.length) return;

    const mentioned = mentionCandidates;
    const maxThreadTurns = Number(process.env.BOT_MENTION_THREAD_TURNS || this.conversationThreadService?.DEFAULT_MAX_TURNS || 6);
    const grantTurns = Number(process.env.BOT_MENTION_GRANT_TURNS || Math.min(2, maxThreadTurns));
    const createThread = String(process.env.BOT_MENTION_CREATE_THREAD || 'true').toLowerCase() === 'true';

    let thread = null;
    if (this.conversationThreadService && createThread) {
      try {
        thread = await this.conversationThreadService.startThread(
          channel.id,
          [speakingAvatar, ...mentioned],
          { mode: 'mention', maxTurns: maxThreadTurns, duration: Number(process.env.CONVERSATION_THREAD_TTL || 180000) }
        );
      } catch (err) {
        this.logger.debug?.(`mention thread creation failed: ${err.message}`);
      }
    }

    const availableBudget = Math.max(0, maxPerMessage - responders.size);
    const slice = mentioned.slice(0, Math.max(0, Math.min(cascadeLimit || mentioned.length, availableBudget)));

    for (const target of slice) {
      try {
        await this.presenceService.ensurePresence(channel.id, `${target._id}`);
        await this.presenceService.recordMention(channel.id, `${target._id}`);
        try {
          const presCol = await this.presenceService.col();
          const doc = await presCol.findOne(
            { channelId: channel.id, avatarId: `${target._id}` },
            { projection: { newSummonTurnsRemaining: 1 } }
          );
          if (!doc?.newSummonTurnsRemaining && grantTurns > 0) {
            await this.presenceService.grantNewSummonTurns(channel.id, `${target._id}`, grantTurns);
          }
        } catch {}

        if (this.configService?.services?.avatarRelationshipService) {
          try {
            const relationshipService = this.configService.services.avatarRelationshipService;
            await relationshipService.recordConversation({
              avatar1Id: String(speakingAvatar._id),
              avatar1Name: speakingAvatar.name,
              avatar2Id: String(target._id),
              avatar2Name: target.name,
              messageId: 'mention',
              content: text.substring(0, 200),
              context: `${speakingAvatar.name} mentioned ${target.name} in conversation`,
              sentiment: 'neutral'
            });
          } catch (relErr) {
            this.logger.debug?.(`Failed to record conversation relationship: ${relErr.message}`);
          }
        }

        const sendResult = await this.sendResponse(channel, target, null, {
          overrideCooldown: true,
          cascadeDepth: cascadeDepth + 1,
          conversationThread: thread?.id || thread
        });

        if (sendResult && thread && this.conversationThreadService) {
          try {
            await this.conversationThreadService.recordTurn(channel.id, `${target._id}`, thread.id);
          } catch (err) {
            this.logger.debug?.(`mention thread record failed: ${err.message}`);
          }
        }
      } catch (e) {
        this.logger.debug?.(`mention cascade send failed for ${target.name}: ${e.message}`);
      }
    }
  }

  async checkForNewMessages(channel, avatar, { since = Date.now() - 5000, limit = 10 } = {}) {
    try {
      const channelObj = typeof channel === 'string' ? await this.discordService.client.channels.fetch(channel) : channel;
      if (!channelObj?.messages?.fetch) return false;
      const fetched = await channelObj.messages.fetch({ limit });
      const avatarId = avatar ? String(avatar._id || avatar.id || '') : '';
      const sinceTs = Number(since) || 0;
      return Array.from(fetched.values()).some(msg => {
        if (!msg) return false;
        if (avatarId && String(msg.author?.id) === avatarId) return false;
        if (msg.author?.bot && msg.author?.id === this.discordService.client?.user?.id) return false;
        return msg.createdTimestamp > sinceTs;
      });
    } catch (err) {
      this.logger.debug?.(`checkForNewMessages failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Build situation context for tool decision making
   * @private
   */
  async _buildSituationContext(avatar, channel) {
    const situation = {};
    
    try {
      // Get location
      const locationResult = await this.mapService.getLocationAndAvatars(channel.id);
      if (locationResult?.location) {
        situation.location = locationResult.location.name;
      }
      
      // Get nearby avatars
      if (locationResult?.avatars) {
        situation.nearbyAvatars = locationResult.avatars
          .filter(a => a._id !== avatar._id)
          .map(a => a.name);
      }
      
      // Get avatar stats
      if (avatar.hp !== undefined) {
        situation.hp = avatar.hp;
        situation.maxHp = avatar.maxHp || 100;
      }
      
      // Check combat status
      situation.inCombat = avatar.status === 'in_combat' || avatar.combatState;
      
    } catch (error) {
      this.logger.debug?.(`Failed to build situation context: ${error.message}`);
    }
    
    return situation;
  }

  /**
   * Check if a model supports function/tool calling
   * @private
   */
  _modelSupportsTools(modelName) {
    if (!modelName) return false;
    
    const modelLower = String(modelName).toLowerCase();
    
    // Known models that support function calling
    const supportedPatterns = [
      /gpt-4/,                          // GPT-4 family
      /gpt-3\.5-turbo/,                 // GPT-3.5-turbo
      /claude-3/,                       // Claude 3 family (all variants)
      /claude-sonnet/,                  // Claude Sonnet
      /claude-opus/,                    // Claude Opus
      /gemini.*pro/,                    // Gemini Pro models
      /gemini.*flash/,                  // Gemini Flash models
      /gemini-2/,                       // Gemini 2.0+
      /mistral.*large/,                 // Mistral Large
      /mistral.*medium/,                // Mistral Medium
      /command-r/,                      // Cohere Command R
      /qwen.*coder/,                    // Qwen Coder models
      /deepseek.*coder/,                // DeepSeek Coder models
      /yi-.*-chat/,                     // Yi Chat models
    ];
    
    // Check if model matches any supported pattern
    for (const pattern of supportedPatterns) {
      if (pattern.test(modelLower)) {
        return true;
      }
    }
    
    // Models that explicitly don't support tools
    const unsupportedPatterns = [
      /hermes/,                         // Hermes models have issues
      /llama-2/,                        // Llama 2 doesn't support tools
      /vicuna/,                         // Vicuna doesn't support tools
      /alpaca/,                         // Alpaca doesn't support tools
      /-instruct$/,                     // Many -instruct variants don't support tools
    ];
    
    for (const pattern of unsupportedPatterns) {
      if (pattern.test(modelLower)) {
        return false;
      }
    }
    
    // Default to false for unknown models to be safe
    return false;
  }

  /**
   * Fast-path optimization: Check if message likely needs tool decision
   * Returns false for obviously conversational messages to skip expensive tool decision LLM call
   * @param {Array} channelHistory - Recent messages
   * @returns {boolean} Whether to check for tools
   * @private
   */
  _shouldCheckForTools(channelHistory) {
    if (!channelHistory || channelHistory.length === 0) return true;
    
    // Get the most recent user message
    const lastMessage = channelHistory[channelHistory.length - 1];
    if (!lastMessage || !lastMessage.content) return true;
    
    const content = lastMessage.content.toLowerCase().trim();
    
    // Fast-path SKIP: Obviously conversational patterns (no tools needed)
    const conversationalPatterns = [
      /^(hi|hey|hello|sup|yo|greetings|howdy|hiya)/,
      /^(thanks|thank you|ty|thx|tysm)/,
      /^(bye|goodbye|cya|see you|later|gnight)/,
      /^(lol|haha|lmao|rofl|xd|😂|😄|🤣)/,
      /^(ok|okay|k|kk|cool|nice|neat|interesting)/,
      /^(what|where|when|why|how|who)\s/,  // Questions
      /\?$/,  // Ends with question mark
      /^tell me (about|more)/,
      /^(i think|i feel|i believe|imo|imho)/,
    ];
    
    // If matches conversational pattern, skip tool check
    if (conversationalPatterns.some(p => p.test(content))) {
      return false; // No tool decision needed
    }
    
    // Fast-path CHECK: Obviously needs tools
    const toolKeywords = [
      'attack', 'hit', 'strike', 'fight',
      'move to', 'go to', 'travel to', 'walk to', 'head to', 'visit',
      'challenge', 'duel', 'battle',
      'flee', 'run away', 'escape',
      'use', 'cast', 'activate',
      'summon', 'spawn', 'create',
      'defend', 'block', 'guard'
    ];
    
    if (toolKeywords.some(kw => content.includes(kw))) {
      return true; // Definitely needs tool decision
    }
    
    // Default: Use tool decision (better safe than miss a tool opportunity)
    return true;
  }

  /**
   * Generate a scene description for image generation using an orchestrator model.
   * Analyzes the channel conversation and creates a detailed visual prompt.
   * @param {object} avatar - The avatar that will be depicted
   * @param {Array} channelHistory - Recent channel messages for context
   * @returns {Promise<string>} A detailed scene description for image generation
   * @private
   */
  async _generateSceneDescription(avatar, channelHistory = []) {
    // Fallback prompt if orchestrator fails
    const fallbackPrompt = avatar.imagePrompt || avatar.appearance || `A fantasy character named ${avatar.name}`;
    
    try {
      // Need a text-capable AI service for the orchestrator
      const orchestrator = this.unifiedAIService;
      if (!orchestrator?.chat) {
        this.logger?.debug?.(`[ConversationManager] No orchestrator available, using fallback prompt for ${avatar.name}`);
        return fallbackPrompt;
      }
      
      // Build conversation context summary
      let conversationContext = '';
      if (channelHistory?.length > 0) {
        const recentMessages = channelHistory.slice(-8); // Last 8 messages
        conversationContext = recentMessages
          .map(m => {
            const author = m.author?.username || m.author?.name || 'Unknown';
            const content = (m.content || '').slice(0, 150);
            return `${author}: ${content}`;
          })
          .filter(line => line.length > 10)
          .join('\n');
      }
      
      // Build the orchestrator prompt
      const systemPrompt = `You are an expert at describing scenes for AI image generation. 
Given a character and conversation context, create a vivid, detailed image generation prompt.

The prompt should:
- Describe a single coherent scene/moment
- Include the main character's appearance and pose
- Set the mood, lighting, and atmosphere
- Be 2-4 sentences, under 300 characters total
- Focus on visual elements only (no dialogue or sounds)
- Be suitable for a fantasy/creative art style

Output ONLY the image prompt, nothing else.`;

      const userPrompt = `Character: ${avatar.name}
Appearance: ${avatar.appearance || avatar.imagePrompt || 'A fantasy character'}
Personality: ${avatar.personality || 'Mysterious and creative'}

Recent conversation:
${conversationContext || '(No recent messages)'}

Generate an image prompt depicting ${avatar.name} in this scene:`;

      // Use a fast, capable model for orchestration
      const orchestratorModel = 'openai/gpt-4o-mini';
      
      this.logger?.debug?.(`[ConversationManager] Generating scene description for ${avatar.name}`);
      
      const result = await orchestrator.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], {
        model: orchestratorModel,
        max_tokens: 150,
        temperature: 0.8,
      });
      
      const scenePrompt = typeof result === 'string' ? result.trim() : result?.text?.trim();
      
      if (scenePrompt && scenePrompt.length > 20) {
        this.logger?.info?.(`[ConversationManager] Generated scene description for ${avatar.name}: "${scenePrompt.slice(0, 100)}..."`);
        return scenePrompt;
      }
      
      this.logger?.debug?.(`[ConversationManager] Orchestrator returned empty/short result, using fallback`);
      return fallbackPrompt;
      
    } catch (e) {
      this.logger?.warn?.(`[ConversationManager] Scene description generation failed: ${e.message}, using fallback`);
      return fallbackPrompt;
    }
  }

  /**
   * Generate a response for an avatar that has an image-only model (like FLUX).
   * These models cannot generate text, only images, so we use them directly for image generation.
   * @param {object} avatar - The avatar with an image-only model
   * @param {object} channel - Discord channel
   * @param {Array} [channelHistory] - Recent channel history for context
   * @returns {Promise<object|null>} The response message or null if failed
   * @private
   */
  async _generateImageOnlyResponse(avatar, channel, channelHistory = []) {
    try {
      // Get the AI service that can generate images
      const ai = this.unifiedAIService?.base || this.aiService;
      if (!ai?.generateImageViaOpenRouter && !ai?.generateImage) {
        this.logger?.warn?.(`[ConversationManager] No image generation service available for ${avatar.name}`);
        return null;
      }
      
      // Use orchestrator model to generate a scene description from channel context
      let imagePrompt = await this._generateSceneDescription(avatar, channelHistory);
      
      // Collect reference images from channel history (profile pics of avatars and users)
      const referenceImages = [];
      
      // Add avatar's own image as primary reference
      if (avatar.imageUrl) {
        referenceImages.push(avatar.imageUrl);
      }
      
      // Collect profile pics from recent messages in channel history
      if (channelHistory?.length > 0) {
        const recentHistory = channelHistory.slice(-10); // Last 10 messages
        const seenUrls = new Set(referenceImages);
        
        for (const msg of recentHistory) {
          // Avatar profile pics from webhook messages
          if (msg.author?.avatar && msg.webhookId) {
            const avatarUrl = msg.author.displayAvatarURL?.() || msg.author.avatarURL?.();
            if (avatarUrl && !seenUrls.has(avatarUrl)) {
              referenceImages.push(avatarUrl);
              seenUrls.add(avatarUrl);
            }
          }
          // User profile pics from regular messages
          if (msg.author && !msg.webhookId) {
            const userUrl = msg.author.displayAvatarURL?.() || msg.author.avatarURL?.();
            if (userUrl && !seenUrls.has(userUrl)) {
              referenceImages.push(userUrl);
              seenUrls.add(userUrl);
            }
          }
          // Stop if we have enough references
          if (referenceImages.length >= 5) break;
        }
      }
      
      this.logger?.info?.(`[ConversationManager] Collected ${referenceImages.length} reference images for ${avatar.name}`);
      
      // Generate the image using the avatar's model
      this.logger?.info?.(`[ConversationManager] Generating image for ${avatar.name} with model ${avatar.model}`);
      
      const result = await (ai.generateImageViaOpenRouter || ai.generateImage).call(ai, imagePrompt, referenceImages, {
        model: avatar.model,
        source: `avatar:${avatar._id}`,
      });
      
      if (!result) {
        this.logger?.warn?.(`[ConversationManager] Image generation returned null for ${avatar.name}`);
        return null;
      }
      
      // Check for image data in different formats
      let imageUrl = null;
      let imageAttachment = null;
      
      if (result.images && result.images.length > 0) {
        // Handle images array format (from generateImageViaOpenRouter)
        const img = result.images[0];
        if (img.url) {
          imageUrl = img.url;
        } else if (img.data) {
          // Base64 data - need to send as attachment
          imageAttachment = {
            data: Buffer.from(img.data, 'base64'),
            name: 'generated.png',
            mimeType: img.mimeType || 'image/png'
          };
        }
      } else if (result.url) {
        imageUrl = result.url;
      } else if (result.data) {
        // Base64 data - need to send as attachment
        imageAttachment = {
          data: Buffer.from(result.data, 'base64'),
          name: 'generated.png',
          mimeType: result.mimeType || 'image/png'
        };
      }
      
      if (!imageUrl && !imageAttachment) {
        this.logger?.warn?.(`[ConversationManager] No image URL or data from generation for ${avatar.name}`);
        return null;
      }
      
      // Send via webhooks - use attachment for base64 data, embed for URLs
      try {
        const webhook = await this.discordService.getOrCreateWebhook(channel);
        if (!webhook) {
          this.logger?.error?.(`[ConversationManager] Failed to get webhook for image response`);
          return null;
        }
        
        const username = `${avatar.name.slice(0, 78)}${avatar.emoji || ''}`.slice(0, 80);
        const threadId = channel.isThread?.() ? channel.id : undefined;
        
        let sentMessage;
        if (imageAttachment) {
          // Send base64 image as file attachment
          const { AttachmentBuilder } = await import('discord.js');
          const attachment = new AttachmentBuilder(imageAttachment.data, { name: imageAttachment.name });
          
          sentMessage = await webhook.send({
            content: '',
            files: [attachment],
            username: username.replace(/discord/ig, ''),
            avatarURL: avatar.imageUrl,
            threadId,
          });
          this.logger?.info?.(`[ConversationManager] Sent image attachment for ${avatar.name}`);
        } else {
          // Send URL as embed
          const embed = {
            color: 0x9b59b6,
            image: { url: imageUrl },
            footer: { text: `Generated by ${avatar.model}` }
          };
          
          sentMessage = await webhook.send({
            embeds: [embed],
            username: username.replace(/discord/ig, ''),
            avatarURL: avatar.imageUrl,
            threadId,
          });
          this.logger?.info?.(`[ConversationManager] Sent image embed for ${avatar.name}`);
        }
        
        // Attach avatar ID for tracking
        if (avatar._id || avatar.id) {
          sentMessage.rati = { avatarId: (avatar._id || avatar.id).toString() };
        }
        sentMessage.guild = channel.guild;
        sentMessage.channel = channel;
        
        // Save to database
        try {
          await this.databaseService?.saveMessage?.(sentMessage);
        } catch (e) {
          this.logger?.debug?.(`[ConversationManager] Failed to save image message: ${e.message}`);
        }
        
        // Update response metrics
        this.channelLastBotMessage.set(channel.id, Date.now());
        
        return sentMessage;
      } catch (e) {
        this.logger?.error?.(`[ConversationManager] Failed to send image via webhook: ${e.message}`);
        return null;
      }
      
    } catch (e) {
      this.logger?.error?.(`[ConversationManager] Image-only response failed for ${avatar.name}: ${e.message}`);
      return null;
    }
  }
}