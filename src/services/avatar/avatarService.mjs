import { resolveAdminAvatarId } from '../social/adminAvatarResolver.mjs';
import { formatAddress, formatLargeNumber } from '../../utils/walletFormatters.mjs';
/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

// AvatarService.mjs – fully ESM, generic‑filter version
// -------------------------------------------------------

/**
 * @typedef {Object} Avatar
 * @property {import('mongodb').ObjectId} _id - Unique avatar ID
 * @property {string} name - Avatar name (2-50 characters)
 * @property {string} emoji - Avatar emoji (1-10 characters)
 * @property {string} description - Avatar description
 * @property {string} personality - Avatar personality
 * @property {string|null} imageUrl - Full S3 URL or null for partial avatars
 * @property {string} model - AI model used ('auto', 'partial', etc)
 * @property {string} channelId - Discord channel ID
 * @property {string} summoner - Format: "user:discordId" | "wallet:address" | "system"
 * @property {number} lives - Remaining lives (default: 3)
 * @property {'alive'|'dead'} status - Avatar status
 * @property {Date} createdAt - Creation timestamp
 * @property {Date} updatedAt - Last update timestamp
 * @property {string} [guildId] - Discord guild ID (user avatars only)
 * @property {AvatarStats} [stats] - RPG stats (user avatars only)
 * @property {AvatarThought[]} [thoughts] - Recent thoughts (user avatars only)
 * @property {string} [dynamicPersonality] - Evolving personality (user avatars only)
 * @property {number} [messageCount] - Activity count (user avatars only)
 * @property {string} [arweave_prompt] - Decentralized prompt storage (user avatars only)
 * @property {Date} [lastBredAt] - Last breeding timestamp (user avatars only)
 * @property {string} [walletAddress] - Solana public key (wallet avatars only)
 * @property {Object.<string, TokenBalance>} [tokenBalances] - Token balances (wallet avatars only)
 * @property {Object.<string, number>} [nftBalances] - NFT counts by collection (wallet avatars only)
 * @property {WalletContext} [walletContext] - First-seen metadata (wallet avatars only)
 * @property {boolean} [isPartial] - True if no image generated (wallet avatars only)
 * @property {Date} [lastActivityAt] - Last transaction timestamp (wallet avatars only)
 * @property {number} [activityCount] - Total transaction count (wallet avatars only)
 * @property {Object} [webContext] - Latest web search context (history, opened summaries)
 * @property {boolean} [_existing] - Flag indicating avatar already existed (internal use)
 */

/**
 * @typedef {Object} AvatarStats
 * @property {number} strength - Strength stat
 * @property {number} dexterity - Dexterity stat
 * @property {number} constitution - Constitution stat
 * @property {number} intelligence - Intelligence stat
 * @property {number} wisdom - Wisdom stat
 * @property {number} charisma - Charisma stat
 */

/**
 * @typedef {Object} AvatarThought
 * @property {string} content - Thought content
 * @property {number} timestamp - Unix timestamp
 * @property {string} guildName - Guild where thought occurred
 */

/**
 * @typedef {Object} TokenBalance
 * @property {number} balance - Token balance
 * @property {number|null} usdValue - USD value of balance
 * @property {Date} lastUpdated - Last update timestamp
 */

/**
 * @typedef {Object} WalletContext
 * @property {string|null} firstSeenToken - Token symbol first seen
 * @property {number|null} firstSeenAmount - Amount in first transaction
 * @property {number|null} firstSeenUsd - USD value at creation
 * @property {number} creationBalance - Balance at creation time
 */

/**
 * @typedef {Object} AvatarCreateOptions
 * @property {string} prompt - Prompt for avatar generation
 * @property {string} summoner - Who/what summoned this avatar
 * @property {string} channelId - Discord channel ID
 * @property {string} [guildId] - Discord guild ID
 * @property {string} [imageUrl] - Override image URL (skip generation)
 */

/**
 * @typedef {Object} WalletAvatarContext
 * @property {string} tokenSymbol - Token symbol (e.g., 'BONK', 'SOL')
 * @property {string} tokenAddress - Token mint address
 * @property {number} amount - Transaction amount
 * @property {number} [usdValue] - USD value of transaction
 * @property {number} currentBalance - Current token balance
 * @property {number} [orbNftCount] - Number of Orb NFTs owned
 * @property {string} [discordChannelId] - Discord channel for activation
 * @property {string} [guildId] - Discord guild ID
 */

import process from 'process';
import eventBus from '../../utils/eventBus.mjs';
import Fuse from 'fuse.js';
import { ObjectId } from 'mongodb';
import { toObjectId } from '../../utils/toObjectId.mjs';
import { buildAvatarQuery } from './helpers/buildAvatarQuery.js';

export class AvatarService {
  constructor({
    databaseService,
    configService,
    getMapService,
    aiService,
    schedulingService,
    statService,
    schemaService,
    logger,
    walletInsights,
  }) {
    this.databaseService = databaseService;
    this.configService = configService;
    // late‑bound to avoid cyclic deps
    this.getMapService = getMapService;
    this.aiService = aiService;
    this.schedulingService = schedulingService;
    this.statService = statService;
    this.schemaService = schemaService;
    this.logger = logger;
        this.walletInsights = walletInsights;

    // in‑memory helpers
    this.channelAvatars = new Map(); // channelId → Set<avatarId>
    this.avatarActivityCount = new Map(); // avatarId  → integer

    // collection aliases
    this.IMAGE_URL_COLLECTION = 'image_urls';
    this.AVATARS_COLLECTION = 'avatars';

    this.prompts = null;
    this.avatarCache = [];
  }

  /* -------------------------------------------------- */
  /*  DB INITIALISATION                                 */
  /* -------------------------------------------------- */
  async initializeDatabase() {
    this.db = await this.databaseService.getDatabase();
    this.avatarsCollection = this.db.collection(this.AVATARS_COLLECTION);
    this.messagesCollection = this.db.collection('messages');
    this.channelsCollection = this.db.collection('channels');

    await Promise.all([
      // Existing indexes
      this.avatarsCollection.createIndex({ name: 1 }),
      this.avatarsCollection.createIndex({ channelId: 1 }),
      this.avatarsCollection.createIndex({ createdAt: -1 }),
      this.avatarsCollection.createIndex({ messageCount: -1 }),
      
      // CRITICAL: Wallet avatar indexes
      this.avatarsCollection.createIndex({ walletAddress: 1 }, { sparse: true }),
      this.avatarsCollection.createIndex({ summoner: 1 }),
      this.avatarsCollection.createIndex({ lastActivityAt: -1 }, { sparse: true }),
  this.avatarsCollection.createIndex({ 'tokenBalances.$**': 1 }, { sparse: true }),
      
      // Compound indexes for common queries
      this.avatarsCollection.createIndex({ status: 1, walletAddress: 1 }, { sparse: true }),
      this.avatarsCollection.createIndex({ status: 1, name: 1 }),
      this.avatarsCollection.createIndex({ status: 1, channelId: 1 }),
      
      // Other collections
      this.messagesCollection.createIndex({ timestamp: 1 }),
      this.channelsCollection.createIndex({ lastActive: 1 }),
    ]);

    this.logger.info('AvatarService database setup completed with wallet avatar indexes.');
  }

  /* -------------------------------------------------- */
  /*  INTERNAL HELPERS                                   */
  /* -------------------------------------------------- */

  /**
   * Compatibility shim: translates the old discrete filter args
   * (includeStatus, emoji, …) into a `filters` object.
   */
  _legacyToFilters({ includeStatus = 'alive', emoji, channelId, guildId } = {}) {
    const filters = {};
    if (includeStatus === 'alive') filters.status = { $ne: 'dead' };
    else if (includeStatus === 'dead') filters.status = 'dead';
    if (emoji) filters.emoji = emoji;
    if (channelId) filters.channelId = channelId;
    if (guildId) filters.guildId = guildId;
    return filters;
  }

  /* -------------------------------------------------- */
  /*  GENERIC DB QUERIES                                */
  /* -------------------------------------------------- */

  async _db() {
    return this.db || (this.db = await this.databaseService.getDatabase());
  }

  /* -------------------------------------------------- */
  /*  BULK LOOK‑UP                                       */
  /* -------------------------------------------------- */

  async getAvatarsByIds(ids = [], { filters = {}, limit = 100 } = {}) {
    const db = await this._db();
    const _ids = ids.map(id => (typeof id === 'string' ? new ObjectId(id) : id));
    const query = { ...buildAvatarQuery(filters), _id: { $in: _ids } };
    return db.collection(this.AVATARS_COLLECTION).find(query).limit(limit).toArray();
  }

  /* -------------------------------------------------- */
  /*  STATS                                              */
  /* -------------------------------------------------- */

  async getAvatarStats(avatarId) {
    const db = await this._db();
    const objectId = toObjectId(avatarId);
    const stats = await db.collection('dungeon_stats').findOne({ avatarId: objectId });
    return (
      stats || { hp: 100, attack: 10, defense: 5, avatarId: objectId }
    );
  }

  async updateAvatarStats(avatar, stats) {
    const db = await this._db();
    stats.avatarId = avatar._id;
    await db.collection('dungeon_stats').updateOne(
      { avatarId: avatar._id },
      { $set: stats },
      { upsert: true }
    );
    this.logger.debug(`Updated stats for avatar ${avatar._id} – ${avatar.name}`);
  }

