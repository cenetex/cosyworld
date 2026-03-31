/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * @file test/services/dnd/MonsterService.test.mjs
 * @description Comprehensive tests for MonsterService
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MonsterService, MONSTER_TAGS, CR_TO_LEVEL_MAP } from '../../../src/services/dnd/MonsterService.mjs';
import { ObjectId } from 'mongodb';

/**
 * Create mock dependencies for MonsterService
 */
const createMockDeps = () => {
  const mockCollection = {
    findOne: vi.fn(),
    insertOne: vi.fn(),
    find: vi.fn(),
    updateOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    deleteOne: vi.fn(),
    countDocuments: vi.fn(),
    distinct: vi.fn(),
    aggregate: vi.fn(),
    createIndexes: vi.fn().mockResolvedValue(true),
  };

  // Make find return a mock cursor with toArray
  mockCollection.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([]),
  });

  // Make aggregate return a mock cursor with toArray
  mockCollection.aggregate.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([{ avg: 2.5 }]),
  });

  const mockDb = {
    collection: vi.fn().mockReturnValue(mockCollection),
  };

  return {
    databaseService: {
      getDatabase: vi.fn().mockResolvedValue(mockDb),
    },
    schemaService: {
      executePipeline: vi.fn(),
      generateImage: vi.fn(),
    },
    aiService: {
      generateImageViaOpenRouter: vi.fn(),
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

const createMockMonster = (overrides = {}) => ({
  _id: new ObjectId(),
  monsterId: 'test_monster',
  name: 'Test Monster',
  emoji: '👾',
  description: 'A test monster for unit tests.',
  imageUrl: null,
  cr: 1,
  xp: 200,
  stats: { hp: 25, ac: 13, speed: 30, str: 14, dex: 12, con: 14, int: 8, wis: 10, cha: 8 },
  attacks: [{ name: 'Claw', bonus: 4, damage: { dice: 6, count: 1, modifier: 2, type: 'slashing' } }],
  traits: ['keen_senses'],
  immunities: [],
  vulnerabilities: [],
  tags: {
    habitats: ['cave', 'ruins'],
    type: 'monstrosity',
    role: 'brute',
  },
  isGenerated: false,
  usageCount: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('MonsterService', () => {
  let service;
  let deps;

  beforeEach(() => {
    deps = createMockDeps();
    service = new MonsterService(deps);
  });

  describe('constructor', () => {
    it('should initialize with required dependencies', () => {
      expect(service.databaseService).toBe(deps.databaseService);
      expect(service.schemaService).toBe(deps.schemaService);
      expect(service.aiService).toBe(deps.aiService);
      expect(service.logger).toBe(deps.logger);
    });
  });

  describe('collection()', () => {
    it('should create collection and indexes on first access', async () => {
      await service.collection();

      expect(deps.databaseService.getDatabase).toHaveBeenCalled();
      expect(deps.mockDb.collection).toHaveBeenCalledWith('monsters');
      expect(deps.mockCollection.createIndexes).toHaveBeenCalled();
    });

    it('should cache index creation after first access', async () => {
      await service.collection();
      await service.collection();

      // createIndexes should only be called once due to _indexesCreated flag
      expect(deps.mockCollection.createIndexes).toHaveBeenCalledTimes(1);
    });
  });

  describe('seedStaticMonsters()', () => {
    it('should seed monsters that do not exist', async () => {
      deps.mockCollection.findOne.mockResolvedValue(null);
      deps.mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

      const result = await service.seedStaticMonsters();

      expect(result.seeded).toBeGreaterThan(0);
      expect(deps.mockCollection.insertOne).toHaveBeenCalled();
    });

    it('should skip monsters that already exist', async () => {
      deps.mockCollection.findOne.mockResolvedValue({ monsterId: 'goblin' });

      const result = await service.seedStaticMonsters();

      expect(result.existing).toBeGreaterThan(0);
    });
  });

  describe('getMonstersByTags()', () => {
    it('should return all monsters when no filters provided', async () => {
      const mockMonsters = [createMockMonster(), createMockMonster({ monsterId: 'another' })];
      deps.mockCollection.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue(mockMonsters),
      });

      const result = await service.getMonstersByTags({});

      expect(result).toHaveLength(2);
      expect(deps.mockCollection.find).toHaveBeenCalledWith({});
    });

    it('should filter by habitats (OR match)', async () => {
      deps.mockCollection.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([createMockMonster()]),
      });

      await service.getMonstersByTags({ habitats: ['cave', 'crypt'] });

      expect(deps.mockCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          'tags.habitats': { $in: ['cave', 'crypt'] },
        })
      );
    });

    it('should filter by type (exact match)', async () => {
      deps.mockCollection.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      });

      await service.getMonstersByTags({ type: 'undead' });

      expect(deps.mockCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          'tags.type': 'undead',
        })
      );
    });

    it('should filter by CR range', async () => {
      deps.mockCollection.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      });

      await service.getMonstersByTags({ minCR: 1, maxCR: 5 });

      expect(deps.mockCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          cr: { $gte: 1, $lte: 5 },
        })
      );
    });

    it('should convert targetLevel to CR range', async () => {
      deps.mockCollection.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      });

      await service.getMonstersByTags({ targetLevel: 5 });

      // Level 5 should map to CR range 3-7 (level ± 2)
      expect(deps.mockCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          cr: expect.objectContaining({ $gte: 3, $lte: 7 }),
        })
      );
    });
  });

  describe('selectMonsterForEncounter() - Bonding Curve', () => {
    it('should return 100% new when no existing monsters', async () => {
      deps.mockCollection.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      });

      deps.schemaService.executePipeline.mockResolvedValue({
        name: 'New Creature',
        description: 'A newly generated creature',
        emoji: '🐉',
        cr: 1,
        xp: 200,
        hp: 25,
        ac: 13,
        speed: 30,
        str: 14,
        dex: 12,
        con: 14,
        int: 8,
        wis: 10,
        cha: 8,
        attackName: 'Bite',
        attackBonus: 4,
        damageDice: 8,
        damageDiceCount: 1,
        damageModifier: 2,
        damageType: 'piercing',
        trait1: 'Keen Senses',
        immunity: 'none',
        vulnerability: 'none',
      });

      deps.mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

      const result = await service.selectMonsterForEncounter({ habitats: ['cave'] });

      expect(result.isNew).toBe(true);
      expect(result.monster).toBeDefined();
      expect(result.monster.name).toBe('New Creature');
    });

    it('should have 50% chance of new when 1 existing monster', async () => {
      const existingMonster = createMockMonster();
      deps.mockCollection.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([existingMonster]),
      });
      deps.mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

      // Run multiple trials to test probability
      let newCount = 0;
      const trials = 100;

      // Mock Math.random to alternate
      const originalRandom = Math.random;
      let callCount = 0;

      for (let i = 0; i < trials; i++) {
        // Force one new and one existing
        Math.random = () => (i % 2 === 0 ? 0.3 : 0.7); // 0.3 < 0.5 = new, 0.7 > 0.5 = existing

        deps.schemaService.executePipeline.mockResolvedValue({
          name: `Generated ${i}`,
          description: 'Generated',
          emoji: '🐉',
          cr: 1,
          xp: 200,
          hp: 25,
          ac: 13,
          str: 14,
          dex: 12,
          con: 14,
          int: 8,
          wis: 10,
          cha: 8,
          attackName: 'Bite',
          attackBonus: 4,
          damageDice: 8,
          damageDiceCount: 1,
          damageModifier: 2,
          damageType: 'piercing',
          trait1: 'Test',
        });
        deps.mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

        const result = await service.selectMonsterForEncounter({ habitats: ['cave'] });
        if (result.isNew) newCount++;
      }

      Math.random = originalRandom;

      // Should be roughly 50/50 (we forced alternation)
      expect(newCount).toBe(50);
    });

    it('should respect forceNew option', async () => {
      const existingMonster = createMockMonster();
      deps.mockCollection.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([existingMonster, createMockMonster({ monsterId: 'm2' })]),
      });

      deps.schemaService.executePipeline.mockResolvedValue({
        name: 'Forced New',
        description: 'Forced',
        emoji: '🐉',
        cr: 1,
        xp: 200,
        hp: 25,
        ac: 13,
        str: 14,
        dex: 12,
        con: 14,
        int: 8,
        wis: 10,
        cha: 8,
        attackName: 'Bite',
        attackBonus: 4,
        damageDice: 8,
        damageDiceCount: 1,
        damageModifier: 2,
        damageType: 'piercing',
        trait1: 'Test',
      });
      deps.mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

      const result = await service.selectMonsterForEncounter(
        { habitats: ['cave'] },
        { forceNew: true }
      );

      expect(result.isNew).toBe(true);
    });

    it('should respect forceExisting option', async () => {
      const existingMonster = createMockMonster();
      deps.mockCollection.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([existingMonster]),
      });
      deps.mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

      // Force a low random that would normally trigger new
      const originalRandom = Math.random;
      Math.random = () => 0.1; // Would be < 0.5, triggering new

      const result = await service.selectMonsterForEncounter(
        { habitats: ['cave'] },
        { forceExisting: true }
      );

      Math.random = originalRandom;

      expect(result.isNew).toBe(false);
      expect(result.monster.monsterId).toBe(existingMonster.monsterId);
    });
  });

  describe('generateMonster()', () => {
    beforeEach(() => {
      deps.schemaService.executePipeline.mockResolvedValue({
        name: 'Shadow Stalker',
        description: 'A creature of living darkness.',
        emoji: '👤',
        cr: 2,
        xp: 450,
        hp: 40,
        ac: 14,
        speed: 40,
        str: 12,
        dex: 16,
        con: 14,
        int: 10,
        wis: 12,
        cha: 8,
        attackName: 'Shadow Touch',
        attackBonus: 5,
        damageDice: 8,
        damageDiceCount: 2,
        damageModifier: 3,
        damageType: 'necrotic',
        trait1: 'Shadow Meld',
        trait2: 'Sunlight Sensitivity',
        immunity: 'necrotic',
        vulnerability: 'radiant',
      });

      deps.mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    });

    it('should generate a monster with correct structure', async () => {
      const monster = await service.generateMonster({
        habitats: ['crypt'],
        type: 'undead',
        role: 'skirmisher',
      });

      expect(monster.name).toBe('Shadow Stalker');
      expect(monster.monsterId).toContain('shadow_stalker');
      expect(monster.isGenerated).toBe(true);
      expect(monster.tags.habitats).toEqual(['crypt']);
      expect(monster.tags.type).toBe('undead');
      expect(monster.tags.role).toBe('skirmisher');
    });

    it('should structure stats correctly', async () => {
      const monster = await service.generateMonster({});

      expect(monster.stats).toEqual({
        hp: 40,
        ac: 14,
        speed: 40,
        str: 12,
        dex: 16,
        con: 14,
        int: 10,
        wis: 12,
        cha: 8,
      });
    });

    it('should structure attacks correctly', async () => {
      const monster = await service.generateMonster({});

      expect(monster.attacks).toHaveLength(1);
      expect(monster.attacks[0]).toEqual({
        name: 'Shadow Touch',
        bonus: 5,
        damage: {
          dice: 8,
          count: 2,
          modifier: 3,
          type: 'necrotic',
        },
      });
    });

    it('should handle immunities and vulnerabilities', async () => {
      const monster = await service.generateMonster({});

      expect(monster.immunities).toEqual(['necrotic']);
      expect(monster.vulnerabilities).toEqual(['radiant']);
    });

    it('should create fallback monster on AI failure', async () => {
      deps.schemaService.executePipeline.mockRejectedValue(new Error('AI Error'));

      const monster = await service.generateMonster({ targetLevel: 3 });

      expect(monster.name).toBe('Unknown Creature');
      expect(monster.isGenerated).toBe(true);
    });
  });

  describe('getMonster()', () => {
    it('should return monster by monsterId', async () => {
      const mockMonster = createMockMonster();
      deps.mockCollection.findOne.mockResolvedValue(mockMonster);

      const result = await service.getMonster('test_monster');

      expect(result).toEqual(mockMonster);
      expect(deps.mockCollection.findOne).toHaveBeenCalledWith({ monsterId: 'test_monster' });
    });

    it('should return null for non-existent monster', async () => {
      deps.mockCollection.findOne.mockResolvedValue(null);

      const result = await service.getMonster('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('updateMonster()', () => {
    it('should update monster fields', async () => {
      const mockMonster = createMockMonster({ usageCount: 5 });
      deps.mockCollection.findOneAndUpdate.mockResolvedValue(mockMonster);

      const result = await service.updateMonster('test_monster', { usageCount: 5 });

      expect(deps.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
        { monsterId: 'test_monster' },
        expect.objectContaining({
          $set: expect.objectContaining({ usageCount: 5 }),
        }),
        { returnDocument: 'after' }
      );
    });
  });

  describe('deleteMonster()', () => {
    it('should delete monster and return true', async () => {
      deps.mockCollection.deleteOne.mockResolvedValue({ deletedCount: 1 });

      const result = await service.deleteMonster('test_monster');

      expect(result).toBe(true);
    });

    it('should return false if monster not found', async () => {
      deps.mockCollection.deleteOne.mockResolvedValue({ deletedCount: 0 });

      const result = await service.deleteMonster('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('getStats()', () => {
    it('should return monster statistics', async () => {
      deps.mockCollection.countDocuments
        .mockResolvedValueOnce(15) // total
        .mockResolvedValueOnce(5) // generated
        .mockResolvedValueOnce(10); // static
      deps.mockCollection.aggregate.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ avg: 3.2 }]),
      });

      const result = await service.getStats();

      expect(result).toEqual({
        total: 15,
        generated: 5,
        static: 10,
        averageUsage: 3.2,
      });
    });
  });

  describe('getUsedTags()', () => {
    it('should return all unique tag values', async () => {
      deps.mockCollection.distinct
        .mockResolvedValueOnce(['cave', 'crypt', 'forest'])
        .mockResolvedValueOnce(['undead', 'beast', 'humanoid'])
        .mockResolvedValueOnce(['minion', 'brute', 'elite']);

      const result = await service.getUsedTags();

      expect(result).toEqual({
        habitats: ['cave', 'crypt', 'forest'],
        types: ['undead', 'beast', 'humanoid'],
        roles: ['minion', 'brute', 'elite'],
      });
    });
  });

  describe('calculateEncounterXP()', () => {
    it('should sum XP values with counts', () => {
      const monsters = [
        { xp: 100, count: 3 },
        { xp: 200, count: 1 },
        { xp: 50, count: 2 },
      ];

      const result = service.calculateEncounterXP(monsters);

      expect(result).toBe(100 * 3 + 200 * 1 + 50 * 2); // 600
    });

    it('should default count to 1', () => {
      const monsters = [{ xp: 100 }, { xp: 200 }];

      const result = service.calculateEncounterXP(monsters);

      expect(result).toBe(300);
    });
  });

  describe('_levelToCRRange()', () => {
    it('should calculate appropriate CR range for party level', () => {
      // Access private method for testing
      const range = service._levelToCRRange(5);

      expect(range.min).toBe(3); // level - 2
      expect(range.max).toBe(7); // level + 2
    });

    it('should clamp minimum CR to 0', () => {
      const range = service._levelToCRRange(1);

      expect(range.min).toBe(0); // max(0, 1-2)
      expect(range.max).toBe(3);
    });
  });

  describe('_crToXP()', () => {
    it('should return correct XP for standard CRs', () => {
      expect(service._crToXP(0.25)).toBe(50);
      expect(service._crToXP(1)).toBe(200);
      expect(service._crToXP(5)).toBe(1800);
      expect(service._crToXP(10)).toBe(5900);
    });

    it('should calculate XP for non-standard CRs', () => {
      expect(service._crToXP(25)).toBe(5000); // 25 * 200
    });
  });

  describe('_generateMonsterId()', () => {
    it('should generate URL-safe ID from name', () => {
      const id = service._generateMonsterId('Shadow Stalker of Doom');

      expect(id).toMatch(/^shadow_stalker_of_doom_[a-z0-9]+$/);
    });

    it('should remove special characters', () => {
      const id = service._generateMonsterId("Giant Spider (Poison) - Level 3!");

      expect(id).toMatch(/^giant_spider_poison_level_3_[a-z0-9]+$/);
    });
  });
});

