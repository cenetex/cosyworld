/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/services/combat/combatEncounterService.test.mjs
 * @description Comprehensive tests for CombatEncounterService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CombatEncounterService } from '../../../src/services/combat/combatEncounterService.mjs';

const createMockDeps = () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  db: {
    collection: vi.fn().mockReturnValue({
      findOne: vi.fn(),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'session-123' }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    }),
  },
  avatarService: {
    getAvatarsByIds: vi.fn().mockResolvedValue([]),
    getAvatarById: vi.fn().mockResolvedValue(null),
    updateStats: vi.fn().mockResolvedValue(true),
  },
  itemService: {
    getItemsByOwnerId: vi.fn().mockResolvedValue([]),
    getEquippedItems: vi.fn().mockResolvedValue([]),
    useItem: vi.fn().mockResolvedValue(true),
  },
  diceService: {
    roll: vi.fn().mockReturnValue({ total: 10, rolls: [10] }),
    rollWithAdvantage: vi.fn().mockReturnValue({ total: 15, rolls: [10, 15] }),
  },
  combatMechanicsService: {
    calculateDamage: vi.fn().mockReturnValue(10),
    calculateHitChance: vi.fn().mockReturnValue(0.75),
    applyStatusEffect: vi.fn().mockResolvedValue(true),
    resolveStatusEffects: vi.fn().mockResolvedValue([]),
  },
  combatLogService: {
    logAction: vi.fn().mockResolvedValue(true),
    getCombatLog: vi.fn().mockResolvedValue([]),
  },
  locationService: {
    getLocationByChannel: vi.fn().mockResolvedValue({ name: 'Test Arena' }),
  },
});

