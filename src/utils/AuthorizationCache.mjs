/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Authorization cache with TTL-based expiration for guild authorization status.
 * Addresses the critical security issue of never-expiring authorization cache.
 */
export class AuthorizationCache {
  /**
   * @param {Object} options - Configuration options
   * @param {number} options.ttlMs - Cache TTL in milliseconds (default: 5 minutes)
   * @param {number} options.negativeTtlMs - TTL for unauthorized guilds (default: 1 minute)
   * @param {number} options.cleanupIntervalMs - Cleanup interval (default: 1 minute)
   * @param {Object} options.logger - Logger instance
   */
  constructor(options = {}) {
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000; // 5 minutes for authorized
    this.negativeTtlMs = options.negativeTtlMs ?? 60 * 1000; // 1 minute for unauthorized
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? 60 * 1000; // 1 minute
    this.logger = options.logger || console;

    // Cache structure: Map<guildId, { authorized: boolean, timestamp: number }>
    this.cache = new Map();

    // Pending lookup promises to prevent duplicate DB queries
    this.pendingLookups = new Map();

    // Start periodic cleanup
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.cleanupIntervalMs);
  }

  /**
   * Get authorization status from cache if valid
   * @param {string} guildId - Guild ID to check
   * @returns {boolean|null} Authorization status or null if not cached/expired
   */
  get(guildId) {
    const entry = this.cache.get(guildId);
    if (!entry) return null;

    const ttl = entry.authorized ? this.ttlMs : this.negativeTtlMs;
    if (Date.now() - entry.timestamp >= ttl) {
      // Entry expired
      this.cache.delete(guildId);
      return null;
    }

    return entry.authorized;
  }

  /**
   * Set authorization status in cache
   * @param {string} guildId - Guild ID
   * @param {boolean} authorized - Authorization status
   */
  set(guildId, authorized) {
    this.cache.set(guildId, {
      authorized: Boolean(authorized),
      timestamp: Date.now(),
    });
    this.logger.debug?.(`[AuthorizationCache] Cached authorization for guild ${guildId}: ${authorized}`);
  }

  /**
   * Check authorization with fetch callback for cache misses
   * Prevents duplicate concurrent lookups for the same guild
   * @param {string} guildId - Guild ID to check
   * @param {Function} fetchFn - Async function to fetch authorization if not cached
   * @returns {Promise<boolean>} Authorization status
   */
  async check(guildId, fetchFn) {
    // Check cache first
    const cached = this.get(guildId);
    if (cached !== null) {
      return cached;
    }

    // Check if there's already a pending lookup
    if (this.pendingLookups.has(guildId)) {
      return this.pendingLookups.get(guildId);
    }

    // Create new lookup promise
    const lookupPromise = (async () => {
      try {
        const authorized = await fetchFn();
        this.set(guildId, authorized);
        return authorized;
      } catch (error) {
        this.logger.error?.(`[AuthorizationCache] Failed to fetch authorization for guild ${guildId}: ${error.message}`);
        // Don't cache errors, return false for safety
        return false;
      } finally {
        // Clean up pending lookup
        this.pendingLookups.delete(guildId);
      }
    })();

    this.pendingLookups.set(guildId, lookupPromise);
    return lookupPromise;
  }

  /**
   * Invalidate a specific guild's cached authorization
   * @param {string} guildId - Guild ID to invalidate
   */
  invalidate(guildId) {
    this.cache.delete(guildId);
    this.logger.debug?.(`[AuthorizationCache] Invalidated cache for guild ${guildId}`);
  }

  /**
   * Invalidate all cached authorizations
   * Useful when authorization rules change globally
   */
  invalidateAll() {
    const size = this.cache.size;
    this.cache.clear();
    this.logger.info?.(`[AuthorizationCache] Invalidated all ${size} cached entries`);
  }

  /**
   * Bulk load authorization statuses (e.g., at startup)
   * @param {Array<{guildId: string, authorized: boolean}>} entries - Entries to load
   */
  bulkLoad(entries) {
    const now = Date.now();
    for (const { guildId, authorized } of entries) {
      if (guildId) {
        this.cache.set(guildId, {
          authorized: Boolean(authorized),
          timestamp: now,
        });
      }
    }
    this.logger.info?.(`[AuthorizationCache] Bulk loaded ${entries.length} entries`);
  }

  /**
   * Clean up expired entries
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [guildId, entry] of this.cache.entries()) {
      const ttl = entry.authorized ? this.ttlMs : this.negativeTtlMs;
      if (now - entry.timestamp >= ttl) {
        this.cache.delete(guildId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug?.(`[AuthorizationCache] Cleaned up ${cleaned} expired entries`);
    }
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  getStats() {
    let authorizedCount = 0;
    let unauthorizedCount = 0;
    let expiredCount = 0;
    const now = Date.now();

    for (const entry of this.cache.values()) {
      const ttl = entry.authorized ? this.ttlMs : this.negativeTtlMs;
      if (now - entry.timestamp >= ttl) {
        expiredCount++;
      } else if (entry.authorized) {
        authorizedCount++;
      } else {
        unauthorizedCount++;
      }
    }

    return {
      size: this.cache.size,
      authorizedCount,
      unauthorizedCount,
      expiredCount,
      pendingLookups: this.pendingLookups.size,
      ttlMs: this.ttlMs,
      negativeTtlMs: this.negativeTtlMs,
    };
  }

  /**
   * Shutdown and cleanup
   */
  shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
    this.pendingLookups.clear();
    this.logger.info?.('[AuthorizationCache] Shutdown complete');
  }
}

export default AuthorizationCache;
