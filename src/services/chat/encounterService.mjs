/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { randomUUID } from 'crypto';

/**
 * EncounterService
 * 
 * Manages the state of conversational "encounters" in channels.
 * Implements a D&D-style initiative system where avatars roll for turn order.
 */
export class EncounterService {
  constructor({
    logger,
    databaseService,
    avatarService,
    presenceService,
    configService
  }) {
    this.logger = logger || console;
    this.databaseService = databaseService;
    this.avatarService = avatarService;
    this.presenceService = presenceService;
    this.configService = configService;

    // Configuration
    this.ENCOUNTER_TIMEOUT_MS = Number(process.env.ENCOUNTER_TIMEOUT_MS || 5 * 60 * 1000); // 5 minutes inactivity
    this.MAX_PARTICIPANTS = Number(process.env.ENCOUNTER_MAX_PARTICIPANTS || 10);
    
    // In-memory cache for active encounters (could be moved to DB/Redis for persistence)
    // key: channelId -> EncounterState
    this.activeEncounters = new Map();
  }

  /**
   * Get the active encounter for a channel, or null if none
   * @param {string} channelId 
   * @returns {Object|null}
   */
  getEncounter(channelId) {
    const encounter = this.activeEncounters.get(channelId);
    if (!encounter) return null;

    // Check for timeout
    if (Date.now() - encounter.lastTurnAt > this.ENCOUNTER_TIMEOUT_MS) {
      this.endEncounter(channelId, 'timeout');
      return null;
    }

    return encounter;
  }

  /**
   * Start a new encounter in a channel
   * @param {string} channelId 
   * @param {Array<Object>} initialAvatars - List of avatar objects
   * @param {Object} context - Additional context (trigger type, etc.)
   * @returns {Promise<Object>} The new encounter state
   */
  async startEncounter(channelId, initialAvatars, context = {}) {
    this.logger.info?.(`[EncounterService] Starting new encounter in ${channelId} with ${initialAvatars.length} avatars`);

    const participants = [];
    
    for (const avatar of initialAvatars) {
      const initiative = await this.avatarService.rollInitiative(avatar);
      participants.push({
        avatarId: String(avatar._id || avatar.id),
        name: avatar.name,
        initiative,
        joinedAt: Date.now(),
        lastActedAt: 0,
        turnsTaken: 0
      });
    }

    // Sort by initiative (descending)
    participants.sort((a, b) => b.initiative - a.initiative);

    const encounter = {
      id: randomUUID(),
      channelId,
      status: 'active',
      startedAt: Date.now(),
      lastTurnAt: Date.now(),
      round: 1,
      currentTurnIndex: 0,
      participants,
      context
    };

    this.activeEncounters.set(channelId, encounter);
    
    // Log the order
    const orderStr = participants.map(p => `${p.name} (${p.initiative})`).join(' -> ');
    this.logger.info?.(`[EncounterService] Initiative Order: ${orderStr}`);

    return encounter;
  }

  /**
   * Add an avatar to an existing encounter
   * @param {string} channelId 
   * @param {Object} avatar 
   * @returns {Promise<Object>} Updated encounter
   */
  async joinEncounter(channelId, avatar) {
    const encounter = this.getEncounter(channelId);
    if (!encounter) return null;

    const avatarId = String(avatar._id || avatar.id);
    
    // Check if already participating
    if (encounter.participants.some(p => p.avatarId === avatarId)) {
      return encounter;
    }

    if (encounter.participants.length >= this.MAX_PARTICIPANTS) {
      this.logger.warn?.(`[EncounterService] Encounter full in ${channelId}`);
      return encounter;
    }

    const initiative = await this.avatarService.rollInitiative(avatar);
    
    // Insert into sorted list
    const newParticipant = {
      avatarId,
      name: avatar.name,
      initiative,
      joinedAt: Date.now(),
      lastActedAt: 0,
      turnsTaken: 0
    };

    encounter.participants.push(newParticipant);
    encounter.participants.sort((a, b) => b.initiative - a.initiative);
    
    // Adjust currentTurnIndex if insertion happened before current index
    // This is complex, for simplicity we might just let them wait for next round
    // or just re-sort. If we re-sort, the current turn might jump.
    // For now, simple re-sort.
    
    this.logger.info?.(`[EncounterService] ${avatar.name} joined encounter in ${channelId} (Init: ${initiative})`);
    
    return encounter;
  }

  /**
   * Get the participant whose turn it is
   * @param {string} channelId 
   * @returns {Object|null} Participant object
   */
  getCurrentTurn(channelId) {
    const encounter = this.getEncounter(channelId);
    if (!encounter || encounter.participants.length === 0) return null;

    return encounter.participants[encounter.currentTurnIndex];
  }

  /**
   * Advance to the next turn
   * @param {string} channelId 
   * @returns {Object} The NEXT participant
   */
  nextTurn(channelId) {
    const encounter = this.getEncounter(channelId);
    if (!encounter) return null;

    encounter.currentTurnIndex++;
    encounter.lastTurnAt = Date.now();

    // Wrap around for new round
    if (encounter.currentTurnIndex >= encounter.participants.length) {
      encounter.currentTurnIndex = 0;
      encounter.round++;
      this.logger.debug?.(`[EncounterService] Round ${encounter.round} started in ${channelId}`);
    }

    return this.getCurrentTurn(channelId);
  }

  /**
   * End an encounter
   * @param {string} channelId 
   * @param {string} reason 
   */
  endEncounter(channelId, reason = 'manual') {
    if (this.activeEncounters.has(channelId)) {
      this.logger.info?.(`[EncounterService] Ending encounter in ${channelId} (Reason: ${reason})`);
      this.activeEncounters.delete(channelId);
    }
  }

  /**
   * Check if an avatar is currently in an encounter in this channel
   */
  isParticipating(channelId, avatarId) {
    const encounter = this.getEncounter(channelId);
    if (!encounter) return false;
    return encounter.participants.some(p => p.avatarId === String(avatarId));
  }
}
