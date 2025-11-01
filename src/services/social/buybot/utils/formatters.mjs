import { formatAddress, formatLargeNumber, formatTokenAmount } from '../../../../utils/walletFormatters.mjs';

export const EMOJI_SHORTCODE_MAP = Object.freeze({
  fire: '🔥',
  rocket: '🚀',
  moneybag: '💰',
  money_mouth_face: '🤑',
  coin: '🪙',
  sparkles: '✨',
  star: '⭐️',
  stars: '🌟',
  trophy: '🏆',
  crown: '👑',
  dragon: '🐉',
  tiger: '🐯',
  fox: '🦊',
  wolf: '🐺',
  panda_face: '🐼',
  koala: '🐨',
  whale: '🐋',
  shark: '🦈',
  dolphin: '🐬',
  unicorn: '🦄',
  robot: '🤖',
  alien: '👽',
  wizard: '🧙',
  mage: '🧙',
  crystal_ball: '🔮',
  diamond: '💎',
  boom: '💥',
  zap: '⚡️',
  lightning: '⚡️',
  sun: '☀️',
  moon: '🌙',
  comet: '☄️',
  cyclone: '🌀',
  snowflake: '❄️',
  anchor: '⚓️',
  globe: '🌐',
  earth_africa: '🌍',
  earth_americas: '🌎',
  earth_asia: '🌏',
  satellite: '🛰️',
  astronaut: '🧑‍🚀',
});

/**
 * Normalize emoji strings coming from avatar metadata.
 * Converts shortcode formats like :fire: and extracts actual pictographs from mixed strings.
 * @param {string} rawEmoji
 * @param {string} [fallback='✨']
 * @returns {string}
 */
export function getDisplayEmoji(rawEmoji, fallback = '✨') {
  if (!rawEmoji || typeof rawEmoji !== 'string') {
    return fallback;
  }

  const cleaned = rawEmoji.trim();
  if (!cleaned) {
    return fallback;
  }

  const shortcodeMatch = cleaned.match(/^:([a-z0-9_+\-]{1,30}):$/i);
  if (shortcodeMatch) {
    const emoji = EMOJI_SHORTCODE_MAP[shortcodeMatch[1].toLowerCase()];
    if (emoji) {
      return emoji;
    }
  }

  const pictographs = cleaned.match(/\p{Extended_Pictographic}/gu);
  if (pictographs && pictographs.length > 0) {
    return pictographs.slice(0, 2).join('');
  }

  return cleaned[0] || fallback;
}

/**
 * Get buy size multiplier emoji/text based on USD value.
 * @param {number} usdValue
 * @returns {string}
 */
export function getBuyMultiplier(usdValue) {
  if (!Number.isFinite(usdValue)) {
    return '';
  }
  if (usdValue >= 10000) return '$10,000+';
  if (usdValue >= 5000) return '$5,000';
  if (usdValue >= 1000) return '$1,000';
  if (usdValue >= 500) return '$500';
  if (usdValue >= 100) return '$100';
  if (usdValue >= 50) return '$50';
  if (usdValue >= 10) return '$10';
  return '';
}

/**
 * Calculate USD value of a token amount using decimals and price.
 * @param {number|string} amount
 * @param {number} decimals
 * @param {number} usdPrice
 * @returns {number}
 */
export function calculateUsdValue(amount, decimals, usdPrice) {
  const tokenAmount = parseFloat(amount) / Math.pow(10, decimals);
  return tokenAmount * usdPrice;
}

// Re-export commonly used formatters for convenience in buybot modules.
export { formatAddress, formatLargeNumber, formatTokenAmount };
