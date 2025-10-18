import { resolveAdminAvatarId } from '../social/adminAvatarResolver.mjs';
import { publishEvent } from '../../events/envelope.mjs';

/**
 * Combat system constants - extracted from magic numbers for maintainability
 */
const COMBAT_CONSTANTS = {
  // Turn Management
  DEFAULT_TURN_TIMEOUT_MS: 30_000,
  DEFAULT_AUTO_ACT_DELAY_MS: 1500,
  DEFAULT_MIN_TURN_GAP_MS: 4000,
  DEFAULT_ROUND_COOLDOWN_MS: 3000,
  
  // Encounter Management
  DEFAULT_MAX_ENCOUNTERS_PER_GUILD: 5,
  DEFAULT_STALE_ENCOUNTER_MS: 60 * 60 * 1000, // 1 hour
  DEFAULT_IDLE_END_ROUNDS: 3,
  DEFAULT_MAX_ROUNDS: 3, // Maximum rounds before combat ends
  
  // Media Generation
  DEFAULT_MEDIA_WAIT_TIMEOUT_MS: 45_000,
  DEFAULT_POSTER_WAIT_TIMEOUT_MS: 15_000,
  DEFAULT_ROUND_PLANNING_TIMEOUT_MS: 3500,
  
  // Cooldowns
  KNOCKOUT_COOLDOWN_MS: 24 * 60 * 60 * 1000, // 24 hours
  FLEE_COOLDOWN_MS: 24 * 60 * 60 * 1000, // 24 hours
  
  // Combat Mechanics
  LOW_HP_THRESHOLD: 0.3,
  DEFEND_AC_BONUS: 2,
  DEFAULT_AC: 10,
  DEFAULT_HP: 10,
  DEFAULT_DEX: 10,
  
  // Cleanup
  CLEANUP_INTERVAL_MS: 60 * 1000,
  
  // Rate Limiting
  DEFAULT_MAX_ACTIONS_PER_MINUTE: 10,
  RATE_LIMIT_WINDOW_MS: 60 * 1000,
};

/**
 * Rate limiter for combat actions to prevent spam
 */
class CombatRateLimiter {
  constructor(maxActionsPerMinute = COMBAT_CONSTANTS.DEFAULT_MAX_ACTIONS_PER_MINUTE) {
    this.actions = new Map(); // avatarId -> [timestamps]
    this.maxActions = maxActionsPerMinute;
    this.windowMs = COMBAT_CONSTANTS.RATE_LIMIT_WINDOW_MS;
    this.cleanupInterval = null;
    
    // Cleanup old entries every minute
    this.cleanupInterval = setInterval(() => {
      this._cleanup();
    }, this.windowMs);
    
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Check if an avatar can perform a combat action
   * @param {string} avatarId - The avatar ID
   * @returns {boolean} - True if action is allowed, false if rate limited
   */
  canAct(avatarId) {
    if (!avatarId) return false;
    
    const now = Date.now();
    const actions = this.actions.get(avatarId) || [];
    
    // Remove actions outside the time window
    const recentActions = actions.filter(timestamp => now - timestamp < this.windowMs);
    
    if (recentActions.length >= this.maxActions) {
      return false; // Rate limited
    }
    
    // Record this action
    recentActions.push(now);
    this.actions.set(avatarId, recentActions);
    
    return true;
  }

  /**
   * Get remaining actions for an avatar in current window
   * @param {string} avatarId - The avatar ID
   * @returns {number} - Number of remaining actions allowed
   */
  getRemainingActions(avatarId) {
    if (!avatarId) return 0;
    
    const now = Date.now();
    const actions = this.actions.get(avatarId) || [];
    const recentActions = actions.filter(timestamp => now - timestamp < this.windowMs);
    
    return Math.max(0, this.maxActions - recentActions.length);
  }

  /**
   * Reset rate limit for an avatar
   * @param {string} avatarId - The avatar ID
   */
  reset(avatarId) {
    if (avatarId) {
      this.actions.delete(avatarId);
    }
  }

  /**
   * Clean up old entries from memory
   * @private
   */
  _cleanup() {
    const now = Date.now();
    const threshold = now - this.windowMs;
    
    for (const [avatarId, actions] of this.actions.entries()) {
      const recentActions = actions.filter(timestamp => timestamp > threshold);
      
      if (recentActions.length === 0) {
        this.actions.delete(avatarId);
      } else {
        this.actions.set(avatarId, recentActions);
      }
    }
  }

  /**
   * Destroy the rate limiter and cleanup resources
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.actions.clear();
  }
}

/**
 * CombatEncounterService
 * Manages turn-based D&D style combat encounters (initiative, turn order, state) for AI + tool driven actions.
 * Human slash/chat command layer intentionally deferred (per implementation request).
 */
export class CombatEncounterService {
  constructor({ logger, diceService, avatarService, mapService, battleService, battleMediaService, databaseService, unifiedAIService, discordService, configService, promptAssembler, getConversationManager }) {
  this.logger = logger || console;
    this.diceService = diceService;
    this.avatarService = avatarService;
    this.mapService = mapService;
    this.battleService = battleService;
    // Prefer direct injection of battleMediaService (container-registered); fall back to any instance hung off battleService
    this.battleMediaService = battleMediaService || (battleService && battleService.battleMediaService) || null;
    this.databaseService = databaseService;
    this.unifiedAIService = unifiedAIService; // optional
    this.discordService = discordService; // for embeds / announcements
    this.configService = configService;
  this.promptAssembler = promptAssembler || null;
  this.getConversationManager = typeof getConversationManager === 'function' ? getConversationManager : () => null;

    // channelId -> encounter object
    this.encounters = new Map();
    // Sorted list of encounters by age for efficient cleanup: [{channelId, createdAt}]
    this.encountersByAge = [];

    // Configurable knobs (using COMBAT_CONSTANTS for defaults)
  this.turnTimeoutMs = Number(process.env.COMBAT_TURN_TIMEOUT_MS || COMBAT_CONSTANTS.DEFAULT_TURN_TIMEOUT_MS);
  this.idleEndRounds = Number(process.env.COMBAT_IDLE_END_ROUNDS || COMBAT_CONSTANTS.DEFAULT_IDLE_END_ROUNDS);
  this.enableTurnEnforcement = true;
  this.maxEncountersPerGuild = Number(process.env.MAX_ENCOUNTERS_PER_GUILD || COMBAT_CONSTANTS.DEFAULT_MAX_ENCOUNTERS_PER_GUILD);
  this.staleEncounterMs = Number(process.env.COMBAT_STALE_ENCOUNTER_MS || COMBAT_CONSTANTS.DEFAULT_STALE_ENCOUNTER_MS);
  this._initCleanupInterval();

  // Rate limiting for combat actions
  const maxActionsPerMin = Number(process.env.COMBAT_MAX_ACTIONS_PER_MINUTE || COMBAT_CONSTANTS.DEFAULT_MAX_ACTIONS_PER_MINUTE);
  this.rateLimiter = new CombatRateLimiter(maxActionsPerMin);
  this.enableRateLimiting = (process.env.COMBAT_RATE_LIMITING_ENABLED || 'true').toLowerCase() === 'true';

  // Auto-acting controls
  this.autoActDelayMs = Number(process.env.COMBAT_AUTO_ACT_DELAY_MS || COMBAT_CONSTANTS.DEFAULT_AUTO_ACT_DELAY_MS);
  this.defaultCombatMode = (process.env.COMBAT_MODE_DEFAULT || 'auto').toLowerCase(); // 'auto' or 'manual'

  // Pacing & commentary controls
  this.minTurnGapMs = Number(process.env.COMBAT_MIN_TURN_GAP_MS || COMBAT_CONSTANTS.DEFAULT_MIN_TURN_GAP_MS);
  this.roundCooldownMs = Number(process.env.COMBAT_ROUND_COOLDOWN_MS || COMBAT_CONSTANTS.DEFAULT_ROUND_COOLDOWN_MS);
  this.enableCommentary = (process.env.COMBAT_COMMENTARY_ENABLED || 'true') === 'true';
  this.commentaryChance = Math.max(0, Math.min(1, parseFloat(process.env.COMBAT_COMMENTARY_CHANCE || '0.65')));
  // Round planning & narration
  this.enableRoundPlanning = (process.env.COMBAT_ROUND_PLANNING_ENABLED || 'true') === 'true';
  this.roundPlanningTimeoutMs = Number(process.env.COMBAT_ROUND_PLANNING_TIMEOUT_MS || COMBAT_CONSTANTS.DEFAULT_ROUND_PLANNING_TIMEOUT_MS);
  // Turn sequencing & media gating
  this.mediaWaitTimeoutMs = Number(process.env.COMBAT_MEDIA_WAIT_TIMEOUT_MS || COMBAT_CONSTANTS.DEFAULT_MEDIA_WAIT_TIMEOUT_MS);
  this.posterWaitTimeoutMs = Number(process.env.COMBAT_POSTER_WAIT_TIMEOUT_MS || COMBAT_CONSTANTS.DEFAULT_POSTER_WAIT_TIMEOUT_MS);
  
  // Feature flags for migration to event-driven architecture
  this.useEventDrivenTurnAdvancement = (process.env.COMBAT_EVENT_DRIVEN || 'false').toLowerCase() === 'true';
  }

  /** Internal helper to publish standardized combat narrative request events */
  _publish(type, payload = {}) {
    try {
      publishEvent({ type, payload, source: 'combatEncounterService' });
    } catch (e) {
      this.logger.warn?.(`[CombatEncounter] publish failed for ${type}: ${e.message}`);
    }
  }

  /** Initialize cleanup interval (safe to call multiple times) */
  _initCleanupInterval() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleEncounters();
    }, COMBAT_CONSTANTS.CLEANUP_INTERVAL_MS);
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  // Removed in-channel AI chat builders; combat now delegates speaking to ConversationManager
  
