/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Telegram Bot Service
 * Provides utilities for managing Telegram bot integration
 * Supports both global bot and per-avatar bots
 */

import { Telegraf } from 'telegraf';
import { decrypt, encrypt } from '../../utils/encryption.mjs';

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
  }) {
    this.logger = logger;
    this.databaseService = databaseService;
    this.configService = configService;
    this.secretsService = secretsService;
    this.aiService = aiService;
    this.globalBotService = globalBotService;
    this.googleAIService = googleAIService;
    this.veoService = veoService;
    this.bots = new Map(); // avatarId -> Telegraf instance
    this.globalBot = null;
    
    // Message debouncing: track pending replies per channel
    this.pendingReplies = new Map(); // channelId -> { timeout, lastMessageTime, messages }
    this.REPLY_DELAY_MS = 10000; // 10 seconds delay between messages
    
    // Proactive messaging tracking
    this.lastProactiveMessageTime = null;
    this.conversationHistory = new Map(); // channelId -> array of recent messages
    this.HISTORY_LIMIT = 50; // Keep last 50 messages per channel for rich context
    
    // Media generation cooldown tracking (per user)
    // Limits: Videos: 2/hour, 4/day | Images: 3/hour, 100/day (Telegram-only counting)
    this.mediaGenerationLimits = {
      video: { hourly: 2, daily: 4 },
      image: { hourly: 3, daily: 100 }
    };
  }

  /**
   * Initialize global Telegram bot if configured
   */
  async initializeGlobalBot() {
    try {
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

      this.globalBot = new Telegraf(token);
      
      // Set up media usage command
      this.globalBot.start((ctx) => ctx.reply('Welcome to CosyWorld! 🌍 I\'m here to share stories and chat about our vibrant community.'));
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
      
      // Set up message handlers for conversations
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

    this.logger?.debug?.('[TelegramService] Message handlers configured');
  }

  /**
   * Save a message to the database for persistence
   * @private
   */
  async _saveMessageToDatabase(channelId, message) {
    try {
      const db = await this.databaseService.getDatabase();
      await db.collection('telegram_messages').insertOne({
        channelId,
        from: message.from,
        text: message.text,
        date: new Date(message.date * 1000), // Convert Unix timestamp to Date
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
        date: msg.date instanceof Date ? Math.floor(msg.date.getTime() / 1000) : msg.date
      }));
      
      this.conversationHistory.set(channelId, history);
      this.logger?.info?.(`[TelegramService] Loaded ${history.length} messages from database for channel ${channelId}`);
      return history;
    } catch (error) {
      this.logger?.error?.(`[TelegramService] Failed to load conversation history:`, error);
      return [];
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
      this.logger?.info?.(`[TelegramService] Recorded ${mediaType} generation for user ${username} (${userId})`);
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
    
    // Ignore messages from the bot itself
    if (message.from.is_bot) {
      return;
    }

    // Load history from database if not in memory
    if (!this.conversationHistory.has(channelId)) {
      await this._loadConversationHistory(channelId);
    }
    
    const history = this.conversationHistory.get(channelId) || [];
    
    // Add message to history
    const messageData = {
      from: message.from.first_name || message.from.username || 'User',
      text: message.text,
      date: message.date,
      isBot: false
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

    // Check if bot is mentioned
    const botUsername = ctx.botInfo?.username;
    const isMentioned = message.text?.includes(`@${botUsername}`) || 
                       message.entities?.some(e => e.type === 'mention' && message.text.slice(e.offset, e.offset + e.length).includes(botUsername));

    this.logger?.debug?.(`[TelegramService] Message received in ${channelId}, mentioned: ${isMentioned}`);

    // If mentioned, reply immediately
    if (isMentioned) {
      await this.generateAndSendReply(ctx, channelId, true);
      // Mark that we've responded to this conversation
      const pending = this.pendingReplies.get(channelId) || {};
      pending.lastBotResponseTime = Date.now();
      this.pendingReplies.set(channelId, pending);
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
          
          this.logger?.info?.(`[TelegramService] Conversation gap detected in ${channelId} (${Math.round(timeSinceLastMessage/1000)}s silence)`);
          
          // Mark this message as checked to avoid duplicate responses
          pending.lastCheckedMessageTime = lastMessageTime;
          this.pendingReplies.set(channelId, pending);
          
          // Generate a response to the conversation
          // Create a mock context object for the reply
          if (!this.globalBot) continue;
          
          const mockCtx = {
            chat: { id: channelId },
            message: {
              text: lastMessage.text,
              from: { first_name: lastMessage.from, id: 'unknown' },
              date: lastMessage.date
            },
            telegram: this.globalBot.telegram, // CRITICAL: Need this for sendPhoto/sendVideo
            reply: async (text) => {
              return await this.globalBot.telegram.sendMessage(channelId, text);
            }
          };
          
          await this.generateAndSendReply(mockCtx, channelId, false);
          pending.lastBotResponseTime = Date.now();
          this.pendingReplies.set(channelId, pending);
          
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
    try {
      // Determine GLOBAL tool credit context (not per-user)
      let imageLimitCtx = null;
      let videoLimitCtx = null;
      try {
        [imageLimitCtx, videoLimitCtx] = await Promise.all([
          this.checkMediaGenerationLimit(null, 'image'),
          this.checkMediaGenerationLimit(null, 'video')
        ]);
      } catch (e) {
        this.logger?.debug?.('[TelegramService] Could not fetch tool credit context:', e.message);
      }

      // Load conversation history if not already in memory
      if (!this.conversationHistory.has(channelId)) {
        await this._loadConversationHistory(channelId);
      }
      
      // Get full conversation history (last 20 messages for context)
      const fullHistory = this.conversationHistory.get(channelId) || [];
      const recentHistory = fullHistory.slice(-20); // Use last 20 for AI context
      
      // Build rich conversation context from history
      const conversationContext = recentHistory.length > 0
        ? recentHistory.map(m => `${m.from}: ${m.text}`).join('\n')
        : `${ctx.message.from.first_name || ctx.message.from.username || 'User'}: ${ctx.message.text}`;

      this.logger?.info?.(`[TelegramService] Generating reply with ${recentHistory.length} messages of context`);

      // Get global bot persona
      let botPersonality = 'You are the CosyWorld narrator bot, a warm and welcoming guide who shares stories about our AI avatar community.';
      let botDynamicPrompt = 'I\'ve been welcoming interesting souls to CosyWorld.';
      
      if (this.globalBotService?.bot) {
        try {
          const persona = await this.globalBotService.getPersona();
          if (persona?.bot) {
            botPersonality = persona.bot.personality || botPersonality;
            botDynamicPrompt = persona.bot.dynamicPrompt || botDynamicPrompt;
          }
        } catch (e) {
          this.logger?.debug?.('[TelegramService] Could not load bot persona:', e.message);
        }
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
Tool Credits (global): ${buildCreditInfo(imageLimitCtx, 'Images')} | ${buildCreditInfo(videoLimitCtx, 'Videos')}
Rule: Only call tools if credits available. If 0, explain naturally and mention reset time.`;

      const systemPrompt = `${botPersonality}

${botDynamicPrompt}

Conversation mode: ${isMention ? 'Direct mention - respond to their question' : 'General chat - respond naturally'}
Keep responses brief (2-3 sentences).

${toolCreditContext}

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
            name: 'generate_image',
            description: 'Generate an image based on a text prompt. Use this when users ask you to create, generate, or make an image or photo.',
            parameters: {
              type: 'object',
              properties: {
                prompt: {
                  type: 'string',
                  description: 'A detailed description of the image to generate. Be creative and descriptive.'
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
            description: 'Generate a short video based on a text prompt. Use this when users ask you to create, generate, or make a video.',
            parameters: {
              type: 'object',
              properties: {
                prompt: {
                  type: 'string',
                  description: 'A detailed description of the video to generate. Include motion, action, and visual details.'
                }
              },
              required: ['prompt']
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
        const acknowledgment = responseObj.text || String(response || '').trim();
        
        if (acknowledgment) {
          // Send the AI's natural acknowledgment first
          await ctx.reply(acknowledgment);
          
          // Track in conversation history
          if (!this.conversationHistory.has(String(ctx.chat.id))) {
            this.conversationHistory.set(String(ctx.chat.id), []);
          }
          const botMessage = {
            from: 'Bot',
            text: acknowledgment,
            date: Math.floor(Date.now() / 1000),
            isBot: true
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
        await ctx.reply(cleanResponse);
        
        // Track bot's reply in conversation history
        if (!this.conversationHistory.has(channelId)) {
          this.conversationHistory.set(channelId, []);
        }
        const botMessage = {
          from: 'Bot',
          text: cleanResponse,
          date: Math.floor(Date.now() / 1000),
          isBot: true
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
      
      for (const toolCall of toolCalls) {
        const functionName = toolCall.function?.name;
        const args = typeof toolCall.function?.arguments === 'string' 
          ? JSON.parse(toolCall.function.arguments)
          : toolCall.function?.arguments || {};

        this.logger?.info?.(`[TelegramService] Executing tool: ${functionName}`, { args, userId, username });

        if (functionName === 'generate_image') {
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
            continue;
          }
          
          await this.executeImageGeneration(ctx, args.prompt, conversationContext, userId, username);
          
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
            continue;
          }
          
          await this.executeVideoGeneration(ctx, args.prompt, conversationContext, userId, username);
          
        } else {
          this.logger?.warn?.(`[TelegramService] Unknown tool: ${functionName}`);
          await ctx.reply(`I tried to use ${functionName} but I don't know how yet! 🤔`);
        }
      }
    } catch (error) {
      this.logger?.error?.('[TelegramService] Tool execution failed:', error);
      await ctx.reply('I encountered an error using my powers! 😅 Try again?');
    }
  }

  /**
   * Execute image generation and send to channel
   * @param {Object} ctx - Telegram context
   * @param {string} prompt - Image generation prompt (enhanced by AI)
   * @param {string} conversationContext - Recent conversation history
   * @param {string} userId - User ID for cooldown tracking
   * @param {string} username - Username for logging
   */
  async executeImageGeneration(ctx, prompt, conversationContext = '', userId = null, username = null) {
    try {
      // No status message - the AI already sent a natural acknowledgment

      this.logger?.info?.('[TelegramService] Generating image:', { prompt, userId, username });

      // Generate image using the AI service
      let imageUrl = null;
      
      // Try aiService first (usually OpenRouter/Replicate)
      if (this.aiService?.generateImage) {
        try {
          imageUrl = await this.aiService.generateImage(prompt, [], {
            source: 'telegram.user_request',
            purpose: 'user_generated',
            context: prompt
          });
        } catch (err) {
          this.logger?.warn?.('[TelegramService] aiService image generation failed:', err.message);
        }
      }

      // Fallback to googleAIService if available
      if (!imageUrl && this.googleAIService?.generateImage) {
        try {
          imageUrl = await this.googleAIService.generateImage(prompt, '1:1', {
            source: 'telegram.user_request',
            purpose: 'user_generated',
            context: prompt
          });
        } catch (err) {
          this.logger?.warn?.('[TelegramService] googleAIService image generation failed:', err.message);
        }
      }

      if (!imageUrl) {
        throw new Error('All image generation services failed');
      }

      this.logger?.info?.('[TelegramService] Image generated successfully:', { imageUrl });

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
      await ctx.telegram.sendPhoto(ctx.chat.id, imageUrl, {
        caption: caption || undefined // No caption if AI generation failed
      });
      
      // Record usage for cooldown tracking
      if (userId && username) {
        await this._recordMediaUsage(userId, username, 'image');
      }
      
      // Mark that bot posted media - this counts as bot attention/activity
      const channelId = String(ctx.chat.id);
      const pending = this.pendingReplies.get(channelId) || {};
      pending.lastBotResponseTime = Date.now();
      this.pendingReplies.set(channelId, pending);
      
      this.logger?.info?.('[TelegramService] Image posted, marked as bot activity');

    } catch (error) {
      this.logger?.error?.('[TelegramService] Image generation failed:', error);
      
      // Generate natural error message
      let errorText = '❌ Sorry, I couldn\'t generate that image. The AI gods weren\'t smiling today! 😅';
      if (this.globalBotService) {
        try {
          const errorResponse = await this.aiService.chat([
            { role: 'user', content: 'You tried to generate an image but it failed. Give a brief, sympathetic, slightly humorous apology (under 50 words).' }
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
    }
  }

  /**
   * Execute video generation and send to channel
   * @param {Object} ctx - Telegram context
   * @param {string} prompt - Video generation prompt (enhanced by AI)
   * @param {string} conversationContext - Recent conversation history
   * @param {string} userId - User ID for cooldown tracking
   * @param {string} username - Username for logging
   */
  async executeVideoGeneration(ctx, prompt, conversationContext = '', userId = null, username = null) {
    try {
      // No status message - the AI already sent a natural acknowledgment

      this.logger?.info?.('[TelegramService] Generating video:', { prompt, userId, username });

      // Generate video using VeoService
      if (!this.veoService) {
        throw new Error('Video generation service not available');
      }

      // Generate video (returns array of URLs)
      const videoUrls = await this.veoService.generateVideos({
        prompt: prompt,
        config: {
          numberOfVideos: 1,
          aspectRatio: '16:9'
          // Note: durationSeconds and resolution parameters are not supported for text-to-video generation
        },
        model: 'veo-3.1-generate-preview'
      });

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
      await ctx.telegram.sendVideo(ctx.chat.id, videoUrl, {
        caption: caption || undefined,
        supports_streaming: true
      });
      
      // Record usage for cooldown tracking
      if (userId && username) {
        await this._recordMediaUsage(userId, username, 'video');
      }
      
      // Mark that bot posted media - this counts as bot attention/activity
      const channelId = String(ctx.chat.id);
      const pending = this.pendingReplies.get(channelId) || {};
      pending.lastBotResponseTime = Date.now();
      this.pendingReplies.set(channelId, pending);
      
      this.logger?.info?.('[TelegramService] Video posted, marked as bot activity');

    } catch (error) {
      this.logger?.error?.('[TelegramService] Video generation failed:', error);
      
      // Generate natural error message
      let errorText = '❌ Sorry, I couldn\'t generate that video. Video generation is complex and sometimes fails! 😅';
      if (this.globalBotService) {
        try {
          const errorResponse = await this.aiService.chat([
            { role: 'user', content: 'You tried to generate a video but it failed. Give a brief, sympathetic, slightly humorous apology (under 50 words).' }
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
      const bot = new Telegraf(token);
      
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
          caption: content,
          parse_mode: 'Markdown',
        });
      } else if (options.videoUrl) {
        messageResult = await bot.telegram.sendVideo(channelId, options.videoUrl, {
          caption: content,
          parse_mode: 'Markdown',
        });
      } else {
        messageResult = await bot.telegram.sendMessage(channelId, content, {
          parse_mode: 'Markdown',
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
   * @returns {string} - Markdown formatted text
   */
  _formatTelegramMarkdown(text) {
    if (!text) return '';
    
    // Use standard Markdown (not MarkdownV2) for better compatibility
    // Telegram supports: *bold* _italic_ [text](URL) `code` ```pre```
    return String(text).trim();
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
        
        const tweetText = text || `Check out this post from CosyWorld!\n\n${opts.tweetUrl}`;
        
        const messageResult = await this.globalBot.telegram.sendMessage(channelId, tweetText, {
          parse_mode: 'Markdown',
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
        caption = (caption + ' #CosyWorld').trim();
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
            parse_mode: 'Markdown',
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
              parse_mode: 'Markdown',
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
          parse_mode: 'Markdown',
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
   * Generate and send a proactive conversation starter
   * Called periodically to initiate conversations in configured channels
   */
  async sendProactiveMessage() {
    try {
      if (!this.globalBot) {
        this.logger?.debug?.('[TelegramService][proactive] No global bot configured');
        return null;
      }

      // Load configuration
      const config = await this._loadGlobalPostingConfig();
      const proactiveConfig = config?.proactive || {};
      
      // Check if proactive messaging is enabled
      if (proactiveConfig.enabled === false) {
        this.logger?.debug?.('[TelegramService][proactive] Proactive messaging disabled in config');
        return null;
      }

      // Get channel ID
      let channelId = config?.channelId;
      
      if (!channelId && this.secretsService) {
        try {
          channelId = await this.secretsService.getAsync('telegram_global_channel_id');
        } catch {
          this.logger?.debug?.('[TelegramService][proactive] No channel in secrets');
        }
      }
      
      if (!channelId) {
        channelId = this.configService.get('TELEGRAM_GLOBAL_CHANNEL_ID') || process.env.TELEGRAM_GLOBAL_CHANNEL_ID;
      }

      if (!channelId) {
        this.logger?.debug?.('[TelegramService][proactive] No channel ID configured');
        return null;
      }

      // Check rate limiting - don't send too frequently
      const minIntervalMs = (proactiveConfig.minIntervalHours || 2) * 60 * 60 * 1000; // Default 2 hours
      const now = Date.now();
      
      if (this.lastProactiveMessageTime && (now - this.lastProactiveMessageTime) < minIntervalMs) {
        const nextInHours = ((minIntervalMs - (now - this.lastProactiveMessageTime)) / (60 * 60 * 1000)).toFixed(1);
        this.logger?.debug?.(`[TelegramService][proactive] Too soon to send another message (next in ${nextInHours}h)`);
        return null;
      }

      // Get conversation history for context
      const history = this.conversationHistory.get(channelId) || [];
      const recentContext = history
        .slice(-10) // Last 10 messages
        .map(m => `${m.from}: ${m.text}`)
        .join('\n');

      // Get bot personality
      let botPersonality = 'You are the CosyWorld narrator bot, a warm and welcoming guide who shares stories about our AI avatar community.';
      let botDynamicPrompt = 'I\'ve been welcoming interesting souls to CosyWorld.';
      
      if (this.globalBotService?.bot) {
        try {
          const persona = await this.globalBotService.getPersona();
          if (persona?.bot) {
            botPersonality = persona.bot.personality || botPersonality;
            botDynamicPrompt = persona.bot.dynamicPrompt || botDynamicPrompt;
          }
        } catch (e) {
          this.logger?.debug?.('[TelegramService][proactive] Could not load bot persona:', e.message);
        }
      }

      // Get recent community activity for inspiration
      let communityContext = '';
      try {
        const db = await this.databaseService.getDatabase();
        
        // Get recent avatar creations
        const recentAvatars = await db.collection('avatars')
          .find({})
          .sort({ created: -1 })
          .limit(5)
          .toArray();
        
        if (recentAvatars.length > 0) {
          const avatarNames = recentAvatars.map(a => `${a.emoji || ''} ${a.name}`).join(', ');
          communityContext += `Recent new members: ${avatarNames}\n`;
        }

        // Get recent social posts
        const recentPosts = await db.collection('social_posts')
          .find({ platform: 'telegram', global: true })
          .sort({ createdAt: -1 })
          .limit(3)
          .toArray();
        
        if (recentPosts.length > 0) {
          communityContext += `Recent posts shared: ${recentPosts.length} updates\n`;
        }
      } catch (e) {
        this.logger?.debug?.('[TelegramService][proactive] Could not fetch community context:', e.message);
      }

      // Generate conversation starter
      const systemPrompt = `${botPersonality}

Your current thoughts and perspective:
${botDynamicPrompt}

${communityContext ? `Recent community activity:\n${communityContext}` : ''}

You're initiating a conversation in the Telegram channel. Generate an engaging conversation starter that:
- Reflects on recent events or introduces an interesting topic about CosyWorld
- Encourages others to respond and engage
- Is warm, curious, and thought-provoking
- Stays concise (2-4 sentences max)
- Feels natural, not forced or salesy

${recentContext ? `Recent channel conversation for context:\n${recentContext}\n\nDon't repeat what was just discussed, bring something fresh.` : 'This is a fresh conversation starter.'}`;

      const userPrompt = 'Generate an engaging conversation starter for the CosyWorld community channel.';

      if (!this.aiService) {
        this.logger?.warn?.('[TelegramService][proactive] AI service not configured');
        return null;
      }

      const response = await this.aiService.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], {
        model: this.globalBotService?.bot?.model || 'anthropic/claude-sonnet-4.5',
        temperature: 0.9 // Higher temperature for more creative starters
      });

      const messageText = typeof response === 'object' ? response.text : response;
      const cleanMessage = String(messageText || '')
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .trim();

      if (!cleanMessage) {
        this.logger?.warn?.('[TelegramService][proactive] Generated empty message');
        return null;
      }

      // Send the message
      const messageResult = await this.globalBot.telegram.sendMessage(channelId, cleanMessage);
      
      // Update tracking
      this.lastProactiveMessageTime = Date.now();
      
      // Add to conversation history
      if (!this.conversationHistory.has(channelId)) {
        this.conversationHistory.set(channelId, []);
      }
      const botMessage = {
        from: 'Bot',
        text: cleanMessage,
        date: Math.floor(Date.now() / 1000),
        isBot: true
      };
      this.conversationHistory.get(channelId).push(botMessage);
      
      // Persist to telegram_messages collection
      this._saveMessageToDatabase(channelId, botMessage).catch(err => 
        this.logger?.error?.('[TelegramService] Failed to save proactive message:', err)
      );

      // Store in social_posts database for analytics
      const db = await this.databaseService.getDatabase();
      await db.collection('social_posts').insertOne({
        global: true,
        platform: 'telegram',
        messageId: messageResult.message_id,
        channelId,
        content: cleanMessage,
        metadata: {
          type: 'proactive_conversation',
          source: 'automated_scheduler',
        },
        createdAt: new Date(),
      });

      this.logger?.info?.(`[TelegramService][proactive] Sent conversation starter to channel ${channelId}`);
      return { messageId: messageResult.message_id, channelId, text: cleanMessage };

    } catch (error) {
      this.logger?.error?.('[TelegramService][proactive] Failed to send proactive message:', error.message);
      return null;
    }
  }

  /**
   * Start scheduled proactive messaging
   * @param {Object} schedulingService - The scheduling service instance
   * @param {number} checkIntervalMs - How often to check if we should send (default: 30 minutes)
   */
  startProactiveMessaging(schedulingService, checkIntervalMs = 30 * 60 * 1000) {
    if (!schedulingService) {
      this.logger?.warn?.('[TelegramService] Cannot start proactive messaging: no scheduling service');
      return;
    }

    schedulingService.addTask('telegram-proactive', async () => {
      try {
        await this.sendProactiveMessage();
      } catch (error) {
        this.logger?.error?.('[TelegramService] Proactive message task error:', error.message);
      }
    }, checkIntervalMs);

    this.logger?.info?.(`[TelegramService] Proactive messaging scheduled (checks every ${checkIntervalMs/60000} minutes)`);
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
          this.logger?.debug?.(`[TelegramService] Bot for avatar ${avatarId} stopped`);
        } catch (e) {
          this.logger?.warn?.(`[TelegramService] Error stopping bot for ${avatarId}:`, e.message);
        }
      }

      this.bots.clear();
      this.logger?.info?.('[TelegramService] All bots stopped');
    } catch (error) {
      this.logger?.error?.('[TelegramService] Shutdown error:', error.message);
    }
  }
}

export { TelegramService };
export default TelegramService;
