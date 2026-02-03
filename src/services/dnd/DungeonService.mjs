/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * DungeonService - Procedural dungeon generation and management
 */

import { ObjectId } from 'mongodb';
import { randomInt } from 'crypto';
import { DiceService } from '../battle/diceService.mjs';
import eventBus from '../../utils/eventBus.mjs';

// Legacy imports for fallback compatibility
import { getMonstersByCR, calculateEncounterXP } from '../../data/dnd/monsters.mjs';
import { rollTreasure, getItem as getDndItem } from '../../data/dnd/items.mjs';

/**
 * RoomImageCache - Caches room images to avoid regenerating for same room types
 * Uses declining probability algorithm similar to MonsterService
 * Includes LRU eviction to prevent unbounded memory growth
 */
class RoomImageCache {
  constructor() {
    this.cache = new Map(); // key: "theme:roomType" → { images: [...], usageCount: number, lastAccessedAt: number }
    this.maxImagesPerType = 5;
    this.minGenerateProbability = 0.1; // Floor at 10% for variety
    this.maxCacheSize = 50; // Max number of theme:roomType combinations to cache
    this.maxAgeMs = 24 * 60 * 60 * 1000; // Evict entries older than 24 hours
    
    // Schedule periodic cleanup every hour
    this._cleanupInterval = setInterval(() => this._evictStale(), 60 * 60 * 1000);
    if (this._cleanupInterval.unref) this._cleanupInterval.unref();
  }

  _rand01() {
    // 0 <= x < 1, using crypto RNG
    return randomInt(0, 1_000_000) / 1_000_000;
  }
  
  getCacheKey(theme, roomType) {
    return `${theme}:${roomType}`;
  }
  
  /**
   * Get or generate room image using declining probability
   * P(generate) = max(0.1, 1 / (n + 1)) where n = cached images
   * @param {string} theme - Dungeon theme
   * @param {string} roomType - Room type
   * @param {Function} generateFn - Async function to generate image
   * @returns {Promise<string|null>} Image URL
   */
  async getOrGenerate(theme, roomType, generateFn) {
    const key = this.getCacheKey(theme, roomType);
    let entry = this.cache.get(key);
    
    if (!entry) {
      // Evict oldest entry if at capacity
      if (this.cache.size >= this.maxCacheSize) {
        this._evictOldest();
      }
      entry = { images: [], totalUsage: 0, lastAccessedAt: Date.now() };
      this.cache.set(key, entry);
    }
    
    // Update access time
    entry.lastAccessedAt = Date.now();
    
    const n = entry.images.length;
    const probGenerate = Math.max(this.minGenerateProbability, 1 / (n + 1));
    const roll = this._rand01();
    
    // Generate new image if roll says so OR no cached images
    if (roll < probGenerate || n === 0) {
      try {
        const newImage = await generateFn();
        if (newImage && entry.images.length < this.maxImagesPerType) {
          entry.images.push({ url: newImage, usageCount: 1 });
        }
        return newImage;
      } catch {
        // Fall through to cached if generation fails
      }
    }
    
    // Select from cache (weighted by inverse usage for variety)
    if (entry.images.length > 0) {
      return this._selectWeighted(entry.images);
    }
    
    return null;
  }
  
  _selectWeighted(images) {
    if (images.length === 1) {
      images[0].usageCount++;
      return images[0].url;
    }
    
    const weights = images.map(img => 1 / (img.usageCount + 1));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let roll = this._rand01() * totalWeight;
    
    for (let i = 0; i < images.length; i++) {
      roll -= weights[i];
      if (roll <= 0) {
        images[i].usageCount++;
        return images[i].url;
      }
    }
    images[0].usageCount++;
    return images[0].url;
  }
  
  /**
   * Evict the oldest (least recently accessed) cache entry
   * @private
   */
  _evictOldest() {
    let oldestKey = null;
    let oldestTime = Infinity;
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
  
  /**
   * Evict entries older than maxAgeMs
   * @private
   */
  _evictStale() {
    const now = Date.now();
    const keysToDelete = [];
    
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.lastAccessedAt > this.maxAgeMs) {
        keysToDelete.push(key);
      }
    }
    
    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }
  
  /**
   * Clear all cached images
   */
  clear() {
    this.cache.clear();
  }
  
  /**
   * Get cache statistics for debugging
   */
  getStats() {
    const stats = {
      totalEntries: this.cache.size,
      maxSize: this.maxCacheSize,
      entries: {}
    };
    for (const [key, entry] of this.cache.entries()) {
      stats.entries[key] = {
        imageCount: entry.images.length,
        totalUsage: entry.images.reduce((sum, img) => sum + img.usageCount, 0),
        ageMinutes: Math.round((Date.now() - entry.lastAccessedAt) / 60000)
      };
    }
    return stats;
  }
}

// Singleton instance for room image caching
const roomImageCache = new RoomImageCache();

const ROOM_WEIGHTS = {
  combat: 40,
  treasure: 20,
  puzzle: 15,
  rest: 10,
  shop: 5,
  empty: 10
};

const ROOM_EMOJIS = {
  combat: '⚔️',
  treasure: '💰',
  puzzle: '🧩',
  rest: '🏕️',
  shop: '🛒',
  empty: '🚪',
  boss: '💀',
  entrance: '🚪'
};

const DUNGEON_THEMES = ['crypt', 'cave', 'castle', 'ruins', 'sewers', 'forest'];

const DIFFICULTY_ROOMS = {
  easy: { min: 4, max: 6 },
  medium: { min: 5, max: 8 },
  hard: { min: 7, max: 10 },
  deadly: { min: 9, max: 12 }
};

// Entrance puzzle definitions
const ENTRANCE_PUZZLES = {
  crypt: [
    { riddle: 'What walks on four legs in the morning, two at noon, and three in the evening?', answer: 'human', hint: 'Think about the ages of life.' },
    { riddle: 'I am not alive, yet I grow; I don\'t have lungs, but I need air; I don\'t have a mouth, but water kills me. What am I?', answer: 'fire', hint: 'I flicker and dance.' },
    { riddle: 'The more you take, the more you leave behind. What am I?', answer: 'footsteps', hint: 'Look down as you walk.' }
  ],
  cave: [
    { riddle: 'I can be cracked, made, told, and played. What am I?', answer: 'joke', hint: 'I bring laughter.' },
    { riddle: 'What has a head and a tail but no body?', answer: 'coin', hint: 'Flip me to decide.' },
    { riddle: 'I have cities, but no houses. I have mountains, but no trees. I have water, but no fish. What am I?', answer: 'map', hint: 'I guide travelers.' }
  ],
  castle: [
    { riddle: 'What can you catch but not throw?', answer: 'cold', hint: 'Achoo!' },
    { riddle: 'I speak without a mouth and hear without ears. I have no body, but I come alive with the wind. What am I?', answer: 'echo', hint: 'Hello... hello... hello...' },
    { riddle: 'What has keys but no locks, space but no room, and you can enter but can\'t go inside?', answer: 'keyboard', hint: 'Type your answer.' }
  ],
  ruins: [
    { riddle: 'What gets wetter the more it dries?', answer: 'towel', hint: 'You use me after bathing.' },
    { riddle: 'What can travel around the world while staying in a corner?', answer: 'stamp', hint: 'I\'m found on letters.' },
    { riddle: 'I have branches, but no fruit, trunk, or leaves. What am I?', answer: 'bank', hint: 'Money grows on me.' }
  ],
  sewers: [
    { riddle: 'What has an eye but cannot see?', answer: 'needle', hint: 'I help you sew.' },
    { riddle: 'What comes once in a minute, twice in a moment, but never in a thousand years?', answer: 'm', hint: 'Look at the letters.' },
    { riddle: 'What can fill a room but takes up no space?', answer: 'light', hint: 'Flip the switch.' }
  ],
  forest: [
    { riddle: 'What has roots that nobody sees, is taller than trees, up it goes yet never grows?', answer: 'mountain', hint: 'I touch the clouds.' },
    { riddle: 'What belongs to you but others use it more than you do?', answer: 'name', hint: 'Hello, nice to meet you.' },
    { riddle: 'I can be long or short; I can be grown or bought; I can be painted or left bare; I can be round or square. What am I?', answer: 'nails', hint: 'Found on fingers and in hardware stores.' }
  ]
};

