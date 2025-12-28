/**
 * @fileoverview Tool definitions for AI-driven interactions in Telegram
 * @module services/social/telegram/toolDefinitions
 */

import {
  VALID_PLAN_ACTIONS,
  STEP_TIMEOUTS,
  ACTION_ICONS,
  ACTION_LABELS
} from './constants.mjs';
import { buildCreditInfo } from './utils.mjs';

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
    // Primary action planner - handles all responses and media generation
    buildPlanActionsTool(),
    // Quick tools for simple lookups
    buildGetTokenStatsTool(),
    // Direct media tools (for simple single-action requests)
    buildGenerateImageTool(),
    buildGenerateVideoTool(),
    buildGenerateVideoWithReferenceTool(),
    buildGenerateVideoFromImageTool(),
    buildExtendVideoTool(),
    buildGenerateVideoInterpolationTool(),
    buildPostTweetTool(),
    buildReactToMessageTool()
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
      description: `Plan and execute actions to interact with the channel. This is your PRIMARY tool.

QUICK REACTIONS (use liberally!):
- react_to_message: Add any emoji reaction. Great for quick acknowledgments without being verbose.

SPEAKING:
- speak: Send a message. Use 'message' for the text. Add 'targetMessageId' to reply to someone specific.

MEDIA CREATION:
- generate_image: Create artwork (aspectRatio: 16:9=landscape, 9:16=portrait/phone, 1:1=square). If user sent an image, it's automatically used as a reference for style/content!
- generate_video: Create video content
- post_tweet: Share to X/Twitter

TIPS:
- Reactions are fast and fun - use them to stay engaged without walls of text
- Combine: react THEN speak for emphasis
- One thoughtful message beats three short ones
- It's OK to just react and not speak - sometimes an emoji says it all
- When user sends an image with a request like "make this into..." or "remix this", use generate_image - their image is automatically used as reference`,
      parameters: {
        type: 'object',
        properties: {
          objective: {
            type: 'string',
            description: 'Brief goal (e.g., "React to cool art", "Answer question about tokens")'
          },
          steps: {
            type: 'array',
            minItems: 1,
            description: 'Ordered steps to execute.',
            items: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  enum: ['speak', 'react_to_message', 'generate_image', 'generate_keyframe', 'generate_video', 'generate_video_with_reference', 'generate_video_from_image', 'extend_video', 'generate_video_interpolation', 'edit_image', 'post_tweet', 'research', 'wait'],
                  description: 'Action type to perform.'
                },
                // Conversation action fields
                message: {
                  type: 'string',
                  description: 'For speak: The message to send. Keep it conversational and natural.'
                },
                emoji: {
                  type: 'string',
                  description: 'For react_to_message: Any single emoji character you want to use as a reaction.'
                },
                targetMessageId: {
                  type: 'number',
                  description: 'Message ID from [msg:XXX] in recent messages. Required for react_to_message, optional for speak (makes it a reply).'
                },
                // Media action fields
                description: {
                  type: 'string',
                  description: 'For media generation: Detailed prompt describing what to create.'
                },
                aspectRatio: {
                  type: 'string',
                  enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
                  description: 'For image/video: 16:9=widescreen/landscape, 9:16=portrait/vertical, 1:1=square.'
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
                  description: 'For video_from_image, extend_video, edit_image: ID of source media.'
                },
                mediaId: {
                  type: 'string',
                  description: 'For post_tweet: ID of the media to share (alternative to sourceMediaId).'
                },
                text: {
                  type: 'string',
                  description: 'For post_tweet: Tweet text to post (under 280 chars).'
                },
                referenceMediaIds: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'For video_with_reference: 1-3 reference image IDs.'
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
                }
              },
              required: ['action']
            }
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
If the user sent an image with their message, it will automatically be used as a style/content reference for the generation. This is great for "make this into...", "remix this", or "create something like this but..." requests.

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
            description: 'A detailed description of the image to generate. Be creative and descriptive. Reference the user\'s image if they sent one.'
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
    
    // Check for description (only required for media/research actions, not speak/react)
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
    
    if (action === 'post_tweet') {
      if (!step.sourceMediaId && !step.mediaId && !hasMediaGeneration) {
        errors.push(`Step ${stepNum} (post_tweet): Requires prior media generation or mediaId/sourceMediaId`);
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

/**
 * Build the react_to_message tool definition
 * @returns {Object} Tool definition
 */
function buildReactToMessageTool() {
  return {
    type: 'function',
    function: {
      name: 'react_to_message',
      description: `Quick emoji reaction - perfect for acknowledging messages without being verbose!
Use any emoji that fits the moment. This is often better than a text response for quick acknowledgments.`,
      parameters: {
        type: 'object',
        properties: {
          emoji: {
            type: 'string',
            description: 'Any emoji character you want to react with.'
          },
          messageId: {
            type: 'number',
            description: 'Message ID from [msg:XXX]. If omitted, reacts to the last message.'
          }
        },
        required: ['emoji']
      }
    }
  };
}
