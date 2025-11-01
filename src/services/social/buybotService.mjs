/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * BuybotService - Real-time token tracking using AWS Lambda monitoring
 * 
 * Monitors Solana token purchases and transfers for designated tokens
 * Provides Discord commands to manage tracked tokens per channel
 * Uses AWS Lambda endpoint for transaction monitoring instead of direct Helius polling
 */

import {
  DEFAULT_ORB_COLLECTION_ADDRESS,
  POLLING_INTERVAL_MS,
  MAX_TRACKED_TOKENS_PER_CHANNEL,
  MAX_TRACKED_COLLECTIONS_PER_CHANNEL,
  MAX_TOTAL_ACTIVE_WEBHOOKS,
  API_RETRY_MAX_ATTEMPTS,
  API_RETRY_BASE_DELAY_MS,
  PRICE_CACHE_TTL_MS,
  RECENT_TRANSACTIONS_LIMIT
} from '../../config/buybotConstants.mjs';
import { formatTokenAmount, formatLargeNumber, formatAddress } from '../../utils/walletFormatters.mjs';

const EMOJI_SHORTCODE_MAP = Object.freeze({
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

export class BuybotService {
  constructor({ logger, databaseService, configService, discordService, getTelegramService, avatarService, avatarRelationshipService, services }) {
    this.logger = logger || console;
    this.databaseService = databaseService;
    this.configService = configService;
    this.discordService = discordService;
    this.getTelegramService = getTelegramService || (() => null); // Late-bound to avoid circular dependency
    this.avatarService = avatarService;
    this.avatarRelationshipService = avatarRelationshipService;
    this.services = services; // Container for late-bound service resolution
    
    // AWS Lambda endpoint for transaction monitoring
    this.lambdaEndpoint = null;
    this.activeWebhooks = new Map(); // channelId -> webhook data
    this.db = null;
    
    // Price cache: tokenAddress -> { price, marketCap, timestamp }
    this.priceCache = new Map();
    
    // Token info cache: tokenAddress -> { tokenInfo, timestamp }
    this.tokenInfoCache = new Map();
    
  // Wallet balance cache to avoid hammering the Lambda balances endpoint
  this.walletBalanceCache = new Map();
  this.WALLET_BALANCE_CACHE_TTL_MS = 30_000;
  this.WALLET_BALANCE_CACHE_MAX_ENTRIES = 100;

    // Volume tracking for Discord activity summaries
    // channelId -> { totalVolume, events: [], lastSummaryAt }
    this.volumeTracking = new Map();
    this.VOLUME_THRESHOLD_USD = 100; // Post summary after $100 in volume
    
    // Collection names
    this.TRACKED_TOKENS_COLLECTION = 'buybot_tracked_tokens';
    this.TOKEN_EVENTS_COLLECTION = 'buybot_token_events';
    this.TRACKED_COLLECTIONS_COLLECTION = 'buybot_tracked_collections';
    this.ACTIVITY_SUMMARIES_COLLECTION = 'buybot_activity_summaries'; // New collection for Discord summaries
  }

  /**
   * Initialize the service and Lambda endpoint connection
   */
  async initialize() {
    try {
      const lambdaEndpoint = process.env.BUYBOT_LAMBDA_ENDPOINT;
      if (!lambdaEndpoint) {
        this.logger.warn('[BuybotService] BUYBOT_LAMBDA_ENDPOINT not configured, service disabled');
        return;
      }

      this.lambdaEndpoint = lambdaEndpoint;
      
      this.db = await this.databaseService.getDatabase();
      
      // Initialize wallet avatar service
      if (this.walletAvatarService) {
        await this.walletAvatarService.initialize();
      }
      
      // Create indexes
      await this.ensureIndexes();
      
      // Load existing tracked tokens and setup webhooks
      await this.restoreTrackedTokens();
      
      this.logger.info('[BuybotService] Initialized successfully with Lambda endpoint:', this.lambdaEndpoint);
    } catch (error) {
      this.logger.error('[BuybotService] Initialization failed:', error);
    }
  }

  /**
   * Retry an async operation with exponential backoff
   * @param {Function} fn - Async function to retry
   * @param {number} maxAttempts - Maximum retry attempts
   * @param {number} baseDelay - Base delay in milliseconds
   * @returns {Promise<any>} Result of the function
   */
  async retryWithBackoff(fn, maxAttempts = API_RETRY_MAX_ATTEMPTS, baseDelay = API_RETRY_BASE_DELAY_MS) {
    let lastError;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        if (attempt < maxAttempts - 1) {
          const delay = baseDelay * Math.pow(2, attempt);
          this.logger.warn(`[BuybotService] Retry attempt ${attempt + 1}/${maxAttempts} after ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Ensure database indexes exist
   */
  async ensureIndexes() {
    try {
      await this.db.collection(this.TRACKED_TOKENS_COLLECTION).createIndexes([
        { key: { channelId: 1, tokenAddress: 1 }, unique: true, name: 'channel_token' },
        { key: { channelId: 1 }, name: 'channel_lookup' },
        { key: { tokenAddress: 1 }, name: 'token_lookup' },
      ]);

      await this.db.collection(this.TOKEN_EVENTS_COLLECTION).createIndexes([
        { key: { channelId: 1, timestamp: -1 }, name: 'channel_events' },
        { key: { tokenAddress: 1, timestamp: -1 }, name: 'token_events' },
        { key: { signature: 1 }, unique: true, name: 'signature_unique' },
        { key: { timestamp: -1 }, name: 'timestamp_lookup' },
      ]);

      await this.db.collection(this.TRACKED_COLLECTIONS_COLLECTION).createIndexes([
        { key: { channelId: 1, collectionAddress: 1 }, unique: true, name: 'channel_collection' },
        { key: { channelId: 1 }, name: 'collection_channel_lookup' },
        { key: { collectionAddress: 1 }, name: 'collection_lookup' },
      ]);

      this.logger.info('[BuybotService] Database indexes created');
    } catch (error) {
      this.logger.error('[BuybotService] Failed to create indexes:', error);
    }
  }

  /**
   * Restore tracked tokens from database on startup
   */
  async restoreTrackedTokens() {
    try {
      const trackedTokens = await this.db
        .collection(this.TRACKED_TOKENS_COLLECTION)
        .find({ active: true })
        .toArray();

      this.logger.info(`[BuybotService] Restoring ${trackedTokens.length} tracked tokens`);

      for (const token of trackedTokens) {
        await this.setupTokenWebhook(token.channelId, token.tokenAddress, token.platform || 'discord');
      }
    } catch (error) {
      this.logger.error('[BuybotService] Failed to restore tracked tokens:', error);
    }
  }

  /**
   * Add a token to track for a channel
   * @param {string} channelId - Channel ID (Discord or Telegram)
   * @param {string} tokenAddress - Solana token address
   * @param {string} platform - Platform type ('discord' or 'telegram')
   * @returns {Promise<Object>} Result object
   */
  async addTrackedToken(channelId, tokenAddress, platform = 'discord') {
    try {
      if (!this.lambdaEndpoint) {
        return { success: false, message: 'Buybot service not configured. Please set BUYBOT_LAMBDA_ENDPOINT.' };
      }

      // Check if total active webhooks limit reached
      if (this.activeWebhooks.size >= MAX_TOTAL_ACTIVE_WEBHOOKS) {
        return { 
          success: false, 
          message: `System limit reached: maximum ${MAX_TOTAL_ACTIVE_WEBHOOKS} total tracked tokens/collections across all channels.` 
        };
      }

      // Check per-channel limit
      const channelTokenCount = await this.db.collection(this.TRACKED_TOKENS_COLLECTION)
        .countDocuments({ channelId, active: true });
      
      if (channelTokenCount >= MAX_TRACKED_TOKENS_PER_CHANNEL) {
        return {
          success: false,
          message: `Channel limit reached: maximum ${MAX_TRACKED_TOKENS_PER_CHANNEL} tokens per channel. Remove some before adding more.`
        };
      }

      // Validate token address format (basic check)
      if (!tokenAddress || tokenAddress.length < 32 || tokenAddress.length > 44) {
        return { success: false, message: 'Invalid Solana token address format.' };
      }

      // Fetch token metadata
      const tokenInfo = await this.getTokenInfo(tokenAddress);
      if (!tokenInfo) {
        return { success: false, message: 'Could not fetch token information. Verify the address is correct.' };
      }

      // Check if already tracking
      const existing = await this.db.collection(this.TRACKED_TOKENS_COLLECTION).findOne({
        channelId,
        tokenAddress,
      });

      if (existing && existing.active) {
        return { 
          success: false, 
          message: `Already tracking ${tokenInfo.name || tokenAddress} in this channel.` 
        };
      }

      // Add or update token tracking
      await this.db.collection(this.TRACKED_TOKENS_COLLECTION).updateOne(
        { channelId, tokenAddress },
        {
          $set: {
            active: true,
            platform: platform || 'discord',
            tokenName: tokenInfo.name,
            tokenSymbol: tokenInfo.symbol,
            tokenDecimals: tokenInfo.decimals,
            usdPrice: tokenInfo.usdPrice || null, // Store USD price if available
            marketCap: tokenInfo.marketCap || null, // Store market cap if available
            lastPriceUpdate: new Date(), // Track when price was last updated
            mediaThresholds: {
              image: 100,  // Default: $100 for images
              video: 1000, // Default: $1000 for videos
            },
            customMedia: {
              image: null, // Custom image URL for small buys
              video: null, // Custom video URL for small buys
            },
            addedAt: new Date(),
            lastEventAt: null,
            errorCount: 0, // Initialize error counter
            lastErrorAt: null,
            warning: tokenInfo.warning || null, // Store any warnings about the token
          },
        },
        { upsert: true }
      );

      // Setup webhook for tracking
      await this.setupTokenWebhook(channelId, tokenAddress, platform);

      this.logger.info(`[BuybotService] Added tracking for ${tokenInfo.symbol} (${tokenAddress}) in channel ${channelId}`);

      return {
        success: true,
        message: `Now tracking **${tokenInfo.name}** (${tokenInfo.symbol})`,
        tokenInfo,
      };
    } catch (error) {
      this.logger.error('[BuybotService] Failed to add tracked token:', error);
      return { success: false, message: `Error: ${error.message}` };
    }
  }

  /**
   * Remove a token from tracking for a channel
   * @param {string} channelId - Discord channel ID
   * @param {string} tokenAddress - Solana token address
   * @returns {Promise<Object>} Result object
   */
  async removeTrackedToken(channelId, tokenAddress) {
    try {
      const token = await this.db.collection(this.TRACKED_TOKENS_COLLECTION).findOne({
        channelId,
        tokenAddress,
      });

      if (!token || !token.active) {
        return { success: false, message: 'Token not currently tracked in this channel.' };
      }

      // Mark as inactive
      await this.db.collection(this.TRACKED_TOKENS_COLLECTION).updateOne(
        { channelId, tokenAddress },
        { $set: { active: false, removedAt: new Date() } }
      );

      // Remove webhook if no other channels tracking
      await this.cleanupTokenWebhook(tokenAddress);

      this.logger.info(`[BuybotService] Removed tracking for ${token.tokenSymbol} in channel ${channelId}`);

      return {
        success: true,
        message: `Stopped tracking **${token.tokenName}** (${token.tokenSymbol})`,
      };
    } catch (error) {
      this.logger.error('[BuybotService] Failed to remove tracked token:', error);
      return { success: false, message: `Error: ${error.message}` };
    }
  }

  /**
   * Get all tracked tokens for a channel
   * @param {string} channelId - Discord channel ID
   * @returns {Promise<Array>} Array of tracked tokens
   */
  async getTrackedTokens(channelId) {
    try {
      return await this.db
        .collection(this.TRACKED_TOKENS_COLLECTION)
        .find({ channelId, active: true })
        .toArray();
    } catch (error) {
      this.logger.error('[BuybotService] Failed to get tracked tokens:', error);
      return [];
    }
  }

  /**
   * Get service status
   * @returns {Object} Status object
   */
  getServiceStatus() {
    return {
      lambdaEndpoint: this.lambdaEndpoint,
      activeWebhooks: this.activeWebhooks.size,
      cachedPrices: this.priceCache.size,
      cachedTokenInfo: this.tokenInfoCache.size,
    };
  }

  /**
   * Set media generation thresholds for a tracked token
   * @param {string} channelId - Channel ID
   * @param {string} tokenAddress - Token address
   * @param {number} imageThreshold - USD threshold for image generation
   * @param {number} videoThreshold - USD threshold for video generation
   * @returns {Promise<Object>} Result object
   */
  async setMediaThresholds(channelId, tokenAddress, imageThreshold, videoThreshold) {
    try {
      const token = await this.db.collection(this.TRACKED_TOKENS_COLLECTION).findOne({
        channelId,
        tokenAddress,
        active: true,
      });

      if (!token) {
        return { success: false, message: 'Token not currently tracked in this channel.' };
      }

      await this.db.collection(this.TRACKED_TOKENS_COLLECTION).updateOne(
        { channelId, tokenAddress },
        {
          $set: {
            mediaThresholds: {
              image: imageThreshold,
              video: videoThreshold,
            },
          },
        }
      );

      this.logger.info(`[BuybotService] Updated media thresholds for ${token.tokenSymbol}: image=$${imageThreshold}, video=$${videoThreshold}`);

      return {
        success: true,
        message: `Media thresholds updated for **${token.tokenName}** (${token.tokenSymbol})`,
      };
    } catch (error) {
      this.logger.error('[BuybotService] Failed to set media thresholds:', error);
      return { success: false, message: `Error: ${error.message}` };
    }
  }

  /**
   * Set custom media for a tracked token (for small buys)
   * @param {string} channelId - Channel ID
   * @param {string} tokenAddress - Token address
   * @param {string} mediaUrl - URL of the media (image or video)
   * @param {string} mediaType - Type of media ('image' or 'video')
   * @returns {Promise<Object>} Result object
   */
  async setCustomMedia(channelId, tokenAddress, mediaUrl, mediaType) {
    try {
      const token = await this.db.collection(this.TRACKED_TOKENS_COLLECTION).findOne({
        channelId,
        tokenAddress,
        active: true,
      });

      if (!token) {
        return { success: false, message: 'Token not currently tracked in this channel.' };
      }

      if (!['image', 'video'].includes(mediaType)) {
        return { success: false, message: 'Media type must be "image" or "video".' };
      }

      const updateField = mediaType === 'image' ? 'customMedia.image' : 'customMedia.video';

      await this.db.collection(this.TRACKED_TOKENS_COLLECTION).updateOne(
        { channelId, tokenAddress },
        {
          $set: {
            [updateField]: mediaUrl,
          },
        }
      );

      this.logger.info(`[BuybotService] Set custom ${mediaType} for ${token.tokenSymbol}: ${mediaUrl}`);

      return {
        success: true,
        message: `Custom ${mediaType} set for **${token.tokenName}** (${token.tokenSymbol})`,
        mediaType,
        mediaUrl,
      };
    } catch (error) {
      this.logger.error('[BuybotService] Failed to set custom media:', error);
      return { success: false, message: `Error: ${error.message}` };
    }
  }

  /**
   * Track an NFT collection for a channel
   * @param {string} channelId - Telegram channel ID
   * @param {string} collectionAddress - NFT collection address
   * @param {Object} options - Optional settings (name, notifyMint, notifyTransfer, notifySale)
   * @returns {Promise<Object>} Result object
   */
  async trackCollection(channelId, collectionAddress, options = {}) {
    try {
      if (!this.isValidSolanaAddress(collectionAddress)) {
        return { success: false, message: 'Invalid Solana address format.' };
      }

      // Check per-channel limit
      const channelCollectionCount = await this.db.collection(this.TRACKED_COLLECTIONS_COLLECTION)
        .countDocuments({ channelId, active: true });
      
      if (channelCollectionCount >= MAX_TRACKED_COLLECTIONS_PER_CHANNEL) {
        return {
          success: false,
          message: `Channel limit reached: maximum ${MAX_TRACKED_COLLECTIONS_PER_CHANNEL} collections per channel. Remove some before adding more.`
        };
      }

      // Check if already tracking
      const existing = await this.db.collection(this.TRACKED_COLLECTIONS_COLLECTION).findOne({
        channelId,
        collectionAddress,
        active: true,
      });

      if (existing) {
        return {
          success: false,
          message: `Already tracking collection **${existing.collectionName || collectionAddress}**`,
        };
      }

      // Get collection info from DexScreener or use provided name
      let collectionName = options.name || 'Unknown Collection';
      
      // Note: NFT collection metadata fetching not currently implemented
      // Using provided name or default
      this.logger.debug(`[BuybotService] Using collection name: ${collectionName}`);

      // Store tracking info
      const collectionDoc = {
        channelId,
        collectionAddress,
        collectionName,
        platform: 'telegram',
        notifyMint: options.notifyMint !== false, // Default true
        notifyTransfer: options.notifyTransfer !== false, // Default true
        notifySale: options.notifySale !== false, // Default true
        active: true,
        trackedAt: new Date(),
      };

      await this.db.collection(this.TRACKED_COLLECTIONS_COLLECTION).insertOne(collectionDoc);

      this.logger.info(`[BuybotService] Started tracking collection ${collectionName} (${collectionAddress}) in channel ${channelId}`);

      return {
        success: true,
        message: `Now tracking **${collectionName}** NFT collection`,
        collection: collectionDoc,
      };
    } catch (error) {
      this.logger.error('[BuybotService] Failed to track collection:', error);
      return { success: false, message: `Error: ${error.message}` };
    }
  }

  /**
   * Remove NFT collection from tracking
   * @param {string} channelId - Channel ID
   * @param {string} collectionAddress - Collection address
   * @returns {Promise<Object>} Result object
   */
  async removeTrackedCollection(channelId, collectionAddress) {
    try {
      const collection = await this.db.collection(this.TRACKED_COLLECTIONS_COLLECTION).findOne({
        channelId,
        collectionAddress,
      });

      if (!collection || !collection.active) {
        return { success: false, message: 'Collection not currently tracked in this channel.' };
      }

      // Mark as inactive
      await this.db.collection(this.TRACKED_COLLECTIONS_COLLECTION).updateOne(
        { channelId, collectionAddress },
        { $set: { active: false, removedAt: new Date() } }
      );

      this.logger.info(`[BuybotService] Removed tracking for collection ${collection.collectionName} in channel ${channelId}`);

      return {
        success: true,
        message: `Stopped tracking **${collection.collectionName}** NFT collection`,
      };
    } catch (error) {
      this.logger.error('[BuybotService] Failed to remove tracked collection:', error);
      return { success: false, message: `Error: ${error.message}` };
    }
  }

  /**
   * Get all tracked NFT collections for a channel
   * @param {string} channelId - Channel ID
   * @returns {Promise<Array>} Array of tracked collections
   */
  async getTrackedCollections(channelId) {
    try {
      return await this.db
        .collection(this.TRACKED_COLLECTIONS_COLLECTION)
        .find({ channelId, active: true })
        .toArray();
    } catch (error) {
      this.logger.error('[BuybotService] Failed to get tracked collections:', error);
      return [];
    }
  }

  /**
   * Get wallet's total NFT count across all tracked collections for a channel
   * Falls back to default ORB collection if no collections are tracked
   * @param {string} walletAddress - Wallet address
   * @param {string} channelId - Channel ID
   * @returns {Promise<number>} Total NFT count
   */
  async getWalletNftCountForChannel(walletAddress, channelId) {
    try {
      const trackedCollections = await this.getTrackedCollections(channelId);
      
      if (trackedCollections.length === 0) {
        // Fallback to default ORB collection if no collections tracked
        return await this.getWalletNftCount(walletAddress, DEFAULT_ORB_COLLECTION_ADDRESS);
      }

      let totalCount = 0;
      for (const collection of trackedCollections) {
        const count = await this.getWalletNftCount(walletAddress, collection.collectionAddress);
        totalCount += count;
      }
      
      return totalCount;
    } catch (error) {
      this.logger.error('[BuybotService] Failed to get wallet NFT count for channel:', error);
      return 0;
    }
  }

  /**
   * Validate Solana token address format
   * @param {string} address - Token address to validate
   * @returns {boolean}
   */
  isValidSolanaAddress(address) {
    // Solana addresses are base58 encoded, 32-44 characters
    if (!address || typeof address !== 'string') return false;
    if (address.length < 32 || address.length > 44) return false;
    
    // Check for valid base58 characters only
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
    return base58Regex.test(address);
  }

  /**
   * Get token price from DexScreener API with caching and retry
   * @param {string} tokenAddress - Token address
   * @returns {Promise<Object|null>}
   */
  async getPriceFromDexScreener(tokenAddress) {
    try {
      // Check cache first
      const cached = this.priceCache.get(tokenAddress);
      if (cached && (Date.now() - cached.timestamp) < PRICE_CACHE_TTL_MS) {
        this.logger.debug(`[BuybotService] Using cached price for ${tokenAddress}`);
        return {
          usdPrice: cached.price,
          marketCap: cached.marketCap,
          liquidity: cached.liquidity,
          name: cached.name,
          symbol: cached.symbol,
          image: cached.image
        };
      }

      // Fetch with retry and backoff
      const data = await this.retryWithBackoff(async () => {
        const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
        if (!response.ok) {
          throw new Error(`DexScreener API returned ${response.status}`);
        }
        return await response.json();
      });

      if (!data || !data.pairs || data.pairs.length === 0) {
        this.logger.debug(`[BuybotService] No pairs found on DexScreener for ${tokenAddress}`);
        return null;
      }

      // Get the most liquid pair (highest liquidity)
      const bestPair = data.pairs.reduce((best, pair) => {
        const liquidity = pair.liquidity?.usd || 0;
        const bestLiquidity = best?.liquidity?.usd || 0;
        return liquidity > bestLiquidity ? pair : best;
      }, data.pairs[0]);

      if (!bestPair || !bestPair.priceUsd) {
        this.logger.debug(`[BuybotService] No valid price found on DexScreener for ${tokenAddress}`);
        return null;
      }

      const result = {
        usdPrice: parseFloat(bestPair.priceUsd),
        marketCap: bestPair.fdv || bestPair.marketCap,
        liquidity: bestPair.liquidity?.usd,
        name: bestPair.baseToken?.name || 'Unknown Token',
        symbol: bestPair.baseToken?.symbol || 'UNKNOWN',
        image: bestPair.info?.imageUrl || null,
      };

      // Cache the result
      this.priceCache.set(tokenAddress, {
        price: result.usdPrice,
        marketCap: result.marketCap,
        liquidity: result.liquidity,
        name: result.name,
        symbol: result.symbol,
        image: result.image,
        timestamp: Date.now()
      });

      this.logger.info(`[BuybotService] Got price from DexScreener: ${result.usdPrice} USD for ${result.symbol} (${tokenAddress})`);
      
      return result;
    } catch (error) {
      this.logger.error(`[BuybotService] Failed to fetch price from DexScreener:`, error);
      return null;
    }
  }

  /**
   * Get token info from DexScreener
   * @param {string} tokenAddress - Token address
   * @returns {Promise<Object|null>}
   */
  async getTokenInfo(tokenAddress) {
    try {
      // Check cache first
      const cached = this.tokenInfoCache.get(tokenAddress);
      if (cached && (Date.now() - cached.timestamp) < PRICE_CACHE_TTL_MS) {
        this.logger.debug(`[BuybotService] Using cached token info for ${tokenAddress}`);
        return cached.tokenInfo;
      }
      
      // First validate the address format
      if (!this.isValidSolanaAddress(tokenAddress)) {
        this.logger.warn(`[BuybotService] Invalid Solana address format: ${tokenAddress}`);
        return null;
      }

      // Use DexScreener as primary source for token info
      this.logger.info(`[BuybotService] Fetching token info from DexScreener for ${tokenAddress}...`);
      const dexScreenerData = await this.getPriceFromDexScreener(tokenAddress);
      
      if (dexScreenerData) {
        const tokenInfo = {
          address: tokenAddress,
          name: dexScreenerData.name || 'Unknown Token',
          symbol: dexScreenerData.symbol || 'UNKNOWN',
          decimals: 9, // Default for SPL tokens
          supply: null,
          image: dexScreenerData.image || null,
          usdPrice: dexScreenerData.usdPrice || null,
          marketCap: dexScreenerData.marketCap || null,
        };
        
        // Cache the token info
        this.tokenInfoCache.set(tokenAddress, {
          tokenInfo,
          timestamp: Date.now()
        });
        
        this.logger.info(`[BuybotService] Successfully fetched token info for ${tokenInfo.symbol} (${tokenAddress})`);
        return tokenInfo;
      }

      // If DexScreener doesn't have the token, return minimal info
      this.logger.warn(`[BuybotService] Token ${tokenAddress} not found in DexScreener`);
      const tokenInfo = {
        address: tokenAddress,
        name: 'Unknown Token',
        symbol: 'UNKNOWN',
        decimals: 9, // Default for SPL tokens
        supply: null,
        image: null,
        usdPrice: null,
        marketCap: null,
        warning: 'Token not found - may be newly created or invalid',
      };
      
      // Cache the fallback token info
      this.tokenInfoCache.set(tokenAddress, {
        tokenInfo,
        timestamp: Date.now()
      });
      
      return tokenInfo;
    } catch (error) {
      this.logger.error(`[BuybotService] Failed to fetch token info for ${tokenAddress}:`, error);
      return null;
    }
  }

  /**
   * Setup Lambda-based monitoring for token tracking
   * @param {string} channelId - Channel ID
   * @param {string} tokenAddress - Token address to track
   * @param {string} platform - Platform type ('discord' or 'telegram')
   */
  async setupTokenWebhook(channelId, tokenAddress, platform = 'discord') {
    try {
      if (!this.lambdaEndpoint) return;

      // Use Lambda endpoint to monitor token transfers via polling
      this.startPollingToken(channelId, tokenAddress, platform);

      this.logger.info(`[BuybotService] Setup monitoring for ${tokenAddress} in ${channelId} (${platform})`);
    } catch (error) {
      this.logger.error('[BuybotService] Failed to setup webhook:', error);
    }
  }

  /**
   * Start polling for token transactions
   * @param {string} channelId - Channel ID
   * @param {string} tokenAddress - Token address
   * @param {string} platform - Platform type ('discord' or 'telegram')
   */
  startPollingToken(channelId, tokenAddress, platform = 'discord') {
    const key = `${channelId}:${tokenAddress}`;
    
    if (this.activeWebhooks.has(key)) {
      return; // Already polling
    }

    // Poll at regular intervals
    const doPoll = async () => {
      try {
        await this.checkTokenTransactions(channelId, tokenAddress, platform);
      } catch (error) {
        this.logger.error(`[BuybotService] Polling error for ${tokenAddress}:`, error);
      }
      
      // Schedule next poll
      const webhookData = this.activeWebhooks.get(key);
      if (webhookData) {
        webhookData.pollTimeout = setTimeout(doPoll, POLLING_INTERVAL_MS);
        webhookData.lastChecked = Date.now();
      }
    };

    // Store webhook data
    const webhookData = {
      channelId,
      tokenAddress,
      platform,
      pollTimeout: setTimeout(doPoll, POLLING_INTERVAL_MS),
      lastChecked: Date.now(),
    };
    
    this.activeWebhooks.set(key, webhookData);

    this.logger.info(`[BuybotService] Started polling for ${tokenAddress} in channel ${channelId} (${platform})`);
  }

  /**
   * Stop polling for a specific token
   * @param {string} channelId - Channel ID  
   * @param {string} tokenAddress - Token address
   * @param {string} platform - Platform type
   */
  stopPollingToken(channelId, tokenAddress, platform) {
    const key = `${channelId}:${tokenAddress}`;
    const webhookData = this.activeWebhooks.get(key);
    
    if (webhookData) {
      if (webhookData.pollTimeout) {
        clearTimeout(webhookData.pollTimeout);
      }
      this.activeWebhooks.delete(key);
      this.logger.info(`[BuybotService] Stopped polling for ${tokenAddress} in channel ${channelId} (${platform})`);
    }
  }

  /**
   * Determine transaction type from Lambda API response
   * @param {Object} tx - Transaction data from Lambda API
   * @returns {string} Transaction type
   */
  determineTransactionType(tx, transfers = []) {
    const transferList = transfers.length ? transfers : tx?.transfers || [];

    if (!transferList || transferList.length === 0) {
      return 'UNKNOWN';
    }

    const uniqueMints = new Set(transferList.map(t => t.mint).filter(Boolean));
    if (uniqueMints.size > 1) {
      return 'SWAP';
    }

    // Heuristic: if we have distinct sender/recipient wallets, treat as swap/purchase
    const walletPairs = transferList.map(t => ({ from: t.fromWallet, to: t.toWallet }));
    const hasDistinctWallets = walletPairs.some(pair => pair.from && pair.to && pair.from !== pair.to);

    const hasParticipants = Array.isArray(tx?.participants) &&
      tx.participants.some(p => p.direction === 'out') &&
      tx.participants.some(p => p.direction === 'in');

    if (hasDistinctWallets && hasParticipants) {
      return 'SWAP';
    }

    return 'TRANSFER';
  }

  /**
   * Generate transaction description from Lambda API response
   * @param {Object} tx - Transaction data from Lambda API
   * @returns {string} Transaction description
   */
  generateTransactionDescription(tx, transfers = []) {
    const transferList = transfers.length ? transfers : tx?.transfers || [];

    if (!transferList || transferList.length === 0) {
      return 'Unknown Transaction';
    }

    const uniqueMints = new Set(transferList.map(t => t.mint).filter(Boolean));
    const hasMultipleTokens = uniqueMints.size > 1;

    if (hasMultipleTokens) {
      return 'Token Swap/Purchase';
    }

    const walletPairs = transferList.map(t => ({ from: t.fromWallet, to: t.toWallet }));
    const hasDistinctWallets = walletPairs.some(pair => pair.from && pair.to && pair.from !== pair.to);

    if (hasDistinctWallets) {
      return 'Token Swap/Purchase';
    }

    return 'Token Transfer';
  }

  /**
   * Check for new token transactions
   * @param {string} channelId - Channel ID
   * @param {string} tokenAddress - Token address
   * @param {string} platform - Platform type ('discord' or 'telegram')
   */
  async checkTokenTransactions(channelId, tokenAddress, platform = 'discord') {
    try {
      if (!this.lambdaEndpoint) return;

      // Get the last checked timestamp
      const token = await this.db.collection(this.TRACKED_TOKENS_COLLECTION).findOne({
        channelId,
        tokenAddress,
        active: true,
      });

      if (!token) {
        // Token was removed, stop polling
        this.stopPollingToken(channelId, tokenAddress, platform);
        return;
      }

      // Fetch fresh token info (including current price) for notifications
      const freshTokenInfo = await this.getTokenInfo(tokenAddress);
      
      // Update token with fresh price and market data
      if (freshTokenInfo && freshTokenInfo.usdPrice) {
        await this.db.collection(this.TRACKED_TOKENS_COLLECTION).updateOne(
          { channelId, tokenAddress },
          { 
            $set: { 
              usdPrice: freshTokenInfo.usdPrice,
              marketCap: freshTokenInfo.marketCap || null,
              lastPriceUpdate: new Date(),
            } 
          }
        );
        
        // Merge fresh data into token object for notifications
        token.usdPrice = freshTokenInfo.usdPrice;
        token.marketCap = freshTokenInfo.marketCap;
      }

      // Get recent transactions for the token from Lambda endpoint
      let transactions;
      try {
        // Call Lambda endpoint to get token transactions
        const response = await this.retryWithBackoff(async () => {
          const lambdaResponse = await fetch(`${this.lambdaEndpoint}/stats/recent-transactions?mint=${tokenAddress}&limit=${RECENT_TRANSACTIONS_LIMIT}`);
          if (!lambdaResponse.ok) {
            throw new Error(`Lambda API returned ${lambdaResponse.status}: ${await lambdaResponse.text()}`);
          }
          return await lambdaResponse.json();
        });
        
        if (!response || !response.data || response.data.length === 0) {
          // No transactions yet - this is common for very new tokens
          this.logger.debug(`[BuybotService] No transactions found for ${tokenAddress} yet`);
          
          // Reset error counter on successful query with no results
          await this.db.collection(this.TRACKED_TOKENS_COLLECTION).updateOne(
            { channelId, tokenAddress },
            { $set: { errorCount: 0 } }
          );
          return;
        }

        if (response.data.length >= RECENT_TRANSACTIONS_LIMIT) {
          this.logger.warn(
            `[BuybotService] Recent transaction query for ${tokenAddress} returned ${response.data.length} rows (limit=${RECENT_TRANSACTIONS_LIMIT}). ` +
            'Consider increasing BUYBOT_RECENT_TRANSACTIONS_LIMIT to avoid dropping buys during high volume periods.'
          );
        }
        
        // Map Lambda API response to our transaction format
        transactions = response.data.map(tx => {
          const normalizedTransfers = (tx.transfers || []).map(transfer => ({
            ...transfer,
            mint: transfer.mint || tokenAddress,
            tokenAmount: transfer.tokenAmount || transfer.amount || transfer.rawAmount || '0',
            rawAmount: transfer.rawAmount ?? null,
            decimals: typeof transfer.decimals === 'number' ? transfer.decimals : 9,
            fromUserAccount: transfer.fromUserAccount || transfer.fromTokenAccount || null,
            toUserAccount: transfer.toUserAccount || transfer.toTokenAccount || null,
            fromWallet: transfer.fromWallet || transfer.fromUserAccount || transfer.fromTokenAccount || null,
            toWallet: transfer.toWallet || transfer.toUserAccount || transfer.toTokenAccount || null,
          }));

          const normalizedTx = {
            ...tx,
            transfers: normalizedTransfers,
          };

          return {
            signature: tx.signature,
            timestamp: tx.blockTime || Math.floor(Date.now() / 1000),
            slot: tx.slot,
            type: this.determineTransactionType(normalizedTx, normalizedTransfers),
            description: this.generateTransactionDescription(normalizedTx, normalizedTransfers),
            tokenTransfers: normalizedTransfers,
            participants: tx.participants || [],
            events: {},
          };
        });

        // Oldest-first processing so we don't skip intermediate buys
        transactions.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      } catch (txError) {
        // Handle 404 Not Found - token might not exist or have no transactions
        if (txError.message?.includes('Not Found') || 
            txError.message?.includes('404') ||
            txError.message?.includes('8100002') ||
            txError.message?.includes('could not find account')) {
          
          this.logger.warn(`[BuybotService] Token ${tokenAddress} not found or has no transactions yet`);
          
          // Check if this is a persistent error (token doesn't exist)
          const token = await this.db.collection(this.TRACKED_TOKENS_COLLECTION).findOne({
            channelId,
            tokenAddress,
          });
          
          // Increment error counter
          const errorCount = (token.errorCount || 0) + 1;
          
          // If we've had too many errors, mark as inactive
          if (errorCount >= 5) {
            this.logger.warn(`[BuybotService] Token ${tokenAddress} has failed ${errorCount} times, marking as inactive`);
            
            await this.db.collection(this.TRACKED_TOKENS_COLLECTION).updateOne(
              { channelId, tokenAddress },
              { 
                $set: { 
                  active: false, 
                  error: 'Token not found or invalid after multiple attempts',
                  lastErrorAt: new Date(),
                } 
              }
            );
            
            // Stop polling for this token
            this.stopPollingToken(channelId, tokenAddress, platform);
            
            // Notify channel about the issue
            const errorMsg = `⚠️ Stopped tracking token \`${tokenAddress.substring(0, 8)}...\` - Token not found or has no activity. It may be:\n` +
                           `• An invalid address\n` +
                           `• A newly created token not yet indexed\n` +
                           `• A token with no transactions yet\n\n` +
                           `Try re-adding it later if it's a new token.`;
            
            if (platform === 'discord') {
              await this.sendDiscordNotification(channelId, errorMsg);
            } else if (platform === 'telegram') {
              await this.sendTelegramNotification(channelId, errorMsg);
            }
            
            return;
          } else {
            // Update error count but keep polling
            await this.db.collection(this.TRACKED_TOKENS_COLLECTION).updateOne(
              { channelId, tokenAddress },
              { 
                $set: { errorCount, lastErrorAt: new Date() },
              }
            );
            return; // Skip this check cycle
          }
        }
        
        // For other errors, log and continue
        this.logger.error(`[BuybotService] Error fetching transactions for ${tokenAddress}:`, txError.message);
        return;
      }

      if (!transactions || transactions.length === 0) {
        return;
      }

      // Filter for token transfers and swaps
      for (const tx of transactions) {
        // Skip if we've already processed this transaction
        const existing = await this.db.collection(this.TOKEN_EVENTS_COLLECTION).findOne({
          signature: tx.signature,
        });

        if (existing) continue;

        // Parse transaction for token events
        const event = await this.parseTokenTransaction(tx, tokenAddress);

        // If user requested RATi-only purchases, skip non-swap events for RATi
        if (event && token && token.tokenSymbol === 'RATi' && event.type !== 'swap') {
          // skip non-purchase events for RATi
          continue;
        }

        if (event) {
          // Store event - handle duplicate signature inserts gracefully
          try {
            await this.db.collection(this.TOKEN_EVENTS_COLLECTION).insertOne({
              ...event,
              channelId,
              tokenAddress,
              signature: tx.signature,
              timestamp: new Date(tx.timestamp * 1000),
              createdAt: new Date(),
              createdAt: new Date(),
            });
          } catch (insertErr) {
            // Mongo duplicate key (signature already exists) - skip silently
            if (insertErr && (insertErr.code === 11000 || String(insertErr.message).includes('E11000'))) {
              this.logger.debug(`[BuybotService] Duplicate token event ${tx.signature} detected, skipping insert`);
              continue; // skip processing this transaction
            }

            // Unexpected insert error - log and skip this event
            this.logger.error(`[BuybotService] Failed to insert token event ${tx.signature}:`, insertErr);
            continue;
          }

          // Send notification to appropriate platform
          await this.sendEventNotification(channelId, event, token, platform);

          // Update last event time
          await this.db.collection(this.TRACKED_TOKENS_COLLECTION).updateOne(
            { channelId, tokenAddress },
            { $set: { lastEventAt: new Date() } }
          );
        }
      }

      // Update last checked timestamp
      await this.db.collection(this.TRACKED_TOKENS_COLLECTION).updateOne(
        { channelId, tokenAddress },
        { $set: { lastCheckedAt: new Date() } }
      );

    } catch (error) {
      this.logger.error(`[BuybotService] Error checking transactions for ${tokenAddress}:`, error);
    }
  }

  /**
   * Parse a transaction for token events
   * @param {Object} tx - Transaction data from Lambda API
   * @param {string} tokenAddress - Token address to filter for
   * @returns {Promise<Object|null>} Parsed event or null
   */
  async parseTokenTransaction(tx, tokenAddress) {
    try {
      const tokenTransfers = tx.tokenTransfers || tx.transfers || [];
      const relevantTransfers = tokenTransfers.filter(transfer => {
        if (!transfer) return false;
        const matchesMint = !transfer.mint || transfer.mint === tokenAddress;
        const amountValue = parseFloat(transfer.tokenAmount || transfer.amount || transfer.rawAmount || '0');
        return matchesMint && amountValue > 0;
      });

      if (relevantTransfers.length === 0) {
        this.logger.debug(`[BuybotService] No relevant transfers found for ${tokenAddress} in tx ${tx.signature}`);
        return null;
      }

      const transfer = relevantTransfers[0];

      // Determine event type (swap vs plain transfer)
      let eventType = 'transfer';
      let description = 'Token Transfer';
      if (tx.type === 'SWAP' || tx.type === 'swap' || tx.description?.toLowerCase()?.includes('swap') || tx.description?.toLowerCase()?.includes('trade')) {
        eventType = 'swap';
        description = 'Token Swap/Purchase';
      } else if (this.determineTransactionType(tx, tokenTransfers) === 'SWAP') {
        eventType = 'swap';
        description = 'Token Swap/Purchase';
      }

      const decimals = typeof transfer.decimals === 'number' ? transfer.decimals : 9;

      const tokenAmountUi = parseFloat(transfer.tokenAmount || transfer.amount || transfer.rawAmount || '0');
      let rawAmount;
      if (transfer.rawAmount) {
        rawAmount = Number(transfer.rawAmount);
      } else if (Number.isFinite(tokenAmountUi)) {
        rawAmount = Math.round(Math.abs(tokenAmountUi) * Math.pow(10, decimals));
      } else {
        rawAmount = 0;
      }

      const preBalances = tx.preTokenBalances || [];
      const postBalances = tx.postTokenBalances || [];

      const toWallet = transfer.toWallet || transfer.toUserAccount || transfer.to || null;
      const fromWallet = transfer.fromWallet || transfer.fromUserAccount || transfer.from || null;

      const pre = preBalances.find(b => b.owner === toWallet || b.account === toWallet) || null;
      const post = postBalances.find(b => b.owner === toWallet || b.account === toWallet) || null;

      let preAmountUi = null;
      let postAmountUi = null;
      let isNewHolder = false;
      let isIncrease = false;

      if (pre && post) {
        preAmountUi = parseFloat(pre.uiTokenAmount?.uiAmount || 0);
        postAmountUi = parseFloat(post.uiTokenAmount?.uiAmount || 0);
        isNewHolder = preAmountUi === 0 && postAmountUi > 0;
        isIncrease = postAmountUi > preAmountUi;
      } else if (post) {
        postAmountUi = parseFloat(post.uiTokenAmount?.uiAmount || 0);
        isIncrease = postAmountUi > 0;
      }

      const participants = Array.isArray(tx.participants) ? tx.participants : [];
      const participantWallets = new Set(participants.map(p => p.wallet).filter(Boolean));
      const uniqueMints = new Set(relevantTransfers.map(t => t.mint || tokenAddress).filter(Boolean));

      const isBasicTransfer = relevantTransfers.length === 1 &&
        participantWallets.size === 2 &&
        fromWallet &&
        toWallet &&
        fromWallet !== toWallet &&
        !relevantTransfers.some(t => t.isMint || t.isBurn);

      const feeLamports = typeof tx.feeLamports === 'number' ? tx.feeLamports : null;
      const feeThreshold = Number(process.env.BUYBOT_TRANSFER_FEE_THRESHOLD_LAMPORTS || 10_000);
      const isLowFee = feeLamports !== null ? feeLamports <= feeThreshold : false;
      const isLikelyTransfer = isBasicTransfer && uniqueMints.size === 1 && (feeLamports === null || isLowFee);

      const inferredType = isLikelyTransfer ? 'transfer' : eventType;
      const displayDescription = isLikelyTransfer ? 'Token Transfer' : (tx.description || description);

      return {
        type: eventType,
        description: tx.description || description,
        displayDescription,
        amount: rawAmount,
        decimals,
        preAmountUi,
        postAmountUi,
        isNewHolder,
        isIncrease,
        from: fromWallet || 'Unknown',
        to: toWallet || 'Unknown',
        fromWallet,
        toWallet,
        txUrl: `https://solscan.io/tx/${tx.signature}`,
        timestamp: tx.timestamp ? new Date(tx.timestamp * 1000) : new Date(),
        feeLamports,
        inferredType,
        isLikelyTransfer,
      };
    } catch (error) {
      this.logger.error('[BuybotService] Error parsing transaction:', error);
      return null;
    }
  }

  /**
   * Send event notification to Discord or Telegram channel
   * @param {string} channelId - Channel ID
   * @param {Object} event - Event data
   * @param {Object} token - Token data
   * @param {string} platform - Platform type ('discord' or 'telegram')
   */
  async sendEventNotification(channelId, event, token, platform = 'discord') {
    try {
      if (platform === 'telegram') {
        await this.sendTelegramNotification(channelId, event, token);
      } else {
        await this.sendDiscordNotification(channelId, event, token);
      }
    } catch (error) {
      this.logger.error('[BuybotService] Failed to send event notification:', error);
    }
  }

  /**
   * Send notification to Discord channel
   * @param {string} channelId - Discord channel ID
   * @param {Object} event - Event data
   * @param {Object} token - Token data
   */
  async sendDiscordNotification(channelId, event, token) {
    try {
      // Get guild ID from the channel for avatar context
      let guildId = null;
      try {
        const channel = await this.discordService.client.channels.fetch(channelId);
        guildId = channel?.guild?.id || null;
      } catch {
        this.logger.warn(`[BuybotService] Could not fetch guild for channel ${channelId}`);
      }
      
      const effectiveType = event?.inferredType || event.type;
      const displayDescription = event?.displayDescription || event.description;

      const emoji = effectiveType === 'swap' ? '💰' : '📤';
      const color = effectiveType === 'swap' ? 0x00ff00 : 0x0099ff;
  const formattedAmount = formatTokenAmount(event.amount, event.decimals || token.tokenDecimals);
      const usdValue = token.usdPrice ? this.calculateUsdValue(event.amount, event.decimals || token.tokenDecimals, token.usdPrice) : null;
      const tokenDecimals = event.decimals || token.tokenDecimals || 9;

      // Get wallet avatars for addresses FIRST (before building embed)
      let buyerAvatar = null;
      let senderAvatar = null;
      let recipientAvatar = null;

      try {
        if (effectiveType === 'swap' && event.to) {
          this.logger.info(`[BuybotService] Processing swap for wallet ${formatAddress(event.to)}`);
          const buyerWalletContext = await this.buildWalletAvatarContext(event.to, token, tokenDecimals, { minUsd: 5, limit: 5 });
          const currentBalance = buyerWalletContext.currentBalance;
          const orbNftCount = await this.getWalletNftCountForChannel(event.to, channelId);
          
          this.logger.info(`[BuybotService] Wallet ${formatAddress(event.to)} balance: ${currentBalance} ${token.tokenSymbol}, NFTs: ${orbNftCount}`);
          
          try {
            buyerAvatar = await this.avatarService.createAvatarForWallet(event.to, {
              tokenSymbol: token.tokenSymbol,
              tokenAddress: token.tokenAddress,
              amount: formattedAmount,
              usdValue: buyerWalletContext.currentBalanceUsd,
              currentBalance: currentBalance,
              orbNftCount: orbNftCount,
              discordChannelId: channelId,
              guildId: guildId,
              tokenPriceUsd: token.usdPrice || null,
              additionalTokenBalances: buyerWalletContext.additionalTokenBalances,
              walletTopTokens: buyerWalletContext.holdingsSnapshot,
            });
            
            if (buyerAvatar) {
              this.logger.info(`[BuybotService] Created/retrieved buyer avatar:`, {
                emoji: buyerAvatar.emoji,
                name: buyerAvatar.name,
                hasImage: !!buyerAvatar.imageUrl,
                imageUrl: buyerAvatar.imageUrl,
                imageUrlType: typeof buyerAvatar.imageUrl,
                isPartial: buyerAvatar.isPartial,
                walletAddress: buyerAvatar.walletAddress
              });
            } else {
              this.logger.error(`[BuybotService] Failed to create buyer avatar for ${formatAddress(event.to)} - returned null`);
            }
          } catch (buyerError) {
            this.logger.error(`[BuybotService] Error creating buyer avatar:`, {
              error: buyerError.message,
              stack: buyerError.stack,
              wallet: formatAddress(event.to)
            });
          }
        } else if (effectiveType === 'transfer') {
          if (event.from) {
            this.logger.info(`[BuybotService] Processing transfer from ${formatAddress(event.from)}`);
            const senderWalletContext = await this.buildWalletAvatarContext(event.from, token, tokenDecimals, { minUsd: 5, limit: 5 });
            const senderBalance = senderWalletContext.currentBalance;
            const senderOrbCount = await this.getWalletNftCountForChannel(event.from, channelId);
            
            this.logger.info(`[BuybotService] Sender ${formatAddress(event.from)} balance: ${senderBalance} ${token.tokenSymbol}, NFTs: ${senderOrbCount}`);
            
            try {
              senderAvatar = await this.avatarService.createAvatarForWallet(event.from, {
                tokenSymbol: token.tokenSymbol,
                tokenAddress: token.tokenAddress,
                amount: formattedAmount,
                usdValue: senderWalletContext.currentBalanceUsd,
                currentBalance: senderBalance,
                orbNftCount: senderOrbCount,
                discordChannelId: channelId,
                guildId: guildId,
                tokenPriceUsd: token.usdPrice || null,
                additionalTokenBalances: senderWalletContext.additionalTokenBalances,
                walletTopTokens: senderWalletContext.holdingsSnapshot,
              });
              
              if (senderAvatar) {
                this.logger.info(`[BuybotService] Created/retrieved sender avatar:`, {
                  emoji: senderAvatar.emoji,
                  name: senderAvatar.name,
                  hasImage: !!senderAvatar.imageUrl,
                  walletAddress: senderAvatar.walletAddress
                });
              } else {
                this.logger.error(`[BuybotService] Failed to create sender avatar for ${formatAddress(event.from)} - returned null`);
              }
            } catch (senderError) {
              this.logger.error(`[BuybotService] Error creating sender avatar:`, {
                error: senderError.message,
                stack: senderError.stack,
                wallet: formatAddress(event.from)
              });
            }
          }
          if (event.to) {
            this.logger.info(`[BuybotService] Processing transfer to ${formatAddress(event.to)}`);
            const recipientWalletContext = await this.buildWalletAvatarContext(event.to, token, tokenDecimals, { minUsd: 5, limit: 5 });
            const recipientBalance = recipientWalletContext.currentBalance;
            const recipientOrbCount = await this.getWalletNftCountForChannel(event.to, channelId);
            
            this.logger.info(`[BuybotService] Recipient ${formatAddress(event.to)} balance: ${recipientBalance} ${token.tokenSymbol}, NFTs: ${recipientOrbCount}`);
            
            try {
              recipientAvatar = await this.avatarService.createAvatarForWallet(event.to, {
                tokenSymbol: token.tokenSymbol,
                tokenAddress: token.tokenAddress,
                amount: formattedAmount,
                usdValue: recipientWalletContext.currentBalanceUsd,
                currentBalance: recipientBalance,
                orbNftCount: recipientOrbCount,
                discordChannelId: channelId,
                guildId: guildId,
                tokenPriceUsd: token.usdPrice || null,
                additionalTokenBalances: recipientWalletContext.additionalTokenBalances,
                walletTopTokens: recipientWalletContext.holdingsSnapshot,
              });
              
              if (recipientAvatar) {
                this.logger.info(`[BuybotService] Created/retrieved recipient avatar:`, {
                  emoji: recipientAvatar.emoji,
                  name: recipientAvatar.name,
                  hasImage: !!recipientAvatar.imageUrl,
                  walletAddress: recipientAvatar.walletAddress
                });
              } else {
                this.logger.error(`[BuybotService] Failed to create recipient avatar for ${formatAddress(event.to)} - returned null`);
              }
            } catch (recipientError) {
              this.logger.error(`[BuybotService] Error creating recipient avatar:`, {
                error: recipientError.message,
                stack: recipientError.stack,
                wallet: formatAddress(event.to)
              });
            }
          }
        }
      } catch (avatarError) {
        this.logger.error('[BuybotService] Exception while getting wallet avatars:', {
          error: avatarError.message,
          stack: avatarError.stack,
          eventType: event.type
        });
      }

      const buyerEmoji = buyerAvatar ? this.getDisplayEmoji(buyerAvatar.emoji) : null;
      const senderEmoji = senderAvatar ? this.getDisplayEmoji(senderAvatar.emoji) : null;
      const recipientEmoji = recipientAvatar ? this.getDisplayEmoji(recipientAvatar.emoji) : null;

      // Build custom description with avatar names instead of wallet addresses
      let customDescription = displayDescription;
      if (effectiveType === 'swap' && buyerAvatar && buyerAvatar.name && buyerEmoji) {
        // Replace wallet address with avatar name in description
  customDescription = `${buyerEmoji} **${buyerAvatar.name}** (\`${formatAddress(event.to)}\`) purchased ${formattedAmount} ${token.tokenSymbol}`;
      } else if (effectiveType === 'transfer') {
        // Build transfer description with avatar names
        const senderDisplay = senderAvatar && senderAvatar.name && senderEmoji
          ? `${senderEmoji} **${senderAvatar.name}** (\`${formatAddress(event.from)}\`)`
          : `\`${formatAddress(event.from)}\``;
        
        const recipientDisplay = recipientAvatar && recipientAvatar.name && recipientEmoji
          ? `${recipientEmoji} **${recipientAvatar.name}** (\`${formatAddress(event.to)}\`)`
          : `\`${formatAddress(event.to)}\``;
        
        customDescription = `${senderDisplay} transferred ${formattedAmount} ${token.tokenSymbol} to ${recipientDisplay}`;
      }

      // Now create the embed with custom description
      const embed = {
        title: `${emoji} ${token.tokenSymbol} ${effectiveType === 'swap' ? 'Purchase' : 'Transfer'}`,
        description: customDescription,
        color: color,
        fields: [],
        timestamp: event.timestamp.toISOString(),
        footer: {
          text: 'Solana • Powered by DexScreener',
        },
      };

      // Amount with USD value
      if (usdValue) {
        embed.fields.push({
          name: '💵 Value',
          value: `$${usdValue.toFixed(2)}`,
          inline: true,
        });
      }

      embed.fields.push({
        name: '📦 Amount',
        value: `${formattedAmount} ${token.tokenSymbol}`,
        inline: true,
      });

      // Price and market cap
      if (token.usdPrice) {
        embed.fields.push({
          name: '💲 Price',
          value: `$${token.usdPrice.toFixed(6)}`,
          inline: true,
        });
      }

      if (token.marketCap) {
        embed.fields.push({
          name: '📊 Market Cap',
          value: `$${formatLargeNumber(token.marketCap)}`,
          inline: true,
        });
      }

      // From/To addresses - show wallet avatars with names/emojis
      if (effectiveType === 'swap') {
        if (buyerAvatar && buyerAvatar.name && buyerEmoji) {
          let buyerInfo = `${buyerEmoji} **${buyerAvatar.name}**`;
          buyerInfo += `\n\`${formatAddress(event.to)}\``;
          
          // Get balance from flexible tokenBalances schema
          const tokenBalance = buyerAvatar.tokenBalances?.[token.tokenSymbol];
          if (tokenBalance && tokenBalance.balance >= 1_000_000) {
            buyerInfo += `\n🐋 ${formatLargeNumber(tokenBalance.balance)} ${token.tokenSymbol}`;
            const orbCount = buyerAvatar.nftBalances?.Orb || 0;
            if (orbCount > 0) {
              buyerInfo += ` • ${orbCount} Orb${orbCount > 1 ? 's' : ''}`;
            }
          }
          embed.fields.push({
            name: '💸 Buyer',
            value: buyerInfo,
            inline: false,
          });
        } else {
          embed.fields.push({
            name: '📥 To',
            value: `\`${formatAddress(event.to)}\``,
            inline: true,
          });
        }
      } else {
        // Transfer - show both parties
        if (senderAvatar && senderAvatar.name && senderEmoji) {
          let senderInfo = `${senderEmoji} **${senderAvatar.name}**`;
          senderInfo += `\n\`${formatAddress(event.from)}\``;
          
          // Get balance from flexible tokenBalances schema
          const tokenBalance = senderAvatar.tokenBalances?.[token.tokenSymbol];
          if (tokenBalance && tokenBalance.balance >= 1_000_000) {
            senderInfo += `\n🐋 ${formatLargeNumber(tokenBalance.balance)} ${token.tokenSymbol}`;
            const orbCount = senderAvatar.nftBalances?.Orb || 0;
            if (orbCount > 0) {
              senderInfo += ` • ${orbCount} Orb${orbCount > 1 ? 's' : ''}`;
            }
          }
          embed.fields.push({
            name: '📤 From',
            value: senderInfo,
            inline: true,
          });
        } else {
          embed.fields.push({
            name: '📤 From',
            value: `\`${formatAddress(event.from)}\``,
            inline: true,
          });
        }
        
        if (recipientAvatar && recipientAvatar.name && recipientEmoji) {
          let recipientInfo = `${recipientEmoji} **${recipientAvatar.name}**`;
          recipientInfo += `\n\`${formatAddress(event.to)}\``;
          
          // Get balance from flexible tokenBalances schema
          const tokenBalance = recipientAvatar.tokenBalances?.[token.tokenSymbol];
          if (tokenBalance && tokenBalance.balance >= 1_000_000) {
            recipientInfo += `\n🐋 ${formatLargeNumber(tokenBalance.balance)} ${token.tokenSymbol}`;
            const orbCount = recipientAvatar.nftBalances?.Orb || 0;
            if (orbCount > 0) {
              recipientInfo += ` • ${orbCount} Orb${orbCount > 1 ? 's' : ''}`;
            }
          }
          embed.fields.push({
            name: '📥 To',
            value: recipientInfo,
            inline: true,
          });
        } else {
          embed.fields.push({
            name: '📥 To',
            value: `\`${formatAddress(event.to)}\``,
            inline: true,
          });
        }
      }

      // Balance changes
      if (event.isNewHolder) {
        embed.fields.push({
          name: '🆕 Status',
          value: 'New Holder!',
          inline: false,
        });
      } else if (event.isIncrease && event.preAmountUi && event.postAmountUi) {
        const increasePercent = ((event.postAmountUi - event.preAmountUi) / event.preAmountUi * 100).toFixed(1);
  const preFormatted = formatLargeNumber(event.preAmountUi);
  const postFormatted = formatLargeNumber(event.postAmountUi);
        embed.fields.push({
          name: '📈 Balance Change',
          value: `+${increasePercent}% (${preFormatted} → ${postFormatted} ${token.tokenSymbol})`,
          inline: false,
        });
      } else if (event.preAmountUi && event.postAmountUi && event.postAmountUi < event.preAmountUi) {
        const decreasePercent = ((event.preAmountUi - event.postAmountUi) / event.preAmountUi * 100).toFixed(1);
  const preFormatted = formatLargeNumber(event.preAmountUi);
  const postFormatted = formatLargeNumber(event.postAmountUi);
        embed.fields.push({
          name: '📉 Balance Change',
          value: `-${decreasePercent}% (${preFormatted} → ${postFormatted} ${token.tokenSymbol})`,
          inline: false,
        });
      }

      // Add links as buttons
      const dexScreenerUrl = `https://dexscreener.com/solana/${token.tokenAddress}`;
      const jupiterUrl = token.tokenSymbol === 'RATi' 
        ? `https://pump.fun/${token.tokenAddress}`
        : `https://jup.ag/swap/SOL-${token.tokenAddress}`;

      const components = [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: 'View Transaction',
              url: event.txUrl,
            },
            {
              type: 2,
              style: 5,
              label: 'DexScreener',
              url: dexScreenerUrl,
            },
            {
              type: 2,
              style: 5,
              label: token.tokenSymbol === 'RATi' ? 'Buy on Pump.fun' : 'Swap on Jupiter',
              url: jupiterUrl,
            },
          ],
        },
      ];

      // Send the Discord message with proper error handling
      try {
        const channel = await this.discordService.client.channels.fetch(channelId);
        if (!channel) {
          throw new Error(`Channel ${channelId} not found`);
        }
        if (!channel.isTextBased()) {
          throw new Error(`Channel ${channelId} is not a text channel`);
        }
        
        const sentMessage = await channel.send({ embeds: [embed], components });
        this.logger.info(`[BuybotService] Sent Discord notification for ${token.tokenSymbol} ${event.type} to channel ${channelId} (message ID: ${sentMessage.id})`);
        
        // Track volume for activity summaries
        if (usdValue) {
          await this.trackVolumeAndCheckSummary(channelId, event, token, usdValue);
        }
      } catch (sendError) {
        this.logger.error(`[BuybotService] Failed to send Discord message to channel ${channelId}:`, {
          error: sendError.message,
          code: sendError.code,
          channelId,
          tokenSymbol: token.tokenSymbol,
          eventType: event.type
        });
        throw sendError; // Re-throw to trigger outer catch block
      }
      
      // Trigger avatar responses for full (non-partial) avatars involved in the trade
      this.logger.info(`[BuybotService] About to trigger avatar responses`, {
        hasBuyerAvatar: !!buyerAvatar,
        hasSenderAvatar: !!senderAvatar,
        hasRecipientAvatar: !!recipientAvatar,
        buyerImage: buyerAvatar?.imageUrl ? 'EXISTS' : 'NULL',
        senderImage: senderAvatar?.imageUrl ? 'EXISTS' : 'NULL',
        recipientImage: recipientAvatar?.imageUrl ? 'EXISTS' : 'NULL'
      });
      
      const eventForResponses = { ...event, type: effectiveType, description: customDescription };

      await this.triggerAvatarTradeResponses(channelId, eventForResponses, token, {
        buyerAvatar,
        senderAvatar,
        recipientAvatar
      });
      
      this.logger.info(`[BuybotService] Finished triggering avatar responses`);
    } catch (error) {
      this.logger.error('[BuybotService] Failed to send Discord notification:', error);
    }
  }

  /**
   * Trigger avatar responses after a trade notification
   * Only full avatars (isPartial=false) will respond
   * @param {string} channelId - Discord channel ID
   * @param {Object} event - Trade event data
   * @param {Object} token - Token information
   * @param {Object} avatars - { buyerAvatar, senderAvatar, recipientAvatar }
   */
  async triggerAvatarTradeResponses(channelId, event, token, avatars) {
    this.logger.info(`[BuybotService] triggerAvatarTradeResponses CALLED`, {
      channelId,
      eventType: event.type,
      tokenSymbol: token.tokenSymbol,
      avatarsReceived: {
        buyerAvatar: !!avatars.buyerAvatar,
        senderAvatar: !!avatars.senderAvatar,
        recipientAvatar: !!avatars.recipientAvatar
      }
    });
    
    try {
      const { buyerAvatar, senderAvatar, recipientAvatar } = avatars;
      
      // Collect avatars involved in this trade that have images (full AI-generated avatars)
      // Avatars with images are likely RATi holders and can participate in conversations
      const fullAvatars = [];
      
      if (buyerAvatar && buyerAvatar.imageUrl && buyerAvatar._id) {
        fullAvatars.push({ avatar: buyerAvatar, role: 'buyer' });
      }
      if (senderAvatar && senderAvatar.imageUrl && senderAvatar._id) {
        fullAvatars.push({ avatar: senderAvatar, role: 'sender' });
      }
      if (recipientAvatar && recipientAvatar.imageUrl && recipientAvatar._id) {
        fullAvatars.push({ avatar: recipientAvatar, role: 'recipient' });
      }
      
      if (fullAvatars.length === 0) {
        this.logger.debug(`[BuybotService] No full avatars (with images) in trade, skipping responses`);
        return;
      }
      
      this.logger.info(`[BuybotService] Triggering responses for ${fullAvatars.length} full avatar(s) in trade`);
      
      // Record relationships between avatars involved in this trade
      if (fullAvatars.length >= 2 && this.avatarRelationshipService) {
        await this.recordTradeRelationships(fullAvatars, event, token);
      }
      
      // Get the channel object
      const channel = await this.discordService.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        this.logger.warn(`[BuybotService] Channel ${channelId} not accessible for avatar responses`);
        return;
      }
      
      // Get ResponseCoordinator from services
      const responseCoordinator = this.services?.resolve?.('responseCoordinator');
      if (!responseCoordinator) {
        this.logger.warn(`[BuybotService] ResponseCoordinator not available for trade responses`);
        return;
      }
      
      // Get ConversationManager once for all avatars
      const conversationManager = this.services?.resolve?.('conversationManager');
      if (!conversationManager) {
        this.logger.warn(`[BuybotService] ConversationManager not available for trade responses`);
        return;
      }
      
      // Trigger each full avatar to respond with context about the trade
      for (let i = 0; i < fullAvatars.length; i++) {
        const { avatar, role } = fullAvatars[i];
        try {
          // Build trade context prompt for the avatar (async now includes relationship data)
          const tradeContext = await this.buildTradeContextForAvatar(event, token, role, avatar, fullAvatars, {
            buyerAvatar,
            senderAvatar,
            recipientAvatar
          });
          
          this.logger.info(`[BuybotService] Scheduling avatar ${avatar.name} to respond to trade as ${role}`);
          
          // Generate response with trade context
          // Use a small delay to avoid rate limits and allow embeds to appear first
          setTimeout(async () => {
            try {
              this.logger.info(`[BuybotService] Triggering response for avatar ${avatar.name}`);
              
              // Send response with trade context passed via options (not as preset message)
              await conversationManager.sendResponse(channel, avatar, null, {
                overrideCooldown: true,
                cascadeDepth: 0,
                tradeContext: tradeContext  // Pass as additional context for AI
              });
              
              this.logger.info(`[BuybotService] Successfully sent response for avatar ${avatar.name}`);
            } catch (respError) {
              this.logger.error(`[BuybotService] Failed to generate response for ${avatar.name}:`, {
                error: respError.message,
                stack: respError.stack
              });
            }
          }, 3000 * (i + 1)); // Stagger responses by 3 seconds each (increased from 2s)
          
        } catch (error) {
          this.logger.error(`[BuybotService] Error scheduling response for avatar:`, {
            error: error.message,
            stack: error.stack,
            avatarName: avatar.name
          });
        }
      }
      
    } catch (error) {
      this.logger.error('[BuybotService] Failed to trigger avatar trade responses:', error);
    }
  }

  /**
   * Record trade relationships between avatars
   * @param {Array} fullAvatars - Array of {avatar, role} objects
   * @param {Object} event - Trade event
   * @param {Object} token - Token info
   */
  async recordTradeRelationships(fullAvatars, event, token) {
    try {
      if (!this.avatarRelationshipService) {
        return;
      }

      // Calculate trade amount and USD value
      const decimals = event.decimals || token.tokenDecimals || 9;
      const tokenAmount = parseFloat(event.amount) / Math.pow(10, decimals);
      const usdValue = token.usdPrice ? tokenAmount * token.usdPrice : 0;

      // For transfers, record relationship between sender and recipient
      if (event.type === 'transfer' && fullAvatars.length === 2) {
        const sender = fullAvatars.find(a => a.role === 'sender');
        const recipient = fullAvatars.find(a => a.role === 'recipient');

        if (sender && recipient) {
          await this.avatarRelationshipService.recordTrade({
            avatar1Id: String(sender.avatar._id),
            avatar1Name: sender.avatar.name,
            avatar2Id: String(recipient.avatar._id),
            avatar2Name: recipient.avatar.name,
            tokenSymbol: token.tokenSymbol,
            amount: tokenAmount,
            usdValue: usdValue,
            tradeType: 'transfer',
            direction: 'sent', // From sender's perspective
            txSignature: event.signature || 'unknown'
          });

          this.logger.info(`[BuybotService] Recorded transfer relationship: ${sender.avatar.name} -> ${recipient.avatar.name}`);
        }
      }

      // For swaps with multiple participants, record all pairwise relationships
      if (event.type === 'swap' && fullAvatars.length >= 2) {
        const buyer = fullAvatars.find(a => a.role === 'buyer');
        
        if (buyer) {
          // Record relationship with all other participants
          for (const other of fullAvatars) {
            if (other.avatar._id.toString() !== buyer.avatar._id.toString()) {
              await this.avatarRelationshipService.recordTrade({
                avatar1Id: String(buyer.avatar._id),
                avatar1Name: buyer.avatar.name,
                avatar2Id: String(other.avatar._id),
                avatar2Name: other.avatar.name,
                tokenSymbol: token.tokenSymbol,
                amount: tokenAmount,
                usdValue: usdValue,
                tradeType: 'swap',
                direction: 'received', // Buyer received tokens
                txSignature: event.signature || 'unknown'
              });

              this.logger.debug(`[BuybotService] Recorded swap relationship: ${buyer.avatar.name} <-> ${other.avatar.name}`);
            }
          }
        }
      }
    } catch (error) {
      this.logger.error('[BuybotService] Failed to record trade relationships:', error);
    }
  }

  /**
   * Build context message for avatar to understand the trade they're involved in
   * @param {Object} event - Trade event
   * @param {Object} token - Token info
   * @param {string} role - Avatar's role (buyer/sender/recipient)
   * @param {Object} avatar - Avatar document
   * @param {Array} allAvatars - All full avatars in this trade
   * @param {Object} allParticipants - All participants (buyerAvatar, senderAvatar, recipientAvatar)
   * @returns {Promise<string>} Context prompt
   */
  async buildTradeContextForAvatar(event, token, role, avatar, allAvatars, allParticipants = {}) {
    // Calculate the actual token amount in UI units (not raw amount)
    const decimals = event.decimals || token.tokenDecimals || 9;
    const tokenAmount = parseFloat(event.amount) / Math.pow(10, decimals);
    
    // Format for display
  const amountForDisplay = formatLargeNumber(tokenAmount);
    
    // Calculate USD value if available
    let usdValue = '';
    if (token.usdPrice) {
      const usdAmount = tokenAmount * token.usdPrice;
      usdValue = ` (worth $${usdAmount.toFixed(2)})`;
    }
    
    let contextParts = [`You just witnessed a ${token.tokenSymbol} ${event.type} transaction`];
    
    if (role === 'buyer') {
      contextParts.push(`You are the buyer in this transaction`);
      contextParts.push(`You just acquired ${amountForDisplay} ${token.tokenSymbol}${usdValue}`);
      
      // Get balance from flexible tokenBalances schema
      const tokenBalance = avatar.tokenBalances?.[token.tokenSymbol];
      if (tokenBalance?.balance) {
  contextParts.push(`Your current balance: ${formatLargeNumber(tokenBalance.balance)} ${token.tokenSymbol}`);
      }
    } else if (role === 'sender') {
      contextParts.push(`You are the sender in this transfer`);
      contextParts.push(`You just sent ${amountForDisplay} ${token.tokenSymbol}${usdValue}`);
      
      // Add recipient information if available
      const { recipientAvatar } = allParticipants;
      if (recipientAvatar) {
        const recipientEmoji = recipientAvatar.emoji ? this.getDisplayEmoji(recipientAvatar.emoji) : null;
        const recipientName = recipientEmoji && recipientAvatar.name
          ? `${recipientEmoji} ${recipientAvatar.name}`
          : recipientAvatar.name || formatAddress(event.to);
        contextParts.push(`Recipient: ${recipientName}`);
      }
      
      // Get balance after transfer
      const tokenBalance = avatar.tokenBalances?.[token.tokenSymbol];
      if (tokenBalance?.balance) {
  contextParts.push(`Your remaining balance: ${formatLargeNumber(tokenBalance.balance)} ${token.tokenSymbol}`);
      }
    } else if (role === 'recipient') {
      contextParts.push(`You are the recipient in this transfer`);
      contextParts.push(`You just received ${amountForDisplay} ${token.tokenSymbol}${usdValue}`);
      
      // Add sender information if available
      const { senderAvatar } = allParticipants;
      if (senderAvatar) {
        const senderEmoji = senderAvatar.emoji ? this.getDisplayEmoji(senderAvatar.emoji) : null;
        const senderName = senderEmoji && senderAvatar.name
          ? `${senderEmoji} ${senderAvatar.name}`
          : senderAvatar.name || formatAddress(event.from);
        contextParts.push(`Sender: ${senderName}`);
      }
      
      // Get balance after transfer
      const tokenBalance = avatar.tokenBalances?.[token.tokenSymbol];
      if (tokenBalance?.balance) {
  contextParts.push(`Your new balance: ${formatLargeNumber(tokenBalance.balance)} ${token.tokenSymbol}`);
      }
    }

    const tokenBalances = avatar.tokenBalances || {};
    const notableHoldings = Object.entries(tokenBalances)
      .map(([symbol, info]) => {
        const usdValue = Number(info?.usdValue);
        const balanceValue = Number(info?.balance);
        return {
          symbol,
          usdValue: Number.isFinite(usdValue) ? usdValue : null,
          balance: Number.isFinite(balanceValue) ? balanceValue : null,
        };
      })
      .filter(entry => entry.usdValue !== null && entry.usdValue >= 5)
      .sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0))
      .slice(0, 3);

    if (notableHoldings.length > 0) {
      const holdingsText = notableHoldings
        .map(entry => {
          const balanceText = entry.balance !== null
            ? entry.balance.toLocaleString(undefined, { maximumFractionDigits: 3 })
            : 'unknown amount';
          return `${entry.symbol}: ${balanceText} (~$${entry.usdValue.toFixed(2)})`;
        })
        .join('; ');
      contextParts.push(`Your notable holdings include ${holdingsText}`);
    }
    
    // Add relationship context for other avatars involved
    const otherAvatars = allAvatars.filter(a => a.avatar._id.toString() !== avatar._id.toString());
    if (otherAvatars.length > 0 && this.avatarRelationshipService) {
      contextParts.push(`\nOther avatars in this trade:`);
      
      for (const other of otherAvatars) {
        const otherEmoji = other.avatar.emoji ? this.getDisplayEmoji(other.avatar.emoji) : null;
        const otherName = otherEmoji && other.avatar.name
          ? `${otherEmoji} ${other.avatar.name}`
          : other.avatar.name || formatAddress(other.avatar.walletAddress);
        
        // Get relationship context
        try {
          const relationshipContext = await this.avatarRelationshipService.getRelationshipContext(
            String(avatar._id),
            String(other.avatar._id)
          );
          
          if (relationshipContext) {
            contextParts.push(`\n${relationshipContext}`);
          } else {
            contextParts.push(`${otherName}: This is your first interaction together`);
          }
        } catch (err) {
          this.logger.warn(`[BuybotService] Failed to get relationship context: ${err.message}`);
          contextParts.push(otherName);
        }
      }
      
      contextParts.push(`Feel free to interact with them about this trade, drawing on your shared history`);
    } else if (otherAvatars.length > 0) {
      const otherNames = otherAvatars.map(({ avatar }) => {
        const otherEmoji = avatar.emoji ? this.getDisplayEmoji(avatar.emoji) : null;
        if (otherEmoji && avatar.name) {
          return `${otherEmoji} ${avatar.name}`;
        }
  return avatar.name || formatAddress(avatar.walletAddress);
      }).join(', ');
      contextParts.push(`Other avatars involved: ${otherNames}`);
      contextParts.push(`Feel free to interact with them about this trade`);
    }
    
    contextParts.push(`React naturally to this transaction - celebrate, comment on the market, or banter with other traders`);
    
    return `[Trade Context: ${contextParts.join('. ')}.]`;
  }

  /**
   * Send notification to Telegram channel
   * @param {string} channelId - Telegram channel ID
   * @param {Object} event - Event data
   * @param {Object} token - Token data
   */
  async sendTelegramNotification(channelId, event, token) {
    try {
      // Skip individual transfer and swap notifications on Telegram
      // These are now summarized from Discord and posted periodically
      if (event.type === 'swap' || event.type === 'transfer') {
        this.logger.info(`[BuybotService] Skipping individual ${event.type} notification to Telegram ${channelId} (will be included in summary)`);
        return;
      }

      const telegramService = this.getTelegramService ? this.getTelegramService() : null;
      
      if (!telegramService || !telegramService.globalBot) {
        this.logger.warn('[BuybotService] Telegram service not available');
        return;
      }

  const formattedAmount = formatTokenAmount(event.amount, event.decimals || token.tokenDecimals);
    const usdValue = token.usdPrice ? this.calculateUsdValue(event.amount, event.decimals || token.tokenDecimals, token.usdPrice) : null;
    const tokenDecimals = event.decimals || token.tokenDecimals || 9;

      // Debug logging
      this.logger.info(`[BuybotService] Sending notification for ${token.tokenSymbol}:`, {
        tokenAddress: token.tokenAddress,
        usdPrice: token.usdPrice,
        marketCap: token.marketCap,
        usdValue: usdValue,
        amount: formattedAmount,
        hasMediaThresholds: !!token.mediaThresholds,
        hasCustomMedia: !!token.customMedia,
      });

      // Get wallet avatars for addresses FIRST (before building message)
      let buyerAvatar = null;
      let senderAvatar = null;
      let recipientAvatar = null;

      try {
        if (event.type === 'swap' && event.to) {
          // Get wallet's current token balance
          const buyerWalletContext = await this.buildWalletAvatarContext(event.to, token, tokenDecimals, { minUsd: 5, limit: 5 });
          const currentBalance = buyerWalletContext.currentBalance;
          
          // Get wallet's NFT count for all tracked collections in this channel
          const orbNftCount = await this.getWalletNftCountForChannel(event.to, channelId);
          
          buyerAvatar = await this.avatarService.createAvatarForWallet(event.to, {
            tokenSymbol: token.tokenSymbol,
            tokenAddress: token.tokenAddress,
            amount: formattedAmount,
            usdValue: buyerWalletContext.currentBalanceUsd,
            currentBalance: currentBalance,
            orbNftCount: orbNftCount,
            telegramChannelId: channelId, // Pass telegram channel for introductions
            tokenPriceUsd: token.usdPrice || null,
            additionalTokenBalances: buyerWalletContext.additionalTokenBalances,
            walletTopTokens: buyerWalletContext.holdingsSnapshot,
          });
        } else if (event.type === 'transfer') {
          if (event.from) {
            const senderWalletContext = await this.buildWalletAvatarContext(event.from, token, tokenDecimals, { minUsd: 5, limit: 5 });
            const senderBalance = senderWalletContext.currentBalance;
            const senderOrbCount = await this.getWalletNftCountForChannel(event.from, channelId);
            
            senderAvatar = await this.avatarService.createAvatarForWallet(event.from, {
              tokenSymbol: token.tokenSymbol,
              tokenAddress: token.tokenAddress,
              amount: formattedAmount,
              usdValue: senderWalletContext.currentBalanceUsd,
              currentBalance: senderBalance,
              orbNftCount: senderOrbCount,
              telegramChannelId: channelId,
              tokenPriceUsd: token.usdPrice || null,
              additionalTokenBalances: senderWalletContext.additionalTokenBalances,
              walletTopTokens: senderWalletContext.holdingsSnapshot,
            });
          }
          if (event.to) {
            const recipientWalletContext = await this.buildWalletAvatarContext(event.to, token, tokenDecimals, { minUsd: 5, limit: 5 });
            const recipientBalance = recipientWalletContext.currentBalance;
            const recipientOrbCount = await this.getWalletNftCountForChannel(event.to, channelId);
            
            recipientAvatar = await this.avatarService.createAvatarForWallet(event.to, {
              tokenSymbol: token.tokenSymbol,
              tokenAddress: token.tokenAddress,
              amount: formattedAmount,
              usdValue: recipientWalletContext.currentBalanceUsd,
              currentBalance: recipientBalance,
              orbNftCount: recipientOrbCount,
              telegramChannelId: channelId,
              tokenPriceUsd: token.usdPrice || null,
              additionalTokenBalances: recipientWalletContext.additionalTokenBalances,
              walletTopTokens: recipientWalletContext.holdingsSnapshot,
            });
          }
        }
      } catch (avatarError) {
        this.logger.error('[BuybotService] Failed to get wallet avatars:', avatarError);
      }

      const buyerEmoji = buyerAvatar ? this.getDisplayEmoji(buyerAvatar.emoji) : null;
      const senderEmoji = senderAvatar ? this.getDisplayEmoji(senderAvatar.emoji) : null;
      const recipientEmoji = recipientAvatar ? this.getDisplayEmoji(recipientAvatar.emoji) : null;

      // Build enhanced notification message with avatar names
      let message = '';
      
      // Title with emoji and type
      if (event.type === 'swap') {
        const emoji = token.tokenSymbol === 'RATi' ? '🐭' : '💰';
        const multiplier = usdValue ? this.getBuyMultiplier(usdValue) : '';
        message += `*${token.tokenSymbol} Buy*\n${emoji}${multiplier ? ' × ' + multiplier : ''}\n\n`;
        
        // Add description with avatar name
        if (buyerAvatar && buyerAvatar.name && buyerEmoji) {
          message += `${buyerEmoji} *${buyerAvatar.name}* (\`${formatAddress(event.to)}\`) purchased ${formattedAmount} ${token.tokenSymbol}\n\n`;
        } else {
          message += `Purchased ${formattedAmount} ${token.tokenSymbol}\n\n`;
        }
      } else {
        // Transfer
        message += `📤 *${token.tokenSymbol} Transfer*\n\n`;
        
        // Add description with avatar names
        const senderDisplay = senderAvatar && senderAvatar.name && senderEmoji
          ? `${senderEmoji} *${senderAvatar.name}* (\`${formatAddress(event.from)}\`)`
          : `\`${formatAddress(event.from)}\``;
        
        const recipientDisplay = recipientAvatar && recipientAvatar.name && recipientEmoji
          ? `${recipientEmoji} *${recipientAvatar.name}* (\`${formatAddress(event.to)}\`)`
          : `\`${formatAddress(event.to)}\``;
        
        message += `${senderDisplay} transferred ${formattedAmount} ${token.tokenSymbol} to ${recipientDisplay}\n\n`;
      }

      // Amount and USD value (for both swaps and transfers)
      if (usdValue) {
        message += `💵 *$${usdValue.toFixed(2)}*\n\n`;
      }

      // Addresses - show wallet avatars with names/emojis
      if (event.type === 'swap') {
        if (buyerAvatar && buyerAvatar.name && buyerEmoji) {
          message += `${buyerEmoji} Buyer: *${buyerAvatar.name}*\n`;
          
          // Get balance from flexible tokenBalances schema
          const tokenBalance = buyerAvatar.tokenBalances?.[token.tokenSymbol];
          if (tokenBalance && tokenBalance.balance >= 1_000_000) {
            message += `    🐋 ${formatLargeNumber(tokenBalance.balance)} ${token.tokenSymbol}`;
            const orbCount = buyerAvatar.nftBalances?.Orb || 0;
            if (orbCount > 0) {
              message += ` • ${orbCount} Orb${orbCount > 1 ? 's' : ''}`;
            }
            message += `\n`;
          }
          message += `    \`${formatAddress(event.to)}\`\n`;
        } else {
          message += `👤 Buyer: \`${formatAddress(event.to)}\`\n`;
        }
      } else {
        // Transfer - show both parties with avatars
        if (senderAvatar && senderAvatar.name && senderEmoji) {
          message += `${senderEmoji} From: *${senderAvatar.name}*\n`;
          
          // Get balance from flexible tokenBalances schema
          const tokenBalance = senderAvatar.tokenBalances?.[token.tokenSymbol];
          if (tokenBalance && tokenBalance.balance >= 1_000_000) {
            message += `    🐋 ${formatLargeNumber(tokenBalance.balance)} ${token.tokenSymbol}`;
            const orbCount = senderAvatar.nftBalances?.Orb || 0;
            if (orbCount > 0) {
              message += ` • ${orbCount} Orb${orbCount > 1 ? 's' : ''}`;
            }
            message += `\n`;
          }
          message += `    \`${formatAddress(event.from)}\`\n`;
        } else {
          message += `📤 From: \`${formatAddress(event.from)}\`\n`;
        }
        
        if (recipientAvatar && recipientAvatar.name && recipientEmoji) {
          message += `${recipientEmoji} To: *${recipientAvatar.name}*\n`;
          
          // Get balance from flexible tokenBalances schema
          const tokenBalance = recipientAvatar.tokenBalances?.[token.tokenSymbol];
          if (tokenBalance && tokenBalance.balance >= 1_000_000) {
            message += `    🐋 ${formatLargeNumber(tokenBalance.balance)} ${token.tokenSymbol}`;
            const orbCount = recipientAvatar.nftBalances?.Orb || 0;
            if (orbCount > 0) {
              message += ` • ${orbCount} Orb${orbCount > 1 ? 's' : ''}`;
            }
            message += `\n`;
          }
          message += `    \`${formatAddress(event.to)}\`\n`;
        } else {
          message += `📥 To: \`${formatAddress(event.to)}\`\n`;
        }
      }


      // Balance changes (new holder, increase, decrease)
      if (event.isNewHolder) {
        message += `🆕 *New Holder!*\n`;
      } else if (event.isIncrease && event.preAmountUi && event.postAmountUi) {
        const increasePercent = ((event.postAmountUi - event.preAmountUi) / event.preAmountUi * 100).toFixed(1);
        message += `📈 Balance increased ${increasePercent}%\n`;
        
        // Show before/after for significant changes
        if (event.preAmountUi > 0) {
          const preFormatted = formatLargeNumber(event.preAmountUi);
          const postFormatted = formatLargeNumber(event.postAmountUi);
          message += `   ${preFormatted} → ${postFormatted} ${token.tokenSymbol}\n`;
        }
      } else if (event.preAmountUi && event.postAmountUi && event.postAmountUi < event.preAmountUi) {
        // Handle decreases (outgoing transfers)
        const decreasePercent = ((event.preAmountUi - event.postAmountUi) / event.preAmountUi * 100).toFixed(1);
        message += `📉 Balance decreased ${decreasePercent}%\n`;
        
  const preFormatted = formatLargeNumber(event.preAmountUi);
  const postFormatted = formatLargeNumber(event.postAmountUi);
        message += `   ${preFormatted} → ${postFormatted} ${token.tokenSymbol}\n`;
      }

      // Market cap and price info
      message += `\n`;
      if (token.usdPrice) {
        message += `💲 Price: $${token.usdPrice.toFixed(6)}\n`;
      }
      if (token.marketCap) {
  message += `📊 Market Cap: $${formatLargeNumber(token.marketCap)}\n`;
      }

      // Links
      message += `\n`;
      
      // Transaction link
      message += `[Tx](${event.txUrl})`;
      
      // DexScreener link
      const dexScreenerUrl = `https://dexscreener.com/solana/${token.tokenAddress}`;
      message += ` • [DexScreener](${dexScreenerUrl})`;
      
      // Pump.fun or Jupiter buy link
      if (token.tokenSymbol === 'RATi') {
        const buyUrl = `https://pump.fun/${token.tokenAddress}`;
        message += ` • [Buy](${buyUrl})`;
      } else {
        // Generic Jupiter swap link for other tokens
        const jupiterUrl = `https://jup.ag/swap/SOL-${token.tokenAddress}`;
        message += ` • [Swap](${jupiterUrl})`;
      }

      await telegramService.globalBot.telegram.sendMessage(
        channelId,
        message,
        {
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }
      );

      this.logger.info(`[BuybotService] Sent Telegram notification for ${token.tokenSymbol} ${event.type} to channel ${channelId}`);

      // Check if this is a significant purchase that warrants auto-generated media
      if (event.type === 'swap' && usdValue) {
        await this.handleSignificantPurchase(channelId, event, token, usdValue, formattedAmount);
      }
    } catch (error) {
      this.logger.error('[BuybotService] Failed to send Telegram notification:', error);
    }
  }

  /**
   * Get buy size multiplier emoji/text
   * @param {number} usdValue - USD value of purchase
   * @returns {string} Multiplier string
   */
  getBuyMultiplier(usdValue) {
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
   * Normalize emoji strings coming from avatar metadata.
   * Converts shortcode formats like :fire: and extracts actual pictographs from mixed strings.
   * @param {string} rawEmoji - Raw emoji value from avatar document
   * @param {string} [fallback='✨'] - Emoji to use when normalization fails
   * @returns {string} Display-safe emoji
   */
  getDisplayEmoji(rawEmoji, fallback = '✨') {
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
      // Join the first grapheme or sequence (some emojis use multiple code points)
      return pictographs.slice(0, 2).join('');
    }

    // Fall back to the first visible character to avoid empty strings
    return cleaned[0] || fallback;
  }

  /**
   * Calculate USD value of a token amount
   * @param {number} amount - Raw token amount (smallest units)
   * @param {number} decimals - Token decimals
   * @param {number} usdPrice - Price per token in USD
   * @returns {number} USD value
   */
  calculateUsdValue(amount, decimals, usdPrice) {
    const tokenAmount = parseFloat(amount) / Math.pow(10, decimals);
    return tokenAmount * usdPrice;
  }

  /**
   * Fetch all SPL token balances for a wallet from the Lambda balances endpoint
   * @param {string} walletAddress - Wallet address to query
   * @returns {Promise<Array>} Array of balance entries
   */
  async fetchWalletBalances(walletAddress) {
    if (!walletAddress) {
      return [];
    }

    const cached = this.walletBalanceCache.get(walletAddress);
    if (cached && (Date.now() - cached.timestamp) < this.WALLET_BALANCE_CACHE_TTL_MS) {
      return cached.entries;
    }

    if (!this.lambdaEndpoint) {
      return cached ? cached.entries : [];
    }

    const trimmedEndpoint = this.lambdaEndpoint.endsWith('/')
      ? this.lambdaEndpoint.slice(0, -1)
      : this.lambdaEndpoint;

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

      if (this.walletBalanceCache.size > this.WALLET_BALANCE_CACHE_MAX_ENTRIES) {
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

      return entries;
    } catch (error) {
  this.logger.error(`[BuybotService] Failed to fetch wallet balances for ${formatAddress(walletAddress)}:`, error);
      return cached ? cached.entries : [];
    }
  }

  /**
   * Convert a Lambda balance entry into UI amount using token decimals
   * @param {Object} entry - Balance entry from Lambda
   * @param {number} decimals - Token decimals
   * @returns {number} UI amount (full tokens)
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
   * Get wallet's token balance using cached Lambda balances
   * @param {string} walletAddress - Wallet address
   * @param {string} tokenAddress - Token mint address
   * @param {number} [tokenDecimals=9] - Token decimals
   * @returns {Promise<number>} Token balance (UI units)
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
    if (!Number.isFinite(decimals)) {
      const tokenInfo = await this.getTokenInfo(tokenAddress);
      decimals = tokenInfo?.decimals ?? 9;
    }

    const uiAmount = this.calculateUiAmountFromEntry(balanceEntry, decimals);
    return Number.isFinite(uiAmount) ? uiAmount : 0;
  }

  /**
   * Determine the top token holdings for a wallet above a USD threshold
   * @param {string} walletAddress - Wallet address
   * @param {Object} [options]
   * @param {number} [options.minUsd=5] - Minimum USD value to include
   * @param {number} [options.limit=5] - Maximum number of tokens to return
   * @param {number} [options.maxLookups=12] - Maximum number of tokens to price check
   * @returns {Promise<Array>} Array of holdings sorted by USD value desc
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
        tokenInfo = await this.getTokenInfo(mint);
      } catch (err) {
  this.logger.warn(`[BuybotService] Failed to fetch token info for mint ${formatAddress(mint)}: ${err.message}`);
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
   * Build additional token balance map suitable for avatar persistence
   * @param {Array} topTokens - Array of token holding summaries
   * @param {string} [primarySymbol] - Symbol of the primary token to exclude
   * @returns {Object|null} Map of token symbol -> balance metadata
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
   * Build wallet context data for avatar creation/update, including top holdings
   * @param {string} walletAddress - Wallet address
   * @param {Object} token - Primary token metadata
   * @param {number} tokenDecimals - Token decimals for primary token
   * @param {Object} [options] - Options for holdings calculation
   * @returns {Promise<Object>} Context with balance, USD value, holdings snapshot
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

  /**
   * Handle significant purchases with auto-generated media or custom media for smaller buys
   * @param {string} channelId - Telegram channel ID
   * @param {Object} event - Event data
   * @param {Object} token - Token data
   * @param {number} usdValue - USD value of the purchase
   * @param {string} formattedAmount - Formatted token amount
   */
  async handleSignificantPurchase(channelId, event, token, usdValue, formattedAmount) {
    try {
      const telegramService = this.getTelegramService ? this.getTelegramService() : null;
      if (!telegramService) return;

      // Get thresholds from token config (with defaults)
      const imageThreshold = token.mediaThresholds?.image || 100;
      const videoThreshold = token.mediaThresholds?.video || 1000;

      if (usdValue >= videoThreshold) {
        // HUGE buy - generate video
        this.logger.info(`[BuybotService] 🚀 HUGE BUY detected: $${usdValue.toFixed(2)} - generating video`);
        
        const videoPrompt = `Epic celebration of a massive ${token.tokenSymbol} purchase! ` +
          `${formattedAmount} ${token.tokenSymbol} worth $${usdValue.toFixed(0)} just bought! ` +
          `Cinematic celebration with gold coins, green candles shooting up, ` +
          `"TO THE MOON" energy, crypto bull market vibes, exciting and triumphant atmosphere`;

        await this.generateAndSendMedia(telegramService, channelId, videoPrompt, 'video', usdValue, token.tokenSymbol);
        
      } else if (usdValue >= imageThreshold) {
        // BIG buy - generate image
        this.logger.info(`[BuybotService] 💰 BIG BUY detected: $${usdValue.toFixed(2)} - generating image`);
        
        const imagePrompt = `Celebration of a significant ${token.tokenSymbol} purchase! ` +
          `${formattedAmount} ${token.tokenSymbol} worth $${usdValue.toFixed(0)}. ` +
          `Show green candles, upward trending charts, coins, bulls, ` +
          `crypto trading success theme, vibrant and exciting`;

        await this.generateAndSendMedia(telegramService, channelId, imagePrompt, 'image', usdValue, token.tokenSymbol);
        
      } else if (usdValue > 0) {
        // Smaller buy - check for custom media
        // Prefer video for higher values within the small range, then image
        const customVideo = token.customMedia?.video;
        const customImage = token.customMedia?.image;
        
        if (customVideo) {
          this.logger.info(`[BuybotService] 📹 Sending custom video for $${usdValue.toFixed(2)} purchase`);
          try {
            await telegramService.globalBot.telegram.sendVideo(
              channelId,
              customVideo,
              {
                caption: `${token.tokenSymbol} purchase! Worth $${usdValue.toFixed(0)}! 🎉`
              }
            );
          } catch (error) {
            this.logger.error('[BuybotService] Failed to send custom video:', error);
          }
        } else if (customImage) {
          this.logger.info(`[BuybotService] 🖼️ Sending custom image for $${usdValue.toFixed(2)} purchase`);
          try {
            await telegramService.globalBot.telegram.sendPhoto(
              channelId,
              customImage,
              {
                caption: `${token.tokenSymbol} purchase! Worth $${usdValue.toFixed(0)}! 🎉`
              }
            );
          } catch (error) {
            this.logger.error('[BuybotService] Failed to send custom image:', error);
          }
        }
      }
    } catch (error) {
      this.logger.error('[BuybotService] Failed to handle significant purchase:', error);
    }
  }

  /**
   * Generate and send media (image or video) for significant purchases
   * @param {Object} telegramService - Telegram service instance
   * @param {string} channelId - Channel ID
   * @param {string} prompt - Generation prompt
   * @param {string} mediaType - 'image' or 'video'
   * @param {number} usdValue - USD value of purchase
   * @param {string} tokenSymbol - Token symbol
   */
  async generateAndSendMedia(telegramService, channelId, prompt, mediaType, usdValue, tokenSymbol) {
    try {
      const message = mediaType === 'video'
        ? `🚀 *HUGE ${tokenSymbol} BUY ALERT!*\n\n💵 *$${usdValue.toFixed(0)} purchase detected!*\n\nGenerating celebration video...`
        : `💰 *BIG ${tokenSymbol} BUY!*\n\n💵 *$${usdValue.toFixed(0)} purchase!*\n\nGenerating celebration image...`;

      // Send initial message
      await telegramService.globalBot.telegram.sendMessage(
        channelId,
        message,
        { parse_mode: 'Markdown' }
      );

      // Generate media using the appropriate service
      if (mediaType === 'video' && telegramService.veoService) {
        this.logger.info(`[BuybotService] Generating video for $${usdValue.toFixed(0)} purchase`);
        
        const videoUrls = await telegramService.veoService.generateVideos({ 
          prompt, 
          config: { numberOfVideos: 1, personGeneration: "allow_adult" } 
        });
        
        if (videoUrls && videoUrls.length > 0) {
          await telegramService.globalBot.telegram.sendVideo(
            channelId,
            videoUrls[0],
            {
              caption: `🎬 Epic ${tokenSymbol} buy celebration! Worth $${usdValue.toFixed(0)}! 🚀`
            }
          );
          this.logger.info(`[BuybotService] Video sent successfully for ${tokenSymbol} purchase`);
        } else {
          this.logger.warn(`[BuybotService] Video generation returned no URLs for ${tokenSymbol} purchase`);
        }
      } else if (mediaType === 'image' && telegramService.googleAIService) {
        this.logger.info(`[BuybotService] Generating image for $${usdValue.toFixed(0)} purchase`);
        
        const imageUrl = await telegramService.googleAIService.generateImage(prompt);
        
        if (imageUrl) {
          await telegramService.globalBot.telegram.sendPhoto(
            channelId,
            imageUrl,
            {
              caption: `🖼️ ${tokenSymbol} big buy celebration! Worth $${usdValue.toFixed(0)}! 💰`
            }
          );
          this.logger.info(`[BuybotService] Image sent successfully for ${tokenSymbol} purchase`);
        } else {
          this.logger.warn(`[BuybotService] Image generation returned null for ${tokenSymbol} purchase`);
        }
      }
    } catch (error) {
      this.logger.error(`[BuybotService] Failed to generate/send ${mediaType}:`, error);
      
      // Send fallback message
      await telegramService.globalBot.telegram.sendMessage(
        channelId,
        `⚠️ Couldn't generate ${mediaType}, but what a buy! 🚀`,
        { parse_mode: 'Markdown' }
      );
    }
  }

  /**
   * Cleanup webhook if no channels are tracking the token
   * @param {string} tokenAddress - Token address
   */
  async cleanupTokenWebhook(tokenAddress) {
    try {
      const activeCount = await this.db
        .collection(this.TRACKED_TOKENS_COLLECTION)
        .countDocuments({ tokenAddress, active: true });

      if (activeCount === 0) {
        // Stop all polling for this token
        for (const [_key, webhook] of this.activeWebhooks.entries()) {
          if (webhook.tokenAddress === tokenAddress) {
            this.stopPollingToken(webhook.channelId, tokenAddress, webhook.platform || 'discord');
          }
        }
      }
    } catch (error) {
      this.logger.error('[BuybotService] Failed to cleanup webhook:', error);
    }
  }
  /**
   * Get wallet's NFT count for a specific collection
   * @param {string} _walletAddress - Wallet address
   * @param {string} _collectionAddress - NFT collection address
   * @returns {Promise<number>} NFT count
   */
  async getWalletNftCount(_walletAddress, _collectionAddress) {
    // NFT tracking not currently supported without Helius
    // TODO: Implement alternative NFT data source if needed
    this.logger.debug('[BuybotService] NFT tracking not currently supported');
    return 0;
  }

  /**
   * Track volume for Discord channel and check if summary should be generated
   * @param {string} discordChannelId - Discord channel ID
   * @param {Object} event - Event data
   * @param {Object} token - Token data
   * @param {number} usdValue - USD value of transaction
   */
  async trackVolumeAndCheckSummary(discordChannelId, event, token, usdValue) {
    try {
      if (!usdValue) return;

      // Initialize tracking for this channel if needed
      if (!this.volumeTracking.has(discordChannelId)) {
        this.volumeTracking.set(discordChannelId, {
          totalVolume: 0,
          events: [],
          lastSummaryAt: Date.now()
        });
      }

      const tracking = this.volumeTracking.get(discordChannelId);
      
      // Add this event to tracking
      tracking.totalVolume += usdValue;
      tracking.events.push({
        type: event.type,
        tokenSymbol: token.tokenSymbol,
    tokenAddress: token.tokenAddress,
    amount: formatTokenAmount(event.amount, event.decimals || token.tokenDecimals),
        usdValue,
        timestamp: event.timestamp || new Date(),
        from: event.from,
        to: event.to
      });

      this.logger.info(`[BuybotService] Volume tracking for ${discordChannelId}: $${tracking.totalVolume.toFixed(2)} (threshold: $${this.VOLUME_THRESHOLD_USD})`);

      // Check if we've reached the threshold
      if (tracking.totalVolume >= this.VOLUME_THRESHOLD_USD) {
        await this.storeActivitySummary(discordChannelId);
      }
    } catch (error) {
      this.logger.error('[BuybotService] Error tracking volume:', error);
    }
  }

  /**
   * Store Discord activity summary in database for Telegram bot context
   * @param {string} discordChannelId - Discord channel ID
   */
  async storeActivitySummary(discordChannelId) {
    try {
      const tracking = this.volumeTracking.get(discordChannelId);
      if (!tracking || tracking.events.length === 0) return;

      // Generate summary text
      const summaryText = this.generateActivitySummary(tracking);
      
      // Get all token symbols involved
      const tokenSymbols = [...new Set(tracking.events.map(e => e.tokenSymbol))];
      const tokenAddresses = [...new Set(tracking.events.map(e => e.tokenAddress))];
      
      // Store summary in database
      await this.db.collection(this.ACTIVITY_SUMMARIES_COLLECTION).insertOne({
        discordChannelId,
        tokenSymbols,
        tokenAddresses,
        summary: summaryText,
        totalVolume: tracking.totalVolume,
        eventCount: tracking.events.length,
        swapCount: tracking.events.filter(e => e.type === 'swap').length,
        transferCount: tracking.events.filter(e => e.type === 'transfer').length,
        periodStart: new Date(tracking.lastSummaryAt),
        periodEnd: new Date(),
        createdAt: new Date()
      });

      this.logger.info(`[BuybotService] Stored activity summary for Discord channel ${discordChannelId}: $${tracking.totalVolume.toFixed(2)}`);

      // Reset tracking for this channel
      this.volumeTracking.set(discordChannelId, {
        totalVolume: 0,
        events: [],
        lastSummaryAt: Date.now()
      });

    } catch (error) {
      this.logger.error('[BuybotService] Error storing activity summary:', error);
    }
  }

  /**
   * Generate a formatted summary of trading activity
   * @param {Object} tracking - Volume tracking data
   * @returns {string} Formatted summary message
   */
  generateActivitySummary(tracking) {
    const { totalVolume, events } = tracking;
    
    // Group by token
    const tokenStats = {};
    for (const event of events) {
      if (!tokenStats[event.tokenSymbol]) {
        tokenStats[event.tokenSymbol] = {
          swapCount: 0,
          transferCount: 0,
          totalUsd: 0
        };
      }
      if (event.type === 'swap') {
        tokenStats[event.tokenSymbol].swapCount++;
      } else {
        tokenStats[event.tokenSymbol].transferCount++;
      }
      tokenStats[event.tokenSymbol].totalUsd += event.usdValue;
    }

    // Build concise summary
    let summary = `$${totalVolume.toFixed(2)} volume: `;
    
    const tokenParts = [];
    for (const [symbol, stats] of Object.entries(tokenStats)) {
      const parts = [];
      if (stats.swapCount > 0) parts.push(`${stats.swapCount} buy`);
      if (stats.transferCount > 0) parts.push(`${stats.transferCount} transfer`);
      tokenParts.push(`${symbol} (${parts.join(', ')})`);
    }
    
    summary += tokenParts.join('; ');
    
    return summary;
  }

  /**
   * Get recent activity summaries for a token
   * Used by Telegram bot to provide context about Discord activity
   * @param {string} tokenAddress - Token address or symbol
   * @param {number} limit - Number of summaries to retrieve
   * @returns {Promise<Array>} Recent activity summaries
   */
  async getRecentActivitySummaries(tokenAddress, limit = 5) {
    try {
      // Match by either tokenAddress or tokenSymbol
      const summaries = await this.db.collection(this.ACTIVITY_SUMMARIES_COLLECTION)
        .find({
          $or: [
            { tokenAddresses: tokenAddress },
            { tokenSymbols: tokenAddress }
          ]
        })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();

      return summaries;
    } catch (error) {
      this.logger.error('[BuybotService] Error getting recent summaries:', error);
      return [];
    }
  }

  /**
   * Shutdown service and cleanup
   */
  async shutdown() {
    try {
      // Stop all polling
      for (const [_key, webhook] of this.activeWebhooks.entries()) {
        if (webhook.pollTimeout) {
          clearTimeout(webhook.pollTimeout);
        }
      }
      this.activeWebhooks.clear();

      this.logger.info('[BuybotService] Shutdown complete');
    } catch (error) {
      this.logger.error('[BuybotService] Error during shutdown:', error);
    }
  }
}

export default BuybotService;
