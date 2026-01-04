/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * DMNarratorService - AI-powered Dungeon Master Narrator
 * Generates third-person narrative descriptions for combat actions,
 * room entries, and dramatic moments. This is the "voice" of the DM.
 */

/**
 * Narrative templates for fallback when AI is unavailable
 */
const NARRATIVE_TEMPLATES = {
  attackHit: [
    '*{attacker} lunges forward, striking {defender} with a devastating blow!*',
    '*With lethal precision, {attacker} finds an opening in {defender}\'s defenses!*',
    '*{attacker}\'s weapon connects solidly, sending {defender} reeling back!*',
    '*A vicious strike from {attacker} leaves {defender} staggering!*'
  ],
  attackMiss: [
    '*{attacker} swings wildly, but {defender} narrowly evades the assault!*',
    '*{defender} ducks under {attacker}\'s attack at the last moment!*',
    '*{attacker}\'s strike goes wide, clanging harmlessly against stone!*',
    '*With surprising agility, {defender} sidesteps {attacker}\'s blow!*'
  ],
  attackCritical: [
    '*{attacker} finds the perfect opening and delivers a DEVASTATING strike!*',
    '*Time seems to slow as {attacker} lands an absolutely PERFECT hit!*',
    '*{attacker}\'s attack finds its mark with supernatural precision!*',
    '*The blow is CATASTROPHIC! {defender} never saw it coming!*'
  ],
  knockout: [
    '*{defender} crumples to the ground, defeated by {attacker}\'s final blow...*',
    '*With one last gasp, {defender} falls unconscious at {attacker}\'s feet.*',
    '*The light fades from {defender}\'s eyes as they collapse, overwhelmed.*',
    '*{defender} staggers... and falls. The battle is over for them.*'
  ],
  death: [
    '*{defender}\'s soul departs as {attacker} delivers the killing blow...*',
    '*With a sickening thud, {defender} falls—never to rise again.*',
    '*{attacker} has claimed {defender}\'s life. The battlefield grows silent.*'
  ],
  defend: [
    '*{name} raises their guard, bracing for the next assault!*',
    '*{name} shifts into a defensive stance, eyes scanning for threats!*',
    '*Shields up! {name} prepares to weather the storm!*'
  ],
  flee: [
    '*{name} breaks from combat and sprints toward safety!*',
    '*Discretion proves the better part of valor as {name} retreats!*',
    '*{name} decides to live to fight another day and flees!*'
  ],
  roundStart: [
    '*The battle rages on! Round {round} begins!*',
    '*Steel clashes against steel as round {round} commences!*',
    '*The combatants circle warily... Round {round}!*'
  ],
  combatStart: [
    '*The air crackles with tension as battle lines are drawn!*',
    '*Weapons are drawn, eyes narrowed—combat is inevitable!*',
    '*The clash of fate begins! May the strongest prevail!*'
  ],
  combatEnd: {
    victory: '*The dust settles. {winner} stands victorious!*',
    defeat: '*Silence falls... the battle has claimed its toll.*',
    draw: '*Neither side gains the upper hand. The battle ends in stalemate.*'
  }
};

export class DMNarratorService {
  /**
   * @param {Object} deps
   * @param {Object} deps.logger - Logging service
   * @param {Object} deps.unifiedAIService - AI service for narrative generation
   * @param {Object} deps.configService - Configuration service
   */
  constructor({ logger, unifiedAIService, configService }) {
    this.logger = logger || console;
    this.unifiedAIService = unifiedAIService;
    this.configService = configService;
    
    // DM persona configuration
    this.dmName = 'The Dungeon Master';
    this.dmEmoji = '🎲';
    this.enabled = (process.env.DM_NARRATOR_ENABLED || 'true') === 'true';
    this.narrativeModel = process.env.DM_NARRATOR_MODEL || 'google/gemini-2.0-flash-001';
  }

