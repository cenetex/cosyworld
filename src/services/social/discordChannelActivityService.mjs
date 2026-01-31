/**
 * Copyright (c) 2019-2026 Cenetex Inc.
 * Licensed under the MIT License.
 */

export class DiscordChannelActivityService {
  constructor({ logger, databaseService }) {
    this.logger = logger || console;
    this.databaseService = databaseService;

    this.inactiveDays = (() => {
      const raw = Number(process.env.DISCORD_AI_INACTIVE_DAYS || 0);
      if (!Number.isNaN(raw) && raw >= 0) return raw;
      return 0;
    })();

    this._col = null;
  }

  async _getCollection() {
    if (this._col) return this._col;
    const db = await this.databaseService.getDatabase();
    this._col = db.collection('discord_channel_activity');
    await Promise.all([
      this._col.createIndex({ guildId: 1, channelId: 1 }, { unique: true }),
      this._col.createIndex({ lastHumanAt: 1 }),
    ]);
    return this._col;
  }

  async recordHumanActivity({ guildId, channelId, userId = null, messageId = null, at = new Date() }) {
    if (!guildId || !channelId) return;
    const col = await this._getCollection();
    await col.updateOne(
      { guildId: String(guildId), channelId: String(channelId) },
      {
        $set: {
          lastHumanAt: at instanceof Date ? at : new Date(at),
          lastHumanUserId: userId ? String(userId) : null,
          lastHumanMessageId: messageId ? String(messageId) : null,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          guildId: String(guildId),
          channelId: String(channelId),
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  async getLastHumanAt({ guildId, channelId }) {
    if (!guildId || !channelId) return null;
    const col = await this._getCollection();
    const doc = await col.findOne(
      { guildId: String(guildId), channelId: String(channelId) },
      { projection: { lastHumanAt: 1 } }
    );
    return doc?.lastHumanAt ? new Date(doc.lastHumanAt) : null;
  }

  async isChannelActiveForAI({ guildId, channelId, now = Date.now() }) {
    // If disabled (0), always active.
    if (!this.inactiveDays || this.inactiveDays <= 0) return true;

    // Only apply to guild channels.
    if (!guildId || !channelId) return true;

    const lastHumanAt = await this.getLastHumanAt({ guildId, channelId });
    if (!lastHumanAt) return false;

    const cutoffMs = this.inactiveDays * 24 * 60 * 60 * 1000;
    return (now - lastHumanAt.getTime()) <= cutoffMs;
  }
}

export default DiscordChannelActivityService;