// Export room image cache for use by DungeonTool
export { roomImageCache };

export class DungeonService {
  static _combatEndedListener = null;

  constructor({ databaseService, partyService, characterService, monsterService, combatEncounterService, discordService, locationService, itemService, logger }) {
    this.databaseService = databaseService;
    this.partyService = partyService;
    this.characterService = characterService;
    this.monsterService = monsterService;
    this.combatEncounterService = combatEncounterService;
    this.discordService = discordService;
    this.locationService = locationService;
    this.itemService = itemService;
    this.diceService = new DiceService();
    this.logger = logger;
    this._collection = null;
    
    // Listen for combat end events to resolve dungeon encounters (H-1)
    this._setupCombatListener();
  }
  
  /**
   * Set up listener for combat end events
   * @private
   */
  _setupCombatListener() {
    if (DungeonService._combatEndedListener) {
      if (eventBus.off) {
        eventBus.off('combat.dungeon.ended', DungeonService._combatEndedListener);
      } else if (eventBus.removeListener) {
        eventBus.removeListener('combat.dungeon.ended', DungeonService._combatEndedListener);
      }
    }

    DungeonService._combatEndedListener = async (data) => {
      try {
        const { dungeonId, roomId, winners, combatants, reason } = data;
        if (!dungeonId || !roomId) return;
        
        this.logger?.info?.(`[DungeonService] Received combat.dungeon.ended for dungeon ${dungeonId}, room ${roomId}, reason=${reason}`);
        
        // Build combat result from event data
        const combatResult = {
          winners: (winners || []).map(w => ({
            name: w.name,
            isMonster: w.isMonster || false
          })),
          combatants,
          reason // Pass the end reason (room_cleared, tpk, flee, etc.)
        };
        
        await this.resolveCombat(dungeonId, roomId, combatResult);
      } catch (e) {
        this.logger?.error?.(`[DungeonService] combat.dungeon.ended handler error: ${e.message}`);
      }
    };

    eventBus.on('combat.dungeon.ended', DungeonService._combatEndedListener);
  }

  async collection() {
    if (!this._collection) {
      const db = await this.databaseService.getDatabase();
      this._collection = db.collection('dungeons');
      await this._ensureIndexes();
    }
    return this._collection;
  }

  async _ensureIndexes() {
    try {
      await this._collection.createIndex({ partyId: 1 });
      await this._collection.createIndex({ status: 1, createdAt: -1 });
      await this._collection.createIndex({ channelId: 1, status: 1 });
    } catch (e) {
      this.logger?.warn?.('[DungeonService] Index creation:', e.message);
    }
  }

  async getDungeon(dungeonId) {
    const col = await this.collection();
    return col.findOne({ _id: new ObjectId(dungeonId) });
  }

  /**
   * Repair a dungeon by repopulating missing encounters
   * Used when combat rooms have no monsters due to MonsterService failures
   * @param {ObjectId} dungeonId - Dungeon ID
   * @returns {Promise<Object>} Updated dungeon
   */
  async repairDungeonEncounters(dungeonId) {
    const col = await this.collection();
    const dungeon = await col.findOne({ _id: new ObjectId(dungeonId) });
    if (!dungeon) return null;

    let modified = false;
    for (const room of dungeon.rooms) {
      // Check if room should have an encounter but doesn't
      const needsEncounter = ['combat', 'boss'].includes(room.type);
      const hasNoMonsters = !room.encounter?.monsters?.length;
      const notCleared = !room.cleared;

      if (needsEncounter && hasNoMonsters && notCleared) {
        this.logger?.info?.(`[DungeonService] Repairing empty encounter in room ${room.id} (${room.type})`);
        // Use stored partySize for proper scaling (default to 4 for legacy dungeons)
        const partySize = dungeon.partySize || 4;
        room.encounter = await this._generateEncounter(
          room.type === 'boss' ? 'boss' : 'regular',
          dungeon.partyLevel,
          dungeon.theme,
          partySize
        );
        modified = true;
      }
    }

    if (modified) {
      await col.updateOne(
        { _id: new ObjectId(dungeonId) },
        { $set: { rooms: dungeon.rooms } }
      );
      this.logger?.info?.(`[DungeonService] Repaired encounters for dungeon ${dungeonId}`);
    }

    return col.findOne({ _id: new ObjectId(dungeonId) });
  }

  async getActiveDungeon(partyId) {
    const col = await this.collection();
    return col.findOne({ partyId: new ObjectId(partyId), status: 'active' });
  }

  /**
   * Get active dungeon by channel ID (one dungeon per channel)
   * @param {string} channelId - Discord channel ID
   * @returns {Promise<Object|null>} Active dungeon or null
   */
  async getActiveDungeonByChannel(channelId) {
    if (!channelId) return null;
    const col = await this.collection();
    // Check both channelId and threadId - a dungeon thread IS its location
    return col.findOne({ 
      $or: [{ channelId }, { threadId: channelId }], 
      status: 'active' 
    });
  }

  /**
   * Get dungeon by its location ID
   * @param {ObjectId} locationId - Location ID
   * @returns {Promise<Object|null>} Dungeon or null
   */
  async getDungeonByLocationId(locationId) {
    if (!locationId) return null;
    const col = await this.collection();
    return col.findOne({ locationId: new ObjectId(locationId) });
  }

  /**
   * Set the channel ID for a dungeon
   * @param {ObjectId} dungeonId - Dungeon ID
   * @param {string} channelId - Discord channel ID
   */
  async setChannelId(dungeonId, channelId) {
    const col = await this.collection();
    await col.updateOne(
      { _id: new ObjectId(dungeonId) },
      { $set: { channelId } }
    );
  }