  /* -------------------------------------------------- */
  /*  AVATAR INITIALISATION                              */
  /* -------------------------------------------------- */

  async initializeAvatar(avatar, locationId) {
    const defaultStats = await this.getOrCreateStats(avatar);
    await this.updateAvatarStats(avatar, avatar.stats || defaultStats);
    if (locationId)
      await this.getMapService().updateAvatarPosition(avatar, locationId);
    this.logger.info(`Initialized avatar ${avatar._id}${locationId ? ' @' + locationId : ''}`);
    await this.updateAvatar(avatar);
    return avatar;
  }

  async getOrCreateStats(avatar) {
    let stats = avatar.stats || (await this.getAvatarStats(avatar._id));
    if (!stats || !this.statService.constructor.validateStats(stats)) {
      stats = this.statService.generateStatsFromDate(avatar?.createdAt || new Date());
      await this.updateAvatarStats(avatar, stats);
      avatar.stats = stats;
      await this.updateAvatar(avatar);
    }
    return stats;
  }

  /* -------------------------------------------------- */
  /*  ACTIVE / CHANNEL                                   */
  /* -------------------------------------------------- */

  async getActiveAvatars({ filters = {}, limit = 100 } = {}) {
    const avatars = await this.getAllAvatars({ filters, limit });
    return avatars
      .filter(a => a.status !== 'dead' && a.active !== false)
      .map(a => ({ ...a, id: a._id, active: true }));
  }

  async getAvatarsInChannel(channelId, guildId = null) {
    const { avatars } = await this.getMapService().getLocationAndAvatars(channelId);
    if (!guildId) return avatars;
  
    const guildConfig = await this.configService.getGuildConfig(guildId);
  
    // Apply avatar tribe restrictions:
    // - mode === 'permit': permit all EXCEPT listed emojis (blocklist)
    // - mode === 'forbid': forbid all EXCEPT listed emojis (allowlist)
    const restrictions = guildConfig.avatarTribeRestrictions || {};
    const override = restrictions.channels?.[channelId];
    const mode = override?.mode || restrictions.default?.mode || 'permit';
    const exceptions = override?.emojis || restrictions.default?.emojis || [];

    let filtered = avatars.filter(av => av.status !== 'dead' && av.active !== false);
    if (mode === 'permit') {
      // Block the listed emojis when in permit mode
      filtered = exceptions.length
        ? filtered.filter(av => !exceptions.includes(av.emoji))
        : filtered;
    } else {
      // Allow only listed emojis when in forbid mode
      filtered = exceptions.length
        ? filtered.filter(av => exceptions.includes(av.emoji))
        : [];
    }

    // Limit to MAX_ACTIVE_AVATARS_PER_CHANNEL active avatars
    // Return only avatars marked as "active" in the channel presence
    const activeAvatars = await this.getActiveAvatarsInChannel(channelId, filtered);
    return activeAvatars;
  }

  /**
   * Get the active avatars in a channel (limited to MAX_ACTIVE_AVATARS_PER_CHANNEL)
   * Uses channel_avatar_presence collection to track which avatars are currently active
   * @param {string} channelId - Channel ID
   * @param {Array} allAvatars - All avatars in the channel
   * @returns {Promise<Array>} Active avatars (max 8)
   */
  async getActiveAvatarsInChannel(channelId, allAvatars) {
    try {
      const MAX_ACTIVE = Number(process.env.MAX_ACTIVE_AVATARS_PER_CHANNEL || 8);
      
      const db = await this._db();
      const presenceCol = db.collection('channel_avatar_presence');
      
      // Get active avatar IDs for this channel
      const activePresence = await presenceCol
        .find({ channelId, isActive: true })
        .sort({ lastActivityAt: -1 }) // Most recently active first
        .limit(MAX_ACTIVE)
        .toArray();
      
      const activeIds = new Set(activePresence.map(p => String(p.avatarId)));
      
      // Filter avatars to only those marked as active
      const activeAvatars = allAvatars.filter(av => activeIds.has(String(av._id)));
      
      // If we have fewer active avatars than available, auto-activate up to MAX_ACTIVE
      if (activeAvatars.length < Math.min(MAX_ACTIVE, allAvatars.length)) {
        const inactiveAvatars = allAvatars.filter(av => !activeIds.has(String(av._id)));
        const toActivate = Math.min(MAX_ACTIVE - activeAvatars.length, inactiveAvatars.length);
        
        for (let i = 0; i < toActivate; i++) {
          const avatar = inactiveAvatars[i];
          await this.activateAvatarInChannel(channelId, String(avatar._id));
          activeAvatars.push(avatar);
        }
      }
      
      return activeAvatars;
    } catch (err) {
      this.logger.error(`Failed to get active avatars in channel – ${err.message}`);
      // Fallback: return first MAX_ACTIVE avatars
      const MAX_ACTIVE = Number(process.env.MAX_ACTIVE_AVATARS_PER_CHANNEL || 8);
      return allAvatars.slice(0, MAX_ACTIVE);
    }
  }

  /**
   * Activate an avatar in a channel, deactivating the stalest one if at capacity
   * @param {string} channelId - Channel ID
   * @param {string} avatarId - Avatar ID to activate
   */
  async activateAvatarInChannel(channelId, avatarId) {
    try {
      const MAX_ACTIVE = Number(process.env.MAX_ACTIVE_AVATARS_PER_CHANNEL || 8);
      
      const db = await this._db();
      const presenceCol = db.collection('channel_avatar_presence');
      
      // Check if already active
      const existing = await presenceCol.findOne({ channelId, avatarId });
      if (existing?.isActive) {
        // Just update activity timestamp
        await presenceCol.updateOne(
          { channelId, avatarId },
          { $set: { lastActivityAt: new Date() } }
        );
        return;
      }
      
      // Count current active avatars
      const activeCount = await presenceCol.countDocuments({ channelId, isActive: true });
      
      // If at capacity, deactivate the stalest avatar
      if (activeCount >= MAX_ACTIVE) {
        const stalest = await presenceCol
          .find({ channelId, isActive: true })
          .sort({ lastActivityAt: 1 }) // Oldest first
          .limit(1)
          .toArray();
        
        if (stalest.length > 0) {
          await presenceCol.updateOne(
            { _id: stalest[0]._id },
            { $set: { isActive: false, deactivatedAt: new Date() } }
          );
          this.logger.info(`[AvatarService] Deactivated stalest avatar ${stalest[0].avatarId} in channel ${channelId}`);
        }
      }
      
      // Activate the new avatar
      await presenceCol.updateOne(
        { channelId, avatarId },
        { 
          $set: { 
            isActive: true, 
            lastActivityAt: new Date(),
            activatedAt: new Date()
          },
          $setOnInsert: { createdAt: new Date() }
        },
        { upsert: true }
      );
      
      this.logger.info(`[AvatarService] Activated avatar ${avatarId} in channel ${channelId}`);
    } catch (err) {
      this.logger.error(`Failed to activate avatar in channel – ${err.message}`);
    }
  }

  /**
   * Update activity timestamp for an avatar in a channel
   * Called when an avatar speaks or is mentioned
   * @param {string} channelId - Channel ID
   * @param {string} avatarId - Avatar ID
   */
  async updateAvatarActivity(channelId, avatarId) {
    try {
      const db = await this._db();
      const presenceCol = db.collection('channel_avatar_presence');
      const avatarsCol = db.collection(this.AVATARS_COLLECTION);
      
      const now = new Date();
      
      // Update channel presence
      await presenceCol.updateOne(
        { channelId, avatarId },
        { 
          $set: { lastActivityAt: now },
          $setOnInsert: { 
            isActive: true,
            createdAt: now,
            activatedAt: now
          }
        },
        { upsert: true }
      );
      
      // Update avatar's lastActiveAt timestamp
      await avatarsCol.updateOne(
        { _id: new ObjectId(avatarId) },
        { $set: { lastActiveAt: now } }
      );
    } catch (err) {
      this.logger.warn(`Failed to update avatar activity – ${err.message}`);
    }
  }

  /* -------------------------------------------------- */
  /*  CHANNEL AVATAR MANAGEMENT                          */
  /* -------------------------------------------------- */

  async manageChannelAvatars(channelId, newAvatarId) {
    let avatars = this.channelAvatars.get(channelId) || new Set();
    if (newAvatarId && avatars.size >= 8) {
      const leastActive = [...avatars].reduce((min, id) => {
        const count = this.avatarActivityCount.get(id) || 0;
        return count < (this.avatarActivityCount.get(min) || 0) ? id : min;
      });
      avatars.delete(leastActive);
    }
    if (newAvatarId) {
      avatars.add(newAvatarId);
      this.avatarActivityCount.set(
        newAvatarId,
        (this.avatarActivityCount.get(newAvatarId) || 0) + 1
      );
    }
    this.channelAvatars.set(channelId, avatars);
    return avatars;
  }

  /* -------------------------------------------------- */
  /*  SIMPLE GETTERS                                     */
  /* -------------------------------------------------- */

