function nowIso() {
  return new Date().toISOString();
}

function encode(value) {
  return JSON.stringify(value ?? null);
}

function decode(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export class SqliteConfigStore {
  constructor({ sqliteConnection, logger }) {
    this.connection = sqliteConnection;
    this.logger = logger || console;
    this.db = this.connection.connect();
  }

  async initialize() {
    this.connection.connect();
  }

  async getSetupStatus() {
    const row = this.db.prepare('SELECT value_json FROM setup_state WHERE key = ?').get('setup_complete');
    const doc = decode(row?.value_json, null);

    if (doc?.value === true || doc?.setupComplete === true) {
      return {
        setupComplete: true,
        adminWallet: doc.adminWallet || null,
        setupDate: doc.setupDate || null,
        lastModified: doc.lastModified || doc.updatedAt || null
      };
    }

    return {
      setupComplete: false,
      adminWallet: null,
      setupDate: null
    };
  }

  async markSetupComplete({ adminWallet, completedAt = new Date() } = {}) {
    const at = completedAt instanceof Date ? completedAt.toISOString() : String(completedAt);
    const payload = {
      key: 'setup_complete',
      value: true,
      setupComplete: true,
      adminWallet: adminWallet || null,
      setupDate: at,
      lastModified: nowIso()
    };

    this.db.prepare(`
      INSERT INTO setup_state (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `).run('setup_complete', encode(payload), payload.lastModified);

    return true;
  }

  async resetSetup() {
    this.db.prepare('DELETE FROM setup_state WHERE key = ?').run('setup_complete');
    return true;
  }

  async updateAdminWallet(newWallet) {
    const status = await this.getSetupStatus();
    if (!status.setupComplete) {
      return this.markSetupComplete({ adminWallet: newWallet });
    }

    const payload = {
      key: 'setup_complete',
      value: true,
      setupComplete: true,
      adminWallet: newWallet || null,
      setupDate: status.setupDate || nowIso(),
      lastModified: nowIso()
    };

    this.db.prepare(`
      INSERT INTO setup_state (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `).run('setup_complete', encode(payload), payload.lastModified);

    return true;
  }

  async getSetting(key, { scope = 'global', fallback = undefined } = {}) {
    const row = this.db.prepare('SELECT value_json FROM app_settings WHERE key = ? AND scope = ?').get(key, scope);
    if (!row) return fallback;
    return decode(row.value_json, fallback);
  }

  async setSetting(key, value, { scope = 'global' } = {}) {
    const updatedAt = nowIso();
    this.db.prepare(`
      INSERT INTO app_settings (key, scope, value_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key, scope) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `).run(key, scope, encode(value), updatedAt);

    return { acknowledged: true, modifiedCount: 1, upsertedCount: 0 };
  }

  async listSettings({ keyPrefix = null, scope = 'global' } = {}) {
    const rows = keyPrefix
      ? this.db.prepare('SELECT key, scope, value_json, updated_at FROM app_settings WHERE scope = ? AND key LIKE ? ORDER BY key')
        .all(scope, `${keyPrefix}%`)
      : this.db.prepare('SELECT key, scope, value_json, updated_at FROM app_settings WHERE scope = ? ORDER BY key')
        .all(scope);

    return rows.map(row => ({
      key: row.key,
      scope: row.scope,
      value: decode(row.value_json, null),
      updatedAt: row.updated_at
    }));
  }

  async getGuildConfig(guildId) {
    const row = this.db.prepare('SELECT config_json FROM guild_configs WHERE guild_id = ?').get(guildId);
    const doc = decode(row?.config_json, null);
    return doc ? { ...doc, guildId: doc.guildId || guildId } : null;
  }

  async saveGuildConfig(guildId, patch = {}) {
    const existing = await this.getGuildConfig(guildId);
    const updatedAt = nowIso();
    const next = {
      ...(existing || {}),
      ...patch,
      guildId,
      updatedAt
    };

    this.db.prepare(`
      INSERT INTO guild_configs (guild_id, config_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        config_json = excluded.config_json,
        updated_at = excluded.updated_at
    `).run(guildId, encode(next), updatedAt);

    return { acknowledged: true, modifiedCount: existing ? 1 : 0, upsertedCount: existing ? 0 : 1 };
  }

  async listGuildConfigs() {
    const rows = this.db.prepare('SELECT guild_id, config_json FROM guild_configs ORDER BY guild_id').all();
    return rows.map(row => ({
      ...decode(row.config_json, {}),
      guildId: decode(row.config_json, {})?.guildId || row.guild_id
    }));
  }
}
