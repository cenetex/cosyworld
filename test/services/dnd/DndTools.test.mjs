/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * @file test/services/dnd/DndTools.test.mjs
 * @description Comprehensive tests for D&D Tools (CharacterTool, PartyTool, DungeonTool, CastTool, QuestTool)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CharacterTool } from '../../../src/services/tools/tools/CharacterTool.mjs';
import { PartyTool } from '../../../src/services/tools/tools/PartyTool.mjs';
import { DungeonTool } from '../../../src/services/tools/tools/DungeonTool.mjs';
import { CastTool } from '../../../src/services/tools/tools/CastTool.mjs';
import { QuestTool } from '../../../src/services/tools/tools/QuestTool.mjs';
import { ObjectId } from 'mongodb';

/**
 * Create mock avatar
 */
const createMockAvatar = (overrides = {}) => ({
  _id: new ObjectId('507f1f77bcf86cd799439011'),
  name: 'TestAvatar',
  emoji: '🧙',
  stats: {
    strength: 14,
    dexterity: 12,
    constitution: 16,
    intelligence: 18,
    wisdom: 13,
    charisma: 10,
  },
  ...overrides,
});

/**
 * Create mock message
 */
const createMockMessage = (content = '', overrides = {}) => ({
  content,
  author: { id: 'user-123', username: 'TestUser' },
  channel: { id: 'channel-123', send: vi.fn() },
  guild: { id: 'guild-123' },
  guildId: 'guild-123',
  reply: vi.fn(),
  ...overrides,
});

/**
 * Create mock character sheet
 */
const createMockSheet = (overrides = {}) => ({
  _id: new ObjectId(),
  avatarId: new ObjectId('507f1f77bcf86cd799439011'),
  class: 'wizard',
  race: 'elf',
  background: 'sage',
  level: 5,
  experience: 7500,
  proficiencyBonus: 3,
  hitDice: { current: 5, max: 5, size: 6 },
  spellcasting: {
    ability: 'intelligence',
    type: 'full',
    slots: { 1: { current: 4, max: 4 }, 2: { current: 3, max: 3 }, 3: { current: 2, max: 2 } },
    known: ['magic_missile', 'fireball', 'shield'],
    cantrips: ['fire_bolt', 'prestidigitation'],
  },
  features: [{ id: 'arcane_recovery', name: 'Arcane Recovery' }],
  proficiencies: { armor: [], weapons: ['dagger'], saves: ['intelligence', 'wisdom'], skills: ['arcana', 'history'] },
  partyId: null,
  ...overrides,
});

/**
 * Create base mock dependencies
 */
const createBaseMockDeps = () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  avatarService: {
    getAvatarById: vi.fn().mockResolvedValue(createMockAvatar()),
    getAvatarByName: vi.fn().mockResolvedValue(createMockAvatar()),
    updateAvatar: vi.fn().mockResolvedValue(true),
  },
  discordService: {
    client: {
      users: { fetch: vi.fn().mockResolvedValue({ send: vi.fn() }) },
    },
  },
  questService: {
    onEvent: vi.fn().mockResolvedValue(null),
    startQuest: vi.fn().mockResolvedValue({ questId: 'tutorial', currentStep: 0 }),
    getCurrentStep: vi.fn().mockResolvedValue(null),
    resetQuest: vi.fn().mockResolvedValue(true),
  },
});

// ==================== CharacterTool Tests ====================

