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
  RECENT_TRANSACTIONS_LIMIT,
  RECENT_TRANSACTIONS_MAX_PAGES
} from '../../config/buybotConstants.mjs';
import {
  formatTokenAmount,
  formatLargeNumber,
  formatAddress,
  getDisplayEmoji as normalizeDisplayEmoji,
  getBuyMultiplier as resolveBuyMultiplier,
  calculateUsdValue as computeUsdValue
} from './buybot/utils/formatters.mjs';
import { WalletInsights } from './buybot/walletInsights.mjs';

const DEFAULT_TOKEN_PREFERENCES = {
  displayEmoji: '\uD83D\uDCB0',
  transferEmoji: '\uD83D\uDCE4',
  buttons: {
    primary: {
      label: 'Swap on Jupiter',
      urlTemplate: 'https://jup.ag/swap/SOL-{address}'
    }
  },
  telegram: {
    linkLabel: 'Swap',
    linkUrlTemplate: 'https://jup.ag/swap/SOL-{address}'
  },
  notifications: {
    onlySwapEvents: false,
    transferAggregationUsdThreshold: 0
  },
  walletAvatar: {
    createFullAvatar: false,
    minBalanceForFullAvatar: 0,
    autoActivate: false,
    sendIntro: false,
    requireClaimedAvatar: false,
    requireCollectionOwnership: false,
    collectionKeys: []
  }
};

const cloneDefaultTokenPreferences = () => JSON.parse(JSON.stringify(DEFAULT_TOKEN_PREFERENCES));


