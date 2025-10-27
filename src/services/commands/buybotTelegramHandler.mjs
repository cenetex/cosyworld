/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Buybot Telegram Command Handler
 * Handles /ca, /ca_remove, and /ca_list commands for Telegram
 */

/**
 * Setup buybot commands for Telegram bot
 * @param {Object} bot - Telegraf bot instance
 * @param {Object} services - Services container
 */
export function setupBuybotTelegramCommands(bot, services) {
  const { buybotService, logger } = services;

  if (!buybotService) {
    logger?.warn('[BuybotTelegram] BuybotService not available');
    return;
  }

  // State management for interactive flows
  const userStates = new Map(); // userId -> { action, data, channelId }
  const userChannels = new Map(); // userId -> last channelId they were managing

  // /start command - Handle deep links from groups
  bot.command('start', async (ctx) => {
    try {
      const startPayload = ctx.message.text.split(' ')[1];
      
      if (startPayload && startPayload.startsWith('group_')) {
        // User came from a group via deep link - open settings for that group
        const channelId = startPayload.replace('group_', '');
        const userId = String(ctx.from.id);
        
        logger?.info?.(`[BuybotTelegram] /start with group context: ${channelId}`);
        
        // Store the channelId for this user
        userChannels.set(userId, channelId);
        
        const trackedTokens = await buybotService.getTrackedTokens(channelId);

        if (trackedTokens.length === 0) {
          await ctx.reply(
            '⚙️ *Buybot Settings*\n\n' +
            'No tokens are currently being tracked in your group.\n\n' +
            'Add your first token below:',
            {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '➕ Add Token', callback_data: `settings_add_token_${channelId}` }],
                  [{ text: '❓ Help', callback_data: 'settings_help' }]
                ]
              }
            }
          );
          return;
        }

        // Show main settings menu with tracked tokens
        const tokenButtons = trackedTokens.map(token => ([
          { 
            text: `${token.tokenSymbol} - ${token.tokenName}`, 
            callback_data: `settings_token_${token.tokenAddress}_${channelId}` 
          }
        ]));

        await ctx.reply(
          '⚙️ *Buybot Settings*\n\n' +
          `Managing ${trackedTokens.length} token${trackedTokens.length !== 1 ? 's' : ''} for your group.\n\n` +
          'Select a token to configure:',
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                ...tokenButtons,
                [{ text: '➕ Add Token', callback_data: `settings_add_token_${channelId}` }],
                [{ text: '❓ Help', callback_data: 'settings_help' }]
              ]
            }
          }
        );
      } else {
        // Regular /start without deep link - show welcome message
        await ctx.reply(
          '👋 *Welcome to Buybot!*\n\n' +
          '🤖 I track Solana token transactions and send real-time notifications.\n\n' +
          '💡 *To get started:*\n' +
          '1. Add me to your Telegram group\n' +
          '2. Type /settings in the group\n' +
          '3. Click the button to open settings here in DM\n' +
          '4. Add tokens to track\n\n' +
          '⚡ Powered by Helius\n\n' +
          'Type /help for more information.',
          { parse_mode: 'Markdown' }
        );
      }
    } catch (error) {
      logger?.error('[BuybotTelegram] /start command error:', error);
      await ctx.reply('❌ An error occurred. Please try again.');
    }
  });

  // /settings command - Interactive settings menu (DM only)
  bot.command('settings', async (ctx) => {
    try {
      logger?.info?.('[BuybotTelegram] /settings command received');
      
      // Check if this is a private chat (DM)
      if (ctx.chat.type !== 'private') {
        // In a group/channel - save the channel context and redirect to DM
        const botUsername = ctx.botInfo.username;
        const userId = String(ctx.from.id);
        const groupChannelId = String(ctx.chat.id);
        
        // Store which group the user wants to manage
        userStates.set(userId, { 
          action: 'select_group', 
          channelId: groupChannelId,
          groupName: ctx.chat.title || 'this group'
        });
        
        await ctx.reply(
          '⚙️ *Settings are available in DM only*\n\n' +
          'For security and privacy, please configure buybot settings in a private message.\n\n' +
          `Click the button below to open settings for **${ctx.chat.title || 'this group'}**:`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📱 Open Settings in DM', url: `https://t.me/${botUsername}?start=group_${groupChannelId}` }]
              ]
            }
          }
        );
        return;
      }

      // We're in a DM - check if there's a deep link parameter (from group)
      let channelId = String(ctx.chat.id); // Default to DM channel
      const userId = String(ctx.from.id);
      const startPayload = ctx.message.text.split(' ')[1];
      if (startPayload && startPayload.startsWith('group_')) {
        channelId = startPayload.replace('group_', '');
        logger?.info?.(`[BuybotTelegram] Managing settings for group ${channelId} via DM`);
      }
      
      // Store the channelId for this user
      userChannels.set(userId, channelId);
      
      const trackedTokens = await buybotService.getTrackedTokens(channelId);

      if (trackedTokens.length === 0) {
        await ctx.reply(
          '⚙️ *Buybot Settings*\n\n' +
          'No tokens are currently being tracked in this chat.\n\n' +
          'To add tokens, use the button below or return to your group and add tokens there first.',
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '➕ Add Token', callback_data: `settings_add_token_${channelId}` }],
                [{ text: '❓ Help', callback_data: 'settings_help' }]
              ]
            }
          }
        );
        return;
      }

      // Show main settings menu with tracked tokens
      const tokenButtons = trackedTokens.map(token => ([
        { 
          text: `${token.tokenSymbol} - ${token.tokenName}`, 
          callback_data: `settings_token_${token.tokenAddress}_${channelId}` 
        }
      ]));

      await ctx.reply(
        '⚙️ *Buybot Settings*\n\n' +
        `Managing ${trackedTokens.length} token${trackedTokens.length !== 1 ? 's' : ''} for this group.\n\n` +
        'Select a token to configure:',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              ...tokenButtons,
              [{ text: '➕ Add Token', callback_data: `settings_add_token_${channelId}` }],
              [{ text: '❓ Help', callback_data: 'settings_help' }]
            ]
          }
        }
      );
    } catch (error) {
      logger?.error('[BuybotTelegram] /settings command error:', error);
      await ctx.reply('❌ An error occurred. Please try again.');
    }
  });

  // Handle callback queries (button presses)
  bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const userId = String(ctx.from.id);

    try {
      // Acknowledge the callback immediately
      await ctx.answerCbQuery();

      if (data === 'settings_help') {
        await showHelpMenu(ctx);
      } else if (data.startsWith('settings_add_token_')) {
        const channelId = data.replace('settings_add_token_', '');
        userStates.set(userId, { action: 'add_token', channelId });
        await ctx.reply(
          '➕ *Add Token*\n\n' +
          'Please send the Solana token address you want to track.\n\n' +
          '*Example:* `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`\n\n' +
          '⏱️ Send the address in your next message...',
          { parse_mode: 'Markdown' }
        );
      } else if (data.startsWith('settings_token_')) {
        // Format: settings_token_<address>_<channelId>
        const parts = data.replace('settings_token_', '').split('_');
        const channelId = parts.pop(); // Last part is channelId
        const tokenAddress = parts.join('_'); // Rest is token address
        await showTokenSettings(ctx, buybotService, channelId, tokenAddress, logger);
      } else if (data.startsWith('token_media_')) {
        // Format: token_media_<address>_<channelId>
        const parts = data.replace('token_media_', '').split('_');
        const channelId = parts.pop();
        const tokenAddress = parts.join('_');
        userStates.set(userId, { action: 'set_media_thresholds', tokenAddress, channelId });
        await ctx.reply(
          '🎬 *Media Thresholds*\n\n' +
          'Send two numbers separated by space:\n' +
          '`<image_threshold> <video_threshold>`\n\n' +
          '*Example:* `50 500`\n' +
          'This means: $50+ → image, $500+ → video\n\n' +
          '💡 Use `0 0` to disable auto-generation.',
          { parse_mode: 'Markdown' }
        );
      } else if (data.startsWith('token_custom_image_')) {
        const parts = data.replace('token_custom_image_', '').split('_');
        const channelId = parts.pop();
        const tokenAddress = parts.join('_');
        userStates.set(userId, { action: 'upload_custom_image', tokenAddress, channelId });
        await ctx.reply(
          '📸 *Upload Custom Image*\n\n' +
          'Send a photo to use for small purchases.\n\n' +
          '⏱️ Waiting for your image...',
          { parse_mode: 'Markdown' }
        );
      } else if (data.startsWith('token_custom_video_')) {
        const parts = data.replace('token_custom_video_', '').split('_');
        const channelId = parts.pop();
        const tokenAddress = parts.join('_');
        userStates.set(userId, { action: 'upload_custom_video', tokenAddress, channelId });
        await ctx.reply(
          '🎬 *Upload Custom Video*\n\n' +
          'Send a video to use for small purchases.\n\n' +
          '⏱️ Waiting for your video...',
          { parse_mode: 'Markdown' }
        );
      } else if (data.startsWith('token_remove_')) {
        const parts = data.replace('token_remove_', '').split('_');
        const channelId = parts.pop();
        const tokenAddress = parts.join('_');
        const result = await buybotService.removeTrackedToken(channelId, tokenAddress);
        if (result.success) {
          await ctx.editMessageText(
            `✅ ${result.message}\n\nUse /settings to manage other tokens.`,
            { parse_mode: 'Markdown' }
          );
        } else {
          await ctx.reply(`❌ ${result.message}`);
        }
      } else if (data === 'back_to_settings') {
        // Re-show settings menu using stored channelId
        const userId = String(ctx.from.id);
        const channelId = userChannels.get(userId) || String(ctx.chat.id);
        
        const trackedTokens = await buybotService.getTrackedTokens(channelId);
        const tokenButtons = trackedTokens.map(token => ([
          { 
            text: `${token.tokenSymbol} - ${token.tokenName}`, 
            callback_data: `settings_token_${token.tokenAddress}_${channelId}` 
          }
        ]));

        await ctx.editMessageText(
          '⚙️ *Buybot Settings*\n\n' +
          `Managing ${trackedTokens.length} token${trackedTokens.length !== 1 ? 's' : ''}.\n\n` +
          'Select a token to configure:',
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                ...tokenButtons,
                [{ text: '➕ Add Token', callback_data: `settings_add_token_${channelId}` }],
                [{ text: '❓ Help', callback_data: 'settings_help' }]
              ]
            }
          }
        );
      }
    } catch (error) {
      logger?.error('[BuybotTelegram] Callback query error:', error);
      await ctx.reply('❌ An error occurred. Please try again.');
    }
  });

  // Handle text messages for interactive flows
  bot.on('text', async (ctx, next) => {
    const userId = String(ctx.from.id);
    const state = userStates.get(userId);

    if (!state) {
      return next(); // Not in a flow, continue to other handlers
    }

    const channelId = state.channelId;

    try {
      if (state.action === 'add_token') {
        const tokenAddress = ctx.message.text.trim();
        await ctx.reply('⏳ Checking token...');
        const result = await buybotService.addTrackedToken(channelId, tokenAddress, 'telegram');
        
        if (result.success) {
          let message = `✅ *Token Added*\n\n${result.message}\n\n`;
          if (result.tokenInfo) {
            message += `*Address:* \`${tokenAddress}\`\n`;
            message += `*Decimals:* ${result.tokenInfo.decimals}\n\n`;
          }
          message += '🔔 You\'ll receive notifications when transactions occur!\n\n';
          message += 'Use /settings to configure media and thresholds.';
          await ctx.reply(message, { parse_mode: 'Markdown' });
        } else {
          await ctx.reply(`❌ ${result.message}`);
        }
        userStates.delete(userId);

      } else if (state.action === 'set_media_thresholds') {
        const args = ctx.message.text.trim().split(/\s+/);
        if (args.length < 2) {
          await ctx.reply('❌ Please send two numbers: `<image_threshold> <video_threshold>`', { parse_mode: 'Markdown' });
          return;
        }

        const imageUsd = parseFloat(args[0]);
        const videoUsd = parseFloat(args[1]);

        if (isNaN(imageUsd) || isNaN(videoUsd) || imageUsd < 0 || videoUsd < 0) {
          await ctx.reply('❌ Both values must be valid positive numbers.');
          return;
        }

        const result = await buybotService.setMediaThresholds(channelId, state.tokenAddress, imageUsd, videoUsd);
        
        if (result.success) {
          await ctx.reply(
            `✅ *Media Thresholds Updated*\n\n` +
            `${result.message}\n\n` +
            `🖼️ Image: ${imageUsd > 0 ? '$' + imageUsd : 'Disabled'}\n` +
            `🎬 Video: ${videoUsd > 0 ? '$' + videoUsd : 'Disabled'}\n\n` +
            'Use /settings to configure other options.',
            { parse_mode: 'Markdown' }
          );
        } else {
          await ctx.reply(`❌ ${result.message}`);
        }
        userStates.delete(userId);
      }
    } catch (error) {
      logger?.error('[BuybotTelegram] Text handler error:', error);
      await ctx.reply('❌ An error occurred. Please try again.');
      userStates.delete(userId);
    }
  });

  // Handle photo uploads for custom media
  bot.on('photo', async (ctx) => {
    const userId = String(ctx.from.id);
    const state = userStates.get(userId);

    if (!state || state.action !== 'upload_custom_image') return;

    try {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const result = await buybotService.setCustomMedia(state.channelId, state.tokenAddress, photo.file_id, 'image');
      
      if (result.success) {
        await ctx.reply(
          `✅ *Custom Image Set*\n\n` +
          `${result.message}\n\n` +
          'This image will be sent for small purchases.\n\n' +
          'Use /settings to configure other options.',
          { parse_mode: 'Markdown' }
        );
      } else {
        await ctx.reply(`❌ ${result.message}`);
      }
      userStates.delete(userId);
    } catch (error) {
      logger?.error('[BuybotTelegram] Photo upload error:', error);
      await ctx.reply('❌ An error occurred. Please try again.');
      userStates.delete(userId);
    }
  });

  // Handle video uploads for custom media
  bot.on('video', async (ctx) => {
    const userId = String(ctx.from.id);
    const state = userStates.get(userId);

    if (!state || state.action !== 'upload_custom_video') return;

    try {
      const result = await buybotService.setCustomMedia(state.channelId, state.tokenAddress, ctx.message.video.file_id, 'video');
      
      if (result.success) {
        await ctx.reply(
          `✅ *Custom Video Set*\n\n` +
          `${result.message}\n\n` +
          'This video will be sent for small purchases.\n\n' +
          'Use /settings to configure other options.',
          { parse_mode: 'Markdown' }
        );
      } else {
        await ctx.reply(`❌ ${result.message}`);
      }
      userStates.delete(userId);
    } catch (error) {
      logger?.error('[BuybotTelegram] Video upload error:', error);
      await ctx.reply('❌ An error occurred. Please try again.');
      userStates.delete(userId);
    }
  });

  // /help command - Quick help reference
  bot.command('help', async (ctx) => {
    try {
      logger?.info?.('[BuybotTelegram] /help command received');
      await ctx.reply(
        '� *Buybot Help*\n\n' +
        'Use /settings to manage all buybot configuration through an interactive menu.\n\n' +
        '⚙️ *What you can do:*\n' +
        '• Track Solana tokens\n' +
        '• Set media generation thresholds\n' +
        '• Upload custom celebration media\n' +
        '• View transaction notifications\n\n' +
        '💡 Just type /settings to get started!',
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      logger?.error('[BuybotTelegram] /help command error:', error);
      await ctx.reply('❌ An error occurred. Please try again.');
    }
  });

  logger?.info('[BuybotTelegram] Commands registered successfully');
}

