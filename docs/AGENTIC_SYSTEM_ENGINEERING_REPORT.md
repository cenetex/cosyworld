# Agentic System Engineering Report

**Date:** November 25, 2025  
**Author:** Engineering Analysis  
**Version:** 1.2 (Updated with Phase 2 Implementation)  
**Scope:** Telegram Bot Agent Planning & Execution System

---

## Implementation Status

### Phase 1: Stabilization ✅ COMPLETE

| Task | Status | Implementation |
|------|--------|----------------|
| Progress feedback during execution | ✅ Complete | `_updateProgressMessage()`, `_deleteProgressMessage()` with step counter and action icons |
| Step timeout with cancellation | ✅ Complete | `_executeStepWithTimeout()` with per-action configurable timeouts |
| Plan validation before execution | ✅ Complete | `_validatePlan()` checks action validity, dependencies, and step requirements |
| Action icons and labels | ✅ Complete | `_getActionIcon()`, `_getActionLabel()` for user-friendly progress display |
| Execution results tracking | ✅ Complete | `executionResults[]` array with success/failure, duration, and error tracking |

**Key Additions:**
- `VALID_PLAN_ACTIONS` - Set of valid action types
- `STEP_TIMEOUTS` - Per-action timeout configuration (30s to 5min based on action type)
- `_validatePlan()` - Pre-execution validation with errors and warnings
- `_executeStepWithTimeout()` - Promise-based timeout wrapper
- `_updateProgressMessage()` / `_deleteProgressMessage()` - Progress UI management
- `_getActionIcon()` / `_getActionLabel()` - Human-readable action display

**Phase 1 Completion Date:** November 25, 2025

---

### Phase 2: Refactoring ✅ COMPLETE

| Task | Status | Implementation |
|------|--------|----------------|
| ActionExecutor base class | ✅ Complete | `src/services/planner/actionExecutor.mjs` with abstract `execute()` method |
| Concrete executors | ✅ Complete | 10 executor classes (GenerateImage, GenerateVideo, Speak, PostTweet, etc.) |
| ActionExecutorRegistry | ✅ Complete | Registry pattern with `register()`, `get()`, `isSupported()` methods |
| PlanExecutionService | ✅ Complete | `src/services/planner/planExecutionService.mjs` with callback-based execution |
| TelegramService integration | ✅ Complete | `_executePlanWithService()` with feature flag `USE_PLAN_EXECUTION_SERVICE` |
| Unit test coverage | ✅ Complete | 102 tests across 3 test files (all passing) |

**New Files Created:**
- `src/services/planner/actionExecutor.mjs` - ActionExecutor pattern implementation
- `src/services/planner/planExecutionService.mjs` - Refactored plan execution service
- `test/services/planner/actionExecutor.test.mjs` - 32 tests for executors
- `test/services/planner/planExecutionService.test.mjs` - 32 tests for service
- `test/services/social/telegramPlanExecution.test.mjs` - 38 tests for Phase 1 features

**Architecture Benefits:**
- **Separation of Concerns**: Each action type has its own executor class
- **Testability**: Executors can be unit tested in isolation
- **Extensibility**: New actions can be added by creating new executor classes
- **Maintainability**: Plan execution logic is centralized in PlanExecutionService
- **Gradual Rollout**: Feature flag allows toggling between implementations

**Phase 2 Completion Date:** November 25, 2025

---

## Executive Summary

The CosyWorld Telegram bot implements an **agentic planning system** that allows the AI to reason about multi-step tasks, plan sequences of actions, and execute them autonomously. This report analyzes the current implementation, identifies architectural weaknesses, and proposes concrete improvements for enhanced reliability, scalability, and user experience.

---

## 1. Current Architecture Overview

