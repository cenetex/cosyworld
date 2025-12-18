/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file src/services/planner/planExecutionService.mjs
 * @description Service for executing agent plans with progress tracking, timeouts, and validation.
 *              Extracted from TelegramService as part of Phase 2 refactoring.
 *              Phase 3: Added parallel execution support and user confirmation.
 */

import { actionExecutorRegistry } from './actionExecutor.mjs';
import { StepDependencyAnalyzer, EXPENSIVE_ACTIONS } from './stepDependencyAnalyzer.mjs';

/**
 * @typedef {Object} PlanStep
 * @property {string} action - Action type
 * @property {string} [description] - Step description
 * @property {string} [sourceMediaId] - Source media ID for dependent actions
 */

/**
 * @typedef {Object} Plan
 * @property {string} [objective] - Plan objective
 * @property {PlanStep[]} steps - Plan steps
 * @property {number} [confidence] - Confidence score 0-1
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether plan is valid
 * @property {string[]} errors - Validation errors
 * @property {string[]} warnings - Validation warnings
 */

/**
 * @typedef {Object} ExecutionResult
 * @property {boolean} success - Overall success
 * @property {number} successCount - Number of successful steps
 * @property {number} totalSteps - Total number of steps
 * @property {number} durationMs - Total execution time
 * @property {Object[]} stepResults - Individual step results
 * @property {string} [lastMediaId] - Last generated media ID
 */

/**
 * Service for executing agent plans
 */
export class PlanExecutionService {
  /**
   * Valid plan actions
   */
  static VALID_PLAN_ACTIONS = new Set([
    'generate_image', 'generate_keyframe', 'generate_video', 
    'generate_video_from_image', 'generate_video_with_reference',
    'generate_video_interpolation', 'edit_image', 'extend_video',
    'speak', 'post_tweet', 'research', 'wait', 'react_to_message'
  ]);

  /**
   * Action icons for UI
   */
  static ACTION_ICONS = {
    generate_image: '🎨',
    generate_keyframe: '🖼️',
    generate_video: '🎬',
    generate_video_from_image: '🎥',
    generate_video_with_reference: '🎭',
    generate_video_interpolation: '🔄',
    edit_image: '✏️',
    extend_video: '📹',
    speak: '💬',
    post_tweet: '🐦',
    research: '🔍',
    wait: '⏳',
    react_to_message: '👍'
  };

  /**
   * Action labels for UI
   */
  static ACTION_LABELS = {
    generate_image: 'Generating image',
    generate_keyframe: 'Creating keyframe',
    generate_video: 'Generating video',
    generate_video_from_image: 'Creating video from image',
    generate_video_with_reference: 'Creating video with reference',
    generate_video_interpolation: 'Creating video interpolation',
    edit_image: 'Editing image',
    extend_video: 'Extending video',
    speak: 'Composing message',
    post_tweet: 'Posting to X',
    research: 'Researching',
    wait: 'Processing',
    react_to_message: 'Reacting to message'
  };

  /**
   * @param {Object} options
   * @param {Object} options.logger - Logger instance
   * @param {Object} [options.executorRegistry] - Custom executor registry
   * @param {boolean} [options.enableParallelExecution=false] - Enable parallel step execution
   * @param {Function} [options.confirmationHandler] - Handler for user confirmations
   */
  constructor({ logger, executorRegistry = null, enableParallelExecution = false, confirmationHandler = null } = {}) {
    this.logger = logger;
    this.executorRegistry = executorRegistry || actionExecutorRegistry;
    this.enableParallelExecution = enableParallelExecution;
    this.confirmationHandler = confirmationHandler;
    this.dependencyAnalyzer = new StepDependencyAnalyzer({ logger });
  }

  /**
   * Validate a plan before execution
   * @param {Plan} plan - The plan to validate
   * @returns {ValidationResult}
   */
  validatePlan(plan) {
    const errors = [];
    const warnings = [];
    
    if (!plan) {
      errors.push('Plan is empty or undefined');
      return { valid: false, errors, warnings };
    }
    
    if (!plan.objective || typeof plan.objective !== 'string') {
      warnings.push('Plan has no objective - execution may lack context');
    }
    
    if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
      errors.push('Plan has no steps to execute');
      return { valid: false, errors, warnings };
    }
    
    if (plan.steps.length > 10) {
      warnings.push(`Plan has ${plan.steps.length} steps - consider breaking into smaller plans`);
    }
    
    let hasMediaGeneration = false;
    
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const stepNum = i + 1;
      const action = step.action?.toLowerCase();
      
      if (!action) {
        errors.push(`Step ${stepNum}: Missing action type`);
        continue;
      }
      
