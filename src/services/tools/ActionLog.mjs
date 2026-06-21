/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

export class ActionLog {
  constructor({ logger, databaseService } = {}) {
    this.logger = logger || console;
    this.databaseService = databaseService || null;
  }

  async collection() {
    const db = await this.databaseService?.getDatabase?.();
    if (!db) throw new Error('Database unavailable');
    return db.collection('dungeon_log');
  }

  async logAction(action) {
    try {
      const logEntry = {
        channelId: action.channelId,
        action: action.action,
        actorId: action.actorId,
        actorName: action.actorName,
        displayName: action.displayName || action.actorName,
        target: action.target,
        result: action.result,
        memory: action.memory, // Added memory field
        metadata: {
          tool: action.tool || null,
          emoji: action.emoji || null,
          isCustom: action.isCustom || false
        },
        timestamp: Date.now()
      };

      await (await this.collection()).insertOne(logEntry);
    } catch (error) {
      this.logger.error(`Error logging dungeon action: ${error.message}`);
    }
  }

  async getRecentActions(channelId, limit = 5) {
    try {
      return await (await this.collection())
        .find({ channelId })
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();
    } catch (error) {
      this.logger.error(`Error retrieving dungeon actions: ${error.message}`);
      return [];
    }
  }
}