  /**
   * Set the thread ID for a dungeon and create/link location record
   * @param {ObjectId} dungeonId - Dungeon ID
   * @param {string} threadId - Discord thread ID
   */
  async setThreadId(dungeonId, threadId) {
    const col = await this.collection();
    const dungeon = await col.findOne({ _id: new ObjectId(dungeonId) });
    
    // Create a location record for this dungeon thread
    // Contract:
    // - `locationChannelId` is the Discord thread id (gameplay key)
    // - `locationDocId`/`locationId` is locations._id (story metadata)
    const locationChannelId = threadId || null;
    let locationDocId = null;
    if (threadId && this.locationService) {
      try {
        const db = await this.databaseService.getDatabase();
        const locationsCol = db.collection('locations');
        
        // Check if location already exists for this thread
        const existingLocation = await locationsCol.findOne({ channelId: threadId });
        
        if (existingLocation) {
          locationDocId = existingLocation._id;
          // Update it to be marked as dungeon type
          await locationsCol.updateOne(
            { _id: existingLocation._id },
            { $set: { 
              type: 'dungeon',
              dungeonId: new ObjectId(dungeonId),
              updatedAt: new Date().toISOString()
            }}
          );
        } else {
          // Create new location for the dungeon
          const locationDoc = {
            name: dungeon?.name || 'Dungeon',
            description: `A ${dungeon?.theme || 'mysterious'} dungeon - ${dungeon?.difficulty || 'unknown'} difficulty.`,
            channelId: threadId,
            type: 'dungeon',
            dungeonId: new ObjectId(dungeonId),
            parentId: dungeon?.channelId || null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            version: '1.0.0'
          };
          const result = await locationsCol.insertOne(locationDoc);
          locationDocId = result.insertedId;
        }
        
        this.logger?.info?.(`[DungeonService] Linked dungeon ${dungeonId} to location ${locationDocId}`);
      } catch (e) {
        this.logger?.warn?.(`[DungeonService] Failed to create location for dungeon: ${e.message}`);
      }
    }
    
    await col.updateOne(
      { _id: new ObjectId(dungeonId) },
      { $set: { threadId, locationChannelId, locationDocId, locationId: locationDocId } }
    );
  }

  async generateDungeon(partyId, { difficulty = 'medium', theme = null, channelId = null } = {}) {
    const party = await this.partyService.getParty(partyId);
    if (!party) throw new Error('Party not found');

    // Check no active dungeon
    const active = await this.getActiveDungeon(partyId);
    if (active) throw new Error('Party already in a dungeon');

    // Get average party level
    const partyLevel = await this._getAverageLevel(party);
    const selectedTheme = theme || DUNGEON_THEMES[this.diceService.rollDie(DUNGEON_THEMES.length) - 1];
    const roomCount = this._getRoomCount(difficulty);

    const rooms = [];

    // Entrance room with puzzle
    const entranceRoom = this._createRoom('room_1', 'entrance', partyLevel, 'entrance', difficulty, selectedTheme);
    entranceRoom.puzzle = this._generateEntrancePuzzle(selectedTheme);
    rooms.push(entranceRoom);

    // Generate middle rooms
    for (let i = 2; i < roomCount; i++) {
      const type = this._weightedRandom(ROOM_WEIGHTS);
      rooms.push(this._createRoom(`room_${i}`, type, partyLevel, null, difficulty, selectedTheme));
    }

    // Boss room
    rooms.push(this._createRoom(`room_${roomCount}`, 'boss', partyLevel, null, difficulty, selectedTheme));

    // Connect rooms (linear with some branches)
    this._connectRooms(rooms);

    // Populate encounters asynchronously (uses MonsterService with bonding curve)
    // Pass party size for proper encounter scaling
    const partySize = party.members?.length || 1;
    await this._populateEncounters(rooms, partyLevel, selectedTheme, partySize);

    const dungeonName = this._generateName(selectedTheme);
    
    const dungeon = {
      name: dungeonName,
      theme: selectedTheme,
      difficulty,
      partyLevel,
      partySize, // Store for encounter repairs
      rooms,
      currentRoom: 'room_1',
      partyId: new ObjectId(partyId),
      channelId: channelId || null,
      threadId: null,
      locationChannelId: null, // Discord thread id (gameplay location key)
      locationDocId: null, // locations._id (metadata)
      locationId: null, // legacy alias of locationDocId
      status: 'active',
      entrancePuzzleSolved: false,
      createdAt: new Date(),
      completedAt: null
    };

    const col = await this.collection();
    const result = await col.insertOne(dungeon);

    await this.partyService.setDungeon(partyId, result.insertedId);

    this.logger?.info?.(`[DungeonService] Generated ${difficulty} ${selectedTheme} dungeon for party ${partyId}`);
    return { ...dungeon, _id: result.insertedId };
  }

  async _getAverageLevel(party) {
    let totalLevel = 0;
    for (const member of party.members) {
      const sheet = member.sheet || (await this.characterService?.getSheet(member.avatarId));
      totalLevel += sheet?.level || 1;
    }
    return Math.max(1, Math.round(totalLevel / party.members.length));
  }

  _getRoomCount(difficulty) {
    const range = DIFFICULTY_ROOMS[difficulty] || DIFFICULTY_ROOMS.medium;
    return this.diceService.rollDie(range.max - range.min + 1) + range.min - 1;
  }

  _weightedRandom(weights) {
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    let roll = this.diceService.rollDie(total);
    
    for (const [type, weight] of Object.entries(weights)) {
      roll -= weight;
      if (roll <= 0) return type;
    }
    return 'combat';
  }

  _createRoom(id, type, partyLevel, override = null, difficulty = 'medium', theme = 'crypt') {
    const effectiveType = override || type;
    
    // Rooms that don't require any action to clear
    const autoCleared = ['rest', 'shop', 'empty'].includes(effectiveType);
    
    const room = {
      id,
      type: effectiveType,
      threadId: null,
      cleared: autoCleared, // Auto-clear passive rooms
      connections: [],
      encounter: null,
      // Mark rooms that need async encounter generation
      _needsEncounter: type === 'combat' || type === 'boss',
      _encounterType: type
    };

    if (type === 'treasure') {
      room.encounter = this._generateTreasure(partyLevel, difficulty);
    }

    // Generate puzzle for puzzle-type rooms (non-entrance puzzles)
    if (type === 'puzzle') {
      room.puzzle = this._generateEntrancePuzzle(theme);
    }

    return room;
  }

  /**
   * Populate encounters for rooms that need them (async operation)
   * @private
   */
  async _populateEncounters(rooms, partyLevel, theme, partySize = 4) {
    for (const room of rooms) {
      if (room._needsEncounter) {
        room.encounter = await this._generateEncounter(room._encounterType, partyLevel, theme, partySize);
        delete room._needsEncounter;
        delete room._encounterType;
      }
    }
    return rooms;
  }

  async _generateEncounter(type, partyLevel, theme = 'cave', partySize = 4) {
    // Scale XP budget by actual party size (minimum 1)
    // Solo players get reduced encounters, full parties get full challenge
    const effectivePartySize = Math.max(1, Math.min(6, partySize));
    const baseBudget = type === 'boss'
      ? partyLevel * 100
      : partyLevel * 50;
    const budget = baseBudget * effectivePartySize;

    // Cap monster count based on party size to prevent overwhelming solo players
    const maxMonsters = Math.max(2, effectivePartySize + 1);

    const monsters = await this._selectMonsters(budget, partyLevel, type === 'boss', theme, maxMonsters);
    
    // Calculate XP - use monsterService if available, otherwise fallback
    const xpValue = this.monsterService
      ? this.monsterService.calculateEncounterXP(monsters)
      : calculateEncounterXP(monsters);

    return {
      monsters,
      xpValue,
      defeated: false
    };
  }

