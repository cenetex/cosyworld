import { postFightPoster } from '../battleMediaHelper.mjs';
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
  this.description = 'Perform an explicit attack against a target (use ⚔️ challenge to initiate combat).';
  this.emoji = '🗡️';
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

  /**
   * Get parameter schema for LLM tool calling
   */
  getParameterSchema() {
    return {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'The name of the avatar to attack'
        }
      },
      required: ['target']
    };
  }

  async execute(message, params, avatar, services) {
    // Disallow actions from KO'd or dead actors
    try {
      const now = Date.now();
      if (avatar?.status === 'dead') return null;
      if (avatar?.status === 'knocked_out') return null;
      if (avatar?.knockedOutUntil && now < avatar.knockedOutUntil) return null;
    } catch {}

    const encounterService = services?.combatEncounterService;
    if (!message?.channel?.isThread?.() && encounterService?.getEncounterByParentChannelId) {
      const parentEncounter = encounterService.getEncounterByParentChannelId(message.channel.id);
      if (parentEncounter && parentEncounter.state !== 'ended') {
        return `-# [ Combat is active in <#${parentEncounter.channelId}>. ]`;
      }
    }

    // Check for dungeon context first (for target suggestions)
    const dungeonService = services?.dungeonService;
    const characterService = services?.characterService;
    let dungeonTargets = [];
    let inDungeon = false;
    
    if (dungeonService) {
      try {
        // Try channel-based lookup first (works even if avatar has no partyId yet)
        let dungeon = await dungeonService.getActiveDungeonByChannel?.(message.channel.id);

        // Fallback: check via character sheet → partyId → dungeon
        if (!dungeon && characterService) {
          const sheet = await characterService.getSheet(avatar._id);
          if (sheet?.partyId) {
            dungeon = await dungeonService.getActiveDungeon(sheet.partyId);
          }
        }

        if (dungeon) {
            inDungeon = true;
            const room = dungeon.rooms.find(r => r.id === dungeon.currentRoom);
            if (room?.encounter?.monsters?.length && !room.cleared) {
              // Deduplicate monsters by name, combining counts
              const monsterMap = new Map();
              for (const m of room.encounter.monsters) {
                const name = m.name || m.id || m.monsterId;
                if (monsterMap.has(name)) {
                  monsterMap.get(name).count += (m.count || 1);
                } else {
                  monsterMap.set(name, {
                    name,
                    emoji: m.emoji || '👹',
                    count: m.count || 1,
                    stats: m.stats
                  });
                }
              }
              dungeonTargets = Array.from(monsterMap.values());
            }
        }
      } catch (e) {
        this.logger?.warn?.(`[AttackTool] Dungeon check failed: ${e.message}`);
      }
    }

  if (!params || !params[0]) {
      // Show available targets if in dungeon with monsters
      if (inDungeon && dungeonTargets.length > 0) {
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import('discord.js');
        // Use the monster name directly - CombatTargetRegistry handles matching
        // Encode name to handle special chars but preserve underscores as a space marker
        // Get targets from active combat encounter for proper IDs
        const encounter = encounterService?.getEncounterByChannelId?.(message.channel.id);
        const combatTargets = encounter?.combatants?.filter(c => c.isMonster && (c.currentHp || 0) > 0) || [];
        
        // Use combat encounter targets if available (has proper avatarId), otherwise fall back to dungeon targets
        const usingCombatTargets = combatTargets.length > 0;
        const buttonsSource = usingCombatTargets ? combatTargets : dungeonTargets;
        
        const targetButtons = buttonsSource.slice(0, 5).map(t => {
          // Use avatarId for combat targets; use name for dungeon targets to keep name-based matching
          const targetId = usingCombatTargets
            ? (t.combatantId || t.avatarId || t.id || t.monsterId || t.name)
            : (t.name || t.id || t.monsterId || t.avatarId);
          const displayName = t.name || 'Unknown';
          const count = t.count || 1;
          const hp = t.currentHp ?? t.stats?.hp ?? '?';
          return new ButtonBuilder()
            .setCustomId(`dnd_target_${encodeURIComponent(String(targetId))}`)
            .setLabel(`${count > 1 ? count + 'x ' : ''}${displayName} (${hp}HP)`.slice(0, 80))
            .setEmoji(t.emoji || '👹')
            .setStyle(ButtonStyle.Danger);
        });
        const row = new ActionRowBuilder().addComponents(targetButtons);
        
        // Use the same source for fields display
        const fieldsSource = combatTargets.length > 0 ? combatTargets : dungeonTargets;
        
        return {
          embeds: [{
            title: '🎯 Select Target',
            description: `**${avatar.name}** readies an attack!\nChoose your target:`,
            color: 0xFF4757,
            fields: fieldsSource.slice(0, 5).map(t => ({
              name: `${t.emoji || '👹'} ${t.name || 'Unknown'}`,
              value: `HP: ${t.currentHp ?? t.stats?.hp ?? '?'} | AC: ${t.armorClass ?? t.stats?.ac ?? '?'}`,
              inline: true
            }))
          }],
          components: [row]
        };
      }
      
      // Attempt AI intent parse if encounter active
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

    const targetText = params.join(' ').trim();

    try {
      // V3 FIX: Check for active combat encounter FIRST and use CombatTargetRegistry
      // This fixes the "Ghost Enemy" bug where monsters exist in combat but not on the map
      const combatTargetRegistry = services?.combatTargetRegistry;
      
      if (encounterService && combatTargetRegistry) {
        const encounter = encounterService.getEncounterByChannelId?.(message.channel.id) || 
                          encounterService.getEncounter?.(message.channel.id);
        
        if (encounter?.state === 'active') {
          // We're in active combat - use registry for target resolution
          const attackerId = String(avatar?._id || avatar?.id || '');
          const target = combatTargetRegistry.resolveTarget(
            message.channel.id,
            targetText,
            { excludeAvatarIds: [attackerId] }
          );
          
          if (target) {
            // Turn enforcement
            if (!encounterService.isTurn(encounter, attackerId)) {
              // Silently ignore out-of-turn attempts
              return null;
            }
            
            // Execute attack against combat target
            this.logger?.info?.(`[AttackTool][${message.channel.id}] ${avatar.name} attacks ${target.name} (via CombatTargetRegistry)`);
            
            // Pre-register a blocker so turn won't advance until we finish
            let resolveBlocker = null;
            try {
              const p = new Promise(res => { resolveBlocker = res; });
              encounterService.addTurnAdvanceBlocker?.(message.channel.id, p);
            } catch {}
            
            const result = await this.battleService.attack({ 
              message, 
              attacker: avatar, 
              defender: target.ref || target, 
              services,
              encounterManaged: true  // V6: encounter system owns HP tracking
            });
            
            try { resolveBlocker?.(); } catch {}
            
            // Notify combat service that player action is complete
            // V4: Pass full result and target info for DM narration embed
            try {
              if (encounterService.completePlayerAction) {
                await encounterService.completePlayerAction(message.channel.id, attackerId, {
                  actionType: 'attack',
                  damage: result?.damage,
                  targetId: target.avatarId || target._id,
                  target: target,
                  attacker: avatar,
                  result: result,
                  attackRoll: result?.attackRoll,
                  armorClass: result?.armorClass,
                  critical: result?.critical
                });
              }
            } catch (e) {
              this.logger?.warn?.(`[AttackTool] completePlayerAction failed: ${e.message}`);
            }
            
            // V4: Return null since the DM narration embed is now posted by combatMessagingService
            // This prevents duplicate messaging (ephemeral + embed)
            return null;
          } else {
            // Target not found in combat - show valid targets to help player
            const validTargets = combatTargetRegistry.getValidTargets(message.channel.id, avatar._id);
            if (validTargets.length > 0) {
              const targetList = validTargets.map(t => 
                `• **${t.name}** (${t.currentHp}/${t.maxHp} HP)`
              ).join('\n');
              return `-# 🫠 [ Target '${targetText}' not found in combat. ]\n\n**Valid targets:**\n${targetList}`;
            }
            return `-# 🫠 [ Target '${targetText}' not found. No valid targets in combat. ]`;
          }
        }
      }

      // Check if we're in a dungeon encounter first (via channel or partyId)
      
      if (dungeonService) {
        // Channel-based lookup first, then partyId fallback
        let dungeon = await dungeonService.getActiveDungeonByChannel?.(message.channel.id);
        if (!dungeon && characterService) {
          try {
            const sheet = await characterService.getSheet(avatar._id);
            if (sheet?.partyId) dungeon = await dungeonService.getActiveDungeon(sheet.partyId);
          } catch {}
        }

        if (dungeon) {
            // We're in a dungeon! Check for room monsters
            const room = dungeon.rooms.find(r => r.id === dungeon.currentRoom);
            if (room?.encounter?.monsters?.length && !room.cleared) {
              // Match target against dungeon monsters
              const monsterMatch = room.encounter.monsters.find(m => {
                const target = targetText.toLowerCase();
                const keys = [m.name, m.id, m.monsterId].filter(Boolean).map(k => k.toLowerCase());
                const keyMatch = keys.some(k => k.includes(target) || target.includes(k));
                if (keyMatch) return true;
                const mName = (m.name || '').toLowerCase();
                return mName.split(' ').some(w => w.length >= 3 && target.includes(w));
              });
              
              if (monsterMatch) {
                // V6 FIX: Always route through the encounter system — never call
                // battleService.attack directly, as that bypasses turn tracking
                // and allows unlimited attacks outside the initiative order.
                let dungeonEncounter = encounterService?.getEncounter(message.channel.id);
                
                if (!dungeonEncounter || !dungeonEncounter.dungeonContext) {
                  // Start dungeon combat — this creates the encounter and rolls initiative
                  dungeonEncounter = await dungeonService.startRoomCombat(
                    String(dungeon._id), 
                    dungeon.currentRoom, 
                    message.channel.id
                  );
                  if (!dungeonEncounter) {
                    return `-# [ ❌ Failed to start dungeon combat. ]`;
                  }
                }
                
                // Now that the encounter exists, the top-of-function active-encounter
                // block will handle it on the player's next attack attempt. Show a
                // prompt with the target buttons so the player can re-select.
                return `-# ⚔️ [ Combat has begun! Use the **Take Your Turn** button or 🗡️ to attack. ]`;
              }
            }
          }
      }

      // Fall through to normal map-based attack
      const locationResult = await this.mapService.getLocationAndAvatars(message.channel.id);
      if (!locationResult || !locationResult.location || !Array.isArray(locationResult.avatars)) {
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
        // React to source message to indicate invalid local target without verbose reply
        if (this.discordService?.reactToMessage) {
          this.discordService.reactToMessage(message, '👀');
        }
        return `-# 🫠 [ Target '${targetText}' not found here. ]`;
      }
      
      // Additional safeguard: Block self-combat (should already be filtered by excludeAvatarIds)
      const defenderId = String(defender?._id || defender?.id || '');
      if (attackerId && defenderId && attackerId === defenderId) {
        this.logger?.warn?.(`[AttackTool] Self-combat blocked: ${avatar?.name} tried to attack themselves`);
        return `-# 🤔 [ You cannot attack yourself! ]`;
      }
      
      const now = Date.now();
      if (defender.status === 'dead') {
        return `-# ⚰️ [ **${defender.name}** is already dead! Have some *respect* for the fallen. ]`;
      }
      if (defender.knockedOutUntil && now < defender.knockedOutUntil) {
        return `-# 💤 [ **${defender.name}** cannot fight again today. ]`;
      }
      if (defender.combatCooldownUntil && now < defender.combatCooldownUntil) {
        return `-# 💤 [ **${defender.name}** refuses to fight after fleeing. ]`;
      }
      if (avatar.knockedOutUntil && now < avatar.knockedOutUntil) {
        return `-# 💤 [ **${avatar.name}** is still recovering and cannot initiate combat. ]`;
      }
      if (avatar.combatCooldownUntil && now < avatar.combatCooldownUntil) {
        return `-# 💤 [ **${avatar.name}** is resting after a narrow escape and cannot enter combat yet. ]`;
      }
      // Ensure encounter exists & both combatants present (no human command layer yet)
  let isNewEncounter = false;
  let initiatedAndReturned = false;
  try {
        if (encounterService?.ensureEncounterForAttack) {
          const before = encounterService.getEncounter(message.channel.id) ||
            encounterService.getEncounterByParentChannelId?.(message.channel.id);
          let encounter;
          try {
            encounter = await encounterService.ensureEncounterForAttack({ channelId: message.channel.id, attacker: avatar, defender, sourceMessage: message, deferStart: true });
          } catch (e) {
            const msg = String(e?.message || '').toLowerCase();
            if (msg.includes('self_combat')) {
              return `-# 🤔 [ You cannot attack yourself! ]`;
            }
            if (msg.includes('thread_required')) {
              return `-# [ ❌ Combat must happen in a thread. Please enable threads in this channel. ]`;
            }
            if (msg.includes('flee_cooldown')) {
              return `-# 💤 [ Combat cannot start: one combatant recently fled and is on cooldown. ]`;
            }
            if (msg.includes('knocked_out_status')) {
              // More engaging message for knocked out status - try to identify which avatar
              const knockedOutAvatar = defender?.status === 'knocked_out' || defender?.status === 'dead' ? defender : avatar;
              return `-# 🛡️ [ **Attack Failed**: ${knockedOutAvatar.name} is knocked out and recovering. They cannot enter combat at this time. ]`;
            }
            if (msg.includes('knockout_cooldown')) {
              return `-# 💤 [ Combat cannot start: one combatant is still recovering from being knocked out. ]`;
            }
            throw e;
          }
          const encounterChannelId = encounter?.channelId || message.channel.id;
          const locationChannelId = encounter?.parentChannelId || encounterChannelId;
          const redirectToThread = !!encounter?.parentChannelId && message.channel.id !== encounterChannelId;
          isNewEncounter = !before && !!encounter;
          // If brand-new encounter, show location image and a "vs" fight poster
          if (isNewEncounter) {
            try {
        // Pause auto-acts/turn starts while we post the poster and chatter
        encounterService.beginManualAction(encounterChannelId);
        // React to the initiating message to acknowledge combat start
        try { this.discordService?.reactToMessage?.(message, '⚔️'); } catch {}
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
        // Done with poster/chatter
        encounterService.endManualAction(encounterChannelId);
        try { const enc = encounterService.getEncounter(encounterChannelId); enc?.posterBlocker?.resolve?.(); } catch {}
              // Now start the encounter formally (initiative + chatter + timers)
              try { await encounterService.rollInitiative(encounterService.getEncounter(encounterChannelId)); } catch {}
              // Do NOT attack now; mark and return after initiating combat (no extra text reply)
              initiatedAndReturned = true;
              return redirectToThread ? `-# [ Combat started in <#${encounterChannelId}>. ]` : null;
            } catch (e) {
              this.logger?.warn?.(`[AttackTool] fight poster init failed: ${e.message}`);
        try { services?.combatEncounterService?.endManualAction(encounterChannelId); } catch {}
        try { const enc = services?.combatEncounterService?.getEncounter(encounterChannelId); enc?.posterBlocker?.resolve?.(); } catch {}
              try { await services?.combatEncounterService?.rollInitiative(services?.combatEncounterService?.getEncounter(encounterChannelId)); } catch {}
              // Return after starting combat despite poster failure fallback (no extra text reply)
              initiatedAndReturned = true;
              return redirectToThread ? `-# [ Combat started in <#${encounterChannelId}>. ]` : null;
            }
          }
          // Turn enforcement (only for active encounters)
          const current = encounterService.getEncounter(encounterChannelId);
          if (current?.state === 'active' && !encounterService.isTurn(current, avatar.id || avatar._id)) {
            // Silently ignore out-of-turn attempts to reduce clutter
            return null;
          }
        }
      } catch (e) {
  this.logger?.warn?.(`[AttackTool] encounter ensure failed: ${e.message}`);
      }
  // If we just initiated and returned, stop here (no immediate attack)
  if (initiatedAndReturned) return;
  // Delegate to battleService
      // Pre-register a blocker so turn won't advance until we finish media posting
      let resolveBlocker = null;
      try {
        const p = new Promise(res => { resolveBlocker = res; });
        services?.combatEncounterService?.addTurnAdvanceBlocker?.(message.channel.id, p);
      } catch {}
  this.logger?.info?.(`[AttackTool][${message.channel.id}] ${avatar.name} attacks ${defender.name}`);
  // V8: Pass encounterManaged flag when in active encounter to prevent double damage
  // (battleService writes to DB, completePlayerAction applies to encounter state)
  const activeEnc = services?.combatEncounterService?.getEncounter?.(message.channel.id);
  const encounterManaged = activeEnc?.state === 'active';
  const result = await this.battleService.attack({ message, attacker: avatar, defender, services, encounterManaged });
  // No per-action media generation; proceed
      try { resolveBlocker && resolveBlocker(); } catch {}
      
      // Notify combat service that player action is complete (advances turn for player-controlled avatars)
      // V4: Pass full result and target info for DM narration embed
      try {
        const ces = services?.combatEncounterService;
        if (ces?.completePlayerAction) {
          await ces.completePlayerAction(message.channel.id, avatar._id || avatar.id, {
            actionType: 'attack',
            damage: result?.damage,
            targetId: defender?._id || defender?.id,
            target: defender,
            attacker: avatar,
            result: result,
            attackRoll: result?.attackRoll,
            armorClass: result?.armorClass,
            critical: result?.critical
          });
        }
      } catch (e) {
        this.logger?.warn?.(`[AttackTool] completePlayerAction failed: ${e.message}`);
      }
      
      // V4: Return null since DM narration embed is now posted by combatMessagingService
      return null;
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
