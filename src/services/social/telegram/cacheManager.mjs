/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Telegram Cache Manager
 * Handles all caching operations for the Telegram bot service
 */

import { CACHE_CONFIG, CONVERSATION_CONFIG, MEDIA_CONFIG, PLAN_CONFIG } from './constants.mjs';

/**
 * CacheManager handles all caching operations for TelegramService
 */
export class CacheManager {
  constructor({ logger }) {
    this.logger = logger;

    // Conversation history cache
    this.conversationHistory = new Map(); // channelId -> array of messages

    // Member cache for fast lookups
    this.memberCache = new Map(); // `${channelId}:${userId}` -> { record, expiry }

    // Buybot context cache
    this.buybotCache = new Map(); // channelId -> { data, expiry }

    // Persona cache
    this.personaCache = { data: null, expiry: 0 };

    // Active conversations tracking
    this.activeConversations = new Map(); // channelId -> Map<userId, expiry>

    // Pending replies tracking
    this.pendingReplies = new Map(); // channelId -> { timeout, lastMessageTime, etc }

    // Recent media cache
    this.recentMediaByChannel = new Map(); // channelId -> [mediaEntries]

    // Agent plans cache
    this.agentPlansByChannel = new Map(); // channelId -> [planEntries]

    // Service exhaustion tracking
    this.serviceExhausted = new Map(); // mediaType -> Date (expiry)

    // Debounce locks
    this.debounceLocks = new Map(); // channelId -> Promise

    // Spam tracker
    this.spamTracker = new Map(); // userId -> [timestamps]

    // Cleanup interval reference
    this._cleanupInterval = null;
  }

  // ============================================================================
  // Lifecycle Methods
  // ============================================================================

  /**
   * Start periodic cache cleanup
   */
  startCleanup() {
    if (this._cleanupInterval) return;

    this._cleanupInterval = setInterval(() => {
      this.pruneAll();
    }, CACHE_CONFIG.CLEANUP_INTERVAL_MS);

    this.logger?.info?.('[CacheManager] Started periodic cache cleanup');
  }

