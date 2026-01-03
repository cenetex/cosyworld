/**
 * CombatLogService - Persists combat actions to MongoDB for replay and analytics
 * 
 * Features:
 * - Logs all combat actions with timestamps
 * - Stores HP snapshots after each action
 * - Enables combat replay and analytics
 * - Supports encounter-level aggregation
 * 
 * @module services/battle/CombatLogService
 */

export class CombatLogService {
  /**
   * @param {Object} deps - Dependencies
   * @param {Object} deps.databaseService - Database service for MongoDB operations
   * @param {Object} [deps.logger] - Optional logger
   */
  constructor({ databaseService, logger }) {
    this.databaseService = databaseService;
    this.logger = logger;
    this._indexesCreated = false;
  }

  /**
   * Get the combat_logs collection with indexes
   * @returns {Promise<Collection>}
   */
  async collection() {
    const db = await this.databaseService.getDatabase();
    const col = db.collection('combat_logs');

    if (!this._indexesCreated) {
      try {
        await col.createIndexes([
          { key: { encounterId: 1, timestamp: 1 } },
          { key: { channelId: 1, timestamp: -1 } },
          { key: { 'action.actorId': 1 } },
          { key: { timestamp: -1 } },
          // TTL index to auto-delete logs older than 30 days
          { key: { timestamp: 1 }, expireAfterSeconds: 30 * 24 * 60 * 60 }
        ]);
        this._indexesCreated = true;
      } catch (err) {
        this.logger?.warn?.('[CombatLogService] Index creation failed:', err.message);
      }
    }

    return col;
  }

  /**
   * Log a combat action
   * @param {Object} params - Log parameters
   * @param {Object} params.encounter - The combat encounter
   * @param {Object} params.combatant - The acting combatant
   * @param {Object} params.action - The action taken
   * @param {Object} params.result - Action result
   * @param {string} [params.dialogue] - Optional dialogue
   * @returns {Promise<Object>} The inserted log entry
   */
  async logAction({ encounter, combatant, action, result, dialogue }) {
    if (!encounter || !combatant || !action) {
      this.logger?.debug?.('[CombatLogService] Skipping log - missing required fields');
      return null;
    }

    try {
      const col = await this.collection();

      // Build HP snapshot of all combatants
      const hpSnapshot = (encounter.combatants || []).map(c => ({
        avatarId: c.avatarId,
        name: c.name,
        currentHp: c.currentHp,
        maxHp: c.maxHp,
        isMonster: c.isMonster || false
      }));

      const logEntry = {
        encounterId: encounter.encounterId || encounter.id,
        channelId: encounter.channelId,
        dungeonId: encounter.dungeonContext?.dungeonId || null,
        roomId: encounter.dungeonContext?.roomId || null,
        round: encounter.round || 1,
        turn: encounter.currentTurnIndex || 0,
        timestamp: new Date(),
        action: {
          type: action.type,
          actorId: combatant.avatarId,
          actorName: combatant.name,
          targetId: action.target?.avatarId || null,
          targetName: action.target?.name || null,
          details: this._extractActionDetails(action)
        },
        result: {
          hit: result?.result === 'hit' || result?.result === 'knockout' || result?.result === 'dead',
          damage: result?.damage || 0,
          critical: result?.critical || false,
          attackRoll: result?.attackRoll || null,
          targetAC: result?.armorClass || result?.targetAC || null,
          outcome: result?.result || 'unknown'
        },
        dialogue: dialogue || null,
        hpSnapshot
      };

      await col.insertOne(logEntry);
      this.logger?.debug?.(`[CombatLogService] Logged ${action.type} by ${combatant.name}`);

      return logEntry;
    } catch (err) {
      this.logger?.error?.('[CombatLogService] Failed to log action:', err.message);
      return null;
    }
  }

  /**
   * Log encounter start
   * @param {Object} encounter - The combat encounter
   * @returns {Promise<Object>}
   */
  async logEncounterStart(encounter) {
    try {
      const col = await this.collection();

      const logEntry = {
        encounterId: encounter.encounterId || encounter.id,
        channelId: encounter.channelId,
        dungeonId: encounter.dungeonContext?.dungeonId || null,
        roomId: encounter.dungeonContext?.roomId || null,
        round: 0,
        turn: 0,
        timestamp: new Date(),
        action: {
          type: 'encounter_start',
          actorId: null,
          actorName: 'System',
          targetId: null,
          targetName: null,
          details: {
            participantCount: encounter.combatants?.length || 0,
            participants: (encounter.combatants || []).map(c => ({
              name: c.name,
              isMonster: c.isMonster || false,
              hp: c.maxHp
            }))
          }
        },
        result: { hit: false, damage: 0, critical: false },
        hpSnapshot: (encounter.combatants || []).map(c => ({
          avatarId: c.avatarId,
          name: c.name,
          currentHp: c.currentHp,
          maxHp: c.maxHp,
          isMonster: c.isMonster || false
        }))
      };

      await col.insertOne(logEntry);
      this.logger?.debug?.('[CombatLogService] Logged encounter start');

      return logEntry;
    } catch (err) {
      this.logger?.error?.('[CombatLogService] Failed to log encounter start:', err.message);
      return null;
    }
  }

