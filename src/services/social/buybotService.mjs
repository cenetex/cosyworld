/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * BuybotService - Real-time token tracking using Helius SDK
 * 
 * Monitors Solana token purchases and transfers for designated tokens
 * Provides Discord commands to manage tracked tokens per channel
 */

import { createHelius } from 'helius-sdk';
import { PublicKey, Connection } from '@solana/web3.js';
import {
  DEFAULT_ORB_COLLECTION_ADDRESS,
  POLLING_INTERVAL_MS,
  MAX_TRACKED_TOKENS_PER_CHANNEL,
  MAX_TRACKED_COLLECTIONS_PER_CHANNEL,
  MAX_TOTAL_ACTIVE_WEBHOOKS,
  API_RETRY_MAX_ATTEMPTS,
  API_RETRY_BASE_DELAY_MS,
  PRICE_CACHE_TTL_MS
} from '../../config/buybotConstants.mjs';

export class BuybotService {
  constructor({ logger, databaseService, configService, discordService, getTelegramService, walletAvatarService }) {
    this.logger = logger || console;
    this.databaseService = databaseService;
    this.configService = configService;
    this.discordService = discordService;
    this.getTelegramService = getTelegramService || (() => null); // Late-bound to avoid circular dependency
    this.walletAvatarService = walletAvatarService;
    
    this.helius = null;
    this.connection = null;
    this.activeWebhooks = new Map(); // channelId -> webhook data
    this.db = null;
    
    // Price cache: tokenAddress -> { price, marketCap, timestamp }
    this.priceCache = new Map();
    
    // Collection names
    this.TRACKED_TOKENS_COLLECTION = 'buybot_tracked_tokens';
    this.TOKEN_EVENTS_COLLECTION = 'buybot_token_events';
    this.TRACKED_COLLECTIONS_COLLECTION = 'buybot_tracked_collections';
  }