describe('MONSTER_TAGS', () => {
  it('should have defined habitat options', () => {
    expect(MONSTER_TAGS.habitats).toContain('cave');
    expect(MONSTER_TAGS.habitats).toContain('crypt');
    expect(MONSTER_TAGS.habitats).toContain('forest');
  });

  it('should have defined creature types', () => {
    expect(MONSTER_TAGS.types).toContain('undead');
    expect(MONSTER_TAGS.types).toContain('beast');
    expect(MONSTER_TAGS.types).toContain('humanoid');
  });

  it('should have defined combat roles', () => {
    expect(MONSTER_TAGS.roles).toContain('minion');
    expect(MONSTER_TAGS.roles).toContain('elite');
    expect(MONSTER_TAGS.roles).toContain('boss');
  });
});

describe('CR_TO_LEVEL_MAP', () => {
  it('should map fractional CRs to level 1', () => {
    expect(CR_TO_LEVEL_MAP[0]).toBe(1);
    expect(CR_TO_LEVEL_MAP[0.125]).toBe(1);
    expect(CR_TO_LEVEL_MAP[0.25]).toBe(1);
    expect(CR_TO_LEVEL_MAP[0.5]).toBe(1);
  });

  it('should map CR directly to level for 1-20', () => {
    expect(CR_TO_LEVEL_MAP[5]).toBe(5);
    expect(CR_TO_LEVEL_MAP[10]).toBe(10);
    expect(CR_TO_LEVEL_MAP[20]).toBe(20);
  });
});
