/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { MongoClient, ObjectId } from 'mongodb';

export class DatabaseService {
  static instance = null;

  constructor({ logger, configService }) {
    if (DatabaseService.instance) {
      return DatabaseService.instance;
    }

    this.logger = logger;
    this.configService = configService;
    this.dbClient = null;
    this.db = null;
    this.connected = false;
    this.reconnectDelay = 5000;
    this.dbName = process.env.MONGO_DB_NAME || 'moonstone';

    DatabaseService.instance = this;
  }

  async connect() {
    if (this.db) {
      return this.db;
    }

  // Note: environment is determined via process.env.NODE_ENV when needed.

    if (!process.env.MONGO_URI) {
      throw new Error('MongoDB URI not provided in environment variables.');
    }

    try {
      this.logger.info('Connecting to MongoDB...');
      this.dbClient = new MongoClient(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 10000,
      });

      await this.dbClient.connect();
      this.db = this.dbClient.db(this.dbName);
      this.connected = true;
      this.logger.info(`Connected to MongoDB: ${this.dbName}`);
      await this.createIndexes();
      return this.db;
    } catch (error) {
      this.connected = false;
      this.logger.error(`MongoDB connection failed: ${error.message}`);

      if (this.dbClient) {
        try {
          await this.dbClient.close();
        } catch (closeError) {
          this.logger.error(`Error closing MongoDB connection: ${closeError.message}`);
        }
      }

      // Set up reconnection with exponential backoff
      const reconnectDelay = Math.min(this.reconnectDelay * 1.5, 30000); // Maximum 30 seconds
      this.logger.info(`Will attempt to reconnect in ${reconnectDelay / 1000} seconds...`);
      setTimeout(() => this.connect(), reconnectDelay);
      this.reconnectDelay = reconnectDelay;
      return null;
    }
  }

  async getMessageById(messageId) {
    if (!this.db) {
      this.logger.warn('Database is not connected. Cannot retrieve message.');
      return null;
    }

    try {
      const messages = this.db.collection('messages');
      return await messages.findOne({ _id: ObjectId.createFromTime(messageId) });
    } catch (error) {
      this.logger.error(`Error retrieving message by ID: ${error.message}`);
      return null;
    }
  }  
  /**
  * Marks a channel as active by updating its last activity timestamp in the database.
  * @param {string} channelId - The ID of the channel.
  * @param {string} guildId - The ID of the guild the channel belongs to.
  */
 async markChannelActive(channelId, guildId) {
  const channelActivityCollection = (await this.getDatabase()).collection('channel_activity');
   await channelActivityCollection.updateOne(
     { _id: channelId },
     { $set: { lastActivityTimestamp: Date.now() }, $setOnInsert: { guildId: guildId } },
     { upsert: true }
   );
 }

    /**
   * Saves the message to the database.
   * @param {Object} message - The Discord message object to save.
   */
    async saveMessage(message) {
      try {
        const db = await this.getDatabase();
        const messagesCollection = db.collection("messages");
      
        // Prepare the message data for insertion
        const attachments = Array.from(message.attachments.values()).map(a => ({
          id: a.id,
          url: a.url,
          proxyURL: a.proxyURL,
          filename: a.name,
          contentType: a.contentType,
          size: a.size,
          height: a.height,
          width: a.width,
        }));
  
        const embeds = message.embeds.map(e => ({
          type: e.type,
          title: e.title,
          description: e.description,
          url: e.url,
          image: e.image ? { url: e.image.url, proxyURL: e.image.proxyURL, height: e.image.height, width: e.image.width } : null,
          thumbnail: e.thumbnail ? { url: e.thumbnail.url, proxyURL: e.thumbnail.proxyURL, height: e.thumbnail.height, width: e.thumbnail.width } : null,
        }));
  
        const messageData = {
          guildId: message.guild.id,
          messageId: message.id,
          channelId: message.channel.id,
          authorId: message.author.id,
          authorUsername: message.author.username,
          author: { id: message.author.id, bot: message.author.bot, username: message.author.username, discriminator: message.author.discriminator, avatar: message.author.avatar },
          content: message.content,
          attachments,
          embeds,
          hasImages: attachments.some(a => a.contentType?.startsWith("image/")) || embeds.some(e => e.image || e.thumbnail),
          // Persist AI-generated image captions/urls if the message object was enriched upstream
          imageDescription: message.imageDescription || null,
          imageDescriptions: Array.isArray(message.imageDescriptions) ? message.imageDescriptions : null,
          imageUrls: Array.isArray(message.imageUrls) ? message.imageUrls : null,
          primaryImageUrl: message.primaryImageUrl || null,
          // Track reply information if this is a reply to another message
          replyToMessageId: message.reference?.messageId || null,
          replyToChannelId: message.reference?.channelId || null,
          replyToGuildId: message.reference?.guildId || null,
          // Track which avatar sent this message (for webhook messages)
          avatarId: message.rati?.avatarId || message.avatarId || null,
          timestamp: message.createdTimestamp,
        };

        // Debug logging for avatarId tracking
        if (message.author.bot || message.webhookId) {
          this.logger.info(`[saveMessage] Bot/webhook message ${messageData.messageId}: avatarId=${messageData.avatarId}, webhookId=${message.webhookId}, rati=${JSON.stringify(message.rati || {})}`);
        }
  
        if (!messageData.messageId || !messageData.channelId) {
          this.logger.error("Missing required message data:", messageData);
          return;
        }
        await this.markChannelActive(message.channel.id, message.guild.id);

        // Insert the message into the database using updateOne with upsert
        // Use $setOnInsert for most fields (only set when creating new document)
        // Use $set for avatarId (update even if message already exists)
        
        // Extract avatarId from messageData to handle separately
        const avatarId = messageData.avatarId;
        const messageDataWithoutAvatarId = { ...messageData };
        delete messageDataWithoutAvatarId.avatarId;
        
        const updateOps = {
          $setOnInsert: messageDataWithoutAvatarId,
        };
        
        // If avatarId is present, always update it (even for existing messages)
        // This handles the race condition where messageCreate fires before we set avatarId
        if (avatarId) {
          updateOps.$set = { avatarId };
        }
        
        const result = await messagesCollection.updateOne(
          { messageId: messageData.messageId },
          updateOps,
          { upsert: true }
        );
        
        // Check if a new document was inserted
        if (result.upsertedCount === 1) {
          this.logger.debug("💾 Message saved to database");
          return true;
        } else if (messageData.avatarId && result.modifiedCount === 1) {
          this.logger.debug(`Message ${messageData.messageId} updated with avatarId`);
          return true;
        } else {
          this.logger.debug(`Message ${messageData.messageId} already exists in the database.`);
          return false;
        }
      } catch (error) {
        this.logger.error(`Error saving message to database: ${error.message}`);
        console.error(error.stack);
      }
    }

  async getRecentRiskyMessagesForUser(userId, limit = 20) {
    try {
      const db = await this.getDatabase();
      if (!db) return [];
      const messagesCollection = db.collection('messages');
      const riskyMessages = await messagesCollection
        .find({
          authorId: userId,
          threatLevel: { $in: ['medium', 'high'] }
        })
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();
      return riskyMessages;
    } catch (error) {
      this.logger.error(`Error fetching recent risky messages for user ${userId}: ${error.message}`);
      return [];
    }
  }

  async getDatabase() {
    return await this.waitForConnection();
  }

  /**
   * Waits for database connection to be established
   * @param {number} maxRetries - Maximum number of retries
   * @param {number} delay - Delay between retries in milliseconds
   * @returns {Promise<Object|null>} - Returns database object or null
   */
  async waitForConnection(maxRetries = 5, delay = 1000) {
    let retries = 0;

    while (retries < maxRetries) {
      await this.connect();
      if (this.connected && this.db) {
        return this.db;
      }

      this.logger.info(`Waiting for database connection... (attempt ${retries + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      retries++;
    }

    this.logger.error(`Failed to establish database connection after ${maxRetries} attempts`);
    return null;
  }

  async createIndexes() {
    const db = await this.getDatabase();
    if (!db) return;

    try {
      // Helper to create an index, tolerant of missing collections
      const safeEnsureIndex = async (collectionName, key, options = {}) => {
        const coll = db.collection(collectionName);
        const keyStr = JSON.stringify(key);
        try {
          // Some drivers throw NamespaceNotFound when listing indexes of a non-existent collection.
          // In that case, proceed to createIndex which will implicitly create the collection.
          let existing = [];
          try {
            existing = await coll.indexes();
          } catch (e) {
            await Promise.all([
              safeEnsureIndex('daily_summons', { timestamp: 1 }, {
                expireAfterSeconds: 30 * 24 * 60 * 60,
                name: 'daily_summons_ttl'
              }),
              safeEnsureIndex('daily_summons', { userId: 1, timestamp: 1 }, {
                name: 'daily_summons_user_day'
              })
            ]);
            const msg = String(e?.message || e);
            if (msg.includes('ns does not exist') || msg.includes('NamespaceNotFound')) {
              existing = [];
            } else {
              throw e;
            }
          }

          const hasEquivalent = Array.isArray(existing) && existing.some(i => JSON.stringify(i.key) === keyStr);
          if (hasEquivalent) {
            this.logger.info(`[indexes] ${collectionName} ${keyStr} already exists; skipping`);
            return;
          }

          await coll.createIndex(key, { background: true, ...options });
        } catch (e) {
          const msg = String(e.message || e);
          if (
            msg.includes('An equivalent index already exists') ||
            msg.includes('Index already exists with a different name') ||
            msg.includes('ns does not exist') ||
            msg.includes('NamespaceNotFound')
          ) {
            // Non-fatal; log and continue.
            this.logger.warn(`[indexes] Non-fatal while ensuring index on ${collectionName} ${keyStr}: ${msg}`);
            return;
          }
          throw e;
        }
      };

      await Promise.all([
        db.collection('messages').createIndexes([
          { key: { "author.username": 1 }, background: true },
          { key: { timestamp: -1 }, background: true },
          { key: { avatarId: 1 }, background: true },
          { key: { messageId: 1 }, unique: true },
          { key: { channelId: 1 }, background: true },
          { key: { channelId: 1, timestamp: -1 }, name: 'messages_channel_timestamp', background: true },
          { key: { replyToMessageId: 1 }, name: 'messages_reply_to', background: true, sparse: true },
          { key: { messageId: 1, avatarId: 1 }, name: 'messages_id_avatar', background: true },
        ]),
        db.collection('agent_events').createIndexes([
          { key: { agent_id: 1, ts: -1 }, name: 'agent_events_agent_ts', background: true },
          { key: { hash: 1 }, name: 'agent_events_hash', unique: true, background: true },
          { key: { type: 1, ts: -1 }, name: 'agent_events_type_ts', background: true }
        ]),
        db.collection('avatars').createIndexes([
          { key: { name: 1, createdAt: -1 }, background: true },
          { key: { model: 1 }, background: true },
          { key: { emoji: 1 }, background: true },
          { key: { emoji: 1, _id: -1 }, name: 'avatars_emoji_id_desc', background: true },
          { key: { 'nft.collection': 1, _id: -1 }, name: 'avatars_nft_collection_id_desc', background: true },
          { key: { collection: 1, _id: -1 }, name: 'avatars_collection_id_desc', background: true },
          { key: { parents: 1 }, background: true },
          { key: { createdAt: -1 }, background: true },
          { key: { channelId: 1 }, background: true },
          { key: { agentId: 1 }, name: 'avatars_agent_id', background: true, sparse: true },
          { key: { name: 'text', description: 'text' }, background: true },
        ]),
        db.collection('dungeon_stats').createIndex(
          { avatarId: 1 },
          { unique: true, background: true }
        ),
        db.collection('narratives').createIndex(
          { avatarId: 1, timestamp: -1 },
          { background: true }
        ),
        db.collection('memories').createIndexes([
          { key: { avatarId: 1, timestamp: -1 }, background: true },
          { key: { avatarId: 1, ts: -1 }, background: true },
        ]),
        db.collection('dungeon_log').createIndexes([
          { key: { timestamp: -1 }, background: true },
          { key: { actor: 1 }, background: true },
          { key: { target: 1 }, background: true },
        ]),
        db.collection('messages').createIndex({ hasImages: 1 }),
        db.collection('messages').createIndex({ imageDescription: 1 }),
        db.collection('x_auth').createIndex({ avatarId: 1 }, { unique: true }),
        db.collection('social_posts').createIndex({ avatarId: 1, timestamp: -1 }),
        // Image analysis cache indexes
        db.collection('image_analysis_cache').createIndexes([
          { key: { urlHash: 1 }, unique: true, name: 'image_cache_urlhash', background: true },
          { key: { url: 1 }, name: 'image_cache_url', background: true },
          { key: { analyzedAt: -1 }, name: 'image_cache_analyzed', background: true },
          { key: { status: 1 }, name: 'image_cache_status', background: true },
        ]),
        // Avatar location memory indexes
        db.collection('avatar_location_memory').createIndexes([
          { key: { avatarId: 1, lastVisited: -1 }, name: 'memory_avatar_time', background: true },
          { key: { avatarId: 1, channelId: 1 }, name: 'memory_avatar_channel', background: true },
          { key: { lastVisited: 1 }, expireAfterSeconds: 30 * 24 * 60 * 60, name: 'memory_ttl', background: true },
        ]),
        // Presence and scheduling indexes
        db.collection('presence').createIndexes([
          { key: { channelId: 1, avatarId: 1 }, unique: true, name: 'presence_channel_avatar', background: true },
          { key: { channelId: 1, lastTurnAt: -1 }, name: 'presence_lastTurn', background: true },
          { key: { updatedAt: 1 }, name: 'presence_updatedAt', background: true },
        ]),
        db.collection('turn_leases').createIndexes([
          { key: { channelId: 1, avatarId: 1, tickId: 1 }, unique: true, name: 'leases_unique', background: true },
          { key: { leaseExpiresAt: 1 }, expireAfterSeconds: 3600, name: 'leases_ttl', background: true },
        ]),
        db.collection('channel_ticks').createIndexes([
          { key: { channelId: 1 }, unique: true, name: 'ticks_channel', background: true },
          { key: { lastTickAt: -1 }, name: 'ticks_lastTick', background: true },
        ]),
        // Planner collections
        db.collection('thread_states').createIndexes([
          { key: { channelId: 1 }, unique: true, name: 'thread_states_channel', background: true },
          { key: { lastActivityTs: -1 }, name: 'thread_states_activity', background: true },
          { key: { updatedAt: -1 }, name: 'thread_states_updated', background: true },
        ]),
        db.collection('planner_assignments').createIndexes([
          { key: { status: 1, type: 1, priority: -1, createdAt: 1 }, name: 'assign_status_type_priority', background: true },
          { key: { channelId: 1, status: 1 }, name: 'assign_channel_status', background: true },
          { key: { updatedAt: 1 }, name: 'assign_updated', background: true },
        ]),
        db.collection('thread_summaries').createIndexes([
          { key: { channelId: 1 }, unique: true, name: 'thread_summary_channel', background: true },
          { key: { updatedAt: -1 }, name: 'thread_summary_updated', background: true },
        ]),
        // Story system collections
        db.collection('story_arcs').createIndexes([
          { key: { status: 1, lastProgressedAt: -1 }, name: 'story_arcs_status_progress', background: true },
          { key: { status: 1, startedAt: -1 }, name: 'story_arcs_status_start', background: true },
          { key: { 'characters.avatarId': 1 }, name: 'story_arcs_characters', background: true },
          { key: { theme: 1, startedAt: -1 }, name: 'story_arcs_theme', background: true },
          { key: { createdAt: -1 }, name: 'story_arcs_created', background: true },
        ]),
        db.collection('story_character_states').createIndexes([
          { key: { avatarId: 1 }, unique: true, name: 'story_char_avatar', background: true },
          { key: { currentArc: 1 }, name: 'story_char_arc', background: true },
          { key: { 'storyStats.lastFeaturedAt': -1 }, name: 'story_char_featured', background: true },
          { key: { updatedAt: -1 }, name: 'story_char_updated', background: true },
        ]),
        db.collection('story_memory_summaries').createIndexes([
          { key: { type: 1, referenceId: 1 }, name: 'story_mem_type_ref', background: true },
          { key: { significance: -1, createdAt: -1 }, name: 'story_mem_sig_created', background: true },
          { key: { lastUsed: -1 }, name: 'story_mem_used', background: true },
        ]),
        (async () => {
          await safeEnsureIndex('daily_summons', { timestamp: 1 }, {
            expireAfterSeconds: 30 * 24 * 60 * 60,
            name: 'daily_summons_ttl'
          });
        })(),
        (async () => {
          await safeEnsureIndex('daily_summons', { userId: 1, timestamp: 1 }, {
            name: 'daily_summons_user_day'
          });
        })(),
  // Wallet links and claims (prioritization support) — safe creation to avoid name conflicts
  (async () => { await safeEnsureIndex('discord_wallet_links', { discordId: 1 }); })(),
  (async () => { await safeEnsureIndex('discord_wallet_links', { address: 1 }); })(),
  (async () => { await safeEnsureIndex('avatar_claims', { walletAddress: 1 }); })(),
  (async () => { await safeEnsureIndex('avatar_claims', { avatarId: 1 }); })(),
      ]);
      // Conditionally add TTL for presence.updatedAt only if no existing index on updatedAt
      try {
        const presence = db.collection('presence');
        const idx = await presence.indexes();
        const hasUpdatedIndex = idx.some(i => i.key && i.key.updatedAt === 1);
        if (!hasUpdatedIndex) {
          await presence.createIndex({ updatedAt: 1 }, { expireAfterSeconds: 14 * 24 * 60 * 60, name: 'presence_ttl', background: true });
        } else {
          this.logger.info('Presence updatedAt index exists; skipping TTL index to avoid conflict.');
        }
      } catch (e) {
        this.logger.warn(`presence TTL index skipped: ${e.message}`);
      }
      this.logger.info('Database indexes created successfully');
    } catch (error) {
      const msg = String(error.message || error);
      this.logger.error(`Error creating indexes: ${msg}`);
      if (msg.includes('An equivalent index already exists') || msg.includes('Index already exists with a different name')) {
        this.logger.warn('Index exists (possibly with a different name); proceeding without failure.');
        return; // degrade to warning to avoid blocking startup
      }
      throw error;
    }
  }

  async close() {
    if (this.dbClient) {
      await this.dbClient.close();
      this.connected = false;
      this.db = null;
      this.logger.info('MongoDB connection closed');
    }
  }
}
