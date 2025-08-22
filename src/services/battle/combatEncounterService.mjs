/**
 * CombatEncounterService
 * Manages turn-based D&D style combat encounters (initiative, turn order, state) for AI + tool driven actions.
 * Human slash/chat command layer intentionally deferred (per implementation request).
 */
export class CombatEncounterService {
  constructor({ logger, diceService, avatarService, mapService, battleService, databaseService, unifiedAIService, discordService, configService, promptAssembler }) {
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
  }

  /** Compose an avatar persona system prompt */
  _getAvatarPersonaSystem(avatar, { locationName, role = 'actor' } = {}) {
    const traits = [avatar.title, avatar.personality, avatar.traits]?.filter(Boolean).join(', ');
    const desc = avatar.description || avatar.bio || '';
    const faction = avatar.faction || avatar.coordinator || '';
    const lines = [];
    lines.push(`You are ${avatar.displayName || avatar.name}. Stay strictly in-character (${role}).`);
    if (traits) lines.push(`Traits: ${traits}.`);
    if (faction) lines.push(`Faction: ${faction}.`);
    if (desc) lines.push(`Backstory/Description: ${desc}`);
    if (locationName) lines.push(`Current Location: ${locationName}.`);
    lines.push('Voice: concise, flavorful, fitting your persona. Avoid meta commentary.');
    return lines.join('\n');
  }

