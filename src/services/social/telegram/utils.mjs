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
  html: false,
  breaks: true,
  linkify: true,
});

// Helper for escaping HTML in code blocks
const escapeHtml = (str) => 
  str.replace(/&/g, '&amp;')
     .replace(/</g, '&lt;')
     .replace(/>/g, '&gt;')
     .replace(/"/g, '&quot;');

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
 * @param {string} prompt - User's prompt
 * @param {string} defaultRatio - Default aspect ratio
 * @returns {string} - Inferred aspect ratio
 */
export function inferAspectRatioFromPrompt(prompt, defaultRatio = '1:1') {
  const lowerPrompt = prompt.toLowerCase();
  
  if (lowerPrompt.includes('widescreen') || 
      lowerPrompt.includes('banner') || 
      lowerPrompt.includes('landscape') || 
      lowerPrompt.includes('wide shot') ||
      lowerPrompt.includes('horizontal') || 
      lowerPrompt.includes('panoramic') ||
      lowerPrompt.includes('cinematic')) {
    return '16:9';
  }
  
  if (lowerPrompt.includes('portrait') || 
      lowerPrompt.includes('vertical') || 
      lowerPrompt.includes('tall') || 
      lowerPrompt.includes('phone wallpaper') ||
      lowerPrompt.includes('story') || 
      lowerPrompt.includes('tiktok')) {
    return '9:16';
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

export default {
  safeDecrypt,
  escapeRegExp,
  decodeHtmlEntities,
  formatTelegramMarkdown,
  inferMimeTypeFromUrl,
  downloadImageAsBase64,
  formatNumber,
  formatPrice,
  generateRequestId,
  includesMention,
  inferAspectRatioFromPrompt,
  buildCreditInfo,
};
