/**
 * @file Phase 3 Advanced Features Tests
 * Tests for StepDependencyAnalyzer and parallel plan execution
 * @copyright Copyright (c) 2025 Zod Logics. All rights reserved.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StepDependencyAnalyzer, MEDIA_PRODUCING_ACTIONS, MEDIA_CONSUMING_ACTIONS, EXPENSIVE_ACTIONS } from '../../../src/services/planner/stepDependencyAnalyzer.mjs';
import { PlanExecutionService } from '../../../src/services/planner/planExecutionService.mjs';

describe('StepDependencyAnalyzer', () => {
  let analyzer;

  beforeEach(() => {
    analyzer = new StepDependencyAnalyzer();
  });

  describe('buildDependencyGraph', () => {
    it('should create empty dependencies for single independent step', () => {
      const steps = [{ action: 'think', description: 'Think about something' }];
      const graph = analyzer.buildDependencyGraph(steps);
      
      expect(graph.dependencies.get(0).size).toBe(0);
      expect(graph.dependents.get(0).size).toBe(0);
    });

    it('should detect media consumer depending on media producer', () => {
      const steps = [
        { action: 'generate_image', description: 'Create image' },
        { action: 'post_tweet', description: 'Share on X' }
      ];
      const graph = analyzer.buildDependencyGraph(steps);
      
      expect(graph.dependencies.get(0).size).toBe(0);
      expect(graph.dependencies.get(1).has(0)).toBe(true);
    });

    it('should handle explicit dependsOn parameter', () => {
      const steps = [
        { action: 'speak', description: 'Say hello' },
        { action: 'generate_image', description: 'Create image' },
        { action: 'post_tweet', description: 'Post', params: { dependsOn: [0] } }
      ];
      const graph = analyzer.buildDependencyGraph(steps);
      
      expect(graph.dependencies.get(2).has(0)).toBe(true);
      expect(graph.dependencies.get(2).has(1)).toBe(true); // Also depends on media producer
    });

    it('should handle edit_image following generate_image', () => {
      const steps = [
        { action: 'generate_image', description: 'Create image' },
        { action: 'edit_image', description: 'Edit it' }
      ];
      const graph = analyzer.buildDependencyGraph(steps);
      
      expect(graph.dependencies.get(1).has(0)).toBe(true);
      expect(graph.dependents.get(0).has(1)).toBe(true);
    });

    it('should track useMediaFrom parameter', () => {
      const steps = [
        { action: 'generate_image', description: 'First image' },
        { action: 'generate_image', description: 'Second image' },
        { action: 'post_tweet', description: 'Post first', params: { useMediaFrom: 0 } }
      ];
      const graph = analyzer.buildDependencyGraph(steps);
      
      expect(graph.dependencies.get(2).has(0)).toBe(true);
    });
  });

  describe('calculateExecutionLevels', () => {
    it('should put independent steps at level 0', () => {
      const steps = [
        { action: 'speak', description: 'Hello' },
        { action: 'think', description: 'Ponder' }
      ];
      const levels = analyzer.calculateExecutionLevels(steps);
      
      expect(levels).toHaveLength(1);
      expect(levels[0].level).toBe(0);
      expect(levels[0].stepIndices).toContain(0);
      expect(levels[0].stepIndices).toContain(1);
    });

    it('should separate dependent steps into different levels', () => {
      const steps = [
        { action: 'generate_image', description: 'Create' },
        { action: 'post_tweet', description: 'Share' }
      ];
      const levels = analyzer.calculateExecutionLevels(steps);
      
      expect(levels).toHaveLength(2);
      expect(levels[0].stepIndices).toContain(0);
      expect(levels[1].stepIndices).toContain(1);
    });

    it('should handle complex dependency chain', () => {
      const steps = [
        { action: 'generate_keyframe', description: 'Create keyframe' },
        { action: 'generate_video_from_image', description: 'Animate' },
        { action: 'post_tweet', description: 'Share' }
      ];
      const levels = analyzer.calculateExecutionLevels(steps);
      
      expect(levels).toHaveLength(3);
      expect(levels[0].stepIndices).toEqual([0]);
      expect(levels[1].stepIndices).toEqual([1]);
      expect(levels[2].stepIndices).toEqual([2]);
    });

    it('should group parallel independent steps', () => {
      const steps = [
        { action: 'think', description: 'Step A' },
        { action: 'speak', description: 'Step B' },
        { action: 'research', description: 'Step C' }
      ];
      const levels = analyzer.calculateExecutionLevels(steps);
      
      expect(levels).toHaveLength(1);
      expect(levels[0].stepIndices).toHaveLength(3);
    });
  });

  describe('action classification', () => {
    it('should identify expensive actions', () => {
      expect(analyzer.isExpensiveAction({ action: 'generate_video' })).toBe(true);
      expect(analyzer.isExpensiveAction({ action: 'generate_image' })).toBe(true);
      expect(analyzer.isExpensiveAction({ action: 'post_tweet' })).toBe(true);
      expect(analyzer.isExpensiveAction({ action: 'speak' })).toBe(false);
      expect(analyzer.isExpensiveAction({ action: 'wait' })).toBe(false);
    });

    it('should identify media producing actions', () => {
      expect(analyzer.producesMedia({ action: 'generate_image' })).toBe(true);
      expect(analyzer.producesMedia({ action: 'generate_video' })).toBe(true);
      expect(analyzer.producesMedia({ action: 'speak' })).toBe(false);
    });

    it('should identify media consuming actions', () => {
      expect(analyzer.consumesMedia({ action: 'edit_image' })).toBe(true);
      expect(analyzer.consumesMedia({ action: 'post_tweet' })).toBe(true);
      expect(analyzer.consumesMedia({ action: 'speak' })).toBe(false);
    });

    it('should identify independent actions', () => {
      expect(analyzer.isIndependentAction({ action: 'think' })).toBe(true);
      expect(analyzer.isIndependentAction({ action: 'plan' })).toBe(true);
      expect(analyzer.isIndependentAction({ action: 'generate_image' })).toBe(false);
    });
  });

  describe('getExpensiveSteps', () => {
    it('should return expensive steps with indices', () => {
      const steps = [
        { action: 'speak', description: 'Hello' },
        { action: 'generate_image', description: 'Create' },
        { action: 'post_tweet', description: 'Share' }
      ];
      const expensive = analyzer.getExpensiveSteps(steps);
      
      expect(expensive).toHaveLength(2);
      expect(expensive[0].index).toBe(1);
      expect(expensive[1].index).toBe(2);
    });
  });

  describe('analyzePlan', () => {
    it('should provide comprehensive analysis', () => {
      const steps = [
        { action: 'generate_image', description: 'Create' },
        { action: 'generate_video_from_image', description: 'Animate' },
        { action: 'post_tweet', description: 'Share' }
      ];
      const analysis = analyzer.analyzePlan(steps);
      
      expect(analysis.totalSteps).toBe(3);
      expect(analysis.executionLevels).toBe(3);
      expect(analysis.expensiveStepCount).toBe(3); // All 3 are expensive
      expect(analysis.expensiveStepIndices).toContain(0);
      expect(analysis.expensiveStepIndices).toContain(1);
      expect(analysis.expensiveStepIndices).toContain(2);
    });

    it('should detect parallelization opportunities', () => {
      const steps = [
        { action: 'speak', description: 'A' },
        { action: 'think', description: 'B' },
        { action: 'research', description: 'C' }
      ];
      const analysis = analyzer.analyzePlan(steps);
      
      expect(analysis.maxParallelism).toBe(3);
      expect(analysis.parallelizableLevels).toBe(1);
    });
  });
});

describe('PlanExecutionService Phase 3', () => {
  let service;
  let mockLogger;
  let mockRegistry;
  let mockExecutor;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    mockExecutor = {
      execute: vi.fn().mockResolvedValue({ success: true, action: 'speak', stepNum: 1 }),
      getTimeout: vi.fn().mockReturnValue(30000)
    };

    mockRegistry = {
      get: vi.fn().mockReturnValue(mockExecutor)
    };

    service = new PlanExecutionService({
      logger: mockLogger,
      executorRegistry: mockRegistry
    });
  });

  describe('constructor options', () => {
    it('should accept enableParallelExecution option', () => {
      const parallelService = new PlanExecutionService({
        logger: mockLogger,
        enableParallelExecution: true
      });
      expect(parallelService.enableParallelExecution).toBe(true);
    });

    it('should accept confirmationHandler option', () => {
      const handler = vi.fn();
      const serviceWithConfirm = new PlanExecutionService({
        logger: mockLogger,
        confirmationHandler: handler
      });
      expect(serviceWithConfirm.confirmationHandler).toBe(handler);
    });

    it('should initialize dependency analyzer', () => {
      expect(service.dependencyAnalyzer).toBeInstanceOf(StepDependencyAnalyzer);
    });
  });

  describe('isExpensiveAction', () => {
    it('should identify expensive actions', () => {
      expect(service.isExpensiveAction('generate_video')).toBe(true);
      expect(service.isExpensiveAction('generate_image')).toBe(true);
      expect(service.isExpensiveAction('speak')).toBe(false);
    });
  });

  describe('requestConfirmation', () => {
    it('should return true when no handler configured', async () => {
      const result = await service.requestConfirmation({ action: 'generate_video' }, 1, {});
      expect(result).toBe(true);
    });

    it('should call handler when configured', async () => {
      const handler = vi.fn().mockResolvedValue(false);
      service.confirmationHandler = handler;
      
      const step = { action: 'generate_video' };
      const result = await service.requestConfirmation(step, 1, { userId: '123' });
      
      expect(handler).toHaveBeenCalledWith(step, 1, { userId: '123' });
      expect(result).toBe(false);
    });

    it('should return true on handler error', async () => {
      service.confirmationHandler = vi.fn().mockRejectedValue(new Error('Handler failed'));
      
      const result = await service.requestConfirmation({ action: 'generate_video' }, 1, {});
      expect(result).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('executeStep', () => {
    it('should call executor and return result', async () => {
      const step = { action: 'speak', description: 'Hello' };
      const context = { ctx: {}, services: {} };
      const state = { latestMediaId: null, generationFailed: false, totalSteps: 1 };
      
      const result = await service.executeStep(step, 0, context, state);
      
      expect(mockExecutor.execute).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should call onProgress callback', async () => {
      const onProgress = vi.fn();
      const step = { action: 'speak', description: 'Hello' };
      const context = { ctx: {}, services: {} };
      const state = { latestMediaId: null, generationFailed: false, totalSteps: 2 };
      
      await service.executeStep(step, 0, context, state, { onProgress });
      
      expect(onProgress).toHaveBeenCalledWith(1, 2, 'speak');
    });

    it('should call onSuccess on successful execution', async () => {
      const onSuccess = vi.fn();
      const step = { action: 'speak', description: 'Hello' };
      const context = { ctx: {}, services: {} };
      const state = { latestMediaId: null, generationFailed: false, totalSteps: 1 };
      
      await service.executeStep(step, 0, context, state, { onSuccess });
      
      expect(onSuccess).toHaveBeenCalled();
    });

    it('should call onFailure on failed execution', async () => {
      mockExecutor.execute.mockResolvedValue({ success: false, action: 'speak', stepNum: 1, error: 'Failed' });
      const onFailure = vi.fn();
      const step = { action: 'speak', description: 'Hello' };
      const context = { ctx: {}, services: {} };
      const state = { latestMediaId: null, generationFailed: false, totalSteps: 1 };
      
      await service.executeStep(step, 0, context, state, { onFailure });
      
      expect(onFailure).toHaveBeenCalled();
    });

    it('should skip step when confirmation declined', async () => {
      service.confirmationHandler = vi.fn().mockResolvedValue(false);
      const step = { action: 'generate_video', description: 'Create video' };
      const context = { ctx: {}, services: {} };
      const state = { latestMediaId: null, generationFailed: false, totalSteps: 1 };
      
      const result = await service.executeStep(step, 0, context, state);
      
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('User declined confirmation');
      expect(mockExecutor.execute).not.toHaveBeenCalled();
    });

    it('should update state.latestMediaId when step produces media', async () => {
      mockExecutor.execute.mockResolvedValue({ 
        success: true, 
        action: 'generate_image', 
        stepNum: 1,
        mediaId: 'media-123'
      });
      const step = { action: 'generate_image', description: 'Create image' };
      const context = { ctx: {}, services: {} };
      const state = { latestMediaId: null, generationFailed: false, totalSteps: 1 };
      
      await service.executeStep(step, 0, context, state);
      
      expect(state.latestMediaId).toBe('media-123');
    });

    it('should set generationFailed on media generation failure', async () => {
      mockExecutor.execute.mockResolvedValue({ 
        success: false, 
        action: 'generate_image', 
        stepNum: 1,
        error: 'Failed to generate'
      });
      mockRegistry.get.mockReturnValue({
        ...mockExecutor,
        execute: mockExecutor.execute
      });
      
      const step = { action: 'generate_image', description: 'Create image' };
      const context = { ctx: {}, services: {} };
      const state = { latestMediaId: null, generationFailed: false, totalSteps: 1 };
      
      await service.executeStep(step, 0, context, state);
      
      expect(state.generationFailed).toBe(true);
    });
  });

  describe('executePlan with parallel option', () => {
    it('should use sequential execution by default', async () => {
      const plan = {
        objective: 'Test',
        steps: [
          { action: 'speak', description: 'Hello' },
          { action: 'speak', description: 'World' }
        ]
      };
      const context = { ctx: {}, services: {} };
      
      const result = await service.executePlan(plan, context);
      
      expect(result.parallelExecution).toBeUndefined();
    });

    it('should use parallel execution when enabled in constructor', async () => {
      const parallelService = new PlanExecutionService({
        logger: mockLogger,
        executorRegistry: mockRegistry,
        enableParallelExecution: true
      });
      
      const plan = {
        objective: 'Test',
        steps: [
          { action: 'speak', description: 'Hello' },
          { action: 'speak', description: 'World' }
        ]
      };
      const context = { ctx: {}, services: {} };
      
      const result = await parallelService.executePlan(plan, context);
      
      expect(result.parallelExecution).toBe(true);
    });

    it('should override parallel setting with options.parallel', async () => {
      const plan = {
        objective: 'Test',
        steps: [
          { action: 'speak', description: 'Hello' },
          { action: 'speak', description: 'World' }
        ]
      };
      const context = { ctx: {}, services: {} };
      
      const result = await service.executePlan(plan, context, { parallel: true });
      
      expect(result.parallelExecution).toBe(true);
    });
  });

  describe('executePlanParallel', () => {
    it('should execute independent steps in parallel', async () => {
      const executionOrder = [];
      mockExecutor.execute.mockImplementation(async (step) => {
        executionOrder.push(step.description);
        return { success: true, action: step.action, stepNum: 1 };
      });

      const plan = {
        objective: 'Test parallel',
        steps: [
          { action: 'speak', description: 'A' },
          { action: 'speak', description: 'B' }
        ]
      };
      const context = { ctx: {}, services: {} };
      
      const result = await service.executePlanParallel(plan, context);
      
      expect(result.success).toBe(true);
      expect(result.parallelExecution).toBe(true);
      expect(result.executionLevels).toBe(1); // Both should run at same level
    });

    it('should execute dependent steps sequentially', async () => {
      const executionOrder = [];
      mockExecutor.execute.mockImplementation(async (step, ctx) => {
        executionOrder.push(step.action);
        if (step.action === 'generate_image') {
          return { success: true, action: step.action, stepNum: ctx.stepNum, mediaId: 'img-1' };
        }
        return { success: true, action: step.action, stepNum: ctx.stepNum };
      });

      const plan = {
        objective: 'Test sequential dependency',
        steps: [
          { action: 'generate_image', description: 'Create' },
          { action: 'post_tweet', description: 'Share' }
        ]
      };
      const context = { ctx: {}, services: {} };
      
      const result = await service.executePlanParallel(plan, context);
      
      expect(result.executionLevels).toBe(2); // Different levels
      expect(executionOrder[0]).toBe('generate_image');
      expect(executionOrder[1]).toBe('post_tweet');
    });

    it('should track media produced by each step', async () => {
      mockExecutor.execute.mockImplementation(async (step, ctx) => {
        if (step.action === 'generate_image') {
          return { success: true, action: step.action, stepNum: ctx.stepNum, mediaId: `media-${ctx.stepNum}` };
        }
        return { success: true, action: step.action, stepNum: ctx.stepNum };
      });

      const plan = {
        objective: 'Test media tracking',
        steps: [
          { action: 'generate_image', description: 'Create' },
          { action: 'speak', description: 'Speak' }
        ]
      };
      const context = { ctx: {}, services: {} };
      
      const result = await service.executePlanParallel(plan, context);
      
      expect(result.lastMediaId).toBeDefined();
    });
  });

  describe('validation post_tweet warning', () => {
    it('should produce warning not error for post_tweet without prior media', () => {
      const plan = {
        objective: 'Post existing media',
        steps: [
          { action: 'speak', description: 'Hello' },
          { action: 'post_tweet', description: 'Share' }
        ]
      };
      
      const result = service.validatePlan(plan);
      
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('No media in plan');
    });

    it('should not warn when useLatestMedia is set', () => {
      const plan = {
        objective: 'Post existing media',
        steps: [
          { action: 'post_tweet', description: 'Share', useLatestMedia: true }
        ]
      };
      
      const result = service.validatePlan(plan);
      
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('should not warn when sourceMediaId is provided', () => {
      const plan = {
        objective: 'Post specific media',
        steps: [
          { action: 'post_tweet', description: 'Share', sourceMediaId: 'media-123' }
        ]
      };
      
      const result = service.validatePlan(plan);
      
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('should not warn when media generation precedes post_tweet', () => {
      const plan = {
        objective: 'Generate and post',
        steps: [
          { action: 'generate_image', description: 'Create' },
          { action: 'post_tweet', description: 'Share' }
        ]
      };
      
      const result = service.validatePlan(plan);
      
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });
  });
});

describe('Exported constants', () => {
  it('should export MEDIA_PRODUCING_ACTIONS', () => {
    expect(MEDIA_PRODUCING_ACTIONS).toBeInstanceOf(Set);
    expect(MEDIA_PRODUCING_ACTIONS.has('generate_image')).toBe(true);
    expect(MEDIA_PRODUCING_ACTIONS.has('generate_video')).toBe(true);
  });

  it('should export MEDIA_CONSUMING_ACTIONS', () => {
    expect(MEDIA_CONSUMING_ACTIONS).toBeInstanceOf(Set);
    expect(MEDIA_CONSUMING_ACTIONS.has('edit_image')).toBe(true);
    expect(MEDIA_CONSUMING_ACTIONS.has('post_tweet')).toBe(true);
  });

  it('should export EXPENSIVE_ACTIONS', () => {
    expect(EXPENSIVE_ACTIONS).toBeInstanceOf(Set);
    expect(EXPENSIVE_ACTIONS.has('generate_video')).toBe(true);
  });
});