  async getAvatars(avatarIds, { filters = {} } = {}) {
    try {
      const db = await this._db();
      const _ids = avatarIds.map(id => (typeof id === 'string' ? new ObjectId(id) : id));
      const query = { ...buildAvatarQuery(filters), _id: { $in: _ids } };
      return db.collection(this.AVATARS_COLLECTION).find(query).toArray();
    } catch (err) {
      this.logger.error(`Failed to fetch avatars – ${err.message}`);
      return [];
    }
  }

  /* -------------------------------------------------- */
  /*  MENTION PARSING                                    */
  /* -------------------------------------------------- */

  extractMentionedAvatars(content, avatars) {
    const mentioned = new Set();
    if (!content || !Array.isArray(avatars)) return mentioned;

    // exact match / emoji first
    for (const av of avatars) {
      if (!av?._id || !av.name) continue;
      const nameMatch = content.toLowerCase().includes(av.name.toLowerCase());
      const emojiMatch = av.emoji && content.includes(av.emoji);
      if (nameMatch || emojiMatch) mentioned.add(av);
    }

    // fuzzy on remaining
    const fuse = new Fuse(avatars.filter(a => !mentioned.has(a)), {
      keys: ['name'], threshold: 0.4
    });
    fuse.search(content).forEach(r => {
      if (r.score < 0.5) mentioned.add(r.item);
    });

    return mentioned;
  }

  /**
   * Fetch all verified wallet addresses linked to a Discord user.
   * Uses the discord_wallet_links collection (created by the wallet linking flow).
   * @param {string} discordId
   * @returns {Promise<string[]>}
   */
  async getLinkedWalletsByDiscordId(discordId) {
    try {
      if (!discordId) return [];
      const db = await this._db();
      const links = await db.collection('discord_wallet_links')
        .find({ discordId: String(discordId) })
        .project({ address: 1 })
        .toArray();
      return links.map(l => String(l.address)).filter(Boolean);
    } catch (err) {
      this.logger?.warn?.(`getLinkedWalletsByDiscordId failed: ${err?.message}`);
      return [];
    }
  }

  /**
   * Get a Set of avatarId strings owned by the provided wallet addresses.
   * Sources: avatar_claims (primary). Optionally merges x_auth if present.
   * @param {string[]} walletAddresses
   * @returns {Promise<Set<string>>}
   */
  async getOwnedAvatarIdsByWallets(walletAddresses = []) {
    const owned = new Set();
    try {
      const addId = (id) => { try { if (id) owned.add(String(id)); } catch {} };
      const db = await this._db();
      if (walletAddresses.length) {
        // avatar_claims: { avatarId: ObjectId, walletAddress: string }
        const claims = await db.collection('avatar_claims')
          .find({ walletAddress: { $in: walletAddresses } })
          .project({ avatarId: 1 })
          .toArray();
        for (const c of claims) addId(c.avatarId);
      }
      return owned;
    } catch (err) {
      this.logger?.warn?.(`getOwnedAvatarIdsByWallets failed: ${err?.message}`);
      return owned;
    }
  }

  /**
   * Resolve owned avatar IDs for a set of Discord user IDs by following wallet links.
   * @param {string[]} discordIds
   * @returns {Promise<Set<string>>}
   */
  async getOwnedAvatarIdsByDiscordIds(discordIds = []) {
    try {
      const wallets = new Set();
      for (const did of discordIds) {
        const wl = await this.getLinkedWalletsByDiscordId(did);
        wl.forEach(w => wallets.add(w));
      }
      return await this.getOwnedAvatarIdsByWallets([...wallets]);
    } catch (err) {
      this.logger?.warn?.(`getOwnedAvatarIdsByDiscordIds failed: ${err?.message}`);
      return new Set();
    }
  }

  /**
   * Prioritize avatars for a message with the following precedence:
   *  1) Avatars already in the channel (caller must supply in-channel list)
   *  2) Avatars the user owns (via linked wallet → avatar_claims)
   *  3) Avatars with exact name matches in the message content
   * Remaining avatars follow in original order.
   * @param {Array} avatarsInChannel - list of avatar docs in the channel
   * @param {Object} message - Discord message
   * @returns {Promise<Array>} prioritized list
   */
  async prioritizeAvatarsForMessage(avatarsInChannel, message) {
    try {
      const avatars = Array.isArray(avatarsInChannel) ? avatarsInChannel.slice() : [];
      if (!avatars.length || !message?.author?.id) return avatars;

      // 2) Owned avatars (by linked wallets)
      const wallets = await this.getLinkedWalletsByDiscordId(message.author.id);
      const ownedIds = wallets.length ? await this.getOwnedAvatarIdsByWallets(wallets) : new Set();
      const owned = [];
      const restAfterOwned = [];
      for (const av of avatars) {
        if (ownedIds.has(String(av._id))) owned.push(av); else restAfterOwned.push(av);
      }

      // 3) Exact name matches (word-boundary match, case-insensitive)
      const content = String(message.content || '');
      const exact = [];
      const remainder = [];
      const seen = new Set(owned.map(a => String(a._id)));
      for (const av of restAfterOwned) {
        const name = String(av.name || '').trim();
        let isExact = false;
        if (name) {
          try {
            const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const rx = new RegExp(`(^|\\b)${esc}(\\b|$)`, 'i');
            isExact = rx.test(content);
          } catch { isExact = content.toLowerCase().includes(name.toLowerCase()); }
        }
        if (isExact) { exact.push(av); seen.add(String(av._id)); }
        else remainder.push(av);
      }

      // Final order: owned → exact → remainder
      return [...owned, ...exact, ...remainder];
    } catch (err) {
      this.logger?.warn?.(`prioritizeAvatarsForMessage failed: ${err?.message}`);
      return Array.isArray(avatarsInChannel) ? avatarsInChannel : [];
    }
  }

  /**
   * Find avatars in a guild whose name or emoji are mentioned in the provided content.
   * Returns up to `limit` avatars, prioritizing exact matches first, then fuzzy.
   */
  async findMentionedAvatarsInGuild(content, guildId, limit = 3) {
    if (!content || !guildId) return [];
    try {
      const db = await this._db();
      // Pull a bounded set of active avatars in the guild
      const avatars = await db.collection(this.AVATARS_COLLECTION)
        .find({ guildId, status: { $ne: 'dead' }, active: { $ne: false } }, { projection: { name: 1, emoji: 1, channelId: 1 } })
        .limit(500)
        .toArray();
      const mentioned = Array.from(this.extractMentionedAvatars(content, avatars));
      return mentioned.slice(0, limit);
    } catch (err) {
      this.logger?.warn?.(`findMentionedAvatarsInGuild failed: ${err?.message}`);
      return [];
    }
  }

  /* -------------------------------------------------- */
  /*  RECENT‑ACTIVITY QUERY                              */
  /* -------------------------------------------------- */

