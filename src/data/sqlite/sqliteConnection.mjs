import path from 'path';
import fs from 'fs';

import Database from 'better-sqlite3';

const DEFAULT_SQLITE_DB_PATH = process.env.NODE_ENV === 'production'
  ? '/data/cosyworld.sqlite'
  : path.resolve(process.cwd(), 'data/cosyworld.sqlite');

const MIGRATIONS = [
  {
    version: 1,
    name: 'config_store_foundation',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS documents (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        doc TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT,
        PRIMARY KEY (collection, id)
      );

      CREATE TABLE IF NOT EXISTS setup_state (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'global',
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (key, scope)
      );

      CREATE TABLE IF NOT EXISTS guild_configs (
        guild_id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS app_settings_scope_key ON app_settings(scope, key);
    `
  },
  {
    version: 2,
    name: 'identity_auth_foundation',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'active',
        is_admin INTEGER NOT NULL DEFAULT 0,
        profile_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS wallets (
        id TEXT PRIMARY KEY,
        chain TEXT NOT NULL,
        normalized_address TEXT NOT NULL,
        display_address TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(chain, normalized_address)
      );

      CREATE TABLE IF NOT EXISTS user_wallets (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'login',
        verified_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, wallet_id)
      );

      CREATE TABLE IF NOT EXISTS external_identities (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_user_id TEXT NOT NULL,
        profile_json TEXT,
        verified_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(provider, provider_user_id)
      );

      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        metadata_json TEXT
      );

      CREATE INDEX IF NOT EXISTS auth_sessions_user_expires ON auth_sessions(user_id, expires_at);

      CREATE TABLE IF NOT EXISTS auth_challenges (
        id TEXT PRIMARY KEY,
        purpose TEXT NOT NULL,
        chain TEXT,
        normalized_address TEXT,
        subject_json TEXT,
        nonce TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        UNIQUE(purpose, nonce)
      );

      CREATE INDEX IF NOT EXISTS auth_challenges_address ON auth_challenges(chain, normalized_address, expires_at);

      CREATE TABLE IF NOT EXISTS oauth_states (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        state TEXT NOT NULL UNIQUE,
        owner_kind TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        code_verifier TEXT,
        scopes_json TEXT,
        payload_json TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS oauth_states_owner ON oauth_states(provider, owner_kind, owner_id);

      CREATE TABLE IF NOT EXISTS provider_credentials (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        owner_kind TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        credential_json TEXT NOT NULL,
        profile_json TEXT,
        scopes_json TEXT,
        expires_at TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        error_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(provider, owner_kind, owner_id)
      );

      CREATE INDEX IF NOT EXISTS provider_credentials_provider_status
        ON provider_credentials(provider, status, expires_at);

      CREATE TABLE IF NOT EXISTS auth_events (
        id TEXT PRIMARY KEY,
        event TEXT NOT NULL,
        user_id TEXT,
        wallet_id TEXT,
        provider TEXT,
        owner_kind TEXT,
        owner_id TEXT,
        ip TEXT,
        user_agent TEXT,
        details_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS auth_events_created ON auth_events(created_at);
    `
  }
];

export class SqliteConnection {
  constructor({ logger, dbPath = process.env.SQLITE_DB_PATH || DEFAULT_SQLITE_DB_PATH } = {}) {
    this.logger = logger || console;
    this.dbPath = dbPath;
    this.db = null;
  }

  connect() {
    if (this.db) return this.db;

    const dir = path.dirname(this.dbPath);
    fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.migrate();
    this.logger?.info?.(`[data] SQLite connected at ${this.dbPath}`);
    return this.db;
  }

  migrate() {
    const db = this.db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    const hasMigration = db.prepare('SELECT version FROM schema_migrations WHERE version = ?');
    const insertMigration = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');

    for (const migration of MIGRATIONS) {
      if (hasMigration.get(migration.version)) continue;
      const apply = db.transaction(() => {
        db.exec(migration.sql);
        insertMigration.run(migration.version, migration.name, new Date().toISOString());
      });
      apply();
      this.logger?.info?.(`[data] Applied SQLite migration ${migration.version}: ${migration.name}`);
    }
  }

  transaction(fn) {
    const db = this.connect();
    return db.transaction(fn)();
  }

  close() {
    if (!this.db) return;
    this.db.close();
    this.db = null;
  }
}

export function createSqliteConnection(options) {
  return new SqliteConnection(options);
}
