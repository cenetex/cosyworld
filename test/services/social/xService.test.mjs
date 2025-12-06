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
    const mockUploadMedia = vi.fn().mockImplementation((...args) => {
      console.log('mockUploadMedia called with:', args);
      return Promise.resolve('media_id_123');
    });
    const mockTweet = vi.fn().mockResolvedValue({ data: { id: '1234567890' } });
    
    const MockClient = {
      v2: {
        tweet: mockTweet,
        uploadMedia: (...args) => {
          console.error('Plain uploadMedia called');
          return Promise.resolve('media_id_123');
        },
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
    console.log('MockClient defined via doMock');
  
    class MockTwitterApi {
      constructor() {
        console.error('Mock constructor called');
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
  it('debug mocks', async () => {
    const { TwitterApi } = await import('twitter-api-v2');
    console.error('TwitterApi is mock:', vi.isMockFunction(TwitterApi));
    expect(vi.isMockFunction(TwitterApi)).toBe(true);
    const client = new TwitterApi('token');
    console.error('client keys:', Object.keys(client));
    console.error('client.v2:', client.v2);
    if (client.v2) {
      console.error('client.v2.uploadMedia:', client.v2.uploadMedia);
    }
  });

  let xService;
  let logger;
  let databaseService;
  let collectionMock;
  let xPostConfigCollection;
  let xAuthCollection;

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
      info: vi.fn((...args) => console.error('logger.info:', args)),
      warn: vi.fn((...args) => console.error('logger.warn:', args)),
      error: vi.fn((...args) => console.error('logger.error:', args)),
      debug: vi.fn((...args) => console.error('logger.debug:', args))
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

    xService = new XService({
      logger,
      databaseService,
      configService: {},
      secretsService: {},
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
