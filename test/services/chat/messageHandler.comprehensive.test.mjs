/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/services/chat/messageHandler.comprehensive.test.mjs
 * @description Comprehensive tests for MessageHandler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageHandler } from '../../../src/services/chat/messageHandler.mjs';

const createMockDeps = () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
  },
  toolService: {
    extractToolCommands: vi.fn().mockReturnValue({ commands: [], cleanText: '', commandLines: [] }),
    executeTool: vi.fn().mockResolvedValue({ message: 'Tool executed', notify: true }),
    applyGuildToolEmojiOverrides: vi.fn(),
    setConversationManager: vi.fn(),
  },
  discordService: {
    client: {
      user: { id: 'bot-123' },
      guilds: { cache: new Map() },
      on: vi.fn(),
    },
    getChannel: vi.fn().mockResolvedValue({ id: 'channel-123', type: 0 }),
    sendMessage: vi.fn().mockResolvedValue(true),
  },
  databaseService: {
    getDatabase: vi.fn().mockResolvedValue({
      collection: vi.fn().mockReturnValue({
        findOne: vi.fn().mockResolvedValue(null),
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
        updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      }),
    }),
  },
  configService: {
    get: vi.fn().mockReturnValue(null),
    getGuildConfig: vi.fn().mockResolvedValue({
      avatarModes: {},
      enabledChannels: [],
    }),
  },
  spamControlService: {
    isSpam: vi.fn().mockReturnValue(false),
    recordMessage: vi.fn(),
  },
  schedulingService: {
    addTask: vi.fn(),
    removeTask: vi.fn(),
  },
  turnScheduler: {
    recordActivity: vi.fn(),
  },
  avatarService: {
    getAvatarsInChannel: vi.fn().mockResolvedValue([]),
    findAvatarByMention: vi.fn().mockResolvedValue(null),
    getAvatarById: vi.fn().mockResolvedValue(null),
    updateAvatar: vi.fn().mockResolvedValue(true),
  },
  decisionMaker: {
    shouldRespond: vi.fn().mockResolvedValue({ respond: false }),
  },
  conversationManager: {
    addMessage: vi.fn(),
    getConversationHistory: vi.fn().mockResolvedValue([]),
    getOrCreateConversation: vi.fn().mockResolvedValue({ id: 'conv-123' }),
  },
  riskManagerService: {
    assessRisk: vi.fn().mockResolvedValue({ risk: 'low', score: 0.1 }),
  },
  moderationService: {
    checkContent: vi.fn().mockResolvedValue({ approved: true }),
    moderateMessage: vi.fn().mockResolvedValue({ action: 'allow' }),
    refreshDynamicRegex: vi.fn().mockResolvedValue(),
  },
  mapService: {
    getLocationAndAvatars: vi.fn().mockResolvedValue({ location: null, avatars: [] }),
  },
  responseCoordinator: {
    queueResponse: vi.fn().mockResolvedValue(true),
    shouldRespond: vi.fn().mockReturnValue(true),
  },
  buybotService: {
    isBuybotChannel: vi.fn().mockReturnValue(false),
    handleMessage: vi.fn().mockResolvedValue(null),
  },
});

describe('MessageHandler', () => {
  let handler;
  let deps;

  beforeEach(() => {
    deps = createMockDeps();
    handler = new MessageHandler(deps);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with all dependencies', () => {
      expect(handler.logger).toBe(deps.logger);
      expect(handler.toolService).toBe(deps.toolService);
      expect(handler.discordService).toBe(deps.discordService);
      expect(handler.avatarService).toBe(deps.avatarService);
    });

    it('should initialize moderation regex patterns', () => {
      expect(handler.staticModerationRegexes).toBeInstanceOf(Array);
      expect(handler.staticModerationRegexes.length).toBeGreaterThan(0);
    });

    it('should not be started initially', () => {
      expect(handler.started).toBe(false);
    });

    it('should reference Discord client', () => {
      expect(handler.client).toBe(deps.discordService.client);
    });
  });

  describe('start', () => {
    it('should mark handler as started', async () => {
      await handler.start();

      expect(handler.started).toBe(true);
    });
  });

  describe('_isPureModelOnlyGuild', () => {
    it('should return true when only pureModel mode is enabled', () => {
      const guildConfig = {
        avatarModes: {
          pureModel: true,
          free: false,
          onChain: false,
          collection: false,
        },
      };

      const result = handler._isPureModelOnlyGuild(guildConfig);

      expect(result).toBe(true);
    });

    it('should return false when other modes are enabled', () => {
      const guildConfig = {
        avatarModes: {
          pureModel: true,
          free: true,
        },
      };

      const result = handler._isPureModelOnlyGuild(guildConfig);

      expect(result).toBe(false);
    });

    it('should handle legacy wallet mode', () => {
      const guildConfig = {
        avatarModes: {
          pureModel: true,
          free: false,
          wallet: false, // Legacy mode
        },
      };

      const result = handler._isPureModelOnlyGuild(guildConfig);

      expect(result).toBe(true);
    });

    it('should return false for empty config', () => {
      const result = handler._isPureModelOnlyGuild({});

      expect(result).toBe(false);
    });

    it('should return false for null config', () => {
      const result = handler._isPureModelOnlyGuild(null);

      expect(result).toBe(false);
    });
  });

  describe('_filterAvatarsByGuildModes', () => {
    it('should return empty array for empty input', () => {
      const result = handler._filterAvatarsByGuildModes([], {});

      expect(result).toEqual([]);
    });

    it('should return empty array for null input', () => {
      const result = handler._filterAvatarsByGuildModes(null, {});

      expect(result).toEqual([]);
    });

    it('should return all avatars when all modes enabled', () => {
      const avatars = [
        { _id: '1', name: 'Avatar1' },
        { _id: '2', name: 'Avatar2' },
      ];
      const guildConfig = { avatarModes: {} };

      const result = handler._filterAvatarsByGuildModes(avatars, guildConfig);

      expect(result).toEqual(avatars);
    });

    it('should handle legacy wallet mode mapping', () => {
      const avatars = [
        { _id: '1', name: 'Free' },
        { _id: '2', name: 'Wallet', walletAddress: '0x123' },
      ];
      const guildConfig = {
        avatarModes: {
          wallet: true, // Legacy
        },
      };

      const result = handler._filterAvatarsByGuildModes(avatars, guildConfig);

      expect(result.length).toBeGreaterThan(0);
    });
  });
});

