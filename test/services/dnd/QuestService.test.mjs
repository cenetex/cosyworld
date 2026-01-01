/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * @file test/services/dnd/QuestService.test.mjs
 * @description Comprehensive tests for QuestService
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuestService } from '../../../src/services/quests/QuestService.mjs';
import { ObjectId } from 'mongodb';

/**
 * Sample quest definition for testing
 */
const SAMPLE_QUEST = {
  id: 'test_quest',
  name: 'Test Quest',
  title: 'Test Quest',
  type: 'tutorial',
  description: 'A quest for testing',
  steps: [
    {
      id: 'step_1',
      title: 'First Step',
      description: 'Complete the first step',
      hint: 'This is a hint',
      trigger: 'character_created',
      conditions: [{ type: 'has_sheet' }],
      xpReward: 25,
    },
    {
      id: 'step_2',
      title: 'Second Step',
      description: 'Complete the second step',
      hint: 'Another hint',
      trigger: 'party_joined',
      conditions: [{ type: 'in_party' }],
      xpReward: 50,
    },
    {
      id: 'step_3',
      title: 'Third Step',
      description: 'Complete the third step',
      hint: 'Last hint',
      trigger: 'dungeon_entered',
      conditions: [{ type: 'in_dungeon' }],
      xpReward: 100,
    },
  ],
  rewards: {
    xp: 100,
    gold: 50,
    items: [],
  },
};

const SPELLCASTER_QUEST = {
  id: 'spellcaster_quest',
  name: 'Spellcaster Quest',
  title: 'Spellcaster Quest',
  type: 'tutorial',
  description: 'A quest for spellcasters',
  steps: [
    {
      id: 'spell_step',
      title: 'Learn Spells',
      description: 'Learn to cast spells',
      trigger: 'spell_cast',
      conditions: [{ type: 'is_spellcaster' }],
      xpReward: 50,
    },
  ],
  rewards: { xp: 100 },
};

/**
 * Create mock dependencies for QuestService
 */