  /**
   * Select monsters for an encounter using MonsterService with bonding curve
   * Falls back to static monsters if MonsterService unavailable
   * @private
   * @param {number} budget - XP budget for the encounter
   * @param {number} partyLevel - Average party level
   * @param {boolean} isBoss - Whether this is a boss encounter
   * @param {string} theme - Dungeon theme/habitat
   * @param {number} maxMonsters - Maximum number of monsters (scaled by party size)
   */
  async _selectMonsters(budget, partyLevel, isBoss, theme = 'cave', maxMonsters = 6) {
    // Use MonsterService if available
    if (this.monsterService) {
      return this._selectMonstersFromService(budget, partyLevel, isBoss, theme, maxMonsters);
    }

    // Fallback to static monster selection
    return this._selectMonstersStatic(budget, partyLevel, isBoss, maxMonsters);
  }

  /**
   * Select monsters using MonsterService (dynamic, with bonding curve)
   * @private
   * @param {number} budget - XP budget
   * @param {number} partyLevel - Average party level
   * @param {boolean} isBoss - Boss encounter flag
   * @param {string} theme - Dungeon theme
   * @param {number} maxMonsters - Max monster count (scaled by party size)
   */
  async _selectMonstersFromService(budget, partyLevel, isBoss, theme, maxMonsters = 6) {
    const monsters = [];
    let remaining = budget;

    // Map theme to habitat
    const habitats = [theme];

    if (isBoss) {
      // Select a boss monster (elite or boss role)
      const { monster: bossMonster } = await this.monsterService.selectMonsterForEncounter({
        habitats,
        role: 'elite',
        targetLevel: partyLevel
      });

      if (bossMonster) {
        // Ensure monster has an image (generate and persist if missing)
        const imageUrl = await this.monsterService.getOrGenerateImage(bossMonster);
        
        monsters.push({
          monsterId: bossMonster.monsterId,
          id: bossMonster.monsterId, // Backwards compatibility
          name: bossMonster.name,
          emoji: bossMonster.emoji,
          stats: bossMonster.stats,
          attacks: bossMonster.attacks,
          cr: bossMonster.cr,
          xp: bossMonster.xp,
          imageUrl,
          count: 1
        });
        remaining -= bossMonster.xp;
      }
    }

    // Fill remaining budget with minions (capped by party-size-scaled maxMonsters)
    const _minionBudget = remaining;
    let minionCount = 0;
    const effectiveMaxMinions = Math.max(1, maxMonsters - (isBoss ? 1 : 0));

    while (remaining > 0 && minionCount < effectiveMaxMinions) {
      // V5 FIX: Use maxXP filter to ensure monsters fit within budget
      // This prevents selecting a CR 1 (200 XP) monster for a 50 XP budget
      const maxXPForMonster = Math.max(25, remaining); // Minimum 25 XP to allow smallest monsters
      
      const { monster: minion } = await this.monsterService.selectMonsterForEncounter({
        habitats,
        role: isBoss ? 'minion' : null, // Mixed roles if not a boss encounter
        targetLevel: Math.max(1, partyLevel - 1),
        maxXP: maxXPForMonster  // V5: Add budget constraint
      }, {
        forceExisting: minionCount > 0 // After first minion, prefer existing to avoid too many generations
      });

      if (!minion || minion.xp > remaining) break;

      // Check if we already have this monster type
      const existing = monsters.find(m => m.monsterId === minion.monsterId);
      if (existing) {
        existing.count++;
      } else {
        // Ensure monster has an image (generate and persist if missing)
        const imageUrl = await this.monsterService.getOrGenerateImage(minion);
        
        monsters.push({
          monsterId: minion.monsterId,
          id: minion.monsterId,
          name: minion.name,
          emoji: minion.emoji,
          stats: minion.stats,
          attacks: minion.attacks,
          cr: minion.cr,
          xp: minion.xp,
          imageUrl,
          count: 1
        });
      }

      remaining -= minion.xp;
      minionCount++;
    }

    // If MonsterService returned no monsters, fall back to static selection
    if (monsters.length === 0) {
      this.logger?.warn?.(`[DungeonService] MonsterService returned no monsters for ${theme}, falling back to static`);
      return this._selectMonstersStatic(budget, partyLevel, isBoss, maxMonsters);
    }

    return monsters;
  }

  /**
   * Fallback static monster selection (original implementation)
   * @private
   * @param {number} budget - XP budget
   * @param {number} partyLevel - Average party level  
   * @param {boolean} isBoss - Boss encounter flag
   * @param {number} maxMonsters - Max monster count (scaled by party size)
   */
  async _selectMonstersStatic(budget, partyLevel, isBoss, maxMonsters = 6) {
    const monsters = [];
    let remaining = budget;

    if (isBoss) {
      // Pick a single strong monster
      const bossCR = Math.min(5, Math.max(1, Math.floor(partyLevel / 2) + 1));
      const bossOptions = getMonstersByCR(bossCR);
      if (bossOptions.length > 0) {
        const boss = bossOptions[this.diceService.rollDie(bossOptions.length) - 1];
        // V5 FIX: Generate image for static monsters via MonsterService if available
        let imageUrl = null;
        if (this.monsterService) {
          try {
            // Look up the seeded monster in the database and get/generate its image
            const dbMonster = await this.monsterService.getMonstersByTags({ role: null }).then(ms => 
              ms.find(m => m.monsterId === boss.id || m.name === boss.name)
            );
            if (dbMonster) {
              imageUrl = await this.monsterService.getOrGenerateImage(dbMonster);
            }
          } catch (e) {
            this.logger?.warn?.(`[DungeonService] Failed to get image for ${boss.name}: ${e.message}`);
          }
        }
        monsters.push({ 
          id: boss.id, 
          name: boss.name, 
          emoji: boss.emoji, 
          stats: boss.stats,
          attacks: boss.attacks,
          imageUrl,
          count: 1 
        });
        remaining -= boss.xp;
      }
    }

    // Fill with minions (capped by maxMonsters)
    const targetCR = isBoss ? 0.25 : Math.min(1, partyLevel / 4);
    const minions = getMonstersByCR(targetCR);
    
    if (minions.length > 0) {
      const minion = minions[this.diceService.rollDie(minions.length) - 1];
      const count = Math.max(1, Math.floor(remaining / minion.xp));
      const effectiveMax = Math.max(1, maxMonsters - (isBoss ? 1 : 0));
      if (count > 0) {
        // V5 FIX: Generate image for static monsters via MonsterService if available
        let imageUrl = null;
        if (this.monsterService) {
          try {
            const dbMonster = await this.monsterService.getMonstersByTags({ role: null }).then(ms => 
              ms.find(m => m.monsterId === minion.id || m.name === minion.name)
            );
            if (dbMonster) {
              imageUrl = await this.monsterService.getOrGenerateImage(dbMonster);
            }
          } catch (e) {
            this.logger?.warn?.(`[DungeonService] Failed to get image for ${minion.name}: ${e.message}`);
          }
        }
        monsters.push({ 
          id: minion.id, 
          name: minion.name, 
          emoji: minion.emoji, 
          stats: minion.stats,
          attacks: minion.attacks,
          imageUrl,
          count: Math.min(count, effectiveMax) 
        });
      }
    }

    return monsters;
  }

