/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { BasicTool } from '../BasicTool.mjs';
import { publishEvent as basePublishEvent } from '../../../events/envelope.mjs';

export class HideTool extends BasicTool {
  constructor({
    logger,
    avatarService,
    statService,
    diceService,
    battleService,
    mapService,
    discordService,
  }) {
    super();
    this.logger = logger || console;
    this.avatarService = avatarService;
    this.statService = statService;
    this.diceService = diceService;
    this.battleService = battleService;
    this.mapService = mapService;
    this.discordService = discordService;

    this.name = 'hide';
    this.parameters = '';
    this.description = 'Attempt to hide (Stealth check vs passive Perception). Grants advantage on the next attack until revealed.';
    this.emoji = '🫥';
    this.replyNotification = true;
    this.cooldownMs = 15 * 1000;
  }

  async execute(message, _params, avatar, services) {
    try {
      if (!this.battleService?.hide) {
        return `-# [ ❌ Hide is not available. ]`;
      }
      // If in encounter, enforce turn and consume turn
      const ces = services?.combatEncounterService;
      const enc = ces?.getEncounter?.(message.channel.id);
      if (enc && enc.state === 'active') {
        if (!ces.isTurn(enc, avatar.id || avatar._id)) return null;
        const publish = (evt) => { try { (services?.eventPublisher?.publishEvent || basePublishEvent)(evt); } catch {} };
        const corrId = message.id;
        const channelId = message.channel.id;
        const actorId = avatar.id || avatar._id;
        const res = await this.battleService.hide({ message, avatar });
        if (res?.result === 'success') {
          publish({ type: 'combat.hide.success', source: 'HideTool', corrId, payload: { avatarId: actorId, channelId } });
        } else if (res?.result === 'fail') {
          publish({ type: 'combat.hide.fail', source: 'HideTool', corrId, payload: { avatarId: actorId, channelId } });
        }
        return res?.message || res || `-# [ ${avatar.name} attempts to hide. ]`;
      }
      const res = await this.battleService.hide({ message, avatar });
      return res?.message || res || `-# [ ${avatar.name} attempts to hide. ]`;
    } catch (e) {
      this.logger?.error?.(`[HideTool] error: ${e.message}`);
      return `-# [ ❌ Error: Hide failed. ]`;
    }
  }

  getDescription() { return this.description; }
  async getSyntax() { return `${this.emoji}`; }
}

export default HideTool;