/**
 * Show help menu with back button
 * @param {Object} ctx - Telegram context
 */
async function showHelpMenu(ctx) {
  const helpMessage =
    '🤖 *Buybot Help*\n\n' +
    'Track Solana token purchases and transfers in real-time.\n\n' +
    '⚙️ *Using Settings:*\n' +
    '1. Use /settings to open the menu\n' +
    '2. Select a token to configure\n' +
    '3. Use buttons to manage settings\n\n' +
    '🎬 *Media Options:*\n' +
    '• *Auto-Generation:* AI creates images/videos for big buys\n' +
    '• *Custom Media:* Upload your own for small buys\n' +
    '• *Thresholds:* Control when auto-generation triggers\n\n' +
    '💰 *How It Works:*\n' +
    'Buybot checks for transactions every 30 seconds and sends notifications with:\n' +
    '• Transaction details and USD value\n' +
    '• Buyer information\n' +
    '• Market cap and links\n' +
    '• Celebratory media (when configured)\n\n' +
    '🪙 *Popular Tokens:*\n' +
    '• USDC: `EPjFW...Dt1v`\n' +
    '• BONK: `DezXA...B263`\n' +
    '• SOL: `So111...1112`\n\n' +
    '⚡ Powered by Helius';

  await ctx.editMessageText(helpMessage, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '« Back to Settings', callback_data: 'back_to_settings' }]
      ]
    }
  });
}

