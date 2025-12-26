/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Content Filter Utility
 * Provides utilities for filtering and validating message content
 * to detect and reject messages containing cryptocurrency addresses and cashtags.
 */

// Solana address pattern: Base58 encoded, 32-44 characters
// Valid Base58 characters: 1-9, A-H, J-N, P-Z, a-k, m-z (no 0, I, O, l)
// Note: We use inline patterns in functions to avoid global regex state issues

// Ethereum address pattern: 0x followed by 40 hex characters
const ETH_ADDRESS_REGEX = /\b0x[a-fA-F0-9]{40}\b/gi;

// Cashtag pattern: $ followed by 1-15 alphanumeric characters (typical ticker format)
const CASHTAG_REGEX = /\$[A-Za-z][A-Za-z0-9]{0,14}\b/g;

// URL pattern: matches http(s) URLs and www. prefixed URLs
const URL_REGEX = /(https?:\/\/[^\s<>\"']+|www\.[^\s<>\"']+)/gi;

/**
 * Check if a string looks like a Solana address
 * @param {string} text - The text to check
 * @returns {boolean} True if the text matches a Solana address pattern
 */
export function isSolanaAddress(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  // Solana addresses are typically 32-44 characters in Base58
  if (trimmed.length < 32 || trimmed.length > 44) return false;
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed);
}

/**
 * Check if a string looks like an Ethereum address
 * @param {string} text - The text to check
 * @returns {boolean} True if the text matches an Ethereum address pattern
 */
export function isEthAddress(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  return /^0x[a-fA-F0-9]{40}$/i.test(trimmed);
}

/**
 * Check if a string is a cashtag (e.g., $BTC, $ETH, $SOL)
 * @param {string} text - The text to check
 * @returns {boolean} True if the text is a cashtag
 */
export function isCashtag(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  return /^\$[A-Za-z][A-Za-z0-9]{0,14}$/.test(trimmed);
}

/**
 * Check if text contains any URLs
 * @param {string} text - The text to check
 * @returns {boolean} True if the text contains URLs
 */
export function containsUrl(text) {
  if (!text || typeof text !== 'string') return false;
  return URL_REGEX.test(text);
}

/**
 * Extract all URLs from text
 * @param {string} text - The text to search
 * @returns {string[]} Array of URLs found
 */
export function extractUrls(text) {
  if (!text || typeof text !== 'string') return [];
  const matches = text.match(URL_REGEX);
  if (!matches) return [];
  return [...new Set(matches)];
}

/**
 * Remove URLs from text, optionally preserving URLs from allowed domains
 * @param {string} text - The text to sanitize
 * @param {Object} [options] - Options
 * @param {string} [options.replacement=''] - What to replace URLs with
 * @param {string[]} [options.allowedDomains=[]] - List of allowed domain patterns to preserve (e.g., 'cloudfront.net', 'amazonaws.com')
 * @param {boolean} [options.preserveMarkdownLinks=true] - Whether to preserve URLs inside markdown link syntax [text](url) when they point to media files
 * @returns {string} Text with URLs removed (except allowed ones)
 */
export function stripUrls(text, options = {}) {
  const { replacement = '', allowedDomains = [], preserveMarkdownLinks = true } = options;
  if (!text || typeof text !== 'string') return text;
  
  // Build a set of allowed domain patterns for faster lookup
  const allowedPatterns = allowedDomains.map(d => d.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, ''));
  
  // Helper to check if a URL is from an allowed domain
  const isAllowedUrl = (url) => {
    if (allowedPatterns.length === 0) return false;
    try {
      const urlLower = url.toLowerCase();
      return allowedPatterns.some(pattern => urlLower.includes(pattern));
    } catch {
      return false;
    }
  };
  
  // Helper to check if URL points to a media file
  const isMediaUrl = (url) => /\.(png|jpg|jpeg|gif|webp|mp4|webm|svg)(\?|$)/i.test(url);
  
  let result = text;
  const protectedLinks = new Map();
  let linkIndex = 0;
  
  // If preserving markdown links, first extract and protect them
  if (preserveMarkdownLinks) {
    // Match markdown links: [text](url)
    const markdownLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi;
    
    result = result.replace(markdownLinkRegex, (match, linkText, url) => {
      // Preserve if URL is from allowed domain or if it looks like an image/media URL
      if (isAllowedUrl(url) || isMediaUrl(url)) {
        const placeholder = `__MDLINK_${linkIndex}__`;
        protectedLinks.set(placeholder, match);
        linkIndex++;
        return placeholder;
      }
      // Strip the URL but keep the link text
      return linkText;
    });
  }
  
  // Now strip remaining URLs (not in markdown links)
  result = result.replace(URL_REGEX, (url) => {
    if (isAllowedUrl(url)) return url;
    return replacement;
  });
  
  // Restore protected markdown links
  for (const [placeholder, original] of protectedLinks.entries()) {
    result = result.replace(placeholder, original);
  }
  
  // Clean up whitespace
  return result.replace(/\s+/g, ' ').trim();
}

