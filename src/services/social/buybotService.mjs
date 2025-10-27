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

export class BuybotService {
  constructor({ logger, databaseService, configService, discordService, getTelegramService }) {
    this.logger = logger || console;
    this.databaseService = databaseService;
    this.configService = configService;
    this.discordService = discordService;
    this.getTelegramService = getTelegramService || (() => null); // Late-bound to avoid circular dependency
    
    this.helius = null;
    this.activeWebhooks = new Map(); // channelId -> webhook data
    this.db = null;
    
    // Collection names
    this.TRACKED_TOKENS_COLLECTION = 'buybot_tracked_tokens';
    this.TOKEN_EVENTS_COLLECTION = 'buybot_token_events';
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
      this.db = await this.databaseService.getDatabase();
      
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
          
          // For pump.fun or new tokens, return minimal info
          // The token might exist but not be indexed yet
          return {
            address: tokenAddress,
            name: 'Unknown Token',
            symbol: 'UNKNOWN',
            decimals: 9, // Default for SPL tokens
            supply: null,
            image: null,
            warning: 'Token not yet indexed - may be newly created or invalid',
          };
        }
        throw apiError;
      }

      if (!asset) {
        this.logger.warn(`[BuybotService] No asset data returned for ${tokenAddress}`);
        return null;
      }

      // Calculate market cap if we have supply and price
      let marketCap = null;
      const supply = asset.token_info?.supply;
      const decimals = asset.token_info?.decimals || 9;
      const pricePerToken = asset.token_info?.price_info?.price_per_token;
      
      if (supply && pricePerToken && decimals) {
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

    // Poll every 30 seconds
    const pollInterval = setInterval(async () => {
      try {
        await this.checkTokenTransactions(channelId, tokenAddress, platform);
      } catch (error) {
        this.logger.error(`[BuybotService] Polling error for ${tokenAddress}:`, error);
      }
    }, 30000);

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
          // Store event
          await this.db.collection(this.TOKEN_EVENTS_COLLECTION).insertOne({
            ...event,
            channelId,
            tokenAddress,
            signature: tx.signature,
            timestamp: new Date(tx.timestamp * 1000),
            createdAt: new Date(),
          });

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

      // From/To addresses
      embed.fields.push({
        name: '📤 From',
        value: `\`${this.formatAddress(event.from)}\``,
        inline: true,
      });

      embed.fields.push({
        name: '📥 To',
        value: `\`${this.formatAddress(event.to)}\``,
        inline: true,
      });

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
    } catch (error) {
      this.logger.error('[BuybotService] Failed to send Discord notification:', error);
    }
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

      // Addresses - show both from and to for transfers
      if (event.type === 'swap') {
        message += `👤 Buyer: \`${this.formatAddress(event.to)}\`\n`;
      } else {
        // Transfer - show both parties
        message += `📤 From: \`${this.formatAddress(event.from)}\`\n`;
        message += `📥 To: \`${this.formatAddress(event.to)}\`\n`;
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
        
        const videoResult = await telegramService.veoService.generateVideo(prompt);
        
        if (videoResult?.videoUrl) {
          await telegramService.globalBot.telegram.sendVideo(
            channelId,
            videoResult.videoUrl,
            {
              caption: `🎬 Epic ${tokenSymbol} buy celebration! Worth $${usdValue.toFixed(0)}! 🚀`
            }
          );
          this.logger.info(`[BuybotService] Video sent successfully for ${tokenSymbol} purchase`);
        }
      } else if (mediaType === 'image' && telegramService.googleAIService) {
        this.logger.info(`[BuybotService] Generating image for $${usdValue.toFixed(0)} purchase`);
        
        const imageResult = await telegramService.googleAIService.generateImage(prompt);
        
        if (imageResult?.imageUrl) {
          await telegramService.globalBot.telegram.sendPhoto(
            channelId,
            imageResult.imageUrl,
            {
              caption: `🖼️ ${tokenSymbol} big buy celebration! Worth $${usdValue.toFixed(0)}! 💰`
            }
          );
          this.logger.info(`[BuybotService] Image sent successfully for ${tokenSymbol} purchase`);
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