### 1.1 Core Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          TELEGRAM SERVICE                                    │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────────────────┐  │
│  │  Message Handler │→│  AI Chat Engine  │→│  Tool Call Router          │  │
│  │  (debounce)      │  │  (system prompt) │  │  (plan_actions, generate) │  │
│  └─────────────────┘  └──────────────────┘  └────────────────────────────┘  │
│                                                        ↓                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                      PLAN EXECUTION ENGINE                               ││
│  │  ┌──────────────┐  ┌──────────────────┐  ┌─────────────────────────┐   ││
│  │  │ Plan Parser  │→│ Step Sequencer   │→│ Action Executors        │   ││
│  │  │ (objective,  │  │ (latestMediaId)  │  │ (image, video, tweet)  │   ││
│  │  │  steps[])    │  │                  │  │                         │   ││
│  │  └──────────────┘  └──────────────────┘  └─────────────────────────┘   ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                        ↓                     │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────────────────┐  │
│  │  Plan Storage   │  │  Media Registry  │  │  External Services        │  │
│  │  (MongoDB)      │  │  (recent media)  │  │  (Gemini, Veo, X/Twitter) │  │
│  └─────────────────┘  └──────────────────┘  └────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Supported Actions

| Action | Description | State Passed |
|--------|-------------|--------------|
| `generate_image` | Generate image via Gemini | `latestGeneratedMediaId` |
| `generate_keyframe` | Generate image marked as keyframe | `latestGeneratedMediaId` |
| `generate_video` | Generate video via Veo | `latestGeneratedMediaId` |
| `generate_video_from_image` | Video from recent image | Uses `sourceMediaId` or `latestGeneratedMediaId` |
| `edit_image` | Edit existing image | Uses `sourceMediaId` or `latestGeneratedMediaId` |
| `extend_video` | Extend existing video | Uses `sourceMediaId` or `latestGeneratedMediaId` |
| `speak` | Generate and send text response | None |
| `post_tweet` | Post media to X/Twitter | Uses `latestGeneratedMediaId` |
| `research` | Acknowledge research intent | None |
| `wait` | Acknowledge processing | None |

### 1.3 Data Flow

