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
  
  
    // 2) then apply your tribe restrictions
    const restrictions = guildConfig.avatarTribeRestrictions || {};
    const override = restrictions.channels?.[channelId];
    const mode = override?.mode || restrictions.default?.mode || 'permit';
    const exceptions = override?.emojis || restrictions.default?.emojis || [];
  
    let filtered = avatars.filter(av => av.status !== 'dead' && av.active !== false);
    if (mode === 'permit') {
      // permit all except listed exceptions
      filtered = exceptions.length
        ? filtered.filter(av => exceptions.includes(av.emoji))
        : filtered;
    } else {
      // forbid mode: only allow listed exceptions
      filtered = exceptions.length
        ? filtered.filter(av => !exceptions.includes(av.emoji))
        : [];
    }
  
    return filtered;
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
    const filters = { ...this._legacyToFilters(opts), name: { $regex: new RegExp(`^${name}$`, 'i') } };
    const db = await this._db();
    const avatar = await db.collection(this.AVATARS_COLLECTION).findOne(buildAvatarQuery(filters));
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

  async generateAvatarDetails(userPrompt, guildId = null) {
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

  async generateAvatarImage(prompt) {
    return this.schemaService.generateImage(prompt, '1:1');
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

  async createAvatar({ prompt, summoner, channelId, guildId }) {
    const details = await this.generateAvatarDetails(prompt, guildId);
    if (!details?.name) return null;

    const existing = await this.getAvatarByName(details.name);
    if (existing) return existing;

    const imageUrl = await this.generateAvatarImage(details.description);
    const model = await this.aiService.getModel(details.model);

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

    const file = await this.generateAvatarImage(avatar.description);
    if (!file) return false;

    const s3Url = await uploadImage(file); // assumed available in scope
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
}