  async getAvatarsWithRecentMessages(limit = 100) {
    try {
      const db = await this._db();
      const matchQuery = process.env.DISCORD_BOT_ID
        ? { authorId: process.env.DISCORD_BOT_ID }
        : { authorId: { $exists: true } };

      const authors = await db.collection('messages').aggregate([
        { $match: matchQuery },
        { $group: { _id: '$authorUsername', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 1000 }
      ]).toArray();

      const top = authors.map(a => a._id);
      return db.collection(this.AVATARS_COLLECTION)
        .aggregate([
          { $match: { name: { $in: top }, status: { $ne: 'dead' } } },
          { $sample: { size: limit } }
        ]).toArray();
    } catch (err) {
      this.logger.error(`Error fetching avatars w/ recent msgs – ${err.message}`);
      return [];
    }
  }

  /* -------------------------------------------------- */
  /*  NAME LOOK‑UPS                                      */
  /* -------------------------------------------------- */

  async getAvatarByName(name, opts = {}) {
    // Use case-insensitive exact match without regex to avoid issues with special characters
    const db = await this._db();
    const filters = this._legacyToFilters(opts);
    const query = buildAvatarQuery(filters);
    
    // Find all matching the base query, then filter by exact name match (case-insensitive)
    const avatars = await db.collection(this.AVATARS_COLLECTION).find(query).toArray();
    const avatar = avatars.find(av => av.name && av.name.toLowerCase() === name.toLowerCase());
    
    if (!avatar) return null;
    avatar.stats = await this.getOrCreateStats(avatar);
    return avatar;
  }

  async fuzzyAvatarByName(text, opts = {}) {
    const filters = this._legacyToFilters(opts);
    const db = await this._db();
    const all = await db.collection(this.AVATARS_COLLECTION).find(buildAvatarQuery(filters)).toArray();
    const fuse = new Fuse(all, { keys: ['name'], threshold: 0.4 });
    return fuse.search(text).slice(0, opts.limit ?? 10).map(r => r.item);
  }

  /* -------------------------------------------------- */
  /*  GENERIC LISTING                                    */
  /* -------------------------------------------------- */

  async getAllAvatars({ filters = {}, limit = 100 } = {}) {
    const db = await this._db();
    return db.collection(this.AVATARS_COLLECTION)
      .aggregate([{ $match: buildAvatarQuery(filters) }, { $sample: { size: limit } }])
      .toArray();
  }

  async getAvatarById(id, opts = {}) {
    const filters = this._legacyToFilters(opts);
    const db = await this._db();
    const query = { ...buildAvatarQuery(filters), _id: typeof id === 'string' ? new ObjectId(id) : id };
    return db.collection(this.AVATARS_COLLECTION).findOne(query);
  }

  /* -------------------------------------------------- */
  /*  UTILITY                                            */
  /* -------------------------------------------------- */

  async retryOperation(operation, max = 3) {
    for (let attempt = 1; attempt <= max; attempt++) {
      try { return await operation(); }
      catch (err) {
        if (attempt === max) throw err;
        const delay = 2 ** attempt * 1_000;
        this.logger.warn(`Attempt ${attempt} failed – retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  getRandomAlignment() {
    const axes = [['chaotic', 'neutral', 'lawful'], ['good', 'neutral', 'evil']];
    return `${axes[0][Math.floor(Math.random() * 3)]} ${axes[1][Math.floor(Math.random() * 3)]}`;
  }

  /* -------------------------------------------------- */
  /*  AVATAR VALIDATION HELPERS                          */
  /* -------------------------------------------------- */

  /**
   * Validate and sanitize an avatar name
   * Centralized validation logic used by both createAvatar() and createPartialAvatar()
   * @param {string} name - Raw name from AI generation
   * @param {string} context - Context string for logging (e.g., 'avatar', 'partial avatar')
   * @returns {string|null} - Sanitized name or null if invalid
   * @private
   */
  _validateAndSanitizeName(name, context = 'avatar') {
    if (!name || typeof name !== 'string') {
      this.logger?.error?.(`[AvatarService] Cannot create ${context}: name is not a string`);
      return null;
    }

    try {
      const orig = name.trim();
      
      // Pattern checks - detect error-like names
      const isHttpCode = /^(?:HTTP_)?(4\d\d|5\d\d)$/.test(orig);
      const isJustDigits = /^\d{3,}$/.test(orig);
      const hasErrorMarkers = /⚠️|\[Error|No response|failed|invalid/i.test(orig);
      const hasMarkdown = /^-#|^#/.test(orig);
      
      if (!orig || isHttpCode || isJustDigits || hasErrorMarkers || hasMarkdown) {
        this.logger?.error?.(`[AvatarService] Cannot create ${context}: invalid/error-like name detected: '${orig}'`);
        return null;
      }
      
      // Strip any accidental 'Error:' prefixes inserted by malformed upstream responses
      const sanitized = orig.replace(/^Error[:\s-]+/i, '').trim();
      
      // Final validation: name must be reasonable length
      if (sanitized.length < 2 || sanitized.length > 50) {
        this.logger?.error?.(`[AvatarService] Cannot create ${context}: name length invalid (${sanitized.length}): '${sanitized}'`);
        return null;
      }
      
      return sanitized;
    } catch (e) {
      this.logger?.error?.(`[AvatarService] Name sanitization failed: ${e?.message || e}`);
      return null;
    }
  }

  /**
   * Check if an avatar with the given name already exists
   * @param {string} name - Avatar name to check
   * @returns {Promise<Object|null>} - Existing avatar with _existing flag, or null
   * @private
   */
  async _checkExistingAvatar(name) {
    const existing = await this.getAvatarByName(name);
    if (existing) {
      this.logger?.info?.(`[AvatarService] Avatar "${name}" already exists, returning existing`);
      return { ...existing, _existing: true };
    }
    return null;
  }

  /**
   * Get avatar by wallet address (uses indexed query)
   * @param {string} walletAddress - Solana wallet address
   * @param {Object} options - Query options
   * @param {boolean} options.includeInactive - Include dead avatars (default: false)
   * @returns {Promise<Object|null>} - Avatar document or null
   */
  async getAvatarByWalletAddress(walletAddress, { includeInactive = false } = {}) {
    if (!walletAddress) return null;
    
    try {
      const db = await this._db();
      const query = { walletAddress };
      
      if (!includeInactive) {
        query.status = { $ne: 'dead' };
      }
      
      return await db.collection(this.AVATARS_COLLECTION).findOne(query);
    } catch (err) {
      this.logger?.error?.(`[AvatarService] Failed to get avatar by wallet address: ${err.message}`);
      return null;
    }
  }

  /* -------------------------------------------------- */
  /*  AI‑ASSISTED GENERATION                             */
  /* -------------------------------------------------- */

  async generateAvatarDetails(userPrompt, _guildId = null) {
    const prompt = `Generate a unique and creative character for a role‑playing game based on this description: "${userPrompt}". Include fields: name, description, personality, emoji, and model (or \"none\").`;
    const schema = {
      name: 'rati-avatar', strict: true,
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          personality: { type: 'string' },
          emoji: { type: 'string' },
          model: { type: 'string' },
        },
        required: ['name', 'description', 'personality', 'emoji', 'model'],
        additionalProperties: false,
      }
    };
    return this.schemaService.executePipeline({ prompt, schema });
  }

  /**
   * Generate simple avatar details for partial avatars (no family field required)
   * Used for lightweight avatar creation without image generation
   * @param {string} userPrompt - Prompt for avatar generation
   * @returns {Promise<Object>} Avatar details (name, emoji, description, personality)
   */
  async generatePartialAvatarDetails(userPrompt) {
    const prompt = `Create a simple character based on: "${userPrompt}". Keep it straightforward - just name, emoji, brief description, and personality.`;
    const schema = {
      name: 'rati-partial-avatar', strict: true,
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          personality: { type: 'string' },
          emoji: { type: 'string' },
        },
        required: ['name', 'description', 'personality', 'emoji'],
        additionalProperties: false,
      }
    };
    return this.schemaService.executePipeline({ prompt, schema });
  }

  async generateAvatarImage(prompt, uploadOptions = {}) {
    return this.schemaService.generateImage(prompt, '1:1', uploadOptions);
  }

  /**
   * Resolve a suitable chat model for hydrated avatars. Falls back through configured defaults.
   * @param {string|null} currentModel
   * @returns {Promise<string>}
   */
  async _resolveHydratedModel(currentModel = null) {
    if (currentModel && currentModel !== 'partial') {
      return currentModel;
    }

    let selectedModel = null;

    if (this.aiService?.selectRandomModel) {
      try {
        selectedModel = await this.aiService.selectRandomModel();
      } catch (error) {
        this.logger?.warn?.(`[AvatarService] Failed to select random model for upgrade: ${error.message}`);
      }
    }

    if (!selectedModel || selectedModel === 'partial') {
      selectedModel = this.aiService?.defaultChatOptions?.model
        || this.aiService?.defaultCompletionOptions?.model
        || process.env.OPENROUTER_CHAT_MODEL
        || process.env.GOOGLE_AI_CHAT_MODEL
        || 'meta-llama/llama-3.2-1b-instruct';
    }

    return selectedModel;
  }

  /* -------------------------------------------------- */
  /*  CRUD                                               */
  /* -------------------------------------------------- */

  async updateAvatar(avatar) {
    const db = await this._db();
    if (avatar.arweave_prompt) await this.syncArweavePrompt(avatar);
    if (typeof avatar._id === 'string') avatar._id = new ObjectId(avatar._id);

    const res = await db.collection(this.AVATARS_COLLECTION)
      .updateOne({ _id: avatar._id }, { $set: { ...avatar, updatedAt: new Date() } });

    if (!res.matchedCount) {
      this.logger.error(`Avatar ${avatar._id} not found.`); return null;
    }
    if (res.modifiedCount) this.avatarCache = [];
    return db.collection(this.AVATARS_COLLECTION).findOne({ _id: avatar._id });
  }

  async createAvatar({ prompt, summoner, channelId, guildId, imageUrl: imageUrlOverride = null }) {
    let details = null;
    try {
      details = await this.generateAvatarDetails(prompt, guildId);
    } catch (err) {
      // Harden against upstream structured-output/JSON issues by falling back to a simple heuristic
      this.logger?.warn?.(`generateAvatarDetails failed: ${err?.message || err}`);
      try {
        const fallbackPrompt = [
          { role: 'system', content: 'You are generating a minimal RPG character. Reply with a single line: Name | One-sentence description | emoji | model (short). No JSON.' },
          { role: 'user', content: `Create a character for: ${prompt}` }
        ];
  const raw = await this.aiService.chat(fallbackPrompt, {});
        const text = typeof raw === 'object' && raw?.text ? raw.text : String(raw || '');
        
        // Check if the response is an error message or empty
        if (!text || text.includes('No response') || text.includes('⚠️') || text.includes('[Error') || text.trim().length < 3) {
          this.logger?.error?.(`Fallback avatar details failed: AI returned error or empty response: "${text}"`);
          return null;
        }
        
        const parts = text.split('|').map(s => s.trim()).filter(Boolean);
        const [name, description, emoji, model] = [parts[0] || 'Wanderer', parts[1] || 'A curious soul.', parts[2] || '🙂', parts[3] || 'auto'];
        
        // Validate that we got actual content, not error messages
        if (!name || name.includes('No response') || name.includes('⚠️') || name.includes('[') || name.length < 2) {
          this.logger?.error?.(`Fallback avatar details failed: Invalid name generated: "${name}"`);
          return null;
        }
        
        details = { name, description, personality: parts[1] || 'curious', emoji, model };
      } catch (e2) {
        this.logger?.error?.(`Fallback avatar details failed: ${e2?.message || e2}`);
        return null;
      }
    }
    if (!details?.name) {
      this.logger?.warn?.('[AvatarService] Cannot create avatar: no valid details generated');
      return null;
    }

    // Validate and sanitize name using centralized method
    const validatedName = this._validateAndSanitizeName(details.name, 'avatar');
    if (!validatedName) return null;
    details.name = validatedName;

    // Check for existing avatar with same name
    const existing = await this._checkExistingAvatar(details.name);
    if (existing) return existing;

    let imageUrl = null;
    if (imageUrlOverride) {
      imageUrl = imageUrlOverride;
    } else {
      try { 
        // Pass metadata through to the upload service for proper event emission
        const uploadOptions = {
          source: 'avatar.create',
          avatarName: details.name,
          avatarEmoji: details.emoji,
          prompt: details.description,
          context: `${details.emoji || '✨'} Meet ${details.name} — ${details.description}`.trim()
        };
        imageUrl = await this.generateAvatarImage(details.description, uploadOptions); 
      } catch (e) {
        this.logger?.warn?.(`Avatar image generation failed, continuing without image: ${e?.message || e}`);
        imageUrl = null;
      }
    }
    let model = null;
    try { model = await this.aiService.getModel(details.model); } catch { model = details.model || 'auto'; }

    const doc = {
      ...details,
      imageUrl,
      model,
      channelId,
      summoner,
      lives: 3,
      status: 'alive',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const db = await this._db();
    const { insertedId } = await db.collection(this.AVATARS_COLLECTION).insertOne(doc);

  // Auto-post new avatars to X when enabled and admin account is linked
    try {
      const autoPost = String(process.env.X_AUTO_POST_AVATARS || 'false').toLowerCase();
      if (autoPost === 'true' && doc.imageUrl && this.configService?.services?.xService) {
        // Basic dedupe: avoid posting if a recent social_posts entry exists for this image
        const posted = await db.collection('social_posts').findOne({ imageUrl: doc.imageUrl, mediaType: 'image' });
        if (!posted) {
          try {
            // Resolve admin identity (avatar doc if ObjectId, otherwise fallback system identity)
            let admin = null;
            const envId = resolveAdminAvatarId();
            if (envId && /^[a-f0-9]{24}$/i.test(envId)) {
              admin = await this.configService.services.avatarService.getAvatarById(envId);
            } else {
              const aiCfg = this.configService?.getAIConfig?.(process.env.AI_SERVICE);
              const model = aiCfg?.chatModel || aiCfg?.model || process.env.OPENROUTER_CHAT_MODEL || process.env.GOOGLE_AI_CHAT_MODEL || 'default';
              const safe = String(model).toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
              admin = { _id: `model:${safe}`, name: `System (${model})`, username: process.env.X_ADMIN_USERNAME || undefined };
            }
            if (admin) {
              const content = `${doc.emoji || ''} Meet ${doc.name} — ${doc.description}`.trim().slice(0, 240);
              // Emit event for global auto-poster system (may have been emitted by S3Service already, but ensure it's available)
              try { 
                eventBus.emit('MEDIA.IMAGE.GENERATED', { 
                  type: 'image', 
                  source: 'avatar.create', 
                  avatarId: insertedId, 
                  imageUrl: doc.imageUrl, 
                  prompt: doc.description, 
                  avatarName: doc.name,
                  avatarEmoji: doc.emoji,
                  context: content,
                  createdAt: new Date() 
                }); 
              } catch {}
              // Direct X posting for backwards compatibility (may be skipped if global auto-poster already posted)
              await this.configService.services.xService.postImageToX(admin, doc.imageUrl, content);
            }
          } catch (e) { this.logger?.warn?.(`[AvatarService] auto X post (avatar) failed: ${e.message}`); }
        }
      }
    } catch (e) { this.logger?.debug?.(`[AvatarService] auto X post (avatar) skipped: ${e.message}`); }

    return { ...doc, _id: insertedId };
  }

  /**
   * Create a partial avatar (no image generation, lightweight AI generation)
   * Used for wallet avatars and other scenarios where we want personality without the cost of image generation
   * @param {Object} params - Creation parameters
   * @param {string} params.prompt - Prompt for avatar generation
   * @param {string} params.summoner - Who/what summoned this avatar
   * @param {string} params.channelId - Channel ID
   * @param {string} params.guildId - Guild ID
   * @param {Object} params.metadata - Additional metadata (walletAddress, tokenBalances, etc)
   * @returns {Promise<Object>} Created partial avatar
   */
  async createPartialAvatar({ prompt, summoner, channelId, guildId: _guildId, metadata = {} }) {
    let details = null;
    try {
      details = await this.generatePartialAvatarDetails(prompt);
    } catch (err) {
      this.logger?.warn?.(`generatePartialAvatarDetails failed: ${err?.message || err}`);
      return null;
    }

    if (!details?.name || !details?.emoji) {
      this.logger?.warn?.('[AvatarService] Cannot create partial avatar: no valid details generated');
      return null;
    }

    // Validate and sanitize name using centralized method
    const validatedName = this._validateAndSanitizeName(details.name, 'partial avatar');
    if (!validatedName) return null;
    details.name = validatedName;

    // Check for existing avatar with same name
    const existing = await this._checkExistingAvatar(details.name);
    if (existing) return existing;

    const doc = {
      name: details.name,
      emoji: details.emoji,
      description: details.description,
      personality: details.personality,
      imageUrl: null, // No image for partial avatars
      model: 'partial', // Mark as partial
      channelId,
      summoner,
      isPartial: true, // Flag for easy filtering
      lives: 3,
      status: 'alive',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...metadata // Spread any additional metadata (walletAddress, tokenBalances, etc)
    };

    const db = await this._db();
    const { insertedId } = await db.collection(this.AVATARS_COLLECTION).insertOne(doc);

    this.logger?.info?.(`[AvatarService] Created partial avatar: ${doc.emoji} ${doc.name}`);

    return { ...doc, _id: insertedId };
  }

  /* -------------------------------------------------- */
  /*  IMAGE LIMITING & STORAGE                            */
  /* -------------------------------------------------- */

  async checkDailyLimit(channelId) {
    const db = await this._db();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const n = await db.collection(this.IMAGE_URL_COLLECTION)
      .countDocuments({ channelId, date: { $gte: today } });
    this.logger.info(`Daily image requests for ${channelId}: ${n}`);
    return n < 100;
  }

  async insertRequestIntoMongo(prompt, imageUrl, channelId) {
    const db = await this._db();
    await db.collection(this.IMAGE_URL_COLLECTION)
      .insertOne({ prompt, imageUrl, channelId, date: new Date() });
  }

  async isImageAccessible(url) {
    return new Promise(async resolve => {
      try {
        const { protocol } = new URL(url);
        const mod = protocol === 'https:' ? await import('https') : await import('http');
        const req = mod.request(url, { method: 'HEAD' }, res => resolve(res.statusCode === 200));
        req.on('error', () => resolve(false));
        req.end();
      } catch { resolve(false); }
    });
  }

  async regenerateAvatarImage(avatarId) {
    const db = await this._db();
    const avatar = await db.collection(this.AVATARS_COLLECTION).findOne({ _id: new ObjectId(avatarId) });
    if (!avatar) return false;
    if (await this.isImageAccessible(avatar.imageUrl)) return true;

    // Pass metadata for proper event emission
    const uploadOptions = {
      source: 'avatar.regenerate',
      avatarName: avatar.name,
      avatarEmoji: avatar.emoji,
      avatarId: avatarId,
      prompt: avatar.description,
      context: `${avatar.emoji || '✨'} ${avatar.name} — ${avatar.description}`.trim()
    };
    
    const file = await this.generateAvatarImage(avatar.description, uploadOptions);
    if (!file) return false;

    // Upload via s3Service if available, otherwise return false
    let s3Url = null;
    try {
      if (this.schemaService?.uploadImage) {
        s3Url = await this.schemaService.uploadImage(file);
      } else if (this.aiService?.s3Service?.uploadImage) {
        s3Url = await this.aiService.s3Service.uploadImage(file);
      }
    } catch (err) {
      this.logger?.error(`uploadImage failed: ${err.message}`);
    }
    if (!s3Url) return false;
    const res = await db.collection(this.AVATARS_COLLECTION)
      .updateOne({ _id: avatar._id }, { $set: { imageUrl: s3Url, updatedAt: new Date() } });
    return !!res.modifiedCount;
  }

  /* -------------------------------------------------- */
  /*  ARWEAVE PROMPTS                                    */
  /* -------------------------------------------------- */

  async syncArweavePrompt(avatar) {
    if (!avatar.arweave_prompt || !this.isValidUrl(avatar.arweave_prompt)) return null;
    const res = await fetch(avatar.arweave_prompt);
    if (!res.ok) throw new Error(`Arweave fetch failed: ${res.statusText}`);
    const prompt = (await res.text()).trim();
    const db = await this._db();
    await db.collection(this.AVATARS_COLLECTION).updateOne(
      { _id: avatar._id },
      { $set: { prompt } }
    );
    return prompt;
  }

  isValidUrl(str) {
    try { new URL(str); return true; } catch { return false; }
  }

  async updateAllArweavePrompts() {
    const db = await this._db();
    const avatars = await db.collection(this.AVATARS_COLLECTION)
      .find({ arweave_prompt: { $exists: true, $ne: null } }).toArray();
    for (const av of avatars) {
      try { await this.syncArweavePrompt(av); }
      catch (err) { this.logger.error(`Arweave sync for ${av.name} failed – ${err.message}`); }
    }
  }

  /* -------------------------------------------------- */
  /*  UNIQUE‑FOR‑USER SUMMONING                          */
  /* -------------------------------------------------- */

  async getOrCreateUniqueAvatarForUser(summonerId, summonPrompt, channelId) {
    const db = await this._db();
    const existing = await db.collection(this.AVATARS_COLLECTION)
      .findOne({ summoner: summonerId, status: 'alive' });
    if (existing) return { avatar: existing, new: false };

    const stats = this.statService.generateStatsFromDate(new Date());
    const prompt = `Stats: ${JSON.stringify(stats)}\n\n${summonPrompt}`;
    const avatar = await this.createAvatar({ prompt, summoner: summonerId, channelId });
    
    // Handle case where avatar creation failed
    if (!avatar) {
      this.logger?.error?.('[AvatarService] Failed to create avatar - createAvatar returned null');
      return { avatar: null, new: false };
    }
    
    avatar.stats = stats;
    return { avatar, new: true };
  }

  async summonUserAvatar(message, customPrompt = null) {
    if (!message?.author) return null;
    const { id: userId, username } = message.author;
    const channelId = message.channel.id;
    const prompt = customPrompt || `Create an avatar that represents ${username}.`;
    const { avatar, new: isNewAvatar } = await this.getOrCreateUniqueAvatarForUser(userId, prompt, channelId);

    if (avatar.channelId !== channelId)
      await this.getMapService().updateAvatarPosition(avatar, channelId, avatar.channelId);

    return { avatar, isNewAvatar };
  }

  /* -------------------------------------------------- */
  /*  WALLET AVATAR CREATION                             */
  /* -------------------------------------------------- */

  /**
   * Build wallet holdings context using the shared insights helper when available.
   * Falls back to empty defaults if insights cannot be resolved.
   * @param {string} walletAddress
   * @param {Object} token
   * @param {number} tokenDecimals
   * @param {Object} [options]
   * @returns {Promise<{ currentBalance: number, currentBalanceUsd: number|null, holdingsSnapshot: Array, additionalTokenBalances: Object|null }>}
   */
  async buildWalletAvatarContext(walletAddress, token = {}, tokenDecimals = 9, options = {}) {
    if (!this.walletInsights || !walletAddress || !token?.tokenAddress) {
      return {
        currentBalance: 0,
        currentBalanceUsd: null,
        holdingsSnapshot: [],
        additionalTokenBalances: null,
      };
    }

    try {
      return await this.walletInsights.buildWalletAvatarContext(walletAddress, token, tokenDecimals, options);
    } catch (error) {
      this.logger?.warn?.(`[AvatarService] Wallet context generation failed for ${formatAddress(walletAddress)}: ${error.message}`);
      return {
        currentBalance: 0,
        currentBalanceUsd: null,
        holdingsSnapshot: [],
        additionalTokenBalances: null,
      };
    }
  }

  /**
   * Enrich provided wallet context with current balances/top tokens if missing.
   * @param {string} walletAddress
   * @param {Object} context
   * @returns {Promise<Object>}
   */
  async enrichWalletContext(walletAddress, context = {}) {
    if (!this.walletInsights || !walletAddress || context?.populateWalletContext === false) {
      return context;
    }

    const tokenAddress = context.tokenAddress;
    const tokenSymbol = context.tokenSymbol;
    if (!tokenAddress || !tokenSymbol) {
      return context;
    }

    const needsPrimaryBalance = !Number.isFinite(context.currentBalance);
    const needsTopTokens = !Array.isArray(context.walletTopTokens) || context.walletTopTokens.length === 0;
    const needsAdditional = !context.additionalTokenBalances || Object.keys(context.additionalTokenBalances).length === 0;

    if (!needsPrimaryBalance && !needsTopTokens && !needsAdditional) {
      return context;
    }

    const tokenDecimals = context.tokenDecimals ?? context.decimals ?? 9;
    const tokenMeta = {
      tokenAddress,
      tokenSymbol,
      tokenName: context.tokenName || tokenSymbol || tokenAddress,
      usdPrice: context.tokenPriceUsd ?? context.usdPricePerToken ?? context.usdPrice ?? null,
    };

    try {
      const walletContext = await this.buildWalletAvatarContext(walletAddress, tokenMeta, tokenDecimals, {
        minUsd: context.minUsd ?? 5,
        limit: context.limit ?? 5,
      });

      const nextContext = { ...context };

      if (needsPrimaryBalance && Number.isFinite(walletContext.currentBalance)) {
        nextContext.currentBalance = walletContext.currentBalance;
        nextContext.usdValue = Number.isFinite(walletContext.currentBalanceUsd)
          ? walletContext.currentBalanceUsd
          : nextContext.usdValue;
      }

      if (needsTopTokens && Array.isArray(walletContext.holdingsSnapshot)) {
        nextContext.walletTopTokens = walletContext.holdingsSnapshot;
      }

      if (needsAdditional && walletContext.additionalTokenBalances) {
        nextContext.additionalTokenBalances = walletContext.additionalTokenBalances;
      }

      if (nextContext.tokenPriceUsd === undefined && Array.isArray(walletContext.holdingsSnapshot)) {
        const primary = walletContext.holdingsSnapshot.find(entry => entry.mint === tokenAddress);
        if (primary && Number.isFinite(primary.price)) {
          nextContext.tokenPriceUsd = primary.price;
        }
      }

      return nextContext;
    } catch (error) {
      this.logger?.warn?.(`[AvatarService] Failed to enrich wallet context for ${formatAddress(walletAddress)}: ${error.message}`);
      return context;
    }
  }

  /**
   * Create or retrieve an avatar for a Solana wallet address
   * This is the proper service method - replaces the standalone helper
   * 
   * @param {string} walletAddress - Solana wallet public key
   * @param {WalletAvatarContext} context - Context for avatar creation
   * @returns {Promise<Avatar>} Avatar document
   */
  async createAvatarForWallet(walletAddress, context = {}) {
    const db = await this._db();
    
    const walletShort = formatAddress(walletAddress);

    context = await this.enrichWalletContext(walletAddress, context);

    const normalizedTokenSymbol = context.tokenSymbol?.replace(/^\$/, '');
    const normalizedBalance = Number.isFinite(context.currentBalance)
      ? context.currentBalance
      : Number.parseFloat(context.currentBalance ?? 0) || 0;

    const tokenPreferences = this.configService?.getTokenPreferences
      ? this.configService.getTokenPreferences({
          symbol: normalizedTokenSymbol,
          address: context.tokenAddress
        })
      : null;

    const walletAvatarPrefs = tokenPreferences?.walletAvatar || {};
    const minBalanceForFullAvatar = Number.isFinite(walletAvatarPrefs.minBalanceForFullAvatar)
      ? walletAvatarPrefs.minBalanceForFullAvatar
      : 0;

    const isHolder = Boolean(walletAvatarPrefs.createFullAvatar) && normalizedBalance > minBalanceForFullAvatar;
    const shouldAutoActivate = Boolean(walletAvatarPrefs.autoActivate);
    const shouldSendIntro = Boolean(walletAvatarPrefs.sendIntro);

    // Check if avatar already exists for this wallet (uses indexed query)
    let avatar = await this.getAvatarByWalletAddress(walletAddress);
    
    if (avatar) {
      // Check if we need to upgrade a partial avatar to full avatar (add image)
      const isPartialAvatar = !avatar.imageUrl;
      const needsUpgrade = isPartialAvatar && isHolder;
      
    // Debug logging for upgrade decision
    this.logger?.info?.(`[AvatarService] Existing avatar ${avatar.emoji} ${avatar.name} - imageUrl: ${avatar.imageUrl ? 'EXISTS' : 'NULL'}, isPartial: ${isPartialAvatar}, eligibleHolder: ${isHolder}, needsUpgrade: ${needsUpgrade}`);
      
      if (needsUpgrade) {
        const balanceDescription = context.tokenSymbol
          ? `${formatLargeNumber(normalizedBalance)} ${context.tokenSymbol}`
          : `${formatLargeNumber(normalizedBalance)} tokens`;
        this.logger?.info?.(`[AvatarService] Upgrading partial avatar ${avatar.emoji} ${avatar.name} to full avatar (eligible holder with ${balanceDescription})`);
        
        try {
          // Generate image for existing avatar
          const uploadOptions = {
            source: 'avatar.upgrade',
            avatarName: avatar.name,
            avatarEmoji: avatar.emoji,
            avatarId: avatar._id,
            prompt: avatar.description,
            context: `${avatar.emoji || '✨'} ${avatar.name} — ${avatar.description}`.trim()
          };
          const imageUrl = await this.generateAvatarImage(avatar.description, uploadOptions);
          
          if (imageUrl) {
            const upgradedAt = new Date();
            const hydratedModel = await this._resolveHydratedModel(avatar.model);
            const upgradeFields = {
              imageUrl,
              isPartial: false,
              upgradedAt,
            };

            if (hydratedModel && hydratedModel !== avatar.model) {
              upgradeFields.model = hydratedModel;
            }

            const updateResult = await db.collection(this.AVATARS_COLLECTION).updateOne(
              { _id: avatar._id },
              { 
                $set: upgradeFields
              }
            );
            this.logger?.info?.(`[AvatarService] Successfully upgraded ${avatar.name} to full avatar with image: ${imageUrl} (matched: ${updateResult.matchedCount}, modified: ${updateResult.modifiedCount})`);
            
            // CRITICAL FIX: Update the in-memory avatar object immediately
            avatar.imageUrl = imageUrl;
            avatar.isPartial = false;
            avatar.upgradedAt = upgradedAt;
            if (upgradeFields.model) {
              avatar.model = upgradeFields.model;
              this.logger?.info?.(`[AvatarService] Assigned upgraded model ${upgradeFields.model} to ${avatar.name}`);
            }
          } else {
            this.logger?.error?.(`[AvatarService] Failed to generate image for ${avatar.name}`);
          }
        } catch (error) {
          this.logger?.error?.(`[AvatarService] Error upgrading avatar ${avatar.name}:`, error);
        }
      }
      
      // Update last activity and token balances
      const updateData = {
        lastActivityAt: new Date()
      };
      
      // Update token balance if provided
      if (context.tokenSymbol && context.currentBalance !== undefined) {
        const mainBalance = {
          balance: Number.isFinite(context.currentBalance) ? context.currentBalance : 0,
          usdValue: Number.isFinite(context.usdValue) ? context.usdValue : null,
          lastUpdated: new Date()
        };

        if (context.tokenAddress) {
          mainBalance.mint = context.tokenAddress;
        }
        if (context.tokenPriceUsd !== undefined) {
          mainBalance.priceUsd = Number.isFinite(context.tokenPriceUsd) ? context.tokenPriceUsd : null;
        }

        updateData[`tokenBalances.${context.tokenSymbol}`] = mainBalance;
      }
      
      // Update NFT count if provided
      if (context.orbNftCount !== undefined) {
        updateData['nftBalances.Orb'] = context.orbNftCount;
      }

      if (context.additionalTokenBalances && typeof context.additionalTokenBalances === 'object') {
        for (const [symbol, balanceData] of Object.entries(context.additionalTokenBalances)) {
          const extraBalance = {
            balance: Number.isFinite(balanceData.balance) ? balanceData.balance : 0,
            usdValue: Number.isFinite(balanceData.usdValue) ? balanceData.usdValue : null,
            lastUpdated: balanceData.lastUpdated ? new Date(balanceData.lastUpdated) : new Date()
          };

          if (balanceData.mint) {
            extraBalance.mint = balanceData.mint;
          }
          if (balanceData.priceUsd !== undefined) {
            extraBalance.priceUsd = Number.isFinite(balanceData.priceUsd) ? balanceData.priceUsd : null;
          }
          if (balanceData.decimals !== undefined && balanceData.decimals !== null) {
            extraBalance.decimals = balanceData.decimals;
          }
          if (balanceData.change1h !== undefined) {
            extraBalance.change1h = Number.isFinite(balanceData.change1h) ? balanceData.change1h : null;
          }
          if (balanceData.change24h !== undefined) {
            extraBalance.change24h = Number.isFinite(balanceData.change24h) ? balanceData.change24h : null;
          }
          if (balanceData.change7d !== undefined) {
            extraBalance.change7d = Number.isFinite(balanceData.change7d) ? balanceData.change7d : null;
          }
          if (balanceData.change30d !== undefined) {
            extraBalance.change30d = Number.isFinite(balanceData.change30d) ? balanceData.change30d : null;
          }

          updateData[`tokenBalances.${symbol}`] = extraBalance;
        }
      }

      if (Array.isArray(context.walletTopTokens)) {
        updateData.walletTopTokens = context.walletTopTokens.map(holding => ({
          symbol: holding.symbol,
          name: holding.name,
          mint: holding.mint,
          amount: Number.isFinite(holding.amount) ? holding.amount : 0,
          usdValue: Number.isFinite(holding.usdValue) ? holding.usdValue : null,
          price: Number.isFinite(holding.price) ? holding.price : null,
          decimals: Number.isFinite(holding.decimals) ? holding.decimals : null,
          change1h: Number.isFinite(holding.change1h) ? holding.change1h : null,
          change24h: Number.isFinite(holding.change24h) ? holding.change24h : null,
          change7d: Number.isFinite(holding.change7d) ? holding.change7d : null,
          change30d: Number.isFinite(holding.change30d) ? holding.change30d : null,
          updatedAt: new Date()
        }));
      }
      
      await db.collection(this.AVATARS_COLLECTION).updateOne(
        { _id: avatar._id },
        { 
          $set: updateData,
          $inc: { activityCount: 1 }
        }
      );
      
      // Reload to get updated data
      avatar = await db.collection(this.AVATARS_COLLECTION).findOne({ _id: avatar._id });
      
      this.logger?.info?.(`[AvatarService] Updated wallet avatar ${avatar.emoji} ${avatar.name} for ${walletShort}${needsUpgrade ? ' (upgraded to full)' : ''} - Final imageUrl: ${avatar.imageUrl ? 'EXISTS (' + (avatar.imageUrl.substring(0, 50)) + '...)' : 'NULL'}`);
      return avatar;
    }
    
  // Create new avatar - token preferences decide whether to generate a full image
    
    // Build prompt for avatar creation
    const tokenInfo = context.tokenSymbol ? `${context.tokenSymbol} holder` : 'trader';
    const balanceInfo = normalizedBalance 
      ? `with ${formatLargeNumber(normalizedBalance)} ${context.tokenSymbol || ''}`.trim()
      : '';
    
    const prompt = `Create a character for wallet ${walletShort}, a Solana ${tokenInfo} ${balanceInfo}. Make them unique and memorable.`;
    
    // Create avatar with retries
    let retries = 0;
    const maxRetries = 2;
    
    while (!avatar && retries < maxRetries) {
      try {
        this.logger?.info?.(`[AvatarService] Creating wallet avatar for ${walletShort} (attempt ${retries + 1}/${maxRetries}, fullAvatarEligible: ${isHolder})`);
        
        if (isHolder) {
          // Full avatar with image
          avatar = await this.createAvatar({
            prompt,
            summoner: `wallet:${walletAddress}`,
            channelId: context.discordChannelId || context.channelId || null,
            guildId: context.guildId || null
          });
        } else {
          // Partial avatar (no image)
          avatar = await this.createPartialAvatar({
            prompt,
            summoner: `wallet:${walletAddress}`,
            channelId: context.discordChannelId || context.channelId || null,
            guildId: context.guildId || null,
            metadata: {}
          });
        }
        
        // Validate avatar has required fields
        if (avatar && (!avatar.name || !avatar.emoji)) {
          this.logger?.error?.(`[AvatarService] Wallet avatar created but missing required fields - name: "${avatar.name}", emoji: "${avatar.emoji}"`);
          avatar = null; // Force retry
        } else if (avatar) {
          this.logger?.info?.(`[AvatarService] Successfully created wallet avatar "${avatar.name}" ${avatar.emoji} for ${walletShort}`);
        }
      } catch (error) {
        this.logger?.error?.(`[AvatarService] Wallet avatar creation attempt ${retries + 1} failed for ${walletShort}:`, {
          error: error.message,
          fullAvatarEligible: isHolder
        });
      }
      
      retries++;
      if (!avatar && retries < maxRetries) {
        this.logger?.info?.(`[AvatarService] Retrying wallet avatar creation for ${walletShort}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    if (!avatar) {
      this.logger?.error?.(`[AvatarService] Failed to create wallet avatar for ${walletShort} after ${maxRetries} attempts`);
      throw new Error(`Failed to create avatar for wallet ${walletShort}`);
    }
    
    // Add wallet-specific metadata
    const tokenBalances = {};
    const nftBalances = {};
    
    if (context.tokenSymbol) {
      tokenBalances[context.tokenSymbol] = {
        balance: Number.isFinite(context.currentBalance) ? context.currentBalance : 0,
        usdValue: Number.isFinite(context.usdValue) ? context.usdValue : null,
        lastUpdated: new Date(),
        mint: context.tokenAddress || null,
        priceUsd: Number.isFinite(context.tokenPriceUsd) ? context.tokenPriceUsd : null,
      };
    }

    if (context.additionalTokenBalances && typeof context.additionalTokenBalances === 'object') {
      for (const [symbol, balanceData] of Object.entries(context.additionalTokenBalances)) {
        tokenBalances[symbol] = {
          balance: Number.isFinite(balanceData.balance) ? balanceData.balance : 0,
          usdValue: Number.isFinite(balanceData.usdValue) ? balanceData.usdValue : null,
          lastUpdated: balanceData.lastUpdated ? new Date(balanceData.lastUpdated) : new Date(),
          mint: balanceData.mint || null,
          priceUsd: Number.isFinite(balanceData.priceUsd) ? balanceData.priceUsd : null,
          decimals: Number.isFinite(balanceData.decimals) ? balanceData.decimals : null,
          change1h: Number.isFinite(balanceData.change1h) ? balanceData.change1h : null,
          change24h: Number.isFinite(balanceData.change24h) ? balanceData.change24h : null,
          change7d: Number.isFinite(balanceData.change7d) ? balanceData.change7d : null,
          change30d: Number.isFinite(balanceData.change30d) ? balanceData.change30d : null,
        };
      }
    }
    
    if (context.orbNftCount) {
      nftBalances.Orb = context.orbNftCount;
    }
    
    await db.collection(this.AVATARS_COLLECTION).updateOne(
      { _id: avatar._id },
      { 
        $set: {
          walletAddress,
          tokenBalances,
          nftBalances,
          walletTopTokens: Array.isArray(context.walletTopTokens)
            ? context.walletTopTokens.map(holding => ({
                symbol: holding.symbol,
                name: holding.name,
                mint: holding.mint,
                amount: Number.isFinite(holding.amount) ? holding.amount : 0,
                usdValue: Number.isFinite(holding.usdValue) ? holding.usdValue : null,
                price: Number.isFinite(holding.price) ? holding.price : null,
                decimals: Number.isFinite(holding.decimals) ? holding.decimals : null,
                change1h: Number.isFinite(holding.change1h) ? holding.change1h : null,
                change24h: Number.isFinite(holding.change24h) ? holding.change24h : null,
                change7d: Number.isFinite(holding.change7d) ? holding.change7d : null,
                change30d: Number.isFinite(holding.change30d) ? holding.change30d : null,
                updatedAt: new Date()
              }))
            : [],
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
    
    // Reload with wallet metadata
    avatar = await db.collection(this.AVATARS_COLLECTION).findOne({ _id: avatar._id });
    
    this.logger?.info?.(`[AvatarService] Created new wallet avatar ${avatar.emoji} ${avatar.name} for ${walletShort} - imageUrl: ${avatar.imageUrl ? 'EXISTS (' + (avatar.imageUrl.substring(0, 50)) + '...)' : 'NULL'}, isPartial: ${avatar.isPartial}`);
    
    // Activate in channel and optionally send introduction per token preferences
    if (shouldAutoActivate && context.discordChannelId) {
      try {
        // Activate in channel
        await this.activateAvatarInChannel(
          context.discordChannelId, 
          String(avatar._id)
        );
        this.logger?.info?.(`[AvatarService] Activated wallet avatar in channel ${context.discordChannelId}`);
        
        // Send introduction message (only for new avatars)
        if (shouldSendIntro && !avatar._existing && this.configService?.services?.discordService) {
          try {
            const balanceStr = normalizedBalance
              ? `${formatLargeNumber(normalizedBalance)} ${context.tokenSymbol || ''}`.trim()
              : `${context.tokenSymbol || 'their token position'}`;
            
            // Generate brief introduction (1 sentence, trading-themed)
            const introPrompt = [
              { 
                role: 'system', 
                content: `You are ${avatar.name}, ${avatar.description}. You're a Solana trader with ${balanceStr}.` 
              },
              { 
                role: 'user', 
                content: `You just made a ${context.tokenSymbol} trade. Introduce yourself briefly in ONE sentence (max 15 words). Be enthusiastic and trading-focused.` 
              }
            ];
            
            const intro = await this.aiService.chat(introPrompt, { temperature: 0.9 });
            const introText = typeof intro === 'object' && intro?.text ? intro.text : String(intro || '');
            
            if (introText && introText.length > 5 && !introText.includes('No response')) {
              // Send to Discord as webhook (avatar speaks!)
              await this.configService.services.discordService.sendAsWebhook(
                context.discordChannelId,
                `${avatar.emoji} *${introText.trim()}*`,
                avatar
              );
              
              // Send avatar embed to show their profile
              setTimeout(async () => {
                try {
                  await this.configService.services.discordService.sendMiniAvatarEmbed(
                    avatar,
                    context.discordChannelId,
                    `New trader detected!`
                  );
                } catch (embedError) {
                  this.logger?.warn?.(`[AvatarService] Failed to send avatar embed: ${embedError.message}`);
                }
              }, 500);
              
              this.logger?.info?.(`[AvatarService] Sent Discord introduction for wallet avatar ${avatar.name}`);
              
              // Also send to Telegram channel if configured
              if (context.telegramChannelId) {
                try {
                  const telegramService = this.configService?.services?.telegramService;
                  if (telegramService) {
                    const walletSlug = walletAddress.substring(0, 4) + '...' + walletAddress.slice(-4);
                    const telegramMessage = 
                      `${avatar.emoji} *New Trader: ${avatar.name}*\n\n` +
                      `_${introText.trim()}_\n\n` +
                      `🔗 Wallet: \`${walletSlug}\`\n` +
                      `💰 Balance: ${balanceStr}`;
                    
                    await telegramService.sendMessage(context.telegramChannelId, telegramMessage, {
                      parse_mode: 'Markdown'
                    });
                    
                    this.logger?.info?.(`[AvatarService] Sent Telegram introduction for wallet avatar ${avatar.name} to channel ${context.telegramChannelId}`);
                  }
                } catch (telegramErr) {
                  this.logger?.warn?.(`[AvatarService] Failed to send Telegram introduction: ${telegramErr.message}`);
                }
              }
            }
          } catch (introErr) {
            this.logger?.warn?.(`[AvatarService] Failed to send introduction: ${introErr.message}`);
          }
        }
      } catch (err) {
        this.logger?.warn?.(`[AvatarService] Failed to activate wallet avatar: ${err.message}`);
      }
    }
    
