import { COMBAT_CONSTANTS } from './CombatConstants.mjs';

/**
 * Core helper methods for combat state:
 * - Stat calculations
 * - Knockout checks
 * - ID normalization
 * - Avatar retrieval
 */
export class CombatCoreHelpers {
  constructor({ logger, avatarService }) {
    this.logger = logger || console;
    this.avatarService = avatarService;
  }

  /**
   * Calculate DEX modifier from avatar stats
   * @param {Object} stats - Avatar stats object
   * @returns {number} - DEX modifier
   */
  dexModFromStats(stats) {
    const dex = Number(stats?.dexterity ?? COMBAT_CONSTANTS.DEFAULT_DEX);
    return Math.floor((dex - COMBAT_CONSTANTS.DEFAULT_DEX) / 2);
  }

  /**
   * Check if combatant is knocked out or dead
   * @param {Object} combatant - Combatant object
   * @returns {boolean}
   */
  isKnockedOut(combatant) {
    if (!combatant) return true;
    const now = Date.now();
    return (combatant.currentHp || 0) <= 0 ||
           combatant.conditions?.includes('unconscious') ||
           combatant.ref?.status === 'dead' ||
           combatant.ref?.status === 'knocked_out' ||
           (combatant.ref?.knockedOutUntil && now < combatant.ref.knockedOutUntil);
  }

  /**
   * Normalize avatar IDs for comparison
   * @param {string|Object} id - ID or object with ID
   * @returns {string|null}
   */
  normalizeId(id) {
    if (!id) return null;
    if (typeof id === 'object' && id.id) return String(id.id).toLowerCase();
    return String(id).toLocaleLowerCase();
  }

  /**
   * Extract avatar ID from avatar object
   * @param {Object} avatar - Avatar object
   * @returns {string|null}
   */
  getAvatarId(avatar) {
    if (!avatar) return null;
    if (typeof avatar === 'string') return this.normalizeId(avatar);
    return this.normalizeId(avatar.id || avatar.avatarId);
  }

  /**
   * Find combatant in encounter by avatar ID
   * @param {Object} encounter - Encounter object
   * @param {string|Object} avatarId - Avatar ID to search for
   * @returns {Object|null}
   */
  getCombatant(encounter, avatarId) {
    if (!encounter?.combatants || !avatarId) return null;
    const normalizedId = this.normalizeId(avatarId);
    return encounter.combatants.find(c => this.normalizeId(c.avatarId) === normalizedId) || null;
  }

  /**
   * Get current turn avatar ID
   * @param {Object} encounter - Encounter object
   * @returns {string|null}
   */
  getCurrentTurnAvatarId(encounter) {
    if (!Array.isArray(encounter?.initiativeOrder)) return null;
    const idx = Math.max(0, Math.min(encounter.initiativeOrder.length - 1, Number(encounter.currentTurnIndex) || 0));
    return encounter.initiativeOrder[idx] || null;
  }

  /**
   * Check if it's currently a specific avatar's turn
   * @param {Object} encounter - Encounter object
   * @param {string|Object} avatarId - Avatar ID to check
   * @returns {boolean}
   */
  isTurn(encounter, avatarId) {
    if (!encounter || encounter.state !== 'active') return false;
    const currentId = this.normalizeId(this.getCurrentTurnAvatarId(encounter));
    const targetId = this.normalizeId(avatarId);
    return currentId === targetId;
  }

  /**
   * Check if avatar can enter combat (checks status, cooldowns)
   * @param {Object} avatar - Avatar object
   * @returns {boolean}
   */
  canEnterCombat(avatar) {
    try {
      if (!avatar) {
        this.logger.debug?.('[CombatEncounter] canEnterCombat: avatar is null');
        return false;
      }

      const now = Date.now();

      if (avatar.status === 'dead' || avatar.status === 'knocked_out') {
        this.logger.debug?.(`[CombatEncounter] canEnterCombat: ${avatar.name} has status ${avatar.status}`);
        return false;
      }

      if (avatar.knockedOutUntil && now < avatar.knockedOutUntil) {
        this.logger.debug?.(`[CombatEncounter] canEnterCombat: ${avatar.name} on KO cooldown until ${new Date(avatar.knockedOutUntil)}`);
        return false;
      }

      if (avatar.combatCooldownUntil && now < avatar.combatCooldownUntil) {
        this.logger.debug?.(`[CombatEncounter] canEnterCombat: ${avatar.name} on flee cooldown until ${new Date(avatar.combatCooldownUntil)}`);
        return false;
      }

      return true;
    } catch (error) {
      this.logger.warn?.(`[CombatEncounter] canEnterCombat error: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if avatar is in active combat
   * @param {Object} encounter - Encounter object
   * @param {string|Object} avatarId - Avatar ID
   * @returns {boolean}
   */
  isInActiveCombat(encounter, avatarId) {
    if (!encounter || encounter.state !== 'active') return false;
    return !!this.getCombatant(encounter, avatarId);
  }
}

export default CombatCoreHelpers;
