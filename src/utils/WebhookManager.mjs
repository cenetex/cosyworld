/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { WebhookClient } from 'discord.js';
import { RateLimitHandler } from './RateLimitHandler.mjs';

/**
 * Manages Discord webhooks with TTL-based caching and automatic invalidation.
 * Addresses the critical issue of unbounded cache and stale webhooks.
 */
export class WebhookManager {
  /**
   * @param {Object} options - Configuration options
   * @param {number} options.ttlMs - Cache TTL in milliseconds (default: 30 minutes)
   * @param {number} options.maxCacheSize - Maximum cache entries (default: 1000)
   * @param {number} options.cleanupIntervalMs - Cleanup interval (default: 5 minutes)
   * @param {Object} options.logger - Logger instance
   * @param {Object} options.client - Discord.js client
   */
  constructor(options = {}) {
    this.ttlMs = options.ttlMs ?? 30 * 60 * 1000; // 30 minutes default
    this.maxCacheSize = options.maxCacheSize ?? 1000;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? 5 * 60 * 1000; // 5 minutes
    this.logger = options.logger || console;
    this.client = options.client;

    // Cache structure: Map<channelId, { webhook: WebhookClient, timestamp: number, hits: number }>
    this.cache = new Map();

    // Rate limit handler for webhook operations
    this.rateLimitHandler = new RateLimitHandler({
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      logger: this.logger,
    });

    // Start periodic cleanup
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.cleanupIntervalMs);

