/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

// MapService.mjs – ESM rewrite with in‑memory caching & avatarGateway
// ---------------------------------------------------------------
//  * depends on avatar/avatarGateway.js
//  * uses an internal Map for position caching (positionsCache)
//  * delegates all avatar manipulation to AvatarGateway instead of
//    duplicating queries here
//  * provides atomic updateAvatarPosition() with Mongo session
//  * all public read methods fall back to DB if cache miss and update
//    the cache transparently
// ---------------------------------------------------------------

import { createAvatarGateway } from '../avatar/avatarGateway.js';

export class MapService {
  constructor({ logger, databaseService, configService, discordService, locationService }) {
    this.logger          = logger || console;
    this.databaseService = databaseService;
    this.configService   = configService;
    this.discordService  = discordService;
    this.locationService = locationService;

    // façade over AvatarService methods we need
    this.avatarGateway = createAvatarGateway({ databaseService });

    // memo caches
    this.positionsCache = new Map(); // avatarId → { locationId, lastMoved }

    // collection names
    this.AVATARS_COLLECTION          = 'avatars';
    this.LOCATIONS_COLLECTION        = 'locations';
    this.DUNGEON_POSITIONS_COLLECTION = 'dungeon_positions';
    this.DUNGEON_STATS_COLLECTION    = 'dungeon_stats';

    this.db = null;
  }

  /* -------------------------------------------------- */
  /*  INITIALISATION                                    */
  /* -------------------------------------------------- */

  async _db() {
    return this.db || (this.db = await this.databaseService.getDatabase());
  }

  async initializeDatabase() {
    const db  = await this._db();
    const col = (name, init) => {
      if (!init) return;
      db.createCollection(name).catch(() => {/* already exists */});
    };

    const existing = (await db.listCollections().toArray()).map(c => c.name);
    if (!existing.includes(this.LOCATIONS_COLLECTION))        col(this.LOCATIONS_COLLECTION, true);
    if (!existing.includes(this.DUNGEON_POSITIONS_COLLECTION)) {
      col(this.DUNGEON_POSITIONS_COLLECTION, true);
      await db.collection(this.DUNGEON_POSITIONS_COLLECTION).createIndex({ avatarId: 1 }, { unique: true });
    }
    if (!existing.includes(this.DUNGEON_STATS_COLLECTION)) {
      col(this.DUNGEON_STATS_COLLECTION, true);
      await db.collection(this.DUNGEON_STATS_COLLECTION).createIndex({ avatarId: 1 }, { unique: true });
    }
    this.logger.info('MapService: dungeon DB ready');
  }

  /* -------------------------------------------------- */
  /*  LOCATION HELPERS                                  */
  /* -------------------------------------------------- */

  async getLocationDescription({ channelId, name }) {
    const db = await this._db();
    const loc = await db.collection(this.LOCATIONS_COLLECTION).findOne({
      $or: [ { channelId }, { name } ]
    });
    return loc?.description || null;
  }

  async findLocation(term) {
    const db = await this._db();
    return db.collection(this.LOCATIONS_COLLECTION).findOne({
      $or: [ { channelId: term }, { id: term }, { name: { $regex: new RegExp(term,'i') } } ]
    });
  }

  /* -------------------------------------------------- */
  /*  AVATAR ↔ LOCATION RELATIONS                       */
  /* -------------------------------------------------- */

  async getAvatarLocation(avatar) {
    const cached = this.positionsCache.get(avatar._id?.toString());
    if (cached) return cached;

    const db   = await this._db();
    const pos = await db.collection(this.DUNGEON_POSITIONS_COLLECTION)
                        .findOne({ avatarId: avatar._id });
    if (pos) {
      this.positionsCache.set(avatar._id.toString(), pos);
      return pos;
    }

    // fallback: derive from avatar.channelId
    const avatarData = await this.avatarGateway.getAvatarById(avatar._id);
    if (!avatarData) throw new Error(`Avatar ${avatar._id} not found`);

    const derived = { locationId: avatarData.channelId, avatarId: avatarData._id };
    this.positionsCache.set(avatar._id.toString(), derived);
    // write‑back for consistency (ignore race)
    db.collection(this.DUNGEON_POSITIONS_COLLECTION).updateOne(
      { avatarId: avatar._id }, { $setOnInsert: derived }, { upsert: true }
    ).catch(()=>{});
    return derived;
  }

  /**
   * Atomically update both dungeon_positions and avatar.channelId.
   * Delegates avatar update to AvatarGateway to avoid direct coupling.
   */
  async updateAvatarPosition(avatar, newLocationId) {
    const db = await this._db();
    const session = db.client.startSession();

    try {
      await session.withTransaction(async () => {
        await db.collection(this.DUNGEON_POSITIONS_COLLECTION).updateOne(
          { avatarId: avatar._id },
          { $set: { locationId: newLocationId, lastMoved: new Date() } },
          { upsert: true, session }
        );

        await this.avatarGateway.updateChannelId(avatar._id, newLocationId, session);
      });
    } finally {
      await session.endSession();
    }

    // refresh cache
    this.positionsCache.set(avatar._id.toString(), { locationId: newLocationId, avatarId: avatar._id, lastMoved: new Date() });
  }

  async getAvatarPosition(avatarId) {
    return this.getAvatarLocation(avatarId); // alias for clarity
  }

  /* -------------------------------------------------- */
  /*  LOCATION + AVATARS                                */
  /* -------------------------------------------------- */

  async getLocationAndAvatars(locationId) {
    const db = await this._db();

    // location info via LocationService façade (async cache inside service)
    const location = await this.locationService.getLocationByChannelId(locationId);
    if (!location) throw new Error(`Location ${locationId} not found`);

    // all avatars whose stored position OR channelId matches the location
    const posDocs = await db.collection(this.DUNGEON_POSITIONS_COLLECTION).find({ locationId }).toArray();
    const idsInPos = posDocs.map(p => p.avatarId);

    const avatars = await db.collection(this.AVATARS_COLLECTION).find({
      $or: [ { channelId: locationId }, { _id: { $in: idsInPos } } ]
    }).toArray();

    return { location, avatars };
  }
}
