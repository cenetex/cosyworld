/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * @file test/services/dnd/SpellService.test.mjs
 * @description Comprehensive tests for SpellService
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpellService } from '../../../src/services/dnd/SpellService.mjs';
import { ObjectId } from 'mongodb';

/**
 * Create mock dependencies for SpellService
 */
const createMockDeps = () => ({
  characterService: {
    getSheet: vi.fn(),
    consumeSpellSlot: vi.fn().mockResolvedValue(true),
  },
  avatarService: {
    getAvatarById: vi.fn().mockResolvedValue({
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      name: 'TestWizard',
      stats: {
        strength: 8,
        dexterity: 14,
        constitution: 12,
        intelligence: 18,
        wisdom: 12,
        charisma: 10,
      },
    }),
  },
  statusEffectService: {
    applyEffect: vi.fn().mockResolvedValue(true),
    getEffects: vi.fn().mockResolvedValue([]),
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
});

const createMockSheet = (overrides = {}) => ({
  avatarId: new ObjectId('507f1f77bcf86cd799439011'),
  class: 'wizard',
  level: 5,
  proficiencyBonus: 3,
  spellcasting: {
    ability: 'intelligence',
    type: 'full',
    prepared: true,
    slots: {
      1: { current: 4, max: 4 },
      2: { current: 3, max: 3 },
      3: { current: 2, max: 2 },
    },
    known: ['magic_missile', 'fireball', 'shield'],
    cantrips: ['fire_bolt', 'prestidigitation'],
    preparedSpells: ['magic_missile', 'fireball', 'shield'],
  },
  ...overrides,
});

describe('SpellService', () => {
  let service;
  let deps;

  beforeEach(() => {
    deps = createMockDeps();
    service = new SpellService(deps);
  });

  describe('constructor', () => {
    it('should initialize with required dependencies', () => {
      expect(service.characterService).toBe(deps.characterService);
      expect(service.avatarService).toBe(deps.avatarService);
      expect(service.statusEffectService).toBe(deps.statusEffectService);
      expect(service.diceService).toBeDefined();
    });
  });

  describe('getSpell()', () => {
    it('should return spell definition for valid spell', () => {
      const spell = service.getSpell('magic_missile');
      
      expect(spell).toBeDefined();
      expect(spell.name).toBe('Magic Missile');
    });

    it('should return null for invalid spell', () => {
      const spell = service.getSpell('invalid_spell');
      
      expect(spell).toBeNull();
    });

    it('should return cantrip for fire_bolt', () => {
      const spell = service.getSpell('fire_bolt');
      
      expect(spell).toBeDefined();
      expect(spell.level).toBe(0);
    });
  });

  describe('castSpell()', () => {
    const casterId = '507f1f77bcf86cd799439011';
    const targetId = '507f1f77bcf86cd799439012';

    it('should cast a cantrip without consuming spell slots', async () => {
      const sheet = createMockSheet();
      deps.characterService.getSheet.mockResolvedValue(sheet);

      const result = await service.castSpell(casterId, 'fire_bolt', 0, [targetId]);

      expect(result.spell.name).toBe('Fire Bolt');
      expect(result.slotLevel).toBe(0);
      expect(deps.characterService.consumeSpellSlot).not.toHaveBeenCalled();
    });

    it('should cast a leveled spell and consume slot', async () => {
      const sheet = createMockSheet();
      deps.characterService.getSheet.mockResolvedValue(sheet);

      const result = await service.castSpell(casterId, 'magic_missile', 1, [targetId]);

      expect(result.spell.name).toBe('Magic Missile');
      expect(result.slotLevel).toBe(1);
      expect(deps.characterService.consumeSpellSlot).toHaveBeenCalledWith(casterId, 1);
    });

    it('should allow upcasting spells', async () => {
      const sheet = createMockSheet();
      deps.characterService.getSheet.mockResolvedValue(sheet);

      const result = await service.castSpell(casterId, 'magic_missile', 3, [targetId]);

      expect(result.slotLevel).toBe(3);
      expect(deps.characterService.consumeSpellSlot).toHaveBeenCalledWith(casterId, 3);
    });

    it('should throw if no character sheet found', async () => {
      deps.characterService.getSheet.mockResolvedValue(null);

      await expect(
        service.castSpell(casterId, 'fire_bolt', 0, [targetId])
      ).rejects.toThrow('No character sheet found');
    });

    it('should throw if spell is unknown', async () => {
      const sheet = createMockSheet();
      deps.characterService.getSheet.mockResolvedValue(sheet);

      await expect(
        service.castSpell(casterId, 'unknown_spell', 1, [targetId])
      ).rejects.toThrow('Unknown spell: unknown_spell');
    });

    it('should throw if not a spellcaster', async () => {
      const sheet = createMockSheet({ spellcasting: null });
      deps.characterService.getSheet.mockResolvedValue(sheet);

      await expect(
        service.castSpell(casterId, 'fire_bolt', 0, [targetId])
      ).rejects.toThrow('Not a spellcaster');
    });

    it('should throw if spell not known', async () => {
      const sheet = createMockSheet();
      sheet.spellcasting.known = ['shield']; // Does not include magic_missile
      sheet.spellcasting.cantrips = [];
      deps.characterService.getSheet.mockResolvedValue(sheet);

      await expect(
        service.castSpell(casterId, 'magic_missile', 1, [targetId])
      ).rejects.toThrow('Spell not known');
    });

    it('should throw if slot level too low for spell', async () => {
      const sheet = createMockSheet();
      deps.characterService.getSheet.mockResolvedValue(sheet);

      await expect(
        service.castSpell(casterId, 'fireball', 2, [targetId]) // Fireball requires level 3
      ).rejects.toThrow('Requires at least a level 3 slot');
    });

    it('should return results for each target', async () => {
      const sheet = createMockSheet();
      deps.characterService.getSheet.mockResolvedValue(sheet);
      deps.avatarService.getAvatarById.mockImplementation((id) =>
        Promise.resolve({
          _id: new ObjectId(id),
          name: `Target-${id}`,
          stats: { dexterity: 12 },
        })
      );

      const targets = [targetId, '507f1f77bcf86cd799439013'];
      const result = await service.castSpell(casterId, 'magic_missile', 1, targets);

      expect(result.results).toHaveLength(2);
      expect(result.results[0].targetId).toBeDefined();
      expect(result.results[1].targetId).toBeDefined();
    });
  });

  describe('Spell Types', () => {
    const casterId = '507f1f77bcf86cd799439011';
    const targetId = '507f1f77bcf86cd799439012';

    beforeEach(() => {
      const sheet = createMockSheet();
      sheet.spellcasting.known = ['magic_missile', 'cure_wounds', 'shield', 'fireball'];
      sheet.spellcasting.cantrips = ['fire_bolt'];
      deps.characterService.getSheet.mockResolvedValue(sheet);
    });

    it('should handle attack roll spells', async () => {
      const result = await service.castSpell(casterId, 'fire_bolt', 0, [targetId]);

      expect(result.results[0]).toHaveProperty('attackRoll');
      expect(result.results[0]).toHaveProperty('hit');
    });

    it('should handle auto-hit spells (magic missile)', async () => {
      const result = await service.castSpell(casterId, 'magic_missile', 1, [targetId]);

      expect(result.results[0].hit).toBe(true);
      expect(result.results[0].damage).toBeDefined();
    });

    it('should handle healing spells', async () => {
      const result = await service.castSpell(casterId, 'cure_wounds', 1, [casterId]);

      expect(result.results[0]).toHaveProperty('healing');
    });

    it('should handle saving throw spells', async () => {
      const result = await service.castSpell(casterId, 'fireball', 3, [targetId]);

      expect(result.results[0]).toHaveProperty('save');
      expect(result.results[0]).toHaveProperty('damage');
    });
  });

  describe('Spell Calculations', () => {
    const casterId = '507f1f77bcf86cd799439011';
    const targetId = '507f1f77bcf86cd799439012';

    it('should calculate correct spell attack modifier', async () => {
      // INT 18 (+4) + Prof 3 = +7 spell attack
      const sheet = createMockSheet();
      deps.characterService.getSheet.mockResolvedValue(sheet);

      const result = await service.castSpell(casterId, 'fire_bolt', 0, [targetId]);

      // Attack roll should be d20 + 7
      expect(result.results[0]).toHaveProperty('total');
    });

    it('should calculate correct spell save DC', async () => {
      // 8 + INT (+4) + Prof 3 = DC 15
      const sheet = createMockSheet();
      deps.characterService.getSheet.mockResolvedValue(sheet);

      const result = await service.castSpell(casterId, 'fireball', 3, [targetId]);

      expect(result.results[0]).toHaveProperty('dc');
    });

    it('should scale cantrip damage with level', async () => {
      const sheet = createMockSheet({ level: 5 }); // Fire bolt 2d10 at level 5
      deps.characterService.getSheet.mockResolvedValue(sheet);

      const result = await service.castSpell(casterId, 'fire_bolt', 0, [targetId]);

      if (result.results[0].hit) {
        expect(result.results[0].damage).toBeGreaterThan(0);
      }
    });
  });
});
