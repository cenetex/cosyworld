import { postFightPoster } from '../battleMediaHelper.mjs';
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
    
    // V6 FIX: If there's already an active encounter in this channel, delegate to
    // the attack tool instead of blocking.  Players naturally use ⚔️ to mean "attack"
    // during combat, not just to initiate it.
    if (encounterService) {
      const activeEncounter = encounterService.getEncounterByChannelId?.(message.channel.id) || 
                               encounterService.getEncounter?.(message.channel.id);
      if (activeEncounter?.state === 'active') {
        // Delegate to attack tool — it handles turn enforcement and encounter integration
        const attackTool = services?.toolService?.tools?.get?.('attack') || 
                           services?.attackTool;
        if (attackTool?.execute) {
          return attackTool.execute(message, params, avatar, services);
        }
      }
    }
    
    if (!message?.channel?.isThread?.() && encounterService?.getEncounterByParentChannelId) {
      const parentEncounter = encounterService.getEncounterByParentChannelId(message.channel.id);
      if (parentEncounter && parentEncounter.state !== 'ended') {
        return `-# [ Combat is active in <#${parentEncounter.channelId}>. ]`;
      }
    }
    if (!params || !params[0]) {
      return `-# [ ❌ Error: No target specified. ]`;
    }
    const targetName = params.join(' ').trim();

    try {
      // ── Check for dungeon context first ──
      // If we're in a dungeon thread, the target may be a room monster rather than
      // an avatar on the map.  Resolve via channel-based dungeon lookup.
      const dungeonService = services?.dungeonService;
      const characterService = services?.characterService;
      if (dungeonService) {
        let dungeon = await dungeonService.getActiveDungeonByChannel?.(message.channel.id);
        if (!dungeon && characterService) {
          try {
            const sheet = await characterService.getSheet(avatar._id);
            if (sheet?.partyId) dungeon = await dungeonService.getActiveDungeon(sheet.partyId);
          } catch {}
        }
        if (dungeon) {
          const room = dungeon.rooms.find(r => r.id === dungeon.currentRoom);
          if (room?.encounter?.monsters?.length && !room.cleared) {
            const target = targetText.toLowerCase();
            const monsterMatch = room.encounter.monsters.find(m => {
              const keys = [m.name, m.id, m.monsterId].filter(Boolean).map(k => k.toLowerCase());
              return keys.some(k => k.includes(target) || target.includes(k))
                || (m.name || '').toLowerCase().split(' ').some(w => w.length >= 3 && target.includes(w));
            });
            if (monsterMatch) {
              // Start dungeon combat via the encounter service
              let dungeonEncounter = encounterService?.getEncounter?.(message.channel.id);
              if (!dungeonEncounter || !dungeonEncounter.dungeonContext) {
                dungeonEncounter = await dungeonService.startRoomCombat(
                  String(dungeon._id), dungeon.currentRoom, message.channel.id
                );
              }
              if (dungeonEncounter) {
                try { await encounterService.rollInitiative(dungeonEncounter); } catch {}
                return `-# ⚔️ [ **${avatar.name}** challenges the monsters! Combat begins! ]`;
              }
            }
          }
        }
      }

      const locationResult = await this.mapService.getLocationAndAvatars(message.channel.id);
      if (!locationResult || !Array.isArray(locationResult.avatars)) {
        return `-# 🤔 [ The avatar can't be found! ]`;
      }
      const defender = locationResult.avatars.find(a => a.name.toLowerCase() === targetName.toLowerCase());
      if (!defender) {
        return `-# � [ The avatar can't be found! ]`;
      }

      // Block self-combat - normalize both IDs properly
      const normalizeId = (obj) => {
        if (!obj) return '';
        const id = obj._id || obj.id;
        if (!id) return '';
        // Handle ObjectId objects
        if (typeof id === 'object' && id.toString) return id.toString();
        return String(id);
      };

      const attackerId = normalizeId(avatar);
      const defenderId = normalizeId(defender);

      // Comprehensive debug logging
      this.logger?.info?.(`[ChallengeTool] SELF-COMBAT CHECK:`);
      this.logger?.info?.(`  Attacker: name="${avatar?.name}" id="${attackerId}" raw_id="${JSON.stringify(avatar?._id || avatar?.id)}"`);
      this.logger?.info?.(`  Defender: name="${defender?.name}" id="${defenderId}" raw_id="${JSON.stringify(defender?._id || defender?.id)}"`);
      this.logger?.info?.(`  Match: ${attackerId === defenderId}`);

      if (attackerId && defenderId && attackerId === defenderId) {
        this.logger?.warn?.(`[ChallengeTool] Self-combat blocked: ${avatar?.name} tried to challenge themselves`);
        return `-# 🤔 [ You cannot challenge yourself to combat! ]`;
      }      // Defender state checks for clearer reasons
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
        await postFightPoster({
          attacker: avatar,
          defender,
          encounterChannelId,
          locationChannelId,
          battleMediaService: battleMedia,
          discordService: this.discordService,
          mapService: this.mapService,
          encounterService,
          configService: this.configService,
          logger: this.logger
        });
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
