/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Telegram Service Utilities
 * Common helper functions for the Telegram bot service
 */

import MarkdownIt from 'markdown-it';
import { decrypt } from '../../../utils/encryption.mjs';
import { HTML_ENTITY_MAP } from './constants.mjs';

// ============================================================================
// Markdown-it Configuration
// ============================================================================

const md = new MarkdownIt({
  html: true, // Enable HTML tags in source
  breaks: true,
  linkify: true,
});

// Helper for escaping HTML in code blocks and user-facing error messages
export const escapeHtml = (str) => {
  if (typeof str !== 'string') str = String(str ?? '');
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
};

// Custom renderer for Telegram-compatible HTML
// Telegram supports: <b>, <i>, <u>, <s>, <a>, <code>, <pre>
md.renderer.rules.strong_open = () => '<b>';
md.renderer.rules.strong_close = () => '</b>';
md.renderer.rules.em_open = () => '<i>';
md.renderer.rules.em_close = () => '</i>';
md.renderer.rules.s_open = () => '<s>';
md.renderer.rules.s_close = () => '</s>';
md.renderer.rules.code_inline = (tokens, idx) => `<code>${escapeHtml(tokens[idx].content)}</code>`;
md.renderer.rules.code_block = (tokens, idx) => `<pre><code>${escapeHtml(tokens[idx].content)}</code></pre>`;
md.renderer.rules.fence = (tokens, idx) => `<pre><code>${escapeHtml(tokens[idx].content)}</code></pre>`;

// ============================================================================
// Encryption Utilities
// ============================================================================

/**
 * Tolerant decrypt that accepts plaintext or legacy formats
 * Falls back to input on failure
 * @param {string} value - Value to decrypt
 * @returns {string} - Decrypted value or original
 */
export function safeDecrypt(value) {
  try {
    if (!value) return '';
    // If value contains our GCM triplet separator, attempt decrypt; else treat as plaintext
    if (typeof value === 'string' && value.includes(':')) {
      return decrypt(value);
    }
    return String(value);
  } catch {
    // If decryption fails (e.g., rotated key), return as-is
    return String(value || '');
  }
}

// ============================================================================
// String Utilities
// ============================================================================

/**
 * Escape special regex characters in a string
 * @param {string} value - String to escape
 * @returns {string} - Escaped string
 */
export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Decode HTML entities in a string
 * @param {string} value - String with HTML entities
 * @returns {string} - Decoded string
 */
export function decodeHtmlEntities(value) {
  if (!value || typeof value !== 'string') {
    return typeof value === 'undefined' || value === null ? '' : String(value);
  }

  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, entity) => {
    if (!entity) return match;
    const lower = entity.toLowerCase();

    if (lower.startsWith('#x')) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    }

    if (lower.startsWith('#')) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    }

    if (HTML_ENTITY_MAP[lower]) {
      return HTML_ENTITY_MAP[lower];
    }

    return match;
  });
}

// ============================================================================
// Formatting Utilities
// ============================================================================

/**
 * Format text with Markdown for Telegram
 * Converts Markdown to Telegram-compatible HTML
 * @param {string} text - Text to format
 * @param {Object} [logger] - Optional logger for warnings
 * @returns {string} - HTML formatted text
 */
export function formatTelegramMarkdown(text, logger = null) {
  if (!text) return '';

  try {
    const normalized = typeof text === 'string' ? text : String(text ?? '');
    const decoded = decodeHtmlEntities(normalized);
    
    // Convert Markdown to HTML using markdown-it
    let html = md.render(decoded.trim());

    // Fix paragraphs: replace </p><p> with double newline
    html = html.replace(/<\/p>\s*<p>/g, '\n\n');

    // Remove remaining <p> tags
    html = html.replace(/<\/?p>/g, '');

    // Replace <br> with newline
    html = html.replace(/<br\s*\/?>\n?/g, '\n');

    return html.trim();
  } catch (e) {
    logger?.warn?.('[TelegramUtils] Markdown conversion failed, falling back to plain text:', e);
    return String(text).trim();
  }
}

