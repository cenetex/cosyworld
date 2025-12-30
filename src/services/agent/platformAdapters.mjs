/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Platform Adapters for UnifiedChatAgent
 * 
 * These adapters provide a unified interface for platform-specific operations
 * like sending messages, reactions, typing indicators, and media.
 */

/**
 * Base Platform Adapter interface
 * @interface
 */
export class BasePlatformAdapter {
  constructor({ logger }) {
    this.logger = logger;
  }

  /** Platform name for logging/debugging */
  get platform() {
    return 'base';
  }

  /** Start typing indicator, returns stop function */
  async startTyping() {
    return () => {};
  }

  /** Send a one-shot typing indicator */
  async sendTyping() {}

  /** Send a text message, returns message object with id */
  async sendMessage(_text) {
    throw new Error('Not implemented');
  }

  /** Reply to a specific message */
  async replyToMessage(_messageId, _text) {
    throw new Error('Not implemented');
  }

  /** React to a message with emoji */
  async react(_emoji, _messageId) {
    throw new Error('Not implemented');
  }

  /** Send an image with optional caption */
  async sendImage(_imageUrl, _caption) {
    throw new Error('Not implemented');
  }

  /** Send a video with optional caption */
  async sendVideo(_videoUrl, _caption) {
    throw new Error('Not implemented');
  }

  /** Format message text for the platform (markdown, html, etc.) */
  formatMessage(text) {
    return text;
  }
}

// ============================================================================
// Discord Adapter
// ============================================================================

/**
 * Discord Platform Adapter
 * Handles Discord-specific message operations
 */
export class DiscordPlatformAdapter extends BasePlatformAdapter {
  constructor({ logger, discordService, channel, message }) {
    super({ logger });
    this.discordService = discordService;
    this.channel = channel;
    this.message = message; // Original message for reply context
    this._typingInterval = null;
  }

  get platform() {
    return 'discord';
  }

  async startTyping() {
    if (!this.channel?.sendTyping) return () => {};
    
    try {
      await this.channel.sendTyping();
      // Discord typing lasts ~10s, refresh every 8s
      this._typingInterval = setInterval(() => {
        this.channel.sendTyping().catch(() => {});
      }, 8000);
      
      return () => {
        if (this._typingInterval) {
          clearInterval(this._typingInterval);
          this._typingInterval = null;
        }
      };
    } catch (error) {
      this.logger?.debug?.('[DiscordAdapter] Failed to start typing:', error.message);
      return () => {};
    }
  }

  async sendTyping() {
    try {
      if (this.channel?.sendTyping) {
        await this.channel.sendTyping();
      }
    } catch (error) {
      this.logger?.debug?.('[DiscordAdapter] sendTyping failed:', error.message);
    }
  }

  async sendMessage(text) {
    try {
      if (!this.channel?.send) {
        throw new Error('Channel does not support sending messages');
      }
      
      // Format for Discord (convert basic markdown)
      const formatted = this.formatMessage(text);
      
      // Discord has 2000 char limit per message
      const chunks = this._chunkMessage(formatted, 2000);
      let lastMessage = null;
      
      for (const chunk of chunks) {
        lastMessage = await this.channel.send(chunk);
      }
      
      return { id: lastMessage?.id, message: lastMessage };
    } catch (error) {
      this.logger?.error?.('[DiscordAdapter] sendMessage failed:', error);
      throw error;
    }
  }

  async replyToMessage(messageId, text) {
    try {
      // Try to fetch the target message and reply to it
      const targetMessage = await this.channel.messages.fetch(messageId).catch(() => null);
      
      if (targetMessage?.reply) {
        const formatted = this.formatMessage(text);
        const sent = await targetMessage.reply(formatted);
        return { id: sent?.id, message: sent };
      }
      
      // Fallback to regular message
      return this.sendMessage(text);
    } catch (error) {
      this.logger?.debug?.('[DiscordAdapter] replyToMessage failed, falling back:', error.message);
      return this.sendMessage(text);
    }
  }

  async react(emoji, messageId) {
    try {
      // Determine which message to react to
      let targetMessage = null;
      
      if (messageId) {
        targetMessage = await this.channel.messages.fetch(messageId).catch(() => null);
      } else if (this.message) {
        targetMessage = this.message;
      }
      
      if (!targetMessage?.react) {
        this.logger?.debug?.('[DiscordAdapter] No message to react to');
        return;
      }
      
      // Discord supports most emojis directly
      await targetMessage.react(emoji);
      this.logger?.debug?.(`[DiscordAdapter] Reacted with ${emoji} to message ${targetMessage.id}`);
    } catch (error) {
      this.logger?.warn?.('[DiscordAdapter] react failed:', error.message);
    }
  }

