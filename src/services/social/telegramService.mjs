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
        } catch {
          this.logger?.debug?.('[TelegramService] No existing bot to stop');
        }
      }

      this.globalBot = new Telegraf(token);
      
      // Set up basic commands
      this.globalBot.start((ctx) => ctx.reply('Welcome to CosyWorld! 🌍 I\'m here to share stories and chat about our vibrant community.'));
      this.globalBot.help((ctx) => ctx.reply('I\'m the CosyWorld bot! I can chat about our community and answer questions. Just message me anytime!'));
      
      // Set up message handlers for conversations
      this.setupMessageHandlers();
      
      // Launch the bot (uses long polling by default, which Telegram handles gracefully)
      // Telegram will automatically disconnect any other instance using the same token
      // Don't await launch() - it starts a long-running polling process
      this.globalBot.launch().catch(err => {
        this.logger?.error?.('[TelegramService] Bot launch error:', err.message);
      });
      
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
      return;
    }

    // Otherwise, use debouncing logic
    this.debounceReply(ctx, channelId);
  }

  /**
   * Debounce replies - wait 30 seconds, but reset timer if new messages arrive
   */
  debounceReply(ctx, channelId) {
    const pending = this.pendingReplies.get(channelId) || { messages: [] };
    
    // Clear existing timeout
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }

    // Add message to context
    pending.messages.push({
      text: ctx.message.text,
      from: ctx.message.from,
      date: ctx.message.date,
    });

    // Keep only last 10 messages for context
    if (pending.messages.length > 10) {
      pending.messages = pending.messages.slice(-10);
    }

    pending.lastMessageTime = Date.now();

    // Set new timeout
    pending.timeout = setTimeout(async () => {
      try {
        await this.generateAndSendReply(ctx, channelId, false);
        this.pendingReplies.delete(channelId);
      } catch (error) {
        this.logger?.error?.('[TelegramService] Debounced reply error:', error);
      }
    }, this.REPLY_DELAY_MS);

    this.pendingReplies.set(channelId, pending);
    this.logger?.debug?.(`[TelegramService] Reply debounced for channel ${channelId}, ${pending.messages.length} messages pending`);
  }

  /**
   * Generate and send a reply using the global bot's personality
   * Now includes tool calling for image and video generation!
   * Uses full conversation history for better context awareness.
   */
  async generateAndSendReply(ctx, channelId, isMention) {
    try {
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

      const systemPrompt = `${botPersonality}

Your current thoughts and perspective:
${botDynamicPrompt}

You're having a conversation in a Telegram channel. Respond naturally and conversationally.
Keep responses concise (2-3 sentences max).
${isMention ? 'You were directly mentioned - respond to the question or comment.' : 'Respond to the general conversation flow.'}

CRITICAL: When using tools, you MUST provide BOTH a natural text response AND the tool call:
- The text response should acknowledge what you're about to do in a contextual, natural way
- Reference the actual content of their request, not generic phrases
- Make it feel like natural conversation, not a status update
- Then use the tool to actually execute the action

Examples:
User: "Can you show me the ratbros mourning Rati?"
You: "Of course. Let me capture that somber moment for you..." [+ generate_image tool with detailed prompt]

User: "Make a video of rain falling"  
You: "I love that - there's something meditative about rain. Give me a minute to bring it to life..." [+ generate_video tool]

When they ask for media generation:
- Generate/create/make an image or photo → Natural acknowledgment + generate_image tool
- Generate/create/make a video → Natural acknowledgment + generate_video tool

ALWAYS provide the acknowledgment text alongside the tool call. The acknowledgment is part of the conversation.`;

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
        max_tokens: 500,
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
          this.conversationHistory.get(String(ctx.chat.id)).push({
            from: 'Bot',
            text: acknowledgment,
            date: Date.now()
          });
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
   * @param {Object} ctx - Telegram context
   * @param {Array} toolCalls - Array of tool calls from AI
   * @param {string} conversationContext - Recent conversation for context
   */
  async handleToolCalls(ctx, toolCalls, conversationContext) {
    try {
      for (const toolCall of toolCalls) {
        const functionName = toolCall.function?.name;
        const args = typeof toolCall.function?.arguments === 'string' 
          ? JSON.parse(toolCall.function.arguments)
          : toolCall.function?.arguments || {};

        this.logger?.info?.(`[TelegramService] Executing tool: ${functionName}`, { args });

        if (functionName === 'generate_image') {
          await this.executeImageGeneration(ctx, args.prompt, conversationContext);
        } else if (functionName === 'generate_video') {
          await this.executeVideoGeneration(ctx, args.prompt, conversationContext);
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
   */
  async executeImageGeneration(ctx, prompt, conversationContext = '') {
    try {
      // No status message - the AI already sent a natural acknowledgment

      this.logger?.info?.('[TelegramService] Generating image:', { prompt });

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
            max_tokens: 100,
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
            max_tokens: 100,
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
   */
  async executeVideoGeneration(ctx, prompt, conversationContext = '') {
    try {
      // No status message - the AI already sent a natural acknowledgment

      this.logger?.info?.('[TelegramService] Generating video:', { prompt });

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
            max_tokens: 100,
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
            max_tokens: 100,
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
        max_tokens: 200,
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
      this.conversationHistory.get(channelId).push({
        from: 'Bot',
        text: cleanMessage,
        date: Date.now()
      });

      // Store in database
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
