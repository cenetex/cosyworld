/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/services/chat/conversationManager.test.mjs
 * @description Comprehensive tests for ConversationManager
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationManager } from '../../../src/services/chat/conversationManager.mjs';

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
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([]),
      }),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'msg-123' }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ deletedCount: 1 }),
      countDocuments: vi.fn().mockResolvedValue(0),
    }),
  },
  avatarService: {
    getAvatarById: vi.fn().mockResolvedValue({ _id: 'av1', name: 'TestAvatar' }),
    getAvatarsByChannelId: vi.fn().mockResolvedValue([]),
  },
  memoryService: {
    getMemories: vi.fn().mockResolvedValue([]),
    createMemory: vi.fn().mockResolvedValue(true),
  },
  tokenService: {
    countTokens: vi.fn().mockReturnValue(100),
    truncateToTokenLimit: vi.fn().mockImplementation((text) => text),
  },
});

describe('ConversationManager', () => {
  let manager;
  let deps;
  let mockCollection;

  beforeEach(() => {
    deps = createMockDeps();
    mockCollection = deps.db.collection();
    manager = new ConversationManager(deps);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with dependencies', () => {
      expect(manager.db).toBe(deps.db);
      expect(manager.avatarService).toBe(deps.avatarService);
    });

    it('should set default configuration', () => {
      expect(manager.maxHistoryLength).toBeDefined();
      expect(manager.tokenLimit).toBeDefined();
    });

    it('should respect environment variables', () => {
      process.env.CONVERSATION_MAX_HISTORY = '100';
      process.env.CONVERSATION_TOKEN_LIMIT = '8000';

      const customManager = new ConversationManager(deps);

      expect(customManager.maxHistoryLength).toBe(100);
      expect(customManager.tokenLimit).toBe(8000);

      delete process.env.CONVERSATION_MAX_HISTORY;
      delete process.env.CONVERSATION_TOKEN_LIMIT;
    });
  });

  describe('getConversationHistory', () => {
    const mockMessages = [
      { role: 'user', content: 'Hello', timestamp: new Date('2024-01-01T10:00:00Z') },
      { role: 'assistant', content: 'Hi there!', timestamp: new Date('2024-01-01T10:00:01Z') },
      { role: 'user', content: 'How are you?', timestamp: new Date('2024-01-01T10:00:02Z') },
    ];

    beforeEach(() => {
      mockCollection.find().toArray.mockResolvedValue(mockMessages);
    });

    it('should retrieve conversation history for a channel', async () => {
      const history = await manager.getConversationHistory('channel-123');

      expect(mockCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({ channelId: 'channel-123' })
      );
      expect(history).toHaveLength(3);
    });

    it('should respect limit parameter', async () => {
      await manager.getConversationHistory('channel-123', { limit: 10 });

      expect(mockCollection.find().limit).toHaveBeenCalledWith(10);
    });

    it('should filter by avatar if specified', async () => {
      await manager.getConversationHistory('channel-123', { avatarId: 'av-123' });

      expect(mockCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'channel-123',
          avatarId: 'av-123',
        })
      );
    });

    it('should sort by timestamp descending', async () => {
      await manager.getConversationHistory('channel-123');

      expect(mockCollection.find().sort).toHaveBeenCalledWith({ timestamp: -1 });
    });

    it('should return messages in chronological order', async () => {
      const history = await manager.getConversationHistory('channel-123');

      // Should reverse to chronological order
      expect(history[0].content).toBe('Hello');
      expect(history[2].content).toBe('How are you?');
    });

    it('should include optional fields in messages', async () => {
      const messagesWithMetadata = [
        {
          role: 'user',
          content: 'Hello',
          authorId: 'user-123',
          authorName: 'TestUser',
          timestamp: new Date(),
        },
      ];
      mockCollection.find().toArray.mockResolvedValue(messagesWithMetadata);

      const history = await manager.getConversationHistory('channel-123');

      expect(history[0]).toHaveProperty('authorId');
      expect(history[0]).toHaveProperty('authorName');
    });
  });

  describe('addMessage', () => {
    const messageData = {
      channelId: 'channel-123',
      role: 'user',
      content: 'Test message',
      authorId: 'user-456',
      authorName: 'TestUser',
    };

    it('should add a new message to conversation', async () => {
      await manager.addMessage(messageData);

      expect(mockCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'channel-123',
          role: 'user',
          content: 'Test message',
          timestamp: expect.any(Date),
        })
      );
    });

    it('should return the inserted message ID', async () => {
      mockCollection.insertOne.mockResolvedValue({ insertedId: 'msg-789' });

      const result = await manager.addMessage(messageData);

      expect(result.insertedId).toBe('msg-789');
    });

    it('should handle assistant messages', async () => {
      await manager.addMessage({
        ...messageData,
        role: 'assistant',
        avatarId: 'av-123',
      });

      expect(mockCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'assistant',
          avatarId: 'av-123',
        })
      );
    });

    it('should handle system messages', async () => {
      await manager.addMessage({
        channelId: 'channel-123',
        role: 'system',
        content: 'System notification',
      });

      expect(mockCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'system',
        })
      );
    });

    it('should set timestamp if not provided', async () => {
      await manager.addMessage(messageData);

      const insertCall = mockCollection.insertOne.mock.calls[0][0];
      expect(insertCall.timestamp).toBeInstanceOf(Date);
    });

    it('should use provided timestamp', async () => {
      const timestamp = new Date('2024-01-01T12:00:00Z');

      await manager.addMessage({ ...messageData, timestamp });

      expect(mockCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp,
        })
      );
    });
  });

  describe('buildContextWindow', () => {
    const mockHistory = [
      { role: 'user', content: 'First message', authorName: 'User1' },
      { role: 'assistant', content: 'Response 1', avatarName: 'Bot' },
      { role: 'user', content: 'Second message', authorName: 'User1' },
      { role: 'assistant', content: 'Response 2', avatarName: 'Bot' },
    ];

    beforeEach(() => {
      mockCollection.find().toArray.mockResolvedValue(mockHistory);
    });

    it('should build context window from history', async () => {
      const context = await manager.buildContextWindow('channel-123', 'av-123');

      expect(Array.isArray(context)).toBe(true);
      expect(context.length).toBeGreaterThan(0);
    });

    it('should respect token limit', async () => {
      deps.tokenService.countTokens.mockReturnValue(5000); // High token count

      await manager.buildContextWindow('channel-123', 'av-123', { tokenLimit: 4000 });

      expect(deps.tokenService.truncateToTokenLimit).toHaveBeenCalled();
    });

    it('should include avatar memories', async () => {
      deps.memoryService.getMemories.mockResolvedValue([
        { content: 'Important memory', importance: 0.9 },
      ]);

      const context = await manager.buildContextWindow('channel-123', 'av-123', {
        includeMemories: true,
      });

      expect(deps.memoryService.getMemories).toHaveBeenCalledWith('av-123');
      expect(context.some((msg) => msg.content.includes('Important memory'))).toBe(true);
    });

    it('should format messages with role and content', async () => {
      const context = await manager.buildContextWindow('channel-123', 'av-123');

      context.forEach((msg) => {
        expect(msg).toHaveProperty('role');
        expect(msg).toHaveProperty('content');
      });
    });

    it('should handle empty history', async () => {
      mockCollection.find().toArray.mockResolvedValue([]);

      const context = await manager.buildContextWindow('channel-123', 'av-123');

      expect(context).toEqual([]);
    });

    it('should include system prompt if provided', async () => {
      const systemPrompt = 'You are a helpful assistant.';

      const context = await manager.buildContextWindow('channel-123', 'av-123', {
        systemPrompt,
      });

      expect(context[0]).toEqual({
        role: 'system',
        content: systemPrompt,
      });
    });
  });

  describe('summarizeConversation', () => {
    const longHistory = Array(50).fill(null).map((_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
      timestamp: new Date(Date.now() - (50 - i) * 60000),
    }));

    beforeEach(() => {
      mockCollection.find().toArray.mockResolvedValue(longHistory);
    });

    it('should summarize long conversations', async () => {
      const summary = await manager.summarizeConversation('channel-123');

      expect(summary).toBeDefined();
      expect(typeof summary).toBe('string');
    });

    it('should preserve recent messages', async () => {
      const result = await manager.summarizeConversation('channel-123', {
        preserveRecent: 10,
      });

      expect(result.preservedMessages).toHaveLength(10);
    });

    it('should create memory from summary', async () => {
      await manager.summarizeConversation('channel-123', {
        createMemory: true,
        avatarId: 'av-123',
      });

      expect(deps.memoryService.createMemory).toHaveBeenCalled();
    });
  });

  describe('clearHistory', () => {
    it('should clear all messages for a channel', async () => {
      await manager.clearHistory('channel-123');

      expect(mockCollection.deleteMany).toHaveBeenCalledWith({
        channelId: 'channel-123',
      });
    });

    it('should clear only for specific avatar if provided', async () => {
      await manager.clearHistory('channel-123', { avatarId: 'av-123' });

      expect(mockCollection.deleteMany).toHaveBeenCalledWith({
        channelId: 'channel-123',
        avatarId: 'av-123',
      });
    });

    it('should clear messages older than specified date', async () => {
      const cutoffDate = new Date('2024-01-01');

      await manager.clearHistory('channel-123', { before: cutoffDate });

      expect(mockCollection.deleteMany).toHaveBeenCalledWith({
        channelId: 'channel-123',
        timestamp: { $lt: cutoffDate },
      });
    });

    it('should return count of deleted messages', async () => {
      mockCollection.deleteMany.mockResolvedValue({ deletedCount: 42 });

      const result = await manager.clearHistory('channel-123');

      expect(result.deletedCount).toBe(42);
    });
  });

  describe('getMessageCount', () => {
    it('should return count of messages for channel', async () => {
      mockCollection.countDocuments.mockResolvedValue(150);

      const count = await manager.getMessageCount('channel-123');

      expect(count).toBe(150);
    });

    it('should count only for specific avatar if provided', async () => {
      await manager.getMessageCount('channel-123', { avatarId: 'av-123' });

      expect(mockCollection.countDocuments).toHaveBeenCalledWith({
        channelId: 'channel-123',
        avatarId: 'av-123',
      });
    });

    it('should count only specific roles if provided', async () => {
      await manager.getMessageCount('channel-123', { role: 'user' });

      expect(mockCollection.countDocuments).toHaveBeenCalledWith({
        channelId: 'channel-123',
        role: 'user',
      });
    });
  });

  describe('getParticipants', () => {
    const messagesWithParticipants = [
      { authorId: 'user-1', authorName: 'User One' },
      { authorId: 'user-2', authorName: 'User Two' },
      { avatarId: 'av-1', avatarName: 'Avatar One' },
      { authorId: 'user-1', authorName: 'User One' }, // Duplicate
    ];

    beforeEach(() => {
      mockCollection.find().toArray.mockResolvedValue(messagesWithParticipants);
    });

    it('should return unique participants', async () => {
      const participants = await manager.getParticipants('channel-123');

      expect(participants.users).toHaveLength(2);
      expect(participants.avatars).toHaveLength(1);
    });

    it('should include participant names', async () => {
      const participants = await manager.getParticipants('channel-123');

      expect(participants.users[0]).toHaveProperty('name', 'User One');
    });
  });

  describe('searchMessages', () => {
    it('should search messages by content', async () => {
      await manager.searchMessages('channel-123', 'hello');

      expect(mockCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'channel-123',
          content: expect.any(Object), // Regex
        })
      );
    });

    it('should support regex search', async () => {
      await manager.searchMessages('channel-123', /hello/i);

      expect(mockCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          content: /hello/i,
        })
      );
    });

    it('should limit results', async () => {
      await manager.searchMessages('channel-123', 'hello', { limit: 20 });

      expect(mockCollection.find().limit).toHaveBeenCalledWith(20);
    });
  });

  describe('getRecentContext', () => {
    it('should get recent messages for quick context', async () => {
      const recentMessages = [
        { role: 'user', content: 'Recent 1' },
        { role: 'assistant', content: 'Recent 2' },
      ];
      mockCollection.find().toArray.mockResolvedValue(recentMessages);

      const context = await manager.getRecentContext('channel-123', 5);

      expect(mockCollection.find().limit).toHaveBeenCalledWith(5);
      expect(context).toEqual(recentMessages.reverse());
    });
  });

  describe('markAsProcessed', () => {
    it('should mark message as processed', async () => {
      await manager.markAsProcessed('msg-123');

      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { _id: 'msg-123' },
        expect.objectContaining({
          $set: { processed: true, processedAt: expect.any(Date) },
        })
      );
    });
  });

  describe('pruneOldMessages', () => {
    it('should delete messages older than retention period', async () => {
      await manager.pruneOldMessages(30); // 30 days

      expect(mockCollection.deleteMany).toHaveBeenCalledWith({
        timestamp: { $lt: expect.any(Date) },
      });
    });

    it('should return count of pruned messages', async () => {
      mockCollection.deleteMany.mockResolvedValue({ deletedCount: 1000 });

      const result = await manager.pruneOldMessages(30);

      expect(result.prunedCount).toBe(1000);
    });

    it('should log pruning results', async () => {
      mockCollection.deleteMany.mockResolvedValue({ deletedCount: 500 });

      await manager.pruneOldMessages(30);

      expect(deps.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('500'),
        expect.any(Object)
      );
    });
  });
});

