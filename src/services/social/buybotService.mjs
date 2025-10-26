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

      return {
        address: tokenAddress,
        name: asset.content?.metadata?.name || 'Unknown Token',
        symbol: asset.content?.metadata?.symbol || 'UNKNOWN',
        decimals: asset.token_info?.decimals || 9,
        supply: asset.token_info?.supply,
        image: asset.content?.links?.image,
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

      const embed = {
        title: `${emoji} ${token.tokenSymbol} ${event.type === 'swap' ? 'Purchase' : 'Transfer'}`,
        description: event.description,
        color: color,
        fields: [
          {
            name: 'Amount',
            value: `${this.formatTokenAmount(event.amount, event.decimals || token.tokenDecimals)} ${token.tokenSymbol}`,
            inline: true,
          },
          {
            name: 'From',
            value: this.formatAddress(event.from),
            inline: true,
          },
          {
            name: 'To',
            value: this.formatAddress(event.to),
            inline: true,
          },
        ],
        timestamp: event.timestamp.toISOString(),
        footer: {
          text: 'Solana • Powered by Helius',
        },
      };

      // Add transaction link as button
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

      const emoji = event.type === 'swap' ? '💰' : '📤';
      const title = event.type === 'swap' ? 'Purchase' : 'Transfer';

      const message =
        `${emoji} *${token.tokenSymbol} ${title}*\n\n` +
        `${event.description}\n\n` +
  `*Amount:* ${this.formatTokenAmount(event.amount, event.decimals || token.tokenDecimals)} ${token.tokenSymbol}\n` +
        `*From:* \`${this.formatAddress(event.from)}\`\n` +
        `*To:* \`${this.formatAddress(event.to)}\`\n\n` +
        `[View Transaction](${event.txUrl})\n\n` +
        `⚡ Solana • Powered by Helius`;

      await telegramService.globalBot.telegram.sendMessage(
        channelId,
        message,
        {
          parse_mode: 'Markdown',
          disable_web_page_preview: false,
        }
      );

      this.logger.info(`[BuybotService] Sent Telegram notification for ${token.tokenSymbol} ${event.type} to channel ${channelId}`);
    } catch (error) {
      this.logger.error('[BuybotService] Failed to send Telegram notification:', error);
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
