import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

let TelegramService;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  ({ default: TelegramService } = await import('../../../src/services/social/telegramService.mjs'));
});

function createService(overrides = {}) {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };

  const collectionMock = {
    updateOne: vi.fn().mockResolvedValue({}),
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'mock' }),
    find: vi.fn().mockReturnValue({
      sort: () => ({
        limit: () => ({
          toArray: async () => []
        })
      })
    })
  };

  const databaseService = {
    getDatabase: vi.fn().mockResolvedValue({
      collection: () => collectionMock
    })
  };

  return new TelegramService({
    logger,
    databaseService,
    configService: { get: () => null },
    secretsService: null,
    aiService: null,
    globalBotService: null,
    googleAIService: null,
    veoService: null,
    buybotService: null,
    xService: overrides.xService || null,
    ...overrides
  });
}

describe('TelegramService tweet tool helpers', () => {
  let service;

  beforeEach(() => {
    service = createService();
  });

  it('remembers generated media with bounded cache', async () => {
    service.RECENT_MEDIA_LIMIT = 2;

    await service._rememberGeneratedMedia('channel', { mediaUrl: 'https://example.com/1.png', caption: 'first' });
    await service._rememberGeneratedMedia('channel', { mediaUrl: 'https://example.com/2.png', caption: 'second' });
    await service._rememberGeneratedMedia('channel', { mediaUrl: 'https://example.com/3.png', caption: 'third' });

    const cached = await service._getRecentMedia('channel', 5);
    expect(cached).toHaveLength(2);
    expect(cached[0].caption).toBe('third');
    expect(cached[1].caption).toBe('second');
  });

  it('posts tweet when media exists and xService resolves', async () => {
    const postGlobalMediaUpdate = vi.fn().mockResolvedValue({ tweetId: '123', tweetUrl: 'https://x.com/i/web/status/123' });
    service = createService({ xService: { postGlobalMediaUpdate } });
    service._markMediaAsTweeted = vi.fn().mockResolvedValue();
    service._recordBotResponse = vi.fn().mockResolvedValue();

    const mediaEntry = {
      id: 'media-1',
      type: 'image',
      mediaUrl: 'https://example.com/1.png',
      caption: 'A moment',
      prompt: 'prompt text',
      createdAt: new Date()
    };
    service.recentMediaByChannel.set('channel-1', [mediaEntry]);

    const ctx = { reply: vi.fn() };

    await service.executeTweetPost(ctx, {
      text: 'Look at this',
      mediaId: 'media-1',
      channelId: 'channel-1',
      userId: 'user-1',
      username: 'tester'
    });

    expect(postGlobalMediaUpdate).toHaveBeenCalledWith(expect.objectContaining({
      mediaUrl: 'https://example.com/1.png',
      source: 'telegram.tweet_tool'
    }), expect.any(Object));
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Tweeted'));
    expect(service._markMediaAsTweeted).toHaveBeenCalledWith('channel-1', 'media-1', expect.any(Object));
  });
});

describe('TelegramService planning tool helpers', () => {
  let service;

  beforeEach(() => {
    service = createService();
  });

  it('records plan entries and replies with formatted plan', async () => {
    service._recordBotResponse = vi.fn().mockResolvedValue();
    service._saveMessageToDatabase = vi.fn().mockResolvedValue();
    service._persistAgentPlanRecord = vi.fn().mockResolvedValue();

    const ctx = { reply: vi.fn() };

    await service.executePlanActions(ctx, {
      objective: 'Share a fresh creation',
      steps: [
        { action: 'speak', description: 'Tell the channel what inspired the piece' },
        { action: 'generate_image', description: 'Create an image of the scene', expectedOutcome: 'A cozy visual' }
      ],
      confidence: 0.82
    }, 'channel-plan', 'user-42', 'tester');

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('🧠 Planning sequence ready.'));
    const plans = service.agentPlansByChannel.get('channel-plan');
    expect(plans).toBeDefined();
    expect(plans[0].steps).toHaveLength(2);
    expect(plans[0].objective).toContain('fresh creation');
  });

  it('summarizes recent plans for prompt context', async () => {
    const now = new Date();
    service.agentPlansByChannel.set('channel-plan', [{
      id: 'plan-1',
      channelId: 'channel-plan',
      objective: 'Delight the chat',
      steps: [{ action: 'speak', description: 'Warm greeting' }],
      createdAt: now
    }]);

    const planContext = await service._buildPlanContext('channel-plan', 2);
    expect(planContext.summary).toContain('Recent agent plans');
    expect(planContext.plans).toHaveLength(1);
  });
});
