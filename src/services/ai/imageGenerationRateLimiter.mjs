/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file imageGenerationRateLimiter.mjs
 * @description Rate limiter for AI image generation to control costs and prevent spam
 */

/**
 * Rate limiter for image generation from AI models.
 * Tracks per-avatar and global limits to control costs.
 */
export class ImageGenerationRateLimiter {
  constructor({ logger, configService } = {}) {
    this.logger = logger || console;
    this.configService = configService;

    // Per-avatar tracking: Map<avatarId, { count: number, lastGenerated: number, timestamps: number[] }>
    this._avatarLimits = new Map();
    
    // Global tracking
    this._globalCount = 0;
    this._globalTimestamps = [];
    
    // Default configuration
    this._defaults = {
      // Per-avatar limits
      perAvatarPerHour: 3,
      perAvatarPerDay: 10,
      perAvatarCooldownMs: 5 * 60 * 1000, // 5 minutes minimum between images
      
      // Global limits
      globalPerHour: 20,
      globalPerDay: 100,
      
      // Probability controls
      baseImageProbability: 0.15, // 15% base chance to generate image when model supports it
      contextBoostProbability: 0.3, // +30% when context suggests visual content
      
      // Cost thresholds (USD)
      maxCostPerImage: 0.10,
      dailyCostBudget: 5.00,
    };
    
    this._dailyCost = 0;
    this._dailyCostResetAt = Date.now();
  }

  /**
   * Get current configuration merged with defaults.
   */
  _getConfig() {
    const cfg = this.configService?.get?.('imageGeneration') || {};
    return { ...this._defaults, ...cfg };
  }

  /**
   * Clean up old timestamps from tracking arrays.
   */
  _cleanupTimestamps(timestamps, maxAgeMs) {
    const cutoff = Date.now() - maxAgeMs;
    return timestamps.filter(ts => ts > cutoff);
  }

  /**
   * Get or create avatar tracking record.
   */
  _getAvatarRecord(avatarId) {
    if (!this._avatarLimits.has(avatarId)) {
      this._avatarLimits.set(avatarId, {
        count: 0,
        lastGenerated: 0,
        hourlyTimestamps: [],
        dailyTimestamps: [],
      });
    }
    return this._avatarLimits.get(avatarId);
  }

  /**
   * Check if image generation is allowed for an avatar.
   * @param {string} avatarId 
   * @param {object} options 
   * @returns {{ allowed: boolean, reason?: string, waitMs?: number }}
   */
  checkAllowed(avatarId, { estimatedCost = 0.01 } = {}) {
    const config = this._getConfig();
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;

    // Reset daily cost tracking if needed
    if (now - this._dailyCostResetAt > 24 * 60 * 60 * 1000) {
      this._dailyCost = 0;
      this._dailyCostResetAt = now;
    }

    // Check daily cost budget
    if (this._dailyCost + estimatedCost > config.dailyCostBudget) {
      return { allowed: false, reason: 'daily_cost_budget_exceeded' };
    }

    // Check per-image cost
    if (estimatedCost > config.maxCostPerImage) {
      return { allowed: false, reason: 'image_cost_too_high' };
    }

    // Clean up global timestamps
    this._globalTimestamps = this._cleanupTimestamps(this._globalTimestamps, 24 * 60 * 60 * 1000);
    const globalHourly = this._globalTimestamps.filter(ts => ts > hourAgo).length;
    const globalDaily = this._globalTimestamps.length;

    // Check global limits
    if (globalHourly >= config.globalPerHour) {
      return { allowed: false, reason: 'global_hourly_limit', waitMs: 60 * 60 * 1000 - (now - Math.min(...this._globalTimestamps.filter(ts => ts > hourAgo))) };
    }
    if (globalDaily >= config.globalPerDay) {
      return { allowed: false, reason: 'global_daily_limit' };
    }

    // Check avatar-specific limits
    const record = this._getAvatarRecord(avatarId);
    
    // Clean up avatar timestamps
    record.hourlyTimestamps = this._cleanupTimestamps(record.hourlyTimestamps, 60 * 60 * 1000);
    record.dailyTimestamps = this._cleanupTimestamps(record.dailyTimestamps, 24 * 60 * 60 * 1000);

    // Check cooldown
    const timeSinceLast = now - record.lastGenerated;
    if (timeSinceLast < config.perAvatarCooldownMs) {
      return { allowed: false, reason: 'avatar_cooldown', waitMs: config.perAvatarCooldownMs - timeSinceLast };
    }

    // Check hourly limit
    if (record.hourlyTimestamps.length >= config.perAvatarPerHour) {
      return { allowed: false, reason: 'avatar_hourly_limit', waitMs: 60 * 60 * 1000 - timeSinceLast };
    }

    // Check daily limit
    if (record.dailyTimestamps.length >= config.perAvatarPerDay) {
      return { allowed: false, reason: 'avatar_daily_limit' };
    }

    return { allowed: true };
  }

