/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Moderation Service
 * 
 * Manages user moderation, spam prevention, and trust levels.
 * Extracted from TelegramService for reusability.
 * 
 * Features:
 * - Spam detection and prevention
 * - User trust levels (new, trusted, verified)
 * - Rate limiting per user
 * - Strike system with auto-ban
 * - Channel-specific moderation rules
 * 
 * @module services/moderation/moderationService
 */

// ModerationError available in ../../utils/errors.mjs if needed

/**
 * Trust levels
 */
export const TrustLevel = {
  NEW: 'new',           // New user, limited access
  TRUSTED: 'trusted',   // Regular user
  VERIFIED: 'verified', // Verified/premium user
  MODERATOR: 'moderator', // Can moderate others
  ADMIN: 'admin'        // Full access
};

/**
 * Strike reasons
 */
export const StrikeReason = {
  SPAM: 'spam',
  ABUSE: 'abuse',
  FLOODING: 'flooding',
  PROHIBITED_CONTENT: 'prohibited_content',
  BOT_ABUSE: 'bot_abuse'
};

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  // Trust level thresholds
  trustThresholds: {
    [TrustLevel.TRUSTED]: 10,    // Messages to become trusted
    [TrustLevel.VERIFIED]: 100   // Messages to become verified
  },
  
  // Rate limiting
  rateLimit: {
    windowMs: 60000,          // 1 minute window
    maxMessages: {
      [TrustLevel.NEW]: 5,
      [TrustLevel.TRUSTED]: 15,
      [TrustLevel.VERIFIED]: 30,
      [TrustLevel.MODERATOR]: 60,
      [TrustLevel.ADMIN]: Infinity
    }
  },
  
  // Spam detection
  spam: {
    duplicateThreshold: 3,    // Same message 3 times = spam
    duplicateWindowMs: 60000, // Within 1 minute
    minMessageIntervalMs: 500 // Min time between messages
  },
  
  // Strike system
  strikes: {
    maxStrikes: 3,            // Strikes before ban
    strikeDecayMs: 7 * 24 * 60 * 60 * 1000, // Strike expires after 1 week
    banDurationMs: 24 * 60 * 60 * 1000       // 24 hour ban
  },
  
  // Media cooldowns
  mediaCooldown: {
    image: {
      [TrustLevel.NEW]: 60000,      // 1 min
      [TrustLevel.TRUSTED]: 30000,  // 30s
      [TrustLevel.VERIFIED]: 15000, // 15s
      [TrustLevel.MODERATOR]: 5000, // 5s
      [TrustLevel.ADMIN]: 0
    },
    video: {
      [TrustLevel.NEW]: 300000,     // 5 min
      [TrustLevel.TRUSTED]: 120000, // 2 min
      [TrustLevel.VERIFIED]: 60000, // 1 min
      [TrustLevel.MODERATOR]: 30000,// 30s
      [TrustLevel.ADMIN]: 0
    }
  }
};

/**
 * UserModerationService - User moderation and spam prevention
 */
export class UserModerationService {
  /**
   * @param {Object} deps - Service dependencies
   * @param {Object} deps.databaseService - Database service
   * @param {Object} deps.logger - Logger instance
   */
  constructor({ databaseService, logger }) {
    this.databaseService = databaseService;
    this.logger = logger;
    
    // Use default config (can be extended via setConfig method if needed)
    this.config = { ...DEFAULT_CONFIG };
    
    // In-memory caches
    this._userCache = new Map();      // userId -> user data
    this._rateLimit = new Map();      // channelId:userId -> rate limit data
    this._recentMessages = new Map(); // channelId:userId -> recent messages
    this._bans = new Map();           // channelId:userId -> ban expiry
    
    // Cleanup interval
    this._cleanupInterval = null;
    
    this.logger?.info?.('[UserModerationService] Initialized');
  }

