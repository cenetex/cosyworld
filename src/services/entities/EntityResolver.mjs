/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * EntityResolver
 * 
 * Provides unified entity resolution across different game contexts.
 * Handles avatars, combat monsters, dungeon NPCs, and other game entities.
 * 
 * This service abstracts the complexity of finding entities that may exist
 * in different systems (avatar DB, active combat, dungeon state, etc.)
 */
export class EntityResolver {
  constructor({ avatarService, combatEncounterService, mapService, dungeonService, logger }) {
    this.avatarService = avatarService;
    this.combatEncounterService = combatEncounterService;
    this.mapService = mapService;
    this.dungeonService = dungeonService;
    this.logger = logger || console;
  }

  /**
   * Resolve an entity by name in a given channel context
   * Works for avatars, monsters, NPCs, etc.
   * 
   * @param {string} channelId - Discord channel ID
   * @param {string} name - Entity name to search for
   * @param {Object} options - Resolution options
   * @param {string[]} options.excludeIds - IDs to exclude from results
   * @param {boolean} options.requireAlive - Only return living entities (default: true)
   * @param {boolean} options.preferCombat - Prioritize combat targets (default: true)
   * @returns {Promise<{type: string, entity: Object}|null>}
   */
  async resolve(channelId, name, options = {}) {
    const { excludeIds = [], requireAlive = true, preferCombat = true } = options;
    
    if (!name || !channelId) {
      return null;
    }

    // Priority 1: Active combat targets (most specific context)
    if (preferCombat) {
      const combatTarget = this._resolveCombatTarget(channelId, name, excludeIds, requireAlive);
      if (combatTarget) {
        this.logger?.debug?.(`[EntityResolver] Found combat target: ${combatTarget.name}`);
        return { type: 'combatant', entity: combatTarget };
      }
    }

    // Priority 2: Location-based avatars
    try {
      const locationResult = await this.mapService?.getLocationAndAvatars?.(channelId);
      if (locationResult?.avatars?.length) {
        const avatar = this._matchByName(locationResult.avatars, name, excludeIds);
        if (avatar) {
          this.logger?.debug?.(`[EntityResolver] Found location avatar: ${avatar.name}`);
          return { type: 'avatar', entity: avatar };
        }
      }
    } catch (e) {
      this.logger?.debug?.(`[EntityResolver] Location lookup failed: ${e.message}`);
    }

    // Priority 3: Check dungeon room monsters (not yet in combat)
    const dungeonMonster = await this._resolveDungeonMonster(channelId, name, excludeIds);
    if (dungeonMonster) {
      this.logger?.debug?.(`[EntityResolver] Found dungeon monster: ${dungeonMonster.name}`);
      return { type: 'dungeon_monster', entity: dungeonMonster };
    }

    // Priority 4: Global avatar search (fallback)
    if (this.avatarService?.findAvatarByName) {
      try {
        const avatar = await this.avatarService.findAvatarByName(name);
        if (avatar && !excludeIds.includes(String(avatar._id || avatar.id))) {
          this.logger?.debug?.(`[EntityResolver] Found global avatar: ${avatar.name}`);
          return { type: 'avatar', entity: avatar };
        }
      } catch (e) {
        this.logger?.debug?.(`[EntityResolver] Global avatar search failed: ${e.message}`);
      }
    }

    return null;
  }

  /**
   * Resolve multiple entities by names
   * @param {string} channelId 
   * @param {string[]} names 
   * @param {Object} options 
   * @returns {Promise<Array<{type: string, entity: Object}>>}
   */
  async resolveMany(channelId, names, options = {}) {
    const results = [];
    const foundIds = [...(options.excludeIds || [])];

    for (const name of names) {
      const result = await this.resolve(channelId, name, { ...options, excludeIds: foundIds });
      if (result) {
        results.push(result);
        const id = String(result.entity._id || result.entity.id || result.entity.avatarId || '');
        if (id) foundIds.push(id);
      }
    }

    return results;
  }

