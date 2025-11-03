/**
 * Common wallet and numeric formatting helpers shared across social/ avatar services.
 */

/**
 * Format a Solana (base58) address for display by keeping the first/last 4 chars.
 * @param {string} address
 * @returns {string}
 */
export function formatAddress(address) {
  if (typeof address !== 'string' || address.length < 8) {
    return address;
  }
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

/**
 * Convert a raw token amount (in smallest units) to UI string.
 * @param {string|number} amount
 * @param {number} decimals
 * @returns {string}
 */
export function formatTokenAmount(amount, decimals = 9) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) {
    return '0';
  }
  const uiAmount = numeric / Math.pow(10, decimals);
  return uiAmount.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

/**
 * Render large numbers using compact suffixes.
 * @param {number} value
 * @returns {string}
 */
export function formatLargeNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return '0';
  }
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
  return num.toFixed(2);
}
