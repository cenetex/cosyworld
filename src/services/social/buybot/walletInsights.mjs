import { formatAddress } from '../../../utils/walletFormatters.mjs';

const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_CACHE_MAX_ENTRIES = 100;

/**
 * Encapsulates wallet balance fetching/caching and holdings insights.
 */
export class WalletInsights {
  constructor({
    logger = console,
    getLambdaEndpoint = () => null,
    retryWithBackoff = async (fn) => fn(),
    getTokenInfo,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    cacheMaxEntries = DEFAULT_CACHE_MAX_ENTRIES,
  } = {}) {
    this.logger = logger;
    this.getLambdaEndpoint = getLambdaEndpoint;
    this.retryWithBackoff = retryWithBackoff;
    this.getTokenInfo = getTokenInfo;
    this.cacheTtlMs = cacheTtlMs;
    this.cacheMaxEntries = cacheMaxEntries;
    this.walletBalanceCache = new Map();
  }

  /**
   * Update cache controls after construction.
   * @param {{ cacheTtlMs?: number, cacheMaxEntries?: number }} options
   */
  configure(options = {}) {
    if (Number.isFinite(options.cacheTtlMs)) {
      this.cacheTtlMs = options.cacheTtlMs;
    }
    if (Number.isFinite(options.cacheMaxEntries)) {
      this.cacheMaxEntries = options.cacheMaxEntries;
    }
  }

  /**
   * Override resolver callbacks used for external integrations.
   * @param {{ getLambdaEndpoint?: Function, retryWithBackoff?: Function, getTokenInfo?: Function }} resolvers
   */
  setResolvers(resolvers = {}) {
    const { getLambdaEndpoint, retryWithBackoff, getTokenInfo } = resolvers;
    if (typeof getLambdaEndpoint === 'function') {
      this.getLambdaEndpoint = getLambdaEndpoint;
    }
    if (typeof retryWithBackoff === 'function') {
      this.retryWithBackoff = retryWithBackoff;
    }
    if (typeof getTokenInfo === 'function') {
      this.getTokenInfo = getTokenInfo;
    }
  }

  /**
   * Drop all cached wallet balances.
   */
  clearCache() {
    this.walletBalanceCache.clear();
  }

  /**
   * Fetch SPL token balances for a wallet using the buybot Lambda endpoint.
   * @param {string} walletAddress
   * @returns {Promise<Array>}
   */
  async fetchWalletBalances(walletAddress) {
    if (!walletAddress) {
      return [];
    }

    const cached = this.walletBalanceCache.get(walletAddress);
    if (cached && (Date.now() - cached.timestamp) < this.cacheTtlMs) {
      return cached.entries;
    }

    const lambdaEndpoint = this.getLambdaEndpoint?.();
    if (!lambdaEndpoint) {
      return cached ? cached.entries : [];
    }

    const trimmedEndpoint = lambdaEndpoint.endsWith('/')
      ? lambdaEndpoint.slice(0, -1)
      : lambdaEndpoint;

    const url = new URL(`${trimmedEndpoint}/balances`);
    url.searchParams.set('wallet', walletAddress);

    try {
      const response = await this.retryWithBackoff(async () => {
        const res = await fetch(url.toString(), { headers: { accept: 'application/json' } });
        if (res.ok) {
          return res;
        }

        const errorBody = await res.text().catch(() => '');
        throw new Error(`Lambda balances request failed (${res.status}): ${errorBody}`);
      }, 3, 500);

      const payload = await response.json().catch(() => ({}));
      const entries = Array.isArray(payload?.data) ? payload.data : [];

      this.walletBalanceCache.set(walletAddress, {
        entries,
        timestamp: Date.now(),
      });

      this.#evictIfNeeded();

      return entries;
    } catch (error) {
      this.logger?.error?.(
        `[WalletInsights] Failed to fetch balances for ${formatAddress(walletAddress)}:`,
        error,
      );
      return cached ? cached.entries : [];
    }
  }

