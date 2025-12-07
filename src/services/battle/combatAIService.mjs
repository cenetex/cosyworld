/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * CombatAIService
 * Handles AI-driven combat decisions and dialogue generation.
 * Extracted from CombatEncounterService for better modularity.
 */

/**
 * Personality-based combat behavior profiles
 */
const PERSONALITY_PROFILES = {
  aggressive: {
    defendThreshold: 0.15,      // Only defend when very low HP
    focusLowHpTarget: false,    // Attack randomly, not strategically
    fleeThreshold: 0.05,        // Almost never flee
    preferredActions: ['attack', 'special_attack'],
    criticalHitBonus: 0.1,      // 10% more likely to go for risky attacks
  },
  tactical: {
    defendThreshold: 0.35,      // Defend at moderate HP
    focusLowHpTarget: true,     // Target weakest enemy
    fleeThreshold: 0.2,         // Flee when outmatched
    preferredActions: ['attack', 'defend', 'use_item'],
    criticalHitBonus: 0,
  },
  defensive: {
    defendThreshold: 0.5,       // Defend often
    focusLowHpTarget: false,    // Attack whoever is closest threat
    fleeThreshold: 0.35,        // Flee early if losing
    preferredActions: ['defend', 'attack', 'flee'],
    criticalHitBonus: -0.1,     // Play it safe
  },
  berserker: {
    defendThreshold: 0,         // Never defend
    focusLowHpTarget: false,    // Random target
    fleeThreshold: 0,           // Never flee
    preferredActions: ['attack', 'special_attack'],
    criticalHitBonus: 0.2,      // Very aggressive
  },
  balanced: {
    defendThreshold: 0.3,
    focusLowHpTarget: true,
    fleeThreshold: 0.15,
    preferredActions: ['attack', 'defend'],
    criticalHitBonus: 0,
  }
};

/**
 * Fallback dialogue phrases for when AI is unavailable
 */
const FALLBACK_DIALOGUES = {
  attack: {
    hit: [
      "Take this!",
      "Here's my answer!",
      "Feel my wrath!",
      "You won't escape me!",
      "This ends now!",
      "My blade finds its mark!",
      "Victory will be mine!",
      "Prepare yourself!"
    ],
    critical: [
      "A perfect strike!",
      "Witness my true power!",
      "This is my moment!",
      "Incredible!",
      "Did you see that?!"
    ],
    knockout: [
      "It's over!",
      "Rest now.",
      "You fought well.",
      "The battle is won!",
      "Victory is mine!"
    ],
    miss: [
      "Curses!",
      "Not this time...",
      "I'll get you next time!",
      "Missed!",
      "Drat!"
    ]
  },
  defend: [
    "Come at me!",
    "I'm ready for you!",
    "Try your best!",
    "You'll have to do better than that!",
    "I won't go down easily!"
  ],
  flee: {
    success: [
      "I'll be back!",
      "This isn't over!",
      "Live to fight another day!",
      "Tactical retreat!"
    ],
    fail: [
      "I can't escape!",
      "No way out!",
      "Blocked!",
      "I'm trapped!"
    ]
  },
  taunt: [
    "Is that all you've got?",
    "Come on, hit me!",
    "You call that an attack?",
    "My grandmother hits harder!"
  ]
};

export class CombatAIService {
  /**
   * @param {Object} deps
   * @param {Object} deps.logger - Logging service
   * @param {Object} deps.unifiedAIService - AI service for dialogue generation
   * @param {Object} deps.avatarService - Avatar data service
   * @param {Object} deps.diceService - Dice rolling service
   */
  constructor({ logger, unifiedAIService, avatarService, diceService }) {
    this.logger = logger || console;
    this.unifiedAIService = unifiedAIService;
    this.avatarService = avatarService;
    this.diceService = diceService;
  }

