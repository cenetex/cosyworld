/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { BasicTool } from '../BasicTool.mjs';

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

  async execute(message, _params, avatar, _services) {
    try {
      if (!this.battleService?.hide) {
        return `-# [ ❌ Hide is not available. ]`;
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