  /** Helper: compute DEX modifier from stats, defaulting to 10 */
  _dexModFromStats(stats) {
    const dex = Number(stats?.dexterity ?? COMBAT_CONSTANTS.DEFAULT_DEX);
    return Math.floor((dex - COMBAT_CONSTANTS.DEFAULT_DEX) / 2);
  }

  /** Helper: check if a combatant is knocked out or dead */
  _isKnockedOut(combatant) {
    if (!combatant) return true;
    const now = Date.now();
    return (combatant.currentHp || 0) <= 0 ||
           combatant.conditions?.includes('unconscious') ||
           combatant.ref?.status === 'dead' ||
           combatant.ref?.status === 'knocked_out' ||
           (combatant.ref?.knockedOutUntil && now < combatant.ref.knockedOutUntil);
  }

  /**
   * Validate encounter state integrity before critical operations
   * @param {Object} encounter - The encounter to validate
   * @param {string} operation - Name of the operation (for logging)
   * @returns {boolean} - True if valid, false otherwise
   */
  _validateEncounter(encounter, operation = 'unknown') {
    const errors = [];
    
    if (!encounter) {
      errors.push('Encounter is null or undefined');
    } else {
      // Required fields
      if (!encounter.channelId) {
        errors.push('Missing channelId');
      }
      if (!Array.isArray(encounter.combatants)) {
        errors.push('Invalid combatants (not an array)');
      }
      if (!Array.isArray(encounter.initiativeOrder)) {
        errors.push('Invalid initiativeOrder (not an array)');
      }
      
      // State-specific validation
      if (encounter.state === 'active') {
        if (encounter.initiativeOrder.length === 0) {
          errors.push('Active encounter with empty initiative order');
        }
        if (!encounter.startedAt) {
          errors.push('Active encounter without startedAt timestamp');
        }
        if (typeof encounter.currentTurnIndex !== 'number') {
          errors.push('Active encounter without valid currentTurnIndex');
        }
        if (encounter.round < 1) {
          errors.push('Active encounter with invalid round number');
        }
      }
      
      // Combatant validation
      if (Array.isArray(encounter.combatants)) {
        encounter.combatants.forEach((c, i) => {
          if (!c.avatarId) errors.push(`Combatant ${i} missing avatarId`);
          if (!c.name) errors.push(`Combatant ${i} missing name`);
          if (!c.ref) errors.push(`Combatant ${i} missing ref`);
        });
      }
    }
    
    if (errors.length > 0) {
      this.logger.error?.(
        `[CombatEncounter] Validation failed for operation '${operation}': ${errors.join(', ')}`
      );
      return false;
    }
    
    return true;
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
      if (!avatar) {
        this.logger.debug?.('[CombatEncounter] canEnterCombat: avatar is null');
        return false;
      }
      
      const now = Date.now();
      
      if (avatar.status === 'dead' || avatar.status === 'knocked_out') {
        this.logger.debug?.(`[CombatEncounter] canEnterCombat: ${avatar.name} has status ${avatar.status}`);
        return false;
      }
      
      if (avatar.knockedOutUntil && now < avatar.knockedOutUntil) {
        this.logger.debug?.(`[CombatEncounter] canEnterCombat: ${avatar.name} on KO cooldown until ${new Date(avatar.knockedOutUntil)}`);
        return false;
      }
      
      if (avatar.combatCooldownUntil && now < avatar.combatCooldownUntil) {
        this.logger.debug?.(`[CombatEncounter] canEnterCombat: ${avatar.name} on flee cooldown until ${new Date(avatar.combatCooldownUntil)}`);
        return false;
      }
      
      return true;
    } catch (error) {
      this.logger.warn?.(`[CombatEncounter] canEnterCombat error: ${error.message}`);
      return false;
    }
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
    if (!content || !actorRef) return;
    try {
      if (this.discordService?.sendAsWebhook) {
        // Ensure actorRef has a valid name property
        const validActorRef = {
          name: String(actorRef.name || actorRef.username || 'Unknown Actor'),
          imageUrl: actorRef.imageUrl || actorRef.image || actorRef.avatarUrl || '',
          emoji: actorRef.emoji || ''
        };
        await this.discordService.sendAsWebhook(encounter.channelId, content, validActorRef);
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
      currentHp: a.currentHp ?? a.hp ?? a.health ??  (a.stats?.hp || COMBAT_CONSTANTS.DEFAULT_HP),
      maxHp: a.stats?.hp || a.hp ||  a.maxHp || COMBAT_CONSTANTS.DEFAULT_HP,
      armorClass: COMBAT_CONSTANTS.DEFAULT_AC, // will be updated after stats fetch if available
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
      // Heartbeats to help recover from stalls
      lastTurnStartAt: null,
      lastTimerArmedAt: null,
      lastHostileAt: null,
      lastActionAt: null,
      lastAction: null,
      // Chatter tracking to avoid repetitive speakers
      chatter: { spokenThisRound: new Set(), lastSpeakerId: null },
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
    
    // Insert into sorted list by age for efficient cleanup
    this._insertEncounterByAge(channelId, encounter.createdAt);
    
    this.logger?.info?.(`[CombatEncounter][${channelId}] created: ${combatants.length} combatant(s), state=pending`);
    return encounter;
  }

  /**
   * Insert encounter into sorted age list (binary search for insertion point)
   * @private
   */
  _insertEncounterByAge(channelId, createdAt) {
    const entry = { channelId, createdAt };
    
    // Binary search for insertion point
    let left = 0;
    let right = this.encountersByAge.length;
    
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (this.encountersByAge[mid].createdAt < createdAt) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    
    this.encountersByAge.splice(left, 0, entry);
  }

  /** Rolls initiative for all combatants (d20 + DEX mod if stats available) */
  async rollInitiative(encounter) {
    // Fetch all stats in parallel for better performance
    const statsPromises = encounter.combatants.map(c => 
      this.avatarService.getOrCreateStats(c.ref)
        .catch(e => {
          this.logger.warn?.(`[CombatEncounter] Failed stats for ${c.name}: ${e.message}`);
          return null;
        })
    );
    
    const allStats = await Promise.all(statsPromises);
    
    // Apply stats and roll initiative for each combatant
    encounter.combatants.forEach((c, i) => {
      const stats = allStats[i];
      const roll = this.diceService.rollDie(20);
      
      if (stats) {
        const dexMod = this._dexModFromStats(stats);
        c.initiative = roll + dexMod;
        c.armorClass = COMBAT_CONSTANTS.DEFAULT_AC + dexMod;
      } else {
        // Fallback for missing stats
        c.initiative = roll;
        c.armorClass = COMBAT_CONSTANTS.DEFAULT_AC;
      }
    });
    
    this._rebuildInitiativeOrder(encounter, { preserveCurrent: false });
    encounter.state = 'active';
    encounter.startedAt = Date.now();
    encounter.round = 1;
    encounter.currentTurnIndex = 0;
    // Reset chatter tracking for new combat
    encounter.chatter = encounter.chatter || { spokenThisRound: new Set(), lastSpeakerId: null };
    encounter.chatter.spokenThisRound = new Set();
    encounter.chatter.lastSpeakerId = null;
    // Wait for fight poster phase (if any) before initiative narrative for clean ordering
    try { await encounter.posterBlocker?.promise; } catch {}
    
    // DISABLED: Pre-combat narrative causes spam - only show fight poster
    // try { this._publish('combat.narrative.request.pre_combat', { channelId: encounter.channelId }); } catch (e) { this.logger.warn?.(`[CombatEncounter] pre-combat narrative request failed: ${e.message}`); }
    
    // Announce first turn immediately for clarity (disabled - see _announceTurn)
    try { await this._announceTurn(encounter); } catch {}
    // kick off first turn using pacing logic
    this.logger?.info?.(`[CombatEncounter][${encounter.channelId}] started: round=1, order=${encounter.initiativeOrder.join('>')}`);
    this._scheduleTurnStart(encounter, { roundWrap: false });
    return encounter;
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
    if ((encounter.manualActionCount || 0) > 0) {
      this.logger.info?.(`[CombatEncounter] manual action in progress; delaying auto-act for ${this.autoActDelayMs}ms`);
      encounter.timers.auto = setTimeout(() => this._scheduleAutoAct(encounter), this.autoActDelayMs);
      return;
    }
    if (this._getCombatModeFor(combatant) !== 'auto') return; // manual: do not auto-act
    this.logger.info?.(`[CombatEncounter] scheduling auto-act for ${combatant.name} in ${this.autoActDelayMs}ms (turn of ${combatant.avatarId})`);
    encounter.timers.auto = setTimeout(() => this._maybeAutoAct(encounter, currentId).catch(e=>this.logger.warn?.(`[CombatEncounter] auto-act error: ${e.message}`)), this.autoActDelayMs);
  }

  /** If it's still the same combatant's turn, pick and execute an AI action */
  /**
   * Trigger immediate AI action for the current combatant's turn
   * This eliminates the 30-60s wait for watchdog timeout by immediately prompting the AI
   */
  async _triggerImmediateAIAction(encounter, combatant) {
    try {
      if (!encounter || !combatant || !combatant.ref) {
        this.logger?.warn?.('[CombatEncounter] _triggerImmediateAIAction: invalid inputs');
        return;
      }
      
      // Get the ConversationManager to trigger AI response
      const conversationManager = this.getConversationManager?.();
      if (!conversationManager) {
        this.logger?.debug?.('[CombatEncounter] _triggerImmediateAIAction: no ConversationManager available');
        return;
      }
      
      // Get the Discord channel
      const channel = await this.discordService?.getChannel?.(encounter.channelId);
      if (!channel) {
        this.logger?.warn?.(`[CombatEncounter] _triggerImmediateAIAction: channel ${encounter.channelId} not found`);
        return;
      }
      
      // Trigger AI response for this avatar immediately
      // The AI will use its tools (attack, defend, hide, etc.) based on the combat state
      this.logger?.info?.(
        `[CombatEncounter][${encounter.channelId}] Prompting ${combatant.name} for immediate action`
      );
      
      await conversationManager.sendResponse(channel, combatant.ref, null, {
        overrideCooldown: true,
        context: {
          inCombat: true,
          currentTurn: true,
          encounter: {
            channelId: encounter.channelId,
            round: encounter.round,
            combatants: encounter.combatants.map(c => ({
              name: c.name,
              hp: c.currentHp,
              maxHp: c.maxHp,
              isDefending: c.isDefending
            }))
          }
        }
      });
      
    } catch (e) {
      this.logger?.warn?.(`[CombatEncounter] _triggerImmediateAIAction error: ${e.message}`);
    }
  }

  async _maybeAutoAct(encounter, plannedAvatarId) {
    // Comprehensive null safety guards
    if (!encounter || encounter.state !== 'active') {
      this.logger.debug?.('[CombatEncounter] _maybeAutoAct: invalid encounter or not active');
      return;
    }
    
    const currentId = this.getCurrentTurnAvatarId(encounter);
    if (!currentId) {
      this.logger.warn?.('[CombatEncounter] _maybeAutoAct: no current turn avatar');
      return;
    }
    
    if (currentId !== plannedAvatarId) {
      this.logger.debug?.('[CombatEncounter] _maybeAutoAct: turn changed, skipping');
      return; // turn changed
    }
    
    const actor = this.getCombatant(encounter, currentId);
    if (!actor) {
      this.logger.warn?.(`[CombatEncounter] _maybeAutoAct: no combatant found for ${currentId}, advancing turn`);
      await this.nextTurn(encounter);
      return;
    }
    
    if (!actor.ref) {
      this.logger.warn?.(`[CombatEncounter] _maybeAutoAct: combatant ${actor.name} missing ref, advancing turn`);
      await this.nextTurn(encounter);
      return;
    }
    
    if (this._getCombatModeFor(actor) !== 'auto') {
      this.logger.debug?.(`[CombatEncounter] _maybeAutoAct: ${actor.name} is in manual mode`);
      return;
    }
    
    try {
      // Check if actor is knocked out using centralized helper
      if (this._isKnockedOut(actor)) {
        this.logger.info?.(`[CombatEncounter] auto-act skip for KO'd combatant ${actor.name}`);
        await this.nextTurn(encounter);
        return;
      }
    } catch (e) {
      this.logger.warn?.(`[CombatEncounter] _maybeAutoAct: KO check failed for ${actor.name}: ${e.message}`);
    }
    
    // Check if encounter should end before taking any action
    // This prevents post-knockout attacks when the previous action KO'd the last opponent
    if (this.evaluateEnd(encounter)) {
      this.logger.info?.(`[CombatEncounter][${encounter.channelId}] auto-act cancelled: encounter ended`);
      return;
    }
    
    this.logger.info?.(`[CombatEncounter][${encounter.channelId}] auto-act start for ${actor.name} (HP ${actor.currentHp}/${actor.maxHp})`);
    
    // SIMPLIFIED AUTO-ACT: Just trigger AI response with tool decision system
    // The ToolDecisionService will decide what action to take based on combat state
    try {
      const channel = await this.discordService?.getChannel?.(encounter.channelId);
      if (!channel) {
        this.logger.warn?.(`[CombatEncounter] auto-act: channel ${encounter.channelId} not found`);
        await this.nextTurn(encounter);
        return;
      }
      
      const conversationManager = this.getConversationManager?.();
      if (!conversationManager) {
        this.logger.warn?.('[CombatEncounter] auto-act: no ConversationManager available');
        await this.nextTurn(encounter);
        return;
      }
      
      // Trigger AI response - the tool decision system will choose the appropriate action
      this.logger.info?.(`[CombatEncounter][${encounter.channelId}] Prompting ${actor.name} to act via AI`);
      
      await conversationManager.sendResponse(channel, actor.ref, null, {
        overrideCooldown: true,
        context: {
          inCombat: true,
          currentTurn: true,
          encounter: {
            channelId: encounter.channelId,
            round: encounter.round,
            combatants: encounter.combatants.map(c => ({
              name: c.name,
              hp: c.currentHp,
              maxHp: c.maxHp,
              isDefending: c.isDefending,
              isKnockedOut: this._isKnockedOut(c)
            }))
          }
        }
      });
      
      // Turn advancement will be handled by the tool execution (attack/defend/etc)
      // No need to call nextTurn here - the tool will handle it
      
    } catch (e) {
      this.logger.warn?.(`[CombatEncounter] auto-act failed: ${e.message}`);
      // Fallback: just advance turn on error
      await this.nextTurn(encounter);
    }
  }

  _scheduleTurnTimeout(encounter) {
    // clear previous timer
  if (encounter.timers.turn) clearTimeout(encounter.timers.turn);
    encounter.timers.turn = setTimeout(() => this._onTurnTimeout(encounter), this.turnTimeoutMs);
    try { encounter.lastTimerArmedAt = Date.now(); } catch {}
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
        // Reset defending state at the start of their new turn
        if (current) current.isDefending = false;
        try { encounter.lastTurnStartAt = Date.now(); } catch {}
        if (this._isKnockedOut(current)) {
          this.logger.info?.(`[CombatEncounter] skipping turn for KO'd combatant ${current?.name || currentId}`);
          if (this.evaluateEnd(encounter)) return;
          // Avoid tight recursion: advance on next tick
          setTimeout(() => this.nextTurn(encounter), 0);
          return;
        }
      } catch (e) { this.logger.warn?.(`[CombatEncounter] KO skip check failed: ${e.message}`); }
      
      // DISABLED: Narrative requests cause too much spam during combat
      // Only trigger the AI action for the current turn
      // try { this._publish('combat.narrative.request.commentary', { channelId: encounter.channelId }); } catch {}
      // try { this._publish('combat.narrative.request.inter_turn', { channelId: encounter.channelId }); } catch {}
      
      // CRITICAL FIX: Trigger immediate AI response for combat turn
      // All combatants are AI agents, so immediately prompt for action instead of waiting for timeout
      try {
        const currentId = this.getCurrentTurnAvatarId(encounter);
        const current = this.getCombatant(encounter, currentId);
        if (current?.ref) {
          this.logger?.info?.(
            `[CombatEncounter][${encounter.channelId}] Triggering immediate AI response for ${current.name}'s turn`
          );
          // Use ConversationManager to generate immediate AI response for this avatar
          this._triggerImmediateAIAction(encounter, current).catch(e => {
            this.logger?.warn?.(`[CombatEncounter] Immediate AI action failed for ${current.name}: ${e.message}`);
          });
        }
      } catch (e) {
        this.logger?.warn?.(`[CombatEncounter] Failed to trigger immediate AI action: ${e.message}`);
      }
      
      // Start timers (fallback if AI doesn't respond)
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
    
    // Maximum rounds limit - END COMBAT AFTER 3 ROUNDS
    const maxRounds = Number(process.env.COMBAT_MAX_ROUNDS || COMBAT_CONSTANTS.DEFAULT_MAX_ROUNDS);
    if (encounter.round >= maxRounds) {
      this.logger?.info?.(`[CombatEncounter][${encounter.channelId}] Max rounds (${maxRounds}) reached - ending combat`);
      this.endEncounter(encounter, { reason: 'max_rounds' });
      return true;
    }
    
    // Basic rule: if <=1 conscious combatant remains
    const alive = encounter.combatants.filter(c => !this._isKnockedOut(c));
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
          actor.ref.combatCooldownUntil = Date.now() + COMBAT_CONSTANTS.FLEE_COOLDOWN_MS;
          await this.avatarService.updateAvatar(actor.ref);
        } catch {}
        try {
          const tavernId = await this.discordService?.getOrCreateThread?.(encounter.channelId, 'tavern');
          if (tavernId && this.mapService?.updateAvatarPosition) {
            await this.mapService.updateAvatarPosition(actor.ref, tavernId);
            this.logger?.info?.(`[Location][${encounter.channelId}] ${actor.name} → Tavern (${tavernId})`);
          }
        } catch (e) { this.logger?.warn?.(`[CombatEncounter] flee movement failed: ${e.message}`); }
        
