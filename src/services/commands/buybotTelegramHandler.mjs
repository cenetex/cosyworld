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
      
      logger?.info?.(`[BuybotTelegram] /start command received, payload: ${startPayload || 'none'}`);
      
      if (startPayload && startPayload.startsWith('group_')) {
        // User came from a group via deep link - open settings for that group
        const encodedChannelId = startPayload.replace('group_', '');
        
        // Decode channel ID (convert 'n' prefix back to minus sign for negative IDs)
        const channelId = encodedChannelId.startsWith('n') 
          ? '-' + encodedChannelId.substring(1)
          : encodedChannelId;
        
        const userId = String(ctx.from.id);
        
        logger?.info?.(`[BuybotTelegram] Decoded channel ID: ${channelId} (from encoded: ${encodedChannelId})`);
        
        // Store the channelId for this user
        userChannels.set(userId, channelId);
        
        const trackedTokens = await buybotService.getTrackedTokens(channelId);
        
        logger?.info?.(`[BuybotTelegram] Found ${trackedTokens.length} tracked tokens for channel ${channelId}`);

        if (trackedTokens.length === 0) {
          await ctx.reply(
            '⚙️ <b>Buybot Settings</b>\n\n' +
            'No tokens are currently being tracked in your group.\n\n' +
            'Add your first token below:',
            {
              parse_mode: 'HTML',
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
        // Store tokens in user state to avoid callback_data length limits (64 bytes)
        userStates.set(userId, { 
          action: 'viewing_tokens', 
          channelId,
          tokens: trackedTokens 
        });
        
        const tokenButtons = trackedTokens.map((token, index) => ([
          { 
            text: `${token.tokenSymbol} - ${token.tokenName}`, 
            callback_data: `token_${index}` // Short format: just the index
          }
        ]));

        await ctx.reply(
          '⚙️ <b>Buybot Settings</b>\n\n' +
          `Managing ${trackedTokens.length} token${trackedTokens.length !== 1 ? 's' : ''} for your group.\n\n` +
          'Select a token to configure:',
          {
            parse_mode: 'HTML',
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
          '👋 <b>Welcome to Buybot!</b>\n\n' +
          '🤖 I track Solana token transactions and send real-time notifications.\n\n' +
          '💡 <b>To get started:</b>\n' +
          '1. Add me to your Telegram group\n' +
          '2. Type /settings in the group\n' +
          '3. Click the button to open settings here in DM\n' +
          '4. Add tokens to track\n\n' +
          '⚡ Powered by Helius\n\n' +
          'Type /help for more information.',
          { parse_mode: 'HTML' }
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
        
        logger?.info?.(`[BuybotTelegram] /settings in group, channel ID: ${groupChannelId}`);
        
        // Encode channel ID for deep link (replace minus sign with 'n' for negative)
        const encodedChannelId = groupChannelId.startsWith('-') 
          ? 'n' + groupChannelId.substring(1) 
          : groupChannelId;
        
        logger?.info?.(`[BuybotTelegram] Encoded channel ID: ${encodedChannelId}, deep link: https://t.me/${botUsername}?start=group_${encodedChannelId}`);
        
        // Store which group the user wants to manage
        userStates.set(userId, { 
          action: 'select_group', 
          channelId: groupChannelId,
          groupName: ctx.chat.title || 'this group'
        });
        
        await ctx.reply(
          '⚙️ <b>Settings are available in DM only</b>\n\n' +
          'For security and privacy, please configure buybot settings in a private message.\n\n' +
          `Click the button below to open settings for <b>${ctx.chat.title || 'this group'}</b>:`,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📱 Open Settings in DM', url: `https://t.me/${botUsername}?start=group_${encodedChannelId}` }]
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
          '⚙️ <b>Buybot Settings</b>\n\n' +
          'No tokens are currently being tracked in this chat.\n\n' +
          'To add tokens, use the button below or return to your group and add tokens there first.',
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '➕ Add Token', callback_data: 'add_token' }],
                [{ text: '❓ Help', callback_data: 'settings_help' }]
              ]
            }
          }
        );
        return;
      }

      // Store tokens in user state to avoid callback_data length limits
      userStates.set(userId, { 
        action: 'viewing_tokens', 
        channelId,
        tokens: trackedTokens 
      });
      
      const tokenButtons = trackedTokens.map((token, index) => ([
        { 
          text: `${token.tokenSymbol} - ${token.tokenName}`, 
          callback_data: `token_${index}` // Short format
        }
      ]));

      await ctx.reply(
        '⚙️ <b>Buybot Settings</b>\n\n' +
        `Managing ${trackedTokens.length} token${trackedTokens.length !== 1 ? 's' : ''} for this group.\n\n` +
        'Select a token to configure:',
        {
          parse_mode: 'HTML',
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
    const state = userStates.get(userId);

    try {
      // Acknowledge the callback immediately
      await ctx.answerCbQuery();

      if (data === 'settings_help') {
        await showHelpMenu(ctx);
      } else if (data === 'add_token') {
        // Get channelId from user state
        const channelId = state?.channelId || userChannels.get(userId) || String(ctx.chat.id);
        userStates.set(userId, { action: 'add_token', channelId });
        await ctx.reply(
          '➕ <b>Add Token</b>\n\n' +
          'Please send the Solana token address you want to track.\n\n' +
          '<b>Example:</b> <code>EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v</code>\n\n' +
          '⏱️ Send the address in your next message...',
          { parse_mode: 'HTML' }
        );
      } else if (data.startsWith('token_')) {
        // Format: token_<index> - look up from user state
        const index = parseInt(data.replace('token_', ''));
        if (!state || !state.tokens || !state.tokens[index]) {
          await ctx.reply('❌ Token not found. Please use /settings to refresh.');
          return;
        }
        const token = state.tokens[index];
        const channelId = state.channelId;
        await showTokenSettings(ctx, buybotService, channelId, token.tokenAddress, logger, userStates);
      } else if (data.startsWith('media_')) {
        // Format: media_<index>
        const index = parseInt(data.replace('media_', ''));
        if (!state || !state.tokens || !state.tokens[index]) {
          await ctx.reply('❌ Token not found. Please use /settings to refresh.');
          return;
        }
        const token = state.tokens[index];
        const channelId = state.channelId;
        userStates.set(userId, { action: 'set_media_thresholds', tokenAddress: token.tokenAddress, channelId });
        await ctx.reply(
          '🎬 <b>Media Thresholds</b>\n\n' +
          'Send two numbers separated by space:\n' +
          '<code>&lt;image_threshold&gt; &lt;video_threshold&gt;</code>\n\n' +
          '<b>Example:</b> <code>50 500</code>\n' +
          'This means: $50+ → image, $500+ → video\n\n' +
          '💡 Use <code>0 0</code> to disable auto-generation.',
          { parse_mode: 'HTML' }
        );
      } else if (data.startsWith('img_')) {
        // Format: img_<index>
        const index = parseInt(data.replace('img_', ''));
        if (!state || !state.tokens || !state.tokens[index]) {
          await ctx.reply('❌ Token not found. Please use /settings to refresh.');
          return;
        }
        const token = state.tokens[index];
        const channelId = state.channelId;
        userStates.set(userId, { action: 'upload_custom_image', tokenAddress: token.tokenAddress, channelId });
        await ctx.reply(
          '📸 <b>Upload Custom Image</b>\n\n' +
          'Send a photo to use for small purchases.\n\n' +
          '⏱️ Waiting for your image...',
          { parse_mode: 'HTML' }
        );
      } else if (data.startsWith('vid_')) {
        // Format: vid_<index>
        const index = parseInt(data.replace('vid_', ''));
        if (!state || !state.tokens || !state.tokens[index]) {
          await ctx.reply('❌ Token not found. Please use /settings to refresh.');
          return;
        }
        const token = state.tokens[index];
        const channelId = state.channelId;
        userStates.set(userId, { action: 'upload_custom_video', tokenAddress: token.tokenAddress, channelId });
        await ctx.reply(
          '🎬 <b>Upload Custom Video</b>\n\n' +
          'Send a video to use for small purchases.\n\n' +
          '⏱️ Waiting for your video...',
          { parse_mode: 'HTML' }
        );
      } else if (data.startsWith('remove_')) {
        // Format: remove_<index>
        const index = parseInt(data.replace('remove_', ''));
        if (!state || !state.tokens || !state.tokens[index]) {
          await ctx.reply('❌ Token not found. Please use /settings to refresh.');
          return;
        }
        const token = state.tokens[index];
        const channelId = state.channelId;
        const result = await buybotService.removeTrackedToken(channelId, token.tokenAddress);
        if (result.success) {
          await ctx.editMessageText(
            `✅ ${result.message}\n\nUse /settings to manage other tokens.`,
            { parse_mode: 'HTML' }
          );
        } else {
          await ctx.reply(`❌ ${result.message}`);
        }
      } else if (data === 'back_to_settings') {
        // Re-show settings menu using stored channelId
        const userId = String(ctx.from.id);
        const channelId = userChannels.get(userId) || String(ctx.chat.id);
        
        const trackedTokens = await buybotService.getTrackedTokens(channelId);
        
        // Update user state with fresh token list
        userStates.set(userId, { 
          action: 'viewing_tokens', 
          channelId,
          tokens: trackedTokens 
        });
        
        const tokenButtons = trackedTokens.map((token, index) => ([
          { 
            text: `${token.tokenSymbol} - ${token.tokenName}`, 
            callback_data: `token_${index}` 
          }
        ]));

        await ctx.editMessageText(
          '⚙️ <b>Buybot Settings</b>\n\n' +
          `Managing ${trackedTokens.length} token${trackedTokens.length !== 1 ? 's' : ''}.\n\n` +
          'Select a token to configure:',
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                ...tokenButtons,
                [{ text: '➕ Add Token', callback_data: 'add_token' }],
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
    if (!ctx.from) {
      return next();
    }
    const userId = String(ctx.from.id);
    const state = userStates.get(userId);

    if (!state) {
      try {
        return await next(); // Not in a flow, continue to other handlers
      } catch (err) {
        logger?.error('[BuybotTelegram] Error in downstream handler:', err);
        throw err; // Re-throw to let Telegraf global handler catch it
      }
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
            message += `<b>Address:</b> <code>${tokenAddress}</code>\n`;
            message += `<b>Decimals:</b> ${result.tokenInfo.decimals}\n\n`;
          }
          message += '🔔 You\'ll receive notifications when transactions occur!\n\n';
          message += 'Use /settings to configure media and thresholds.';
          await ctx.reply(message, { parse_mode: 'HTML' });
        } else {
          await ctx.reply(`❌ ${result.message}`);
        }
        userStates.delete(userId);

      } else if (state.action === 'set_media_thresholds') {
        const args = ctx.message.text.trim().split(/\s+/);
        if (args.length < 2) {
          await ctx.reply('❌ Please send two numbers: <code>&lt;image_threshold&gt; &lt;video_threshold&gt;</code>', { parse_mode: 'HTML' });
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
            `✅ <b>Media Thresholds Updated</b>\n\n` +
            `${result.message}\n\n` +
            `🖼️ Image: ${imageUsd > 0 ? '$' + imageUsd : 'Disabled'}\n` +
            `🎬 Video: ${videoUsd > 0 ? '$' + videoUsd : 'Disabled'}\n\n` +
            'Use /settings to configure other options.',
            { parse_mode: 'HTML' }
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
          `✅ <b>Custom Image Set</b>\n\n` +
          `${result.message}\n\n` +
          'This image will be sent for small purchases.\n\n' +
          'Use /settings to configure other options.',
          { parse_mode: 'HTML' }
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
          `✅ <b>Custom Video Set</b>\n\n` +
          `${result.message}\n\n` +
          'This video will be sent for small purchases.\n\n' +
          'Use /settings to configure other options.',
          { parse_mode: 'HTML' }
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
        '🤖 <b>Buybot Help</b>\n\n' +
        'Use /settings to manage all buybot configuration through an interactive menu.\n\n' +
        '⚙️ <b>What you can do:</b>\n' +
        '• Track Solana tokens\n' +
        '• Set media generation thresholds\n' +
        '• Upload custom celebration media\n' +
        '• View transaction notifications\n\n' +
        '💡 Just type /settings to get started!',
        { parse_mode: 'HTML' }
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
    '🤖 <b>Buybot Help</b>\n\n' +
    'Track Solana token purchases and transfers in real-time.\n\n' +
    '⚙️ <b>Using Settings:</b>\n' +
    '1. Use /settings to open the menu\n' +
    '2. Select a token to configure\n' +
    '3. Use buttons to manage settings\n\n' +
    '🎬 <b>Media Options:</b>\n' +
    '• <b>Auto-Generation:</b> AI creates images/videos for big buys\n' +
    '• <b>Custom Media:</b> Upload your own for small buys\n' +
    '• <b>Thresholds:</b> Control when auto-generation triggers\n\n' +
    '💰 <b>How It Works:</b>\n' +
  'Buybot checks for transactions every 2 minutes and sends notifications with:\n' +
    '• Transaction details and USD value\n' +
    '• Buyer information\n' +
    '• Market cap and links\n' +
    '• Celebratory media (when configured)\n\n' +
    '🪙 <b>Popular Tokens:</b>\n' +
    '• USDC: <code>EPjFW...Dt1v</code>\n' +
    '• BONK: <code>DezXA...B263</code>\n' +
    '• SOL: <code>So111...1112</code>\n\n' +
    '⚡ Powered by Helius';

  await ctx.editMessageText(helpMessage, {
    parse_mode: 'HTML',
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
 * @param {Map} userStates - User states map
 */
async function showTokenSettings(ctx, buybotService, channelId, tokenAddress, logger, userStates) {
  try {
    const userId = String(ctx.from.id);
    const trackedTokens = await buybotService.getTrackedTokens(channelId);
    const token = trackedTokens.find(t => t.tokenAddress === tokenAddress);
    const tokenIndex = trackedTokens.findIndex(t => t.tokenAddress === tokenAddress);

    if (!token || tokenIndex === -1) {
      await ctx.editMessageText('❌ Token not found or no longer tracked.');
      return;
    }
    
    // Update user state with current token list for button navigation
    userStates.set(userId, {
      action: 'viewing_token_settings',
      channelId,
      tokens: trackedTokens,
      currentTokenIndex: tokenIndex
    });

    const imageThreshold = token.mediaThresholds?.image || 100;
    const videoThreshold = token.mediaThresholds?.video || 1000;
    const hasCustomImage = !!token.customMedia?.image;
    const hasCustomVideo = !!token.customMedia?.video;

    const message =
      `⚙️ <b>${token.tokenSymbol} Settings</b>\n\n` +
      `<b>Name:</b> ${token.tokenName}\n` +
      `<b>Address:</b> <code>${tokenAddress}</code>\n\n` +
      `📊 <b>Current Configuration:</b>\n` +
      `🖼️ Image Threshold: ${imageThreshold > 0 ? '$' + imageThreshold : 'Disabled'}\n` +
      `🎬 Video Threshold: ${videoThreshold > 0 ? '$' + videoThreshold : 'Disabled'}\n` +
      `📸 Custom Image: ${hasCustomImage ? '✅ Set' : '❌ Not set'}\n` +
      `🎥 Custom Video: ${hasCustomVideo ? '✅ Set' : '❌ Not set'}\n\n` +
      `💡 <b>How it works:</b>\n` +
      `• Buys ≥ $${videoThreshold}: Auto-generate video\n` +
      `• Buys ≥ $${imageThreshold}: Auto-generate image\n` +
      `• Buys < $${imageThreshold}: ${hasCustomImage || hasCustomVideo ? 'Send custom media' : 'Text only'}`;

    const replyMarkup = {
      inline_keyboard: [
        [{ text: '🎬 Set Media Thresholds', callback_data: `media_${tokenIndex}` }],
        [
          { text: '📸 Upload Custom Image', callback_data: `img_${tokenIndex}` },
          { text: '🎥 Upload Custom Video', callback_data: `vid_${tokenIndex}` }
        ],
        [{ text: '🗑️ Remove Token', callback_data: `remove_${tokenIndex}` }],
        [{ text: '« Back to Settings', callback_data: 'back_to_settings' }]
      ]
    };

    const currentMessage = ctx.callbackQuery?.message;
    if (currentMessage) {
      const currentText = currentMessage.text ?? currentMessage.caption ?? '';
      const currentMarkupJson = currentMessage.reply_markup ? JSON.stringify(currentMessage.reply_markup) : null;
      const nextMarkupJson = JSON.stringify(replyMarkup);

      if (currentText === message && currentMarkupJson === nextMarkupJson) {
        logger?.debug('[BuybotTelegram] Token settings message already up to date; skipping edit.');
        return;
      }
    }

    try {
      await ctx.editMessageText(message, {
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      });
    } catch (editError) {
      // Telegram returns 400 when the message content and keyboard are unchanged – safely ignore
      if (String(editError)?.includes('message is not modified')) {
        logger?.debug('[BuybotTelegram] Telegram reported "message is not modified"; ignoring.');
        return;
      }
      throw editError;
    }
  } catch (error) {
    logger?.error('[BuybotTelegram] showTokenSettings error:', error);
    await ctx.reply('❌ An error occurred. Please try again.');
  }
}

export default setupBuybotTelegramCommands;
