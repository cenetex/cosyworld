import { COMBAT_CONSTANTS } from './CombatConstants.mjs';

/**
 * Manages turn-based combat flow:
 * - Initiative setup
 * - Turn advancement
 * - Turn scheduling
 * - End condition evaluation
 */
export class CombatTurnManager {
  constructor({ logger, coreHelpers }) {
    this.logger = logger || console;
    this.coreHelpers = coreHelpers;
  }

  /**
   * Rebuild and sort initiative order
   * @param {Object} encounter - Encounter
   * @param {Object} options - { preserveCurrent }
   */
  rebuildInitiativeOrder(encounter, { preserveCurrent = false } = {}) {
    if (!encounter) return;
    const currentId = preserveCurrent ? this.coreHelpers.normalizeId(this.coreHelpers.getCurrentTurnAvatarId(encounter)) : null;
    encounter.initiativeOrder = encounter.combatants
      .slice()
      .sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0))
      .map(c => this.coreHelpers.normalizeId(c.avatarId));
    if (preserveCurrent && currentId) {
      const idx = encounter.initiativeOrder.indexOf(currentId);
      encounter.currentTurnIndex = Math.max(0, idx);
    }
  }

  /**
   * Mark a hostile action (to track for idle end condition)
   * @param {Object} encounter - Encounter
   */
  markHostile(encounter) {
    encounter.lastHostileAt = Date.now();
  }

  /**
   * Evaluate if combat should end (win conditions, idle, max rounds)
   * @param {Object} encounter - Encounter
   * @returns {boolean} - True if combat ended
   */
  evaluateEnd(encounter, { turnTimeoutMs, idleEndRounds, logger } = {}) {
    if (encounter.state !== 'active') return false;

    logger = logger || this.logger;

    // Maximum rounds limit
    const maxRounds = Number(process.env.COMBAT_MAX_ROUNDS || COMBAT_CONSTANTS.DEFAULT_MAX_ROUNDS);
    if (encounter.round >= maxRounds) {
      logger?.info?.(`[CombatEncounter][${encounter.channelId}] Max rounds (${maxRounds}) reached - ending combat`);
      return true; // Let caller handle endEncounter
    }

    // Basic rule: if <=1 conscious combatant remains
    const alive = encounter.combatants.filter(c => !this.coreHelpers.isKnockedOut(c));
    if (alive.length <= 1) {
      logger?.info?.(`[CombatEncounter][${encounter.channelId}] Only ${alive.length} combatant(s) alive - ending combat`);
      return true;
    }

    // End if all alive combatants are defending
    if (alive.length >= 2 && alive.every(c => c.isDefending)) {
      logger?.info?.(`[CombatEncounter][${encounter.channelId}] All combatants defending - ending combat`);
      return true;
    }

    // Idle logic: no hostile actions for N rounds
    if (encounter.lastHostileAt && turnTimeoutMs && idleEndRounds) {
      const roundsSince = (Date.now() - encounter.lastHostileAt) / turnTimeoutMs;
      if (roundsSince >= idleEndRounds) {
        logger?.info?.(`[CombatEncounter][${encounter.channelId}] Combat idle for ${idleEndRounds} rounds - ending`);
        return true;
      }
    }

    return false;
  }

  /**
   * Get reason why encounter ended
   * @param {Object} encounter - Ended encounter
   * @returns {string}
   */
  formatEndReason(encounter) {
    const reason = encounter.endReason || 'unknown';
    const reasons = {
      max_rounds: 'Maximum rounds reached',
      single_combatant: 'Only one combatant remains',
      idle: 'Combat became idle',
      flee: 'A combatant fled',
      all_defending: 'All combatants defending',
    };
    return reasons[reason] || `Ended: ${reason}`;
  }
}

export default CombatTurnManager;