// ============================================================================
// MIME Type Utilities
// ============================================================================

/**
 * Infer MIME type from a URL
 * @param {string} imageUrl - URL to analyze
 * @returns {string} - MIME type
 */
export function inferMimeTypeFromUrl(imageUrl) {
  try {
    const urlWithoutQuery = imageUrl.split('?')[0] || imageUrl;
    const ext = urlWithoutQuery.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      case 'gif':
        return 'image/gif';
      default:
        return 'image/png';
    }
  } catch {
    return 'image/png';
  }
}

/**
 * Download an image and convert to base64
 * @param {string} imageUrl - URL to download
 * @param {Object} [logger] - Optional logger
 * @returns {Promise<{data: string, mimeType: string}|null>}
 */
export async function downloadImageAsBase64(imageUrl, logger = null) {
  if (!imageUrl) return null;
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const mimeType = response.headers.get('content-type') || inferMimeTypeFromUrl(imageUrl);
    return {
      data: Buffer.from(arrayBuffer).toString('base64'),
      mimeType: mimeType || 'image/png',
    };
  } catch (err) {
    logger?.warn?.('[TelegramUtils] Failed to download image:', err.message);
    return null;
  }
}

/**
 * Download an image and return as Buffer
 * @param {string} imageUrl - URL to download
 * @param {Object} [logger] - Optional logger
 * @returns {Promise<{buffer: Buffer, mimeType: string, filename: string}|null>}
 */
export async function downloadImageAsBuffer(imageUrl, logger = null) {
  if (!imageUrl) return null;
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = response.headers.get('content-type') || inferMimeTypeFromUrl(imageUrl);
    
    // Determine filename from URL or generate one
    const urlPath = new URL(imageUrl).pathname;
    let filename = urlPath.split('/').pop() || `image_${Date.now()}`;
    
    // Ensure correct extension based on mime type
    if (mimeType === 'image/png' && !filename.endsWith('.png')) {
      filename = filename.replace(/\.[^.]+$/, '') + '.png';
    } else if ((mimeType === 'image/jpeg' || mimeType === 'image/jpg') && !filename.match(/\.jpe?g$/)) {
      filename = filename.replace(/\.[^.]+$/, '') + '.jpg';
    }
    
    return { buffer, mimeType: mimeType || 'image/png', filename };
  } catch (err) {
    logger?.warn?.('[TelegramUtils] Failed to download image as buffer:', err.message);
    return null;
  }
}

/**
 * Send image to Telegram with optional high-res PNG download link
 * @param {Object} telegram - Telegram API instance (ctx.telegram)
 * @param {string|number} chatId - Chat ID to send to
 * @param {string} imageUrl - Image URL
 * @param {Object} [options] - Send options
 * @param {string} [options.caption] - Image caption
 * @param {string} [options.parseMode='HTML'] - Parse mode for caption
 * @param {boolean} [options.includeDownloadLink=true] - If true, add PNG download link
 * @param {Object} [logger] - Optional logger
 * @returns {Promise<Object|null>} - Sent message object
 */
export async function sendImagePreservingFormat(telegram, chatId, imageUrl, options = {}, _logger = null) {
  const { caption, parseMode = 'HTML', includeDownloadLink = true } = options;
  
  // Check if it's a PNG
  const isPng = imageUrl.toLowerCase().includes('.png') || 
                imageUrl.toLowerCase().includes('image/png');
  
  // Build caption with optional download link
  let finalCaption = caption || '';
  if (includeDownloadLink && isPng && imageUrl) {
    const downloadLink = `\n\n<a href="${imageUrl}">📥 Download High-Res PNG</a>`;
    finalCaption = finalCaption ? `${finalCaption}${downloadLink}` : downloadLink.trim();
  }
  
  return await telegram.sendPhoto(chatId, imageUrl, {
    caption: finalCaption || undefined,
    parse_mode: parseMode
  });
}

