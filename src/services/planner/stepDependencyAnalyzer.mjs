/**
 * @file StepDependencyAnalyzer - Analyzes plan step dependencies for parallel execution
 * @description Identifies which steps can run in parallel based on data dependencies
 * @copyright Copyright (c) 2025 Zod Logics. All rights reserved.
 * 
 * This source code is licensed under a proprietary license.
 * See LICENSE file in the root directory for details.
 */

/**
 * @typedef {Object} Step
 * @property {string} action - The action type
 * @property {string} [description] - Description of the step
 * @property {Object} [params] - Parameters for the action
 */

/**
 * @typedef {Object} DependencyGraph
 * @property {Map<number, Set<number>>} dependencies - Map of step index to set of step indices it depends on
 * @property {Map<number, Set<number>>} dependents - Map of step index to set of step indices that depend on it
 */

/**
 * @typedef {Object} ExecutionLevel
 * @property {number} level - The level number (0 = no dependencies, can run first)
 * @property {number[]} stepIndices - Indices of steps that can run at this level
 */

/**
 * Actions that produce media output
 * @type {Set<string>}
 */
const MEDIA_PRODUCING_ACTIONS = new Set([
  'generate_image',
  'generate_keyframe',
  'generate_video',
  'generate_video_from_image',
  'edit_image'
]);

/**
 * Actions that consume media from previous steps
 * @type {Set<string>}
 */
const MEDIA_CONSUMING_ACTIONS = new Set([
  'edit_image',
  'generate_video_from_image',
  'post_tweet',
  'send_telegram',
  'post_to_channel'
]);

/**
 * Actions that are expensive and might benefit from confirmation
 * @type {Set<string>}
 */
const EXPENSIVE_ACTIONS = new Set([
  'generate_video',
  'generate_video_from_image',
  'generate_image',
  'generate_keyframe',
  'post_tweet'
]);

/**
 * Actions that can always run in parallel (no dependencies)
 * @type {Set<string>}
 */
const INDEPENDENT_ACTIONS = new Set([
  'think',
  'plan',
  'analyze'
]);

/**
 * StepDependencyAnalyzer analyzes plan steps to identify dependencies
 * and determine which steps can execute in parallel
 */
class StepDependencyAnalyzer {
  /**
   * @param {Object} [options]
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(options = {}) {
    this.logger = options.logger;
  }

  /**
   * Build a dependency graph for plan steps
   * @param {Step[]} steps - Array of plan steps
   * @returns {DependencyGraph} The dependency graph
   */
  buildDependencyGraph(steps) {
    const dependencies = new Map(); // stepIndex -> Set of step indices this depends on
    const dependents = new Map();   // stepIndex -> Set of step indices that depend on this

    // Initialize maps
    for (let i = 0; i < steps.length; i++) {
      dependencies.set(i, new Set());
      dependents.set(i, new Set());
    }

    // Track the last media-producing step
    let lastMediaProducerIndex = -1;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const action = step.action?.toLowerCase() || '';

      // Check if this step consumes media
      if (MEDIA_CONSUMING_ACTIONS.has(action)) {
        // Check if params explicitly reference a previous step's output
        if (step.params?.useMediaFrom !== undefined) {
          const sourceIndex = step.params.useMediaFrom;
          if (sourceIndex >= 0 && sourceIndex < i) {
            dependencies.get(i).add(sourceIndex);
            dependents.get(sourceIndex).add(i);
          }
        } else if (lastMediaProducerIndex >= 0) {
          // Default: depend on the last media-producing step
          dependencies.get(i).add(lastMediaProducerIndex);
          dependents.get(lastMediaProducerIndex).add(i);
        }
      }

      // Check for explicit dependencies in params
      if (step.params?.dependsOn) {
        const deps = Array.isArray(step.params.dependsOn) 
          ? step.params.dependsOn 
          : [step.params.dependsOn];
        
        for (const depIndex of deps) {
          if (depIndex >= 0 && depIndex < i) {
            dependencies.get(i).add(depIndex);
            dependents.get(depIndex).add(i);
          }
        }
      }

      // Update last media producer
      if (MEDIA_PRODUCING_ACTIONS.has(action)) {
        lastMediaProducerIndex = i;
      }

      // Sequential dependency for certain action patterns
      // e.g., edit_image should follow generate_image
      if (action === 'edit_image' && i > 0) {
        const prevAction = steps[i - 1]?.action?.toLowerCase();
        if (MEDIA_PRODUCING_ACTIONS.has(prevAction)) {
          dependencies.get(i).add(i - 1);
          dependents.get(i - 1).add(i);
        }
      }
    }

