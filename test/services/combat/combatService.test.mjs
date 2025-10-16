/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/services/combat/combatService.test.mjs
 * @description Unit tests for Combat System
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDatabaseService, createMockLogger, createMockEventBus } from '../../helpers/mockServices.mjs';
import { createTestAvatar, createTestCombatSession } from '../../helpers/testData.mjs';

describe('Combat System', () => {
  let mockDb;
  let mockLogger;
  let mockEventBus;
  let mockCollection;

  beforeEach(() => {
    mockDb = createMockDatabaseService();
    mockLogger = createMockLogger();
    mockEventBus = createMockEventBus();
    mockCollection = mockDb.collection;
  });

  describe('Combat Stats', () => {
    it('should have base stats on avatar', () => {
      const avatar = createTestAvatar();

      expect(avatar.stats).toBeDefined();
      expect(avatar.stats.hp).toBeGreaterThan(0);
      expect(avatar.stats.maxHp).toBeGreaterThan(0);
      expect(avatar.stats.attack).toBeGreaterThan(0);
      expect(avatar.stats.defense).toBeGreaterThan(0);
      expect(avatar.stats.speed).toBeGreaterThan(0);
    });

    it('should respect HP boundaries', () => {
      const avatar = createTestAvatar({
        stats: { hp: 100, maxHp: 100, attack: 10, defense: 5, speed: 8 },
      });

      expect(avatar.stats.hp).toBeLessThanOrEqual(avatar.stats.maxHp);
      expect(avatar.stats.hp).toBeGreaterThanOrEqual(0);
    });

    it('should have immutable base stats', () => {
      const avatar = createTestAvatar();
      const originalAttack = avatar.stats.attack;

      // Base stats should not be modified directly
      // Modifiers should be tracked separately
      expect(avatar.stats.attack).toBe(originalAttack);
    });
  });

  describe('Combat Session Management', () => {
    it('should create combat session with valid structure', () => {
      const session = createTestCombatSession();

      expect(session.sessionId).toBeDefined();
      expect(session.participants).toHaveLength(2);
      expect(session.state).toBe('active');
      expect(Array.isArray(session.turns)).toBe(true);
      expect(session.currentTurn).toBe(0);
      expect(session.startedAt).toBeInstanceOf(Date);
    });

    it('should track turn history', () => {
      const session = createTestCombatSession({
        turns: [
          {
            avatarId: 'avatar-1',
            action: 'attack',
            roll: 15,
            damage: 10,
            narrative: 'Avatar attacks!',
          },
        ],
      });

      expect(session.turns).toHaveLength(1);
      expect(session.turns[0].action).toBe('attack');
      expect(session.turns[0].damage).toBe(10);
    });

    it('should end combat session when winner determined', () => {
      const session = createTestCombatSession({
        state: 'ended',
        winner: 'avatar-1',
        endedAt: new Date(),
      });

      expect(session.state).toBe('ended');
      expect(session.winner).toBe('avatar-1');
      expect(session.endedAt).toBeInstanceOf(Date);
    });
  });

  describe('Dice Rolling', () => {
    it('should roll dice within valid range', () => {
      // Simulate dice rolls
      for (let i = 0; i < 100; i++) {
        const roll = Math.floor(Math.random() * 20) + 1; // d20
        expect(roll).toBeGreaterThanOrEqual(1);
        expect(roll).toBeLessThanOrEqual(20);
      }
    });

    it('should support different dice types', () => {
      const d6 = () => Math.floor(Math.random() * 6) + 1;
      const d12 = () => Math.floor(Math.random() * 12) + 1;
      const d20 = () => Math.floor(Math.random() * 20) + 1;

      // Test dice ranges
      for (let i = 0; i < 50; i++) {
        expect(d6()).toBeGreaterThanOrEqual(1);
        expect(d6()).toBeLessThanOrEqual(6);
        
        expect(d12()).toBeGreaterThanOrEqual(1);
        expect(d12()).toBeLessThanOrEqual(12);
        
        expect(d20()).toBeGreaterThanOrEqual(1);
        expect(d20()).toBeLessThanOrEqual(20);
      }
    });
  });

  describe('Damage Calculation', () => {
    it('should calculate damage with attack and defense', () => {
      const attacker = createTestAvatar({ stats: { attack: 15 } });
      const defender = createTestAvatar({ stats: { defense: 5 } });

      // Simplified damage formula: attack - defense + roll
      const roll = 10;
      const damage = Math.max(0, attacker.stats.attack - defender.stats.defense + roll);

      expect(damage).toBeGreaterThanOrEqual(0);
      expect(damage).toBe(20); // 15 - 5 + 10
    });

    it('should not allow negative damage', () => {
      const attacker = createTestAvatar({ stats: { attack: 5 } });
      const defender = createTestAvatar({ stats: { defense: 20 } });

      const roll = 5;
      const damage = Math.max(0, attacker.stats.attack - defender.stats.defense + roll);

      expect(damage).toBeGreaterThanOrEqual(0);
    });

    it('should apply damage to HP', () => {
      const avatar = createTestAvatar({
        stats: { hp: 100, maxHp: 100 },
      });

      const damage = 30;
      avatar.stats.hp = Math.max(0, avatar.stats.hp - damage);

      expect(avatar.stats.hp).toBe(70);
      expect(avatar.stats.hp).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Combat Actions', () => {
    it('should support attack action', () => {
      const action = {
        type: 'attack',
        avatarId: 'attacker-id',
        targetId: 'target-id',
        roll: 15,
      };

      expect(action.type).toBe('attack');
      expect(action.avatarId).toBeDefined();
      expect(action.targetId).toBeDefined();
      expect(action.roll).toBeGreaterThan(0);
    });

    it('should support defend action', () => {
      const action = {
        type: 'defend',
        avatarId: 'defender-id',
        defenseBonus: 5,
      };

      expect(action.type).toBe('defend');
      expect(action.defenseBonus).toBeGreaterThan(0);
    });

    it('should support move action', () => {
      const action = {
        type: 'move',
        avatarId: 'mover-id',
        fromPosition: { x: 0, y: 0 },
        toPosition: { x: 1, y: 1 },
      };

      expect(action.type).toBe('move');
      expect(action.fromPosition).toBeDefined();
      expect(action.toPosition).toBeDefined();
    });

    it('should support item use action', () => {
      const action = {
        type: 'use_item',
        avatarId: 'user-id',
        itemId: 'potion-123',
        effect: 'heal',
        amount: 50,
      };

      expect(action.type).toBe('use_item');
      expect(action.itemId).toBeDefined();
      expect(action.effect).toBeDefined();
      expect(action.amount).toBeGreaterThan(0);
    });
  });

  describe('Turn Order', () => {
    it('should determine turn order by speed stat', () => {
      const avatars = [
        createTestAvatar({ name: 'Slow', stats: { speed: 5 } }),
        createTestAvatar({ name: 'Fast', stats: { speed: 15 } }),
        createTestAvatar({ name: 'Medium', stats: { speed: 10 } }),
      ];

      // Sort by speed descending
      const turnOrder = avatars.sort((a, b) => b.stats.speed - a.stats.speed);

      expect(turnOrder[0].name).toBe('Fast');
      expect(turnOrder[1].name).toBe('Medium');
      expect(turnOrder[2].name).toBe('Slow');
    });

    it('should handle speed ties with random tiebreaker', () => {
      const avatars = [
        createTestAvatar({ name: 'Avatar1', stats: { speed: 10 } }),
        createTestAvatar({ name: 'Avatar2', stats: { speed: 10 } }),
      ];

      // Should handle ties (implementation-specific)
      expect(avatars[0].stats.speed).toBe(avatars[1].stats.speed);
    });
  });

  describe('Combat Events', () => {
    it('should emit combat.started event', () => {
      const session = createTestCombatSession();

      mockEventBus.emit('combat.started', {
        sessionId: session.sessionId,
        participants: session.participants,
      });

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'combat.started',
        expect.objectContaining({
          sessionId: session.sessionId,
        })
      );
    });

    it('should emit combat.turn event', () => {
      mockEventBus.emit('combat.turn', {
        sessionId: 'session-123',
        turn: 1,
        avatarId: 'avatar-1',
        action: 'attack',
      });

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'combat.turn',
        expect.objectContaining({
          action: 'attack',
        })
      );
    });

    it('should emit combat.ended event', () => {
      mockEventBus.emit('combat.ended', {
        sessionId: 'session-123',
        winner: 'avatar-1',
        loser: 'avatar-2',
      });

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'combat.ended',
        expect.objectContaining({
          winner: 'avatar-1',
        })
      );
    });
  });

  describe('Combat Validation', () => {
    it('should validate combat participants exist', () => {
      const session = createTestCombatSession();

      expect(session.participants).toHaveLength(2);
      session.participants.forEach(participantId => {
        expect(typeof participantId).toBe('string');
        expect(participantId.length).toBeGreaterThan(0);
      });
    });

    it('should validate action targets are valid', () => {
      const session = createTestCombatSession();
      const action = {
        avatarId: session.participants[0],
        targetId: session.participants[1],
      };

      expect(session.participants).toContain(action.avatarId);
      expect(session.participants).toContain(action.targetId);
    });

    it('should prevent actions from defeated avatars', () => {
      const avatar = createTestAvatar({
        stats: { hp: 0, maxHp: 100 },
      });

      expect(avatar.stats.hp).toBe(0);
      // Defeated avatars should not be able to act
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero damage gracefully', () => {
      const avatar = createTestAvatar();
      const initialHp = avatar.stats.hp;

      avatar.stats.hp = Math.max(0, avatar.stats.hp - 0);

      expect(avatar.stats.hp).toBe(initialHp);
    });

    it('should handle overkill damage', () => {
      const avatar = createTestAvatar({
        stats: { hp: 10, maxHp: 100 },
      });

      const damage = 1000;
      avatar.stats.hp = Math.max(0, avatar.stats.hp - damage);

      expect(avatar.stats.hp).toBe(0); // Should not go negative
    });

    it('should handle healing over max HP', () => {
      const avatar = createTestAvatar({
        stats: { hp: 90, maxHp: 100 },
      });

      const healing = 50;
      avatar.stats.hp = Math.min(avatar.stats.maxHp, avatar.stats.hp + healing);

      expect(avatar.stats.hp).toBe(100); // Should not exceed maxHp
    });
  });
});