/**
 * Extract user's profile photo from Telegram
 * @param {Object} telegram - Telegram API instance (ctx.telegram)
 * @param {number|string} userId - User ID
 * @param {Object} [logger] - Optional logger
 * @returns {Promise<{data: string, mimeType: string}|null>}
 */
export async function getUserProfilePhoto(telegram, userId, logger = null) {
  if (!telegram || !userId) return null;
  
  try {
    // Get user profile photos (limit to 1)
    const photos = await telegram.getUserProfilePhotos(userId, 0, 1);
    
    if (!photos?.photos?.length || !photos.photos[0]?.length) {
      logger?.debug?.('[TelegramUtils] No profile photos found for user', { userId });
      return null;
    }
    
    // Get the largest photo (last in the array)
    const photoSizes = photos.photos[0];
    const largestPhoto = photoSizes[photoSizes.length - 1];
    
    // Get file info and download
    const file = await telegram.getFile(largestPhoto.file_id);
    if (!file?.file_path) {
      logger?.warn?.('[TelegramUtils] Could not get file path for profile photo');
      return null;
    }
    
    // Construct download URL (requires bot token in the URL)
    const fileUrl = `https://api.telegram.org/file/bot${telegram.token}/${file.file_path}`;
    
    return await downloadImageAsBase64(fileUrl, logger);
  } catch (err) {
    logger?.warn?.('[TelegramUtils] Failed to get user profile photo:', err.message);
    return null;
  }
}

/**
 * Extract image from a Telegram message (photo or document)
 * @param {Object} telegram - Telegram API instance (ctx.telegram)
 * @param {Object} message - Telegram message object
 * @param {Object} [logger] - Optional logger
 * @returns {Promise<{data: string, mimeType: string, width?: number, height?: number}|null>}
 */
export async function getMessageImage(telegram, message, logger = null) {
  if (!telegram || !message) return null;
  
  try {
    let fileId = null;
    let mimeType = 'image/jpeg';
    let width = null;
    let height = null;
    
    // Check for photo array
    if (message.photo?.length) {
      // Get the largest photo (last in array)
      const largestPhoto = message.photo[message.photo.length - 1];
      fileId = largestPhoto.file_id;
      width = largestPhoto.width;
      height = largestPhoto.height;
    }
    // Check for document (could be PNG, GIF, etc.)
    else if (message.document?.mime_type?.startsWith('image/')) {
      fileId = message.document.file_id;
      mimeType = message.document.mime_type;
    }
    // Check for sticker
    else if (message.sticker) {
      fileId = message.sticker.file_id;
      mimeType = message.sticker.is_animated ? 'application/x-tgsticker' : 'image/webp';
      width = message.sticker.width;
      height = message.sticker.height;
    }
    
    if (!fileId) {
      logger?.debug?.('[TelegramUtils] No image found in message');
      return null;
    }
    
    // Get file info and download
    const file = await telegram.getFile(fileId);
    if (!file?.file_path) {
      logger?.warn?.('[TelegramUtils] Could not get file path for message image');
      return null;
    }
    
    // Construct download URL
    const fileUrl = `https://api.telegram.org/file/bot${telegram.token}/${file.file_path}`;
    
    const imageData = await downloadImageAsBase64(fileUrl, logger);
    if (!imageData) return null;
    
    return {
      ...imageData,
      mimeType: imageData.mimeType || mimeType,
      width,
      height
    };
  } catch (err) {
    logger?.warn?.('[TelegramUtils] Failed to get message image:', err.message);
    return null;
  }
}

/**
 * Extract images from a reply chain
 * @param {Object} ctx - Telegram context
 * @param {number} maxImages - Maximum number of images to extract (default: 5)
 * @param {Object} [logger] - Optional logger
 * @returns {Promise<Array<{data: string, mimeType: string, label: string}>>}
 */
