/**
 * @file Test suite for StepDependencyAnalyzer
 * @description Tests for dependency analysis and parallel execution planning
 * @copyright Copyright (c) 2025 Zod Logics. All rights reserved.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import StepDependencyAnalyzer, { 
  MEDIA_PRODUCING_ACTIONS, 
  MEDIA_CONSUMING_ACTIONS,
  EXPENSIVE_ACTIONS 
} from '../../../src/services/planner/stepDependencyAnalyzer.mjs';

describe('StepDependencyAnalyzer', () => {
  let analyzer;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    analyzer = new StepDependencyAnalyzer({ logger: mockLogger });
  });

  describe('constructor', () => {
    it('should create instance with logger', () => {
      expect(analyzer.logger).toBe(mockLogger);
    });

    it('should create instance without logger', () => {
      const noLoggerAnalyzer = new StepDependencyAnalyzer();
      expect(noLoggerAnalyzer.logger).toBeUndefined();
    });
  });

  describe('buildDependencyGraph', () => {
    it('should create empty graph for no steps', () => {
      const graph = analyzer.buildDependencyGraph([]);
      expect(graph.dependencies.size).toBe(0);
      expect(graph.dependents.size).toBe(0);
    });

    it('should create independent graph for non-media steps', () => {
      const steps = [
        { action: 'think', description: 'Think about it' },
        { action: 'research', description: 'Research topic' }
      ];
      const graph = analyzer.buildDependencyGraph(steps);
      
      expect(graph.dependencies.get(0).size).toBe(0);
      expect(graph.dependencies.get(1).size).toBe(0);
    });

    it('should create dependency for media consuming after producing', () => {
      const steps = [
        { action: 'generate_image', description: 'Create image' },
        { action: 'post_tweet', description: 'Post to X' }
      ];
      const graph = analyzer.buildDependencyGraph(steps);
      
      // post_tweet (1) depends on generate_image (0)
      expect(graph.dependencies.get(1).has(0)).toBe(true);
      expect(graph.dependents.get(0).has(1)).toBe(true);
    });

    it('should track multiple media consumers', () => {
      const steps = [
        { action: 'generate_image', description: 'Create image' },
        { action: 'post_tweet', description: 'Post to X' },
        { action: 'send_telegram', description: 'Send to Telegram' }
      ];
      const graph = analyzer.buildDependencyGraph(steps);
      
      // Both consumers depend on the producer
      expect(graph.dependencies.get(1).has(0)).toBe(true);
      expect(graph.dependencies.get(2).has(0)).toBe(true);
    });

    it('should respect explicit useMediaFrom parameter', () => {
      const steps = [
        { action: 'generate_image', description: 'First image' },
        { action: 'generate_image', description: 'Second image' },
        { action: 'post_tweet', params: { useMediaFrom: 0 }, description: 'Post first image' }
      ];
      const graph = analyzer.buildDependencyGraph(steps);
      
      // post_tweet depends on step 0, not step 1
      expect(graph.dependencies.get(2).has(0)).toBe(true);
      expect(graph.dependencies.get(2).has(1)).toBe(false);
    });

    it('should respect explicit dependsOn parameter', () => {
      const steps = [
        { action: 'think', description: 'Plan' },
        { action: 'research', params: { dependsOn: [0] }, description: 'Research based on plan' }
      ];
      const graph = analyzer.buildDependencyGraph(steps);
      
      expect(graph.dependencies.get(1).has(0)).toBe(true);
    });

    it('should handle edit_image depending on previous image', () => {
      const steps = [
        { action: 'generate_image', description: 'Original' },
        { action: 'edit_image', description: 'Edit it' }
      ];
      const graph = analyzer.buildDependencyGraph(steps);
      
      expect(graph.dependencies.get(1).has(0)).toBe(true);
    });

    it('should chain media dependencies correctly', () => {
      const steps = [
        { action: 'generate_image', description: 'Base image' },
        { action: 'edit_image', description: 'Edit' },
        { action: 'generate_video_from_image', description: 'Video' },
        { action: 'post_tweet', description: 'Share' }
      ];
      const graph = analyzer.buildDependencyGraph(steps);
      
      // edit_image (1) depends on generate_image (0)
      expect(graph.dependencies.get(1).has(0)).toBe(true);
      // generate_video_from_image (2) depends on edit_image (1) - last media producer
      expect(graph.dependencies.get(2).has(1)).toBe(true);
      // post_tweet (3) depends on generate_video_from_image (2)
      expect(graph.dependencies.get(3).has(2)).toBe(true);
    });
  });

  describe('calculateExecutionLevels', () => {
    it('should return single level for independent steps', () => {
      const steps = [
        { action: 'think', description: 'Think 1' },
        { action: 'think', description: 'Think 2' },
        { action: 'think', description: 'Think 3' }
      ];
      const levels = analyzer.calculateExecutionLevels(steps);
      
      expect(levels.length).toBe(1);
      expect(levels[0].stepIndices).toEqual([0, 1, 2]);
    });

    it('should create sequential levels for dependent steps', () => {
      const steps = [
        { action: 'generate_image', description: 'Create image' },
        { action: 'post_tweet', description: 'Post to X' }
      ];
      const levels = analyzer.calculateExecutionLevels(steps);
      
      expect(levels.length).toBe(2);
      expect(levels[0].stepIndices).toEqual([0]);
      expect(levels[1].stepIndices).toEqual([1]);
    });

    it('should group parallel independent steps', () => {
      const steps = [
        { action: 'generate_image', description: 'Image' },
        { action: 'think', description: 'Think' },      // Independent
        { action: 'research', description: 'Research' }, // Independent
        { action: 'post_tweet', description: 'Post' }   // Depends on image
      ];
      const levels = analyzer.calculateExecutionLevels(steps);
      
      // Level 0: generate_image, think, research (all independent)
      expect(levels[0].stepIndices).toContain(0);
      expect(levels[0].stepIndices).toContain(1);
      expect(levels[0].stepIndices).toContain(2);
      // Level 1: post_tweet (depends on generate_image)
      expect(levels[1].stepIndices).toEqual([3]);
    });

    it('should handle complex dependency chains', () => {
      const steps = [
        { action: 'generate_keyframe', description: 'Keyframe' },  // 0: no deps
        { action: 'generate_video_from_image', description: 'Video' }, // 1: deps on 0
        { action: 'post_tweet', description: 'Post' }                  // 2: deps on 1
      ];
      const levels = analyzer.calculateExecutionLevels(steps);
      
      expect(levels.length).toBe(3);
      expect(levels[0].stepIndices).toEqual([0]);
      expect(levels[1].stepIndices).toEqual([1]);
      expect(levels[2].stepIndices).toEqual([2]);
    });
  });

  describe('isExpensiveAction', () => {
    it('should identify expensive actions', () => {
      expect(analyzer.isExpensiveAction({ action: 'generate_video' })).toBe(true);
      expect(analyzer.isExpensiveAction({ action: 'generate_video_from_image' })).toBe(true);
      expect(analyzer.isExpensiveAction({ action: 'generate_image' })).toBe(true);
      expect(analyzer.isExpensiveAction({ action: 'post_tweet' })).toBe(true);
    });

    it('should identify non-expensive actions', () => {
      expect(analyzer.isExpensiveAction({ action: 'think' })).toBe(false);
      expect(analyzer.isExpensiveAction({ action: 'research' })).toBe(false);
      expect(analyzer.isExpensiveAction({ action: 'speak' })).toBe(false);
    });

    it('should handle case insensitivity', () => {
      expect(analyzer.isExpensiveAction({ action: 'GENERATE_VIDEO' })).toBe(true);
      expect(analyzer.isExpensiveAction({ action: 'Generate_Image' })).toBe(true);
    });
  });

  describe('getExpensiveSteps', () => {
    it('should return all expensive steps with indices', () => {
      const steps = [
        { action: 'think' },
        { action: 'generate_image' },
        { action: 'speak' },
        { action: 'generate_video' }
      ];
      const expensive = analyzer.getExpensiveSteps(steps);
      
      expect(expensive.length).toBe(2);
      expect(expensive[0].index).toBe(1);
      expect(expensive[0].step.action).toBe('generate_image');
      expect(expensive[1].index).toBe(3);
      expect(expensive[1].step.action).toBe('generate_video');
    });

    it('should return empty array for no expensive steps', () => {
      const steps = [
        { action: 'think' },
        { action: 'research' }
      ];
      const expensive = analyzer.getExpensiveSteps(steps);
      expect(expensive.length).toBe(0);
    });
  });

  describe('isIndependentAction', () => {
    it('should identify independent actions', () => {
      expect(analyzer.isIndependentAction({ action: 'think' })).toBe(true);
      expect(analyzer.isIndependentAction({ action: 'plan' })).toBe(true);
      expect(analyzer.isIndependentAction({ action: 'analyze' })).toBe(true);
    });

    it('should identify dependent actions', () => {
      expect(analyzer.isIndependentAction({ action: 'generate_image' })).toBe(false);
      expect(analyzer.isIndependentAction({ action: 'post_tweet' })).toBe(false);
    });
  });

  describe('producesMedia', () => {
    it('should identify media-producing actions', () => {
      expect(analyzer.producesMedia({ action: 'generate_image' })).toBe(true);
      expect(analyzer.producesMedia({ action: 'generate_keyframe' })).toBe(true);
      expect(analyzer.producesMedia({ action: 'generate_video' })).toBe(true);
      expect(analyzer.producesMedia({ action: 'edit_image' })).toBe(true);
    });

    it('should identify non-media-producing actions', () => {
      expect(analyzer.producesMedia({ action: 'think' })).toBe(false);
      expect(analyzer.producesMedia({ action: 'post_tweet' })).toBe(false);
    });
  });

  describe('consumesMedia', () => {
    it('should identify media-consuming actions', () => {
      expect(analyzer.consumesMedia({ action: 'edit_image' })).toBe(true);
      expect(analyzer.consumesMedia({ action: 'post_tweet' })).toBe(true);
      expect(analyzer.consumesMedia({ action: 'generate_video_from_image' })).toBe(true);
    });

    it('should identify non-media-consuming actions', () => {
      expect(analyzer.consumesMedia({ action: 'generate_image' })).toBe(false);
      expect(analyzer.consumesMedia({ action: 'think' })).toBe(false);
    });
  });

  describe('analyzePlan', () => {
    it('should provide complete analysis summary', () => {
      const steps = [
        { action: 'generate_image' },
        { action: 'think' },
        { action: 'post_tweet' }
      ];
      const analysis = analyzer.analyzePlan(steps);
      
      expect(analysis.totalSteps).toBe(3);
      expect(analysis.executionLevels).toBeGreaterThan(0);
      expect(analysis.maxParallelism).toBeGreaterThanOrEqual(1);
      expect(analysis.expensiveStepCount).toBe(2); // generate_image, post_tweet
      expect(analysis.levels).toBeDefined();
      expect(analysis.graph).toBeDefined();
    });

    it('should detect parallelizable levels', () => {
      const steps = [
        { action: 'think' },
        { action: 'research' },
        { action: 'analyze' }
      ];
      const analysis = analyzer.analyzePlan(steps);
      
      expect(analysis.maxParallelism).toBe(3);
      expect(analysis.parallelizableLevels).toBe(1);
    });

    it('should handle empty plan', () => {
      const analysis = analyzer.analyzePlan([]);
      
      expect(analysis.totalSteps).toBe(0);
      expect(analysis.executionLevels).toBe(0);
      expect(analysis.maxParallelism).toBe(0);
    });
  });

  describe('exported constants', () => {
    it('should export MEDIA_PRODUCING_ACTIONS', () => {
      expect(MEDIA_PRODUCING_ACTIONS).toBeDefined();
      expect(MEDIA_PRODUCING_ACTIONS.has('generate_image')).toBe(true);
    });

    it('should export MEDIA_CONSUMING_ACTIONS', () => {
      expect(MEDIA_CONSUMING_ACTIONS).toBeDefined();
      expect(MEDIA_CONSUMING_ACTIONS.has('post_tweet')).toBe(true);
    });

    it('should export EXPENSIVE_ACTIONS', () => {
      expect(EXPENSIVE_ACTIONS).toBeDefined();
      expect(EXPENSIVE_ACTIONS.has('generate_video')).toBe(true);
    });
  });
});