      if (!PlanExecutionService.VALID_PLAN_ACTIONS.has(action)) {
        errors.push(`Step ${stepNum}: Unknown action "${action}"`);
        continue;
      }
      
      // Check for description (only required for media actions, not speak/react)
      const needsDescription = ['generate_image', 'generate_keyframe', 'generate_video', 'generate_video_from_image', 
                                'generate_video_with_reference', 'generate_video_interpolation', 'edit_image', 'extend_video'].includes(action);
      if (needsDescription && !step.description) {
        warnings.push(`Step ${stepNum} (${action}): Missing description`);
      }
      
      // Track media generation
      if (['generate_image', 'generate_keyframe', 'generate_video', 'generate_video_from_image'].includes(action)) {
        hasMediaGeneration = true;
      }
      
      // Check dependencies
      if (['edit_image', 'extend_video'].includes(action)) {
        if (!step.sourceMediaId && !hasMediaGeneration) {
          errors.push(`Step ${stepNum} (${action}): Requires prior media generation or sourceMediaId`);
        }
      }
      
      // Helper to detect placeholder values like "(will use generated image ID)" 
      const isPlaceholder = (val) => !val || typeof val !== 'string' || 
        val.includes('(') || val.includes('will use') || val.includes('generated') || 
        val.length < 4 || val.length > 20;
      
