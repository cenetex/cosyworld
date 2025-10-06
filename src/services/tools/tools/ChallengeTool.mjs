import { resolveAdminAvatarId } from '../../social/adminAvatarResolver.mjs';
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

  /**
   * Get parameter schema for LLM tool calling
   */
  getParameterSchema() {
    return {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'The name of the avatar to challenge to a duel'
        }
      },
      required: ['target']
    };
  }

  async execute(message, params, avatar, services) {
    // Block initiating combat if actor cannot enter (KO/dead/knockout or flee cooldown)
    try {
      const now = Date.now();
      if (avatar?.status === 'dead') return null;
      if (avatar?.status === 'knocked_out') return null;
      if (avatar?.knockedOutUntil && now < avatar.knockedOutUntil) return `-# 💤 [ **${avatar.name}** cannot fight again today. ]`;
      if (avatar?.combatCooldownUntil && now < avatar.combatCooldownUntil) return `-# 💤 [ **${avatar.name}** is resting after a narrow escape and cannot enter combat yet. ]`;
    } catch {}
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
      // Defender state checks for clearer reasons
      try {
        const now = Date.now();
        if (defender.status === 'dead') {
          return `-# ⚰️ [ **${defender.name}** is already dead! Have some respect for the fallen. ]`;
        }
        if (defender.knockedOutUntil && now < defender.knockedOutUntil) {
          return `-# 💤 [ **${defender.name}** cannot fight again today. ]`;
        }
        if (defender.combatCooldownUntil && now < defender.combatCooldownUntil) {
          return `-# 💤 [ **${defender.name}** refuses to fight after fleeing. ]`;
        }
      } catch {}

      // Ensure encounter exists but defer start while we post poster + chatter
      const ces = services?.combatEncounterService;
      if (!ces?.ensureEncounterForAttack) return `-# [ ❌ Combat system unavailable. ]`;

      const before = ces.getEncounter(message.channel.id);
      let encounter;
      try {
        encounter = await ces.ensureEncounterForAttack({ channelId: message.channel.id, attacker: avatar, defender, sourceMessage: message, deferStart: true });
      } catch (e) {
        const msg = String(e?.message || '').toLowerCase();
        if (msg.includes('flee_cooldown')) {
          return `-# 💤 [ Combat cannot start: one combatant recently fled and is on cooldown. ]`;
        }
        if (msg.includes('knockout_cooldown')) {
          return `-# 💤 [ Combat cannot start: one combatant is knocked out and cannot fight today. ]`;
        }
        throw e;
      }
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
              // Optional: auto-post to X for admin account and attach tweet info to encounter
              try {
                const autoX = String(process.env.X_AUTO_POST_BATTLES || 'false').toLowerCase();
                const xsvc = this.configService?.services?.xService;
                if (autoX === 'true' && xsvc && poster.imageUrl) {
                  let admin = null;
                  try {
                    const envId = resolveAdminAvatarId();
                    if (envId && /^[a-f0-9]{24}$/i.test(envId)) {
                      admin = await this.configService.services.avatarService.getAvatarById(envId);
                    } else {
                      const aiCfg = this.configService?.getAIConfig?.(process.env.AI_SERVICE);
                      const model = aiCfg?.chatModel || aiCfg?.model || process.env.OPENROUTER_CHAT_MODEL || process.env.GOOGLE_AI_CHAT_MODEL || 'default';
                      const safe = String(model).toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
                      admin = { _id: `model:${safe}`, name: `System (${model})`, username: process.env.X_ADMIN_USERNAME || undefined };
                    }
                  } catch {}
                  if (admin) {
                    const locName = loc?.location?.name || 'Unknown Arena';
                    const text = `⚔️ ${avatar.name} vs ${defender.name} — ${locName}`;
                    const { tweetId, tweetUrl } = await xsvc.postImageToXDetailed(admin, poster.imageUrl, text);
                    try {
                      const enc = services?.combatEncounterService?.getEncounter(message.channel.id);
                      if (enc) { enc._xTweetId = tweetId; enc._xTweetUrl = tweetUrl; }
                    } catch {}
                  }
                }
              } catch (e) { this.logger?.warn?.(`[ChallengeTool] auto X poster post failed: ${e.message}`); }
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
      const reason = String(error?.message || '').trim();
      this.logger?.error?.(`[ChallengeTool] error: ${reason}`);
      // Provide a slightly more descriptive fallback when we have a reason code
      if (reason) {
        const friendly = reason
          .replace(/_/g, ' ')
          .replace(/^([a-z])/, (m, c) => c.toUpperCase());
        return `-# [ ❌ Error: Challenge failed — ${friendly}. ]`;
      }
      return `-# [ ❌ Error: Challenge failed. Please try again later. ]`;
    }
  }

  getDescription() { return this.description; }
  async getSyntax() { return `${this.emoji} <target>`; }
}

export default ChallengeTool;
