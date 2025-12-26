/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * @file botService.mjs
 * @description Multi-Bot Management Service
 * 
 * Manages bot instances with isolated configurations, platform connections,
 * and scoped secrets. Each bot is a deployable unit that can connect to
 * Discord, X (Twitter), and/or Telegram with its own credentials.
 */

import crypto from 'crypto';

/**
 * @typedef {Object} BotPlatformConfig
 * @property {boolean} enabled - Whether this platform is enabled
 * @property {string} [clientId] - Platform client ID
 * @property {string[]} [guildIds] - Discord guild IDs
 * @property {string} [accountId] - X account reference
 * @property {string} [botUsername] - Telegram bot username
 * @property {string[]} [channelIds] - Telegram channel IDs
 */

/**
 * @typedef {Object} BotConfig
 * @property {string} defaultModel - Default AI model
 * @property {number} temperature - AI temperature setting
 * @property {number} maxTokens - Max tokens per response
 * @property {Object} features - Feature flags
 * @property {Object} rateLimit - Rate limiting config
 */

/**
 * @typedef {Object} Bot
 * @property {string} _id - Bot ID
 * @property {string} name - Bot display name
 * @property {string} [description] - Bot description
 * @property {'running'|'paused'|'error'|'initializing'} status - Current status
 * @property {Object} platforms - Platform configurations
 * @property {BotConfig} config - Bot configuration
 * @property {string[]} avatarIds - Assigned avatar IDs
 * @property {Date} createdAt - Creation timestamp
 * @property {Date} updatedAt - Last update timestamp
 * @property {string} createdBy - Creator wallet address
 * @property {Date} [lastActiveAt] - Last activity timestamp
 */

const DEFAULT_BOT_CONFIG = {
  defaultModel: 'anthropic/claude-sonnet-4',
  temperature: 0.7,
  maxTokens: 2048,
  features: {
    combat: true,
    breeding: true,
    x402Payments: false,
    autoPost: true,
  },
  rateLimit: {
    messagesPerHour: 60,
    cooldownSeconds: 10,
  },
};

const DEFAULT_PLATFORMS = {
  discord: { enabled: false, guildIds: [] },
  x: { enabled: false },
  telegram: { enabled: false, channelIds: [] },
};

export class BotService {
  static COLLECTION_NAME = 'bots';

  constructor({ logger, databaseService, secretsService, configService }) {
    this.logger = logger;
    this.databaseService = databaseService;
    this.secretsService = secretsService;
    this.configService = configService;
    this.collection = null;
    this._initialized = false;
  }

  /**
   * Initialize the service and ensure indexes
   */
  async initialize() {
    if (this._initialized) return;

    try {
      const db = await this.databaseService.getDatabase();
      this.collection = db.collection(BotService.COLLECTION_NAME);

      // Create indexes
      await this.collection.createIndex({ name: 1 }, { unique: true });
      await this.collection.createIndex({ status: 1 });
      await this.collection.createIndex({ 'platforms.discord.enabled': 1 });
      await this.collection.createIndex({ 'platforms.x.enabled': 1 });
      await this.collection.createIndex({ 'platforms.telegram.enabled': 1 });
      await this.collection.createIndex({ avatarIds: 1 });
      await this.collection.createIndex({ createdAt: -1 });

      this._initialized = true;
      this.logger.info('[BotService] Initialized with indexes');

      // Ensure default bot exists for backward compatibility
      await this._ensureDefaultBot();
    } catch (error) {
      this.logger.error('[BotService] Initialization failed:', error.message);
      throw error;
    }
  }

  /**
   * Ensure a default bot exists for backward compatibility with legacy config
   */
  async _ensureDefaultBot() {
    const existing = await this.collection.findOne({ _id: 'default' });
    if (existing) return existing;

    const defaultBot = {
      _id: 'default',
      name: 'Default Bot',
      description: 'Primary bot instance (migrated from legacy configuration)',
      status: 'running',
      platforms: {
        discord: { enabled: true, guildIds: [] },
        x: { enabled: true },
        telegram: { enabled: true, channelIds: [] },
      },
      config: { ...DEFAULT_BOT_CONFIG },
      avatarIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'system',
      isDefault: true,
    };

    await this.collection.insertOne(defaultBot);
    this.logger.info('[BotService] Created default bot for backward compatibility');
    return defaultBot;
  }

