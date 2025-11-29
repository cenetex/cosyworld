/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * StatusEffectService
 * Manages combat status effects (buffs, debuffs, conditions).
 * Handles application, duration tracking, and effect resolution.
 */

/**
 * Status effect definitions with their properties
 */
export const STATUS_EFFECTS = {
  // ============ POSITIVE EFFECTS ============
  
  blessed: {
    name: 'Blessed',
    emoji: '✨',
    type: 'buff',
    stackable: false,
    duration: 3,
    effects: {
      attackBonus: 1,
      acBonus: 1
    },
    description: '+1 to attack rolls and AC'
  },
  
  hasted: {
    name: 'Hasted',
    emoji: '⚡',
    type: 'buff',
    stackable: false,
    duration: 3,
    effects: {
      extraAction: true,
      acBonus: 2,
      dexBonus: 2
    },
    description: 'Extra action, +2 AC and DEX'
  },
  
  inspired: {
    name: 'Inspired',
    emoji: '🎵',
    type: 'buff',
    stackable: true,
    maxStacks: 3,
    duration: 2,
    effects: {
      attackBonus: 1,  // Per stack
      damageBonus: 1   // Per stack
    },
    description: '+1 attack and damage per stack'
  },
  
  shielded: {
    name: 'Shielded',
    emoji: '🛡️',
    type: 'buff',
    stackable: false,
    duration: 2,
    effects: {
      acBonus: 4,
      damageReduction: 2
    },
    description: '+4 AC, reduce damage by 2'
  },
  
  regenerating: {
    name: 'Regenerating',
    emoji: '💚',
    type: 'buff',
    stackable: false,
    duration: 3,
    effects: {
      healPerTurn: 2
    },
    description: 'Heal 2 HP at start of each turn'
  },
  
  hidden: {
    name: 'Hidden',
    emoji: '🫥',
    type: 'buff',
    stackable: false,
    duration: 1,
    effects: {
      advantage: true,
      autoHide: true
    },
    description: 'Advantage on next attack, then revealed'
  },
  
  enraged: {
    name: 'Enraged',
    emoji: '😤',
    type: 'buff',
    stackable: false,
    duration: 2,
    effects: {
      damageBonus: 3,
      acPenalty: -2
    },
    description: '+3 damage, -2 AC (reckless fury)'
  },
  
  // ============ NEGATIVE EFFECTS ============
  
  poisoned: {
    name: 'Poisoned',
    emoji: '🤢',
    type: 'debuff',
    stackable: false,
    duration: 3,
    effects: {
      damagePerTurn: 2,
      attackPenalty: -2,
      savingThrowPenalty: -2
    },
    description: '2 damage/turn, -2 to attacks and saves'
  },
  
  burning: {
    name: 'Burning',
    emoji: '🔥',
    type: 'debuff',
    stackable: true,
    maxStacks: 3,
    duration: 2,
    effects: {
      damagePerTurn: 3  // Per stack
    },
    description: '3 fire damage per turn per stack'
  },
  
  frozen: {
    name: 'Frozen',
    emoji: '🥶',
    type: 'debuff',
    stackable: false,
    duration: 2,
    effects: {
      speedPenalty: true,
      acPenalty: -2,
      dexPenalty: -4
    },
    description: '-2 AC, -4 DEX, cannot flee'
  },
  
  stunned: {
    name: 'Stunned',
    emoji: '😵',
    type: 'debuff',
    stackable: false,
    duration: 1,
    effects: {
      skipTurn: true,
      autoFail: ['dex', 'str'],
      attackersHaveAdvantage: true
    },
    description: 'Skip turn, auto-fail DEX/STR saves'
  },
  
  frightened: {
    name: 'Frightened',
    emoji: '😨',
    type: 'debuff',
    stackable: false,
    duration: 2,
    effects: {
      attackPenalty: -2,
      cannotApproach: true,
      fleeBonus: 2
    },
    description: '-2 to attacks, cannot move closer to source'
  },
  
  blinded: {
    name: 'Blinded',
    emoji: '🙈',
    type: 'debuff',
    stackable: false,
    duration: 2,
    effects: {
      disadvantage: true,
      attackersHaveAdvantage: true,
      autoFail: ['sight']
    },
    description: 'Disadvantage on attacks, attackers have advantage'
  },
  
  weakened: {
    name: 'Weakened',
    emoji: '💔',
    type: 'debuff',
    stackable: true,
    maxStacks: 3,
    duration: 2,
    effects: {
      damagePenalty: -2  // Per stack
    },
    description: '-2 damage per stack'
  },
  
  slowed: {
    name: 'Slowed',
    emoji: '🐌',
    type: 'debuff',
    stackable: false,
    duration: 2,
    effects: {
      initiativePenalty: -5,
      acPenalty: -1,
      dexPenalty: -2,
      cannotFlee: true
    },
    description: '-5 initiative, -1 AC, cannot flee'
  },
  
  // ============ NEUTRAL/CONDITION EFFECTS ============
  
  grappled: {
    name: 'Grappled',
    emoji: '🤼',
    type: 'condition',
    stackable: false,
    duration: null,  // Until escaped
    effects: {
      cannotMove: true,
      attackPenalty: -1
    },
    description: 'Cannot move, -1 to attacks. Escape DC based on grappler'
  },
  
  prone: {
    name: 'Prone',
    emoji: '⬇️',
    type: 'condition',
    stackable: false,
    duration: null,  // Until stand up
    effects: {
      meleeAdvantage: true,
      rangedDisadvantage: true,
      attackPenalty: -2
    },
    description: 'Melee attackers have advantage, ranged disadvantage'
  },
  
  restrained: {
    name: 'Restrained',
    emoji: '⛓️',
    type: 'condition',
    stackable: false,
    duration: null,  // Until freed
    effects: {
      cannotMove: true,
      attackPenalty: -2,
      dexPenalty: -4,
      attackersHaveAdvantage: true
    },
    description: 'Cannot move, -2 attacks, attackers have advantage'
  },
  
  unconscious: {
    name: 'Unconscious',
    emoji: '💤',
    type: 'condition',
    stackable: false,
    duration: null,  // Until healed
    effects: {
      skipTurn: true,
      autoFail: ['dex', 'str'],
      attackersHaveAdvantage: true,
      autoCritical: true
    },
    description: 'Incapacitated, attacks are automatic criticals'
  },
  
  concentrating: {
    name: 'Concentrating',
    emoji: '🎯',
    type: 'condition',
    stackable: false,
    duration: null,
    effects: {
      maintainingEffect: true
    },
    description: 'Maintaining a spell/ability. Break on damage (CON save)'
  }
};

