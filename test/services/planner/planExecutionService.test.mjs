/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/services/planner/planExecutionService.test.mjs
 * @description Unit tests for PlanExecutionService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlanExecutionService } from '../../../src/services/planner/planExecutionService.mjs';
import { ActionExecutor, ActionExecutorRegistry } from '../../../src/services/planner/actionExecutor.mjs';

// =============================================================================
// Plan Validation Tests
// =============================================================================

describe('PlanExecutionService.validatePlan', () => {
  let service;

  beforeEach(() => {
    service = new PlanExecutionService({ logger: null });
  });

  describe('basic validation', () => {
    it('returns invalid for null plan', () => {
      const result = service.validatePlan(null);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Plan is empty or undefined');
    });

    it('returns invalid for empty steps', () => {
      const result = service.validatePlan({ objective: 'Test', steps: [] });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Plan has no steps to execute');
    });

    it('warns when plan has no objective', () => {
      const result = service.validatePlan({
        steps: [{ action: 'speak', description: 'Hello' }]
      });
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('no objective'))).toBe(true);
    });

    it('warns when plan has too many steps', () => {
      const steps = Array(12).fill({ action: 'speak', description: 'Hello' });
      const result = service.validatePlan({ objective: 'Test', steps });
      expect(result.warnings.some(w => w.includes('12 steps'))).toBe(true);
    });
  });

  describe('action validation', () => {
    it('validates all supported actions', () => {
      for (const action of PlanExecutionService.VALID_PLAN_ACTIONS) {
        const result = service.validatePlan({
          objective: 'Test',
          steps: [
            { action: 'generate_image', description: 'First' },
            { action, description: 'Test' }
          ]
        });
        expect(result.errors.some(e => e.includes(`Unknown action "${action}"`))).toBe(false);
      }
    });

    it('rejects unknown actions', () => {
      const result = service.validatePlan({
        objective: 'Test',
        steps: [{ action: 'invalid_action', description: 'Bad' }]
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Unknown action'))).toBe(true);
    });

    it('errors when step has no action', () => {
      const result = service.validatePlan({
        objective: 'Test',
        steps: [{ description: 'No action' }]
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Missing action type'))).toBe(true);
    });
  });

  describe('dependency validation', () => {
    it('requires prior media for post_tweet', () => {
      const result = service.validatePlan({
        objective: 'Test',
        steps: [{ action: 'post_tweet', description: 'Tweet' }]
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('post_tweet') && e.includes('Requires prior media'))).toBe(true);
    });

    it('allows post_tweet after media generation', () => {
      const result = service.validatePlan({
        objective: 'Test',
        steps: [
          { action: 'generate_image', description: 'Make image' },
          { action: 'post_tweet', description: 'Share it' }
        ]
      });
      expect(result.valid).toBe(true);
    });

    it('allows post_tweet with explicit sourceMediaId', () => {
      const result = service.validatePlan({
        objective: 'Test',
        steps: [{ action: 'post_tweet', description: 'Tweet', sourceMediaId: 'abc123' }]
      });
      expect(result.valid).toBe(true);
    });
  });
});

// =============================================================================
// Action Icon and Label Tests
// =============================================================================

describe('PlanExecutionService icons and labels', () => {
  let service;

  beforeEach(() => {
    service = new PlanExecutionService({ logger: null });
  });

  it('returns correct icons for actions', () => {
    expect(service.getActionIcon('generate_image')).toBe('🎨');
    expect(service.getActionIcon('generate_video')).toBe('🎬');
    expect(service.getActionIcon('speak')).toBe('💬');
    expect(service.getActionIcon('post_tweet')).toBe('🐦');
  });

  it('returns default icon for unknown action', () => {
    expect(service.getActionIcon('unknown')).toBe('⚡');
  });

  it('returns correct labels for actions', () => {
    expect(service.getActionLabel('generate_image')).toBe('Generating image');
    expect(service.getActionLabel('speak')).toBe('Composing message');
    expect(service.getActionLabel('post_tweet')).toBe('Posting to X');
  });

  it('returns action name for unknown label', () => {
    expect(service.getActionLabel('unknown_action')).toBe('unknown_action');
  });
});

// =============================================================================
// Timeout Tests
// =============================================================================

describe('PlanExecutionService.executeWithTimeout', () => {
  let service;

  beforeEach(() => {
    service = new PlanExecutionService({ logger: null });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves when step completes in time', async () => {
    const stepFn = vi.fn().mockResolvedValue({ success: true });
    
    const promise = service.executeWithTimeout(stepFn, 5000, 1, 'test');
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;
    
    expect(result).toEqual({ success: true });
  });

  it('rejects when step times out', async () => {
    const stepFn = vi.fn().mockImplementation(() => new Promise(() => {}));
    
    const promise = service.executeWithTimeout(stepFn, 5000, 1, 'test');
    promise.catch(() => {}); // Prevent unhandled rejection
    
    await vi.advanceTimersByTimeAsync(6000);
    
    await expect(promise).rejects.toThrow('Step 1 (test) timed out after 5s');
  });

  it('clears timeout on success', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const stepFn = vi.fn().mockResolvedValue('done');
    
    const promise = service.executeWithTimeout(stepFn, 5000, 1, 'test');
    await vi.advanceTimersByTimeAsync(100);
    await promise;
    
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('clears timeout on error', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const stepFn = vi.fn().mockRejectedValue(new Error('Step failed'));
    
    const promise = service.executeWithTimeout(stepFn, 5000, 1, 'test');
    promise.catch(() => {});
    
    await vi.advanceTimersByTimeAsync(100);
    
    await expect(promise).rejects.toThrow('Step failed');
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});

// =============================================================================
// Plan Execution Tests
// =============================================================================

describe('PlanExecutionService.executePlan', () => {
  let service;
  let mockRegistry;
  let mockExecutor;

  beforeEach(() => {
    mockExecutor = {
      actionType: 'test_action',
      getTimeout: () => 5000,
      execute: vi.fn().mockResolvedValue({ success: true, action: 'test_action', stepNum: 1 })
    };

    mockRegistry = {
      get: vi.fn().mockReturnValue(mockExecutor)
    };

    service = new PlanExecutionService({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      executorRegistry: mockRegistry
    });
  });

  it('executes all steps in plan', async () => {
    const plan = {
      objective: 'Test',
      steps: [
        { action: 'test_action', description: 'Step 1' },
        { action: 'test_action', description: 'Step 2' }
      ]
    };

    const result = await service.executePlan(plan, {});

    expect(mockExecutor.execute).toHaveBeenCalledTimes(2);
    expect(result.totalSteps).toBe(2);
    expect(result.successCount).toBe(2);
    expect(result.success).toBe(true);
  });

  it('tracks execution duration', async () => {
    const plan = {
      objective: 'Test',
      steps: [{ action: 'test_action', description: 'Step 1' }]
    };

    const result = await service.executePlan(plan, {});

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.stepResults[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('calls onProgress callback', async () => {
    const onProgress = vi.fn();
    const plan = {
      objective: 'Test',
      steps: [{ action: 'test_action', description: 'Step 1' }]
    };

    await service.executePlan(plan, {}, { onProgress });

    expect(onProgress).toHaveBeenCalledWith(1, 1, 'test_action');
  });

  it('calls onStepComplete callback', async () => {
    const onStepComplete = vi.fn();
    const plan = {
      objective: 'Test',
      steps: [{ action: 'test_action', description: 'Step 1' }]
    };

    await service.executePlan(plan, {}, { onStepComplete });

    expect(onStepComplete).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      action: 'test_action',
      stepNum: 1
    }));
  });

  it('calls onError callback on step failure', async () => {
    mockExecutor.execute.mockRejectedValue(new Error('Test error'));
    const onError = vi.fn();
    const plan = {
      objective: 'Test',
      steps: [{ action: 'test_action', description: 'Step 1' }]
    };

    await service.executePlan(plan, {}, { onError });

    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      1,
      'test_action',
      false
    );
  });

  it('handles unknown actions gracefully', async () => {
    mockRegistry.get.mockReturnValue(null);
    const plan = {
      objective: 'Test',
      steps: [{ action: 'unknown_action', description: 'Step 1' }]
    };

    const result = await service.executePlan(plan, {});

    expect(result.stepResults[0].success).toBe(false);
    expect(result.stepResults[0].error).toBe('Unimplemented action');
  });

  it('tracks latestMediaId through execution', async () => {
    const executorWithMedia = {
      actionType: 'generate_image',
      getTimeout: () => 5000,
      execute: vi.fn().mockResolvedValue({
        success: true,
        action: 'generate_image',
        stepNum: 1,
        mediaId: 'generated123'
      })
    };
    mockRegistry.get.mockReturnValue(executorWithMedia);

    const plan = {
      objective: 'Test',
      steps: [{ action: 'generate_image', description: 'Make image' }]
    };

    const result = await service.executePlan(plan, {});

    expect(result.lastMediaId).toBe('generated123');
  });

  it('handles step execution errors gracefully', async () => {
    // Executor that always fails
    const failingExecutor = {
      actionType: 'generate_image',
      getTimeout: () => 5000,
      execute: vi.fn().mockRejectedValue(new Error('Generation failed'))
    };
    mockRegistry.get.mockReturnValue(failingExecutor);

    const plan = {
      objective: 'Test',
      steps: [
        { action: 'generate_image', description: 'Step 1' }
      ]
    };

    const result = await service.executePlan(plan, {});

    expect(result.stepResults[0].success).toBe(false);
    expect(result.stepResults[0].error).toBe('Generation failed');
    expect(result.successCount).toBe(0);
  });
});

// =============================================================================
// Plan Summary Logging Tests
// =============================================================================

describe('PlanExecutionService.logPlanSummary', () => {
  it('logs plan summary without errors', () => {
    const mockLogger = { info: vi.fn() };
    const service = new PlanExecutionService({ logger: mockLogger });

    const plan = {
      objective: 'Create and share content',
      steps: [
        { action: 'generate_image', description: 'Make an image' },
        { action: 'post_tweet', description: 'Share it' }
      ],
      confidence: 0.85
    };

    service.logPlanSummary(plan);

    expect(mockLogger.info).toHaveBeenCalled();
    const loggedString = mockLogger.info.mock.calls[0][0];
    expect(loggedString).toContain('AGENT PLAN SEQUENCE');
    expect(loggedString).toContain('Create and share');
    expect(loggedString).toContain('GENERATE_IMAGE');
    expect(loggedString).toContain('85%');
  });

  it('handles plan without objective', () => {
    const mockLogger = { info: vi.fn() };
    const service = new PlanExecutionService({ logger: mockLogger });

    const plan = {
      steps: [{ action: 'speak', description: 'Hello' }]
    };

    expect(() => service.logPlanSummary(plan)).not.toThrow();
  });

  it('handles plan without confidence', () => {
    const mockLogger = { info: vi.fn() };
    const service = new PlanExecutionService({ logger: mockLogger });

    const plan = {
      objective: 'Test',
      steps: [{ action: 'speak', description: 'Hello' }]
    };

    expect(() => service.logPlanSummary(plan)).not.toThrow();
  });
});

// =============================================================================
// Static Configuration Tests
// =============================================================================

describe('PlanExecutionService static configuration', () => {
  it('has all valid plan actions defined', () => {
    const expectedActions = [
      'generate_image', 'generate_keyframe', 'generate_video',
      'generate_video_from_image', 'edit_image', 'extend_video',
      'speak', 'post_tweet', 'research', 'wait'
    ];

    for (const action of expectedActions) {
      expect(PlanExecutionService.VALID_PLAN_ACTIONS.has(action)).toBe(true);
    }
  });

  it('has icons for all valid actions', () => {
    for (const action of PlanExecutionService.VALID_PLAN_ACTIONS) {
      expect(PlanExecutionService.ACTION_ICONS[action]).toBeDefined();
    }
  });

  it('has labels for all valid actions', () => {
    for (const action of PlanExecutionService.VALID_PLAN_ACTIONS) {
      expect(PlanExecutionService.ACTION_LABELS[action]).toBeDefined();
    }
  });
});
