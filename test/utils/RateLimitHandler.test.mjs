/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimitHandler } from '../../src/utils/RateLimitHandler.mjs';

describe('RateLimitHandler', () => {
  let handler;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };
    handler = new RateLimitHandler({
      maxRetries: 2,
      baseDelayMs: 10,
      maxDelayMs: 100,
      logger: mockLogger,
    });
  });

  describe('execute', () => {
    it('should return result on successful execution', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await handler.execute(fn, 'test operation');
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable errors', async () => {
      const error = new Error('Rate limited');
      error.status = 429;
      error.retryAfter = 10;
      
      const fn = vi.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce('success');
      
      const result = await handler.execute(fn, 'test operation');
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should throw after max retries', async () => {
      const error = new Error('Server error');
      error.status = 500;
      
      const fn = vi.fn().mockRejectedValue(error);
      
      await expect(handler.execute(fn, 'test operation')).rejects.toThrow('Server error');
      expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should not retry non-retryable errors', async () => {
      const error = new Error('Invalid input');
      error.status = 400;
      
      const fn = vi.fn().mockRejectedValue(error);
      
      await expect(handler.execute(fn, 'test operation')).rejects.toThrow('Invalid input');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('isRetryable', () => {
    it('should return true for rate limit errors', () => {
      const error = { status: 429 };
      expect(handler.isRetryable(error)).toBe(true);
    });

    it('should return true for rate limit message', () => {
      const error = { message: 'You are being rate limited' };
      expect(handler.isRetryable(error)).toBe(true);
    });

    it('should return true for server errors', () => {
      expect(handler.isRetryable({ status: 500 })).toBe(true);
      expect(handler.isRetryable({ status: 502 })).toBe(true);
      expect(handler.isRetryable({ status: 503 })).toBe(true);
      expect(handler.isRetryable({ status: 504 })).toBe(true);
    });

    it('should return true for network errors', () => {
      expect(handler.isRetryable({ code: 'ECONNRESET' })).toBe(true);
      expect(handler.isRetryable({ code: 'ETIMEDOUT' })).toBe(true);
    });

    it('should return false for client errors', () => {
      expect(handler.isRetryable({ status: 400 })).toBe(false);
      expect(handler.isRetryable({ status: 404 })).toBe(false);
    });
  });

  describe('calculateDelay', () => {
    it('should use retryAfter when provided', () => {
      const delay = handler.calculateDelay(0, 50);
      expect(delay).toBeGreaterThanOrEqual(50);
      expect(delay).toBeLessThanOrEqual(handler.maxDelayMs); // Capped at maxDelayMs
    });

    it('should use exponential backoff when no retryAfter', () => {
      const delay0 = handler.calculateDelay(0, null);
      const delay1 = handler.calculateDelay(1, null);
      const delay2 = handler.calculateDelay(2, null);
      
      // Each delay should be roughly 2x the previous (before jitter)
      expect(delay1).toBeGreaterThan(delay0);
      expect(delay2).toBeGreaterThan(delay1);
    });

    it('should cap delay at maxDelayMs', () => {
      const delay = handler.calculateDelay(10, null);
      expect(delay).toBeLessThanOrEqual(handler.maxDelayMs);
    });
  });
});
