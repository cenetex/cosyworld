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
  const userStates = new Map(); // userId -> { action, data }

  // /settings command - Interactive settings menu
  bot.command('settings', async (ctx) => {
    try {
      logger?.info?.('[BuybotTelegram] /settings command received');
      const channelId = String(ctx.chat.id);
      const trackedTokens = await buybotService.getTrackedTokens(channelId);

      if (trackedTokens.length === 0) {
        await ctx.reply(
          '⚙️ *Buybot Settings*\n\n' +
          'No tokens are currently being tracked.\n\n' +
          'Use the button below to add your first token!',
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '➕ Add Token', callback_data: 'settings_add_token' }],
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
          callback_data: `settings_token_${token.tokenAddress}` 
        }
      ]));

      await ctx.reply(
        '⚙️ *Buybot Settings*\n\n' +
        `Managing ${trackedTokens.length} token${trackedTokens.length !== 1 ? 's' : ''}.\n\n` +
        'Select a token to configure:',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              ...tokenButtons,
              [{ text: '➕ Add Token', callback_data: 'settings_add_token' }],
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
    const channelId = String(ctx.chat.id);
    const userId = String(ctx.from.id);

    try {
      // Acknowledge the callback immediately
      await ctx.answerCbQuery();

      if (data === 'settings_help') {
        await showHelpMenu(ctx);
      } else if (data === 'settings_add_token') {
        userStates.set(userId, { action: 'add_token', channelId });
        await ctx.reply(
          '➕ *Add Token*\n\n' +
          'Please send the Solana token address you want to track.\n\n' +
          '*Example:* `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`\n\n' +
          '⏱️ Send the address in your next message...',
          { parse_mode: 'Markdown' }
        );
      } else if (data.startsWith('settings_token_')) {
        const tokenAddress = data.replace('settings_token_', '');
        await showTokenSettings(ctx, buybotService, channelId, tokenAddress, logger);
      } else if (data.startsWith('token_media_')) {
        const tokenAddress = data.replace('token_media_', '');
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
        const tokenAddress = data.replace('token_custom_image_', '');
        userStates.set(userId, { action: 'upload_custom_image', tokenAddress, channelId });
        await ctx.reply(
          '📸 *Upload Custom Image*\n\n' +
          'Send a photo to use for small purchases.\n\n' +
          '⏱️ Waiting for your image...',
          { parse_mode: 'Markdown' }
        );
      } else if (data.startsWith('token_custom_video_')) {
        const tokenAddress = data.replace('token_custom_video_', '');
        userStates.set(userId, { action: 'upload_custom_video', tokenAddress, channelId });
        await ctx.reply(
          '🎬 *Upload Custom Video*\n\n' +
          'Send a video to use for small purchases.\n\n' +
          '⏱️ Waiting for your video...',
          { parse_mode: 'Markdown' }
        );
      } else if (data.startsWith('token_remove_')) {
        const tokenAddress = data.replace('token_remove_', '');
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
        // Re-show settings menu
        const trackedTokens = await buybotService.getTrackedTokens(channelId);
        const tokenButtons = trackedTokens.map(token => ([
          { 
            text: `${token.tokenSymbol} - ${token.tokenName}`, 
            callback_data: `settings_token_${token.tokenAddress}` 
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
                [{ text: '➕ Add Token', callback_data: 'settings_add_token' }],
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

  // /ca command - Show tracked tokens
  bot.command('ca', async (ctx) => {
    try {
      logger?.info?.('[BuybotTelegram] /ca command received');
      const channelId = String(ctx.chat.id);
      const trackedTokens = await buybotService.getTrackedTokens(channelId);

      if (trackedTokens.length === 0) {
        await ctx.reply(
          '📊 *Token Tracking*\n\n' +
          'No tokens are currently being tracked in this chat.\n\n' +
          'Use `/ca_add <token_address>` to start tracking a token.\n\n' +
          '*Example:* `/ca_add EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`\n\n' +
          '💡 *Commands:*\n' +
          '• `/ca_add <address>` - Track a token\n' +
          '• `/ca` or `/ca_list` - Show tracked tokens\n' +
          '• `/ca_remove <address>` - Stop tracking\n' +
          '• `/ca_help` - Show help\n\n' +
          '🪙 *Popular Tokens:*\n' +
          '• USDC: `EPjFW...Dt1v`\n' +
          '• BONK: `DezXA...kX6R`\n' +
          '• SOL: `So111...1112`',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // Format tracked tokens list
      let message = `📊 *Tracked Tokens*\n\nTracking ${trackedTokens.length} token${trackedTokens.length !== 1 ? 's' : ''} in this chat:\n\n`;

      for (const token of trackedTokens) {
        const addedTime = formatRelativeTime(token.addedAt);
        const lastEventTime = token.lastEventAt ? formatRelativeTime(token.lastEventAt) : 'None';

        message += `*${token.tokenSymbol}* - ${token.tokenName}\n`;
        message += `Address: \`${token.tokenAddress}\`\n`;
        message += `Added: ${addedTime}\n`;
        message += `Last Event: ${lastEventTime}\n\n`;
      }

      message += '💡 Use `/ca_add <address>` to track more tokens\n';
      message += '💡 Use `/ca_remove <address>` to stop tracking a token';

      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error) {
      logger?.error('[BuybotTelegram] /ca command error:', error);
      await ctx.reply('❌ An error occurred. Please try again.');
    }
  });

  // /ca_add command - Add a token to track
  bot.command('ca_add', async (ctx) => {
    try {
      logger?.info?.('[BuybotTelegram] /ca_add command received');
      const args = ctx.message.text.split(/\s+/).slice(1);
      const channelId = String(ctx.chat.id);

      if (args.length === 0) {
        await ctx.reply(
          '❌ Please provide a token address to track.\n\n' +
          '*Usage:* `/ca_add <token_address>`\n\n' +
          '*Example:* `/ca_add EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`\n\n' +
          '🪙 *Popular Tokens:*\n' +
          '• *USDC:* `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`\n' +
          '• *BONK:* `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263`\n' +
          '• *SOL:* `So11111111111111111111111111111111111111112`',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      const tokenAddress = args[0];

      await ctx.reply('⏳ Checking token...');

      const result = await buybotService.addTrackedToken(channelId, tokenAddress, 'telegram');

      if (result.success) {
        let message = `✅ *Token Tracking Added*\n\n${result.message}\n\n`;
        
        if (result.tokenInfo) {
          message += `*Address:* \`${tokenAddress}\`\n`;
          message += `*Decimals:* ${result.tokenInfo.decimals}\n\n`;
        }
        
        message += '🔔 You\'ll receive notifications when transactions occur!';

        await ctx.reply(message, { parse_mode: 'Markdown' });
      } else {
        await ctx.reply(`❌ ${result.message}`);
      }
    } catch (error) {
      logger?.error('[BuybotTelegram] /ca_add command error:', error);
      await ctx.reply('❌ An error occurred. Please try again.');
    }
  });

  // /ca_list command - Show tracked tokens
  bot.command('ca_list', async (ctx) => {
    try {
      // Just redirect to /ca with no args
      ctx.message.text = '/ca';
      await bot.handleUpdate({ message: ctx.message, update_id: ctx.update.update_id });
    } catch (error) {
      logger?.error('[BuybotTelegram] /ca_list command error:', error);
      await ctx.reply('❌ An error occurred. Please try again.');
    }
  });

  // /ca_remove command - Remove token
  bot.command('ca_remove', async (ctx) => {
    try {
      logger?.info?.('[BuybotTelegram] /ca_remove command received');
      const args = ctx.message.text.split(/\s+/).slice(1);

      if (args.length === 0) {
        await ctx.reply(
          '❌ Please provide a token address to remove.\n\n' +
          '*Usage:* `/ca_remove <token_address>`\n\n' +
          '*Example:* `/ca_remove EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      const tokenAddress = args[0];
      const channelId = String(ctx.chat.id);

      await ctx.reply('⏳ Removing token...');

      const result = await buybotService.removeTrackedToken(channelId, tokenAddress);

      if (result.success) {
        await ctx.reply(`✅ ${result.message}`);
      } else {
        await ctx.reply(`❌ ${result.message}`);
      }
    } catch (error) {
      logger?.error('[BuybotTelegram] /ca_remove command error:', error);
      await ctx.reply('❌ An error occurred. Please try again.');
    }
  });

  // /ca_help command - Show help
  bot.command('ca_help', async (ctx) => {
    try {
      logger?.info?.('[BuybotTelegram] /ca_help command received');
      const helpMessage =
        '🤖 *Buybot Help*\n\n' +
        'Track Solana token purchases and transfers in real-time using Helius.\n\n' +
        '📝 *Commands:*\n' +
        '• `/ca_add <address>` - Start tracking a token\n' +
        '• `/ca` or `/ca_list` - View tracked tokens\n' +
        '• `/ca_remove <address>` - Stop tracking\n' +
        '• `/ca_media <address> <image_$> <video_$>` - Set media thresholds\n' +
        '• `/ca_set_media <address> <image|video>` - Upload custom media\n' +
        '• `/ca_help` - Show this help\n\n' +
        '💰 *How It Works:*\n' +
        'Buybot checks for new transactions every 30 seconds and sends notifications when:\n' +
        '• Tokens are swapped/purchased 💰\n' +
        '• Tokens are transferred 📤\n\n' +
        '🎬 *Auto Media Generation:*\n' +
        'Configure when the bot automatically generates celebration media:\n' +
        '• Default: $100 → Image, $1000 → Video\n' +
        '• Example: `/ca_media <address> 50 500` (Image at $50, Video at $500)\n\n' +
        '📸 *Custom Media:*\n' +
        'Upload your own images or videos for smaller purchases:\n' +
        '• `/ca_set_media <address> image` then send a photo\n' +
        '• `/ca_set_media <address> video` then send a video\n' +
        '• Custom media is used for buys below auto-generation thresholds\n\n' +
        '🪙 *Popular Token Addresses:*\n' +
        '• *USDC:* `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`\n' +
        '• *BONK:* `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263`\n' +
        '• *SOL:* `So11111111111111111111111111111111111111112`\n\n' +
        '📖 *Example Usage:*\n' +
        '```\n/ca_add EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\n```\n' +
        'Starts tracking USDC in this chat.\n\n' +
        '⚡ Powered by Helius';

      await ctx.reply(helpMessage, { parse_mode: 'Markdown' });
    } catch (error) {
      logger?.error('[BuybotTelegram] /ca_help command error:', error);
      await ctx.reply('❌ An error occurred. Please try again.');
    }
  });

  // /ca_media command - Configure media generation thresholds
  bot.command('ca_media', async (ctx) => {
    try {
      logger?.info?.('[BuybotTelegram] /ca_media command received');
      const args = ctx.message.text.split(/\s+/).slice(1);
      const channelId = String(ctx.chat.id);

      if (args.length < 3) {
        await ctx.reply(
          '❌ Please provide token address and both thresholds.\n\n' +
          '*Usage:* `/ca_media <token_address> <image_threshold> <video_threshold>`\n\n' +
          '*Example:* `/ca_media EPjFW...Dt1v 50 500`\n' +
          'This sets: $50 → generate image, $500 → generate video\n\n' +
          '*Tip:* Set to 0 to disable (e.g., `/ca_media <address> 0 0`)',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      const [tokenAddress, imageThreshold, videoThreshold] = args;
      const imageUsd = parseFloat(imageThreshold);
      const videoUsd = parseFloat(videoThreshold);

      if (isNaN(imageUsd) || isNaN(videoUsd) || imageUsd < 0 || videoUsd < 0) {
        await ctx.reply('❌ Thresholds must be valid positive numbers.');
        return;
      }

      const result = await buybotService.setMediaThresholds(channelId, tokenAddress, imageUsd, videoUsd);

      if (result.success) {
        await ctx.reply(
          `✅ *Media Thresholds Updated*\n\n` +
          `${result.message}\n\n` +
          `🖼️ Image: ${imageUsd > 0 ? '$' + imageUsd : 'Disabled'}\n` +
          `🎬 Video: ${videoUsd > 0 ? '$' + videoUsd : 'Disabled'}`,
          { parse_mode: 'Markdown' }
        );
      } else {
        await ctx.reply(`❌ ${result.message}`);
      }
    } catch (error) {
      logger?.error('[BuybotTelegram] /ca_media command error:', error);
      await ctx.reply('❌ An error occurred. Please try again.');
    }
  });

  // /ca_set_media command - Upload custom media for smaller buys
  bot.command('ca_set_media', async (ctx) => {
    try {
      logger?.info?.('[BuybotTelegram] /ca_set_media command received');
      const args = ctx.message.text.split(/\s+/).slice(1);
      const channelId = String(ctx.chat.id);

      if (args.length < 2) {
        await ctx.reply(
          '❌ Please provide token address and media type.\n\n' +
          '*Usage:* `/ca_set_media <token_address> <image|video>`\n\n' +
          '*Example:* `/ca_set_media EPjFW...Dt1v image`\n' +
          'Then send a photo or video in your next message.\n\n' +
          '💡 This media will be used for buys below the auto-generation thresholds.',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      const [tokenAddress, mediaType] = args;

      if (!['image', 'video'].includes(mediaType.toLowerCase())) {
        await ctx.reply('❌ Media type must be either "image" or "video".');
        return;
      }

      const normalizedMediaType = mediaType.toLowerCase();

      // Verify token is tracked
      const trackedTokens = await buybotService.getTrackedTokens(channelId);
      const token = trackedTokens.find(t => t.tokenAddress === tokenAddress);

      if (!token) {
        await ctx.reply(
          `❌ Token \`${tokenAddress}\` is not tracked in this chat.\n\n` +
          'Use `/ca_add <address>` to track it first.',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // Send prompt and wait for media
      await ctx.reply(
        `📸 *Upload ${normalizedMediaType === 'image' ? 'Image' : 'Video'}*\n\n` +
        `Please send a ${normalizedMediaType} to use for small ${token.tokenSymbol} purchases.\n\n` +
        '⏱️ Waiting for your upload...',
        { parse_mode: 'Markdown' }
      );

      // Store pending upload state (you might want to use a proper session manager)
      // For now, we'll use a simple approach with a timeout
      const waitForMedia = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('timeout'));
        }, 60000); // 1 minute timeout

        const handler = async (mediaCtx) => {
          // Check if this is from the same user and chat
          if (mediaCtx.chat.id !== ctx.chat.id || mediaCtx.from.id !== ctx.from.id) {
            return;
          }

          let mediaUrl = null;

          if (normalizedMediaType === 'image' && mediaCtx.message.photo) {
            // Get the largest photo size
            const photo = mediaCtx.message.photo[mediaCtx.message.photo.length - 1];
            mediaUrl = photo.file_id;
          } else if (normalizedMediaType === 'video' && mediaCtx.message.video) {
            mediaUrl = mediaCtx.message.video.file_id;
          }

          if (mediaUrl) {
            clearTimeout(timeout);
            bot.off('message', handler);
            resolve({ mediaUrl, mediaCtx });
          }
        };

        bot.on('message', handler);
      });

      try {
        const { mediaUrl, mediaCtx } = await waitForMedia;

        // Save the custom media
        const result = await buybotService.setCustomMedia(channelId, tokenAddress, mediaUrl, normalizedMediaType);

        if (result.success) {
          await mediaCtx.reply(
            `✅ *Custom Media Set*\n\n` +
            `${result.message}\n\n` +
            `This ${normalizedMediaType} will be sent for ${token.tokenSymbol} purchases below your auto-generation thresholds.\n\n` +
            `💡 Current thresholds:\n` +
            `🖼️ Image: $${token.mediaThresholds?.image || 100}\n` +
            `🎬 Video: $${token.mediaThresholds?.video || 1000}`,
            { parse_mode: 'Markdown' }
          );
        } else {
          await mediaCtx.reply(`❌ ${result.message}`);
        }
      } catch (error) {
        if (error.message === 'timeout') {
          await ctx.reply('⏱️ Upload timed out. Please try again with `/ca_set_media <address> <type>`.');
        } else {
          throw error;
        }
      }
    } catch (error) {
      logger?.error('[BuybotTelegram] /ca_set_media command error:', error);
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
          [{ text: '🎬 Set Media Thresholds', callback_data: `token_media_${tokenAddress}` }],
          [
            { text: '📸 Upload Custom Image', callback_data: `token_custom_image_${tokenAddress}` },
            { text: '🎥 Upload Custom Video', callback_data: `token_custom_video_${tokenAddress}` }
          ],
          [{ text: '🗑️ Remove Token', callback_data: `token_remove_${tokenAddress}` }],
          [{ text: '« Back to Settings', callback_data: 'back_to_settings' }]
        ]
      }
    });
  } catch (error) {
    logger?.error('[BuybotTelegram] showTokenSettings error:', error);
    await ctx.reply('❌ An error occurred. Please try again.');
  }
}

/**
 * Format a date as relative time (e.g., "2 hours ago")
 * @param {Date} date - Date to format
 * @returns {string} Formatted relative time
 */
function formatRelativeTime(date) {
  const now = new Date();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days !== 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  return 'just now';
}

export default setupBuybotTelegramCommands;
