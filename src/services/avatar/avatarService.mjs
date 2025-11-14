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

const normalizeMentionText = (value = '') => String(value || '')
  .replace(/\([^)]*\)/g, ' ')
  .replace(/[^\w\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const mentionTokensFor = (value = '') => normalizeMentionText(value)
  .split(' ')
  .filter(token => token && (token.length >= 3 || /^\d+$/.test(token)));

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
    this.pendingAvatarImageHydrations = new Set();

  this.registeredCollectionCache = { keys: [], expiresAt: 0 };

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
  this.avatarsCollection.createIndex({ claimedBy: 1 }, { sparse: true }),
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
    if (avatar && !avatar.imageUrl && avatar.isPartial !== true) {
      await this._ensureAvatarImage(avatar, { reason: 'wallet-hydration' });
    }

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

    const baseContent = String(content);
    const lowerContent = baseContent.toLowerCase();
    const normalizedContent = normalizeMentionText(baseContent);
    const normalizedWords = normalizedContent ? normalizedContent.split(' ').filter(Boolean) : [];
    const normalizedWordSet = new Set(normalizedWords);
    const contentTokens = mentionTokensFor(baseContent);
    const contentTokenSet = new Set(contentTokens);

    // exact match / emoji first
    for (const av of avatars) {
      if (!av?._id || !av.name) continue;
      const name = String(av.name);
      const lowerName = name.toLowerCase();
      const normalizedName = normalizeMentionText(name);
      const nameTokens = mentionTokensFor(name);
      const nameMatch = lowerContent.includes(lowerName);
      const emojiMatch = av.emoji && content.includes(av.emoji);
      const normalizedMatch = normalizedName && normalizedContent.includes(normalizedName);
      const overlappingTokens = nameTokens.length && contentTokens.length
        ? contentTokens.filter(token => nameTokens.some(candidate =>
            candidate.startsWith(token) || token.startsWith(candidate)
          ))
        : [];
      const tokenMatch = overlappingTokens.length > 0;
  const strongOverlap = nameTokens.length > 0 && overlappingTokens.length >= Math.min(nameTokens.length, 2);
      const firstToken = nameTokens[0];
      const wordMatch = firstToken && normalizedWordSet.has(firstToken);
      const partialWordMatch = firstToken && normalizedWords.some(word =>
        word.length >= 3 && (firstToken.startsWith(word) || word.startsWith(firstToken))
      );
      const anyTokenDirectMatch = nameTokens.some(token => contentTokenSet.has(token));
      if (
        nameMatch ||
        emojiMatch ||
        normalizedMatch ||
        tokenMatch ||
        strongOverlap ||
        wordMatch ||
        partialWordMatch ||
        anyTokenDirectMatch
      ) {
        mentioned.add(av);
      }
    }

    // fuzzy on remaining
    const fuzzyPool = avatars
      .filter(a => !mentioned.has(a) && String(a?.name || '').trim().length >= 3)
      .map(av => ({
      avatar: av,
      name: av.name,
      normalizedName: normalizeMentionText(av.name || '')
      }));
    if (fuzzyPool.length) {
      const fuse = new Fuse(fuzzyPool, {
        keys: [
          { name: 'name', weight: 0.6 },
          { name: 'normalizedName', weight: 0.4 }
        ],
        threshold: 0.35,
        ignoreLocation: true
      });
      const queries = [baseContent, normalizedContent].filter(Boolean);
      for (const query of queries) {
        fuse.search(query).forEach(r => {
          if (r.score < 0.5) mentioned.add(r.item.avatar);
        });
      }
    }

    return mentioned;
  }

  /**
   * Match avatars from the provided list that are mentioned in content.
   * Applies multiple heuristics (normalized text, word boundaries, emoji) and
   * keeps the order in which avatars appear in the text.
   *
   * @param {string} content - User supplied text to scan
   * @param {Array<Object>} avatars - Avatars scoped to the current channel
   * @param {Object} [options]
   * @param {number|null} [options.limit] - Max avatars to return
   * @param {Array<string|ObjectId>} [options.excludeAvatarIds] - Avatar ids to skip
   * @returns {Array<Object>} ordered list of mentioned avatars
   */
  matchAvatarsByContent(content, avatars = [], options = {}) {
    if (!content || !Array.isArray(avatars) || avatars.length === 0) return [];

    const text = String(content || '');
    const lower = text.toLowerCase();
    const normalized = normalizeMentionText(text);
    const normalizedWords = normalized ? normalized.split(' ').filter(Boolean) : [];
    const wordPositions = new Map();
    normalizedWords.forEach((word, idx) => {
      if (!wordPositions.has(word)) {
        wordPositions.set(word, idx);
      }
    });
    const contentTokens = mentionTokensFor(text);
    const limit = Number.isInteger(options.limit) ? options.limit : null;
    const excludeIds = new Set((options.excludeAvatarIds || []).map(id => String(id)));

    const pushUnique = (collection, avatar) => {
      if (!avatar) return;
      const id = String(avatar._id || avatar.id || '');
      if (!id || excludeIds.has(id)) return;
      if (collection.some(av => String(av._id || av.id || '') === id)) return;
      collection.push(avatar);
    };

    const findWordIndex = (avatar) => {
      const tokens = mentionTokensFor(avatar?.name || '');
      for (const token of tokens) {
        if (wordPositions.has(token)) {
          return wordPositions.get(token);
        }
        const partialIdx = normalizedWords.findIndex(word =>
          word.length >= 3 && (token.startsWith(word) || word.startsWith(token))
        );
        if (partialIdx !== -1) return partialIdx;
      }
      return Number.MAX_SAFE_INTEGER;
    };

    const positionOf = (avatar) => {
      if (!avatar) return Number.MAX_SAFE_INTEGER;
      const wordIdx = findWordIndex(avatar);
      if (wordIdx !== Number.MAX_SAFE_INTEGER) return wordIdx;
      const name = String(avatar?.name || '').toLowerCase();
      const emoji = String(avatar?.emoji || '').toLowerCase();
      const nameIdx = name ? lower.indexOf(name) : -1;
      if (nameIdx >= 0) return normalizedWords.length + nameIdx;
      const emojiIdx = emoji ? lower.indexOf(emoji) : -1;
      if (emojiIdx >= 0) return normalizedWords.length + lower.length + emojiIdx;
      return Number.MAX_SAFE_INTEGER;
    };

    const hasWordOrTokenMatch = (avatar) => {
      if (!avatar) return false;
      const name = String(avatar?.name || '').trim();
      const emoji = String(avatar?.emoji || '').trim();
      const tokens = mentionTokensFor(name);
      const wordHit = tokens.some(token => wordPositions.has(token));
      const partialWordHit = tokens.some(token => normalizedWords.some(word =>
        word.length >= 3 && (token.startsWith(word) || word.startsWith(token))
      ));
      const tokenOverlap = contentTokens.length && tokens.length
        ? contentTokens.some(ct => tokens.some(token =>
            token.startsWith(ct) || ct.startsWith(token)
          ))
        : false;
      const emojiMatch = emoji && text.includes(emoji);
      return wordHit || partialWordHit || tokenOverlap || emojiMatch;
    };

    const matches = Array.from(this.extractMentionedAvatars(text, avatars));
    const orderedMatches = [];
    for (const match of matches) {
      pushUnique(orderedMatches, match);
    }

    for (const avatar of avatars) {
      if (limit !== null && orderedMatches.length >= limit) break;
      if (orderedMatches.some(av => String(av._id || av.id || '') === String(avatar?._id || avatar?.id || ''))) continue;
      if (!hasWordOrTokenMatch(avatar)) continue;
      pushUnique(orderedMatches, avatar);
    }

    orderedMatches.sort((a, b) => positionOf(a) - positionOf(b));

    if (limit !== null) {
      return orderedMatches.slice(0, Math.max(0, limit));
    }
    return orderedMatches;
  }

  /**
   * Convenience helper to detect mentions constrained to a single channel.
   */
  async detectMentionedAvatarsInChannel(content, channelId, guildId, options = {}) {
    if (!content || !channelId) return [];
    const avatars = options.avatars || await this.getAvatarsInChannel(channelId, guildId);
    return this.matchAvatarsByContent(content, avatars, options);
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
      const trimmedAddress = String(walletAddress).trim();
      const walletSummoner = `wallet:${trimmedAddress}`;

      const query = {
        $or: [
          { walletAddress: trimmedAddress },
          { summoner: walletSummoner }
        ]
      };

      if (!includeInactive) {
        query.status = { $ne: 'dead' };
      }

      const avatar = await db.collection(this.AVATARS_COLLECTION).findOne(query);

      if (avatar && avatar.walletAddress !== trimmedAddress) {
        try {
          await db.collection(this.AVATARS_COLLECTION).updateOne(
            { _id: avatar._id },
            {
              $set: {
                walletAddress: trimmedAddress,
                summoner: walletSummoner
              }
            }
          );
          avatar.walletAddress = trimmedAddress;
          avatar.summoner = walletSummoner;
        } catch (updateErr) {
          this.logger?.warn?.(`[AvatarService] Failed to normalize wallet avatar record for ${formatAddress(walletAddress)}: ${updateErr.message}`);
        }
      }

      return avatar;
    } catch (err) {
      this.logger?.error?.(`[AvatarService] Failed to get avatar by wallet address: ${err.message}`);
      return null;
    }
  }

  /**
   * Get all claimed NFT avatars for a wallet (via claimedBy field)
   * @param {string} walletAddress - Wallet address
   * @param {Object} options - Query options
   * @param {boolean} options.includeInactive - Include dead avatars (default: false)
   * @returns {Promise<Object[]>}
   */
  async getClaimedAvatarsByWallet(walletAddress, { includeInactive = false } = {}) {
    if (!walletAddress) return [];

    try {
      const db = await this._db();
      const query = { claimedBy: walletAddress };
      if (!includeInactive) {
        query.status = { $ne: 'dead' };
      }

      return await db.collection(this.AVATARS_COLLECTION)
        .find(query)
        .sort({ updatedAt: -1, createdAt: -1 })
        .toArray();
    } catch (err) {
      this.logger?.warn?.(`[AvatarService] Failed to get claimed avatars for wallet ${formatAddress(walletAddress)}: ${err.message}`);
      return [];
    }
  }

  /**
   * Get the highest priority claimed NFT avatar for a wallet.
   * Prefers avatars with NFT metadata, falls back to most recently updated.
   * @param {string} walletAddress
   * @param {Object} options
   * @param {boolean} options.includeInactive
   * @returns {Promise<Object|null>}
   */
  async getPrimaryClaimedAvatarForWallet(walletAddress, { includeInactive = false } = {}) {
    const claimed = await this.getClaimedAvatarsByWallet(walletAddress, { includeInactive });
    if (!claimed.length) {
      return null;
    }

    const nftBacked = claimed.find(av => av?.nft?.collection || av?.source === 'nft-sync');
    return nftBacked || claimed[0];
  }

  async getRegisteredNftCollectionKeys({ refresh = false } = {}) {
    const now = Date.now();
    if (!refresh && this.registeredCollectionCache && now < this.registeredCollectionCache.expiresAt) {
      return this.registeredCollectionCache.keys;
    }

    try {
      const db = await this._db();
      const configs = await db
        .collection('collection_configs')
        .find({}, {
          projection: {
            key: 1,
            aliases: 1,
            addresses: 1,
            alternateKeys: 1,
            collectionAddress: 1,
            collectionAddresses: 1,
            contractAddress: 1,
            contractAddresses: 1,
            mint: 1,
            mintAddresses: 1,
            gateTarget: 1,
          }
        })
        .toArray();

      const collected = new Set();
      const addValue = (value) => {
        if (typeof value !== 'string') {
          return;
        }
        const trimmed = value.trim();
        if (!trimmed) {
          return;
        }
        collected.add(trimmed);
      };

      for (const cfg of configs) {
        if (!cfg || typeof cfg !== 'object') {
          continue;
        }

        addValue(cfg.key);
        addValue(cfg.collectionAddress);
        addValue(cfg.contractAddress);
        addValue(cfg.mint);
        addValue(cfg.gateTarget);

        const candidateArrays = [
          cfg.aliases,
          cfg.addresses,
          cfg.alternateKeys,
          cfg.collectionAddresses,
          cfg.contractAddresses,
          cfg.mintAddresses,
        ];

        for (const arr of candidateArrays) {
          if (!Array.isArray(arr)) {
            continue;
          }
          for (const entry of arr) {
            addValue(entry);
          }
        }
      }

      const keys = Array.from(collected);
      this.registeredCollectionCache = {
        keys,
        expiresAt: now + 5 * 60_000,
      };

      return keys;
    } catch (error) {
      // collection configs might not exist yet; cache empty result briefly
      this.logger?.debug?.(`[AvatarService] getRegisteredNftCollectionKeys fallback: ${error.message}`);
      this.registeredCollectionCache = {
        keys: [],
        expiresAt: now + 60_000,
      };
      return [];
    }
  }

  _extractCollectionIdentifiersFromAsset(asset) {
    if (!asset || typeof asset !== 'object') {
      return [];
    }

    const values = new Set();
    const pushValue = (value) => {
      if (typeof value !== 'string') {
        return;
      }
      const trimmed = value.trim();
      if (!trimmed) {
        return;
      }
      values.add(trimmed);
    };

    pushValue(asset.collectionAddress);
    pushValue(asset.collectionMint);
    pushValue(asset.collectionId);
    pushValue(asset.collectionKey);
    pushValue(asset.collectionSlug);
    pushValue(asset.collectionName);
    if (typeof asset.collection === 'string') {
      pushValue(asset.collection);
    }

    const inspectObject = (obj) => {
      if (!obj || typeof obj !== 'object') {
        return;
      }
      pushValue(obj.address);
      pushValue(obj.id);
      pushValue(obj.mint);
      pushValue(obj.collectionAddress);
      pushValue(obj.contractAddress);
      pushValue(obj.collection);
      pushValue(obj.key);
      if (Array.isArray(obj.addresses)) {
        obj.addresses.forEach(pushValue);
      }
    };

    inspectObject(asset.collection);
    inspectObject(asset.collectionInfo);
    inspectObject(asset.collection_data);
    inspectObject(asset.collectionData);

    const inspectArray = (arr) => {
      if (!Array.isArray(arr)) {
        return;
      }
      for (const entry of arr) {
        if (typeof entry === 'string') {
          pushValue(entry);
        } else {
          inspectObject(entry);
        }
      }
    };

    inspectArray(asset.collections);
    inspectArray(asset.collectionAddresses);
    inspectArray(asset.collectionIds);

    const groupingCandidates = [];
    if (Array.isArray(asset.grouping)) groupingCandidates.push(asset.grouping);
    if (Array.isArray(asset.groupings)) groupingCandidates.push(asset.groupings);

    for (const groups of groupingCandidates) {
      for (const group of groups) {
        const rawKey = group?.group_key || group?.groupKey || group?.key || '';
        const normalizedKey = typeof rawKey === 'string' ? rawKey.toLowerCase() : '';
        if (normalizedKey && normalizedKey !== 'collection') {
          continue;
        }
        pushValue(group?.group_value || group?.groupValue || group?.value);
      }
    }

    if (asset.grouping && !Array.isArray(asset.grouping) && typeof asset.grouping === 'object') {
      const rawKey = asset.grouping.group_key || asset.grouping.groupKey || asset.grouping.key || '';
      const normalizedKey = typeof rawKey === 'string' ? rawKey.toLowerCase() : '';
      if (!normalizedKey || normalizedKey === 'collection') {
        pushValue(asset.grouping.group_value || asset.grouping.groupValue || asset.grouping.value);
      }
    }

    return Array.from(values);
  }

  _extractTokenIdentifiersFromAsset(asset) {
    if (!asset || typeof asset !== 'object') {
      return [];
    }

    const values = new Set();
    const addValue = (value) => {
      if (value === null || value === undefined) {
        return;
      }
      if (typeof value === 'bigint') {
        values.add(value.toString());
        return;
      }
      if (typeof value === 'number') {
        values.add(value.toString());
        return;
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) {
          values.add(trimmed);
        }
      }
    };

    addValue(asset.tokenId);
    addValue(asset.token_id);
    addValue(asset.tokenID);
    addValue(asset.tokenIDHex);
    addValue(asset.tokenIDNumeric);
    addValue(asset.id);
    addValue(asset.mint);
    addValue(asset.mintAddress);
    addValue(asset.mint_address);
    addValue(asset.address);
    addValue(asset.assetId);
    addValue(asset.nftId);
    addValue(asset.nft_id);
    addValue(asset.programId);

    const inspectObject = (obj) => {
      if (!obj || typeof obj !== 'object') {
        return;
      }
      addValue(obj.tokenId);
      addValue(obj.token_id);
      addValue(obj.id);
      addValue(obj.mint);
      addValue(obj.address);
      addValue(obj.nftId);
    };

    inspectObject(asset.token);
    inspectObject(asset.nft);
    inspectObject(asset.metadata);
    inspectObject(asset.content);

    if (Array.isArray(asset.tokenIds)) {
      asset.tokenIds.forEach(addValue);
    }

    return Array.from(values);
  }

  async findRandomOwnedCollectionAvatar(walletAddress, { restrictToCollections = null } = {}) {
    if (!walletAddress) {
      return null;
    }

    if (!this.walletInsights || typeof this.walletInsights.getWalletAssets !== 'function') {
      return null;
    }

    let registeredKeys;
    if (Array.isArray(restrictToCollections) && restrictToCollections.length > 0) {
      registeredKeys = restrictToCollections.map(key => String(key).trim()).filter(Boolean);
    } else {
      registeredKeys = await this.getRegisteredNftCollectionKeys();
    }

    if (!registeredKeys.length) {
      return null;
    }

    const normalizedCollections = new Set(
      registeredKeys
        .map(value => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
        .filter(Boolean)
    );

    let assets;
    try {
      assets = await this.walletInsights.getWalletAssets(walletAddress, { refresh: 'if-stale' });
    } catch (error) {
      this.logger?.warn?.(`[AvatarService] Failed to load wallet assets for ${formatAddress(walletAddress)}: ${error.message}`);
      return null;
    }

    if (!Array.isArray(assets) || assets.length === 0) {
      return null;
    }

    const tokenQueryValues = new Set();
    const tokenToCollections = new Map();

    for (const asset of assets) {
      const collectionIdentifiers = this._extractCollectionIdentifiersFromAsset(asset)
        .map(value => value.toLowerCase())
        .filter(value => normalizedCollections.has(value));

      if (!collectionIdentifiers.length) {
        continue;
      }

      const tokenIdentifiers = this._extractTokenIdentifiersFromAsset(asset);
      if (!tokenIdentifiers.length) {
        continue;
      }

      for (const tokenIdentifier of tokenIdentifiers) {
        const tokenString = String(tokenIdentifier).trim();
        if (!tokenString) {
          continue;
        }

        const normalizedToken = tokenString.toLowerCase();
        tokenQueryValues.add(tokenString);
        tokenQueryValues.add(normalizedToken);

        let collectionSet = tokenToCollections.get(normalizedToken);
        if (!collectionSet) {
          collectionSet = new Set();
          tokenToCollections.set(normalizedToken, collectionSet);
        }

        for (const collection of collectionIdentifiers) {
          collectionSet.add(collection);
        }
      }
    }

    if (tokenQueryValues.size === 0) {
      return null;
    }

    let candidateAvatars = [];
    try {
      const db = await this._db();
      candidateAvatars = await db.collection(this.AVATARS_COLLECTION)
        .find({
          'nft.tokenId': { $in: Array.from(tokenQueryValues) },
          status: { $ne: 'dead' }
        })
        .toArray();
    } catch (error) {
      this.logger?.warn?.(`[AvatarService] Failed to load NFT avatars for ${formatAddress(walletAddress)}: ${error.message}`);
      return null;
    }

    if (!candidateAvatars.length) {
      return null;
    }

    const filtered = candidateAvatars.filter(avatar => {
      const tokenIdRaw = avatar?.nft?.tokenId;
      if (!tokenIdRaw && !avatar?.nft?.mint) {
        return false;
      }
      const tokenIdString = (tokenIdRaw || avatar?.nft?.mint)?.toString?.().trim?.() || '';
      if (!tokenIdString) {
        return false;
      }
      const normalizedToken = tokenIdString.toLowerCase();
      const collectionSet = tokenToCollections.get(normalizedToken);
      if (!collectionSet || collectionSet.size === 0) {
        return false;
      }
      const avatarCollection = (avatar?.nft?.collection || avatar?.collection || '')
        .toString()
        .trim()
        .toLowerCase();
      if (!avatarCollection) {
        return false;
      }
      return collectionSet.has(avatarCollection);
    });

    if (!filtered.length) {
      return null;
    }

    const randomIndex = Math.floor(Math.random() * filtered.length);
    return filtered[randomIndex];
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

  _canGenerateAvatarImages() {
    if (!this.schemaService?.generateImage) return false;
    try {
      const replicateConfig = this.configService?.getAIConfig?.('replicate') || {};
      const apiToken = replicateConfig.apiToken || process.env.REPLICATE_API_TOKEN;
      return Boolean(apiToken);
    } catch (error) {
      this.logger?.warn?.(`[AvatarService] Failed to inspect Replicate config: ${error.message}`);
      return false;
    }
  }

  async _ensureAvatarImage(avatar, { reason = 'hydrate', prompt = null, force = false } = {}) {
    if (!avatar) return null;
    if (!force && avatar.imageUrl) return avatar;
    if (!force && avatar.isPartial === true) return avatar;
    if (!this._canGenerateAvatarImages()) {
      this.logger?.debug?.(`[AvatarService] Skipping image hydration for ${avatar?.name || avatar?._id}: Replicate not configured`);
      return avatar;
    }

    let objectId = null;
    try {
      objectId = toObjectId(avatar._id);
    } catch {
      this.logger?.warn?.(`[AvatarService] Cannot hydrate avatar image without valid _id (got ${avatar?._id})`);
      return avatar;
    }

    const cacheKey = objectId.toHexString();
    if (this.pendingAvatarImageHydrations.has(cacheKey)) {
      return avatar;
    }

    const generationPrompt = (typeof prompt === 'string' && prompt.trim())
      || (typeof avatar.description === 'string' && avatar.description.trim())
      || `${avatar.emoji || ''} ${avatar.name || 'avatar'}`.trim();

    if (!generationPrompt) {
      this.logger?.warn?.(`[AvatarService] Unable to hydrate image for ${avatar?.name || cacheKey}: no prompt available`);
      return avatar;
    }

    this.pendingAvatarImageHydrations.add(cacheKey);
    try {
      const uploadOptions = {
        source: `avatar.hydration.${reason}`,
        avatarId: cacheKey,
        avatarName: avatar.name,
        avatarEmoji: avatar.emoji,
        prompt: generationPrompt
      };

      const imageUrl = await this.generateAvatarImage(generationPrompt, uploadOptions);
      if (!imageUrl) {
        this.logger?.warn?.(`[AvatarService] Replicate returned no image for ${avatar?.name || cacheKey}`);
        return avatar;
      }

      const db = await this._db();
      const updatedAt = new Date();
      const update = {
        imageUrl,
        updatedAt
      };
      if (avatar.isPartial === true) {
        update.isPartial = false;
        update.upgradedAt = updatedAt;
      }

      await db.collection(this.AVATARS_COLLECTION).updateOne({ _id: objectId }, { $set: update });

      avatar.imageUrl = imageUrl;
      avatar.updatedAt = updatedAt;
      if (avatar.isPartial === true) {
        avatar.isPartial = false;
        avatar.upgradedAt = updatedAt;
      }
    } catch (error) {
      this.logger?.warn?.(`[AvatarService] Failed to hydrate missing image for ${avatar?.name || cacheKey}: ${error.message}`);
    } finally {
      this.pendingAvatarImageHydrations.delete(cacheKey);
    }

    return avatar;
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

    const existing = await this._checkExistingAvatar(details.name);
    if (existing) return existing;

    let imageUrl = null;
    if (imageUrlOverride) {
      imageUrl = imageUrlOverride;
    } else {
      try {
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

    const now = new Date();
    const insertDoc = {
      ...details,
      imageUrl,
      model,
      channelId: channelId || null,
      summoner: summoner ? String(summoner) : null,
      guildId: guildId || null,
      lives: 3,
      status: 'alive',
      createdAt: now,
      updatedAt: now
    };

    const db = await this._db();
    const collection = db.collection(this.AVATARS_COLLECTION);
    const result = await collection.findOneAndUpdate(
      { name: details.name },
      {
        $setOnInsert: insertDoc,
        $set: { updatedAt: now }
      },
      { upsert: true, returnDocument: 'after' }
    );

    const createdAvatar = result.value;
    if (!createdAvatar) {
      this.logger?.error?.(`[AvatarService] Failed to create or fetch avatar for ${details.name}`);
      return null;
    }

    const isNew = Boolean(result.lastErrorObject?.upserted);
    if (!isNew) {
      createdAvatar._existing = true;
      createdAvatar.stats = createdAvatar.stats || await this.getOrCreateStats(createdAvatar);
      return createdAvatar;
    }

    if (!createdAvatar.imageUrl) {
      await this._ensureAvatarImage(createdAvatar, { reason: 'post-create', force: true });
    }

    try {
      const autoPost = String(process.env.X_AUTO_POST_AVATARS || 'false').toLowerCase();
      if (autoPost === 'true' && createdAvatar.imageUrl && this.configService?.services?.xService) {
        const posted = await db.collection('social_posts').findOne({ imageUrl: createdAvatar.imageUrl, mediaType: 'image' });
        if (!posted) {
          try {
            let admin = null;
            const envId = resolveAdminAvatarId();
            if (envId && /^[a-f0-9]{24}$/i.test(envId)) {
              admin = await this.configService.services.avatarService.getAvatarById(envId);
            } else {
              const aiCfg = this.configService?.getAIConfig?.(process.env.AI_SERVICE);
              const modelId = aiCfg?.chatModel || aiCfg?.model || process.env.OPENROUTER_CHAT_MODEL || process.env.GOOGLE_AI_CHAT_MODEL || 'default';
              const safe = String(modelId).toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
              admin = { _id: `model:${safe}`, name: `System (${modelId})`, username: process.env.X_ADMIN_USERNAME || undefined };
            }
            if (admin) {
              const content = `${createdAvatar.emoji || ''} Meet ${createdAvatar.name} — ${createdAvatar.description}`.trim().slice(0, 240);
              try {
                eventBus.emit('MEDIA.IMAGE.GENERATED', {
                  type: 'image',
                  source: 'avatar.create',
                  avatarId: createdAvatar._id,
                  imageUrl: createdAvatar.imageUrl,
                  prompt: createdAvatar.description,
                  avatarName: createdAvatar.name,
                  avatarEmoji: createdAvatar.emoji,
                  context: content,
                  createdAt: new Date()
                });
              } catch {}
              await this.configService.services.xService.postImageToX(admin, createdAvatar.imageUrl, content);
            }
          } catch (e) { this.logger?.warn?.(`[AvatarService] auto X post (avatar) failed: ${e.message}`); }
        }
      }
    } catch (e) { this.logger?.debug?.(`[AvatarService] auto X post (avatar) skipped: ${e.message}`); }

    return createdAvatar;
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
    const guildIdForWallet = context?.guildId;
    if (guildIdForWallet && this.configService?.getGuildConfig) {
      try {
        const guildConfig = await this.configService.getGuildConfig(guildIdForWallet);
        const guildAvatarModes = guildConfig?.avatarModes || {};
        if (guildAvatarModes.wallet === false) {
          const reason = `Wallet avatars disabled for guild ${guildIdForWallet}`;
          this.logger?.info?.(`[AvatarService] ${reason}`);
          throw new Error(reason);
        }
      } catch (modeError) {
        if (modeError?.message?.includes('disabled for guild')) throw modeError;
        this.logger?.warn?.(`[AvatarService] Failed to evaluate wallet avatar mode for guild ${guildIdForWallet}: ${modeError.message}`);
      }
    }

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
    const configuredCollectionKeys = Array.isArray(walletAvatarPrefs.collectionKeys)
      ? walletAvatarPrefs.collectionKeys.map(value => String(value).trim()).filter(Boolean)
      : [];
    const normalizedCollectionKeySet = new Set(configuredCollectionKeys.map(value => value.toLowerCase()));
    const requireCollectionOwnership = context.requireCollectionOwnership === true || walletAvatarPrefs.requireCollectionOwnership === true;

    const extractCollectionIdentifier = (candidate) => {
      if (!candidate) return null;
      const raw = candidate?.nft?.collection || candidate?.collection || null;
      if (!raw) return null;
      const normalized = String(raw).trim().toLowerCase();
      return normalized || null;
    };

    const hasMatchingConfiguredCollection = (candidate) => {
      const normalized = extractCollectionIdentifier(candidate);
      if (!normalized) return false;
      if (normalizedCollectionKeySet.size === 0) {
        return true;
      }
      return normalizedCollectionKeySet.has(normalized);
    };

    const hasNftAssociation = (candidate) => {
      if (!candidate) return false;
      if (candidate.claimed === true || Boolean(candidate.claimedBy)) return true;
      if (candidate.source === 'nft-sync') return true;
      return hasMatchingConfiguredCollection(candidate);
    };

    const satisfiesCollectionRequirement = (candidate) => {
      if (!requireCollectionOwnership) return true;
      if (!candidate) return false;
      if (normalizedCollectionKeySet.size > 0) {
        return hasMatchingConfiguredCollection(candidate);
      }
      return hasMatchingConfiguredCollection(candidate) || candidate.claimed === true || Boolean(candidate.claimedBy);
    };

    const minBalanceForFullAvatar = Number.isFinite(walletAvatarPrefs.minBalanceForFullAvatar)
      ? walletAvatarPrefs.minBalanceForFullAvatar
      : 0;

    const hasPositiveBalance = normalizedBalance > 0;
    const meetsFullAvatarThreshold = normalizedBalance > minBalanceForFullAvatar;
    const isEligibleForFullAvatar = Boolean(walletAvatarPrefs.createFullAvatar) && meetsFullAvatarThreshold;
    const shouldAutoActivate = Boolean(walletAvatarPrefs.autoActivate);
    const shouldSendIntro = Boolean(walletAvatarPrefs.sendIntro);
    const requireClaimedAvatar = context.requireClaimedAvatar === true;

    // Check if avatar already exists for this wallet (uses indexed query)
    let avatar = null;
    let claimedSource = false;

    if (!requireClaimedAvatar) {
      const existingAvatar = await this.getAvatarByWalletAddress(walletAddress);
      if (existingAvatar) {
        if (satisfiesCollectionRequirement(existingAvatar)) {
          avatar = existingAvatar;
          claimedSource = hasNftAssociation(existingAvatar);
        } else if (requireCollectionOwnership) {
          this.logger?.info?.(`[AvatarService] Skipping existing wallet avatar ${existingAvatar.emoji || '🛸'} ${existingAvatar.name || 'Unnamed'} for ${walletShort}: collection NFT required.`);
        }
      }
    }

    const claimedAvatar = await this.getPrimaryClaimedAvatarForWallet(walletAddress);
    if (claimedAvatar) {
      if (satisfiesCollectionRequirement(claimedAvatar)) {
        avatar = claimedAvatar;
        claimedSource = hasNftAssociation(claimedAvatar) || claimedSource;
        this.logger?.info?.(`[AvatarService] Using claimed NFT avatar ${claimedAvatar.emoji || '🛸'} ${claimedAvatar.name || 'Unnamed'} for ${walletShort}`);
      } else if (requireCollectionOwnership) {
        this.logger?.info?.(`[AvatarService] Claimed avatar ${claimedAvatar.emoji || '🛸'} ${claimedAvatar.name || 'Unnamed'} does not satisfy collection requirement for ${walletShort}`);
      }
    }

    if (!avatar) {
      const ownedCollectionAvatar = await this.findRandomOwnedCollectionAvatar(walletAddress, {
        restrictToCollections: configuredCollectionKeys.length ? configuredCollectionKeys : null
      });
      
      if (ownedCollectionAvatar) {
        avatar = ownedCollectionAvatar;
        claimedSource = hasNftAssociation(ownedCollectionAvatar) || claimedSource;
        this.logger?.info?.(`[AvatarService] Wallet ${walletShort} owns registered collection avatar ${ownedCollectionAvatar.emoji || '🛸'} ${ownedCollectionAvatar.name || 'Unnamed'}${configuredCollectionKeys.length ? ` (restricted to: ${configuredCollectionKeys.join(', ')})` : ''}`);
      }
    }

    if (!avatar && requireCollectionOwnership) {
      this.logger?.info?.(`[AvatarService] requireCollectionOwnership enabled but no matching collection avatar found for ${walletShort}`);
      return null;
    }

    if (!avatar && requireClaimedAvatar) {
      this.logger?.info?.(`[AvatarService] requireClaimedAvatar enabled but no claimed avatar found for ${walletShort}`);
      return null;
    }

    const effectiveShouldAutoActivate = claimedSource ? true : shouldAutoActivate;
    const effectiveShouldSendIntro = claimedSource ? false : shouldSendIntro;
    
    if (avatar) {
      // Check if we need to upgrade a partial avatar to full avatar (add image)
      const isPartialAvatar = !avatar.imageUrl;
      const needsUpgrade = isPartialAvatar && isEligibleForFullAvatar;
      
      // Debug logging for upgrade decision
      this.logger?.info?.(`[AvatarService] Existing avatar ${avatar.emoji} ${avatar.name} - imageUrl: ${avatar.imageUrl ? 'EXISTS' : 'NULL'}, isPartial: ${isPartialAvatar}, hasBalance: ${hasPositiveBalance}, balance: ${normalizedBalance}, fullAvatarAllowed: ${Boolean(walletAvatarPrefs.createFullAvatar)}, meetsThreshold: ${meetsFullAvatarThreshold}, needsUpgrade: ${needsUpgrade}`);
      
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
        lastActivityAt: new Date(),
        updatedAt: new Date(),
      };

      if (walletAddress && avatar.walletAddress !== walletAddress) {
        updateData.walletAddress = walletAddress;
      }
      
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
      
      const nextChannelId = context.discordChannelId || context.channelId || null;
      if (nextChannelId && nextChannelId !== avatar.channelId) {
        updateData.channelId = nextChannelId;
      }

      const nextGuildId = context.guildId || context.discordGuildId || null;
      if (nextGuildId && nextGuildId !== avatar.guildId) {
        updateData.guildId = nextGuildId;
      }

      if (!avatar.summoner || !avatar.summoner.startsWith('wallet:')) {
        updateData.summoner = `wallet:${walletAddress}`;
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

  const claimedActivationTarget = context.discordChannelId || context.channelId || avatar.channelId;
      if ((claimedSource || avatar.claimed === true || Boolean(avatar.claimedBy)) && claimedActivationTarget) {
        try {
          await this.activateAvatarInChannel(claimedActivationTarget, String(avatar._id));
          this.logger?.info?.(`[AvatarService] Ensured claimed NFT avatar ${avatar.name} is active in channel ${claimedActivationTarget}`);
        } catch (activationError) {
          this.logger?.warn?.(`[AvatarService] Failed to activate claimed avatar ${avatar.name} in channel ${context.discordChannelId}: ${activationError.message}`);
        }
      }
      return avatar;
    }
    
  // Create new avatar - token preferences decide whether to generate a full image
    
    // Build prompt for avatar creation
    const tokenInfo = context.tokenSymbol ? `${context.tokenSymbol} holder` : 'trader';
    const balanceInfo = normalizedBalance 
      ? `with ${formatLargeNumber(normalizedBalance)} ${context.tokenSymbol || ''}`.trim()
      : '';

    let avatarPromptTheme = null;
    if (this.configService) {
      try {
        if (context.guildId && this.configService.getGuildConfig) {
          const guildConfig = await this.configService.getGuildConfig(context.guildId);
          avatarPromptTheme = guildConfig?.prompts?.avatarTheme || null;
        }
      } catch (themeError) {
        this.logger?.warn?.(`[AvatarService] Failed to load avatar prompt theme for guild ${context.guildId}: ${themeError.message}`);
      }

      if (!avatarPromptTheme) {
        avatarPromptTheme = this.configService?.config?.prompt?.avatarTheme || null;
      }
    }

    const promptSegments = [
      `Create a character for wallet ${walletShort}, a Solana ${tokenInfo} ${balanceInfo}. Make them unique and memorable.`
    ];

    if (avatarPromptTheme) {
      promptSegments.push(`Use the server's avatar prompt theme as creative direction: ${avatarPromptTheme}.`);
    }

    if (configuredCollectionKeys.length) {
      promptSegments.push(`Infuse visual or personality cues inspired by these NFT collections: ${configuredCollectionKeys.join(', ')}.`);
    } else if (requireCollectionOwnership) {
      promptSegments.push('Reflect the prestige of holding exclusive collection NFTs.');
    }

    if (Array.isArray(context.walletTopTokens) && context.walletTopTokens.length) {
      const topSymbols = context.walletTopTokens
        .map(entry => entry?.symbol || entry?.mint)
        .filter(Boolean)
        .slice(0, 3);
      if (topSymbols.length) {
        promptSegments.push(`Subtly nod to their top holdings (${topSymbols.join(', ')}) in their story or aesthetic.`);
      }
    }

    const prompt = promptSegments.join(' ');
    
    // Create avatar with retries
    let retries = 0;
    const maxRetries = 2;
    
    while (!avatar && retries < maxRetries) {
      try {
  this.logger?.info?.(`[AvatarService] Creating wallet avatar for ${walletShort} (attempt ${retries + 1}/${maxRetries}, hasBalance: ${hasPositiveBalance}, meetsThreshold: ${meetsFullAvatarThreshold}, fullAvatarEligible: ${isEligibleForFullAvatar})`);
        
  if (isEligibleForFullAvatar) {
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
          fullAvatarEligible: isEligibleForFullAvatar
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
  const activationTargetChannel = context.discordChannelId || context.channelId || avatar.channelId || null;

    if (effectiveShouldAutoActivate && activationTargetChannel) {
      try {
        // Activate in channel
        await this.activateAvatarInChannel(
          activationTargetChannel, 
          String(avatar._id)
        );
        this.logger?.info?.(`[AvatarService] Activated wallet avatar in channel ${activationTargetChannel}`);
        
        // Send introduction message (only for new avatars)
        if (effectiveShouldSendIntro && !avatar._existing && this.configService?.services?.discordService) {
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
                activationTargetChannel,
                `${avatar.emoji} *${introText.trim()}*`,
                avatar
              );
              
              // Send avatar embed to show their profile
              setTimeout(async () => {
                try {
                  await this.configService.services.discordService.sendMiniAvatarEmbed(
                    avatar,
                    activationTargetChannel,
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
