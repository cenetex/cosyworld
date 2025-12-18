/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Telegram Service Constants
 * Centralized configuration values for the Telegram bot service
 */

// ============================================================================
// Cache Configuration
// ============================================================================

export const CACHE_CONFIG = {
  // Persona cache TTL (5 minutes)
  PERSONA_TTL_MS: 300_000,
  // Buybot context cache TTL (1 minute)
  BUYBOT_TTL_MS: 60_000,
  // Member cache TTL (60 seconds)
  MEMBER_TTL_MS: 60_000,
  // Cache cleanup interval (60 seconds)
  CLEANUP_INTERVAL_MS: 60_000,
  // Max conversation history per channel
  MAX_HISTORY_PER_CHANNEL: 100,
  // Max total cache entries
  MAX_CACHE_ENTRIES: 500,
};

// ============================================================================
// Conversation Configuration
// ============================================================================

export const CONVERSATION_CONFIG = {
  // Number of messages to keep in memory per channel
  HISTORY_LIMIT: 50,
  // Active conversation window (5 minutes)
  ACTIVE_WINDOW_MS: 5 * 60 * 1000,
  // Gap polling interval (30 seconds)
  GAP_POLL_INTERVAL_MS: 30_000,
  // Gap threshold before responding (45 seconds)
  GAP_THRESHOLD_MS: 45_000,
};

// ============================================================================
// Reply Delay Configuration
// ============================================================================

export const REPLY_DELAY_CONFIG = {
  // Delay for direct mentions (3 seconds - quick but not instant)
  MENTIONED_MS: 3_000,
  // Delay for gap responses (8 seconds)
  DEFAULT_MS: 8_000,
};

// ============================================================================
// Spam Prevention Configuration
// ============================================================================

export const SPAM_CONFIG = {
  // Probation window for new users (5 minutes)
  PROBATION_MS: 5 * 60 * 1000,
  // Spam detection window (10 seconds)
  WINDOW_MS: 10_000,
  // Messages in window to trigger spam detection
  THRESHOLD: 8,
  // Penalty tiers with durations
  PENALTY_TIERS: [
    { strikes: 1, durationMs: 30_000, notice: 'First warning: please slow down (30s timeout applied).' },
    { strikes: 2, durationMs: 120_000, notice: 'Second warning: take a breather for 2 minutes.' },
    { strikes: 3, durationMs: 600_000, notice: 'Third warning: you are muted for 10 minutes.' },
    { strikes: 4, durationMs: 3_600_000, notice: 'Final warning: 1 hour cooldown before you can chat again.' },
    { strikes: 5, durationMs: Infinity, notice: 'Permanent ban for repeated spam. Contact a moderator to appeal.' },
  ],
};

// ============================================================================
// Media Generation Configuration
// ============================================================================

export const MEDIA_LIMITS = {
  video: { hourly: 2, daily: 4 },
  image: { hourly: 3, daily: 100 },
  tweet: { hourly: 3, daily: 12 },
};

export const MEDIA_CONFIG = {
  // Recent media entries to keep in memory per channel
  RECENT_LIMIT: 10,
  // Max age for recent media (72 hours)
  MAX_AGE_MS: 72 * 60 * 60 * 1000,
  // Minimum media ID prefix length for lookups
  ID_PREFIX_MIN_LENGTH: 6,
};

// ============================================================================
// Content Filter Configuration
// ============================================================================

/**
 * Core cashtags that are always allowed through content filters.
 * Can be overridden via ALLOWED_CORE_CASHTAGS environment variable (comma-separated).
 */
export const CORE_CASHTAGS = (process.env.ALLOWED_CORE_CASHTAGS || '$RATI,$HISS')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// ============================================================================
// Agent Planning Configuration
// ============================================================================

export const PLAN_CONFIG = {
  // Max plans to keep per channel
  LIMIT: 5,
  // Max age for plans (72 hours)
  MAX_AGE_MS: 72 * 60 * 60 * 1000,
};

// ============================================================================
// Valid Plan Actions
// ============================================================================

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
  'react_to_message',
  'post_tweet',
  'research',
  'wait',
]);

// ============================================================================
// Step Timeout Configuration (ms)
// ============================================================================

export const STEP_TIMEOUTS = {
  generate_image: 120_000,
  generate_keyframe: 120_000,
  generate_video: 300_000,
  generate_video_from_image: 300_000,
  generate_video_with_reference: 360_000,
  generate_video_interpolation: 360_000,
  edit_image: 120_000,
  extend_video: 300_000,
  speak: 30_000,
  react_to_message: 5_000,
  post_tweet: 60_000,
  research: 30_000,
  wait: 5_000,
  default: 120_000,
};

// ============================================================================
// Action Icons and Labels
// ============================================================================

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
  react_to_message: '😊',
  post_tweet: '🐦',
  research: '🔍',
  wait: '⏳',
};

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
  react_to_message: 'Reacting',
  post_tweet: 'Posting to X',
  research: 'Researching',
  wait: 'Processing',
};

// ============================================================================
// Bot Configuration
// ============================================================================

export const BOT_CONFIG = {
  // Handler timeout for long operations (10 minutes)
  HANDLER_TIMEOUT_MS: 600_000,
  // Launch timeout (30 seconds)
  LAUNCH_TIMEOUT_MS: 30_000,
  // Max launch retries
  MAX_LAUNCH_RETRIES: 3,
};

// ============================================================================
// AI Model Configuration
// ============================================================================

export const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.5';

// ============================================================================
// HTML Entity Map for Decoding
// ============================================================================

export const HTML_ENTITY_MAP = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export default {
  CACHE_CONFIG,
  CONVERSATION_CONFIG,
  REPLY_DELAY_CONFIG,
  SPAM_CONFIG,
  MEDIA_LIMITS,
  MEDIA_CONFIG,
  PLAN_CONFIG,
  VALID_PLAN_ACTIONS,
  STEP_TIMEOUTS,
  ACTION_ICONS,
  ACTION_LABELS,
  BOT_CONFIG,
  HTML_ENTITY_MAP,
  DEFAULT_MODEL,
};