  /**
   * Initialize the service and Helius SDK
   */
  async initialize() {
    try {
      const heliusApiKey = process.env.HELIUS_API_KEY;
      if (!heliusApiKey) {
        this.logger.warn('[BuybotService] HELIUS_API_KEY not configured, service disabled');
        return;
      }

      this.helius = createHelius({ apiKey: heliusApiKey });
      
      // Create Solana connection using Helius RPC endpoint
      const heliusRpcUrl = `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;
      this.connection = new Connection(heliusRpcUrl, 'confirmed');
      
      this.db = await this.databaseService.getDatabase();
      
      // Initialize wallet avatar service
      if (this.walletAvatarService) {
        await this.walletAvatarService.initialize();
      }
      
      // Create indexes
      await this.ensureIndexes();
      
      // Load existing tracked tokens and setup webhooks
      await this.restoreTrackedTokens();
      
      this.logger.info('[BuybotService] Initialized successfully');
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
      if (!this.helius) {
        return { success: false, message: 'Buybot service not configured. Please set HELIUS_API_KEY.' };
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

      // Fetch token metadata using Helius
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

      // Get collection info from Helius (if available)
      let collectionName = options.name || 'Unknown Collection';
      try {
        // Try to fetch collection metadata
        const response = await this.helius.getAsset({
          id: collectionAddress
        });
        
        if (response && response.content && response.content.metadata) {
          collectionName = response.content.metadata.name || collectionName;
        }
      } catch (err) {
        this.logger.warn('[BuybotService] Could not fetch collection metadata:', err.message);
      }

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
   * Get token information from Helius
   * @param {string} tokenAddress - Token mint address
   * @returns {Promise<Object|null>} Token info or null
   */
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
          liquidity: cached.liquidity
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
      };

      // Cache the result
      this.priceCache.set(tokenAddress, {
        price: result.usdPrice,
        marketCap: result.marketCap,
        liquidity: result.liquidity,
        timestamp: Date.now()
      });

      this.logger.info(`[BuybotService] Got price from DexScreener: ${result.usdPrice} USD for ${tokenAddress}`);
      
      return result;
    } catch (error) {
      this.logger.error(`[BuybotService] Failed to fetch price from DexScreener:`, error);
      return null;
    }
  }

  /**
   * Get token info from Helius
   * @param {string} tokenAddress - Token address
   * @returns {Promise<Object|null>}
   */
  async getTokenInfo(tokenAddress) {
    try {
      if (!this.helius) return null;

      // First validate the address format
      if (!this.isValidSolanaAddress(tokenAddress)) {
        this.logger.warn(`[BuybotService] Invalid Solana address format: ${tokenAddress}`);
        return null;
      }

      // Try to get asset info from Helius
      let asset;
      try {
        asset = await this.helius.getAsset({
          id: tokenAddress,
        });
      } catch (apiError) {
        // If token not found via getAsset, try alternative method
        if (apiError.message?.includes('Not Found') || apiError.message?.includes('404')) {
          this.logger.warn(`[BuybotService] Token ${tokenAddress} not found in Helius DAS API`);
          
          // Try to get price from DexScreener as fallback
          const dexScreenerData = await this.getPriceFromDexScreener(tokenAddress);
          
          // For pump.fun or new tokens, return minimal info with DexScreener price if available
          return {
            address: tokenAddress,
            name: 'Unknown Token',
            symbol: 'UNKNOWN',
            decimals: 9, // Default for SPL tokens
            supply: null,
            image: null,
            usdPrice: dexScreenerData?.usdPrice || null,
            marketCap: dexScreenerData?.marketCap || null,
            warning: 'Token not yet indexed - may be newly created or invalid',
          };
        }
        throw apiError;
      }

      if (!asset) {
        this.logger.warn(`[BuybotService] No asset data returned for ${tokenAddress}`);
        return null;
      }

      // Get basic token info
      const supply = asset.token_info?.supply;
      const decimals = asset.token_info?.decimals || 9;
      let pricePerToken = asset.token_info?.price_info?.price_per_token;
      let marketCap = null;

      // If Helius doesn't have price data, try DexScreener
      if (!pricePerToken) {
        this.logger.info(`[BuybotService] No price from Helius for ${tokenAddress}, trying DexScreener...`);
        const dexScreenerData = await this.getPriceFromDexScreener(tokenAddress);
        if (dexScreenerData) {
          pricePerToken = dexScreenerData.usdPrice;
          marketCap = dexScreenerData.marketCap;
          this.logger.info(`[BuybotService] Using DexScreener price: $${pricePerToken} for ${tokenAddress}`);
        }
      }
      
      // Calculate market cap if we have supply and price (and didn't get it from DexScreener)
      if (!marketCap && supply && pricePerToken && decimals) {
        // Convert supply from raw amount to actual token amount using decimals
        const actualSupply = supply / Math.pow(10, decimals);
        marketCap = actualSupply * pricePerToken;
      }

      return {
        address: tokenAddress,
        name: asset.content?.metadata?.name || 'Unknown Token',
        symbol: asset.content?.metadata?.symbol || 'UNKNOWN',
        decimals: decimals,
        supply: supply,
        image: asset.content?.links?.image,
        usdPrice: pricePerToken || null, // Price in USD if available
        marketCap: marketCap, // Market cap calculated from supply * price
      };
    } catch (error) {
      this.logger.error(`[BuybotService] Failed to fetch token info for ${tokenAddress}:`, error);
      return null;
    }
  }

  /**
   * Setup Helius webhook for token tracking
   * @param {string} channelId - Channel ID
   * @param {string} tokenAddress - Token address to track
   * @param {string} platform - Platform type ('discord' or 'telegram')
   */
  async setupTokenWebhook(channelId, tokenAddress, platform = 'discord') {
    try {
      if (!this.helius) return;

      // Use Helius enhanced transactions API to monitor token transfers
      // We'll poll for now, but could setup webhooks for production
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

    // Poll at configured interval
    const pollInterval = setInterval(async () => {
      try {
        await this.checkTokenTransactions(channelId, tokenAddress, platform);
      } catch (error) {
        this.logger.error(`[BuybotService] Polling error for ${tokenAddress}:`, error);
      }
    }, POLLING_INTERVAL_MS);

    this.activeWebhooks.set(key, {
      channelId,
      tokenAddress,
      platform,
      pollInterval,
      lastChecked: Date.now(),
    });

    this.logger.info(`[BuybotService] Started polling for ${tokenAddress} in channel ${channelId} (${platform})`);
  }

  /**
   * Check for new token transactions
   * @param {string} channelId - Channel ID
   * @param {string} tokenAddress - Token address
   * @param {string} platform - Platform type ('discord' or 'telegram')
   */
  async checkTokenTransactions(channelId, tokenAddress, platform = 'discord') {
    try {
      if (!this.helius) return;

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

      // Get recent transactions for the token
      // Use Helius Enhanced Transactions API to get token transfer history
      let transactions;
      try {
        // Use enhanced.getTransactionsByAddress for token mint queries
        const response = await this.helius.enhanced.getTransactionsByAddress({
          address: tokenAddress,
          limit: 10,
        });
        
        if (!response || response.length === 0) {
          // No transactions yet - this is common for very new tokens
          this.logger.debug(`[BuybotService] No transactions found for ${tokenAddress} yet`);
          
          // Reset error counter on successful query with no results
          await this.db.collection(this.TRACKED_TOKENS_COLLECTION).updateOne(
            { channelId, tokenAddress },
            { $set: { errorCount: 0 } }
          );
          return;
        }
        
        // Map to our transaction format
        transactions = response.map(tx => ({
          signature: tx.signature,
          timestamp: tx.timestamp,
          slot: tx.slot,
          type: tx.type,
          description: tx.description,
          tokenTransfers: tx.tokenTransfers || [],
          events: tx.events || {},
        }));
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
   * @param {Object} tx - Transaction data from Helius Enhanced API
   * @param {string} tokenAddress - Token address to filter for
   * @returns {Promise<Object|null>} Parsed event or null
   */
  async parseTokenTransaction(tx, tokenAddress) {
    try {
      // Look for token transfers in the transaction
      const tokenTransfers = tx.tokenTransfers || [];
      const relevantTransfers = tokenTransfers.filter(
        t => t.mint === tokenAddress && parseFloat(t.tokenAmount || 0) > 0
      );

      if (relevantTransfers.length === 0) return null;

      const transfer = relevantTransfers[0];

      // Determine event type (swap vs plain transfer)
      let eventType = 'transfer';
      let description = 'Token Transfer';
      if (tx.type === 'SWAP' || tx.description?.toLowerCase()?.includes('swap') || tx.description?.toLowerCase()?.includes('trade')) {
        eventType = 'swap';
        description = 'Token Swap/Purchase';
      }

      // Decimals (fallback to 9 if not provided)
      const decimals = transfer.decimals || 9;

      // tokenAmount from Helius may be a UI amount (e.g. "1.23") or a raw integer string.
      const tokenAmountUi = parseFloat(transfer.tokenAmount || 0);
      let rawAmount;
      if (String(transfer.tokenAmount).includes('.')) {
        rawAmount = Math.round(Math.abs(tokenAmountUi) * Math.pow(10, decimals));
      } else {
        rawAmount = Number(transfer.tokenAmount || 0);
      }

      // Try to detect holder changes using pre/post balances if available
      const preBalances = tx.preTokenBalances || [];
      const postBalances = tx.postTokenBalances || [];

      const toAccount = transfer.toUserAccount || transfer.to || transfer.toAccount || null;

      const pre = preBalances.find(b => b.owner === toAccount || b.account === toAccount || b.accountIndex === transfer.toAccountIndex) || null;
      const post = postBalances.find(b => b.owner === toAccount || b.account === toAccount || b.accountIndex === transfer.toAccountIndex) || null;

      const preAmountUi = pre ? parseFloat(pre.uiTokenAmount?.uiAmount || 0) : 0;
      const postAmountUi = post ? parseFloat(post.uiTokenAmount?.uiAmount || 0) : (preAmountUi + Math.abs(tokenAmountUi));

      const isNewHolder = preAmountUi === 0 && postAmountUi > 0;
      const isIncrease = postAmountUi > preAmountUi;

      return {
        type: eventType,
        description: tx.description || description,
        // amount stored as raw smallest-unit integer
        amount: rawAmount,
        decimals,
        preAmountUi,
        postAmountUi,
        isNewHolder,
        isIncrease,
        from: transfer.fromUserAccount || transfer.from || 'Unknown',
        to: toAccount || transfer.toUserAccount || transfer.to || 'Unknown',
        txUrl: `https://solscan.io/tx/${tx.signature}`,
        timestamp: tx.timestamp ? new Date(tx.timestamp * 1000) : new Date(),
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
      
      const emoji = event.type === 'swap' ? '💰' : '📤';
      const color = event.type === 'swap' ? 0x00ff00 : 0x0099ff;
      const formattedAmount = this.formatTokenAmount(event.amount, event.decimals || token.tokenDecimals);
      const usdValue = token.usdPrice ? this.calculateUsdValue(event.amount, event.decimals || token.tokenDecimals, token.usdPrice) : null;

      const embed = {
        title: `${emoji} ${token.tokenSymbol} ${event.type === 'swap' ? 'Purchase' : 'Transfer'}`,
        description: event.description,
        color: color,
        fields: [],
        timestamp: event.timestamp.toISOString(),
        footer: {
          text: 'Solana • Powered by Helius',
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
          value: `$${this.formatLargeNumber(token.marketCap)}`,
          inline: true,
        });
      }

      // Get wallet avatars for addresses
      let buyerAvatar = null;
      let senderAvatar = null;
      let recipientAvatar = null;

      try {
        if (event.type === 'swap' && event.to) {
          this.logger.info(`[BuybotService] Processing swap for wallet ${this.formatAddress(event.to)}`);
          const currentBalance = await this.getWalletTokenBalance(event.to, token.tokenAddress);
          const orbNftCount = await this.getWalletNftCountForChannel(event.to, channelId);
          
          this.logger.info(`[BuybotService] Wallet ${this.formatAddress(event.to)} balance: ${currentBalance} ${token.tokenSymbol}, NFTs: ${orbNftCount}`);
          
          buyerAvatar = await this.walletAvatarService.getOrCreateWalletAvatar(event.to, {
            tokenSymbol: token.tokenSymbol,
            tokenAddress: token.tokenAddress,
            amount: formattedAmount,
            usdValue: usdValue,
            currentBalance: currentBalance,
            orbNftCount: orbNftCount,
            discordChannelId: channelId,
            guildId: guildId
          });
          
          if (buyerAvatar) {
            this.logger.info(`[BuybotService] Created/retrieved avatar: ${buyerAvatar.emoji} ${buyerAvatar.name}`);
          } else {
            this.logger.info(`[BuybotService] No avatar created for ${this.formatAddress(event.to)} (balance: ${currentBalance})`);
          }
        } else if (event.type === 'transfer') {
          if (event.from) {
            this.logger.info(`[BuybotService] Processing transfer from ${this.formatAddress(event.from)}`);
            const senderBalance = await this.getWalletTokenBalance(event.from, token.tokenAddress);
            const senderOrbCount = await this.getWalletNftCountForChannel(event.from, channelId);
            
            this.logger.info(`[BuybotService] Sender ${this.formatAddress(event.from)} balance: ${senderBalance} ${token.tokenSymbol}, NFTs: ${senderOrbCount}`);
            
            senderAvatar = await this.walletAvatarService.getOrCreateWalletAvatar(event.from, {
              tokenSymbol: token.tokenSymbol,
              tokenAddress: token.tokenAddress,
              amount: formattedAmount,
              usdValue: usdValue,
              currentBalance: senderBalance,
              orbNftCount: senderOrbCount,
              discordChannelId: channelId,
              guildId: guildId
            });
            
            if (senderAvatar) {
              this.logger.info(`[BuybotService] Created/retrieved sender avatar: ${senderAvatar.emoji} ${senderAvatar.name}`);
            }
          }
          if (event.to) {
            this.logger.info(`[BuybotService] Processing transfer to ${this.formatAddress(event.to)}`);
            const recipientBalance = await this.getWalletTokenBalance(event.to, token.tokenAddress);
            const recipientOrbCount = await this.getWalletNftCountForChannel(event.to, channelId);
            
            this.logger.info(`[BuybotService] Recipient ${this.formatAddress(event.to)} balance: ${recipientBalance} ${token.tokenSymbol}, NFTs: ${recipientOrbCount}`);
            
            recipientAvatar = await this.walletAvatarService.getOrCreateWalletAvatar(event.to, {
              tokenSymbol: token.tokenSymbol,
              tokenAddress: token.tokenAddress,
              amount: formattedAmount,
              usdValue: usdValue,
              currentBalance: recipientBalance,
              orbNftCount: recipientOrbCount,
              discordChannelId: channelId,
              guildId: guildId
            });
            
            if (recipientAvatar) {
              this.logger.info(`[BuybotService] Created/retrieved recipient avatar: ${recipientAvatar.emoji} ${recipientAvatar.name}`);
            }
          }
        }
      } catch (avatarError) {
        this.logger.error('[BuybotService] Failed to get wallet avatars:', avatarError);
      }

      // From/To addresses - show wallet avatars with names/emojis
      if (event.type === 'swap') {
        if (buyerAvatar) {
          let buyerInfo = `${buyerAvatar.emoji} **${buyerAvatar.name}**`;
          if (buyerAvatar.family) {
            buyerInfo += ` _(${buyerAvatar.family})_`;
          }
          buyerInfo += `\n\`${this.formatAddress(event.to)}\``;
          
          // Get balance from flexible tokenBalances schema
          const tokenBalance = buyerAvatar.tokenBalances?.[token.tokenSymbol];
          if (tokenBalance && tokenBalance.balance >= 1_000_000) {
            buyerInfo += `\n🐋 ${this.formatLargeNumber(tokenBalance.balance)} ${token.tokenSymbol}`;
            const orbCount = buyerAvatar.nftBalances?.Orb || 0;
            if (orbCount > 0) {
              buyerInfo += ` • ${orbCount} Orb${orbCount > 1 ? 's' : ''}`;
            }
          }
          embed.fields.push({
            name: '� Buyer',
            value: buyerInfo,
            inline: false,
          });
        } else {
          embed.fields.push({
            name: '📥 To',
            value: `\`${this.formatAddress(event.to)}\``,
            inline: true,
          });
        }
      } else {
        // Transfer - show both parties
        if (senderAvatar) {
          let senderInfo = `${senderAvatar.emoji} **${senderAvatar.name}**`;
          if (senderAvatar.family) {
            senderInfo += ` _(${senderAvatar.family})_`;
          }
          senderInfo += `\n\`${this.formatAddress(event.from)}\``;
          
          // Get balance from flexible tokenBalances schema
          const tokenBalance = senderAvatar.tokenBalances?.[token.tokenSymbol];
          if (tokenBalance && tokenBalance.balance >= 1_000_000) {
            senderInfo += `\n🐋 ${this.formatLargeNumber(tokenBalance.balance)} ${token.tokenSymbol}`;
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
            name: '�📤 From',
            value: `\`${this.formatAddress(event.from)}\``,
            inline: true,
          });
        }
        
        if (recipientAvatar) {
          let recipientInfo = `${recipientAvatar.emoji} **${recipientAvatar.name}**`;
          if (recipientAvatar.family) {
            recipientInfo += ` _(${recipientAvatar.family})_`;
          }
          recipientInfo += `\n\`${this.formatAddress(event.to)}\``;
          
          // Get balance from flexible tokenBalances schema
          const tokenBalance = recipientAvatar.tokenBalances?.[token.tokenSymbol];
          if (tokenBalance && tokenBalance.balance >= 1_000_000) {
            recipientInfo += `\n🐋 ${this.formatLargeNumber(tokenBalance.balance)} ${token.tokenSymbol}`;
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
            value: `\`${this.formatAddress(event.to)}\``,
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
        const preFormatted = this.formatLargeNumber(event.preAmountUi);
        const postFormatted = this.formatLargeNumber(event.postAmountUi);
        embed.fields.push({
          name: '📈 Balance Change',
          value: `+${increasePercent}% (${preFormatted} → ${postFormatted} ${token.tokenSymbol})`,
          inline: false,
        });
      } else if (event.preAmountUi && event.postAmountUi && event.postAmountUi < event.preAmountUi) {
        const decreasePercent = ((event.preAmountUi - event.postAmountUi) / event.preAmountUi * 100).toFixed(1);
        const preFormatted = this.formatLargeNumber(event.preAmountUi);
        const postFormatted = this.formatLargeNumber(event.postAmountUi);
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

      await this.discordService.client.channels.fetch(channelId).then(channel => {
        if (channel && channel.isTextBased()) {
          channel.send({ embeds: [embed], components });
        }
      });

      this.logger.info(`[BuybotService] Sent Discord notification for ${token.tokenSymbol} ${event.type} to channel ${channelId}`);
      
      // Trigger avatar responses for full (non-partial) avatars involved in the trade
      await this.triggerAvatarTradeResponses(channelId, event, token, {
        buyerAvatar,
        senderAvatar,
        recipientAvatar
      });
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
    try {
      const { buyerAvatar, senderAvatar, recipientAvatar } = avatars;
      
      // Collect full (non-partial) avatars involved in this trade
      // Now avatars are stored directly in main avatars collection with isPartial flag
      const fullAvatars = [];
      
      if (buyerAvatar && buyerAvatar.isPartial === false && buyerAvatar._id) {
        fullAvatars.push({ avatar: buyerAvatar, role: 'buyer' });
      }
      if (senderAvatar && senderAvatar.isPartial === false && senderAvatar._id) {
        fullAvatars.push({ avatar: senderAvatar, role: 'sender' });
      }
      if (recipientAvatar && recipientAvatar.isPartial === false && recipientAvatar._id) {
        fullAvatars.push({ avatar: recipientAvatar, role: 'recipient' });
      }
      
      if (fullAvatars.length === 0) {
        this.logger.debug(`[BuybotService] No full avatars in trade, skipping responses`);
        return;
      }
      
      this.logger.info(`[BuybotService] Triggering responses for ${fullAvatars.length} full avatar(s) in trade`);
      
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
      
      // Trigger each full avatar to respond with context about the trade
      for (let i = 0; i < fullAvatars.length; i++) {
        const { avatar, role } = fullAvatars[i];
        try {
          // Build trade context prompt for the avatar
          const tradeContext = this.buildTradeContextForAvatar(event, token, role, avatar, fullAvatars);
          
          this.logger.info(`[BuybotService] Avatar ${avatar.name} responding to trade as ${role}`);
          
          // Generate response with trade context
          // Use a small delay to avoid rate limits and allow embeds to appear first
          setTimeout(async () => {
            try {
              await responseCoordinator.generateResponse(avatar, channel, null, {
                overrideCooldown: true,
                tradeContext,
                cascadeDepth: 0
              });
            } catch (respError) {
              this.logger.error(`[BuybotService] Failed to generate response for ${avatar.name}: ${respError.message}`);
            }
          }, 2000 * (i + 1)); // Stagger responses by 2 seconds each
          
        } catch (error) {
          this.logger.error(`[BuybotService] Error triggering response for avatar: ${error.message}`);
        }
      }
      
    } catch (error) {
      this.logger.error('[BuybotService] Failed to trigger avatar trade responses:', error);
    }
  }

  /**
   * Build context message for avatar to understand the trade they're involved in
   * @param {Object} event - Trade event
   * @param {Object} token - Token info
   * @param {string} role - Avatar's role (buyer/sender/recipient)
   * @param {Object} avatar - Avatar document
   * @param {Array} allAvatars - All full avatars in this trade
   * @returns {string} Context prompt
   */
  buildTradeContextForAvatar(event, token, role, avatar, allAvatars) {
    const formattedAmount = this.formatLargeNumber(event.amountUi || event.amount);
    const usdValue = event.usdValue ? `$${event.usdValue.toFixed(2)}` : '';
    
    let contextParts = [`You just witnessed a ${token.tokenSymbol} ${event.type} transaction`];
    
    if (role === 'buyer') {
      contextParts.push(`You are the buyer in this transaction`);
      contextParts.push(`You acquired ${formattedAmount} ${token.tokenSymbol}${usdValue ? ` worth ${usdValue}` : ''}`);
      if (avatar.currentBalance) {
        contextParts.push(`Your current balance: ${this.formatLargeNumber(avatar.currentBalance)} ${token.tokenSymbol}`);
      }
    } else if (role === 'sender') {
      contextParts.push(`You are the sender in this transfer`);
      contextParts.push(`You sent ${formattedAmount} ${token.tokenSymbol}${usdValue ? ` worth ${usdValue}` : ''}`);
    } else if (role === 'recipient') {
      contextParts.push(`You are the recipient in this transfer`);
      contextParts.push(`You received ${formattedAmount} ${token.tokenSymbol}${usdValue ? ` worth ${usdValue}` : ''}`);
    }
    
    // Mention other full avatars if present
    const otherAvatars = allAvatars.filter(a => a.avatar._id.toString() !== avatar._id.toString());
    if (otherAvatars.length > 0) {
      const otherNames = otherAvatars.map(a => `${a.avatar.emoji} ${a.avatar.name}`).join(', ');
      contextParts.push(`Other avatars involved: ${otherNames}`);
      contextParts.push(`Feel free to interact with them about this trade`);
    }
    
    contextParts.push(`Comment naturally on this transaction, react to it, or discuss it with others involved`);
    
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
      const telegramService = this.getTelegramService ? this.getTelegramService() : null;
      
      if (!telegramService || !telegramService.globalBot) {
        this.logger.warn('[BuybotService] Telegram service not available');
        return;
      }

      const formattedAmount = this.formatTokenAmount(event.amount, event.decimals || token.tokenDecimals);
      const usdValue = token.usdPrice ? this.calculateUsdValue(event.amount, event.decimals || token.tokenDecimals, token.usdPrice) : null;

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

      // Build enhanced notification message
      let message = '';
      
      // Title with emoji and type
      if (event.type === 'swap') {
        const emoji = token.tokenSymbol === 'RATi' ? '🐭' : '💰';
        const multiplier = usdValue ? this.getBuyMultiplier(usdValue) : '';
        message += `*${token.tokenSymbol} Buy*\n${emoji}${multiplier ? ' × ' + multiplier : ''}\n\n`;
      } else {
        // Transfer
        message += `📤 *${token.tokenSymbol} Transfer*\n\n`;
      }

      // Amount and USD value (for both swaps and transfers)
      if (usdValue) {
        message += `💵 *$${usdValue.toFixed(2)}*\n\n`;
      }

      // Token amount
      message += `${event.type === 'swap' ? 'Got' : 'Transferred'} *${formattedAmount} ${token.tokenSymbol}*\n\n`;

      // Get wallet avatars for addresses
      let buyerAvatar = null;
      let senderAvatar = null;
      let recipientAvatar = null;

      try {
        if (event.type === 'swap' && event.to) {
          // Get wallet's current token balance
          const currentBalance = await this.getWalletTokenBalance(event.to, token.tokenAddress);
          
          // Get wallet's NFT count for all tracked collections in this channel
          const orbNftCount = await this.getWalletNftCountForChannel(event.to, channelId);
          
          buyerAvatar = await this.walletAvatarService.getOrCreateWalletAvatar(event.to, {
            tokenSymbol: token.tokenSymbol,
            tokenAddress: token.tokenAddress,
            amount: formattedAmount,
            usdValue: usdValue,
            currentBalance: currentBalance,
            orbNftCount: orbNftCount,
            telegramChannelId: channelId // Pass telegram channel for introductions
          });
        } else if (event.type === 'transfer') {
          if (event.from) {
            const senderBalance = await this.getWalletTokenBalance(event.from, token.tokenAddress);
            const senderOrbCount = await this.getWalletNftCountForChannel(event.from, channelId);
            
            senderAvatar = await this.walletAvatarService.getOrCreateWalletAvatar(event.from, {
              tokenSymbol: token.tokenSymbol,
              tokenAddress: token.tokenAddress,
              amount: formattedAmount,
              usdValue: usdValue,
              currentBalance: senderBalance,
              orbNftCount: senderOrbCount,
              telegramChannelId: channelId
            });
          }
          if (event.to) {
            const recipientBalance = await this.getWalletTokenBalance(event.to, token.tokenAddress);
            const recipientOrbCount = await this.getWalletNftCountForChannel(event.to, channelId);
            
            recipientAvatar = await this.walletAvatarService.getOrCreateWalletAvatar(event.to, {
              tokenSymbol: token.tokenSymbol,
              tokenAddress: token.tokenAddress,
              amount: formattedAmount,
              usdValue: usdValue,
              currentBalance: recipientBalance,
              orbNftCount: recipientOrbCount,
              telegramChannelId: channelId
            });
          }
        }
      } catch (avatarError) {
        this.logger.error('[BuybotService] Failed to get wallet avatars:', avatarError);
      }

      // Addresses - show wallet avatars with names/emojis
      if (event.type === 'swap') {
        if (buyerAvatar) {
          message += `${buyerAvatar.emoji} Buyer: *${buyerAvatar.name}*\n`;
          if (buyerAvatar.currentBalance >= 1_000_000) {
            message += `    🐋 ${this.formatLargeNumber(buyerAvatar.currentBalance)} ${token.tokenSymbol}`;
            if (buyerAvatar.orbNftCount > 0) {
              message += ` • ${buyerAvatar.orbNftCount} Orb${buyerAvatar.orbNftCount > 1 ? 's' : ''}`;
            }
            message += `\n`;
          }
          message += `    \`${this.formatAddress(event.to)}\`\n`;
        } else {
          message += `👤 Buyer: \`${this.formatAddress(event.to)}\`\n`;
        }
      } else {
        // Transfer - show both parties with avatars
        if (senderAvatar) {
          message += `${senderAvatar.emoji} From: *${senderAvatar.name}*\n`;
          if (senderAvatar.currentBalance >= 1_000_000) {
            message += `    🐋 ${this.formatLargeNumber(senderAvatar.currentBalance)} ${token.tokenSymbol}`;
            if (senderAvatar.orbNftCount > 0) {
              message += ` • ${senderAvatar.orbNftCount} Orb${senderAvatar.orbNftCount > 1 ? 's' : ''}`;
            }
            message += `\n`;
          }
          message += `    \`${this.formatAddress(event.from)}\`\n`;
        } else {
          message += `📤 From: \`${this.formatAddress(event.from)}\`\n`;
        }
        
        if (recipientAvatar) {
          message += `${recipientAvatar.emoji} To: *${recipientAvatar.name}*\n`;
          if (recipientAvatar.currentBalance >= 1_000_000) {
            message += `    🐋 ${this.formatLargeNumber(recipientAvatar.currentBalance)} ${token.tokenSymbol}`;
            if (recipientAvatar.orbNftCount > 0) {
              message += ` • ${recipientAvatar.orbNftCount} Orb${recipientAvatar.orbNftCount > 1 ? 's' : ''}`;
            }
            message += `\n`;
          }
          message += `    \`${this.formatAddress(event.to)}\`\n`;
        } else {
          message += `📥 To: \`${this.formatAddress(event.to)}\`\n`;
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
          const preFormatted = this.formatLargeNumber(event.preAmountUi);
          const postFormatted = this.formatLargeNumber(event.postAmountUi);
          message += `   ${preFormatted} → ${postFormatted} ${token.tokenSymbol}\n`;
        }
      } else if (event.preAmountUi && event.postAmountUi && event.postAmountUi < event.preAmountUi) {
        // Handle decreases (outgoing transfers)
        const decreasePercent = ((event.preAmountUi - event.postAmountUi) / event.preAmountUi * 100).toFixed(1);
        message += `📉 Balance decreased ${decreasePercent}%\n`;
        
        const preFormatted = this.formatLargeNumber(event.preAmountUi);
        const postFormatted = this.formatLargeNumber(event.postAmountUi);
        message += `   ${preFormatted} → ${postFormatted} ${token.tokenSymbol}\n`;
      }

      // Market cap and price info
      message += `\n`;
      if (token.usdPrice) {
        message += `💲 Price: $${token.usdPrice.toFixed(6)}\n`;
      }
      if (token.marketCap) {
        message += `📊 Market Cap: $${this.formatLargeNumber(token.marketCap)}\n`;
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
   * Stop polling for a token
   * @param {string} channelId - Channel ID
   * @param {string} tokenAddress - Token address
   * @param {string} platform - Platform type
   */
  stopPollingToken(channelId, tokenAddress, platform) {
    const key = `${channelId}:${tokenAddress}`;
    const webhook = this.activeWebhooks.get(key);

    if (webhook && webhook.pollInterval) {
      clearInterval(webhook.pollInterval);
      this.activeWebhooks.delete(key);
      this.logger.info(`[BuybotService] Stopped polling for ${tokenAddress} in channel ${channelId} (${platform || 'unknown'})`);
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
            this.stopPollingToken(webhook.channelId, tokenAddress);
          }
        }
      }
    } catch (error) {
      this.logger.error('[BuybotService] Failed to cleanup webhook:', error);
    }
  }

  /**
   * Format token amount with decimals
   * @param {string|number} amount - Raw amount
   * @param {number} decimals - Token decimals
   * @returns {string} Formatted amount
   */
  formatTokenAmount(amount, decimals = 9) {
    const num = parseFloat(amount) / Math.pow(10, decimals);
    return num.toLocaleString('en-US', { maximumFractionDigits: 4 });
  }

  /**
   * Format large numbers in compact form (K, M, B)
   * @param {number} num - Number to format
   * @returns {string} Formatted number
   */
  formatLargeNumber(num) {
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
    return num.toFixed(2);
  }

  /**
   * Format Solana address for display
   * @param {string} address - Full address
   * @returns {string} Formatted address
   */
  formatAddress(address) {
    if (!address || address.length < 8) return address;
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  }

  /**
   * Get wallet's token balance using Helius
   * @param {string} walletAddress - Wallet address
   * @param {string} tokenAddress - Token mint address
   * @returns {Promise<number>} Token balance (in UI units, e.g., full tokens not lamports)
   */
  async getWalletTokenBalance(walletAddress, tokenAddress) {
    try {
      if (!this.connection) {
        this.logger.warn('[BuybotService] Connection not initialized, cannot fetch balance');
        return 0;
      }

      this.logger.debug(`[BuybotService] Fetching balance for ${this.formatAddress(walletAddress)} token ${this.formatAddress(tokenAddress)}`);

      // Use Solana Connection to get parsed token accounts
      const accounts = await this.connection.getParsedTokenAccountsByOwner(
        new PublicKey(walletAddress),
        { mint: new PublicKey(tokenAddress) }
      );

      if (!accounts || !accounts.value || accounts.value.length === 0) {
        this.logger.debug(`[BuybotService] No token accounts found for ${this.formatAddress(walletAddress)}`);
        return 0;
      }

      // Sum up all token account balances (there might be multiple)
      const totalBalance = accounts.value.reduce((sum, account) => {
        const amount = account.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0;
        return sum + amount;
      }, 0);

      this.logger.debug(`[BuybotService] Balance for ${this.formatAddress(walletAddress)}: ${totalBalance}`);
      return totalBalance;
    } catch (error) {
      this.logger.error(`[BuybotService] Failed to get wallet token balance for ${this.formatAddress(walletAddress)}:`, error);
      return 0;
    }
  }

  /**
   * Get wallet's NFT count for a specific collection using Helius
   * @param {string} walletAddress - Wallet address
   * @param {string} collectionAddress - NFT collection address
   * @returns {Promise<number>} NFT count
   */
  async getWalletNftCount(walletAddress, collectionAddress) {
    try {
      if (!this.helius) {
        this.logger.warn('[BuybotService] Helius not initialized, cannot fetch NFTs');
        return 0;
      }

      // Use Helius DAS API to get assets
      const response = await this.helius.getAssetsByOwner({
        ownerAddress: walletAddress,
        page: 1,
        limit: 1000
      });

      if (!response || !response.items) {
        return 0;
      }

      // Filter by collection
      const nftsInCollection = response.items.filter(nft => {
        // Check grouping (v1 collection standard)
        if (nft.grouping) {
          const collectionGroup = nft.grouping.find(g => g.group_key === 'collection');
          if (collectionGroup && collectionGroup.group_value === collectionAddress) {
            return true;
          }
        }
        
        // Check collection field (newer standard)
        if (nft.collection && nft.collection.address === collectionAddress) {
          return true;
        }
        
        return false;
      });

      return nftsInCollection.length;
    } catch (error) {
      this.logger.error('[BuybotService] Failed to get wallet NFT count:', error);
      return 0;
    }
  }

  /**
   * Shutdown service and cleanup
   */
  async shutdown() {
    try {
      // Stop all polling
      for (const [_key, webhook] of this.activeWebhooks.entries()) {
        if (webhook.pollInterval) {
          clearInterval(webhook.pollInterval);
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