/**
 * Extract all cashtags from text
 * @param {string} text - The text to search
 * @returns {string[]} Array of cashtags found (including the $ symbol)
 */
export function extractCashtags(text) {
  if (!text || typeof text !== 'string') return [];
  const matches = text.match(CASHTAG_REGEX);
  if (!matches) return [];
  // Normalize to uppercase and deduplicate
  return [...new Set(matches.map(tag => tag.toUpperCase()))];
}

/**
 * Check if text contains any cashtags not in the allowlist
 * @param {string} text - The text to check
 * @param {string[]} [allowedCashtags=[]] - List of allowed cashtags (with or without $)
 * @returns {Object} Object with found cashtags and whether any are blocked
 */
export function checkCashtags(text, allowedCashtags = []) {
  if (!text || typeof text !== 'string') {
    return { found: [], blocked: [], allowed: [], hasBlocked: false };
  }
  
  const found = extractCashtags(text);
  if (found.length === 0) {
    return { found: [], blocked: [], allowed: [], hasBlocked: false };
  }
  
  // Normalize allowlist to uppercase with $ prefix
  const normalizedAllowlist = new Set(
    allowedCashtags.map(tag => {
      const normalized = String(tag).trim().toUpperCase();
      return normalized.startsWith('$') ? normalized : `$${normalized}`;
    })
  );
  
  const allowed = [];
  const blocked = [];
  
  for (const tag of found) {
    if (normalizedAllowlist.has(tag)) {
      allowed.push(tag);
    } else {
      blocked.push(tag);
    }
  }
  
  return {
    found,
    blocked,
    allowed,
    hasBlocked: blocked.length > 0
  };
}

/**
 * Check if text contains any cryptocurrency addresses
 * @param {string} text - The text to check
 * @returns {boolean} True if the text contains a crypto address
 */