  async sendImage(imageUrl, caption) {
    try {
      if (!this.channel?.send) {
        throw new Error('Channel does not support sending messages');
      }
      
      // Discord can send images as embeds or attachments
      const sent = await this.channel.send({
        content: caption ? this.formatMessage(caption) : undefined,
        files: [imageUrl],
      });
      
      return { id: sent?.id, message: sent };
    } catch (error) {
      this.logger?.error?.('[DiscordAdapter] sendImage failed:', error);
      // Try to send as embed with URL
      try {
        const sent = await this.channel.send({
          content: caption || '🎨 Generated image',
          embeds: [{
            image: { url: imageUrl }
          }]
        });
        return { id: sent?.id, message: sent };
      } catch (embedError) {
        this.logger?.error?.('[DiscordAdapter] sendImage embed fallback failed:', embedError);
        throw error;
      }
    }
  }

  async sendVideo(videoUrl, caption) {
    try {
      if (!this.channel?.send) {
        throw new Error('Channel does not support sending messages');
      }
      
      const sent = await this.channel.send({
        content: caption ? this.formatMessage(caption) : '🎬 Generated video',
        files: [videoUrl],
      });
      
      return { id: sent?.id, message: sent };
    } catch (error) {
      this.logger?.error?.('[DiscordAdapter] sendVideo failed:', error);
      // Fallback to just sending the URL
      const sent = await this.channel.send({
        content: `${caption || '🎬 Generated video'}\n${videoUrl}`,
      });
      return { id: sent?.id, message: sent };
    }
  }

  formatMessage(text) {
    if (!text) return '';
    
    // Discord uses standard markdown, so mostly just pass through
    // Remove any HTML tags that might have been added
    let formatted = text
      .replace(/<b>/g, '**')
      .replace(/<\/b>/g, '**')
      .replace(/<i>/g, '*')
      .replace(/<\/i>/g, '*')
      .replace(/<code>/g, '`')
      .replace(/<\/code>/g, '`')
      .replace(/<pre>/g, '```')
      .replace(/<\/pre>/g, '```')
      .replace(/<[^>]+>/g, ''); // Strip any remaining HTML
    
    return formatted;
  }

  _chunkMessage(text, maxLength) {
    if (text.length <= maxLength) return [text];
    
    const chunks = [];
    let remaining = text;
    
    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }
      
      // Try to break at a newline or space
      let breakPoint = remaining.lastIndexOf('\n', maxLength);
      if (breakPoint === -1 || breakPoint < maxLength / 2) {
        breakPoint = remaining.lastIndexOf(' ', maxLength);
      }
      if (breakPoint === -1 || breakPoint < maxLength / 2) {
        breakPoint = maxLength;
      }
      
      chunks.push(remaining.slice(0, breakPoint));
      remaining = remaining.slice(breakPoint).trim();
    }
    
    return chunks;
  }
}

// ============================================================================
// Telegram Adapter
// ============================================================================

/**
 * Telegram Platform Adapter
 * Wraps Telegraf context for unified interface
 */
export class TelegramPlatformAdapter extends BasePlatformAdapter {
  constructor({ logger, ctx, telegramService }) {
    super({ logger });
    this.ctx = ctx;
    this.telegramService = telegramService;
    this._typingInterval = null;
  }

  get platform() {
    return 'telegram';
  }

  async startTyping() {
    try {
      await this.ctx.telegram.sendChatAction(this.ctx.chat.id, 'typing');
      
      this._typingInterval = setInterval(() => {
        this.ctx.telegram.sendChatAction(this.ctx.chat.id, 'typing').catch(() => {});
      }, 4000);
      
      return () => {
        if (this._typingInterval) {
          clearInterval(this._typingInterval);
          this._typingInterval = null;
        }
      };
    } catch (error) {
      this.logger?.debug?.('[TelegramAdapter] Failed to start typing:', error.message);
      return () => {};
    }
  }

  async sendTyping() {
    try {
      await this.ctx.telegram.sendChatAction(this.ctx.chat.id, 'typing');
    } catch (error) {
      this.logger?.debug?.('[TelegramAdapter] sendTyping failed:', error.message);
    }
  }

  async sendMessage(text) {
    try {
      const formatted = this.formatMessage(text);
      const sent = await this.ctx.reply(formatted, { parse_mode: 'HTML' });
      return { id: sent?.message_id, message: sent };
    } catch (error) {
      this.logger?.error?.('[TelegramAdapter] sendMessage failed:', error);
      throw error;
    }
  }

  async replyToMessage(messageId, text) {
    try {
      const formatted = this.formatMessage(text);
      const sent = await this.ctx.reply(formatted, {
        reply_to_message_id: messageId,
        parse_mode: 'HTML',
        allow_sending_without_reply: true,
      });
      return { id: sent?.message_id, message: sent };
    } catch (error) {
      this.logger?.debug?.('[TelegramAdapter] replyToMessage failed, falling back:', error.message);
      return this.sendMessage(text);
    }
  }