  /**
   * Generate treasure for a treasure room using the new loot tables
   * @param {number} partyLevel - Average party level
   * @param {string} difficulty - Dungeon difficulty (easy, medium, hard, deadly)
   * @returns {Object} Treasure encounter with gold and items
   */
  _generateTreasure(partyLevel, difficulty = 'medium') {
    // Use the new rollTreasure system with proper loot tables
    const rollDie = (sides) => this.diceService.rollDie(sides);
    const treasure = rollTreasure(difficulty, partyLevel, rollDie);
    
    return {
      gold: treasure.gold,
      items: treasure.items,
      collected: false
    };
  }

  _connectRooms(rooms) {
    // Linear connections
    for (let i = 0; i < rooms.length - 1; i++) {
      rooms[i].connections.push(rooms[i + 1].id);
    }

    // Add some branches for larger dungeons
    if (rooms.length > 6) {
      const branchPoint = Math.floor(rooms.length / 3);
      const branchTarget = Math.floor(rooms.length * 2 / 3);
      rooms[branchPoint].connections.push(rooms[branchTarget].id);
    }
  }

  _generateName(theme) {
    const prefixes = {
      crypt: ['Ancient', 'Forgotten', 'Cursed', 'Dark'],
      cave: ['Deep', 'Crystal', 'Shadow', 'Echoing'],
      castle: ['Ruined', 'Haunted', 'Lost', 'Fallen'],
      ruins: ['Crumbling', 'Sunken', 'Overgrown', 'Silent'],
      sewers: ['Fetid', 'Flooded', 'Winding', 'Infested'],
      forest: ['Twisted', 'Enchanted', 'Thorny', 'Misty']
    };

    const suffixes = {
      crypt: ['Crypt', 'Tomb', 'Catacombs', 'Mausoleum'],
      cave: ['Caverns', 'Depths', 'Grotto', 'Hollow'],
      castle: ['Keep', 'Fortress', 'Citadel', 'Stronghold'],
      ruins: ['Ruins', 'Temple', 'Sanctuary', 'Halls'],
      sewers: ['Sewers', 'Tunnels', 'Undercity', 'Warrens'],
      forest: ['Grove', 'Thicket', 'Woods', 'Glade']
    };

    const prefix = prefixes[theme]?.[this.diceService.rollDie(4) - 1] || 'Dark';
    const suffix = suffixes[theme]?.[this.diceService.rollDie(4) - 1] || 'Dungeon';

    return `The ${prefix} ${suffix}`;
  }

  async enterRoom(dungeonId, roomId) {
    const dungeon = await this.getDungeon(dungeonId);
    if (!dungeon) throw new Error('Dungeon not found');

    const room = dungeon.rooms.find(r => r.id === roomId);
    if (!room) throw new Error('Room not found');

    // Check room is accessible
    const currentRoom = dungeon.rooms.find(r => r.id === dungeon.currentRoom);
    if (!currentRoom.connections.includes(roomId) && dungeon.currentRoom !== roomId) {
      throw new Error('Room not accessible');
    }

    // Rooms that block advancement until cleared/solved
    const requiresClearing = ['combat', 'boss'].includes(currentRoom.type);
    const hasUnsolvedPuzzle = currentRoom.puzzle && !currentRoom.puzzle.solved;
    
    if (dungeon.currentRoom !== roomId && !currentRoom.cleared) {
      // Check puzzle first - puzzle rooms may not be combat/boss type but still block
      if (hasUnsolvedPuzzle) {
        throw new Error('Must solve the puzzle before advancing');
      }
      if (requiresClearing) {
        throw new Error('Must clear current room before advancing');
      }
    }

    const col = await this.collection();
    await col.updateOne(
      { _id: dungeon._id },
      { $set: { currentRoom: roomId } }
    );

    // Return fresh dungeon doc so callers always see updated currentRoom.
    const updatedDungeon = await col.findOne({ _id: dungeon._id });
    return { room, dungeon: updatedDungeon || dungeon };
  }

  /**
   * Clear a room after it's been completed
   * C-3 fix: Combat/boss rooms can only be cleared through combat resolution
   * @param {string} dungeonId - The dungeon ID
   * @param {string} roomId - The room ID
   * @param {Object} [options] - Options
   * @param {boolean} [options.combatVictory] - True if called from combat resolution
   * @param {boolean} [options.force] - Force clear (for admin/debug)
   */
  async clearRoom(dungeonId, roomId, options = {}) {
    const dungeon = await this.getDungeon(dungeonId);
    if (!dungeon) throw new Error('Dungeon not found');

    const roomIndex = dungeon.rooms.findIndex(r => r.id === roomId);
    if (roomIndex === -1) throw new Error('Room not found');

    const room = dungeon.rooms[roomIndex];
    
    // Already cleared
    if (room.cleared) {
      return { room, xpAwarded: 0, dungeonComplete: false, alreadyCleared: true };
    }

    // C-3 fix: Combat/boss rooms require combat victory to clear
    const isCombatRoom = room.type === 'combat' || room.type === 'boss';
    if (isCombatRoom && room.encounter?.monsters?.length && !options.combatVictory && !options.force) {
      throw new Error('Combat rooms must be cleared through combat. Use the Fight button to start combat.');
    }

    const xpAwarded = room.encounter?.xpValue || 0;

    const col = await this.collection();
    await col.updateOne(
      { _id: dungeon._id },
      { $set: { [`rooms.${roomIndex}.cleared`]: true } }
    );

    // Award XP to party
    if (xpAwarded > 0) {
      await this.partyService.distributeXP(dungeon.partyId, xpAwarded);
    }

    // Check if dungeon complete (boss cleared)
    const isBoss = room.type === 'boss';
    if (isBoss) {
      await this.completeDungeon(dungeonId);
    }

    return { room, xpAwarded, dungeonComplete: isBoss };
  }

