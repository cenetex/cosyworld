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
    const encounterService = services?.combatEncounterService;
    if (!message?.channel?.isThread?.() && encounterService?.getEncounterByParentChannelId) {
      const parentEncounter = encounterService.getEncounterByParentChannelId(message.channel.id);
      if (parentEncounter && parentEncounter.state !== 'ended') {
        return `-# [ Combat is active in <#${parentEncounter.channelId}>. ]`;
      }
    }
    if (!params || !params[0]) {
      return `-# [ ❌ Error: No target specified. ]`;
    }
    const targetText = params.join(' ').trim();

    try {
      const locationResult = await this.mapService.getLocationAndAvatars(message.channel.id);
      if (!locationResult || !Array.isArray(locationResult.avatars)) {
        return `-# 🤔 [ The avatar can't be found! ]`;
      }

      // Use flexible matching similar to camera/summon tools
      const attackerId = String(avatar?._id || avatar?.id || '');
      const matches = this.avatarService.matchAvatarsByContent(
        targetText,
        locationResult.avatars,
        {
          limit: 1,
          excludeAvatarIds: attackerId ? [attackerId] : []
        }
      );

      const defender = matches.length > 0 ? matches[0] : null;
      if (!defender) {
        return `-# 🤔 [ The avatar can't be found! ]`;
      }

      // Additional safeguard: Block self-combat (should already be filtered by excludeAvatarIds)
      const defenderId = String(defender?._id || defender?.id || '');
      if (attackerId && defenderId && attackerId === defenderId) {
        this.logger?.warn?.(`[ChallengeTool] Self-combat blocked: ${avatar?.name} tried to challenge themselves`);
        return `-# 🤔 [ You cannot challenge yourself to combat! ]`;
      }

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
      if (!encounterService?.ensureEncounterForAttack) return `-# [ ❌ Combat system unavailable. ]`;

      const before = encounterService.getEncounter(message.channel.id) ||
        encounterService.getEncounterByParentChannelId?.(message.channel.id);
      let encounter;
      try {
        encounter = await encounterService.ensureEncounterForAttack({ channelId: message.channel.id, attacker: avatar, defender, sourceMessage: message, deferStart: true });
      } catch (e) {
        const msg = String(e?.message || '').toLowerCase();
        if (msg.includes('self_combat')) {
          return `-# 🤔 [ You cannot challenge yourself to combat! ]`;
        }
        if (msg.includes('thread_required')) {
          return `-# [ ❌ Combat must happen in a thread. Please enable threads in this channel. ]`;
        }
        if (msg.includes('flee_cooldown')) {
          return `-# 💤 [ Combat cannot start: one combatant recently fled and is on cooldown. ]`;
        }
        if (msg.includes('knocked_out_status')) {
          // More engaging message for knocked out status
          const knockedOutAvatar = defender.status === 'knocked_out' || defender.status === 'dead' ? defender : avatar;
          return `-# 🛡️ [ **Challenge Failed**: ${knockedOutAvatar.name} is knocked out and recovering. They cannot enter combat at this time. ]`;
        }
        if (msg.includes('knockout_cooldown')) {
          return `-# 💤 [ Combat cannot start: one combatant is still recovering from being knocked out. ]`;
        }
        throw e;
      }
      const encounterChannelId = encounter?.channelId || message.channel.id;
      const locationChannelId = encounter?.parentChannelId || encounterChannelId;
      const redirectToThread = !!encounter?.parentChannelId && message.channel.id !== encounterChannelId;
      const isNew = !before && !!encounter;
      this.logger?.info?.(`[ChallengeTool][${message.channel.id}] ${avatar.name} challenges ${defender.name} (isNew=${isNew}).`);

      // React to acknowledge challenge
      try { this.discordService?.reactToMessage?.(message, '⚔️'); } catch {}

      // Gate turn system while we post the poster and chatter
      try { encounterService.beginManualAction(encounterChannelId); } catch {}
      try {
        const battleMedia = services?.battleMediaService || this.battleMediaService;
        const loc = await this.mapService.getLocationAndAvatars(locationChannelId);
        if (battleMedia?.generateFightPoster) {
          const poster = await battleMedia.generateFightPoster({ attacker: avatar, defender, location: loc?.location });
          if (poster?.imageUrl && this.discordService?.client) {
            // Store poster URL on encounter for later video generation reuse
            try {
              const enc = encounterService.getEncounter(encounterChannelId);
              if (enc) enc.fightPosterUrl = poster.imageUrl;
            } catch {}
            
            const channel = await this.discordService.client.channels.fetch(encounterChannelId);
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
                      const enc = services?.combatEncounterService?.getEncounter(encounterChannelId);
                      if (enc) { enc._xTweetId = tweetId; enc._xTweetUrl = tweetUrl; }
                    } catch {}
                  }
                }
              } catch (e) { this.logger?.warn?.(`[ChallengeTool] auto X poster post failed: ${e.message}`); }
              
              // NO ConversationManager chatter here - combat system handles dialogue autonomously
              // Old code was causing spam by triggering full AI responses with tool execution
            }
          }
        }
      } catch (e) {
        this.logger?.warn?.(`[ChallengeTool] poster generation failed: ${e.message}`);
      } finally {
        try { encounterService.endManualAction(encounterChannelId); } catch {}
        try { const enc = encounterService.getEncounter(encounterChannelId); enc?.posterBlocker?.resolve?.(); } catch {}
      }

      // Start encounter (initiative roll + turn system)
      // NO ConversationManager chatter - combat system handles all actions
      try { await encounterService.rollInitiative(encounterService.getEncounter(encounterChannelId)); } catch {}
      return redirectToThread ? `-# [ Combat started in <#${encounterChannelId}>. ]` : null;
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