export async function getReplyChainImages(ctx, maxImages = 5, logger = null) {
  const images = [];
  let message = ctx.message?.reply_to_message;
  
  while (message && images.length < maxImages) {
    const imageData = await getMessageImage(ctx.telegram, message, logger);
    if (imageData) {
      images.push({
        data: imageData.data,
        mimeType: imageData.mimeType,
        label: `reference_${images.length + 1}`,
        width: imageData.width,
        height: imageData.height
      });
    }
    
    // Move to next message in reply chain
    message = message.reply_to_message;
  }
  
  return images;
}

// ============================================================================
// Number Formatting Utilities
// ============================================================================

/**
 * Format a number for display (K, M, B suffixes)
 * @param {number} num - Number to format
 * @returns {string} - Formatted string
 */
export function formatNumber(num) {
  if (!num) return 'N/A';
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(2)}K`;
  return `$${num.toFixed(2)}`;
}

/**
 * Format a price for display
 * @param {number} price - Price to format
 * @returns {string} - Formatted string
 */
export function formatPrice(price) {
  if (!price) return 'N/A';
  if (price < 0.01) return `$${price.toFixed(6)}`;
  return `$${price.toFixed(4)}`;
}

// ============================================================================
// ID Generation Utilities
// ============================================================================

/**
 * Generate a unique request ID for deduplication
 * @param {Object} ctx - Telegram context
 * @returns {string} - Unique request ID
 */
export function generateRequestId(ctx) {
  const messageId = ctx?.message?.message_id;
  const updateId = ctx?.update?.update_id;
  const chatId = ctx?.chat?.id;
  return `${chatId}:${messageId || updateId || Date.now()}`;
}

// ============================================================================
// Mention Detection Utilities
// ============================================================================

/**
 * Check if a message includes a mention of the bot
 * @param {string} source - Message text
 * @param {Array} entities - Message entities
 * @param {string} botUsername - Bot's username
 * @returns {boolean} - True if mentioned
 */
export function includesMention(source, entities, botUsername) {
  if (!botUsername) return false;
  if (source && source.includes(`@${botUsername}`)) {
    return true;
  }
  if (!source || !entities) return false;
  return entities.some((entity) => {
    if (entity.type !== 'mention') return false;
    if (typeof entity.offset !== 'number' || typeof entity.length !== 'number') return false;
    const fragment = source.substring(entity.offset, entity.offset + entity.length);
    return fragment.includes(botUsername);
  });
}

// ============================================================================
// Aspect Ratio Inference
// ============================================================================

/**
 * Infer aspect ratio from prompt keywords
 * Supports: 1:1 (square), 16:9 (widescreen), 9:16 (portrait), 3:1 (banner), 21:9 (ultra-wide)
 * @param {string} prompt - User's prompt
 * @param {string} defaultRatio - Default aspect ratio
 * @returns {string} - Inferred aspect ratio
 */
export function inferAspectRatioFromPrompt(prompt, defaultRatio = '1:1') {
  const lowerPrompt = prompt.toLowerCase();
  
  // Gemini supported ratios: '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'
  const SUPPORTED_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
  
  // Check for explicit aspect ratio mentions first (e.g., "16:9", "21:9")
  const explicitRatioMatch = lowerPrompt.match(/\b(\d+:\d+)\b/);
  if (explicitRatioMatch) {
    const ratio = explicitRatioMatch[1];
    // If it's a supported ratio, use it directly
    if (SUPPORTED_RATIOS.includes(ratio)) {
      return ratio;
    }
    // Map unsupported ratios to closest supported ones
    if (ratio === '3:1' || ratio === '2:1') {
      return '21:9'; // Closest ultra-wide
    }
  }
  
  // Banner/Header - use 21:9 (closest ultra-wide supported ratio)
  if (lowerPrompt.includes('banner') || 
      lowerPrompt.includes('header') ||
      lowerPrompt.includes('cover photo') ||
      lowerPrompt.includes('twitter header') ||
      lowerPrompt.includes('youtube banner')) {
    return '21:9';
  }
  
  // Ultra-wide/Cinematic (21:9)
  if (lowerPrompt.includes('ultra wide') ||
      lowerPrompt.includes('ultrawide') ||
      lowerPrompt.includes('anamorphic') ||
      lowerPrompt.includes('cinematic') ||
      lowerPrompt.includes('movie') ||
      lowerPrompt.includes('film')) {
    return '21:9';
  }
  
  // Widescreen (16:9)
  if (lowerPrompt.includes('widescreen') || 
      lowerPrompt.includes('landscape') || 
      lowerPrompt.includes('wide shot') ||
      lowerPrompt.includes('horizontal') || 
      lowerPrompt.includes('panoramic') ||
      lowerPrompt.includes('desktop wallpaper') ||
      lowerPrompt.includes('thumbnail')) {
    return '16:9';
  }
  
  // Portrait/Vertical (9:16)
  if (lowerPrompt.includes('portrait') || 
      lowerPrompt.includes('vertical') || 
      lowerPrompt.includes('tall') || 
      lowerPrompt.includes('phone wallpaper') ||
      lowerPrompt.includes('story') || 
      lowerPrompt.includes('tiktok') ||
      lowerPrompt.includes('reels') ||
      lowerPrompt.includes('shorts')) {
    return '9:16';
  }
  
  // Square (1:1) for profile pictures
  if (lowerPrompt.includes('profile') ||
      lowerPrompt.includes('avatar') ||
      lowerPrompt.includes('pfp') ||
      lowerPrompt.includes('icon')) {
    return '1:1';
  }
  
  return defaultRatio;
}

// ============================================================================
// Credit/Limit Formatting
// ============================================================================

/**
 * Build a compact credit info string for AI context
 * @param {Object} limit - Limit check result
 * @param {string} label - Label for the media type
 * @returns {string} - Formatted credit info
 */
export function buildCreditInfo(limit, label) {
  if (!limit) return `${label}: unavailable`;
  
  const now = Date.now();
  const hLeft = Math.max(0, (limit.hourlyLimit ?? 0) - (limit.hourlyUsed ?? 0));
  const dLeft = Math.max(0, (limit.dailyLimit ?? 0) - (limit.dailyUsed ?? 0));
  const available = hLeft > 0 && dLeft > 0;

  if (available) {
    return `${label}: ${Math.min(hLeft, dLeft)} available`;
  }

  // No credits - calculate time until next reset
  let nextResetMin = null;
  if (hLeft === 0 && limit.resetTimes?.hourly) {
    const msUntilHourly = limit.resetTimes.hourly.getTime() - now;
    if (msUntilHourly > 0) nextResetMin = Math.ceil(msUntilHourly / 60000);
  }
  if (dLeft === 0 && limit.resetTimes?.daily) {
    const msUntilDaily = limit.resetTimes.daily.getTime() - now;
    if (msUntilDaily > 0) {
      const dailyMin = Math.ceil(msUntilDaily / 60000);
      nextResetMin = nextResetMin ? Math.min(nextResetMin, dailyMin) : dailyMin;
    }
  }

  return nextResetMin 
    ? `${label}: 0 left, resets in ${nextResetMin}m`
    : `${label}: 0 left`;
}

/**
 * Estimate the number of tokens in a string
 * Heuristic: ~4 characters per token for English text
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

export default {
  safeDecrypt,
  escapeRegExp,
  escapeHtml,
  decodeHtmlEntities,
  formatTelegramMarkdown,
  inferMimeTypeFromUrl,
  downloadImageAsBase64,
  downloadImageAsBuffer,
  sendImagePreservingFormat,
  getUserProfilePhoto,
  getMessageImage,
  getReplyChainImages,
  formatNumber,
  formatPrice,
  generateRequestId,
  includesMention,
  inferAspectRatioFromPrompt,
  buildCreditInfo,
  estimateTokens,
};