  /**
   * Start a combat encounter for a room (DS-1 fix: combat integration)
   * This integrates with the existing CombatEncounterService
   * @param {string} dungeonId - The dungeon ID
   * @param {string} roomId - The room ID
   * @param {string} channelId - Discord channel ID for the encounter
   * @returns {Promise<Object>} The created encounter or null if room has no combat
   */
  async startRoomCombat(dungeonId, roomId, channelId) {
    if (!this.combatEncounterService) {
      this.logger?.warn?.('[DungeonService] CombatEncounterService not available, skipping combat');
      return null;
    }

    const dungeon = await this.getDungeon(dungeonId);
    if (!dungeon) throw new Error('Dungeon not found');

    const room = dungeon.rooms.find(r => r.id === roomId);
    if (!room) throw new Error('Room not found');

    // Only combat and boss rooms have encounters
    if (room.type !== 'combat' && room.type !== 'boss' && room.type !== 'entrance') {
      return null;
    }

    // Room already cleared
    if (room.cleared) {
      return null;
    }

    // No monsters in encounter
    if (!room.encounter?.monsters?.length) {
      return null;
    }

    // Get party avatars
    const party = await this.partyService.getPartyWithAvatars(dungeon.partyId);
    if (!party) throw new Error('Party not found');

    // Mark party avatars appropriately:
    // - Avatars with discordUserId (from summoner or direct): human-controlled (waits for their input)
    // - Avatars without discordUserId: AI-controlled allies (auto-act)
    const partyAvatars = party.members.map((m, idx) => {
      if (!m.avatar) return null;
      const avatarId = String(m.avatarId || m.avatar._id);
      
      // Extract discordUserId from multiple sources:
      // 1. Direct discordUserId field on member or avatar
      // 2. Summoner field in format 'user:discordId'
      let discordUserId = m.discordUserId || m.avatar.discordUserId || null;
      if (!discordUserId && m.avatar.summoner && String(m.avatar.summoner).startsWith('user:')) {
        discordUserId = String(m.avatar.summoner).replace(/^user:/, '');
      }
      
      // Check if this is the party leader
      const isLeader = party.leaderId && String(party.leaderId) === avatarId;
      
      const isHumanControlled = !!discordUserId;
      
      // Log avatar control status for debugging
      this.logger?.debug?.(`[DungeonService] Party member ${idx}: ${m.avatar.name} - summoner=${m.avatar.summoner}, discordUserId=${discordUserId}, isLeader=${isLeader}, isHumanControlled=${isHumanControlled}`);
      
      return {
        ...m.avatar,
        isPlayerCharacter: true, // All party members are "player characters" (not enemies)
        partyMemberId: avatarId,
        discordUserId,
        isLeader,
        // Preserve or set summoner for human-controlled avatars
        summoner: isHumanControlled ? `user:${discordUserId}` : (m.avatar.summoner || null)
      };
    }).filter(Boolean);
    if (partyAvatars.length === 0) {
      throw new Error('No party members available for combat');
    }
    
    // CRITICAL: Check if ANY avatars are player-controlled
    // If not, log a warning - the combat will auto-play without player input
    const humanControlledCount = partyAvatars.filter(a => !!a.discordUserId).length;
    if (humanControlledCount === 0) {
      this.logger?.warn?.(`[DungeonService] WARNING: No player-controlled avatars in party! Combat will auto-play.`);
      this.logger?.warn?.(`[DungeonService] Party avatars: ${partyAvatars.map(a => `${a.name} (summoner=${a.summoner})`).join(', ')}`);
    } else {
      this.logger?.info?.(`[DungeonService] ${humanControlledCount}/${partyAvatars.length} avatars are player-controlled`);
    }

    // Instantiate monsters as pseudo-avatars for combat
    const monsterCombatants = this._instantiateMonstersForCombat(room.encounter.monsters);

    // Combine all participants
    const allParticipants = [...partyAvatars, ...monsterCombatants];

    // Create the encounter
    const encounter = this.combatEncounterService.createEncounter({
      channelId,
      participants: allParticipants,
      sourceMessage: null,
      context: {
        mode: 'dungeon',
        threadId: channelId
      }
    });

    // Store encounter context for later resolution
    encounter.dungeonContext = {
      dungeonId: String(dungeon._id),
      roomId,
      monsters: room.encounter.monsters
    };

    // Roll initiative and start combat
    await this.combatEncounterService.rollInitiative(encounter);

    this.logger?.info?.(`[DungeonService] Started combat in room ${roomId} with ${monsterCombatants.length} monsters`);
    
    return encounter;
  }

  /**
   * Instantiate monsters from encounter data into combat-ready pseudo-avatars
   * Adds HP variance for D&D authenticity (±25% of base HP)
   * @private
   */
  _instantiateMonstersForCombat(monsters) {
    const combatants = [];
    
    for (const monster of monsters) {
      const count = monster.count || 1;
      for (let i = 0; i < count; i++) {
        const instanceId = `monster_${monster.id || monster.monsterId}_${i + 1}_${Date.now()}`;
        
        // Calculate HP with variance (±25% of base, minimum 1)
        const baseHp = monster.stats?.hp || 10;
        const variance = Math.max(1, Math.floor(baseHp / 4)); // 25% variance
        const hpRoll = this.diceService.rollDie(variance * 2 + 1) - variance - 1; // Range: -variance to +variance
        const finalHp = Math.max(1, baseHp + hpRoll);
        
        combatants.push({
          _id: instanceId,
          id: instanceId,
          baseMonsterId: monster.id || monster.monsterId || null,
          name: count > 1 ? `${monster.name} ${i + 1}` : monster.name,
          emoji: monster.emoji || '👹',
          imageUrl: monster.imageUrl || null,
          isMonster: true,
          stats: {
            hp: finalHp,
            maxHp: finalHp,
            ac: monster.stats?.ac || 10,
            strength: monster.stats?.str || 10,
            dexterity: monster.stats?.dex || 10,
            constitution: monster.stats?.con || 10,
            intelligence: monster.stats?.int || 10,
            wisdom: monster.stats?.wis || 10,
            charisma: monster.stats?.cha || 10
          },
          attacks: monster.attacks || [],
          side: 'enemy'
        });
      }
    }
    
    return combatants;
  }

  /**
   * Handle combat resolution for a dungeon room
   * Called when combat ends to properly clear the room and award XP
   * @param {string} dungeonId - The dungeon ID
   * @param {string} roomId - The room ID
   * @param {Object} combatResult - Result from the combat encounter
   */
  async resolveCombat(dungeonId, roomId, combatResult) {
    const dungeon = await this.getDungeon(dungeonId);
    if (!dungeon) return;

    const room = dungeon.rooms.find(r => r.id === roomId);
    if (!room || room.cleared) return;

    // Determine if party won based on explicit reason; otherwise use conservative fallbacks.
    // IMPORTANT: Do not clear rooms on ambiguous outcomes.
    const reason = combatResult?.reason;
    let partyWon = false;

    if (reason === 'room_cleared') {
      partyWon = true;
    } else if (reason === 'tpk') {
      partyWon = false;
    } else if (reason === 'flee') {
      // Players fleeing should never clear the room.
      partyWon = false;
    } else if (Array.isArray(combatResult?.combatants) && combatResult.combatants.length > 0) {
      // Prefer combatants state if provided.
      const monstersAlive = combatResult.combatants.filter(c => c?.isMonster && ((c.currentHp ?? 0) > 0));
      const playersAlive = combatResult.combatants.filter(c => !c?.isMonster && ((c.currentHp ?? 0) > 0));
      partyWon = monstersAlive.length === 0 && playersAlive.length > 0;
    } else if (Array.isArray(combatResult?.winners)) {
      // Winners list is derived from alive combatants at end.
      partyWon = combatResult.winners.some(w => w && !w.isMonster);
    } else {
      partyWon = false;
    }

    if (partyWon) {
      // Clear the room and award XP (C-3: pass combatVictory flag)
      await this.clearRoom(dungeonId, roomId, { combatVictory: true });
      this.logger?.info?.(`[DungeonService] Party cleared room ${roomId} after combat victory`);
    } else {
      this.logger?.info?.(`[DungeonService] Party defeated in room ${roomId} (${reason || 'unknown'})`);
      // Handle TPK - reset party to dungeon entrance with penalties
      await this._handleTotalPartyKill(dungeon, room, reason);
    }

    return { partyWon, room };
  }
  