```
User Message
     ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 1. AI generates response with tool_calls                            │
│    - plan_actions: { objective, steps[], confidence }               │
│    - OR direct tools: generate_image, post_tweet, etc.              │
└─────────────────────────────────────────────────────────────────────┘
     ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 2. Tool call router prioritizes plan_actions over direct tools      │
│    - Filters out duplicate generation calls                         │
│    - Executes plan steps sequentially                               │
└─────────────────────────────────────────────────────────────────────┘
     ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 3. Each step executed with state passing                            │
│    - latestGeneratedMediaId propagated between steps                │
│    - generationFailed flag tracked for conditional execution        │
└─────────────────────────────────────────────────────────────────────┘
     ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 4. Plan persisted to MongoDB for context in future conversations    │
│    - TTL: 72 hours in-memory, 3 days in DB                          │
│    - Used to build planning context for AI                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Current Strengths

### 2.1 Planning Architecture ✅
- **Explicit planning tool** (`plan_actions`) allows AI to reason about multi-step tasks
- **State passing** between steps via `latestGeneratedMediaId`
- **Conditional execution** - skips tweet if media generation failed
- **Plan persistence** - recent plans inform future AI decisions

### 2.2 Media Pipeline ✅
- **Keyframe support** for video generation (image → video workflow)
- **Multiple action types** including edit, extend, and video-from-image
- **Media registry** tracks recent media for easy reference

### 2.3 Tool Deduplication ✅
- **Plan priority** - when `plan_actions` present, filters out duplicate direct tools
- **Unique tool call filtering** prevents redundant executions

---

## 3. Identified Weaknesses & Issues

### 3.1 Critical Issues

#### 3.1.1 **No Rollback or Compensation on Failure**
- **Location:** `executePlanActions()`
- **Issue:** If step 3 of a 5-step plan fails, steps 1-2 remain executed with no rollback
- **Impact:** Partial execution leaves inconsistent state (e.g., image generated but not tweeted)
- **Example:**
  ```
  Plan: generate_image → generate_video_from_image → post_tweet
  Step 2 fails → Image exists, no video, no tweet
  User sees partial result with no explanation
  ```

#### 3.1.2 **No Step Timeout or Cancellation**
- **Location:** `executePlanActions()` step loop
- **Issue:** Long-running steps (video generation: ~2-5 minutes) block entire plan
- **Impact:** User waits indefinitely with no feedback; can't cancel mid-plan
- **Risk:** API timeouts cascade to Telegram response timeout

#### 3.1.3 **No Progress Feedback During Execution**
- **Location:** `executePlanActions()` 
- **Issue:** User sees nothing between plan start and first result
- **Impact:** For multi-step plans, users think bot is frozen
- **Current state:** Only final media is shown, no intermediate updates

#### 3.1.4 **Single-Threaded Sequential Execution**
- **Location:** `executePlanActions()` step loop
- **Issue:** All steps execute sequentially even when parallelizable
- **Impact:** Unnecessarily slow for independent steps
- **Example:** 
  ```
  Plan: generate_image (A) → generate_image (B) → post_tweet
  Images A and B could be generated in parallel but aren't
  ```

### 3.2 Architectural Concerns

#### 3.2.1 **Monolithic Plan Executor**
- **Issue:** `executePlanActions()` is 200+ lines with mixed concerns
- **Impact:** Hard to test, extend, or add new action types
- **Location:** Lines 3360-3620 of `telegramService.mjs`

#### 3.2.2 **Action Handlers Embedded in Switch Statement**
- **Issue:** Each action is handled inline with copy-pasted patterns
- **Impact:** Adding new actions requires modifying core function
- **Example:** Every action has identical `if (record) { latestGeneratedMediaId = record.id }` pattern

#### 3.2.3 **No Action Validation Before Execution**
- **Issue:** Plan steps aren't validated before execution starts
- **Impact:** Invalid plans discovered mid-execution
- **Example:** `post_tweet` without prior media generation fails late

#### 3.2.4 **Hardcoded AI Model in speak/tweet Generation**
- **Issue:** Uses `anthropic/claude-sonnet-4.5` directly instead of configured model
- **Impact:** Inconsistent with bot's personality if different model configured
- **Location:** Lines 3530, 3575

### 3.3 Feature Gaps

#### 3.3.1 **No Conditional Logic in Plans**
- **Issue:** Can't express "if image succeeds, then post; else retry with different prompt"
- **Impact:** Plans are linear only; no branching or error handling

#### 3.3.2 **No Plan Modification Mid-Execution**
- **Issue:** Once plan starts, it can't be adjusted based on intermediate results
- **Impact:** Can't adapt to partial failures or new information

#### 3.3.3 **No User Confirmation for Expensive Operations**
- **Issue:** Video generation (expensive) executes without explicit confirmation
- **Impact:** Accidental quota consumption

#### 3.3.4 **Limited Action Parameters**
- **Issue:** Steps only pass `description`, `action`, `sourceMediaId`, `expectedOutcome`
- **Impact:** Can't specify aspect ratio, style, or other options per-step

#### 3.3.5 **No Inter-Step Dependencies Declared**
- **Issue:** Dependencies are implicit (uses `latestGeneratedMediaId`)
- **Impact:** Can't detect parallelizable steps; can't show dependency graph

---

## 4. Proposed Improvements

### 4.1 Phase 1: Stabilization (1-2 weeks) ✅ COMPLETE

#### 4.1.1 Add Progress Feedback During Execution ✅ IMPLEMENTED

```javascript
// Implemented: _updateProgressMessage, _deleteProgressMessage, _getActionIcon, _getActionLabel
async _updateProgressMessage(ctx, messageId, text, channelId) {
  if (messageId) {
    await ctx.telegram.editMessageText(channelId, messageId, null, text, { parse_mode: 'HTML' });
    return messageId;
  } else {
    const msg = await ctx.reply(text, { parse_mode: 'HTML' });
    return msg.message_id;
  }
}

