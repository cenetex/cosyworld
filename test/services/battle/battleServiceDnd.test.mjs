/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/services/battle/battleServiceDnd.test.mjs
 * @description Unit tests for BattleService D&D Integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BattleService } from '../../../src/services/battle/battleService.mjs';

describe('BattleService D&D Integration', () => {
  let battleService;
  let mockAvatarService;
  let mockDatabaseService;
  let mockStatService;
  let mockDiceService;
  let mockCharacterService;
  let mockCombatEquipmentService;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    };

    mockAvatarService = {
      getOrCreateStats: vi.fn(),
      updateAvatarStats: vi.fn(),
      updateAvatar: vi.fn(),
    };

    mockDatabaseService = {
      getDatabase: vi.fn().mockResolvedValue({
        collection: vi.fn().mockReturnValue({
          deleteMany: vi.fn().mockResolvedValue({}),
        }),
      }),
    };

    mockStatService = {
      createModifier: vi.fn().mockResolvedValue({}),
      getTotalModifier: vi.fn().mockResolvedValue(0),
      generateStatsFromDate: vi.fn().mockReturnValue({
        strength: 14,
        dexterity: 12,
        constitution: 14,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
        hp: 11,
      }),
    };

    mockDiceService = {
      rollDie: vi.fn(),
    };

    mockCharacterService = {
      getSheet: vi.fn(),
    };

    mockCombatEquipmentService = {
      getEquippedWeapon: vi.fn(),
      getEquippedArmor: vi.fn(),
      calculateAC: vi.fn(),
      rollWeaponDamage: vi.fn(),
    };

    battleService = new BattleService({
      avatarService: mockAvatarService,
      logger: mockLogger,
      databaseService: mockDatabaseService,
      statService: mockStatService,
      mapService: null,
      diceService: mockDiceService,
      eventPublisher: null,
      characterService: mockCharacterService,
      combatEquipmentService: mockCombatEquipmentService,
    });
  });

  describe('_abilityMod', () => {
    it('should calculate ability modifier correctly', () => {
      expect(battleService._abilityMod(10)).toBe(0);
      expect(battleService._abilityMod(8)).toBe(-1);
      expect(battleService._abilityMod(12)).toBe(1);
      expect(battleService._abilityMod(14)).toBe(2);
      expect(battleService._abilityMod(16)).toBe(3);
      expect(battleService._abilityMod(18)).toBe(4);
      expect(battleService._abilityMod(20)).toBe(5);
    });

    it('should handle undefined/null gracefully', () => {
      expect(battleService._abilityMod(undefined)).toBe(0);
      expect(battleService._abilityMod(null)).toBe(0);
    });
  });

  describe('_checkWeaponProficiency', () => {
    it('should return false if no sheet', () => {
      expect(battleService._checkWeaponProficiency(null, { type: 'longsword' })).toBe(false);
    });

    it('should return false if no weapon', () => {
      expect(battleService._checkWeaponProficiency({ proficiencies: { weapons: ['martial'] } }, null)).toBe(false);
    });

    it('should return true for exact weapon match', () => {
      const sheet = { proficiencies: { weapons: ['longsword', 'shortsword'] } };
      const weapon = { weaponType: 'longsword' };
      expect(battleService._checkWeaponProficiency(sheet, weapon)).toBe(true);
    });

    it('should return true for martial proficiency', () => {
      const sheet = { proficiencies: { weapons: ['martial'] } };
      const weapon = { weaponType: 'longsword' };
      expect(battleService._checkWeaponProficiency(sheet, weapon)).toBe(true);
    });

    it('should return true for simple proficiency', () => {
      const sheet = { proficiencies: { weapons: ['simple'] } };
      const weapon = { weaponType: 'club' };
      expect(battleService._checkWeaponProficiency(sheet, weapon)).toBe(true);
    });
  });

  describe('_getCombatBonuses', () => {
    const mockAvatar = { _id: 'avatar-1', name: 'Fighter' };
    const mockStats = { strength: 16, dexterity: 14, constitution: 14 };

    it('should return base values without character sheet', async () => {
      mockCharacterService.getSheet.mockResolvedValue(null);
      mockCombatEquipmentService.getEquippedWeapon.mockResolvedValue(null);

      const bonuses = await battleService._getCombatBonuses(mockAvatar, mockStats);

      expect(bonuses.proficiencyBonus).toBe(0);
      expect(bonuses.isProficientWithWeapon).toBe(false);
      expect(bonuses.attackMod).toBe(3); // STR mod only
    });

    it('should add proficiency bonus when proficient with weapon', async () => {
      mockCharacterService.getSheet.mockResolvedValue({
        proficiencyBonus: 2,
        proficiencies: { weapons: ['martial'] },
      });
      mockCombatEquipmentService.getEquippedWeapon.mockResolvedValue({
        name: 'Longsword',
        weaponType: 'longsword',
        statBonus: 'strength',
        damage: { dice: 8, count: 1 },
      });

      const bonuses = await battleService._getCombatBonuses(mockAvatar, mockStats);

      expect(bonuses.proficiencyBonus).toBe(2);
      expect(bonuses.isProficientWithWeapon).toBe(true);
      expect(bonuses.attackMod).toBe(5); // STR mod (3) + proficiency (2)
    });

    it('should use weapon attack bonus for magic weapons', async () => {
      mockCharacterService.getSheet.mockResolvedValue({
        proficiencyBonus: 2,
        proficiencies: { weapons: ['martial'] },
      });
      mockCombatEquipmentService.getEquippedWeapon.mockResolvedValue({
        name: 'Longsword +1',
        weaponType: 'longsword',
        statBonus: 'strength',
        attackBonus: 1,
        damage: { dice: 8, count: 1 },
      });

      const bonuses = await battleService._getCombatBonuses(mockAvatar, mockStats);

      expect(bonuses.attackMod).toBe(6); // STR mod (3) + proficiency (2) + magic (1)
    });

    it('should use DEX for finesse weapons', async () => {
      mockCharacterService.getSheet.mockResolvedValue({
        proficiencyBonus: 2,
        proficiencies: { weapons: ['martial'] },
      });
      mockCombatEquipmentService.getEquippedWeapon.mockResolvedValue({
        name: 'Rapier',
        weaponType: 'rapier',
        statBonus: 'dexterity',
        damage: { dice: 8, count: 1 },
      });

      const bonuses = await battleService._getCombatBonuses(mockAvatar, mockStats);

      expect(bonuses.attackAbility).toBe('dexterity');
      expect(bonuses.attackMod).toBe(4); // DEX mod (2) + proficiency (2)
    });
  });

  describe('_calculateDefenderAC', () => {
    const mockAvatar = { _id: 'defender-1', name: 'Target' };
    const mockStats = { dexterity: 14 };

    it('should return base AC + DEX mod without armor', async () => {
      mockCombatEquipmentService.getEquippedArmor.mockResolvedValue(null);

      const ac = await battleService._calculateDefenderAC(mockAvatar, mockStats, false);

      expect(ac).toBe(12); // 10 + DEX mod (2)
    });

    it('should add defensive stance bonus', async () => {
      mockCombatEquipmentService.getEquippedArmor.mockResolvedValue(null);

      const ac = await battleService._calculateDefenderAC(mockAvatar, mockStats, true);

      expect(ac).toBe(14); // 10 + DEX mod (2) + defend bonus (2)
    });

    it('should use armor AC calculation when armor equipped', async () => {
      const mockArmor = { name: 'Chain Mail', acBase: 16, category: 'heavy' };
      mockCombatEquipmentService.getEquippedArmor.mockResolvedValue(mockArmor);
      mockCombatEquipmentService.calculateAC.mockReturnValue(16);

      const ac = await battleService._calculateDefenderAC(mockAvatar, mockStats, false);

      expect(mockCombatEquipmentService.calculateAC).toHaveBeenCalledWith(mockArmor, mockStats);
      expect(ac).toBe(16);
    });
  });

  describe('_rollWeaponDamage', () => {
    const mockStats = { strength: 16, dexterity: 14 };

    it('should use equipment service for weapon damage', () => {
      const mockWeapon = { name: 'Longsword', statBonus: 'strength' };
      mockCombatEquipmentService.rollWeaponDamage.mockReturnValue(10);

      const damage = battleService._rollWeaponDamage(mockWeapon, mockStats, false);

      expect(mockCombatEquipmentService.rollWeaponDamage).toHaveBeenCalledWith(mockWeapon, mockStats, false);
      expect(damage).toBe(10);
    });

    it('should double dice on critical hit', () => {
      const mockWeapon = { name: 'Longsword', statBonus: 'strength' };
      mockCombatEquipmentService.rollWeaponDamage.mockReturnValue(18);

      const damage = battleService._rollWeaponDamage(mockWeapon, mockStats, true);

      expect(mockCombatEquipmentService.rollWeaponDamage).toHaveBeenCalledWith(mockWeapon, mockStats, true);
      expect(damage).toBe(18);
    });

    it('should fallback to 1d8 + STR when no weapon', () => {
      mockDiceService.rollDie.mockReturnValue(5);

      const damage = battleService._rollWeaponDamage(null, mockStats, false);

      expect(mockDiceService.rollDie).toHaveBeenCalledWith(8);
      expect(damage).toBe(8); // 5 + STR mod (3)
    });

    it('should return minimum 1 damage', () => {
      mockDiceService.rollDie.mockReturnValue(1);

      const damage = battleService._rollWeaponDamage(null, { strength: 6 }, false);

      expect(damage).toBe(1); // 1 + STR mod (-2) = -1, clamped to 1
    });
  });

  describe('attack - D&D integration', () => {
    const mockMessage = { channel: { id: 'channel-1' }, id: 'msg-1' };
    const mockAttacker = { _id: 'attacker-1', name: 'Fighter', status: 'active' };
    const mockDefender = { _id: 'defender-1', name: 'Goblin', status: 'active' };
    const mockAttackerStats = { strength: 16, dexterity: 12 };
    const mockDefenderStats = { dexterity: 12, hp: 10, isDefending: false };

    beforeEach(() => {
      mockAvatarService.getOrCreateStats
        .mockResolvedValueOnce(mockAttackerStats)
        .mockResolvedValueOnce(mockDefenderStats);
      mockCharacterService.getSheet.mockResolvedValue({
        proficiencyBonus: 2,
        proficiencies: { weapons: ['martial'] },
      });
      mockCombatEquipmentService.getEquippedWeapon.mockResolvedValue({
        name: 'Longsword',
        weaponType: 'longsword',
        statBonus: 'strength',
        damage: { dice: 8, count: 1 },
      });
      mockCombatEquipmentService.getEquippedArmor.mockResolvedValue(null);
    });

    it('should hit when attack roll >= AC', async () => {
      // Roll 15 + 5 (STR 3 + prof 2) = 20 vs AC 11 (10 + DEX 1)
      mockDiceService.rollDie.mockReturnValue(15);
      mockCombatEquipmentService.rollWeaponDamage.mockReturnValue(8);

      const result = await battleService.attack({
        message: mockMessage,
        attacker: mockAttacker,
        defender: mockDefender,
      });

      expect(result.result).toBe('hit');
      expect(result.weapon).toBe('Longsword');
      expect(result.damage).toBe(8);
      expect(result.message).toContain('Longsword');
    });

    it('should miss when attack roll < AC', async () => {
      // Roll 2 + 5 (STR 3 + prof 2) = 7 vs AC 11 (10 + DEX 1)
      mockDiceService.rollDie.mockReturnValue(2);

      const result = await battleService.attack({
        message: mockMessage,
        attacker: mockAttacker,
        defender: mockDefender,
      });

      expect(result.result).toBe('miss');
      expect(result.weapon).toBe('Longsword');
      expect(result.message).toContain('Longsword');
    });

    it('should critical hit on natural 20', async () => {
      mockDiceService.rollDie.mockReturnValue(20);
      mockCombatEquipmentService.rollWeaponDamage.mockReturnValue(16); // Crit damage

      const result = await battleService.attack({
        message: mockMessage,
        attacker: mockAttacker,
        defender: mockDefender,
      });

      expect(result.result).toBe('hit');
      expect(result.critical).toBe(true);
      expect(mockCombatEquipmentService.rollWeaponDamage).toHaveBeenCalledWith(
        expect.any(Object),
        mockAttackerStats,
        true
      );
    });

    it('should include proficiency in attack breakdown', async () => {
      mockDiceService.rollDie.mockReturnValue(15);
      mockCombatEquipmentService.rollWeaponDamage.mockReturnValue(8);

      const result = await battleService.attack({
        message: mockMessage,
        attacker: mockAttacker,
        defender: mockDefender,
      });

      // Message should show breakdown: roll+abilityMod+proficiency
      expect(result.message).toMatch(/15\+3\+2=20/);
    });
  });
});