  /**
   * Handle Total Party Kill (TPK) - party loses combat
   * Respawns party at dungeon entrance with gold penalty
   * @param {Object} dungeon - The dungeon object
   * @param {Object} room - The room where TPK occurred
   * @param {string} reason - Reason for combat end
   * @private
   */
  async _handleTotalPartyKill(dungeon, room, reason) {
    const dungeonId = String(dungeon._id);
    
    // Calculate gold penalty (lose 10-25% based on difficulty)
    const penaltyPercent = {
      easy: 0.10,
      medium: 0.15,
      hard: 0.20,
      deadly: 0.25
    }[dungeon.difficulty] || 0.15;
    
    // Apply gold penalty to party
    try {
      const party = await this.partyService.getParty(dungeon.partyId);
      if (party?.sharedGold > 0) {
        const goldLost = Math.floor(party.sharedGold * penaltyPercent);
        if (goldLost > 0) {
          await this.partyService.addGold(dungeon.partyId, -goldLost);
          this.logger?.info?.(`[DungeonService] TPK gold penalty: ${goldLost} gold lost`);
        }
      }
    } catch (e) {
      this.logger?.warn?.(`[DungeonService] Failed to apply TPK gold penalty: ${e.message}`);
    }
    
    // Reset party to entrance room (room_1)
    const col = await this.collection();
    await col.updateOne(
      { _id: new ObjectId(dungeonId) },
      { $set: { 
        currentRoom: 'room_1',
        tpkCount: (dungeon.tpkCount || 0) + 1,
        lastTpkAt: new Date(),
        lastTpkRoom: room.id,
        lastTpkReason: reason
      }}
    );
    
    // Emit TPK event for UI handling
    eventBus.emit('dungeon.tpk', {
      dungeonId,
      roomId: room.id,
      partyId: String(dungeon.partyId),
      reason,
      goldPenaltyPercent: penaltyPercent
    });
    
    // Post TPK message to dungeon thread if available
    if (dungeon.threadId && this.discordService?.client) {
      try {
        const thread = await this.discordService.client.channels.fetch(dungeon.threadId);
        if (thread) {
          await thread.send({
            embeds: [{
              author: { name: '🎲 The Dungeon Master' },
              title: '💀 Total Party Kill',
              description: `*The darkness claims your party...*\n\nYou awaken at the dungeon entrance, battered but alive. The monsters have reset, and some of your gold has been scattered in your retreat.\n\n**Gold Lost:** ${Math.round(penaltyPercent * 100)}%\n**Current Room:** Entrance`,
              color: 0x7C3AED,
              footer: { text: 'Dust yourself off and try again, adventurer...' }
            }]
          });
        }
      } catch (e) {
        this.logger?.warn?.(`[DungeonService] Failed to post TPK message: ${e.message}`);
      }
    }
    
    this.logger?.info?.(`[DungeonService] TPK handled - party reset to entrance in dungeon ${dungeonId}`);
  }

  async collectTreasure(dungeonId, roomId) {
    const dungeon = await this.getDungeon(dungeonId);
    if (!dungeon) throw new Error('Dungeon not found');

    const roomIndex = dungeon.rooms.findIndex(r => r.id === roomId);
    if (roomIndex === -1) throw new Error('Room not found');

    const room = dungeon.rooms[roomIndex];
    if (room.type !== 'treasure' || !room.encounter) {
      throw new Error('No treasure in this room');
    }
    if (room.encounter.collected) {
      throw new Error('Treasure already collected');
    }

    const gold = room.encounter.gold;
    const items = room.encounter.items || [];
    const storedItemIds = [];

    const col = await this.collection();
    await col.updateOne(
      { _id: dungeon._id },
      { 
        $set: { 
          [`rooms.${roomIndex}.encounter.collected`]: true,
          [`rooms.${roomIndex}.cleared`]: true
        } 
      }
    );

    await this.partyService.addGold(dungeon.partyId, gold);

    if (items.length > 0 && this.itemService?.createDndItemFromDefinition) {
      for (const item of items) {
        const count = Math.max(1, Number(item.count || 1));
        const definition = getDndItem(item.id);
        if (!definition) continue;

        for (let i = 0; i < count; i++) {
          try {
            const created = await this.itemService.createDndItemFromDefinition(item.id, definition, {
              source: 'dungeon.loot',
              rarity: item.rarity,
              emoji: item.emoji
            });
            if (created?._id) {
              storedItemIds.push(created._id);
              await this.partyService.addToInventory(dungeon.partyId, created._id);
            }
          } catch (e) {
            this.logger?.warn?.(`[DungeonService] Failed to persist loot item ${item.id}: ${e.message}`);
          }
        }
      }
    }

    return { gold, items, storedItemIds };
  }

  async completeDungeon(dungeonId) {
    const col = await this.collection();
    const dungeon = await this.getDungeon(dungeonId);
    
    await col.updateOne(
      { _id: new ObjectId(dungeonId) },
      { $set: { status: 'completed', completedAt: new Date() } }
    );

    // Update location status if linked
    if (dungeon?.locationId) {
      try {
        const db = await this.databaseService.getDatabase();
        await db.collection('locations').updateOne(
          { _id: new ObjectId(dungeon.locationId) },
          { $set: { 
            dungeonStatus: 'completed',
            updatedAt: new Date().toISOString()
          }}
        );
      } catch (e) {
        this.logger?.warn?.(`[DungeonService] Failed to update location status: ${e.message}`);
      }
    }

    await this.partyService.setDungeon(dungeon.partyId, null);
    this.logger?.info?.(`[DungeonService] Dungeon ${dungeonId} completed`);
  }

  async abandonDungeon(dungeonId) {
    const col = await this.collection();
    const dungeon = await this.getDungeon(dungeonId);
    
    await col.updateOne(
      { _id: new ObjectId(dungeonId) },
      { $set: { status: 'abandoned', completedAt: new Date() } }
    );

    // Update location status if linked
    if (dungeon?.locationId) {
      try {
        const db = await this.databaseService.getDatabase();
        await db.collection('locations').updateOne(
          { _id: new ObjectId(dungeon.locationId) },
          { $set: { 
            dungeonStatus: 'abandoned',
            updatedAt: new Date().toISOString()
          }}
        );
      } catch (e) {
        this.logger?.warn?.(`[DungeonService] Failed to update location status: ${e.message}`);
      }
    }

    await this.partyService.setDungeon(dungeon.partyId, null);
    this.logger?.info?.(`[DungeonService] Dungeon ${dungeonId} abandoned`);
  }

  /**
   * Generate an entrance puzzle based on dungeon theme
   * @private
   */
  _generateEntrancePuzzle(theme) {
    const puzzles = ENTRANCE_PUZZLES[theme] || ENTRANCE_PUZZLES.crypt;
    const puzzle = puzzles[this.diceService.rollDie(puzzles.length) - 1];
    return {
      ...puzzle,
      solved: false,
      attempts: 0,
      maxAttempts: 3
    };
  }