// Progress display with icons: "🎨 Step 1/3: Generating image..."
const progressText = `${this._getActionIcon(action)} <b>Step ${stepNum}/${totalSteps}:</b> ${this._getActionLabel(action)}...`;
```

**Tasks:**
- [x] Implement progress message with step counter
- [x] Use message editing instead of multiple messages
- [x] Clean up progress message on success
- [x] Add action-specific icons and labels

#### 4.1.2 Add Step Timeout with Graceful Cancellation ✅ IMPLEMENTED

```javascript
// Implemented: STEP_TIMEOUTS config and _executeStepWithTimeout
static STEP_TIMEOUTS = {
  generate_image: 120000,      // 2 minutes
  generate_video: 300000,      // 5 minutes
  speak: 30000,                // 30 seconds
  post_tweet: 60000,           // 1 minute
  default: 120000              // 2 minutes
};

async _executeStepWithTimeout(stepFn, action, stepNum) {
  const timeoutMs = TelegramService.STEP_TIMEOUTS[action] || TelegramService.STEP_TIMEOUTS.default;
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Step ${stepNum} (${action}) timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    stepFn().then(resolve).catch(reject).finally(() => clearTimeout(timeoutId));
  });
}
```

**Tasks:**
- [x] Add per-step timeout configuration (STEP_TIMEOUTS)
- [x] Implement timeout wrapper for step execution
- [x] Add user-facing timeout explanation message

#### 4.1.3 Validate Plan Before Execution ✅ IMPLEMENTED

```javascript
// Implemented: VALID_PLAN_ACTIONS and _validatePlan
static VALID_PLAN_ACTIONS = new Set([
  'generate_image', 'generate_keyframe', 'generate_video', 
  'generate_video_from_image', 'edit_image', 'extend_video',
  'speak', 'post_tweet', 'research', 'wait'
]);

_validatePlan(plan) {
  const errors = [];
  const warnings = [];
  // Validates: action types, descriptions, dependencies, step count
  return { valid: errors.length === 0, errors, warnings };
}
```

**Tasks:**
- [x] Create action whitelist (VALID_PLAN_ACTIONS Set)
- [x] Validate dependency requirements (media before tweet/edit)
- [x] Return user-friendly error messages
- [x] Add warnings for non-blocking issues

### 4.2 Phase 2: Refactoring (2-4 weeks) ✅ COMPLETE

#### 4.2.1 Extract Action Executor Pattern ✅ IMPLEMENTED

```javascript
// Implemented: src/services/planner/actionExecutor.mjs

/**
 * Base class for action executors
 */
export class ActionExecutor {
  constructor(actionType) {
    this.actionType = actionType;
  }
  
  canHandle(action) {
    return action?.toLowerCase() === this.actionType;
  }
  
  async execute(_step, _context) {
    throw new Error('ActionExecutor.execute() must be implemented by subclass');
  }
  
  getTimeout() {
    return 120000; // 2 minutes default
  }
}

// Concrete executors for each action type
export class GenerateImageExecutor extends ActionExecutor { ... }
export class GenerateKeyframeExecutor extends ActionExecutor { ... }
export class EditImageExecutor extends ActionExecutor { ... }
export class GenerateVideoExecutor extends ActionExecutor { ... }
export class GenerateVideoFromImageExecutor extends ActionExecutor { ... }
export class ExtendVideoExecutor extends ActionExecutor { ... }
export class SpeakExecutor extends ActionExecutor { ... }
export class PostTweetExecutor extends ActionExecutor { ... }
export class ResearchExecutor extends ActionExecutor { ... }
export class WaitExecutor extends ActionExecutor { ... }

// Registry with all executors
export const actionExecutorRegistry = new ActionExecutorRegistry();
```

**Tasks:**
- [x] Create `ActionExecutor` base class
- [x] Extract each action into separate executor class (10 executors)
- [x] Implement registry pattern with `ActionExecutorRegistry`
- [x] Add per-action timeout configuration via `getTimeout()`

#### 4.2.2 Create PlanExecutionService ✅ IMPLEMENTED

```javascript
// Implemented: src/services/planner/planExecutionService.mjs

