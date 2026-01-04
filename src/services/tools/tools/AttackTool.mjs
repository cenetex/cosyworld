import { resolveAdminAvatarId } from '../../social/adminAvatarResolver.mjs';
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

    // Check for dungeon context first (for target suggestions)
    const dungeonService = services?.dungeonService;
    const characterService = services?.characterService;
    let dungeonTargets = [];
    let inDungeon = false;
    
    if (dungeonService && characterService) {
      try {
        const sheet = await characterService.getSheet(avatar._id);
        if (sheet?.partyId) {
          const dungeon = await dungeonService.getActiveDungeon(sheet.partyId);
          if (dungeon) {
            inDungeon = true;
            const room = dungeon.rooms.find(r => r.id === dungeon.currentRoom);
            if (room?.encounter?.monsters?.length && !room.cleared) {
              // Deduplicate monsters by name, combining counts
              const monsterMap = new Map();
              for (const m of room.encounter.monsters) {
                const name = m.name || m.id;
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
        const targetButtons = dungeonTargets.slice(0, 5).map(t => 
          new ButtonBuilder()
            .setCustomId(`dnd_target_${encodeURIComponent(t.name)}`)
            .setLabel(`${t.count}x ${t.name}`.slice(0, 80)) // Discord button label limit
            .setEmoji(t.emoji)
            .setStyle(ButtonStyle.Danger)
        );
        const row = new ActionRowBuilder().addComponents(targetButtons);
        
        return {
          embeds: [{
            title: '🎯 Select Target',
            description: `**${avatar.name}** readies an attack!\nChoose your target:`,
            color: 0xFF4757,
            fields: dungeonTargets.map(t => ({
              name: `${t.emoji} ${t.name}`,
              value: `HP: ${t.stats?.hp || '?'} | AC: ${t.stats?.ac || '?'}`,
              inline: true
            }))
          }],
          components: [row]
        };
      }
      
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

    const targetText = params.join(' ').trim();

    try {
      // V3 FIX: Check for active combat encounter FIRST and use CombatTargetRegistry
      // This fixes the "Ghost Enemy" bug where monsters exist in combat but not on the map
      const encounterService = services?.combatEncounterService;
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
              services 
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

      // Check if we're in a dungeon encounter first (via context or dungeonService)
      
      if (dungeonService && characterService) {
        const sheet = await characterService.getSheet(avatar._id);
        if (sheet?.partyId) {
          const dungeon = await dungeonService.getActiveDungeon(sheet.partyId);
          if (dungeon) {
            // We're in a dungeon! Check for room monsters
            const room = dungeon.rooms.find(r => r.id === dungeon.currentRoom);
            if (room?.encounter?.monsters?.length && !room.cleared) {
              // Match target against dungeon monsters
              const monsterMatch = room.encounter.monsters.find(m => {
                const mName = (m.name || m.id || '').toLowerCase();
                const target = targetText.toLowerCase();
                return mName.includes(target) || target.includes(mName) || 
                       mName.split(' ').some(w => target.includes(w));
              });
              
              if (monsterMatch) {
                // Start or continue dungeon combat
                const encounterService = services?.combatEncounterService;
                let dungeonEncounter = encounterService?.getEncounter(message.channel.id);
                
                if (!dungeonEncounter || !dungeonEncounter.dungeonContext) {
                  // Start dungeon combat
                  dungeonEncounter = await dungeonService.startRoomCombat(
                    String(dungeon._id), 
                    dungeon.currentRoom, 
                    message.channel.id
                  );
                  if (!dungeonEncounter) {
                    return `-# [ ❌ Failed to start dungeon combat. ]`;
                  }
                }
                
                // Find the monster combatant by name match
                const monsterCombatant = dungeonEncounter.participants?.find(p => 
                  p.isMonster && p.name.toLowerCase().includes(targetText.toLowerCase())
                );
                
                if (monsterCombatant) {
                  // Use battleService to attack the monster
                  const result = await this.battleService.attack({ 
                    message, 
                    attacker: avatar, 
                    defender: monsterCombatant, 
                    services 
                  });
                  return result.message;
                }
              }
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
        const encounterService = services?.combatEncounterService;
        if (encounterService?.ensureEncounterForAttack) {
          const before = encounterService.getEncounter(message.channel.id);
          let encounter;
          try {
            encounter = await encounterService.ensureEncounterForAttack({ channelId: message.channel.id, attacker: avatar, defender, sourceMessage: message, deferStart: true });
          } catch (e) {
            const msg = String(e?.message || '').toLowerCase();
            if (msg.includes('self_combat')) {
              return `-# 🤔 [ You cannot attack yourself! ]`;
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
          isNewEncounter = !before && !!encounter;
          // If brand-new encounter, show location image and a "vs" fight poster
          if (isNewEncounter) {
            try {
        // Pause auto-acts/turn starts while we post the poster and chatter
        encounterService.beginManualAction(message.channel.id);
        // React to the initiating message to acknowledge combat start
        try { this.discordService?.reactToMessage?.(message, '⚔️'); } catch {}
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
                            const enc = encounterService.getEncounter(message.channel.id);
                            if (enc) { enc._xTweetId = tweetId; enc._xTweetUrl = tweetUrl; }
                          } catch {}
                        }
                      }
                    } catch (e) { this.logger?.warn?.(`[AttackTool] auto X poster post failed: ${e.message}`); }
                    
                    // DISABLED: Brief discussion after poster causes spam
                    // Combat flow should be: poster -> initiative -> turn-based actions only
                    // const cm = this.conversationManager;
                    // if (cm?.sendResponse) {
                    //   try { await cm.sendResponse(channel, avatar, null, { overrideCooldown: true }); } catch {}
                    //   try { await cm.sendResponse(channel, defender, null, { overrideCooldown: true }); } catch {}
                    // }
                  }
                }
              }
        // Done with poster/chatter
        encounterService.endManualAction(message.channel.id);
        try { const enc = encounterService.getEncounter(message.channel.id); enc?.posterBlocker?.resolve?.(); } catch {}
              // Now start the encounter formally (initiative + chatter + timers)
              try { await encounterService.rollInitiative(encounterService.getEncounter(message.channel.id)); } catch {}
              // Do NOT attack now; mark and return after initiating combat (no extra text reply)
              initiatedAndReturned = true;
              return null;
            } catch (e) {
              this.logger?.warn?.(`[AttackTool] fight poster init failed: ${e.message}`);
        try { services?.combatEncounterService?.endManualAction(message.channel.id); } catch {}
        try { const enc = services?.combatEncounterService?.getEncounter(message.channel.id); enc?.posterBlocker?.resolve?.(); } catch {}
              try { await services?.combatEncounterService?.rollInitiative(services?.combatEncounterService?.getEncounter(message.channel.id)); } catch {}
              // Return after starting combat despite poster failure fallback (no extra text reply)
              initiatedAndReturned = true;
              return null;
            }
          }
          // Turn enforcement (only for active encounters)
          const current = encounterService.getEncounter(message.channel.id);
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
  const result = await this.battleService.attack({ message, attacker: avatar, defender, services });
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