/**
 * @fileoverview Tool definitions for AI-driven interactions in Telegram
 * @module services/social/telegram/toolDefinitions
 */

/**
 * Valid plan actions that can be executed
 * @constant {Set<string>}
 */
export const VALID_PLAN_ACTIONS = new Set([
  'generate_image', 
  'generate_keyframe', 
  'generate_video', 
  'generate_video_from_image', 
  'generate_video_with_reference', 
  'generate_video_interpolation', 
  'edit_image', 
  'extend_video',
  'speak', 
  'post_tweet', 
  'research', 
  'wait'
]);

/**
 * Step timeout configuration (ms)
 * @constant {Object<string, number>}
 */
export const STEP_TIMEOUTS = {
  generate_image: 120000,      // 2 minutes
  generate_keyframe: 120000,   // 2 minutes
  generate_video: 300000,      // 5 minutes
  generate_video_from_image: 300000, // 5 minutes
  generate_video_with_reference: 360000, // 6 minutes (reference processing)
  generate_video_interpolation: 360000, // 6 minutes
  edit_image: 120000,          // 2 minutes
  extend_video: 300000,        // 5 minutes
  speak: 30000,                // 30 seconds
  post_tweet: 60000,           // 1 minute
  research: 30000,             // 30 seconds
  wait: 5000,                  // 5 seconds
  default: 120000              // 2 minutes default
};

/**
 * Action icons for display
 * @constant {Object<string, string>}
 */
export const ACTION_ICONS = {
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
  wait: '⏳'
};

/**
 * Action labels for display
 * @constant {Object<string, string>}
 */
export const ACTION_LABELS = {
  generate_image: 'Generating image',
  generate_keyframe: 'Creating keyframe',
  generate_video: 'Generating video',
  generate_video_from_image: 'Creating video from image',
  generate_video_with_reference: 'Creating video with character reference',
  generate_video_interpolation: 'Creating video interpolation',
  edit_image: 'Editing image',
  extend_video: 'Extending video',
  speak: 'Composing message',
  post_tweet: 'Posting to X',
  research: 'Researching',
  wait: 'Processing'
};

/**
 * Get icon for an action type
 * @param {string} action - Action name
 * @returns {string} Emoji icon
 */
export function getActionIcon(action) {
  return ACTION_ICONS[action] || '⚡';
}

/**
 * Get human-readable label for an action type
 * @param {string} action - Action name
 * @returns {string} Human-readable label
 */
export function getActionLabel(action) {
  return ACTION_LABELS[action] || action;
}

/**
 * Get timeout for an action type
 * @param {string} action - Action name
 * @returns {number} Timeout in milliseconds
 */
export function getStepTimeout(action) {
  return STEP_TIMEOUTS[action] || STEP_TIMEOUTS.default;
}

/**
 * Build tool definitions for AI chat
 * Returns the complete set of tools available for the AI to call
 * @returns {Array<Object>} Array of tool definitions
 */
export function buildToolDefinitions() {
  return [
    buildPlanActionsTool(),
    buildGetTokenStatsTool(),
    buildGenerateImageTool(),
    buildGenerateVideoTool(),
    buildGenerateVideoWithReferenceTool(),
    buildGenerateVideoFromImageTool(),
    buildExtendVideoTool(),
    buildGenerateVideoInterpolationTool(),
    buildPostTweetTool()
  ];
}

/**
 * Build the plan_actions tool definition
 * @returns {Object} Tool definition
 */