const createMockDeps = () => {
  const mockCollection = {
    findOne: vi.fn(),
    find: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    }),
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
    characterService: {
      getSheet: vi.fn().mockResolvedValue({
        avatarId: new ObjectId('507f1f77bcf86cd799439011'),
        class: 'fighter',
        level: 1,
        partyId: null,
        spellcasting: null,
      }),
      awardXP: vi.fn().mockResolvedValue({ newXP: 100, leveledUp: false }),
    },
    partyService: {
      getPartyByMember: vi.fn().mockResolvedValue(null),
    },
    dungeonService: {
      getActiveDungeon: vi.fn().mockResolvedValue(null),
    },
    discordService: {
      client: {
        users: {
          fetch: vi.fn().mockResolvedValue({
            send: vi.fn().mockResolvedValue(true),
          }),
        },
      },
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

describe('QuestService', () => {
  let service;
  let deps;

  beforeEach(() => {
    deps = createMockDeps();
    service = new QuestService(deps);
  });

  describe('constructor', () => {
    it('should initialize with required dependencies', () => {
      expect(service.databaseService).toBe(deps.databaseService);
      expect(service.characterService).toBe(deps.characterService);
      expect(service.partyService).toBe(deps.partyService);
      expect(service.dungeonService).toBe(deps.dungeonService);
      expect(service._quests).toBeInstanceOf(Map);
    });
  });

  describe('Quest Registry', () => {
    describe('registerQuest()', () => {
      it('should register a quest definition', () => {
        service.registerQuest(SAMPLE_QUEST);

        expect(service._quests.has('test_quest')).toBe(true);
        expect(service._quests.get('test_quest')).toEqual(SAMPLE_QUEST);
      });

      it('should not register quest without id', () => {
        service.registerQuest({ name: 'No ID Quest' });

        expect(service._quests.size).toBe(0);
        expect(deps.logger.error).toHaveBeenCalled();
      });

      it('should log registration', () => {
        service.registerQuest(SAMPLE_QUEST);

        expect(deps.logger.info).toHaveBeenCalledWith(
          expect.stringContaining('Registered quest: test_quest')
        );
      });
    });

    describe('getQuest()', () => {
      it('should return registered quest', () => {
        service.registerQuest(SAMPLE_QUEST);

        const quest = service.getQuest('test_quest');

        expect(quest).toEqual(SAMPLE_QUEST);
      });

      it('should return undefined for unknown quest', () => {
        const quest = service.getQuest('unknown');

        expect(quest).toBeUndefined();
      });
    });

    describe('getAllQuests()', () => {
      it('should return all registered quests', () => {
        service.registerQuest(SAMPLE_QUEST);
        service.registerQuest(SPELLCASTER_QUEST);

        const quests = service.getAllQuests();

        expect(quests).toHaveLength(2);
      });

      it('should return empty array when no quests registered', () => {
        const quests = service.getAllQuests();

        expect(quests).toEqual([]);
      });
    });

    describe('getQuestsByType()', () => {
      it('should filter quests by type', () => {
        service.registerQuest(SAMPLE_QUEST);
        service.registerQuest({ ...SAMPLE_QUEST, id: 'story_quest', type: 'story' });

        const tutorials = service.getQuestsByType('tutorial');

        expect(tutorials).toHaveLength(1);
        expect(tutorials[0].id).toBe('test_quest');
      });
    });
  });

  describe('Progress Management', () => {
    const avatarId = '507f1f77bcf86cd799439011';

    describe('getProgress()', () => {
      it('should find progress for avatar and quest', async () => {
        const mockProgress = {
          avatarId: new ObjectId(avatarId),
          questId: 'test_quest',
          currentStep: 0,
          status: 'active',
        };
        deps.mockCollection.findOne.mockResolvedValue(mockProgress);

        const progress = await service.getProgress(avatarId, 'test_quest');

        expect(progress).toEqual(mockProgress);
      });

      it('should return null if no progress', async () => {
        deps.mockCollection.findOne.mockResolvedValue(null);

        const progress = await service.getProgress(avatarId, 'test_quest');

        expect(progress).toBeNull();
      });
    });

    describe('getActiveQuests()', () => {
      it('should return active quests with definitions', async () => {
        service.registerQuest(SAMPLE_QUEST);
        deps.mockCollection.find.mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            { avatarId: new ObjectId(avatarId), questId: 'test_quest', status: 'active' },
          ]),
        });

        const active = await service.getActiveQuests(avatarId);

        expect(active).toHaveLength(1);
        expect(active[0].quest.id).toBe('test_quest');
      });
    });

    describe('startQuest()', () => {
      it('should start a new quest', async () => {
        service.registerQuest(SAMPLE_QUEST);
        deps.mockCollection.findOne.mockResolvedValue(null);
        deps.mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

        const result = await service.startQuest(avatarId, 'test_quest');

        expect(result.questId).toBe('test_quest');
        expect(result.currentStep).toBe(0);
        expect(result.status).toBe('active');
      });

      it('should throw if quest not found', async () => {
        await expect(service.startQuest(avatarId, 'unknown')).rejects.toThrow(
          'Quest not found: unknown'
        );
      });

      it('should throw if quest already started', async () => {
        service.registerQuest(SAMPLE_QUEST);
        deps.mockCollection.findOne.mockResolvedValue({
          avatarId: new ObjectId(avatarId),
          questId: 'test_quest',
          status: 'active',
        });

        await expect(service.startQuest(avatarId, 'test_quest')).rejects.toThrow(
          'Quest already started'
        );
      });
    });

    describe('resetQuest()', () => {
      it('should reset quest progress', async () => {
        deps.mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

        await service.resetQuest(avatarId, 'test_quest');

        expect(deps.mockCollection.updateOne).toHaveBeenCalledWith(
          { avatarId: expect.any(ObjectId), questId: 'test_quest' },
          expect.objectContaining({
            $set: expect.objectContaining({
              currentStep: 0,
              status: 'active',
            }),
          })
        );
      });
    });

    describe('abandonQuest()', () => {
      it('should mark quest as abandoned', async () => {
        deps.mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

        await service.abandonQuest(avatarId, 'test_quest');

        expect(deps.mockCollection.updateOne).toHaveBeenCalledWith(
          { avatarId: expect.any(ObjectId), questId: 'test_quest' },
          expect.objectContaining({
            $set: expect.objectContaining({
              status: 'abandoned',
            }),
          })
        );
      });
    });
  });

  describe('Step Management', () => {
    const avatarId = '507f1f77bcf86cd799439011';

    describe('getCurrentStep()', () => {
      it('should return current step details', async () => {
        service.registerQuest(SAMPLE_QUEST);
        deps.mockCollection.findOne.mockResolvedValue({
          avatarId: new ObjectId(avatarId),
          questId: 'test_quest',
          currentStep: 0,
          status: 'active',
        });

        const step = await service.getCurrentStep(avatarId, 'test_quest');

        expect(step.step.id).toBe('step_1');
        expect(step.step.title).toBe('First Step');
      });

      it('should return null if quest not started', async () => {
        service.registerQuest(SAMPLE_QUEST);
        deps.mockCollection.findOne.mockResolvedValue(null);

        const step = await service.getCurrentStep(avatarId, 'test_quest');

        expect(step).toBeNull();
      });

      it('should return null if quest completed', async () => {
        service.registerQuest(SAMPLE_QUEST);
        deps.mockCollection.findOne.mockResolvedValue({
          avatarId: new ObjectId(avatarId),
          questId: 'test_quest',
          currentStep: 3, // Past last step
          status: 'completed',
        });

        const step = await service.getCurrentStep(avatarId, 'test_quest');

        expect(step).toBeNull();
      });
    });

    describe('advanceStep()', () => {
      it('should advance to next step', async () => {
        service.registerQuest(SAMPLE_QUEST);
        deps.mockCollection.findOne.mockResolvedValue({
          avatarId: new ObjectId(avatarId),
          questId: 'test_quest',
          currentStep: 0,
          status: 'active',
        });
        deps.mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

        const result = await service.advanceStep(avatarId, 'test_quest');

        expect(result.advanced).toBe(true);
        expect(result.newStep).toBe(1);
      });

      it('should complete quest on last step', async () => {
        service.registerQuest(SAMPLE_QUEST);
        deps.mockCollection.findOne.mockResolvedValue({
          avatarId: new ObjectId(avatarId),
          questId: 'test_quest',
          currentStep: 2, // Last step
          status: 'active',
        });
        deps.mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

        const result = await service.advanceStep(avatarId, 'test_quest');

        expect(result.completed).toBe(true);
      });

      it('should award XP on advancement', async () => {
        service.registerQuest(SAMPLE_QUEST);
        deps.mockCollection.findOne.mockResolvedValue({
          avatarId: new ObjectId(avatarId),
          questId: 'test_quest',
          currentStep: 0,
          status: 'active',
        });
        deps.mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

        const result = await service.advanceStep(avatarId, 'test_quest');

        expect(result.xpAwarded).toBe(25);
        expect(deps.characterService.awardXP).toHaveBeenCalledWith(avatarId, 25);
      });
    });
  });

  describe('Event System', () => {
    const avatarId = '507f1f77bcf86cd799439011';

    describe('onEvent()', () => {
      it('should trigger step advancement on matching event', async () => {
        service.registerQuest(SAMPLE_QUEST);
        deps.mockCollection.find.mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            {
              avatarId: new ObjectId(avatarId),
              questId: 'test_quest',
              currentStep: 0,
              status: 'active',
            },
          ]),
        });
        deps.mockCollection.findOne.mockResolvedValue({
          avatarId: new ObjectId(avatarId),
          questId: 'test_quest',
          currentStep: 0,
          status: 'active',
        });
        deps.mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

        // Trigger character_created event (matches step_1)
        await service.onEvent(avatarId, 'character_created', {});

        expect(deps.mockCollection.updateOne).toHaveBeenCalled();
      });

      it('should not advance if event does not match', async () => {
        service.registerQuest(SAMPLE_QUEST);
        deps.mockCollection.find.mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            {
              avatarId: new ObjectId(avatarId),
              questId: 'test_quest',
              currentStep: 0,
              status: 'active',
            },
          ]),
        });
        deps.mockCollection.findOne.mockResolvedValue({
          avatarId: new ObjectId(avatarId),
          questId: 'test_quest',
          currentStep: 0,
          status: 'active',
        });

        // Trigger wrong event
        await service.onEvent(avatarId, 'wrong_event', {});

        // Should not advance (no updateOne for advancement)
      });
    });
  });

  describe('Condition Checks', () => {
    const avatarId = '507f1f77bcf86cd799439011';

    describe('_isConditionMet()', () => {
      it('should check has_sheet condition', async () => {
        deps.characterService.getSheet.mockResolvedValue({ class: 'fighter' });

        const result = await service._isConditionMet(avatarId, { condition: { type: 'has_sheet' } });

        expect(result).toBe(true);
      });

      it('should check in_party condition', async () => {
        deps.characterService.getSheet.mockResolvedValue({ partyId: new ObjectId() });

        const result = await service._isConditionMet(avatarId, { condition: { type: 'in_party' } });

        expect(result).toBe(true);
      });

      it('should check in_dungeon condition', async () => {
        deps.characterService.getSheet.mockResolvedValue({ partyId: new ObjectId() });
        deps.dungeonService.getActiveDungeon.mockResolvedValue({ name: 'Dungeon' });

        const result = await service._isConditionMet(avatarId, { condition: { type: 'in_dungeon' } });

        expect(result).toBe(true);
      });

      it('should check is_spellcaster condition', async () => {
        deps.characterService.getSheet.mockResolvedValue({ spellcasting: { ability: 'int' } });

        const result = await service._isConditionMet(avatarId, { condition: { type: 'is_spellcaster' } });

        expect(result).toBe(true);
      });

      it('should check not_spellcaster condition', async () => {
        deps.characterService.getSheet.mockResolvedValue({ class: 'fighter' });

        const result = await service._isConditionMet(avatarId, { condition: { type: 'not_spellcaster' } });

        expect(result).toBe(true);
      });

      it('should check level_min condition', async () => {
        deps.characterService.getSheet.mockResolvedValue({ level: 5 });

        const result = await service._isConditionMet(avatarId, { condition: { type: 'level_min', value: 3 } });

        expect(result).toBe(true);
      });

      it('should fail level_min if below threshold', async () => {
        deps.characterService.getSheet.mockResolvedValue({ level: 2 });

        const result = await service._isConditionMet(avatarId, { condition: { type: 'level_min', value: 5 } });

        expect(result).toBe(false);
      });
    });
  });

  describe('Formatting', () => {
    describe('formatStepMessage()', () => {
      it('should format step as embed', () => {
        service.registerQuest(SAMPLE_QUEST);

        const embed = service.formatStepMessage(SAMPLE_QUEST, SAMPLE_QUEST.steps[0], 1, 3);

        expect(embed.embeds).toBeDefined();
        expect(embed.embeds[0].title).toContain('First Step');
        expect(embed.embeds[0].description).toContain('Complete the first step');
      });

      it('should include progress in embed', () => {
        service.registerQuest(SAMPLE_QUEST);

        const embed = service.formatStepMessage(SAMPLE_QUEST, SAMPLE_QUEST.steps[0], 1, 3);

        expect(embed.embeds[0].fields).toContainEqual(
          expect.objectContaining({ name: expect.stringContaining('Progress') })
        );
      });
    });

    describe('formatCompletionMessage()', () => {
      it('should format completion as embed', () => {
        const embed = service.formatCompletionMessage(SAMPLE_QUEST, 175);

        expect(embed.embeds).toBeDefined();
        expect(embed.embeds[0].title).toContain('Quest Complete');
        expect(embed.embeds[0].color).toBe(0x10B981); // Green
      });

      it('should include rewards in message', () => {
        const embed = service.formatCompletionMessage(SAMPLE_QUEST, 175);

        expect(embed.embeds[0].description).toContain('Test Quest');
        // XP rewards are in fields, not description
        expect(embed.embeds[0].fields.some(f => f.value.includes('175 XP'))).toBe(true);
      });
    });

    describe('formatQuestList()', () => {
      it('should format quest list as embed', () => {
        service.registerQuest(SAMPLE_QUEST);
        service.registerQuest(SPELLCASTER_QUEST);

        const embed = service.formatQuestList([SAMPLE_QUEST, SPELLCASTER_QUEST], 'Available Quests');

        expect(embed.embeds).toBeDefined();
        expect(embed.embeds[0].title).toContain('Available Quests');
      });
    });
  });

  describe('Welcome DM', () => {
    const discordUserId = 'user-123';

    describe('hasSeenWelcome()', () => {
      it('should return false if not seen', async () => {
        deps.mockCollection.findOne.mockResolvedValue(null);

        const result = await service.hasSeenWelcome(discordUserId);

        expect(result).toBe(false);
      });

      it('should return true if seen', async () => {
        deps.mockCollection.findOne.mockResolvedValue({ discordUserId, seenAt: new Date() });

        const result = await service.hasSeenWelcome(discordUserId);

        expect(result).toBe(true);
      });
    });

    describe('markWelcomeSeen()', () => {
      it('should mark welcome as seen', async () => {
        deps.mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

        await service.markWelcomeSeen(discordUserId);

        expect(deps.mockCollection.updateOne).toHaveBeenCalledWith(
          { discordUserId },
          expect.objectContaining({ $set: expect.objectContaining({ discordUserId }) }),
          { upsert: true }
        );
      });
    });

    describe('getWelcomeEmbed()', () => {
      it('should return welcome embed', () => {
        const embed = service.getWelcomeEmbed();

        expect(embed.embeds).toBeDefined();
        expect(embed.embeds[0].title).toContain('Welcome');
        expect(embed.embeds[0].description).toContain('D&D');
      });
    });
  });

  describe('Helper Methods', () => {
    describe('_makeProgressBar()', () => {
      it('should create progress bar', () => {
        const bar = service._makeProgressBar(3, 5);

        expect(bar).toContain('█'); // Filled
        expect(bar).toContain('░'); // Empty
      });

      it('should show full bar when complete', () => {
        const bar = service._makeProgressBar(5, 5);

        expect(bar).not.toContain('░');
      });

      it('should show empty bar at start', () => {
        const bar = service._makeProgressBar(0, 5);

        expect(bar).not.toContain('█');
      });
    });

    describe('_getQuestColor()', () => {
      it.each([
        ['tutorial', 0x7C3AED],  // Purple
        ['story', 0x3B82F6],     // Blue
        ['side', 0x10B981],      // Green
        ['daily', 0xF59E0B],     // Amber
        ['achievement', 0xEF4444], // Red
      ])('should return correct color for %s type', (type, expectedColor) => {
        const color = service._getQuestColor(type);
        expect(color).toBe(expectedColor);
      });
    });

    describe('_getTypeEmoji()', () => {
      it.each([
        ['tutorial', '📚'],
        ['story', '📜'],
        ['side', '📋'],
        ['daily', '🌅'],
        ['achievement', '🏆'],
      ])('should return correct emoji for %s type', (type, expectedEmoji) => {
        const emoji = service._getTypeEmoji(type);
        expect(emoji).toBe(expectedEmoji);
      });

      it('should return fallback for unknown type', () => {
        const emoji = service._getTypeEmoji('unknown');
        expect(emoji).toBe('❓');
      });
    });
  });
});
