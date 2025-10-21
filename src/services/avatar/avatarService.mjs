import { resolveAdminAvatarId } from '../social/adminAvatarResolver.mjs';
/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

// AvatarService.mjs – fully ESM, generic‑filter version
// -------------------------------------------------------
//  * requires helpers/buildAvatarQuery.mjs (see previous message)
//  * remove the bespoke `_buildAvatarQuery` logic; every query is derived
//    from a flexible `filters` object via buildAvatarQuery()
//  * public APIs that accepted includeStatus / emoji / traits … now take
//    a single `{ filters, … }` bag. A tiny compatibility layer still
//    translates the old signature so existing callers will not break.
// -------------------------------------------------------

import process from 'process';
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
      this.avatarsCollection.createIndex({ name: 1 }),
      this.avatarsCollection.createIndex({ channelId: 1 }),
      this.avatarsCollection.createIndex({ createdAt: -1 }),
      this.avatarsCollection.createIndex({ messageCount: -1 }),
      this.messagesCollection.createIndex({ timestamp: 1 }),
      this.channelsCollection.createIndex({ lastActive: 1 }),
    ]);

    this.logger.info('AvatarService database setup completed.');
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
      
      await presenceCol.updateOne(
        { channelId, avatarId },
        { 
          $set: { lastActivityAt: new Date() },
          $setOnInsert: { 
            isActive: true,
            createdAt: new Date(),
            activatedAt: new Date()
          }
        },
        { upsert: true }
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

  async generateAvatarImage(prompt, uploadOptions = {}) {
    return this.schemaService.generateImage(prompt, '1:1', uploadOptions);
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
        const raw = await this.aiService.chat(fallbackPrompt, { max_tokens: 128 });
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

    // Sanitize name: avoid pure numeric / HTTP status or error-looking tokens.
    try {
      const orig = details.name.trim();
      const isHttpCode = /^(?:HTTP_)?(4\d\d|5\d\d)$/.test(orig);
      const isJustDigits = /^\d{3,}$/.test(orig);
      const hasErrorMarkers = /⚠️|\[Error|No response|failed|invalid/i.test(orig);
      const hasMarkdown = /^-#|^#/.test(orig);
      
      if (!orig || isHttpCode || isJustDigits || hasErrorMarkers || hasMarkdown) {
        this.logger?.error?.(`[AvatarService] Cannot create avatar: invalid/error-like name detected: '${orig}'`);
        return null;
      }
      
      // Strip any accidental 'Error:' prefixes inserted by malformed upstream responses
      details.name = details.name.replace(/^Error[:\s-]+/i, '').trim();
      
      // Final validation: name must be reasonable length
      if (details.name.length < 2 || details.name.length > 50) {
        this.logger?.error?.(`[AvatarService] Cannot create avatar: name length invalid (${details.name.length}): '${details.name}'`);
        return null;
      }
    } catch (e) {
      this.logger?.error?.(`[AvatarService] Name sanitization failed: ${e?.message || e}`);
      return null;
    }

    const existing = await this.getAvatarByName(details.name);
  // If an avatar with this generated name already exists, return it and
  // flag as existing so callers (e.g. SummonTool) can avoid treating it
  // as freshly created (prevent duplicate introductions, stat overrides, etc.)
  if (existing) return { ...existing, _existing: true };

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
              // Event already emitted by S3Service during upload with full metadata
              // Direct X posting for backwards compatibility
              await this.configService.services.xService.postImageToX(admin, doc.imageUrl, content);
            }
          } catch (e) { this.logger?.warn?.(`[AvatarService] auto X post (avatar) failed: ${e.message}`); }
        }
      }
    } catch (e) { this.logger?.debug?.(`[AvatarService] auto X post (avatar) skipped: ${e.message}`); }

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
