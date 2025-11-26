/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/services/planner/actionExecutor.test.mjs
 * @description Unit tests for ActionExecutor and ActionExecutorRegistry
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ActionExecutor,
  GenerateImageExecutor,
  GenerateKeyframeExecutor,
  EditImageExecutor,
  GenerateVideoExecutor,
  GenerateVideoFromImageExecutor,
  ExtendVideoExecutor,
  SpeakExecutor,
  PostTweetExecutor,
  ResearchExecutor,
  WaitExecutor,
  ActionExecutorRegistry,
  actionExecutorRegistry
} from '../../../src/services/planner/actionExecutor.mjs';

// =============================================================================
// ActionExecutor Base Class Tests
// =============================================================================

describe('ActionExecutor base class', () => {
  it('stores action type', () => {
    const executor = new ActionExecutor('test_action');
    expect(executor.actionType).toBe('test_action');
  });

  it('canHandle returns true for matching action', () => {
    const executor = new ActionExecutor('test_action');
    expect(executor.canHandle('test_action')).toBe(true);
    expect(executor.canHandle('TEST_ACTION')).toBe(true);
  });

  it('canHandle returns false for non-matching action', () => {
    const executor = new ActionExecutor('test_action');
    expect(executor.canHandle('other_action')).toBe(false);
  });

  it('execute throws when not implemented', async () => {
    const executor = new ActionExecutor('test_action');
    await expect(executor.execute({}, {})).rejects.toThrow('must be implemented by subclass');
  });

  it('has default timeout of 2 minutes', () => {
    const executor = new ActionExecutor('test_action');
    expect(executor.getTimeout()).toBe(120000);
  });
});

// =============================================================================
// Concrete Executor Tests
// =============================================================================

describe('GenerateImageExecutor', () => {
  let executor;
  let mockContext;

  beforeEach(() => {
    executor = new GenerateImageExecutor();
    mockContext = {
      ctx: {},
      conversationContext: 'test context',
      userId: 'user123',
      username: 'testuser',
      stepNum: 1,
      services: {
        telegram: {
          executeImageGeneration: vi.fn()
        }
      }
    };
  });

  it('has correct action type', () => {
    expect(executor.actionType).toBe('generate_image');
  });

  it('has 2 minute timeout', () => {
    expect(executor.getTimeout()).toBe(120000);
  });

  it('returns success with mediaId on successful generation', async () => {
    mockContext.services.telegram.executeImageGeneration.mockResolvedValue({ id: 'media123' });
    
    const result = await executor.execute({ description: 'test image' }, mockContext);
    
    expect(result.success).toBe(true);
    expect(result.mediaId).toBe('media123');
    expect(result.action).toBe('generate_image');
    expect(result.stepNum).toBe(1);
  });

  it('returns failure when generation returns null', async () => {
    mockContext.services.telegram.executeImageGeneration.mockResolvedValue(null);
    
    const result = await executor.execute({ description: 'test image' }, mockContext);
    
    expect(result.success).toBe(false);
  });
});

describe('GenerateVideoExecutor', () => {
  let executor;

  beforeEach(() => {
    executor = new GenerateVideoExecutor();
  });

  it('has correct action type', () => {
    expect(executor.actionType).toBe('generate_video');
  });

  it('has 5 minute timeout for video generation', () => {
    expect(executor.getTimeout()).toBe(300000);
  });
});

describe('EditImageExecutor', () => {
  let executor;
  let mockContext;

  beforeEach(() => {
    executor = new EditImageExecutor();
    mockContext = {
      ctx: { reply: vi.fn() },
      conversationContext: 'test context',
      userId: 'user123',
      username: 'testuser',
      stepNum: 1,
      latestMediaId: null,
      services: {
        telegram: {
          executeImageEdit: vi.fn()
        }
      }
    };
  });

  it('requires source image', async () => {
    mockContext.latestMediaId = null;
    
    const result = await executor.execute({}, mockContext);
    
    expect(result.success).toBe(false);
    expect(result.error).toBe('No source image');
    expect(mockContext.ctx.reply).toHaveBeenCalled();
  });

  it('uses latestMediaId as source', async () => {
    mockContext.latestMediaId = 'existing123';
    mockContext.services.telegram.executeImageEdit.mockResolvedValue({ id: 'edited123' });
    
    const result = await executor.execute({ description: 'edit prompt' }, mockContext);
    
    expect(result.success).toBe(true);
    expect(result.mediaId).toBe('edited123');
  });

  it('uses step.sourceMediaId over latestMediaId', async () => {
    mockContext.latestMediaId = 'existing123';
    mockContext.services.telegram.executeImageEdit.mockResolvedValue({ id: 'edited456' });
    
    await executor.execute({ description: 'edit', sourceMediaId: 'specific789' }, mockContext);
    
    expect(mockContext.services.telegram.executeImageEdit).toHaveBeenCalledWith(
      mockContext.ctx,
      expect.objectContaining({ sourceMediaId: 'specific789' })
    );
  });
});

