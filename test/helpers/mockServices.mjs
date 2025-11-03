/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/helpers/mockServices.mjs
 * @description Mock service implementations for testing
 */

/**
 * Create a mock logger service
 */
export function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

/**
 * Create a mock database service
 */
export function createMockDatabaseService() {
  const mockCollection = {
    findOne: vi.fn(),
    find: vi.fn(() => ({
      toArray: vi.fn().mockResolvedValue([]),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
    })),
    insertOne: vi.fn(),
    insertMany: vi.fn(),
    updateOne: vi.fn(),
    updateMany: vi.fn(),
    deleteOne: vi.fn(),
    deleteMany: vi.fn(),
    countDocuments: vi.fn(),
    createIndex: vi.fn(),
    aggregate: vi.fn(() => ({
      toArray: vi.fn().mockResolvedValue([]),
    })),
  };

  return {
    getDatabase: vi.fn().mockResolvedValue({
      collection: vi.fn(() => mockCollection),
    }),
    collection: mockCollection,
    isConnected: true,
    initialize: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Create a mock config service
 */
export function createMockConfigService() {
  return {
    get: vi.fn((key, defaultValue) => defaultValue),
    set: vi.fn(),
    loadConfig: vi.fn().mockResolvedValue(undefined),
    config: {},
  };
}

/**
 * Create a mock secrets service
 */
export function createMockSecretsService() {
  return {
    getSecret: vi.fn().mockResolvedValue('mock-secret'),
    setSecret: vi.fn().mockResolvedValue(undefined),
    deleteSecret: vi.fn().mockResolvedValue(undefined),
    hydrateFromEnv: vi.fn(),
  };
}

/**
 * Create a mock AI service
 */
export function createMockAIService() {
  return {
    chat: vi.fn().mockResolvedValue({
      text: 'Mock AI response',
      model: 'mock-model',
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    }),
    generateStructuredOutput: vi.fn().mockResolvedValue({
      name: 'Mock Item',
      type: 'weapon',
      damage: 10,
    }),
    ready: Promise.resolve(),
  };
}

/**
 * Create a mock avatar service
 */
export function createMockAvatarService() {
  return {
    findByAvatarId: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({
      avatarId: 'test-avatar-id',
      name: 'Test Avatar',
      rarity: 'common',
    }),
    update: vi.fn().mockResolvedValue(true),
    delete: vi.fn().mockResolvedValue(true),
    list: vi.fn().mockResolvedValue([]),
    initialize: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Create a mock memory service
 */
export function createMockMemoryService() {
  return {
    storeMessage: vi.fn().mockResolvedValue(undefined),
    getRecentMessages: vi.fn().mockResolvedValue([]),
    getRelevantMemories: vi.fn().mockResolvedValue([]),
    createReflection: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Create a mock event bus
 */
export function createMockEventBus() {
  const listeners = new Map();
  
  return {
    on: vi.fn((event, handler) => {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      listeners.get(event).push(handler);
    }),
    emit: vi.fn((event, data) => {
      const handlers = listeners.get(event) || [];
      handlers.forEach(handler => handler(data));
    }),
    once: vi.fn(),
    off: vi.fn(),
    removeAllListeners: vi.fn(),
  };
}

/**
 * Create a mock Awilix container with common services
 */
export function createMockContainer(overrides = {}) {
  const mockServices = {
    logger: createMockLogger(),
    databaseService: createMockDatabaseService(),
    configService: createMockConfigService(),
    secretsService: createMockSecretsService(),
    aiService: createMockAIService(),
    avatarService: createMockAvatarService(),
    memoryService: createMockMemoryService(),
    eventBus: createMockEventBus(),
    ...overrides,
  };

  return {
    resolve: vi.fn((name) => mockServices[name]),
    register: vi.fn(),
    registrations: mockServices,
    cradle: mockServices,
  };
}