  /**
   * Start periodic cleanup
   */
  startCleanup() {
    if (this._cleanupInterval) return;
    
    this._cleanupInterval = setInterval(() => {
      this._pruneExpiredData();
    }, 60000); // Every minute
    
    this.logger?.info?.('[UserModerationService] Started cleanup interval');
  }

  /**
   * Stop cleanup interval
   */
  stopCleanup() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // USER STATUS & TRUST
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Check user status before allowing action
   * @param {string} channelId - Channel identifier
   * @param {string} userId - User identifier
   * @param {Object} [options] - Check options
   * @returns {Promise<Object>} - { allowed, reason, trustLevel, cooldown? }
   */
  async checkUserStatus(channelId, userId, options = {}) {
    const { action = 'message', mediaType = null } = options;
    
    // Check ban status
    const banStatus = this._checkBan(channelId, userId);
    if (banStatus.banned) {
      return {
        allowed: false,
        reason: 'banned',
        banExpiresAt: banStatus.expiresAt,
        trustLevel: TrustLevel.NEW
      };
    }
    
    // Get or create user data
    const userData = await this._getOrCreateUser(channelId, userId);
    
    // Check rate limit
    if (action === 'message') {
      const rateLimitStatus = this._checkRateLimit(channelId, userId, userData.trustLevel);
      if (!rateLimitStatus.allowed) {
        return {
          allowed: false,
          reason: 'rate_limited',
          trustLevel: userData.trustLevel,
          cooldown: rateLimitStatus.cooldown
        };
      }
    }
    
    // Check media cooldown
    if (action === 'media' && mediaType) {
      const cooldownStatus = this._checkMediaCooldown(channelId, userId, mediaType, userData.trustLevel);
      if (!cooldownStatus.allowed) {
        return {
          allowed: false,
          reason: 'media_cooldown',
          trustLevel: userData.trustLevel,
          cooldown: cooldownStatus.cooldown
        };
      }
    }
    
    return {
      allowed: true,
      trustLevel: userData.trustLevel,
      messageCount: userData.messageCount,
      strikes: userData.strikes
    };
  }

  /**
   * Get user trust level
   * @param {string} channelId - Channel identifier
   * @param {string} userId - User identifier
   * @returns {Promise<string>} - Trust level
   */
  async getTrustLevel(channelId, userId) {
    const userData = await this._getOrCreateUser(channelId, userId);
    return userData.trustLevel;
  }

