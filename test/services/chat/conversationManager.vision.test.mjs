import { describe, it, expect } from 'vitest';
import { ConversationManager } from '../../../src/services/chat/conversationManager.mjs';

function createManager({ supportsVision }) {
  const captured = { messages: null, options: null };

  const unifiedAIService = {
    base: {
      supportsVisionModel: () => supportsVision
    },
    chat: async (messages, options) => {
      captured.messages = messages;
      captured.options = options;
      return { text: 'ok' };
    }
  };

  const manager = new ConversationManager({
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    databaseService: {
      getDatabase: async () => ({
        collection: () => ({
          find: () => ({
            sort: () => ({
              limit: () => ({
                toArray: async () => []
              })
            })
          })
        })
      })
    },
    aiService: {},
    unifiedAIService,
    discordService: {
      startTyping: async () => () => {},
      sendAsWebhook: async (_channelId, content) => ({ id: 'sent-1', content }),
      reactToMessage: async () => {},
      replyToMessage: async () => {},
      getGuildByChannelId: async () => ({ id: 'g1' }),
      client: { channels: { fetch: async () => null } }
    },
    avatarService: {
      updateAvatar: async () => {},
      updateAvatarActivity: async () => {},
      getAvatarById: async () => null
    },
    memoryService: {},
    promptService: {
      getResponseChatMessages: async () => [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'hello' }
      ]
    },
    configService: { services: {} },
    knowledgeService: {},
    mapService: { updateAvatarPosition: async () => {} },
    toolService: {
      toolEmojis: new Map(),
      tools: new Map(),
      extractToolCommands: () => ({ commands: [] }),
      executeTool: async () => ({ message: null })
    },
    presenceService: null,
    conversationThreadService: null,
    toolSchemaGenerator: null,
    toolExecutor: null,
    toolDecisionService: null
  });

  manager.checkChannelPermissions = async () => true;
  manager.ensureAvatarModel = async avatar => {
    avatar.model = avatar.model || 'some-model';
  };
  manager.getChannelContext = async () => [
    { content: 'old', timestamp: 1, hasImages: false },
    {
      content: 'new',
      timestamp: 2,
      hasImages: true,
      imageUrls: ['https://cdn.example.com/img.png'],
      primaryImageUrl: 'https://cdn.example.com/img.png'
    }
  ];
  manager.getChannelSummary = async () => '';

  return { manager, captured };
}

describe('ConversationManager vision routing', () => {
  it('passes image_url parts to vision-capable models', async () => {
    const { manager, captured } = createManager({ supportsVision: true });
    const channel = { id: 'c1' };
    const avatar = { _id: 'a1', name: 'Ava', model: 'vision-model' };

    await manager.sendResponse(channel, avatar);

    const user = captured.messages.find(m => m.role === 'user');
    expect(Array.isArray(user.content)).toBe(true);
    expect(user.content[0]).toEqual({ type: 'image_url', image_url: { url: 'https://cdn.example.com/img.png' } });
    expect(user.content.some(p => p.type === 'text')).toBe(true);
  });

  it('does not pass image_url parts to non-vision models', async () => {
    const { manager, captured } = createManager({ supportsVision: false });
    const channel = { id: 'c1' };
    const avatar = { _id: 'a1', name: 'Ava', model: 'text-model' };

    await manager.sendResponse(channel, avatar);

    const user = captured.messages.find(m => m.role === 'user');
    expect(typeof user.content).toBe('string');
    expect(user.content).toContain('hello');
  });
});
