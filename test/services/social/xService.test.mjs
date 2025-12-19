import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// Mock TwitterApi
const { mockTweet, mockUploadMedia, mockUserMentionTimeline, mockReply, mockV2Client, mockV1Client } = vi.hoisted(() => {
  const mockTweet = vi.fn().mockResolvedValue({ data: { id: '1234567890' } });
  const mockUserMentionTimeline = vi.fn().mockResolvedValue({ data: { data: [] } });
  const mockReply = vi.fn().mockResolvedValue({ data: { id: '999999999999999' } });
  const mockUploadMedia = vi.fn().mockImplementation(() => {
    console.error('mockUploadMedia implementation called');
    return Promise.resolve('media_id_123');
  });
  const mockV2Client = {
    tweet: mockTweet,
    uploadMedia: mockUploadMedia,
    me: vi.fn().mockResolvedValue({ data: { username: 'mockuser', id: 'user123', name: 'Mock User' } }),
    userMentionTimeline: mockUserMentionTimeline,
    reply: mockReply,
  };
  const mockV1Client = {
    uploadMedia: mockUploadMedia
  };
  return { mockTweet, mockUploadMedia, mockUserMentionTimeline, mockReply, mockV2Client, mockV1Client };
});

// Mock encryption utils
vi.mock('../../../src/utils/encryption.mjs', () => ({
  decrypt: (val) => val.replace('encrypted:', ''),
  encrypt: (val) => 'encrypted:' + val
}));

let XService;

beforeAll(async () => {
  vi.resetModules();
  process.env.X_GLOBAL_POST_ENABLED = 'true';
  
  vi.doMock('twitter-api-v2', () => {
    const MockClient = {
      v2: {
        tweet: mockTweet,
        uploadMedia: (...args) => {
          return mockUploadMedia(...args);
        },
        me: vi.fn().mockResolvedValue({ data: { username: 'mockuser', id: 'user123', name: 'Mock User' } }),
        userMentionTimeline: mockUserMentionTimeline,
        reply: mockReply,
      },
      v1: {
        uploadMedia: mockUploadMedia
      },
      readWrite: {
        tweet: mockTweet,
        uploadMedia: mockUploadMedia
      }
    };
  
    class MockTwitterApi {
      constructor() {
        return MockClient;
      }
    }

    return {
      __esModule: true,
      TwitterApi: MockTwitterApi,
      default: MockTwitterApi
    };
  });

  ({ default: XService } = await import('../../../src/services/social/xService.mjs'));
});

describe('XService Content Filtering', () => {
  let xService;
  let logger;
  let databaseService;
  let collectionMock;
  let xPostConfigCollection;
  let xAuthCollection;
  let secretsService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUploadMedia.mockResolvedValue('media_id_123');
    mockTweet.mockResolvedValue({ data: { id: '123456789012345' } });
    mockUserMentionTimeline.mockResolvedValue({ data: { data: [] } });
    mockReply.mockResolvedValue({ data: { id: '999999999999999' } });

    // Mock global fetch for image downloads
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => new ArrayBuffer(10),
      headers: { get: () => 'image/jpeg' }
    });

    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    };

    collectionMock = {
      findOne: vi.fn(),
      updateOne: vi.fn(),
      find: vi.fn().mockReturnValue({
        sort: () => ({
          limit: () => ({
            toArray: async () => []
          })
        })
      })
    };

    xPostConfigCollection = {
      findOne: vi.fn().mockResolvedValue({ enabled: true })
    };

    xAuthCollection = {
      findOne: vi.fn().mockResolvedValue({
        accessToken: 'encrypted:mock-token',
        global: true
      }),
      updateOne: vi.fn()
    };

    databaseService = {
      getDatabase: vi.fn().mockResolvedValue({
        collection: (name) => {
          if (name === 'x_post_config') return xPostConfigCollection;
          if (name === 'x_auth') return xAuthCollection;
          return collectionMock;
        }
      })
    };

    secretsService = {
      getAsync: vi.fn().mockResolvedValue('mock_secret')
    };

    xService = new XService({
      logger,
      databaseService,
      configService: {},
      secretsService,
      metricsService: {
        increment: vi.fn(),
        gauge: vi.fn(),
        recordHealth: vi.fn()
      }
    });
  });

  it('should block restricted cashtags by default', async () => {
    const result = await xService.postGlobalMediaUpdate({
      text: 'Check out this coin $RATI it is amazing',
      mediaUrl: 'https://example.com/image.png',
      // No contentFilters passed, defaults should apply (blockCashtags: true)
    });

    expect(result).toEqual({
      error: true,
      reason: expect.stringContaining('blocked cashtag')
    });
    expect(mockTweet).not.toHaveBeenCalled();
  });

  it('should allow restricted cashtags when explicitly allowed in contentFilters', async () => {
    const result = await xService.postGlobalMediaUpdate({
      text: 'Check out this coin $RATI it is amazing',
      mediaUrl: 'https://example.com/image.png',
      contentFilters: {
        allowedCashtags: ['$RATI'],
        blockCashtags: true
      }
    });

    // Should succeed and return tweet info
    expect(result).toEqual({
      tweetId: '123456789012345',
      tweetUrl: expect.stringContaining('123456789012345')
    });
    expect(mockTweet).toHaveBeenCalled();
  });

  it('should allow restricted cashtags when passed from globalBotService config', async () => {
    const globalBotServiceMock = {
      bot: {
        globalBotConfig: {
          contentFilters: {
            allowedCashtags: ['$HISS'],
            blockCashtags: true
          }
        }
      }
    };

    const result = await xService.postGlobalMediaUpdate({
      text: 'Check out this coin $HISS it is amazing',
      mediaUrl: 'https://example.com/image.png'
    }, { globalBotService: globalBotServiceMock });

    // Should succeed
    expect(result).toEqual({
      tweetId: '123456789012345',
      tweetUrl: expect.stringContaining('123456789012345')
    });
    expect(mockTweet).toHaveBeenCalled();
  });

  it('should prioritize globalBotService config over opts.contentFilters', async () => {
    const globalBotServiceMock = {
      bot: {
        globalBotConfig: {
          contentFilters: {
            allowedCashtags: ['$HISS'], // Only HISS allowed
            blockCashtags: true
          }
        }
      }
    };

    // We pass $RATI in opts, but globalBotService only allows $HISS
    // The current implementation prioritizes globalBotService if present
    const result = await xService.postGlobalMediaUpdate({
      text: 'Check out this coin $RATI it is amazing',
      mediaUrl: 'https://example.com/image.png',
      contentFilters: {
        allowedCashtags: ['$RATI']
      }
    }, { globalBotService: globalBotServiceMock });

    // Should fail because $RATI is not in the globalBotService config
    expect(result).toEqual({
      error: true,
      reason: expect.stringContaining('blocked cashtag')
    });
    expect(mockTweet).not.toHaveBeenCalled();
  });
});