  /**
   * Log encounter end
   * @param {Object} encounter - The combat encounter
   * @param {Object} result - End result (winner, outcome)
   * @returns {Promise<Object>}
   */
  async logEncounterEnd(encounter, result = {}) {
    try {
      const col = await this.collection();

      const logEntry = {
        encounterId: encounter.encounterId || encounter.id,
        channelId: encounter.channelId,
        dungeonId: encounter.dungeonContext?.dungeonId || null,
        roomId: encounter.dungeonContext?.roomId || null,
        round: encounter.round || 1,
        turn: encounter.currentTurnIndex || 0,
        timestamp: new Date(),
        action: {
          type: 'encounter_end',
          actorId: null,
          actorName: 'System',
          targetId: null,
          targetName: null,
          details: {
            outcome: result.outcome || 'unknown',
            totalRounds: encounter.round || 1,
            winners: result.winners?.map(w => w.name) || [],
            xpAwarded: result.xpAwarded || 0
          }
        },
        result: { hit: false, damage: 0, critical: false },
        hpSnapshot: (encounter.combatants || []).map(c => ({
          avatarId: c.avatarId,
          name: c.name,
          currentHp: c.currentHp,
          maxHp: c.maxHp,
          isMonster: c.isMonster || false
        }))
      };

      await col.insertOne(logEntry);
      this.logger?.debug?.('[CombatLogService] Logged encounter end');

      return logEntry;
    } catch (err) {
      this.logger?.error?.('[CombatLogService] Failed to log encounter end:', err.message);
      return null;
    }
  }

  /**
   * Get combat log for an encounter
   * @param {string} encounterId - The encounter ID
   * @returns {Promise<Array>} Array of log entries
   */
  async getEncounterLog(encounterId) {
    const col = await this.collection();
    return col.find({ encounterId }).sort({ timestamp: 1 }).toArray();
  }

  /**
   * Get recent combat logs for a channel
   * @param {string} channelId - The channel ID
   * @param {number} [limit=50] - Maximum entries to return
   * @returns {Promise<Array>}
   */
  async getChannelLogs(channelId, limit = 50) {
    const col = await this.collection();
    return col.find({ channelId }).sort({ timestamp: -1 }).limit(limit).toArray();
  }

  /**
   * Get combat statistics for an avatar
   * @param {string} avatarId - The avatar ID
   * @returns {Promise<Object>} Stats including total damage, kills, etc.
   */
  async getAvatarStats(avatarId) {
    const col = await this.collection();

    const pipeline = [
      { $match: { 'action.actorId': avatarId, 'action.type': 'attack' } },
      {
        $group: {
          _id: '$action.actorId',
          totalAttacks: { $sum: 1 },
          totalHits: { $sum: { $cond: ['$result.hit', 1, 0] } },
          totalDamage: { $sum: '$result.damage' },
          criticalHits: { $sum: { $cond: ['$result.critical', 1, 0] } },
          knockouts: { $sum: { $cond: [{ $eq: ['$result.outcome', 'knockout'] }, 1, 0] } }
        }
      }
    ];

    const results = await col.aggregate(pipeline).toArray();
    return results[0] || {
      totalAttacks: 0,
      totalHits: 0,
      totalDamage: 0,
      criticalHits: 0,
      knockouts: 0
    };
  }

  /**
   * Extract relevant details from action object
   * @private
   */
  _extractActionDetails(action) {
    const details = {};

    if (action.type === 'attack') {
      details.attackType = action.attackType || 'melee';
    } else if (action.type === 'cast') {
      details.spellName = action.spellName || action.spell?.name;
      details.spellLevel = action.spellLevel || action.spell?.level;
    } else if (action.type === 'defend') {
      details.defenseType = action.defenseType || 'dodge';
    } else if (action.type === 'flee') {
      details.success = action.success;
    }

    return details;
  }
}

export default CombatLogService;