export class PlanExecutionService {
  static VALID_PLAN_ACTIONS = new Set([...]);
  static ACTION_ICONS = { ... };
  static ACTION_LABELS = { ... };
  
  constructor({ logger, executorRegistry }) {
    this.logger = logger;
    this.executorRegistry = executorRegistry || actionExecutorRegistry;
  }
  
  validatePlan(plan) {
    // Returns { valid, errors, warnings }
  }
  
  async executeWithTimeout(stepFn, timeoutMs, stepNum, action) {
    // Promise-based timeout wrapper
  }
  
  async executePlan(plan, context, options = {}) {
    // Main execution loop with callbacks:
    // - onProgress(stepNum, totalSteps, action)
    // - onStepComplete(result)
    // - onError(error, stepNum, action, isTimeout)
    return { success, successCount, totalSteps, durationMs, stepResults, lastMediaId };
  }
  
  logPlanSummary(plan) {
    // Console-only plan visualization
  }
}
```

**Tasks:**
- [x] Create `PlanExecutionService` class
- [x] Move validation logic to service
- [x] Add callback-based progress reporting
- [x] Integrate with TelegramService (flag: `USE_PLAN_EXECUTION_SERVICE`)

#### 4.2.3 TelegramService Integration ✅ IMPLEMENTED

```javascript
// In TelegramService constructor:
this.planExecutionService = new PlanExecutionService({
  logger: this.logger,
  executorRegistry: actionExecutorRegistry
});
this.USE_PLAN_EXECUTION_SERVICE = true;

// New method for service-based execution:
async _executePlanWithService(ctx, planEntry, channelId, userId, username, conversationContext) {
  // Delegates to PlanExecutionService with progress callbacks
}

// executePlanActions now uses service when enabled:
if (this.USE_PLAN_EXECUTION_SERVICE) {
  await this._executePlanWithService(...);
  return;
}
// Falls back to inline execution if service fails
```

**Tasks:**
- [x] Import PlanExecutionService and actionExecutorRegistry
- [x] Initialize service in constructor
- [x] Add feature flag for gradual rollout
- [x] Create `_executePlanWithService` method
- [x] Update `executePlanActions` with delegation logic
- [x] Maintain inline fallback for backward compatibility

#### 4.2.4 Unit Test Coverage ✅ IMPLEMENTED

**New Test Files Created:**
- `test/services/planner/actionExecutor.test.mjs` (32 tests)
- `test/services/planner/planExecutionService.test.mjs` (32 tests)  
- `test/services/social/telegramPlanExecution.test.mjs` (38 tests)

**Total: 102 passing tests** covering:
- ActionExecutor base class behavior
- All 10 concrete executor implementations
- ActionExecutorRegistry functionality
- PlanExecutionService validation
- Timeout wrapper behavior
- Progress callbacks
- Plan execution flow

---

### 4.3 Phase 3: Advanced Features (4-6 weeks)
        state.generationFailed = true;
        
        // Emit step error
        this._emit('step:error', { executionId, step, error, index: i });
        
        // Decide whether to continue or abort
        if (this._shouldAbortOnError(step, error)) {
          break;
        }
      }
    }
    
    // Emit plan complete
    const success = results.every(r => r.success);
    this._emit('plan:complete', { executionId, plan, results, success });
    
    return { success, results, state };
  }
}
```

**Tasks:**
- [ ] Create `PlanExecutionService` class
- [ ] Implement event emitter for progress tracking
- [ ] Add execution state management
- [ ] Implement abort-on-error policy

#### 4.2.3 Implement Dependency Graph for Parallel Execution

