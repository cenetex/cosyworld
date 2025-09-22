/**
 * GuildConnectionRepository
 * Encapsulates persistence logic for connected and detected guilds.
 */
export class GuildConnectionRepository {
  constructor({ databaseService, logger }) {
    this.databaseService = databaseService;
    this.logger = logger || console;
  }

  async _db() {
    return await this.databaseService.getDatabase();
  }

  async upsertConnectedGuilds(guilds = []) {
    if (!Array.isArray(guilds) || guilds.length === 0) return 0;
    const db = await this._db();
    const collection = db.collection('connected_guilds');
    const bulkOps = guilds.map(g => ({
      updateOne: {
        filter: { id: g.id },
        update: { $set: g },
        upsert: true
      }
    }));
    const res = await collection.bulkWrite(bulkOps);
    return res.upsertedCount + (res.modifiedCount || 0);
  }

  async upsertDetectedGuilds(guilds = []) {
    if (!Array.isArray(guilds) || guilds.length === 0) return 0;
    const db = await this._db();
    const collection = db.collection('detected_guilds');
    const bulkOps = guilds.map(g => ({
      updateOne: {
        filter: { id: g.id },
        update: { $set: g },
        upsert: true
      }
    }));
    const res = await collection.bulkWrite(bulkOps);
    return res.upsertedCount + (res.modifiedCount || 0);
  }

  async removeConnectedGuild(id) {
    if (!id) return 0;
    const db = await this._db();
    const res = await db.collection('connected_guilds').deleteOne({ id });
    return res.deletedCount || 0;
  }
}

export default GuildConnectionRepository;
