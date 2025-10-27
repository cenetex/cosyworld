/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Wallet Avatar Service
 * Creates and manages 1:1 avatars for Solana wallet addresses
 * Similar to how Discord users get unique avatars, but for blockchain wallets
 * Integrates with AvatarService for full avatar creation with images
 */

export class WalletAvatarService {
  constructor({ databaseService, aiService, logger, avatarService, discordService, getTelegramService }) {
    this.databaseService = databaseService;
    this.aiService = aiService;
    this.logger = logger || console;
    this.avatarService = avatarService;
    this.discordService = discordService;
    this.getTelegramService = getTelegramService || (() => null);
    
    this.WALLET_AVATARS_COLLECTION = 'wallet_avatars';
    this.db = null;
    
    // Threshold for creating wallet avatars (1M RATi)
    this.AVATAR_CREATION_THRESHOLD = 1_000_000;
  }

  /**
   * Initialize service and ensure indexes
   */
  async initialize() {
    try {
      this.db = await this.databaseService.getDatabase();
      
      // Create indexes for efficient lookups
      await this.db.collection(this.WALLET_AVATARS_COLLECTION).createIndex(
        { walletAddress: 1 },
        { unique: true }
      );
      
      await this.db.collection(this.WALLET_AVATARS_COLLECTION).createIndex(
        { lastActivityAt: -1 }
      );
      
      this.logger.info('[WalletAvatarService] Initialized successfully');
    } catch (error) {
      this.logger.error('[WalletAvatarService] Initialization failed:', error);
    }
  }

  /**
   * Get or create an avatar for a wallet address
   * @param {string} walletAddress - Solana wallet address
   * @param {Object} context - Optional context (token, amount, balance, etc)
   * @returns {Promise<Object|null>} Wallet avatar object or null if below threshold
   */
  async getOrCreateWalletAvatar(walletAddress, context = {}) {
    try {
      if (!this.db) {
        this.db = await this.databaseService.getDatabase();
      }

      // Check if avatar already exists
      let walletAvatar = await this.db.collection(this.WALLET_AVATARS_COLLECTION)
        .findOne({ walletAddress });

      if (walletAvatar) {
        // Update last activity and balance info
        const updateData = {
          lastActivityAt: new Date(),
          $inc: { activityCount: 1 }
        };
        
        // Update balance if provided
        if (context.currentBalance !== undefined) {
          updateData.currentBalance = context.currentBalance;
        }
        if (context.orbNftCount !== undefined) {
          updateData.orbNftCount = context.orbNftCount;
        }
        
        await this.db.collection(this.WALLET_AVATARS_COLLECTION).updateOne(
          { walletAddress },
          { $set: updateData }
        );
        
        // Return updated avatar
        walletAvatar.lastActivityAt = updateData.lastActivityAt;
        walletAvatar.activityCount = (walletAvatar.activityCount || 0) + 1;
        if (context.currentBalance !== undefined) {
          walletAvatar.currentBalance = context.currentBalance;
        }
        if (context.orbNftCount !== undefined) {
          walletAvatar.orbNftCount = context.orbNftCount;
        }
        
        return walletAvatar;
      }

      // Check if wallet meets threshold for avatar creation (1M+ RATi)
      if (context.tokenSymbol === 'RATi' && context.currentBalance !== undefined) {
        if (context.currentBalance < this.AVATAR_CREATION_THRESHOLD) {
          this.logger.info(`[WalletAvatarService] Wallet ${this.formatAddress(walletAddress)} has ${context.currentBalance} RATi (below ${this.AVATAR_CREATION_THRESHOLD} threshold)`);
          return null;
        }
      } else {
        // If no balance info, skip avatar creation
        this.logger.info(`[WalletAvatarService] No balance info for ${this.formatAddress(walletAddress)}, skipping avatar creation`);
        return null;
      }

      // Create new wallet avatar for whale holders using full avatar service
      walletAvatar = await this.createWalletAvatar(walletAddress, context);
      
      return walletAvatar;
    } catch (error) {
      this.logger.error('[WalletAvatarService] getOrCreateWalletAvatar failed:', error);
      return null;
    }
  }