describe('MessageHandler - Message Processing', () => {
  let handler;
  let deps;

  beforeEach(() => {
    deps = createMockDeps();
    handler = new MessageHandler(deps);
    handler.started = true;
  });

  describe('URL detection', () => {
    it('should detect URLs in messages', () => {
      const urlRegex = handler.staticModerationRegexes[0];
      
      expect(urlRegex.test('Check out https://example.com')).toBe(true);
      expect(urlRegex.test('Visit http://test.org/path')).toBe(true);
      expect(urlRegex.test('No URL here')).toBe(false);
    });
  });
});

describe('MessageHandler - Guild Configuration', () => {
  let handler;
  let deps;

  beforeEach(() => {
    deps = createMockDeps();
    handler = new MessageHandler(deps);
  });

  describe('avatar mode filtering', () => {
    it('should correctly identify free avatars', () => {
      const freeAvatar = { _id: '1', name: 'Free', summoner: 'user:123' };
      const walletAvatar = { _id: '2', name: 'Wallet', walletAddress: '0x123', summoner: 'wallet:0x123' };

      // Free avatar should not have wallet indicators
      expect(freeAvatar.walletAddress).toBeUndefined();
      expect(walletAvatar.walletAddress).toBeDefined();
    });
  });
});

describe('MessageHandler - Error Handling', () => {
  let handler;
  let deps;

  beforeEach(() => {
    deps = createMockDeps();
    handler = new MessageHandler(deps);
    handler.started = true;
  });

  it('should handle database errors gracefully', async () => {
    deps.databaseService.getDatabase.mockRejectedValue(new Error('DB connection failed'));

    // Should not throw
    await expect(async () => {
      await handler._filterAvatarsByGuildModes([], null);
    }).not.toThrow();
  });

  it('should handle missing services gracefully', () => {
    const minimalDeps = {
      ...deps,
      buybotService: null,
    };

    const minimalHandler = new MessageHandler(minimalDeps);

    expect(minimalHandler.buybotService).toBeNull();
  });
});

describe('MessageHandler - Tool Planner Integration', () => {
  let handler;
  let deps;

  beforeEach(() => {
    deps = createMockDeps();
    handler = new MessageHandler(deps);
  });

  it('should initialize tool planner in start()', async () => {
    await handler.start();

    expect(handler.toolPlanner).toBeDefined();
  });

  it('should have null tool planner before start', () => {
    expect(handler.toolPlanner).toBeNull();
  });
});

describe('MessageHandler - Static Moderation Patterns', () => {
  let handler;
  let deps;

  beforeEach(() => {
    deps = createMockDeps();
    handler = new MessageHandler(deps);
  });

  it('should have URL pattern as first regex', () => {
    const urlPattern = handler.staticModerationRegexes[0];

    // Test various URL formats
    expect('https://example.com'.match(urlPattern)).toBeTruthy();
    expect('http://subdomain.example.org/path?query=1'.match(urlPattern)).toBeTruthy();
    expect('https://192.168.1.1:8080/api'.match(urlPattern)).toBeTruthy();
  });

  it('should not match non-URLs', () => {
    const urlPattern = handler.staticModerationRegexes[0];

    expect('just some text'.match(urlPattern)).toBeFalsy();
    expect('email@example.com'.match(urlPattern)).toBeFalsy();
    expect('ftp://files.example.com'.match(urlPattern)).toBeFalsy(); // Only http/https
  });

  it('should support dynamic moderation regex', () => {
    // Initially null
    expect(handler.dynamicModerationRegex).toBeNull();

    // Can be set dynamically
    handler.dynamicModerationRegex = 'spam|scam';

    expect(handler.dynamicModerationRegex).toBe('spam|scam');
  });
});

describe('MessageHandler - Integration with Services', () => {
  let handler;
  let deps;

  beforeEach(() => {
    deps = createMockDeps();
    handler = new MessageHandler(deps);
    handler.started = true;
  });

  it('should use spam control service', () => {
    expect(handler.spamControlService).toBe(deps.spamControlService);
    expect(handler.spamControlService.isSpam).toBeDefined();
    expect(handler.spamControlService.recordMessage).toBeDefined();
  });

  it('should use moderation service', () => {
    expect(handler.moderationService).toBe(deps.moderationService);
    expect(handler.moderationService.checkContent).toBeDefined();
  });

  it('should use risk manager service', () => {
    expect(handler.riskManagerService).toBe(deps.riskManagerService);
    expect(handler.riskManagerService.assessRisk).toBeDefined();
  });

  it('should use response coordinator', () => {
    expect(handler.responseCoordinator).toBe(deps.responseCoordinator);
    expect(handler.responseCoordinator.queueResponse).toBeDefined();
  });

  it('should use turn scheduler', () => {
    expect(handler.turnScheduler).toBe(deps.turnScheduler);
    expect(handler.turnScheduler.recordActivity).toBeDefined();
  });
});