  async react(emoji, messageId) {
    const targetMessageId = messageId || this.ctx.message?.message_id;
    if (!targetMessageId) return;

    try {
      // Telegram has limited supported emojis - delegate to service for mapping
      const reactionEmoji = this._mapEmojiForTelegram(emoji);
      
      await this.ctx.telegram.setMessageReaction(
        this.ctx.chat.id,
        targetMessageId,
        [{ type: 'emoji', emoji: reactionEmoji }]
      );
      this.logger?.debug?.(`[TelegramAdapter] Reacted with ${reactionEmoji} to message ${targetMessageId}`);
    } catch (error) {
      this.logger?.warn?.('[TelegramAdapter] react failed:', error.message);
    }
  }

  async sendImage(imageUrl, caption) {
    try {
      const sent = await this.ctx.replyWithPhoto(imageUrl, {
        caption: caption ? this.formatMessage(caption) : undefined,
        parse_mode: 'HTML',
      });
      return { id: sent?.message_id, message: sent };
    } catch (error) {
      this.logger?.error?.('[TelegramAdapter] sendImage failed:', error);
      // Try document fallback
      try {
        const sent = await this.ctx.replyWithDocument(imageUrl, {
          caption: caption ? this.formatMessage(caption) : undefined,
          parse_mode: 'HTML',
        });
        return { id: sent?.message_id, message: sent };
      } catch (docError) {
        this.logger?.error?.('[TelegramAdapter] sendImage document fallback failed:', docError);
        throw error;
      }
    }
  }

  async sendVideo(videoUrl, caption) {
    try {
      const sent = await this.ctx.replyWithVideo(videoUrl, {
        caption: caption ? this.formatMessage(caption) : undefined,
        parse_mode: 'HTML',
        supports_streaming: true,
      });
      return { id: sent?.message_id, message: sent };
    } catch (error) {
      this.logger?.error?.('[TelegramAdapter] sendVideo failed:', error);
      throw error;
    }
  }

  formatMessage(text) {
    if (!text) return '';
    
    // Convert markdown to Telegram HTML
    // This is a simplified version - the full version is in telegram/utils.mjs
    let formatted = text
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.+?)\*/g, '<i>$1</i>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/```([\s\S]*?)```/g, '<pre>$1</pre>');
    
    // Escape HTML special chars in non-tag content
    // (simplified - a real implementation would be more careful)
    
    return formatted;
  }

  // Telegram supported reaction emojis (subset)
  static TELEGRAM_REACTION_EMOJIS = new Set([
    '👍', '👎', '❤️', '🔥', '🥰', '👏', '😁', '🤔', '🤯', '😱',
    '🤬', '😢', '🎉', '🤩', '🤮', '💩', '🙏', '👌', '🕊️', '🤡',
    '🥱', '🥴', '🐳', '❤️‍🔥', '🌚', '🌭', '💯', '🤣', '⚡️', '🍌',
    '🏆', '💔', '🤨', '😐', '😈', '😍', '👻', '👨‍💻', '👀', '🎃',
    '💅', '🙈', '👊', '🤝', '✍️', '🤗', '🫡', '🎅', '🎄', '☃️',
    '🥷', '😘', '😋', '😂', '🤷', '🥳',
  ]);

  static EMOJI_FALLBACK_MAP = {
    '🚀': '🔥', '🌟': '❤️', '✨': '🔥', '🐀': '🥰', '💰': '💯',
    '💸': '💯', '💎': '🔥', '😎': '👍', '🤙': '👍', '✌️': '👍',
    '👋': '👍', '👑': '💯', '💥': '🔥', '🌈': '❤️', '🤖': '👨‍💻',
    '💪': '👊', '🙌': '👏', '😊': '😁', '😄': '😁', '💀': '😂',
  };

  _mapEmojiForTelegram(emoji) {
    if (TelegramPlatformAdapter.TELEGRAM_REACTION_EMOJIS.has(emoji)) {
      return emoji;
    }
    return TelegramPlatformAdapter.EMOJI_FALLBACK_MAP[emoji] || '👍';
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a Discord adapter from a Discord message event
 */
export function createDiscordAdapter({ logger, discordService, message }) {
  return new DiscordPlatformAdapter({
    logger,
    discordService,
    channel: message.channel,
    message,
  });
}

/**
 * Create a Telegram adapter from a Telegraf context
 */
export function createTelegramAdapter({ logger, telegramService, ctx }) {
  return new TelegramPlatformAdapter({
    logger,
    telegramService,
    ctx,
  });
}
