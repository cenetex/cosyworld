/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthorizationCache } from '../../src/utils/AuthorizationCache.mjs';

describe('AuthorizationCache', () => {
  let cache;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };
    cache = new AuthorizationCache({
      ttlMs: 1000, // 1 second for testing
      negativeTtlMs: 500, // 0.5 second for testing
      cleanupIntervalMs: 10000, // Long interval so it doesn't interfere
      logger: mockLogger,
    });
  });

  afterEach(() => {
    cache.shutdown();
  });

  describe('get/set', () => {
    it('should return null for uncached guilds', () => {
      expect(cache.get('guild123')).toBeNull();
    });

    it('should cache and return authorized status', () => {
      cache.set('guild123', true);
      expect(cache.get('guild123')).toBe(true);
    });

    it('should cache and return unauthorized status', () => {
      cache.set('guild123', false);
      expect(cache.get('guild123')).toBe(false);
    });

    it('should expire authorized entries after TTL', async () => {
      cache.set('guild123', true);
      expect(cache.get('guild123')).toBe(true);
      
      await new Promise(resolve => setTimeout(resolve, 1100));
      expect(cache.get('guild123')).toBeNull();
    });

    it('should expire unauthorized entries after negative TTL', async () => {
      cache.set('guild123', false);
      expect(cache.get('guild123')).toBe(false);
      
      await new Promise(resolve => setTimeout(resolve, 600));
      expect(cache.get('guild123')).toBeNull();
    });
  });

  describe('check', () => {
    it('should use cached value when available', async () => {
      cache.set('guild123', true);
      const fetchFn = vi.fn();
      
      const result = await cache.check('guild123', fetchFn);
      
      expect(result).toBe(true);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('should call fetchFn when cache miss', async () => {
      const fetchFn = vi.fn().mockResolvedValue(true);
      
      const result = await cache.check('guild123', fetchFn);
      
      expect(result).toBe(true);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('should cache result after fetch', async () => {
      const fetchFn = vi.fn().mockResolvedValue(true);
      
      await cache.check('guild123', fetchFn);
      const result = await cache.check('guild123', fetchFn);
      
      expect(result).toBe(true);
      expect(fetchFn).toHaveBeenCalledTimes(1); // Only called once
    });

    it('should prevent duplicate concurrent lookups', async () => {
      const fetchFn = vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return true;
      });
      
      const [result1, result2] = await Promise.all([
        cache.check('guild123', fetchFn),
        cache.check('guild123', fetchFn),
      ]);
      
      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('should return false on fetch error', async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error('DB error'));
      
      const result = await cache.check('guild123', fetchFn);
      
      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('invalidate', () => {
    it('should remove guild from cache', () => {
      cache.set('guild123', true);
      cache.invalidate('guild123');
      expect(cache.get('guild123')).toBeNull();
    });
  });

  describe('invalidateAll', () => {
    it('should clear all entries', () => {
      cache.set('guild1', true);
      cache.set('guild2', false);
      cache.set('guild3', true);
      
      cache.invalidateAll();
      
      expect(cache.get('guild1')).toBeNull();
      expect(cache.get('guild2')).toBeNull();
      expect(cache.get('guild3')).toBeNull();
    });
  });

  describe('bulkLoad', () => {
    it('should load multiple entries at once', () => {
      cache.bulkLoad([
        { guildId: 'guild1', authorized: true },
        { guildId: 'guild2', authorized: false },
        { guildId: 'guild3', authorized: true },
      ]);
      
      expect(cache.get('guild1')).toBe(true);
      expect(cache.get('guild2')).toBe(false);
      expect(cache.get('guild3')).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      cache.set('guild1', true);
      cache.set('guild2', false);
      
      const stats = cache.getStats();
      
      expect(stats.size).toBe(2);
      expect(stats.authorizedCount).toBe(1);
      expect(stats.unauthorizedCount).toBe(1);
      expect(stats.ttlMs).toBe(1000);
      expect(stats.negativeTtlMs).toBe(500);
    });
  });
});