function buildPlanActionsTool() {
  return {
    type: 'function',
    function: {
      name: 'plan_actions',
      description: `Outline a plan that lists upcoming actions before executing them.
VIDEO ACTIONS: generate_video, generate_video_with_reference, generate_video_from_image, extend_video, generate_video_interpolation
IMAGE ACTIONS: generate_image, generate_keyframe, edit_image
OTHER: speak, post_tweet, research, wait

CRITICAL: When user requests widescreen/banner/landscape images, you MUST set aspectRatio to '16:9'. When user requests portrait/tall images, set aspectRatio to '9:16'. The description alone does NOT control aspect ratio - you must explicitly set the aspectRatio property!`,
      parameters: {
        type: 'object',
        properties: {
          objective: {
            type: 'string',
            description: 'Overall goal or intention for the plan.'
          },
          steps: {
            type: 'array',
            minItems: 1,
            description: 'Ordered steps describing the actions you will take.',
            items: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  enum: ['speak', 'generate_image', 'generate_keyframe', 'generate_video', 'generate_video_with_reference', 'generate_video_from_image', 'extend_video', 'generate_video_interpolation', 'edit_image', 'post_tweet', 'research', 'wait'],
                  description: 'Action to perform.'
                },
                description: {
                  type: 'string',
                  description: 'Detailed prompt or description. For videos, include subject, action, camera, style, audio cues.'
                },
                aspectRatio: {
                  type: 'string',
                  enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
                  description: 'CRITICAL for generate_image/video actions! 16:9=widescreen/banner/landscape, 9:16=portrait/tall/vertical/story, 1:1=square. MUST match user intent!'
                },
                style: {
                  type: 'string',
                  description: 'For videos: cinematic, animated, documentary, film_noir, dreamlike, stop_motion.'
                },
                camera: {
                  type: 'string',
                  description: 'For videos: camera movement (tracking, dolly, aerial, POV, etc).'
                },
                sourceMediaId: {
                  type: 'string',
                  description: 'For video_from_image, extend_video: ID of source media.'
                },
                referenceMediaIds: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'For video_with_reference: 1-3 reference image IDs for character consistency.'
                },
                firstFrameMediaId: {
                  type: 'string',
                  description: 'For video_interpolation: first frame image ID.'
                },
                lastFrameMediaId: {
                  type: 'string',
                  description: 'For video_interpolation: last frame image ID.'
                },
                negativePrompt: {
                  type: 'string',
                  description: 'Things to avoid in generation.'
                },
                expectedOutcome: {
                  type: 'string',
                  description: 'Optional expected result of the step.'
                }
              },
              required: ['action', 'description', 'aspectRatio']
            }
          },
          confidence: {
            type: 'number',
            description: 'Optional confidence score between 0 and 1.'
          }
        },
        required: ['objective', 'steps']
      }
    }
  };
}

/**
 * Build the get_token_stats tool definition
 * @returns {Object} Tool definition
 */
function buildGetTokenStatsTool() {
  return {
    type: 'function',
    function: {
      name: 'get_token_stats',
      description: 'Get current market statistics for a tracked Solana token (market cap, price, 24h volume). Use this when users ask about token price, market cap, or stats.',
      parameters: {
        type: 'object',
        properties: {
          tokenSymbol: {
            type: 'string',
            description: 'The token symbol (e.g., "RATi", "BONK", "SOL")'
          }
        },
        required: ['tokenSymbol']
      }
    }
  };
}

/**
 * Build the generate_image tool definition
 * @returns {Object} Tool definition
 */
function buildGenerateImageTool() {
  return {
    type: 'function',
    function: {
      name: 'generate_image',
      description: `Generate an image based on a text prompt.
ASPECT RATIO GUIDE:
- 16:9 = widescreen, banner, landscape, cinematic, YouTube thumbnail
- 9:16 = portrait, tall, vertical, story, TikTok, mobile
- 1:1 = square, profile picture, icon
- 6:2 = ultrawide banner, header image
You MUST set aspectRatio explicitly - it controls the actual image dimensions!`,
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'A detailed description of the image to generate. Be creative and descriptive.'
          },
          aspectRatio: {
            type: 'string',
            enum: ['16:9', '9:16', '1:1', '6:2'],
            description: 'REQUIRED - 16:9 for widescreen/banner, 9:16 for portrait/story, 1:1 for square, 6:2 for ultrawide banner. Default to 16:9 if unclear.'
          }
        },
        required: ['prompt', 'aspectRatio']
      }
    }
  };
}

/**
 * Build the generate_video tool definition
 * @returns {Object} Tool definition
 */
