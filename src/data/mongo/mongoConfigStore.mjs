export class MongoConfigStore {
  constructor({ databaseService, logger }) {
    this.databaseService = databaseService;
    this.logger = logger || console;
    this.db = null;
  }

  async initialize() {
    this.db = this.db || await this.databaseService.getDatabase();
    if (!this.db) throw new Error('MongoDB unavailable');
    await this.db.collection('system_setup').createIndex({ key: 1 }, { unique: true });
    await this.db.collection('guild_configs').createIndex({ guildId: 1 }, { unique: true });
    await this.db.collection('settings').createIndex({ key: 1, scope: 1 }, { unique: false });
  }

  async _db() {
    if (!this.db) await this.initialize();
    return this.db;
  }

  async getSetupStatus() {
    const db = await this._db();
    const doc = await db.collection('system_setup').findOne({ key: 'setup_complete' });

    if (doc?.value === true || doc?.setupComplete === true) {
      return {
        setupComplete: true,
        adminWallet: doc.adminWallet || null,
        setupDate: doc.setupDate || null,
        lastModified: doc.lastModified || null
      };
    }

    return {
      setupComplete: false,
      adminWallet: null,
      setupDate: null
    };
  }

  async markSetupComplete({ adminWallet, completedAt = new Date() } = {}) {
    const db = await this._db();
    await db.collection('system_setup').updateOne(
      { key: 'setup_complete' },
      {
        $set: {
          key: 'setup_complete',
          value: true,
          setupComplete: true,
          adminWallet: adminWallet || null,
          setupDate: completedAt,
          lastModified: new Date()
        }
      },
      { upsert: true }
    );
    return true;
  }

  async resetSetup() {
    const db = await this._db();
    await db.collection('system_setup').deleteOne({ key: 'setup_complete' });
    return true;
  }

  async updateAdminWallet(newWallet) {
    const db = await this._db();
    await db.collection('system_setup').updateOne(
      { key: 'setup_complete' },
      {
        $set: {
          adminWallet: newWallet || null,
          lastModified: new Date()
        },
        $setOnInsert: {
          key: 'setup_complete',
          value: true,
          setupComplete: true,
          setupDate: new Date()
        }
      },
      { upsert: true }
    );
    return true;
  }

  async getSetting(key, { scope = 'global', fallback = undefined } = {}) {
    const db = await this._db();
    if (scope === 'global_settings') {
      const doc = await db.collection('global_settings').findOne({ _id: key });
      return doc?.config ?? fallback;
    }

    const doc = await db.collection('settings').findOne({ key, scope });
    return doc ? doc.value : fallback;
  }

  async setSetting(key, value, { scope = 'global' } = {}) {
    const db = await this._db();
    if (scope === 'global_settings') {
      return await db.collection('global_settings').updateOne(
        { _id: key },
        {
          $set: { _id: key, config: value, updatedAt: new Date() },
          $setOnInsert: { createdAt: new Date() }
        },
        { upsert: true }
      );
    }

    return await db.collection('settings').updateOne(
      { key, scope },
      {
        $set: { key, scope, value, updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    );
  }

  async listSettings({ keyPrefix = null, scope = 'global' } = {}) {
    const db = await this._db();
    const query = { scope };
    if (keyPrefix) query.key = { $regex: `^${keyPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` };
    return await db.collection('settings').find(query).sort({ key: 1 }).toArray();
  }

  async getGuildConfig(guildId) {
    const db = await this._db();
    return await db.collection('guild_configs').findOne({ guildId });
  }

  async saveGuildConfig(guildId, patch = {}) {
    const db = await this._db();
    return await db.collection('guild_configs').updateOne(
      { guildId },
      {
        $set: { ...patch, guildId, updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    );
  }

  async listGuildConfigs() {
    const db = await this._db();
    return await db.collection('guild_configs').find({}).toArray();
  }
}
