/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { BasicTool } from '../BasicTool.mjs';

export class ChallengeTool extends BasicTool {
  constructor({
    logger,
    configService,
    avatarService,
    mapService,
    conversationManager,
    battleMediaService,
    discordService,
  }) {
    super();
    this.logger = logger || console;
    this.configService = configService;
    this.avatarService = avatarService;
    this.mapService = mapService;
    this.conversationManager = conversationManager;
    this.battleMediaService = battleMediaService;
    this.discordService = discordService;

    this.name = 'challenge';
    this.parameters = '<target>';
    this.description = 'Challenge another avatar to a duel (starts combat without attacking).';
    this.emoji = '⚔️';
    this.replyNotification = true;
    this.cooldownMs = 10 * 1000; // 10s to make initiating snappy
  }

  async execute(message, params, avatar, services) {
    if (!params || !params[0]) {
      return `-# [ ❌ Error: No target specified. ]`;
    }
    const targetName = params.join(' ').trim();

    try {
      const locationResult = await this.mapService.getLocationAndAvatars(message.channel.id);
      if (!locationResult || !Array.isArray(locationResult.avatars)) {
        return `-# 🤔 [ The avatar can't be found! ]`;
      }
      const defender = locationResult.avatars.find(a => a.name.toLowerCase() === targetName.toLowerCase());
      if (!defender) return `-# 🫠 [ Target '${targetName}' not found here. ]`;

      // Ensure encounter exists but defer start while we post poster + chatter
      const ces = services?.combatEncounterService;
      if (!ces?.ensureEncounterForAttack) return `-# [ ❌ Combat system unavailable. ]`;

      const before = ces.getEncounter(message.channel.id);
      const encounter = await ces.ensureEncounterForAttack({ channelId: message.channel.id, attacker: avatar, defender, sourceMessage: message, deferStart: true });
      const isNew = !before && !!encounter;
      this.logger?.info?.(`[ChallengeTool][${message.channel.id}] ${avatar.name} challenges ${defender.name} (isNew=${isNew}).`);

      // React to acknowledge challenge
      try { this.discordService?.reactToMessage?.(message, '⚔️'); } catch {}

      // Gate turn system while we post the poster and chatter
      try { ces.beginManualAction(message.channel.id); } catch {}
      try {
        const battleMedia = services?.battleMediaService || this.battleMediaService;
        const loc = await this.mapService.getLocationAndAvatars(message.channel.id);
        if (battleMedia?.generateFightPoster) {
          const poster = await battleMedia.generateFightPoster({ attacker: avatar, defender, location: loc?.location });
          if (poster?.imageUrl && this.discordService?.client) {
            const channel = await this.discordService.client.channels.fetch(message.channel.id);
            if (channel?.isTextBased()) {
              const embed = {
                title: `Combat Initiated: ${avatar.name} vs ${defender.name}`,
                description: loc?.location?.name ? `Location: ${loc.location.name}` : undefined,
                color: 0xff4757,
                image: { url: poster.imageUrl },
              };
              await channel.send({ embeds: [embed] });
              // Brief in-character chatter
              const cm = this.conversationManager;
              if (cm?.sendResponse) {
                try { await cm.sendResponse(channel, avatar, null, { overrideCooldown: true }); } catch {}
                try { await cm.sendResponse(channel, defender, null, { overrideCooldown: true }); } catch {}
              }
            }
          }
        }
      } catch (e) {
        this.logger?.warn?.(`[ChallengeTool] poster/chatter failed: ${e.message}`);
      } finally {
        try { ces.endManualAction(message.channel.id); } catch {}
        try { const enc = ces.getEncounter(message.channel.id); enc?.posterBlocker?.resolve?.(); } catch {}
      }

      // Start encounter (initiative + chatter + timers)
      try { await ces.rollInitiative(ces.getEncounter(message.channel.id)); } catch {}
      return null; // no extra text
    } catch (error) {
      this.logger?.error?.(`[ChallengeTool] error: ${error.message}`);
      return `-# [ ❌ Error: Challenge failed. Please try again later. ]`;
    }
  }

  getDescription() { return this.description; }
  async getSyntax() { return `${this.emoji} <target>`; }
}

export default ChallengeTool;
