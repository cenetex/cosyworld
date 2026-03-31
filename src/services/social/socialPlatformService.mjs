/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { EventEmitter } from 'events';
import { TelegramProvider } from './providers/telegramProvider.mjs';
import { MoltbookProvider } from './providers/moltbookProvider.mjs';
import { XProvider } from './providers/xProvider.mjs';
import { encrypt, decrypt } from '../../utils/encryption.mjs';

/**
 * SocialPlatformService
 * 
 * Unified service for managing social platform integrations (Telegram, X, Discord).
 * Orchestrates per-avatar connections and delegates platform-specific logic to providers.
 */
export class SocialPlatformService extends EventEmitter {
  constructor({
    logger,
    databaseService,
    configService,
    secretsService,
    aiService,
    // Legacy services to be migrated/wrapped
    telegramService,
    xService,
    discordService
  }) {
    super();
    this.logger = logger;
    this.databaseService = databaseService;
    this.config = configService;
    this.secrets = secretsService;
    this.ai = aiService;
    
    // Legacy services
    this.telegramService = telegramService;
    this.xService = xService;
    this.discordService = discordService;

    this.providers = new Map();
    this._connectionsCollection = null;
    this._connectionsCollectionPromise = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    
    this.logger.info('Initializing SocialPlatformService...');
    
    // Initialize providers
    this.registerProvider('telegram', new TelegramProvider(this));
    this.registerProvider('moltbook', new MoltbookProvider(this));
    this.registerProvider('x', new XProvider(this));
    
    await Promise.all([
      this.getProvider('telegram').initialize(),
      this.getProvider('moltbook').initialize(),
      this.getProvider('x').initialize()
    ]);

    await this._rehydrateConnections();
    
    this.initialized = true;
    this.logger.info('SocialPlatformService initialized');
  }

  /**
   * Register a platform provider
   * @param {string} platformName 
   * @param {object} providerInstance 
   */
  registerProvider(platformName, providerInstance) {
    this.providers.set(platformName.toLowerCase(), providerInstance);
    this.logger.info(`Registered provider for platform: ${platformName}`);
  }

  /**
   * Get a provider by name
   * @param {string} platformName 
   * @returns {object|null}
   */
  getProvider(platformName) {
    return this.providers.get(platformName.toLowerCase()) || null;
  }

  async connectAvatar(platform, avatarId, credentials = {}, options = {}) {
    const normalizedPlatform = this._normalizePlatform(platform);
    const provider = this._ensureProvider(normalizedPlatform);
    const collection = await this._getConnectionsCollection();

    if (!avatarId) {
      throw new Error('avatarId is required');
    }

    const serializedCredentials = this._serializeCredentials(credentials);
    const now = new Date();
    const existing = await collection.findOne({ platform: normalizedPlatform, avatarId });

    if (existing) {
      // Stop existing session before replacing credentials
      try {
        await provider.disconnectAvatar(avatarId);
      } catch (err) {
        this.logger.warn(`[SocialPlatformService] Failed to stop existing ${normalizedPlatform} session for avatar ${avatarId}: ${err.message}`);
      }
    }

    let providerResult = {};
    try {
      providerResult = await provider.connectAvatar(avatarId, credentials, options) || {};
    } catch (error) {
      this.logger.error(`[SocialPlatformService] Provider connect failed for ${normalizedPlatform}:${avatarId}:`, error);
      await collection.updateOne(
        { platform: normalizedPlatform, avatarId },
        {
          $set: {
            status: 'error',
            lastError: error.message,
            updatedAt: now,
            channelId: options.channelId || existing?.channelId || null,
          },
          $setOnInsert: { createdAt: now }
        },
        { upsert: true }
      );
      throw error;
    }

    const metadataFromOptions = options.metadata || null;
    const metadata = {
      ...(existing?.metadata || {}),
      ...(metadataFromOptions || {}),
      ...(providerResult.metadata || {})
    };

    metadata.username = providerResult.username
      ?? metadataFromOptions?.username
      ?? existing?.metadata?.username
      ?? metadata.username
      ?? null;
    metadata.externalId = providerResult.id
      ?? providerResult.externalId
      ?? metadataFromOptions?.externalId
      ?? existing?.metadata?.externalId
      ?? metadata.externalId
      ?? null;

    const update = {
      status: 'connected',
      metadata,
      credentials: serializedCredentials,
      updatedAt: now,
      lastConnectedAt: now,
      lastError: null,
      channelId: options.channelId ?? providerResult.channelId ?? existing?.channelId ?? null,
    };

    await collection.updateOne(
      { platform: normalizedPlatform, avatarId },
      {
        $set: update,
        $setOnInsert: { createdAt: now }
      },
      { upsert: true }
    );

    this.emit('connected', { platform: normalizedPlatform, avatarId, metadata: update.metadata });

    return {
      success: true,
      platform: normalizedPlatform,
      avatarId,
      metadata: update.metadata,
      channelId: update.channelId
    };
  }