describe('ConversationManager - Bot Rate Limiting', () => {
  let manager;
  let deps;

  beforeEach(() => {
    deps = createMockDeps();
    manager = new ConversationManager(deps);
  });

  it('should have rate limiting configuration', () => {
    expect(manager.BOT_REPLY_COOLDOWN).toBeDefined();
    expect(manager.BOT_BURST_ALLOWED).toBeDefined();
    expect(manager.BOT_BURST_WINDOW_MS).toBeDefined();
  });

  it('should track last bot message time per channel', () => {
    expect(manager.channelLastBotMessage).toBeInstanceOf(Map);
  });

  it('should track bot burst count per channel', () => {
    expect(manager.channelBotBurstCount).toBeInstanceOf(Map);
  });

  it('should initialize response queue per channel', () => {
    expect(manager.channelResponseQueue).toBeInstanceOf(Map);
  });
});

describe('ConversationManager - Channel Context', () => {
  let manager;
  let deps;

  beforeEach(() => {
    deps = createMockDeps();
    manager = new ConversationManager(deps);
  });

  it('should have channel cooldown configuration', () => {
    expect(manager.CHANNEL_COOLDOWN).toBe(5000); // 5 seconds
  });

  it('should track last message per channel', () => {
    expect(manager.channelLastMessage).toBeInstanceOf(Map);
  });

  it('should limit responses per message', () => {
    expect(manager.MAX_RESPONSES_PER_MESSAGE).toBe(2);
  });

  it('should track channel responders', () => {
    expect(manager.channelResponders).toBeInstanceOf(Map);
  });
});

describe('ConversationManager - Summary Caching', () => {
  let manager;
  let deps;

  beforeEach(() => {
    deps = createMockDeps();
    manager = new ConversationManager(deps);
  });

  it('should have summary cache map', () => {
    expect(manager.summaryCacheMap).toBeInstanceOf(Map);
  });

  it('should have summary cache TTL of 60 seconds', () => {
    expect(manager.SUMMARY_CACHE_TTL_MS).toBe(60000);
  });
});
