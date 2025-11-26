/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Custom error classes for CosyWorld services
 * Provides structured error handling with user-friendly messages
 */

/**
 * Base error class for all CosyWorld errors
 */
export class CosyWorldError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'CosyWorldError';
    this.code = options.code || 'UNKNOWN_ERROR';
    this.retryable = options.retryable ?? false;
    this.userMessage = options.userMessage || 'Something went wrong. Please try again.';
    this.context = options.context || {};
    this.timestamp = new Date();
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      userMessage: this.userMessage,
      retryable: this.retryable,
      context: this.context,
      timestamp: this.timestamp.toISOString()
    };
  }
}

/**
 * Error codes for media generation
 */
export const MediaErrorCodes = {
  // Quota/Rate limiting errors
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVICE_EXHAUSTED: 'SERVICE_EXHAUSTED',
  
  // Service errors
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  TIMEOUT: 'TIMEOUT',
  NETWORK_ERROR: 'NETWORK_ERROR',
  
  // Validation errors
  INVALID_PROMPT: 'INVALID_PROMPT',
  INVALID_MEDIA: 'INVALID_MEDIA',
  MEDIA_NOT_FOUND: 'MEDIA_NOT_FOUND',
  UNSUPPORTED_FORMAT: 'UNSUPPORTED_FORMAT',
  
  // Content policy errors
  CONTENT_BLOCKED: 'CONTENT_BLOCKED',
  SAFETY_FILTER: 'SAFETY_FILTER',
  
  // Processing errors
  GENERATION_FAILED: 'GENERATION_FAILED',
  UPLOAD_FAILED: 'UPLOAD_FAILED',
  DOWNLOAD_FAILED: 'DOWNLOAD_FAILED',
  COMPOSITION_FAILED: 'COMPOSITION_FAILED',
  
  // Enhanced error classifications (P7)
  ASPECT_RATIO_MISMATCH: 'ASPECT_RATIO_MISMATCH',
  KEYFRAME_GENERATION_FAILED: 'KEYFRAME_GENERATION_FAILED',
  REFERENCE_IMAGE_INVALID: 'REFERENCE_IMAGE_INVALID',
  CHARACTER_DESIGN_MISSING: 'CHARACTER_DESIGN_MISSING',
  PROMPT_TOO_LONG: 'PROMPT_TOO_LONG',
  PROMPT_UNCLEAR: 'PROMPT_UNCLEAR',
  VIDEO_STRATEGY_EXHAUSTED: 'VIDEO_STRATEGY_EXHAUSTED',
  INTERPOLATION_FAILED: 'INTERPOLATION_FAILED',
  EXTENSION_FAILED: 'EXTENSION_FAILED'
};

/**
 * Media generation specific error
 */