  /**
   * Update trust level manually
   * @param {string} channelId - Channel identifier
   * @param {string} userId - User identifier
   * @param {string} level - New trust level
   */
  async setTrustLevel(channelId, userId, level) {
    const userData = await this._getOrCreateUser(channelId, userId);
    userData.trustLevel = level;
    userData.trustLevelSetManually = true;
    await this._saveUser(channelId, userId, userData);
    
    this.logger?.info?.(`[ModerationService] Set trust level for ${userId} to ${level}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MESSAGE TRACKING
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Record a message from user
   * @param {string} channelId - Channel identifier
   * @param {string} userId - User identifier
   * @param {string} content - Message content
   * @returns {Promise<Object>} - { isSpam, reason? }
   */
  async recordMessage(channelId, userId, content) {
    const key = `${channelId}:${userId}`;
    
    // Check for spam
    const spamCheck = this._checkForSpam(key, content);
    if (spamCheck.isSpam) {
      await this.recordStrike(channelId, userId, StrikeReason.SPAM);
      return { isSpam: true, reason: spamCheck.reason };
    }
    
    // Update rate limit counter
    this._incrementRateLimit(channelId, userId);
    
    // Update user message count and trust level
    const userData = await this._getOrCreateUser(channelId, userId);
    userData.messageCount = (userData.messageCount || 0) + 1;
    userData.lastMessageAt = Date.now();
    
    // Auto-upgrade trust level
    if (!userData.trustLevelSetManually) {
      const newLevel = this._calculateTrustLevel(userData.messageCount);
      if (newLevel !== userData.trustLevel) {
        userData.trustLevel = newLevel;
        this.logger?.info?.(`[ModerationService] User ${userId} upgraded to ${newLevel}`);
      }
    }
    
    await this._saveUser(channelId, userId, userData);
    
    // Store recent message for spam detection
    this._storeRecentMessage(key, content);
    
    return { isSpam: false };
  }

  /**
   * Record media usage for cooldown tracking
   * @param {string} channelId - Channel identifier
   * @param {string} userId - User identifier
   * @param {string} mediaType - 'image' or 'video'
   */
  async recordMediaUsage(channelId, userId, mediaType) {
    const userData = await this._getOrCreateUser(channelId, userId);
    userData.lastMediaUsage = userData.lastMediaUsage || {};
    userData.lastMediaUsage[mediaType] = Date.now();
    await this._saveUser(channelId, userId, userData);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STRIKE SYSTEM
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Record a strike against a user
   * @param {string} channelId - Channel identifier
   * @param {string} userId - User identifier
   * @param {string} reason - Strike reason
   * @returns {Promise<Object>} - { strikeCount, banned }
   */
  async recordStrike(channelId, userId, reason) {
    const userData = await this._getOrCreateUser(channelId, userId);
    
    // Clean up expired strikes
    userData.strikes = (userData.strikes || []).filter(
      s => Date.now() - s.timestamp < this.config.strikes.strikeDecayMs
    );
    
    // Add new strike
    userData.strikes.push({
      reason,
      timestamp: Date.now()
    });
    
    const strikeCount = userData.strikes.length;
    let banned = false;
    
    // Check if should ban
    if (strikeCount >= this.config.strikes.maxStrikes) {
      await this.banUser(channelId, userId, this.config.strikes.banDurationMs, 'Too many strikes');
      banned = true;
    }
    
    await this._saveUser(channelId, userId, userData);
    
    this.logger?.warn?.(`[ModerationService] Strike recorded for ${userId}: ${reason} (${strikeCount}/${this.config.strikes.maxStrikes})`);
    
    return { strikeCount, banned };
  }

  /**
   * Clear strikes for a user
   * @param {string} channelId - Channel identifier
   * @param {string} userId - User identifier
   */
  async clearStrikes(channelId, userId) {
    const userData = await this._getOrCreateUser(channelId, userId);
    userData.strikes = [];
    await this._saveUser(channelId, userId, userData);
    
    this.logger?.info?.(`[ModerationService] Cleared strikes for ${userId}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // BAN SYSTEM
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Ban a user
   * @param {string} channelId - Channel identifier
   * @param {string} userId - User identifier
   * @param {number} durationMs - Ban duration in ms
   * @param {string} [reason] - Ban reason
   */
  async banUser(channelId, userId, durationMs, reason = 'Unspecified') {
    const key = `${channelId}:${userId}`;
    const expiresAt = Date.now() + durationMs;
    
    this._bans.set(key, {
      expiresAt,
      reason,
      timestamp: Date.now()
    });
    
    // Persist to database
    if (this.databaseService) {
      try {
        const collection = this.databaseService.getCollection('moderation_bans');
        await collection.updateOne(
          { channelId, userId: userId },
          { $set: { expiresAt: new Date(expiresAt), reason, createdAt: new Date() } },
          { upsert: true }
        );
      } catch (err) {
        this.logger?.error?.('[ModerationService] Failed to persist ban:', err.message);
      }
    }
    
    this.logger?.warn?.(`[ModerationService] Banned ${userId} until ${new Date(expiresAt).toISOString()}: ${reason}`);
  }

  /**
   * Unban a user
   * @param {string} channelId - Channel identifier
   * @param {string} userId - User identifier
   */
  async unbanUser(channelId, userId) {
    const key = `${channelId}:${userId}`;
    this._bans.delete(key);
    
    // Remove from database
    if (this.databaseService) {
      try {
        const collection = this.databaseService.getCollection('moderation_bans');
        await collection.deleteOne({ channelId, userId: userId });
      } catch (err) {
        this.logger?.error?.('[ModerationService] Failed to remove ban:', err.message);
      }
    }
    
    this.logger?.info?.(`[ModerationService] Unbanned ${userId}`);
  }

  /**
   * Check if user is banned
   * @param {string} channelId - Channel identifier
   * @param {string} userId - User identifier
   * @returns {Object} - { banned, expiresAt?, reason? }
   */
  isUserBanned(channelId, userId) {
    return this._checkBan(channelId, userId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE METHODS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get or create user data
   * @private
   */
  async _getOrCreateUser(channelId, userId) {
    const key = `${channelId}:${userId}`;
    
    // Check cache first
    if (this._userCache.has(key)) {
      return this._userCache.get(key);
    }
    
    // Try to load from database
    let userData = null;
    if (this.databaseService) {
      try {
        const collection = this.databaseService.getCollection('moderation_users');
        userData = await collection.findOne({ channelId, userId: userId });
      } catch (err) {
        this.logger?.error?.('[ModerationService] Failed to load user:', err.message);
      }
    }
    
    // Create new user if not found
    if (!userData) {
      userData = {
        userId: userId,
        channelId,
        trustLevel: TrustLevel.NEW,
        messageCount: 0,
        strikes: [],
        firstSeen: Date.now(),
        lastMessageAt: null,
        lastMediaUsage: {}
      };
    }
    
    this._userCache.set(key, userData);
    return userData;
  }

  /**
   * Save user data
   * @private
   */
  async _saveUser(channelId, userId, userData) {
    const key = `${channelId}:${userId}`;
    this._userCache.set(key, userData);
    
    // Persist to database (non-blocking)
    if (this.databaseService) {
      this.databaseService.getCollection('moderation_users')
        .updateOne(
          { channelId, userId: userId },
          { $set: { ...userData, updatedAt: new Date() } },
          { upsert: true }
        )
        .catch(err => {
          this.logger?.error?.('[ModerationService] Failed to save user:', err.message);
        });
    }
  }

  /**
   * Calculate trust level based on message count
   * @private
   */
  _calculateTrustLevel(messageCount) {
    const thresholds = this.config.trustThresholds;
    
    if (messageCount >= thresholds[TrustLevel.VERIFIED]) {
      return TrustLevel.VERIFIED;
    }
    if (messageCount >= thresholds[TrustLevel.TRUSTED]) {
      return TrustLevel.TRUSTED;
    }
    return TrustLevel.NEW;
  }

  /**
   * Check rate limit
   * @private
   */
  _checkRateLimit(channelId, userId, trustLevel) {
    const key = `${channelId}:${userId}`;
    const now = Date.now();
    const windowMs = this.config.rateLimit.windowMs;
    const maxMessages = this.config.rateLimit.maxMessages[trustLevel] || 5;
    
    let rateData = this._rateLimit.get(key);
    
    // Reset window if expired
    if (!rateData || now - rateData.windowStart > windowMs) {
      rateData = { windowStart: now, count: 0 };
    }
    
    if (rateData.count >= maxMessages) {
      const cooldown = windowMs - (now - rateData.windowStart);
      return { allowed: false, cooldown };
    }
    
    this._rateLimit.set(key, rateData);
    return { allowed: true };
  }

  /**
   * Increment rate limit counter
   * @private
   */
  _incrementRateLimit(channelId, userId) {
    const key = `${channelId}:${userId}`;
    const rateData = this._rateLimit.get(key) || { windowStart: Date.now(), count: 0 };
    rateData.count++;
    this._rateLimit.set(key, rateData);
  }

  /**
   * Check media cooldown
   * @private
   */
  _checkMediaCooldown(channelId, userId, mediaType, trustLevel) {
    const cooldownMs = this.config.mediaCooldown[mediaType]?.[trustLevel] || 30000;
    
    const userData = this._userCache.get(`${channelId}:${userId}`);
    const lastUsage = userData?.lastMediaUsage?.[mediaType] || 0;
    const elapsed = Date.now() - lastUsage;
    
    if (elapsed < cooldownMs) {
      return { allowed: false, cooldown: cooldownMs - elapsed };
    }
    
    return { allowed: true };
  }

  /**
   * Check for spam
   * @private
   */
  _checkForSpam(key, content) {
    const recent = this._recentMessages.get(key) || [];
    const now = Date.now();
    const windowMs = this.config.spam.duplicateWindowMs;
    
    // Filter to recent window
    const recentInWindow = recent.filter(m => now - m.timestamp < windowMs);
    
    // Check for duplicate messages
    const duplicates = recentInWindow.filter(m => m.content === content);
    if (duplicates.length >= this.config.spam.duplicateThreshold) {
      return { isSpam: true, reason: 'duplicate_message' };
    }
    
    // Check for too fast messaging
    if (recentInWindow.length > 0) {
      const lastMessage = recentInWindow[recentInWindow.length - 1];
      if (now - lastMessage.timestamp < this.config.spam.minMessageIntervalMs) {
        return { isSpam: true, reason: 'too_fast' };
      }
    }
    
    return { isSpam: false };
  }

  /**
   * Store recent message for spam detection
   * @private
   */
  _storeRecentMessage(key, content) {
    const recent = this._recentMessages.get(key) || [];
    recent.push({ content, timestamp: Date.now() });
    
    // Keep only last 10 messages
    if (recent.length > 10) {
      recent.shift();
    }
    
    this._recentMessages.set(key, recent);
  }

  /**
   * Check ban status
   * @private
   */
  _checkBan(channelId, userId) {
    const key = `${channelId}:${userId}`;
    const ban = this._bans.get(key);
    
    if (!ban) {
      return { banned: false };
    }
    
    if (Date.now() >= ban.expiresAt) {
      this._bans.delete(key);
      return { banned: false };
    }
    
    return {
      banned: true,
      expiresAt: ban.expiresAt,
      reason: ban.reason
    };
  }

  /**
   * Prune expired data from caches
   * @private
   */
  _pruneExpiredData() {
    const now = Date.now();
    
    // Prune expired bans
    for (const [key, ban] of this._bans.entries()) {
      if (now >= ban.expiresAt) {
        this._bans.delete(key);
      }
    }
    
    // Prune old rate limit windows
    const windowMs = this.config.rateLimit.windowMs;
    for (const [key, data] of this._rateLimit.entries()) {
      if (now - data.windowStart > windowMs * 2) {
        this._rateLimit.delete(key);
      }
    }
    
    // Prune old recent messages
    const messageWindowMs = this.config.spam.duplicateWindowMs;
    for (const [key, messages] of this._recentMessages.entries()) {
      const filtered = messages.filter(m => now - m.timestamp < messageWindowMs);
      if (filtered.length === 0) {
        this._recentMessages.delete(key);
      } else {
        this._recentMessages.set(key, filtered);
      }
    }
    
    // Prune inactive users from cache (keep only last 24 hours)
    const maxInactive = 24 * 60 * 60 * 1000;
    for (const [key, userData] of this._userCache.entries()) {
      const lastActive = userData.lastMessageAt || userData.firstSeen;
      if (now - lastActive > maxInactive) {
        this._userCache.delete(key);
      }
    }
  }

  /**
   * Deep merge configuration
   * @private
   */
  _mergeConfig(defaults, overrides) {
    const result = { ...defaults };
    for (const key of Object.keys(overrides)) {
      if (typeof overrides[key] === 'object' && !Array.isArray(overrides[key])) {
        result[key] = this._mergeConfig(defaults[key] || {}, overrides[key]);
      } else {
        result[key] = overrides[key];
      }
    }
    return result;
  }

  /**
   * Get service statistics
   * @returns {Object} - Stats
   */
  getStats() {
    return {
      cachedUsers: this._userCache.size,
      activeBans: this._bans.size,
      rateLimitEntries: this._rateLimit.size,
      recentMessageEntries: this._recentMessages.size
    };
  }
}

export default UserModerationService;