      // For post_tweet, missing media is a warning not an error
      // The executor can use latestMediaId from context (previously generated media)
      if (action === 'post_tweet') {
        const hasValidMediaId = !isPlaceholder(step.sourceMediaId) || !isPlaceholder(step.mediaId);
        if (!hasValidMediaId && !hasMediaGeneration && !step.useLatestMedia) {
          warnings.push(`Step ${stepNum} (post_tweet): No media in plan - will use most recent media if available`);
        }
      }
    }
    
    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Check if an action is expensive and may require confirmation
   * @param {string} action - Action type
   * @returns {boolean}
   */
  isExpensiveAction(action) {
    return EXPENSIVE_ACTIONS.has(action);
  }

  /**
   * Request confirmation for expensive actions
   * @param {Object} step - The step to confirm
   * @param {number} stepNum - Step number
   * @param {Object} context - Execution context
   * @returns {Promise<boolean>} True if confirmed, false to skip
   */
  async requestConfirmation(step, stepNum, context) {
    if (!this.confirmationHandler) {
      return true; // No handler, auto-confirm
    }

    try {
      return await this.confirmationHandler(step, stepNum, context);
    } catch (error) {
      this.logger?.warn?.(`[PlanExecutionService] Confirmation handler error: ${error.message}`);
      return true; // Default to proceeding on error
    }
  }

  /**
   * Get icon for action type
   * @param {string} action
   * @returns {string}
   */
  getActionIcon(action) {
    return PlanExecutionService.ACTION_ICONS[action] || '⚡';
  }

  /**
   * Get label for action type
   * @param {string} action
   * @returns {string}
   */
  getActionLabel(action) {
    return PlanExecutionService.ACTION_LABELS[action] || action;
  }

  /**
   * Execute a step with timeout
   * @param {Function} stepFn - The step function to execute
   * @param {number} timeoutMs - Timeout in milliseconds
   * @param {number} stepNum - Step number for logging
   * @param {string} action - Action name for error message
   * @returns {Promise<any>}
   */
  async executeWithTimeout(stepFn, timeoutMs, stepNum, action) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Step ${stepNum} (${action}) timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      
      stepFn()
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(err => {
          clearTimeout(timeoutId);
          reject(err);
        });
    });
  }

  /**
   * Execute a single step
   * @param {Object} step - The step to execute
   * @param {number} stepIndex - Step index (0-based)
   * @param {Object} context - Execution context
   * @param {Object} state - Shared execution state
   * @param {Object} callbacks - Callbacks for progress/completion
   * @returns {Promise<Object>} Step result
   */
  async executeStep(step, stepIndex, context, state, callbacks = {}) {
    const { onProgress, onStepComplete, onError, onSuccess, onFailure } = callbacks;
    const action = step.action?.toLowerCase();
    const stepNum = stepIndex + 1;
    const stepStartTime = Date.now();

    // Notify progress
    if (onProgress) {
      await onProgress(stepNum, state.totalSteps, action);
    }

    this.logger?.info?.(`[PlanExecutionService] 📍 Step ${stepNum}/${state.totalSteps}: ${(action || 'unknown').toUpperCase()}`);

    // Check for confirmation if this is an expensive action
    if (this.isExpensiveAction(action) && this.confirmationHandler) {
      const confirmed = await this.requestConfirmation(step, stepNum, context);
      if (!confirmed) {
        const result = { 
          success: true, 
          action, 
          stepNum, 
          skipped: true,
          reason: 'User declined confirmation',
          durationMs: Date.now() - stepStartTime 
        };
        if (onStepComplete) await onStepComplete(result);
        return result;
      }
    }

    // Get executor for this action
    const executor = this.executorRegistry.get(action);
    if (!executor) {
      this.logger?.warn?.(`[PlanExecutionService] No executor for action: ${action}`);
      const result = { success: false, action, stepNum, error: 'Unimplemented action' };
      if (onStepComplete) await onStepComplete(result);
      if (onFailure) await onFailure(result, step, stepNum);
      return result;
    }

    // Build execution context for executor
    const executorContext = {
      ...context,
      stepNum,
      latestMediaId: state.latestMediaId,
      generationFailed: state.generationFailed,
      logger: this.logger
    };

    try {
      // Execute with timeout
      const result = await this.executeWithTimeout(
        () => executor.execute(step, executorContext),
        executor.getTimeout(),
        stepNum,
        action
      );

      result.durationMs = Date.now() - stepStartTime;

      // Update state based on result
      if (result.success) {
        if (result.mediaId) {
          state.latestMediaId = result.mediaId;
          state.generationFailed = false;
          this.logger?.info?.(`[PlanExecutionService] Step ${stepNum} produced mediaId: ${result.mediaId}`);
        }
        if (onSuccess) await onSuccess(result, step, stepNum);
      } else {
        if (['generate_image', 'generate_keyframe', 'generate_video', 'generate_video_from_image'].includes(action)) {
          state.generationFailed = true;
        }
        if (onFailure) await onFailure(result, step, stepNum);
      }

      if (onStepComplete) await onStepComplete(result);
      return result;

    } catch (error) {
      const isTimeout = error.message?.includes('timed out');
      this.logger?.error?.(`[PlanExecutionService] Step ${stepNum} failed:`, error.message);

      const result = {
        success: false,
        action,
        stepNum,
        error: error.message,
        durationMs: Date.now() - stepStartTime
      };

      if (['generate_image', 'generate_keyframe', 'generate_video', 'generate_video_from_image'].includes(action)) {
        state.generationFailed = true;
      }

      if (onError) await onError(error, stepNum, action, isTimeout);
      if (onFailure) await onFailure(result, step, stepNum);
      if (onStepComplete) await onStepComplete(result);
      
      return result;
    }
  }

  /**
   * Execute steps in parallel at a given execution level
   * @param {Object[]} steps - Steps to execute (with original indices)
   * @param {Object} context - Execution context
   * @param {Object} state - Shared execution state
   * @param {Object} callbacks - Callbacks
   * @returns {Promise<Object[]>} Array of step results
   */
  async executeParallelLevel(steps, context, state, callbacks) {
    this.logger?.info?.(`[PlanExecutionService] Executing ${steps.length} steps in parallel`);

    const promises = steps.map(({ step, index }) => 
      this.executeStep(step, index, context, state, callbacks)
    );

    return Promise.all(promises);
  }

  /**
   * Execute a plan with parallel execution (respecting dependencies)
   * @param {Plan} plan - The plan to execute
   * @param {Object} context - Execution context
   * @param {Object} options - Execution options
   * @returns {Promise<ExecutionResult>}
   */
  async executePlanParallel(plan, context, options = {}) {
    const startTime = Date.now();
    const stepResults = [];
    const totalSteps = plan.steps?.length || 0;

    // Analyze dependencies
    const analysis = this.dependencyAnalyzer.analyzePlan(plan.steps);
    
    this.logger?.info?.(`[PlanExecutionService] Parallel execution: ${analysis.executionLevels} levels, max parallelism: ${analysis.maxParallelism}`);

    // Create shared state
    const state = {
      latestMediaId: null,
      generationFailed: false,
      totalSteps,
      mediaByStep: new Map() // Track media produced by each step
    };

    // Execute each level
    for (const level of analysis.levels) {
      const stepsToExecute = level.stepIndices.map(index => ({
        step: plan.steps[index],
        index
      }));

      if (stepsToExecute.length === 1) {
        // Single step, execute normally
        const result = await this.executeStep(
          stepsToExecute[0].step,
          stepsToExecute[0].index,
          context,
          state,
          options
        );
        stepResults[stepsToExecute[0].index] = result;
        
        // Track media
        if (result.mediaId) {
          state.mediaByStep.set(stepsToExecute[0].index, result.mediaId);
        }
      } else {
        // Multiple steps, execute in parallel
        const results = await this.executeParallelLevel(stepsToExecute, context, state, options);
        
        // Store results at correct indices
        for (let i = 0; i < stepsToExecute.length; i++) {
          const idx = stepsToExecute[i].index;
          stepResults[idx] = results[i];
          
          if (results[i].mediaId) {
            state.mediaByStep.set(idx, results[i].mediaId);
          }
        }
      }
    }

    const totalDuration = Date.now() - startTime;
    const successCount = stepResults.filter(r => r?.success).length;

    this.logger?.info?.(`[PlanExecutionService] Parallel plan complete: ${successCount}/${totalSteps} steps in ${Math.round(totalDuration / 1000)}s`);

    return {
      success: successCount === totalSteps,
      successCount,
      totalSteps,
      durationMs: totalDuration,
      stepResults,
      lastMediaId: state.latestMediaId,
      parallelExecution: true,
      executionLevels: analysis.executionLevels
    };
  }

  /**
   * Execute a plan
   * @param {Plan} plan - The plan to execute
   * @param {Object} context - Execution context
   * @param {Object} context.ctx - Telegram context
   * @param {string} context.channelId - Channel ID
   * @param {string} context.userId - User ID
   * @param {string} context.username - Username
   * @param {string} context.conversationContext - Conversation context
   * @param {Object} context.services - Service dependencies
   * @param {Object} [options] - Execution options
   * @param {Function} [options.onProgress] - Progress callback (stepNum, totalSteps, action)
   * @param {Function} [options.onStepComplete] - Step complete callback (result)
   * @param {Function} [options.onError] - Error callback (error, stepNum, action)
   * @param {Function} [options.onSuccess] - Success callback (result, step, stepNum)
   * @param {Function} [options.onFailure] - Failure callback (result, step, stepNum)
   * @param {boolean} [options.parallel] - Override parallel execution setting
   * @returns {Promise<ExecutionResult>}
   */
  async executePlan(plan, context, options = {}) {
    const totalSteps = plan.steps?.length || 0;
    
    // Check if parallel execution should be used
    const useParallel = options.parallel !== undefined 
      ? options.parallel 
      : this.enableParallelExecution;

    if (useParallel && totalSteps > 1) {
      return this.executePlanParallel(plan, context, options);
    }

    // Sequential execution (original behavior with new executeStep method)
    const startTime = Date.now();
    const stepResults = [];

    // Create shared state
    const state = {
      latestMediaId: null,
      generationFailed: false,
      totalSteps
    };

    this.logger?.info?.(`[PlanExecutionService] Starting sequential plan execution with ${totalSteps} steps`);

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const result = await this.executeStep(step, i, context, state, options);
      stepResults.push(result);
    }

    const totalDuration = Date.now() - startTime;
    const successCount = stepResults.filter(r => r.success).length;

    this.logger?.info?.(`[PlanExecutionService] Plan complete: ${successCount}/${totalSteps} steps in ${Math.round(totalDuration / 1000)}s`);

    return {
      success: successCount === totalSteps,
      successCount,
      totalSteps,
      durationMs: totalDuration,
      stepResults,
      lastMediaId: state.latestMediaId
    };
  }

  /**
   * Log a plan summary to console (for debugging)
   * @param {Plan} plan
   */
  logPlanSummary(plan) {
    const lines = [
      '\n╔══════════════════════════════════════════════════════════════╗',
      '║                    🧠 AGENT PLAN SEQUENCE                    ║',
      '╠══════════════════════════════════════════════════════════════╣'
    ];
    
    if (plan.objective) {
      lines.push(`║ Objective: ${plan.objective.substring(0, 50).padEnd(50)} ║`);
    }
    
    if (plan.steps?.length) {
      lines.push('╠──────────────────────────────────────────────────────────────╣');
      plan.steps.forEach((step, idx) => {
        const action = (step.action || 'step').toUpperCase().padEnd(20);
        const desc = (step.description || '').substring(0, 35).padEnd(35);
        lines.push(`║ ${(idx + 1).toString().padStart(2)}. [${action}] ${desc} ║`);
      });
    }
    
    if (typeof plan.confidence === 'number') {
      lines.push('╠──────────────────────────────────────────────────────────────╣');
      const confidenceBar = '█'.repeat(Math.round(plan.confidence * 20)).padEnd(20);
      lines.push(`║ Confidence: [${confidenceBar}] ${Math.round(plan.confidence * 100).toString().padStart(3)}%            ║`);
    }
    
    lines.push('╚══════════════════════════════════════════════════════════════╝\n');
    
    this.logger?.info?.(lines.join('\n'));
  }
}

export default PlanExecutionService;