  /**
   * Attempt to solve the entrance puzzle
   * @param {string} dungeonId - The dungeon ID
   * @param {string} answer - The player's answer
   * @param {string} [roomId] - Optional room ID (defaults to current room or entrance)
   * @returns {Promise<Object>} Result with success, message, and hint
   */
  async solvePuzzle(dungeonId, answer, roomId = null) {
    const dungeon = await this.getDungeon(dungeonId);
    if (!dungeon) throw new Error('Dungeon not found');

    // Find the room with the puzzle - check specified room, current room, or entrance
    let puzzleRoom = null;
    if (roomId) {
      puzzleRoom = dungeon.rooms.find(r => r.id === roomId);
    } else {
      // Check current room first, then entrance
      const currentRoom = dungeon.rooms.find(r => r.id === dungeon.currentRoom);
      if (currentRoom?.puzzle && !currentRoom.puzzle.solved) {
        puzzleRoom = currentRoom;
      } else {
        puzzleRoom = dungeon.rooms.find(r => r.type === 'entrance');
      }
    }

    if (!puzzleRoom?.puzzle) {
      return { success: true, message: 'No puzzle to solve!' };
    }

    if (puzzleRoom.puzzle.solved) {
      return { success: true, message: 'The puzzle has already been solved!' };
    }

    const normalizedAnswer = answer.toLowerCase().trim();
    const correctAnswer = puzzleRoom.puzzle.answer.toLowerCase().trim();

    if (normalizedAnswer === correctAnswer || normalizedAnswer.includes(correctAnswer)) {
      const xpAwarded = 50;
      // Puzzle solved! Mark room as cleared so player can advance
      const col = await this.collection();
      await col.updateOne(
        { _id: new ObjectId(dungeonId), 'rooms.id': puzzleRoom.id },
        { 
          $set: { 
            'rooms.$.puzzle.solved': true,
            'rooms.$.cleared': true,
            ...(puzzleRoom.type === 'entrance' ? { entrancePuzzleSolved: true } : {})
          } 
        }
      );

      if (xpAwarded > 0 && this.partyService?.distributeXP) {
        try {
          await this.partyService.distributeXP(dungeon.partyId, xpAwarded);
        } catch (e) {
          this.logger?.warn?.(`[DungeonService] Failed to award puzzle XP: ${e.message}`);
        }
      }

      this.logger?.info?.(`[DungeonService] Puzzle solved for dungeon ${dungeonId}, room ${puzzleRoom.id}`);
      return { 
        success: true, 
        message: puzzleRoom.type === 'entrance' 
          ? '✅ Correct! The ancient doors groan open, revealing the path ahead...'
          : '✅ Correct! The puzzle mechanism clicks into place, and the way forward is clear!',
        xpAwarded
      };
    }

    // Wrong answer
    puzzleRoom.puzzle.attempts++;
    const attemptsLeft = puzzleRoom.puzzle.maxAttempts - puzzleRoom.puzzle.attempts;

    const col = await this.collection();
    await col.updateOne(
      { _id: new ObjectId(dungeonId), 'rooms.id': puzzleRoom.id },
      { $inc: { 'rooms.$.puzzle.attempts': 1 } }
    );

    if (attemptsLeft <= 0) {
      // Out of attempts - reveal answer and let them proceed with penalty
      // Still mark room as cleared so they can advance
      const col2 = await this.collection();
      await col2.updateOne(
        { _id: new ObjectId(dungeonId), 'rooms.id': puzzleRoom.id },
        { 
          $set: { 
            'rooms.$.cleared': true,
            ...(puzzleRoom.type === 'entrance' ? { entrancePuzzleSolved: true } : {})
          } 
        }
      );
      
      return {
        success: false,
        failed: true,
        message: `❌ Too many wrong attempts! The answer was: **${puzzleRoom.puzzle.answer}**. ${puzzleRoom.type === 'entrance' ? 'The doors open reluctantly...' : 'The puzzle deactivates...'}`,
        hint: null
      };
    }

    return {
      success: false,
      failed: false,
      message: `❌ That's not quite right. ${attemptsLeft} attempt(s) remaining.`,
      hint: puzzleRoom.puzzle.hint,
      attemptsLeft
    };
  }

  /**
   * Get the current puzzle for a dungeon
   * @param {string} dungeonId - The dungeon ID
   * @param {string} [roomId] - Optional room ID (defaults to current room or entrance)
   * @returns {Promise<Object|null>} The puzzle or null if none/solved
   */
  async getPuzzle(dungeonId, roomId = null) {
    const dungeon = await this.getDungeon(dungeonId);
    if (!dungeon) return null;

    // Find the room with the puzzle - check specified room, current room, or entrance
    let puzzleRoom = null;
    if (roomId) {
      puzzleRoom = dungeon.rooms.find(r => r.id === roomId);
    } else {
      // Check current room first, then entrance
      const currentRoom = dungeon.rooms.find(r => r.id === dungeon.currentRoom);
      if (currentRoom?.puzzle && !currentRoom.puzzle.solved) {
        puzzleRoom = currentRoom;
      } else {
        puzzleRoom = dungeon.rooms.find(r => r.type === 'entrance');
      }
    }

    if (!puzzleRoom?.puzzle || puzzleRoom.puzzle.solved) {
      return null;
    }

    return {
      roomId: puzzleRoom.id,
      roomType: puzzleRoom.type,
      riddle: puzzleRoom.puzzle.riddle,
      hint: puzzleRoom.puzzle.hint,
      attempts: puzzleRoom.puzzle.attempts,
      maxAttempts: puzzleRoom.puzzle.maxAttempts,
      attemptsLeft: puzzleRoom.puzzle.maxAttempts - puzzleRoom.puzzle.attempts
    };
  }

  /**
   * Skip the puzzle without solving it
   * @param {string} dungeonId - The dungeon ID
   * @param {string} [roomId] - Optional room ID (defaults to current room or entrance)
   * @returns {Promise<Object>} Result
   */
  async skipPuzzle(dungeonId, roomId = null) {
    const dungeon = await this.getDungeon(dungeonId);
    if (!dungeon) throw new Error('Dungeon not found');

    // Find the room with the puzzle
    let puzzleRoom = null;
    if (roomId) {
      puzzleRoom = dungeon.rooms.find(r => r.id === roomId);
    } else {
      const currentRoom = dungeon.rooms.find(r => r.id === dungeon.currentRoom);
      if (currentRoom?.puzzle && !currentRoom.puzzle.solved) {
        puzzleRoom = currentRoom;
      } else {
        puzzleRoom = dungeon.rooms.find(r => r.type === 'entrance');
      }
    }

    if (!puzzleRoom?.puzzle) {
      return { success: true, message: 'No puzzle to skip!' };
    }

    if (puzzleRoom.puzzle.solved) {
      return { success: true, message: 'The puzzle has already been solved!' };
    }

    // Mark puzzle as skipped (solved but bypassed) and clear the room
    const col = await this.collection();
    await col.updateOne(
      { _id: new ObjectId(dungeonId), 'rooms.id': puzzleRoom.id },
      { 
        $set: { 
          'rooms.$.puzzle.solved': true,
          'rooms.$.puzzle.skipped': true,
          'rooms.$.cleared': true,
          ...(puzzleRoom.type === 'entrance' ? { entrancePuzzleSolved: true } : {})
        } 
      }
    );

    this.logger?.info?.(`[DungeonService] Puzzle skipped for dungeon ${dungeonId}, room ${puzzleRoom.id}`);
    return { 
      success: true, 
      message: 'You bypassed the puzzle through determination alone.',
      skipped: true
    };
  }

  getRoomEmoji(type) {
    return ROOM_EMOJIS[type] || '❓';
  }

  getDungeonMap(dungeon) {
    return dungeon.rooms.map(r => ({
      id: r.id,
      type: r.type,
      emoji: this.getRoomEmoji(r.type),
      cleared: r.cleared,
      current: r.id === dungeon.currentRoom,
      connections: r.connections
    }));
  }
}