/**
 * Active status effect on a combatant
 */
class ActiveStatusEffect {
  constructor(effectId, sourceId, options = {}) {
    const template = STATUS_EFFECTS[effectId];
    if (!template) {
      throw new Error(`Unknown status effect: ${effectId}`);
    }
    
    this.id = effectId;
    this.name = template.name;
    this.emoji = template.emoji;
    this.type = template.type;
    this.effects = { ...template.effects };
    this.sourceId = sourceId;
    this.appliedAt = Date.now();
    this.appliedOnRound = options.round || 1;
    this.duration = options.duration ?? template.duration;
    this.stacks = options.stacks || 1;
    this.maxStacks = template.maxStacks || 1;
    this.stackable = template.stackable || false;
  }
  
  /**
   * Check if effect has expired
   */
  isExpired(currentRound) {
    if (this.duration === null) return false; // Permanent until removed
    return (currentRound - this.appliedOnRound) >= this.duration;
  }
  
  /**
   * Add a stack (if stackable)
   */
  addStack() {
    if (!this.stackable) return false;
    if (this.stacks >= this.maxStacks) return false;
    this.stacks++;
    return true;
  }
  
  /**
   * Get effect values (multiplied by stacks if applicable)
   */
  getEffectValues() {
    if (!this.stackable || this.stacks === 1) {
      return this.effects;
    }
    
    // Multiply numeric effects by stacks
    const scaled = {};
    for (const [key, value] of Object.entries(this.effects)) {
      scaled[key] = typeof value === 'number' ? value * this.stacks : value;
    }
    return scaled;
  }
}

/**
 * StatusEffectService
 */
export class StatusEffectService {
  constructor({ logger, diceService }) {
    this.logger = logger || console;
    this.diceService = diceService;
  }

