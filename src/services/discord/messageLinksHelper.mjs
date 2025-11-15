/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Helper utilities for parsing and fetching Discord message links
 */

/**
 * Regular expression to match Discord message URLs
 * Format: https://discord.com/channels/GUILD_ID/CHANNEL_ID/MESSAGE_ID
 * Also matches ptb and canary subdomains
 */
const DISCORD_MESSAGE_LINK_REGEX = /https?:\/\/(?:ptb\.|canary\.)?discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/g;

/**
 * Extract all Discord message links from text
 * @param {string} text - Text to search for message links
 * @returns {Array<Object>} Array of parsed link objects with guildId, channelId, messageId
 */
export function extractMessageLinks(text) {
  if (!text || typeof text !== 'string') return [];
  
  const links = [];
  const matches = text.matchAll(DISCORD_MESSAGE_LINK_REGEX);
  
  for (const match of matches) {
    links.push({
      url: match[0],
      guildId: match[1],
      channelId: match[2],
      messageId: match[3]
    });
  }
  
  return links;
}

/**
 * Fetch a Discord message from the API
 * @param {Object} discordClient - Discord.js client
 * @param {string} channelId - Channel ID
 * @param {string} messageId - Message ID
 * @param {Object} logger - Logger instance
 * @returns {Promise<Object|null>} The fetched message or null if not found
 */
export async function fetchDiscordMessage(discordClient, channelId, messageId, logger) {
  try {
    const channel = await discordClient.channels.fetch(channelId);
    if (!channel) {
      logger?.warn?.(`Channel ${channelId} not found`);
      return null;
    }
    
    const message = await channel.messages.fetch(messageId);
    return message;
  } catch (error) {
    logger?.warn?.(`Failed to fetch message ${messageId} from channel ${channelId}: ${error.message}`);
    return null;
  }
}

/**
 * Fetch surrounding context messages (before and after the referenced message)
 * @param {Object} discordClient - Discord.js client
 * @param {string} channelId - Channel ID
 * @param {string} messageId - Message ID
 * @param {Object} options - Options for context fetching
 * @param {number} options.before - Number of messages before (default: 3)
 * @param {number} options.after - Number of messages after (default: 2)
 * @param {Object} logger - Logger instance
 * @returns {Promise<Object>} Object with before, target, and after messages
 */
export async function fetchMessageContext(discordClient, channelId, messageId, options = {}, logger) {
  const { before = 3, after = 2 } = options;
  
  try {
    const channel = await discordClient.channels.fetch(channelId);
    if (!channel) {
      logger?.warn?.(`Channel ${channelId} not found for context`);
      return { before: [], target: null, after: [] };
    }
    
    // Fetch the target message
    const targetMessage = await channel.messages.fetch(messageId);
    if (!targetMessage) {
      return { before: [], target: null, after: [] };
    }
    
    // Fetch messages before
    let beforeMessages = [];
    if (before > 0) {
      const beforeCollection = await channel.messages.fetch({ 
        limit: before, 
        before: messageId 
      });
      beforeMessages = Array.from(beforeCollection.values()).reverse(); // Oldest first
    }
    
    // Fetch messages after
    let afterMessages = [];
    if (after > 0) {
      const afterCollection = await channel.messages.fetch({ 
        limit: after, 
        after: messageId 
      });
      afterMessages = Array.from(afterCollection.values()).reverse(); // Oldest first
    }
    
    return {
      before: beforeMessages,
      target: targetMessage,
      after: afterMessages
    };
  } catch (error) {
    logger?.warn?.(`Failed to fetch context for message ${messageId}: ${error.message}`);
    return { before: [], target: null, after: [] };
  }
}

/**
 * Format a message for display in context
 * @param {Object} message - Discord message object
 * @param {boolean} isTarget - Whether this is the referenced/target message
 * @returns {string} Formatted message text
 */
export function formatMessageForContext(message, isTarget = false) {
  if (!message) return '';
  
  const author = message.author?.username || message.author?.tag || 'Unknown';
  const content = message.content || '[No text content]';
  
  // Handle webhook messages (avatar messages)
  const isWebhook = message.webhookId || (message.author?.bot && message.author?.discriminator === '0000');
  const prefix = isWebhook ? '🤖' : '👤';
  
  // Mark the target message
  const marker = isTarget ? ' ⭐' : '';
  
  // Include image descriptions if present
  let imageNote = '';
  if (message.attachments?.size > 0) {
    const imageCount = Array.from(message.attachments.values()).filter(a => 
      a.contentType?.startsWith('image/')
    ).length;
    if (imageCount > 0) {
      imageNote = ` [${imageCount} image${imageCount > 1 ? 's' : ''}]`;
    }
  }
  
  return `${prefix} ${author}${marker}: ${content}${imageNote}`;
}

/**
 * Build a summary of the message context for AI consumption
 * @param {Object} context - Context object from fetchMessageContext
 * @param {Object} link - Link object with url, guildId, channelId, messageId
 * @returns {string} Formatted context summary
 */
export function buildContextSummary(context, link) {
  const { before, target, after } = context;
  
  if (!target) {
    return `[Referenced message not found: ${link.url}]`;
  }
  
  const parts = [];
  parts.push('--- Referenced Discord Message ---');
  parts.push(`Link: ${link.url}`);
  parts.push('');
  
  // Add context before
  if (before && before.length > 0) {
    parts.push('Context before:');
    before.forEach(msg => {
      parts.push(formatMessageForContext(msg, false));
    });
    parts.push('');
  }
  
  // Add the target message (marked)
  parts.push('Referenced message:');
  parts.push(formatMessageForContext(target, true));
  parts.push('');
  
  // Add context after
  if (after && after.length > 0) {
    parts.push('Context after:');
    after.forEach(msg => {
      parts.push(formatMessageForContext(msg, false));
    });
    parts.push('');
  }
  
  parts.push('--- End Referenced Message ---');
  
  return parts.join('\n');
}

export default {
  extractMessageLinks,
  fetchDiscordMessage,
  fetchMessageContext,
  formatMessageForContext,
  buildContextSummary
};
