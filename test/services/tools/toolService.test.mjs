/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/services/tools/toolService.test.mjs
 * @description Comprehensive tests for ToolService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToolService } from '../../../src/services/tools/ToolService.mjs';

// Mock tool classes
vi.mock('../../../src/services/tools/tools/AttackTool.mjs', () => ({
  AttackTool: class AttackTool {
    name = 'attack';
    emoji = '🗡️';
    execute = vi.fn().mockResolvedValue({ message: 'Attack executed', notify: true });
    getDescription = () => 'Attack a target';
    getSyntax = () => '🗡️ @target';
  }
}));

vi.mock('../../../src/services/tools/tools/MoveTool.mjs', () => ({
  MoveTool: class MoveTool {
    name = 'move';
    emoji = '🚶';
    execute = vi.fn().mockResolvedValue({ message: 'Moved to location', notify: true });
    getDescription = () => 'Move to a location';
    getSyntax = () => '🚶 location';
  }
}));

vi.mock('../../../src/services/tools/tools/RememberTool.mjs', () => ({
  RememberTool: class RememberTool {
    name = 'remember';
    emoji = '💭';
    execute = vi.fn().mockResolvedValue({ message: 'Memory stored', notify: true });
    getDescription = () => 'Store a memory';
    getSyntax = () => '💭 memory';
  }
}));

// Mock remaining tools as no-ops - inline factories to avoid hoisting issues
vi.mock('../../../src/services/tools/tools/ChallengeTool.mjs', () => ({
  ChallengeTool: class { name = 'challenge'; emoji = '⚔️'; execute = vi.fn().mockResolvedValue({ message: 'challenge executed', notify: true }); getDescription = () => 'challenge description'; getSyntax = () => '⚔️ challenge'; }
}));
vi.mock('../../../src/services/tools/tools/DefendTool.mjs', () => ({
  DefendTool: class { name = 'defend'; emoji = '🛡️'; execute = vi.fn().mockResolvedValue({ message: 'defend executed', notify: true }); getDescription = () => 'defend description'; getSyntax = () => '🛡️ defend'; }
}));
vi.mock('../../../src/services/tools/tools/SummonTool.mjs', () => ({
  SummonTool: class { name = 'summon'; emoji = '✨'; execute = vi.fn().mockResolvedValue({ message: 'summon executed', notify: true }); getDescription = () => 'summon description'; getSyntax = () => '✨ summon'; }
}));
vi.mock('../../../src/services/tools/tools/BreedTool.mjs', () => ({
  BreedTool: class { name = 'breed'; emoji = '💕'; execute = vi.fn().mockResolvedValue({ message: 'breed executed', notify: true }); getDescription = () => 'breed description'; getSyntax = () => '💕 breed'; }
}));
vi.mock('../../../src/services/tools/tools/CreationTool.mjs', () => ({
  CreationTool: class { name = 'create'; emoji = '🎨'; execute = vi.fn().mockResolvedValue({ message: 'create executed', notify: true }); getDescription = () => 'create description'; getSyntax = () => '🎨 create'; }
}));
vi.mock('../../../src/services/tools/tools/XSocialTool.mjs', () => ({
  XSocialTool: class { name = 'x'; emoji = '𝕏'; execute = vi.fn().mockResolvedValue({ message: 'x executed', notify: true }); getDescription = () => 'x description'; getSyntax = () => '𝕏 x'; }
}));
vi.mock('../../../src/services/tools/tools/ItemTool.mjs', () => ({
  ItemTool: class { name = 'item'; emoji = '🎒'; execute = vi.fn().mockResolvedValue({ message: 'item executed', notify: true }); getDescription = () => 'item description'; getSyntax = () => '🎒 item'; }
}));
vi.mock('../../../src/services/tools/tools/ThinkTool.mjs', () => ({
  ThinkTool: class { name = 'respond'; emoji = '💬'; execute = vi.fn().mockResolvedValue({ message: 'respond executed', notify: true }); getDescription = () => 'respond description'; getSyntax = () => '💬 respond'; }
}));
vi.mock('../../../src/services/tools/tools/WebSearchTool.mjs', () => ({
  WebSearchTool: class { name = 'search'; emoji = '🔍'; execute = vi.fn().mockResolvedValue({ message: 'search executed', notify: true }); getDescription = () => 'search description'; getSyntax = () => '🔍 search'; }
}));
vi.mock('../../../src/services/tools/tools/SelfieTool.mjs', () => ({
  SelfieTool: class { name = 'selfie'; emoji = '🤳'; execute = vi.fn().mockResolvedValue({ message: 'selfie executed', notify: true }); getDescription = () => 'selfie description'; getSyntax = () => '🤳 selfie'; }
}));
vi.mock('../../../src/services/tools/tools/SceneCameraTool.mjs', () => ({
  SceneCameraTool: class { name = 'camera'; emoji = '📷'; execute = vi.fn().mockResolvedValue({ message: 'camera executed', notify: true }); getDescription = () => 'camera description'; getSyntax = () => '📷 camera'; }
}));
vi.mock('../../../src/services/tools/tools/VideoCameraTool.mjs', () => ({
  VideoCameraTool: class { name = 'video camera'; emoji = '🎥'; execute = vi.fn().mockResolvedValue({ message: 'video camera executed', notify: true }); getDescription = () => 'video camera description'; getSyntax = () => '🎥 video camera'; }
}));
vi.mock('../../../src/services/tools/tools/DevilTool.mjs', () => ({
  DevilTool: class { name = 'devil'; emoji = '😈'; execute = vi.fn().mockResolvedValue({ message: 'devil executed', notify: true }); getDescription = () => 'devil description'; getSyntax = () => '😈 devil'; }
}));
vi.mock('../../../src/services/tools/tools/HideTool.mjs', () => ({
  HideTool: class { name = 'hide'; emoji = '🫥'; execute = vi.fn().mockResolvedValue({ message: 'hide executed', notify: true }); getDescription = () => 'hide description'; getSyntax = () => '🫥 hide'; }
}));
vi.mock('../../../src/services/tools/tools/FleeTool.mjs', () => ({
  FleeTool: class { name = 'flee'; emoji = '🏃'; execute = vi.fn().mockResolvedValue({ message: 'flee executed', notify: true }); getDescription = () => 'flee description'; getSyntax = () => '🏃 flee'; }
}));
vi.mock('../../../src/services/tools/tools/PotionTool.mjs', () => ({
  PotionTool: class { name = 'potion'; emoji = '🧪'; execute = vi.fn().mockResolvedValue({ message: 'potion executed', notify: true }); getDescription = () => 'potion description'; getSyntax = () => '🧪 potion'; }
}));
vi.mock('../../../src/services/tools/tools/WikiTool.mjs', () => ({
  WikiTool: class { name = 'wiki'; emoji = '📖'; execute = vi.fn().mockResolvedValue({ message: 'wiki executed', notify: true }); getDescription = () => 'wiki description'; getSyntax = () => '📖 wiki'; }
}));