describe('CombatEncounterService', () => {
  let service;
  let deps;
  let mockCollection;

  beforeEach(() => {
    deps = createMockDeps();
    mockCollection = deps.db.collection();
    service = new CombatEncounterService(deps);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with dependencies', () => {
      expect(service.db).toBe(deps.db);
      expect(service.avatarService).toBe(deps.avatarService);
      expect(service.itemService).toBe(deps.itemService);
    });

    it('should set default configuration', () => {
      expect(service.maxParticipants).toBeDefined();
      expect(service.roundTimeLimit).toBeDefined();
    });
  });

  describe('initiateEncounter', () => {
    const mockAttacker = {
      _id: 'attacker-123',
      name: 'Warrior',
      stats: { hp: 100, attack: 20, defense: 15 },
    };

    const mockDefender = {
      _id: 'defender-456',
      name: 'Mage',
      stats: { hp: 80, attack: 15, defense: 10 },
    };

    beforeEach(() => {
      deps.avatarService.getAvatarById
        .mockResolvedValueOnce(mockAttacker)
        .mockResolvedValueOnce(mockDefender);
    });

    it('should create a new combat session', async () => {
      const result = await service.initiateEncounter(
        'attacker-123',
        'defender-456',
        'channel-789'
      );

      expect(mockCollection.insertOne).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should reject if attacker is already in combat', async () => {
      mockCollection.findOne.mockResolvedValue({
        _id: 'existing-session',
        participants: ['attacker-123', 'other-123'],
        status: 'active',
      });

      const result = await service.initiateEncounter(
        'attacker-123',
        'defender-456',
        'channel-789'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('already in combat');
    });

    it('should reject if defender is already in combat', async () => {
      mockCollection.findOne
        .mockResolvedValueOnce(null) // Attacker not in combat
        .mockResolvedValueOnce({ // Defender in combat
          _id: 'existing-session',
          participants: ['defender-456', 'other-123'],
          status: 'active',
        });

      const result = await service.initiateEncounter(
        'attacker-123',
        'defender-456',
        'channel-789'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('already in combat');
    });

    it('should reject if attacker not found', async () => {
      deps.avatarService.getAvatarById.mockReset();
      deps.avatarService.getAvatarById.mockResolvedValue(null);

      const result = await service.initiateEncounter(
        'nonexistent',
        'defender-456',
        'channel-789'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should initialize combat state with correct structure', async () => {
      mockCollection.findOne.mockResolvedValue(null);

      await service.initiateEncounter(
        'attacker-123',
        'defender-456',
        'channel-789'
      );

      expect(mockCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          participants: expect.any(Array),
          channelId: 'channel-789',
          status: 'active',
          round: 1,
          turn: 0,
        })
      );
    });

    it('should record initiative order', async () => {
      mockCollection.findOne.mockResolvedValue(null);
      deps.diceService.roll
        .mockReturnValueOnce({ total: 15 }) // Attacker initiative
        .mockReturnValueOnce({ total: 10 }); // Defender initiative

      await service.initiateEncounter(
        'attacker-123',
        'defender-456',
        'channel-789'
      );

      const insertCall = mockCollection.insertOne.mock.calls[0][0];
      expect(insertCall.turnOrder).toBeDefined();
    });
  });

  describe('processAttack', () => {
    const mockSession = {
      _id: 'session-123',
      participants: [
        { avatarId: 'attacker-123', hp: 100, maxHp: 100 },
        { avatarId: 'defender-456', hp: 80, maxHp: 80 },
      ],
      channelId: 'channel-789',
      status: 'active',
      round: 1,
      turn: 0,
      turnOrder: ['attacker-123', 'defender-456'],
    };

    const mockAttacker = {
      _id: 'attacker-123',
      name: 'Warrior',
      stats: { attack: 20 },
    };

    const mockDefender = {
      _id: 'defender-456',
      name: 'Mage',
      stats: { defense: 10 },
    };

    beforeEach(() => {
      mockCollection.findOne.mockResolvedValue(mockSession);
      deps.avatarService.getAvatarById
        .mockResolvedValueOnce(mockAttacker)
        .mockResolvedValueOnce(mockDefender);
    });

    it('should process a successful attack', async () => {
      deps.combatMechanicsService.calculateHitChance.mockReturnValue(0.8);
      deps.diceService.roll.mockReturnValue({ total: 50 }); // 50 < 80, hit

      const result = await service.processAttack('session-123', 'attacker-123', 'defender-456');

      expect(result.success).toBe(true);
      expect(result.hit).toBe(true);
    });

    it('should process a missed attack', async () => {
      deps.combatMechanicsService.calculateHitChance.mockReturnValue(0.2);
      deps.diceService.roll.mockReturnValue({ total: 90 }); // 90 > 20, miss

      const result = await service.processAttack('session-123', 'attacker-123', 'defender-456');

      expect(result.success).toBe(true);
      expect(result.hit).toBe(false);
    });

    it('should reject if not the attacker turn', async () => {
      mockCollection.findOne.mockResolvedValue({
        ...mockSession,
        turn: 1, // Defender's turn
      });

      const result = await service.processAttack('session-123', 'attacker-123', 'defender-456');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not your turn');
    });

    it('should reject if session not found', async () => {
      mockCollection.findOne.mockResolvedValue(null);

      const result = await service.processAttack('nonexistent', 'attacker-123', 'defender-456');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should reject if session is not active', async () => {
      mockCollection.findOne.mockResolvedValue({
        ...mockSession,
        status: 'ended',
      });

      const result = await service.processAttack('session-123', 'attacker-123', 'defender-456');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not active');
    });

    it('should apply damage on hit', async () => {
      deps.combatMechanicsService.calculateHitChance.mockReturnValue(1.0);
      deps.combatMechanicsService.calculateDamage.mockReturnValue(15);

      const result = await service.processAttack('session-123', 'attacker-123', 'defender-456');

      expect(result.damage).toBe(15);
      expect(mockCollection.updateOne).toHaveBeenCalled();
    });

    it('should handle critical hits', async () => {
      deps.diceService.roll.mockReturnValue({ total: 100, crit: true }); // Natural 20

      const result = await service.processAttack('session-123', 'attacker-123', 'defender-456');

      expect(result.critical).toBe(true);
    });

    it('should advance turn after attack', async () => {
      deps.combatMechanicsService.calculateHitChance.mockReturnValue(1.0);

      await service.processAttack('session-123', 'attacker-123', 'defender-456');

      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { _id: 'session-123' },
        expect.objectContaining({
          $set: expect.objectContaining({
            turn: expect.any(Number),
          }),
        })
      );
    });

    it('should trigger knockout when defender HP reaches zero', async () => {
      const lowHpSession = {
        ...mockSession,
        participants: [
          { avatarId: 'attacker-123', hp: 100, maxHp: 100 },
          { avatarId: 'defender-456', hp: 5, maxHp: 80 }, // Low HP
        ],
      };
      mockCollection.findOne.mockResolvedValue(lowHpSession);
      deps.combatMechanicsService.calculateDamage.mockReturnValue(20); // Overkill

      const result = await service.processAttack('session-123', 'attacker-123', 'defender-456');

      expect(result.knockout).toBe(true);
    });

    it('should log combat action', async () => {
      deps.combatMechanicsService.calculateHitChance.mockReturnValue(1.0);

      await service.processAttack('session-123', 'attacker-123', 'defender-456');

      expect(deps.combatLogService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-123',
          action: 'attack',
        })
      );
    });
  });

  describe('useAbility', () => {
    const mockSession = {
      _id: 'session-123',
      participants: [
        { avatarId: 'caster-123', hp: 100, maxHp: 100, mana: 50 },
        { avatarId: 'target-456', hp: 80, maxHp: 80 },
      ],
      status: 'active',
      turn: 0,
      turnOrder: ['caster-123', 'target-456'],
    };

    const mockAbility = {
      name: 'Fireball',
      manaCost: 20,
      damage: 30,
      type: 'magic',
    };

    beforeEach(() => {
      mockCollection.findOne.mockResolvedValue(mockSession);
    });

    it('should use ability when sufficient mana', async () => {
      const result = await service.useAbility(
        'session-123',
        'caster-123',
        'target-456',
        mockAbility
      );

      expect(result.success).toBe(true);
    });

    it('should reject when insufficient mana', async () => {
      const lowManaSession = {
        ...mockSession,
        participants: [
          { avatarId: 'caster-123', hp: 100, maxHp: 100, mana: 10 }, // Low mana
          { avatarId: 'target-456', hp: 80, maxHp: 80 },
        ],
      };
      mockCollection.findOne.mockResolvedValue(lowManaSession);

      const result = await service.useAbility(
        'session-123',
        'caster-123',
        'target-456',
        mockAbility
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('insufficient mana');
    });

    it('should deduct mana on use', async () => {
      await service.useAbility(
        'session-123',
        'caster-123',
        'target-456',
        mockAbility
      );

      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { _id: 'session-123' },
        expect.objectContaining({
          $set: expect.objectContaining({
            'participants.$[caster].mana': 30, // 50 - 20
          }),
        })
      );
    });

    it('should apply status effects', async () => {
      const stunAbility = {
        name: 'Stun',
        manaCost: 15,
        statusEffect: 'stunned',
        duration: 2,
      };

      await service.useAbility(
        'session-123',
        'caster-123',
        'target-456',
        stunAbility
      );

      expect(deps.combatMechanicsService.applyStatusEffect).toHaveBeenCalledWith(
        expect.anything(),
        'target-456',
        'stunned',
        2
      );
    });
  });

  describe('flee', () => {
    const mockSession = {
      _id: 'session-123',
      participants: [
        { avatarId: 'runner-123', hp: 20, maxHp: 100 },
        { avatarId: 'pursuer-456', hp: 80, maxHp: 80 },
      ],
      status: 'active',
      turn: 0,
      turnOrder: ['runner-123', 'pursuer-456'],
    };

    beforeEach(() => {
      mockCollection.findOne.mockResolvedValue(mockSession);
    });

    it('should allow flee attempt', async () => {
      deps.diceService.roll.mockReturnValue({ total: 80 }); // High roll = success

      const result = await service.flee('session-123', 'runner-123');

      expect(result.success).toBe(true);
      expect(result.escaped).toBe(true);
    });

    it('should fail flee on low roll', async () => {
      deps.diceService.roll.mockReturnValue({ total: 20 }); // Low roll = fail

      const result = await service.flee('session-123', 'runner-123');

      expect(result.success).toBe(true); // Action succeeded
      expect(result.escaped).toBe(false); // But didn't escape
    });

    it('should end combat on successful flee', async () => {
      deps.diceService.roll.mockReturnValue({ total: 100 });

      await service.flee('session-123', 'runner-123');

      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { _id: 'session-123' },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: 'fled',
          }),
        })
      );
    });

    it('should consume turn on failed flee', async () => {
      deps.diceService.roll.mockReturnValue({ total: 10 });

      await service.flee('session-123', 'runner-123');

      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { _id: 'session-123' },
        expect.objectContaining({
          $set: expect.objectContaining({
            turn: 1, // Advanced to next turn
          }),
        })
      );
    });
  });

  describe('endCombat', () => {
    const mockSession = {
      _id: 'session-123',
      participants: [
        { avatarId: 'winner-123', hp: 50, maxHp: 100 },
        { avatarId: 'loser-456', hp: 0, maxHp: 80 },
      ],
      status: 'active',
    };

    beforeEach(() => {
      mockCollection.findOne.mockResolvedValue(mockSession);
    });

    it('should end combat and declare winner', async () => {
      const result = await service.endCombat('session-123', 'knockout');

      expect(result.success).toBe(true);
      expect(result.winner).toBe('winner-123');
    });

    it('should update session status', async () => {
      await service.endCombat('session-123', 'knockout');

      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { _id: 'session-123' },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: 'ended',
            endReason: 'knockout',
          }),
        })
      );
    });

    it('should award experience to winner', async () => {
      await service.endCombat('session-123', 'knockout');

      expect(deps.avatarService.updateStats).toHaveBeenCalledWith(
        'winner-123',
        expect.objectContaining({
          experience: expect.any(Number),
        })
      );
    });

    it('should update combat statistics', async () => {
      await service.endCombat('session-123', 'knockout');

      // Winner gets win count increment
      expect(deps.avatarService.updateStats).toHaveBeenCalledWith(
        'winner-123',
        expect.objectContaining({
          'combatStats.wins': expect.any(Number),
        })
      );
    });
  });

  describe('getActiveCombat', () => {
    it('should return active combat for avatar', async () => {
      const mockSession = {
        _id: 'session-123',
        participants: [{ avatarId: 'avatar-123' }],
        status: 'active',
      };
      mockCollection.findOne.mockResolvedValue(mockSession);

      const result = await service.getActiveCombat('avatar-123');

      expect(result).toEqual(mockSession);
    });

    it('should return null if no active combat', async () => {
      mockCollection.findOne.mockResolvedValue(null);

      const result = await service.getActiveCombat('avatar-123');

      expect(result).toBeNull();
    });
  });

  describe('getCombatStatus', () => {
    const mockSession = {
      _id: 'session-123',
      participants: [
        { avatarId: 'a1', hp: 75, maxHp: 100, statusEffects: [] },
        { avatarId: 'a2', hp: 50, maxHp: 80, statusEffects: ['poisoned'] },
      ],
      status: 'active',
      round: 3,
      turn: 1,
      turnOrder: ['a1', 'a2'],
    };

    beforeEach(() => {
      mockCollection.findOne.mockResolvedValue(mockSession);
    });

    it('should return formatted combat status', async () => {
      const status = await service.getCombatStatus('session-123');

      expect(status).toMatchObject({
        round: 3,
        currentTurn: 'a2',
        participants: expect.any(Array),
      });
    });

    it('should include health percentages', async () => {
      const status = await service.getCombatStatus('session-123');

      expect(status.participants[0].healthPercent).toBe(75);
      expect(status.participants[1].healthPercent).toBeCloseTo(62.5);
    });

    it('should include status effects', async () => {
      const status = await service.getCombatStatus('session-123');

      expect(status.participants[1].statusEffects).toContain('poisoned');
    });
  });

  describe('cleanup', () => {
    it('should remove stale combat sessions', async () => {
      const staleSessions = [
        { _id: 'stale-1', createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        { _id: 'stale-2', createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
      ];
      mockCollection.find().toArray.mockResolvedValue(staleSessions);

      await service.cleanup();

      expect(mockCollection.deleteMany).toHaveBeenCalled();
    });

    it('should log cleanup results', async () => {
      mockCollection.deleteMany.mockResolvedValue({ deletedCount: 5 });

      await service.cleanup();

      expect(deps.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('5'),
        expect.any(Object)
      );
    });
  });
});

