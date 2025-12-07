/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { BaseSocialProvider } from './baseSocialProvider.mjs';
import { Telegraf } from 'telegraf';

export class TelegramProvider extends BaseSocialProvider {
  constructor(service) {
    super(service, 'telegram');
    this.bots = new Map(); // avatarId -> Telegraf instance
  }

  async initialize() {
    this.logger.info('Initializing TelegramProvider...');
    // TODO: Load existing bots from DB
  }

  async connectAvatar(avatarId, credentials, options = {}) {
    const { token } = credentials;
    if (!token) throw new Error('Telegram token required');

    // Ensure prior bot is stopped before reconnecting
    await this.disconnectAvatar(avatarId, { reason: 'reconnect' });

    try {
      const bot = new Telegraf(token);

      // Verify token
      const botInfo = await bot.telegram.getMe();
      this.logger.info(`Connected Telegram bot for avatar ${avatarId}: @${botInfo.username}`);

      // Store bot instance
      this.bots.set(avatarId, bot);

      // Setup basic handlers (start, help, etc.)
      this._setupBotHandlers(bot, avatarId);

      await bot.launch({ dropPendingUpdates: true });

      return {
        username: botInfo.username,
        id: botInfo.id,
        metadata: {
          firstName: botInfo.first_name,
          channelId: options.channelId || null,
        },
        channelId: options.channelId || null,
      };
    } catch (error) {
      this.logger.error(`Failed to connect Telegram bot for avatar ${avatarId}:`, error);
      throw error;
    }
  }

  async disconnectAvatar(avatarId, options = {}) {
    const bot = this.bots.get(avatarId);
    if (!bot) return;

    try {
      bot.stop(options.reason || 'Manual disconnect');
    } finally {
      this.bots.delete(avatarId);
      this.logger.info(`Disconnected Telegram bot for avatar ${avatarId}`);
    }
  }

  async post(_avatarId, _content) {
    // TODO: Implement posting logic
    throw new Error('Not implemented');
  }

  _setupBotHandlers(bot, avatarId) {
    bot.start((ctx) => ctx.reply('Hello! I am an AI avatar.'));
    
    bot.on('text', async (ctx) => {
      try {
        // TODO: Delegate to AI service via SocialPlatformService
        // const response = await this.service.handleMessage(avatarId, ctx.message.text);
        // ctx.reply(response);
        ctx.reply('I received your message, but I am not yet connected to my brain.');
      } catch (error) {
        this.logger.error(`Error handling message for avatar ${avatarId}:`, error);
      }
    });
  }
}