function buildGenerateVideoTool() {
  return {
    type: 'function',
    function: {
      name: 'generate_video',
      description: `Generate a short video (8 seconds) with AI-generated audio using TEXT-TO-VIDEO.
This creates a completely new video from your text description - no source image needed.

PROMPT BEST PRACTICES:
- Include SUBJECT (who/what), ACTION (what they're doing), and STYLE (cinematic, animated, etc.)
- Add CAMERA directions: "tracking shot", "dolly in", "aerial view", "POV shot"
- Add AMBIANCE: "warm sunset lighting", "moody blue tones", "misty atmosphere"
- For DIALOGUE: Use quotes - "Hello there," she said
- For SOUND EFFECTS: Describe explicitly - "footsteps echo on marble floor"

NOTE: If you want to animate an existing image, use generate_video_from_image instead.`,
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Detailed video description. Include subject, action, camera movement, style, and audio cues.'
          },
          aspectRatio: {
            type: 'string',
            enum: ['16:9', '9:16'],
            description: 'REQUIRED - 16:9 (widescreen/cinematic/YouTube) or 9:16 (vertical/TikTok/Stories). Default to 16:9.'
          },
          style: {
            type: 'string',
            enum: ['cinematic', 'animated', 'documentary', 'film_noir', 'dreamlike', 'stop_motion'],
            description: 'Visual style for the video.'
          },
          camera: {
            type: 'string',
            description: 'Camera movement/position: tracking, dolly, aerial, POV, close-up, wide shot, etc.'
          },
          negativePrompt: {
            type: 'string',
            description: 'Things to avoid in the video (e.g., "blurry, distorted, cartoon").'
          }
        },
        required: ['prompt', 'aspectRatio']
      }
    }
  };
}

/**
 * Build the generate_video_with_reference tool definition
 * @returns {Object} Tool definition
 */
function buildGenerateVideoWithReferenceTool() {
  return {
    type: 'function',
    function: {
      name: 'generate_video_with_reference',
      description: `Generate a video using 1-3 reference images to preserve character/subject appearance. 
Use this when you need to maintain visual consistency with a specific character, person, or product. 
The reference images guide what the subject looks like in the generated video.
Note: Uses 16:9 aspect ratio and 8 second duration.`,
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Detailed video description. Describe the scene and actions, the reference images define appearance.'
          },
          referenceMediaIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of 1-3 recent media IDs to use as reference images for character/subject consistency.'
          }
        },
        required: ['prompt', 'referenceMediaIds']
      }
    }
  };
}

/**
 * Build the generate_video_from_image tool definition
 * @returns {Object} Tool definition
 */
function buildGenerateVideoFromImageTool() {
  return {
    type: 'function',
    function: {
      name: 'generate_video_from_image',
      description: `Animate an existing image into a video. The image becomes the starting frame and comes to life.
ONLY use this with images YOU have generated - you can find them in your recent media list.
Perfect for bringing your generated artwork to life with motion and sound.`,
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Describe how to animate the image - what movements, actions, camera motion, and sounds should occur.'
          },
          sourceMediaId: {
            type: 'string',
            description: 'ID of YOUR generated image to animate (from your recent media list). Only works with images you created.'
          },
          aspectRatio: {
            type: 'string',
            enum: ['16:9', '9:16'],
            description: 'Should match source image orientation. 16:9 for wide images, 9:16 for tall images.'
          }
        },
        required: ['prompt', 'sourceMediaId', 'aspectRatio']
      }
    }
  };
}

/**
 * Build the extend_video tool definition
 * @returns {Object} Tool definition
 */
function buildExtendVideoTool() {
  return {
    type: 'function',
    function: {
      name: 'extend_video',
      description: `Extend a previously generated video by 7 seconds (up to 20 times, max 141 seconds total).
Continues the action from where the video ended. Great for building longer narratives.`,
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Describe what should happen in the extension. Continues from the video\'s last frame.'
          },
          sourceMediaId: {
            type: 'string',
            description: 'ID of the video to extend (from your recent media list). Must be a Veo-generated video.'
          }
        },
        required: ['prompt', 'sourceMediaId']
      }
    }
  };
}

/**
 * Build the generate_video_interpolation tool definition
 * @returns {Object} Tool definition
 */
