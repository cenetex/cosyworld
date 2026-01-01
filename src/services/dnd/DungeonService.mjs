/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * DungeonService - Procedural dungeon generation and management
 */

import { ObjectId } from 'mongodb';
import { getMonstersByCR, calculateEncounterXP } from '../../data/dnd/monsters.mjs';
import { DiceService } from '../battle/diceService.mjs';

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

export class DungeonService {
  constructor({ databaseService, partyService, discordService, logger }) {
    this.databaseService = databaseService;
    this.partyService = partyService;
    this.discordService = discordService;
    this.diceService = new DiceService();
    this.logger = logger;
    this._collection = null;
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
    } catch (e) {
      this.logger?.warn?.('[DungeonService] Index creation:', e.message);
    }
  }

  async getDungeon(dungeonId) {
    const col = await this.collection();
    return col.findOne({ _id: new ObjectId(dungeonId) });
  }

  async getActiveDungeon(partyId) {
    const col = await this.collection();
    return col.findOne({ partyId: new ObjectId(partyId), status: 'active' });
  }

  async generateDungeon(partyId, { difficulty = 'medium', theme = null } = {}) {
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

    // Entrance room
    rooms.push(this._createRoom('room_1', 'combat', partyLevel, 'entrance'));

    // Generate middle rooms
    for (let i = 2; i < roomCount; i++) {
      const type = this._weightedRandom(ROOM_WEIGHTS);
      rooms.push(this._createRoom(`room_${i}`, type, partyLevel));
    }

    // Boss room
    rooms.push(this._createRoom(`room_${roomCount}`, 'boss', partyLevel));

    // Connect rooms (linear with some branches)
    this._connectRooms(rooms);

    const dungeon = {
      name: this._generateName(selectedTheme),
      theme: selectedTheme,
      difficulty,
      partyLevel,
      rooms,
      currentRoom: 'room_1',
      partyId: new ObjectId(partyId),
      status: 'active',
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
      const sheet = member.sheet || (await this.partyService.characterService?.getSheet(member.avatarId));
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

  _createRoom(id, type, partyLevel, override = null) {
    const room = {
      id,
      type: override || type,
      threadId: null,
      cleared: false,
      connections: [],
      encounter: null
    };

    if (type === 'combat' || type === 'boss') {
      room.encounter = this._generateEncounter(type, partyLevel);
    } else if (type === 'treasure') {
      room.encounter = this._generateTreasure(partyLevel);
    }

    return room;
  }

  _generateEncounter(type, partyLevel) {
    const budget = type === 'boss'
      ? partyLevel * 100 * 4
      : partyLevel * 50 * 4;

    const monsters = this._selectMonsters(budget, partyLevel, type === 'boss');
    
    return {
      monsters,
      xpValue: calculateEncounterXP(monsters),
      defeated: false
    };
  }

  _selectMonsters(budget, partyLevel, isBoss) {
    const monsters = [];
    let remaining = budget;

    if (isBoss) {
      // Pick a single strong monster
      const bossCR = Math.min(5, Math.max(1, Math.floor(partyLevel / 2) + 1));
      const bossOptions = getMonstersByCR(bossCR);
      if (bossOptions.length > 0) {
        const boss = bossOptions[this.diceService.rollDie(bossOptions.length) - 1];
        monsters.push({ id: boss.id, count: 1 });
        remaining -= boss.xp;
      }
    }

    // Fill with minions
    const targetCR = isBoss ? 0.25 : Math.min(1, partyLevel / 4);
    const minions = getMonstersByCR(targetCR);
    
    if (minions.length > 0) {
      const minion = minions[this.diceService.rollDie(minions.length) - 1];
      const count = Math.max(1, Math.floor(remaining / minion.xp));
      if (count > 0) {
        monsters.push({ id: minion.id, count: Math.min(count, 6) });
      }
    }

    return monsters;
  }

  _generateTreasure(partyLevel) {
    const goldBase = partyLevel * 10;
    const gold = goldBase + this.diceService.rollDie(goldBase);
    
    return {
      gold,
      items: [],
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

    const col = await this.collection();
    await col.updateOne(
      { _id: dungeon._id },
      { $set: { currentRoom: roomId } }
    );

    return { room, dungeon };
  }

  async clearRoom(dungeonId, roomId) {
    const dungeon = await this.getDungeon(dungeonId);
    if (!dungeon) throw new Error('Dungeon not found');

    const roomIndex = dungeon.rooms.findIndex(r => r.id === roomId);
    if (roomIndex === -1) throw new Error('Room not found');

    const room = dungeon.rooms[roomIndex];
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

    return { gold, items: room.encounter.items };
  }

  async completeDungeon(dungeonId) {
    const col = await this.collection();
    await col.updateOne(
      { _id: new ObjectId(dungeonId) },
      { $set: { status: 'completed', completedAt: new Date() } }
    );

    const dungeon = await this.getDungeon(dungeonId);
    await this.partyService.setDungeon(dungeon.partyId, null);

    this.logger?.info?.(`[DungeonService] Dungeon ${dungeonId} completed`);
  }

  async abandonDungeon(dungeonId) {
    const col = await this.collection();
    await col.updateOne(
      { _id: new ObjectId(dungeonId) },
      { $set: { status: 'abandoned', completedAt: new Date() } }
    );

    const dungeon = await this.getDungeon(dungeonId);
    await this.partyService.setDungeon(dungeon.partyId, null);

    this.logger?.info?.(`[DungeonService] Dungeon ${dungeonId} abandoned`);
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