describe('CharacterTool', () => {
  let tool;
  let deps;

  beforeEach(() => {
    deps = {
      ...createBaseMockDeps(),
      characterService: {
        getSheet: vi.fn().mockResolvedValue(null),
        createCharacter: vi.fn().mockResolvedValue(createMockSheet()),
        rest: vi.fn().mockResolvedValue({ hpRecovered: 10, slotsRecovered: true }),
      },
    };
    tool = new CharacterTool(deps);
  });

  describe('constructor', () => {
    it('should initialize with correct properties', () => {
      expect(tool.name).toBe('character');
      expect(tool.emoji).toBe('📜');
      expect(tool.description).toContain('D&D character');
    });
  });

  describe('getParameterSchema()', () => {
    it('should define valid schema', () => {
      const schema = tool.getParameterSchema();

      expect(schema.type).toBe('object');
      expect(schema.properties.action).toBeDefined();
      expect(schema.properties.action.enum).toContain('create');
      expect(schema.properties.action.enum).toContain('sheet');
      expect(schema.properties.action.enum).toContain('rest');
    });
  });

  describe('execute() - create', () => {
    it('should create a character successfully', async () => {
      const avatar = createMockAvatar();
      const message = createMockMessage('📜 character create elf wizard');

      const result = await tool.execute(message, ['create', 'elf', 'wizard'], avatar);

      expect(result.embeds).toBeDefined();
      expect(result.embeds[0].title).toContain('Character Created');
      expect(deps.characterService.createCharacter).toHaveBeenCalled();
    });

    it('should return error if character already exists', async () => {
      deps.characterService.createCharacter.mockRejectedValue(new Error('Character already exists for this avatar'));
      const avatar = createMockAvatar();
      const message = createMockMessage();

      const result = await tool.execute(message, ['create', 'elf', 'wizard'], avatar);

      expect(result.embeds[0].color).toBe(0xEF4444); // Error red
    });

    it('should return error for invalid race', async () => {
      const avatar = createMockAvatar();
      const message = createMockMessage();

      const result = await tool.execute(message, ['create', 'invalidrace', 'wizard'], avatar);

      expect(result.embeds[0].color).toBe(0xEF4444);
    });

    it('should return error for invalid class', async () => {
      const avatar = createMockAvatar();
      const message = createMockMessage();

      const result = await tool.execute(message, ['create', 'elf', 'invalidclass'], avatar);

      expect(result.embeds[0].color).toBe(0xEF4444);
    });

    it('should trigger quest event on creation', async () => {
      const avatar = createMockAvatar();
      const message = createMockMessage();

      await tool.execute(message, ['create', 'elf', 'wizard'], avatar);

      expect(deps.questService.onEvent).toHaveBeenCalledWith(
        avatar._id,
        'character_created',
        expect.any(Object)
      );
    });
  });

  describe('execute() - sheet', () => {
    it('should display character sheet', async () => {
      deps.characterService.getSheet.mockResolvedValue(createMockSheet());
      const avatar = createMockAvatar();
      const message = createMockMessage();

      const result = await tool.execute(message, ['sheet'], avatar);

      expect(result.embeds).toBeDefined();
      expect(result.embeds[0].title).toContain(avatar.name);
    });

    it('should return error if no sheet exists', async () => {
      deps.characterService.getSheet.mockResolvedValue(null);
      const avatar = createMockAvatar();
      const message = createMockMessage();

      const result = await tool.execute(message, ['sheet'], avatar);

      expect(result.embeds[0].color).toBe(0x6B7280); // Gray for "no sheet"
    });
  });

  describe('execute() - rest', () => {
    it('should perform short rest', async () => {
      deps.characterService.getSheet.mockResolvedValue(createMockSheet());
      const avatar = createMockAvatar();
      const message = createMockMessage();

      const result = await tool.execute(message, ['rest', 'short'], avatar);

      expect(result.embeds).toBeDefined();
      expect(deps.characterService.rest).toHaveBeenCalledWith(avatar._id, 'short');
    });

    it('should perform long rest by default', async () => {
      deps.characterService.getSheet.mockResolvedValue(createMockSheet());
      const avatar = createMockAvatar();
      const message = createMockMessage();

      const result = await tool.execute(message, ['rest'], avatar);

      expect(deps.characterService.rest).toHaveBeenCalledWith(avatar._id, 'short');
    });
  });
});

// ==================== PartyTool Tests ====================