describe('SpeakExecutor', () => {
  let executor;

  beforeEach(() => {
    executor = new SpeakExecutor();
  });

  it('has correct action type', () => {
    expect(executor.actionType).toBe('speak');
  });

  it('has 30 second timeout', () => {
    expect(executor.getTimeout()).toBe(30000);
  });
});

describe('PostTweetExecutor', () => {
  let executor;
  let mockContext;

  beforeEach(() => {
    executor = new PostTweetExecutor();
    mockContext = {
      ctx: { reply: vi.fn() },
      channelId: 'channel123',
      conversationContext: 'test context',
      userId: 'user123',
      username: 'testuser',
      stepNum: 1,
      latestMediaId: null,
      generationFailed: false,
      logger: { warn: vi.fn() },
      services: {
        telegram: {
          _getRecentMedia: vi.fn().mockResolvedValue([]),
          executeTweetPost: vi.fn()
        },
        ai: {
          chat: vi.fn().mockResolvedValue('Generated tweet text')
        },
        globalBot: { bot: { model: 'test-model' } }
      }
    };
  });

  it('has 1 minute timeout', () => {
    expect(executor.getTimeout()).toBe(60000);
  });

  it('skips when generationFailed is true', async () => {
    mockContext.generationFailed = true;
    
    const result = await executor.execute({}, mockContext);
    
    expect(result.success).toBe(false);
    expect(result.error).toBe('Prior media generation failed');
    expect(mockContext.ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Skipping'));
  });

  it('fails when no media is available', async () => {
    mockContext.latestMediaId = null;
    mockContext.services.telegram._getRecentMedia.mockResolvedValue([]);
    
    const result = await executor.execute({}, mockContext);
    
    expect(result.success).toBe(false);
    expect(result.error).toBe('No media found');
  });

  it('uses latestMediaId for tweet', async () => {
    mockContext.latestMediaId = 'media123';
    mockContext.services.telegram.executeTweetPost.mockResolvedValue({});
    
    const result = await executor.execute({ description: 'share this' }, mockContext);
    
    expect(result.success).toBe(true);
    expect(result.mediaId).toBe('media123');
    expect(mockContext.services.telegram.executeTweetPost).toHaveBeenCalled();
  });
});

describe('WaitExecutor and ResearchExecutor', () => {
  it('WaitExecutor returns success immediately', async () => {
    const executor = new WaitExecutor();
    const result = await executor.execute({}, { stepNum: 1 });
    expect(result.success).toBe(true);
  });

  it('WaitExecutor has 5 second timeout', () => {
    const executor = new WaitExecutor();
    expect(executor.getTimeout()).toBe(5000);
  });

  it('ResearchExecutor returns success immediately', async () => {
    const executor = new ResearchExecutor();
    const result = await executor.execute({}, { stepNum: 2 });
    expect(result.success).toBe(true);
  });

  it('ResearchExecutor has 30 second timeout', () => {
    const executor = new ResearchExecutor();
    expect(executor.getTimeout()).toBe(30000);
  });
});

// =============================================================================
// ActionExecutorRegistry Tests
// =============================================================================

describe('ActionExecutorRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new ActionExecutorRegistry();
  });

  it('registers all default executors', () => {
    const expectedActions = [
      'generate_image', 'generate_keyframe', 'generate_video',
      'generate_video_from_image', 'edit_image', 'extend_video',
      'speak', 'post_tweet', 'research', 'wait'
    ];

    for (const action of expectedActions) {
      expect(registry.isSupported(action)).toBe(true);
    }
  });

  it('returns executor for valid action', () => {
    const executor = registry.get('generate_image');
    expect(executor).toBeInstanceOf(GenerateImageExecutor);
  });

  it('returns null for unknown action', () => {
    const executor = registry.get('unknown_action');
    expect(executor).toBeNull();
  });

  it('handles case-insensitive action lookup', () => {
    expect(registry.get('GENERATE_IMAGE')).toBeInstanceOf(GenerateImageExecutor);
    expect(registry.get('Generate_Image')).toBeInstanceOf(GenerateImageExecutor);
  });

  it('getSupportedActions returns all registered actions', () => {
    const actions = registry.getSupportedActions();
    expect(actions).toContain('generate_image');
    expect(actions).toContain('post_tweet');
    expect(actions.length).toBe(10);
  });

  it('allows registering custom executors', () => {
    class CustomExecutor extends ActionExecutor {
      constructor() {
        super('custom_action');
      }
    }
    
    registry.register(new CustomExecutor());
    
    expect(registry.isSupported('custom_action')).toBe(true);
    expect(registry.get('custom_action')).toBeInstanceOf(CustomExecutor);
  });
});

describe('actionExecutorRegistry singleton', () => {
  it('is an instance of ActionExecutorRegistry', () => {
    expect(actionExecutorRegistry).toBeInstanceOf(ActionExecutorRegistry);
  });

  it('has all default executors registered', () => {
    expect(actionExecutorRegistry.isSupported('generate_image')).toBe(true);
    expect(actionExecutorRegistry.isSupported('post_tweet')).toBe(true);
  });
});