  /** Build AI chat messages with memory recall via PromptAssembler if available */
  async _buildAvatarMessages(avatar, { task, context = '' } = {}) {
    if (!this.unifiedAIService?.chat) return null;
    let locName = null;
    try { locName = await this.mapService?.getLocationDescription?.({ channelId: avatar.channelId || avatar.locationId }); } catch {}
    const systemText = this._getAvatarPersonaSystem(avatar, { locationName: locName, role: 'actor' });
    const focusText = 'Reply with ONE short line (max 20 words). Keep it in-universe. No hashtags. Avoid emojis unless fitting.';
    const msgText = task || 'Speak one short in-character line for this moment.';
    const contextText = context || '';
    try {
      if (this.promptAssembler) {
        const built = await this.promptAssembler.buildPrompt({
          avatarId: avatar._id || avatar.id,
          systemText,
          contextText,
          focusText,
          msgText,
          limitTokens: 8000,
          guardrail: 800,
          recallCap: 1200,
          perSnippet: 160,
          who: avatar.name,
          source: 'combat'
        });
        const blocks = built?.blocks || `${systemText}\n${contextText}`;
        return [
          { role: 'system', content: blocks },
          { role: 'user', content: 'Reply now with a single fitting line.' }
        ];
      }
    } catch (e) {
      this.logger.warn?.(`[CombatEncounter] prompt assemble failed: ${e.message}`);
    }
    // Fallback without assembler
    return [
      { role: 'system', content: systemText },
      { role: 'user', content: `${context}\n\n${msgText}`.trim() }
    ];
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
      sourceMessageId: sourceMessage?.id || null
    };
    this.encounters.set(channelId, encounter);
    return encounter;
  }

  /** Rolls initiative for all combatants (d20 + DEX mod if stats available) */
  async rollInitiative(encounter) {
    for (const c of encounter.combatants) {
      try {
        const stats = await this.avatarService.getOrCreateStats(c.ref);
        const dexMod = Math.floor(((stats?.dexterity || 10) - 10) / 2);
        const roll = this.diceService.rollDie(20);
        c.initiative = roll + dexMod;
        c.armorClass = 10 + Math.floor(((stats?.dexterity || 10) - 10) / 2); // base AC for now
      } catch (e) {
        c.initiative = this.diceService.rollDie(20);
        this.logger.warn?.(`[CombatEncounter] Failed stats for ${c.name}: ${e.message}`);
      }
    }
    encounter.initiativeOrder = encounter.combatants
      .slice()
      .sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0))
  .map(c => this._normalizeId(c.avatarId));
    encounter.state = 'active';
    encounter.startedAt = Date.now();
    encounter.round = 1;
    encounter.currentTurnIndex = 0;
  // kick off first turn using pacing logic
  this._scheduleTurnStart(encounter, { roundWrap: false });
  this._announceInitiative(encounter).catch(e=>this.logger.warn?.(`[CombatEncounter] initiative announce failed: ${e.message}`));
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
      // When wrapping to new round, optionally request brief plans then narrate
      if (this.enableRoundPlanning) {
        await this._roundPlanningPhase(encounter);
      }
      this._scheduleTurnStart(encounter, { roundWrap: true });
      return;
    }
    this._scheduleTurnStart(encounter, { roundWrap: false });
  }

  /** Auto action if turn times out (simple defend / dodge) */
  async _onTurnTimeout(encounter) {
    const avatarId = this.getCurrentTurnAvatarId(encounter);
    if (!avatarId) return;
    const combatant = this.getCombatant(encounter, avatarId);
    if (!combatant) return;
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
  this.logger.info?.(`[CombatEncounter] auto-act start for ${actor.name} (HP ${actor.currentHp}/${actor.maxHp})`);

    // Choose action: simple heuristic (low HP -> defend; else attack)
    const hp = Math.max(0, actor.currentHp || 0);
    const maxHp = Math.max(1, actor.maxHp || 10);
    const low = hp / maxHp <= 0.3;
    let didAct = false;
    const post = async (content) => {
      try {
        if (this.discordService?.sendAsWebhook && content) {
          await this.discordService.sendAsWebhook(encounter.channelId, content, actor.ref);
        }
      } catch (e) {
        this.logger.warn?.(`[CombatEncounter] auto-act post failed: ${e.message}`);
      }
    };

    try {
      if (low && this.battleService?.defend) {
        const msg = await this.battleService.defend({ avatar: actor.ref });
        actor.isDefending = true; // reflect in encounter for status UI
        await post(`${actor.name} used defend 🛡️\n${msg}`);
        this.logger.info?.(`[CombatEncounter] ${actor.name} auto-defends (low HP).`);
        didAct = true;
        // Advance turn after defend
        await this.nextTurn(encounter);
        return;
      }

      // Attack some other conscious combatant
      const targets = encounter.combatants.filter(c => c.avatarId !== actor.avatarId && (c.currentHp || 0) > 0);
      const target = targets[Math.floor(Math.random() * Math.max(1, targets.length))];
      if (target && this.battleService?.attack) {
        const messageShim = { channel: { id: encounter.channelId } };
        const services = { combatEncounterService: this };
        const res = await this.battleService.attack({ message: messageShim, attacker: actor.ref, defender: target.ref, services });
        if (res?.message) {
          await post(`${actor.name} used attack ⚔️\n${res.message}`);
        }
        this.logger.info?.(`[CombatEncounter] ${actor.name} auto-attacks ${target.name}.`);
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
      this.logger.info?.(`[CombatEncounter] ${actor.name} fallback defend (no target).`);
        } catch {}
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
      // Optional commentary before announcing the new turn
      try { await this._maybePostCommentary(encounter); } catch (e) { this.logger.warn?.(`[CombatEncounter] commentary error: ${e.message}`); }
      // Now announce and start timers
      this._scheduleTurnTimeout(encounter);
      this._scheduleAutoAct(encounter);
      this._announceTurn(encounter).catch(e=>this.logger.warn?.(`[CombatEncounter] turn announce failed: ${e.message}`));
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

  /** Ends encounter and clears timers */
  endEncounter(encounter, { reason } = {}) {
    if (encounter.timers.turn) clearTimeout(encounter.timers.turn);
    encounter.state = 'ended';
    encounter.endedAt = Date.now();
    encounter.endReason = reason || 'unspecified';
    // Optionally persist summary later
  this._persistEncounter(encounter).catch(e => this.logger.warn?.(`[CombatEncounter] persist failed: ${e.message}`));
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
    const dexMod = Math.floor((((stats?.dexterity) ?? 10) - 10) / 2);
    const initiative = this.diceService.rollDie(20) + dexMod;
    const armorClass = 10 + dexMod;
  const combatant = { avatarId: aid, name: avatar.name, ref: avatar, initiative, currentHp: stats?.hp || 10, maxHp: stats?.hp || 10, armorClass, hasActed: false, isDefending: false, conditions: [], side: 'neutral' };
    encounter.combatants.push(combatant);
    // Rebuild initiative order and keep current turn index referencing correct avatar
    const currentAvatarId = this.getCurrentTurnAvatarId(encounter);
  encounter.initiativeOrder = encounter.combatants.slice().sort((a, b) => b.initiative - a.initiative).map(c => this._normalizeId(c.avatarId));
  encounter.currentTurnIndex = Math.max(0, encounter.initiativeOrder.indexOf(this._normalizeId(currentAvatarId)));
  }

  /** Utility: ensures an encounter exists for channel and is active, creating + rolling if needed */
  async ensureEncounterForAttack({ channelId, attacker, defender, sourceMessage }) {
    const now = Date.now();
    if ((attacker?.knockedOutUntil && now < attacker.knockedOutUntil) || (defender?.knockedOutUntil && now < defender.knockedOutUntil)) {
      throw new Error('knockout_cooldown');
    }
    let encounter = this.getEncounter(channelId);
    if (!encounter) {
      encounter = this.createEncounter({ channelId, participants: [attacker, defender], sourceMessage });
      await this.rollInitiative(encounter);
      this.logger.info?.(`[CombatEncounter] Created new encounter in channel ${channelId} with ${encounter.combatants.length} combatants.`);
    } else if (encounter.state === 'pending') {
      // finalize
      await this.rollInitiative(encounter);
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
  handleAttackResult(encounter, { attackerId, defenderId, result }) {
    if (!encounter || encounter.state !== 'active') return;
    const attId = this._normalizeId(attackerId);
    const defId = this._normalizeId(defenderId);
    if (result?.damage && (result.result === 'hit' || result.result === 'knockout' || result.result === 'dead')) {
      this.applyDamage(encounter, defId, result.damage);
      this.markHostile(encounter);
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

  /** Post an embed for initiative order */
  async _announceInitiative(encounter) {
    if (!this.discordService?.client) return;
    const channel = this.discordService.client.channels.cache.get(encounter.channelId);
    if (!channel?.send) return;
    // Fetch location meta if available
    let locName = null;
    try { locName = await this.mapService?.getLocationDescription?.({ channelId: encounter.channelId }); } catch {}
    const orderLines = encounter.initiativeOrder.map((id, i) => {
      const c = this.getCombatant(encounter, id);
      return `${i+1}. ${c.name} (Init ${c.initiative})`;
    }).join('\n');
    const embed = {
      title: '⚔️ Combat Initiated',
      description: `Round 1 begins!${locName ? `\nLocation: ${locName}` : ''}`,
      fields: [
        { name: 'Initiative Order', value: orderLines || '—' }
      ],
      color: 0xFF0000,
      footer: { text: `${this.getCombatant(encounter, this.getCurrentTurnAvatarId(encounter))?.name || 'Unknown'} acts first` }
    };
    try { await channel.send({ embeds: [embed] }); } catch (e) { this.logger.warn?.(`[CombatEncounter] send initiative embed failed: ${e.message}`); }
  }

  /** Post an embed for each new turn */
  async _announceTurn(encounter) {
    if (!this.discordService?.client) return;
    const channel = this.discordService.client.channels.cache.get(encounter.channelId);
    if (!channel?.send) return;
    if (encounter.state !== 'active') return;
    const currentId = this.getCurrentTurnAvatarId(encounter);
    const current = this.getCombatant(encounter, currentId);
    if (!current) return;
  const status = encounter.combatants.map(c => `${this._normalizeId(c.avatarId) === this._normalizeId(currentId) ? '➡️' : ' '} ${c.name}: ${c.currentHp}/${c.maxHp} HP${c.isDefending ? ' 🛡️' : ''}`).join('\n');
    const mode = this._getCombatModeFor(current);
    // Try pull location name for flavor
    let locName = null;
    try { locName = await this.mapService?.getLocationDescription?.({ channelId: encounter.channelId }); } catch {}
    const embed = {
      title: `Round ${encounter.round} • ${current.name}'s Turn`,
      description: `${locName ? `Location: ${locName}\n` : ''}${current.isDefending ? '🛡️ Currently defending' : (mode === 'manual' ? 'Choose an action: Attack or Defend.' : 'Acting...')}`,
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
    if (!this.unifiedAIService?.chat) return; // requires unified AI
    if (!this.discordService?.sendAsWebhook) return;
    const ctx = encounter.lastAction;
    if (!ctx) return;
    const attacker = this.getCombatant(encounter, ctx.attackerId)?.ref;
    const defender = this.getCombatant(encounter, ctx.defenderId)?.ref;
    if (!attacker || !defender) return;

    // Choose speaker based on outcome
    let locName = null;
    try { locName = await this.mapService?.getLocationDescription?.({ channelId: encounter.channelId }); } catch {}
    let speaker = defender;
    let user = locName ? `(Location: ${locName}) ` : '';
    if (ctx.result === 'miss') {
      user += `${attacker.name} just missed their attack against you. Offer a quick, playful taunt or witty dodge comment.`;
    } else if (ctx.result === 'hit') {
      user += `${attacker.name} just hit you for ${ctx.damage} damage. React briefly in-character (pain, resolve, or strategy).`;
    } else if (ctx.result === 'knockout' || ctx.result === 'dead') {
      speaker = attacker; // victor speaks
      user += `You have just ${ctx.result === 'dead' ? 'defeated' : 'knocked out'} ${defender.name}. Say one short line (victory, respect, or remorse).`;
    } else {
      // fallback generic
      user += `Brief in-character reaction to the recent exchange with ${attacker.name} and ${defender.name}.`;
    }

    try {
      const sc = encounter.combatants.map(c => `${c.name}: ${c.currentHp}/${c.maxHp} HP`).join(', ');
      const messages = await this._buildAvatarMessages(speaker, { task: user, context: `Combatants: ${sc}. Round ${encounter.round}.` });
      const resp = await this.unifiedAIService.chat(messages, { temperature: 0.7 });
      const text = (resp?.text || '').trim();
      if (text) {
        await this.discordService.sendAsWebhook(encounter.channelId, text, speaker);
      }
    } catch (e) {
      this.logger.warn?.(`[CombatEncounter] commentary AI/send failed: ${e.message}`);
    }
  }

  /**
   * Brief per-round planning: ask each avatar for a one-liner intent, then have a DM narrator summarize the setup.
   */
  async _roundPlanningPhase(encounter) {
    if (!this.unifiedAIService?.chat || !this.discordService?.sendAsWebhook) return;
    try {
      // Ask each conscious combatant for a quick plan line
      const alive = encounter.combatants.filter(c => (c.currentHp || 0) > 0);
      const plans = [];
      for (const c of alive) {
        try {
          let locName = null;
          try { locName = await this.mapService?.getLocationDescription?.({ channelId: encounter.channelId }); } catch {}
          const messages = await this._buildAvatarMessages(c.ref, { task: `${locName ? `(Location: ${locName}) ` : ''}What is your plan this round?`, context: `Round ${encounter.round+1} starting. Your HP: ${c.currentHp}/${c.maxHp}.` });
          const resp = await this.unifiedAIService.chat(messages, { temperature: 0.7 });
          const plan = (resp?.text || '').trim();
          if (plan) {
            plans.push({ id: c.avatarId, name: c.name, plan, ref: c.ref });
            await this.discordService.sendAsWebhook(encounter.channelId, `“${plan}”`, c.ref);
          }
        } catch (e) {
          this.logger.warn?.(`[CombatEncounter] plan for ${c.name} failed: ${e.message}`);
        }
      }

      // Short wait to avoid flooding
      await new Promise(r => setTimeout(r, Math.min(this.roundPlanningTimeoutMs, 6000)));

      // DM narration: location POV synthesis
      try {
        const summary = plans.map(p => `${p.name}: ${p.plan}`).join('\n');
        const messages = [
          { role: 'system', content: 'You are the Dungeon Master describing the scene succinctly. 2–3 short sentences, evocative but concise.' },
          { role: 'user', content: `Round ${encounter.round+1} is about to start. Plans:\n${summary || 'No plans provided.'}` }
        ];
        const dm = await this.unifiedAIService.chat(messages, { temperature: 0.6 });
        const dmText = (dm?.text || '').trim();
        if (dmText) {
          await this.discordService.sendAsWebhook(encounter.channelId, dmText, null /* generic bot avatar */);
        }
      } catch (e) {
        this.logger.warn?.(`[CombatEncounter] DM narration failed: ${e.message}`);
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
        if (enc.timers.turn) clearTimeout(enc.timers.turn);
        this.encounters.delete(channelId);
        this.logger.info?.(`[CombatEncounter] Cleaned encounter channel=${channelId} reason=${ended ? 'ended' : 'stale'}`);
      }
    }
  }

  /** Explicit destroy for graceful shutdown */
  destroy() {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    for (const enc of this.encounters.values()) {
      if (enc.timers.turn) clearTimeout(enc.timers.turn);
    }
    this.encounters.clear();
  }
}

export default CombatEncounterService;
