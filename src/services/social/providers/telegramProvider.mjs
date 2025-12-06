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

  async connectAvatar(avatarId, credentials) {
    const { token } = credentials;
    if (!token) throw new Error('Telegram token required');

    try {
      const bot = new Telegraf(token);
      
      // Verify token
      const botInfo = await bot.telegram.getMe();
      this.logger.info(`Connected Telegram bot for avatar ${avatarId}: @${botInfo.username}`);

      // Store bot instance
      this.bots.set(avatarId, bot);

      // Setup basic handlers (start, help, etc.)
      this._setupBotHandlers(bot, avatarId);

      // Launch bot
      // Note: In production, we might want to use webhooks instead of polling
      bot.launch();

      return {
        username: botInfo.username,
        id: botInfo.id
      };
    } catch (error) {
      this.logger.error(`Failed to connect Telegram bot for avatar ${avatarId}:`, error);
      throw error;
    }
  }

  async disconnectAvatar(avatarId) {
    const bot = this.bots.get(avatarId);
    if (bot) {
      bot.stop('Manual disconnect');
      this.bots.delete(avatarId);
      this.logger.info(`Disconnected Telegram bot for avatar ${avatarId}`);
    }
  }

  async post(avatarId, content) {
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
