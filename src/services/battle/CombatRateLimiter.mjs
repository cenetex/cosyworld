import { COMBAT_CONSTANTS } from './CombatConstants.mjs';

/**
 * Rate limiter for combat actions to prevent spam
 */
export class CombatRateLimiter {
  constructor(maxActionsPerMinute = COMBAT_CONSTANTS.DEFAULT_MAX_ACTIONS_PER_MINUTE) {
    this.actions = new Map(); // avatarId -> [timestamps]
    this.maxActions = maxActionsPerMinute;
    this.windowMs = COMBAT_CONSTANTS.RATE_LIMIT_WINDOW_MS;
    this.cleanupInterval = null;

    // Cleanup old entries every minute
    this.cleanupInterval = setInterval(() => {
      this._cleanup();
    }, this.windowMs);

    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Check if an avatar can perform a combat action
   * @param {string} avatarId - The avatar ID
   * @returns {boolean} - True if action is allowed, false if rate limited
   */
  canAct(avatarId) {
    if (!avatarId) return false;

    const now = Date.now();
    const actions = this.actions.get(avatarId) || [];

    // Remove actions outside the window
    const recentActions = actions.filter(timestamp => now - timestamp < this.windowMs);

    if (recentActions.length >= this.maxActions) {
      return false; // Rate limited
    }

    // Record this action
    recentActions.push(now);
    this.actions.set(avatarId, recentActions);

    return true;
  }

  /**
   * Get remaining actions for an avatar in current window
   * @param {string} avatarId - The avatar ID
   * @returns {number} - Number of remaining actions allowed
   */
  getRemainingActions(avatarId) {
    if (!avatarId) return 0;

    const now = Date.now();
    const actions = this.actions.get(avatarId) || [];
    const recentActions = actions.filter(timestamp => now - timestamp < this.windowMs);

    return Math.max(0, this.maxActions - recentActions.length);
  }

  /**
   * Reset rate limit for an avatar
   * @param {string} avatarId - The avatar ID
   */
  reset(avatarId) {
    if (avatarId) {
      this.actions.delete(avatarId);
    }
  }

  /**
   * Clean up old entries from memory
   * @private
   */
  _cleanup() {
    const now = Date.now();
    const threshold = now - this.windowMs;

    for (const [avatarId, actions] of this.actions.entries()) {
      const recentActions = actions.filter(timestamp => timestamp > threshold);

      if (recentActions.length === 0) {
        this.actions.delete(avatarId);
      } else {
        this.actions.set(avatarId, recentActions);
      }
    }
  }

  /**
   * Destroy the rate limiter and cleanup resources
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.actions.clear();
  }
}

export default CombatRateLimiter;