  /**
   * Convert lambda balance entry to UI amount using decimals.
   * @param {Object} entry
   * @param {number} decimals
   * @returns {number}
   */
  calculateUiAmountFromEntry(entry, decimals = 9) {
    if (!entry) {
      return 0;
    }

    if (entry.uiAmount !== undefined && entry.uiAmount !== null && entry.uiAmount !== '') {
      const uiAmount = Number(entry.uiAmount);
      if (Number.isFinite(uiAmount)) {
        return uiAmount;
      }
    }

    const rawAmount = Number(entry.amount ?? entry.rawAmount ?? 0);
    if (!Number.isFinite(rawAmount) || rawAmount === 0) {
      return 0;
    }

    const tokenDecimals = Number.isFinite(entry.decimals)
      ? Number(entry.decimals)
      : decimals;

    return rawAmount / Math.pow(10, tokenDecimals);
  }

  /**
   * Read wallet balance for specific mint.
   * @param {string} walletAddress
   * @param {string} tokenAddress
   * @param {number} [tokenDecimals=9]
   * @returns {Promise<number>}
   */
  async getWalletTokenBalance(walletAddress, tokenAddress, tokenDecimals = 9) {
    if (!walletAddress || !tokenAddress) {
      return 0;
    }

    const entries = await this.fetchWalletBalances(walletAddress);
    const balanceEntry = entries.find(entry => entry?.mint === tokenAddress);
    if (!balanceEntry) {
      return 0;
    }

    let decimals = Number.isFinite(tokenDecimals) ? tokenDecimals : null;
    if (!Number.isFinite(decimals) && this.getTokenInfo) {
      try {
        const tokenInfo = await this.getTokenInfo(tokenAddress);
        decimals = tokenInfo?.decimals ?? 9;
      } catch (err) {
        this.logger?.warn?.(`[WalletInsights] Could not load decimals for ${formatAddress(tokenAddress)}: ${err.message}`);
        decimals = 9;
      }
    }

    const uiAmount = this.calculateUiAmountFromEntry(balanceEntry, decimals);
    return Number.isFinite(uiAmount) ? uiAmount : 0;
  }