```javascript
// Proposed: Dependency analysis for parallelization

class StepDependencyAnalyzer {
  /**
   * Analyze plan steps and return execution groups
   * Steps in the same group can be executed in parallel
   */
  analyze(steps) {
    const groups = [];
    let currentGroup = [];
    let lastProducedMedia = false;
    
    for (const step of steps) {
      const needsMedia = this._needsPriorMedia(step);
      const producesMedia = this._producesMedia(step);
      
      if (needsMedia && !lastProducedMedia) {
        // This step needs media from a prior step - can't parallelize
        if (currentGroup.length > 0) {
          groups.push(currentGroup);
          currentGroup = [];
        }
      }
      
      currentGroup.push(step);
      lastProducedMedia = producesMedia;
      
      // If this step must complete before next (e.g., produces media for next)
      if (producesMedia && this._nextStepNeedsMedia(steps, step)) {
        groups.push(currentGroup);
        currentGroup = [];
      }
    }
    
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }
    
    return groups;
  }
  
  _needsPriorMedia(step) {
    return ['generate_video_from_image', 'edit_image', 'extend_video', 'post_tweet']
      .includes(step.action) && !step.sourceMediaId;
  }
  
  _producesMedia(step) {
    return ['generate_image', 'generate_keyframe', 'generate_video', 
            'generate_video_from_image', 'edit_image', 'extend_video']
      .includes(step.action);
  }
}

// Usage in PlanExecutionService
async execute(plan, context) {
  const groups = this.dependencyAnalyzer.analyze(plan.steps);
  
  for (const group of groups) {
    if (group.length === 1) {
      // Execute single step
      await this._executeStep(group[0], context);
    } else {
      // Execute group in parallel
      await Promise.all(group.map(step => this._executeStep(step, context)));
    }
  }
}
```

**Tasks:**
- [ ] Implement dependency analyzer
- [ ] Group parallelizable steps
- [ ] Add concurrency limit for parallel execution
- [ ] Handle shared state in parallel groups

### 4.3 Phase 3: Enhanced Capabilities (4-6 weeks)

#### 4.3.1 Conditional Execution and Error Handling

```javascript
// Proposed: Enhanced step schema with conditionals

const planSchema = {
  objective: 'Generate and post a sunset image',
  steps: [
    {
      id: 'step1',
      action: 'generate_image',
      description: 'A beautiful sunset over mountains',
      onSuccess: 'step2',
      onFailure: 'step1_retry'
    },
    {
      id: 'step1_retry',
      action: 'generate_image',
      description: 'A simple sunset scene',
      onSuccess: 'step2',
      onFailure: 'abort',
      retryOf: 'step1'
    },
    {
      id: 'step2',
      action: 'post_tweet',
      description: 'Share the sunset',
      requires: ['step1'],
      onFailure: 'step2_notify'
    },
    {
      id: 'step2_notify',
      action: 'speak',
      description: 'Apologize for tweet failure',
      isCompensation: true
    }
  ]
};
```

**Tasks:**
- [ ] Extend step schema with `onSuccess`, `onFailure`, `requires`
- [ ] Implement step graph execution instead of linear
- [ ] Add compensation actions for rollback
- [ ] Support retry with modified parameters

#### 4.3.2 User Confirmation for Expensive Operations

```javascript
// Proposed: Confirmation flow

async executePlanActions(ctx, plan, context) {
  // Check if plan contains expensive operations
  const expensiveOps = plan.steps.filter(s => 
    ['generate_video', 'generate_video_from_image', 'extend_video'].includes(s.action)
  );
  
  if (expensiveOps.length > 0) {
    const confirmMsg = await ctx.reply(
      `This plan includes ${expensiveOps.length} video generation(s) which use more resources.\n\n` +
      `Proceed? Reply "yes" or "go" to confirm.`,
      { reply_markup: { inline_keyboard: [[
        { text: '✅ Yes, proceed', callback_data: `confirm_plan:${plan.id}` },
        { text: '❌ Cancel', callback_data: `cancel_plan:${plan.id}` }
      ]]}
    });
    
    // Store pending plan for callback handling
    this._pendingPlans.set(plan.id, { plan, context, confirmMsgId: confirmMsg.message_id });
    return; // Execution will continue in callback handler
  }
  
  // No confirmation needed - execute immediately
  await this._executePlan(plan, context);
}
```

**Tasks:**
- [ ] Identify expensive operations
- [ ] Implement confirmation flow with inline keyboard
- [ ] Add timeout for confirmation (auto-cancel after 5 minutes)
- [ ] Store pending plans for callback resolution

