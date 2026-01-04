/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * CombatTargetRegistry - Authoritative target resolution for combat encounters
 * 
 * This service solves the "Ghost Enemy" bug by providing a single source of truth
 * for target resolution during active combat. It searches the encounter's combatant
 * array directly, rather than relying on map-based avatar lookups.
 */

export class CombatTargetRegistry {
  constructor({ combatEncounterService, logger }) {
    this.combatEncounterService = combatEncounterService;
    this.logger = logger || console;
  }

  /**
   * Normalize an avatar/combatant ID to string format
   * @private
   */
  _normalize(id) {
    if (!id) return '';
    if (typeof id === 'object') return String(id._id || id.id || '');
    return String(id);
  }

  /**
   * Resolve a target name to a combatant in the active encounter
   * Uses multi-tier fuzzy matching to handle partial names, numbered monsters, etc.
   * 
   * @param {string} channelId - Channel where combat is happening
   * @param {string} targetName - Name to search for (fuzzy match)
   * @param {Object} options - Resolution options
   * @param {string[]} options.excludeAvatarIds - IDs to exclude from results
   * @param {boolean} options.includeDead - Include dead combatants (default: false)
   * @returns {Object|null} Combatant object or null if not found
   */
  resolveTarget(channelId, targetName, options = {}) {
    const encounter = this.combatEncounterService?.getEncounterByChannelId?.(channelId);
    if (!encounter || encounter.state !== 'active') {
      this.logger?.debug?.(`[CombatTargetRegistry] No active encounter in channel ${channelId}`);
      return null;
    }

    const { excludeAvatarIds = [], includeDead = false } = options;
    let searchLower = (targetName || '').toLowerCase().trim();
    
    if (!searchLower) {
      this.logger?.debug?.('[CombatTargetRegistry] Empty search term');
      return null;
    }
    
    // Handle underscore-to-space conversion for legacy button format
    const searchWithSpaces = searchLower.replace(/_/g, ' ');

    // Filter to valid candidates
    const excludeSet = new Set(excludeAvatarIds.map(id => this._normalize(id)));
    const candidates = encounter.combatants.filter(c => {
      const cId = this._normalize(c.avatarId);
      if (excludeSet.has(cId)) return false;
      if (!includeDead && (c.currentHp || 0) <= 0) return false;
      return true;
    });

    if (candidates.length === 0) {
      this.logger?.debug?.('[CombatTargetRegistry] No valid candidates after filtering');
      return null;
    }

    // Priority 0: Exact ID match (for button-generated target IDs)
    // This handles cases like "monster_mortar_mite_6idl_2_1767503059096"
    // Use case-insensitive comparison since searchLower is lowercased
    let match = candidates.find(c => {
      const cId = (this._normalize(c.avatarId) || '').toLowerCase();
      const cIdAlt = (this._normalize(c._id || c.id) || '').toLowerCase();
      return cId === searchLower || cIdAlt === searchLower;
    });
    if (match) {
      this.logger?.debug?.(`[CombatTargetRegistry] ID match: ${match.name} (via ${searchLower})`);
      return match;
    }

    // Priority 1: Exact name match (case-insensitive) - try both original and space-converted
    match = candidates.find(c => {
      const cName = (c.name || '').toLowerCase();
      return cName === searchLower || cName === searchWithSpaces;
    });
    if (match) {
      this.logger?.debug?.(`[CombatTargetRegistry] Exact match: ${match.name}`);
      return match;
    }

    // Priority 2: Name starts with search term
    match = candidates.find(c => 
      (c.name || '').toLowerCase().startsWith(searchLower)
    );
    if (match) {
      this.logger?.debug?.(`[CombatTargetRegistry] Prefix match: ${match.name}`);
      return match;
    }

    // Priority 3: Name contains search term
    match = candidates.find(c => 
      (c.name || '').toLowerCase().includes(searchLower)
    );
    if (match) {
      this.logger?.debug?.(`[CombatTargetRegistry] Contains match: ${match.name}`);
      return match;
    }

    // Priority 4: Search term contains combatant name
    // Handles case where user types "attack the goblin warrior" and monster is "Goblin"
    match = candidates.find(c => {
      const cName = (c.name || '').toLowerCase();
      return cName.length >= 3 && searchLower.includes(cName);
    });
    if (match) {
      this.logger?.debug?.(`[CombatTargetRegistry] Reverse contains match: ${match.name}`);
      return match;
    }

    // Priority 5: Word-by-word match
    // Handles "Mortar Mite 1" matching "mortar" or "mite"
    match = candidates.find(c => {
      const words = (c.name || '').toLowerCase().split(/\s+/);
      const searchWords = searchLower.split(/\s+/);
      
      // Check if any significant word matches
      return words.some(w => 
        w.length >= 3 && (
          searchWords.includes(w) || 
          searchWords.some(sw => sw.includes(w) || w.includes(sw))
        )
      );
    });
    if (match) {
      this.logger?.debug?.(`[CombatTargetRegistry] Word match: ${match.name}`);
      return match;
    }

    // Priority 6: Levenshtein distance for typo tolerance (simple version)
    // Only if search term is reasonably long
    if (searchLower.length >= 4) {
      match = candidates.find(c => {
        const cName = (c.name || '').toLowerCase();
        return this._fuzzyMatch(searchLower, cName);
      });
      if (match) {
        this.logger?.debug?.(`[CombatTargetRegistry] Fuzzy match: ${match.name}`);
        return match;
      }
    }

    this.logger?.debug?.(`[CombatTargetRegistry] No match found for "${targetName}"`);
    return null;
  }

