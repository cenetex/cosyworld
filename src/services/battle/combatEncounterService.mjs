import { resolveAdminAvatarId } from '../social/adminAvatarResolver.mjs';
import { publishEvent } from '../../events/envelope.mjs';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import eventBus from '../../utils/eventBus.mjs';
import { CombatAIService } from './combatAIService.mjs';
import { CombatMessagingService } from './combatMessagingService.mjs';
import { StatusEffectService } from './statusEffectService.mjs';
import { CombatLogService } from './combatLogService.mjs';
import { TurnLock, TURN_STATES } from './TurnLock.mjs';

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
  constructor({ logger, diceService, avatarService, mapService, battleService, battleMediaService, databaseService, unifiedAIService, discordService, configService, promptAssembler, getConversationManager, veoService, dmNarratorService }) {
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
    this.veoService = veoService || null; // For battle recap videos
    this.dmNarratorService = dmNarratorService || null; // For AI DM third-person narration

    // Initialize modular combat services
    this.combatAIService = new CombatAIService({
      logger: this.logger,
      unifiedAIService: this.unifiedAIService,
      avatarService: this.avatarService,
      diceService: this.diceService
    });
    
    this.combatMessagingService = new CombatMessagingService({
      logger: this.logger,
      discordService: this.discordService
    });
    
    this.statusEffectService = new StatusEffectService({
      logger: this.logger,
      diceService: this.diceService
    });
    
    // Combat log persistence
    this.combatLogService = databaseService ? new CombatLogService({
      databaseService,
      logger: this.logger
    }) : null;

    // Turn lock state machine (V3 fix for race conditions)
    this.turnLock = new TurnLock({ logger: this.logger });

    // channelId -> encounter object (active encounters)
    this.encounters = new Map();
    // parentChannelId -> encounter (for thread-based combat redirects)
    this.encountersByParent = new Map();
    // Sorted list of encounters by age for efficient cleanup: [{channelId, createdAt}]
    this.encountersByAge = [];
    
    // channelId -> completed encounter object (for video generation after combat ends)
    // Stores battleRecap data for 24 hours after combat completion
    this.completedEncounters = new Map();

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

  // Auto-action system removed - combat follows pure D&D initiative rules

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

  _getPolicyForMode(mode) {
    const maxRounds = Number(process.env.COMBAT_MAX_ROUNDS || COMBAT_CONSTANTS.DEFAULT_MAX_ROUNDS);
    const idleEndRounds = this.idleEndRounds;
    const staleEncounterMs = this.staleEncounterMs;
    if (mode === 'pvp') {
      const pvpStale = Number(process.env.COMBAT_PVP_STALE_MS || 30 * 24 * 60 * 60 * 1000);
      return {
        maxRounds: null,
        idleEndRounds: null,
        allowAllDefendingEnd: false,
        allowIdleEnd: false,
        staleEncounterMs: pvpStale
      };
    }
    return {
      maxRounds,
      idleEndRounds,
      allowAllDefendingEnd: true,
      allowIdleEnd: true,
      staleEncounterMs
    };
  }

  _buildCombatThreadName(attacker, defender) {
    const a = attacker?.name || 'Unknown';
    const d = defender?.name || 'Unknown';
    const raw = `Combat: ${a} vs ${d}`;
    return raw.length > 90 ? `${raw.slice(0, 87)}...` : raw;
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
    // Support both avatar stats (dexterity) and monster stats (dex)
    const dex = Number(stats?.dexterity ?? stats?.dex ?? COMBAT_CONSTANTS.DEFAULT_DEX);
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

  _createPosterBlocker() {
    let resolve;
    const p = new Promise(res => { resolve = res; });
    // Auto-resolve after timeout to avoid deadlock if no poster is produced
    setTimeout(() => { try { resolve(); } catch {} }, this.posterWaitTimeoutMs).unref?.();
    return { promise: p, resolve: resolve || (() => {}) };
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

  /** Alias for getEncounter - used by some services/tools */
  getEncounterByChannelId(channelId) {
    return this.getEncounter(channelId);
  }

  /** Returns active encounter for a parent channel (thread-based combat) */
  getEncounterByParentChannelId(channelId) {
    return this.encountersByParent.get(channelId) || null;
  }

  /** Creates a new encounter for channel with given participants (array of avatar objects). */
  createEncounter({ channelId, participants, sourceMessage, context = {} }) {
    if (this.encounters.has(channelId)) {
      return this.encounters.get(channelId);
    }
    const mode = context.mode || 'world';
    const policy = context.policy || this._getPolicyForMode(mode);
    const parentChannelId = context.parentChannelId || null;
    const threadId = context.threadId || channelId;
    const originLocations = context.originLocations || {};
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
    const combatants = Array.from(unique.entries()).map(([aid, a]) => {
      // Always start with MAX HP for a fresh combat, ignoring avatar's current HP
      const maxHp = a.stats?.hp || a.maxHp || a.hp || COMBAT_CONSTANTS.DEFAULT_HP;

      // FIX: Clear stale knocked_out status on the ref object for fresh encounters.
      // The 24-hour KO cooldown is meant for world PvP, not dungeon re-attempts.
      // Without this, _isKnockedOut() sees the stale ref.status and skips the
      // combatant before round 1, causing instant TPK.
      if (a.status === 'knocked_out') {
        a.status = 'active';
        delete a.knockedOutUntil;
        this.logger?.info?.(`[CombatEncounter] Cleared stale knocked_out status on ${a.name} for fresh encounter`);
      }
      // Determine if player-controlled (waiting for human input):
      // An avatar is human-controlled if:
      // - Not a monster AND
      // - Has summoner starting with 'user:' OR has a discordUserId (linked to human)
      const isMonster = a.isMonster === true;
      const hasSummoner = String(a.summoner || '').startsWith('user:');
      const hasDiscordUser = !!a.discordUserId;
      const isPlayerControlled = !isMonster && (hasSummoner || hasDiscordUser);
      
      // Extract discordUserId for turn validation
      // Priority: direct field > extracted from summoner
      let discordUserId = a.discordUserId || null;
      if (!discordUserId && hasSummoner) {
        discordUserId = String(a.summoner).replace(/^user:/, '');
      }
      
      const baseMonsterId = a.baseMonsterId || a.monsterId || null;
      return {
        combatantId: aid,
        avatarId: aid,
        name: a.name,
        ref: a,
        baseMonsterId: isMonster ? baseMonsterId : null,
        discordUserId, // Store at combatant level for turn validation
        initiative: null,
        currentHp: maxHp, // Start at full HP for new encounter
        maxHp: maxHp,
        armorClass: COMBAT_CONSTANTS.DEFAULT_AC, // will be updated after stats fetch if available
        hasActed: false,
        isDefending: false,
        conditions: [],
        side: isMonster ? 'enemy' : 'neutral',
        isMonster,
        isPlayerControlled,
        autoMode: !isPlayerControlled, // Non-player avatars auto-act; players wait for input
        awaitingAction: false // Set to true when waiting for player input
      };
    });

    const encounter = {
      encounterId: `${threadId}:${Date.now()}`,
      channelId,
      parentChannelId,
      threadId,
      mode,
      policy,
      originLocations,
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
      // Round action accumulator for consolidated narration
      pendingRoundActions: [],
      lastNarratedRound: 0,
      timers: {},
      knockout: null,
      knockoutMedia: null,
      fightPosterUrl: null, // Initial fight poster URL for video generation
      summaryMediaUrl: null, // Final summary/victory scene URL for video generation
      // Media/turn sequencing controls
      turnAdvanceBlockers: [], // array of Promises to await before advancing to next turn
      manualActionCount: 0, // increments during manual/command-driven actions to pause auto-act
      posterBlocker: this._createPosterBlocker(),
      sourceMessageId: sourceMessage?.id || null,
      // Battle recap data - stores moments from each round for video generation
      battleRecap: { rounds: [] }
    };
    this.encounters.set(channelId, encounter);
    if (parentChannelId) {
      this.encountersByParent.set(parentChannelId, encounter);
    }
    
    // Insert into sorted list by age for efficient cleanup
    this._insertEncounterByAge(channelId, encounter.createdAt);
    
    this.logger?.info?.(`[CombatEncounter][${channelId}] created: ${combatants.length} combatant(s), state=pending`);
    this._persistActiveEncounter(encounter).catch(e => this.logger.warn?.(`[CombatEncounter] active persist failed: ${e.message}`));
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
    // Skip avatarService lookup for monsters - they have inline stats
    const statsPromises = encounter.combatants.map(c => {
      // Monsters have inline stats, no need to fetch from avatarService
      if (c.isMonster && c.ref?.stats) {
        return Promise.resolve(c.ref.stats);
      }
      return this.avatarService.getOrCreateStats(c.ref)
        .catch(e => {
          this.logger.warn?.(`[CombatEncounter] Failed stats for ${c.name}: ${e.message}`);
          return null;
        });
    });
    
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
    
    // Log encounter start to database
    if (this.combatLogService) {
      this.combatLogService.logEncounterStart(encounter).catch(() => {});
    }
    
    // V3: Emit combat started event for UI sync
    eventBus.emit('combat.started', {
      channelId: encounter.channelId,
      encounterId: encounter.encounterId,
      combatants: encounter.combatants?.map(c => ({ name: c.name, avatarId: c.avatarId, isMonster: c.isMonster })),
      round: 1
    });
    
    this._persistActiveEncounter(encounter).catch(e => this.logger.warn?.(`[CombatEncounter] active persist failed: ${e.message}`));

    // Wait for fight poster phase (if any) before initiative narrative for clean ordering
    try { await encounter.posterBlocker?.promise; } catch {}
    
    // Pre-combat dialogue: let each combatant say something before the fight starts
    await this._postPreCombatDialogue(encounter);
    
    // Start first turn - _scheduleTurnStart handles turn announcement
    this.logger?.info?.(`[CombatEncounter][${encounter.channelId}] started: round=1, order=${encounter.initiativeOrder.join('>')}`);
    this._scheduleTurnStart(encounter);
    return encounter;
  }

  // Combat mode system removed - all actions come from tools

  // AUTO-ACTION SYSTEM REMOVED
  // Combat now follows pure D&D rules: wait for player action via tools
  // Tools (AttackTool, DefendTool) drive combat, not automated AI responses

  /** If it's still the same combatant's turn, pick and execute an AI action */
  /**
   * Execute one combatant's turn in combat
   * Orchestrates: status effects → action selection → execution → dialogue → post → capture
   */
  async _executeTurn(encounter, combatant) {
    try {
      if (!combatant || !combatant.ref) {
        this.logger?.warn?.('[CombatEncounter] _executeTurn: invalid combatant');
        await this.nextTurn(encounter);
        return;
      }
      
      // 0. Process status effects at turn start (DoT, HoT, expired effects)
      const statusResult = this.statusEffectService.processTurnStart(combatant, encounter.round);
      if (statusResult.messages.length > 0) {
        const channel = this._getChannel(encounter);
        if (channel) {
          await channel.send({ content: `-# ${statusResult.messages.join(' | ')}` });
        }
      }
      
      // Check if turn is skipped due to status effect (stunned, etc.)
      if (statusResult.skipTurn) {
        this.logger?.info?.(`[CombatEncounter] ${combatant.name}'s turn skipped due to status effect`);
        await this.nextTurn(encounter);
        return;
      }
      
      // Check if knocked out from DoT
      if (combatant.currentHp <= 0) {
        this.logger?.info?.(`[CombatEncounter] ${combatant.name} knocked out from status effects`);
        if (this.evaluateEnd(encounter)) return;
        await this.nextTurn(encounter);
        return;
      }
      
      // 1. Select action (AI decision via CombatAIService)
      const action = await this.combatAIService.selectCombatAction(encounter, combatant);
      if (!action) {
        this.logger?.warn?.(`[CombatEncounter] No valid action for ${combatant.name}`);
        await this.nextTurn(encounter);
        return;
      }
      
      // 2. Execute action via BattleService
      const result = await this._executeCombatAction(action, combatant, encounter);
      
      // 2b. Generate DM narration (third-person cinematic description)
      let dmNarration = null;
      try {
        if (this.dmNarratorService && action.type === 'attack' && action.target && result) {
          dmNarration = await this.dmNarratorService.narrateAction({
            action,
            attacker: combatant.ref,
            defender: action.target.ref,
            result,
            encounter
          });
        }
      } catch (e) {
        this.logger?.debug?.(`[CombatEncounter] DM narration failed: ${e.message}`);
      }
      
      // 3. Generate combat dialogue (AI one-liner via CombatAIService)
      this.logger?.info?.(`[CombatEncounter] Generating dialogue for ${combatant.name} (action: ${action.type})`);
      const dialogue = await this.combatAIService.generateCombatDialogue(combatant, action, result);
      this.logger?.info?.(`[CombatEncounter] Dialogue generated: "${dialogue}"`);
      
      // 4. Post to Discord via CombatMessagingService
      await this.combatMessagingService.postCombatAction(encounter, combatant, action, result, dialogue, dmNarration);
      
      // 4b. Log to database for replay/analytics
      if (this.combatLogService) {
        this.combatLogService.logAction({ encounter, combatant, action, result, dialogue }).catch(() => {});
      }
      
      // 5. Capture for video
      if (action.type === 'attack' && action.target && result) {
        this._captureBattleMoment(encounter, {
          attacker: combatant,
          defender: action.target,
          result,
          dialogue
        });
      }
      
      // 6. Check end conditions
      if (this.evaluateEnd(encounter)) return;
      
      // 7. Advance turn
      await this.nextTurn(encounter);
      
    } catch (e) {
      this.logger?.error?.(`[CombatEncounter] _executeTurn error for ${combatant?.name}: ${e.message}`);
      await this.nextTurn(encounter);
    }
  }

  /**
   * AI selects combat action based on current state
   * @deprecated Use combatAIService.selectCombatAction instead
   */
  async _selectCombatAction(encounter, combatant) {
    // Delegate to CombatAIService for smarter decision making
    return this.combatAIService.selectCombatAction(encounter, combatant);
  }

  /**
   * Execute the selected combat action via BattleService
   */
  async _executeCombatAction(action, combatant, encounter) {
    if (!action || !this.battleService) return null;
    
    switch (action.type) {
      case 'attack':
        if (!action.target) return null;
        const attackResult = await this.battleService.attack({
          attacker: combatant.ref,
          defender: action.target.ref,
          defenderIsDefending: !!action.target.isDefending,
          encounterManaged: true  // V6: encounter system owns HP tracking
        });
        // Apply damage and state changes
        if (attackResult?.damage) {
          this.applyDamage(encounter, action.target.avatarId, attackResult.damage);
          this.markHostile(encounter);
        }
        // Enrich result with correct HP from encounter tracking
        const targetCombatant = this.getCombatant(encounter, action.target.avatarId);
        if (targetCombatant) {
          attackResult.currentHp = targetCombatant.currentHp;
          attackResult.maxHp = targetCombatant.maxHp;
        }
        return attackResult;
      
      case 'defend':
        combatant.isDefending = true;
        return { result: 'defending' };
      
      default:
        return null;
    }
  }

  /**
   * Generate combat dialogue using AI (short one-liner)
   */
  async _generateCombatDialogue(combatant, action, result) {
    // Always generate dialogue - use fallbacks if AI unavailable
    if (!this.unifiedAIService?.chat) {
      this.logger?.info?.('[CombatEncounter] AI service unavailable, using fallback dialogue');
      return this._getFallbackDialogue(combatant, action, result);
    }
    
    try {
      // Use the avatar's actual model and persona for authentic dialogue
      const avatar = combatant.ref;
      // Use avatar's assigned model, fall back to a fast model for combat banter
      const model = avatar?.model || 'google/gemini-2.0-flash-001';
      const personality = avatar?.personality || 'bold warrior';
      const description = avatar?.description || '';
      const emoji = avatar?.emoji || '';
      const name = combatant.name;
      
      // Build a compact but character-rich system prompt
      // Use avatar.prompt if available (full persona), otherwise build a minimal one
      let systemContent;
      if (avatar?.prompt) {
        // Use the avatar's full system prompt but add combat-specific instructions
        systemContent = `${avatar.prompt}\n\nCOMBAT MODE: Generate a SHORT one-liner (max 15 words) for this combat action. Stay in character. Return ONLY the dialogue, no quotes or narration.`;
      } else {
        systemContent = `You are ${emoji ? emoji + ' ' : ''}${name}. ${description ? `Character: ${description}. ` : ''}Personality: ${personality}. Generate a SHORT one-liner (max 15 words) for this combat action. Stay in character. Return ONLY the dialogue, no quotes or narration.`;
      }
      
      const prompt = `Generate a SHORT combat one-liner (max 15 words) for ${name}.
Action: ${action.type}${action.target ? ` against ${action.target.name}` : ''}
Result: ${result?.result || 'defending'}
${result?.damage ? `Damage: ${result.damage}` : ''}
${result?.critical ? 'CRITICAL HIT!' : ''}

One-liner (no quotes):`;
      
      const messages = [
        { role: 'system', content: systemContent },
        { role: 'user', content: prompt }
      ];
      
      const response = await this.unifiedAIService.chat(messages, {
        model,
        temperature: 0.9
      });
      
      const dialogue = (response?.text || '').trim().replace(/^["']|["']$/g, ''); // Remove surrounding quotes if any
      if (dialogue) {
        this.logger?.info?.(`[CombatEncounter] AI generated dialogue for ${combatant.name} using ${model}: "${dialogue}"`);
        return dialogue;
      } else {
        this.logger?.info?.(`[CombatEncounter] AI returned empty dialogue, using fallback`);
        return this._getFallbackDialogue(combatant, action, result);
      }
    } catch (e) {
      this.logger?.warn?.(`[CombatEncounter] Dialogue generation failed: ${e.message}, using fallback`);
      return this._getFallbackDialogue(combatant, action, result);
    }
  }

  /**
   * Get fallback dialogue when AI is unavailable
   * @private
   */
  _getFallbackDialogue(combatant, action, result) {
    const attackPhrases = [
      "Take this!",
      "Here's my answer!",
      "Feel my wrath!",
      "You won't escape me!",
      "This ends now!",
      "My blade finds its mark!",
      "Victory will be mine!",
      "Prepare yourself!"
    ];
    
    const criticalPhrases = [
      "A perfect strike!",
      "Witness my true power!",
      "This is my moment!",
      "Incredible!",
      "Did you see that?!"
    ];
    
    const knockoutPhrases = [
      "It's over!",
      "Rest now.",
      "You fought well.",
      "The battle is won!",
      "Victory is mine!"
    ];
    
    const missPhrases = [
      "Curses!",
      "Not this time...",
      "I'll get you next time!",
      "Missed!",
      "Drat!"
    ];
    
    const defendPhrases = [
      "Come at me!",
      "I'm ready for you.",
      "Try to break through this!",
      "Defense is key.",
      "I won't fall so easily!"
    ];
    
    let dialogue = "Let's do this!";
    
    if (action.type === 'defend') {
      dialogue = defendPhrases[Math.floor(Math.random() * defendPhrases.length)];
    } else if (action.type === 'attack' && result) {
      if (result.result === 'knockout') {
        dialogue = knockoutPhrases[Math.floor(Math.random() * knockoutPhrases.length)];
      } else if (result.critical) {
        dialogue = criticalPhrases[Math.floor(Math.random() * criticalPhrases.length)];
      } else if (result.result === 'miss') {
        dialogue = missPhrases[Math.floor(Math.random() * missPhrases.length)];
      } else if (result.result === 'hit') {
        dialogue = attackPhrases[Math.floor(Math.random() * attackPhrases.length)];
      }
    }
    
    this.logger?.info?.(`[CombatEncounter] Fallback dialogue for ${combatant.name}: "${dialogue}"`);
    return dialogue;
  }

  /**
   * Post pre-combat dialogue from each combatant
   * Called after initiative is rolled but before first turn
   * @private
   */
  async _postPreCombatDialogue(encounter) {
    try {
      if (!this.unifiedAIService?.chat) {
        this.logger?.info?.('[CombatEncounter] AI service unavailable for pre-combat dialogue');
        return;
      }

      const channel = this._getChannel(encounter);
      if (!channel) {
        this.logger?.warn?.('[CombatEncounter] No channel for pre-combat dialogue');
        return;
      }

      // Let each combatant speak in initiative order (max 4 to avoid spam)
      const speakers = encounter.combatants.slice(0, 4);
      
      for (const combatant of speakers) {
        try {
          // Use the avatar's actual model and persona for authentic dialogue
          const avatar = combatant.ref;
          // Use avatar's assigned model, fall back to a fast model for combat banter
          const model = avatar?.model || 'google/gemini-2.0-flash-001';
          const personality = avatar?.personality || 'bold warrior';
          const description = avatar?.description || '';
          const emoji = avatar?.emoji || '';
          const name = combatant.name;
          
          // Generate pre-combat taunt/challenge
          const opponents = encounter.combatants
            .filter(c => c.avatarId !== combatant.avatarId)
            .map(c => c.name)
            .join(', ');

          // Build system prompt - use full avatar.prompt if available
          let systemContent;
          if (avatar?.prompt) {
            systemContent = `${avatar.prompt}\n\nCOMBAT MODE: Generate a SHORT pre-combat taunt or challenge (max 20 words). Be bold and in-character. Return ONLY the dialogue, no quotes.`;
          } else {
            systemContent = `You are ${emoji ? emoji + ' ' : ''}${name}. ${description ? `Character: ${description}. ` : ''}Personality: ${personality}. Generate a SHORT pre-combat taunt or challenge (max 20 words). Be bold and in-character. Return ONLY the dialogue, no quotes.`;
          }

          const messages = [
            { 
              role: 'system', 
              content: systemContent
            },
            { 
              role: 'user', 
              content: `You're about to fight ${opponents}. Say something intimidating, confident, or challenging before combat begins.` 
            }
          ];

          const response = await this.unifiedAIService.chat(messages, {
            model,
            temperature: 0.95
          });

          const dialogue = (response?.text || '').trim().replace(/^["']|["']$/g, '');
          
          if (dialogue) {
            this.logger?.info?.(`[CombatEncounter] Pre-combat dialogue for ${combatant.name} using ${model}: "${dialogue}"`);
            await this._postAsWebhook(encounter, combatant.ref, dialogue);
            
            // Small delay between speakers for pacing
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
        } catch (e) {
          this.logger?.warn?.(`[CombatEncounter] Failed to generate pre-combat dialogue for ${combatant.name}: ${e.message}`);
        }
      }
    } catch (e) {
      this.logger?.error?.(`[CombatEncounter] Pre-combat dialogue error: ${e.message}`);
    }
  }

  /**
   * Post victory dialogue from the winner
   * Called after combat summary is posted
   * @private
   */
  async _postVictoryDialogue(encounter, winner) {
    try {
      if (!this.unifiedAIService?.chat) {
        this.logger?.info?.('[CombatEncounter] AI service unavailable for victory dialogue');
        return;
      }

      const channel = this._getChannel(encounter);
      if (!channel) {
        this.logger?.warn?.('[CombatEncounter] No channel for victory dialogue');
        return;
      }

      // Use the avatar's actual model and persona for authentic dialogue
      const avatar = winner;
      // Use avatar's assigned model, fall back to a fast model for combat banter
      const model = avatar?.model || 'google/gemini-2.0-flash-001';
      const personality = avatar?.personality || 'bold warrior';
      const description = avatar?.description || '';
      const emoji = avatar?.emoji || '';
      const name = winner.name;

      // Get opponents' names
      const opponents = encounter.combatants
        .filter(c => c.avatarId !== winner.avatarId)
        .map(c => c.name)
        .join(', ');

      // Build system prompt - use full avatar.prompt if available
      let systemContent;
      if (avatar?.prompt) {
        systemContent = `${avatar.prompt}\n\nCOMBAT MODE: You are the victor of this battle. Generate a SHORT victory speech or taunt (max 25 words). Be triumphant and in-character. Return ONLY the dialogue, no quotes.`;
      } else {
        systemContent = `You are ${emoji ? emoji + ' ' : ''}${name}, the victor of this battle. ${description ? `Character: ${description}. ` : ''}Personality: ${personality}. Generate a SHORT victory speech or taunt (max 25 words). Be triumphant and in-character. Return ONLY the dialogue, no quotes.`;
      }

      const messages = [
        { 
          role: 'system', 
          content: systemContent
        },
        { 
          role: 'user', 
          content: `You just defeated ${opponents} in combat. Your current HP: ${winner.currentHp}/${winner.maxHp}. Say something victorious, confident, or gracious in victory.` 
        }
      ];

      const response = await this.unifiedAIService.chat(messages, {
        model,
        temperature: 0.95
      });

      const dialogue = (response?.text || '').trim().replace(/^["']|["']$/g, '');
      
      if (dialogue) {
        this.logger?.info?.(`[CombatEncounter] Victory dialogue for ${winner.name} using ${model}: "${dialogue}"`);
        await this._postAsWebhook(encounter, winner.ref, dialogue);
      }
    } catch (e) {
      this.logger?.error?.(`[CombatEncounter] Victory dialogue error: ${e.message}`);
    }
  }

  /**
   * Post between-round dialogue from 1-2 combatants
   * Adds flavor and immersion during combat (but not every round to reduce spam)
   * @private
   * @param {Object} encounter - Combat encounter
   * @param {number} completedRound - The round that just ended
   * @param {Array} roundActions - Actions that occurred this round
   */
  async _postBetweenRoundDialogue(encounter, completedRound, roundActions = []) {
    try {
      // Only trigger dialogue ~25% of the time to reduce spam
      // Always speak on round 1 (dramatic entrance) and every 4th round
      const isSignificantRound = completedRound === 1 || completedRound % 4 === 0;
      if (!isSignificantRound && Math.random() > 0.25) {
        return;
      }
      
      if (!this.unifiedAIService?.chat) {
        return;
      }

      const channel = this._getChannel(encounter);
      if (!channel) return;

      // Get alive combatants who haven't spoken this round
      const aliveCombatants = encounter.combatants.filter(c => 
        (c.currentHp || 0) > 0 && 
        !encounter.chatter?.spokenThisRound?.has(c.avatarId)
      );

      if (aliveCombatants.length === 0) return;

      // Pick 1-2 random speakers (weighted toward those who took damage or dealt damage this round)
      const involvedIds = new Set();
      for (const action of roundActions) {
        if (action.combatant?.avatarId) involvedIds.add(action.combatant.avatarId);
        if (action.action?.target?.avatarId) involvedIds.add(action.action.target.avatarId);
      }

      // Prioritize involved combatants, then random
      const prioritized = aliveCombatants.filter(c => involvedIds.has(c.avatarId));
      const others = aliveCombatants.filter(c => !involvedIds.has(c.avatarId));
      const pool = [...prioritized, ...others];

      // Pick only 1 speaker to reduce spam (was 1-2)
      const speakerCount = 1;
      const shuffled = pool.sort(() => Math.random() - 0.5);
      const speakers = shuffled.slice(0, speakerCount);

      // Build battle context summary
      const partyHp = encounter.combatants
        .filter(c => !c.isMonster && (c.currentHp || 0) > 0)
        .map(c => `${c.name}: ${c.currentHp}/${c.maxHp} HP`)
        .join(', ');
      const enemyHp = encounter.combatants
        .filter(c => c.isMonster && (c.currentHp || 0) > 0)
        .map(c => `${c.name}: ${c.currentHp}/${c.maxHp} HP`)
        .join(', ');
      const roundSummary = roundActions.slice(0, 5).map(a => {
        const actor = a.combatant?.name || 'Someone';
        const target = a.targetName || a.action?.target?.name || 'someone';
        const damage = a.result?.damage || 0;
        return damage > 0 ? `${actor} hit ${target} for ${damage}` : `${actor} attacked ${target}`;
      }).join('; ');

      for (const speaker of speakers) {
        try {
          const avatar = speaker.ref;
          const model = avatar?.model || 'google/gemini-2.0-flash-001';
          const personality = avatar?.personality || 'bold warrior';
          const description = avatar?.description || '';
          const emoji = avatar?.emoji || '';
          const name = speaker.name;
          const hpPercent = Math.round((speaker.currentHp / speaker.maxHp) * 100);

          // Context based on situation
          let situation = 'The battle rages on.';
          if (hpPercent < 25) {
            situation = 'You are badly wounded!';
          } else if (hpPercent < 50) {
            situation = 'You are taking a beating but still fighting.';
          } else if (hpPercent > 90) {
            situation = 'You are fresh and ready for more.';
          }

          // Build system prompt
          let systemContent;
          if (avatar?.prompt) {
            systemContent = `${avatar.prompt}\n\nCOMBAT MODE: Generate a SHORT battle cry, taunt, or comment (max 15 words). Be fierce and in-character. Return ONLY the dialogue, no quotes.`;
          } else {
            systemContent = `You are ${emoji ? emoji + ' ' : ''}${name}. ${description ? `Character: ${description}. ` : ''}Personality: ${personality}. Generate a SHORT battle cry, taunt, or comment (max 15 words). Be fierce and in-character. Return ONLY the dialogue, no quotes.`;
          }

          const messages = [
            { role: 'system', content: systemContent },
            { 
              role: 'user', 
              content: `Round ${completedRound} just ended. ${situation}\n\nBattle status:\n- Party: ${partyHp || 'Unknown'}\n- Enemies: ${enemyHp || 'Unknown'}\n- Recent: ${roundSummary || 'Fighting continues'}\n\nSay something appropriate to the moment - a battle cry, taunt, encouragement, or reaction.` 
            }
          ];

          const response = await this.unifiedAIService.chat(messages, {
            model,
            temperature: 0.95
          });

          const dialogue = (response?.text || '').trim().replace(/^["']|["']$/g, '');
          
          if (dialogue && dialogue.length > 2) {
            this.logger?.info?.(`[CombatEncounter] Between-round dialogue for ${speaker.name}: "${dialogue}"`);
            await this._postAsWebhook(encounter, speaker.ref, dialogue);
            
            // Track that this combatant spoke
            if (encounter.chatter) {
              encounter.chatter.spokenThisRound.add(speaker.avatarId);
              encounter.chatter.lastSpeakerId = speaker.avatarId;
            }
            
            // Small delay between speakers
            if (speakers.indexOf(speaker) < speakers.length - 1) {
              await new Promise(r => setTimeout(r, 1000));
            }
          }
        } catch (e) {
          this.logger?.warn?.(`[CombatEncounter] Between-round dialogue failed for ${speaker.name}: ${e.message}`);
        }
      }
    } catch (e) {
      this.logger?.warn?.(`[CombatEncounter] Between-round dialogue error: ${e.message}`);
    }
  }

  /**
   * Post combat action to Discord
   */
  async _postCombatAction(encounter, combatant, action, result, dialogue) {
    try {
      const channel = this._getChannel(encounter);
      if (!channel) {
        this.logger?.warn?.('[CombatEncounter] No channel found for posting action');
        return;
      }
      
      // Post action as main bot (cosychat) with subtle formatting
      let actionMessage = `-# [**${combatant.name}**`;
      
      if (action.type === 'attack' && result) {
        const isSuccess = ['hit', 'knockout', 'dead'].includes(result.result);
        actionMessage += ` ${isSuccess ? 'strikes' : 'attacks'} **${action.target.name}**`;
        if (result.damage) actionMessage += ` for **${result.damage} damage**`;
        if (result.critical) actionMessage += ` 🎯 **CRITICAL HIT**`;
        if (result.result === 'knockout') actionMessage += ` 💀 **KNOCKOUT**`;
        if (result.result === 'dead') actionMessage += ` ☠️ **DEATH**`;
        // Add roll vs AC stats
        if (result.attackRoll !== undefined && result.armorClass !== undefined) {
          actionMessage += ` (${isSuccess ? 'HIT' : 'MISS'}: ${result.attackRoll} vs AC ${result.armorClass})]`;
        } else {
          actionMessage += ` (${isSuccess ? 'HIT' : 'MISS'})]`;
        }
      } else if (action.type === 'defend') {
        actionMessage += ' takes a defensive stance 🛡️]';
      }
      
      // Post action as main bot
      this.logger?.info?.(`[CombatEncounter] Posting action: ${actionMessage}`);
      await channel.send({ content: actionMessage });
      
      // Then post dialogue as the avatar (if any)
      if (dialogue) {
        this.logger?.info?.(`[CombatEncounter] Posting dialogue for ${combatant.name}: "${dialogue}"`);
        await this._postAvatarDialogue(encounter, combatant, dialogue);
      } else {
        this.logger?.warn?.(`[CombatEncounter] No dialogue to post for ${combatant.name}`);
      }
    } catch (e) {
      this.logger?.warn?.(`[CombatEncounter] Failed to post action: ${e.message}`);
    }
  }

  /**
   * Post avatar dialogue as a webhook message
   * @param {object} encounter - Combat encounter
   * @param {object} combatant - Combatant who is speaking
   * @param {string} dialogue - What they say
   */
  async _postAvatarDialogue(encounter, combatant, dialogue) {
    try {
      if (!dialogue) {
        this.logger?.debug?.('[CombatEncounter] No dialogue to post');
        return;
      }
      
      const channel = this._getChannel(encounter);
      if (!channel) {
        this.logger?.warn?.('[CombatEncounter] No channel found for dialogue');
        return;
      }
      
      this.logger?.debug?.(`[CombatEncounter] Posting dialogue for ${combatant.name}: "${dialogue}"`);
      await this._postAsWebhook(encounter, combatant.ref, dialogue);
    } catch (e) {
      this.logger?.warn?.(`[CombatEncounter] Failed to post dialogue: ${e.message}`);
    }
  }

  _scheduleTurnTimeout(encounter) {
    // clear previous timer
  if (encounter.timers.turn) clearTimeout(encounter.timers.turn);
    encounter.timers.turn = setTimeout(() => this._onTurnTimeout(encounter), this.turnTimeoutMs);
    try { encounter.lastTimerArmedAt = Date.now(); } catch {}
  }

  /** Schedule start of turn with pacing and optional commentary */
  /**
   * Start the current turn
   * For player-controlled avatars: waits for button input
   * For AI/monsters: triggers AI agent to act immediately
   * 
   * V3 FIX: Uses TurnLock to prevent race conditions
   */
  _scheduleTurnStart(encounter, { isReannounce = false } = {}) {
    if (!encounter || encounter.state !== 'active') return;
    
    const channelId = encounter.channelId;
    
    // V3 FIX: Acquire turn lock before proceeding
    if (this.turnLock.isLocked(channelId)) {
      this.logger?.debug?.(`[CombatEncounter] Turn blocked: lock already held for ${channelId}`);
      return;
    }
    
    // Skip turns for knocked-out combatants
    const currentId = this.getCurrentTurnAvatarId(encounter);
    const current = this.getCombatant(encounter, currentId);
    
    if (this._isKnockedOut(current)) {
      // Log why the combatant was considered KO'd for debugging
      const koReason = (current?.currentHp || 0) <= 0 ? 'HP=0'
        : current?.conditions?.includes('unconscious') ? 'unconscious'
        : current?.ref?.status === 'dead' ? 'status=dead'
        : current?.ref?.status === 'knocked_out' ? `stale ref.status=knocked_out (knockedOutUntil=${current.ref?.knockedOutUntil ? new Date(current.ref.knockedOutUntil).toISOString() : 'unset'})`
        : 'knockedOutUntil timer';
      this.logger.info?.(`[CombatEncounter] skipping turn for KO'd combatant ${current?.name || currentId} — reason: ${koReason}`);
      if (this.evaluateEnd(encounter)) return;
      // Skip to next turn immediately
      setImmediate(() => this.nextTurn(encounter));
      return;
    }
    
    // Acquire lock for turn start
    this.turnLock.acquire(channelId, TURN_STATES.ANNOUNCING, {
      combatantId: currentId,
      combatantName: current?.name
    });
    
    // Reset defending state at the start of their new turn
    if (current) current.isDefending = false;
    encounter.lastTurnStartAt = Date.now();
    // V8: Only reset re-announce budget on genuine new turns, not watchdog re-announces.
    // The watchdog increments _reannounceCount and calls _scheduleTurnStart; if we reset
    // the counter here unconditionally, the watchdog can never reach the auto-skip threshold.
    if (!isReannounce) {
      encounter._reannounceCount = 0;
    }
    
    // Determine if this avatar should wait for player input:
    // 1. Player-controlled avatars with linked user: always wait (unless knocked out)
    // 2. Party members without linked user: wait for someone to claim them (unless all players KO'd)
    // 3. Monsters and AI-controlled avatars: auto-execute
    const isPartyMember = !current.isMonster && (current.ref?.isPlayerCharacter || current.side !== 'enemy');
    const linkedUserId = current.discordUserId || 
      (current.ref?.summoner && String(current.ref.summoner).startsWith('user:') 
        ? String(current.ref.summoner).replace(/^user:/, '') 
        : null);
    const hasLinkedUser = !!linkedUserId;
    
    // Check if this avatar's controlling user is knocked out
    encounter.defeatedPlayers = encounter.defeatedPlayers || {};
    const userIsDefeated = linkedUserId && encounter.defeatedPlayers[linkedUserId];
    
    // For claimable avatars, check if any players remain who could claim them
    const isClaimable = isPartyMember && !hasLinkedUser;
    const hasRemainingPlayers = isClaimable && encounter.combatants.some(c => {
      if (c.isMonster || this._isKnockedOut(c)) return false;
      const cUserId = c.discordUserId || 
        (c.ref?.summoner && String(c.ref.summoner).startsWith('user:') 
          ? String(c.ref.summoner).replace(/^user:/, '') 
          : null);
      return cUserId && !encounter.defeatedPlayers[cUserId];
    });
    
    // Wait for player if:
    // - Linked player is alive and avatar isn't in auto-mode
    // - OR claimable and there are players who could claim it
    const shouldWaitForPlayer = 
      ((current.isPlayerControlled && !current.autoMode) && !userIsDefeated) || 
      (isClaimable && hasRemainingPlayers);
    
    // Check if this is a player-controlled avatar awaiting manual input
    if (shouldWaitForPlayer) {
      // NO turn timeout for human players - wait indefinitely for their action
      // This gives humans unlimited time to think and act
      if (encounter.timers?.turn) {
        clearTimeout(encounter.timers.turn);
        encounter.timers.turn = null;
      }
      
      // Transition to awaiting input state
      this.turnLock.transition(channelId, TURN_STATES.AWAITING_INPUT, {
        combatantId: currentId,
        combatantName: current?.name
      });
      
      // Announce turn with action buttons and WAIT for player input
      current.awaitingAction = true;
      this.logger?.info?.(`[CombatEncounter][${encounter.channelId}] ${current?.name}'s turn - awaiting player input (no timeout)`);
      this._announceTurn(encounter, current).catch(e => {
        this.logger?.error?.(`[CombatEncounter] Turn announcement failed: ${e.message}`);
        this.turnLock.release(channelId, 'announcement_failed');
      });
      return; // Don't auto-execute - wait for button click
    }
    
    // Transition to executing state for AI/monster
    this.turnLock.transition(channelId, TURN_STATES.EXECUTING, {
      combatantId: currentId,
      combatantName: current?.name
    });
    
    // Clear turn timeout for AI/monsters - they act instantly, no fallback needed
    if (encounter.timers?.turn) {
      clearTimeout(encounter.timers.turn);
      encounter.timers.turn = null;
    }
    
    // BATCH MONSTER TURNS: Execute all consecutive monster turns at once with single DM narration
    // This speeds up combat by not generating individual dialogue for each monster
    this.logger?.info?.(`[CombatEncounter][${encounter.channelId}] ${current?.name}'s turn - checking for batch execution`);
    this._executeBatchedMonsterTurns(encounter)
      .then(() => {
        this.turnLock.release(channelId, 'batch_complete');
      })
      .catch(e => {
        this.logger?.error?.(`[CombatEncounter] Batch execution failed: ${e.message}`);
        this.turnLock.release(channelId, 'batch_error');
        this.nextTurn(encounter); // Fallback: advance turn on error
      });
  }

  /**
   * Execute all consecutive monster/AI turns in a batch with single DM narration
   * This significantly speeds up combat by avoiding individual dialogue generation
   * @private
   */
  async _executeBatchedMonsterTurns(encounter) {
    let roundActions = []; // Actions for current round
    let continueLoop = true;
    let lastRound = encounter.round || 1;
    
    while (continueLoop && encounter.state === 'active') {
      const currentId = this.getCurrentTurnAvatarId(encounter);
      const current = this.getCombatant(encounter, currentId);
      
      // Determine if this avatar should wait for player input (same logic as _scheduleTurnStart)
      const isPartyMember = current && !current.isMonster && (current.ref?.isPlayerCharacter || current.side !== 'enemy');
      const linkedUserId = current?.discordUserId || 
        (current?.ref?.summoner && String(current.ref.summoner).startsWith('user:') 
          ? String(current.ref.summoner).replace(/^user:/, '') 
          : null);
      const hasLinkedUser = !!linkedUserId;
      
      // Check if this avatar's controlling user is knocked out
      encounter.defeatedPlayers = encounter.defeatedPlayers || {};
      const userIsDefeated = linkedUserId && encounter.defeatedPlayers[linkedUserId];
      
      // For claimable avatars, check if any players remain who could claim them
      const isClaimable = isPartyMember && !hasLinkedUser;
      const hasRemainingPlayers = isClaimable && encounter.combatants.some(c => {
        if (c.isMonster || this._isKnockedOut(c)) return false;
        const cUserId = c.discordUserId || 
          (c.ref?.summoner && String(c.ref.summoner).startsWith('user:') 
            ? String(c.ref.summoner).replace(/^user:/, '') 
            : null);
        return cUserId && !encounter.defeatedPlayers[cUserId];
      });
      
      const shouldWaitForPlayer = 
        ((current?.isPlayerControlled && !current?.autoMode) && !userIsDefeated) || 
        (isClaimable && hasRemainingPlayers);
      
      // Stop if we hit a player-controlled avatar, claimable avatar, or invalid state
      if (!current || shouldWaitForPlayer) {
        continueLoop = false;
        break;
      }
      
      // Skip knocked out combatants
      if (this._isKnockedOut(current)) {
        this.logger?.debug?.(`[CombatEncounter] Batch: skipping KO'd ${current.name}`);
        if (this.evaluateEnd(encounter)) {
          // Post final narration before ending
          if (roundActions.length > 0) {
            await this._postBatchedMonsterNarration(encounter, roundActions, lastRound);
          }
          return;
        }
        this._advanceTurnIndex(encounter);
        continue;
      }
      
      // Process status effects
      const statusResult = this.statusEffectService.processTurnStart(current, encounter.round);
      if (statusResult.skipTurn) {
        this.logger?.debug?.(`[CombatEncounter] Batch: ${current.name} turn skipped by status`);
        this._advanceTurnIndex(encounter);
        continue;
      }
      
      if (current.currentHp <= 0) {
        if (this.evaluateEnd(encounter)) {
          if (roundActions.length > 0) {
            await this._postBatchedMonsterNarration(encounter, roundActions, lastRound);
          }
          return;
        }
        this._advanceTurnIndex(encounter);
        continue;
      }
      
      // Select and execute action
      const action = await this.combatAIService.selectCombatAction(encounter, current);
      if (!action) {
        this.logger?.warn?.(`[CombatEncounter] Batch: no action for ${current.name}`);
        if (this.evaluateEnd(encounter)) {
          if ((encounter.pendingRoundActions?.length || 0) > 0) {
            await this._postConsolidatedRoundNarration(encounter);
          }
          return;
        }
        this._advanceTurnIndex(encounter);
        continue;
      }
      
      const result = await this._executeCombatAction(action, current, encounter);
      
      // Collect action for round narration
      roundActions.push({
        combatant: current,
        action,
        result,
        targetName: action.target?.name
      });
      
      // Also add to encounter's round accumulator for consolidated narration
      encounter.pendingRoundActions = encounter.pendingRoundActions || [];
      encounter.pendingRoundActions.push({
        combatant: current,
        action,
        result,
        targetName: action.target?.name,
        round: encounter.round
      });
      
      // Log to database
      if (this.combatLogService) {
        this.combatLogService.logAction({ encounter, combatant: current, action, result }).catch(() => {});
      }
      
      // Capture for video
      if (action.type === 'attack' && action.target && result) {
        this._captureBattleMoment(encounter, {
          attacker: current,
          defender: action.target,
          result
        });
      }
      
      // Check end conditions after each action
      if (this.evaluateEnd(encounter)) {
        // Post consolidated round narration before ending
        if ((encounter.pendingRoundActions?.length || 0) > 0) {
          await this._postConsolidatedRoundNarration(encounter);
        }
        return;
      }
      
      // Advance to next turn index (without full nextTurn processing)
      const newRound = this._advanceTurnIndex(encounter);
      
      // V7: Consolidate multi-round auto-combat narration. Post every 3 rounds
      // (or at the end of the batch) to reduce message spam.
      if (newRound) {
        const roundsSinceNarration = encounter.round - lastRound;
        const nextId2 = this.getCurrentTurnAvatarId(encounter);
        const next2 = this.getCombatant(encounter, nextId2);
        const batchWillEnd = !next2 || (next2.isPlayerControlled && !next2.autoMode);
        
        if (roundsSinceNarration >= 3 || batchWillEnd) {
          // Post combined narration covering multiple rounds
          await this._postConsolidatedRoundNarration(encounter);
          
          // Between-round dialogue only at the very end of a batch (not mid-auto-combat)
          if (batchWillEnd) {
            await this._postBetweenRoundDialogue(encounter, lastRound, encounter.pendingRoundActions || []);
          }
          
          // Clear accumulator for next batch of rounds
          encounter.pendingRoundActions = [];
          encounter.lastNarratedRound = encounter.round - 1;
          lastRound = encounter.round;
        }
        
        // Pacing delay between rounds (shorter for auto-combat)
        await new Promise(r => setTimeout(r, 1500));
      }
      
      // Check if next combatant is player-controlled
      const nextId = this.getCurrentTurnAvatarId(encounter);
      const next = this.getCombatant(encounter, nextId);
      if (next && next.isPlayerControlled && !next.autoMode) {
        continueLoop = false;
      }
    }
    
    // DON'T post partial round narration here - wait for round to complete
    // This prevents duplicate "Party Actions" / "Enemy Actions" messages
    
    // Release lock before starting next turn
    this.turnLock.release(encounter.channelId, 'batch_complete_before_player');
    
    // Check who's next
    const nextId = this.getCurrentTurnAvatarId(encounter);
    const nextCombatant = this.getCombatant(encounter, nextId);
    this.logger?.info?.(`[CombatEncounter][${encounter.channelId}] Batch complete: next up is ${nextCombatant?.name || 'unknown'} (isPlayerControlled=${nextCombatant?.isPlayerControlled}, autoMode=${nextCombatant?.autoMode})`);
    
    // Now start the next turn (which should be a player turn or end of round)
    if (encounter.state === 'active') {
      this._scheduleTurnStart(encounter);
      this._persistActiveEncounter(encounter).catch(e => this.logger.warn?.(`[CombatEncounter] active persist failed: ${e.message}`));
    }
  }

  /**
   * Post consolidated narration for all actions in the current round
   * Combines monster and party actions into a single message
   * @private
   */
  async _postConsolidatedRoundNarration(encounter) {
    const actions = encounter.pendingRoundActions || [];
    if (actions.length === 0) return;
    
    const round = actions[0]?.round || encounter.round || 1;
    
    // Avoid double-posting for the same round
    if (encounter.lastNarratedRound >= round) {
      this.logger?.debug?.(`[CombatEncounter] Skipping narration for round ${round} - already narrated`);
      return;
    }
    
    await this._postBatchedMonsterNarration(encounter, actions, round);
    encounter.lastNarratedRound = round;
  }

  /**
   * Advance turn index without full nextTurn processing
   * Used during batched monster turns
   * @private
   * @returns {boolean} True if a new round started
   */
  _advanceTurnIndex(encounter) {
    const order = Array.isArray(encounter.initiativeOrder) ? encounter.initiativeOrder : [];
    if (order.length === 0) return false;
    
    const prevIdx = encounter.currentTurnIndex || 0;
    const nextIdx = (prevIdx + 1) % order.length;
    
    let newRound = false;
    if (nextIdx === 0) {
      // New round
      newRound = true;
      encounter.round = (encounter.round || 1) + 1;
      this.logger?.info?.(`[CombatEncounter][${encounter.channelId}] Batch: advancing to round ${encounter.round}`);
      
      eventBus.emit('combat.round.advanced', {
        channelId: encounter.channelId,
        round: encounter.round
      });
      
      // Reset chatter for new round
      if (encounter.chatter) {
        encounter.chatter.spokenThisRound = new Set();
        encounter.chatter.lastSpeakerId = null;
      }
    }
    
    encounter.currentTurnIndex = nextIdx;
    return newRound;
  }

  /**
   * Post a single DM narration summarizing all batched actions for a round
   * @private
   * @param {Object} encounter - The combat encounter
   * @param {Array} actions - Array of action objects
   * @param {number} round - The round number these actions occurred in
   */
  async _postBatchedMonsterNarration(encounter, actions, round = null) {
    const channel = this._getChannel(encounter);
    if (!channel) return;
    
    try {
      // Compact fallback summary (single sentence unless critical/KO/death)
      const hasCriticalOrKnockout = actions.some(a => !!a?.result?.critical || a?.result?.result === 'knockout' || a?.result?.result === 'dead');
      const totalDamage = actions.reduce((sum, a) => sum + (a.result?.damage || 0), 0);
      const hitCount = actions.filter(a => a.action?.type === 'attack' && ['hit', 'knockout', 'dead'].includes(a.result?.result)).length;
      const missCount = actions.filter(a => a.action?.type === 'attack' && (a.result?.result === 'miss' || a.result?.hit === false)).length;
      const knockoutCount = actions.filter(a => a?.result?.result === 'knockout').length;
      const deathCount = actions.filter(a => a?.result?.result === 'dead').length;
      const fallbackNarration = !hasCriticalOrKnockout
        ? `*Enemies surge in and strike one by one—${hitCount} hit for ${totalDamage} total damage as ${missCount} miss wide.*`
        : `*Enemies surge in and strike one by one—${hitCount} hit for ${totalDamage} total damage as ${missCount} miss wide.* ${deathCount ? 'A killing blow lands.' : knockoutCount ? 'Someone drops, knocked out.' : 'A critical strike punctuates the flurry.'}`;
      
      // Generate DM narration via AI if available
      let dmNarration = null;
      if (this.dmNarratorService && actions.length > 0) {
        try {
          dmNarration = await this.dmNarratorService.narrateBatchedActions?.({
            actions,
            encounter
          });
        } catch (e) {
          this.logger?.debug?.(`[CombatEncounter] Batched DM narration failed: ${e.message}`);
        }
      }
      
      // V7: Support multi-round summaries from auto-combat batching
      let title = '⚔️ Combat Actions';
      if (round) {
        const actionRounds = [...new Set((actions || []).map(a => a.round).filter(Boolean))];
        if (actionRounds.length > 1) {
          title = `⚔️ Rounds ${Math.min(...actionRounds)}–${Math.max(...actionRounds)} Summary`;
        } else {
          title = `⚔️ Round ${round} Summary`;
        }
      }
      
      // Color based on who dealt more damage
      const monsterDamage = actions.filter(a => a.combatant.isMonster).reduce((s, a) => s + (a.result?.damage || 0), 0);
      const partyDamage = actions.filter(a => !a.combatant.isMonster).reduce((s, a) => s + (a.result?.damage || 0), 0);
      const color = monsterDamage > partyDamage ? 0x8B0000 : 0x3B82F6; // Red if monsters won, blue if party
      
      // Build embed for round actions
      const embed = {
        author: { name: '🎲 The Dungeon Master' },
        title,
        description: dmNarration || fallbackNarration,
        color,
        footer: { text: `${actions.length} action${actions.length > 1 ? 's' : ''} this round` }
      };
      
      // Add damage summary field
      // Reuse computed totalDamage
      if (totalDamage > 0) {
        embed.fields = [
          { name: '💥 Total Damage Dealt', value: `${totalDamage} HP`, inline: true }
        ];
      }
      
      await channel.send({ embeds: [embed] });
      this.logger?.info?.(`[CombatEncounter] Posted batched narration for ${actions.length} monster actions`);
      
    } catch (e) {
      this.logger?.warn?.(`[CombatEncounter] Failed to post batched narration: ${e.message}`);
      
      // Fallback: post simple text summary
      try {
        const simple = actions.map(a => 
          `**${a.combatant.name}** ${a.action.type === 'attack' ? 'attacks' : 'defends'}`
        ).join(' | ');
        await channel.send({ content: `-# ${simple}` });
      } catch {
        // Ignore fallback failure
      }
    }
  }
  markHostile(encounter) {
    encounter.lastHostileAt = Date.now();
  }

  /**
   * Post DM narration embed for a player action (same format as AI turns)
   * This provides consistent narrative presentation for both player and AI actions.
   * 
   * @param {Object} encounter - The active combat encounter
   * @param {Object} combatant - The player combatant who acted
   * @param {Object} actionResult - Result from the action containing:
   *   - actionType: 'attack' | 'defend'
   *   - result: Full battle result object
   *   - target: Target combatant
   *   - attacker: Attacker avatar reference
   */
  async _postPlayerActionNarration(encounter, combatant, actionResult = {}) {
    // Skip if no messaging service or missing action info
    if (!this.combatMessagingService) {
      this.logger?.warn?.(`[CombatEncounter] _postPlayerActionNarration skipped: no combatMessagingService`);
      return;
    }
    if (!actionResult.actionType) {
      this.logger?.warn?.(`[CombatEncounter] _postPlayerActionNarration skipped: no actionType in result`, { actionResult });
      return;
    }
    
    try {
      // Build action object in same format as AI turns
      const action = {
        type: actionResult.actionType,
        target: actionResult.target || null
      };
      
      // Get the result object (from battleService)
      const result = actionResult.result || {
        result: actionResult.damage ? 'hit' : 'miss',
        damage: actionResult.damage || 0,
        currentHp: actionResult.target?.currentHp,
        maxHp: actionResult.target?.maxHp,
        attackRoll: actionResult.attackRoll,
        armorClass: actionResult.armorClass,
        critical: actionResult.critical
      };
      
      // Enrich result with target HP for proper display
      if (actionResult.target) {
        const targetCombatant = this.getCombatant(encounter, actionResult.targetId || actionResult.target._id);
        if (targetCombatant) {
          result.currentHp = targetCombatant.currentHp;
          result.maxHp = targetCombatant.maxHp;
        }
      }
      
      // Generate DM narration (third-person cinematic description)
      let dmNarration = null;
      if (this.dmNarratorService && action.type === 'attack' && action.target && result) {
        try {
          dmNarration = await this.dmNarratorService.narrateAction({
            action,
            attacker: combatant.ref || actionResult.attacker,
            defender: action.target.ref || action.target,
            result,
            encounter
          });
        } catch (e) {
          this.logger?.debug?.(`[CombatEncounter] Player action DM narration failed: ${e.message}`);
        }
      }
      
      // For defend action, no AI narration needed - just post the embed
      // Post to Discord via CombatMessagingService (same as AI turns)
      await this.combatMessagingService.postCombatAction(
        encounter,
        combatant,
        action,
        result,
        null, // No dialogue for player actions (player types their own)
        dmNarration
      );
      
      this.logger?.info?.(`[CombatEncounter] Posted DM narration for ${combatant.name}'s ${action.type}`);
      
    } catch (e) {
      this.logger?.warn?.(`[CombatEncounter] Failed to post player action narration: ${e.message}`);
      // Non-fatal - action still completes
    }
  }

  /**
   * Complete a player-initiated action and advance to the next turn
   * Call this from tools (AttackTool, DefendTool, etc.) after a player action completes
   * 
   * V3 FIX: Uses TurnLock to manage state transitions
   * V4 FIX: Posts DM narration as embed for player actions (same as AI turns)
   * 
   * @param {string} channelId - The channel ID where combat is taking place
   * @param {string} avatarId - The avatar ID that took the action
   * @param {Object} actionResult - Result from the action including:
   *   - damage: {number} damage dealt
   *   - targetId: {string} target avatar ID
   *   - actionType: {string} 'attack' | 'defend'
   *   - result: {Object} full battle result from battleService
   *   - target: {Object} target combatant reference
   *   - attacker: {Object} attacker avatar reference
   */
  async completePlayerAction(channelId, avatarId, actionResult = {}) {
    this.logger?.info?.(`[CombatEncounter] completePlayerAction called: channelId=${channelId}, avatarId=${avatarId}, damage=${actionResult.damage}, targetId=${actionResult.targetId}`);
    try {
      // V6 FIX: Validate lock state — reject if not in a valid action state.
      // Previously this logged but continued, allowing duplicate/stale actions.
      const lockState = this.turnLock.getState(channelId);
      if (lockState !== TURN_STATES.AWAITING_INPUT && lockState !== TURN_STATES.EXECUTING) {
        this.logger?.debug?.(`[CombatEncounter] completePlayerAction: wrong lock state (${lockState}), rejecting`);
        return;
      }

      const encounter = this.getEncounterByChannelId(channelId);
      if (!encounter || encounter.state !== 'active') {
        this.logger?.debug?.('[CombatEncounter] completePlayerAction: no active encounter');
        this.turnLock.release(channelId, 'no_encounter');
        return;
      }
      
      const currentId = this.getCurrentTurnAvatarId(encounter);
      const combatant = this.getCombatant(encounter, avatarId);
      
      // Only process if it's actually this avatar's turn
      if (this._normalizeId(currentId) !== this._normalizeId(avatarId)) {
        this.logger?.debug?.(`[CombatEncounter] completePlayerAction: not ${combatant?.name}'s turn`);
        return;
      }
      
      // Check if combatant was awaiting action
      if (!combatant || !combatant.awaitingAction) {
        this.logger?.debug?.('[CombatEncounter] completePlayerAction: combatant not awaiting action');
        return;
      }
      
      // V9 FIX: Atomically clear awaitingAction FIRST, then transition.
      // This closes the race window where two near-simultaneous calls both
      // see awaitingAction=true before either clears it.
      combatant.awaitingAction = false;
      combatant.hasActed = true;
      
      // V9 FIX: Check transition return value — reject if lock state machine
      // doesn't allow COMPLETING (means another call already claimed this turn).
      const transitioned = this.turnLock.transition(channelId, TURN_STATES.COMPLETING, {
        combatantId: avatarId,
        combatantName: combatant?.name,
        reason: 'action_complete'
      });
      if (!transitioned) {
        this.logger?.warn?.(`[CombatEncounter] completePlayerAction: transition to COMPLETING rejected (duplicate action), ignoring`);
        return;
      }
      
      // V9 FIX: Player has acted — reset watchdog re-announce counter so they
      // don't get auto-skipped by a watchdog tick that fires moments later.
      encounter._reannounceCount = 0;
      if (encounter.timers?.turn) {
        clearTimeout(encounter.timers.turn);
        encounter.timers.turn = null;
      }
      
      // Apply damage if provided
      if (actionResult.damage && actionResult.targetId) {
        this.logger?.info?.(`[CombatEncounter] completePlayerAction: applying ${actionResult.damage} damage to targetId=${actionResult.targetId}`);
        this.applyDamage(encounter, actionResult.targetId, actionResult.damage);
        this.markHostile(encounter);
        
        // V3: Emit HP changed event for UI sync
        eventBus.emit('combat.hp.changed', {
          channelId: encounter.channelId,
          targetId: actionResult.targetId,
          damage: actionResult.damage,
          newHp: this.getCombatant(encounter, actionResult.targetId)?.currentHp
        });
      } else {
        this.logger?.debug?.(`[CombatEncounter] completePlayerAction: no damage to apply (damage=${actionResult.damage}, targetId=${actionResult.targetId})`);
      }

      if (actionResult.healing && actionResult.targetId) {
        const healed = this.applyHeal(encounter, actionResult.targetId, actionResult.healing);
        if (healed > 0) {
          eventBus.emit('combat.hp.changed', {
            channelId: encounter.channelId,
            targetId: actionResult.targetId,
            healing: healed,
            newHp: this.getCombatant(encounter, actionResult.targetId)?.currentHp
          });
        }
      }
      
      // V4: Post DM narration embed for player actions (same as AI turns)
      await this._postPlayerActionNarration(encounter, combatant, actionResult);
      
      // V3: Emit action completed event for UI sync
      eventBus.emit('combat.action.completed', {
        channelId: encounter.channelId,
        actorId: avatarId,
        actorName: combatant.name,
        actionType: actionResult.actionType || 'action',
        targetId: actionResult.targetId,
        damage: actionResult.damage
      });
      
      // Check end conditions
      if (this.evaluateEnd(encounter)) {
        this.turnLock.end(channelId);
        return;
      }
      
      // V3 FIX: Transition to advancing state
      this.turnLock.transition(channelId, TURN_STATES.ADVANCING, {
        reason: 'next_turn'
      });
      
      // Advance to next turn
      this.logger?.info?.(`[CombatEncounter] ${combatant.name} completed action, advancing turn`);
      await this.nextTurn(encounter);
      if (encounter.state === 'active') {
        this._persistActiveEncounter(encounter).catch(e => this.logger.warn?.(`[CombatEncounter] active persist failed: ${e.message}`));
      }
      
      // Release lock after turn advance (next turn will acquire its own)
      this.turnLock.release(channelId, 'turn_advanced');
      
    } catch (e) {
      this.logger?.error?.(`[CombatEncounter] completePlayerAction error: ${e.message}`);
      this.turnLock.forceRelease(channelId);
    }
  }

  /** Called after each action to see if combat should end (e.g., one side remains, idle) */
  evaluateEnd(encounter) {
    if (encounter.state !== 'active') return false;
    const policy = encounter.policy || this._getPolicyForMode(encounter.mode);
    
    // Maximum rounds limit - but NOT for dungeon combat (dungeons continue until cleared/flee/TPK)
    // Dungeon encounters should only end when:
    // - All monsters defeated (room cleared)
    // - All players defeated (TPK)
    // - Players flee
    if (!encounter.dungeonContext) {
      const maxRounds = policy?.maxRounds;
      if (Number.isFinite(maxRounds) && encounter.round >= maxRounds) {
        this.logger?.info?.(`[CombatEncounter][${encounter.channelId}] Max rounds (${maxRounds}) reached - ending combat`);
        this.endEncounter(encounter, { reason: 'max_rounds' });
        return true;
      }
    }
    
    // For dungeon combat: check if one side is eliminated
    if (encounter.dungeonContext) {
      // NOTE: Use _isKnockedOut() rather than HP alone.
      // Some KOs are represented via status/knockedOutUntil and can leave HP > 0.
      const monstersAlive = encounter.combatants.filter(c => c.isMonster && !this._isKnockedOut(c));
      const playersAlive = encounter.combatants.filter(c => !c.isMonster && !this._isKnockedOut(c));

      // Everyone down: treat as TPK for dungeon flow safety.
      if (playersAlive.length === 0 && monstersAlive.length === 0) {
        this.logger?.info?.(`[CombatEncounter][${encounter.channelId}] All combatants defeated - ending dungeon combat as TPK`);
        this.endEncounter(encounter, { reason: 'tpk' });
        return true;
      }

      // All monsters defeated - room cleared
      if (monstersAlive.length === 0 && playersAlive.length > 0) {
        this.logger?.info?.(`[CombatEncounter][${encounter.channelId}] All monsters defeated - dungeon room cleared`);
        this.endEncounter(encounter, { reason: 'room_cleared' });
        return true;
      }

      // All players defeated - TPK
      if (playersAlive.length === 0 && monstersAlive.length > 0) {
        this.logger?.info?.(`[CombatEncounter][${encounter.channelId}] All players defeated - TPK`);
        this.endEncounter(encounter, { reason: 'tpk' });
        return true;
      }
    }
    
    // Basic rule: if <=1 conscious combatant remains
    const alive = encounter.combatants.filter(c => !this._isKnockedOut(c));
    if (alive.length <= 1) {
      this.endEncounter(encounter, { reason: 'single_combatant' });
      return true;
    }
    // End if all alive combatants are defending
    if (policy?.allowAllDefendingEnd !== false && alive.length >= 2 && alive.every(c => c.isDefending)) {
      this.endEncounter(encounter, { reason: 'all_defending' });
      return true;
    }
    // Idle logic: if no hostile actions for N rounds after at least one hostile
    // But not for dungeon combat - players may need time to strategize
    if (!encounter.dungeonContext && policy?.allowIdleEnd !== false && encounter.lastHostileAt) {
      const roundsSince = (Date.now() - encounter.lastHostileAt) / (this.turnTimeoutMs);
      const idleEndRounds = policy?.idleEndRounds ?? this.idleEndRounds;
      if (Number.isFinite(idleEndRounds) && roundsSince >= idleEndRounds) {
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

      // Consume the turn immediately to prevent duplicate flee attempts
      actor.awaitingAction = false;

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
        
        // CRITICAL FIX: Remove from encounter to prevent ghost attacks
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
        if (encounter.state === 'active') {
          this._persistActiveEncounter(encounter).catch(e => this.logger.warn?.(`[CombatEncounter] active persist failed: ${e.message}`));
        }
        return { success: true, message: `-# 🏃 [ ${actor.name} flees to the Tavern! ]` };
      }
      // Failure: consume turn
      this.logger?.info?.(`[CombatEncounter][${encounter.channelId}] flee failed for ${actor.name}`);
      try { encounter.lastActionAt = Date.now(); } catch {}
      await this.nextTurn(encounter);
      if (encounter.state === 'active') {
        this._persistActiveEncounter(encounter).catch(e => this.logger.warn?.(`[CombatEncounter] active persist failed: ${e.message}`));
      }
      return { success: false, message: `-# 🏃 [ ${actor.name} fails to escape! ]` };
    } catch (e) {
      this.logger?.warn?.(`[CombatEncounter] handleFlee error: ${e.message}`);
      return { success: false, message: '-# [ Flee attempt failed. ]' };
    }
  }

  /** Ends encounter and clears timers */
  endEncounter(encounter, { reason } = {}) {
    // V3 FIX: Release turn lock when encounter ends
    if (encounter?.channelId) {
      this.turnLock.end(encounter.channelId);
    }
    
    this._clearTimers(encounter);
    encounter.state = 'ended';
    encounter.endedAt = Date.now();
    encounter.endReason = reason || 'unspecified';
    this._removeActiveEncounter(encounter).catch(e => this.logger.warn?.(`[CombatEncounter] active delete failed: ${e.message}`));
    if (encounter.parentChannelId) {
      this.encountersByParent.delete(encounter.parentChannelId);
    }
    this._returnCombatantsToOrigin(encounter).catch(e => {
      this.logger?.warn?.(`[CombatEncounter] return to origin failed: ${e.message}`);
    });
    
    // Determine winners (combatants not knocked out / dead)
    const alive = (encounter.combatants || []).filter(c => !this._isKnockedOut(c));
    const winners = alive;
    const winner = alive.length === 1 ? alive[0].name : null;
    
    try {
      this.logger?.info?.(`[CombatEncounter][${encounter.channelId}] ended: reason=${encounter.endReason}${winner ? ` winner=${winner}` : ''}`);
    } catch {}
    
    // Log encounter end to database
    if (this.combatLogService) {
      this.combatLogService.logEncounterEnd(encounter, {
        outcome: encounter.endReason,
        winners,
        xpAwarded: encounter.dungeonContext?.xpAwarded || 0
      }).catch(() => {});
    }
    
    // Store completed encounter for video generation (24 hours retention)
    // Only store if we have battle recap data
    if (encounter.battleRecap && encounter.battleRecap.rounds && encounter.battleRecap.rounds.length > 0) {
      this.completedEncounters.set(encounter.channelId, {
        channelId: encounter.channelId,
        battleRecap: encounter.battleRecap,
        combatants: encounter.combatants,
        endedAt: encounter.endedAt,
        endReason: encounter.endReason
      });
      this.logger?.info?.(`[CombatEncounter][${encounter.channelId}] Saved to completedEncounters for video generation`);
    }
    
    // Emit event for dungeon combat resolution (H-1: wire XP awards)
    if (encounter.dungeonContext) {
      eventBus.emit('combat.dungeon.ended', {
        dungeonId: encounter.dungeonContext.dungeonId,
        roomId: encounter.dungeonContext.roomId,
        channelId: encounter.channelId,
        winners,
        reason: encounter.endReason,
        combatants: encounter.combatants
      });
    }
    
    // V3: Emit combat ended event for UI cleanup
    eventBus.emit('combat.ended', {
      channelId: encounter.channelId,
      encounterId: encounter.encounterId,
      reason: encounter.endReason,
      winners: winners.map(w => ({ name: w.name, avatarId: w.avatarId }))
    });
    
    // Mark for cleanup by removing from encounters map (age list will be cleaned up later)
    // We don't remove from age list immediately to avoid O(n) search during combat
    
    // DO NOT auto-generate battle recap videos - wait for user button click
    // Videos are generated on-demand via generateBattleRecapVideos() method
    
    // Optionally persist summary later
  this._persistEncounter(encounter).catch(e => this.logger.warn?.(`[CombatEncounter] persist failed: ${e.message}`));
  this._sendSummary(encounter).catch(e => this.logger.warn?.(`[CombatEncounter] summary send failed: ${e.message}`));
  }

  async _returnCombatantsToOrigin(encounter) {
    if (!encounter || encounter.dungeonContext || !encounter.parentChannelId) return;
    if (!this.mapService?.updateAvatarPosition) return;
    const originMap = encounter.originLocations || {};
    const fleerId = this._normalizeId(encounter.fleerId);
    for (const c of (encounter.combatants || [])) {
      if (!c || c.isMonster) continue;
      const cid = this._normalizeId(c.avatarId);
      if (!cid || cid === fleerId) continue;
      if (c.ref?.status === 'dead' || c.ref?.status === 'knocked_out') continue;
      const origin = originMap[cid];
      if (!origin || origin === encounter.channelId) continue;
      try {
        await this.mapService.updateAvatarPosition(c.ref, origin);
      } catch (e) {
        this.logger?.warn?.(`[CombatEncounter] Failed to return ${c.name} to origin: ${e.message}`);
      }
    }
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
  const isMonster = avatar?.isMonster === true;
  const hasSummoner = String(avatar?.summoner || '').startsWith('user:');
  const hasDiscordUser = !!avatar?.discordUserId;
  const isPlayerControlled = !isMonster && (hasSummoner || hasDiscordUser);
  let discordUserId = avatar?.discordUserId || null;
  if (!discordUserId && hasSummoner) {
    discordUserId = String(avatar.summoner).replace(/^user:/, '');
  }

  const combatant = {
    combatantId: aid,
    avatarId: aid,
    name: avatar.name,
    ref: avatar,
    baseMonsterId: isMonster ? (avatar.baseMonsterId || avatar.monsterId || null) : null,
    discordUserId,
    initiative,
    currentHp: stats?.hp || COMBAT_CONSTANTS.DEFAULT_HP,
    maxHp: stats?.hp || COMBAT_CONSTANTS.DEFAULT_HP,
    armorClass,
    hasActed: false,
    isDefending: false,
    conditions: [],
    side: isMonster ? 'enemy' : 'neutral',
    isMonster,
    isPlayerControlled,
    autoMode: !isPlayerControlled,
    awaitingAction: false
  };
    encounter.combatants.push(combatant);
    // Rebuild initiative order and keep current turn index referencing correct avatar
  this._rebuildInitiativeOrder(encounter, { preserveCurrent: true });
  this._persistActiveEncounter(encounter).catch(e => this.logger.warn?.(`[CombatEncounter] active persist failed: ${e.message}`));
  }

  /** Remove a combatant from the encounter and repair initiative order */
  removeCombatant(encounter, avatarId) {
    if (!encounter) return;
    const id = this._normalizeId(avatarId);
    if (!id) return;
    const order = Array.isArray(encounter.initiativeOrder) ? encounter.initiativeOrder : [];
    const removedIndex = order.findIndex(v => this._normalizeId(v) === id);
    encounter.combatants = (encounter.combatants || []).filter(c => this._normalizeId(c.avatarId) !== id);
    encounter.initiativeOrder = order.filter(v => this._normalizeId(v) !== id);
    if (removedIndex !== -1 && Number.isFinite(encounter.currentTurnIndex)) {
      encounter.currentTurnIndex = Math.max(0, encounter.currentTurnIndex - (encounter.currentTurnIndex >= removedIndex ? 1 : 0));
    }
    this._persistActiveEncounter(encounter).catch(e => this.logger.warn?.(`[CombatEncounter] active persist failed: ${e.message}`));
  }

  /** Utility: ensures an encounter exists for channel and is active, creating + rolling if needed */
  async ensureEncounterForAttack({ channelId, attacker, defender, sourceMessage, deferStart = false }) {
    // Block self-combat as a safety net - use _getAvatarId to extract ID from avatar objects
    const attackerId = this._getAvatarId(attacker);
    const defenderId = this._getAvatarId(defender);
    
    // Comprehensive debug logging
    this.logger?.info?.(`[CombatEncounterService] SELF-COMBAT CHECK:`);
    this.logger?.info?.(`  Attacker: name="${attacker?.name}" id="${attackerId}"`);
    this.logger?.info?.(`  Defender: name="${defender?.name}" id="${defenderId}"`);
    this.logger?.info?.(`  Match: ${attackerId === defenderId}`);
    
    if (attackerId && defenderId && attackerId === defenderId) {
      this.logger?.warn?.(`[CombatEncounterService] Self-combat blocked: ${attacker?.name} tried to fight themselves`);
      throw new Error('self_combat_blocked');
    }
    
    const now = Date.now();
    
    // Auto-clear stale knocked_out status if timer has expired
    // This handles cases where status was set but timer wasn't, or timer expired
    if (attacker?.status === 'knocked_out' && (!attacker.knockedOutUntil || now >= attacker.knockedOutUntil)) {
      this.logger?.info?.(
        `[CombatEncounter] Auto-clearing stale knocked_out status for ${attacker.name} ` +
        `(knockedOutUntil=${attacker.knockedOutUntil ? new Date(attacker.knockedOutUntil).toISOString() : 'not set'})`
      );
      attacker.status = 'active';
      try {
        await this.avatarService.updateAvatar(attacker);
      } catch (e) {
        this.logger?.warn?.(`[CombatEncounter] Failed to clear status for ${attacker.name}: ${e.message}`);
      }
    }
    if (defender?.status === 'knocked_out' && (!defender.knockedOutUntil || now >= defender.knockedOutUntil)) {
      this.logger?.info?.(
        `[CombatEncounter] Auto-clearing stale knocked_out status for ${defender.name} ` +
        `(knockedOutUntil=${defender.knockedOutUntil ? new Date(defender.knockedOutUntil).toISOString() : 'not set'})`
      );
      defender.status = 'active';
      try {
        await this.avatarService.updateAvatar(defender);
      } catch (e) {
        this.logger?.warn?.(`[CombatEncounter] Failed to clear status for ${defender.name}: ${e.message}`);
      }
    }
    
    // Check both status field AND knockedOutUntil timer
    if (attacker?.status === 'dead' || attacker?.status === 'knocked_out' ||
        defender?.status === 'dead' || defender?.status === 'knocked_out') {
      // Diagnostic logging to understand why avatar is knocked out
      if (attacker?.status === 'knocked_out' || attacker?.status === 'dead') {
        const koUntil = attacker.knockedOutUntil ? new Date(attacker.knockedOutUntil).toISOString() : 'not set';
        const timeRemaining = attacker.knockedOutUntil ? Math.max(0, attacker.knockedOutUntil - now) : 0;
        this.logger?.warn?.(
          `[CombatEncounter] ${attacker.name} blocked from combat: status=${attacker.status}, ` +
          `knockedOutUntil=${koUntil}, timeRemaining=${Math.round(timeRemaining / 1000 / 60)}min`
        );
      }
      if (defender?.status === 'knocked_out' || defender?.status === 'dead') {
        const koUntil = defender.knockedOutUntil ? new Date(defender.knockedOutUntil).toISOString() : 'not set';
        const timeRemaining = defender.knockedOutUntil ? Math.max(0, defender.knockedOutUntil - now) : 0;
        this.logger?.warn?.(
          `[CombatEncounter] ${defender.name} blocked from combat: status=${defender.status}, ` +
          `knockedOutUntil=${koUntil}, timeRemaining=${Math.round(timeRemaining / 1000 / 60)}min`
        );
      }
      throw new Error('knocked_out_status');
    }
    if ((attacker?.knockedOutUntil && now < attacker.knockedOutUntil) || (defender?.knockedOutUntil && now < defender.knockedOutUntil)) {
      throw new Error('knockout_cooldown');
    }
    if ((attacker?.combatCooldownUntil && now < attacker.combatCooldownUntil) || (defender?.combatCooldownUntil && now < defender.combatCooldownUntil)) {
      throw new Error('flee_cooldown');
    }
    const isPlayerControlled = (a) => {
      if (!a || a.isMonster) return false;
      const hasSummoner = String(a.summoner || '').startsWith('user:');
      return !!a.discordUserId || hasSummoner;
    };
    const mode = (isPlayerControlled(attacker) && isPlayerControlled(defender)) ? 'pvp' : 'world';
    const sourceIsThread = !!sourceMessage?.channel?.isThread?.();
    let combatChannelId = channelId;
    let parentChannelId = null;
    let originLocations = {};

    if (!sourceIsThread) {
      const existingByParent = this.getEncounterByParentChannelId(channelId);
      if (existingByParent && existingByParent.state !== 'ended') {
        return existingByParent;
      }
      const threadName = this._buildCombatThreadName(attacker, defender);
      const threadId = await this.discordService?.createThread?.(channelId, threadName, {
        reason: 'Combat encounter'
      });
      if (!threadId || threadId === channelId) {
        throw new Error('thread_required');
      }
      combatChannelId = threadId;
      parentChannelId = channelId;
      // Move player-controlled avatars into combat thread
      const movers = [attacker, defender].filter(a => a && !a.isMonster);
      for (const mover of movers) {
        const moverId = this._getAvatarId(mover);
        if (!moverId) continue;
        try {
          const loc = await this.mapService?.getAvatarLocation?.(mover).catch(() => null);
          if (loc?.locationId) originLocations[moverId] = loc.locationId;
          await this.mapService?.updateAvatarPosition?.(mover, combatChannelId);
        } catch (e) {
          this.logger?.warn?.(`[CombatEncounter] Failed to move ${mover?.name} to combat thread: ${e.message}`);
        }
      }
    } else {
      parentChannelId = sourceMessage?.channel?.parentId || sourceMessage?.channel?.parent?.id || null;
    }

    let encounter = this.getEncounter(combatChannelId);
    if (!encounter) {
      encounter = this.createEncounter({
        channelId: combatChannelId,
        participants: [attacker, defender],
        sourceMessage,
        context: {
          mode,
          parentChannelId,
          threadId: combatChannelId,
          originLocations
        }
      });
      if (!deferStart) {
        await this.rollInitiative(encounter);
      }
      this.logger.info?.(`[CombatEncounter] Created new encounter in channel ${combatChannelId} with ${encounter.combatants.length} combatants.`);
    } else if (encounter.state === 'pending') {
      if (!deferStart) {
        await this.rollInitiative(encounter);
      }
    } else {
      await this.addCombatant(encounter, attacker);
      await this.addCombatant(encounter, defender);
    }
    return encounter;
  }

  /** Record damage to a combatant and evaluate for end conditions */
  applyDamage(encounter, avatarId, amount) {
    const c = this.getCombatant(encounter, avatarId);
    if (!c) {
      this.logger?.warn?.(`[CombatEncounter] applyDamage: combatant not found for avatarId=${avatarId}`);
      return;
    }
    const before = c.currentHp ?? 0;
    c.currentHp = Math.max(0, before - amount);
    this.logger?.info?.(`[CombatEncounter] applyDamage: ${c.name} took ${amount} damage (${before} -> ${c.currentHp})`);
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
            
            // Track if a player-controlled avatar was knocked out
            // This prevents them from claiming other avatars
            const defDiscordUserId = def.discordUserId || 
              (def.ref?.summoner && String(def.ref.summoner).startsWith('user:') 
                ? String(def.ref.summoner).replace(/^user:/, '') 
                : null);
            if (defDiscordUserId && !def.isMonster) {
              encounter.defeatedPlayers = encounter.defeatedPlayers || {};
              encounter.defeatedPlayers[defDiscordUserId] = def.name;
              this.logger?.info?.(`[CombatEncounter] Player ${defDiscordUserId}'s avatar ${def.name} was knocked out`);
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
      
      // Capture battle moment for video recap
      this._captureBattleMoment(encounter, { attacker, defender, result });
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

  /**
   * Capture a battle moment for the video recap
   * Stores action data from each round for later video generation
   * @private
   */
  _captureBattleMoment(encounter, { attacker, defender, result, dialogue }) {
    try {
      if (!encounter?.battleRecap) {
        encounter.battleRecap = { rounds: [] };
      }
      
      const currentRound = encounter.round || 1;
      
      // Find or create round entry
      let roundData = encounter.battleRecap.rounds.find(r => r.round === currentRound);
      if (!roundData) {
        roundData = {
          round: currentRound,
          actions: [],
          timestamp: Date.now()
        };
        encounter.battleRecap.rounds.push(roundData);
      }
      
      // Capture the action
      roundData.actions.push({
        timestamp: Date.now(),
        attackerName: attacker?.name || 'Unknown',
        attackerId: attacker?.avatarId,
        attackerImage: attacker?.ref?.imageUrl || attacker?.ref?.image,
        defenderName: defender?.name || 'Unknown',
        defenderId: defender?.avatarId,
        defenderImage: defender?.ref?.imageUrl || defender?.ref?.image,
        actionType: result?.result || 'attack',
        damage: result?.damage || 0,
        critical: !!result?.critical,
        attackRoll: result?.attackRoll,
        armorClass: result?.armorClass,
        dialogue: dialogue || '' // Include AI-generated dialogue for video
      });
      
      this.logger?.debug?.(`[CombatEncounter][${encounter.channelId}] Captured battle moment: Round ${currentRound}, ${attacker?.name} -> ${defender?.name}`);
    } catch (e) {
      this.logger.warn?.(`[CombatEncounter] Failed to capture battle moment: ${e.message}`);
    }
  }

  /**
   * Generate battle recap videos after combat ends
   * Creates 3 separate 8-second clips (one per round) showing the battle visually
   * @private
   */
  async _generateBattleRecapVideos(encounter) {
    try {
      // Check if we have VeoService and battle recap data
      if (!this.veoService) {
        this.logger?.warn?.('[CombatEncounter] VeoService not available, skipping battle recap videos');
        return null;
      }
      
      if (!encounter?.battleRecap?.rounds || encounter.battleRecap.rounds.length === 0) {
        this.logger?.debug?.('[CombatEncounter] No battle recap data to generate videos from');
        return null;
      }
      
      if (!this.unifiedAIService?.generateCompletion) {
        this.logger?.warn?.('[CombatEncounter] UnifiedAIService not available, skipping battle recap videos');
        return null;
      }
      
      this.logger?.info?.(`[CombatEncounter][${encounter.channelId}] Generating battle recap videos for ${encounter.battleRecap.rounds.length} rounds`);
      
      const videoPromises = [];
      const locationName = await this._getLocationName(encounter).catch(() => 'the battlefield');
      
      // Generate one 8-second video per round
      for (const roundData of encounter.battleRecap.rounds) {
        const videoPromise = this._generateRoundRecapVideo(encounter, roundData, locationName);
        videoPromises.push(videoPromise);
      }
      
      // Generate all videos in parallel
      const videos = await Promise.allSettled(videoPromises);
      
      const successful = videos
        .filter(v => v.status === 'fulfilled' && v.value)
        .map(v => v.value);
      
      const failed = videos.filter(v => v.status === 'rejected');
      
      if (failed.length > 0) {
        this.logger?.warn?.(`[CombatEncounter][${encounter.channelId}] ${failed.length}/${videos.length} battle recap videos failed to generate`);
      }
      
      if (successful.length > 0) {
        this.logger?.info?.(`[CombatEncounter][${encounter.channelId}] Generated ${successful.length} battle recap videos`);
        return successful;
      }
      
      return null;
    } catch (e) {
      this.logger.error?.(`[CombatEncounter] Battle recap video generation failed: ${e.message}`);
      return null;
    }
  }

  /**
   * Generate a single 8-second video for one round of combat
   * @param {object} encounter - Combat encounter
   * @param {object} roundData - Round data with actions
   * @param {string} locationName - Location description
   * @param {string[]} referenceImages - Optional array of reference image URLs to use (for first round)
   * @private
   */
  async _generateRoundRecapVideo(encounter, roundData, locationName, referenceImages = null) {
    try {
      // Build a narrative description of the round's actions
      const actions = roundData.actions || [];
      if (actions.length === 0) {
        this.logger?.debug?.(`[CombatEncounter] Round ${roundData.round} has no actions, skipping video`);
        return null;
      }
      
      // If no reference images provided, collect from this round only
      if (!referenceImages) {
        referenceImages = [];
        const seenImages = new Set();
        
        for (const action of actions) {
          if (action.attackerImage && !seenImages.has(action.attackerImage)) {
            referenceImages.push(action.attackerImage);
            seenImages.add(action.attackerImage);
          }
          if (action.defenderImage && !seenImages.has(action.defenderImage) && referenceImages.length < 3) {
            referenceImages.push(action.defenderImage);
            seenImages.add(action.defenderImage);
          }
          if (referenceImages.length >= 3) break; // Veo 3.1 max is 3 reference images
        }
      }
      
      // Generate cinematic prompt using LLM
      const actionSummary = actions.map(a => 
        `${a.attackerName} ${a.actionType === 'hit' ? 'strikes' : a.actionType === 'knockout' ? 'knocks out' : 'attacks'} ${a.defenderName}${a.critical ? ' with a critical hit' : ''}${a.damage > 0 ? ` for ${a.damage} damage` : ''}`
      ).join(', then ');
      
      const prompt = `Generate a cinematic description for an 8-second fantasy battle video recap showing Round ${roundData.round} of combat.

Location: ${locationName || 'a mystical battlefield'}
Actions this round: ${actionSummary}

Requirements:
- 150-250 words describing the visual action
- Cinematic camera work (sweeping shots, close-ups during key moments)
- Show each combatant's action clearly
- Fantasy RPG aesthetic with dramatic lighting
- Focus on the choreography and flow of combat
- Do NOT include dialogue or narration, only visual description`;
      
      const messages = [
        { role: 'system', content: 'You are a cinematic battle scene director. Generate vivid visual descriptions for fantasy combat videos.' },
        { role: 'user', content: prompt }
      ];
      
      const response = await this.unifiedAIService.chat(messages, {
        temperature: 0.8
      });
      
      const sceneDescription = response?.text || actionSummary;
      
      this.logger?.info?.(`[CombatEncounter][${encounter.channelId}] Generating Round ${roundData.round} recap video with ${referenceImages.length} reference images`);

      // VeoService expects referenceImages as [{ data: base64, mimeType, referenceType }]
      const s3Service = this.battleMediaService?.s3Service || this.configService?.services?.s3Service;
      const toBase64Ref = async (url) => {
        if (!url) return null;
        try {
          if (s3Service?.downloadImage) {
            const buf = await s3Service.downloadImage(url);
            return { data: buf.toString('base64'), mimeType: 'image/png', referenceType: 'asset' };
          }
          if (/^https?:\/\//i.test(url)) {
            const resp = await fetch(url);
            if (!resp.ok) return null;
            const arrayBuffer = await resp.arrayBuffer();
            const buf = Buffer.from(arrayBuffer);
            return { data: buf.toString('base64'), mimeType: resp.headers.get('content-type') || 'image/png', referenceType: 'asset' };
          }
        } catch (e) {
          this.logger?.debug?.(`[CombatEncounter] Failed to load reference image: ${e?.message || e}`);
        }
        return null;
      };

      const refPayload = [];
      for (const url of referenceImages.slice(0, 3)) {
        const ref = await toBase64Ref(url);
        if (ref?.data) refPayload.push(ref);
      }
      
      // Generate video using Veo 3.1 Fast with reference images
      const config = { aspectRatio: '16:9', durationSeconds: 8 };
      const videos = refPayload.length
        ? await this.veoService.generateVideosWithReferenceImages({
            prompt: sceneDescription,
            referenceImages: refPayload,
            config,
            model: 'veo-3.1-fast-generate-preview'
          })
        : await this.veoService.generateVideos({
            prompt: sceneDescription,
            config,
            model: 'veo-3.1-fast-generate-preview'
          });
      
      if (videos && videos.length > 0) {
        return {
          round: roundData.round,
          url: videos[0],
          prompt: sceneDescription,
          actions: actions.length
        };
      }
      
      return null;
    } catch (e) {
      this.logger.error?.(`[CombatEncounter] Round ${roundData.round} video generation failed: ${e.message}`);
      return null;
    }
  }

  /**
   * Extend an existing battle video with a new round (Veo 3.1 extension feature)
   * @param {string} videoUrl - Current video URL to extend
   * @param {object} roundData - Round data with actions
   * @param {string} locationName - Location description
   * @param {string[]} characterNames - Array of all character names in the battle for consistency
   * @private
   */
  async _extendRoundRecapVideo(videoUrl, roundData, locationName, characterNames = []) {
    try {
      const actions = roundData.actions || [];
      if (actions.length === 0) {
        this.logger?.debug?.(`[CombatEncounter] Round ${roundData.round} has no actions, skipping extension`);
        return null;
      }
      
      // Generate cinematic prompt for the extension
      const actionSummary = actions.map(a => 
        `${a.attackerName} ${a.actionType === 'hit' ? 'strikes' : a.actionType === 'knockout' ? 'knocks out' : 'attacks'} ${a.defenderName}${a.critical ? ' with a critical hit' : ''}${a.damage > 0 ? ` for ${a.damage} damage` : ''}`
      ).join(', then ');
      
      // Include character context to maintain visual consistency
      const characterContext = characterNames.length > 0 
        ? `\nCharacters featured: ${characterNames.join(', ')} - maintain their established appearance and visual characteristics from the previous footage.`
        : '';
      
      const prompt = `Continue the fantasy battle video showing Round ${roundData.round}.

Location: ${locationName || 'the battlefield'}
Actions this round: ${actionSummary}${characterContext}

Requirements:
- Continue seamlessly from the previous action
- Maintain the exact same visual appearance for all characters as shown in the previous footage
- 150-250 words describing the visual continuation
- Maintain cinematic camera work and flow
- Show each combatant's action clearly
- Fantasy RPG aesthetic with dramatic lighting
- Keep character designs and appearances consistent with earlier shots
- Do NOT include dialogue or narration, only visual description`;
      
      const messages = [
        { role: 'system', content: 'You are a cinematic battle scene director. Generate vivid visual descriptions for extending fantasy combat videos while maintaining perfect character consistency.' },
        { role: 'user', content: prompt }
      ];
      
      const response = await this.unifiedAIService.chat(messages, {
        temperature: 0.8
      });
      
      const sceneDescription = response?.text || `The battle continues as ${actionSummary}`;
      
      this.logger?.info?.(`[CombatEncounter] Extending video with Round ${roundData.round} (${characterNames.length} characters)`);
      
      // Extend video using Veo 3.1
      const extendedVideos = await this.veoService.extendVideo({
        videoUrl,
        prompt: sceneDescription,
        config: {
          personGeneration: 'allow_adult'
          // Note: resolution parameter is not supported in Gemini API
        },
        model: 'veo-3.1-generate-preview'
      });
      
      return extendedVideos; // Returns array of S3 URLs
      
    } catch (e) {
      this.logger.error?.(`[CombatEncounter] Round ${roundData.round} video extension failed: ${e.message}`);
      return null;
    }
  }

  /**
   * Generate battle recap videos with live status updates (PUBLIC - called from button handler)
   * @param {string} channelId - Channel ID where combat occurred
   * @param {string} statusMessageId - Optional message ID to edit with status updates
   * @returns {Promise<{success: boolean, videos: Array, error?: string}>}
   */
  async generateBattleRecapVideos(channelId, statusMessageId = null) {
    try {
      // Check active encounters first, then completed encounters
      let encounter = this.getEncounter(channelId);
      if (!encounter) {
        encounter = this.completedEncounters.get(channelId);
        if (!encounter) {
          return { success: false, error: 'No encounter found for this channel' };
        }
      }

      // Prevent duplicate video generation
      if (encounter.videoGenerationInProgress) {
        this.logger?.warn?.(`[CombatEncounter][${channelId}] Video generation already in progress, ignoring duplicate request`);
        return { success: false, error: 'Video generation already in progress' };
      }
      
      if (encounter.videoGenerated) {
        this.logger?.warn?.(`[CombatEncounter][${channelId}] Video already generated for this combat, ignoring duplicate request`);
        return { success: false, error: 'Video already generated for this combat' };
      }

      // Mark video generation as in progress
      encounter.videoGenerationInProgress = true;

      const channel = this._getChannel(encounter);
      if (!channel) {
        return { success: false, error: 'Channel not found' };
      }

      // Create or get status message
      let statusMessage = null;
      if (statusMessageId) {
        try {
          statusMessage = await channel.messages.fetch(statusMessageId);
        } catch (e) {
          this.logger.warn?.(`[CombatEncounter] Could not fetch status message: ${e.message}`);
        }
      }
      
      if (!statusMessage) {
        statusMessage = await channel.send({
          content: '🎬 **Generating Battle Recap Videos...**\nPreparing scenes...'
        });
      }

      const videos = await this._generateBattleRecapVideosWithProgress(encounter, statusMessage);
      
      if (!videos || videos.length === 0) {
        // Clear the in-progress flag on failure
        encounter.videoGenerationInProgress = false;
        await statusMessage.edit({
          content: '❌ **Battle Recap Generation Failed**\nNo videos could be generated. The battle may not have enough data.'
        });
        return { success: false, error: 'No videos generated', videos: [] };
      }
      
      // Mark video as successfully generated
      encounter.videoGenerated = true;
      encounter.videoGenerationInProgress = false;
      
      // Update final status
      await statusMessage.edit({
        content: `✅ **Battle Recap Complete!**\n${videos[0].actions} total ${videos[0].actions === 1 ? 'action' : 'actions'}`
      });

      // Post the video
      const video = videos[0];
      try {
        // Video is already uploaded to S3, just link to it
        await channel.send({
          content: `## 🎬 Battle Recap (Rounds ${video.round})\n${video.actions} ${video.actions === 1 ? 'action' : 'actions'}\n[Watch Battle Video](${video.url})`
        });
        
        // Emit event for social media auto-posters (Telegram, X, etc.)
        try {
          const combatants = encounter.combatants || [];
          const avatarNames = combatants.map(c => c.ref?.name).filter(Boolean).join(' vs ');
          const loc = await this.mapService?.getLocationAndAvatars?.(encounter.channelId).catch(() => null);
          const locationName = loc?.location?.name || 'the battlefield';
          
          eventBus.emit('MEDIA.VIDEO.GENERATED', {
            type: 'video',
            source: 'combat.recap',
            videoUrl: video.url,
            context: `🎬 Battle Recap: ${avatarNames} at ${locationName}`,
            prompt: `Epic battle between ${avatarNames}`,
            avatarName: avatarNames,
            guildId: channel.guild?.id,
            createdAt: new Date(),
            metadata: {
              rounds: video.round,
              actions: video.actions,
              duration: video.duration,
              combatants: combatants.length
            }
          });
        } catch (e) {
          this.logger?.warn?.(`[CombatEncounter] Failed to emit video event: ${e.message}`);
        }
        
        // Disable the "Generate Video" button now that video is ready
        try {
          if (statusMessageId) {
            const originalMessage = await channel.messages.fetch(statusMessageId);
            if (originalMessage?.components?.length > 0) {
              // Disable all buttons in the message
              const disabledComponents = originalMessage.components.map(row => {
                const newRow = new ActionRowBuilder();
                row.components.forEach(component => {
                  if (component.customId?.startsWith('generate_battle_video_')) {
                    const disabledButton = ButtonBuilder.from(component).setDisabled(true);
                    newRow.addComponents(disabledButton);
                  }
                });
                return newRow;
              });
              await originalMessage.edit({ components: disabledComponents });
              this.logger?.info?.(`[CombatEncounter] Disabled video generation button`);
            }
          }
        } catch (e) {
          this.logger.warn?.(`[CombatEncounter] Failed to disable button: ${e.message}`);
        }
      } catch (e) {
        this.logger.error?.(`[CombatEncounter] Failed to post battle video: ${e.message}`);
      }
      
      this.logger?.info?.(`[CombatEncounter][${channelId}] Posted ${video.duration}s extended battle recap video`);
      return { success: true, videos };
      
    } catch (e) {
      this.logger.error?.(`[CombatEncounter] Battle recap generation failed: ${e.message}`);
      // Clear the in-progress flag on error
      const encounter = this.getEncounter(channelId) || this.completedEncounters.get(channelId);
      if (encounter) {
        encounter.videoGenerationInProgress = false;
      }
      return { success: false, error: e.message, videos: [] };
    }
  }

  /**
   * Generate battle recap videos with live progress updates
   * Uses Veo 3.1 first/last frame interpolation to create one 8-second video
   * @private
   */
  async _generateBattleRecapVideosWithProgress(encounter, statusMessage) {
    try {
      // Check if we have VeoService and battle recap data
      if (!this.veoService) {
        await statusMessage.edit({ content: '❌ Video generation service not available' });
        return null;
      }
      
      if (!encounter?.battleRecap?.rounds || encounter.battleRecap.rounds.length === 0) {
        await statusMessage.edit({ content: '❌ No battle data available for recap' });
        return null;
      }
      
      if (!this.unifiedAIService?.chat) {
        await statusMessage.edit({ content: '❌ AI service not available for scene generation' });
        return null;
      }
      
      this.logger?.info?.(`[CombatEncounter][${encounter.channelId}] Generating battle recap video`);
      
      await statusMessage.edit({
        content: `🎬 **Generating Battle Recap Video...**\n📸 Preparing combatant references...\n\n░░░░░ 0%`
      });
      
      const loc = await this.mapService?.getLocationAndAvatars?.(encounter.channelId).catch(() => null);
      const locationName = loc?.location?.name || 'the battlefield';
      
      // Get combatants for poster/summary
      const combatants = encounter.combatants || [];
      if (combatants.length < 2) {
        await statusMessage.edit({ content: '❌ Not enough combatants for video generation' });
        return null;
      }
      
      const firstCombatant = combatants[0]?.ref;
      const secondCombatant = combatants[1]?.ref;
      
      if (!firstCombatant || !secondCombatant) {
        await statusMessage.edit({ content: '❌ Combatant data missing' });
        return null;
      }
      
      // Prepare battle narrative
      await statusMessage.edit({
        content: `🎬 **Generating Battle Recap Video...**\n🎭 Creating battle narrative...\n\n▓▓░░░ 40%`
      });
      
      const totalActions = encounter.battleRecap.rounds.reduce((sum, r) => sum + (r.actions?.length || 0), 0);
      const actionSummary = encounter.battleRecap.rounds.map((r, idx) => 
        `Round ${idx + 1}: ` + (r.actions || []).map(a => 
          `${a.attackerName} ${a.actionType === 'hit' ? 'strikes' : a.actionType === 'knockout' ? 'delivers knockout blow to' : 'attacks'} ${a.defenderName}${a.critical ? ' (critical!)' : ''}${a.damage > 0 ? ` [${a.damage} dmg]` : ''}`
        ).join(', ')
      ).filter(Boolean).join('\n');
      
      // Use LLM to generate custom video prompt based on actual combat
      // Determine winner for context
      const alive = combatants.filter(c => (c.currentHp || 0) > 0);
      const winner = alive.length === 1 ? alive[0]?.ref : combatants.sort((a,b) => (b.currentHp||0) - (a.currentHp||0))[0]?.ref;
      
      const promptGenMessages = [
        { 
          role: 'system', 
          content: 'You are a fantasy battle cinematographer. Generate detailed visual descriptions for battle video generation based on combat logs.' 
        },
        { 
          role: 'user', 
          content: `Create a vivid 200-300 word visual description for a fantasy battle video based on this combat:

**Location:** ${locationName}
**Combatants:** ${combatants.map(c => c.name).join(' vs ')}
**Total Rounds:** ${encounter.battleRecap.rounds.length}
**Total Actions:** ${totalActions}
**Winner:** ${winner?.name}

**Battle Flow:**
${actionSummary}

**Combatant Details:**
- ${firstCombatant.name}: ${firstCombatant.description || 'A skilled fighter'}
- ${secondCombatant.name}: ${secondCombatant.description || 'A worthy opponent'}

**Requirements:**
- Describe the visual flow from opening clash to final victory
- Include specific combat moments from the battle log above
- Dynamic camera movements tracking the action
- Fantasy RPG aesthetic with dramatic lighting, particle effects, magical energy
- Emphasize momentum building from initial exchanges to climactic finale
- Reference the combatants' appearances and fighting styles based on their descriptions
- Pure visual choreography - no dialogue, only movement and visual effects
- Make it feel like an epic moment worth remembering

Generate the video prompt now:` 
        }
      ];
      
      const promptResponse = await this.unifiedAIService.chat(promptGenMessages, {
        temperature: 0.9
      });
      
      const sceneDescription = promptResponse?.text || `Epic battle between ${combatants.map(c => c.name).join(' and ')} at ${locationName}. The combat flows from initial clash to victory in one continuous motion.`;
      
      this.logger?.info?.(`[CombatEncounter] Generated video prompt: ${sceneDescription.substring(0, 100)}...`);
      
      // Generate video using Veo with key frame
      await statusMessage.edit({
        content: `🎬 **Generating Battle Recap Video...**\n🎬 Composing battle scene key frame...\n\n▓▓▓░░ 60%`
      });
      
      // Use the combat summary image as the final frame (already generated)
      const s3Service = this.battleMediaService?.s3Service || this.configService?.services?.s3Service;
      let finalFrameUrl = encounter.summaryMediaUrl;
      
      if (finalFrameUrl) {
        this.logger?.info?.(`[CombatEncounter] Using combat summary image as final frame: ${finalFrameUrl}`);
        await statusMessage.edit({
          content: `🎬 **Generating Battle Recap Video...**\n🎬 Using combat summary as final frame...\n\n▓▓▓▓░ 70%`
        });
      } else {
        this.logger?.warn?.(`[CombatEncounter] No combat summary image available, skipping final frame`);
        await statusMessage.edit({
          content: `🎬 **Generating Battle Recap Video...**\n⚠️ No final frame available...\n\n▓▓▓▓░ 70%`
        });
      }
      
      // Step 3: Generate video from the final frame (combat summary image)
      await statusMessage.edit({
        content: `🎬 **Generating Battle Recap Video...**\n🎬 Rendering video from final frame...\n\n▓▓▓▓░ 80%`
      });
      
      let videos;
      if (finalFrameUrl && s3Service) {
        this.logger?.info?.(`[CombatEncounter] Generating video from combat summary (final frame)`);
        try {
          // Download the combat summary image to use as the final frame
          const finalFrameBuffer = await s3Service.downloadImage(finalFrameUrl);
          
          videos = await this.veoService.generateVideosFromImages({
            prompt: sceneDescription,
            images: [{
              data: finalFrameBuffer.toString('base64'),
              mimeType: 'image/png'
            }],
            config: {
              aspectRatio: '16:9',
              durationSeconds: 8,
              personGeneration: 'allow_adult'
            },
            model: 'veo-3.1-generate-preview'
          });
        } catch (e) {
          this.logger.warn?.(`[CombatEncounter] Video generation from final frame failed: ${e.message}`);
        }
      }
      
      // Fallback to text-only generation if key frame approach failed
      if (!videos || videos.length === 0) {
        this.logger?.warn?.(`[CombatEncounter] Using text-only video generation as fallback`);
        try {
          videos = await this.veoService.generateVideos({
            prompt: sceneDescription,
            config: {
              aspectRatio: '16:9',
              durationSeconds: 8,
              personGeneration: 'allow_adult'
            },
            model: 'veo-3.1-generate-preview'
          });
        } catch (e) {
          this.logger.error?.(`[CombatEncounter] Text-only video generation also failed: ${e.message}`);
        }
      }
      
      if (!videos || videos.length === 0) {
        await statusMessage.edit({ content: '❌ Video generation failed' });
        return null;
      }
      
      const videoUrl = videos[0]; // VeoService returns array of URLs
      
      this.logger?.info?.(`[CombatEncounter] Battle recap video generated: ${videoUrl}`);
      
      // Return single video
      return [{
        round: `1-${encounter.battleRecap.rounds.length}`,
        url: videoUrl,
        duration: 8,
        actions: totalActions
      }];
      
    } catch (e) {
      this.logger.error?.(`[CombatEncounter] Battle recap video generation failed: ${e.message}`);
      await statusMessage.edit({ content: `❌ **Generation Failed**\n${e.message}` });
      return null;
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
        parentChannelId: encounter.parentChannelId || null,
        threadId: encounter.threadId || null,
        mode: encounter.mode || null,
        state: encounter.state,
        createdAt: new Date(encounter.createdAt),
        startedAt: encounter.startedAt ? new Date(encounter.startedAt) : null,
        endedAt: encounter.endedAt ? new Date(encounter.endedAt) : null,
        endReason: encounter.endReason || null,
        rounds: encounter.round,
        combatants: encounter.combatants.map(c => ({
          combatantId: c.combatantId,
          avatarId: c.avatarId,
            name: c.name,
            initiative: c.initiative,
            finalHp: c.currentHp,
            maxHp: c.maxHp,
            conditions: c.conditions,
            side: c.side,
            baseMonsterId: c.baseMonsterId || null
        })),
        initiativeOrder: encounter.initiativeOrder,
        summaryVersion: 1,
      };
      await db.collection('combat_encounters').insertOne(doc);
    } catch (e) {
      this.logger.warn?.(`[CombatEncounter] DB persist error: ${e.message}`);
    }
  }

  _normalizeTimestamp(value) {
    if (!value) return null;
    if (value instanceof Date) return value.getTime();
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  _serializeActiveEncounter(encounter) {
    const chatter = encounter.chatter || {};
    const spoken = chatter.spokenThisRound instanceof Set
      ? Array.from(chatter.spokenThisRound)
      : Array.isArray(chatter.spokenThisRound) ? chatter.spokenThisRound : [];
    return {
      channelId: encounter.channelId,
      parentChannelId: encounter.parentChannelId || null,
      threadId: encounter.threadId || null,
      encounterId: encounter.encounterId || null,
      guildId: encounter.guildId || null,
      mode: encounter.mode || null,
      policy: encounter.policy || null,
      originLocations: encounter.originLocations || {},
      state: encounter.state,
      createdAt: this._normalizeTimestamp(encounter.createdAt),
      startedAt: this._normalizeTimestamp(encounter.startedAt),
      endedAt: this._normalizeTimestamp(encounter.endedAt),
      endReason: encounter.endReason || null,
      round: encounter.round || 0,
      currentTurnIndex: encounter.currentTurnIndex || 0,
      initiativeOrder: encounter.initiativeOrder || [],
      lastTurnStartAt: this._normalizeTimestamp(encounter.lastTurnStartAt),
      lastTimerArmedAt: this._normalizeTimestamp(encounter.lastTimerArmedAt),
      lastHostileAt: this._normalizeTimestamp(encounter.lastHostileAt),
      lastActionAt: this._normalizeTimestamp(encounter.lastActionAt),
      lastAction: encounter.lastAction || null,
      chatter: { spokenThisRound: spoken, lastSpeakerId: chatter.lastSpeakerId || null },
      battleRecap: encounter.battleRecap || { rounds: [] },
      fightPosterUrl: encounter.fightPosterUrl || null,
      summaryMediaUrl: encounter.summaryMediaUrl || null,
      sourceMessageId: encounter.sourceMessageId || null,
      manualActionCount: encounter.manualActionCount || 0,
      defeatedPlayers: encounter.defeatedPlayers || null,
      fleerId: encounter.fleerId || null,
      dungeonContext: encounter.dungeonContext || null,
      combatants: (encounter.combatants || []).map(c => ({
        combatantId: c.combatantId || c.avatarId,
        avatarId: c.avatarId || c.combatantId,
        name: c.name,
        initiative: c.initiative,
        currentHp: c.currentHp,
        maxHp: c.maxHp,
        armorClass: c.armorClass,
        hasActed: !!c.hasActed,
        isDefending: !!c.isDefending,
        conditions: Array.isArray(c.conditions) ? c.conditions : [],
        statusEffects: Array.isArray(c.statusEffects) ? c.statusEffects : [],
        side: c.side || null,
        isMonster: !!c.isMonster,
        isPlayerControlled: !!c.isPlayerControlled,
        autoMode: !!c.autoMode,
        awaitingAction: !!c.awaitingAction,
        discordUserId: c.discordUserId || null,
        baseMonsterId: c.baseMonsterId || null,
        refSnapshot: (c.isMonster || !c.ref?._id) ? {
          id: c.ref?._id || c.ref?.id || c.avatarId || c.combatantId,
          name: c.ref?.name || c.name,
          emoji: c.ref?.emoji || c.emoji || null,
          imageUrl: c.ref?.imageUrl || c.ref?.image || c.imageUrl || null,
          isMonster: !!c.isMonster,
          stats: c.ref?.stats || c.stats || null,
          attacks: c.ref?.attacks || c.attacks || null,
          side: c.side || null,
          baseMonsterId: c.baseMonsterId || c.ref?.baseMonsterId || null
        } : null
      }))
    };
  }

  async _persistActiveEncounter(encounter) {
    try {
      if (!this.databaseService || !encounter) return;
      const db = await this.databaseService.getDatabase();
      if (!db) return;
      const doc = this._serializeActiveEncounter(encounter);
      doc.updatedAt = new Date();
      await db.collection('combat_active_encounters').updateOne(
        { channelId: encounter.channelId },
        { $set: doc },
        { upsert: true }
      );
    } catch (e) {
      this.logger.warn?.(`[CombatEncounter] Active persist error: ${e.message}`);
    }
  }

  async _removeActiveEncounter(encounterOrChannelId) {
    try {
      if (!this.databaseService) return;
      const channelId = typeof encounterOrChannelId === 'string'
        ? encounterOrChannelId
        : encounterOrChannelId?.channelId;
      if (!channelId) return;
      const db = await this.databaseService.getDatabase();
      if (!db) return;
      await db.collection('combat_active_encounters').deleteOne({ channelId });
    } catch (e) {
      this.logger.warn?.(`[CombatEncounter] Active delete error: ${e.message}`);
    }
  }

  async _hydrateEncounter(doc) {
    if (!doc?.channelId) return null;
    const combatants = [];
    for (const c of (doc.combatants || [])) {
      let ref = null;
      if (!c.isMonster) {
        try {
          ref = await this.avatarService.getAvatarById(c.avatarId);
        } catch {}
      }
      if (!ref && c.refSnapshot) {
        ref = { ...c.refSnapshot };
      }
      if (!ref) {
        ref = { _id: c.avatarId, id: c.avatarId, name: c.name, isMonster: !!c.isMonster, stats: c.refSnapshot?.stats };
      }
      const isPlayerControlled = c.isPlayerControlled ?? (!c.isMonster && (!!c.discordUserId || String(ref?.summoner || '').startsWith('user:')));
      const autoMode = c.autoMode ?? !isPlayerControlled;
      const combatant = {
        combatantId: c.combatantId || c.avatarId,
        avatarId: c.avatarId || c.combatantId,
        name: c.name || ref?.name || 'Unknown',
        ref,
        baseMonsterId: c.baseMonsterId || ref?.baseMonsterId || null,
        discordUserId: c.discordUserId || ref?.discordUserId || null,
        initiative: c.initiative,
        currentHp: c.currentHp,
        maxHp: c.maxHp,
        armorClass: c.armorClass,
        hasActed: !!c.hasActed,
        isDefending: !!c.isDefending,
        conditions: Array.isArray(c.conditions) ? c.conditions : [],
        statusEffects: Array.isArray(c.statusEffects) ? c.statusEffects : [],
        side: c.side || (c.isMonster ? 'enemy' : 'neutral'),
        isMonster: !!c.isMonster,
        isPlayerControlled,
        autoMode,
        awaitingAction: !!c.awaitingAction
      };
      combatants.push(combatant);
    }
    const spoken = Array.isArray(doc?.chatter?.spokenThisRound) ? doc.chatter.spokenThisRound : [];
    const encounter = {
      encounterId: doc.encounterId || `${doc.channelId}:${Date.now()}`,
      channelId: doc.channelId,
      parentChannelId: doc.parentChannelId || null,
      threadId: doc.threadId || doc.channelId,
      mode: doc.mode || 'world',
      policy: doc.policy || this._getPolicyForMode(doc.mode),
      originLocations: doc.originLocations || {},
      guildId: doc.guildId || null,
      state: doc.state || 'active',
      createdAt: this._normalizeTimestamp(doc.createdAt) || Date.now(),
      startedAt: this._normalizeTimestamp(doc.startedAt),
      endedAt: this._normalizeTimestamp(doc.endedAt),
      endReason: doc.endReason || null,
      combatants,
      initiativeOrder: doc.initiativeOrder || combatants.map(c => c.avatarId),
      currentTurnIndex: doc.currentTurnIndex || 0,
      round: doc.round || 1,
      lastTurnStartAt: this._normalizeTimestamp(doc.lastTurnStartAt),
      lastTimerArmedAt: this._normalizeTimestamp(doc.lastTimerArmedAt),
      lastHostileAt: this._normalizeTimestamp(doc.lastHostileAt),
      lastActionAt: this._normalizeTimestamp(doc.lastActionAt),
      lastAction: doc.lastAction || null,
      chatter: { spokenThisRound: new Set(spoken), lastSpeakerId: doc?.chatter?.lastSpeakerId || null },
      pendingRoundActions: [],
      lastNarratedRound: doc.lastNarratedRound || 0,
      timers: {},
      knockout: doc.knockout || null,
      knockoutMedia: doc.knockoutMedia || null,
      fightPosterUrl: doc.fightPosterUrl || null,
      summaryMediaUrl: doc.summaryMediaUrl || null,
      turnAdvanceBlockers: [],
      manualActionCount: doc.manualActionCount || 0,
      posterBlocker: { promise: Promise.resolve(), resolve: () => {} },
      sourceMessageId: doc.sourceMessageId || null,
      battleRecap: doc.battleRecap || { rounds: [] },
      defeatedPlayers: doc.defeatedPlayers || null,
      fleerId: doc.fleerId || null,
      dungeonContext: doc.dungeonContext || null
    };
    return encounter;
  }

  async loadActiveEncounters() {
    try {
      if (!this.databaseService) return { loaded: 0 };
      const db = await this.databaseService.getDatabase();
      if (!db) return { loaded: 0 };
      const docs = await db.collection('combat_active_encounters').find({ state: { $ne: 'ended' } }).toArray();
      let loaded = 0;
      const MAX_ENCOUNTER_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours — encounters older than this are zombies
      const now = Date.now();
      for (const doc of docs) {
        if (!doc?.channelId || this.encounters.has(doc.channelId)) continue;
        // V8 FIX: Evict stale encounters instead of rehydrating them.
        // Without this, zombie encounters survive restarts indefinitely
        // (one was stuck for 13 days, spamming re-announces every 60s).
        const createdAt = doc.createdAt instanceof Date ? doc.createdAt.getTime() : (Number(doc.createdAt) || 0);
        if (now - createdAt > MAX_ENCOUNTER_AGE_MS) {
          this.logger?.info?.(`[CombatEncounter] Evicting stale encounter in ${doc.channelId} (age: ${Math.round((now - createdAt) / 3600000)}h)`);
          try {
            const evictDb = await this.databaseService.getDatabase();
            await evictDb.collection('combat_active_encounters').deleteOne({ channelId: doc.channelId });
          } catch (e) { this.logger?.warn?.(`[CombatEncounter] Failed to delete stale encounter: ${e.message}`); }
          continue;
        }
        const encounter = await this._hydrateEncounter(doc);
        if (!encounter) continue;
        this.encounters.set(encounter.channelId, encounter);
        if (encounter.parentChannelId) {
          this.encountersByParent.set(encounter.parentChannelId, encounter);
        }
        this._insertEncounterByAge(encounter.channelId, encounter.createdAt);
        loaded++;
        if (encounter.state === 'active') {
          this._scheduleTurnStart(encounter);
        }
      }
      if (loaded > 0) {
        this.logger?.info?.(`[CombatEncounter] Loaded ${loaded} active encounter(s) from persistence`);
      }
      return { loaded };
    } catch (e) {
      this.logger.warn?.(`[CombatEncounter] Active load error: ${e.message}`);
      return { loaded: 0 };
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
    
    // Check if it's this avatar's turn in the initiative order
    const isCurrentTurn = this._normalizeId(this.getCurrentTurnAvatarId(encounter)) === this._normalizeId(avatarId);
    if (!isCurrentTurn) return false;
    
    // V5 FIX: Also check if the combatant is awaiting action
    // This prevents multiple attacks when player spams attack commands
    const combatant = this.getCombatant(encounter, avatarId);
    if (!combatant?.awaitingAction) {
      this.logger?.debug?.(`[CombatEncounter] isTurn: ${combatant?.name} has already acted this turn`);
      return false;
    }
    
    return true;
  }

  /** Initiative embed intentionally removed */

  /** Post an embed for each new turn with a "Take Your Turn" button that shows ephemeral combat options */
  async _announceTurn(encounter) {
    if (!this.discordService?.client) return;
    const channel = this._getChannel(encounter);
    if (!channel?.send) return;
    if (encounter.state !== 'active') return;
    
    const currentId = this.getCurrentTurnAvatarId(encounter);
    const current = this.getCombatant(encounter, currentId);
    if (!current) return;
    
    // V3: Emit turn started event for UI sync
    eventBus.emit('combat.turn.started', {
      channelId: encounter.channelId,
      encounterId: encounter.encounterId,
      round: encounter.round,
      turnIndex: encounter.currentTurnIndex,
      combatantId: currentId,
      combatantName: current.name,
      isPlayerControlled: current.isPlayerControlled
    });
    
    // V6 FIX: Always show the turn announcement for PLAYER turns (including round 1 turn 0).
    // The combat start embed shows the encounter, but the player still needs the
    // "Take Your Turn" button to actually act.  Skip only for AI/monster turns on round 1.
    if (encounter.round === 1 && encounter.currentTurnIndex === 0 && !current.isPlayerControlled) {
      this.logger.debug?.(`[CombatEncounter] skipping round 1 first turn announcement (AI/monster)`);
      return;
    }
    
    // V3 FIX: Only post turn announcement embed for PLAYER-CONTROLLED combatants awaiting input
    // Monster/AI turns will just execute and post their action message - no full status spam
    if (!current.isPlayerControlled) {
      this.logger.debug?.(`[CombatEncounter] skipping turn embed for AI/monster: ${current.name}`);
      return;
    }
    
    // Only show buttons for player-controlled avatars who are awaiting input
    const showTakeActionButton = current.isPlayerControlled && current.awaitingAction;
    
    // Include avatar image as thumbnail if available
    const thumbnailUrl = current.ref?.imageUrl || current.imageUrl || null;
    
    // Get enemies for targeting (monsters only, not party members)
    const enemies = encounter.combatants.filter(c => c.isMonster && c.currentHp > 0);
    const enemyList = enemies.length > 0 
      ? enemies.map(e => `• **${e.name}** (${e.currentHp}/${e.maxHp} HP)`).join('\n')
      : '*No enemies remain*';
    
    // Get party allies (non-monsters, non-self) for status display
    const currentAvatarId = this._normalizeId(current.avatarId);
    const allies = encounter.combatants.filter(c => 
      !c.isMonster && 
      c.currentHp > 0 && 
      this._normalizeId(c.avatarId) !== currentAvatarId
    );
    const allyList = allies.length > 0
      ? allies.map(a => `• ${a.name} (${a.currentHp}/${a.maxHp} HP)`).join('\n')
      : '';
    
    // Build description with enemies and optionally allies
    let description = `*"${current.name}, what is your command?"*\n\n**Enemies:**\n${enemyList}`;
    if (allyList) {
      description += `\n\n**Allies:**\n${allyList}`;
    }
    
    // Simplified embed - just show whose turn and targets, not full turn order
    const embed = {
      author: { name: '🎲 The Dungeon Master' },
      title: `⚔️ ${current.name}'s Turn`,
      description,
      color: 0x3B82F6, // Blue for player turn
      footer: { text: `Round ${encounter.round} • ${current.currentHp}/${current.maxHp} HP` },
      ...(thumbnailUrl && { thumbnail: { url: thumbnailUrl } })
    };
    
    // Create a single "Take Your Turn" button that shows ephemeral options when clicked
    const rows = [];
    if (showTakeActionButton) {
      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('dnd_combat_take_turn')
          .setLabel('Take Your Turn')
          .setEmoji('⚔️')
          .setStyle(ButtonStyle.Primary)
      );
      rows.push(actionRow);
    }
    
    try { 
      // Post public announcement with single "Take Your Turn" button
      await channel.send({ embeds: [embed], components: rows }); 
      this.logger?.debug?.(`[CombatEncounter] Posted turn announcement for ${current.name} with ephemeral action button`);
    } catch (e) { 
      this.logger.warn?.(`[CombatEncounter] send turn embed failed: ${e.message}`); 
    }
  }

  /**
   * Handle the "Take Your Turn" button - validates turn ownership and shows ephemeral combat options
   * @param {Object} interaction - Discord button interaction
   * @returns {Promise<Object>} Response data for the interaction
   */
  async handleTakeTurnButton(interaction) {
    const userId = interaction.user.id;
    const channelId = interaction.channelId;
    
    const encounter = this.getEncounterByChannelId(channelId);
    if (!encounter || encounter.state !== 'active') {
      return { 
        error: true, 
        content: '*The sounds of battle have faded... No active combat here.*',
        ephemeral: true 
      };
    }
    
    const currentId = this.getCurrentTurnAvatarId(encounter);
    const current = this.getCombatant(encounter, currentId);
    
    if (!current) {
      return { 
        error: true, 
        content: '*Something went wrong... The battlefield is in chaos.*',
        ephemeral: true 
      };
    }
    
    // Monsters cannot be controlled by players
    if (current.isMonster) {
      return {
        error: true,
        embed: {
          author: { name: '🎲 The Dungeon Master' },
          description: `*"The enemy is acting! Wait for your turn, adventurer."*\n\n**Current Turn:** ${current.name}`,
          color: 0x95A5A6,
          footer: { text: 'Patience is a virtue in combat...' }
        },
        ephemeral: true
      };
    }
    
    // Check if this user controls the current turn's avatar
    // Support multiple ways a user can be linked to an avatar:
    // 1. summoner field starting with 'user:' (classic avatars)
    // 2. discordUserId field (party members in dungeons)
    // 3. ref.discordUserId (nested in original avatar data)
    let expectedUserId = null;
    
    // Check summoner field first
    if (current.ref?.summoner && String(current.ref.summoner).startsWith('user:')) {
      expectedUserId = String(current.ref.summoner).replace(/^user:/, '');
    }
    // Check discordUserId on the combatant itself
    else if (current.discordUserId) {
      expectedUserId = String(current.discordUserId);
    }
    // Check discordUserId nested in ref
    else if (current.ref?.discordUserId) {
      expectedUserId = String(current.ref.discordUserId);
    }
    
    // FALLBACK: Allow claiming unclaimed party members
    // RESTRICTION: Only if the user's previous avatar wasn't knocked out
    if (!expectedUserId && !current.isMonster) {
      encounter.claimedAvatars = encounter.claimedAvatars || {};
      encounter.defeatedPlayers = encounter.defeatedPlayers || {};
      
      // Check if this user's avatar was already knocked out
      if (encounter.defeatedPlayers[userId]) {
        const defeatedName = encounter.defeatedPlayers[userId];
        return {
          error: true,
          embed: {
            author: { name: '🎲 The Dungeon Master' },
            description: `*"Your champion ${defeatedName} has fallen, brave soul. You can no longer participate in this battle."*`,
            color: 0x2C2C2C,
            footer: { text: 'Watch and hope your allies prevail...' }
          },
          ephemeral: true
        };
      }
      
      // Check if this user already controls a DIFFERENT avatar
      const userExistingClaim = Object.entries(encounter.claimedAvatars)
        .find(([avatarId, claimerId]) => claimerId === userId && avatarId !== currentId);
      if (userExistingClaim) {
        const claimedAvatar = this.getCombatant(encounter, userExistingClaim[0]);
        return {
          error: true,
          embed: {
            author: { name: '🎲 The Dungeon Master' },
            description: `*"You already control ${claimedAvatar?.name || 'another adventurer'}. One soul, one champion."*`,
            color: 0x95A5A6,
            footer: { text: 'Wait for your turn in the initiative order...' }
          },
          ephemeral: true
        };
      }
      
      const existingClaimer = encounter.claimedAvatars[currentId];
      
      if (existingClaimer && existingClaimer !== userId) {
        return {
          error: true,
          embed: {
            author: { name: '🎲 The Dungeon Master' },
            description: `*"${current.name} is being controlled by another adventurer."*\n\n*Wait for your moment in the initiative order.*`,
            color: 0x95A5A6,
            footer: { text: 'Patience is a virtue in combat...' }
          },
          ephemeral: true
        };
      }
      
      // Claim the avatar
      encounter.claimedAvatars[currentId] = userId;
      current.discordUserId = userId;
      current.isPlayerControlled = true;
      current.autoMode = false;
      expectedUserId = userId;
      this.logger?.info?.(`[CombatEncounter] User ${userId} claimed control of ${current.name} via Take Turn button`);
    }
    
    if (expectedUserId !== userId) {
      // Not this user's turn - show ephemeral "not your turn" message
      return {
        error: true,
        embed: {
          author: { name: '🎲 The Dungeon Master' },
          description: `*"Hold, adventurer! It is not your turn to act."*\n\n**Current Turn:** ${current.name}\n\n*Wait for your moment in the initiative order.*`,
          color: 0x95A5A6, // Gray
          footer: { text: 'Patience is a virtue in combat...' }
        },
        ephemeral: true
      };
    }
    
    // It IS this user's turn - show ephemeral combat options
    const status = encounter.combatants.map(c => {
      const indicator = this._normalizeId(c.avatarId) === this._normalizeId(currentId) ? '➡️' : ' ';
      const defending = c.isDefending ? ' 🛡️' : '';
      const emoji = c.isMonster ? '👹' : (c.isPlayerControlled ? '🧙' : '⚔️');
      return `${indicator} ${emoji} ${c.name}: ${c.currentHp}/${c.maxHp} HP${defending}`;
    }).join('\n');
    
    // Get enemies for target selection
    const enemies = encounter.combatants.filter(c => 
      c.isMonster && c.currentHp > 0
    ) || [];
    
    // Build action buttons
    const rows = [];
    
    // Main action row
    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('dnd_combat_attack')
        .setLabel('Attack')
        .setEmoji('⚔️')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('dnd_combat_cast')
        .setLabel('Cast Spell')
        .setEmoji('🪄')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('dnd_combat_defend')
        .setLabel('Defend')
        .setEmoji('🛡️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('dnd_combat_flee')
        .setLabel('Flee')
        .setEmoji('🏃')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('dnd_combat_auto')
        .setLabel('Auto')
        .setEmoji('🤖')
        .setStyle(ButtonStyle.Success)
    );
    rows.push(actionRow);
    
    // Target selection row if enemies exist
    if (enemies.length > 0) {
      const targetButtons = enemies.slice(0, 5).map(enemy => {
        // Use avatarId for stable target resolution (not name)
        const targetId = enemy.combatantId || enemy.avatarId || enemy._id || enemy.id || enemy.name;
        return new ButtonBuilder()
          .setCustomId(`dnd_target_${encodeURIComponent(String(targetId))}`)
          .setLabel(`${enemy.name} (${enemy.currentHp}HP)`.slice(0, 80))
          .setEmoji(enemy.emoji || '👹')
          .setStyle(ButtonStyle.Danger);
      });
      rows.push(new ActionRowBuilder().addComponents(targetButtons));
    }
    
    return {
      error: false,
      embed: {
        author: { name: '⚔️ Your Turn!' },
        title: current.name,
        description: `**Choose your action, brave adventurer!**\n\n*The battlefield awaits your command...*`,
        fields: [
          { name: '📊 Combat Status', value: status.slice(0, 1024) }
        ],
        color: 0xEF4444, // Red for urgency
        footer: { text: 'Take your time - the battle pauses for you' }
      },
      components: rows,
      ephemeral: true
    };
  }

  /**
   * Validate if a user can take a combat action (it's their turn)
   * @param {string} channelId - Channel ID
   * @param {string} discordUserId - Discord user ID
   * @returns {{ valid: boolean, error?: string, encounter?: Object, combatant?: Object }}
   */
  validateUserCombatAction(channelId, discordUserId) {
    const encounter = this.getEncounterByChannelId(channelId);
    if (!encounter || encounter.state !== 'active') {
      return { valid: false, error: 'No active combat in this channel.' };
    }
    
    const currentId = this.getCurrentTurnAvatarId(encounter);
    const current = this.getCombatant(encounter, currentId);
    
    if (!current) {
      return { valid: false, error: 'Combat state error.' };
    }
    
    // Monsters cannot be controlled by players
    if (current.isMonster) {
      return { 
        valid: false, 
        error: `It's the enemy's turn! Current turn: ${current.name}`,
        currentTurnName: current.name
      };
    }
    
    // Check if this user controls the current turn's avatar
    // Support multiple ways a user can be linked to an avatar:
    // 1. summoner field starting with 'user:' (classic avatars)
    // 2. discordUserId field (party members in dungeons)
    // 3. ref.discordUserId (nested in original avatar data)
    let expectedUserId = null;
    
    // Check summoner field first
    if (current.ref?.summoner && String(current.ref.summoner).startsWith('user:')) {
      expectedUserId = String(current.ref.summoner).replace(/^user:/, '');
    }
    // Check discordUserId on the combatant itself
    else if (current.discordUserId) {
      expectedUserId = String(current.discordUserId);
    }
    // Check discordUserId nested in ref
    else if (current.ref?.discordUserId) {
      expectedUserId = String(current.ref.discordUserId);
    }
    
    // If expected user matches, allow the action
    if (expectedUserId && expectedUserId === discordUserId) {
      return { valid: true, encounter, combatant: current };
    }
    
    // FALLBACK: If the avatar has NO linked user (unclaimed party member),
    // allow any user to claim and control it by clicking the button.
    // This handles cases where avatars don't have summoner/discordUserId set.
    // RESTRICTION: Only allow claiming if:
    // 1. The user hasn't already been knocked out with another avatar
    // 2. The user hasn't already claimed a different avatar
    if (!expectedUserId && !current.isMonster) {
      encounter.claimedAvatars = encounter.claimedAvatars || {};
      encounter.defeatedPlayers = encounter.defeatedPlayers || {};
      
      // Check if this user's avatar was already knocked out - they can't claim another
      if (encounter.defeatedPlayers[discordUserId]) {
        const defeatedName = encounter.defeatedPlayers[discordUserId];
        return { 
          valid: false, 
          error: `Your avatar ${defeatedName} has fallen! You cannot control other party members.`,
          currentTurnName: current.name
        };
      }
      
      // Check if this user already controls a DIFFERENT avatar
      const userExistingClaim = Object.entries(encounter.claimedAvatars)
        .find(([avatarId, userId]) => userId === discordUserId && avatarId !== currentId);
      if (userExistingClaim) {
        const claimedAvatar = this.getCombatant(encounter, userExistingClaim[0]);
        return { 
          valid: false, 
          error: `You already control ${claimedAvatar?.name || 'another avatar'}. You cannot control multiple party members.`,
          currentTurnName: current.name
        };
      }
      
      // Check if another user has already claimed this specific avatar
      const existingClaimer = encounter.claimedAvatars[currentId];
      if (existingClaimer && existingClaimer !== discordUserId) {
        return { 
          valid: false, 
          error: `${current.name} is controlled by another player.`,
          currentTurnName: current.name
        };
      }
      
      // Claim this avatar for this user for the remainder of this encounter
      encounter.claimedAvatars[currentId] = discordUserId;
      current.discordUserId = discordUserId;
      current.isPlayerControlled = true;
      current.autoMode = false;
      
      this.logger?.info?.(`[CombatEncounter] User ${discordUserId} claimed control of unclaimed avatar ${current.name}`);
      return { valid: true, encounter, combatant: current };
    }
    
    return { 
      valid: false, 
      error: `It's not your turn! Current turn: ${current.name}`,
      currentTurnName: current.name
    };
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
    const completedEncounterRetentionMs = 24 * 60 * 60 * 1000; // 24 hours
    
    // Clean up completed encounters older than 24 hours
    let completedCleanedCount = 0;
    for (const [channelId, completed] of this.completedEncounters.entries()) {
      if (now - completed.endedAt > completedEncounterRetentionMs) {
        this.completedEncounters.delete(channelId);
        completedCleanedCount++;
        this.logger.info?.(`[CombatEncounter] Cleaned completed encounter channel=${channelId} age=${Math.floor((now - completed.endedAt) / 1000 / 60)}min`);
      }
    }
    
    if (completedCleanedCount > 0) {
      this.logger.info?.(`[CombatEncounter] Cleanup: removed ${completedCleanedCount} completed encounter(s), ${this.completedEncounters.size} retained`);
    }
    
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
      const staleThreshold = enc.policy?.staleEncounterMs || this.staleEncounterMs;
      const stale = !ended && enc.startedAt && (now - enc.startedAt > staleThreshold);
      
      if (ended || stale) {
        if (stale) {
          this.endEncounter(enc, { reason: 'stale' });
        }
        this._clearTimers(enc);
        this.encounters.delete(oldest.channelId);
        this.encountersByAge.shift();
        if (enc.parentChannelId) {
          this.encountersByParent.delete(enc.parentChannelId);
        }
        this._removeActiveEncounter(enc).catch(e => this.logger.warn?.(`[CombatEncounter] active delete failed: ${e.message}`));
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
          const currentId = this.getCurrentTurnAvatarId(enc);
          const current = currentId ? this.getCombatant(enc, currentId) : null;
          
          // V6 FIX: For player turns, don't skip their turn but DO re-announce
          // if the lock expired (the lock silently clears after 60s, leaving combat
          // stalled with no prompt). Re-announce so the player sees buttons again.
          // V7: Limit re-announces to 2 then auto-skip to keep combat moving.
          // V9 FIX: Also check COMPLETING/ADVANCING — the player may have just acted
          // and the turn is mid-processing. Don't skip or re-announce in that case.
          if (current?.isPlayerControlled && !current?.autoMode) {
            const lockState = this.turnLock.getState(channelId);
            // If lock is actively processing (EXECUTING/COMPLETING/ADVANCING), leave it alone
            if (lockState === TURN_STATES.EXECUTING || lockState === TURN_STATES.COMPLETING || lockState === TURN_STATES.ADVANCING) {
              continue;
            }
            if (lockState === TURN_STATES.IDLE || lockState === null) {
              enc._reannounceCount = (enc._reannounceCount || 0) + 1;
              if (enc._reannounceCount > 2) {
                // Too many re-announces — auto-skip this player's turn
                this.logger.warn?.(`[CombatEncounter][${channelId}] watchdog: auto-skipping ${current.name} after ${enc._reannounceCount} re-announces`);
                enc._reannounceCount = 0;
                void this._onTurnTimeout(enc);
              } else {
                // Lock expired — player's turn is still active but UI vanished
                this.logger.info?.(`[CombatEncounter][${channelId}] watchdog: re-announcing stalled player turn for ${current.name} (attempt ${enc._reannounceCount}/2)`);
                current.awaitingAction = true;
                this._scheduleTurnStart(enc, { isReannounce: true });
              }
            }
            // Otherwise player is still in a valid lock state (AWAITING_INPUT) — let them think
            continue;
          }
          
          // V9 FIX: If the lock is actively held (EXECUTING/COMPLETING/ADVANCING),
          // the turn is being processed — don't nudge.
          const monsterLockState = this.turnLock.getState(channelId);
          if (monsterLockState === TURN_STATES.EXECUTING || monsterLockState === TURN_STATES.COMPLETING || monsterLockState === TURN_STATES.ADVANCING) {
            continue;
          }
          
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
      
      // Sync maxHp from avatar stats but preserve combat currentHp
      // The combatant's currentHp is already tracked correctly during combat via applyDamage
      for (const c of encounter.combatants) {
        if (c.ref) {
          try {
            const freshStats = await this.avatarService?.getOrCreateStats?.(c.ref);
            if (freshStats?.hp) {
              c.maxHp = freshStats.hp;
              // DO NOT overwrite currentHp - it's already correctly tracked during combat
              // c.currentHp is reduced by applyDamage() and should not be reset from ref
            }
          } catch (e) {
            this.logger.debug?.(`[CombatEncounter] HP sync failed for ${c.name}: ${e.message}`);
          }
        }
      }
      
      const status = encounter.combatants.map(c => `${c.name}: ${c.currentHp}/${c.maxHp} HP`).join('\n');
      
      // Determine winner for victory dialogue
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
          
          const messages = [
            { role: 'system', content: 'You are a combat narrator. Generate brief, dramatic battle summaries.' },
            { role: 'user', content: prompt }
          ];
          
          const response = await this.unifiedAIService.chat(messages, {
            temperature: 0.8
          });
          
          if (response?.text) {
            const summary = String(response.text).trim().replace(/^["']|["']$/g, '').slice(0, 400);
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
      
      // Create "Generate Video" button
      const generateVideoButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`generate_battle_video_${encounter.channelId}`)
          .setLabel('🎬 Generate Battle Video')
          .setStyle(ButtonStyle.Primary)
      );
  // Capture any video URL we plan to post separately after the embed
  let _videoUrl = null;
  try {
        if (this.battleMediaService || this.battleService?.battleMediaService) {
          const bms = this.battleMediaService || this.battleService?.battleMediaService;
          const loc = await this.mapService?.getLocationAndAvatars?.(encounter.channelId).catch(()=>null);
          let media = encounter.knockoutMedia || null;
          
          // Determine winner/loser (works for both KO and non-KO)
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
          
          // Generate summary media if we don't have any yet
          if (!media || (!media.imageUrl && !media.videoUrl)) {
            try {
              media = await bms.generateSummaryMedia({
                winner: winnerC?.ref,
                loser: loserC?.ref,
                outcome,
                location: loc?.location
              });
              // Store summary media URL for video generation reuse
              if (media?.imageUrl) {
                encounter.summaryMediaUrl = media.imageUrl;
                // Also update the completedEncounters entry if it exists
                const completed = this.completedEncounters.get(encounter.channelId);
                if (completed) {
                  completed.summaryMediaUrl = media.imageUrl;
                  this.logger?.info?.(`[CombatEncounter] Updated completedEncounters with summaryMediaUrl`);
                }
              }
            } catch (e) {
              this.logger.warn?.(`[CombatEncounter] summary media generation failed: ${e.message}`);
            }
          }
          
          // Fallback to fight poster if summary failed
          if ((!media || (!media.imageUrl && !media.videoUrl)) && bms?.generateFightPoster) {
            try {
              const attacker = winnerC?.ref || encounter.combatants?.[0]?.ref;
              const defender = loserC?.ref || encounter.combatants?.[1]?.ref || attacker;
              const poster = await bms.generateFightPoster({ attacker, defender, location: loc?.location });
              if (poster?.imageUrl) media = { imageUrl: poster.imageUrl };
            } catch (e) {
              this.logger.warn?.(`[CombatEncounter] fight poster fallback failed: ${e.message}`);
            }
          }

          // Attach media if any
          if (media?.imageUrl) {
            embed.image = { url: media.imageUrl };
            // Store summary media URL if we have media and haven't stored it yet
            if (!encounter.summaryMediaUrl) {
              encounter.summaryMediaUrl = media.imageUrl;
              // Also update the completedEncounters entry if it exists
              const completed = this.completedEncounters.get(encounter.channelId);
              if (completed) {
                completed.summaryMediaUrl = media.imageUrl;
                this.logger?.info?.(`[CombatEncounter] Updated completedEncounters with summaryMediaUrl (fallback)`);
              }
            }
          }
          // Do not attach video inside the embed; post it separately for reliable inline playback
          _videoUrl = media?.videoUrl || null;
          // Fallback to avatar image if no generated image
          if (!embed.image && (winnerC?.ref?.imageUrl || loserC?.ref?.imageUrl)) {
            embed.image = { url: winnerC?.ref?.imageUrl || loserC?.ref?.imageUrl };
          }
        }
      } catch (e) {
        this.logger.warn?.(`[CombatEncounter] summary media failed: ${e.message}`);
      }
  // Send the embed with "Generate Video" button
  await channel.send({ 
    embeds: [embed],
    components: [generateVideoButton]
  });
  
  // Post winner's victory dialogue
  if (winnerC && winnerC.ref) {
    await this._postVictoryDialogue(encounter, winnerC);
  }
  
  // Then, if a video URL exists, post it as a separate message so the client can inline it
  try {
    if (typeof _videoUrl === 'string' && _videoUrl.length > 0) {
      await channel.send({ content: `🎬 [Watch Final Clip](${_videoUrl})` });
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
        // Store summary media URL for video generation reuse
        if (media.imageUrl) {
          encounter.summaryMediaUrl = media.imageUrl;
          // Also update the completedEncounters entry if it exists
          const completed = this.completedEncounters.get(encounter.channelId);
          if (completed) {
            completed.summaryMediaUrl = media.imageUrl;
            this.logger?.info?.(`[CombatEncounter] Updated completedEncounters with summaryMediaUrl (knockout)`);
          }
        }
        
        // Post media as follow-up message
        try {
          const channel = this._getChannel(encounter);
          if (channel?.send) {
            if (media.videoUrl) {
              await channel.send({ content: `🎬 [Watch Finishing Move](${media.videoUrl})` });
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
        
        // V3: Emit round advanced event for UI sync
        eventBus.emit('combat.round.advanced', {
          channelId: encounter.channelId,
          encounterId: encounter.encounterId,
          round: encounter.round
        });
        
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
      // Apply index
      encounter.currentTurnIndex = nextIdx;
      
      // V9 FIX: Release any lingering lock before scheduling the next turn.
      // Without this, the lock can remain in COMPLETING/ADVANCING from the previous
      // action, causing _scheduleTurnStart to silently bail via isLocked() — which
      // is why monsters would time out for 60s doing nothing.
      const channelId = encounter.channelId;
      if (this.turnLock.isLocked(channelId)) {
        this.turnLock.release(channelId, 'nextTurn_pre_schedule');
      }
      
      // Start the turn - _scheduleTurnStart handles turn announcement
      this._scheduleTurnStart(encounter);
      this._persistActiveEncounter(encounter).catch(e => this.logger.warn?.(`[CombatEncounter] active persist failed: ${e.message}`));
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
      
      // Turn timed out - skip this turn (D&D style: if you don't act, you lose your turn)
      this.logger.info?.(`[CombatEncounter][${encounter.channelId}] Turn timeout for ${actor.name} - skipping turn`);
      await this.nextTurn(encounter);
      
    } catch (e) {
      this.logger?.warn?.(`[CombatEncounter] onTurnTimeout error: ${e.message}`);
    }
  }

  // ============ Status Effect Public API ============

  /**
   * Apply a status effect to a combatant in the current encounter
   * @param {string} channelId - Channel ID of the encounter
   * @param {string} avatarId - Avatar ID of the target
   * @param {string} effectId - Status effect ID (see StatusEffectService)
   * @param {string} sourceId - Avatar ID of the source
   * @param {Object} options - Additional options (duration, stacks)
   * @returns {Object} Result of application
   */
  applyStatusEffect(channelId, avatarId, effectId, sourceId, options = {}) {
    const encounter = this.getEncounter(channelId);
    if (!encounter || encounter.state !== 'active') {
      return { success: false, reason: 'no_active_encounter' };
    }
    
    const combatant = this.getCombatant(encounter, avatarId);
    if (!combatant) {
      return { success: false, reason: 'combatant_not_found' };
    }
    
    return this.statusEffectService.applyEffect(combatant, effectId, sourceId, {
      ...options,
      round: encounter.round
    });
  }

  /**
   * Remove a status effect from a combatant
   * @param {string} channelId - Channel ID of the encounter
   * @param {string} avatarId - Avatar ID of the target
   * @param {string} effectId - Status effect ID to remove
   * @returns {boolean} Whether effect was removed
   */
  removeStatusEffect(channelId, avatarId, effectId) {
    const encounter = this.getEncounter(channelId);
    if (!encounter) return false;
    
    const combatant = this.getCombatant(encounter, avatarId);
    if (!combatant) return false;
    
    return this.statusEffectService.removeEffect(combatant, effectId);
  }

  /**
   * Get status summary for a combatant (emoji icons)
   * @param {string} channelId - Channel ID of the encounter
   * @param {string} avatarId - Avatar ID of the target
   * @returns {string} Status effect emoji summary
   */
  getStatusSummary(channelId, avatarId) {
    const encounter = this.getEncounter(channelId);
    if (!encounter) return '';
    
    const combatant = this.getCombatant(encounter, avatarId);
    if (!combatant) return '';
    
    return this.statusEffectService.getStatusSummary(combatant);
  }

  /**
   * Check if combatant has a specific status effect
   * @param {string} channelId - Channel ID of the encounter
   * @param {string} avatarId - Avatar ID of the target
   * @param {string} effectId - Status effect ID to check
   * @returns {boolean}
   */
  hasStatusEffect(channelId, avatarId, effectId) {
    const encounter = this.getEncounter(channelId);
    if (!encounter) return false;
    
    const combatant = this.getCombatant(encounter, avatarId);
    if (!combatant) return false;
    
    return this.statusEffectService.hasEffect(combatant, effectId);
  }

  /**
   * Get the CombatAIService instance for external use
   * @returns {CombatAIService}
   */
  getCombatAIService() {
    return this.combatAIService;
  }

  /**
   * Get the StatusEffectService instance for external use
   * @returns {StatusEffectService}
   */
  getStatusEffectService() {
    return this.statusEffectService;
  }

  /**
   * Get the CombatMessagingService instance for external use
   * @returns {CombatMessagingService}
   */
  getCombatMessagingService() {
    return this.combatMessagingService;
  }
}

// Re-export sub-services for external use
export { CombatAIService } from './combatAIService.mjs';
export { CombatMessagingService } from './combatMessagingService.mjs';
export { StatusEffectService, STATUS_EFFECTS } from './statusEffectService.mjs';

export default CombatEncounterService;