  /**
   * Select the best combat action based on personality and situation
   * @param {Object} encounter - Current encounter state
   * @param {Object} combatant - The combatant making the decision
   * @returns {Promise<{type: string, target?: Object}>}
   */
  async selectCombatAction(encounter, combatant) {
    const opponents = this._getAliveOpponents(encounter, combatant);
    
    if (opponents.length === 0) {
      return null;
    }

    const personality = this._getPersonalityProfile(combatant);
    const factors = await this._gatherCombatFactors(encounter, combatant, opponents);

    // Check if should flee
    if (factors.myHpPercent < personality.fleeThreshold && this._shouldFlee(factors, personality)) {
      return { type: 'flee', target: null };
    }

    // Check if should defend
    if (factors.myHpPercent < personality.defendThreshold && this._shouldDefend(factors, personality)) {
      return { type: 'defend', target: null };
    }

    // Check if should use item (future implementation)
    if (factors.hasUsableItems && this._shouldUseItem(factors, personality)) {
      const item = this._selectBestItem(factors);
      if (item) {
        return { type: 'use_item', target: null, item };
      }
    }

    // Default to attack
    const target = this._selectTarget(opponents, factors, personality);
    return { type: 'attack', target };
  }

  /**
   * Generate in-character combat dialogue using AI
   * @param {Object} combatant - The speaking combatant
   * @param {Object} action - The action being performed
   * @param {Object} result - The result of the action
   * @returns {Promise<string>}
   */
  async generateCombatDialogue(combatant, action, result) {
    // Try AI generation first
    if (this.unifiedAIService?.chat) {
      try {
        const dialogue = await this._generateAIDialogue(combatant, action, result);
        if (dialogue) {
          return dialogue;
        }
      } catch (e) {
        this.logger?.warn?.(`[CombatAI] AI dialogue failed: ${e.message}`);
      }
    }

    // Fallback to pre-written phrases
    return this._getFallbackDialogue(combatant, action, result);
  }