  /**
   * Generate a unique bot ID
   */
  _generateBotId() {
    return `bot_${crypto.randomBytes(8).toString('hex')}`;
  }

  /**
   * Create a new bot instance
   * @param {Object} data - Bot creation data
   * @returns {Promise<Bot>}
   */
  async createBot(data) {
    await this.initialize();

    const { name, description, createdBy, platforms = {}, config = {} } = data;

    if (!name) {
      throw new Error('Bot name is required');
    }

    // Check for duplicate name
    const existing = await this.collection.findOne({ name });
    if (existing) {
      throw new Error(`Bot with name "${name}" already exists`);
    }

    const bot = {
      _id: this._generateBotId(),
      name,
      description: description || '',
      status: 'initializing',
      platforms: {
        discord: { ...DEFAULT_PLATFORMS.discord, ...platforms.discord },
        x: { ...DEFAULT_PLATFORMS.x, ...platforms.x },
        telegram: { ...DEFAULT_PLATFORMS.telegram, ...platforms.telegram },
      },
      config: { ...DEFAULT_BOT_CONFIG, ...config },
      avatarIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: createdBy || 'unknown',
      isDefault: false,
    };

    await this.collection.insertOne(bot);
    this.logger.info(`[BotService] Created bot: ${bot.name} (${bot._id})`);

    return bot;
  }

  /**
   * Get a bot by ID
   * @param {string} botId
   * @returns {Promise<Bot|null>}
   */
  async getBot(botId) {
    await this.initialize();
    return this.collection.findOne({ _id: botId });
  }

  /**
   * Get a bot by name
   * @param {string} name
   * @returns {Promise<Bot|null>}
   */
  async getBotByName(name) {
    await this.initialize();
    return this.collection.findOne({ name });
  }

  /**
   * List all bots with optional filters
   * @param {Object} filters
   * @returns {Promise<Bot[]>}
   */
  async listBots(filters = {}) {
    await this.initialize();

    const query = {};

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.platform) {
      query[`platforms.${filters.platform}.enabled`] = true;
    }

    if (filters.avatarId) {
      query.avatarIds = filters.avatarId;
    }

    const bots = await this.collection
      .find(query)
      .sort({ isDefault: -1, createdAt: -1 })
      .toArray();

