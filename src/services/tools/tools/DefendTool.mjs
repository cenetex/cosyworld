/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { BasicTool } from '../BasicTool.mjs';

export class DefendTool extends BasicTool {
  constructor({
    configService,
    avatarService,
    battleService,
    mapService,
    conversationManager,
    diceService,
  }) {
    super();
    this.configService = configService;
    this.avatarService = avatarService;
    this.battleService = battleService;
    this.mapService = mapService;
    this.conversationManager = conversationManager;
    this.diceService = diceService;

    this.name = 'defend';
    this.description = 'Take a defensive stance';
    this.emoji = '🛡️';
    this.cooldownMs = 30 * 1000; // 30 seconds cooldown
  }

  async execute(message, params, avatar) {
    try {
      // If in an active encounter, enforce turn order and advance turn after defending
      const ces = (this.conversationManager?.toolService?.toolServices?.combatEncounterService) || null;
      let inEncounter = null;
      try { inEncounter = ces?.getEncounter?.(message.channel.id) || null; } catch {}
      if (inEncounter && inEncounter.state === 'active') {
        try {
          if (!ces.isTurn(inEncounter, avatar.id || avatar._id)) return null; // silent out-of-turn
          const msg = await this.battleService.defend({ avatar });
          // Reflect in encounter state
          try {
            const c = ces.getCombatant(inEncounter, avatar.id || avatar._id);
            if (c) c.isDefending = true;
            inEncounter.lastActionAt = Date.now();
          } catch {}
          await ces.nextTurn(inEncounter);
          return msg;
        } catch (e) {
          return `-# [ ❌ Error: Failed to defend: ${e.message} ]`;
        }
      }
      // Out of combat: just set defending state
      return await this.battleService.defend({ avatar });
    } catch (error) {
      return `-# [ ❌ Error: Failed to defend: ${error.message} ]`;
    }
  }

  getDescription() {
    return 'Take a defensive stance (+2 AC until next attack)';
  }

  async getSyntax() {
    return `${this.emoji}`;
  }
}