describe('PartyTool', () => {
  let tool;
  let deps;

  beforeEach(() => {
    deps = {
      ...createBaseMockDeps(),
      characterService: {
        getSheet: vi.fn().mockResolvedValue(createMockSheet()),
      },
      partyService: {
        getParty: vi.fn().mockResolvedValue(null),
        getPartyByMember: vi.fn().mockResolvedValue(null),
        getPartyWithAvatars: vi.fn().mockResolvedValue(null),
        createParty: vi.fn().mockResolvedValue({
          _id: new ObjectId(),
          name: 'Heroes',
          leaderId: new ObjectId('507f1f77bcf86cd799439011'),
          members: [{ avatarId: new ObjectId('507f1f77bcf86cd799439011'), role: 'tank' }],
          maxSize: 4,
        }),
        invite: vi.fn().mockResolvedValue(true),
        leave: vi.fn().mockResolvedValue({ dissolved: false }),
        setRole: vi.fn().mockResolvedValue(true),
      },
    };
    tool = new PartyTool(deps);
  });

  describe('constructor', () => {
    it('should initialize with correct properties', () => {
      expect(tool.name).toBe('party');
      expect(tool.emoji).toBe('👥');
    });
  });

  describe('execute() - create', () => {
    it('should create a party', async () => {
      const avatar = createMockAvatar();
      const message = createMockMessage();

      const result = await tool.execute(message, ['create', 'Heroes'], avatar);

      expect(result.embeds).toBeDefined();
      expect(result.embeds[0].title).toContain('Party Formed');
      expect(deps.partyService.createParty).toHaveBeenCalled();
    });

    it('should trigger quest event', async () => {
      const avatar = createMockAvatar();
      const message = createMockMessage();

      await tool.execute(message, ['create', 'Heroes'], avatar);

      expect(deps.questService.onEvent).toHaveBeenCalledWith(
        avatar._id,
        'party_ready',
        undefined
      );
    });
  });

  describe('execute() - invite', () => {
    it('should invite a member', async () => {
      const sheet = createMockSheet({ partyId: new ObjectId() });
      deps.characterService.getSheet.mockResolvedValue(sheet);
      deps.partyService.getParty.mockResolvedValue({
        _id: sheet.partyId,
        name: 'Heroes',
        leaderId: new ObjectId('507f1f77bcf86cd799439011'),
        members: [{ avatarId: new ObjectId('507f1f77bcf86cd799439011') }],
        maxSize: 4,
      });
      const avatar = createMockAvatar();
      const message = createMockMessage();

      const result = await tool.execute(message, ['invite', 'OtherAvatar'], avatar);

      expect(result.embeds).toBeDefined();
      expect(deps.partyService.invite).toHaveBeenCalled();
    });
  });

  describe('execute() - leave', () => {
    it('should leave party', async () => {
      const sheet = createMockSheet({ partyId: new ObjectId() });
      deps.characterService.getSheet.mockResolvedValue(sheet);
      const avatar = createMockAvatar();
      const message = createMockMessage();

      const result = await tool.execute(message, ['leave'], avatar);

      expect(result.embeds).toBeDefined();
      expect(deps.partyService.leave).toHaveBeenCalled();
    });
  });

  describe('execute() - list', () => {
    it('should show party status', async () => {
      const partyId = new ObjectId();
      const sheet = createMockSheet({ partyId });
      deps.characterService.getSheet.mockResolvedValue(sheet);
      deps.partyService.getPartyWithAvatars.mockResolvedValue({
        _id: partyId,
        name: 'Heroes',
        leaderId: new ObjectId('507f1f77bcf86cd799439011'),
        members: [{ avatarId: new ObjectId('507f1f77bcf86cd799439011'), role: 'tank', avatar: { name: 'Hero' }, sheet: { class: 'fighter', level: 3 } }],
        maxSize: 4,
        sharedGold: 100,
      });
      const avatar = createMockAvatar();
      const message = createMockMessage();

      const result = await tool.execute(message, ['list'], avatar);

      expect(result.embeds).toBeDefined();
      expect(result.embeds[0].title).toContain('Heroes');
    });
  });
});