function buildGenerateVideoInterpolationTool() {
  return {
    type: 'function',
    function: {
      name: 'generate_video_interpolation',
      description: `Generate a video that transitions from a first frame image to a last frame image.
Creates smooth interpolation between two keyframes. Great for before/after, transformations, or controlled transitions.`,
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Describe the transition/transformation between the two frames.'
          },
          firstFrameMediaId: {
            type: 'string',
            description: 'ID of the image to use as the first frame.'
          },
          lastFrameMediaId: {
            type: 'string',
            description: 'ID of the image to use as the last frame.'
          }
        },
        required: ['prompt', 'firstFrameMediaId', 'lastFrameMediaId']
      }
    }
  };
}

/**
 * Build the post_tweet tool definition
 * @returns {Object} Tool definition
 */
function buildPostTweetTool() {
  return {
    type: 'function',
    function: {
      name: 'post_tweet',
      description: 'Post a CosyWorld update to X/Twitter using a recently generated image or video when a user explicitly requests it.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Tweet text under 270 characters. Mention CosyWorld naturally when helpful.'
          },
          mediaId: {
            type: 'string',
            description: 'ID of the recent media item to share (from your recent media list).'
          }
        },
        required: ['text', 'mediaId']
      }
    }
  };
}

/**
 * Normalize a tool function name (some models return prefixed names)
 * @param {string} name - Raw function name from model
 * @returns {string} Normalized function name
 */
export function normalizeToolName(name) {
  if (name && name.includes(':')) {
    return name.split(':').pop();
  }
  return name;
}

/**
 * Validate a plan before execution
 * @param {Object} plan - The plan to validate
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validatePlan(plan) {
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
    
    // Check if action is valid
    if (!action) {
      errors.push(`Step ${stepNum}: Missing action type`);
      continue;
    }
    
    if (!VALID_PLAN_ACTIONS.has(action)) {
      errors.push(`Step ${stepNum}: Unknown action "${action}"`);
      continue;
    }
    
    // Check for description
    if (!step.description && !['wait', 'research'].includes(action)) {
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
    
    if (action === 'post_tweet') {
      if (!step.sourceMediaId && !hasMediaGeneration) {
        errors.push(`Step ${stepNum} (post_tweet): Requires prior media generation or sourceMediaId`);
      }
    }
    
    if (action === 'generate_video_from_image') {
      if (!step.sourceMediaId && !hasMediaGeneration) {
        warnings.push(`Step ${stepNum} (generate_video_from_image): No prior image - will fall back to text-to-video`);
      }
    }
  }
  
  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Filter and deduplicate tool calls to prevent double execution
 * @param {Array} toolCalls - Raw tool calls from AI
 * @param {Object} [options] - Options
 * @param {Object} [options.logger] - Logger instance
 * @returns {Array} Filtered and deduplicated tool calls
 */
export function filterToolCalls(toolCalls, options = {}) {
  const { logger } = options;
  
  // Check if plan_actions is present - if so, it takes precedence
  const hasPlan = toolCalls.some(tc => tc.function?.name === 'plan_actions');
  
  // Filter out redundant direct calls if a plan is present
  let effectiveToolCalls = hasPlan 
    ? toolCalls.filter(tc => {
        const name = tc.function?.name;
        // Keep plan_actions and informational tools
        if (name === 'plan_actions' || name === 'get_token_stats' || name === 'research') return true;
        // Filter out action tools that should be in the plan
        if (['generate_image', 'generate_video', 'post_tweet', 'speak', 'wait'].includes(name)) {
          logger?.info?.(`[ToolDefinitions] Skipping direct ${name} call in favor of plan_actions`);
          return false;
        }
        return true;
      })
    : toolCalls;

  // Deduplicate tool calls
  const uniqueToolCalls = [];
  const seenCalls = new Set();
  
  for (const tc of effectiveToolCalls) {
    const argsStr = typeof tc.function?.arguments === 'string' 
      ? tc.function.arguments 
      : JSON.stringify(tc.function?.arguments || {});
    const key = `${tc.function?.name}:${argsStr}`;
    
    if (!seenCalls.has(key)) {
      seenCalls.add(key);
      uniqueToolCalls.push(tc);
    } else {
      logger?.warn?.(`[ToolDefinitions] Skipping duplicate tool call: ${tc.function?.name}`);
    }
  }

  // Additional safety: If we have a plan, filter out stray generation calls
  const finalToolCalls = hasPlan 
    ? uniqueToolCalls.filter(tc => {
        const name = tc.function?.name;
        return name === 'plan_actions' || name === 'get_token_stats' || name === 'research';
      })
    : uniqueToolCalls;

  return finalToolCalls;
}