  /**
   * Record that an image was generated.
   * @param {string} avatarId 
   * @param {object} options 
   */
  recordGeneration(avatarId, { cost = 0.01 } = {}) {
    const now = Date.now();
    const record = this._getAvatarRecord(avatarId);
    
    record.count++;
    record.lastGenerated = now;
    record.hourlyTimestamps.push(now);
    record.dailyTimestamps.push(now);
    
    this._globalTimestamps.push(now);
    this._globalCount++;
    this._dailyCost += cost;

    this.logger?.debug?.(`[ImageRateLimiter] Recorded generation for ${avatarId}, daily cost: $${this._dailyCost.toFixed(4)}`);
  }

  /**
   * Determine if an avatar should attempt image generation based on probability and context.
   * @param {string} avatarId 
   * @param {object} context 
   * @returns {{ shouldGenerate: boolean, reason?: string }}
   */
  shouldGenerateImage(avatarId, { messageContent = '', isExplicitRequest = false } = {}) {
    const config = this._getConfig();
    
    // Check rate limits first
    const limitCheck = this.checkAllowed(avatarId);
    if (!limitCheck.allowed) {
      return { shouldGenerate: false, reason: limitCheck.reason };
    }

    // Explicit requests always generate (if limits allow)
    if (isExplicitRequest) {
      return { shouldGenerate: true, reason: 'explicit_request' };
    }

    // Calculate probability based on context
    let probability = config.baseImageProbability;
    
    // Boost probability for visual-related content
    const visualKeywords = ['picture', 'image', 'show', 'draw', 'visualize', 'imagine', 'look like', 'see', 'photo', 'art', 'illustration'];
    const contentLower = messageContent.toLowerCase();
    if (visualKeywords.some(kw => contentLower.includes(kw))) {
      probability += config.contextBoostProbability;
    }

    // Roll the dice
    const roll = Math.random();
    if (roll < probability) {
      return { shouldGenerate: true, reason: 'probability_roll', probability };
    }

    return { shouldGenerate: false, reason: 'probability_miss', probability };
  }

  /**
   * Get statistics for monitoring.
   */
  getStats() {
    return {
      globalCount: this._globalCount,
      globalHourly: this._globalTimestamps.filter(ts => ts > Date.now() - 60 * 60 * 1000).length,
      globalDaily: this._globalTimestamps.filter(ts => ts > Date.now() - 24 * 60 * 60 * 1000).length,
      dailyCost: this._dailyCost,
      avatarCount: this._avatarLimits.size,
    };
  }

  /**
   * Clean up expired records to prevent memory leaks.
   */
  cleanup() {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;
    
    // Clean up avatar records that haven't been used in 24 hours
    for (const [avatarId, record] of this._avatarLimits.entries()) {
      if (record.lastGenerated < dayAgo && record.dailyTimestamps.length === 0) {
        this._avatarLimits.delete(avatarId);
      }
    }
    
    // Clean up global timestamps
    this._globalTimestamps = this._cleanupTimestamps(this._globalTimestamps, 24 * 60 * 60 * 1000);
  }
}

export default ImageGenerationRateLimiter;