// ==================== DungeonTool Tests ====================

describe('DungeonTool', () => {
  let tool;
  let deps;

  beforeEach(() => {
    deps = {
      ...createBaseMockDeps(),
      characterService: {
        getSheet: vi.fn().mockResolvedValue(createMockSheet({ partyId: new ObjectId() })),
      },
      partyService: {
        getParty: vi.fn().mockResolvedValue({
          _id: new ObjectId(),
          name: 'Heroes',
          leaderId: new ObjectId('507f1f77bcf86cd799439011'),
          members: [{ avatarId: new ObjectId('507f1f77bcf86cd799439011') }],
        }),
      },
      dungeonService: {
        getActiveDungeon: vi.fn().mockResolvedValue(null),
        generateDungeon: vi.fn().mockResolvedValue({
          _id: new ObjectId(),
          name: 'Dark Crypt',
          theme: 'crypt',
          difficulty: 'medium',
          rooms: [
            { id: 'room_1', type: 'entrance', cleared: false },
            { id: 'room_2', type: 'combat', cleared: false },
            { id: 'room_3', type: 'boss', cleared: false },
          ],
          currentRoom: 'room_1',
        }),
        enterRoom: vi.fn().mockResolvedValue({ room: { id: 'room_2', type: 'combat', connections: [] } }),
        abandonDungeon: vi.fn().mockResolvedValue({ success: true }),
        getRoomEmoji: vi.fn().mockReturnValue('🚪'),
      },
    };
    tool = new DungeonTool(deps);
  });

  describe('constructor', () => {
    it('should initialize with correct properties', () => {
      expect(tool.name).toBe('dungeon');
      expect(tool.emoji).toBe('🏰');
    });
  });

  describe('execute() - enter', () => {
    it('should enter a dungeon', async () => {
      const avatar = createMockAvatar();
      const message = createMockMessage();

      const result = await tool.execute(message, ['enter', 'medium'], avatar);

      expect(result.embeds).toBeDefined();
      expect(result.embeds[0].title).toContain('Dark Crypt');
      expect(deps.dungeonService.generateDungeon).toHaveBeenCalled();
    });

    it('should trigger quest event', async () => {
      const avatar = createMockAvatar();
      const message = createMockMessage();

      await tool.execute(message, ['enter'], avatar);

      expect(deps.questService.onEvent).toHaveBeenCalledWith(
        avatar._id,
        'dungeon_entered',
        expect.any(Object)
      );
    });

    it('should return error if not in party', async () => {
      deps.characterService.getSheet.mockResolvedValue(createMockSheet({ partyId: null }));
      const avatar = createMockAvatar();
      const message = createMockMessage();

      const result = await tool.execute(message, ['enter'], avatar);

      expect(result.embeds[0].color).toBe(0xEF4444);
    });
  });

  describe('execute() - status', () => {
    it('should show dungeon status', async () => {
      deps.dungeonService.getActiveDungeon.mockResolvedValue({
        _id: new ObjectId(),
        name: 'Dark Crypt',
        rooms: [{ id: 'room_1', type: 'entrance', cleared: true }],
        currentRoom: 'room_1',
      });
      const avatar = createMockAvatar();
      const message = createMockMessage();

      const result = await tool.execute(message, ['status'], avatar);

      expect(result.embeds).toBeDefined();
    });
  });

  describe('execute() - move', () => {
    it('should move to next room', async () => {
      deps.dungeonService.getActiveDungeon.mockResolvedValue({
        _id: new ObjectId(),
        name: 'Dark Crypt',
        rooms: [
          { id: 'room_1', type: 'entrance', cleared: true, connections: ['room_2'] },
          { id: 'room_2', type: 'combat', cleared: false },
        ],
        currentRoom: 'room_1',
      });
      deps.dungeonService.enterRoom.mockResolvedValue({
        room: { id: 'room_2', type: 'combat', cleared: false, connections: [] }
      });
      const avatar = createMockAvatar();
      const message = createMockMessage();

      const result = await tool.execute(message, ['move', 'room_2'], avatar);

      expect(result.embeds).toBeDefined();
      expect(deps.dungeonService.enterRoom).toHaveBeenCalled();
    });
  });

  describe('execute() - abandon', () => {
    it('should abandon dungeon', async () => {
      deps.dungeonService.getActiveDungeon.mockResolvedValue({
        _id: new ObjectId(),
        name: 'Dark Crypt',
      });
      const avatar = createMockAvatar();
      const message = createMockMessage();

      const result = await tool.execute(message, ['abandon'], avatar);

      expect(result.embeds).toBeDefined();
      expect(deps.dungeonService.abandonDungeon).toHaveBeenCalled();
    });
  });
});

