/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { BasicTool } from '../BasicTool.mjs';

export class DefendTool extends BasicTool {
  constructor({
    battleService,
    conversationManager,
  }) {
    super();
    this.battleService = battleService;
    this.conversationManager = conversationManager;

    this.name = 'defend';
    this.description = 'Take a defensive stance';
    this.emoji = '🛡️';
    this.cooldownMs = 30 * 1000; // 30 seconds cooldown
  }

  async execute(message, params, avatar, services) {
    try {
      // Disallow actions from dead or KO'd avatars
      const now = Date.now();
      if (avatar?.status === 'dead' || avatar?.status === 'knocked_out' || (avatar?.knockedOutUntil && now < avatar.knockedOutUntil)) {
        return null;
      }

      // If in an active encounter, enforce turn order and advance turn after defending
      const ces = services?.combatEncounterService || 
                  (this.conversationManager?.toolService?.toolServices?.combatEncounterService) || null;
      if (!message?.channel?.isThread?.() && ces?.getEncounterByParentChannelId) {
        const parentEncounter = ces.getEncounterByParentChannelId(message.channel.id);
        if (parentEncounter && parentEncounter.state !== 'ended') {
          return `-# [ Combat is active in <#${parentEncounter.channelId}>. ]`;
        }
      }
      let inEncounter = null;
      try { inEncounter = ces?.getEncounter?.(message.channel.id) || null; } catch {}
      if (inEncounter && inEncounter.state === 'active') {
        try {
          if (!ces.isTurn(inEncounter, avatar.id || avatar._id)) return null; // silent out-of-turn
          await this.battleService.defend({ avatar });
          // Reflect in encounter state
          try {
            const c = ces.getCombatant(inEncounter, avatar.id || avatar._id);
            if (c) c.isDefending = true;
            inEncounter.lastActionAt = Date.now();
          } catch {}
          // Use completePlayerAction for consistency with player control
          // V4: Pass actionType for DM narration embed
          if (ces.completePlayerAction) {
            await ces.completePlayerAction(message.channel.id, avatar._id || avatar.id, {
              actionType: 'defend',
              attacker: avatar
            });
          } else {
            await ces.nextTurn(inEncounter);
          }
          // V4: Return null since DM narration embed is now posted by combatMessagingService
          return null;
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