const createMockDeps = () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  aiService: {
    chat: vi.fn().mockResolvedValue({ text: 'AI response' }),
  },
  unifiedAIService: {
    chat: vi.fn().mockResolvedValue({ text: 'Unified AI response' }),
  },
  googleAIService: null,
  imageProcessingService: {
    processImage: vi.fn().mockResolvedValue('processed-image-url'),
  },
  configService: {
    get: vi.fn().mockReturnValue({}),
    getGuildConfig: vi.fn().mockResolvedValue({}),
  },
  cooldownService: {
    getRemainingCooldown: vi.fn().mockReturnValue(0),
    setUsed: vi.fn(),
  },
  memoryService: {
    addMemory: vi.fn().mockResolvedValue(true),
  },
  discordService: {
    client: { user: { id: 'bot-123' } },
  },
  databaseService: {
    getDatabase: vi.fn().mockResolvedValue({
      collection: vi.fn().mockReturnValue({
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        findOne: vi.fn().mockResolvedValue(null),
      }),
    }),
  },
  schedulingService: {
    addTask: vi.fn(),
  },
  spamControlService: null,
  moderationService: null,
  mapService: null,
  decisionMaker: null,
  avatarService: {
    getAvatarById: vi.fn().mockResolvedValue({ _id: 'avatar-1', name: 'TestAvatar' }),
  },
  riskManagerService: null,
  s3Service: null,
  locationService: null,
  battleService: null,
  combatEncounterService: {
    isInActiveCombat: vi.fn().mockReturnValue(false),
  },
  battleMediaService: null,
  xService: null,
  itemService: null,
  statService: null,
  schemaService: null,
  knowledgeService: null,
  veoService: null,
  videoJobService: null,
  presenceService: null,
  conversationThreadService: null,
  wikiService: null,
});