describe('CombatEncounterService - Status Effects', () => {
  let service;
  let deps;

  beforeEach(() => {
    deps = createMockDeps();
    service = new CombatEncounterService(deps);
  });

  it('should process status effects at turn start', async () => {
    const mockSession = {
      _id: 'session-123',
      participants: [
        {
          avatarId: 'poisoned-123',
          hp: 100,
          statusEffects: [{ type: 'poison', damage: 5, duration: 2 }],
        },
      ],
      status: 'active',
      turn: 0,
      turnOrder: ['poisoned-123'],
    };
    deps.db.collection().findOne.mockResolvedValue(mockSession);

    await service.processTurnStart('session-123', 'poisoned-123');

    expect(deps.combatMechanicsService.resolveStatusEffects).toHaveBeenCalled();
  });

  it('should remove expired status effects', async () => {
    deps.combatMechanicsService.resolveStatusEffects.mockResolvedValue([
      { type: 'poison', expired: true },
    ]);

    const mockSession = {
      _id: 'session-123',
      participants: [
        {
          avatarId: 'affected-123',
          statusEffects: [{ type: 'poison', duration: 0 }],
        },
      ],
      status: 'active',
    };
    deps.db.collection().findOne.mockResolvedValue(mockSession);

    await service.processTurnStart('session-123', 'affected-123');

    // Should update to remove expired effect
    expect(deps.db.collection().updateOne).toHaveBeenCalled();
  });
});