#### 4.3.3 Plan Templates and Presets

```javascript
// Proposed: Common plan templates

const PLAN_TEMPLATES = {
  'generate_and_post': {
    name: 'Generate and Post',
    description: 'Generate an image and post it to X',
    steps: [
      { action: 'generate_image', description: '{{prompt}}' },
      { action: 'post_tweet', description: '{{caption}}' }
    ]
  },
  'video_workflow': {
    name: 'Video Workflow',
    description: 'Generate keyframe, create video, post to X',
    steps: [
      { action: 'generate_keyframe', description: '{{prompt}}' },
      { action: 'generate_video_from_image', description: 'Animate the scene' },
      { action: 'post_tweet', description: '{{caption}}' }
    ]
  },
  'edit_and_post': {
    name: 'Edit and Post',
    description: 'Edit recent image and post',
    steps: [
      { action: 'edit_image', description: '{{edit_instruction}}', sourceMediaId: '{{mediaId}}' },
      { action: 'post_tweet', description: '{{caption}}' }
    ]
  }
};

// AI can reference templates
const tools = [{
  type: 'function',
  function: {
    name: 'use_plan_template',
    description: 'Use a predefined plan template for common workflows',
    parameters: {
      type: 'object',
      properties: {
        template: { 
          type: 'string', 
          enum: Object.keys(PLAN_TEMPLATES),
          description: 'Template name' 
        },
        variables: {
          type: 'object',
          description: 'Template variables (prompt, caption, etc.)'
        }
      }
    }
  }
}];
```

**Tasks:**
- [ ] Define common plan templates
- [ ] Implement template variable substitution
- [ ] Add `use_plan_template` tool for AI
- [ ] Allow user-defined templates (stored in DB)

### 4.4 Phase 4: Integration with Job Queue (6-8 weeks)

#### 4.4.1 Async Plan Execution via JobQueueService

```javascript
// Proposed: Queue-based plan execution

async executePlanActions(ctx, args, channelId, userId, username, conversationContext) {
  // Create plan job
  const jobId = await this.jobQueueService.addJob('execute_plan', {
    plan: args,
    channelId,
    userId,
    username,
    conversationContext
  }, {
    priority: JobPriority.HIGH,
    metadata: {
      chatId: ctx.chat.id,
      messageId: ctx.message?.message_id
    }
  });
  
  // Send acknowledgment with job reference
  await ctx.reply(
    `📋 Plan queued for execution (Job: ${jobId.substring(0, 8)})\n` +
    `I'll update you as each step completes.`
  );
  
  // Job handler sends updates via Telegram API
  // (See registerPlanExecutionHandler below)
}

// Job handler
this.jobQueueService.registerHandler('execute_plan', async (job) => {
  const { plan, channelId, userId, username, conversationContext } = job.data;
  const { chatId, messageId } = job.metadata;
  
  const planExecutor = new PlanExecutionService({ ... });
  
  // Subscribe to events for real-time updates
  planExecutor.on('step:start', async ({ step, index, total }) => {
    await this.telegram.sendMessage(chatId, 
      `⏳ Step ${index + 1}/${total}: ${step.action}...`
    );
  });
  
  planExecutor.on('step:complete', async ({ step, result, index }) => {
    if (result.mediaId) {
      // Send the generated media
      await this._sendMedia(chatId, result);
    }
  });
  
  const result = await planExecutor.execute(plan, { channelId, userId, username, conversationContext });
  
  return result;
});
```

**Tasks:**
- [ ] Integrate `JobQueueService` with plan execution
- [ ] Implement plan execution job handler
- [ ] Add real-time progress updates via Telegram API
- [ ] Handle job cancellation (user can cancel pending plans)

#### 4.4.2 Plan Execution Dashboard (Admin)

```javascript
// Proposed: Admin endpoints for plan monitoring

