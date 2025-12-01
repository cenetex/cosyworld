/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Content Filter Utility
 * Provides utilities for filtering and validating message content
 * to detect and reject messages containing cryptocurrency addresses.
 */

// Solana address pattern: Base58 encoded, 32-44 characters
// Valid Base58 characters: 1-9, A-H, J-N, P-Z, a-k, m-z (no 0, I, O, l)
// Note: We use inline patterns in functions to avoid global regex state issues

// Ethereum address pattern: 0x followed by 40 hex characters
const ETH_ADDRESS_REGEX = /\b0x[a-fA-F0-9]{40}\b/gi;

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

export default {
  isSolanaAddress,
  isEthAddress,
  containsCryptoAddress,
  extractCryptoAddresses,
  filterCryptoAddresses,
  sanitizeCryptoAddresses
};