        // CRITICAL FIX: Remove from turn order to prevent ghost attacks
        encounter.turnOrder = (encounter.turnOrder || []).filter(
          id => this._normalizeId(id) !== this._normalizeId(avatarId)
        );
        
        // Remove from combatants array
        this.removeCombatant(encounter, avatarId);
        
        // Check if combat should end (only 1 or fewer combatants remain)
        const activeCombatants = encounter.combatants.filter(c => (c.currentHp || 0) > 0);
        if (activeCombatants.length <= 1) {
          this.logger?.info?.(
            `[CombatEncounter][${encounter.channelId}] Combat ending - only ${activeCombatants.length} combatant(s) remain after flee`
          );
          try { encounter.fleerId = this._normalizeId(actor.avatarId); } catch {}
          this.endEncounter(encounter, { reason: 'flee' });
          return { success: true, message: `-# 🏃 [ ${actor.name} flees to the Tavern! The duel ends. ]` };
        }
        
        // Continue combat with remaining participants
        this.logger?.info?.(
          `[CombatEncounter][${encounter.channelId}] ${actor.name} fled, ${activeCombatants.length} combatants remain`
        );
        await this.nextTurn(encounter);
        return { success: true, message: `-# 🏃 [ ${actor.name} flees to the Tavern! ]` };
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
    