export class MediaGenerationError extends CosyWorldError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'MediaGenerationError';
    this.mediaType = options.mediaType || 'unknown'; // 'image', 'video', 'audio'
    this.provider = options.provider || 'unknown'; // 'gemini', 'veo', 'replicate'
    this.attempt = options.attempt || 1;
    this.maxAttempts = options.maxAttempts || 3;
    this.metadata = options.metadata || options; // Support metadata property for compatibility
  }

  /**
   * Create a quota exceeded error
   */
  static quotaExceeded(mediaType, resetTime, provider = 'unknown') {
    const timeUntilReset = resetTime ? Math.ceil((resetTime - Date.now()) / 60000) : 60;
    return new MediaGenerationError('Media generation quota exceeded', {
      code: MediaErrorCodes.QUOTA_EXCEEDED,
      mediaType,
      provider,
      retryable: true,
      userMessage: `🚫 ${mediaType === 'video' ? 'Video' : 'Image'} generation is on cooldown. Try again in ${timeUntilReset} minutes!`,
      context: { resetTime, timeUntilReset }
    });
  }

  /**
   * Create a service unavailable error
   */
  static serviceUnavailable(mediaType, provider, reason = '') {
    return new MediaGenerationError(`${provider} service unavailable: ${reason}`, {
      code: MediaErrorCodes.SERVICE_UNAVAILABLE,
      mediaType,
      provider,
      retryable: true,
      userMessage: `😔 ${mediaType === 'video' ? 'Video' : 'Image'} generation isn't available right now. Try again in a moment!`
    });
  }

  /**
   * Create a generation failed error
   */
  static generationFailed(mediaType, provider, reason = '', retryable = true) {
    return new MediaGenerationError(`${mediaType} generation failed: ${reason}`, {
      code: MediaErrorCodes.GENERATION_FAILED,
      mediaType,
      provider,
      retryable,
      userMessage: `🎨 The ${mediaType} didn't come out right. Let's try again with a different approach!`
    });
  }

  /**
   * Create a content blocked error
   */
  static contentBlocked(mediaType, provider) {
    return new MediaGenerationError('Content blocked by safety filters', {
      code: MediaErrorCodes.CONTENT_BLOCKED,
      mediaType,
      provider,
      retryable: false,
      userMessage: `⚠️ I can't generate that ${mediaType} - it might contain restricted content. Try a different prompt!`
    });
  }

  /**
   * Create a media not found error
   */
  static mediaNotFound(mediaId, mediaType = 'media') {
    return new MediaGenerationError(`Media not found: ${mediaId}`, {
      code: MediaErrorCodes.MEDIA_NOT_FOUND,
      mediaType,
      retryable: false,
      userMessage: `🔍 I couldn't find that ${mediaType}. It may have expired. Try generating a new one!`,
      context: { mediaId }
    });
  }

  /**
   * Create a timeout error
   */
  static timeout(mediaType, provider, timeoutMs) {
    return new MediaGenerationError(`${mediaType} generation timed out after ${timeoutMs}ms`, {
      code: MediaErrorCodes.TIMEOUT,
      mediaType,
      provider,
      retryable: true,
      userMessage: `⏱️ The ${mediaType} is taking too long. Let's try a simpler prompt!`,
      context: { timeoutMs }
    });
  }

  /**
   * Create an aspect ratio mismatch error
   */
  static aspectRatioMismatch(requested, actual, mediaType = 'image') {
    return new MediaGenerationError(`Aspect ratio mismatch: requested ${requested}, got ${actual}`, {
      code: MediaErrorCodes.ASPECT_RATIO_MISMATCH,
      mediaType,
      retryable: true,
      userMessage: `📐 The ${mediaType} didn't match the requested ${requested} aspect ratio. Let me regenerate with the correct dimensions.`,
      context: { requested, actual }
    });
  }

  /**
   * Create a keyframe generation failed error
   */
  static keyframeGenerationFailed(provider, reason = '') {
    return new MediaGenerationError(`Keyframe generation failed: ${reason}`, {
      code: MediaErrorCodes.KEYFRAME_GENERATION_FAILED,
      mediaType: 'video',
      provider,
      retryable: true,
      userMessage: '🎬 The video keyframe didn\'t generate properly. Trying a different approach...'
    });
  }

  /**
   * Create a reference image invalid error
   */
  static referenceImageInvalid(reason = 'Invalid or inaccessible reference image') {
    return new MediaGenerationError(`Reference image invalid: ${reason}`, {
      code: MediaErrorCodes.REFERENCE_IMAGE_INVALID,
      mediaType: 'video',
      retryable: true,
      userMessage: '🖼️ The reference image couldn\'t be used. Trying without it...'
    });
  }

  /**
   * Create a character design missing error
   */
  static characterDesignMissing() {
    return new MediaGenerationError('Character design not configured for this bot', {
      code: MediaErrorCodes.CHARACTER_DESIGN_MISSING,
      mediaType: 'image',
      retryable: false,
      userMessage: '🎨 No character design configured. Using default image generation.'
    });
  }

  /**
   * Create a prompt too long error
   */
  static promptTooLong(length, maxLength, mediaType = 'image') {
    return new MediaGenerationError(`Prompt too long: ${length} chars exceeds ${maxLength} limit`, {
      code: MediaErrorCodes.PROMPT_TOO_LONG,
      mediaType,
      retryable: false,
      userMessage: `✍️ The prompt is too long. Try a shorter description (max ${maxLength} characters).`,
      context: { length, maxLength }
    });
  }

  /**
   * Create a prompt unclear error
   */
  static promptUnclear(mediaType = 'image', suggestion = '') {
    return new MediaGenerationError('Prompt is unclear or ambiguous', {
      code: MediaErrorCodes.PROMPT_UNCLEAR,
      mediaType,
      retryable: false,
      userMessage: suggestion ? `🤔 I'm not sure what to generate. ${suggestion}` : '🤔 The prompt is unclear. Try being more specific!'
    });
  }

  /**
   * Create a video strategy exhausted error
   */
  static videoStrategyExhausted(strategiesAttempted = []) {
    return new MediaGenerationError(`All video generation strategies failed: ${strategiesAttempted.join(', ')}`, {
      code: MediaErrorCodes.VIDEO_STRATEGY_EXHAUSTED,
      mediaType: 'video',
      retryable: false,
      userMessage: '🎬 Video generation is having trouble right now. Try again with a simpler prompt, or try later!',
      context: { strategiesAttempted }
    });
  }

  /**
   * Create an interpolation failed error
   */
  static interpolationFailed(provider, reason = '') {
    return new MediaGenerationError(`Video interpolation failed: ${reason}`, {
      code: MediaErrorCodes.INTERPOLATION_FAILED,
      mediaType: 'video',
      provider,
      retryable: true,
      userMessage: '🎬 The video morphing effect didn\'t work. Try different start/end images!'
    });
  }

  /**
   * Create an extension failed error
   */
  static extensionFailed(provider, reason = '') {
    return new MediaGenerationError(`Video extension failed: ${reason}`, {
      code: MediaErrorCodes.EXTENSION_FAILED,
      mediaType: 'video',
      provider,
      retryable: true,
      userMessage: '📹 I couldn\'t extend that video. The original might be too complex.'
    });
  }

  /**
   * Check if error is due to quota/rate limiting
   */
  isQuotaError() {
    return [
      MediaErrorCodes.QUOTA_EXCEEDED,
      MediaErrorCodes.RATE_LIMITED,
      MediaErrorCodes.SERVICE_EXHAUSTED
    ].includes(this.code);
  }

  /**
   * Check if error is transient and worth retrying
   */
  isTransient() {
    return this.retryable && [
      MediaErrorCodes.TIMEOUT,
      MediaErrorCodes.NETWORK_ERROR,
      MediaErrorCodes.PROVIDER_ERROR
    ].includes(this.code);
  }
}