  async disconnectAvatar(platform, avatarId, reason = 'manual') {
    const normalizedPlatform = this._normalizePlatform(platform);
    const provider = this.getProvider(normalizedPlatform);
    const collection = await this._getConnectionsCollection();
    const now = new Date();

    const existing = await collection.findOne({ platform: normalizedPlatform, avatarId });
    if (!existing) {
      return { success: true, message: 'No connection to disconnect' };
    }

    if (provider) {
      try {
        await provider.disconnectAvatar(avatarId, { reason });
      } catch (error) {
        this.logger.warn(`[SocialPlatformService] Failed to disconnect provider ${normalizedPlatform}:${avatarId}: ${error.message}`);
      }
    }

    await collection.updateOne(
      { platform: normalizedPlatform, avatarId },
      {
        $set: {
          status: 'disconnected',
          updatedAt: now,
          disconnectedAt: now,
          lastError: null,
        }
      }
    );

    this.emit('disconnected', { platform: normalizedPlatform, avatarId, reason });

    return { success: true };
  }

  async isAvatarConnected(platform, avatarId) {
    const connection = await this.getConnection(platform, avatarId);
    return Boolean(connection && connection.status === 'connected');
  }

  async getConnection(platform, avatarId) {
    const normalizedPlatform = this._normalizePlatform(platform);
    const collection = await this._getConnectionsCollection();
    return collection.findOne({ platform: normalizedPlatform, avatarId });
  }

  async listConnectionsForAvatar(avatarId) {
    const collection = await this._getConnectionsCollection();
    return collection.find({ avatarId }).toArray();
  }

  async post(platform, avatarId, content, options = {}) {
    const normalizedPlatform = this._normalizePlatform(platform);
    const provider = this._ensureProvider(normalizedPlatform);
    return provider.post(avatarId, content, options);
  }

  async updateStoredCredentials(platform, avatarId, credentials = null) {
    const normalizedPlatform = this._normalizePlatform(platform);
    const collection = await this._getConnectionsCollection();
    const serialized = this._serializeCredentials(credentials);
    const update = {
      $set: {
        updatedAt: new Date()
      }
    };

    if (serialized) {
      update.$set.credentials = serialized;
      update.$set.lastCredentialsRefreshedAt = new Date();
    } else {
      update.$unset = { credentials: '', lastCredentialsRefreshedAt: '' };
    }

    const options = serialized ? { upsert: true } : {};
    await collection.updateOne({ platform: normalizedPlatform, avatarId }, update, options);
  }

  async _rehydrateConnections() {
    try {
      const collection = await this._getConnectionsCollection();
      const activeConnections = await collection.find({ status: 'connected' }).toArray();
      if (!activeConnections.length) {
        return;
      }

      this.logger.info(`[SocialPlatformService] Rehydrating ${activeConnections.length} platform connection(s)`);
      for (const connection of activeConnections) {
        const provider = this.getProvider(connection.platform);
        if (!provider) {
          this.logger.warn(`[SocialPlatformService] No provider registered for platform ${connection.platform}, skipping rehydrate`);
          continue;
        }

        try {
          const creds = this._deserializeCredentials(connection.credentials);
          await provider.connectAvatar(connection.avatarId, creds, {
            channelId: connection.channelId,
            metadata: connection.metadata,
            rehydrate: true,
          });
        } catch (error) {
          this.logger.warn(`[SocialPlatformService] Failed to rehydrate ${connection.platform}:${connection.avatarId}: ${error.message}`);
          await collection.updateOne(
            { _id: connection._id },
            {
              $set: {
                status: 'error',
                lastError: error.message,
                updatedAt: new Date()
              }
            }
          );
        }
      }
    } catch (error) {
      this.logger.error('[SocialPlatformService] Rehydrate failed:', error);
    }
  }

  async _getConnectionsCollection() {
    if (this._connectionsCollection) {
      return this._connectionsCollection;
    }

    if (!this._connectionsCollectionPromise) {
      this._connectionsCollectionPromise = (async () => {
        const db = await this.databaseService.getDatabase();
        const collection = db.collection('social_platform_connections');
        await Promise.all([
          collection.createIndex({ avatarId: 1, platform: 1 }, { unique: true }),
          collection.createIndex({ platform: 1, status: 1 }),
        ]);
        return collection;
      })();
    }

    this._connectionsCollection = await this._connectionsCollectionPromise;
    return this._connectionsCollection;
  }

  _normalizePlatform(platform) {
    if (!platform || typeof platform !== 'string') {
      throw new Error('platform is required');
    }
    return platform.toLowerCase();
  }

  _ensureProvider(platform) {
    const provider = this.getProvider(platform);
    if (!provider) {
      throw new Error(`No provider registered for platform ${platform}`);
    }
    return provider;
  }

  _serializeCredentials(credentials = {}) {
    const safeCredentials = credentials && Object.keys(credentials).length ? credentials : null;
    if (!safeCredentials) return null;
    try {
      return {
        cipherText: encrypt(JSON.stringify(safeCredentials)),
        updatedAt: new Date()
      };
    } catch (error) {
      this.logger.error('[SocialPlatformService] Failed to encrypt credentials:', error);
      throw error;
    }
  }

  _deserializeCredentials(serialized) {
    if (!serialized?.cipherText) return {};
    try {
      const json = decrypt(serialized.cipherText);
      return JSON.parse(json);
    } catch (error) {
      this.logger.error('[SocialPlatformService] Failed to decrypt credentials:', error);
      return {};
    }
  }
}
