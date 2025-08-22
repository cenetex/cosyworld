/**
 * CombatEncounterService
 * Manages turn-based D&D style combat encounters (initiative, turn order, state) for AI + tool driven actions.
 * Human slash/chat command layer intentionally deferred (per implementation request).
 */
export class CombatEncounterService {
  constructor({ logger, diceService, avatarService, mapService, battleService, databaseService, unifiedAIService, discordService, configService, promptAssembler, getConversationManager }) {
  this.logger = logger || console;
    this.diceService = diceService;
    this.avatarService = avatarService;
    this.mapService = mapService;
    this.battleService = battleService;
    this.databaseService = databaseService;
    this.unifiedAIService = unifiedAIService; // optional
    this.discordService = discordService; // for embeds / announcements
    this.configService = configService;
  this.promptAssembler = promptAssembler || null;
  this.getConversationManager = typeof getConversationManager === 'function' ? getConversationManager : () => null;

    // channelId -> encounter object
    this.encounters = new Map();

    // Configurable knobs (could move to configService later)
  this.turnTimeoutMs = 30_000; // default AI / auto resolution window
  this.idleEndRounds = 3; // end if no hostile action for N rounds
  this.enableTurnEnforcement = true;
  this.maxEncountersPerGuild = Number(process.env.MAX_ENCOUNTERS_PER_GUILD || 5);
  this.staleEncounterMs = 60 * 60 * 1000; // 1 hour
  this.cleanupInterval = setInterval(() => this.cleanupStaleEncounters(), 60 * 1000).unref?.() || null;

  // Auto-acting controls
  this.autoActDelayMs = Number(process.env.COMBAT_AUTO_ACT_DELAY_MS || 1500);
  this.defaultCombatMode = (process.env.COMBAT_MODE_DEFAULT || 'auto').toLowerCase(); // 'auto' or 'manual'

  // Pacing & commentary controls
  this.minTurnGapMs = Number(process.env.COMBAT_MIN_TURN_GAP_MS || 4000); // ensure at least this gap between actions
  this.roundCooldownMs = Number(process.env.COMBAT_ROUND_COOLDOWN_MS || 3000); // extra pause when round wraps
  this.enableCommentary = (process.env.COMBAT_COMMENTARY_ENABLED || 'true') === 'true';
  this.commentaryChance = Math.max(0, Math.min(1, parseFloat(process.env.COMBAT_COMMENTARY_CHANCE || '0.65')));
  // Round planning & narration
  this.enableRoundPlanning = (process.env.COMBAT_ROUND_PLANNING_ENABLED || 'true') === 'true';
  this.roundPlanningTimeoutMs = Number(process.env.COMBAT_ROUND_PLANNING_TIMEOUT_MS || 3500);
  // Turn sequencing & media gating
  this.mediaWaitTimeoutMs = Number(process.env.COMBAT_MEDIA_WAIT_TIMEOUT_MS || 45_000);
  this.posterWaitTimeoutMs = Number(process.env.COMBAT_POSTER_WAIT_TIMEOUT_MS || 15_000);
  }

  // Removed in-channel AI chat builders; combat now delegates speaking to ConversationManager

  /** Helper: compute DEX modifier from stats, defaulting to 10 */
  _dexModFromStats(stats) {
    const dex = Number(stats?.dexterity ?? 10);
    return Math.floor((dex - 10) / 2);
  }

  /** Public: is avatar an active combatant in channel's encounter */
  isInActiveCombat(channelId, avatarId) {
    try {
      const enc = this.getEncounter(channelId);
      if (!enc || enc.state !== 'active') return false;
      return !!this.getCombatant(enc, avatarId);
    } catch { return false; }
  }

  /** Public: can avatar enter combat (blocks KO/death & KO cooldown & flee cooldown) */
  canEnterCombat(avatar) {
    try {
      const now = Date.now();
      if (!avatar) return false;
      if (avatar.status === 'dead' || avatar.status === 'knocked_out') return false;
      if (avatar.knockedOutUntil && now < avatar.knockedOutUntil) return false;
      if (avatar.combatCooldownUntil && now < avatar.combatCooldownUntil) return false;
      return true;
    } catch { return false; }
  }

