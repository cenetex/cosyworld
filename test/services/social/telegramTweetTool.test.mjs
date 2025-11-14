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
    createIndex: vi.fn().mockResolvedValue({ name: 'mock' }),
    countDocuments: vi.fn().mockResolvedValue(0),
    findOne: vi.fn().mockResolvedValue(null),
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

  const serviceInstance = new TelegramService({
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

  serviceInstance.__collectionMock = collectionMock;
  serviceInstance.__databaseServiceMock = databaseService;
  return serviceInstance;
}

describe('TelegramService tweet tool helpers', () => {
  let service;

  beforeEach(() => {
    service = createService();
    service._recordMediaUsage = vi.fn().mockResolvedValue();
    vi.spyOn(service, 'checkMediaGenerationLimit').mockResolvedValue({
      allowed: true,
      hourlyUsed: 0,
      dailyUsed: 0,
      hourlyLimit: 3,
      dailyLimit: 12,
      resetTimes: {
        hourly: new Date(Date.now() + 60000),
        daily: new Date(Date.now() + 3600000)
      }
    });
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
    service._trackBotMessage = vi.fn().mockResolvedValue();
    service._recordMediaUsage = vi.fn().mockResolvedValue();
    vi.spyOn(service, 'checkMediaGenerationLimit').mockResolvedValue({
      allowed: true,
      hourlyUsed: 0,
      dailyUsed: 0,
      hourlyLimit: 3,
      dailyLimit: 12,
      resetTimes: {
        hourly: new Date(Date.now() + 60000),
        daily: new Date(Date.now() + 3600000)
      }
    });

    const mediaEntry = {
      id: 'media-1',
      type: 'image',
      mediaUrl: 'https://example.com/1.png',
      caption: 'A moment',
      prompt: 'prompt text',
      createdAt: new Date()
    };
    service.recentMediaByChannel.set('channel-1', [mediaEntry]);

    const ctx = {
      reply: vi.fn(),
      chat: { id: 'channel-1' },
      telegram: {
        sendPhoto: vi.fn().mockResolvedValue({ message_id: 99 })
      }
    };

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
  expect(ctx.telegram.sendPhoto).toHaveBeenCalledWith('channel-1', 'https://example.com/1.png', expect.objectContaining({ caption: expect.stringContaining('Posted to X') }));
  expect(ctx.reply).not.toHaveBeenCalled();
    expect(service._markMediaAsTweeted).toHaveBeenCalledWith('channel-1', 'media-1', expect.any(Object));
    expect(service._recordMediaUsage).toHaveBeenCalledWith('user-1', 'tester', 'tweet');
  });

  it('falls back to database lookup when only a short ID is provided', async () => {
    const postGlobalMediaUpdate = vi.fn().mockResolvedValue({ tweetId: 'tweet-9', tweetUrl: 'https://x.com/i/web/status/tweet-9' });
    service = createService({ xService: { postGlobalMediaUpdate } });
    service._markMediaAsTweeted = vi.fn().mockResolvedValue();
    service._recordBotResponse = vi.fn().mockResolvedValue();
    service._trackBotMessage = vi.fn().mockResolvedValue();

    const dbMediaRecord = {
      id: 'abcd1234-1111-2222-3333-abcdefabcdef',
      channelId: 'channel-2',
      type: 'image',
      mediaUrl: 'https://example.com/db.png',
      caption: 'DB stored media',
      createdAt: new Date()
    };

    service.__collectionMock.findOne = vi.fn()
      .mockResolvedValueOnce(null) // exact match
      .mockResolvedValueOnce(dbMediaRecord); // prefix match
    vi.spyOn(service, 'checkMediaGenerationLimit').mockResolvedValue({
      allowed: true,
      hourlyUsed: 0,
      dailyUsed: 0,
      hourlyLimit: 3,
      dailyLimit: 12,
      resetTimes: {
        hourly: new Date(Date.now() + 60000),
        daily: new Date(Date.now() + 3600000)
      }
    });

    const ctx = {
      reply: vi.fn(),
      chat: { id: 'channel-2' },
      telegram: {
        sendPhoto: vi.fn().mockResolvedValue({ message_id: 101 })
      }
    };

    await service.executeTweetPost(ctx, {
      text: 'Share this one',
      mediaId: 'abcd1234',
      channelId: 'channel-2',
      userId: 'user-7',
      username: 'tester'
    });

    expect(service.__collectionMock.findOne).toHaveBeenCalledTimes(2);
    expect(postGlobalMediaUpdate).toHaveBeenCalled();
    expect(service._markMediaAsTweeted).toHaveBeenCalledWith('channel-2', dbMediaRecord.id, expect.any(Object));
    expect(ctx.telegram.sendPhoto).toHaveBeenCalled();
  });

  it('prevents tweeting when quota exhausted', async () => {
    const postGlobalMediaUpdate = vi.fn();
    service = createService({ xService: { postGlobalMediaUpdate } });
    service._recordBotResponse = vi.fn().mockResolvedValue();
    vi.spyOn(service, 'checkMediaGenerationLimit').mockResolvedValue({
      allowed: false,
      hourlyUsed: 3,
      dailyUsed: 5,
      hourlyLimit: 3,
      dailyLimit: 12,
      resetTimes: {
        hourly: new Date(Date.now() + 600000),
        daily: new Date(Date.now() + 7200000)
      }
    });

    const ctx = {
      reply: vi.fn(),
      chat: { id: 'channel-3' }
    };

    await service.executeTweetPost(ctx, {
      text: 'Need to share this',
      mediaId: 'media-3',
      channelId: 'channel-3',
      userId: 'user-9',
      username: 'tester'
    });

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('X posting is cooling down'));
    expect(postGlobalMediaUpdate).not.toHaveBeenCalled();
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

describe('TelegramService index bootstrap', () => {
  it('creates telegram indexes only once even if requested repeatedly', async () => {
    const service = createService();
    await service._ensureTelegramIndexes();
    await service._ensureTelegramIndexes();

    expect(service.__collectionMock.createIndex).toHaveBeenCalledTimes(5);
  });

  it('gracefully skips index creation when no databaseService is available', async () => {
    const service = createService({ databaseService: null });
    await service._ensureTelegramIndexes();

    expect(service._indexesReady).toBe(false);
  });
});
