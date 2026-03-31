import { COMBAT_CONSTANTS } from './CombatConstants.mjs';

/**
 * Manages combat state changes:
 * - Damage application
 * - Healing
 * - Attack result handling
 * - Knockout state
 */
export class CombatStateManager {
  constructor({ logger, coreHelpers }) {
    this.logger = logger || console;
    this.coreHelpers = coreHelpers;
  }

  /**
   * Record damage to a combatant
   * @param {Object} encounter - Encounter
   * @param {string} avatarId - Avatar ID
   * @param {number} amount - Damage amount
   */
  applyDamage(encounter, avatarId, amount) {
    const c = this.coreHelpers.getCombatant(encounter, avatarId);
    if (!c) return;
    c.currentHp = Math.max(0, (c.currentHp ?? 0) - amount);
    if (c.currentHp === 0 && !c.conditions.includes('unconscious')) {
      c.conditions.push('unconscious');
    }
  }

  /**
   * Apply healing to a combatant
   * @param {Object} encounter - Encounter
   * @param {string} avatarId - Avatar ID
   * @param {number} amount - Healing amount
   * @returns {number} - Actual healed amount
   */
  applyHeal(encounter, avatarId, amount) {
    try {
      const c = this.coreHelpers.getCombatant(encounter, avatarId);
      if (!c || typeof amount !== 'number' || amount <= 0) return 0;
      const before = Math.max(0, c.currentHp || 0);
      const maxHp = Math.max(1, c.maxHp || c.ref?.stats?.hp || COMBAT_CONSTANTS.DEFAULT_HP);
      c.currentHp = Math.min(maxHp, before + amount);
      return c.currentHp - before;
    } catch {
      return 0;
    }
  }

  /**
   * Apply attack result state changes (knockout, damage marking)
   * @param {Object} encounter - Encounter
   * @param {Object} options - { attackerId, defenderId, result }
   */
  applyAttackState(encounter, { attackerId, defenderId, result }) {
    try {
      const attId = this.coreHelpers.normalizeId(attackerId);
      const defId = this.coreHelpers.normalizeId(defenderId);

      // Apply damage
      if (result?.damage && (result.result === 'hit' || result.result === 'knockout' || result.result === 'dead')) {
        this.applyDamage(encounter, defId, result.damage);
        encounter.lastHostileAt = Date.now();
      }

      // Apply knockout state
      if (result?.result === 'knockout' || result?.result === 'dead') {
        try {
          encounter.knockout = { attackerId: attId, defenderId: defId, result: result?.result };
          const def = this.coreHelpers.getCombatant(encounter, defId);
          if (def) {
            def.currentHp = 0;
            if (!def.conditions?.includes('unconscious')) {
              def.conditions = [...(def.conditions || []), 'unconscious'];
            }
          }
        } catch (e) {
          this.logger.warn?.(`[CombatEncounter] Failed to apply KO state: ${e.message}`);
        }
      }

      // Record last action
      try {
        const attacker = this.coreHelpers.getCombatant(encounter, attId);
        const defender = this.coreHelpers.getCombatant(encounter, defId);
        encounter.lastAction = {
          attackerId: attId,
          attackerName: attacker?.name,
          defenderId: defId,
          defenderName: defender?.name,
          result: result?.result,
          damage: result?.damage || 0,
          attackRoll: result?.attackRoll,
          armorClass: result?.armorClass,
          critical: !!result?.critical,
        };
        encounter.lastActionAt = Date.now();
      } catch (e) {
        this.logger.warn?.(`[CombatEncounter] Failed to record last action: ${e.message}`);
      }
    } catch (e) {
      this.logger.error?.(`[CombatEncounter] applyAttackState error: ${e.message}`);
    }
  }

  /**
   * Capture battle moment for video recap
   * @param {Object} encounter - Encounter
   * @param {Object} options - { attacker, defender, result, dialogue }
   */
  captureBattleMoment(encounter, { attacker, defender, result, dialogue }) {
    if (!encounter.battleRecap) {
      encounter.battleRecap = { rounds: [] };
    }
    if (!encounter.battleRecap.rounds[encounter.round - 1]) {
      encounter.battleRecap.rounds[encounter.round - 1] = { moments: [] };
    }

    const moment = {
      timestamp: Date.now(),
      attacker: attacker?.name,
      defender: defender?.name,
      result: result?.result,
      damage: result?.damage,
      attackRoll: result?.attackRoll,
      ac: result?.armorClass,
      critical: result?.critical,
      dialogue: dialogue || null,
    };

    encounter.battleRecap.rounds[encounter.round - 1].moments.push(moment);
  }
}

export default CombatStateManager;
