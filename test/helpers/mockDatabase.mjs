/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/helpers/mockDatabase.mjs
 * @description Mock database helpers for testing
 */

import { vi } from 'vitest';

/**
 * Create a mock MongoDB collection
 * @returns {Object} Mock collection
 */
export function createMockCollection() {
  return {
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'mock-id' }),
    insertMany: vi.fn().mockResolvedValue({ insertedIds: ['id1', 'id2'] }),
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn(() => ({
      toArray: vi.fn().mockResolvedValue([]),
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    })),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1, matchedCount: 1 }),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0, matchedCount: 0 }),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    countDocuments: vi.fn().mockResolvedValue(0),
    createIndex: vi.fn().mockResolvedValue('index_name'),
    createIndexes: vi.fn().mockResolvedValue(['index1', 'index2']),
    aggregate: vi.fn(() => ({
      toArray: vi.fn().mockResolvedValue([]),
    })),
  };
}

/**
 * Create a mock MongoDB database
 * @param {Object} [collections={}] - Pre-configured collections
 * @returns {Object} Mock database
 */
export function createMockDatabase(collections = {}) {
  return {
    collection: vi.fn((name) => {
      if (collections[name]) {
        return collections[name];
      }
      return createMockCollection();
    }),
  };
}

/**
 * Create a mock database service
 * @param {Object} [mockDb] - Mock database instance
 * @returns {Object} Mock database service
 */
export function createMockDatabaseService(mockDb) {
  const db = mockDb || createMockDatabase();
  
  return {
    getDatabase: vi.fn().mockResolvedValue(db),
    isConnected: vi.fn().mockReturnValue(true),
    connect: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn().mockResolvedValue(true),
  };
}

/**
 * Create a mock logger
 * @returns {Object} Mock logger
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
 * Create a mock config service
 * @param {Object} [config={}] - Configuration values
 * @returns {Object} Mock config service
 */
export function createMockConfigService(config = {}) {
  const defaultConfig = {
    payment: {
      x402: {
        sellerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        network: 'base-sepolia',
      },
      aiMarkup: 1.1,
      platformFee: 0.02,
    },
    ai: {
      defaultModel: 'google/gemini-2.0-flash-exp:free',
    },
    ...config,
  };

  return {
    get: vi.fn((key) => {
      const keys = key.split('.');
      let value = defaultConfig;
      for (const k of keys) {
        value = value?.[k];
      }
      return value;
    }),
    set: vi.fn(),
    getAll: vi.fn().mockReturnValue(defaultConfig),
  };
}

/**
 * Create mock agent wallet service
 * @returns {Object} Mock agent wallet service
 */
export function createMockAgentWalletService() {
  return {
    isConfigured: vi.fn().mockReturnValue(true),
    getOrCreateWallet: vi.fn().mockResolvedValue({
      agentId: 'agent-123',
      network: 'base',
      address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      balance: { usdc: 100000 },
    }),
    getWallet: vi.fn().mockResolvedValue(null),
    fundWallet: vi.fn().mockResolvedValue(true),
    getBalance: vi.fn().mockResolvedValue(100000),
    createPayment: vi.fn().mockResolvedValue({
      signedPayload: '0x...',
    }),
  };
}

/**
 * Create mock x402 service
 * @returns {Object} Mock x402 service
 */
export function createMockX402Service() {
  return {
    generatePaymentRequired: vi.fn().mockReturnValue({
      x402Version: 1,
      facilitator: { scheme: 'exact', network: 'base' },
      price: { usdcAmount: 50000 },
      paymentDestination: { address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb' },
    }),
    verifyPayment: vi.fn().mockResolvedValue({
      verified: true,
      amount: 50000,
      settlementId: 'settlement-123',
    }),
    settlePayment: vi.fn().mockResolvedValue({
      settled: true,
      txHash: '0x...',
    }),
    getSupportedNetworks: vi.fn().mockResolvedValue(['base', 'base-sepolia']),
  };
}

/**
 * Create a complete mock service container
 * @param {Object} [overrides={}] - Override specific services
 * @returns {Object} Mock service container
 */
export function createMockServices(overrides = {}) {
  return {
    logger: createMockLogger(),
    databaseService: createMockDatabaseService(),
    configService: createMockConfigService(),
    agentWalletService: createMockAgentWalletService(),
    x402Service: createMockX402Service(),
    ...overrides,
  };
}
