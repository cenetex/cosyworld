/**
 * CombatEncounterService
 * Manages turn-based D&D style combat encounters (initiative, turn order, state) for AI + tool driven actions.
 * Human slash/chat command layer intentionally deferred (per implementation request).
 */
export class CombatEncounterService {
  constructor({ logger, diceService, avatarService, mapService, battleService, databaseService, unifiedAIService, discordService, configService }) {
    this.logger = logger || console;
    this.diceService = diceService;
    this.avatarService = avatarService;
    this.mapService = mapService;
    this.battleService = battleService;
    this.databaseService = databaseService;
    this.unifiedAIService = unifiedAIService; // optional
    this.discordService = discordService; // for embeds / announcements
    this.configService = configService;

    // channelId -> encounter object
    this.encounters = new Map();

    // Configurable knobs (could move to configService later)
    this.turnTimeoutMs = 30_000; // default AI / auto resolution window
  this.idleEndRounds = 3; // end if no hostile action for N rounds
  this.enableTurnEnforcement = true;
  this.maxEncountersPerGuild = Number(process.env.MAX_ENCOUNTERS_PER_GUILD || 5);
  this.staleEncounterMs = 60 * 60 * 1000; // 1 hour
  this.cleanupInterval = setInterval(() => this.cleanupStaleEncounters(), 60 * 1000).unref?.() || null;
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
    (participants || []).forEach(a => { if (a && a.id) unique.set(a.id, a); });
    const combatants = Array.from(unique.values()).map(a => ({
      avatarId: a.id,
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
      .map(c => c.avatarId);
    encounter.state = 'active';
    encounter.startedAt = Date.now();
    encounter.round = 1;
    encounter.currentTurnIndex = 0;
    this._scheduleTurnTimeout(encounter);
    this._announceInitiative(encounter).catch(e=>this.logger.warn?.(`[CombatEncounter] initiative announce failed: ${e.message}`));
    return encounter;
  }

  /** Returns the combatant object for avatarId within encounter */
  getCombatant(encounter, avatarId) {
    return encounter.combatants.find(c => c.avatarId === avatarId) || null;
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
    }
    this._scheduleTurnTimeout(encounter);
    this._announceTurn(encounter).catch(e=>this.logger.warn?.(`[CombatEncounter] turn announce failed: ${e.message}`));
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
    } catch (e) {
      this.logger.warn?.(`[CombatEncounter] auto-defend failed: ${e.message}`);
    }
  await this.nextTurn(encounter);
  }

  _scheduleTurnTimeout(encounter) {
    // clear previous timer
    if (encounter.timers.turn) clearTimeout(encounter.timers.turn);
    encounter.timers.turn = setTimeout(() => this._onTurnTimeout(encounter), this.turnTimeoutMs);
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
    if (!avatar?.id) return;
    if (this.getCombatant(encounter, avatar.id)) return; // already in
    const stats = await this.avatarService.getOrCreateStats(avatar).catch(() => null);
    const dexMod = Math.floor((((stats?.dexterity) ?? 10) - 10) / 2);
    const initiative = this.diceService.rollDie(20) + dexMod;
    const armorClass = 10 + dexMod;
    const combatant = { avatarId: avatar.id, name: avatar.name, ref: avatar, initiative, currentHp: stats?.hp || 10, maxHp: stats?.hp || 10, armorClass, hasActed: false, isDefending: false, conditions: [], side: 'neutral' };
    encounter.combatants.push(combatant);
    // Rebuild initiative order and keep current turn index referencing correct avatar
    const currentAvatarId = this.getCurrentTurnAvatarId(encounter);
    encounter.initiativeOrder = encounter.combatants.slice().sort((a, b) => b.initiative - a.initiative).map(c => c.avatarId);
    encounter.currentTurnIndex = Math.max(0, encounter.initiativeOrder.indexOf(currentAvatarId));
  }

  /** Utility: ensures an encounter exists for channel and is active, creating + rolling if needed */
  async ensureEncounterForAttack({ channelId, attacker, defender, sourceMessage }) {
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
    if (result?.damage && (result.result === 'hit' || result.result === 'knockout' || result.result === 'dead')) {
      this.applyDamage(encounter, defenderId, result.damage);
      this.markHostile(encounter);
    }
    // Advance turn only if attacker was current turn
    if (this.getCurrentTurnAvatarId(encounter) === attackerId) {
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
    return this.getCurrentTurnAvatarId(encounter) === avatarId;
  }

  /** Post an embed for initiative order */
  async _announceInitiative(encounter) {
    if (!this.discordService?.client) return;
    const channel = this.discordService.client.channels.cache.get(encounter.channelId);
    if (!channel?.send) return;
    const orderLines = encounter.initiativeOrder.map((id, i) => {
      const c = this.getCombatant(encounter, id);
      return `${i+1}. ${c.name} (Init ${c.initiative})`;
    }).join('\n');
    const embed = {
      title: '⚔️ Combat Initiated',
      description: `Round 1 begins!`,
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
    const status = encounter.combatants.map(c => `${c.avatarId === currentId ? '➡️' : ' '} ${c.name}: ${c.currentHp}/${c.maxHp} HP${c.isDefending ? ' 🛡️' : ''}`).join('\n');
    const embed = {
      title: `Round ${encounter.round} • ${current.name}'s Turn`,
      description: current.isDefending ? '🛡️ Currently defending' : 'Declare an action.',
      fields: [ { name: 'Status', value: status.slice(0, 1024) } ],
      color: 0x00AD2F,
      footer: { text: '30s turn timer • act with narrative or commands' }
    };
    try { await channel.send({ embeds: [embed] }); } catch (e) { this.logger.warn?.(`[CombatEncounter] send turn embed failed: ${e.message}`); }
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