describe('XService Mention Auto Reply', () => {
  let xService;
  let logger;
  let databaseService;
  let xAuthCollection;
  let mentionsStateCollection;
  let socialPostsCollection;

  beforeEach(() => {
    delete process.env.X_MENTION_REPLY_ENABLED;
    process.env.X_MENTION_MONTHLY_READ_CAP = '10';
    process.env.X_MENTION_MAX_RESULTS = '5';
    process.env.X_MENTION_WEEKLY_READ_CAP = '25';
    delete process.env.X_MENTION_DAILY_READ_CAP;

    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    };

    xAuthCollection = {
      findOne: vi.fn().mockResolvedValue({
        _id: 'auth1',
        accessToken: 'encrypted:mock-token',
        refreshToken: 'encrypted:mock-refresh',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        global: true,
        profile: { id: 'user123', username: 'mockuser' },
        updatedAt: new Date()
      }),
      updateOne: vi.fn()
    };

    mentionsStateCollection = {
      findOne: vi.fn().mockResolvedValue({
        _id: 'global',
        monthKey: new Date().toISOString().slice(0, 7),
        weekKey: (() => {
          // matches XService week key format roughly; not critical for this test
          const now = new Date();
          const tmp = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
          tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
          const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
          const weekNo = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
          return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
        })(),
        dayKey: new Date().toISOString().slice(0, 10),
        readsUsedMonth: 0,
        readsUsedWeek: 0,
        readsUsedDay: 0,
        lastMentionId: null
      }),
      updateOne: vi.fn().mockResolvedValue({ acknowledged: true })
    };

    socialPostsCollection = {
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ acknowledged: true })
    };

    databaseService = {
      getDatabase: vi.fn().mockResolvedValue({
        collection: (name) => {
          if (name === 'x_auth') return xAuthCollection;
          if (name === 'x_mentions_state') return mentionsStateCollection;
          if (name === 'social_posts') return socialPostsCollection;
          return { findOne: vi.fn(), updateOne: vi.fn() };
        }
      })
    };

    xService = new XService({
      logger,
      databaseService,
      configService: {},
      secretsService: { getAsync: vi.fn() },
      metricsService: { increment: vi.fn(), gauge: vi.fn(), recordHealth: vi.fn() }
    });
  });

  it('replies to new mentions and advances since_id with budget tracking', async () => {
    mockUserMentionTimeline.mockResolvedValue({
      data: {
        data: [
          { id: '200000000000000', text: 'Hello CosyWorld!', author_id: 'someoneElse' }
        ]
      }
    });

    const aiService = {
      chat: vi.fn().mockResolvedValue('Welcome to CosyWorld — what are you exploring today?')
    };

    const globalBotService = {
      bot: {
        name: 'CosyWorld',
        model: 'anthropic/claude-sonnet-4.5',
        personality: 'Warm narrator',
        dynamicPrompt: 'Present',
        globalBotConfig: {
          universeName: 'CosyWorld',
          xPostStyle: 'Warm and concise. No links.',
          contentFilters: { enabled: true, blockCashtags: true, blockCryptoAddresses: true, allowedCashtags: [], allowedAddresses: [] }
        }
      }
    };

    const result = await xService.processGlobalMentionsAndReply({ aiService, globalBotService });

    expect(result.ok).toBe(true);
    expect(result.fetched).toBe(1);
    expect(result.replied).toBe(1);
    expect(mockReply).toHaveBeenCalledTimes(1);
    expect(mentionsStateCollection.updateOne).toHaveBeenCalled();
    expect(socialPostsCollection.insertOne).toHaveBeenCalled();
  });

  it('skips polling when weekly read budget is exhausted (responsive until spent)', async () => {
    process.env.X_MENTION_WEEKLY_READ_CAP = '1';
    mentionsStateCollection.findOne.mockResolvedValue({
      _id: 'global',
      monthKey: new Date().toISOString().slice(0, 7),
      weekKey: (() => {
        const now = new Date();
        const tmp = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
        const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
        return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
      })(),
      dayKey: new Date().toISOString().slice(0, 10),
      readsUsedMonth: 1,
      readsUsedWeek: 1,
      readsUsedDay: 0,
      lastMentionId: null
    });

    const result = await xService.processGlobalMentionsAndReply({
      aiService: { chat: vi.fn() },
      globalBotService: { bot: { globalBotConfig: { contentFilters: { enabled: false } } } }
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('budget_exhausted_week');
    expect(mockUserMentionTimeline).not.toHaveBeenCalled();
  });
});