    return bots;
  }

  /**
   * Get bots with a specific platform enabled
   * @param {'discord'|'x'|'telegram'} platform
   * @returns {Promise<Bot[]>}
   */
  async getBotsWithPlatform(platform) {
    return this.listBots({ platform });
  }

  /**
   * Update a bot
   * @param {string} botId
   * @param {Object} updates
   * @returns {Promise<Bot|null>}
   */
  async updateBot(botId, updates) {
    await this.initialize();

    // Prevent modifying system fields
    delete updates._id;
    delete updates.createdAt;
    delete updates.createdBy;
    delete updates.isDefault;

    updates.updatedAt = new Date();

    const result = await this.collection.findOneAndUpdate(
      { _id: botId },
      { $set: updates },
      { returnDocument: 'after' }
    );

    if (result) {
      this.logger.info(`[BotService] Updated bot: ${botId}`);
    }

    return result;
  }

  /**
   * Update bot status
   * @param {string} botId
   * @param {'running'|'paused'|'error'|'initializing'} status
   * @param {string} [reason]
   */
  async updateBotStatus(botId, status, reason = null) {
    const updates = { status, updatedAt: new Date() };
    if (status === 'running') {
      updates.lastActiveAt = new Date();
    }
    if (reason) {
      updates.statusReason = reason;
    }

    return this.updateBot(botId, updates);
  }

  /**
   * Enable a platform for a bot
   * @param {string} botId
   * @param {'discord'|'x'|'telegram'} platform
   * @param {Object} [platformConfig]
   */
  async enablePlatform(botId, platform, platformConfig = {}) {
    await this.initialize();

    const updates = {
      [`platforms.${platform}.enabled`]: true,
      [`platforms.${platform}`]: {
        enabled: true,
        ...platformConfig,
      },
      updatedAt: new Date(),
    };

    return this.collection.findOneAndUpdate(
      { _id: botId },
      { $set: updates },
      { returnDocument: 'after' }
    );
  }

  /**
   * Disable a platform for a bot
   * @param {string} botId
   * @param {'discord'|'x'|'telegram'} platform
   */
  async disablePlatform(botId, platform) {
    await this.initialize();

    return this.collection.findOneAndUpdate(
      { _id: botId },
      { 
        $set: { 
          [`platforms.${platform}.enabled`]: false,
          updatedAt: new Date(),
        }
      },
      { returnDocument: 'after' }
    );
  }

  /**
   * Assign an avatar to a bot
   * @param {string} botId
   * @param {string} avatarId
   */
  async assignAvatar(botId, avatarId) {
    await this.initialize();

    return this.collection.findOneAndUpdate(
      { _id: botId },
      { 
        $addToSet: { avatarIds: avatarId },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: 'after' }
    );
  }

  /**
   * Unassign an avatar from a bot
   * @param {string} botId
   * @param {string} avatarId
   */
  async unassignAvatar(botId, avatarId) {
    await this.initialize();

    return this.collection.findOneAndUpdate(
      { _id: botId },
      { 
        $pull: { avatarIds: avatarId },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: 'after' }
    );
  }

  /**
   * Delete a bot (not allowed for default bot)
   * @param {string} botId
   * @returns {Promise<boolean>}
   */
  async deleteBot(botId) {
    await this.initialize();

    const bot = await this.getBot(botId);
    if (!bot) {
      return false;
    }

    if (bot.isDefault) {
      throw new Error('Cannot delete the default bot');
    }

    // Clean up bot-scoped secrets
    if (this.secretsService) {
      try {
        const botSecrets = await this.secretsService.listKeys({ botId });
        for (const key of botSecrets) {
          await this.secretsService.delete(key, { botId });
        }
      } catch (error) {
        this.logger.warn(`[BotService] Failed to clean up secrets for bot ${botId}:`, error.message);
      }
    }

    await this.collection.deleteOne({ _id: botId });
    this.logger.info(`[BotService] Deleted bot: ${botId}`);

    return true;
  }

  /**
   * Get bot statistics
   * @param {string} botId
   * @returns {Promise<Object>}
   */
  async getBotStats(botId) {
    await this.initialize();

    const bot = await this.getBot(botId);
    if (!bot) return null;

    const db = await this.databaseService.getDatabase();

    // Count avatars
    const avatarCount = bot.avatarIds?.length || 0;

    // Count messages (if we track by bot)
    let messageCount = 0;
    try {
      messageCount = await db.collection('messages')
        .countDocuments({ botId });
    } catch (_e) {
      // Messages may not have botId field yet
    }

    // Platform-specific stats
    const stats = {
      avatarCount,
      messageCount,
      platforms: {},
    };

    if (bot.platforms.discord?.enabled) {
      stats.platforms.discord = {
        guildCount: bot.platforms.discord.guildIds?.length || 0,
      };
    }

    if (bot.platforms.telegram?.enabled) {
      stats.platforms.telegram = {
        channelCount: bot.platforms.telegram.channelIds?.length || 0,
      };
    }

    return stats;
  }

  /**
   * Record bot activity (updates lastActiveAt)
   * @param {string} botId
   */
  async recordActivity(botId) {
    await this.initialize();

    await this.collection.updateOne(
      { _id: botId },
      { $set: { lastActiveAt: new Date() } }
    );
  }

  /**
   * Get or create the default bot
   * @returns {Promise<Bot>}
   */
  async getDefaultBot() {
    await this.initialize();
    return this._ensureDefaultBot();
  }

  /**
   * Migrate legacy secrets to bot-scoped secrets
   * This is a one-time migration helper
   */
  async migrateLegsecrets() {
    await this.initialize();

    const defaultBot = await this.getDefaultBot();
    const logger = this.logger;

    // These keys should be moved to bot scope if they exist globally
    const platformSecrets = [
      'DISCORD_BOT_TOKEN',
      'TELEGRAM_GLOBAL_BOT_TOKEN',
      'TELEGRAM_GLOBAL_CHANNEL_ID',
    ];

    for (const key of platformSecrets) {
      try {
        const { value, source } = await this.secretsService.getWithSource(key);
        if (value && source === 'global') {
          // Set as bot-scoped for default bot
          await this.secretsService.set(key, value, { botId: defaultBot._id });
          logger.info(`[BotService] Migrated ${key} to bot scope for default bot`);
        }
      } catch (error) {
        logger.warn(`[BotService] Could not migrate ${key}:`, error.message);
      }
    }

    return { migrated: platformSecrets.length };
  }
}