    return avatar;
  }

  /* -------------------------------------------------- */
  /*  MISC                                               */
  /* -------------------------------------------------- */

  generateRatiMetadata(avatar, storageUris) {
    return {
      tokenId: avatar._id.toString(),
      name: avatar.name,
      description: avatar.description,
      media: { image: avatar.imageUrl, video: avatar.videoUrl || null },
      attributes: [
        { trait_type: 'Personality', value: avatar.personality },
        { trait_type: 'Status', value: avatar.status },
        { trait_type: 'Lives', value: String(avatar.lives) },
      ],
      signature: null,
      storage: storageUris,
      evolution: {
        level: avatar.evolutionLevel || 1,
        previous: avatar.previousTokenIds || [],
        timestamp: avatar.updatedAt
      },
      memory: {
        recent: avatar.memoryRecent || null,
        archive: avatar.memoryArchive || null
      }
    };
  }

  async getInventoryItems(avatar) {
    if (!avatar) return [];
    const ids = [avatar.selectedItemId, avatar.storedItemId].filter(Boolean);
    if (!ids.length) return [];
    const db = await this._db();
    return db.collection('items').find({ _id: { $in: ids.map(toObjectId) } }).toArray();
  }

  /* -------------------------------------------------- */
  /*  BREED TRACKING                                     */
  /* -------------------------------------------------- */

  async getLastBredDate(avatarId) {
    try {
      const db = await this._db();
      const doc = await db.collection(this.AVATARS_COLLECTION).findOne(
        { _id: typeof avatarId === 'string' ? new ObjectId(avatarId) : avatarId },
        { projection: { lastBredAt: 1 } }
      );
      return doc?.lastBredAt || null;
    } catch (err) {
      this.logger.error(`getLastBredDate failed – ${err.message}`);
      return null;
    }
  }

  async setLastBredDate(avatarId, date = new Date()) {
    try {
      const db = await this._db();
      await db.collection(this.AVATARS_COLLECTION).updateOne(
        { _id: typeof avatarId === 'string' ? new ObjectId(avatarId) : avatarId },
        { $set: { lastBredAt: date, updatedAt: new Date() } }
      );
    } catch (err) {
      this.logger.error(`setLastBredDate failed – ${err.message}`);
    }
  }

  /* -------------------------------------------------- */
  /*  THOUGHTS MANAGEMENT                                */
  /* -------------------------------------------------- */

  /**
   * Get recent thoughts for an avatar
   * @param {string|ObjectId} avatarId - Avatar ID
   * @param {number} limit - Maximum number of thoughts to return (default: 10)
   * @returns {Promise<Array>} Array of thought objects
   */
  async getRecentThoughts(avatarId, limit = 10) {
    try {
      const db = await this._db();
      const avatar = await db.collection(this.AVATARS_COLLECTION).findOne(
        { _id: typeof avatarId === 'string' ? new ObjectId(avatarId) : avatarId },
        { projection: { thoughts: 1 } }
      );
      
      if (!avatar?.thoughts) return [];
      
      return avatar.thoughts
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);
    } catch (err) {
      this.logger.error(`getRecentThoughts failed – ${err.message}`);
      return [];
    }
  }

  /**
   * Add a thought to an avatar's thoughts collection
   * @param {string|ObjectId} avatarId - Avatar ID
   * @param {string} content - Thought content
   * @param {string} guildName - Guild name where thought occurred
   * @returns {Promise<boolean>} Success status
   */
  async addThought(avatarId, content, guildName = 'Unknown') {
    try {
      const db = await this._db();
      const thoughtData = {
        content: content.trim(),
        timestamp: Date.now(),
        guildName
      };

      const result = await db.collection(this.AVATARS_COLLECTION).updateOne(
        { _id: typeof avatarId === 'string' ? new ObjectId(avatarId) : avatarId },
        { 
          $push: { 
            thoughts: { 
              $each: [thoughtData], 
              $position: 0,
              $slice: 20  // Keep only the most recent 20 thoughts
            } 
          },
          $set: { updatedAt: new Date() }
        }
      );

      return result.modifiedCount > 0;
    } catch (err) {
      this.logger.error(`addThought failed – ${err.message}`);
      return false;
    }
  }
}