    // Mark for cleanup by removing from encounters map (age list will be cleaned up later)
    // We don't remove from age list immediately to avoid O(n) search during combat
    
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
  const combatant = { avatarId: aid, name: avatar.name, ref: avatar, initiative, currentHp: stats?.hp || COMBAT_CONSTANTS.DEFAULT_HP, maxHp: stats?.hp || COMBAT_CONSTANTS.DEFAULT_HP, armorClass, hasActed: false, isDefending: false, conditions: [], side: 'neutral' };
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
    if (c.currentHp === 0 && !c.conditions.includes('unconscious')) {
      c.conditions.push('unconscious');
    }
  }

  /** Convenience: apply healing to a combatant if present; returns actual healed amount */
  applyHeal(encounter, avatarId, amount) {
    try {
      const c = this.getCombatant(encounter, avatarId);
      if (!c || typeof amount !== 'number' || amount <= 0) return 0;
      const before = Math.max(0, c.currentHp || 0);
      const maxHp = Math.max(1, c.maxHp || c.ref?.stats?.hp || COMBAT_CONSTANTS.DEFAULT_HP);
      c.currentHp = Math.min(maxHp, before + amount);
      return c.currentHp - before;
    } catch { return 0; }
  }

  /**
   * Apply attack state changes without turn advancement (used by event-driven architecture)
   * @private
   */
  _applyAttackState(encounter, { attackerId, defenderId, result }) {
    try {
      const attId = this._normalizeId(attackerId);
      const defId = this._normalizeId(defenderId);
      
      // Apply damage
      if (result?.damage && (result.result === 'hit' || result.result === 'knockout' || result.result === 'dead')) {
        this.applyDamage(encounter, defId, result.damage);
        this.markHostile(encounter);
      }
      
      // Apply knockout state
      if (result?.result === 'knockout' || result?.result === 'dead') {
        try {
          encounter.knockout = { attackerId: attId, defenderId: defId, result: result?.result };
          const def = this.getCombatant(encounter, defId);
          if (def) {
            def.currentHp = 0;
            if (!def.conditions?.includes('unconscious')) {
              def.conditions = [...(def.conditions || []), 'unconscious'];
            }
          }
        } catch (e) {
          this.logger.warn?.(`[CombatEncounter] Failed to apply KO state: ${e.message}`);
        }
      }
      
      // Record last action
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
      } catch (e) {
        this.logger.warn?.(`[CombatEncounter] Failed to record last action: ${e.message}`);
      }
    } catch (e) {
      this.logger.error?.(`[CombatEncounter] _applyAttackState error: ${e.message}`);
    }
  }

  /** Central handler after an attack result for turn advancement & damage application */
  async handleAttackResult(encounter, { attackerId, defenderId, result }) {
    // Validate encounter
    if (!encounter) {
      this.logger.warn?.('[CombatEncounter] handleAttackResult: null encounter');
      return;
    }
    
    if (encounter.state !== 'active') {
      this.logger.debug?.('[CombatEncounter] handleAttackResult: encounter not active');
      return;
    }
    
    const attId = this._normalizeId(attackerId);
    const defId = this._normalizeId(defenderId);
    
    if (!attId || !defId) {
      this.logger.warn?.('[CombatEncounter] handleAttackResult: invalid attacker or defender ID');
      return;
    }
    
    // If using event-driven architecture, only apply state changes (let events handle turn advancement)
    if (this.useEventDrivenTurnAdvancement) {
      this.logger.debug?.('[CombatEncounter] handleAttackResult: using event-driven mode, skipping direct turn advancement');
      this._applyAttackState(encounter, { attackerId: attId, defenderId: defId, result });
      return;
    }
    
    // Legacy path: apply damage and state changes directly
    if (result?.damage && (result.result === 'hit' || result.result === 'knockout' || result.result === 'dead')) {
      this.applyDamage(encounter, defId, result.damage);
      this.markHostile(encounter);
    }
    
    if (result?.result === 'knockout' || result?.result === 'dead') {
      try { encounter.knockout = { attackerId: attId, defenderId: defId, result: result?.result }; } catch {}
      // Force KO state in encounter immediately for end checks and target selection
      try {
        const def = this.getCombatant(encounter, defId);
        if (def) {
          def.currentHp = 0;
          if (!def.conditions?.includes('unconscious')) def.conditions = [...(def.conditions || []), 'unconscious'];
        }
      } catch {}
      
      // Generate knockout/death media asynchronously (non-blocking)
      this._generateKnockoutMediaAsync(encounter, attId, defId, result)
        .catch(e => this.logger.warn?.(`[CombatEncounter] Async knockout media generation failed: ${e.message}`));
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
    
    // Check if encounter should end BEFORE advancing turn or doing anything else
    // This is critical to prevent post-knockout attacks
    if (this.evaluateEnd(encounter)) {
      this.logger.info?.(`[CombatEncounter][${encounter.channelId}] Encounter ended; skipping turn advancement`);
      return;
    }
    
    // Only advance turn if attacker was current turn AND we haven't already started advancing
    // Mutex flag prevents race condition with combatListeners
    if (encounter.state === 'active' && 
        this._normalizeId(this.getCurrentTurnAvatarId(encounter)) === attId &&
        !encounter._advancingTurn) {
      
      encounter._advancingTurn = true; // 🔒 Set mutex flag
      try {
        // Wait for any registered media/blockers to finish (with timeout) before moving to next turn
        await this._awaitTurnAdvanceBlockers(encounter);
        await this.nextTurn(encounter);
      } catch (error) {
        this.logger.error?.(`[CombatEncounter][${encounter.channelId}] Turn advancement error: ${error.message}`);
      } finally {
        encounter._advancingTurn = false; // 🔓 Release mutex flag
      }
    }
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
  async _announceTurn(_encounter) {
    // DISABLED: Turn announcements are now disabled to reduce spam
    // Only combat start and combat summary embeds are shown
    return;
    
    /* Original implementation kept for reference
    if (!this.discordService?.client) return;
    const channel = this._getChannel(encounter);
    if (!channel?.send) return;
    if (encounter.state !== 'active') return;
    
    // Skip turn announcements for round 1 - they're redundant and spammy
    if (encounter.round === 1) {
      this.logger.debug?.(`[CombatEncounter] skipping round 1 turn announcement`);
      return;
    }
    
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
    */
  }

  /** Generate a short in-character commentary line between actions */
  async _maybePostCommentary(encounter) {
    // DEPRECATED: retained temporarily for backward compatibility; replaced by combat.narrative.request.commentary events
    this.logger.warn?.(
      '[CombatEncounter] _maybePostCommentary is DEPRECATED and will be removed in v2.0. ' +
      'Use combat.narrative.request.commentary events instead.'
    );
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
    let speaker = (ctx.result === 'knockout' || ctx.result === 'dead') ? attacker : defender;
    // Avoid repeating same speaker back-to-back and more than once per round
    try {
      encounter.chatter = encounter.chatter || { spokenThisRound: new Set(), lastSpeakerId: null };
      const spoken = encounter.chatter.spokenThisRound instanceof Set ? encounter.chatter.spokenThisRound : new Set();
      const lastId = encounter.chatter.lastSpeakerId || null;
      const speakerId = this._normalizeId(speaker?.id || speaker?._id);
      // Swap to the other participant if current already spoke or is same as last speaker
      if ((speakerId && spoken.has(speakerId)) || (lastId && speakerId === lastId)) {
        const alt = (speaker === attacker) ? defender : attacker;
        speaker = alt || speaker;
      }
      // Update tracking
      const finalId = this._normalizeId(speaker?.id || speaker?._id);
      if (finalId) {
        spoken.add(finalId);
        encounter.chatter.spokenThisRound = spoken;
        encounter.chatter.lastSpeakerId = finalId;
      }
    } catch {}
    try {
      const channel = this._getChannel(encounter);
      if (!channel) return;
      this.logger.info?.(`[CombatEncounter][${encounter.channelId}] commentary: speaker=${speaker?.name}`);
  await conversationManager.sendResponse(channel, speaker, null, { overrideCooldown: true });
    } catch (e) {
      this.logger.warn?.(`[CombatEncounter] commentary relay failed: ${e.message}`);
    }
  }

  /**
   * Brief pre-combat chatter: give each combatant a chance to speak once after initiative.
   */
  async _preCombatChatter(encounter) {
    // DEPRECATED: replaced by combat.narrative.request.pre_combat event
    this.logger.warn?.(
      '[CombatEncounter] _preCombatChatter is DEPRECATED and will be removed in v2.0. ' +
      'Use combat.narrative.request.pre_combat events instead.'
    );
    const conversationManager = this.getConversationManager?.();
    if (!this.discordService?.client || !conversationManager?.sendResponse) return;
    try {
      const channel = this._getChannel(encounter);
      if (!channel) return;
      const talkers = encounter.combatants.slice(0, 2); // limit to avoid spam
      for (const c of talkers) {
        try {
          this.logger.info?.(`[CombatEncounter][${encounter.channelId}] pre-combat chatter: ${c.ref?.name}`);
          await conversationManager.sendResponse(channel, c.ref, null, { overrideCooldown: true });
        } catch {}
      }
    } catch (e) {
      this.logger.warn?.(`[CombatEncounter] pre-combat chatter error: ${e.message}`);
    }
  }

  /**
   * Post-round discussion: after each full round, let 2 participants speak to extend pacing.
   */
  async _postRoundDiscussion(encounter) {
    // DEPRECATED: replaced by combat.narrative.request.post_round event
    this.logger.warn?.(
      '[CombatEncounter] _postRoundDiscussion is DEPRECATED and will be removed in v2.0. ' +
      'Use combat.narrative.request.post_round events instead.'
    );
    const conversationManager = this.getConversationManager?.();
    if (!this.discordService?.client || !conversationManager?.sendResponse) return;
    try {
      const channel = this._getChannel(encounter);
      if (!channel) return;
      const alive = encounter.combatants.filter(c => (c.currentHp || 0) > 0);
      const talkers = alive.slice(0, 2);
      for (const c of talkers) {
        try {
          this.logger.info?.(`[CombatEncounter][${encounter.channelId}] post-round discussion: ${c.ref?.name}`);
          await conversationManager.sendResponse(channel, c.ref, null, { overrideCooldown: true });
        } catch {}
      }
    } catch (e) {
      this.logger.warn?.(`[CombatEncounter] post-round discussion error: ${e.message}`);
    }
  }

  /**
   * Brief per-round planning: ask each avatar for a one-liner intent, then have a DM narrator summarize the setup.
   */
  async _roundPlanningPhase(encounter) {
  // DEPRECATED: replaced by combat.narrative.request.round_planning event
  this.logger.warn?.(
    '[CombatEncounter] _roundPlanningPhase is DEPRECATED and will be removed in v2.0. ' +
    'Use combat.narrative.request.round_planning events instead.'
  );
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
      this.logger.info?.(`[CombatEncounter][${encounter.channelId}] planning phase talk: ${c.ref?.name}`);
          await conversationManager.sendResponse(channel, c.ref, null, { overrideCooldown: true });
        } catch (e) {
          this.logger.warn?.(`[CombatEncounter] round planning relay failed for ${c.name}: ${e.message}`);
        }
      }
    } catch (e) {
      this.logger.warn?.(`[CombatEncounter] planning phase error: ${e.message}`);
    }
  }

  /** Remove stale / ended encounters from memory (optimized with sorted list) */
  cleanupStaleEncounters() {
    const now = Date.now();
    const threshold = this.staleEncounterMs;
    
    // Clean from oldest until we hit a fresh encounter (early exit optimization)
    let cleanedCount = 0;
    while (this.encountersByAge.length > 0) {
      const oldest = this.encountersByAge[0];
      const enc = this.encounters.get(oldest.channelId);
      
      // If encounter doesn't exist in map, remove from age list
      if (!enc) {
        this.encountersByAge.shift();
        cleanedCount++;
        continue;
      }
      
      const ended = enc.state === 'ended';
      const stale = !ended && enc.startedAt && (now - enc.startedAt > threshold);
      
      if (ended || stale) {
        this._clearTimers(enc);
        this.encounters.delete(oldest.channelId);
        this.encountersByAge.shift();
        cleanedCount++;
        this.logger.info?.(`[CombatEncounter] Cleaned encounter channel=${oldest.channelId} reason=${ended ? 'ended' : 'stale'}`);
      } else {
        // Once we hit a non-stale encounter, all remaining are newer
        break;
      }
    }
    
    if (cleanedCount > 0) {
      this.logger.info?.(`[CombatEncounter] Cleanup: removed ${cleanedCount} encounter(s), ${this.encounters.size} active`);
    }
    
    // Watchdog pass: check all active encounters for stalled timers
    // This is less frequent now since cleanup is faster
    for (const [channelId, enc] of this.encounters.entries()) {
      if (enc.state === 'active') {
        try {
          const refTs = Math.max(
            enc.lastActionAt || 0,
            enc.lastTurnStartAt || 0,
            enc.startedAt || 0
          );
          const since = now - refTs;
          const sinceArm = enc.lastTimerArmedAt ? (now - enc.lastTimerArmedAt) : Infinity;
          const watchdogThreshold = this.turnTimeoutMs * 2;
          const needsNudge = (!enc.timers?.turn && since > watchdogThreshold) || (sinceArm > watchdogThreshold);
          if (needsNudge) {
            this.logger.warn?.(`[CombatEncounter][${channelId}] watchdog advancing turn (since=${since}ms, sinceArm=${sinceArm}ms)`);
            // Try to trigger the timeout path which handles action/advance consistently
            void this._onTurnTimeout(enc);
          }
        } catch (e) {
          this.logger.warn?.(`[CombatEncounter] Watchdog check failed for ${channelId}: ${e.message}`);
        }
      }
    }
  }

  /** Explicit destroy for graceful shutdown */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    for (const enc of this.encounters.values()) {
  this._clearTimers(enc);
    }
    this.encounters.clear();
    
    // Cleanup rate limiter
    if (this.rateLimiter) {
      this.rateLimiter.destroy();
      this.rateLimiter = null;
    }
  }

  /**
   * Check if an avatar can perform a combat action (rate limiting)
   * @param {string} avatarId - The avatar ID
   * @returns {Object} - { allowed: boolean, remaining: number, message?: string }
   */
  checkCombatActionAllowed(avatarId) {
    if (!this.enableRateLimiting || !this.rateLimiter) {
      return { allowed: true, remaining: Infinity };
    }
    
    if (!avatarId) {
      return { allowed: false, remaining: 0, message: 'Invalid avatar ID' };
    }
    
    const allowed = this.rateLimiter.canAct(avatarId);
    const remaining = this.rateLimiter.getRemainingActions(avatarId);
    
    if (!allowed) {
      return {
        allowed: false,
        remaining: 0,
        message: `-# ⏱️ [ Slow down! You've performed too many combat actions recently. Try again in a moment. ]`
      };
    }
    
    return { allowed: true, remaining };
  }

  /** Inter-turn chatter allowing other avatars to chime in between turns */
  async _postInterTurnChatter(encounter) {
    // DEPRECATED: replaced by combat.narrative.request.inter_turn event
    this.logger.warn?.(
      '[CombatEncounter] _postInterTurnChatter is DEPRECATED and will be removed in v2.0. ' +
      'Use combat.narrative.request.inter_turn events instead.'
    );
    const conversationManager = this.getConversationManager?.();
    if (!this.discordService?.client || !conversationManager?.sendResponse) return;
    try {
      const channel = this._getChannel(encounter);
      if (!channel) return;
      // Respect initiative order: pick next two in order after current turn
      const currentId = this.getCurrentTurnAvatarId(encounter);
      const order = encounter.initiativeOrder || [];
      const idx = Math.max(0, order.indexOf(this._normalizeId(currentId)));
      const nextIds = [order[(idx + 1) % order.length], order[(idx + 2) % order.length]].filter(Boolean);
      // Filter to alive and distinct
      const alive = (encounter.combatants || []).filter(c => (c.currentHp || 0) > 0);
      const nextInOrder = nextIds
        .map(id => alive.find(c => this._normalizeId(c.avatarId) === this._normalizeId(id)))
        .filter(Boolean);
      // Avoid duplicates: one message per combatant per round and not the last speaker
      encounter.chatter = encounter.chatter || { spokenThisRound: new Set(), lastSpeakerId: null };
      const spoken = encounter.chatter.spokenThisRound instanceof Set ? encounter.chatter.spokenThisRound : new Set();
      const lastId = encounter.chatter.lastSpeakerId || null;
      const candidates = nextInOrder.filter(c => {
        const cid = this._normalizeId(c.avatarId);
        return cid && !spoken.has(cid) && cid !== this._normalizeId(currentId) && cid !== lastId;
      }).slice(0, 2);
      for (const c of candidates) {
        try {
          this.logger.info?.(`[CombatEncounter][${encounter.channelId}] inter-turn chatter: ${c.ref?.name}`);
          await conversationManager.sendResponse(channel, c.ref, null, { overrideCooldown: true });
          // mark as spoken
          const cid = this._normalizeId(c.avatarId);
          if (cid) {
            spoken.add(cid);
            encounter.chatter.spokenThisRound = spoken;
            encounter.chatter.lastSpeakerId = cid;
          }
        } catch {}
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
      
      // Sync combatant HP from actual avatar refs to get current state
      for (const c of encounter.combatants) {
        if (c.ref) {
          try {
            const freshStats = await this.avatarService?.getOrCreateStats?.(c.ref);
            if (freshStats?.hp) {
              c.maxHp = freshStats.hp;
              // Only update currentHp if ref has a valid value
              if (typeof c.ref.currentHp === 'number') {
                c.currentHp = c.ref.currentHp;
              } else if (typeof c.ref.hp === 'number') {
                c.currentHp = c.ref.hp;
              }
            }
          } catch (e) {
            this.logger.debug?.(`[CombatEncounter] HP sync failed for ${c.name}: ${e.message}`);
          }
        }
      }
      
      const status = encounter.combatants.map(c => `${c.name}: ${c.currentHp}/${c.maxHp} HP`).join('\n');
      
      // Generate AI summary of the battle
      let friendlyReason = this._formatEndReason?.(encounter) || 'The encounter concludes.';
      if (this.unifiedAIService?.chat) {
        try {
          const combatLog = [];
          if (encounter.lastAction) {
            const action = encounter.lastAction;
            combatLog.push(`${action.attackerName} ${action.result === 'hit' ? 'hit' : action.result === 'miss' ? 'missed' : action.result} ${action.defenderName}${action.damage ? ` for ${action.damage} damage` : ''}`);
          }
          if (encounter.knockout) {
            const attacker = this.getCombatant(encounter, encounter.knockout.attackerId);
            const defender = this.getCombatant(encounter, encounter.knockout.defenderId);
            combatLog.push(`${attacker?.name || 'Fighter'} ${encounter.knockout.result === 'dead' ? 'defeated' : 'knocked out'} ${defender?.name || 'opponent'}`);
          }
          
          const prompt = `Summarize this battle in 1-2 dramatic sentences (max 200 chars). Be concise and exciting.

Combatants: ${encounter.combatants.map(c => `${c.name} (${c.currentHp}/${c.maxHp} HP)`).join(', ')}
Rounds: ${encounter.round}
Outcome: ${encounter.endReason || 'concluded'}
${combatLog.length > 0 ? `Key moments: ${combatLog.join('; ')}` : ''}

Write a brief, punchy summary with dramatic flair. No quotes.`;
          
          const response = await this.unifiedAIService.chat({
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.8,
            maxTokens: 100
          });
          
          if (response?.content) {
            const summary = String(response.content).trim().replace(/^["']|["']$/g, '').slice(0, 400);
            if (summary.length > 10) {
              friendlyReason = summary;
            }
          }
        } catch (e) {
          this.logger.debug?.(`[CombatEncounter] AI summary generation failed: ${e.message}`);
        }
      }
      
      const embed = {
        title: 'Combat Summary',
        description: friendlyReason,
        color: 0x7289da,
        fields: [{ name: 'Status', value: status.slice(0, 1024) }],
      };
  // Capture any video URL we plan to post separately after the embed
  let _videoUrl = null;
  try {
        if (this.battleMediaService || this.battleService?.battleMediaService) {
          const bms = this.battleMediaService || this.battleService?.battleMediaService;
          const loc = await this.mapService?.getLocationAndAvatars?.(encounter.channelId).catch(()=>null);
          let media = null;
          let attacker = null;
          let defender = null;
          // KO path: prefer captured media, else generate finishing scene
          if (encounter.knockout) {
            attacker = this.getCombatant(encounter, encounter.knockout.attackerId)?.ref;
            defender = this.getCombatant(encounter, encounter.knockout.defenderId)?.ref;
            media = encounter.knockoutMedia || null;
            // Prefer summary generator so videos are only created in summary
            if (!media || (!media.imageUrl && !media.videoUrl)) {
              try {
                media = await bms.generateSummaryMedia({
                  winner: attacker,
                  loser: defender,
                  outcome: encounter.knockout.result,
                  location: loc?.location
                });
              } catch {}
            }
            if ((!media || (!media.imageUrl && !media.videoUrl)) && bms?.generateFightPoster) {
              try {
                const poster = await bms.generateFightPoster({ attacker, defender, location: loc?.location });
                if (poster?.imageUrl) media = { imageUrl: poster.imageUrl };
              } catch {}
            }
          } else {
            // Non-KO end: prefer a summary scene of the winner vs loser
            try {
              const now = Date.now();
              const aliveNow = (encounter.combatants || []).filter(c => {
                const hpOk = (c.currentHp || 0) > 0;
                const notDead = c.ref?.status !== 'dead';
                const notKO = !(c.ref?.status === 'knocked_out' || (c.ref?.knockedOutUntil && now < c.ref.knockedOutUntil));
                return hpOk && notDead && notKO;
              });
              const everyone = (encounter.combatants || []).slice();
              const winnerC = aliveNow.length === 1
                ? aliveNow[0]
                : everyone.slice().sort((a,b)=> (b.currentHp||0) - (a.currentHp||0))[0];
              const loserC = everyone.find(c => this._normalizeId(c.avatarId) !== this._normalizeId(winnerC?.avatarId)) || winnerC;
              attacker = winnerC?.ref;
              defender = loserC?.ref;
              media = await bms.generateSummaryMedia({
                winner: attacker,
                loser: defender,
                outcome: 'win',
                location: loc?.location
              });
            } catch {}
            if ((!media || (!media.imageUrl && !media.videoUrl)) && bms?.generateFightPoster) {
              try {
                // Choose first two combatants for poster if attacker/defender not set
                if (!attacker || !defender) {
                  const c0 = encounter.combatants?.[0]?.ref;
                  const c1 = encounter.combatants?.[1]?.ref;
                  attacker = attacker || c0;
                  defender = defender || c1 || c0; // handle solo case
                }
                const poster = await bms.generateFightPoster({ attacker, defender, location: loc?.location });
                if (poster?.imageUrl) media = { imageUrl: poster.imageUrl };
              } catch {}
            }
          }
          // If nothing yet, try a dedicated summary image generator (winner vs loser)
          if ((!media || (!media.imageUrl && !media.videoUrl)) && bms?.generateSummaryMedia) {
            try {
              const now = Date.now();
              const aliveNow = (encounter.combatants || []).filter(c => {
                const hpOk = (c.currentHp || 0) > 0;
                const notDead = c.ref?.status !== 'dead';
                const notKO = !(c.ref?.status === 'knocked_out' || (c.ref?.knockedOutUntil && now < c.ref.knockedOutUntil));
                return hpOk && notDead && notKO;
              });
              const everyone = (encounter.combatants || []).slice();
              const winnerC = aliveNow.length === 1
                ? aliveNow[0]
                : everyone.slice().sort((a,b)=> (b.currentHp||0) - (a.currentHp||0))[0];
              const loserC = everyone.find(c => this._normalizeId(c.avatarId) !== this._normalizeId(winnerC?.avatarId)) || winnerC;
              const outcome = encounter.knockout?.result || 'win';
              const sum = await bms.generateSummaryMedia({
                winner: winnerC?.ref,
                loser: loserC?.ref,
                outcome,
                location: loc?.location
              });
              if (sum?.imageUrl || sum?.videoUrl) media = sum;
            } catch (e) {
              this.logger.warn?.(`[CombatEncounter] summary fallback media failed: ${e.message}`);
            }
          }

          // Attach media if any
          if (media?.imageUrl) embed.image = { url: media.imageUrl };
          // Do not attach video inside the embed; post it separately for reliable inline playback
          _videoUrl = media?.videoUrl || null;
          // Fallback to avatar image if no generated image
          if (!embed.image && (attacker?.imageUrl || defender?.imageUrl)) {
            embed.image = { url: attacker?.imageUrl || defender?.imageUrl };
          }
        }
      } catch (e) {
        this.logger.warn?.(`[CombatEncounter] summary media failed: ${e.message}`);
      }
  // Send the embed first
  await channel.send({ embeds: [embed] });
  // Then, if a video URL exists, post it as a separate message so the client can inline it
  try {
    if (typeof _videoUrl === 'string' && _videoUrl.length > 0) {
      await channel.send({ content: `🎬 Final clip: ${_videoUrl}` });
    }
  } catch (e) {
    this.logger.warn?.(`[CombatEncounter] posting video link failed: ${e.message}`);
  }

      // Optional: auto-post summary as a reply on X thread
      try {
        const autoX = String(process.env.X_AUTO_POST_BATTLES || 'false').toLowerCase();
        const xsvc = this.configService?.services?.xService;
        if (autoX === 'true' && xsvc && (encounter._xTweetId || encounter._xTweetUrl)) {
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
          const adminResolved = admin;
          const parentId = encounter._xTweetId;
          // Resolve winner/loser refs for message
          let attRef = null; let defRef = null;
          try {
            if (encounter.knockout?.attackerId && encounter.knockout?.defenderId) {
              attRef = this.getCombatant(encounter, encounter.knockout.attackerId)?.ref || null;
              defRef = this.getCombatant(encounter, encounter.knockout.defenderId)?.ref || null;
            }
          } catch {}
          const text = (() => {
            const outcome = encounter.knockout?.result || 'win';
            if (encounter.knockout && attRef && defRef) {
              return `Result: ${attRef.name} ${outcome === 'dead' ? 'defeated' : 'knocked out'} ${defRef.name}.`;
            }
            return `Battle concluded.`;
          })();
          if (adminResolved && parentId) {
            try {
              if (_videoUrl) {
                await xsvc.replyWithVideoToX(adminResolved, parentId, _videoUrl, text);
              } else if (embed?.image?.url) {
                await xsvc.replyWithImageToX(adminResolved, parentId, embed.image.url, text);
              }
            } catch (e) { this.logger.warn?.(`[CombatEncounter] auto X reply failed: ${e.message}`); }
          }
        }
      } catch (e) { this.logger.debug?.(`[CombatEncounter] auto X summary skipped: ${e.message}`); }
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
      max_rounds: 'The battle reaches its climax after 3 intense rounds!',
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

  /**
   * Generate knockout/death media asynchronously without blocking turn advancement
   * Posts media as a follow-up message when ready
   * @private
   */
  async _generateKnockoutMediaAsync(encounter, attackerId, defenderId, result) {
    try {
      if (!this.battleMediaService && !this.battleService?.battleMediaService) {
        this.logger.debug?.('[CombatEncounter] No media service available for knockout media');
        return;
      }

      const bms = this.battleMediaService || this.battleService?.battleMediaService;
      const attacker = this.getCombatant(encounter, attackerId)?.ref;
      const defender = this.getCombatant(encounter, defenderId)?.ref;
      
      if (!attacker || !defender) {
        this.logger.warn?.('[CombatEncounter] Cannot generate knockout media: missing attacker or defender');
        return;
      }

      this.logger.info?.(`[CombatEncounter][${encounter.channelId}] Generating knockout media async for ${attacker.name} vs ${defender.name}`);

      // Get location for context
      let location = null;
      try {
        const loc = await this.mapService?.getLocationAndAvatars?.(encounter.channelId);
        location = loc?.location;
      } catch (e) {
        this.logger.debug?.(`[CombatEncounter] Could not fetch location: ${e.message}`);
      }

      // Generate media (may take 10-45 seconds)
      let media = null;
      try {
        media = await bms.generateSummaryMedia({
          winner: attacker,
          loser: defender,
          outcome: result?.result || 'knockout',
          location
        });
      } catch (e) {
        this.logger.warn?.(`[CombatEncounter] Knockout media generation failed: ${e.message}`);
        
        // Fallback to fight poster
        if (bms?.generateFightPoster) {
          try {
            const poster = await bms.generateFightPoster({ attacker, defender, location });
            if (poster?.imageUrl) media = { imageUrl: poster.imageUrl };
          } catch (e2) {
            this.logger.warn?.(`[CombatEncounter] Fight poster fallback failed: ${e2.message}`);
          }
        }
      }

      // Store media for summary
      if (media) {
        encounter.knockoutMedia = media;
        
        // Post media as follow-up message
        try {
          const channel = this._getChannel(encounter);
          if (channel?.send) {
            if (media.videoUrl) {
              await channel.send({ content: `🎬 Finishing move: ${media.videoUrl}` });
            } else if (media.imageUrl) {
              await channel.send({ 
                embeds: [{ 
                  title: '💥 Knockout!',
                  image: { url: media.imageUrl },
                  color: 0xFF0000
                }] 
              });
            }
            this.logger.info?.(`[CombatEncounter][${encounter.channelId}] Posted knockout media`);
          }
        } catch (e) {
          this.logger.warn?.(`[CombatEncounter] Failed to post knockout media: ${e.message}`);
        }
      }
      
    } catch (error) {
      this.logger.error?.(`[CombatEncounter] _generateKnockoutMediaAsync error: ${error.message}`);
    }
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

  /** Get the avatarId whose turn it is, or null */
  getCurrentTurnAvatarId(encounter) {
    try {
      if (!encounter) return null;
      const order = Array.isArray(encounter.initiativeOrder) ? encounter.initiativeOrder : [];
      if (order.length === 0) return null;
      const idx = Math.max(0, Math.min(order.length - 1, Number(encounter.currentTurnIndex) || 0));
      const id = order[idx];
      return this._normalizeId(id);
    } catch { return null; }
  }

  /** Find a combatant by avatarId (string or object with id/_id) */
  getCombatant(encounter, avatarId) {
    try {
      if (!encounter) return null;
      const id = this._normalizeId(avatarId);
      const list = Array.isArray(encounter.combatants) ? encounter.combatants : [];
      return list.find(c => this._normalizeId(c.avatarId) === id) || null;
    } catch { return null; }
  }

  /** Advance to the next turn; handle round wrap and narrative pacing hooks */
  async nextTurn(encounter) {
    try {
      // Validate encounter before advancing
      if (!this._validateEncounter(encounter, 'nextTurn')) {
        this.logger.error?.('[CombatEncounter] Cannot advance turn: invalid encounter state');
        return;
      }
      
      if (encounter.state !== 'active') {
        this.logger.debug?.('[CombatEncounter] nextTurn: encounter not active');
        return;
      }
      
      const order = Array.isArray(encounter.initiativeOrder) ? encounter.initiativeOrder : [];
      if (order.length === 0) {
        this.logger.warn?.('[CombatEncounter] nextTurn: empty initiative order');
        return;
      }
      const prevIdx = Math.max(0, Math.min(order.length - 1, Number(encounter.currentTurnIndex) || 0));
      const nextIdx = (prevIdx + 1) % order.length;
      const roundWrap = nextIdx === 0;
      if (roundWrap) {
        // New round
        encounter.round = Math.max(1, Number(encounter.round) || 1) + 1;
        this.logger?.info?.(`[CombatEncounter][${encounter.channelId}] Starting round ${encounter.round}`);
        
        // Check if max rounds reached
        if (this.evaluateEnd(encounter)) {
          this.logger?.info?.(`[CombatEncounter][${encounter.channelId}] Combat ended at start of round ${encounter.round}`);
          return;
        }
        
        // Reset chatter cadence for the new round
        try {
          encounter.chatter = encounter.chatter || { spokenThisRound: new Set(), lastSpeakerId: null };
          encounter.chatter.spokenThisRound = new Set();
          encounter.chatter.lastSpeakerId = null;
        } catch {}
        
        // DISABLED: Narrative requests cause spam - only show combat start and summary
        // try { this._publish('combat.narrative.request.post_round', { channelId: encounter.channelId, round: encounter.round - 1 }); } catch {}
        // if (this.enableRoundPlanning) {
        //   try { this._publish('combat.narrative.request.round_planning', { channelId: encounter.channelId, round: encounter.round }); } catch {}
        // }
      }
      // Apply index and announce turn
      encounter.currentTurnIndex = nextIdx;
      try { await this._announceTurn(encounter); } catch {}
      // Schedule start (pacing + timers + auto-act)
      this._scheduleTurnStart(encounter, { roundWrap });
    } catch (e) {
      this.logger?.warn?.(`[CombatEncounter] nextTurn error: ${e.message}`);
    }
  }

  /** Called when the turn timer elapses without action */
  async _onTurnTimeout(encounter) {
    try {
      // Validate encounter
      if (!encounter) {
        this.logger.warn?.('[CombatEncounter] _onTurnTimeout: null encounter');
        return;
      }
      
      if (encounter.state !== 'active') {
        this.logger.debug?.('[CombatEncounter] _onTurnTimeout: encounter not active');
        return;
      }
      
      const currentId = this.getCurrentTurnAvatarId(encounter);
      if (!currentId) {
        this.logger.warn?.('[CombatEncounter] _onTurnTimeout: no current turn avatar');
        return;
      }
      
      const actor = this.getCombatant(encounter, currentId);
      if (!actor) {
        this.logger.info?.(`[CombatEncounter] turn timed out; advancing (no actor found for ${currentId})`);
        await this.nextTurn(encounter);
        return;
      }
      
      if (!actor.ref) {
        this.logger.warn?.(`[CombatEncounter] _onTurnTimeout: actor ${actor.name} missing ref`);
        await this.nextTurn(encounter);
        return;
      }
      
      const mode = this._getCombatModeFor(actor);
      if (mode === 'auto') {
        // Try to perform the planned action immediately
        await this._maybeAutoAct(encounter, currentId);
        return; // _maybeAutoAct will advance as needed
      }
      // Manual mode: default to defend and advance
      try {
        if (this.battleService?.defend) {
          const msg = await this.battleService.defend({ avatar: actor.ref });
          actor.isDefending = true;
          await this._postAsWebhook(encounter, actor.ref, `${actor.name} used defend 🛡️\n${msg}`);
        }
      } catch {}
      await this.nextTurn(encounter);
    } catch (e) {
      this.logger?.warn?.(`[CombatEncounter] onTurnTimeout error: ${e.message}`);
    }
  }
}


export default CombatEncounterService;
