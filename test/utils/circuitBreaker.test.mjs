/**
 * @fileoverview Tests for CircuitBreaker utility
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CircuitBreaker, CircuitState, createRetryableCircuitBreaker } from '../../../src/utils/circuitBreaker.mjs';

describe('CircuitBreaker', () => {
  let circuitBreaker;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    circuitBreaker = new CircuitBreaker({
      name: 'TestService',
      failureThreshold: 3,
      successThreshold: 2,
      resetTimeout: 100, // Short timeout for testing
      logger: mockLogger
    });
  });

  describe('execute', () => {
    it('should execute function successfully when circuit is closed', async () => {
      const mockFn = vi.fn().mockResolvedValue('success');
      
      const result = await circuitBreaker.execute(mockFn);
      
      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(circuitBreaker.state).toBe(CircuitState.CLOSED);
    });

    it('should open circuit after threshold failures', async () => {
      const mockFn = vi.fn().mockRejectedValue(new Error('Service unavailable'));
      
      // Cause failures to reach threshold
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(mockFn);
        } catch (e) {
          // Expected to fail
        }
      }
      
      expect(circuitBreaker.state).toBe(CircuitState.OPEN);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should reject requests immediately when circuit is open', async () => {
      const mockFn = vi.fn().mockRejectedValue(new Error('Service unavailable'));
      
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(mockFn);
        } catch (e) {
          // Expected
        }
      }
      
      // Try to execute when circuit is open
      await expect(circuitBreaker.execute(mockFn)).rejects.toThrow('Circuit breaker OPEN');
      
      // Original function should not be called
      expect(mockFn).toHaveBeenCalledTimes(3); // Only during opening
    });

    it('should transition to half-open after timeout', async () => {
      const mockFn = vi.fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockRejectedValueOnce(new Error('Fail 3'))
        .mockResolvedValue('success');
      
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(mockFn);
        } catch (e) {
          // Expected
        }
      }
      
      expect(circuitBreaker.state).toBe(CircuitState.OPEN);
      
      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Next execution should transition to half-open
      const result = await circuitBreaker.execute(mockFn);
      
      expect(result).toBe('success');
      expect(circuitBreaker.state).toBe(CircuitState.HALF_OPEN);
    });

    it('should close circuit after successful executions in half-open state', async () => {
      const mockFn = vi.fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockRejectedValueOnce(new Error('Fail 3'))
        .mockResolvedValue('success');
      
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(mockFn);
        } catch (e) {
          // Expected
        }
      }
      
      // Wait for reset
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Execute successfully twice (successThreshold = 2)
      await circuitBreaker.execute(mockFn);
      await circuitBreaker.execute(mockFn);
      
      expect(circuitBreaker.state).toBe(CircuitState.CLOSED);
    });

    it('should track statistics', async () => {
      const mockFn = vi.fn()
        .mockResolvedValueOnce('success1')
        .mockResolvedValueOnce('success2')
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce('success3');
      
      await circuitBreaker.execute(mockFn);
      await circuitBreaker.execute(mockFn);
      
      try {
        await circuitBreaker.execute(mockFn);
      } catch (e) {
        // Expected failure
      }
      
      await circuitBreaker.execute(mockFn);
      
      const status = circuitBreaker.getStatus();
      
      expect(status.stats.totalCalls).toBe(4);
      expect(status.stats.successfulCalls).toBe(3);
      expect(status.stats.failedCalls).toBe(1);
    });
  });

  describe('manual control', () => {
    it('should manually open circuit', () => {
      circuitBreaker.open(5000);
      
      expect(circuitBreaker.state).toBe(CircuitState.OPEN);
      expect(circuitBreaker.isAvailable()).toBe(false);
    });

    it('should manually close circuit', async () => {
      const mockFn = vi.fn().mockRejectedValue(new Error('fail'));
      
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(mockFn);
        } catch (e) {
          // Expected
        }
      }
      
      circuitBreaker.close();
      
      expect(circuitBreaker.state).toBe(CircuitState.CLOSED);
      expect(circuitBreaker.isAvailable()).toBe(true);
    });
  });

  describe('state change callback', () => {
    it('should call callback on state changes', async () => {
      const onStateChange = vi.fn();
      
      const breaker = new CircuitBreaker({
        name: 'CallbackTest',
        failureThreshold: 2,
        resetTimeout: 100,
        onStateChange
      });
      
      const mockFn = vi.fn().mockRejectedValue(new Error('fail'));
      
      // Trigger state change to OPEN
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(mockFn);
        } catch (e) {
          // Expected
        }
      }
      
      expect(onStateChange).toHaveBeenCalledWith(CircuitState.OPEN, CircuitState.CLOSED);
    });
  });
});

describe('createRetryableCircuitBreaker', () => {
  it('should retry on failure', async () => {
    const mockFn = vi.fn()
      .mockRejectedValueOnce(new Error('Temporary failure'))
      .mockResolvedValue('success');
    
    const breaker = createRetryableCircuitBreaker({
      name: 'RetryTest',
      maxRetries: 3,
      retryDelay: 10
    });
    
    const result = await breaker.execute(mockFn);
    
    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(2); // Initial + 1 retry
  });

  it('should not retry if circuit is open', async () => {
    const mockFn = vi.fn().mockRejectedValue(new Error('fail'));
    
    const breaker = createRetryableCircuitBreaker({
      name: 'NoRetryTest',
      failureThreshold: 2,
      maxRetries: 3,
      retryDelay: 10
    });
    
    // Open the circuit
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(mockFn);
      } catch (e) {
        // Expected
      }
    }
    
    // Should not retry when circuit is open
    await expect(breaker.execute(mockFn)).rejects.toThrow('Circuit breaker OPEN');
  });

  it('should use exponential backoff', async () => {
    const mockFn = vi.fn()
      .mockRejectedValueOnce(new Error('Fail 1'))
      .mockRejectedValueOnce(new Error('Fail 2'))
      .mockResolvedValue('success');
    
    const breaker = createRetryableCircuitBreaker({
      name: 'BackoffTest',
      maxRetries: 3,
      retryDelay: 10,
      exponentialBackoff: true
    });
    
    const start = Date.now();
    const result = await breaker.execute(mockFn);
    const duration = Date.now() - start;
    
    expect(result).toBe('success');
    // Should have waited: 10ms + 20ms = 30ms minimum
    expect(duration).toBeGreaterThanOrEqual(30);
  });
});