  /** Helper: rebuild initiative order; optionally preserve current turn avatar when inserting */
  _rebuildInitiativeOrder(encounter, { preserveCurrent = false } = {}) {
    if (!encounter) return;
    const currentId = preserveCurrent ? this._normalizeId(this.getCurrentTurnAvatarId(encounter)) : null;
    encounter.initiativeOrder = encounter.combatants
      .slice()
      .sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0))
      .map(c => this._normalizeId(c.avatarId));
    if (preserveCurrent && currentId) {
      const idx = encounter.initiativeOrder.indexOf(currentId);
      encounter.currentTurnIndex = Math.max(0, idx);
    }
  }

  /** Helper: clear all timers associated with an encounter */
  _clearTimers(encounter) {
    if (!encounter?.timers) return;
    if (encounter.timers.turn) clearTimeout(encounter.timers.turn);
    if (encounter.timers.startTurn) clearTimeout(encounter.timers.startTurn);
    if (encounter.timers.auto) clearTimeout(encounter.timers.auto);
    encounter.timers.turn = encounter.timers.startTurn = encounter.timers.auto = null;
  }

  /** Helper: discord text channel for encounter (if available) */
  _getChannel(encounter) {
    return this.discordService?.client?.channels?.cache?.get(encounter?.channelId) || null;
  }

  /** Helper: retrieve location description/name if mapService supports it */
  async _getLocationName(encounter) {
    try {
      return await this.mapService?.getLocationDescription?.({ channelId: encounter.channelId });
    } catch {
      return null;
    }
  }

  /** Helper: post content via webhook as an actor if supported */
  async _postAsWebhook(encounter, actorRef, content) {
    if (!content) return;
    try {
      if (this.discordService?.sendAsWebhook) {
        await this.discordService.sendAsWebhook(encounter.channelId, content, actorRef);
      }
    } catch (e) {
      this.logger.warn?.(`[CombatEncounter] webhook post failed: ${e.message}`);
    }
  }

  /** Normalize any avatar identifier to a string */
  _normalizeId(id) {
    if (!id) return null;
    try { return typeof id === 'string' ? id : id.toString(); } catch { return null; }
  }

  /** Safely extract an avatarId from an avatar object */
  _getAvatarId(avatar) {
    if (!avatar) return null;
    return this._normalizeId(avatar.id || avatar._id);
  }

  /** Returns active encounter for channel or null */
  getEncounter(channelId) {
    return this.encounters.get(channelId) || null;
  }

  /** Creates a new encounter for channel with given participants (array of avatar objects). */
  createEncounter({ channelId, participants, sourceMessage }) {
    if (this.encounters.has(channelId)) {
      return this.encounters.get(channelId);
    }
    const guildId = sourceMessage?.guild?.id || null;
    // Enforce per-guild cap
    if (guildId) {
      const activeForGuild = Array.from(this.encounters.values()).filter(e => e.guildId === guildId && e.state !== 'ended');
      if (activeForGuild.length >= this.maxEncountersPerGuild) {
        // End the oldest active encounter to make room
        const oldest = activeForGuild.sort((a,b)=>a.createdAt - b.createdAt)[0];
        if (oldest) this.endEncounter(oldest, { reason: 'capacity_reclaim' });
      }
    }
    const unique = new Map();
    (participants || []).forEach(a => {
      const aid = this._getAvatarId(a);
      if (a && aid) unique.set(aid, a);
    });
    const combatants = Array.from(unique.entries()).map(([aid, a]) => ({
      avatarId: aid,
      name: a.name,
      ref: a,
      initiative: null,
      currentHp: a.currentHp ?? a.hp ?? a.health ??  (a.stats?.hp || 10),
      maxHp: a.stats?.hp || a.hp ||  a.maxHp || 10,
      armorClass: 10, // will be updated after stats fetch if available
      hasActed: false,
      isDefending: false,
      conditions: [],
      side: 'neutral'
    }));

    const encounter = {
      channelId,
      guildId,
      state: 'pending', // pending -> active -> ended
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
      combatants,
      initiativeOrder: [], // array of avatarId
      currentTurnIndex: 0,
      round: 0,
      lastHostileAt: null,
  lastActionAt: null,
  lastAction: null,
      timers: {},
  knockout: null,
  knockoutMedia: null,
  // Media/turn sequencing controls
  turnAdvanceBlockers: [], // array of Promises to await before advancing to next turn
  manualActionCount: 0, // increments during manual/command-driven actions to pause auto-act
      posterBlocker: (() => {
        let resolve;
        const p = new Promise(res => { resolve = res; });
        // Auto-resolve after timeout to avoid deadlock if no poster is produced
        setTimeout(() => { try { resolve(); } catch {} }, this.posterWaitTimeoutMs).unref?.();
        return { promise: p, resolve };
      })(),
      sourceMessageId: sourceMessage?.id || null
    };
  this.encounters.set(channelId, encounter);
  this.logger?.info?.(`[CombatEncounter][${channelId}] created: ${combatants.length} combatant(s), state=pending`);
  return encounter;
  }

  /** Rolls initiative for all combatants (d20 + DEX mod if stats available) */
  async rollInitiative(encounter) {
    for (const c of encounter.combatants) {
      try {
    const stats = await this.avatarService.getOrCreateStats(c.ref);
    const dexMod = this._dexModFromStats(stats);
        const roll = this.diceService.rollDie(20);
        c.initiative = roll + dexMod;
    c.armorClass = 10 + dexMod; // base AC for now
      } catch (e) {
        c.initiative = this.diceService.rollDie(20);
        this.logger.warn?.(`[CombatEncounter] Failed stats for ${c.name}: ${e.message}`);
      }
    }
  this._rebuildInitiativeOrder(encounter, { preserveCurrent: false });
    encounter.state = 'active';
    encounter.startedAt = Date.now();
  encounter.round = 1;
  encounter.currentTurnIndex = 0;
  // Wait for fight poster phase (if any) before initiative and chatter for clean ordering
  try { await encounter.posterBlocker?.promise; } catch {}
  // Skip the old 'Combat Initiated' embed. Go straight to brief chatter before first turn.
  await this._preCombatChatter(encounter).catch(e=>this.logger.warn?.(`[CombatEncounter] pre-combat chatter failed: ${e.message}`));
  // kick off first turn using pacing logic
  this.logger?.info?.(`[CombatEncounter][${encounter.channelId}] started: round=1, order=${encounter.initiativeOrder.join('>')}`);
  this._scheduleTurnStart(encounter, { roundWrap: false });
    return encounter;
  }

  /** Returns the combatant object for avatarId within encounter */
  getCombatant(encounter, avatarId) {
  const want = this._normalizeId(avatarId);
  return encounter.combatants.find(c => this._normalizeId(c.avatarId) === want) || null;
  }

  /** Returns avatarId whose turn it is */
  getCurrentTurnAvatarId(encounter) {
    return encounter.initiativeOrder[encounter.currentTurnIndex] || null;
  }

  /** Advances to next turn, incrementing round when wrapping */
  async nextTurn(encounter) {
    if (encounter.state !== 'active') return;
    encounter.currentTurnIndex += 1;
    if (encounter.currentTurnIndex >= encounter.initiativeOrder.length) {
      encounter.currentTurnIndex = 0;
      encounter.round += 1;
      if (encounter.round > 3) {
        this.endEncounter(encounter, { reason: 'round_limit' });
        return;
      }
      this.logger?.info?.(`[CombatEncounter][${encounter.channelId}] round wrap -> round=${encounter.round}`);
      await this._postRoundDiscussion(encounter).catch(e=>this.logger.warn?.(`[CombatEncounter] round discussion failed: ${e.message}`));
      if (this.enableRoundPlanning) {
        await this._roundPlanningPhase(encounter);
      }
      this._scheduleTurnStart(encounter, { roundWrap: true });
      return;
    }
    // If the next combatant is KO'd, skip ahead until a valid one or round wraps
    try {
      let safety = encounter.initiativeOrder.length;
      while (safety-- > 0) {
        const cid = this.getCurrentTurnAvatarId(encounter);
        const c = this.getCombatant(encounter, cid);
        const now = Date.now();
        const isKO = !c || (c.currentHp || 0) <= 0 || c.conditions?.includes('unconscious') || c.ref?.status === 'dead' || c.ref?.status === 'knocked_out' || (c.ref?.knockedOutUntil && now < c.ref.knockedOutUntil);
        if (!isKO) break;
        encounter.currentTurnIndex += 1;
        if (encounter.currentTurnIndex >= encounter.initiativeOrder.length) {
          encounter.currentTurnIndex = 0;
          encounter.round += 1;
          if (encounter.round > 3) {
            this.endEncounter(encounter, { reason: 'round_limit' });
            return;
          }
      await this._postRoundDiscussion(encounter).catch(e=>this.logger.warn?.(`[CombatEncounter] round discussion failed: ${e.message}`));
          if (this.enableRoundPlanning) {
            await this._roundPlanningPhase(encounter);
          }
          this._scheduleTurnStart(encounter, { roundWrap: true });
          return;
        }
      }
    } catch {}
    this._scheduleTurnStart(encounter, { roundWrap: false });
  }

  /** Auto action if turn times out (simple defend / dodge) */
  async _onTurnTimeout(encounter) {
    const avatarId = this.getCurrentTurnAvatarId(encounter);
    if (!avatarId) return;
    const combatant = this.getCombatant(encounter, avatarId);
    if (!combatant) return;
    // If combatant is KO'd or dead, just advance turn without acting
    try {
      const now = Date.now();
      const isKO = (combatant.currentHp || 0) <= 0 || combatant.conditions?.includes('unconscious') || combatant.ref?.status === 'dead' || (combatant.ref?.status === 'knocked_out') || (combatant.ref?.knockedOutUntil && now < combatant.ref.knockedOutUntil);
      if (isKO) {
        this.logger.info?.(`[CombatEncounter] timeout on KO'd combatant ${combatant.name}; skipping action`);
        await this.nextTurn(encounter);
        return;
      }
    } catch {}
    // Auto-defend (set defending state) using battleService if available
    try {
      combatant.isDefending = true;
      if (this.battleService) {
        // Apply to stats so AC is actually affected on subsequent attacks
        await this.battleService.defend({ avatar: combatant.ref });
      }
    } catch (e) {
      this.logger.warn?.(`[CombatEncounter] auto-defend failed: ${e.message}`);
    }
  await this.nextTurn(encounter);
  }

  /** Determine combat mode for a combatant ('auto' or 'manual') */
  _getCombatModeFor(combatant) {
    const explicit = combatant?.ref?.combatMode;
    if (explicit === 'auto' || explicit === 'manual') return explicit;
    return this.defaultCombatMode;
  }

  /** Schedule an auto-act for the current turn if in auto mode */
  _scheduleAutoAct(encounter) {
    if (!encounter) return;
    if (encounter.timers.auto) clearTimeout(encounter.timers.auto);
    const currentId = this.getCurrentTurnAvatarId(encounter);
    const combatant = this.getCombatant(encounter, currentId);
  if (!combatant) return;
    // If a manual action is currently in progress (e.g., user command + poster/media), don't auto-act yet
    if ((encounter.manualActionCount || 0) > 0) {
      this.logger.info?.(`[CombatEncounter] manual action in progress; delaying auto-act for ${this.autoActDelayMs}ms`);
      encounter.timers.auto = setTimeout(() => this._scheduleAutoAct(encounter), this.autoActDelayMs);
      return;
    }
    if (this._getCombatModeFor(combatant) !== 'auto') return; // manual: do not auto-act
    // Schedule with small delay to allow UI/embeds to post first
  this.logger.info?.(`[CombatEncounter] scheduling auto-act for ${combatant.name} in ${this.autoActDelayMs}ms (turn of ${combatant.avatarId})`);
  encounter.timers.auto = setTimeout(() => this._maybeAutoAct(encounter, currentId).catch(e=>this.logger.warn?.(`[CombatEncounter] auto-act error: ${e.message}`)), this.autoActDelayMs);
  }

  /** If it's still the same combatant's turn, pick and execute an AI action */
  async _maybeAutoAct(encounter, plannedAvatarId) {
    if (!encounter || encounter.state !== 'active') return;
    const currentId = this.getCurrentTurnAvatarId(encounter);
    if (currentId !== plannedAvatarId) return; // turn changed
    const actor = this.getCombatant(encounter, currentId);
    if (!actor) return;
    if (this._getCombatModeFor(actor) !== 'auto') return;
    // If actor is KO'd or dead, skip auto-act and advance turn
    try {
      const now = Date.now();
      const isKO = (actor.currentHp || 0) <= 0 || actor.conditions?.includes('unconscious') || actor.ref?.status === 'dead' || (actor.ref?.status === 'knocked_out') || (actor.ref?.knockedOutUntil && now < actor.ref.knockedOutUntil);
      if (isKO) {
        this.logger.info?.(`[CombatEncounter] auto-act skip for KO'd combatant ${actor.name}`);
        await this.nextTurn(encounter);
        return;
      }
    } catch {}
  this.logger.info?.(`[CombatEncounter][${encounter.channelId}] auto-act start for ${actor.name} (HP ${actor.currentHp}/${actor.maxHp})`);

    // Choose action: simple heuristic (low HP -> defend; else attack)
    const hp = Math.max(0, actor.currentHp || 0);
    const maxHp = Math.max(1, actor.maxHp || 10);
    const low = hp / maxHp <= 0.3;
  let didAct = false;
  const post = async (content) => this._postAsWebhook(encounter, actor.ref, content);

  // Pre-register a turn-advance blocker so handleAttackResult waits for any media we generate
  const latch = this._preRegisterTurnAdvanceBlocker(encounter.channelId);
  try {
      if (low && this.battleService?.defend) {
        const msg = await this.battleService.defend({ avatar: actor.ref });
        actor.isDefending = true; // reflect in encounter for status UI
  await post(`${actor.name} used defend 🛡️\n${msg}`);
  this.logger.info?.(`[CombatEncounter][${encounter.channelId}] ${actor.name} auto-defends (low HP).`);
        didAct = true;
        // Advance turn after defend
    // Resolve latch immediately; no media to wait for
    try { latch.resolve(); } catch {}
    await this.nextTurn(encounter);
        return;
      }

      // Attack some other conscious combatant
      const targets = encounter.combatants.filter(c => c.avatarId !== actor.avatarId && (c.currentHp || 0) > 0);
      const target = targets[Math.floor(Math.random() * Math.max(1, targets.length))];
      if (target && this.battleService?.attack) {
        const messageShim = { channel: { id: encounter.channelId } };
        const services = { combatEncounterService: this, battleMediaService: this.battleService?.battleMediaService };
        const res = await this.battleService.attack({ message: messageShim, attacker: actor.ref, defender: target.ref, services });
        if (res?.message) {
          await post(`${actor.name} used attack ⚔️\n${res.message}`);
        }
        // Optional: generate battle scene image/video on auto-act
  try {
          const loc = await this.mapService?.getLocationAndAvatars?.(encounter.channelId).catch(()=>null);
          const battleMedia = services?.battleMediaService;
          if (battleMedia && (res?.result)) {
            const media = await battleMedia.generateForAttack({ attacker: actor.ref, defender: target.ref, result: res, location: loc?.location });
            if ((media?.imageUrl || media?.videoUrl) && this.discordService?.sendEmbedAsWebhook) {
              try {
                const embed = {
                  title: '⚔️ Battle Scene',
                  color: 0xffa502,
                  image: media.imageUrl ? { url: media.imageUrl } : undefined,
                  description: media.videoUrl ? `🎬 Final Clip: ${media.videoUrl}` : undefined,
                  footer: {
                    text: [
                      `${actor.ref.name} ▶ ${target.ref.name}`,
                      (res?.attackRoll != null && res?.armorClass != null) ? `${res.attackRoll} vs AC ${res.armorClass}` : null,
                      (typeof res?.damage === 'number') ? `DMG: ${res.damage}` : null,
                    ].filter(Boolean).join(' • '),
                  },
                };
                await this.discordService.sendEmbedAsWebhook(encounter.channelId, embed, actor.ref.name, actor.ref.imageUrl);
              } catch (e) {
                this.logger?.warn?.(`[CombatEncounter] failed to send battle embed: ${e.message}`);
              }
            }
            // If this resulted in a KO/death, persist media for summary fallback
            if ((res?.result === 'knockout' || res?.result === 'dead') && (media?.imageUrl || media?.videoUrl)) {
              try { this.addKnockoutMedia(encounter.channelId, media); } catch {}
            }
          }
          // Media generation complete; release latch
          try { latch.resolve(); } catch {}
        } catch (e) {
          this.logger.warn?.(`[CombatEncounter] auto-act media generation failed: ${e.message}`);
          try { latch.resolve(); } catch {}
        }
  this.logger.info?.(`[CombatEncounter][${encounter.channelId}] ${actor.name} auto-attacks ${target.name}.`);
        didAct = true; // turn advancement handled via handleAttackResult in battleService
      }
    } catch (e) {
      this.logger.warn?.(`[CombatEncounter] auto action failed: ${e.message}`);
    } finally {
      // If nothing happened (e.g., no targets), fall back to defend and advance
    if (!didAct) {
        try {
      let msg = '';
      if (this.battleService?.defend) msg = await this.battleService.defend({ avatar: actor.ref });
          actor.isDefending = true;
  await post(`${actor.name} used defend 🛡️\n${msg}`);
  this.logger.info?.(`[CombatEncounter][${encounter.channelId}] ${actor.name} fallback defend (no target).`);
        } catch {}
        try { latch.resolve(); } catch {}
        await this.nextTurn(encounter);
      }
    }
  }

  _scheduleTurnTimeout(encounter) {
    // clear previous timer
  if (encounter.timers.turn) clearTimeout(encounter.timers.turn);
    encounter.timers.turn = setTimeout(() => this._onTurnTimeout(encounter), this.turnTimeoutMs);
  }

  /** Schedule start of turn with pacing and optional commentary */
  _scheduleTurnStart(encounter, { roundWrap }) {
    if (!encounter || encounter.state !== 'active') return;
    // clear any pending start timer, auto-act timer, and reset defend state for current actor
    if (encounter.timers.startTurn) clearTimeout(encounter.timers.startTurn);
    if (encounter.timers.auto) clearTimeout(encounter.timers.auto);

    const sinceLast = encounter.lastActionAt ? Date.now() - encounter.lastActionAt : Infinity;
    let delay = Math.max(0, this.minTurnGapMs - sinceLast);
    if (roundWrap) delay += this.roundCooldownMs;

  const doStart = async () => {
      // If a manual action is currently in progress (e.g., poster/media), defer start slightly and retry
      if ((encounter.manualActionCount || 0) > 0) {
        this.logger.info?.(`[CombatEncounter] manual action; rescheduling turn start in ${this.autoActDelayMs}ms`);
        encounter.timers.startTurn = setTimeout(() => this._scheduleTurnStart(encounter, { roundWrap }), this.autoActDelayMs);
        return;
      }
      // Skip turns for knocked-out or dead combatants
      try {
        const currentId = this.getCurrentTurnAvatarId(encounter);
        const current = this.getCombatant(encounter, currentId);
        const now = Date.now();
        const isKO = !current || (current.currentHp || 0) <= 0 || current.conditions?.includes('unconscious') || current.ref?.status === 'dead' || (current.ref?.status === 'knocked_out') || (current.ref?.knockedOutUntil && now < current.ref.knockedOutUntil);
        if (isKO) {
          this.logger.info?.(`[CombatEncounter] skipping turn for KO'd combatant ${current?.name || currentId}`);
          if (this.evaluateEnd(encounter)) return;
          // Avoid tight recursion: advance on next tick
          setTimeout(() => this.nextTurn(encounter), 0);
          return;
        }
      } catch (e) { this.logger.warn?.(`[CombatEncounter] KO skip check failed: ${e.message}`); }
      // Optional commentary and inter-turn chatter (no per-turn embed)
      try { await this._maybePostCommentary(encounter); } catch (e) { this.logger.warn?.(`[CombatEncounter] commentary error: ${e.message}`); }
      // Some older instances may not have this method; guard to avoid noisy TypeErrors
      if (typeof this._postInterTurnChatter === 'function') {
        try { await this._postInterTurnChatter(encounter); } catch (e) { this.logger.warn?.(`[CombatEncounter] inter-turn chatter error: ${e.message}`); }
      }
      // Start timers
      this._scheduleTurnTimeout(encounter);
      this._scheduleAutoAct(encounter);
    };
    if (delay > 0) {
      this.logger.info?.(`[CombatEncounter] delaying next turn by ${delay}ms (roundWrap=${roundWrap})`);
      encounter.timers.startTurn = setTimeout(() => doStart(), delay);
    } else {
      void doStart();
    }
  }

  /** Marks a hostile action (attack) to prevent idle end */
  markHostile(encounter) {
    encounter.lastHostileAt = Date.now();
  }

  /** Called after each action to see if combat should end (e.g., one side remains, idle) */
  evaluateEnd(encounter) {
    if (encounter.state !== 'active') return false;
    // Basic rule: if <=1 conscious combatant remains
    const alive = encounter.combatants.filter(c => (c.currentHp || 0) > 0);
    if (alive.length <= 1) {
      this.endEncounter(encounter, { reason: 'single_combatant' });
      return true;
    }
    // End if all alive combatants are defending
    if (alive.length >= 2 && alive.every(c => c.isDefending)) {
      this.endEncounter(encounter, { reason: 'all_defending' });
      return true;
    }
    // Idle logic: if no hostile actions for N rounds after at least one hostile
    if (encounter.lastHostileAt) {
      const roundsSince = (Date.now() - encounter.lastHostileAt) / (this.turnTimeoutMs);
      if (roundsSince >= this.idleEndRounds) {
        this.endEncounter(encounter, { reason: 'idle' });
        return true;
      }
    }
    return false;
  }

  /** Attempt to flee for a combatant; on success, end encounter and move to Tavern thread. */
  async handleFlee(encounter, avatarId) {
    try {
      if (!encounter || encounter.state !== 'active') return { success: false, message: '-# [ Not in an active encounter. ]' };
      const actor = this.getCombatant(encounter, avatarId);
      if (!actor) return { success: false, message: '-# [ You are not part of this battle. ]' };
      // Enforce turn order
      if (!this.isTurn(encounter, avatarId)) return { success: false, message: null }; // silent per out-of-turn policy

      // Dex check vs highest enemy passive Perception (10 + Dex mod)
      const enemies = encounter.combatants.filter(c => this._normalizeId(c.avatarId) !== this._normalizeId(actor.avatarId) && (c.currentHp || 0) > 0);
      let dc = 10;
      for (const e of enemies) {
        try {
          const stats = await this.avatarService.getOrCreateStats(e.ref);
          const mod = this._dexModFromStats(stats);
          dc = Math.max(dc, 10 + mod);
        } catch {}
      }
      const aStats = await this.avatarService.getOrCreateStats(actor.ref);
      const roll = this.diceService.rollDie(20) + this._dexModFromStats(aStats);
      this.logger?.info?.(`[CombatEncounter][${encounter.channelId}] flee attempt: ${actor.name} roll=${roll} vs DC ${dc}`);
      if (roll >= dc) {
        // Success: set 24h flee cooldown and move to Tavern thread
        try {
          actor.ref.combatCooldownUntil = Date.now() + 24 * 60 * 60 * 1000;
          await this.avatarService.updateAvatar(actor.ref);
        } catch {}
        try {
          const tavernId = await this.discordService?.getOrCreateThread?.(encounter.channelId, 'tavern');
          if (tavernId && this.mapService?.updateAvatarPosition) {
            await this.mapService.updateAvatarPosition(actor.ref, tavernId);
            this.logger?.info?.(`[Location][${encounter.channelId}] ${actor.name} → Tavern (${tavernId})`);
          }
        } catch (e) { this.logger?.warn?.(`[CombatEncounter] flee movement failed: ${e.message}`); }
        // End encounter due to flee
        try { encounter.fleerId = this._normalizeId(actor.avatarId); } catch {}
        this.endEncounter(encounter, { reason: 'flee' });
        return { success: true, message: `-# 🏃 [ ${actor.name} flees to the Tavern! The duel ends. ]` };
      }
      // Failure: consume turn
      this.logger?.info?.(`[CombatEncounter][${encounter.channelId}] flee failed for ${actor.name}`);
      try { encounter.lastActionAt = Date.now(); } catch {}
      await this.nextTurn(encounter);
      return { success: false, message: `-# 🏃 [ ${actor.name} fails to escape! ]` };
    } catch (e) {
      this.logger?.warn?.(`[CombatEncounter] handleFlee error: ${e.message}`);
      return { success: false, message: '-# [ Flee attempt failed. ]' };
    }
  }

  /** Ends encounter and clears timers */
  endEncounter(encounter, { reason } = {}) {
  this._clearTimers(encounter);
    encounter.state = 'ended';
    encounter.endedAt = Date.now();
    encounter.endReason = reason || 'unspecified';
    try {
      const alive = (encounter.combatants || []).filter(c => (c.currentHp || 0) > 0);
      const winner = alive.length === 1 ? alive[0].name : null;
      this.logger?.info?.(`[CombatEncounter][${encounter.channelId}] ended: reason=${encounter.endReason}${winner ? ` winner=${winner}` : ''}`);
    } catch {}
    // Optionally persist summary later
  this._persistEncounter(encounter).catch(e => this.logger.warn?.(`[CombatEncounter] persist failed: ${e.message}`));
  this._sendSummary(encounter).catch(e => this.logger.warn?.(`[CombatEncounter] summary send failed: ${e.message}`));
  }

  /** Adds an avatar mid-combat (e.g., new hostile). Rolls initiative just for them and inserts into order. */
  async addCombatant(encounter, avatar) {
    if (encounter.state !== 'active' && encounter.state !== 'pending') return;
  const aid = this._getAvatarId(avatar);
  if (!aid) return;
  // Enforce knockout cooldown
  const now = Date.now();
  if (avatar?.knockedOutUntil && now < avatar.knockedOutUntil) return;
  if (this.getCombatant(encounter, aid)) return; // already in
  const stats = await this.avatarService.getOrCreateStats(avatar).catch(() => null);
  const dexMod = this._dexModFromStats(stats);
    const initiative = this.diceService.rollDie(20) + dexMod;
    const armorClass = 10 + dexMod;
  const combatant = { avatarId: aid, name: avatar.name, ref: avatar, initiative, currentHp: stats?.hp || 10, maxHp: stats?.hp || 10, armorClass, hasActed: false, isDefending: false, conditions: [], side: 'neutral' };
    encounter.combatants.push(combatant);
    // Rebuild initiative order and keep current turn index referencing correct avatar
  this._rebuildInitiativeOrder(encounter, { preserveCurrent: true });
  }

  /** Utility: ensures an encounter exists for channel and is active, creating + rolling if needed */
  async ensureEncounterForAttack({ channelId, attacker, defender, sourceMessage, deferStart = false }) {
    const now = Date.now();
    if ((attacker?.knockedOutUntil && now < attacker.knockedOutUntil) || (defender?.knockedOutUntil && now < defender.knockedOutUntil)) {
      throw new Error('knockout_cooldown');
    }
    if ((attacker?.combatCooldownUntil && now < attacker.combatCooldownUntil) || (defender?.combatCooldownUntil && now < defender.combatCooldownUntil)) {
      throw new Error('flee_cooldown');
    }
    let encounter = this.getEncounter(channelId);
    if (!encounter) {
      encounter = this.createEncounter({ channelId, participants: [attacker, defender], sourceMessage });
      if (!deferStart) {
        await this.rollInitiative(encounter);
      }
      this.logger.info?.(`[CombatEncounter] Created new encounter in channel ${channelId} with ${encounter.combatants.length} combatants.`);
    } else if (encounter.state === 'pending') {
      // finalize
      if (!deferStart) {
        await this.rollInitiative(encounter);
      }
    } else {
      // ensure both are present
      await this.addCombatant(encounter, attacker);
      await this.addCombatant(encounter, defender);
    }
    return encounter;
  }

  /** Record damage to a combatant and evaluate for end conditions */
  applyDamage(encounter, avatarId, amount) {
    const c = this.getCombatant(encounter, avatarId);
    if (!c) return;
    c.currentHp = Math.max(0, (c.currentHp ?? 0) - amount);
    if (c.currentHp === 0) {
      c.conditions.push('unconscious');
    }
  }

  /** Central handler after an attack result for turn advancement & damage application */
  async handleAttackResult(encounter, { attackerId, defenderId, result }) {
    if (!encounter || encounter.state !== 'active') return;
    const attId = this._normalizeId(attackerId);
    const defId = this._normalizeId(defenderId);
    if (result?.damage && (result.result === 'hit' || result.result === 'knockout' || result.result === 'dead')) {
      this.applyDamage(encounter, defId, result.damage);
      this.markHostile(encounter);
    }
    if (result?.result === 'knockout' || result?.result === 'dead') {
      try { encounter.knockout = { attackerId: attId, defenderId: defId, result: result?.result }; } catch {}
    }
    // Record last action context for pacing & commentary
    try {
      const attacker = this.getCombatant(encounter, attId);
      const defender = this.getCombatant(encounter, defId);
      encounter.lastAction = {
        attackerId: attId,
        attackerName: attacker?.name,
        defenderId: defId,
        defenderName: defender?.name,
        result: result?.result,
        damage: result?.damage || 0,
        attackRoll: result?.attackRoll,
        armorClass: result?.armorClass,
        critical: !!result?.critical,
      };
      encounter.lastActionAt = Date.now();
    } catch {}
    // Advance turn only if attacker was current turn
    if (this._normalizeId(this.getCurrentTurnAvatarId(encounter)) === attId) {
      // Wait for any registered media/blockers to finish (with timeout) before moving to next turn
      try { await this._awaitTurnAdvanceBlockers(encounter); } catch {}
      this.nextTurn(encounter);
    }
    this.evaluateEnd(encounter);
  }

  /** Persist encounter summary (best-effort) */
  async _persistEncounter(encounter) {
    try {
      if (!this.databaseService) return;
      const db = await this.databaseService.getDatabase();
      if (!db) return;
      const doc = {
        channelId: encounter.channelId,
        state: encounter.state,
        createdAt: new Date(encounter.createdAt),
        startedAt: encounter.startedAt ? new Date(encounter.startedAt) : null,
        endedAt: encounter.endedAt ? new Date(encounter.endedAt) : null,
        endReason: encounter.endReason || null,
        rounds: encounter.round,
        combatants: encounter.combatants.map(c => ({
          avatarId: c.avatarId,
            name: c.name,
            initiative: c.initiative,
            finalHp: c.currentHp,
            maxHp: c.maxHp,
            conditions: c.conditions,
            side: c.side
        })),
        initiativeOrder: encounter.initiativeOrder,
        summaryVersion: 1,
      };
      await db.collection('combat_encounters').insertOne(doc);
    } catch (e) {
      this.logger.warn?.(`[CombatEncounter] DB persist error: ${e.message}`);
    }
  }

  /** AI intent parsing for natural language combat actions */
  async parseCombatIntent({ messageContent, avatarsInLocation }) {
    const lower = (messageContent || '').toLowerCase();
    // Quick heuristic fallback
    const verbs = ['attack','strike','hit','slash','shoot','stab','punch','cast','defend','guard','block'];
    const guessed = verbs.find(v => lower.includes(v));
    let heuristic = null;
    if (guessed) {
      // naive target extraction: look for avatar names appearing
      const names = avatarsInLocation.map(a => a.name).sort((a,b)=>b.length - a.length);
      const target = names.find(n => lower.includes(n.toLowerCase())) || null;
      heuristic = { action: guessed === 'defend' || guessed === 'block' || guessed === 'guard' ? 'defend' : 'attack', target, description: messageContent, confidence: 0.4 };
    }
    if (!this.unifiedAIService?.structured) return heuristic;
    try {
      const schema = {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['attack','defend','move','cast','item','other'] },
          target: { type: ['string','null'] },
          description: { type: 'string' },
          confidence: { type: 'number' }
        },
        required: ['action','target','description','confidence']
      };
      const prompt = `Parse this RPG combat intent. Only choose targets from: ${avatarsInLocation.map(a=>a.name).join(', ')}. If none referenced set target to null.
Message: ${messageContent}`;
      const resp = await this.unifiedAIService.structured({ prompt, schema });
      if (resp?.data) {
        return resp.data;
      }
    } catch (e) {
      this.logger.warn?.(`[CombatEncounter] AI parse failed: ${e.message}`);
    }
    return heuristic;
  }

  isTurn(encounter, avatarId) {
    if (!this.enableTurnEnforcement) return true;
  return this._normalizeId(this.getCurrentTurnAvatarId(encounter)) === this._normalizeId(avatarId);
  }

  /** Initiative embed intentionally removed */

  /** Post an embed for each new turn */
  async _announceTurn(encounter) {
  if (!this.discordService?.client) return;
  const channel = this._getChannel(encounter);
    if (!channel?.send) return;
    if (encounter.state !== 'active') return;
    const currentId = this.getCurrentTurnAvatarId(encounter);
    const current = this.getCombatant(encounter, currentId);
    if (!current) return;
  const status = encounter.combatants.map(c => `${this._normalizeId(c.avatarId) === this._normalizeId(currentId) ? '➡️' : ' '} ${c.name}: ${c.currentHp}/${c.maxHp} HP${c.isDefending ? ' 🛡️' : ''}`).join('\n');
    const mode = this._getCombatModeFor(current);
    // Try pull location name for flavor
    const embed = {
      title: `Round ${encounter.round} • ${current.name}'s Turn`,
  description: `${current.isDefending ? '🛡️ Currently defending' : (mode === 'manual' ? 'Choose an action: Attack or Defend.' : 'Acting...')}`,
      fields: [ { name: 'Status', value: status.slice(0, 1024) } ],
      color: 0x00AD2F,
      footer: { text: '30s turn timer • act with narrative or commands' }
    };
    try { await channel.send({ embeds: [embed] }); } catch (e) { this.logger.warn?.(`[CombatEncounter] send turn embed failed: ${e.message}`); }
  }

  /** Generate a short in-character commentary line between actions */
  async _maybePostCommentary(encounter) {
    if (!this.enableCommentary) return;
    if (Math.random() > this.commentaryChance) return;
  const conversationManager = this.getConversationManager?.();
  if (!this.discordService?.client || !conversationManager?.sendResponse) return;
    const ctx = encounter.lastAction;
    if (!ctx) return;
    const attacker = this.getCombatant(encounter, ctx.attackerId)?.ref;
    const defender = this.getCombatant(encounter, ctx.defenderId)?.ref;
    if (!attacker || !defender) return;
    // Choose speaker based on outcome: miss/hit -> defender, KO/death -> attacker
    const speaker = (ctx.result === 'knockout' || ctx.result === 'dead') ? attacker : defender;
    try {
      const channel = this._getChannel(encounter);
      if (!channel) return;
  await conversationManager.sendResponse(channel, speaker, null, { overrideCooldown: true });
    } catch (e) {
      this.logger.warn?.(`[CombatEncounter] commentary relay failed: ${e.message}`);
    }
  }

  /**
   * Brief pre-combat chatter: give each combatant a chance to speak once after initiative.
   */
  async _preCombatChatter(encounter) {
    const conversationManager = this.getConversationManager?.();
    if (!this.discordService?.client || !conversationManager?.sendResponse) return;
    try {
      const channel = this._getChannel(encounter);
      if (!channel) return;
      const talkers = encounter.combatants.slice(0, 2); // limit to avoid spam
      for (const c of talkers) {
        try { await conversationManager.sendResponse(channel, c.ref, null, { overrideCooldown: true }); } catch {}
      }
    } catch (e) {
      this.logger.warn?.(`[CombatEncounter] pre-combat chatter error: ${e.message}`);
    }
  }

  /**
   * Post-round discussion: after each full round, let 2 participants speak to extend pacing.
   */
  async _postRoundDiscussion(encounter) {
    const conversationManager = this.getConversationManager?.();
    if (!this.discordService?.client || !conversationManager?.sendResponse) return;
    try {
      const channel = this._getChannel(encounter);
      if (!channel) return;
      const alive = encounter.combatants.filter(c => (c.currentHp || 0) > 0);
      const talkers = alive.slice(0, 2);
      for (const c of talkers) {
        try { await conversationManager.sendResponse(channel, c.ref, null, { overrideCooldown: true }); } catch {}
      }
    } catch (e) {
      this.logger.warn?.(`[CombatEncounter] post-round discussion error: ${e.message}`);
    }
  }

  /**
   * Brief per-round planning: ask each avatar for a one-liner intent, then have a DM narrator summarize the setup.
   */
  async _roundPlanningPhase(encounter) {
  const conversationManager = this.getConversationManager?.();
  if (!this.discordService?.client || !conversationManager?.sendResponse) return;
    try {
  const channel = this._getChannel(encounter);
      if (!channel) return;
      const alive = encounter.combatants.filter(c => (c.currentHp || 0) > 0);
      // Trigger a lightweight in-character response from participants instead of bespoke planning prompts.
      const limit = Math.min(2, alive.length);
      for (let i = 0; i < limit; i++) {
        const c = alive[i];
        try {
          await conversationManager.sendResponse(channel, c.ref, null, { overrideCooldown: true });
        } catch (e) {
          this.logger.warn?.(`[CombatEncounter] round planning relay failed for ${c.name}: ${e.message}`);
        }
      }
    } catch (e) {
      this.logger.warn?.(`[CombatEncounter] planning phase error: ${e.message}`);
    }
  }

  /** Remove stale / ended encounters from memory */
  cleanupStaleEncounters() {
    const now = Date.now();
    for (const [channelId, enc] of this.encounters.entries()) {
      const ended = enc.state === 'ended';
      const stale = !ended && enc.startedAt && (now - enc.startedAt > this.staleEncounterMs);
      if (ended || stale) {
  this._clearTimers(enc);
        this.encounters.delete(channelId);
        this.logger.info?.(`[CombatEncounter] Cleaned encounter channel=${channelId} reason=${ended ? 'ended' : 'stale'}`);
      }
    }
  }

  /** Explicit destroy for graceful shutdown */
  destroy() {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    for (const enc of this.encounters.values()) {
  this._clearTimers(enc);
    }
    this.encounters.clear();
  }

  /** Inter-turn chatter allowing other avatars to chime in between turns */
  async _postInterTurnChatter(encounter) {
    const conversationManager = this.getConversationManager?.();
    if (!this.discordService?.client || !conversationManager?.sendResponse) return;
    try {
      const channel = this._getChannel(encounter);
      if (!channel) return;
      const currentId = this.getCurrentTurnAvatarId(encounter);
      const others = encounter.combatants.filter(c => this._normalizeId(c.avatarId) !== this._normalizeId(currentId));
      const shuffled = others.sort(() => Math.random() - 0.5).slice(0, 2);
      for (const c of shuffled) {
        try { await conversationManager.sendResponse(channel, c.ref, null, { overrideCooldown: true }); } catch {}
      }
    } catch (e) {
      this.logger.warn?.(`[CombatEncounter] inter-turn chatter error: ${e.message}`);
    }
  }

  /** Final summary embed with optional image/video if a knockout/death occurred */
  async _sendSummary(encounter) {
    try {
      const channel = this._getChannel(encounter);
      if (!channel?.send) return;
      const status = encounter.combatants.map(c => `${c.name}: ${c.currentHp}/${c.maxHp} HP`).join('\n');
      const friendlyReason = this._formatEndReason?.(encounter) || 'The encounter concludes.';
      const embed = {
        title: 'Combat Summary',
        description: friendlyReason,
        color: 0x7289da,
        fields: [{ name: 'Status', value: status.slice(0, 1024) }],
      };
      try {
        if (this.battleService?.battleMediaService && encounter.knockout) {
          const attacker = this.getCombatant(encounter, encounter.knockout.attackerId)?.ref;
          const defender = this.getCombatant(encounter, encounter.knockout.defenderId)?.ref;
          const loc = await this.mapService?.getLocationAndAvatars?.(encounter.channelId).catch(()=>null);
          // 1) Prefer media captured during the KO action
          let media = encounter.knockoutMedia || null;
          // 2) Else, re-generate a finishing scene
          if (!media || (!media.imageUrl && !media.videoUrl)) {
            try {
              media = await this.battleService.battleMediaService.generateForAttack({ attacker, defender, result: { result: encounter.knockout.result }, location: loc?.location });
            } catch {}
          }
          // 3) Else, fall back to a fight poster so there is always an image
          if ((!media || (!media.imageUrl && !media.videoUrl)) && this.battleService?.battleMediaService?.generateFightPoster) {
            try {
              const poster = await this.battleService.battleMediaService.generateFightPoster({ attacker, defender, location: loc?.location });
              if (poster?.imageUrl) media = { imageUrl: poster.imageUrl };
            } catch {}
          }
          if (media?.imageUrl) embed.image = { url: media.imageUrl };
          if (media?.videoUrl) embed.description = `${embed.description || ''}\n🎬 Final Clip: ${media.videoUrl}`.trim();
          // 4) Absolute fallback: ensure some image is attached (attacker or defender avatar)
          if (!embed.image && (attacker?.imageUrl || defender?.imageUrl)) {
            embed.image = { url: attacker?.imageUrl || defender?.imageUrl };
          }
        }
      } catch (e) {
        this.logger.warn?.(`[CombatEncounter] summary media failed: ${e.message}`);
      }
      await channel.send({ embeds: [embed] });
    } catch (e) {
      this.logger.warn?.(`[CombatEncounter] summary send error: ${e.message}`);
    }
  }

  /** Friendly text for summary footer based on endReason */
  _formatEndReason(encounter) {
    const code = encounter?.endReason || 'unspecified';
    const map = {
      single_combatant: 'Only one fighter remains — the battle is decided.',
      all_defending: 'Everyone turtled up — the clash fizzles out.',
      idle: 'No hostilities for a while — the fight winds down.',
      round_limit: 'Time is up — the duel concludes after the final exchange.',
      capacity_reclaim: 'This encounter ended to make room for a new one.',
      flee: 'A fighter fled — the duel ends.',
      unspecified: 'The encounter concludes.',
    };
    let text = map[code] || map.unspecified;
    if (code === 'single_combatant') {
      try {
        const alive = (encounter?.combatants || []).filter(c => (c.currentHp || 0) > 0);
        if (alive.length === 1) text += ` Winner: ${alive[0].name}.`;
      } catch {}
    }
    if (code === 'flee') {
      try {
        const n = encounter?.fleerId ? this.getCombatant(encounter, encounter.fleerId)?.name : null;
        if (n) text = `${n} fled to safety — the battle ends.`;
      } catch {}
    }
    return text;
  }

  /** Public: increment/decrement manual action guard for a channel to pause auto-act/turn starts */
  beginManualAction(channelId) {
    const enc = this.getEncounter(channelId);
    if (!enc) return;
    enc.manualActionCount = (enc.manualActionCount || 0) + 1;
  }

  endManualAction(channelId) {
    const enc = this.getEncounter(channelId);
    if (!enc) return;
    enc.manualActionCount = Math.max(0, (enc.manualActionCount || 0) - 1);
  }

  /** Register a promise to block turn advancement until it resolves (or timeout elapses) */
  addTurnAdvanceBlocker(channelId, promise) {
    const enc = this.getEncounter(channelId);
    if (!enc || !promise) return;
    enc.turnAdvanceBlockers = enc.turnAdvanceBlockers || [];
    enc.turnAdvanceBlockers.push(Promise.resolve(promise).catch(() => {}));
  }

  /** Persist media for the finishing blow so summary can always include an image or video */
  addKnockoutMedia(channelId, media) {
    const enc = this.getEncounter(channelId);
    if (!enc) return;
    try {
      enc.knockoutMedia = media || null;
    } catch {}
  }

  /** Create a deferred blocker that can be resolved later; useful to pre-register before attack */
  _preRegisterTurnAdvanceBlocker(channelId) {
    let resolve, reject;
    const p = new Promise((res, rej) => { resolve = res; reject = rej; });
    this.addTurnAdvanceBlocker(channelId, p);
    return { promise: p, resolve: resolve || (()=>{}), reject: reject || (()=>{}) };
  }

  /** Internal: await all blockers with a timeout to prevent deadlocks */
  async _awaitTurnAdvanceBlockers(encounter) {
    const blockers = Array.isArray(encounter.turnAdvanceBlockers) ? encounter.turnAdvanceBlockers.slice() : [];
    // Reset immediately so subsequent actions start a fresh set
    encounter.turnAdvanceBlockers = [];
    if (blockers.length === 0) return;
    const timeoutMs = this.mediaWaitTimeoutMs;
    const timeout = new Promise(resolve => setTimeout(resolve, timeoutMs));
    try {
      await Promise.race([
        Promise.allSettled(blockers),
        timeout
      ]);
    } catch {}
  }
}

export default CombatEncounterService;