describe('CombatEncounterService - Item Usage', () => {
  let service;
  let deps;

  beforeEach(() => {
    deps = createMockDeps();
    service = new CombatEncounterService(deps);
  });

  it('should allow using consumable items in combat', async () => {
    const mockSession = {
      _id: 'session-123',
      participants: [{ avatarId: 'user-123', hp: 30, maxHp: 100 }],
      status: 'active',
      turn: 0,
      turnOrder: ['user-123'],
    };
    deps.db.collection().findOne.mockResolvedValue(mockSession);

    const healthPotion = {
      _id: 'item-123',
      name: 'Health Potion',
      type: 'consumable',
      effect: { heal: 50 },
    };
    deps.itemService.getItemsByOwnerId.mockResolvedValue([healthPotion]);

    const result = await service.useItem('session-123', 'user-123', 'item-123');

    expect(result.success).toBe(true);
    expect(deps.itemService.useItem).toHaveBeenCalledWith('item-123');
  });

  it('should reject using items not owned', async () => {
    const mockSession = {
      _id: 'session-123',
      participants: [{ avatarId: 'user-123' }],
      status: 'active',
    };
    deps.db.collection().findOne.mockResolvedValue(mockSession);
    deps.itemService.getItemsByOwnerId.mockResolvedValue([]); // No items

    const result = await service.useItem('session-123', 'user-123', 'item-123');

    expect(result.success).toBe(false);
    expect(result.error).toContain('item not found');
  });

  it('should apply item effects', async () => {
    const mockSession = {
      _id: 'session-123',
      participants: [{ avatarId: 'user-123', hp: 30, maxHp: 100 }],
      status: 'active',
      turn: 0,
      turnOrder: ['user-123'],
    };
    deps.db.collection().findOne.mockResolvedValue(mockSession);

    const healthPotion = {
      _id: 'item-123',
      effect: { heal: 50 },
    };
    deps.itemService.getItemsByOwnerId.mockResolvedValue([healthPotion]);

    await service.useItem('session-123', 'user-123', 'item-123');

    // HP should increase (capped at max)
    expect(deps.db.collection().updateOne).toHaveBeenCalledWith(
      { _id: 'session-123' },
      expect.objectContaining({
        $set: expect.objectContaining({
          'participants.$[user].hp': 80, // 30 + 50
        }),
      })
    );
  });
});