  /**
   * Generate narrative for a combat action
   * @param {Object} options
   * @param {Object} options.action - The combat action (type, target)
   * @param {Object} options.result - The result (hit/miss, damage, critical)
   * @param {Object} options.attacker - The attacking combatant
   * @param {Object} options.defender - The defending combatant (if attack)
   * @param {Object} options.encounter - The current encounter state
   * @returns {Promise<string>} Narrative description
   */
  async narrateAction({ action, result, attacker, defender, encounter }) {
    if (!this.enabled) {
      return this._getFallbackNarrative(action, result, attacker, defender);
    }

    try {
      const prompt = this._buildActionPrompt({ action, result, attacker, defender, encounter });
      
      const response = await this.unifiedAIService.chat([
        { role: 'system', content: this._getDMSystemPrompt() },
        { role: 'user', content: prompt }
      ], {
        model: this.narrativeModel,
        temperature: 0.85,
        max_tokens: 150
      });

      const narrative = (response?.text || '').trim();
      if (narrative && narrative.length > 10) {
        this.logger?.debug?.(`[DMNarrator] Generated: "${narrative.slice(0, 100)}..."`);
        return `*${narrative.replace(/^\*|\*$/g, '')}*`; // Ensure italics
      }
    } catch (e) {
      this.logger?.warn?.(`[DMNarrator] AI narration failed: ${e.message}`);
    }

    return this._getFallbackNarrative(action, result, attacker, defender);
  }

  /**
   * Generate narrative for combat start
   * @param {Object} encounter - The encounter state
   * @returns {Promise<string>}
   */
  async narrateCombatStart(encounter) {
    if (!this.enabled || !this.unifiedAIService?.chat) {
      return this._pickRandom(NARRATIVE_TEMPLATES.combatStart);
    }

    try {
      const combatants = (encounter.combatants || [])
        .map(c => c.name)
        .join(', ');

      const prompt = `Combat is about to begin between: ${combatants}.
Write ONE dramatic sentence announcing the start of battle. Be vivid and concise.`;

      const response = await this.unifiedAIService.chat([
        { role: 'system', content: this._getDMSystemPrompt() },
        { role: 'user', content: prompt }
      ], {
        model: this.narrativeModel,
        temperature: 0.9,
        max_tokens: 100
      });

      return `*${(response?.text || '').trim().replace(/^\*|\*$/g, '')}*`;
    } catch {
      return this._pickRandom(NARRATIVE_TEMPLATES.combatStart);
    }
  }

  /**
   * Generate narrative for round start
   * @param {number} round - Round number
   * @param {Object} encounter - Encounter state
   * @returns {Promise<string>}
   */
  async narrateRoundStart(round, _encounter) {
    if (!this.enabled || round <= 1) {
      return ''; // Skip round 1 (covered by combat start)
    }

    const template = this._pickRandom(NARRATIVE_TEMPLATES.roundStart);
    return this._fillTemplate(template, { round });
  }

  /**
   * Generate narrative for knockout/death
   * @param {Object} attacker - The attacker
   * @param {Object} victim - The defeated combatant
   * @param {boolean} isDeath - Whether this is a permanent death
   * @returns {Promise<string>}
   */
  async narrateDefeat(attacker, victim, isDeath = false) {
    if (!this.enabled || !this.unifiedAIService?.chat) {
      const templates = isDeath ? NARRATIVE_TEMPLATES.death : NARRATIVE_TEMPLATES.knockout;
      return this._fillTemplate(this._pickRandom(templates), {
        attacker: attacker?.name || 'The attacker',
        defender: victim?.name || 'Their opponent'
      });
    }

    try {
      const deathType = isDeath ? 'permanent death' : 'knockout';
      const prompt = `${attacker?.name || 'The attacker'} has just dealt the final blow to ${victim?.name || 'their opponent'}, resulting in a ${deathType}.
Write ONE dramatic sentence describing this moment. Be vivid but respectful.`;

      const response = await this.unifiedAIService.chat([
        { role: 'system', content: this._getDMSystemPrompt() },
        { role: 'user', content: prompt }
      ], {
        model: this.narrativeModel,
        temperature: 0.85,
        max_tokens: 100
      });

      return `*${(response?.text || '').trim().replace(/^\*|\*$/g, '')}*`;
    } catch {
      const templates = isDeath ? NARRATIVE_TEMPLATES.death : NARRATIVE_TEMPLATES.knockout;
      return this._fillTemplate(this._pickRandom(templates), {
        attacker: attacker?.name || 'The attacker',
        defender: victim?.name || 'Their opponent'
      });
    }
  }

