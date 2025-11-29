/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Rate limit handler for Discord API operations with exponential backoff.
 * Provides retry logic for transient failures and rate limit responses.
 */
export class RateLimitHandler {
  /**
   * @param {Object} options - Configuration options
   * @param {number} options.maxRetries - Maximum number of retry attempts (default: 3)
   * @param {number} options.baseDelayMs - Base delay in milliseconds for exponential backoff (default: 1000)
   * @param {number} options.maxDelayMs - Maximum delay cap in milliseconds (default: 30000)
   * @param {Object} options.logger - Optional logger instance
   */
  constructor(options = {}) {
    this.maxRetries = options.maxRetries ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.maxDelayMs = options.maxDelayMs ?? 30000;
    this.logger = options.logger || console;
  }

  /**
   * Sleep for a specified duration
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Calculate delay with exponential backoff and jitter
   * @param {number} attempt - Current attempt number (0-indexed)
   * @param {number} retryAfter - Optional retry-after value from Discord in ms
   * @returns {number} Delay in milliseconds
   */
  calculateDelay(attempt, retryAfter = null) {
    if (retryAfter && retryAfter > 0) {
      // Add small jitter to retry-after to prevent thundering herd
      return Math.min(retryAfter + Math.random() * 500, this.maxDelayMs);
    }
    // Exponential backoff: baseDelay * 2^attempt + jitter
    const exponentialDelay = this.baseDelayMs * Math.pow(2, attempt);
    const jitter = Math.random() * this.baseDelayMs;
    return Math.min(exponentialDelay + jitter, this.maxDelayMs);
  }

  /**
   * Check if an error is retryable
   * @param {Error} error - The error to check
   * @returns {boolean} True if the error is retryable
   */
  isRetryable(error) {
    // Discord rate limit error codes and HTTP status
    const retryableCodes = [
      50035, // Invalid Form Body (often rate limit related)
      10008, // Unknown Message (transient)
      10003, // Unknown Channel (transient during reconnect)
      50001, // Missing Access (can be transient during permission updates)
    ];

    // HTTP status codes that are retryable
    const retryableStatuses = [
      429, // Rate Limited
      500, // Internal Server Error
      502, // Bad Gateway
      503, // Service Unavailable
      504, // Gateway Timeout
    ];

    const errorCode = error?.code;
    const httpStatus = error?.status || error?.httpStatus;

    // Check for rate limit specifically
    if (httpStatus === 429 || error?.message?.toLowerCase().includes('rate limit')) {
      return true;
    }

    // Check error codes
    if (retryableCodes.includes(errorCode)) {
      return true;
    }

    // Check HTTP status
    if (retryableStatuses.includes(httpStatus)) {
      return true;
    }

    // Network errors
    if (error?.code === 'ECONNRESET' || error?.code === 'ETIMEDOUT' || error?.code === 'ENOTFOUND') {
      return true;
    }

    return false;
  }

  /**
   * Extract retry-after value from error
   * @param {Error} error - The error object
   * @returns {number|null} Retry-after in milliseconds, or null if not available
   */
  getRetryAfter(error) {
    // Discord.js provides retryAfter in milliseconds
    if (typeof error?.retryAfter === 'number') {
      return error.retryAfter;
    }

    // Some errors have it in seconds in headers
    if (error?.response?.headers?.['retry-after']) {
      return parseFloat(error.response.headers['retry-after']) * 1000;
    }

    // Check for rate limit info in error data
    if (error?.data?.retry_after) {
      return error.data.retry_after * 1000;
    }

    return null;
  }

  /**
   * Execute an async function with retry logic
   * @param {Function} fn - Async function to execute
   * @param {string} operationName - Name of the operation for logging
   * @returns {Promise<*>} Result of the function
   * @throws {Error} If all retries are exhausted
   */
  async execute(fn, operationName = 'Discord API operation') {
    let lastError;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        // Check if we should retry
        if (!this.isRetryable(error) || attempt >= this.maxRetries) {
          this.logger.error?.(`[RateLimitHandler] ${operationName} failed permanently: ${error.message}`);
          throw error;
        }

        // Calculate delay
        const retryAfter = this.getRetryAfter(error);
        const delay = this.calculateDelay(attempt, retryAfter);

        this.logger.warn?.(
          `[RateLimitHandler] ${operationName} failed (attempt ${attempt + 1}/${this.maxRetries + 1}), ` +
          `retrying in ${Math.round(delay)}ms: ${error.message}`
        );

        await this.sleep(delay);
      }
    }

    // Should not reach here, but just in case
    throw lastError;
  }

  /**
   * Wrap a method with rate limit handling
   * @param {Function} method - Method to wrap
   * @param {string} operationName - Name for logging
   * @returns {Function} Wrapped method
   */
  wrap(method, operationName) {
    return (...args) => this.execute(() => method(...args), operationName);
  }
}

/**
 * Create a singleton rate limit handler with default options
 */
export const defaultRateLimitHandler = new RateLimitHandler();

export default RateLimitHandler;