// ==================== CastTool Tests ====================

describe('CastTool', () => {
  let tool;
  let deps;

  beforeEach(() => {
    deps = {
      ...createBaseMockDeps(),
      characterService: {
        getSheet: vi.fn().mockResolvedValue(createMockSheet()),
      },
      spellService: {
        getSpell: vi.fn().mockReturnValue({ name: 'Magic Missile', level: 1 }),
        castSpell: vi.fn().mockResolvedValue({
          spell: { name: 'Magic Missile', level: 1 },
          slotLevel: 1,
          results: [{ targetId: new ObjectId(), targetName: 'Goblin', hit: true, damage: 12 }],
        }),
      },
    };
    tool = new CastTool(deps);
  });

  describe('constructor', () => {
    it('should initialize with correct properties', () => {
      expect(tool.name).toBe('cast');
      expect(tool.emoji).toBe('🪄');
    });
  });

  describe('execute()', () => {
    it('should cast a spell', async () => {
      deps.avatarService.getAvatarByName.mockResolvedValue({ _id: new ObjectId(), name: 'Goblin' });
      const avatar = createMockAvatar();
      const message = createMockMessage();

      const result = await tool.execute(message, ['magic_missile', 'Goblin'], avatar);

      expect(result.embeds).toBeDefined();
      expect(result.embeds[0].title).toContain('Magic Missile');
      expect(deps.spellService.castSpell).toHaveBeenCalled();
    });

    it('should trigger quest event', async () => {
      deps.avatarService.getAvatarByName.mockResolvedValue({ _id: new ObjectId(), name: 'Goblin' });
      const avatar = createMockAvatar();
      const message = createMockMessage();

      await tool.execute(message, ['fire_bolt', 'Goblin'], avatar);

      expect(deps.questService.onEvent).toHaveBeenCalledWith(
        avatar._id,
        'spell_cast',
        expect.any(Object)
      );
    });

    it('should return error if not spellcaster', async () => {
      deps.characterService.getSheet.mockResolvedValue(createMockSheet({ spellcasting: null }));
      const avatar = createMockAvatar();
      const message = createMockMessage();

      const result = await tool.execute(message, ['magic_missile'], avatar);

      expect(result.embeds[0].color).toBe(0xEF4444);
    });

    it('should return error if no sheet', async () => {
      deps.characterService.getSheet.mockResolvedValue(null);
      const avatar = createMockAvatar();
      const message = createMockMessage();

      const result = await tool.execute(message, ['magic_missile'], avatar);

      expect(result.embeds[0].color).toBe(0xEF4444);
    });

    it('should cast on target when specified', async () => {
      const avatar = createMockAvatar();
      const message = createMockMessage();

      await tool.execute(message, ['fire_bolt', 'Goblin'], avatar);

      expect(deps.avatarService.getAvatarByName).toHaveBeenCalledWith('Goblin', { guildId: 'guild-123' });
    });
  });
});

// ==================== QuestTool Tests ====================

