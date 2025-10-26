/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Buybot Command Handler
 * Handles !ca, !ca-remove, and !ca-list commands for token tracking
 * Also supports /ca variants
 */

/**
 * Handle buybot commands
 * @param {Object} message - Discord message object
 * @param {Object} services - Services container
 * @returns {Promise<boolean>} True if command was handled
 */
export async function handleBuybotCommands(message, services) {
  const { buybotService, discordService, logger } = services;

  if (!buybotService) {
    logger?.warn('[BuybotCommands] BuybotService not available');
    return false;
  }

  const content = message.content.trim();
  const parts = content.split(/\s+/);
  const rawCommand = parts[0].toLowerCase();
  
  // Support both ! and / prefixes
  const command = rawCommand.replace(/^[!/]/, '');

  try {
    // ca <token_address> - Add token to track
    if (command === 'ca' && parts.length >= 2) {
      const tokenAddress = parts[1];
      
      await discordService.reactToMessage(message, '⏳');
      
      const result = await buybotService.addTrackedToken(message.channel.id, tokenAddress, 'discord');
      
      if (result.success) {
        await discordService.reactToMessage(message, '✅');
        
        const embed = {
          title: '✅ Token Tracking Added',
          description: result.message,
          color: 0x00ff00,
          fields: result.tokenInfo ? [
            {
              name: 'Token Address',
              value: `\`${tokenAddress}\``,
              inline: false,
            },
            {
              name: 'Decimals',
              value: result.tokenInfo.decimals.toString(),
              inline: true,
            },
          ] : [],
          thumbnail: result.tokenInfo?.image ? { url: result.tokenInfo.image } : undefined,
          timestamp: new Date().toISOString(),
        };

        await message.reply({ embeds: [embed] });
      } else {
        await discordService.reactToMessage(message, '❌');
        await message.reply(`❌ ${result.message}`);
      }
      
      return true;
    }

    // ca-remove <token_address> - Remove token from tracking
    if (command === 'ca-remove' && parts.length >= 2) {
      const tokenAddress = parts[1];
      
      await discordService.reactToMessage(message, '⏳');
      
      const result = await buybotService.removeTrackedToken(message.channel.id, tokenAddress);
      
      if (result.success) {
        await discordService.reactToMessage(message, '✅');
        await message.reply(`✅ ${result.message}`);
      } else {
        await discordService.reactToMessage(message, '❌');
        await message.reply(`❌ ${result.message}`);
      }
      
      return true;
    }

    // ca OR ca-list - Show currently tracked tokens
    if ((command === 'ca' || command === 'ca-list') && parts.length === 1) {
      const trackedTokens = await buybotService.getTrackedTokens(message.channel.id);
      
      if (trackedTokens.length === 0) {
        const embed = {
          title: '📊 Token Tracking',
          description: 'No tokens are currently being tracked in this channel.\n\nUse `!ca <token_address>` to start tracking a token.\n\nExample: `!ca EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`',
          color: 0x0099ff,
          fields: [
            {
              name: '💡 Available Commands',
              value: '`!ca <address>` - Track a token\n`!ca` or `!ca-list` - Show tracked tokens\n`!ca-remove <address>` - Stop tracking\n`!ca-help` - Show this help',
              inline: false,
            },
            {
              name: '🪙 Popular Tokens',
              value: '**USDC**: `EPjFW...Dt1v`\n**BONK**: `DezXA...kX6R`\n**SOL**: `So111...1112`',
              inline: false,
            },
          ],
          timestamp: new Date().toISOString(),
        };
        
        await message.reply({ embeds: [embed] });
        return true;
      }

      const fields = trackedTokens.map(token => ({
        name: `${token.tokenSymbol} - ${token.tokenName}`,
        value: [
          `**Address:** \`${token.tokenAddress}\``,
          `**Added:** <t:${Math.floor(token.addedAt.getTime() / 1000)}:R>`,
          token.lastEventAt ? `**Last Event:** <t:${Math.floor(token.lastEventAt.getTime() / 1000)}:R>` : '**Last Event:** None',
        ].join('\n'),
        inline: false,
      }));

      const embed = {
        title: '📊 Tracked Tokens',
        description: `Tracking ${trackedTokens.length} token${trackedTokens.length !== 1 ? 's' : ''} in this channel:`,
        color: 0x0099ff,
        fields,
        footer: {
          text: 'Use !ca-remove <address> to stop tracking a token',
        },
        timestamp: new Date().toISOString(),
      };

      await message.reply({ embeds: [embed] });
      return true;
    }

    // ca-help - Show help information
    if (command === 'ca-help') {
      const embed = {
        title: '🤖 Buybot Help',
        description: 'Track Solana token purchases and transfers in real-time using Helius.',
        color: 0x00ff00,
        fields: [
          {
            name: '📝 Commands',
            value: '`!ca <address>` - Start tracking a token\n`!ca` or `!ca-list` - View tracked tokens\n`!ca-remove <address>` - Stop tracking a token\n`!ca-help` - Show this help message',
            inline: false,
          },
          {
            name: '💰 How It Works',
            value: 'Buybot checks for new transactions every 30 seconds and posts notifications when:\n• Tokens are swapped/purchased 💰\n• Tokens are transferred 📤',
            inline: false,
          },
          {
            name: '🪙 Popular Token Addresses',
            value: '**USDC**: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`\n**BONK**: `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263`\n**SOL**: `So11111111111111111111111111111111111111112`',
            inline: false,
          },
          {
            name: '📖 Example Usage',
            value: '```\n!ca EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\n```\nStarts tracking USDC in this channel.',
            inline: false,
          },
        ],
        footer: {
          text: 'Powered by Helius • solana.com',
        },
        timestamp: new Date().toISOString(),
      };

      await message.reply({ embeds: [embed] });
      return true;
    }

    return false;
  } catch (error) {
    logger?.error('[BuybotCommands] Error handling command:', error);
    
    try {
      await discordService.reactToMessage(message, '❌');
      await message.reply(`❌ An error occurred: ${error.message}`);
    } catch (replyError) {
      logger?.error('[BuybotCommands] Failed to send error message:', replyError);
    }
    
    return true;
  }
}

export default handleBuybotCommands;
