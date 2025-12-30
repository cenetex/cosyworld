/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Telegram Context Manager
 * Handles retrieval and caching of context data (Persona, Buybot context)
 */

import { CACHE_CONFIG } from './constants.mjs';

export class ContextManager {
  constructor({ logger, databaseService, globalBotService, buybotService, cacheManager }) {
    this.logger = logger;
    this.databaseService = databaseService;
    this.globalBotService = globalBotService;
    this.buybotService = buybotService;
    this.cache = cacheManager;
    
    // Cache references
    this.personaCache = this.cache.personaCache;
    this.buybotCache = this.cache.buybotCache;
    
    // Config
    this.BUYBOT_CACHE_TTL = CACHE_CONFIG.BUYBOT_TTL_MS;
    this.PERSONA_CACHE_TTL = CACHE_CONFIG.PERSONA_TTL_MS;
  }

  /**
   * Get cached bot persona
   * @returns {Promise<Object|null>}
   */
  async getPersona() {
    const now = Date.now();
    if (this.personaCache.data && now < this.personaCache.expiry) {
      this.logger?.debug?.('[ContextManager] Using cached persona');
      return this.personaCache.data;
    }
    
    try {
      if (!this.globalBotService?.bot) {
        return null;
      }
      
      const persona = await this.globalBotService.getPersona();
      this.personaCache.data = persona;
      this.personaCache.expiry = now + this.PERSONA_CACHE_TTL;
      this.logger?.debug?.('[ContextManager] Fetched and cached fresh persona');
      return persona;
    } catch (e) {
      this.logger?.debug?.('[ContextManager] Could not load bot persona:', e.message);
      return null;
    }
  }

  /**
   * Get cached buybot context
   * @param {string} channelId
   * @returns {Promise<string|null>}
   */
  async getBuybotContext(channelId) {
    const now = Date.now();
    const cached = this.buybotCache.get(channelId);
    
    if (cached && now < cached.expiry) {
      this.logger?.debug?.(`[ContextManager] Using cached buybot context for ${channelId}`);
      return cached.data;
    }
    
    try {
      const data = await this._fetchBuybotContext(channelId);
      this.buybotCache.set(channelId, { 
        data, 
        expiry: now + this.BUYBOT_CACHE_TTL 
      });
      this.logger?.debug?.(`[ContextManager] Fetched and cached fresh buybot context for ${channelId}`);
      return data;
    } catch (e) {
      this.logger?.error?.('[ContextManager] Failed to get buybot context:', e);
      return null;
    }
  }

  /**
   * Fetch buybot context from database
   * @private
   */
  async _fetchBuybotContext(channelId) {
    try {
      if (!this.buybotService) return null;

      const db = await this.databaseService.getDatabase();
      
      // Get tracked tokens for this channel
      const trackedTokens = await db.collection('buybot_tracked_tokens')
        .find({ channelId, active: true })
        .toArray();

      if (trackedTokens.length === 0) return null;

      // Build simple context with token info and contract addresses
      let context = `📊 Tracked Tokens (${trackedTokens.length}):\n`;
      
      for (const token of trackedTokens) {
        context += `\n${token.tokenSymbol} (${token.tokenName})\n`;
        context += `  CA: \`${token.tokenAddress}\`\n`;
      }

      // Get recent activity summaries from Discord channels
      const tokenAddresses = trackedTokens.map(t => t.tokenAddress);
      const recentSummaries = await db.collection('buybot_activity_summaries')
        .find({
          tokenAddresses: { $in: tokenAddresses }
        })
        .sort({ createdAt: -1 })
        .limit(3)  // Last 3 summaries
        .toArray();
      
      if (recentSummaries.length > 0) {
        context += `\n\n💬 Recent Discord Activity:\n`;
        for (const summary of recentSummaries) {
          const timeAgo = Math.floor((Date.now() - summary.createdAt.getTime()) / 60000); // minutes
          const timeStr = timeAgo < 60 ? `${timeAgo}m ago` : `${Math.floor(timeAgo / 60)}h ago`;
          context += `• ${summary.summary} (${timeStr})\n`;
        }
      }

      return context.trim();
    } catch (error) {
      this.logger?.error?.('[ContextManager] Failed to fetch buybot context:', error);
      return null;
    }
  }

  /**
   * Get wallet holdings context for an avatar with a wallet address
   * @param {string} walletAddress - The wallet address to fetch holdings for
   * @param {Object} options
   * @param {number} options.limit - Max number of holdings to include (default: 5)
   * @param {number} options.minUsd - Minimum USD value to include (default: 1)
   * @returns {Promise<string|null>} Formatted holdings context string
   */
  async getWalletHoldingsContext(walletAddress, { limit = 5, minUsd = 1 } = {}) {
    if (!walletAddress) return null;
    
    try {
      // Access walletInsights through buybotService
      const walletInsights = this.buybotService?.walletInsights;
      if (!walletInsights) {
        this.logger?.debug?.('[ContextManager] WalletInsights not available');
        return null;
      }
      
      const topTokens = await walletInsights.getWalletTopTokens(walletAddress, { limit, minUsd });
      
      if (!topTokens || topTokens.length === 0) {
        return null;
      }
      
      // Format holdings for the AI context
      let context = `💰 Your Wallet Holdings (Top ${topTokens.length}):\n`;
      
      for (let i = 0; i < topTokens.length; i++) {
        const token = topTokens[i];
        const usdFormatted = token.usdValue >= 1000 
          ? `$${(token.usdValue / 1000).toFixed(1)}k`
          : `$${token.usdValue.toFixed(2)}`;
        const amountFormatted = token.amount >= 1000000 
          ? `${(token.amount / 1000000).toFixed(2)}M`
          : token.amount >= 1000 
            ? `${(token.amount / 1000).toFixed(2)}k`
            : token.amount.toFixed(2);
        
        // Include 24h change if available
        const changeStr = token.change24h !== undefined 
          ? ` (${token.change24h >= 0 ? '+' : ''}${token.change24h.toFixed(1)}% 24h)`
          : '';
        
        context += `  ${i + 1}. $${token.symbol}: ${usdFormatted} (${amountFormatted} tokens)${changeStr}\n`;
      }
      
      context += `\nYou can reference your holdings naturally in conversation when relevant.`;
      
      return context.trim();
    } catch (error) {
      this.logger?.error?.('[ContextManager] Failed to get wallet holdings context:', error);
      return null;
    }
  }

  /**
   * Invalidate persona cache
   */
  invalidatePersonaCache() {
    this.personaCache.data = null;
    this.personaCache.expiry = 0;
    this.logger?.info?.('[ContextManager] Persona cache invalidated');
  }

  /**
   * Invalidate buybot cache for a channel
   * @param {string} channelId
   */
  invalidateBuybotCache(channelId) {
    this.buybotCache.delete(channelId);
    this.logger?.info?.(`[ContextManager] Buybot cache invalidated for ${channelId}`);
  }
}