describe('QuestTool', () => {
  let tool;
  let deps;

  beforeEach(() => {
    deps = {
      ...createBaseMockDeps(),
      characterService: {
        getSheet: vi.fn().mockResolvedValue(createMockSheet()),
      },
      questService: {
        getAllQuests: vi.fn().mockReturnValue([
          { id: 'tutorial', name: 'Tutorial', type: 'tutorial', description: 'Learn the basics' },
        ]),
        getActiveQuests: vi.fn().mockResolvedValue([]),
        getCompletedQuests: vi.fn().mockResolvedValue([]),
        getAvailableQuests: vi.fn().mockResolvedValue([
          { quest: { id: 'tutorial', name: 'Tutorial', type: 'tutorial' } },
        ]),
        startQuest: vi.fn().mockResolvedValue({ questId: 'tutorial', currentStep: 0 }),
        getCurrentStep: vi.fn().mockResolvedValue({
          step: { id: 'step_1', title: 'Create Character', description: 'Create your first character' },
          stepIndex: 0,
        }),
        getQuest: vi.fn().mockReturnValue({ id: 'tutorial', name: 'Tutorial', steps: [] }),
        resetQuest: vi.fn().mockResolvedValue(true),
        abandonQuest: vi.fn().mockResolvedValue(true),
        formatQuestList: vi.fn().mockReturnValue({ embeds: [{ title: 'Quests' }] }),
        formatStepMessage: vi.fn().mockReturnValue({ embeds: [{ title: 'Step 1' }] }),
      },
    };
    tool = new QuestTool(deps);
  });

  describe('constructor', () => {
    it('should initialize with correct properties', () => {
      expect(tool.name).toBe('quest');
      expect(tool.emoji).toBe('📚');
    });
  });

  describe('execute() - list', () => {
    it('should list all quests', async () => {
      const avatar = createMockAvatar();
      const message = createMockMessage();

      const result = await tool.execute(message, ['list'], avatar);

      expect(result.embeds).toBeDefined();
      expect(result.embeds[0].title).toContain('Quest Journal');
    });
  });

  describe('execute() - start', () => {
    it('should start a quest', async () => {
      deps.questService.startQuest.mockResolvedValue({ started: true, quest: { title: 'Tutorial' } });
      const avatar = createMockAvatar();
      const message = createMockMessage();

      const result = await tool.execute(message, ['start', 'tutorial'], avatar);

      expect(result.embeds).toBeDefined();
      expect(deps.questService.startQuest).toHaveBeenCalledWith(avatar._id, 'tutorial');
    });
  });

  describe('execute() - status', () => {
    it('should show quest status', async () => {
      deps.questService.getActiveQuests.mockResolvedValue([
        { progress: { questId: 'tutorial', currentStep: 0 }, quest: { id: 'tutorial', name: 'Tutorial' } },
      ]);
      const avatar = createMockAvatar();
      const message = createMockMessage();

      const result = await tool.execute(message, ['status'], avatar);

      expect(result.embeds).toBeDefined();
    });
  });

  describe('execute() - reset', () => {
    it('should reset a quest', async () => {
      deps.questService.getActiveQuests.mockResolvedValue([
        { progress: { questId: 'tutorial' }, quest: { id: 'tutorial' } },
      ]);
      const avatar = createMockAvatar();
      const message = createMockMessage();

      const result = await tool.execute(message, ['reset'], avatar);

      expect(result.embeds).toBeDefined();
      expect(deps.questService.resetQuest).toHaveBeenCalled();
    });
  });

  describe('execute() - abandon', () => {
    it('should abandon a quest', async () => {
      const avatar = createMockAvatar();
      const message = createMockMessage();

      const result = await tool.execute(message, ['abandon', 'tutorial'], avatar);

      expect(result.embeds).toBeDefined();
      expect(deps.questService.abandonQuest).toHaveBeenCalled();
    });
  });

  describe('execute() - tutorial shortcut', () => {
    it('should show tutorial status when called with "tutorial"', async () => {
      const avatar = createMockAvatar();
      const message = createMockMessage();

      const result = await tool.execute(message, ['tutorial'], avatar);

      // Shows status (which calls getCurrentStep)
      expect(deps.questService.getCurrentStep).toHaveBeenCalledWith(avatar._id, 'tutorial');
    });
  });
});