  /**
   * Determine top token holdings for wallet.
   * @param {string} walletAddress
   * @param {{ minUsd?: number, limit?: number, maxLookups?: number }} [options]
   * @returns {Promise<Array>}
   */
  async getWalletTopTokens(walletAddress, options = {}) {
    const { minUsd = 5, limit = 5, maxLookups = 12 } = options;
    const entries = await this.fetchWalletBalances(walletAddress);

    if (!entries.length) {
      return [];
    }

    const sortedEntries = entries
      .filter(entry => {
        const amount = Number(entry?.amount ?? entry?.uiAmount ?? 0);
        return Number.isFinite(amount) && amount > 0;
      })
      .sort((a, b) => {
        const amountA = Number(a.amount ?? 0);
        const amountB = Number(b.amount ?? 0);
        return amountB - amountA;
      })
      .slice(0, maxLookups);

    const topTokens = [];

    for (const entry of sortedEntries) {
      const mint = entry?.mint;
      if (!mint) {
        continue;
      }

      let tokenInfo = null;
      try {
        tokenInfo = this.getTokenInfo ? await this.getTokenInfo(mint) : null;
      } catch (err) {
        this.logger?.warn?.(
          `[WalletInsights] Failed to fetch token info for mint ${formatAddress(mint)}: ${err.message}`,
        );
        continue;
      }

      if (!tokenInfo || !tokenInfo.usdPrice) {
        continue;
      }

      const decimals = Number.isFinite(entry.decimals)
        ? Number(entry.decimals)
        : tokenInfo.decimals ?? 9;

      const uiAmount = this.calculateUiAmountFromEntry(entry, decimals);
      if (!Number.isFinite(uiAmount) || uiAmount <= 0) {
        continue;
      }

      const usdValue = tokenInfo.usdPrice * uiAmount;
      if (usdValue < minUsd) {
        continue;
      }

      topTokens.push({
        symbol: tokenInfo.symbol || mint.slice(0, 6),
        name: tokenInfo.name || tokenInfo.symbol || mint.slice(0, 12),
        mint,
        amount: uiAmount,
        usdValue,
        price: tokenInfo.usdPrice,
        decimals,
      });

      if (topTokens.length >= limit) {
        break;
      }
    }

    return topTokens.sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0));
  }

  /**
   * Build extra token balance metadata for avatar persistence.
   * @param {Array} topTokens
   * @param {string|null} primarySymbol
   * @returns {Object|null}
   */
  buildAdditionalTokenBalances(topTokens = [], primarySymbol = null) {
    if (!Array.isArray(topTokens) || topTokens.length === 0) {
      return null;
    }

    const additionalBalances = {};

    for (const holding of topTokens) {
      const symbol = holding?.symbol || holding?.mint;
      if (!symbol) {
        continue;
      }

      if (primarySymbol && symbol === primarySymbol) {
        continue;
      }

      additionalBalances[symbol] = {
        balance: Number.isFinite(holding.amount) ? holding.amount : 0,
        usdValue: Number.isFinite(holding.usdValue) ? holding.usdValue : null,
        mint: holding.mint || null,
        priceUsd: Number.isFinite(holding.price) ? holding.price : null,
        decimals: Number.isFinite(holding.decimals) ? holding.decimals : null,
        lastUpdated: new Date(),
      };
    }

    return Object.keys(additionalBalances).length ? additionalBalances : null;
  }

  /**
   * Assemble wallet context for avatar creation/update.
   * @param {string} walletAddress
   * @param {Object} token
   * @param {number} tokenDecimals
   * @param {{ minUsd?: number, limit?: number }} [options]
   * @returns {Promise<{ currentBalance: number, currentBalanceUsd: number|null, holdingsSnapshot: Array, additionalTokenBalances: Object|null }>}
   */
  async buildWalletAvatarContext(walletAddress, token, tokenDecimals, options = {}) {
    const { minUsd = 5, limit = 5 } = options;

    const currentBalance = await this.getWalletTokenBalance(walletAddress, token.tokenAddress, tokenDecimals);
    const topTokens = await this.getWalletTopTokens(walletAddress, { minUsd, limit });

    const currentBalanceUsd = token.usdPrice ? currentBalance * token.usdPrice : null;
    const includePrimary = Number.isFinite(currentBalanceUsd) && currentBalanceUsd >= minUsd;

    const primaryEntry = {
      symbol: token.tokenSymbol || token.tokenAddress?.slice(0, 6) || 'TOKEN',
      name: token.tokenName || token.tokenSymbol || token.tokenAddress,
      mint: token.tokenAddress,
      amount: currentBalance,
      usdValue: currentBalanceUsd,
      price: token.usdPrice || null,
      decimals: tokenDecimals,
    };

    const holdingsSnapshot = [...topTokens];
    const existingIndex = holdingsSnapshot.findIndex(holding => holding.mint === token.tokenAddress);

    if (includePrimary) {
      if (existingIndex >= 0) {
        holdingsSnapshot[existingIndex] = primaryEntry;
      } else {
        holdingsSnapshot.unshift(primaryEntry);
      }
    }

    const sanitizedSnapshot = holdingsSnapshot
      .map(holding => ({
        symbol: holding.symbol || holding.mint,
        name: holding.name || holding.symbol || holding.mint,
        mint: holding.mint,
        amount: Number.isFinite(holding.amount) ? Math.round(holding.amount * 1e4) / 1e4 : 0,
        usdValue: Number.isFinite(holding.usdValue) ? Math.round(holding.usdValue * 100) / 100 : null,
        price: Number.isFinite(holding.price) ? Math.round(holding.price * 1e6) / 1e6 : null,
        decimals: Number.isFinite(holding.decimals) ? holding.decimals : null,
      }))
      .filter(holding => holding.symbol && holding.mint)
      .sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0))
      .slice(0, limit);

    const additionalTokenBalances = this.buildAdditionalTokenBalances(sanitizedSnapshot, token.tokenSymbol);

    return {
      currentBalance,
      currentBalanceUsd,
      holdingsSnapshot: sanitizedSnapshot,
      additionalTokenBalances,
    };
  }

  #evictIfNeeded() {
    if (this.walletBalanceCache.size <= this.cacheMaxEntries) {
      return;
    }

    let oldestKey = null;
    let oldestTs = Number.POSITIVE_INFINITY;

    for (const [key, value] of this.walletBalanceCache.entries()) {
      if (value.timestamp < oldestTs) {
        oldestTs = value.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.walletBalanceCache.delete(oldestKey);
    }
  }
}

export default WalletInsights;