  /**
   * Create a new wallet avatar using the full AvatarService
   * @param {string} walletAddress - Solana wallet address
   * @param {Object} context - Context for avatar creation
   * @returns {Promise<Object>} Created wallet avatar with full avatar data
   */
  async createWalletAvatar(walletAddress, context = {}) {
    try {
      // Build prompt for avatar creation
      const prompt = this.buildAvatarPrompt(walletAddress, context);
      
      this.logger.info(`[WalletAvatarService] Creating whale avatar for ${this.formatAddress(walletAddress)} with ${this.formatLargeNumber(context.currentBalance)} ${context.tokenSymbol}`);
      
      // Use AvatarService to create full avatar with image
      const avatar = await this.avatarService.createAvatar({
        prompt,
        summoner: `wallet:${walletAddress}`, // Mark as wallet-summoned
        channelId: context.channelId || null,
        guildId: context.guildId || null
      });

      if (!avatar) {
        this.logger.error('[WalletAvatarService] AvatarService returned null');
        return null;
      }

      // Store wallet mapping in our collection
      const walletAvatarDoc = {
        walletAddress,
        avatarId: avatar._id,
        name: avatar.name,
        emoji: avatar.emoji,
        description: avatar.description,
        personality: avatar.personality,
        imageUrl: avatar.imageUrl,
        currentBalance: context.currentBalance || 0,
        orbNftCount: context.orbNftCount || 0,
        createdAt: new Date(),
        lastActivityAt: new Date(),
        activityCount: 1,
        context: {
          firstSeenToken: context.tokenSymbol || null,
          firstSeenAmount: context.amount || null,
          firstSeenUsd: context.usdValue || null,
          creationBalance: context.currentBalance || 0
        }
      };

      await this.db.collection(this.WALLET_AVATARS_COLLECTION).insertOne(walletAvatarDoc);
      
      this.logger.info(`[WalletAvatarService] Created avatar: ${avatar.emoji} ${avatar.name} (${avatar._id}) for ${this.formatAddress(walletAddress)}`);
      
      // Introduce the new whale avatar across platforms
      await this.introduceWalletAvatar(walletAvatarDoc, context);
      
      return walletAvatarDoc;
    } catch (error) {
      this.logger.error('[WalletAvatarService] createWalletAvatar failed:', error);
      return null;
    }
  }

  /**
   * Introduce a newly created wallet avatar across platforms (Telegram + Discord)
   * @param {Object} walletAvatar - Wallet avatar document
   * @param {Object} context - Creation context (channelId, tokenSymbol, etc)
   */
  async introduceWalletAvatar(walletAvatar, context = {}) {
    try {
      const intro = this.buildIntroductionMessage(walletAvatar, context);
      
      // Post to Telegram if channel tracking this token
      if (context.telegramChannelId) {
        await this.introduceOnTelegram(context.telegramChannelId, walletAvatar, intro);
      }
      
      // Post to Discord channel tracking this token
      if (context.discordChannelId) {
        await this.introduceOnDiscord(context.discordChannelId, walletAvatar, intro);
      }
      
      // If no specific channels, find channels tracking this token and introduce there
      if (!context.telegramChannelId && !context.discordChannelId && context.tokenAddress) {
        await this.introduceInTrackingChannels(context.tokenAddress, walletAvatar, intro);
      }
    } catch (error) {
      this.logger.error('[WalletAvatarService] introduceWalletAvatar failed:', error);
    }
  }