export class BuybotService {
  constructor({ logger, databaseService, configService, discordService, getTelegramService, avatarService, avatarRelationshipService, walletInsights, services }) {
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

  // Cache repeated "not found" lookups to avoid hammering DexScreener for fresh mints
  this.tokenNotFoundCache = new Map(); // tokenAddress -> { timestamp, count }
  this.TOKEN_NOT_FOUND_CACHE_TTL_MS = Number(process.env.BUYBOT_TOKEN_NOT_FOUND_TTL_MS || (30 * 60_000));

  // Deduplication for in-flight token info requests
  this.pendingTokenInfoRequests = new Map(); // tokenAddress -> Promise<tokenInfo>
    
    // Wallet insights helper encapsulates Lambda polling + caching
    this.walletInsights = walletInsights || new WalletInsights({ logger: this.logger });
    this.walletInsights.configure({
      cacheTtlMs: 30_000,
      cacheMaxEntries: 100,
    });
    this.walletInsights.setResolvers({
      getLambdaEndpoint: () => this.lambdaEndpoint,
      retryWithBackoff: (fn, maxAttempts = API_RETRY_MAX_ATTEMPTS, baseDelay = API_RETRY_BASE_DELAY_MS) => this.retryWithBackoff(fn, maxAttempts, baseDelay),
      getTokenInfo: (tokenAddress) => this.getTokenInfo(tokenAddress),
    });

    // Cache for Discord channel context lookups (threads, parents, guild IDs)
    this.channelContextCache = new Map();
    this.CHANNEL_CONTEXT_TTL_MS = 5 * 60_000; // Re-resolve after five minutes

    // Volume tracking for Discord activity summaries
    // channelId -> { totalVolume, events: [], lastSummaryAt }
    this.volumeTracking = new Map();
    this.VOLUME_THRESHOLD_USD = 100; // Post summary after $100 in volume

  // Aggregation cache for low-value transfers before posting summary
  this.transferAggregationBuckets = new Map();
  this.TRANSFER_AGGREGATION_TTL_MS = 15 * 60_000; // Flush cached transfers after 15 minutes
    
    // Avatar response batching to prevent reply storms from rapid swap notifications
    // channelId -> { avatars: Map(avatarId -> {avatar, roles, events, tradeContexts}), flushTimer }
    this.avatarResponseBatches = new Map();
    this.AVATAR_RESPONSE_BATCH_WINDOW_MS = Number(process.env.BUYBOT_AVATAR_BATCH_WINDOW_MS || 5000); // 5 second batch window
    
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
        { key: { contextChannelId: 1 }, name: 'context_channel_lookup' },
        { key: { tokenAddress: 1 }, name: 'token_lookup' },
      ]);

      const tokenEventsCollection = this.db.collection(this.TOKEN_EVENTS_COLLECTION);
      const existingIndexes = await tokenEventsCollection.indexes();

      const signatureIndex = existingIndexes.find(index => index.name === 'signature_unique');
      const expectedKey = { signature: 1, channelId: 1 };
      const indexNeedsUpdate = !signatureIndex
        || JSON.stringify(signatureIndex.key) !== JSON.stringify(expectedKey)
        || signatureIndex.unique !== true;

      if (signatureIndex && indexNeedsUpdate) {
        await tokenEventsCollection.dropIndex('signature_unique');
      }

      const indexDefinitions = [
        { key: { channelId: 1, timestamp: -1 }, name: 'channel_events' },
        { key: { tokenAddress: 1, timestamp: -1 }, name: 'token_events' },
        { key: expectedKey, unique: true, name: 'signature_unique' },
        { key: { timestamp: -1 }, name: 'timestamp_lookup' },
      ];

      await tokenEventsCollection.createIndexes(indexDefinitions);

      await this.db.collection(this.TRACKED_COLLECTIONS_COLLECTION).createIndexes([
        { key: { channelId: 1, collectionAddress: 1 }, unique: true, name: 'channel_collection' },
        { key: { channelId: 1 }, name: 'collection_channel_lookup' },
        { key: { contextChannelId: 1 }, name: 'collection_context_lookup' },
        { key: { collectionAddress: 1 }, name: 'collection_lookup' },
      ]);

      this.logger.info('[BuybotService] Database indexes created');
    } catch (error) {
      this.logger.error('[BuybotService] Failed to create indexes:', error);
    }
  }

  /**
   * Resolve Discord channel context (thread metadata, parent channel, guild ID)
   * Results are cached briefly to avoid repeated API calls.
   * @param {string} channelId - Discord channel or thread ID
   * @returns {Promise<Object>} Context object
   */
  async getChannelContext(channelId) {
    const fallbackContext = {
      channelId: channelId || null,
      canonicalChannelId: channelId || null,
      parentChannelId: null,
      parentChannelName: null,
      guildId: null,
      isThread: false,
      channelName: null,
      threadName: null,
    };

    if (!channelId) {
      return fallbackContext;
    }

    try {
      const now = Date.now();
      const cachedEntry = this.channelContextCache.get(channelId);
      if (cachedEntry && (now - cachedEntry.cachedAt) < this.CHANNEL_CONTEXT_TTL_MS) {
        return cachedEntry.context;
      }

      const context = { ...fallbackContext };

      const canFetchChannel = Boolean(this.discordService?.client?.channels?.fetch);
      if (canFetchChannel) {
        try {
          const channel = await this.discordService.client.channels.fetch(channelId);
          if (channel) {
            context.channelName = channel.name || null;
            context.guildId = channel.guild?.id || null;

            const isThread = typeof channel.isThread === 'function' && channel.isThread();
            if (isThread) {
              context.isThread = true;
              context.threadName = channel.name || null;
              context.parentChannelId = channel.parentId || null;
              context.parentChannelName = channel.parent?.name || null;
              context.canonicalChannelId = channel.parentId || channelId;

              // Cache parent channel context if available but not present
              if (context.parentChannelId && !this.channelContextCache.has(context.parentChannelId)) {
                this.channelContextCache.set(context.parentChannelId, {
                  cachedAt: now,
                  context: {
                    channelId: context.parentChannelId,
                    canonicalChannelId: context.parentChannelId,
                    parentChannelId: null,
                    parentChannelName: null,
                    guildId: context.guildId,
                    isThread: false,
                    channelName: context.parentChannelName || null,
                    threadName: null,
                  },
                });
              }
            }
          }
        } catch (fetchError) {
          this.logger?.debug?.(`[BuybotService] Failed to fetch Discord channel ${channelId}: ${fetchError.message}`);
        }
      }

      this.channelContextCache.set(channelId, { cachedAt: Date.now(), context });
      return context;
    } catch (error) {
      this.logger?.debug?.(`[BuybotService] getChannelContext fallback for ${channelId}: ${error.message}`);
      return fallbackContext;
    }
  }

  /**
   * Ensure tracked token documents carry thread context metadata
   * @param {Object} token - Token document
   */
  async ensureTrackedTokenContext(token) {
    try {
      if (!token || !token._id || !token.channelId) {
        return;
      }

      const context = await this.getChannelContext(token.channelId);

      const updates = {};
      if (!token.contextChannelId && context.canonicalChannelId) {
        updates.contextChannelId = context.canonicalChannelId;
      }

      const expectedParentId = context.isThread ? (context.parentChannelId || null) : null;
      if (token.threadParentId !== expectedParentId) {
        updates.threadParentId = expectedParentId;
      }

      const expectedThreadName = context.isThread ? (context.threadName || context.channelName || null) : null;
      if (token.threadName !== expectedThreadName) {
        updates.threadName = expectedThreadName;
      }

      const expectedParentName = context.isThread ? (context.parentChannelName || null) : null;
      if (token.threadParentName !== expectedParentName) {
        updates.threadParentName = expectedParentName;
      }

      const expectedChannelName = context.channelName || null;
      if (token.channelName !== expectedChannelName) {
        updates.channelName = expectedChannelName;
      }

      const expectedIsThread = Boolean(context.isThread);
      if (typeof token.isThread === 'undefined' || Boolean(token.isThread) !== expectedIsThread) {
        updates.isThread = expectedIsThread;
      }

      if (token.guildId !== context.guildId) {
        updates.guildId = context.guildId || null;
      }

      if (Object.keys(updates).length === 0) {
        return;
      }

      updates.updatedAt = new Date();
      await this.db.collection(this.TRACKED_TOKENS_COLLECTION).updateOne(
        { _id: token._id },
        { $set: updates }
      );
    } catch (error) {
      this.logger?.debug?.(`[BuybotService] Failed to backfill token context for channel ${token?.channelId}: ${error.message}`);
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
        await this.ensureTrackedTokenContext(token);
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
      const normalizedPlatform = platform || 'discord';
      const normalizedTokenAddress = typeof tokenAddress === 'string' ? tokenAddress.trim() : tokenAddress;

      const channelContext = await this.getChannelContext(channelId);
      const canonicalChannelId = channelContext?.canonicalChannelId || channelId;
      const channelScopeIds = Array.from(new Set([
        channelId,
        canonicalChannelId,
        channelContext?.parentChannelId,
      ].filter(Boolean)));

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
      const baseChannelScopeFilter = {
        $or: [
          { channelId: { $in: channelScopeIds } },
          { contextChannelId: { $in: channelScopeIds } },
        ],
      };

      const platformFilter = normalizedPlatform === 'discord'
        ? {
            $or: [
              { platform: 'discord' },
              { platform: null },
              { platform: { $exists: false } },
            ],
          }
        : { platform: normalizedPlatform };

      const channelTokenQuery = {
        active: true,
        $and: [baseChannelScopeFilter, platformFilter],
      };

      let channelTokenCount = await this.db.collection(this.TRACKED_TOKENS_COLLECTION)
        .countDocuments(channelTokenQuery);

      if (normalizedPlatform !== 'discord' && channelTokenCount >= MAX_TRACKED_TOKENS_PER_CHANNEL) {
        return {
          success: false,
          message: `Channel limit reached: maximum ${MAX_TRACKED_TOKENS_PER_CHANNEL} tokens per channel. Remove some before adding more.`
        };
      }

      // Validate token address format (basic check)
      if (!normalizedTokenAddress || normalizedTokenAddress.length < 32 || normalizedTokenAddress.length > 44) {
        return { success: false, message: 'Invalid Solana token address format.' };
      }

      // Fetch token metadata
      const tokenInfo = await this.getTokenInfo(normalizedTokenAddress);
      if (!tokenInfo) {
        return { success: false, message: 'Could not fetch token information. Verify the address is correct.' };
      }

      // Prevent the same token from being tracked in multiple Discord channels
      if (normalizedPlatform === 'discord') {
        const conflictingChannel = await this.db.collection(this.TRACKED_TOKENS_COLLECTION).findOne({
          tokenAddress: normalizedTokenAddress,
          active: true,
          channelId: { $ne: channelId },
          $or: [
            { platform: 'discord' },
            { platform: null },
            { platform: { $exists: false } },
          ],
        });

        if (conflictingChannel) {
          const channelMention = typeof conflictingChannel.channelId === 'string' && /^\d+$/.test(conflictingChannel.channelId)
            ? `<#${conflictingChannel.channelId}>`
            : conflictingChannel.channelId;

          return {
            success: false,
            message: `That token is already being tracked in Discord channel ${channelMention}. Ask them to run !ca-remove before adding it here.`
          };
        }
      }

      // Check if already tracking
      const existingQuery = {
        channelId,
        tokenAddress: normalizedTokenAddress,
      };

      if (normalizedPlatform === 'discord') {
        existingQuery.$or = [
          { platform: 'discord' },
          { platform: null },
          { platform: { $exists: false } },
        ];
      } else {
        existingQuery.platform = normalizedPlatform;
      }

      const existing = await this.db.collection(this.TRACKED_TOKENS_COLLECTION).findOne(existingQuery);

      if (existing && existing.active) {
        return { 
          success: false, 
          message: `Already tracking ${tokenInfo.name || normalizedTokenAddress} in this channel.` 
        };
      }

      const replacedTokens = [];
      const contextUpdateFields = {
        contextChannelId: canonicalChannelId,
        guildId: channelContext?.guildId || null,
        channelName: channelContext?.channelName || null,
        isThread: Boolean(channelContext?.isThread),
        threadParentId: channelContext?.isThread ? (channelContext.parentChannelId || null) : null,
        threadParentName: channelContext?.isThread ? (channelContext.parentChannelName || null) : null,
        threadName: channelContext?.isThread ? (channelContext.threadName || channelContext.channelName || null) : null,
      };

      // For Discord, ensure the channel only tracks this token going forward
      if (normalizedPlatform === 'discord') {
        const replacementCandidates = await this.db.collection(this.TRACKED_TOKENS_COLLECTION)
          .find({
            active: true,
            tokenAddress: { $ne: normalizedTokenAddress },
            $and: [
              baseChannelScopeFilter,
              {
                $or: [
                  { platform: 'discord' },
                  { platform: null },
                  { platform: { $exists: false } },
                ],
              },
            ],
          })
          .toArray();

        if (replacementCandidates.length > 0) {
          const removalIds = replacementCandidates.map(token => token._id).filter(Boolean);
          const uniqueAddresses = [...new Set(replacementCandidates.map(token => token.tokenAddress))];

          if (removalIds.length > 0) {
            await this.db.collection(this.TRACKED_TOKENS_COLLECTION).updateMany(
              { _id: { $in: removalIds } },
              { $set: { active: false, removedAt: new Date(), removalReason: 'channel_token_replaced' } }
            );
          }

          for (const candidate of replacementCandidates) {
            this.stopPollingToken(candidate.channelId, candidate.tokenAddress, candidate.platform || 'discord');
            replacedTokens.push({
              tokenAddress: candidate.tokenAddress,
              tokenSymbol: candidate.tokenSymbol,
              tokenName: candidate.tokenName,
            });
          }

          for (const address of uniqueAddresses) {
            await this.cleanupTokenWebhook(address);
          }

          channelTokenCount = 0;
        }
      } else if (channelTokenCount >= MAX_TRACKED_TOKENS_PER_CHANNEL) {
        return {
          success: false,
          message: `Channel limit reached: maximum ${MAX_TRACKED_TOKENS_PER_CHANNEL} tokens per channel. Remove some before adding more.`
        };
      }

      // Add or update token tracking
      const upsertQuery = existing && existing._id
        ? { _id: existing._id }
        : {
            channelId,
            tokenAddress: normalizedTokenAddress,
            platform: normalizedPlatform,
          };

      await this.db.collection(this.TRACKED_TOKENS_COLLECTION).updateOne(
        upsertQuery,
        {
          $set: {
            active: true,
            platform: normalizedPlatform,
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
            ...contextUpdateFields,
          },
        },
        { upsert: true }
      );

      // Setup webhook for tracking
      await this.setupTokenWebhook(channelId, normalizedTokenAddress, normalizedPlatform);

      if (replacedTokens.length > 0) {
        const replacedSummary = replacedTokens.map(token => token.tokenSymbol || token.tokenAddress).join(', ');
        this.logger.info(`[BuybotService] Replaced existing tracked tokens [${replacedSummary}] in channel ${channelId}`);
      }

      this.logger.info(`[BuybotService] Added tracking for ${tokenInfo.symbol} (${normalizedTokenAddress}) in channel ${channelId}`);

      return {
        success: true,
        message: `Now tracking **${tokenInfo.name}** (${tokenInfo.symbol})`,
        tokenInfo,
        replacedTokens,
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

      const channelContext = await this.getChannelContext(channelId);
      const canonicalChannelId = channelContext?.canonicalChannelId || channelId;
      const channelScopeIds = Array.from(new Set([
        channelId,
        canonicalChannelId,
        channelContext?.parentChannelId,
      ].filter(Boolean)));

      const baseChannelScopeFilter = {
        $or: [
          { channelId: { $in: channelScopeIds } },
          { contextChannelId: { $in: channelScopeIds } },
        ],
      };

      // Check per-channel limit
      const channelCollectionCount = await this.db.collection(this.TRACKED_COLLECTIONS_COLLECTION)
        .countDocuments({
          active: true,
          ...baseChannelScopeFilter,
        });
      
      if (channelCollectionCount >= MAX_TRACKED_COLLECTIONS_PER_CHANNEL) {
        return {
          success: false,
          message: `Channel limit reached: maximum ${MAX_TRACKED_COLLECTIONS_PER_CHANNEL} collections per channel. Remove some before adding more.`
        };
      }

      // Check if already tracking
      const existing = await this.db.collection(this.TRACKED_COLLECTIONS_COLLECTION).findOne({
        collectionAddress,
        active: true,
        ...baseChannelScopeFilter,
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
        contextChannelId: canonicalChannelId,
        guildId: channelContext?.guildId || null,
        channelName: channelContext?.channelName || null,
        isThread: Boolean(channelContext?.isThread),
        threadParentId: channelContext?.isThread ? (channelContext.parentChannelId || null) : null,
        threadParentName: channelContext?.isThread ? (channelContext.parentChannelName || null) : null,
        threadName: channelContext?.isThread ? (channelContext.threadName || channelContext.channelName || null) : null,
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
      const channelContext = await this.getChannelContext(channelId);
      const canonicalChannelId = channelContext?.canonicalChannelId || channelId;
      const scopeIds = Array.from(new Set([
        channelId,
        canonicalChannelId,
        channelContext?.parentChannelId,
      ].filter(Boolean)));

      const results = await this.db
        .collection(this.TRACKED_COLLECTIONS_COLLECTION)
        .find({
          active: true,
          $or: [
            { channelId: { $in: scopeIds } },
            { contextChannelId: { $in: scopeIds } },
          ],
        })
        .toArray();

      const seen = new Set();
      const collections = [];

      for (const record of results) {
        const key = record?._id ? record._id.toString() : `${record?.channelId || 'unknown'}:${record?.collectionAddress || 'unknown'}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);

        const inheritedFromParent = record?.channelId && record.channelId !== channelId;
        collections.push({
          ...record,
          inheritedFromParent,
        });
      }

      return collections;
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
      const uniqueCollections = new Map();

      for (const collection of trackedCollections) {
        if (!collection?.collectionAddress) {
          continue;
        }
        if (!uniqueCollections.has(collection.collectionAddress)) {
          uniqueCollections.set(collection.collectionAddress, collection);
        }
      }

      for (const collection of uniqueCollections.values()) {
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
   * Check if a channel has buybot notifications enabled (has tracked tokens)
   * @param {string} channelId - Discord channel ID
   * @returns {Promise<boolean>} True if channel has active buybot tracking
   */
  async hasbuybotNotifications(channelId) {
    try {
      if (!channelId || !this.db) {
        return false;
      }

      const count = await this.db.collection(this.TRACKED_TOKENS_COLLECTION)
        .countDocuments({
          channelId,
          active: true
        });

      return count > 0;
    } catch (error) {
      this.logger.error('[BuybotService] Failed to check buybot notifications:', error);
      return false;
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

  _isTokenTemporarilySuppressed(tokenAddress) {
    if (!tokenAddress) return false;
    const entry = this.tokenNotFoundCache.get(tokenAddress);
    if (!entry) {
      return false;
    }

    const age = Date.now() - entry.timestamp;
    if (age > this.TOKEN_NOT_FOUND_CACHE_TTL_MS) {
      this.tokenNotFoundCache.delete(tokenAddress);
      return false;
    }

    return true;
  }

  _markTokenAsNotFound(tokenAddress, reason = 'unknown') {
    if (!tokenAddress) {
      return;
    }

    const previous = this.tokenNotFoundCache.get(tokenAddress);
    const entry = {
      timestamp: Date.now(),
      count: (previous?.count || 0) + 1,
      reason,
    };

    this.tokenNotFoundCache.set(tokenAddress, entry);

    const ttlMinutes = (this.TOKEN_NOT_FOUND_CACHE_TTL_MS / 60_000).toFixed(1);
    if (!previous) {
      this.logger?.warn?.(`[BuybotService] Token ${tokenAddress} not found on DexScreener (${reason}); suppressing lookups for ~${ttlMinutes}m`);
    } else {
      this.logger?.debug?.(`[BuybotService] Token ${tokenAddress} still unavailable on DexScreener (${reason}); attempts=${entry.count}`);
    }
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
          image: cached.image,
          priceChange: cached.priceChange || null
        };
      }

      if (this._isTokenTemporarilySuppressed(tokenAddress)) {
        this.logger.debug(`[BuybotService] Skipping DexScreener lookup for ${tokenAddress} (recently not found)`);
        return null;
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
        this._markTokenAsNotFound(tokenAddress, 'no-pairs');
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
        this._markTokenAsNotFound(tokenAddress, 'no-price');
        return null;
      }

      const toNumber = (value) => {
        if (value === null || value === undefined) return null;
        const num = typeof value === 'string' ? parseFloat(value) : Number(value);
        return Number.isFinite(num) ? num : null;
      };

      const priceChange = {
        h1: toNumber(bestPair?.priceChange?.h1),
        h6: toNumber(bestPair?.priceChange?.h6),
        h24: toNumber(bestPair?.priceChange?.h24),
        d7: toNumber(bestPair?.priceChange?.d7),
        d30: toNumber(bestPair?.priceChange?.d30),
      };

      const result = {
        usdPrice: parseFloat(bestPair.priceUsd),
        marketCap: bestPair.fdv || bestPair.marketCap,
        liquidity: bestPair.liquidity?.usd,
        name: bestPair.baseToken?.name || 'Unknown Token',
        symbol: bestPair.baseToken?.symbol || 'UNKNOWN',
        image: bestPair.info?.imageUrl || null,
        priceChange,
      };

      // Cache the result
      this.priceCache.set(tokenAddress, {
        price: result.usdPrice,
        marketCap: result.marketCap,
        liquidity: result.liquidity,
        name: result.name,
        symbol: result.symbol,
        image: result.image,
        priceChange,
        timestamp: Date.now()
      });

      this.tokenNotFoundCache.delete(tokenAddress);

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

      // Check for pending request to avoid duplicate calls
      if (this.pendingTokenInfoRequests.has(tokenAddress)) {
        this.logger.debug(`[BuybotService] Reusing pending token info request for ${tokenAddress}`);
        return this.pendingTokenInfoRequests.get(tokenAddress);
      }
      
      // First validate the address format
      if (!this.isValidSolanaAddress(tokenAddress)) {
        this.logger.warn(`[BuybotService] Invalid Solana address format: ${tokenAddress}`);
        return null;
      }

      // Create the promise for fetching data
      const fetchPromise = (async () => {
        try {
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
              priceChange: dexScreenerData.priceChange || null,
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
          if (this._isTokenTemporarilySuppressed(tokenAddress)) {
            this.logger.debug(`[BuybotService] Token ${tokenAddress} suppressed after repeated DexScreener misses; returning fallback avatar info`);
          } else {
            this.logger.warn(`[BuybotService] Token ${tokenAddress} not found in DexScreener`);
          }
          const tokenInfo = {
            address: tokenAddress,
            name: 'Unknown Token',
            symbol: 'UNKNOWN',
            decimals: 9, // Default for SPL tokens
            supply: null,
            image: null,
            usdPrice: null,
            marketCap: null,
            priceChange: null,
            warning: 'Token not found - may be newly created or invalid',
          };
          
          // Cache the fallback token info
          this.tokenInfoCache.set(tokenAddress, {
            tokenInfo,
            timestamp: Date.now()
          });
          
          return tokenInfo;
        } finally {
          // Clean up pending request
          this.pendingTokenInfoRequests.delete(tokenAddress);
        }
      })();

      // Store the pending request
      this.pendingTokenInfoRequests.set(tokenAddress, fetchPromise);
      
      return fetchPromise;
    } catch (error) {
      this.logger.error(`[BuybotService] Failed to fetch token info for ${tokenAddress}:`, error);
      this.pendingTokenInfoRequests.delete(tokenAddress);
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

      const tokenPreferences = this.getTokenPreferences(token);
      token.tokenPreferences = tokenPreferences;

      // Ensure the token document always carries the address for downstream consumers.
      if (!token.tokenAddress) {
        token.tokenAddress = tokenAddress;
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

      // Build incremental parameters for Solana monitor queries
      const normalizedLastSeenSlotValue = Number.isFinite(token.lastSeenSlot)
        ? token.lastSeenSlot
        : Number(token.lastSeenSlot);
      const lastSeenSlot = Number.isFinite(normalizedLastSeenSlotValue) && normalizedLastSeenSlotValue > 0
        ? normalizedLastSeenSlotValue
        : null;

      const lastSeenSignature = typeof token.lastSeenSignature === 'string' && token.lastSeenSignature.length > 0
        ? token.lastSeenSignature
        : null;

      const lastSeenAtDate = token.lastSeenAt ? new Date(token.lastSeenAt) : null;
      const lastEventAtDate = token.lastEventAt ? new Date(token.lastEventAt) : null;
      const lastSeenBlockTime = lastSeenAtDate && !Number.isNaN(lastSeenAtDate.getTime())
        ? Math.floor(lastSeenAtDate.getTime() / 1000)
        : (lastEventAtDate && !Number.isNaN(lastEventAtDate.getTime())
          ? Math.floor(lastEventAtDate.getTime() / 1000)
          : null);

      const baseUrl = new URL(`${this.lambdaEndpoint}/stats/recent-transactions`);
      baseUrl.searchParams.set('mint', tokenAddress);
      baseUrl.searchParams.set('limit', RECENT_TRANSACTIONS_LIMIT.toString());
      baseUrl.searchParams.set('refresh', 'if-stale');

      if (lastSeenSlot) {
        baseUrl.searchParams.set('sinceSlot', String(lastSeenSlot));
      }
      if (lastSeenBlockTime) {
        baseUrl.searchParams.set('sinceBlockTime', String(lastSeenBlockTime));
      }
      if (lastSeenSignature) {
        baseUrl.searchParams.set('sinceSignature', lastSeenSignature);
      }

  const rawTransactions = [];
  let transactions = [];
      let paginationCursor = null;
      let pageCount = 0;
      let hitInitialPageLimit = false;
      let morePagesAvailable = false;

      try {
        while (pageCount < RECENT_TRANSACTIONS_MAX_PAGES) {
          const pageUrl = new URL(baseUrl);
          if (paginationCursor) {
            pageUrl.searchParams.set('paginationToken', paginationCursor);
          }

          const payload = await this.retryWithBackoff(async () => {
            const lambdaResponse = await fetch(pageUrl.toString(), { headers: { accept: 'application/json' } });
            if (!lambdaResponse.ok) {
              throw new Error(`Lambda API returned ${lambdaResponse.status}: ${await lambdaResponse.text()}`);
            }
            return await lambdaResponse.json();
          });

          const pageData = Array.isArray(payload?.data) ? payload.data : [];
          if (pageCount === 0 && pageData.length >= RECENT_TRANSACTIONS_LIMIT) {
            hitInitialPageLimit = true;
          }
          rawTransactions.push(...pageData);

          pageCount += 1;

          const hasNextPage = Boolean(payload?.paginationToken);
          const fetchedFullPage = pageData.length >= RECENT_TRANSACTIONS_LIMIT;

          if (!hasNextPage || !fetchedFullPage) {
            break;
          }

          paginationCursor = payload.paginationToken;

          if (pageCount >= RECENT_TRANSACTIONS_MAX_PAGES) {
            morePagesAvailable = true;
            break;
          }
        }

        if (morePagesAvailable) {
          this.logger.warn(
            `[BuybotService] High volume detected for ${tokenAddress} — fetched ${rawTransactions.length} transactions but additional pages remain (max=${RECENT_TRANSACTIONS_MAX_PAGES}). ` +
            'Remaining activity will be captured on the next poll.'
          );
        } else if (hitInitialPageLimit && !lastSeenSlot) {
          this.logger.warn(
            `[BuybotService] Initial transaction sync for ${tokenAddress} reached the page limit (${RECENT_TRANSACTIONS_LIMIT}). ` +
            'Consider increasing BUYBOT_RECENT_TRANSACTIONS_LIMIT for deeper history.'
          );
        }

        if (rawTransactions.length === 0) {
          this.logger.debug(`[BuybotService] No transactions found for ${tokenAddress} with current filters`);
          await this.db.collection(this.TRACKED_TOKENS_COLLECTION).updateOne(
            { channelId, tokenAddress },
            { $set: { errorCount: 0, lastCheckedAt: new Date() } }
          );
          return;
        }

        let maxObservedSlot = lastSeenSlot ?? 0;
        const initialBlockTime = lastSeenBlockTime ?? 0;
        let maxObservedBlockTime = initialBlockTime;

        for (const rawTx of rawTransactions) {
          if (Number.isFinite(rawTx?.slot) && rawTx.slot > maxObservedSlot) {
            maxObservedSlot = rawTx.slot;
          }
          if (Number.isFinite(rawTx?.blockTime) && rawTx.blockTime > maxObservedBlockTime) {
            maxObservedBlockTime = rawTx.blockTime;
          }
        }

        // Map Lambda API response to our transaction format
  transactions = rawTransactions.map(tx => {
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

        const pollMetadataUpdate = {
          lastCheckedAt: new Date(),
          errorCount: 0,
        };

        if (maxObservedSlot && (!lastSeenSlot || maxObservedSlot > lastSeenSlot)) {
          pollMetadataUpdate.lastSeenSlot = maxObservedSlot;
        }

        if (maxObservedBlockTime && maxObservedBlockTime > (lastSeenBlockTime ?? 0)) {
          pollMetadataUpdate.lastSeenAt = new Date(maxObservedBlockTime * 1000);
        }

        if (transactions.length > 0) {
          pollMetadataUpdate.lastSeenSignature = transactions[transactions.length - 1].signature;
        }

        await this.db.collection(this.TRACKED_TOKENS_COLLECTION).updateOne(
          { channelId, tokenAddress },
          { $set: pollMetadataUpdate }
        );

        if (!transactions || transactions.length === 0) {
          return;
        }
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
          channelId,
        });

        if (existing) continue;

        // Parse transaction for token events
        const event = await this.parseTokenTransaction(tx, tokenAddress);

        // Skip non-purchase events when configured for swap-only notifications
        if (event && tokenPreferences?.notifications?.onlySwapEvents && event.type !== 'swap') {
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
              this.logger.debug(`[BuybotService] Duplicate token event ${tx.signature} detected for channel ${channelId}, skipping insert`);
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
   * Remove expired transfer aggregation buckets to avoid stale memory.
   * @param {number} [now=Date.now()] - Current timestamp in milliseconds
   */
  cleanupExpiredTransferAggregations(now = Date.now()) {
    for (const [key, bucket] of this.transferAggregationBuckets.entries()) {
      if (!bucket || !bucket.expireAt || bucket.expireAt <= now) {
        this.transferAggregationBuckets.delete(key);
      }
    }
  }

  /**
   * Build a cache key for aggregating transfers.
   * @param {string} channelId
   * @param {Object} token
   * @param {Object} event
   * @returns {string|null}
   */
  getTransferAggregationKey(channelId, token, event) {
    if (!channelId || !event?.from || !event?.to) {
      return null;
    }

    const tokenKey = String(
      token?.tokenAddress || token?.mint || token?.address || token?.tokenSymbol || token?.symbol || ''
    ).toLowerCase();
    const from = String(event.from).toLowerCase();
    const to = String(event.to).toLowerCase();

    if (!from || !to) {
      return null;
    }

    return `${channelId}:${tokenKey}:${from}>${to}`;
  }

  /**
   * Cache low-value transfers and emit a rolled-up summary when the configured threshold is reached.
   * @param {string} channelId
   * @param {Object} event
   * @param {Object} token
   * @param {Object} tokenPreferences
   * @param {number|null} usdValue
   * @param {Object} avatars - Object with senderAvatar and recipientAvatar
   * @returns {'continue'|'suppress'|'handled'}
   */
  async handleTransferAggregation(channelId, event, token, tokenPreferences, usdValue, avatars = {}) {
    const { senderAvatar, recipientAvatar } = avatars;
    const thresholdRaw = tokenPreferences?.notifications?.transferAggregationUsdThreshold;
    const threshold = Number(thresholdRaw);

    // Debug logging to understand why threshold isn't working
    this.logger.debug?.(`[BuybotService] Transfer aggregation check:`, {
      tokenSymbol: token?.tokenSymbol,
      channelId,
      thresholdRaw,
      threshold,
      usdValue,
      hasNotificationsConfig: !!tokenPreferences?.notifications,
      notificationsConfig: tokenPreferences?.notifications
    });

    if (!Number.isFinite(threshold) || threshold <= 0) {
      this.logger.debug?.(`[BuybotService] No valid threshold configured (${threshold}), continuing with normal notification`);
      return 'continue';
    }

    if (!Number.isFinite(usdValue) || usdValue <= 0) {
      this.logger.debug?.(`[BuybotService] Invalid USD value (${usdValue}), continuing with normal notification`);
      return 'continue';
    }

    const key = this.getTransferAggregationKey(channelId, token, event);
    if (!key) {
      this.logger.debug?.(`[BuybotService] Could not generate aggregation key, continuing with normal notification`);
      return 'continue';
    }

    // If this transfer alone exceeds the threshold, post immediately
    if (usdValue >= threshold) {
      this.logger.debug?.(`[BuybotService] Transfer USD ${usdValue} >= threshold ${threshold}, posting immediately`);
      if (this.transferAggregationBuckets.has(key)) {
        this.transferAggregationBuckets.delete(key);
      }
      return 'continue';
    }

    this.cleanupExpiredTransferAggregations();

    const decimals = event.decimals || token.tokenDecimals || 9;
    const now = Date.now();
    let bucket = this.transferAggregationBuckets.get(key);

    if (!bucket) {
      bucket = {
        channelId,
        tokenAddress: token?.tokenAddress || token?.mint || null,
        tokenSymbol: token?.tokenSymbol || token?.symbol || '',
        from: event.from,
        to: event.to,
        decimals,
        totalUsd: 0,
        totalAmount: 0,
        events: [],
        firstTimestamp: now,
        lastTimestamp: now,
        expireAt: now + this.TRANSFER_AGGREGATION_TTL_MS
      };
    }

    const amountNumeric = Number(event.amount || 0);
    bucket.totalUsd += usdValue;
    if (Number.isFinite(amountNumeric)) {
      bucket.totalAmount += amountNumeric;
    }
    bucket.events.push({
      usdValue,
      amount: event.amount,
      formattedAmount: formatTokenAmount(event.amount, decimals),
      timestamp: event.timestamp instanceof Date ? event.timestamp : new Date(),
      senderAvatar: senderAvatar ? { 
        name: senderAvatar.name, 
        emoji: senderAvatar.emoji,
        walletAddress: senderAvatar.walletAddress 
      } : null,
      recipientAvatar: recipientAvatar ? { 
        name: recipientAvatar.name, 
        emoji: recipientAvatar.emoji,
        walletAddress: recipientAvatar.walletAddress 
      } : null
    });
    bucket.lastTimestamp = now;
    bucket.expireAt = now + this.TRANSFER_AGGREGATION_TTL_MS;

    this.transferAggregationBuckets.set(key, bucket);

    if (bucket.totalUsd >= threshold) {
      this.transferAggregationBuckets.delete(key);
      await this.sendTransferAggregationSummary(channelId, token, bucket, threshold, tokenPreferences);
      return 'handled';
    }

    this.logger?.debug?.('[BuybotService] Cached low-value transfer for aggregation', {
      channelId,
      token: bucket.tokenSymbol,
      from: formatAddress(bucket.from),
      to: formatAddress(bucket.to),
      cachedUsd: bucket.totalUsd,
      threshold
    });

    return 'suppress';
  }

  /**
   * Format aggregation window for embed display.
   * @param {number} startMs
   * @param {number} endMs
   * @returns {string}
   */
  formatAggregationWindow(startMs, endMs) {
    const start = new Date(startMs);
    const end = new Date(endMs);
    if (start.toDateString() === end.toDateString()) {
      return `${start.toLocaleTimeString()} → ${end.toLocaleTimeString()}`;
    }
    return `${start.toLocaleString()} → ${end.toLocaleString()}`;
  }

  /**
   * Emit a Discord summary for aggregated low-value transfers.
   * @param {string} channelId
   * @param {Object} token
   * @param {Object} bucket
   * @param {number} threshold
   * @param {Object} tokenPreferences
   */
  async sendTransferAggregationSummary(channelId, token, bucket, threshold, tokenPreferences) {
    try {
      const transferEmoji = tokenPreferences?.transferEmoji || '\uD83D\uDCE4';
      const totalAmountDisplay = formatTokenAmount(bucket.totalAmount, bucket.decimals);
      const windowLabel = this.formatAggregationWindow(bucket.firstTimestamp, bucket.lastTimestamp);
      const minUsd = bucket.events.reduce((min, evt) => Math.min(min, evt.usdValue), Number.POSITIVE_INFINITY);
      const maxUsd = bucket.events.reduce((max, evt) => Math.max(max, evt.usdValue), 0);

      // Collect unique avatars involved
      const senderAvatars = new Map();
      const recipientAvatars = new Map();
      
      for (const evt of bucket.events) {
        if (evt.senderAvatar && evt.senderAvatar.walletAddress) {
          senderAvatars.set(evt.senderAvatar.walletAddress, evt.senderAvatar);
        }
        if (evt.recipientAvatar && evt.recipientAvatar.walletAddress) {
          recipientAvatars.set(evt.recipientAvatar.walletAddress, evt.recipientAvatar);
        }
      }

      // Build participant display with avatars
      const senderDisplay = senderAvatars.size > 0
        ? Array.from(senderAvatars.values())
            .map(av => `${this.getDisplayEmoji(av.emoji)} **${av.name}**`)
            .join(', ')
        : `\`${formatAddress(bucket.from)}\``;
      
      const recipientDisplay = recipientAvatars.size > 0
        ? Array.from(recipientAvatars.values())
            .map(av => `${this.getDisplayEmoji(av.emoji)} **${av.name}**`)
            .join(', ')
        : `\`${formatAddress(bucket.to)}\``;

      const recentTransfers = bucket.events
        .slice(-5)
        .map(evt => `• $${evt.usdValue.toFixed(2)} (${evt.formattedAmount} ${token.tokenSymbol})`)
        .join('\n');

      const embed = {
        title: `${transferEmoji} ${token.tokenSymbol} Transfer Summary`,
        description: `Multiple low-value transfers from ${senderDisplay} to ${recipientDisplay} exceeded the configured $${threshold.toFixed(2)} threshold.`,
        color: 0x0099ff,
        fields: [
          { name: 'Transfers', value: `${bucket.events.length}`, inline: true },
          { name: 'Total USD', value: `$${bucket.totalUsd.toFixed(2)}`, inline: true },
          { name: 'Total Amount', value: `${totalAmountDisplay} ${token.tokenSymbol}`, inline: true },
          { name: 'Window', value: windowLabel, inline: false },
          { name: 'Threshold', value: `$${threshold.toFixed(2)}`, inline: true }
        ],
        timestamp: new Date(bucket.lastTimestamp).toISOString(),
        footer: {
          text: 'Batched transfer summary • Buybot'
        }
      };

      if (Number.isFinite(minUsd) && Number.isFinite(maxUsd) && bucket.events.length > 1) {
        embed.fields.push({
          name: 'Individual Range',
          value: `$${minUsd.toFixed(2)} - $${maxUsd.toFixed(2)}`,
          inline: true
        });
      }

      if (recentTransfers) {
        embed.fields.push({
          name: 'Recent Transfers',
          value: recentTransfers,
          inline: false
        });
      }

      const dexScreenerUrl = `https://dexscreener.com/solana/${token.tokenAddress}`;
      const primaryButton = tokenPreferences?.buttons?.primary || {};
      const primaryUrl = this.resolveUrlTemplate(primaryButton.urlTemplate, token) || `https://jup.ag/swap/SOL-${token.tokenAddress}`;
      const components = [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: 'DexScreener',
              url: dexScreenerUrl
            }
          ]
        }
      ];

      if (primaryUrl) {
        components[0].components.push({
          type: 2,
          style: 5,
          label: primaryButton.label || 'Swap on Jupiter',
          url: primaryUrl
        });
      }

      const channel = await this.discordService.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        throw new Error(`Channel ${channelId} unavailable for aggregated transfer summary`);
      }

      const sentMessage = await channel.send({ embeds: [embed], components });
      this.logger.info(`[BuybotService] Sent aggregated transfer summary for ${token.tokenSymbol} to channel ${channelId} (message ID: ${sentMessage.id})`);

      const summaryEvent = {
        type: 'transfer',
        amount: bucket.totalAmount,
        decimals: bucket.decimals,
        timestamp: new Date(bucket.lastTimestamp),
        from: bucket.from,
        to: bucket.to
      };

      await this.trackVolumeAndCheckSummary(channelId, summaryEvent, token, bucket.totalUsd);
    } catch (error) {
      this.logger.error('[BuybotService] Failed to send aggregated transfer summary:', error);
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
      
      const tokenPreferences = token?.tokenPreferences || this.getTokenPreferences(token);
      const effectiveType = event?.inferredType || event.type;
      const displayDescription = event?.displayDescription || event.description;
  const requireClaimedAvatar = Boolean(tokenPreferences?.walletAvatar?.requireClaimedAvatar);
      const requireCollectionOwnership = Boolean(tokenPreferences?.walletAvatar?.requireCollectionOwnership);

      // Debug: Log token preferences for transfer threshold debugging
      if (effectiveType === 'transfer') {
        this.logger.debug?.(`[BuybotService] Token preferences for ${token?.tokenSymbol}:`, {
          hasPreferences: !!tokenPreferences,
          hasNotifications: !!tokenPreferences?.notifications,
          transferThreshold: tokenPreferences?.notifications?.transferAggregationUsdThreshold,
          fullNotificationsConfig: tokenPreferences?.notifications
        });
      }

      const swapEmoji = tokenPreferences.displayEmoji || '\uD83D\uDCB0';
      const transferEmoji = tokenPreferences.transferEmoji || '\uD83D\uDCE4';
      const emoji = effectiveType === 'swap' ? swapEmoji : transferEmoji;
      const color = effectiveType === 'swap' ? 0x00ff00 : 0x0099ff;
      const formattedAmount = formatTokenAmount(event.amount, event.decimals || token.tokenDecimals);
      const usdValue = token.usdPrice ? this.calculateUsdValue(event.amount, event.decimals || token.tokenDecimals, token.usdPrice) : null;
      const tokenDecimals = event.decimals || token.tokenDecimals || 9;

      // Get wallet avatars for addresses FIRST (before aggregation/embed building)
      let buyerAvatar = null;
      let senderAvatar = null;
      let recipientAvatar = null;

      try {
        if (effectiveType === 'swap' && event.to) {
          this.logger.info(`[BuybotService] Processing swap for wallet ${formatAddress(event.to)}`);
          const orbNftCount = await this.getWalletNftCountForChannel(event.to, channelId);

          const buyerContext = {
            tokenSymbol: token.tokenSymbol,
            tokenAddress: token.tokenAddress,
            tokenDecimals,
            amount: formattedAmount,
            currentBalance: null,
            usdValue: null,
            orbNftCount,
            discordChannelId: channelId,
            guildId,
            tokenPriceUsd: token.usdPrice || null,
            requireClaimedAvatar,
            requireCollectionOwnership,
          };

          try {
            buyerAvatar = await this.avatarService.createAvatarForWallet(event.to, buyerContext);

            const buyerTokenBalance = buyerAvatar?.tokenBalances?.[token.tokenSymbol];
            const buyerBalance = Number.isFinite(buyerTokenBalance?.balance) ? buyerTokenBalance.balance : null;

            this.logger.info(`[BuybotService] Wallet ${formatAddress(event.to)} balance: ${buyerBalance ?? 0} ${token.tokenSymbol}, NFTs: ${orbNftCount}`);

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
            if (buyerError?.message?.includes('Wallet avatars disabled')) {
              this.logger.info(`[BuybotService] Wallet avatars disabled for guild ${guildId}; skipping buyer avatar.`);
            } else {
              this.logger.error(`[BuybotService] Error creating buyer avatar:`, {
                error: buyerError.message,
                stack: buyerError.stack,
                wallet: formatAddress(event.to)
              });
            }
          }
        } else if (effectiveType === 'transfer') {
          if (event.from) {
            this.logger.info(`[BuybotService] Processing transfer from ${formatAddress(event.from)}`);
            const senderOrbCount = await this.getWalletNftCountForChannel(event.from, channelId);
            
            try {
              senderAvatar = await this.avatarService.createAvatarForWallet(event.from, {
                tokenSymbol: token.tokenSymbol,
                tokenAddress: token.tokenAddress,
                tokenDecimals,
                amount: formattedAmount,
                currentBalance: null,
                usdValue: null,
                orbNftCount: senderOrbCount,
                discordChannelId: channelId,
                guildId,
                tokenPriceUsd: token.usdPrice || null,
                requireClaimedAvatar,
                requireCollectionOwnership,
              });

              const senderTokenBalance = senderAvatar?.tokenBalances?.[token.tokenSymbol];
              const senderBalance = Number.isFinite(senderTokenBalance?.balance) ? senderTokenBalance.balance : null;

              this.logger.info(`[BuybotService] Sender ${formatAddress(event.from)} balance: ${senderBalance ?? 0} ${token.tokenSymbol}, NFTs: ${senderOrbCount}`);

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
              if (senderError?.message?.includes('Wallet avatars disabled')) {
                this.logger.info(`[BuybotService] Wallet avatars disabled for guild ${guildId}; skipping sender avatar.`);
              } else {
                this.logger.error(`[BuybotService] Error creating sender avatar:`, {
                  error: senderError.message,
                  stack: senderError.stack,
                  wallet: formatAddress(event.from)
                });
              }
            }
          }
          if (event.to) {
            this.logger.info(`[BuybotService] Processing transfer to ${formatAddress(event.to)}`);
            const recipientOrbCount = await this.getWalletNftCountForChannel(event.to, channelId);
            
            try {
              recipientAvatar = await this.avatarService.createAvatarForWallet(event.to, {
                tokenSymbol: token.tokenSymbol,
                tokenAddress: token.tokenAddress,
                tokenDecimals,
                amount: formattedAmount,
                currentBalance: null,
                usdValue: null,
                orbNftCount: recipientOrbCount,
                discordChannelId: channelId,
                guildId,
                tokenPriceUsd: token.usdPrice || null,
                requireClaimedAvatar,
                requireCollectionOwnership,
              });

              const recipientTokenBalance = recipientAvatar?.tokenBalances?.[token.tokenSymbol];
              const recipientBalance = Number.isFinite(recipientTokenBalance?.balance) ? recipientTokenBalance.balance : null;

              this.logger.info(`[BuybotService] Recipient ${formatAddress(event.to)} balance: ${recipientBalance ?? 0} ${token.tokenSymbol}, NFTs: ${recipientOrbCount}`);

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
              if (recipientError?.message?.includes('Wallet avatars disabled')) {
                this.logger.info(`[BuybotService] Wallet avatars disabled for guild ${guildId}; skipping recipient avatar.`);
              } else {
                this.logger.error(`[BuybotService] Error creating recipient avatar:`, {
                  error: recipientError.message,
                  stack: recipientError.stack,
                  wallet: formatAddress(event.to)
                });
              }
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

      // NOW handle transfer aggregation with avatar info available
      if (effectiveType === 'transfer') {
        const aggregationOutcome = await this.handleTransferAggregation(
          channelId, 
          event, 
          token, 
          tokenPreferences, 
          usdValue,
          { senderAvatar, recipientAvatar }
        );
        if (aggregationOutcome === 'suppress' || aggregationOutcome === 'handled') {
          return;
        }
      } else {
        // For non-transfer events (swaps), check threshold
        const thresholdRaw = tokenPreferences?.notifications?.transferAggregationUsdThreshold;
        const threshold = Number(thresholdRaw);
        if (Number.isFinite(threshold) && threshold > 0) {
          if (!Number.isFinite(usdValue) || usdValue < threshold) {
            this.logger?.info?.('[BuybotService] Suppressing low-value swap below threshold', {
              eventType: effectiveType,
              channelId,
              token: token?.tokenSymbol || token?.symbol,
              usdValue,
              threshold
            });
            return;
          }
        }
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
  const primaryButton = tokenPreferences?.buttons?.primary || {};
      const primaryUrl = this.resolveUrlTemplate(primaryButton.urlTemplate, token) || `https://jup.ag/swap/SOL-${token.tokenAddress}`;
      const primaryLabel = primaryButton.label || 'Swap on Jupiter';

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
            }
          ],
        },
      ];

      if (primaryUrl) {
        components[0].components.push({
          type: 2,
          style: 5,
          label: primaryLabel,
          url: primaryUrl,
        });
      }

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
        const isMissingPermissions =
          sendError?.code === 50013 ||
          sendError?.status === 403 ||
          (typeof sendError?.message === 'string' && /missing permissions/i.test(sendError.message));

        if (isMissingPermissions) {
          this.logger.warn(`[BuybotService] Missing permissions to post trade embed in channel ${channelId}; skipping notification and triggering avatar responses only.`, {
            channelId,
            tokenSymbol: token.tokenSymbol,
            eventType: event.type
          });
          // Continue without rethrowing so avatars can still respond
        } else {
          this.logger.error(`[BuybotService] Failed to send Discord message to channel ${channelId}:`, {
            error: sendError.message,
            code: sendError.code,
            channelId,
            tokenSymbol: token.tokenSymbol,
            eventType: event.type
          });
          throw sendError; // Re-throw to trigger outer catch block
        }
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
      }, {
        requireClaimedOnly: requireClaimedAvatar
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
  async triggerAvatarTradeResponses(channelId, event, token, avatars, options = {}) {
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
      const requireClaimedOnly = Boolean(options.requireClaimedOnly);

      // Track all avatars involved for relationship context, even if some are still partial
      const relationshipParticipants = [];

      const fullAvatars = [];

      if (buyerAvatar && buyerAvatar._id) {
        relationshipParticipants.push({ avatar: buyerAvatar, role: 'buyer' });
        const isClaimedBuyer = buyerAvatar.claimed === true || Boolean(buyerAvatar.claimedBy);
        if (buyerAvatar.imageUrl && (!requireClaimedOnly || isClaimedBuyer)) {
          fullAvatars.push({ avatar: buyerAvatar, role: 'buyer' });
        }
      }
      if (senderAvatar && senderAvatar._id) {
        relationshipParticipants.push({ avatar: senderAvatar, role: 'sender' });
        const isClaimedSender = senderAvatar.claimed === true || Boolean(senderAvatar.claimedBy);
        if (senderAvatar.imageUrl && (!requireClaimedOnly || isClaimedSender)) {
          fullAvatars.push({ avatar: senderAvatar, role: 'sender' });
        }
      }
      if (recipientAvatar && recipientAvatar._id) {
        relationshipParticipants.push({ avatar: recipientAvatar, role: 'recipient' });
        const isClaimedRecipient = recipientAvatar.claimed === true || Boolean(recipientAvatar.claimedBy);
        if (recipientAvatar.imageUrl && (!requireClaimedOnly || isClaimedRecipient)) {
          fullAvatars.push({ avatar: recipientAvatar, role: 'recipient' });
        }
      }
      
      // Record relationships between avatars involved in this trade
      if (relationshipParticipants.length >= 2 && this.avatarRelationshipService) {
        await this.recordTradeRelationships(relationshipParticipants, event, token);
      }

      if (fullAvatars.length === 0) {
        this.logger.debug(`[BuybotService] No full avatars (with images) in trade, skipping responses`);
        return;
      }

      const now = Date.now();
      const eligibleAvatars = [];
      const suppressedAvatars = [];

      for (const entry of fullAvatars) {
        const status = this._assessAvatarResponseEligibility(entry?.avatar, now);
        if (status.eligible) {
          eligibleAvatars.push(entry);
        } else {
          suppressedAvatars.push({ ...entry, reason: status.reason });
        }
      }

      if (eligibleAvatars.length === 0) {
        this.logger.info(`[BuybotService] All ${fullAvatars.length} avatar(s) were ineligible to respond (knocked out or inactive)`, {
          suppressedReasons: suppressedAvatars.map(({ avatar, role, reason }) => ({
            avatarId: avatar?._id?.toString?.(),
            name: avatar?.name,
            role,
            reason,
          })),
        });
        return;
      }

      if (suppressedAvatars.length > 0) {
        this.logger.info(`[BuybotService] Skipping ${suppressedAvatars.length} avatar(s) that cannot currently speak`, {
          suppressedReasons: suppressedAvatars.map(({ avatar, role, reason }) => ({
            avatarId: avatar?._id?.toString?.(),
            name: avatar?.name,
            role,
            reason,
          })),
        });
      }
      
      this.logger.info(`[BuybotService] Triggering responses for ${eligibleAvatars.length} eligible avatar(s) in trade`);
      
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
      
      const fallbackChannel = channel;
      const channelCache = new Map();
      if (fallbackChannel?.id) {
        channelCache.set(fallbackChannel.id, fallbackChannel);
      }

      const fetchChannelById = async (targetChannelId) => {
        if (!targetChannelId) {
          return null;
        }
        if (channelCache.has(targetChannelId)) {
          return channelCache.get(targetChannelId);
        }

        try {
          const fetchedChannel = await this.discordService.client.channels.fetch(targetChannelId);
          if (fetchedChannel && typeof fetchedChannel.isTextBased === 'function' && fetchedChannel.isTextBased()) {
            channelCache.set(targetChannelId, fetchedChannel);
            return fetchedChannel;
          }

          this.logger.warn(`[BuybotService] Activation channel ${targetChannelId} is not text-based or unavailable`);
        } catch (fetchError) {
          this.logger.warn(`[BuybotService] Failed to fetch activation channel ${targetChannelId}: ${fetchError.message}`);
        }

        return null;
      };

      const resolveChannelForAvatar = async (avatar) => {
        const desiredChannelId = avatar?.activationChannelId;

        if (desiredChannelId && desiredChannelId !== fallbackChannel?.id) {
          const desiredChannel = await fetchChannelById(desiredChannelId);
          if (desiredChannel) {
            return desiredChannel;
          }

          this.logger.debug(`[BuybotService] Falling back to trade channel for avatar ${avatar?.name || avatar?._id}`, {
            activationChannelId: desiredChannelId,
          });
        }

        return fallbackChannel;
      };

      // Trigger each full avatar to respond with context about the trade
      // BATCHING: Instead of immediately scheduling responses, accumulate avatars in a batch window
      // and flush once to prevent reply storms from rapid swap notifications
      for (let i = 0; i < eligibleAvatars.length; i++) {
        const { avatar, role } = eligibleAvatars[i];
        try {
          const targetChannel = await resolveChannelForAvatar(avatar);
          if (!targetChannel || (typeof targetChannel.isTextBased === 'function' && !targetChannel.isTextBased())) {
            this.logger.warn(`[BuybotService] Cannot resolve channel for avatar response`, {
              avatarId: avatar?._id?.toString?.(),
              activationChannelId: avatar?.activationChannelId,
            });
            continue;
          }

          // Build trade context prompt for the avatar (async now includes relationship data)
          const tradeContext = await this.buildTradeContextForAvatar(event, token, role, avatar, relationshipParticipants, {
            buyerAvatar,
            senderAvatar,
            recipientAvatar
          });
          
          this.logger.info(`[BuybotService] Adding avatar ${avatar.name} (${role}) to batch for channel ${targetChannel.id}`);
          
          // Add avatar to batch instead of immediately scheduling
          this.addAvatarToBatch(targetChannel.id, avatar, role, event, token, tradeContext, targetChannel);
          
        } catch (error) {
          this.logger.error(`[BuybotService] Error adding avatar to batch:`, {
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
   * Add an avatar to the response batch for a channel
   * Batching ensures that if multiple swaps happen in quick succession,
   * each avatar only responds once with combined context
   * @param {string} channelId - Channel ID
   * @param {Object} avatar - Avatar object
   * @param {string} role - Avatar role (buyer/sender/recipient)
   * @param {Object} event - Trade event
   * @param {Object} token - Token info
   * @param {string} tradeContext - Formatted trade context for AI
   * @param {Object} channel - Discord channel object
   */
  addAvatarToBatch(channelId, avatar, role, event, token, tradeContext, channel) {
    const avatarId = String(avatar._id || avatar.id);
    
    // Get or create batch for this channel
    let batch = this.avatarResponseBatches.get(channelId);
    if (!batch) {
      batch = {
        avatars: new Map(),
        flushTimer: null,
        channel: channel
      };
      this.avatarResponseBatches.set(channelId, batch);
    }
    
    // Get or create entry for this avatar in the batch
    let avatarEntry = batch.avatars.get(avatarId);
    if (!avatarEntry) {
      avatarEntry = {
        avatar: avatar,
        roles: new Set(),
        events: [],
        tradeContexts: [],
        firstAddedAt: Date.now()
      };
      batch.avatars.set(avatarId, avatarEntry);
    }
    
    // Accumulate data for this avatar
    avatarEntry.roles.add(role);
    avatarEntry.events.push({ event, token, timestamp: Date.now() });
    avatarEntry.tradeContexts.push(tradeContext);
    
    // Clear existing timer and set new one
    if (batch.flushTimer) {
      clearTimeout(batch.flushTimer);
    }
    
    // Schedule flush after batch window
    batch.flushTimer = setTimeout(() => {
      this.flushAvatarBatch(channelId);
    }, this.AVATAR_RESPONSE_BATCH_WINDOW_MS);
    
    this.logger.debug(`[BuybotService] Avatar ${avatar.name} added to batch (${batch.avatars.size} avatars batched, flush in ${this.AVATAR_RESPONSE_BATCH_WINDOW_MS}ms)`);
  }

  /**
   * Flush a batch and trigger responses for all accumulated avatars
   * Each avatar will respond once with combined context from all their trades in the batch window
   * @param {string} channelId - Channel ID
   */
  async flushAvatarBatch(channelId) {
    const batch = this.avatarResponseBatches.get(channelId);
    if (!batch || batch.avatars.size === 0) {
      return;
    }
    
    this.logger.info(`[BuybotService] Flushing avatar batch for channel ${channelId} (${batch.avatars.size} avatars)`);
    
    // Clear timer
    if (batch.flushTimer) {
      clearTimeout(batch.flushTimer);
      batch.flushTimer = null;
    }
    
    // Remove batch from map
    this.avatarResponseBatches.delete(channelId);
    
    // Get conversation manager (use lazy resolution to avoid circular dependency issues)
    let conversationManager;
    try {
      // Try services container first (preferred)
      if (this.services?.cradle?.conversationManager) {
        conversationManager = this.services.cradle.conversationManager;
      } else if (this.services?.resolve) {
        conversationManager = this.services.resolve('conversationManager');
      } else if (this.configService?.services?.conversationManager) {
        conversationManager = this.configService.services.conversationManager;
      }
    } catch (e) {
      this.logger.debug(`[BuybotService] Failed to resolve conversationManager: ${e.message}`);
    }
    
    if (!conversationManager) {
      this.logger.error(`[BuybotService] ConversationManager not available for avatar responses`);
      return;
    }
    
    // Process each avatar in the batch
    const avatarEntries = Array.from(batch.avatars.values());
    for (let i = 0; i < avatarEntries.length; i++) {
      const avatarEntry = avatarEntries[i];
      const { avatar, roles, events, tradeContexts } = avatarEntry;
      
      try {
        // Combine trade contexts if multiple trades in batch
        let combinedContext;
        if (tradeContexts.length === 1) {
          combinedContext = tradeContexts[0];
        } else {
          // Multiple trades - create summary context
          const rolesList = Array.from(roles).join(', ');
          const eventCount = events.length;
          combinedContext = `[Trade Context: You were involved in ${eventCount} recent trade(s) as ${rolesList}.\n\n${tradeContexts.join('\n\n')}]`;
        }
        
        this.logger.info(`[BuybotService] Triggering batched response for avatar ${avatar.name} (${events.length} event(s), roles: ${Array.from(roles).join(', ')})`);
        
        // Send response with combined trade context
        // Small stagger to avoid overwhelming the channel (but much less than before)
        setTimeout(async () => {
          try {
            await conversationManager.sendResponse(batch.channel, avatar, null, {
              overrideCooldown: false, // Let normal cooldown logic apply to batched responses
              cascadeDepth: 0,
              tradeContext: combinedContext
            });
            
            this.logger.info(`[BuybotService] Successfully sent batched response for avatar ${avatar.name}`);
          } catch (respError) {
            this.logger.error(`[BuybotService] Failed to generate batched response for ${avatar.name}:`, {
              error: respError.message,
              stack: respError.stack
            });
          }
        }, 500 * i); // Small stagger: 500ms per avatar (down from 3000ms)
        
      } catch (error) {
        this.logger.error(`[BuybotService] Error processing batched avatar ${avatar.name}:`, {
          error: error.message,
          stack: error.stack
        });
      }
    }
  }

      _assessAvatarResponseEligibility(avatar, now = Date.now()) {
        if (!avatar) {
          return { eligible: false, reason: 'avatar unavailable' };
        }

        if (avatar.status === 'dead') {
          return { eligible: false, reason: 'status=dead' };
        }

        if (avatar.status === 'knocked_out') {
          return { eligible: false, reason: 'status=knocked_out' };
        }

        if (typeof avatar.lives === 'number' && avatar.lives <= 0) {
          return { eligible: false, reason: 'no lives remaining' };
        }

        if (avatar.knockedOutUntil) {
          let untilTs = null;
          if (avatar.knockedOutUntil instanceof Date) {
            untilTs = avatar.knockedOutUntil.getTime();
          } else {
            const parsed = new Date(avatar.knockedOutUntil);
            untilTs = Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
          }
          if (untilTs && untilTs > now) {
            return { eligible: false, reason: `knocked out until ${new Date(untilTs).toISOString()}` };
          }
        }

        return { eligible: true, reason: null };
      }

  /**
   * Record trade relationships between avatars
  * @param {Array} avatarsInTrade - Array of {avatar, role} objects
   * @param {Object} event - Trade event
   * @param {Object} token - Token info
   */
  async recordTradeRelationships(avatarsInTrade, event, token) {
    try {
      if (!this.avatarRelationshipService) {
        return;
      }

      const participants = Array.isArray(avatarsInTrade)
        ? avatarsInTrade.filter(entry => entry?.avatar?._id)
        : [];
      
      if (participants.length < 2) {
        return;
      }

      // Calculate trade amount and USD value
      const decimals = event.decimals || token.tokenDecimals || 9;
      const tokenAmount = parseFloat(event.amount) / Math.pow(10, decimals);
      const usdValue = token.usdPrice ? tokenAmount * token.usdPrice : 0;

      // For transfers, record relationship between sender and recipient
      if (event.type === 'transfer') {
        const sender = participants.find(a => a.role === 'sender');
        const recipient = participants.find(a => a.role === 'recipient');

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
      if (event.type === 'swap' && participants.length >= 2) {
        const buyer = participants.find(a => a.role === 'buyer');
        
        if (buyer) {
          // Record relationship with all other participants
          for (const other of participants) {
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
  * @param {Array} avatarsInTrade - All avatars in this trade (full or partial)
   * @param {Object} allParticipants - All participants (buyerAvatar, senderAvatar, recipientAvatar)
   * @returns {Promise<string>} Context prompt
   */
  async buildTradeContextForAvatar(event, token, role, avatar, avatarsInTrade, allParticipants = {}) {
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
  const otherAvatars = avatarsInTrade.filter(a => a.avatar._id.toString() !== avatar._id.toString());
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
    const tokenPreferences = token?.tokenPreferences || this.getTokenPreferences(token);
    const swapEmoji = tokenPreferences?.displayEmoji || '💰';
    const transferEmoji = tokenPreferences?.transferEmoji || '📤';
    const requireClaimedAvatar = Boolean(tokenPreferences?.walletAvatar?.requireClaimedAvatar);
    const requireCollectionOwnership = Boolean(tokenPreferences?.walletAvatar?.requireCollectionOwnership);

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
          // Get wallet's NFT count for all tracked collections in this channel
          const orbNftCount = await this.getWalletNftCountForChannel(event.to, channelId);

          buyerAvatar = await this.avatarService.createAvatarForWallet(event.to, {
            tokenSymbol: token.tokenSymbol,
            tokenAddress: token.tokenAddress,
            tokenDecimals,
            amount: formattedAmount,
            currentBalance: null,
            usdValue: null,
            orbNftCount,
            telegramChannelId: channelId, // Pass telegram channel for introductions
            tokenPriceUsd: token.usdPrice || null,
            requireClaimedAvatar,
            requireCollectionOwnership,
          });
        } else if (event.type === 'transfer') {
          if (event.from) {
            const senderOrbCount = await this.getWalletNftCountForChannel(event.from, channelId);
            
            senderAvatar = await this.avatarService.createAvatarForWallet(event.from, {
              tokenSymbol: token.tokenSymbol,
              tokenAddress: token.tokenAddress,
              tokenDecimals,
              amount: formattedAmount,
              currentBalance: null,
              usdValue: null,
              orbNftCount: senderOrbCount,
              telegramChannelId: channelId,
              tokenPriceUsd: token.usdPrice || null,
              requireClaimedAvatar,
              requireCollectionOwnership,
            });
          }
          if (event.to) {
            const recipientOrbCount = await this.getWalletNftCountForChannel(event.to, channelId);
            
            recipientAvatar = await this.avatarService.createAvatarForWallet(event.to, {
              tokenSymbol: token.tokenSymbol,
              tokenAddress: token.tokenAddress,
              tokenDecimals,
              amount: formattedAmount,
              currentBalance: null,
              usdValue: null,
              orbNftCount: recipientOrbCount,
              telegramChannelId: channelId,
              tokenPriceUsd: token.usdPrice || null,
              requireClaimedAvatar,
              requireCollectionOwnership,
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
        const emoji = swapEmoji;
        const multiplier = usdValue ? this.getBuyMultiplier(usdValue) : '';
        message += `<b>${token.tokenSymbol} Buy</b>\n${emoji}${multiplier ? ' × ' + multiplier : ''}\n\n`;
        
        // Add description with avatar name
        if (buyerAvatar && buyerAvatar.name && buyerEmoji) {
          message += `${buyerEmoji} <b>${buyerAvatar.name}</b> (<code>${formatAddress(event.to)}</code>) purchased ${formattedAmount} ${token.tokenSymbol}\n\n`;
        } else {
          message += `Purchased ${formattedAmount} ${token.tokenSymbol}\n\n`;
        }
      } else {
        // Transfer
  message += `${transferEmoji} <b>${token.tokenSymbol} Transfer</b>\n\n`;
        
        // Add description with avatar names
        const senderDisplay = senderAvatar && senderAvatar.name && senderEmoji
          ? `${senderEmoji} <b>${senderAvatar.name}</b> (<code>${formatAddress(event.from)}</code>)`
          : `<code>${formatAddress(event.from)}</code>`;
        
        const recipientDisplay = recipientAvatar && recipientAvatar.name && recipientEmoji
          ? `${recipientEmoji} <b>${recipientAvatar.name}</b> (<code>${formatAddress(event.to)}</code>)`
          : `<code>${formatAddress(event.to)}</code>`;
        
        message += `${senderDisplay} transferred ${formattedAmount} ${token.tokenSymbol} to ${recipientDisplay}\n\n`;
      }

      // Amount and USD value (for both swaps and transfers)
      if (usdValue) {
        message += `💵 <b>$${usdValue.toFixed(2)}</b>\n\n`;
      }

      // Addresses - show wallet avatars with names/emojis
      if (event.type === 'swap') {
        if (buyerAvatar && buyerAvatar.name && buyerEmoji) {
          message += `${buyerEmoji} Buyer: <b>${buyerAvatar.name}</b>\n`;
          
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
          message += `    <code>${formatAddress(event.to)}</code>\n`;
        } else {
          message += `👤 Buyer: <code>${formatAddress(event.to)}</code>\n`;
        }
      } else {
        // Transfer - show both parties with avatars
        if (senderAvatar && senderAvatar.name && senderEmoji) {
          message += `${senderEmoji} From: <b>${senderAvatar.name}</b>\n`;
          
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
          message += `    <code>${formatAddress(event.from)}</code>\n`;
        } else {
          message += `📤 From: <code>${formatAddress(event.from)}</code>\n`;
        }
        
        if (recipientAvatar && recipientAvatar.name && recipientEmoji) {
          message += `${recipientEmoji} To: <b>${recipientAvatar.name}</b>\n`;
          
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
          message += `    <code>${formatAddress(event.to)}</code>\n`;
        } else {
          message += `📥 To: <code>${formatAddress(event.to)}</code>\n`;
        }
      }


      // Balance changes (new holder, increase, decrease)
      if (event.isNewHolder) {
        message += `🆕 <b>New Holder!</b>\n`;
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
      message += `<a href="${event.txUrl}">Tx</a>`;
      
      // DexScreener link
      const dexScreenerUrl = `https://dexscreener.com/solana/${token.tokenAddress}`;
      message += ` • <a href="${dexScreenerUrl}">DexScreener</a>`;

  const telegramLink = tokenPreferences?.telegram || {};
      const telegramLinkUrl = this.resolveUrlTemplate(telegramLink.linkUrlTemplate, token) || `https://jup.ag/swap/SOL-${token.tokenAddress}`;
      const telegramLinkLabel = telegramLink.linkLabel || 'Swap';
      if (telegramLinkUrl) {
        message += ` • <a href="${telegramLinkUrl}">${telegramLinkLabel}</a>`;
      }

      await telegramService.globalBot.telegram.sendMessage(
        channelId,
        message,
        {
          parse_mode: 'HTML',
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
    return resolveBuyMultiplier(usdValue);
  }

  /**
   * Normalize emoji strings coming from avatar metadata.
   * Converts shortcode formats like :fire: and extracts actual pictographs from mixed strings.
   * @param {string} rawEmoji - Raw emoji value from avatar document
   * @param {string} [fallback='✨'] - Emoji to use when normalization fails
   * @returns {string} Display-safe emoji
   */
  getDisplayEmoji(rawEmoji, fallback = '✨') {
    return normalizeDisplayEmoji(rawEmoji, fallback);
  }

  /**
   * Calculate USD value of a token amount
   * @param {number} amount - Raw token amount (smallest units)
   * @param {number} decimals - Token decimals
   * @param {number} usdPrice - Price per token in USD
   * @returns {number} USD value
   */
  calculateUsdValue(amount, decimals, usdPrice) {
    return computeUsdValue(amount, decimals, usdPrice);
  }

  getTokenPreferences(token) {
    try {
      if (!this.configService?.getTokenPreferences) {
        return cloneDefaultTokenPreferences();
      }

      const lookupSymbol = token?.tokenSymbol || token?.symbol;
      const lookupAddress = token?.tokenAddress || token?.mint;

      this.logger.debug?.(`[BuybotService] getTokenPreferences lookup:`, {
        lookupSymbol,
        lookupAddress,
        tokenObject: {
          tokenSymbol: token?.tokenSymbol,
          symbol: token?.symbol,
          tokenAddress: token?.tokenAddress,
          mint: token?.mint
        }
      });

      const preferences = this.configService.getTokenPreferences({
        symbol: lookupSymbol,
        address: lookupAddress
      });

      this.logger.debug?.(`[BuybotService] getTokenPreferences result:`, {
        symbol: lookupSymbol,
        hasPreferences: !!preferences,
        hasNotifications: !!preferences?.notifications,
        transferThreshold: preferences?.notifications?.transferAggregationUsdThreshold,
        fullPreferences: preferences
      });

      if (!preferences || typeof preferences !== 'object') {
        return cloneDefaultTokenPreferences();
      }

      return preferences;
    } catch (error) {
      this.logger?.warn?.(`[BuybotService] getTokenPreferences failed: ${error.message}`);
      return cloneDefaultTokenPreferences();
    }
  }

  resolveUrlTemplate(template, token) {
    if (!template) {
      return null;
    }

    const address = token?.tokenAddress || token?.mint || '';
    const symbol = token?.tokenSymbol || token?.symbol || '';

    return template
      .replace(/\{address\}/gi, address)
      .replace(/\{mint\}/gi, address)
      .replace(/\{symbol\}/gi, symbol);
  }

  /**
   * Fetch all SPL token balances for a wallet from the Lambda balances endpoint
   * @param {string} walletAddress - Wallet address to query
   * @returns {Promise<Array>} Array of balance entries
   */
  async fetchWalletBalances(walletAddress) {
    return this.walletInsights.fetchWalletBalances(walletAddress);
  }

  /**
   * Convert a Lambda balance entry into UI amount using token decimals
   * @param {Object} entry - Balance entry from Lambda
   * @param {number} decimals - Token decimals
   * @returns {number} UI amount (full tokens)
   */
  calculateUiAmountFromEntry(entry, decimals = 9) {
    return this.walletInsights.calculateUiAmountFromEntry(entry, decimals);
  }

  /**
   * Get wallet's token balance using cached Lambda balances
   * @param {string} walletAddress - Wallet address
   * @param {string} tokenAddress - Token mint address
   * @param {number} [tokenDecimals=9] - Token decimals
   * @returns {Promise<number>} Token balance (UI units)
   */
  async getWalletTokenBalance(walletAddress, tokenAddress, tokenDecimals = 9) {
    return this.walletInsights.getWalletTokenBalance(walletAddress, tokenAddress, tokenDecimals);
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
    return this.walletInsights.getWalletTopTokens(walletAddress, options);
  }

  /**
   * Build additional token balance map suitable for avatar persistence
   * @param {Array} topTokens - Array of token holding summaries
   * @param {string} [primarySymbol] - Symbol of the primary token to exclude
   * @returns {Object|null} Map of token symbol -> balance metadata
   */
  buildAdditionalTokenBalances(topTokens = [], primarySymbol = null) {
    return this.walletInsights.buildAdditionalTokenBalances(topTokens, primarySymbol);
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
    if (this.avatarService?.buildWalletAvatarContext) {
      try {
        return await this.avatarService.buildWalletAvatarContext(walletAddress, token, tokenDecimals, options);
      } catch (error) {
        this.logger.warn(`[BuybotService] AvatarService wallet context failed for ${formatAddress(walletAddress)}: ${error.message}`);
      }
    }
    return this.walletInsights.buildWalletAvatarContext(walletAddress, token, tokenDecimals, options);
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
        ? `🚀 <b>HUGE ${tokenSymbol} BUY ALERT!</b>\n\n💵 <b>$${usdValue.toFixed(0)} purchase detected!</b>\n\nGenerating celebration video...`
        : `💰 <b>BIG ${tokenSymbol} BUY!</b>\n\n💵 <b>$${usdValue.toFixed(0)} purchase!</b>\n\nGenerating celebration image...`;

      // Send initial message
      await telegramService.globalBot.telegram.sendMessage(
        channelId,
        message,
        { parse_mode: 'HTML' }
      );

      // Generate media using the appropriate service
      if (mediaType === 'video' && telegramService.veoService) {
        this.logger.info(`[BuybotService] Generating video for $${usdValue.toFixed(0)} purchase`);
        
        const videoUrls = await telegramService.veoService.generateVideos({ 
          prompt, 
          config: { numberOfVideos: 1, personGeneration: "allow_adult", durationSeconds: '8' } 
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
        { parse_mode: 'HTML' }
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
  async getWalletNftCount(walletAddress, collectionAddress) {
    if (!walletAddress || !collectionAddress) {
      return 0;
    }

    if (!this.walletInsights || typeof this.walletInsights.getWalletAssets !== 'function') {
      this.logger.debug('[BuybotService] Wallet insights unavailable for NFT counting');
      return 0;
    }

    try {
      const assets = await this.walletInsights.getWalletAssets(walletAddress);
      if (!Array.isArray(assets) || assets.length === 0) {
        return 0;
      }

      const normalizedCollection = collectionAddress.toLowerCase();

      const matchesCollection = (asset = {}) => {
        const rawValues = [
          asset.collectionAddress,
          asset.collectionMint,
          asset.collectionId,
          asset.collection,
          asset.groupingValue,
          asset.groupValue,
          asset.group,
          asset.grouping?.value,
          asset.grouping?.groupValue,
          asset.collectionInfo?.address,
          asset.collectionInfo?.collectionAddress,
          asset.collectionInfo?.id,
          asset.collectionInfo?.mint,
          asset.collection?.address,
          asset.collection?.id,
          asset.collection?.mint,
        ].filter(value => typeof value === 'string' && this.isValidSolanaAddress(value));

        const normalizedValues = rawValues.map(value => value.toLowerCase());
        if (normalizedValues.includes(normalizedCollection)) {
          return true;
        }

        const groupingArray = Array.isArray(asset.grouping)
          ? asset.grouping
          : Array.isArray(asset.groupings)
            ? asset.groupings
            : null;

        if (groupingArray) {
          for (const group of groupingArray) {
            const groupKey = group?.group_key || group?.groupKey || group?.key;
            const groupingValue = group?.group_value || group?.groupValue || group?.value;
            if (groupKey && groupKey !== 'collection') {
              continue;
            }
            if (typeof groupingValue === 'string' && this.isValidSolanaAddress(groupingValue) && groupingValue.toLowerCase() === normalizedCollection) {
              return true;
            }
          }
        }

        const collectionArray = Array.isArray(asset.collections) ? asset.collections : null;
        if (collectionArray) {
          for (const collection of collectionArray) {
            const values = [
              collection?.address,
              collection?.id,
              collection?.mint,
            ]
              .filter(value => typeof value === 'string' && this.isValidSolanaAddress(value))
              .map(value => value.toLowerCase());
            if (values.includes(normalizedCollection)) {
              return true;
            }
          }
        }

        return false;
      };

      const count = assets.reduce((total, asset) => {
        return matchesCollection(asset) ? total + 1 : total;
      }, 0);

      return count;
    } catch (error) {
      this.logger.warn(`[BuybotService] Failed to calculate NFT count for ${formatAddress(walletAddress)}: ${error.message}`);
      return 0;
    }
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