describe('XService Content Validation', () => {
  let xService;
  let logger;
  let databaseService;

  beforeEach(() => {
    vi.clearAllMocks();

    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    };

    databaseService = {
      getDatabase: vi.fn().mockResolvedValue({
        collection: () => ({
          findOne: vi.fn(),
          updateOne: vi.fn(),
        })
      })
    };

    xService = new XService({
      logger,
      databaseService,
      configService: {},
      secretsService: { getAsync: vi.fn() },
      metricsService: { increment: vi.fn(), gauge: vi.fn(), recordHealth: vi.fn() }
    });
  });

  it('should validate tweet length correctly', () => {
    const shortTweet = xService._validateTweetContent('Hello world!');
    expect(shortTweet.valid).toBe(true);
    expect(shortTweet.stats.length).toBe(12);

    const longTweet = xService._validateTweetContent('x'.repeat(300));
    expect(longTweet.valid).toBe(false);
    expect(longTweet.issues.some(i => i.type === 'length')).toBe(true);
  });

  it('should detect excessive mentions', () => {
    const manyMentions = xService._validateTweetContent(
      Array(55).fill('@user').join(' ')
    );
    expect(manyMentions.valid).toBe(false);
    expect(manyMentions.issues.some(i => i.type === 'mentions')).toBe(true);
  });

  it('should warn about excessive hashtags', () => {
    const manyHashtags = xService._validateTweetContent(
      Array(12).fill('#tag').join(' ')
    );
    expect(manyHashtags.valid).toBe(true); // warnings don't fail validation
    expect(manyHashtags.issues.some(i => i.type === 'hashtags')).toBe(true);
  });

  it('should detect empty content', () => {
    const empty = xService._validateTweetContent('');
    expect(empty.valid).toBe(false);
    expect(empty.issues.some(i => i.type === 'empty')).toBe(true);
  });
});

describe('XService Thread Splitting', () => {
  let xService;

  beforeEach(() => {
    vi.clearAllMocks();

    xService = new XService({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      databaseService: { getDatabase: vi.fn() },
      configService: {},
      secretsService: { getAsync: vi.fn() },
      metricsService: { increment: vi.fn(), gauge: vi.fn(), recordHealth: vi.fn() }
    });
  });

  it('should not split short content', () => {
    const result = xService._splitIntoThread('Hello world!');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('Hello world!');
  });

  it('should split long content into multiple tweets', () => {
    const longContent = 'This is a sentence. '.repeat(20); // ~400 chars
    const result = xService._splitIntoThread(longContent, { maxLength: 100 });
    expect(result.length).toBeGreaterThan(1);
    result.forEach(tweet => {
      expect(tweet.length).toBeLessThanOrEqual(100);
    });
  });

  it('should preserve word boundaries when splitting', () => {
    const content = 'Hello world this is a test message that definitely needs splitting into parts';
    const result = xService._splitIntoThread(content, { maxLength: 30, preserveWords: true });
    // Each tweet should be a complete unit, not cut mid-word
    expect(result.length).toBeGreaterThan(1);
    // Verify all parts together equal the original (minus extra whitespace)
    expect(result.join(' ').replace(/\s+/g, ' ')).toBe(content.replace(/\s+/g, ' '));
  });

  it('should handle empty content', () => {
    const result = xService._splitIntoThread('');
    expect(result).toHaveLength(0);
  });
});