  /**
   * Apply a status effect to a combatant
   * @param {Object} combatant - Target combatant
   * @param {string} effectId - Effect ID from STATUS_EFFECTS
   * @param {string} sourceId - ID of the source (attacker/caster)
   * @param {Object} options - Additional options (duration, stacks)
   * @returns {Object} Result of application
   */
  applyEffect(combatant, effectId, sourceId, options = {}) {
    const template = STATUS_EFFECTS[effectId];
    if (!template) {
      this.logger.warn?.(`[StatusEffect] Unknown effect: ${effectId}`);
      return { success: false, reason: 'unknown_effect' };
    }
    
    // Initialize effects array if needed
    if (!combatant.statusEffects) {
      combatant.statusEffects = [];
    }
    
    // Check for existing effect
    const existing = combatant.statusEffects.find(e => e.id === effectId);
    
    if (existing) {
      if (template.stackable) {
        // Add stack
        const added = existing.addStack();
        if (added) {
          this.logger.debug?.(`[StatusEffect] Added stack to ${effectId} on ${combatant.name} (${existing.stacks}/${existing.maxStacks})`);
          return { 
            success: true, 
            action: 'stacked', 
            stacks: existing.stacks,
            effect: existing 
          };
        } else {
          return { 
            success: false, 
            reason: 'max_stacks',
            stacks: existing.stacks 
          };
        }
      } else {
        // Refresh duration
        existing.appliedOnRound = options.round || existing.appliedOnRound;
        this.logger.debug?.(`[StatusEffect] Refreshed ${effectId} on ${combatant.name}`);
        return { 
          success: true, 
          action: 'refreshed', 
          effect: existing 
        };
      }
    }
    
    // Apply new effect
    const effect = new ActiveStatusEffect(effectId, sourceId, options);
    combatant.statusEffects.push(effect);
    
    this.logger.debug?.(`[StatusEffect] Applied ${effectId} to ${combatant.name} (duration: ${effect.duration})`);
    
    return { 
      success: true, 
      action: 'applied', 
      effect 
    };
  }

  /**
   * Remove a status effect from a combatant
   * @param {Object} combatant - Target combatant
   * @param {string} effectId - Effect ID to remove
   * @returns {boolean} Whether effect was removed
   */
  removeEffect(combatant, effectId) {
    if (!combatant.statusEffects) return false;
    
    const index = combatant.statusEffects.findIndex(e => e.id === effectId);
    if (index === -1) return false;
    
    combatant.statusEffects.splice(index, 1);
    this.logger.debug?.(`[StatusEffect] Removed ${effectId} from ${combatant.name}`);
    return true;
  }

  /**
   * Remove all effects of a specific type
   * @param {Object} combatant - Target combatant
   * @param {string} type - Effect type ('buff', 'debuff', 'condition')
   * @returns {number} Number of effects removed
   */
  removeEffectsByType(combatant, type) {
    if (!combatant.statusEffects) return 0;
    
    const before = combatant.statusEffects.length;
    combatant.statusEffects = combatant.statusEffects.filter(e => e.type !== type);
    
    const removed = before - combatant.statusEffects.length;
    if (removed > 0) {
      this.logger.debug?.(`[StatusEffect] Removed ${removed} ${type}(s) from ${combatant.name}`);
    }
    return removed;
  }

  /**
   * Process all effects at the start of a combatant's turn
   * Applies damage-over-time, healing, and checks for expired effects
   * @param {Object} combatant - The combatant whose turn is starting
   * @param {number} currentRound - Current combat round
   * @returns {Object} Summary of effects processed
   */
  processTurnStart(combatant, currentRound) {
    if (!combatant.statusEffects || combatant.statusEffects.length === 0) {
      return { damage: 0, healing: 0, expired: [], skipTurn: false };
    }
    
    const result = {
      damage: 0,
      healing: 0,
      expired: [],
      skipTurn: false,
      messages: []
    };
    
    // Process each effect
    for (const effect of combatant.statusEffects) {
      const values = effect.getEffectValues();
      
      // Damage over time
      if (values.damagePerTurn) {
        result.damage += values.damagePerTurn;
        result.messages.push(`${effect.emoji} ${effect.name}: ${values.damagePerTurn} damage`);
      }
      
      // Healing over time
      if (values.healPerTurn) {
        result.healing += values.healPerTurn;
        result.messages.push(`${effect.emoji} ${effect.name}: ${values.healPerTurn} healing`);
      }
      
      // Skip turn
      if (values.skipTurn) {
        result.skipTurn = true;
        result.messages.push(`${effect.emoji} ${effect.name}: Turn skipped!`);
      }
    }
    
    // Remove expired effects
    const expired = combatant.statusEffects.filter(e => e.isExpired(currentRound));
    for (const effect of expired) {
      result.expired.push(effect.name);
      result.messages.push(`${effect.emoji} ${effect.name} has worn off`);
    }
    combatant.statusEffects = combatant.statusEffects.filter(e => !e.isExpired(currentRound));
    
    // Apply net damage/healing
    if (result.damage > 0) {
      combatant.currentHp = Math.max(0, (combatant.currentHp || 0) - result.damage);
    }
    if (result.healing > 0) {
      combatant.currentHp = Math.min(
        combatant.maxHp || 10,
        (combatant.currentHp || 0) + result.healing
      );
    }
    
    return result;
  }