    return { dependencies, dependents };
  }

  /**
   * Calculate execution levels for parallel execution
   * Steps at the same level can run in parallel
   * @param {Step[]} steps - Array of plan steps
   * @returns {ExecutionLevel[]} Array of execution levels
   */
  calculateExecutionLevels(steps) {
    const graph = this.buildDependencyGraph(steps);
    const levels = [];
    const assigned = new Set();

    let currentLevel = 0;
    
    while (assigned.size < steps.length) {
      const levelSteps = [];

      for (let i = 0; i < steps.length; i++) {
        if (assigned.has(i)) continue;

        // Check if all dependencies are already assigned
        const deps = graph.dependencies.get(i);
        let allDepsAssigned = true;
        
        for (const depIndex of deps) {
          if (!assigned.has(depIndex)) {
            allDepsAssigned = false;
            break;
          }
        }

        if (allDepsAssigned) {
          levelSteps.push(i);
        }
      }

      if (levelSteps.length === 0) {
        // Circular dependency detected - break the cycle
        this.logger?.warn?.('[StepDependencyAnalyzer] Possible circular dependency detected');
        
        // Add remaining unassigned steps to a final level
        for (let i = 0; i < steps.length; i++) {
          if (!assigned.has(i)) {
            levelSteps.push(i);
          }
        }
      }

      // Assign all steps in this level
      for (const stepIndex of levelSteps) {
        assigned.add(stepIndex);
      }

      levels.push({
        level: currentLevel,
        stepIndices: levelSteps
      });

      currentLevel++;
    }

    return levels;
  }

  /**
   * Check if a step is expensive and might benefit from user confirmation
   * @param {Step} step - The step to check
   * @returns {boolean} True if the step is expensive
   */
  isExpensiveAction(step) {
    const action = step.action?.toLowerCase() || '';
    return EXPENSIVE_ACTIONS.has(action);
  }

  /**
   * Get all expensive steps from a plan
   * @param {Step[]} steps - Array of plan steps
   * @returns {Array<{index: number, step: Step}>} Array of expensive steps with their indices
   */
  getExpensiveSteps(steps) {
    return steps
      .map((step, index) => ({ index, step }))
      .filter(({ step }) => this.isExpensiveAction(step));
  }

  /**
   * Check if a step can run independently (no implicit dependencies)
   * @param {Step} step - The step to check
   * @returns {boolean} True if the step is independent
   */
  isIndependentAction(step) {
    const action = step.action?.toLowerCase() || '';
    return INDEPENDENT_ACTIONS.has(action);
  }

  /**
   * Check if a step produces media
   * @param {Step} step - The step to check
   * @returns {boolean} True if the step produces media
   */
  producesMedia(step) {
    const action = step.action?.toLowerCase() || '';
    return MEDIA_PRODUCING_ACTIONS.has(action);
  }

  /**
   * Check if a step consumes media
   * @param {Step} step - The step to check
   * @returns {boolean} True if the step consumes media
   */
  consumesMedia(step) {
    const action = step.action?.toLowerCase() || '';
    return MEDIA_CONSUMING_ACTIONS.has(action);
  }

  /**
   * Analyze a plan and return execution summary
   * @param {Step[]} steps - Array of plan steps
   * @returns {Object} Analysis summary
   */
  analyzePlan(steps) {
    const graph = this.buildDependencyGraph(steps);
    const levels = this.calculateExecutionLevels(steps);
    const expensiveSteps = this.getExpensiveSteps(steps);

    const parallelizableSteps = levels.filter(l => l.stepIndices.length > 1);
    const maxParallelism = Math.max(...levels.map(l => l.stepIndices.length), 0);

    return {
      totalSteps: steps.length,
      executionLevels: levels.length,
      maxParallelism,
      parallelizableLevels: parallelizableSteps.length,
      expensiveStepCount: expensiveSteps.length,
      expensiveStepIndices: expensiveSteps.map(s => s.index),
      levels,
      graph
    };
  }
}

export { 
  StepDependencyAnalyzer,
  MEDIA_PRODUCING_ACTIONS,
  MEDIA_CONSUMING_ACTIONS,
  EXPENSIVE_ACTIONS,
  INDEPENDENT_ACTIONS
};
export default StepDependencyAnalyzer;
