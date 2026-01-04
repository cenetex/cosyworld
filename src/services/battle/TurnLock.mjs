/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * TurnLock - Combat turn state machine with mutex locks
 * 
 * Implements the "Turn Lock" pattern to prevent race conditions in turn-based combat.
 * Ensures that:
 * 1. Only one turn can be active at a time
 * 2. Player turns block AI execution until completed
 * 3. State transitions are atomic and logged
 */

/**
 * Turn states in the combat state machine
 */
export const TURN_STATES = {
  /** No active turn, ready for next */
  IDLE: 'idle',
  /** Turn announcement being sent */
  ANNOUNCING: 'announcing',
  /** Player turn, waiting for button/command input */
  AWAITING_INPUT: 'awaiting_input',
  /** Action is being executed */
  EXECUTING: 'executing',
  /** Post-action cleanup (damage application, death checks) */
  COMPLETING: 'completing',
  /** Transitioning to next turn */
  ADVANCING: 'advancing',
  /** Combat has ended */
  ENDED: 'ended'
};

/**
 * Valid state transitions
 */
const VALID_TRANSITIONS = {
  [TURN_STATES.IDLE]: [TURN_STATES.ANNOUNCING, TURN_STATES.ENDED],
  [TURN_STATES.ANNOUNCING]: [TURN_STATES.AWAITING_INPUT, TURN_STATES.EXECUTING, TURN_STATES.IDLE],
  [TURN_STATES.AWAITING_INPUT]: [TURN_STATES.EXECUTING, TURN_STATES.ADVANCING, TURN_STATES.IDLE, TURN_STATES.ENDED],
  [TURN_STATES.EXECUTING]: [TURN_STATES.COMPLETING, TURN_STATES.ADVANCING, TURN_STATES.ENDED],
  [TURN_STATES.COMPLETING]: [TURN_STATES.ADVANCING, TURN_STATES.ENDED],
  [TURN_STATES.ADVANCING]: [TURN_STATES.IDLE, TURN_STATES.ANNOUNCING, TURN_STATES.ENDED],
  [TURN_STATES.ENDED]: [] // Terminal state
};

/**
 * Lock expiry times by state (prevents deadlocks)
 */
const STATE_TIMEOUTS_MS = {
  [TURN_STATES.ANNOUNCING]: 5000,      // 5 seconds to send announcement
  [TURN_STATES.AWAITING_INPUT]: 60000, // 60 seconds for player to act
  [TURN_STATES.EXECUTING]: 30000,      // 30 seconds for action execution
  [TURN_STATES.COMPLETING]: 10000,     // 10 seconds for cleanup
  [TURN_STATES.ADVANCING]: 5000        // 5 seconds to advance turn
};

export class TurnLock {
  constructor({ logger } = {}) {
    this.logger = logger || console;
    
    /**
     * Lock storage: channelId -> LockState
     * @type {Map<string, Object>}
     */
    this.locks = new Map();
  }

  /**
   * Get current lock state for a channel
   * @param {string} channelId 
   * @returns {Object|null} Lock state or null if no lock
   */
  getLock(channelId) {
    const lock = this.locks.get(channelId);
    if (!lock) return null;

    // Check for expired lock
    if (this._isExpired(lock)) {
      this.logger?.warn?.(`[TurnLock] Expired lock cleared for ${channelId} (was: ${lock.state})`);
      this.locks.delete(channelId);
      return null;
    }

    return lock;
  }

  /**
   * Get current state for a channel
   * @param {string} channelId 
   * @returns {string} Current state (IDLE if no lock)
   */
  getState(channelId) {
    const lock = this.getLock(channelId);
    return lock?.state || TURN_STATES.IDLE;
  }

  /**
   * Check if a channel's turn is locked (any active state)
   * @param {string} channelId 
   * @returns {boolean}
   */
  isLocked(channelId) {
    const state = this.getState(channelId);
    return state !== TURN_STATES.IDLE && state !== TURN_STATES.ENDED;
  }

  /**
   * Check if a channel is awaiting player input
   * @param {string} channelId 
   * @returns {boolean}
   */
  isAwaitingInput(channelId) {
    return this.getState(channelId) === TURN_STATES.AWAITING_INPUT;
  }