  /**
   * Stop periodic cache cleanup
   */
  stopCleanup() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
      this.logger?.info?.('[CacheManager] Stopped periodic cache cleanup');
    }
  }

  /**
   * Clear all caches (for shutdown)
   */
  clearAll() {
    // Clear pending reply timeouts
    for (const [channelId, pending] of this.pendingReplies.entries()) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
        this.logger?.debug?.(`[CacheManager] Cleared pending reply for channel ${channelId}`);
      }
    }

    this.conversationHistory.clear();
    this.memberCache.clear();
    this.buybotCache.clear();
    this.personaCache = { data: null, expiry: 0 };
    this.activeConversations.clear();
    this.pendingReplies.clear();
    this.recentMediaByChannel.clear();
    this.agentPlansByChannel.clear();
    this.serviceExhausted.clear();
    this.debounceLocks.clear();
    this.spamTracker.clear();
  }

  /**
   * Prune all caches to prevent memory leaks
   */
  pruneAll() {
    const now = Date.now();
    let totalPruned = 0;

    // 1. Prune conversation history
    for (const [channelId, history] of this.conversationHistory.entries()) {
      if (history.length > CACHE_CONFIG.MAX_HISTORY_PER_CHANNEL) {
        const removed = history.length - CACHE_CONFIG.MAX_HISTORY_PER_CHANNEL;
        this.conversationHistory.set(channelId, history.slice(-CACHE_CONFIG.MAX_HISTORY_PER_CHANNEL));
        totalPruned += removed;
      }
    }

    // 2. Prune member cache
    for (const [key, entry] of this.memberCache.entries()) {
      if (now > entry.expiry) {
        this.memberCache.delete(key);
        totalPruned++;
      }
    }

    // 3. Prune buybot cache
    for (const [channelId, entry] of this.buybotCache.entries()) {
      if (now > entry.expiry) {
        this.buybotCache.delete(channelId);
        totalPruned++;
      }
    }

    // 4. Prune active conversations
    for (const [channelId, userMap] of this.activeConversations.entries()) {
      for (const [userId, expiry] of userMap.entries()) {
        if (now > expiry) {
          userMap.delete(userId);
          totalPruned++;
        }
      }
      if (userMap.size === 0) {
        this.activeConversations.delete(channelId);
      }
    }

    // 5. Prune service exhaustion
    for (const [mediaType, expiry] of this.serviceExhausted.entries()) {
      if (now > expiry.getTime()) {
        this.serviceExhausted.delete(mediaType);
        totalPruned++;
      }
    }

    // 6. Prune pending replies (older than 5 minutes)
    const staleThreshold = now - 5 * 60 * 1000;
    for (const [channelId, pending] of this.pendingReplies.entries()) {
      if (pending.lastMessageTime && pending.lastMessageTime < staleThreshold) {
        if (pending.timeout) clearTimeout(pending.timeout);
        this.pendingReplies.delete(channelId);
        totalPruned++;
      }
    }

    // 7. Limit total cache entries
    if (this.conversationHistory.size > CACHE_CONFIG.MAX_CACHE_ENTRIES) {
      const toRemove = this.conversationHistory.size - CACHE_CONFIG.MAX_CACHE_ENTRIES;
      const keys = Array.from(this.conversationHistory.keys()).slice(0, toRemove);
      keys.forEach(k => this.conversationHistory.delete(k));
      totalPruned += toRemove;
    }

    if (this.recentMediaByChannel.size > CACHE_CONFIG.MAX_CACHE_ENTRIES) {
      const toRemove = this.recentMediaByChannel.size - CACHE_CONFIG.MAX_CACHE_ENTRIES;
      const keys = Array.from(this.recentMediaByChannel.keys()).slice(0, toRemove);
      keys.forEach(k => this.recentMediaByChannel.delete(k));
      totalPruned += toRemove;
    }

    if (totalPruned > 0) {
      this.logger?.debug?.(`[CacheManager] Cache cleanup: pruned ${totalPruned} entries`);
    }
  }

  // ============================================================================
  // Persona Cache
  // ============================================================================

  getPersona() {
    const now = Date.now();
    if (this.personaCache.data && now < this.personaCache.expiry) {
      return this.personaCache.data;
    }
    return null;
  }

  setPersona(data) {
    this.personaCache.data = data;
    this.personaCache.expiry = Date.now() + CACHE_CONFIG.PERSONA_TTL_MS;
  }

  invalidatePersona() {
    this.personaCache.data = null;
    this.personaCache.expiry = 0;
    this.logger?.info?.('[CacheManager] Persona cache invalidated');
  }

  // ============================================================================
  // Buybot Cache
  // ============================================================================

  getBuybotContext(channelId) {
    const now = Date.now();
    const cached = this.buybotCache.get(channelId);
    if (cached && now < cached.expiry) {
      return cached.data;
    }
    return null;
  }

  setBuybotContext(channelId, data) {
    this.buybotCache.set(channelId, {
      data,
      expiry: Date.now() + CACHE_CONFIG.BUYBOT_TTL_MS,
    });
  }

  invalidateBuybotCache(channelId) {
    if (channelId) {
      this.buybotCache.delete(channelId);
      this.logger?.info?.(`[CacheManager] Buybot cache invalidated for ${channelId}`);
    } else {
      this.buybotCache.clear();
      this.logger?.info?.('[CacheManager] All buybot caches cleared');
    }
  }

  // ============================================================================
  // Member Cache
  // ============================================================================

  getMemberCacheKey(channelId, userId) {
    return `${channelId}:${userId}`;
  }

  getMember(channelId, userId) {
    const key = this.getMemberCacheKey(channelId, userId);
    const entry = this.memberCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.memberCache.delete(key);
      return null;
    }
    return entry.record;
  }

  setMember(channelId, userId, record) {
    const key = this.getMemberCacheKey(channelId, userId);
    if (!record) {
      this.memberCache.delete(key);
      return;
    }
    this.memberCache.set(key, {
      record,
      expiry: Date.now() + CACHE_CONFIG.MEMBER_TTL_MS,
    });
  }

  invalidateMember(channelId, userId) {
    const key = this.getMemberCacheKey(channelId, userId);
    this.memberCache.delete(key);
  }

  // ============================================================================
  // Conversation History
  // ============================================================================

  getConversationHistory(channelId) {
    return this.conversationHistory.get(channelId) || [];
  }

  setConversationHistory(channelId, history) {
    this.conversationHistory.set(channelId, history);
  }

  addToConversationHistory(channelId, message) {
    let history = this.conversationHistory.get(channelId);
    if (!history) {
      history = [];
      this.conversationHistory.set(channelId, history);
    }
    history.push(message);
    
    // Trim if exceeds limit
    if (history.length > CONVERSATION_CONFIG.HISTORY_LIMIT) {
      this.conversationHistory.set(channelId, history.slice(-CONVERSATION_CONFIG.HISTORY_LIMIT));
    }
  }

  hasConversationHistory(channelId) {
    return this.conversationHistory.has(channelId);
  }

  // ============================================================================
  // Active Conversations
  // ============================================================================

  updateActiveConversation(channelId, userId) {
    if (!channelId || !userId) return;
    
    if (!this.activeConversations.has(channelId)) {
      this.activeConversations.set(channelId, new Map());
    }
    
    const channelParticipants = this.activeConversations.get(channelId);
    channelParticipants.set(userId, Date.now() + CONVERSATION_CONFIG.ACTIVE_WINDOW_MS);

    // Cleanup expired participants
    const now = Date.now();
    for (const [uid, expiry] of channelParticipants.entries()) {
      if (now > expiry) channelParticipants.delete(uid);
    }
  }

  isActiveConversation(channelId, userId) {
    if (!channelId || !userId) return false;
    
    const channelParticipants = this.activeConversations.get(channelId);
    if (!channelParticipants) return false;

    const expiry = channelParticipants.get(userId);
    if (!expiry) return false;

    if (Date.now() > expiry) {
      channelParticipants.delete(userId);
      return false;
    }
    return true;
  }

  // ============================================================================
  // Pending Replies
  // ============================================================================

  getPendingReply(channelId) {
    return this.pendingReplies.get(channelId) || {};
  }

  setPendingReply(channelId, data) {
    this.pendingReplies.set(channelId, data);
  }

  // ============================================================================
  // Recent Media
  // ============================================================================

  pruneRecentMedia(channelId) {
    const cache = this.recentMediaByChannel.get(channelId);
    if (!cache || cache.length === 0) return;
    
    const now = Date.now();
    const pruned = cache
      .filter(item => item && item.createdAt && (now - new Date(item.createdAt).getTime()) < MEDIA_CONFIG.MAX_AGE_MS)
      .slice(0, MEDIA_CONFIG.RECENT_LIMIT);
    this.recentMediaByChannel.set(channelId, pruned);
  }

  getRecentMedia(channelId) {
    this.pruneRecentMedia(channelId);
    return this.recentMediaByChannel.get(channelId) || [];
  }

  addRecentMedia(channelId, record) {
    if (!channelId || !record) return null;
    
    const cache = this.recentMediaByChannel.get(channelId) || [];
    const deduped = cache.filter(item => item.id !== record.id);
    deduped.unshift(record);
    this.recentMediaByChannel.set(channelId, deduped.slice(0, MEDIA_CONFIG.RECENT_LIMIT));
    this.pruneRecentMedia(channelId);
    return record;
  }

  findRecentMediaById(channelId, mediaId) {
    if (!channelId || !mediaId) return null;
    
    const cache = this.recentMediaByChannel.get(channelId);
    if (!cache?.length) return null;

    const lookupLower = String(mediaId).trim().toLowerCase();
    return cache.find(item => {
      if (!item?.id) return false;
      const itemId = String(item.id).toLowerCase();
      return itemId === lookupLower || itemId.startsWith(lookupLower);
    }) || null;
  }

  // ============================================================================
  // Agent Plans
  // ============================================================================

  pruneAgentPlans(channelId) {
    const cache = this.agentPlansByChannel.get(channelId);
    if (!cache || cache.length === 0) return;
    
    const now = Date.now();
    const pruned = cache
      .filter(item => item && item.createdAt && (now - new Date(item.createdAt).getTime()) < PLAN_CONFIG.MAX_AGE_MS)
      .slice(0, PLAN_CONFIG.LIMIT);
    this.agentPlansByChannel.set(channelId, pruned);
  }

  getRecentPlans(channelId) {
    this.pruneAgentPlans(String(channelId));
    return this.agentPlansByChannel.get(String(channelId)) || [];
  }

  addAgentPlan(channelId, plan) {
    if (!channelId || !plan) return null;
    
    const normalizedChannelId = String(channelId);
    const cache = this.agentPlansByChannel.get(normalizedChannelId) || [];
    const deduped = cache.filter(item => item.id !== plan.id);
    deduped.unshift(plan);
    this.agentPlansByChannel.set(normalizedChannelId, deduped.slice(0, PLAN_CONFIG.LIMIT));
    this.pruneAgentPlans(normalizedChannelId);
    return plan;
  }

  // ============================================================================
  // Service Exhaustion
  // ============================================================================

  isServiceExhausted(mediaType) {
    const exhaustedUntil = this.serviceExhausted.get(mediaType);
    if (!exhaustedUntil) return false;
    return exhaustedUntil > new Date();
  }

  markServiceExhausted(mediaType, durationMs = 60 * 60 * 1000) {
    const expiry = new Date(Date.now() + durationMs);
    this.serviceExhausted.set(mediaType, expiry);
    this.logger?.warn?.(`[CacheManager] Marked ${mediaType} service as exhausted until ${expiry.toISOString()}`);
  }

  // ============================================================================
  // Debounce Locks
  // ============================================================================

  /**
   * Try to acquire a lock without waiting
   * @param {string} channelId - Channel ID
   * @returns {Function|null} - Release function or null if lock is held
   */
  tryAcquireLock(channelId) {
    if (this.debounceLocks.has(channelId)) {
      return null;
    }

    let releaseFn;
    let timeoutId;
    const lockPromise = new Promise((resolve) => {
      releaseFn = () => {
        clearTimeout(timeoutId);
        this.debounceLocks.delete(channelId);
        resolve();
      };
      // Auto-release after 120 seconds (longer than AI request timeouts)
      timeoutId = setTimeout(() => {
        if (this.debounceLocks.get(channelId) === lockPromise) {
          this.debounceLocks.delete(channelId);
          this.logger?.warn?.(`[CacheManager] Lock timeout for channel ${channelId}`);
          resolve();
        }
      }, 120000);
    });

    this.debounceLocks.set(channelId, lockPromise);
    return releaseFn;
  }

  /**
   * Acquire a lock, waiting if necessary
   * @param {string} channelId - Channel ID
   * @returns {Promise<Function>} - Release function
   */
  async acquireLock(channelId) {
    while (this.debounceLocks.has(channelId)) {
      try {
        await this.debounceLocks.get(channelId);
      } catch {
        // Lock was released, continue
      }
    }
    return this.tryAcquireLock(channelId);
  }

  hasLock(channelId) {
    return this.debounceLocks.has(channelId);
  }

  // ============================================================================
  // Spam Tracking
  // ============================================================================

  checkSpamWindow(userId, windowMs, _threshold) {
    if (!userId) return 0;
    
    const now = Date.now();
    const timestamps = this.spamTracker.get(userId) || [];
    const filtered = timestamps.filter(ts => now - ts < windowMs);
    filtered.push(now);
    this.spamTracker.set(userId, filtered);
    return filtered.length;
  }

  clearSpamTracker(userId) {
    this.spamTracker.set(userId, []);
  }
}

export default CacheManager;