  /**
   * Simple fuzzy match - checks if strings share most characters
   * @private
   */
  _fuzzyMatch(search, target) {
    if (Math.abs(search.length - target.length) > 3) return false;
    
    let matches = 0;
    const shorter = search.length <= target.length ? search : target;
    const longer = search.length > target.length ? search : target;
    
    for (const char of shorter) {
      if (longer.includes(char)) matches++;
    }
    
    return matches / shorter.length >= 0.7;
  }

  /**
   * Get all valid targets for a combatant to attack
   * @param {string} channelId - Channel ID
   * @param {string} attackerAvatarId - The attacker's avatar ID (to exclude)
   * @returns {Array<Object>} Array of valid target combatants
   */
  getValidTargets(channelId, attackerAvatarId) {
    const encounter = this.combatEncounterService?.getEncounterByChannelId?.(channelId);
    if (!encounter || encounter.state !== 'active') {
      return [];
    }

    const attackerId = this._normalize(attackerAvatarId);
    // Note: attackerSide could be used for faction targeting in future
    // const attacker = encounter.combatants.find(c => this._normalize(c.avatarId) === attackerId);
    // const attackerSide = attacker?.side || 'neutral';
    
    return encounter.combatants.filter(c => {
      // Can't target self
      if (this._normalize(c.avatarId) === attackerId) return false;
      // Can't target dead
      if ((c.currentHp || 0) <= 0) return false;
      // Prefer targeting opposite side
      // (For now, allow all non-self targets; side logic can be added later)
      return true;
    });
  }

  /**
   * Get a formatted list of valid targets for display
   * @param {string} channelId 
   * @param {string} attackerAvatarId 
   * @returns {string} Formatted target list
   */
  getFormattedTargetList(channelId, attackerAvatarId) {
    const targets = this.getValidTargets(channelId, attackerAvatarId);
    
    if (targets.length === 0) {
      return '*No valid targets available*';
    }

    return targets.map(t => {
      const hp = t.currentHp <= 0 ? '💀' : `${t.currentHp}/${t.maxHp} HP`;
      const emoji = t.isMonster ? '👹' : '⚔️';
      return `${emoji} **${t.name}** (${hp})`;
    }).join('\n');
  }

  /**
   * Check if a target is valid (exists and alive in combat)
   * @param {string} channelId 
   * @param {string} targetAvatarId 
   * @returns {boolean}
   */
  isValidTarget(channelId, targetAvatarId) {
    const encounter = this.combatEncounterService?.getEncounterByChannelId?.(channelId);
    if (!encounter || encounter.state !== 'active') return false;

    const targetId = this._normalize(targetAvatarId);
    const target = encounter.combatants.find(c => this._normalize(c.avatarId) === targetId);
    
    return target && (target.currentHp || 0) > 0;
  }

  /**
   * Get encounter info for a channel (for debugging/status)
   * @param {string} channelId 
   * @returns {Object|null}
   */
  getEncounterInfo(channelId) {
    const encounter = this.combatEncounterService?.getEncounterByChannelId?.(channelId);
    if (!encounter) return null;

    return {
      state: encounter.state,
      round: encounter.round,
      combatantCount: encounter.combatants?.length || 0,
      aliveCombatants: encounter.combatants?.filter(c => (c.currentHp || 0) > 0).length || 0,
      currentTurn: this.combatEncounterService.getCurrentTurnAvatarId?.(encounter)
    };
  }
}

export default CombatTargetRegistry;