export function containsCryptoAddress(text) {
  if (!text || typeof text !== 'string') return false;
  
  // Check for Ethereum addresses
  if (ETH_ADDRESS_REGEX.test(text)) {
    ETH_ADDRESS_REGEX.lastIndex = 0; // Reset regex state
    return true;
  }
  
  // Check for Solana addresses (more careful check to avoid false positives)
  const words = text.split(/\s+/);
  for (const word of words) {
    // Skip common words and short strings
    if (word.length < 32 || word.length > 44) continue;
    
    // Skip if it contains invalid Base58 characters
    if (/[0IOl]/.test(word)) continue;
    
    // Check if it matches the Base58 pattern for Solana addresses
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(word)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Extract all cryptocurrency addresses from text
 * @param {string} text - The text to search
 * @returns {Object} Object with arrays of found addresses by type
 */
export function extractCryptoAddresses(text) {
  const result = {
    ethereum: [],
    solana: [],
    total: 0
  };
  
  if (!text || typeof text !== 'string') return result;
  
  // Extract Ethereum addresses
  const ethMatches = text.match(ETH_ADDRESS_REGEX);
  if (ethMatches) {
    result.ethereum = [...new Set(ethMatches.map(addr => addr.toLowerCase()))];
  }
  
  // Extract potential Solana addresses
  const words = text.split(/\s+/);
  for (const word of words) {
    if (word.length >= 32 && word.length <= 44) {
      if (!/[0IOl]/.test(word) && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(word)) {
        if (!result.solana.includes(word)) {
          result.solana.push(word);
        }
      }
    }
  }
  
  result.total = result.ethereum.length + result.solana.length;
  return result;
}

/**
 * Filter result object returned by content filter functions
 * @typedef {Object} ContentFilterResult
 * @property {boolean} allowed - Whether the content is allowed
 * @property {boolean} blocked - Whether the content was blocked
 * @property {string} [reason] - Reason for blocking (if blocked)
 * @property {string} [type] - Type of blocked content (e.g., 'crypto_address')
 * @property {Object} [details] - Additional details about what was found
 */

/**
 * Check if a message should be blocked due to crypto addresses
 * @param {string} text - The message text to check
 * @param {Object} [options] - Options
 * @param {Object} [options.logger] - Logger instance for debugging
 * @returns {ContentFilterResult} Result object indicating if content is allowed
 */
export function filterCryptoAddresses(text, options = {}) {
  const { logger } = options;
  
  if (!text || typeof text !== 'string') {
    return { allowed: true, blocked: false };
  }
  
  const addresses = extractCryptoAddresses(text);
  
  if (addresses.total > 0) {
    const details = {
      ethereumCount: addresses.ethereum.length,
      solanaCount: addresses.solana.length,
      ethereum: addresses.ethereum,
      solana: addresses.solana
    };
    
    logger?.debug?.('[ContentFilter] Crypto address detected', details);
    
    return {
      allowed: false,
      blocked: true,
      reason: 'Message contains cryptocurrency address(es)',
      type: 'crypto_address',
      details
    };
  }
  
  return { allowed: true, blocked: false };
}

/**
 * Sanitize text by removing cryptocurrency addresses
 * @param {string} text - The text to sanitize
 * @param {Object} [options] - Options
 * @param {string} [options.replacement='[REDACTED]'] - What to replace addresses with
 * @returns {string} Sanitized text
 */
export function sanitizeCryptoAddresses(text, options = {}) {
  const { replacement = '[REDACTED]' } = options;
  
  if (!text || typeof text !== 'string') return text;
  
  // Replace Ethereum addresses
  let sanitized = text.replace(ETH_ADDRESS_REGEX, replacement);
  
  // Replace Solana addresses (word by word to avoid false positives)
  const words = sanitized.split(/(\s+)/);
  sanitized = words.map(word => {
    if (word.length >= 32 && word.length <= 44) {
      if (!/[0IOl]/.test(word) && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(word)) {
        return replacement;
      }
    }
    return word;
  }).join('');
  
  return sanitized;
}

/**
 * Comprehensive content filter that checks for crypto addresses, cashtags, and URLs
 * @param {string} text - The message text to check
 * @param {Object} [options] - Options
 * @param {Object} [options.logger] - Logger instance for debugging
 * @param {boolean} [options.enabled=true] - Master switch to enable/disable filtering
 * @param {string[]} [options.allowedCashtags=[]] - List of allowed cashtags
 * @param {string[]} [options.allowedAddresses=[]] - List of allowed crypto addresses
 * @param {boolean} [options.blockCryptoAddresses=true] - Whether to block crypto addresses
 * @param {boolean} [options.blockCashtags=true] - Whether to block cashtags
 * @param {boolean} [options.blockUrls=false] - Whether to block URLs
 * @returns {ContentFilterResult} Result object indicating if content is allowed
 */
export function filterContent(text, options = {}) {
  const {
    logger,
    enabled = true,
    allowedCashtags = [],
    allowedAddresses = [],
    blockCryptoAddresses = true,
    blockCashtags = true,
    blockUrls = false
  } = options;
  
  // If filtering is disabled, allow everything
  if (!enabled) {
    return { allowed: true, blocked: false };
  }
  
  if (!text || typeof text !== 'string') {
    return { allowed: true, blocked: false };
  }
  
  const details = {
    cryptoAddresses: null,
    cashtags: null,
    urls: null
  };
  
  // Check for URLs first (if enabled)
  if (blockUrls) {
    const urls = extractUrls(text);
    if (urls.length > 0) {
      details.urls = urls;
      
      logger?.debug?.('[ContentFilter] Blocked URL detected', { urls });
      
      return {
        allowed: false,
        blocked: true,
        reason: 'Message contains URL(s)',
        type: 'url',
        details
      };
    }
  }
  
  // Check for crypto addresses
  if (blockCryptoAddresses) {
    const addresses = extractCryptoAddresses(text);
    
    // Filter out allowed addresses
    const normalizedAllowedAddresses = new Set(
      allowedAddresses.map(addr => String(addr).toLowerCase())
    );
    
    const blockedEth = addresses.ethereum.filter(addr => !normalizedAllowedAddresses.has(addr));
    const blockedSol = addresses.solana.filter(addr => !normalizedAllowedAddresses.has(addr.toLowerCase()));
    
    if (blockedEth.length > 0 || blockedSol.length > 0) {
      details.cryptoAddresses = {
        blocked: { ethereum: blockedEth, solana: blockedSol },
        allowed: {
          ethereum: addresses.ethereum.filter(addr => normalizedAllowedAddresses.has(addr)),
          solana: addresses.solana.filter(addr => normalizedAllowedAddresses.has(addr.toLowerCase()))
        }
      };
      
      logger?.debug?.('[ContentFilter] Blocked crypto address detected', details.cryptoAddresses);
      
      return {
        allowed: false,
        blocked: true,
        reason: 'Message contains blocked cryptocurrency address(es)',
        type: 'crypto_address',
        details
      };
    }
  }
  
  // Check for cashtags
  if (blockCashtags) {
    const cashtagResult = checkCashtags(text, allowedCashtags);
    
    if (cashtagResult.hasBlocked) {
      details.cashtags = cashtagResult;
      
      logger?.debug?.('[ContentFilter] Blocked cashtag detected', details.cashtags);
      
      return {
        allowed: false,
        blocked: true,
        reason: `Message contains blocked cashtag(s): ${cashtagResult.blocked.join(', ')}`,
        type: 'cashtag',
        details
      };
    }
  }
  
  return { allowed: true, blocked: false };
}

export default {
  isSolanaAddress,
  isEthAddress,
  isCashtag,
  containsCryptoAddress,
  containsUrl,
  extractCryptoAddresses,
  extractCashtags,
  extractUrls,
  checkCashtags,
  filterCryptoAddresses,
  filterContent,
  sanitizeCryptoAddresses,
  stripUrls
};