// GET /admin/plans/active
async getActivePlans(req, res) {
  const activePlans = await this.planExecutionService.getActiveExecutions();
  return res.json({
    count: activePlans.length,
    plans: activePlans.map(p => ({
      id: p.executionId,
      objective: p.plan.objective,
      currentStep: p.currentStepIndex,
      totalSteps: p.plan.steps.length,
      status: p.status,
      startedAt: p.startedAt,
      channelId: p.context.channelId,
      username: p.context.username
    }))
  });
}

// POST /admin/plans/:id/cancel
async cancelPlan(req, res) {
  const { id } = req.params;
  await this.planExecutionService.cancel(id, 'Admin cancelled');
  return res.json({ success: true });
}

// GET /admin/plans/stats
async getPlanStats(req, res) {
  const stats = await this.planExecutionService.getStats();
  return res.json({
    totalExecuted: stats.total,
    successRate: stats.successRate,
    avgDurationMs: stats.avgDuration,
    byAction: stats.actionBreakdown,
    byChannel: stats.channelBreakdown
  });
}
```

**Tasks:**
- [ ] Create admin API endpoints
- [ ] Implement plan execution metrics collection
- [ ] Add plan cancellation from admin
- [ ] Build simple dashboard UI

---

## 5. Implementation Priority Matrix

| Improvement | Impact | Effort | Priority |
|-------------|--------|--------|----------|
| Progress feedback during execution | High | Low | P0 |
| Step timeout with cancellation | High | Medium | P0 |
| Plan validation before execution | High | Low | P0 |
| Extract action executor pattern | Medium | Medium | P1 |
| Create PlanExecutionService | Medium | High | P1 |
| Dependency graph for parallelization | Medium | High | P2 |
| Conditional execution/error handling | Medium | High | P2 |
| User confirmation for expensive ops | Medium | Medium | P2 |
| Plan templates/presets | Low | Medium | P3 |
| Async execution via JobQueue | High | High | P3 |
| Admin dashboard | Low | Medium | P3 |

---

## 6. Metrics to Track

### 6.1 Plan Execution Metrics

```javascript
const metrics = {
  // Counters
  plans_executed_total: Counter('plans_executed_total', ['status', 'channel']),
  steps_executed_total: Counter('steps_executed_total', ['action', 'status']),
  
  // Histograms
  plan_duration_seconds: Histogram('plan_duration_seconds', ['step_count']),
  step_duration_seconds: Histogram('step_duration_seconds', ['action']),
  
  // Gauges
  plans_in_progress: Gauge('plans_in_progress', ['channel']),
  pending_confirmations: Gauge('pending_confirmations')
};
```

### 6.2 Key Performance Indicators

| Metric | Target | Current |
|--------|--------|---------|
| Plan success rate | >90% | Unknown |
| Avg plan duration (3 steps) | <60s | Unknown |
| Step timeout rate | <5% | Unknown |
| User cancellation rate | <10% | Unknown |
| Parallel execution savings | >20% | N/A (not implemented) |

---

## 7. Appendix: Code Locations

| Component | File | Lines |
|-----------|------|-------|
| Plan Actions Tool | `telegramService.mjs` | 2975-3020 |
| Tool Call Router | `telegramService.mjs` | 3190-3350 |
| Plan Executor | `telegramService.mjs` | 3360-3620 |
| Plan Storage | `telegramService.mjs` | 1323-1410 |
| Plan Context Builder | `telegramService.mjs` | 1420-1440 |
| MediaGenerationService | `mediaGenerationService.mjs` | 1-787 |
| JobQueueService | `jobQueueService.mjs` | 1-562 |

---

## 8. Next Steps

1. **Immediate (Week 1):** Implement P0 items (progress feedback, timeout, validation)
2. **Short-term (Weeks 2-4):** Refactor to ActionExecutor pattern and PlanExecutionService
3. **Medium-term (Weeks 5-8):** Add parallel execution and conditional logic
4. **Long-term (Weeks 9+):** Full JobQueue integration and admin dashboard

---

*Report generated by Engineering Analysis - November 25, 2025*
