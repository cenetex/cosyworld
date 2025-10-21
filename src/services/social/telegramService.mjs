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
  }) {
    this.logger = logger;
    this.databaseService = databaseService;
    this.configService = configService;
    this.secretsService = secretsService;
    this.aiService = aiService;
    this.globalBotService = globalBotService;
    this.bots = new Map(); // avatarId -> Telegraf instance
    this.globalBot = null;
    
    // Message debouncing: track pending replies per channel
    this.pendingReplies = new Map(); // channelId -> { timeout, lastMessageTime, messages }
    this.REPLY_DELAY_MS = 30000; // 30 seconds delay between messages
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
      await this.globalBot.launch();
      
      const botInfo = await this.globalBot.telegram.getMe();
      this.logger?.info?.(`[TelegramService] Global bot initialized successfully: @${botInfo.username}`);
      return true;
    } catch (error) {
      this.logger?.error?.('[TelegramService] Failed to initialize global bot:', error.message);
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
   * Handle incoming messages with debouncing and mention detection
   */
  async handleIncomingMessage(ctx) {
    const message = ctx.message;
    const channelId = String(ctx.chat.id);
    
    // Ignore messages from the bot itself
    if (message.from.is_bot) {
      return;
    }

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
   */
  async generateAndSendReply(ctx, channelId, isMention) {
    try {
      // Get pending messages for context
      const pending = this.pendingReplies.get(channelId);
      const recentMessages = pending?.messages || [{
        text: ctx.message.text,
        from: ctx.message.from,
        date: ctx.message.date,
      }];

      // Build conversation context
      const conversationContext = recentMessages
        .map(m => `${m.from.first_name || m.from.username || 'User'}: ${m.text}`)
        .join('\n');

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
${isMention ? 'You were directly mentioned - respond to the question or comment.' : 'Respond to the general conversation flow.'}`;

      const userPrompt = `Recent conversation:
${conversationContext}

Respond naturally to this conversation. Be warm, engaging, and reflect your narrator personality.`;

      // Generate response using AI
      if (!this.aiService) {
        await ctx.reply('I\'m here and listening! 👂 (AI service not configured)');
        return;
      }

      const response = await this.aiService.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], {
        model: this.globalBotService?.bot?.model || 'anthropic/claude-sonnet-4.5',
        max_tokens: 150,
        temperature: 0.8
      });

      const responseText = typeof response === 'object' ? response.text : response;
      const cleanResponse = String(responseText || '')
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .trim();

      if (cleanResponse) {
        await ctx.reply(cleanResponse);
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
   * Post to global Telegram channel/group
   * Used for automatic posting of generated media
   */
  async postGlobalMediaUpdate(opts = {}, services = {}) {
    try {
      this.logger?.debug?.('[TelegramService][globalPost] attempt', {
        mediaUrl: opts.mediaUrl,
        type: opts.type || 'image',
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
        this.logger?.warn?.('[TelegramService][globalPost] No global bot configured');
        _bump('no_bot', { mediaUrl: opts.mediaUrl });
        return null;
      }

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
        this.logger?.warn?.('[TelegramService][globalPost] No channel ID configured');
        _bump('no_channel', { mediaUrl: opts.mediaUrl });
        return null;
      }

      const { mediaUrl, text, type = 'image' } = opts;
      
      if (!mediaUrl || !/^https?:\/\//i.test(mediaUrl)) {
        this.logger?.warn?.('[TelegramService][globalPost] Invalid mediaUrl');
        _bump('invalid_media_url', { mediaUrl });
        return null;
      }

      // Rate limiting
      const now = Date.now();
      if (!this._globalRate) this._globalRate = { windowStart: now, count: 0 };
      
      const hourMs = 3600_000;
      if (now - this._globalRate.windowStart >= hourMs) {
        this._globalRate.windowStart = now;
        this._globalRate.count = 0;
      }

      const hourlyCap = Number(config?.rate?.hourly) || 10;
      const minIntervalSec = Number(config?.rate?.minIntervalSec) || 180;

      if (this._globalRate.lastPostedAt && (now - this._globalRate.lastPostedAt) < (minIntervalSec * 1000)) {
        const nextInMs = (minIntervalSec * 1000) - (now - this._globalRate.lastPostedAt);
        this.logger?.debug?.(`[TelegramService][globalPost] Min-interval gating: wait ${Math.ceil(nextInMs/1000)}s`);
        _bump('min_interval', { mediaUrl, minIntervalSec });
        return null;
      }

      if (this._globalRate.count >= hourlyCap) {
        this.logger?.debug?.(`[TelegramService][globalPost] Hourly cap reached (${hourlyCap})`);
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
        try {
          messageResult = await this.globalBot.telegram.sendVideo(channelId, { url: mediaUrl }, {
            caption,
            supports_streaming: true, // Enable streaming for better playback
          });
        } catch (videoErr) {
          // If video posting fails, try to send the thumbnail as fallback
          this.logger?.warn?.('[TelegramService][globalPost] Video post failed, trying photo fallback:', videoErr.message);
          
          // Try to extract thumbnail URL if available
          const thumbnailUrl = opts.thumbnailUrl || mediaUrl.replace(/\.mp4$/i, '.jpg');
          
          try {
            messageResult = await this.globalBot.telegram.sendPhoto(channelId, { url: thumbnailUrl }, {
              caption: caption + '\n\n⚠️ Full video available at source',
            });
            this.logger?.info?.('[TelegramService][globalPost] Posted thumbnail as fallback for video');
          } catch (fallbackErr) {
            this.logger?.error?.('[TelegramService][globalPost] Both video and fallback failed');
            throw videoErr; // Throw original error
          }
        }
      } else {
        messageResult = await this.globalBot.telegram.sendPhoto(channelId, { url: mediaUrl }, {
          caption,
        });
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