/**
 * Show settings menu for a specific token
 * @param {Object} ctx - Telegram context
 * @param {Object} buybotService - Buybot service instance
 * @param {string} channelId - Channel ID
 * @param {string} tokenAddress - Token address
 * @param {Object} logger - Logger instance
 */
async function showTokenSettings(ctx, buybotService, channelId, tokenAddress, logger) {
  try {
    const trackedTokens = await buybotService.getTrackedTokens(channelId);
    const token = trackedTokens.find(t => t.tokenAddress === tokenAddress);

    if (!token) {
      await ctx.editMessageText('❌ Token not found or no longer tracked.');
      return;
    }

    const imageThreshold = token.mediaThresholds?.image || 100;
    const videoThreshold = token.mediaThresholds?.video || 1000;
    const hasCustomImage = !!token.customMedia?.image;
    const hasCustomVideo = !!token.customMedia?.video;

    const message =
      `⚙️ *${token.tokenSymbol} Settings*\n\n` +
      `*Name:* ${token.tokenName}\n` +
      `*Address:* \`${tokenAddress}\`\n\n` +
      `📊 *Current Configuration:*\n` +
      `🖼️ Image Threshold: ${imageThreshold > 0 ? '$' + imageThreshold : 'Disabled'}\n` +
      `🎬 Video Threshold: ${videoThreshold > 0 ? '$' + videoThreshold : 'Disabled'}\n` +
      `📸 Custom Image: ${hasCustomImage ? '✅ Set' : '❌ Not set'}\n` +
      `🎥 Custom Video: ${hasCustomVideo ? '✅ Set' : '❌ Not set'}\n\n` +
      `💡 *How it works:*\n` +
      `• Buys ≥ $${videoThreshold}: Auto-generate video\n` +
      `• Buys ≥ $${imageThreshold}: Auto-generate image\n` +
      `• Buys < $${imageThreshold}: ${hasCustomImage || hasCustomVideo ? 'Send custom media' : 'Text only'}`;

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎬 Set Media Thresholds', callback_data: `token_media_${tokenAddress}_${channelId}` }],
          [
            { text: '📸 Upload Custom Image', callback_data: `token_custom_image_${tokenAddress}_${channelId}` },
            { text: '🎥 Upload Custom Video', callback_data: `token_custom_video_${tokenAddress}_${channelId}` }
          ],
          [{ text: '🗑️ Remove Token', callback_data: `token_remove_${tokenAddress}_${channelId}` }],
          [{ text: '« Back to Settings', callback_data: 'back_to_settings' }]
        ]
      }
    });
  } catch (error) {
    logger?.error('[BuybotTelegram] showTokenSettings error:', error);
    await ctx.reply('❌ An error occurred. Please try again.');
  }
}

export default setupBuybotTelegramCommands;