  /**
   * Build introduction message for a new wallet avatar
   * @param {Object} walletAvatar - Wallet avatar document
   * @param {Object} context - Context info
   * @returns {string} Introduction message
   */
  buildIntroductionMessage(walletAvatar, context) {
    const balanceStr = this.formatLargeNumber(walletAvatar.currentBalance);
    const orbStr = walletAvatar.orbNftCount > 0 ? ` and ${walletAvatar.orbNftCount} Orb${walletAvatar.orbNftCount > 1 ? 's' : ''}` : '';
    
    let intro = `${walletAvatar.emoji} **${walletAvatar.name}** has entered the realm!\n\n`;
    intro += `*${walletAvatar.description}*\n\n`;
    intro += `🐋 A legendary whale holder with **${balanceStr} ${context.tokenSymbol || 'RATi'}**${orbStr}.\n\n`;
    intro += `Wallet: \`${this.formatAddress(walletAvatar.walletAddress)}\``;
    
    return intro;
  }

  /**
   * Introduce avatar on Telegram
   * @param {string} channelId - Telegram channel ID
   * @param {Object} walletAvatar - Wallet avatar document
   * @param {string} intro - Introduction message
   */
  async introduceOnTelegram(channelId, walletAvatar, intro) {
    try {
      const telegramService = this.getTelegramService ? this.getTelegramService() : null;
      
      if (!telegramService || !telegramService.globalBot) {
        this.logger.warn('[WalletAvatarService] Telegram service not available');
        return;
      }

      // Send introduction with image if available
      if (walletAvatar.imageUrl) {
        await telegramService.globalBot.telegram.sendPhoto(
          channelId,
          walletAvatar.imageUrl,
          {
            caption: intro,
            parse_mode: 'Markdown'
          }
        );
      } else {
        await telegramService.globalBot.telegram.sendMessage(
          channelId,
          intro,
          { parse_mode: 'Markdown' }
        );
      }
      
      this.logger.info(`[WalletAvatarService] Introduced ${walletAvatar.name} on Telegram channel ${channelId}`);
    } catch (error) {
      this.logger.error('[WalletAvatarService] introduceOnTelegram failed:', error);
    }
  }

  /**
   * Introduce avatar on Discord
   * @param {string} channelId - Discord channel ID
   * @param {Object} walletAvatar - Wallet avatar document
   * @param {string} intro - Introduction message
   */
  async introduceOnDiscord(channelId, walletAvatar, intro) {
    try {
      if (!this.discordService || !this.discordService.client) {
        this.logger.warn('[WalletAvatarService] Discord service not available');
        return;
      }

      const channel = await this.discordService.client.channels.fetch(channelId);
      
      if (!channel || !channel.isTextBased()) {
        this.logger.warn(`[WalletAvatarService] Discord channel ${channelId} not found or not text-based`);
        return;
      }

      // Send introduction with image if available
      const messageOptions = { content: intro };
      
      if (walletAvatar.imageUrl) {
        messageOptions.embeds = [{
          color: 0x9b59b6, // Purple for whale
          image: { url: walletAvatar.imageUrl },
          footer: { text: `Whale Avatar • ${new Date().toLocaleDateString()}` }
        }];
      }

      await channel.send(messageOptions);
      
      this.logger.info(`[WalletAvatarService] Introduced ${walletAvatar.name} on Discord channel ${channelId}`);
    } catch (error) {
      this.logger.error('[WalletAvatarService] introduceOnDiscord failed:', error);
    }
  }

  /**
   * Find channels tracking a token and introduce avatar there
   * @param {string} tokenAddress - Token address being tracked
   * @param {Object} walletAvatar - Wallet avatar document
   * @param {string} intro - Introduction message
   */
  async introduceInTrackingChannels(tokenAddress, walletAvatar, intro) {
    try {
      // Find all channels tracking this token
      const trackedTokens = await this.db.collection('buybot_tracked_tokens')
        .find({ tokenAddress, active: true })
        .toArray();
      
      if (trackedTokens.length === 0) {
        this.logger.info(`[WalletAvatarService] No channels tracking ${tokenAddress}`);
        return;
      }

      // Introduce on each platform
      for (const token of trackedTokens) {
        if (token.platform === 'telegram') {
          await this.introduceOnTelegram(token.channelId, walletAvatar, intro);
        } else if (token.platform === 'discord') {
          await this.introduceOnDiscord(token.channelId, walletAvatar, intro);
        }
      }
    } catch (error) {
      this.logger.error('[WalletAvatarService] introduceInTrackingChannels failed:', error);
    }
  }