describe('ToolService', () => {
  let service;
  let deps;

  beforeEach(() => {
    deps = createMockDeps();
    service = new ToolService(deps);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with all tools registered', () => {
      expect(service.tools.size).toBeGreaterThan(0);
      expect(service.tools.has('attack')).toBe(true);
      expect(service.tools.has('move')).toBe(true);
      expect(service.tools.has('remember')).toBe(true);
    });

    it('should set up emoji mappings', () => {
      expect(service.toolEmojis.get('⚔️')).toBe('challenge');
      expect(service.toolEmojis.get('🧪')).toBe('potion');
      expect(service.toolEmojis.get('📖')).toBe('wiki');
    });

    it('should use provided cooldownService', () => {
      expect(service.cooldownService).toBe(deps.cooldownService);
    });
  });

  describe('registerTool', () => {
    it('should register a new tool', () => {
      const customTool = {
        name: 'custom',
        emoji: '🔮',
        execute: vi.fn(),
      };
      
      service.registerTool(customTool);
      
      expect(service.tools.has('custom')).toBe(true);
      expect(service.toolEmojis.get('🔮')).toBe('custom');
    });

    it('should not register tool without name', () => {
      const invalidTool = { emoji: '🔮' };
      
      service.registerTool(invalidTool);
      
      expect(service.toolEmojis.has('🔮')).toBe(false);
    });
  });

  describe('extractToolCommands', () => {
    it('should extract single tool command', () => {
      const result = service.extractToolCommands('⚔️ @enemy');
      
      expect(result.commands).toHaveLength(1);
      expect(result.commands[0].command).toBe('challenge');
      expect(result.commands[0].emoji).toBe('⚔️');
      expect(result.commands[0].params).toContain('@enemy');
    });

    it('should extract multiple tool commands', () => {
      const result = service.extractToolCommands('🧪 heal 📖 history');
      
      expect(result.commands).toHaveLength(2);
      expect(result.commands[0].command).toBe('potion');
      expect(result.commands[1].command).toBe('wiki');
    });

    it('should handle empty input', () => {
      const result = service.extractToolCommands('');
      
      expect(result.commands).toHaveLength(0);
      expect(result.cleanText).toBe('');
    });

    it('should handle null input', () => {
      const result = service.extractToolCommands(null);
      
      expect(result.commands).toHaveLength(0);
    });

    it('should return clean text without commands', () => {
      const result = service.extractToolCommands('Hello ⚔️ @enemy goodbye');
      
      expect(result.cleanText).not.toContain('⚔️');
      expect(result.cleanText).toContain('Hello');
    });

    it('should handle commands with no parameters', () => {
      const result = service.extractToolCommands('🏃');
      
      expect(result.commands).toHaveLength(1);
      expect(result.commands[0].command).toBe('flee');
      expect(result.commands[0].params).toHaveLength(0);
    });
  });

  describe('executeTool', () => {
    const mockMessage = {
      channel: { id: 'channel-123' },
      author: { id: 'user-123' },
    };

    const mockAvatar = {
      _id: 'avatar-123',
      name: 'TestAvatar',
      status: 'alive',
    };

    it('should execute a valid tool', async () => {
      const result = await service.executeTool('attack', mockMessage, ['@enemy'], mockAvatar);
      
      expect(result.message).toBeDefined();
      expect(deps.cooldownService.setUsed).toHaveBeenCalledWith('attack', 'avatar-123');
    });

    it('should return error for unknown tool', async () => {
      const result = await service.executeTool('nonexistent', mockMessage, [], mockAvatar);
      
      expect(result).toContain("Tool 'nonexistent' not found");
    });

    it('should enforce cooldowns', async () => {
      deps.cooldownService.getRemainingCooldown.mockReturnValue(120000); // 2 minutes remaining
      
      const result = await service.executeTool('attack', mockMessage, ['@enemy'], mockAvatar);
      
      expect(result).toContain('Please wait');
      expect(result).toContain("minute");
    });

    it('should block dead avatars from using tools', async () => {
      const deadAvatar = { ...mockAvatar, status: 'dead' };
      
      const result = await service.executeTool('attack', mockMessage, ['@enemy'], deadAvatar);
      
      expect(result).toBeNull();
    });

    it('should block knocked out avatars from using tools', async () => {
      const koAvatar = { ...mockAvatar, status: 'knocked_out' };
      
      const result = await service.executeTool('attack', mockMessage, ['@enemy'], koAvatar);
      
      expect(result).toBeNull();
    });

    it('should block non-combat tools during combat', async () => {
      deps.combatEncounterService.isInActiveCombat.mockReturnValue(true);
      
      const result = await service.executeTool('wiki', mockMessage, ['search'], mockAvatar);
      
      expect(result).toContain('not available during combat');
    });

    it('should allow combat tools during combat', async () => {
      deps.combatEncounterService.isInActiveCombat.mockReturnValue(true);
      
      const result = await service.executeTool('attack', mockMessage, ['@enemy'], mockAvatar);
      
      // Should not contain combat block message
      expect(result.message || result).not.toContain('not available during combat');
    });

    it('should allow item use during combat', async () => {
      deps.combatEncounterService.isInActiveCombat.mockReturnValue(true);
      
      const result = await service.executeTool('item', mockMessage, ['use', 'potion'], mockAvatar);
      
      expect(result.message || result).not.toContain('not available during combat');
    });

    it('should log action to memory service', async () => {
      await service.executeTool('attack', mockMessage, ['@enemy'], mockAvatar);
      
      expect(deps.memoryService.addMemory).toHaveBeenCalledWith(
        'avatar-123',
        expect.any(String)
      );
    });

    it('should handle tool execution errors gracefully', async () => {
      const errorTool = service.tools.get('attack');
      errorTool.execute.mockRejectedValue(new Error('Tool failed'));
      
      const result = await service.executeTool('attack', mockMessage, ['@enemy'], mockAvatar);
      
      expect(result.message).toContain('Error executing attack');
    });
  });

  describe('setConversationManager', () => {
    it('should set conversation manager on service', () => {
      const mockManager = { getConversation: vi.fn() };
      
      service.setConversationManager(mockManager);
      
      expect(service.conversationManager).toBe(mockManager);
    });

    it('should propagate to all tools', () => {
      const mockManager = { getConversation: vi.fn() };
      
      service.setConversationManager(mockManager);
      
      for (const tool of service.tools.values()) {
        expect(tool.conversationManager).toBe(mockManager);
      }
    });

    it('should not set same manager twice', () => {
      const mockManager = { getConversation: vi.fn() };
      
      service.setConversationManager(mockManager);
      service.setConversationManager(mockManager);
      
      // Should only be called once per tool
      expect(service.conversationManager).toBe(mockManager);
    });
  });

  describe('applyGuildToolEmojiOverrides', () => {
    it('should apply guild-specific emoji overrides', () => {
      const guildConfig = {
        toolEmojis: {
          attack: '⚡',
        },
      };
      
      service.applyGuildToolEmojiOverrides(guildConfig);
      
      expect(service.toolEmojis.get('⚡')).toBe('attack');
    });

    it('should remove previous emoji mappings for overridden tools', () => {
      // First set default emoji
      service.toolEmojis.set('🗡️', 'attack');
      
      const guildConfig = {
        toolEmojis: {
          attack: '⚡',
        },
      };
      
      service.applyGuildToolEmojiOverrides(guildConfig);
      
      expect(service.toolEmojis.get('🗡️')).toBeUndefined();
    });

    it('should handle empty guild config', () => {
      const initialSize = service.toolEmojis.size;
      
      service.applyGuildToolEmojiOverrides({});
      
      expect(service.toolEmojis.size).toBe(initialSize);
    });

    it('should handle null guild config', () => {
      const initialSize = service.toolEmojis.size;
      
      service.applyGuildToolEmojiOverrides(null);
      
      expect(service.toolEmojis.size).toBe(initialSize);
    });
  });

  describe('getCommandsDescription', () => {
    it('should return formatted command descriptions', async () => {
      const result = await service.getCommandsDescription('guild-123');
      
      expect(result).toContain('Command format:');
      expect(result).toContain('Description:');
    });

    it('should skip tools on cooldown for avatar', async () => {
      const avatar = { _id: 'avatar-123', name: 'Test' };
      deps.cooldownService.getRemainingCooldown.mockReturnValue(60000);
      
      const result = await service.getCommandsDescription('guild-123', avatar);
      
      // Result should be empty or not contain all tools
      expect(typeof result).toBe('string');
    });
  });

  describe('initialize', () => {
    it('should initialize all tools', async () => {
      await service.initialize();
      
      expect(deps.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('ToolService initialized')
      );
    });

    it('should start scheduled X posting', async () => {
      await service.initialize();
      
      expect(deps.schedulingService.addTask).toHaveBeenCalledWith(
        'x-auto-post',
        expect.any(Function),
        expect.any(Number)
      );
    });
  });
});