  /**
   * Check if combatant has a specific effect
   * @param {Object} combatant - Combatant to check
   * @param {string} effectId - Effect ID to look for
   * @returns {boolean}
   */
  hasEffect(combatant, effectId) {
    return combatant.statusEffects?.some(e => e.id === effectId) || false;
  }

  /**
   * Get active effect instance
   * @param {Object} combatant - Combatant to check
   * @param {string} effectId - Effect ID to look for
   * @returns {ActiveStatusEffect|null}
   */
  getEffect(combatant, effectId) {
    return combatant.statusEffects?.find(e => e.id === effectId) || null;
  }

  /**
   * Calculate total attack modifier from status effects
   * @param {Object} combatant - Combatant to calculate for
   * @returns {number}
   */
  getAttackModifier(combatant) {
    if (!combatant.statusEffects) return 0;
    
    let modifier = 0;
    for (const effect of combatant.statusEffects) {
      const values = effect.getEffectValues();
      if (values.attackBonus) modifier += values.attackBonus;
      if (values.attackPenalty) modifier += values.attackPenalty;
    }
    return modifier;
  }

  /**
   * Calculate total AC modifier from status effects
   * @param {Object} combatant - Combatant to calculate for
   * @returns {number}
   */
  getACModifier(combatant) {
    if (!combatant.statusEffects) return 0;
    
    let modifier = 0;
    for (const effect of combatant.statusEffects) {
      const values = effect.getEffectValues();
      if (values.acBonus) modifier += values.acBonus;
      if (values.acPenalty) modifier += values.acPenalty;
    }
    return modifier;
  }

  /**
   * Calculate total damage modifier from status effects
   * @param {Object} combatant - Combatant to calculate for
   * @returns {number}
   */
  getDamageModifier(combatant) {
    if (!combatant.statusEffects) return 0;
    
    let modifier = 0;
    for (const effect of combatant.statusEffects) {
      const values = effect.getEffectValues();
      if (values.damageBonus) modifier += values.damageBonus;
      if (values.damagePenalty) modifier += values.damagePenalty;
    }
    return modifier;
  }

  /**
   * Check if combatant has advantage on attacks
   * @param {Object} combatant - Combatant to check
   * @returns {boolean}
   */
  hasAdvantage(combatant) {
    return combatant.statusEffects?.some(e => e.getEffectValues().advantage) || false;
  }

  /**
   * Check if combatant has disadvantage on attacks
   * @param {Object} combatant - Combatant to check
   * @returns {boolean}
   */
  hasDisadvantage(combatant) {
    return combatant.statusEffects?.some(e => e.getEffectValues().disadvantage) || false;
  }

  /**
   * Check if attackers have advantage against this combatant
   * @param {Object} combatant - Combatant to check
   * @returns {boolean}
   */
  attackersHaveAdvantage(combatant) {
    return combatant.statusEffects?.some(e => e.getEffectValues().attackersHaveAdvantage) || false;
  }

  /**
   * Get total damage reduction
   * @param {Object} combatant - Combatant to check
   * @returns {number}
   */
  getDamageReduction(combatant) {
    if (!combatant.statusEffects) return 0;
    
    let reduction = 0;
    for (const effect of combatant.statusEffects) {
      const values = effect.getEffectValues();
      if (values.damageReduction) reduction += values.damageReduction;
    }
    return reduction;
  }

  /**
   * Get status effect summary for display
   * @param {Object} combatant - Combatant to summarize
   * @returns {string}
   */
  getStatusSummary(combatant) {
    if (!combatant.statusEffects || combatant.statusEffects.length === 0) {
      return '';
    }
    
    return combatant.statusEffects
      .map(e => `${e.emoji}${e.stackable && e.stacks > 1 ? `×${e.stacks}` : ''}`)
      .join(' ');
  }

  /**
   * Get list of all active effect names
   * @param {Object} combatant - Combatant to list effects for
   * @returns {string[]}
   */
  getActiveEffectNames(combatant) {
    return (combatant.statusEffects || []).map(e => e.name);
  }

  /**
   * Clear all status effects (for end of combat)
   * @param {Object} combatant - Combatant to clear
   */
  clearAllEffects(combatant) {
    combatant.statusEffects = [];
  }
}

export default StatusEffectService;