    // Prevent memory leak on shutdown
    if (typeof process !== 'undefined') {
      process.on('beforeExit', () => this.shutdown());
    }
  }

  /**
   * Get or create a webhook for the given channel with caching
   * @param {Object} channel - Discord.js channel object
   * @returns {Promise<WebhookClient|null>} WebhookClient or null on failure
   */
  async getOrCreate(channel) {
    if (!channel || !channel.isTextBased()) {
      this.logger.error?.('[WebhookManager] Invalid or non-text-based channel provided');
      return null;
    }

    try {
      // Resolve target channel (use parent for threads)
      const targetChannel = channel.isThread() 
        ? await this.rateLimitHandler.execute(
            () => channel.parent.fetch(),
            'Fetch thread parent channel'
          )
        : channel;

      if (!targetChannel) {
        throw new Error('Unable to fetch target channel');
      }

      const channelId = targetChannel.id;

      // Check cache with TTL validation
      const cached = this.cache.get(channelId);
      if (cached && this.isValid(cached)) {
        cached.hits++;
        this.logger.debug?.(`[WebhookManager] Cache hit for channel ${channelId} (hits: ${cached.hits})`);
        return cached.webhook;
      }

      // Cache miss or stale - fetch/create webhook
      this.logger.debug?.(`[WebhookManager] Cache miss for channel ${channelId}, fetching webhooks`);

      const webhook = await this.rateLimitHandler.execute(
        () => this.fetchOrCreateWebhook(targetChannel),
        `Get/create webhook for channel ${channelId}`
      );

      if (webhook) {
        // Enforce max cache size using LRU-like eviction
        if (this.cache.size >= this.maxCacheSize) {
          this.evictLeastUsed();
        }

        this.cache.set(channelId, {
          webhook,
          timestamp: Date.now(),
          hits: 1,
        });

        this.logger.debug?.(`[WebhookManager] Cached webhook for channel ${channelId}`);
      }

      return webhook;
    } catch (error) {
      this.logger.error?.(`[WebhookManager] Failed to get/create webhook for channel ${channel.id}: ${error.message}`);
      return null;
    }
  }

  /**
   * Fetch existing or create new webhook for a channel
   * @param {Object} channel - Discord.js channel object
   * @returns {Promise<WebhookClient>} WebhookClient instance
   */
  async fetchOrCreateWebhook(channel) {
    const webhooks = await channel.fetchWebhooks();
    let webhook = webhooks.find(wh => wh.owner?.id === this.client.user.id);

    if (!webhook) {
      webhook = await channel.createWebhook({
        name: 'Multi-Avatar Bot Webhook',
        avatar: this.client.user.displayAvatarURL(),
      });
      this.logger.info?.(`[WebhookManager] Created webhook for channel ${channel.id}`);
    }

    return new WebhookClient({ id: webhook.id, token: webhook.token });
  }

  /**
   * Check if a cached entry is still valid
   * @param {Object} entry - Cache entry
   * @returns {boolean} True if valid
   */
  isValid(entry) {
    if (!entry || !entry.webhook) return false;
    return Date.now() - entry.timestamp < this.ttlMs;
  }

  /**
   * Explicitly invalidate a channel's cached webhook
   * @param {string} channelId - Channel ID to invalidate
   */
  invalidate(channelId) {
    const entry = this.cache.get(channelId);
    if (entry) {
      try {
        entry.webhook?.destroy?.();
      } catch (_e) {
        // Ignore cleanup errors
      }
      this.cache.delete(channelId);
      this.logger.debug?.(`[WebhookManager] Invalidated cache for channel ${channelId}`);
    }
  }

  /**
   * Invalidate webhooks that may have been deleted externally
   * Called when a webhook send fails with specific errors
   * @param {string} channelId - Channel ID
   * @param {Error} error - The error that occurred
   * @returns {boolean} True if the cache was invalidated
   */
  handleWebhookError(channelId, error) {
    // Discord error codes indicating webhook issues
    const webhookErrorCodes = [
      10015, // Unknown Webhook
      50027, // Invalid Webhook Token
    ];

    const shouldInvalidate = webhookErrorCodes.includes(error?.code) ||
      error?.message?.toLowerCase().includes('unknown webhook') ||
      error?.message?.toLowerCase().includes('invalid webhook');

    if (shouldInvalidate) {
      this.logger.warn?.(`[WebhookManager] Webhook error detected for channel ${channelId}, invalidating cache`);
      this.invalidate(channelId);
      return true;
    }

    return false;
  }

  /**
   * Clean up expired entries
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [channelId, entry] of this.cache.entries()) {
      if (now - entry.timestamp >= this.ttlMs) {
        try {
          entry.webhook?.destroy?.();
        } catch (_e) {
          // Ignore cleanup errors
        }
        this.cache.delete(channelId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug?.(`[WebhookManager] Cleaned up ${cleaned} expired cache entries`);
    }
  }

  /**
   * Evict least recently used entry when cache is full
   */
  evictLeastUsed() {
    let oldestKey = null;
    let oldestTime = Infinity;
    let lowestHits = Infinity;

    for (const [channelId, entry] of this.cache.entries()) {
      // Prioritize eviction by: expired > low hits > oldest
      const isExpired = !this.isValid(entry);
      
      if (isExpired || entry.hits < lowestHits || 
          (entry.hits === lowestHits && entry.timestamp < oldestTime)) {
        oldestKey = channelId;
        oldestTime = entry.timestamp;
        lowestHits = entry.hits;
        
        if (isExpired) break; // Evict expired entries first
      }
    }

    if (oldestKey) {
      const entry = this.cache.get(oldestKey);
      try {
        entry?.webhook?.destroy?.();
      } catch (_e) {
        // Ignore cleanup errors
      }
      this.cache.delete(oldestKey);
      this.logger.debug?.(`[WebhookManager] Evicted LRU cache entry for channel ${oldestKey}`);
    }
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  getStats() {
    let validCount = 0;
    let expiredCount = 0;
    let totalHits = 0;

    for (const [_channelId, entry] of this.cache.entries()) {
      if (this.isValid(entry)) {
        validCount++;
      } else {
        expiredCount++;
      }
      totalHits += entry.hits || 0;
    }

    return {
      size: this.cache.size,
      validCount,
      expiredCount,
      totalHits,
      maxSize: this.maxCacheSize,
      ttlMs: this.ttlMs,
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

    // Destroy all cached webhook clients
    for (const [_channelId, entry] of this.cache.entries()) {
      try {
        entry.webhook?.destroy?.();
      } catch (_e) {
        // Ignore cleanup errors
      }
    }
    this.cache.clear();

    this.logger.info?.('[WebhookManager] Shutdown complete');
  }
}

export default WebhookManager;