/**
 * Build credit info string for tool context
 * @param {Object} limit - Limit check result
 * @param {string} label - Display label (e.g., "Images")
 * @returns {string} Formatted credit info
 */
export function buildCreditInfo(limit, label) {
  if (!limit) return `${label}: unavailable`;
  
  const now = Date.now();
  const hLeft = Math.max(0, (limit.hourlyLimit ?? 0) - (limit.hourlyUsed ?? 0));
  const dLeft = Math.max(0, (limit.dailyLimit ?? 0) - (limit.dailyUsed ?? 0));
  const available = hLeft > 0 && dLeft > 0;
  
  if (available) {
    return `${label}: ${Math.min(hLeft, dLeft)} available`;
  }
  
  // No credits - calculate time until next reset
  let nextResetMin = null;
  if (hLeft === 0 && limit.resetTimes?.hourly) {
    const msUntilHourly = limit.resetTimes.hourly.getTime() - now;
    if (msUntilHourly > 0) nextResetMin = Math.ceil(msUntilHourly / 60000);
  }
  if (dLeft === 0 && limit.resetTimes?.daily) {
    const msUntilDaily = limit.resetTimes.daily.getTime() - now;
    if (msUntilDaily > 0) {
      const dailyMin = Math.ceil(msUntilDaily / 60000);
      nextResetMin = nextResetMin ? Math.min(nextResetMin, dailyMin) : dailyMin;
    }
  }
  
  return nextResetMin 
    ? `${label}: 0 left, resets in ${nextResetMin}m`
    : `${label}: 0 left`;
}

/**
 * Build tool credit context string for AI system prompt
 * @param {Object} imageLimitCtx - Image limit check result
 * @param {Object} videoLimitCtx - Video limit check result
 * @param {Object} tweetLimitCtx - Tweet limit check result
 * @returns {string} Formatted context for system prompt
 */
export function buildToolCreditContext(imageLimitCtx, videoLimitCtx, tweetLimitCtx) {
  return `
Tool Credits (global): ${buildCreditInfo(imageLimitCtx, 'Images')} | ${buildCreditInfo(videoLimitCtx, 'Videos')} | ${buildCreditInfo(tweetLimitCtx, 'X posts')}
Rule: Only call tools if credits available. If 0, explain naturally and mention reset time.`;
}

/**
 * Execute a step with timeout
 * @param {Function} stepFn - The step function to execute
 * @param {string} action - Action name for timeout lookup
 * @param {number} stepNum - Step number for logging
 * @returns {Promise<any>}
 */
export function executeStepWithTimeout(stepFn, action, stepNum) {
  const timeoutMs = getStepTimeout(action);
  
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
 * Log a plan summary in a formatted box
 * @param {Object} planEntry - The plan entry to log
 * @param {Object} [logger] - Logger instance
 */
export function logPlanSummary(planEntry, logger) {
  const planLogLines = [
    '\n╔══════════════════════════════════════════════════════════════╗',
    '║                    🧠 AGENT PLAN SEQUENCE                    ║',
    '╠══════════════════════════════════════════════════════════════╣'
  ];
  
  if (planEntry.objective) {
    planLogLines.push(`║ Objective: ${planEntry.objective.substring(0, 50).padEnd(50)} ║`);
  }
  
  if (planEntry.steps?.length) {
    planLogLines.push('╠──────────────────────────────────────────────────────────────╣');
    planEntry.steps.forEach((step, idx) => {
      const action = (step.action || 'step').toUpperCase().padEnd(20);
      const desc = (step.description || '').substring(0, 35).padEnd(35);
      planLogLines.push(`║ ${(idx + 1).toString().padStart(2)}. [${action}] ${desc} ║`);
    });
  }
  
  planLogLines.push('╚══════════════════════════════════════════════════════════════╝\n');
  
  logger?.info?.(planLogLines.join('\n'));
}