/**
 * Conversation/Chat errors
 */
export class ConversationError extends CosyWorldError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'ConversationError';
    this.channelId = options.channelId || null;
    this.userId = options.userId || null;
  }
}

/**
 * Rate limit / quota exceeded error
 */
export class RateLimitError extends MediaGenerationError {
  constructor(message, metadata = {}) {
    super(message, {
      code: MediaErrorCodes.RATE_LIMITED,
      retryable: true,
      userMessage: metadata.userMessage || '🚫 Rate limit reached. Please try again in a few minutes.',
      ...metadata
    });
    this.name = 'RateLimitError';
    this.metadata = metadata;
  }
}

/**
 * Service unavailable error
 */
export class ServiceUnavailableError extends MediaGenerationError {
  constructor(message, metadata = {}) {
    super(message, {
      code: MediaErrorCodes.SERVICE_UNAVAILABLE,
      retryable: true,
      userMessage: metadata.userMessage || '⏳ Service temporarily unavailable. Please try again in a moment.',
      ...metadata
    });
    this.name = 'ServiceUnavailableError';
    this.metadata = metadata;
  }
}

/**
 * Moderation errors
 */
export class ModerationError extends CosyWorldError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'ModerationError';
    this.userId = options.userId || null;
    this.channelId = options.channelId || null;
    this.action = options.action || 'unknown';
  }
}

/**
 * Helper to wrap async functions with retry logic
 * @param {Function} fn - Async function to wrap
 * @param {Object} options - Retry options
 * @returns {Promise<any>}
 */
export async function withRetry(fn, options = {}) {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 10000,
    backoffFactor = 2,
    shouldRetry = (err) => err.retryable !== false,
    onRetry = null
  } = options;

  let lastError;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      
      // Check if we should retry
      if (attempt >= maxAttempts || !shouldRetry(error)) {
        throw error;
      }
      
      // Calculate delay with exponential backoff + jitter
      const delay = Math.min(
        baseDelayMs * Math.pow(backoffFactor, attempt - 1) + Math.random() * 500,
        maxDelayMs
      );
      
      // Notify about retry
      if (onRetry) {
        onRetry(error, attempt, delay);
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

/**
 * Parse error from AI service response and convert to appropriate error type
 * @param {Error} error - Original error
 * @param {Object} context - Context about the operation
 * @returns {CosyWorldError}
 */
export function parseServiceError(error, context = {}) {
  const message = error?.message || String(error);
  const { mediaType = 'media', provider = 'unknown' } = context;

  // Quota/rate limit errors
  if (message.includes('quota') || message.includes('RESOURCE_EXHAUSTED') || message.includes('429')) {
    return MediaGenerationError.quotaExceeded(mediaType, null, provider);
  }

  // Safety/content policy errors
  if (message.includes('safety') || message.includes('blocked') || message.includes('SAFETY')) {
    return MediaGenerationError.contentBlocked(mediaType, provider);
  }

  // Timeout errors
  if (message.includes('timeout') || message.includes('DEADLINE_EXCEEDED')) {
    return MediaGenerationError.timeout(mediaType, provider, context.timeoutMs || 60000);
  }

  // Network errors
  if (message.includes('network') || message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
    return new MediaGenerationError(`Network error: ${message}`, {
      code: MediaErrorCodes.NETWORK_ERROR,
      mediaType,
      provider,
      retryable: true,
      userMessage: '🌐 Network hiccup! Give me a moment and try again.'
    });
  }

  // Default: generic generation failed
  return MediaGenerationError.generationFailed(mediaType, provider, message, true);
}
