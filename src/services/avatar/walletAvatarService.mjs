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
  constructor(services) {
    this.services = services;
    this.databaseService = services.databaseService;
    this.avatarService = services.avatarService;
    this.logger = services.logger;
    this.db = null;
    
    // Thresholds cache (1 minute TTL)
    this.thresholdsCache = null;
    this.thresholdsCacheExpiry = 0;
    
    // Default thresholds (fallback if no config)
    this.DEFAULT_RATI_THRESHOLD = 1_000_000;
    this.DEFAULT_USD_THRESHOLD = 1000;
  }

  /**
   * Get TelegramService (late-bound to avoid circular dependency)
   * @returns {Object|null} TelegramService instance
   */
  getTelegramService() {
    try {
      return this.services?.resolve?.('telegramService') || null;
    } catch {
      return null;
    }
  }
  
  /**
   * Get ConfigService (late-bound to avoid circular dependency)
   * @returns {Object|null} ConfigService instance
   */
  getConfigService() {
    try {
      return this.services?.resolve?.('configService') || null;
    } catch {
      return null;
    }
  }
  
  /**
   * Get wallet avatar thresholds from configuration
   * Supports both guild-specific and global configuration
   * @param {string} guildId - Optional guild ID for guild-specific thresholds
   * @returns {Promise<Object>} Thresholds object with ratiThreshold and usdThreshold
   */
  async getThresholds(guildId = null) {
    try {
      // Check cache first
      const now = Date.now();
      if (this._cachedThresholds && (now - this._thresholdCacheTime) < this._thresholdCacheTTL) {
        return this._cachedThresholds;
      }
      
      if (!this.db) {
        this.db = await this.databaseService.getDatabase();
      }
      
      // Try to get guild-specific config first if guildId provided
      if (guildId) {
        const configService = this.getConfigService();
        if (configService) {
          try {
            const guildConfig = await configService.getGuildConfig(guildId);
            if (guildConfig?.walletAvatarThresholds) {
              const thresholds = {
                ratiThreshold: guildConfig.walletAvatarThresholds.ratiThreshold ?? this.DEFAULT_RATI_THRESHOLD,
                usdThreshold: guildConfig.walletAvatarThresholds.usdThreshold ?? this.DEFAULT_USD_THRESHOLD
              };
              this._cachedThresholds = thresholds;
              this._thresholdCacheTime = now;
              return thresholds;
            }
          } catch (error) {
            this.logger.warn(`[WalletAvatarService] Failed to get guild config for ${guildId}:`, error);
          }
        }
      }
      
      // Fallback to global config
      const globalConfig = await this.db.collection('global_config')
        .findOne({ _id: 'walletAvatarThresholds' });
      
      const thresholds = {
        ratiThreshold: globalConfig?.ratiThreshold ?? this.DEFAULT_RATI_THRESHOLD,
        usdThreshold: globalConfig?.usdThreshold ?? this.DEFAULT_USD_THRESHOLD
      };
      
      // Cache the result
      this._cachedThresholds = thresholds;
      this._thresholdCacheTime = now;
      
      return thresholds;
    } catch (error) {
      this.logger.error('[WalletAvatarService] Failed to get thresholds from config:', error);
      // Return defaults on error
      return {
        ratiThreshold: this.DEFAULT_RATI_THRESHOLD,
        usdThreshold: this.DEFAULT_USD_THRESHOLD
      };
    }
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
   * Stores in main avatars collection with walletAddress field
   * @param {string} walletAddress - Solana wallet address
   * @param {Object} context - Optional context (token, amount, balance, etc)
   * @returns {Promise<Object|null>} Avatar object or null if error
   */
  async getOrCreateWalletAvatar(walletAddress, context = {}) {
    try {
      if (!this.db) {
        this.db = await this.databaseService.getDatabase();
      }

      // Check if avatar already exists in main avatars collection
      let avatar = await this.db.collection('avatars')
        .findOne({ walletAddress, status: { $ne: 'dead' } });

      if (avatar) {
        // Update last activity and token balances
        const updateSet = {
          lastActivityAt: new Date()
        };
        
        // Update token balance if provided (flexible schema)
        if (context.tokenSymbol && context.currentBalance !== undefined) {
          updateSet[`tokenBalances.${context.tokenSymbol}`] = {
            balance: context.currentBalance,
            usdValue: context.usdValue || null,
            lastUpdated: new Date()
          };
        }
        
        // Update NFT counts if provided
        if (context.orbNftCount !== undefined) {
          updateSet[`nftBalances.Orb`] = context.orbNftCount;
        }
        
        await this.db.collection('avatars').updateOne(
          { _id: avatar._id },
          { 
            $set: updateSet,
            $inc: { activityCount: 1 }
          }
        );
        
        // Return updated avatar with new data
        avatar.lastActivityAt = updateSet.lastActivityAt;
        avatar.activityCount = (avatar.activityCount || 0) + 1;
        if (context.tokenSymbol && context.currentBalance !== undefined) {
          avatar.tokenBalances = avatar.tokenBalances || {};
          avatar.tokenBalances[context.tokenSymbol] = updateSet[`tokenBalances.${context.tokenSymbol}`];
        }
        if (context.orbNftCount !== undefined) {
          avatar.nftBalances = avatar.nftBalances || {};
          avatar.nftBalances.Orb = context.orbNftCount;
        }
        
        return avatar;
      }

      // Check if wallet meets threshold for avatar creation
      if (context.currentBalance === undefined || context.currentBalance === null) {
        this.logger.info(`[WalletAvatarService] No balance info provided for ${this.formatAddress(walletAddress)}, skipping avatar creation`);
        return null;
      }

      // NEW LOGIC: 
      // - RATi holders: Create FULL avatar for ANY amount (no minimum threshold)
      // - Non-RATi tokens: Create PARTIAL avatar (name + family only, no image/personality)
      
      if (context.tokenSymbol === 'RATi') {
        // Any RATi holder gets a full avatar
        this.logger.info(`[WalletAvatarService] Creating full avatar for RATi holder ${this.formatAddress(walletAddress)} with ${this.formatLargeNumber(context.currentBalance)} RATi`);
        avatar = await this.createWalletAvatar(walletAddress, context);
      } else {
        // Non-RATi tokens get a partial avatar (name + family only)
        this.logger.info(`[WalletAvatarService] Creating partial avatar for ${context.tokenSymbol} holder ${this.formatAddress(walletAddress)} with ${this.formatLargeNumber(context.currentBalance)} tokens (${context.usdValue ? '$' + context.usdValue.toFixed(2) : 'unknown USD value'})`);
        avatar = await this.createPartialWalletAvatar(walletAddress, context);
      }
      
      return avatar;
    } catch (error) {
      this.logger.error('[WalletAvatarService] getOrCreateWalletAvatar failed:', error);
      return null;
    }
  }

  /**
   * Create a new full wallet avatar using AI generation
   * Stores in main avatars collection with walletAddress field
   * @param {string} walletAddress - Solana wallet address
   * @param {Object} context - Context for avatar creation
   * @returns {Promise<Object>} Created avatar
   */
  async createWalletAvatar(walletAddress, context = {}) {
    try {
      // Build prompt for avatar creation
      const prompt = this.buildAvatarPrompt(walletAddress, context);
      
      this.logger.info(`[WalletAvatarService] Creating full avatar for ${this.formatAddress(walletAddress)} with ${this.formatLargeNumber(context.currentBalance)} ${context.tokenSymbol}`);
      
      // Normalize channel ID (discordChannelId or telegramChannelId or channelId)
      const channelId = context.discordChannelId || context.telegramChannelId || context.channelId || null;
      const guildId = context.guildId || null;
      
      // Use AvatarService to create full avatar with image
      const avatar = await this.avatarService.createAvatar({
        prompt,
        summoner: `wallet:${walletAddress}`, // Mark as wallet-summoned
        channelId: channelId,
        guildId: guildId
      });

      if (!avatar) {
        this.logger.error('[WalletAvatarService] AvatarService returned null');
        return null;
      }

      // Prepare flexible token balances and NFT balances
      const tokenBalances = {};
      const nftBalances = {};
      
      if (context.tokenSymbol) {
        tokenBalances[context.tokenSymbol] = {
          balance: context.currentBalance || 0,
          usdValue: context.usdValue || null,
          lastUpdated: new Date()
        };
      }
      
      if (context.orbNftCount) {
        nftBalances.Orb = context.orbNftCount;
      }

      // Add wallet-specific fields to the avatar document
      await this.db.collection('avatars').updateOne(
        { _id: avatar._id },
        { 
          $set: {
            walletAddress,
            tokenBalances,        // Flexible: { RATi: { balance, usdValue, lastUpdated }, SOL: {...}, ... }
            nftBalances,          // Flexible: { Orb: count, OtherNFT: count, ... }
            isPartial: false,     // Full avatar with AI + image
            lastActivityAt: new Date(),
            activityCount: 1,
            walletContext: {
              firstSeenToken: context.tokenSymbol || null,
              firstSeenAmount: context.amount || null,
              firstSeenUsd: context.usdValue || null,
              creationBalance: context.currentBalance || 0
            }
          }
        }
      );
      
      // Reload avatar with updated fields
      const updatedAvatar = await this.db.collection('avatars').findOne({ _id: avatar._id });
      
      this.logger.info(`[WalletAvatarService] Created full avatar: ${updatedAvatar.emoji} ${updatedAvatar.name} (${updatedAvatar._id}) for ${this.formatAddress(walletAddress)}`);
      
      // Activate avatar in Discord channel so it can participate in conversations
      if (context.discordChannelId) {
        try {
          await this.avatarService.activateAvatarInChannel(context.discordChannelId, String(updatedAvatar._id));
          this.logger.info(`[WalletAvatarService] Activated wallet avatar ${updatedAvatar.name} in Discord channel ${context.discordChannelId}`);
        } catch (activateError) {
          this.logger.error(`[WalletAvatarService] Failed to activate avatar in channel: ${activateError.message}`);
        }
      }
      
      // Introduce the new whale avatar across platforms (only for FULL avatars)
      await this.introduceWalletAvatar(updatedAvatar, context);
      
      return updatedAvatar;
    } catch (error) {
      this.logger.error('[WalletAvatarService] createWalletAvatar failed:', error);
      return null;
    }
  }

  /**
   * Create a partial wallet avatar (name + family + emoji only, no AI/image)
   * Used for non-RATi token holders to avoid expensive AI generation
   * Stores in main avatars collection with isPartial flag
   * @param {string} walletAddress - Solana wallet address
   * @param {Object} context - Context for avatar creation (must include tokenSymbol)
   * @returns {Promise<Object>} Created partial avatar
   */
  async createPartialWalletAvatar(walletAddress, context = {}) {
    try {
      const tokenSymbol = context.tokenSymbol || 'TOKEN';
      
      this.logger.info(`[WalletAvatarService] Creating partial avatar for ${this.formatAddress(walletAddress)} (${tokenSymbol} holder)`);
      
      // Generate deterministic name and family based on wallet + token
      const { name, family, emoji } = this.generatePartialAvatarIdentity(walletAddress, tokenSymbol);
      
      // Prepare flexible token balances and NFT balances
      const tokenBalances = {};
      const nftBalances = {};
      
      if (tokenSymbol) {
        tokenBalances[tokenSymbol] = {
          balance: context.currentBalance || 0,
          usdValue: context.usdValue || null,
          lastUpdated: new Date()
        };
      }
      
      if (context.orbNftCount) {
        nftBalances.Orb = context.orbNftCount;
      }
      
      // Store minimal avatar document in main collection (no AI, no image)
      const avatarDoc = {
        walletAddress,
        name,
        emoji,
        family, // Token-specific family
        description: `A ${tokenSymbol} holder from the ${family}`,
        personality: null, // No AI personality
        imageUrl: null, // No generated image
        tokenBalances,    // Flexible: { SOL: { balance, usdValue, lastUpdated }, BONK: {...}, ... }
        nftBalances,      // Flexible: { Orb: count, OtherNFT: count, ... }
        isPartial: true,  // Flag as partial avatar (no AI/image)
        summoner: `wallet:${walletAddress}`,
        channelId: context.discordChannelId || context.telegramChannelId || context.channelId || null,
        guildId: context.guildId || null,
        lives: 3,
        status: 'alive',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastActivityAt: new Date(),
        activityCount: 1,
        walletContext: {
          firstSeenToken: tokenSymbol,
          firstSeenAmount: context.amount || null,
          firstSeenUsd: context.usdValue || null,
          creationBalance: context.currentBalance || 0
        }
      };

      const result = await this.db.collection('avatars').insertOne(avatarDoc);
      avatarDoc._id = result.insertedId;
      
      this.logger.info(`[WalletAvatarService] Created partial avatar: ${emoji} ${name} from ${family} for ${this.formatAddress(walletAddress)}`);
      
      // NO introduction for partial avatars - they're background personas
      
      return avatarDoc;
    } catch (error) {
      this.logger.error('[WalletAvatarService] createPartialWalletAvatar failed:', error);
      return null;
    }
  }  /**
   * Generate deterministic name, family, and emoji for partial avatars
   * Each token gets its own themed "family" of avatars with unique naming patterns
   * @param {string} walletAddress - Solana wallet address
   * @param {string} tokenSymbol - Token symbol (e.g., "USDC", "SOL")
   * @returns {Object} { name, family, emoji }
   */
  generatePartialAvatarIdentity(walletAddress, tokenSymbol) {
    // Use first 8 chars of wallet for deterministic seed
    const seed = walletAddress.substring(0, 8);
    
    // Token-themed families with distinct character themes
    const tokenThemes = {
      'USDC': {
        family: 'Stablecoin Syndicate',
        prefixes: ['Steady', 'Fixed', 'Anchored', 'Pegged', 'Balanced', 'Secure'],
        suffixes: ['Banker', 'Trader', 'Keeper', 'Holder', 'Dealer', 'Merchant'],
        emojis: ['💵', '💰', '🏦', '💳', '💸', '💴']
      },
      'SOL': {
        family: 'Solar Collective',
        prefixes: ['Blazing', 'Radiant', 'Luminous', 'Bright', 'Stellar', 'Cosmic'],
        suffixes: ['Sun', 'Ray', 'Flare', 'Eclipse', 'Dawn', 'Horizon'],
        emojis: ['☀️', '⚡', '🌞', '🔥', '✨', '🌟']
      },
      'BONK': {
        family: 'Bonk Brigade',
        prefixes: ['Bonking', 'Barking', 'Howling', 'Loyal', 'Furry', 'Playful'],
        suffixes: ['Pup', 'Doge', 'Hound', 'Shiba', 'Woof', 'Snout'],
        emojis: ['🐕', '🐶', '🦴', '🐾', '🎾', '🦮']
      },
      'JUP': {
        family: 'Jupiter Guild',
        prefixes: ['Swapping', 'Trading', 'Orbital', 'Celestial', 'Routing', 'Bridging'],
        suffixes: ['Swapper', 'Trader', 'Router', 'Scout', 'Navigator', 'Pilot'],
        emojis: ['🪐', '🚀', '🌌', '💫', '🔭', '🛸']
      },
      'WIF': {
        family: 'Dogwifhat Clan',
        prefixes: ['Stylish', 'Dapper', 'Fancy', 'Snazzy', 'Chic', 'Classy'],
        suffixes: ['Hatter', 'Wearer', 'Fashionista', 'Model', 'Icon', 'Trendsetter'],
        emojis: ['🎩', '👒', '🧢', '👑', '🎓', '⛑️']
      },
      'PYTH': {
        family: 'Oracle Network',
        prefixes: ['Prophetic', 'Wise', 'Knowing', 'Seeing', 'Truthful', 'Accurate'],
        suffixes: ['Oracle', 'Seer', 'Prophet', 'Keeper', 'Reader', 'Diviner'],
        emojis: ['🔮', '👁️', '📊', '📈', '⚡', '🎯']
      },
      'ORCA': {
        family: 'Ocean Dwellers',
        prefixes: ['Swimming', 'Diving', 'Flowing', 'Splashing', 'Surfing', 'Cruising'],
        suffixes: ['Whale', 'Orca', 'Swimmer', 'Diver', 'Navigator', 'Captain'],
        emojis: ['🐋', '🌊', '💧', '🐚', '⚓', '🏊']
      },
      'RAY': {
        family: 'Raydium Collective',
        prefixes: ['Liquid', 'Pooled', 'Flowing', 'Farming', 'Staking', 'Yielding'],
        suffixes: ['Farmer', 'Provider', 'Staker', 'Maker', 'Builder', 'Pooler'],
        emojis: ['�', '�', '�', '⚡', '�', '💠']
      },
      'SAMO': {
        family: 'Samoyed Squad',
        prefixes: ['Fluffy', 'Snowy', 'Arctic', 'White', 'Smiling', 'Happy'],
        suffixes: ['Samo', 'Pup', 'Floof', 'Cloud', 'Snowball', 'Companion'],
        emojis: ['🐕', '☁️', '❄️', '�', '🐾', '�']
      },
      'USDT': {
        family: 'Tether Alliance',
        prefixes: ['Tethered', 'Stable', 'Steady', 'Bound', 'Fixed', 'Solid'],
        suffixes: ['Anchor', 'Tether', 'Holder', 'Keeper', 'Guardian', 'Custodian'],
        emojis: ['💵', '�', '⚓', '�', '�️', '💼']
      },
      'MEME': {
        family: 'Meme Lords',
        prefixes: ['Viral', 'Dank', 'Based', 'Memetic', 'Legendary', 'Epic'],
        suffixes: ['Memer', 'Lord', 'King', 'Legend', 'Master', 'Champion'],
        emojis: ['�', '🎭', '🃏', '�', '🤡', '�']
      }
    };
    
    // Get theme for token or use default
    const theme = tokenThemes[tokenSymbol] || {
      family: `${tokenSymbol} Holders`,
      prefixes: ['Swift', 'Bold', 'Silent', 'Wise', 'Fierce', 'Noble'],
      suffixes: ['Trader', 'Holder', 'Whale', 'Investor', 'Dealer', 'Keeper'],
      emojis: ['🔷', '💎', '🎯', '⚡', '🌟', '✨']
    };
    
    // Generate deterministic indices from wallet address
    const prefixIndex = parseInt(seed.substring(0, 2), 16) % theme.prefixes.length;
    const suffixIndex = parseInt(seed.substring(2, 4), 16) % theme.suffixes.length;
    const emojiIndex = parseInt(seed.substring(4, 6), 16) % theme.emojis.length;
    
    const family = theme.family;
    const emoji = theme.emojis[emojiIndex];
    const name = `${theme.prefixes[prefixIndex]} ${theme.suffixes[suffixIndex]}`;
    
    return { name, family, emoji };
  }

  /**
   * Introduce a newly created full wallet avatar across platforms (Telegram + Discord)
   * Only called for full avatars, not partial ones
   * @param {Object} avatar - Avatar document from main avatars collection
   * @param {Object} context - Creation context (channelId, tokenSymbol, etc)
   */
  async introduceWalletAvatar(avatar, context = {}) {
    try {
      // Only introduce full avatars (with images and AI)
      if (avatar.isPartial) {
        this.logger.debug(`[WalletAvatarService] Skipping introduction for partial avatar ${avatar.name}`);
        return;
      }
      
      const intro = this.buildIntroductionMessage(avatar, context);
      
      // Post to Telegram if channel tracking this token
      if (context.telegramChannelId) {
        await this.introduceOnTelegram(context.telegramChannelId, avatar, intro);
      }
      
      // Post to Discord channel tracking this token
      if (context.discordChannelId) {
        await this.introduceOnDiscord(context.discordChannelId, avatar, intro);
      }
      
      // If no specific channels, find channels tracking this token and introduce there
      if (!context.telegramChannelId && !context.discordChannelId && context.tokenAddress) {
        await this.introduceInTrackingChannels(context.tokenAddress, avatar, intro);
      }
    } catch (error) {
      this.logger.error('[WalletAvatarService] introduceWalletAvatar failed:', error);
    }
  }

  /**
   * Build introduction message for a new wallet avatar
   * @param {Object} avatar - Avatar document
   * @param {Object} context - Context info
   * @returns {string} Introduction message
   */
  buildIntroductionMessage(avatar, context) {
    // Get primary token balance (the one that triggered avatar creation)
    const primaryToken = context.tokenSymbol || 'RATi';
    const tokenBalance = avatar.tokenBalances?.[primaryToken];
    const balanceStr = tokenBalance ? this.formatLargeNumber(tokenBalance.balance) : '0';
    
    // Get NFT counts
    const orbCount = avatar.nftBalances?.Orb || 0;
    const orbStr = orbCount > 0 ? ` and ${orbCount} Orb${orbCount > 1 ? 's' : ''}` : '';
    
    let intro = `${avatar.emoji} **${avatar.name}** has entered the realm!\n\n`;
    intro += `*${avatar.description}*\n\n`;
    intro += `🐋 A legendary whale holder with **${balanceStr} ${primaryToken}**${orbStr}.\n\n`;
    
    // List other significant token holdings if present
    if (avatar.tokenBalances) {
      const otherTokens = Object.entries(avatar.tokenBalances)
        .filter(([symbol]) => symbol !== primaryToken && avatar.tokenBalances[symbol].balance > 0)
        .slice(0, 3); // Show up to 3 other tokens
      
      if (otherTokens.length > 0) {
        const tokenList = otherTokens.map(([symbol, data]) => 
          `${this.formatLargeNumber(data.balance)} ${symbol}`
        ).join(', ');
        intro += `Also holds: ${tokenList}\n\n`;
      }
    }
    
    intro += `Wallet: \`${this.formatAddress(avatar.walletAddress)}\``;
    
    return intro;
  }

  /**
   * Introduce avatar on Telegram
   * @param {string} channelId - Telegram channel ID
   * @param {Object} avatar - Avatar document
   * @param {string} intro - Introduction message
   */
  async introduceOnTelegram(channelId, avatar, intro) {
    try {
      const telegramService = this.getTelegramService();
      
      if (!telegramService || !telegramService.globalBot) {
        this.logger.warn('[WalletAvatarService] Telegram service not available');
        return;
      }

      // Send introduction with image if available (full avatars only)
      if (avatar.imageUrl) {
        await telegramService.globalBot.telegram.sendPhoto(
          channelId,
          avatar.imageUrl,
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
      
      this.logger.info(`[WalletAvatarService] Introduced ${avatar.name} on Telegram channel ${channelId}`);
    } catch (error) {
      this.logger.error('[WalletAvatarService] introduceOnTelegram failed:', error);
    }
  }

  /**
   * Introduce avatar on Discord
   * @param {string} channelId - Discord channel ID
   * @param {Object} avatar - Avatar document
   * @param {string} intro - Introduction message
   */
  async introduceOnDiscord(channelId, avatar, intro) {
    try {
      const discordService = this.getDiscordService();
      
      if (!discordService) {
        this.logger.warn('[WalletAvatarService] Discord service not available');
        return;
      }

      // Send as webhook to match avatar's persona (if they have image + personality)
      if (avatar.imageUrl && !avatar.isPartial) {
        await discordService.sendAsWebhook(channelId, intro, avatar);
      } else {
        // Simple message for partial avatars or if webhook fails
        await discordService.sendMessage(channelId, intro);
      }
      
      this.logger.info(`[WalletAvatarService] Introduced ${avatar.name} on Discord channel ${channelId}`);
    } catch (error) {
      this.logger.error('[WalletAvatarService] introduceOnDiscord failed:', error);
    }
  }  /**
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
