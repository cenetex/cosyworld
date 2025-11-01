import { formatAddress } from '../../../utils/walletFormatters.mjs';

const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_CACHE_MAX_ENTRIES = 100;

/**
 * Encapsulates wallet balance fetching/caching and holdings insights.
 */
export class WalletInsights {
  constructor(options = {}) {
    const {
      logger = console,
      getLambdaEndpoint,
      retryWithBackoff,
      getTokenInfo,
      cacheTtlMs = DEFAULT_CACHE_TTL_MS,
      cacheMaxEntries = DEFAULT_CACHE_MAX_ENTRIES,
    } = options;
    this.logger = logger;
    this.getLambdaEndpoint = typeof getLambdaEndpoint === 'function' ? getLambdaEndpoint : () => null;
    this.retryWithBackoff = typeof retryWithBackoff === 'function' ? retryWithBackoff : async (fn) => fn();
    this.getTokenInfo = typeof getTokenInfo === 'function' ? getTokenInfo : null;
    this.cacheTtlMs = cacheTtlMs;
    this.cacheMaxEntries = cacheMaxEntries;
    this.walletBalanceCache = new Map();
  }

  /**
   * Normalize lambda payload into cached snapshot shape.
   * @param {Object} payload
   * @returns {{ tokens: Array, assets: Array, meta: Object|null }}
   */
  #normalizeSnapshot(payload = {}) {
    const tokens = Array.isArray(payload?.tokens)
      ? payload.tokens
      : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.balances)
          ? payload.balances
          : [];

    const assets = Array.isArray(payload?.assets) ? payload.assets : [];

    const meta = {
      wallet: payload?.wallet || null,
      fetchedAt: payload?.fetchedAt || payload?.cache?.lastUpdatedISO || null,
      source: payload?.source || payload?.cache?.state || null,
      cache: payload?.cache || null,
    };

    return { tokens, assets, meta };
  }

  /**
   * Ensure we have a fresh snapshot for a wallet, fetching from Lambda if needed.
   * @param {string} walletAddress
   * @param {{ refresh?: 'force'|'if-stale'|'cache-only', bypassCache?: boolean }} options
   * @returns {Promise<{ tokens: Array, assets: Array, meta: Object|null, timestamp: number }>}
   */
  async #ensureWalletSnapshot(walletAddress, options = {}) {
    if (!walletAddress) {
      return { tokens: [], assets: [], meta: null, timestamp: Date.now() };
    }

    const { refresh = null, bypassCache = false } = options;
    const cached = this.walletBalanceCache.get(walletAddress);

    const shouldUseCache = !bypassCache
      && refresh !== 'force'
      && cached
      && (Date.now() - cached.timestamp) < this.cacheTtlMs;

    if (shouldUseCache) {
      return cached;
    }

    const lambdaEndpoint = this.getLambdaEndpoint?.();
    if (!lambdaEndpoint) {
      return cached || { tokens: [], assets: [], meta: null, timestamp: Date.now() };
    }

    const trimmedEndpoint = lambdaEndpoint.endsWith('/')
      ? lambdaEndpoint.slice(0, -1)
      : lambdaEndpoint;

    const url = new URL(`${trimmedEndpoint}/balances`);
    url.searchParams.set('wallet', walletAddress);
    if (refresh) {
      url.searchParams.set('refresh', refresh);
    }

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
      const snapshot = this.#normalizeSnapshot(payload);
      const entry = {
        ...snapshot,
        timestamp: Date.now(),
      };

      this.walletBalanceCache.set(walletAddress, entry);
      this.#evictIfNeeded();

      return entry;
    } catch (error) {
      this.logger?.error?.(
        `[WalletInsights] Failed to fetch balances for ${formatAddress(walletAddress)}:`,
        error,
      );
      return cached || { tokens: [], assets: [], meta: null, timestamp: Date.now() };
    }
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
  async fetchWalletBalances(walletAddress, options = {}) {
    const snapshot = await this.#ensureWalletSnapshot(walletAddress, options);
    return snapshot.tokens;
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

    const explicitUiCandidates = [
      entry.uiAmount,
      entry.uiAmountString,
      entry.tokenAmount?.uiAmount,
      entry.tokenAmount?.uiAmountString,
    ];

    for (const candidate of explicitUiCandidates) {
      if (candidate !== undefined && candidate !== null && candidate !== '') {
        const parsed = Number(candidate);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }

    const candidateDecimals = Number.isFinite(entry.decimals)
      ? Number(entry.decimals)
      : Number.isFinite(entry.tokenAmount?.decimals)
        ? Number(entry.tokenAmount.decimals)
        : decimals;

    const rawCandidates = [
      entry.rawAmount,
      entry.tokenAmount?.rawAmount,
      entry.tokenAmount?.amount,
    ];
    for (const rawCandidate of rawCandidates) {
      if (rawCandidate === undefined || rawCandidate === null || rawCandidate === '') {
        continue;
      }
      const rawValue = Number(rawCandidate);
      if (!Number.isFinite(rawValue)) {
        continue;
      }

      if (!Number.isFinite(candidateDecimals) || candidateDecimals < 0) {
        continue;
      }

      return rawValue / Math.pow(10, candidateDecimals);
    }

    const amountCandidate = entry.amount ?? entry.balance;
    if (amountCandidate !== undefined && amountCandidate !== null && amountCandidate !== '') {
      const parsedAmount = Number(amountCandidate);
      if (Number.isFinite(parsedAmount)) {
        const treatAsUi = (typeof amountCandidate === 'string' && amountCandidate.includes('.'))
          || !Number.isInteger(parsedAmount)
          || candidateDecimals === 0;

        if (treatAsUi) {
          return parsedAmount;
        }

        if (!Number.isFinite(candidateDecimals) || candidateDecimals < 0) {
          return parsedAmount;
        }

        return parsedAmount / Math.pow(10, candidateDecimals);
      }
    }

    return 0;
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

    const snapshot = await this.#ensureWalletSnapshot(walletAddress);
    const balanceEntry = snapshot.tokens.find(entry => entry?.mint === tokenAddress);
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
    const snapshot = await this.#ensureWalletSnapshot(walletAddress);
    const entries = snapshot.tokens;

    if (!entries.length) {
      return [];
    }

    const candidateEntries = entries
      .map(entry => {
        const entryDecimals = Number.isFinite(entry?.decimals)
          ? Number(entry.decimals)
          : Number.isFinite(entry?.tokenAmount?.decimals)
            ? Number(entry.tokenAmount.decimals)
            : 9;
        const uiAmount = this.calculateUiAmountFromEntry(entry, entryDecimals);
        return { entry, uiAmount };
      })
      .filter(item => Number.isFinite(item.uiAmount) && item.uiAmount > 0)
      .sort((a, b) => b.uiAmount - a.uiAmount)
      .slice(0, maxLookups);

    const topTokens = [];

    for (const { entry, uiAmount } of candidateEntries) {
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

      const infoDecimals = Number.isFinite(tokenInfo?.decimals)
        ? Number(tokenInfo.decimals)
        : null;

      const decimals = Number.isFinite(entry.decimals)
        ? Number(entry.decimals)
        : infoDecimals ?? (Number.isFinite(entry.tokenAmount?.decimals)
          ? Number(entry.tokenAmount.decimals)
          : 9);

      const effectiveAmount = Number.isFinite(uiAmount)
        ? uiAmount
        : this.calculateUiAmountFromEntry(entry, decimals);
      if (!Number.isFinite(effectiveAmount) || effectiveAmount <= 0) {
        continue;
      }

      const usdValue = tokenInfo.usdPrice * effectiveAmount;
      if (usdValue < minUsd) {
        continue;
      }

      topTokens.push({
        symbol: tokenInfo.symbol || mint.slice(0, 6),
        name: tokenInfo.name || tokenInfo.symbol || mint.slice(0, 12),
        mint,
        amount: effectiveAmount,
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

  async getWalletAssets(walletAddress, options = {}) {
    const snapshot = await this.#ensureWalletSnapshot(walletAddress, options);
    return snapshot.assets || [];
  }

  getWalletSnapshotMetadata(walletAddress) {
    const cached = this.walletBalanceCache.get(walletAddress);
    return cached?.meta || null;
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