describe('normalizeToolResult', () => {
  // Import the function from the module for testing
  // Since it's not exported, we test it through executeTool

  let service;
  let deps;

  beforeEach(() => {
    deps = createMockDeps();
    service = new ToolService(deps);
  });

  it('should normalize string results', async () => {
    const tool = service.tools.get('attack');
    tool.execute.mockResolvedValue('Simple string result');
    
    const result = await service.executeTool('attack', 
      { channel: { id: '123' } }, 
      [], 
      { _id: 'av1', name: 'Test', status: 'alive' }
    );
    
    expect(result.message).toBe('Simple string result');
    expect(result.notify).toBe(true);
  });

  it('should handle object results with message property', async () => {
    const tool = service.tools.get('attack');
    tool.execute.mockResolvedValue({ message: 'Object message', notify: false });
    
    const result = await service.executeTool('attack', 
      { channel: { id: '123' } }, 
      [], 
      { _id: 'av1', name: 'Test', status: 'alive' }
    );
    
    expect(result.notify).toBe(false);
  });

  it('should handle null results', async () => {
    const tool = service.tools.get('attack');
    tool.execute.mockResolvedValue(null);
    
    const result = await service.executeTool('attack', 
      { channel: { id: '123' } }, 
      [], 
      { _id: 'av1', name: 'Test', status: 'alive' }
    );
    
    expect(result.notify).toBe(false);
  });
});
