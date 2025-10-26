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
        '• `/ca_help` - Show this help\n\n' +
        '💰 *How It Works:*\n' +
        'Buybot checks for new transactions every 30 seconds and sends notifications when:\n' +
        '• Tokens are swapped/purchased 💰\n' +
        '• Tokens are transferred 📤\n\n' +
        '🎬 *Auto Media Generation:*\n' +
        'Configure when the bot automatically generates celebration media:\n' +
        '• Default: $100 → Image, $1000 → Video\n' +
        '• Example: `/ca_media <address> 50 500` (Image at $50, Video at $500)\n\n' +
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

  logger?.info('[BuybotTelegram] Commands registered successfully');
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
