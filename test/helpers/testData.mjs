/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/helpers/testData.mjs
 * @description Test data fixtures for unit tests
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Create a test avatar
 */
export function createTestAvatar(overrides = {}) {
  return {
    avatarId: uuidv4(),
    name: 'Test Avatar',
    personality: 'Brave and curious test avatar',
    rarity: 'common',
    tier: 'common',
    stats: {
      hp: 100,
      maxHp: 100,
      attack: 10,
      defense: 5,
      speed: 8,
    },
    inventory: [],
    location: 'test-location',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Create a test item
 */
export function createTestItem(overrides = {}) {
  return {
    itemId: uuidv4(),
    name: 'Test Sword',
    type: 'weapon',
    rarity: 'common',
    effects: {
      attack: 5,
    },
    description: 'A simple test sword',
    createdAt: new Date(),
    ...overrides,
  };
}

/**
 * Create a test memory
 */
export function createTestMemory(overrides = {}) {
  return {
    _id: uuidv4(),
    avatarId: 'test-avatar-id',
    type: 'conversation',
    content: 'Test memory content',
    importance: 0.5,
    timestamp: new Date(),
    metadata: {
      conversationId: 'test-conversation',
      channelId: 'test-channel',
    },
    ...overrides,
  };
}

/**
 * Create a test combat session
 */
export function createTestCombatSession(overrides = {}) {
  return {
    sessionId: uuidv4(),
    participants: ['avatar-1', 'avatar-2'],
    state: 'active',
    turns: [],
    currentTurn: 0,
    startedAt: new Date(),
    winner: null,
    ...overrides,
  };
}

/**
 * Create test AI chat messages
 */
export function createTestChatMessages(count = 3) {
  const messages = [];
  for (let i = 0; i < count; i++) {
    messages.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Test message ${i + 1}`,
    });
  }
  return messages;
}

/**
 * Create a test AI response
 */
export function createTestAIResponse(overrides = {}) {
  return {
    text: 'This is a test AI response',
    model: 'test-model',
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    },
    ...overrides,
  };
}

/**
 * Create a test tool schema
 */
export function createTestToolSchema(overrides = {}) {
  return {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        description: 'Target of the action',
      },
      amount: {
        type: 'number',
        description: 'Amount or intensity',
        minimum: 1,
        maximum: 100,
      },
    },
    required: ['target'],
    ...overrides,
  };
}

/**
 * Create a test Discord message
 */
export function createTestDiscordMessage(overrides = {}) {
  return {
    id: '123456789',
    content: 'Test message',
    author: {
      id: 'user-123',
      username: 'TestUser',
      bot: false,
    },
    channel: {
      id: 'channel-123',
      name: 'test-channel',
      send: vi.fn().mockResolvedValue({}),
    },
    guild: {
      id: 'guild-123',
      name: 'Test Guild',
    },
    createdTimestamp: Date.now(),
    reply: vi.fn().mockResolvedValue({}),
    react: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}