  /**
   * Build prompt for AI avatar generation
   * @param {string} walletAddress - Wallet address
   * @param {Object} context - Context information
   * @returns {string} Prompt for AI
   */
  buildAvatarPrompt(walletAddress, context) {
    const addressSummary = `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`;
    
    let prompt = `Create a memorable character for a WHALE wallet holder ${addressSummary}.`;
    
    if (context.tokenSymbol === 'RATi' && context.currentBalance) {
      const balanceStr = this.formatLargeNumber(context.currentBalance);
      prompt += ` This is a major RATi holder with ${balanceStr} tokens`;
      
      if (context.orbNftCount && context.orbNftCount > 0) {
        prompt += ` and ${context.orbNftCount} Orb NFT${context.orbNftCount > 1 ? 's' : ''}`;
      }
      prompt += '.';
    }
    
    prompt += '\n\nThis is a significant holder - create an impressive, legendary persona befitting their whale status.';
    prompt += '\n\nThink: cosmic deities, ancient beings, legendary titans, mythical guardians, or celestial entities.';
    prompt += '\n\nExample format: {"name":"Bob the Celestial Snake","emoji":"🐍","description":"A cosmic serpent who slithers through the blockchain","personality":"wise and patient"}';
    
    return prompt;
  }

  /**
   * Format large numbers with K/M/B suffixes
   * @param {number} num - Number to format
   * @returns {string} Formatted number
   */
  formatLargeNumber(num) {
    if (num >= 1_000_000_000) {
      return `${(num / 1_000_000_000).toFixed(2)}B`;
    }
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(2)}M`;
    }
    if (num >= 1_000) {
      return `${(num / 1_000).toFixed(2)}K`;
    }
    return num.toString();
  }

  /**
   * Generate a fallback avatar if AI fails
   * @param {string} walletAddress - Wallet address
   * @returns {Object} Fallback avatar
   */
  generateFallbackAvatar(walletAddress) {
    const name = this.generateCreativeName(walletAddress);
    const emoji = this.getRandomEmoji();
    
    return {
      walletAddress,
      name,
      emoji,
      description: `A legendary ${this.getTraderType()} commanding the Solana blockchain`,
      personality: 'powerful and mysterious',
      createdAt: new Date(),
      lastActivityAt: new Date(),
      activityCount: 1,
      currentBalance: 0,
      orbNftCount: 0,
      context: {}
    };
  }

  /**
   * Generate a creative name from wallet address
   * Uses deterministic generation based on address bytes
   * @param {string} address - Wallet address
   * @returns {string} Generated name
   */
  generateCreativeName(address) {
    const adjectives = [
      'Swift', 'Bold', 'Silent', 'Fierce', 'Wise', 'Ancient', 'Mystic', 'Shadow',
      'Thunder', 'Lightning', 'Cosmic', 'Stellar', 'Quantum', 'Digital', 'Phantom',
      'Crystal', 'Golden', 'Silver', 'Jade', 'Obsidian', 'Celestial', 'Ethereal'
    ];
    
    const nouns = [
      'Trader', 'Whale', 'Hunter', 'Sage', 'Wizard', 'Dragon', 'Phoenix', 'Griffin',
      'Serpent', 'Tiger', 'Wolf', 'Bear', 'Eagle', 'Lion', 'Shark', 'Falcon',
      'Raven', 'Viper', 'Panther', 'Lynx', 'Cobra', 'Oracle', 'Nomad', 'Wanderer'
    ];
    
    // Use address bytes for deterministic selection
    const hash = address.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const adjIndex = hash % adjectives.length;
    const nounIndex = (hash * 7) % nouns.length;
    
    return `${adjectives[adjIndex]} ${nouns[nounIndex]}`;
  }

  /**
   * Get random trader type for description
   * @returns {string} Trader type
   */
  getTraderType() {
    const types = ['whale', 'titan', 'guardian', 'collector', 'sovereign', 'legend'];
    return types[Math.floor(Math.random() * types.length)];
  }

  /**
   * Get random emoji
   * @returns {string} Emoji
   */
  getRandomEmoji() {
    const emojis = [
      '🐉', '🦅', '🦁', '🐺', '🐯', '🦈', '🐍', '🦂', '🕷️', '🦇',
      '👑', '⚡', '🔮', '💎', '🌟', '✨', '💫', '🌙', '☀️', '🔥',
      '🎭', '🎪', '🎨', '🎯', '🎲', '🃏', '🏆', '👤', '🧙', '🧛'
    ];
    return emojis[Math.floor(Math.random() * emojis.length)];
  }

  /**
   * Validate emoji (check if it's a valid emoji character)
   * @param {string} emoji - Emoji to validate
   * @returns {string|null} Valid emoji or null
   */
  validateEmoji(emoji) {
    if (!emoji || typeof emoji !== 'string') return null;
    // Simple check: most emojis are 1-2 chars long
    if (emoji.length > 4) return null;
    // Check if it contains actual emoji characters (basic validation)
    if (/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(emoji)) {
      return emoji;
    }
    return null;
  }

  /**
   * Format wallet address for display
   * @param {string} address - Wallet address
   * @returns {string} Formatted address
   */
  formatAddress(address) {
    if (!address || address.length < 8) return address;
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  }

  /**
   * Update wallet avatar activity
   * @param {string} walletAddress - Wallet address
   * @param {Object} activity - Activity details
   */
  async recordActivity(walletAddress, activity = {}) {
    try {
      if (!this.db) {
        this.db = await this.databaseService.getDatabase();
      }

      await this.db.collection(this.WALLET_AVATARS_COLLECTION).updateOne(
        { walletAddress },
        {
          $set: { lastActivityAt: new Date() },
          $inc: { activityCount: 1 },
          $push: {
            recentActivity: {
              $each: [{
                ...activity,
                timestamp: new Date()
              }],
              $slice: -10 // Keep only last 10 activities
            }
          }
        }
      );
    } catch (error) {
      this.logger.error('[WalletAvatarService] recordActivity failed:', error);
    }
  }

  /**
   * Get avatar by wallet address
   * @param {string} walletAddress - Wallet address
   * @returns {Promise<Object|null>} Wallet avatar or null
   */
  async getWalletAvatar(walletAddress) {
    try {
      if (!this.db) {
        this.db = await this.databaseService.getDatabase();
      }

      return await this.db.collection(this.WALLET_AVATARS_COLLECTION)
        .findOne({ walletAddress });
    } catch (error) {
      this.logger.error('[WalletAvatarService] getWalletAvatar failed:', error);
      return null;
    }
  }

  /**
   * Get top traders (most active wallets)
   * @param {number} limit - Number of results
   * @returns {Promise<Array>} Top wallet avatars
   */
  async getTopTraders(limit = 10) {
    try {
      if (!this.db) {
        this.db = await this.databaseService.getDatabase();
      }

      return await this.db.collection(this.WALLET_AVATARS_COLLECTION)
        .find({})
        .sort({ activityCount: -1 })
        .limit(limit)
        .toArray();
    } catch (error) {
      this.logger.error('[WalletAvatarService] getTopTraders failed:', error);
      return [];
    }
  }
}

export default WalletAvatarService;
