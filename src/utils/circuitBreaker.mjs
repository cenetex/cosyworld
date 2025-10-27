/**
 * @fileoverview Circuit breaker pattern implementation for protecting external services
 * @module utils/circuitBreaker
 */

/**
 * Circuit Breaker States
 * @enum {string}
 */
export const CircuitState = {
  CLOSED: 'CLOSED',     // Normal operation
  OPEN: 'OPEN',         // Failing, reject requests immediately
  HALF_OPEN: 'HALF_OPEN' // Testing if service recovered
};

/**
 * CircuitBreaker - Prevents cascading failures by failing fast
 * 
 * When a service is failing, the circuit breaker "opens" and immediately
 * rejects requests without calling the service. After a timeout, it allows
 * a test request through ("half-open"). If successful, it closes; if it fails,
 * it opens again.
 * 
 * @class
 * @example
 * const breaker = new CircuitBreaker({
 *   name: 'GoogleAI',
 *   failureThreshold: 5,
 *   resetTimeout: 60000
 * });
 * 
 * const result = await breaker.execute(async () => {
 *   return await googleAIService.generateText(prompt);
 * });
 */
export class CircuitBreaker {
  /**
   * Creates a new CircuitBreaker instance
   * @param {Object} options - Configuration options
   * @param {string} options.name - Circuit breaker name (for logging)
   * @param {number} [options.failureThreshold=5] - Failures before opening circuit
   * @param {number} [options.successThreshold=2] - Successes to close from half-open
   * @param {number} [options.resetTimeout=60000] - Ms before trying half-open (default: 1 min)
   * @param {Function} [options.onStateChange] - Callback when state changes
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(options = {}) {
    this.name = options.name || 'CircuitBreaker';
    this.failureThreshold = options.failureThreshold || 5;
    this.successThreshold = options.successThreshold || 2;
    this.resetTimeout = options.resetTimeout || 60000;
    this.onStateChange = options.onStateChange;
    this.logger = options.logger;
    
    // State
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = null;
    this.lastFailure = null;
    this.lastSuccess = null;
    
    // Stats
    this.stats = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      rejectedCalls: 0,
      openedCount: 0
    };
  }

  /**
   * Execute a function with circuit breaker protection
   * @param {Function} fn - Async function to execute
   * @returns {Promise<*>} Function result
   * @throws {Error} If circuit is open or function fails
   */
  async execute(fn) {
    this.stats.totalCalls++;
    
    // Check if circuit is open
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttempt) {
        this.stats.rejectedCalls++;
        const waitMs = this.nextAttempt - Date.now();
        throw new Error(
          `[${this.name}] Circuit breaker OPEN. Retry in ${Math.ceil(waitMs / 1000)}s`
        );
      }
      
      // Transition to half-open
      this._transitionTo(CircuitState.HALF_OPEN);
    }
    
    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (error) {
      this._onFailure(error);
      throw error;
    }
  }

  /**
   * Handle successful execution
   * @private
   */
  _onSuccess() {
    this.stats.successfulCalls++;
    this.lastSuccess = Date.now();
    this.failureCount = 0;
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      
      if (this.successCount >= this.successThreshold) {
        this._transitionTo(CircuitState.CLOSED);
        this.successCount = 0;
      }
    }
  }

  /**
   * Handle failed execution
   * @private
   * @param {Error} error - The error that occurred
   */
  _onFailure(error) {
    this.stats.failedCalls++;
    this.lastFailure = Date.now();
    this.failureCount++;
    this.successCount = 0; // Reset success count on any failure
    
    this.logger?.warn?.(
      `[${this.name}] Call failed (${this.failureCount}/${this.failureThreshold}):`,
      error.message
    );
    
    if (this.failureCount >= this.failureThreshold) {
      this._transitionTo(CircuitState.OPEN);
      this.nextAttempt = Date.now() + this.resetTimeout;
      this.stats.openedCount++;
      
      this.logger?.error?.(
        `[${this.name}] Circuit breaker OPENED. Next attempt in ${this.resetTimeout / 1000}s`
      );
    }
  }

  /**
   * Transition to a new state
   * @private
   * @param {CircuitState} newState - New state
   */
  _transitionTo(newState) {
    const oldState = this.state;
    this.state = newState;
    
    if (oldState !== newState) {
      this.logger?.info?.(`[${this.name}] State: ${oldState} → ${newState}`);
      
      if (this.onStateChange) {
        this.onStateChange(newState, oldState);
      }
    }
  }

  /**
   * Get current circuit breaker status
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      nextAttempt: this.nextAttempt,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess,
      stats: { ...this.stats }
    };
  }

  /**
   * Check if circuit is accepting requests
   * @returns {boolean} True if circuit is closed or half-open
   */
  isAvailable() {
    if (this.state === CircuitState.OPEN) {
      return Date.now() >= this.nextAttempt;
    }
    return true;
  }

  /**
   * Manually open the circuit (useful for maintenance)
   * @param {number} [duration] - How long to stay open (ms)
   */
  open(duration) {
    this._transitionTo(CircuitState.OPEN);
    this.nextAttempt = Date.now() + (duration || this.resetTimeout);
  }

  /**
   * Manually close the circuit (reset to normal operation)
   */
  close() {
    this._transitionTo(CircuitState.CLOSED);
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = null;
  }

  /**
   * Reset all statistics
   */
  resetStats() {
    this.stats = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      rejectedCalls: 0,
      openedCount: 0
    };
  }
}

/**
 * Create a circuit breaker with retry logic
 * @param {Object} options - Circuit breaker options
 * @param {number} [options.maxRetries=3] - Maximum retry attempts
 * @param {number} [options.retryDelay=1000] - Initial retry delay (ms)
 * @param {boolean} [options.exponentialBackoff=true] - Use exponential backoff
 * @returns {Object} Circuit breaker with retry capability
 */
export function createRetryableCircuitBreaker(options = {}) {
  const breaker = new CircuitBreaker(options);
  const maxRetries = options.maxRetries || 3;
  const retryDelay = options.retryDelay || 1000;
  const exponentialBackoff = options.exponentialBackoff !== false;
  
  return {
    async execute(fn) {
      let lastError;
      
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await breaker.execute(fn);
        } catch (error) {
          lastError = error;
          
          // Don't retry if circuit is open
          if (error.message.includes('Circuit breaker OPEN')) {
            throw error;
          }
          
          // Don't retry on last attempt
          if (attempt < maxRetries) {
            const delay = exponentialBackoff
              ? retryDelay * Math.pow(2, attempt)
              : retryDelay;
            
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
      
      throw lastError;
    },
    
    getStatus: () => breaker.getStatus(),
    isAvailable: () => breaker.isAvailable(),
    open: (duration) => breaker.open(duration),
    close: () => breaker.close(),
    resetStats: () => breaker.resetStats()
  };
}
