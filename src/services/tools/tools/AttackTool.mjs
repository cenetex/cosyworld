/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { BasicTool } from '../BasicTool.mjs';

export class AttackTool extends BasicTool {
  constructor({
    logger,
    configService,
    avatarService,
    databaseService,
    statService,
    mapService,
    conversationManager,
    diceService,
    battleService,
    aiService,
  googleAIService,
    s3Service,
  veoService,
  discordService,
  }) {

    super();
    this.logger = logger || console;
    this.configService = configService;
    this.avatarService = avatarService;
    this.databaseService = databaseService;
    this.statService = statService;
    this.mapService = mapService;
    this.conversationManager = conversationManager;
    this.diceService = diceService;
    this.battleService = battleService;
    this.aiService = aiService;
  this.discordService = discordService;
  // Optional secondary googleAIService for image/video if primary provider (e.g., OpenRouter) lacks it
  this.googleAIService = googleAIService;
    this.s3Service = s3Service;
  this.veoService = veoService; // optional video generation

    this.name = 'attack';
    this.parameters = '<target>';
    this.description = 'Attacks the specified avatar';
    this.emoji = '⚔️';
    this.replyNotification = true;
    this.cooldownMs = 30 * 1000; // 30 seconds cooldown

  // Video generation controls
  // Always two-phase: battle image first, then video from that image only
  // Optional: enable videos for critical hits and/or deaths with probability
  const env = (k, d) => (process.env[k] ?? d);
  this.enableCriticalHitVideo = env('BATTLE_VIDEO_CRITICAL_ENABLED', 'true') === 'true';
  this.enableDeathVideo = env('BATTLE_VIDEO_DEATH_ENABLED', 'true') === 'true';
  this.criticalHitVideoChance = Math.max(0, Math.min(1, parseFloat(env('BATTLE_VIDEO_CRITICAL_CHANCE', '0.5')) || 0.5));
  this.deathVideoChance = Math.max(0, Math.min(1, parseFloat(env('BATTLE_VIDEO_DEATH_CHANCE', '1')) || 1));
  }

  async execute(message, params, avatar, services) {
    if (!params || !params[0]) {
      // Attempt AI intent parse if encounter active
      const encounterService = services?.combatEncounterService;
      if (encounterService) {
        try {
          const locationResult = await this.mapService.getLocationAndAvatars(message.channel.id);
          const intent = await encounterService.parseCombatIntent({ messageContent: message.content, avatarsInLocation: locationResult?.avatars || [] });
          if (intent?.action === 'attack' && intent?.target) {
            params = [intent.target];
          } else {
            return `-# [ ❌ Error: No target specified. ]`;
          }
        } catch {
          return `-# [ ❌ Error: No target specified. ]`;
        }
      } else {
        return `-# [ ❌ Error: No target specified. ]`;
      }
    }

    const targetName = params.join(' ').trim();

    try {
      // Find defender in location
      const locationResult = await this.mapService.getLocationAndAvatars(message.channel.id);
      if (!locationResult || !locationResult.location || !Array.isArray(locationResult.avatars)) {
        return `-# 🤔 [ The avatar can't be found! ]`;
      }
      const defender = locationResult.avatars.find(a => a.name.toLowerCase() === targetName.toLowerCase());
      if (!defender) {
        // React to source message to indicate invalid local target without verbose reply
        if (this.discordService?.reactToMessage) {
          this.discordService.reactToMessage(message, '👀');
        }
        return `-# 🫠 [ Target '${targetName}' not found here. ]`;
      }
      const now = Date.now();
      if (defender.status === 'dead') {
        return `-# ⚰️ [ **${defender.name}** is already dead! Have some *respect* for the fallen. ]`;
      }
      if (defender.knockedOutUntil && now < defender.knockedOutUntil) {
        const remainingMs = defender.knockedOutUntil - now;
        const hours = Math.ceil(remainingMs / (60 * 60 * 1000));
        return `-# 💤 [ **${defender.name}** is recovering and cannot fight for ~${hours}h. ]`;
      }
      if (avatar.knockedOutUntil && now < avatar.knockedOutUntil) {
        const remainingMs = avatar.knockedOutUntil - now;
        const hours = Math.ceil(remainingMs / (60 * 60 * 1000));
        return `-# 💤 [ **${avatar.name}** is still recovering and cannot initiate combat for ~${hours}h. ]`;
      }
      // Ensure encounter exists & both combatants present (no human command layer yet)
      try {
        const encounterService = services?.combatEncounterService;
        if (encounterService?.ensureEncounterForAttack) {
          const encounter = await encounterService.ensureEncounterForAttack({ channelId: message.channel.id, attacker: avatar, defender, sourceMessage: message });
          // Turn enforcement
          if (!encounterService.isTurn(encounter, avatar.id || avatar._id)) {
            return `-# ⏳ [ It's not **${avatar.name}**'s turn. ]`;
          }
        }
      } catch (e) {
        this.logger?.warn?.(`[AttackTool] encounter ensure failed: ${e.message}`);
      }
      // Delegate to battleService
      const result = await this.battleService.attack({ message, attacker: avatar, defender, services });
      // Media: delegate to BattleMediaService if available
      const battleMedia = services?.battleMediaService || this.battleMediaService;
      if (battleMedia) {
        try {
          const media = await battleMedia.generateForAttack({ attacker: avatar, defender, result, location: locationResult.location });
          if (media?.text) return `${result.message}${media.text}`;
        } catch (e) {
          this.logger?.warn?.(`[AttackTool] media generation failed: ${e.message}`);
        }
      }
      return result.message;
    } catch (error) {
      this.logger.error(`Attack error: ${error.message}`);
      return `-# [ ❌ Error: Attack failed. Please try again later. ]`;
    }
  }

  getDescription() {
    return 'Attack another avatar';
  }

  async getSyntax() {
    return `${this.emoji} <target>`;
  }
}