  /**
   * Attempt to acquire a lock with a specific state
   * @param {string} channelId 
   * @param {string} state - Target state from TURN_STATES
   * @param {Object} metadata - Additional context
   * @returns {boolean} True if lock acquired, false if blocked
   */
  acquire(channelId, state, metadata = {}) {
    const currentState = this.getState(channelId);
    
    // Validate transition
    if (!this._isValidTransition(currentState, state)) {
      this.logger?.warn?.(
        `[TurnLock] Invalid transition blocked: ${currentState} -> ${state} for ${channelId}`
      );
      return false;
    }

    // Create/update lock
    this.locks.set(channelId, {
      state,
      acquiredAt: Date.now(),
      combatantId: metadata.combatantId || null,
      combatantName: metadata.combatantName || null,
      reason: metadata.reason || '',
      previousState: currentState
    });

    this.logger?.debug?.(
      `[TurnLock] Acquired: ${currentState} -> ${state} for ${channelId}` +
      (metadata.combatantName ? ` (${metadata.combatantName})` : '')
    );

    return true;
  }

  /**
   * Transition from current state to a new state
   * @param {string} channelId 
   * @param {string} newState 
   * @param {Object} metadata 
   * @returns {boolean} True if transition succeeded
   */
  transition(channelId, newState, metadata = {}) {
    return this.acquire(channelId, newState, metadata);
  }

  /**
   * Release the lock (transition to IDLE)
   * @param {string} channelId 
   * @param {string} reason - Why the lock is being released
   */
  release(channelId, reason = 'manual') {
    const lock = this.getLock(channelId);
    if (lock) {
      this.logger?.debug?.(
        `[TurnLock] Released: ${lock.state} -> IDLE for ${channelId} (reason: ${reason})`
      );
    }
    this.locks.delete(channelId);
  }

  /**
   * Force release (for error recovery)
   * @param {string} channelId 
   */
  forceRelease(channelId) {
    const lock = this.locks.get(channelId);
    if (lock) {
      this.logger?.warn?.(
        `[TurnLock] Force released: ${lock.state} for ${channelId}`
      );
    }
    this.locks.delete(channelId);
  }

  /**
   * Mark combat as ended
   * @param {string} channelId 
   */
  end(channelId) {
    this.locks.set(channelId, {
      state: TURN_STATES.ENDED,
      acquiredAt: Date.now(),
      reason: 'combat_ended'
    });
    
    // Clean up after a delay
    setTimeout(() => {
      const lock = this.locks.get(channelId);
      if (lock?.state === TURN_STATES.ENDED) {
        this.locks.delete(channelId);
      }
    }, 60000); // Keep ENDED state for 1 minute for queries
  }

  /**
   * Check if a state transition is valid
   * @private
   */
  _isValidTransition(from, to) {
    // Allow any transition from IDLE
    if (from === TURN_STATES.IDLE) return true;
    
    // Check valid transitions
    const validTargets = VALID_TRANSITIONS[from] || [];
    return validTargets.includes(to);
  }

  /**
   * Check if a lock has expired
   * @private
   */
  _isExpired(lock) {
    if (!lock?.acquiredAt) return true;
    
    const timeout = STATE_TIMEOUTS_MS[lock.state];
    if (!timeout) return false; // No timeout for this state
    
    return Date.now() - lock.acquiredAt > timeout;
  }

  /**
   * Get all active locks (for debugging)
   * @returns {Array<Object>}
   */
  getAllLocks() {
    const result = [];
    for (const [channelId, lock] of this.locks.entries()) {
      if (!this._isExpired(lock)) {
        result.push({
          channelId,
          ...lock,
          age: Date.now() - lock.acquiredAt
        });
      }
    }
    return result;
  }

  /**
   * Clean up expired locks (call periodically)
   */
  cleanup() {
    const expired = [];
    
    for (const [channelId, lock] of this.locks.entries()) {
      if (this._isExpired(lock)) {
        expired.push(channelId);
      }
    }
    
    for (const channelId of expired) {
      this.logger?.debug?.(`[TurnLock] Cleanup: removing expired lock for ${channelId}`);
      this.locks.delete(channelId);
    }
    
    return expired.length;
  }
}

export default TurnLock;