  /**
   * Get all valid targets in a channel context
   * @param {string} channelId 
   * @param {Object} options 
   * @returns {Promise<Array<{type: string, entity: Object}>>}
   */
  async getAllTargets(channelId, options = {}) {
    const { excludeIds = [], requireAlive = true, includeCombat = true, includeAvatars = true } = options;
    const targets = [];
    const seenIds = new Set(excludeIds);

    // Combat targets
    if (includeCombat) {
      const encounter = this.combatEncounterService?.getEncounterByChannelId?.(channelId);
      if (encounter?.state === 'active') {
        for (const c of encounter.combatants) {
          const id = String(c.avatarId || c.id || '');
          if (seenIds.has(id)) continue;
          if (requireAlive && c.currentHp <= 0) continue;
          
          seenIds.add(id);
          targets.push({ type: 'combatant', entity: c });
        }
      }
    }

    // Location avatars
    if (includeAvatars) {
      try {
        const locationResult = await this.mapService?.getLocationAndAvatars?.(channelId);
        if (locationResult?.avatars?.length) {
          for (const a of locationResult.avatars) {
            const id = String(a._id || a.id || '');
            if (seenIds.has(id)) continue;
            
            seenIds.add(id);
            targets.push({ type: 'avatar', entity: a });
          }
        }
      } catch (_e) {
        // Ignore
      }
    }

    return targets;
  }

  /**
   * Resolve combat target from active encounter
   * @private
   */
  _resolveCombatTarget(channelId, name, excludeIds, requireAlive) {
    const encounter = this.combatEncounterService?.getEncounterByChannelId?.(channelId);
    if (!encounter || encounter.state !== 'active') return null;

    const searchLower = (name || '').toLowerCase().trim();
    if (!searchLower) return null;
    
    // Exact match first
    let match = encounter.combatants.find(c => {
      if (excludeIds.includes(String(c.avatarId || c.id))) return false;
      if (requireAlive && c.currentHp <= 0) return false;
      return (c.name || '').toLowerCase() === searchLower;
    });

    if (match) return match;

    // Partial match (contains)
    match = encounter.combatants.find(c => {
      if (excludeIds.includes(String(c.avatarId || c.id))) return false;
      if (requireAlive && c.currentHp <= 0) return false;
      
      const cName = (c.name || '').toLowerCase();
      return cName.includes(searchLower) || searchLower.includes(cName);
    });

    return match || null;
  }

  /**
   * Resolve dungeon monster that may not be in combat yet
   * @private
   */
  async _resolveDungeonMonster(channelId, name, excludeIds) {
    if (!this.dungeonService) return null;

    try {
      const dungeonState = await this.dungeonService.getDungeonByChannelId?.(channelId);
      if (!dungeonState?.currentRoom?.monsters) return null;

      const searchLower = (name || '').toLowerCase().trim();
      
      return dungeonState.currentRoom.monsters.find(m => {
        if (excludeIds.includes(String(m.id || m._id))) return false;
        const mName = (m.name || '').toLowerCase();
        return mName === searchLower || mName.includes(searchLower) || searchLower.includes(mName);
      }) || null;
    } catch (_e) {
      return null;
    }
  }

  /**
   * Match entity by name in a list
   * @private
   */
  _matchByName(entities, name, excludeIds) {
    if (!entities?.length || !name) return null;
    
    const searchLower = name.toLowerCase().trim();
    
    // Exact match
    let match = entities.find(e => {
      const id = String(e._id || e.id || '');
      if (excludeIds.includes(id)) return false;
      return (e.name || '').toLowerCase() === searchLower;
    });

    if (match) return match;

    // Partial match
    match = entities.find(e => {
      const id = String(e._id || e.id || '');
      if (excludeIds.includes(id)) return false;
      
      const eName = (e.name || '').toLowerCase();
      return eName.includes(searchLower) || searchLower.includes(eName);
    });

    return match || null;
  }

  /**
   * Health check
   */
  async ping() {
    return { ok: true, service: 'EntityResolver' };
  }
}