  /**
   * Get DM system prompt
   * @private
   */
  _getDMSystemPrompt() {
    return `You are a dramatic D&D Dungeon Master narrating combat.
Your role is to describe what HAPPENS, not what characters SAY.
Write in third person, present tense. Be vivid but CONCISE (1-2 sentences max).
Use dramatic language but don't be melodramatic.
Focus on the ACTION, not the emotions.
Do NOT include dialogue or quotes from characters.
Do NOT start with "I" or speak in first person.`;
  }

  /**
   * Build prompt for action narration
   * @private
   */
  _buildActionPrompt({ action, result, attacker, defender, encounter }) {
    const parts = [];
    
    parts.push(`Round ${encounter?.round || 1} of combat.`);
    
    // Guard against undefined action
    const actionType = action?.type;
    
    if (actionType === 'attack' && defender) {
      const hitOrMiss = ['hit', 'knockout', 'dead'].includes(result?.result) ? 'HIT' : 'MISS';
      const criticalNote = result?.critical ? ' (CRITICAL!)' : '';
      const damageNote = result?.damage ? ` dealing ${result.damage} damage` : '';
      
      parts.push(`${attacker?.name || 'The attacker'} attacks ${defender?.name || 'their target'}.`);
      parts.push(`Result: ${hitOrMiss}${criticalNote}${damageNote}.`);
      
      if (result?.result === 'knockout') {
        parts.push(`${defender?.name} is knocked unconscious!`);
      } else if (result?.result === 'dead') {
        parts.push(`${defender?.name} is slain!`);
      }
      
      parts.push(`\nDescribe this attack in ONE vivid sentence.`);
    } else if (actionType === 'defend') {
      parts.push(`${attacker?.name || 'The combatant'} takes a defensive stance.`);
      parts.push(`Describe this in ONE sentence.`);
    } else if (actionType === 'flee') {
      parts.push(`${attacker?.name || 'The combatant'} attempts to flee.`);
      parts.push(`Describe this in ONE sentence.`);
    } else if (!actionType) {
      // Fallback for missing action type
      parts.push(`${attacker?.name || 'A combatant'} takes action in battle.`);
      parts.push(`Describe this moment in ONE sentence.`);
    }

    return parts.join('\n');
  }

  /**
   * Get fallback narrative when AI is unavailable
   * @private
   */
  _getFallbackNarrative(action, result, attacker, defender) {
    const attackerName = attacker?.name || 'The attacker';
    const defenderName = defender?.name || 'Their opponent';

    if (action?.type === 'attack') {
      if (result?.result === 'knockout') {
        return this._fillTemplate(this._pickRandom(NARRATIVE_TEMPLATES.knockout), {
          attacker: attackerName,
          defender: defenderName
        });
      }
      if (result?.result === 'dead') {
        return this._fillTemplate(this._pickRandom(NARRATIVE_TEMPLATES.death), {
          attacker: attackerName,
          defender: defenderName
        });
      }
      if (result?.critical) {
        return this._fillTemplate(this._pickRandom(NARRATIVE_TEMPLATES.attackCritical), {
          attacker: attackerName,
          defender: defenderName
        });
      }
      if (['hit', 'knockout', 'dead'].includes(result?.result)) {
        return this._fillTemplate(this._pickRandom(NARRATIVE_TEMPLATES.attackHit), {
          attacker: attackerName,
          defender: defenderName
        });
      }
      return this._fillTemplate(this._pickRandom(NARRATIVE_TEMPLATES.attackMiss), {
        attacker: attackerName,
        defender: defenderName
      });
    }

    if (action?.type === 'defend') {
      return this._fillTemplate(this._pickRandom(NARRATIVE_TEMPLATES.defend), {
        name: attackerName
      });
    }

    if (action?.type === 'flee') {
      return this._fillTemplate(this._pickRandom(NARRATIVE_TEMPLATES.flee), {
        name: attackerName
      });
    }

    return '*The battle continues...*';
  }

  /**
   * Pick random template
   * @private
   */
  _pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /**
   * Fill template variables
   * @private
   */
  _fillTemplate(template, vars = {}) {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }
    return result;
  }
}

export default DMNarratorService;
