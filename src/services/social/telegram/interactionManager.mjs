/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Telegram Interaction Manager
 * Handles user interactions, progress updates, and message sending
 */

export class InteractionManager {
  constructor({ logger }) {
    this.logger = logger;
  }

  /**
   * Update or create a progress message
   * @param {Object} ctx Telegraf context
   * @param {number|null} messageId Existing message ID or null
   * @param {string} text Message text
   * @param {string} channelId Channel ID
   * @returns {Promise<number|null>} Message ID
   */
  async updateProgressMessage(ctx, messageId, text, channelId, options = {}) {
    const parseMode = options.parseMode ?? 'HTML';
    const extra = { parse_mode: parseMode, disable_web_page_preview: true };

    try {
      if (messageId) {
        try {
          // Try to edit existing message
          await ctx.telegram.editMessageText(channelId, messageId, null, text, extra);
          return messageId;
        } catch (error) {
          // If edit fails (e.g. message deleted, or content same), ignore or send new
          if (error.description && error.description.includes('message is not modified')) {
            return messageId;
          }
          this.logger?.debug?.(`[InteractionManager] Failed to edit progress message: ${error.message}`);
          // Fall through to send new message
        }
      }
      
      // Send new message
      const msg = await ctx.reply(text, extra);
      return msg.message_id;
    } catch (error) {
      this.logger?.error?.(`[InteractionManager] Failed to update progress message in ${channelId}:`, error);
      return messageId;
    }
  }

  /**
   * Delete a progress message
   * @param {Object} ctx Telegraf context
   * @param {number} messageId Message ID
   * @param {string} channelId Channel ID
   */
  async deleteProgressMessage(ctx, messageId, channelId) {
    if (!messageId) return;
    try {
      await ctx.telegram.deleteMessage(channelId, messageId);
    } catch (error) {
      this.logger?.debug?.(`[InteractionManager] Failed to delete progress message in ${channelId}:`, error.message);
    }
  }
}
