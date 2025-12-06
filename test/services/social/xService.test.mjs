import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// Mock TwitterApi
const { mockTweet, mockUploadMedia, mockV2Client, mockV1Client } = vi.hoisted(() => {
  const mockTweet = vi.fn().mockResolvedValue({ data: { id: '1234567890' } });
  const mockUploadMedia = vi.fn().mockResolvedValue('media_id_123');
  const mockV2Client = {
    tweet: mockTweet,
    uploadMedia: mockUploadMedia,
    me: vi.fn().mockResolvedValue({ data: { username: 'mockuser' } })
  };
  const mockV1Client = {
    uploadMedia: mockUploadMedia
  };
  return { mockTweet, mockUploadMedia, mockV2Client, mockV1Client };
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
        uploadMedia: mockUploadMedia,
        me: vi.fn().mockResolvedValue({ data: { username: 'mockuser' } })
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
      error: vi.fn((...args) => console.error('logger.error:', ...args)),
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
      tweetId: '1234567890',
      tweetUrl: expect.stringContaining('1234567890')
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
      tweetId: '1234567890',
      tweetUrl: expect.stringContaining('1234567890')
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
