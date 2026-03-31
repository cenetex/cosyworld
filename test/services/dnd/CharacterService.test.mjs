/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * @file test/services/dnd/CharacterService.test.mjs
 * @description Comprehensive tests for CharacterService
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CharacterService } from '../../../src/services/dnd/CharacterService.mjs';
import { ObjectId } from 'mongodb';

/**
 * Create mock dependencies for CharacterService
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
    avatarService: {
      getAvatarById: vi.fn().mockResolvedValue({
        _id: new ObjectId('507f1f77bcf86cd799439011'),
        name: 'TestAvatar',
        stats: {
          strength: 14,
          dexterity: 12,
          constitution: 16,
          intelligence: 10,
          wisdom: 13,
          charisma: 8,
        },
      }),
      updateAvatarStats: vi.fn().mockResolvedValue(true),
      updateAvatar: vi.fn().mockResolvedValue(true),
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

describe('CharacterService', () => {
  let service;
  let deps;

  beforeEach(() => {
    deps = createMockDeps();
    service = new CharacterService(deps);
  });

  describe('constructor', () => {
    it('should initialize with required dependencies', () => {
      expect(service.databaseService).toBe(deps.databaseService);
      expect(service.avatarService).toBe(deps.avatarService);
      expect(service.logger).toBe(deps.logger);
    });
  });

  describe('collection()', () => {
    it('should create collection and indexes on first access', async () => {
      await service.collection();

      expect(deps.databaseService.getDatabase).toHaveBeenCalled();
      expect(deps.mockDb.collection).toHaveBeenCalledWith('character_sheets');
      expect(deps.mockCollection.createIndex).toHaveBeenCalled();
    });

    it('should cache collection after first access', async () => {
      await service.collection();
      await service.collection();

      expect(deps.databaseService.getDatabase).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSheet()', () => {
    it('should find a sheet by avatarId', async () => {
      const avatarId = '507f1f77bcf86cd799439011';
      const mockSheet = {
        avatarId: new ObjectId(avatarId),
        class: 'fighter',
        level: 3,
      };
      deps.mockCollection.findOne.mockResolvedValue(mockSheet);

      const result = await service.getSheet(avatarId);

      expect(result).toEqual(mockSheet);
      expect(deps.mockCollection.findOne).toHaveBeenCalledWith({
        avatarId: expect.any(ObjectId),
      });
    });

    it('should return null if no sheet exists', async () => {
      deps.mockCollection.findOne.mockResolvedValue(null);

      const result = await service.getSheet('507f1f77bcf86cd799439011');

      expect(result).toBeNull();
    });
  });

  describe('createCharacter()', () => {
    const avatarId = '507f1f77bcf86cd799439011';

    it('should create a fighter character', async () => {
      deps.mockCollection.findOne.mockResolvedValue(null); // No existing sheet
      deps.mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

      const sheet = await service.createCharacter(avatarId, {
        race: 'human',
        className: 'fighter',
        background: 'soldier',
      });

      expect(sheet.class).toBe('fighter');
      expect(sheet.race).toBe('human');
      expect(sheet.background).toBe('soldier');
      expect(sheet.level).toBe(1);
      expect(sheet.proficiencyBonus).toBe(2);
      expect(sheet.spellcasting).toBeNull();
      expect(sheet.features).toContainEqual(
        expect.objectContaining({ id: 'fighting_style' })
      );
      expect(sheet.features).toContainEqual(
        expect.objectContaining({ id: 'second_wind' })
      );
    });

    it('should create a spellcaster with spell slots', async () => {
      deps.mockCollection.findOne.mockResolvedValue(null);
      deps.mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

      const sheet = await service.createCharacter(avatarId, {
        race: 'elf',
        className: 'wizard',
        background: 'sage',
      });

      expect(sheet.class).toBe('wizard');
      expect(sheet.spellcasting).not.toBeNull();
      expect(sheet.spellcasting.ability).toBe('intelligence');
      expect(sheet.spellcasting.type).toBe('full');
      expect(sheet.spellcasting.slots).toBeDefined();
    });

    it('should apply racial stat bonuses', async () => {
      deps.mockCollection.findOne.mockResolvedValue(null);
      deps.mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

      await service.createCharacter(avatarId, {
        race: 'dwarf', // +2 CON
        className: 'fighter',
        background: 'soldier',
      });

      // Verify updateAvatarStats was called with modified stats
      expect(deps.avatarService.updateAvatarStats).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: expect.any(ObjectId),
        }),
        expect.objectContaining({
          constitution: 18, // 16 + 2
        })
      );
    });

    it('should throw if class is unknown', async () => {
      deps.mockCollection.findOne.mockResolvedValue(null);

      await expect(
        service.createCharacter(avatarId, {
          race: 'human',
          className: 'invalidclass',
          background: 'soldier',
        })
      ).rejects.toThrow('Unknown class: invalidclass');
    });

    it('should throw if race is unknown', async () => {
      deps.mockCollection.findOne.mockResolvedValue(null);

      await expect(
        service.createCharacter(avatarId, {
          race: 'invalidrace',
          className: 'fighter',
          background: 'soldier',
        })
      ).rejects.toThrow('Unknown race: invalidrace');
    });

    it('should throw if character already exists', async () => {
      deps.mockCollection.findOne.mockResolvedValue({ _id: new ObjectId() });

      await expect(
        service.createCharacter(avatarId, {
          race: 'human',
          className: 'fighter',
          background: 'soldier',
        })
      ).rejects.toThrow('Character already exists for this avatar');
    });

    it('should throw if avatar not found', async () => {
      deps.mockCollection.findOne.mockResolvedValue(null);
      deps.avatarService.getAvatarById.mockResolvedValue(null);

      await expect(
        service.createCharacter(avatarId, {
          race: 'human',
          className: 'fighter',
          background: 'soldier',
        })
      ).rejects.toThrow('Avatar not found');
    });
  });

  describe('awardXP()', () => {
    const avatarId = '507f1f77bcf86cd799439011';

    it('should add XP without leveling up', async () => {
      deps.mockCollection.findOne.mockResolvedValue({
        avatarId: new ObjectId(avatarId),
        class: 'fighter',
        level: 1,
        experience: 0,
      });
      deps.mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

      const result = await service.awardXP(avatarId, 100);

      expect(result.newXP).toBe(100);
      expect(result.leveledUp).toBe(false);
      expect(result.level).toBe(1);
    });

    it('should trigger level up when XP threshold reached', async () => {
      deps.mockCollection.findOne.mockResolvedValue({
        avatarId: new ObjectId(avatarId),
        class: 'fighter',
        level: 1,
        experience: 200,
        spellcasting: null,
        features: [],
      });
      deps.mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

      const result = await service.awardXP(avatarId, 150); // Total 350 >= 300 (level 2)

      expect(result.newXP).toBe(350);
      expect(result.leveledUp).toBe(true);
      expect(result.newLevel).toBe(2);
    });

    it('should throw if no sheet exists', async () => {
      deps.mockCollection.findOne.mockResolvedValue(null);

      await expect(service.awardXP(avatarId, 100)).rejects.toThrow(
        'No character sheet found'
      );
    });
  });

  describe('All Classes Support', () => {
    const avatarId = '507f1f77bcf86cd799439011';
    const classes = ['fighter', 'wizard', 'rogue', 'cleric', 'ranger', 'bard'];

    it.each(classes)('should create a %s character', async (className) => {
      deps.mockCollection.findOne.mockResolvedValue(null);
      deps.mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

      const sheet = await service.createCharacter(avatarId, {
        race: 'human',
        className,
        background: 'soldier',
      });

      expect(sheet.class).toBe(className);
      expect(sheet.level).toBe(1);
    });
  });

  describe('All Races Support', () => {
    const avatarId = '507f1f77bcf86cd799439011';
    const races = ['human', 'elf', 'dwarf', 'halfling'];

    it.each(races)('should create a character with %s race', async (race) => {
      deps.mockCollection.findOne.mockResolvedValue(null);
      deps.mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

      const sheet = await service.createCharacter(avatarId, {
        race,
        className: 'fighter',
        background: 'soldier',
      });

      expect(sheet.race).toBe(race);
    });
  });

  describe('All Backgrounds Support', () => {
    const avatarId = '507f1f77bcf86cd799439011';
    const backgrounds = ['soldier', 'sage', 'criminal', 'acolyte', 'entertainer', 'hermit'];

    it.each(backgrounds)('should create a character with %s background', async (background) => {
      deps.mockCollection.findOne.mockResolvedValue(null);
      deps.mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

      const sheet = await service.createCharacter(avatarId, {
        race: 'human',
        className: 'fighter',
        background,
      });

      expect(sheet.background).toBe(background);
    });
  });
});
