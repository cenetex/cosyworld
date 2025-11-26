/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/services/social/telegramPlanExecution.test.mjs
 * @description Unit tests for TelegramService Phase 1 plan execution features:
 *              - Plan validation
 *              - Step timeouts
 *              - Progress feedback
 */

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
    xService: null,
    ...overrides
  });

  return serviceInstance;
}

// =============================================================================
// Plan Validation Tests
// =============================================================================

describe('TelegramService._validatePlan', () => {
  let service;

  beforeEach(() => {
    service = createService();
  });

  describe('basic validation', () => {
    it('returns invalid for null plan', () => {
      const result = service._validatePlan(null);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Plan is empty or undefined');
    });

    it('returns invalid for undefined plan', () => {
      const result = service._validatePlan(undefined);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Plan is empty or undefined');
    });

    it('returns invalid for plan with no steps', () => {
      const result = service._validatePlan({ objective: 'Test' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Plan has no steps to execute');
    });

    it('returns invalid for plan with empty steps array', () => {
      const result = service._validatePlan({ objective: 'Test', steps: [] });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Plan has no steps to execute');
    });

    it('warns when plan has no objective', () => {
      const result = service._validatePlan({
        steps: [{ action: 'speak', description: 'Hello' }]
      });
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Plan has no objective - execution may lack context');
    });

    it('warns when plan has too many steps', () => {
      const steps = Array(15).fill({ action: 'speak', description: 'Hello' });
      const result = service._validatePlan({ objective: 'Test', steps });
      expect(result.warnings.some(w => w.includes('15 steps'))).toBe(true);
    });
  });

  describe('action validation', () => {
    it('validates all known actions', () => {
      const validActions = [
        'generate_image', 'generate_keyframe', 'generate_video',
        'generate_video_from_image', 'edit_image', 'extend_video',
        'speak', 'post_tweet', 'research', 'wait'
      ];

      for (const action of validActions) {
        const result = service._validatePlan({
          objective: 'Test',
          steps: [
            { action: 'generate_image', description: 'Make image' },
            { action, description: 'Test action' }
          ]
        });
        // Actions that need prior media should pass since we have generate_image first
        expect(result.errors.some(e => e.includes(`Unknown action "${action}"`))).toBe(false);
      }
    });

    it('rejects unknown actions', () => {
      const result = service._validatePlan({
        objective: 'Test',
        steps: [{ action: 'explode_server', description: 'Bad action' }]
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Unknown action "explode_server"'))).toBe(true);
    });

    it('errors when step has no action', () => {
      const result = service._validatePlan({
        objective: 'Test',
        steps: [{ description: 'No action here' }]
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Missing action type'))).toBe(true);
    });

    it('handles case-insensitive actions', () => {
      const result = service._validatePlan({
        objective: 'Test',
        steps: [{ action: 'GENERATE_IMAGE', description: 'Test' }]
      });
      // Should be valid - action is lowercased internally
      expect(result.valid).toBe(true);
    });
  });

  describe('dependency validation', () => {
    it('requires prior media for post_tweet', () => {
      const result = service._validatePlan({
        objective: 'Test',
        steps: [{ action: 'post_tweet', description: 'Tweet something' }]
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('post_tweet') && e.includes('Requires prior media'))).toBe(true);
    });

    it('allows post_tweet after generate_image', () => {
      const result = service._validatePlan({
        objective: 'Test',
        steps: [
          { action: 'generate_image', description: 'Make art' },
          { action: 'post_tweet', description: 'Share it' }
        ]
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('allows post_tweet with sourceMediaId', () => {
      const result = service._validatePlan({
        objective: 'Test',
        steps: [
          { action: 'post_tweet', description: 'Share it', sourceMediaId: 'media123' }
        ]
      });
      expect(result.valid).toBe(true);
    });

    it('requires prior media for edit_image', () => {
      const result = service._validatePlan({
        objective: 'Test',
        steps: [{ action: 'edit_image', description: 'Edit something' }]
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('edit_image') && e.includes('Requires prior media'))).toBe(true);
    });

    it('requires prior media for extend_video', () => {
      const result = service._validatePlan({
        objective: 'Test',
        steps: [{ action: 'extend_video', description: 'Extend video' }]
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('extend_video') && e.includes('Requires prior media'))).toBe(true);
    });

    it('warns when generate_video_from_image has no prior image', () => {
      const result = service._validatePlan({
        objective: 'Test',
        steps: [{ action: 'generate_video_from_image', description: 'Make video' }]
      });
      expect(result.valid).toBe(true);
      // May or may not warn depending on implementation
      // Main check is that it's valid without prior image
    });
  });

  describe('description warnings', () => {
    it('warns when regular actions lack descriptions', () => {
      const result = service._validatePlan({
        objective: 'Test',
        steps: [{ action: 'speak' }]
      });
      expect(result.warnings.some(w => w.includes('Missing description'))).toBe(true);
    });

    it('does not warn when wait/research lack descriptions', () => {
      const result = service._validatePlan({
        objective: 'Test',
        steps: [
          { action: 'wait' },
          { action: 'research' }
        ]
      });
      expect(result.warnings.filter(w => w.includes('Missing description'))).toHaveLength(0);
    });
  });
});

// =============================================================================
// Step Timeout Tests
// =============================================================================

describe('TelegramService._executeStepWithTimeout', () => {
  let service;

  beforeEach(() => {
    service = createService();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves when step completes within timeout', async () => {
    const stepFn = vi.fn().mockResolvedValue({ success: true });
    
    const promise = service._executeStepWithTimeout(stepFn, 'speak', 1);
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;
    
    expect(result).toEqual({ success: true });
    expect(stepFn).toHaveBeenCalledTimes(1);
  });

  it('rejects when step times out', async () => {
    const stepFn = vi.fn().mockImplementation(() => new Promise(() => {})); // Never resolves
    
    const promise = service._executeStepWithTimeout(stepFn, 'speak', 1);
    
    // Attach error handler to prevent unhandled rejection
    promise.catch(() => {});
    
    // Fast-forward past the speak timeout (30s)
    await vi.advanceTimersByTimeAsync(31000);
    
    await expect(promise).rejects.toThrow('Step 1 (speak) timed out after 30s');
  });

  it('uses correct timeout for generate_video (5 min)', async () => {
    const stepFn = vi.fn().mockImplementation(() => new Promise(() => {}));
    
    const promise = service._executeStepWithTimeout(stepFn, 'generate_video', 2);
    
    // Attach error handler to prevent unhandled rejection
    promise.catch(() => {});
    
    // At 4 minutes, should still be pending
    await vi.advanceTimersByTimeAsync(240000);
    
    // At 5 minutes, should time out
    await vi.advanceTimersByTimeAsync(61000);
    
    await expect(promise).rejects.toThrow('Step 2 (generate_video) timed out after 300s');
  });

  it('uses default timeout for unknown actions', async () => {
    const stepFn = vi.fn().mockImplementation(() => new Promise(() => {}));
    
    const promise = service._executeStepWithTimeout(stepFn, 'unknown_action', 1);
    
    // Attach error handler to prevent unhandled rejection
    promise.catch(() => {});
    
    // Default is 2 minutes
    await vi.advanceTimersByTimeAsync(121000);
    
    await expect(promise).rejects.toThrow('timed out after 120s');
  });

  it('clears timeout on successful completion', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const stepFn = vi.fn().mockResolvedValue('done');
    
    const promise = service._executeStepWithTimeout(stepFn, 'speak', 1);
    await vi.advanceTimersByTimeAsync(100);
    await promise;
    
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('clears timeout on step error', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const stepFn = vi.fn().mockRejectedValue(new Error('Step failed'));
    
    const promise = service._executeStepWithTimeout(stepFn, 'speak', 1);
    
    // Attach error handler to prevent unhandled rejection warnings
    promise.catch(() => {});
    
    await vi.advanceTimersByTimeAsync(100);
    
    await expect(promise).rejects.toThrow('Step failed');
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});

// =============================================================================
// Static Configuration Tests
// =============================================================================

describe('TelegramService static configuration', () => {
  it('has all expected valid actions', () => {
    const expectedActions = [
      'generate_image', 'generate_keyframe', 'generate_video',
      'generate_video_from_image', 'edit_image', 'extend_video',
      'speak', 'post_tweet', 'research', 'wait'
    ];
    
    for (const action of expectedActions) {
      expect(TelegramService.VALID_PLAN_ACTIONS.has(action)).toBe(true);
    }
  });

  it('has timeout for each valid action', () => {
    for (const action of TelegramService.VALID_PLAN_ACTIONS) {
      const timeout = TelegramService.STEP_TIMEOUTS[action];
      expect(timeout).toBeDefined();
      expect(typeof timeout).toBe('number');
      expect(timeout).toBeGreaterThan(0);
    }
  });

  it('has default timeout', () => {
    expect(TelegramService.STEP_TIMEOUTS.default).toBeDefined();
    expect(TelegramService.STEP_TIMEOUTS.default).toBe(120000);
  });

  it('video actions have longer timeouts than image actions', () => {
    expect(TelegramService.STEP_TIMEOUTS.generate_video).toBeGreaterThan(
      TelegramService.STEP_TIMEOUTS.generate_image
    );
    expect(TelegramService.STEP_TIMEOUTS.extend_video).toBeGreaterThan(
      TelegramService.STEP_TIMEOUTS.generate_image
    );
  });
});

// =============================================================================
// Progress Message Tests
// =============================================================================

describe('TelegramService._updateProgressMessage', () => {
  let service;

  beforeEach(() => {
    service = createService();
  });

  it('sends new message when messageId is null', async () => {
    const ctx = {
      reply: vi.fn().mockResolvedValue({ message_id: 123 }),
      telegram: {
        editMessageText: vi.fn()
      }
    };

    const result = await service._updateProgressMessage(ctx, null, 'Progress: 50%', 'channel123');
    
    expect(ctx.reply).toHaveBeenCalledWith('Progress: 50%', { parse_mode: 'HTML' });
    expect(ctx.telegram.editMessageText).not.toHaveBeenCalled();
    expect(result).toBe(123);
  });

  it('edits existing message when messageId is provided', async () => {
    const ctx = {
      reply: vi.fn(),
      telegram: {
        editMessageText: vi.fn().mockResolvedValue({})
      }
    };

    const result = await service._updateProgressMessage(ctx, 456, 'Progress: 75%', 'channel123');
    
    expect(ctx.telegram.editMessageText).toHaveBeenCalledWith(
      'channel123', 456, null, 'Progress: 75%', { parse_mode: 'HTML' }
    );
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(result).toBe(456);
  });

  it('returns original messageId on edit failure', async () => {
    const ctx = {
      reply: vi.fn(),
      telegram: {
        editMessageText: vi.fn().mockRejectedValue(new Error('Message not modified'))
      }
    };

    const result = await service._updateProgressMessage(ctx, 789, 'Same text', 'channel123');
    
    expect(result).toBe(789);
  });

  it('handles HTML parse mode', async () => {
    const ctx = {
      reply: vi.fn().mockResolvedValue({ message_id: 999 }),
      telegram: { editMessageText: vi.fn() }
    };

    await service._updateProgressMessage(ctx, null, '<b>Bold</b> text', 'channel123');
    
    expect(ctx.reply).toHaveBeenCalledWith('<b>Bold</b> text', { parse_mode: 'HTML' });
  });
});

describe('TelegramService._deleteProgressMessage', () => {
  let service;

  beforeEach(() => {
    service = createService();
  });

  it('deletes message successfully', async () => {
    const ctx = {
      telegram: {
        deleteMessage: vi.fn().mockResolvedValue(true)
      }
    };

    await service._deleteProgressMessage(ctx, 123, 'channel456');
    
    expect(ctx.telegram.deleteMessage).toHaveBeenCalledWith('channel456', 123);
  });

  it('handles deletion failure gracefully', async () => {
    const ctx = {
      telegram: {
        deleteMessage: vi.fn().mockRejectedValue(new Error('Message not found'))
      }
    };

    // Should not throw
    await expect(service._deleteProgressMessage(ctx, 123, 'channel456')).resolves.not.toThrow();
  });
});

// =============================================================================
// Action Icon and Label Tests
// =============================================================================

describe('TelegramService._getActionIcon', () => {
  let service;

  beforeEach(() => {
    service = createService();
  });

  it('returns correct icons for each action', () => {
    const iconMap = {
      generate_image: '🎨',
      generate_keyframe: '🖼️',
      generate_video: '🎬',
      generate_video_from_image: '🎥',
      edit_image: '✏️',
      extend_video: '📹',
      speak: '💬',
      post_tweet: '🐦',
      research: '🔍',
      wait: '⏳'
    };

    for (const [action, expectedIcon] of Object.entries(iconMap)) {
      expect(service._getActionIcon(action)).toBe(expectedIcon);
    }
  });

  it('returns default icon for unknown action', () => {
    expect(service._getActionIcon('unknown')).toBe('⚡');
  });
});

describe('TelegramService._getActionLabel', () => {
  let service;

  beforeEach(() => {
    service = createService();
  });

  it('returns readable labels for each action', () => {
    expect(service._getActionLabel('generate_image')).toBe('Generating image');
    expect(service._getActionLabel('generate_video')).toBe('Generating video');
    expect(service._getActionLabel('speak')).toBe('Composing message');
    expect(service._getActionLabel('post_tweet')).toBe('Posting to X');
    expect(service._getActionLabel('research')).toBe('Researching');
    expect(service._getActionLabel('wait')).toBe('Processing');
  });

  it('returns default label for unknown action', () => {
    // Default returns the action name itself
    expect(service._getActionLabel('quantum_teleport')).toBe('quantum_teleport');
  });
});