  /**
   * Generate pre-combat taunt/challenge
   * @param {Object} combatant - The speaking combatant
   * @param {Array} opponents - List of opponents
   * @returns {Promise<string>}
   */
  async generatePreCombatDialogue(combatant, opponents) {
    if (!this.unifiedAIService?.chat) {
      return this._getRandomPhrase(FALLBACK_DIALOGUES.taunt);
    }

    try {
      const avatar = combatant.ref;
      const opponentNames = opponents.map(o => o.name).join(', ');
      
      const systemContent = avatar?.prompt 
        ? `${avatar.prompt}\n\nCOMBAT MODE: Generate a SHORT pre-combat taunt or challenge (max 20 words). Be bold and in-character. Return ONLY the dialogue, no quotes.`
        : `You are ${avatar?.emoji || ''} ${combatant.name}. Personality: ${avatar?.personality || 'bold warrior'}. Generate a SHORT pre-combat taunt (max 20 words). Return ONLY the dialogue.`;

      const messages = [
        { role: 'system', content: systemContent },
        { 
          role: 'user', 
          content: `Generate a pre-combat taunt against ${opponentNames}. One-liner (no quotes):` 
        }
      ];

      const response = await this.unifiedAIService.chat(messages, {
        model: avatar?.model || 'google/gemini-2.0-flash-001',
        temperature: 0.9
      });

      const dialogue = (response?.text || '').trim().replace(/^["']|["']$/g, '');
      return dialogue || this._getRandomPhrase(FALLBACK_DIALOGUES.taunt);
    } catch (e) {
      this.logger?.warn?.(`[CombatAI] Pre-combat dialogue failed: ${e.message}`);
      return this._getRandomPhrase(FALLBACK_DIALOGUES.taunt);
    }
  }

  /**
   * Generate commentary between combat actions
   * @param {Object} encounter - Current encounter
   * @param {Object} speaker - The avatar speaking
   * @param {Object} lastAction - The last action that occurred
   * @returns {Promise<string|null>}
   */
  async generateCommentary(encounter, speaker, lastAction) {
    if (!this.unifiedAIService?.chat || !lastAction) {
      return null;
    }

    try {
      const avatar = speaker.ref;
      const context = this._buildCommentaryContext(encounter, lastAction);

      const systemContent = avatar?.prompt
        ? `${avatar.prompt}\n\nGenerate a SHORT reaction comment (max 12 words) to what just happened. Return ONLY the dialogue.`
        : `You are ${avatar?.emoji || ''} ${speaker.name}. Generate a SHORT reaction (max 12 words). Return ONLY the dialogue.`;

      const messages = [
        { role: 'system', content: systemContent },
        { role: 'user', content: context }
      ];

      const response = await this.unifiedAIService.chat(messages, {
        model: avatar?.model || 'google/gemini-2.0-flash-001',
        temperature: 0.95
      });

      const dialogue = (response?.text || '').trim().replace(/^["']|["']$/g, '');
      return dialogue || null;
    } catch (e) {
      this.logger?.debug?.(`[CombatAI] Commentary generation failed: ${e.message}`);
      return null;
    }
  }

  // ============ Private Methods ============

  /**
   * Get personality profile for combatant
   * @private
   */
  _getPersonalityProfile(combatant) {
    const personality = combatant.ref?.personality?.toLowerCase() || 'balanced';
    
    // Map common personality keywords to profiles
    if (personality.includes('aggressive') || personality.includes('fierce') || personality.includes('angry')) {
      return PERSONALITY_PROFILES.aggressive;
    }
    if (personality.includes('tactical') || personality.includes('strategic') || personality.includes('clever')) {
      return PERSONALITY_PROFILES.tactical;
    }
    if (personality.includes('defensive') || personality.includes('careful') || personality.includes('cautious')) {
      return PERSONALITY_PROFILES.defensive;
    }
    if (personality.includes('berserker') || personality.includes('reckless') || personality.includes('wild')) {
      return PERSONALITY_PROFILES.berserker;
    }
    
    return PERSONALITY_PROFILES.balanced;
  }

  /**
   * Gather all factors needed for decision making
   * @private
   */
  async _gatherCombatFactors(encounter, combatant, opponents) {
    const myHpPercent = (combatant.currentHp || 0) / (combatant.maxHp || 1);
    const stats = combatant.ref?.stats || {};
    
    // Find the lowest HP opponent
    const lowestHpOpponent = opponents.reduce((lowest, curr) => {
      const currHpPct = (curr.currentHp || 0) / (curr.maxHp || 1);
      const lowestHpPct = (lowest?.currentHp || 0) / (lowest?.maxHp || 1);
      return currHpPct < lowestHpPct ? curr : lowest;
    }, opponents[0]);

    // Find highest threat (most damage dealt this combat)
    const highestThreat = this._findHighestThreat(encounter, opponents);

    return {
      myHpPercent,
      hasAdvantage: !!stats.advantageNextAttack,
      isHidden: !!stats.isHidden,
      isDefending: !!combatant.isDefending,
      opponentCount: opponents.length,
      lowestHpOpponent,
      highestThreat,
      round: encounter.round || 1,
      hasUsableItems: false, // TODO: Implement item checking
      allOpponentsDefending: opponents.every(o => o.isDefending)
    };
  }

  /**
   * Find the opponent that has dealt the most damage
   * @private
   */
  _findHighestThreat(encounter, opponents) {
    // For now, return highest HP opponent as proxy for threat
    // TODO: Track damage dealt per combatant for better threat assessment
    return opponents.reduce((highest, curr) => {
      return (curr.currentHp || 0) > (highest?.currentHp || 0) ? curr : highest;
    }, opponents[0]);
  }

  /**
   * Get all alive opponents
   * @private
   */
  _getAliveOpponents(encounter, combatant) {
    return (encounter.combatants || []).filter(c => 
      c.avatarId !== combatant.avatarId && 
      (c.currentHp || 0) > 0 &&
      !c.conditions?.includes('unconscious')
    );
  }

  /**
   * Decide if combatant should flee
   * @private
   */
  _shouldFlee(factors, personality) {
    // Don't flee if we have advantage
    if (factors.hasAdvantage || factors.isHidden) return false;
    
    // Flee if heavily outnumbered and low HP
    if (factors.opponentCount >= 2 && factors.myHpPercent < 0.2) {
      return Math.random() < 0.5; // 50% chance
    }
    
    return Math.random() < personality.fleeThreshold;
  }

  /**
   * Decide if combatant should defend
   * @private
   */
  _shouldDefend(factors, _personality) {
    // Don't defend if already defending
    if (factors.isDefending) return false;
    
    // Don't defend if we have advantage - strike now!
    if (factors.hasAdvantage || factors.isHidden) return false;
    
    // Defend if all opponents are defending (stalemate breaker)
    if (factors.allOpponentsDefending) return false;
    
    return true;
  }

  /**
   * Decide if combatant should use an item
   * @private
   */
  _shouldUseItem(factors, _personality) {
    // Heal if low HP and have healing item
    if (factors.myHpPercent < 0.4 && factors.hasHealingItem) {
      return true;
    }
    return false;
  }

  /**
   * Select best item to use
   * @private
   */
  _selectBestItem(_factors) {
    // TODO: Implement item selection logic
    return null;
  }

  /**
   * Select target for attack
   * @private
   */
  _selectTarget(opponents, factors, personality) {
    if (personality.focusLowHpTarget && factors.lowestHpOpponent) {
      // 70% chance to focus low HP target
      if (Math.random() < 0.7) {
        return factors.lowestHpOpponent;
      }
    }
    
    // Random target
    return opponents[Math.floor(Math.random() * opponents.length)];
  }

  /**
   * Generate dialogue using AI
   * @private
   */
  async _generateAIDialogue(combatant, action, result) {
    const avatar = combatant.ref;
    const model = avatar?.model || 'google/gemini-2.0-flash-001';
    const personality = avatar?.personality || 'bold warrior';
    const name = combatant.name;

    let systemContent;
    if (avatar?.prompt) {
      systemContent = `${avatar.prompt}\n\nCOMBAT MODE: Generate a SHORT one-liner (max 15 words) for this combat action. Stay in character. Return ONLY the dialogue, no quotes or narration.`;
    } else {
      const emoji = avatar?.emoji || '';
      const description = avatar?.description || '';
      systemContent = `You are ${emoji ? emoji + ' ' : ''}${name}. ${description ? `Character: ${description}. ` : ''}Personality: ${personality}. Generate a SHORT one-liner (max 15 words) for this combat action. Stay in character. Return ONLY the dialogue, no quotes or narration.`;
    }

    const prompt = `Generate a SHORT combat one-liner (max 15 words) for ${name}.
Action: ${action.type}${action.target ? ` against ${action.target.name}` : ''}
Result: ${result?.result || 'defending'}
${result?.damage ? `Damage: ${result.damage}` : ''}
${result?.critical ? 'CRITICAL HIT!' : ''}

One-liner (no quotes):`;

    const messages = [
      { role: 'system', content: systemContent },
      { role: 'user', content: prompt }
    ];

    const response = await this.unifiedAIService.chat(messages, {
      model,
      temperature: 0.9
    });

    return (response?.text || '').trim().replace(/^["']|["']$/g, '');
  }

  /**
   * Get fallback dialogue when AI is unavailable
   * @private
   */
  _getFallbackDialogue(combatant, action, result) {
    if (action.type === 'defend') {
      return this._getRandomPhrase(FALLBACK_DIALOGUES.defend);
    }

    if (action.type === 'flee') {
      const phrases = result?.success 
        ? FALLBACK_DIALOGUES.flee.success 
        : FALLBACK_DIALOGUES.flee.fail;
      return this._getRandomPhrase(phrases);
    }

    if (action.type === 'attack') {
      const attackResult = result?.result || 'miss';
      
      if (attackResult === 'knockout' || attackResult === 'dead') {
        return this._getRandomPhrase(FALLBACK_DIALOGUES.attack.knockout);
      }
      if (result?.critical) {
        return this._getRandomPhrase(FALLBACK_DIALOGUES.attack.critical);
      }
      if (attackResult === 'hit') {
        return this._getRandomPhrase(FALLBACK_DIALOGUES.attack.hit);
      }
      return this._getRandomPhrase(FALLBACK_DIALOGUES.attack.miss);
    }

    return "...";
  }

  /**
   * Build context for commentary generation
   * @private
   */
  _buildCommentaryContext(encounter, lastAction) {
    const { attackerName, defenderName, result, damage, critical } = lastAction;
    
    let context = `${attackerName} just ${result === 'hit' ? 'hit' : result === 'miss' ? 'missed' : result} ${defenderName}`;
    if (damage) context += ` for ${damage} damage`;
    if (critical) context += ' with a critical hit!';
    context += '. React to this in character:';
    
    return context;
  }

  /**
   * Get random phrase from array
   * @private
   */
  _getRandomPhrase(phrases) {
    if (!Array.isArray(phrases) || phrases.length === 0) {
      return "...";
    }
    return phrases[Math.floor(Math.random() * phrases.length)];
  }
}

export default CombatAIService;
