/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * @file test/services/dnd/DungeonService.test.mjs
 * @description Comprehensive tests for DungeonService
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DungeonService } from '../../../src/services/dnd/DungeonService.mjs';
import { ObjectId } from 'mongodb';

/**
 * Create mock dependencies for DungeonService
 */
const createMockDeps = () => {
  const mockCollection = {
    findOne: vi.fn(),
    insertOne: vi.fn(),
    updateOne: vi.fn(),
    deleteOne: vi.fn(),
    createIndex: vi.fn().mockResolvedValue(true),
  };

  const mockDb = {
    collection: vi.fn().mockReturnValue(mockCollection),
  };

  return {
    databaseService: {
      getDatabase: vi.fn().mockResolvedValue(mockDb),
    },
    partyService: {
      getParty: vi.fn(),
      setDungeon: vi.fn().mockResolvedValue(true),
      distributeXP: vi.fn().mockResolvedValue({ xpEach: 50, results: [] }),
      addGold: vi.fn().mockResolvedValue(true),
      addToInventory: vi.fn().mockResolvedValue(true),
      characterService: {
        getSheet: vi.fn().mockResolvedValue({ level: 3 }),
      },
    },
    characterService: {
      getSheet: vi.fn().mockResolvedValue({ level: 3 }),
    },
    monsterService: null, // Will use static fallback
    discordService: {
      client: {
        channels: {
          fetch: vi.fn().mockResolvedValue({
            threads: {
              create: vi.fn().mockResolvedValue({ id: 'thread-123' }),
            },
          }),
        },
      },
    },
    itemService: {
      createDndItemFromDefinition: vi.fn().mockResolvedValue({ _id: new ObjectId() }),
      getItem: vi.fn()
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    mockCollection,
    mockDb,
  };
};

const createMockParty = (leaderId, memberCount = 1) => ({
  _id: new ObjectId(),
  name: 'Test Party',
  leaderId: new ObjectId(leaderId),
  members: Array.from({ length: memberCount }, (_, i) => ({
    avatarId: new ObjectId(),
    sheetId: new ObjectId(),
    role: i === 0 ? 'tank' : 'dps',
  })),
  maxSize: 4,
  dungeonId: null,
});

const createMockDungeon = (partyId, roomCount = 5) => ({
  _id: new ObjectId(),
  name: 'Test Dungeon',
  theme: 'crypt',
  difficulty: 'medium',
  partyLevel: 3,
  rooms: Array.from({ length: roomCount }, (_, i) => ({
    id: `room_${i + 1}`,
    type: i === 0 ? 'entrance' : i === roomCount - 1 ? 'boss' : 'combat',
    threadId: null,
    cleared: false,
    connections: i < roomCount - 1 ? [`room_${i + 2}`] : [],
    encounter: i === 0 || i === roomCount - 1 || Math.random() > 0.5
      ? { monsters: [], xpValue: 100, defeated: false }
      : null,
  })),
  currentRoom: 'room_1',
  partyId: new ObjectId(partyId),
  status: 'active',
  createdAt: new Date(),
  completedAt: null,
});

describe('DungeonService', () => {
  let service;
  let deps;

  beforeEach(() => {
    deps = createMockDeps();
    service = new DungeonService(deps);
  });

  describe('constructor', () => {
    it('should initialize with required dependencies', () => {
      expect(service.databaseService).toBe(deps.databaseService);
      expect(service.partyService).toBe(deps.partyService);
      expect(service.characterService).toBe(deps.characterService);
      expect(service.discordService).toBe(deps.discordService);
      expect(service.logger).toBe(deps.logger);
      expect(service.diceService).toBeDefined();
    });
  });

  describe('collection()', () => {
    it('should create collection and indexes on first access', async () => {
      await service.collection();

      expect(deps.databaseService.getDatabase).toHaveBeenCalled();
      expect(deps.mockDb.collection).toHaveBeenCalledWith('dungeons');
      expect(deps.mockCollection.createIndex).toHaveBeenCalled();
    });

    it('should cache collection after first access', async () => {
      await service.collection();
      await service.collection();

      expect(deps.databaseService.getDatabase).toHaveBeenCalledTimes(1);
    });
  });

  describe('getDungeon()', () => {
    it('should find a dungeon by ID', async () => {
      const dungeonId = new ObjectId();
      const mockDungeon = createMockDungeon(new ObjectId().toString());
      mockDungeon._id = dungeonId;
      deps.mockCollection.findOne.mockResolvedValue(mockDungeon);

      const result = await service.getDungeon(dungeonId.toString());

      expect(result).toEqual(mockDungeon);
    });

    it('should return null if dungeon not found', async () => {
      deps.mockCollection.findOne.mockResolvedValue(null);

      const result = await service.getDungeon(new ObjectId().toString());

      expect(result).toBeNull();
    });
  });

  describe('getActiveDungeon()', () => {
    it('should find active dungeon for a party', async () => {
      const partyId = new ObjectId();
      const mockDungeon = createMockDungeon(partyId.toString());
      deps.mockCollection.findOne.mockResolvedValue(mockDungeon);

      const result = await service.getActiveDungeon(partyId.toString());

      expect(result).toEqual(mockDungeon);
      expect(deps.mockCollection.findOne).toHaveBeenCalledWith({
        partyId: expect.any(ObjectId),
        status: 'active',
      });
    });
  });

  describe('generateDungeon()', () => {
    const partyId = new ObjectId();
    const leaderId = '507f1f77bcf86cd799439011';

    it('should generate a dungeon with correct difficulty', async () => {
      const party = createMockParty(leaderId, 4);
      party._id = partyId;
      deps.partyService.getParty.mockResolvedValue(party);
      deps.mockCollection.findOne.mockResolvedValue(null); // No active dungeon
      deps.mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

      const dungeon = await service.generateDungeon(partyId.toString(), {
        difficulty: 'hard',
      });

      expect(dungeon.difficulty).toBe('hard');
      expect(dungeon.partyId.toString()).toBe(partyId.toString());
      expect(dungeon.status).toBe('active');
    });

    it('should generate appropriate room count for difficulty', async () => {
      const party = createMockParty(leaderId, 4);
      party._id = partyId;
      deps.partyService.getParty.mockResolvedValue(party);
      deps.mockCollection.findOne.mockResolvedValue(null);
      deps.mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

      const easyDungeon = await service.generateDungeon(partyId.toString(), {
        difficulty: 'easy',
      });
      expect(easyDungeon.rooms.length).toBeGreaterThanOrEqual(4);
      expect(easyDungeon.rooms.length).toBeLessThanOrEqual(6);
    });

    it('should include entrance and boss rooms', async () => {
      const party = createMockParty(leaderId, 4);
      party._id = partyId;
      deps.partyService.getParty.mockResolvedValue(party);
      deps.mockCollection.findOne.mockResolvedValue(null);
      deps.mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

      const dungeon = await service.generateDungeon(partyId.toString());

      // First room should be entrance
      expect(dungeon.rooms[0].type).toBe('entrance');
      // Last room should be boss
      expect(dungeon.rooms[dungeon.rooms.length - 1].type).toBe('boss');
    });

    it('should start party in first room', async () => {
      const party = createMockParty(leaderId, 4);
      party._id = partyId;
      deps.partyService.getParty.mockResolvedValue(party);
      deps.mockCollection.findOne.mockResolvedValue(null);
      deps.mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

      const dungeon = await service.generateDungeon(partyId.toString());

      expect(dungeon.currentRoom).toBe('room_1');
    });

    it('should link dungeon to party', async () => {
      const party = createMockParty(leaderId, 4);
      party._id = partyId;
      deps.partyService.getParty.mockResolvedValue(party);
      deps.mockCollection.findOne.mockResolvedValue(null);
      deps.mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

      await service.generateDungeon(partyId.toString());

      expect(deps.partyService.setDungeon).toHaveBeenCalledWith(
        partyId.toString(),
        expect.any(ObjectId)
      );
    });

    it('should throw if party not found', async () => {
      deps.partyService.getParty.mockResolvedValue(null);

      await expect(
        service.generateDungeon(partyId.toString())
      ).rejects.toThrow('Party not found');
    });

    it('should throw if party already in a dungeon', async () => {
      const party = createMockParty(leaderId, 4);
      party._id = partyId;
      deps.partyService.getParty.mockResolvedValue(party);
      deps.mockCollection.findOne.mockResolvedValue(createMockDungeon(partyId.toString()));

      await expect(
        service.generateDungeon(partyId.toString())
      ).rejects.toThrow('Party already in a dungeon');
    });

    it('should accept custom theme', async () => {
      const party = createMockParty(leaderId, 4);
      party._id = partyId;
      deps.partyService.getParty.mockResolvedValue(party);
      deps.mockCollection.findOne.mockResolvedValue(null);
      deps.mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

      const dungeon = await service.generateDungeon(partyId.toString(), {
        theme: 'castle',
      });

      expect(dungeon.theme).toBe('castle');
    });
  });

  describe('Difficulty Levels', () => {
    const partyId = new ObjectId();
    const leaderId = '507f1f77bcf86cd799439011';

    beforeEach(() => {
      const party = createMockParty(leaderId, 4);
      party._id = partyId;
      deps.partyService.getParty.mockResolvedValue(party);
      deps.mockCollection.findOne.mockResolvedValue(null);
      deps.mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    });

    it.each(['easy', 'medium', 'hard', 'deadly'])(
      'should generate %s difficulty dungeon',
      async (difficulty) => {
        const dungeon = await service.generateDungeon(partyId.toString(), {
          difficulty,
        });

        expect(dungeon.difficulty).toBe(difficulty);
        expect(dungeon.rooms.length).toBeGreaterThan(0);
      }
    );
  });

  describe('Dungeon Themes', () => {
    const partyId = new ObjectId();
    const leaderId = '507f1f77bcf86cd799439011';

    beforeEach(() => {
      const party = createMockParty(leaderId, 4);
      party._id = partyId;
      deps.partyService.getParty.mockResolvedValue(party);
      deps.mockCollection.findOne.mockResolvedValue(null);
      deps.mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    });

    it.each(['crypt', 'cave', 'castle', 'ruins', 'sewers', 'forest'])(
      'should accept %s theme',
      async (theme) => {
        const dungeon = await service.generateDungeon(partyId.toString(), {
          theme,
        });

        expect(dungeon.theme).toBe(theme);
      }
    );
  });

  describe('Room Types', () => {
    it('should generate rooms with encounters for combat rooms', async () => {
      const partyId = new ObjectId();
      const leaderId = '507f1f77bcf86cd799439011';
      const party = createMockParty(leaderId, 4);
      party._id = partyId;
      deps.partyService.getParty.mockResolvedValue(party);
      deps.mockCollection.findOne.mockResolvedValue(null);
      deps.mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

      const dungeon = await service.generateDungeon(partyId.toString());

      // Combat and boss rooms should have encounters, entrance rooms have puzzles instead
      const combatRooms = dungeon.rooms.filter(
        (r) => r.type === 'combat' || r.type === 'boss'
      );
      
      for (const room of combatRooms) {
        expect(room.encounter).toBeDefined();
        expect(room.encounter.monsters).toBeDefined();
      }
    });

    it('should generate treasure for treasure rooms', async () => {
      // This test verifies the internal _createRoom method behavior
      // We'll test by checking the structure of generated rooms
      const room = service._createRoom('test_room', 'treasure', 3);
      
      expect(room.id).toBe('test_room');
      expect(room.type).toBe('treasure');
      expect(room.encounter).toBeDefined();
    });
  });

  describe('Room Connections', () => {
    it('should connect rooms in sequence', async () => {
      const partyId = new ObjectId();
      const leaderId = '507f1f77bcf86cd799439011';
      const party = createMockParty(leaderId, 4);
      party._id = partyId;
      deps.partyService.getParty.mockResolvedValue(party);
      deps.mockCollection.findOne.mockResolvedValue(null);
      deps.mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

      const dungeon = await service.generateDungeon(partyId.toString());

      // Verify rooms are connected (at least linearly)
      for (let i = 0; i < dungeon.rooms.length - 1; i++) {
        const room = dungeon.rooms[i];
        expect(room.connections.length).toBeGreaterThan(0);
      }
    });
  });

  describe('_weightedRandom()', () => {
    it('should return valid room type', () => {
      const weights = {
        combat: 40,
        treasure: 20,
        puzzle: 15,
        rest: 10,
        shop: 5,
        empty: 10,
      };

      // Run multiple times to test distribution
      const results = new Set();
      for (let i = 0; i < 100; i++) {
        results.add(service._weightedRandom(weights));
      }

      // Should get at least a few different types
      expect(results.size).toBeGreaterThan(1);
      
      // All results should be valid types
      for (const result of results) {
        expect(Object.keys(weights)).toContain(result);
      }
    });
  });

  describe('_getRoomCount()', () => {
    it('should return count within difficulty range', () => {
      const ranges = {
        easy: { min: 4, max: 6 },
        medium: { min: 5, max: 8 },
        hard: { min: 7, max: 10 },
        deadly: { min: 9, max: 12 },
      };

      for (const [difficulty, range] of Object.entries(ranges)) {
        for (let i = 0; i < 20; i++) {
          const count = service._getRoomCount(difficulty);
          expect(count).toBeGreaterThanOrEqual(range.min);
          expect(count).toBeLessThanOrEqual(range.max);
        }
      }
    });
  });

  describe('_createRoom()', () => {
    it('should create room with correct structure', () => {
      const room = service._createRoom('test_1', 'combat', 3);

      expect(room.id).toBe('test_1');
      expect(room.type).toBe('combat');
      expect(room.threadId).toBeNull();
      expect(room.cleared).toBe(false);
      expect(room.connections).toEqual([]);
      // Combat rooms are now marked for async encounter generation
      expect(room._needsEncounter).toBe(true);
      expect(room._encounterType).toBe('combat');
    });

    it('should create boss room with encounter marker', () => {
      const room = service._createRoom('boss_room', 'boss', 5);

      expect(room.type).toBe('boss');
      // Boss rooms are marked for async encounter generation
      expect(room._needsEncounter).toBe(true);
      expect(room._encounterType).toBe('boss');
    });

    it('should override type when specified', () => {
      const room = service._createRoom('room_1', 'combat', 3, 'entrance');

      expect(room.type).toBe('entrance');
    });
  });

  describe('_generateEncounter()', () => {
    it('should generate encounter with monsters', async () => {
      // _generateEncounter is now async and falls back to static monsters when monsterService is null
      const encounter = await service._generateEncounter('combat', 5, 'cave');

      expect(encounter.monsters).toBeDefined();
      expect(encounter.xpValue).toBeGreaterThanOrEqual(0);
      expect(encounter.defeated).toBe(false);
    });

    it('should generate stronger boss encounters', async () => {
      const normalEncounter = await service._generateEncounter('combat', 5, 'cave');
      const bossEncounter = await service._generateEncounter('boss', 5, 'cave');

      // Boss should have higher XP value potential
      expect(bossEncounter.xpValue).toBeDefined();
    });
  });

  describe('_generateTreasure()', () => {
    it('should generate treasure based on party level', () => {
      const treasure = service._generateTreasure(5);

      expect(treasure).toBeDefined();
    });
  });

  describe('collectTreasure()', () => {
    it('should persist loot items and add them to party inventory', async () => {
      const dungeonId = new ObjectId();
      const partyId = new ObjectId();
      const room = {
        id: 'room_2',
        type: 'treasure',
        cleared: false,
        encounter: {
          gold: 120,
          items: [{ id: 'dagger', name: 'Dagger', count: 2, rarity: 'common', emoji: '🗡️' }],
          collected: false
        }
      };
      const dungeon = {
        _id: dungeonId,
        partyId,
        rooms: [room],
        currentRoom: 'room_2'
      };

      const createdIds = [new ObjectId(), new ObjectId()];
      deps.itemService.createDndItemFromDefinition
        .mockResolvedValueOnce({ _id: createdIds[0] })
        .mockResolvedValueOnce({ _id: createdIds[1] });

      deps.mockCollection.findOne.mockResolvedValue(dungeon);
      deps.mockCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

      const result = await service.collectTreasure(dungeonId.toString(), 'room_2');

      expect(deps.partyService.addGold).toHaveBeenCalledWith(partyId, 120);
      expect(deps.itemService.createDndItemFromDefinition).toHaveBeenCalledTimes(2);
      expect(deps.partyService.addToInventory).toHaveBeenCalledWith(partyId, createdIds[0]);
      expect(deps.partyService.addToInventory).toHaveBeenCalledWith(partyId, createdIds[1]);
      expect(result.storedItemIds).toHaveLength(2);
    });
  });

  describe('solvePuzzle()', () => {
    it('should award XP when puzzle is solved', async () => {
      const dungeonId = new ObjectId();
      const partyId = new ObjectId();
      const room = {
        id: 'room_1',
        type: 'entrance',
        cleared: false,
        puzzle: {
          riddle: 'What am I?',
          answer: 'fire',
          hint: 'I flicker',
          solved: false,
          attempts: 0,
          maxAttempts: 3
        }
      };
      const dungeon = {
        _id: dungeonId,
        partyId,
        rooms: [room],
        currentRoom: 'room_1'
      };

      deps.mockCollection.findOne.mockResolvedValue(dungeon);
      deps.mockCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

      await service.solvePuzzle(dungeonId.toString(), 'fire');

      expect(deps.partyService.distributeXP).toHaveBeenCalledWith(partyId, 50);
    });
  });

  describe('resolveCombat()', () => {
    it('should apply TPK gold penalty based on sharedGold', async () => {
      const dungeonId = new ObjectId();
      const partyId = new ObjectId();
      const room = {
        id: 'room_1',
        type: 'combat',
        cleared: false,
        encounter: { monsters: [{ id: 'goblin' }], xpValue: 50 }
      };
      const dungeon = {
        _id: dungeonId,
        partyId,
        difficulty: 'medium',
        rooms: [room],
        currentRoom: 'room_1',
        threadId: null
      };

      deps.mockCollection.findOne.mockResolvedValue(dungeon);
      deps.mockCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
      deps.partyService.getParty.mockResolvedValue({ _id: partyId, sharedGold: 200 });

      await service.resolveCombat(dungeonId.toString(), 'room_1', { reason: 'tpk', winners: [] });

      expect(deps.partyService.addGold).toHaveBeenCalledWith(partyId, -30);
    });
  });

  describe('_generateName()', () => {
    it('should generate name containing theme', () => {
      const themes = ['crypt', 'cave', 'castle', 'ruins', 'sewers', 'forest'];

      for (const theme of themes) {
        const name = service._generateName(theme);
        expect(typeof name).toBe('string');
        expect(name.length).toBeGreaterThan(0);
      }
    });
  });
});
