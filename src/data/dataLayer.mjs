import { MongoConfigStore } from './mongo/mongoConfigStore.mjs';
import { MongoIdentityStore } from './mongo/mongoIdentityStore.mjs';
import { createSqliteConnection } from './sqlite/sqliteConnection.mjs';
import { SqliteConfigStore } from './sqlite/sqliteConfigStore.mjs';
import { SqliteIdentityStore } from './sqlite/sqliteIdentityStore.mjs';

export class DataLayer {
  constructor({ backend, stores, sqliteConnection = null } = {}) {
    this.backend = backend;
    this.config = stores.config;
    this.identity = stores.identity;
    this.sqliteConnection = sqliteConnection;
  }

  async initialize() {
    await this.config?.initialize?.();
    await this.identity?.initialize?.();
  }

  transaction(fn) {
    if (this.backend === 'sqlite' && this.sqliteConnection) {
      return this.sqliteConnection.transaction(() => fn(this));
    }
    return fn(this);
  }
}

export function createDataLayer({ logger, databaseService }) {
  const backend = String(process.env.DATA_BACKEND || process.env.STORAGE_DATA_BACKEND || 'sqlite').toLowerCase();

  if (backend === 'sqlite') {
    const sqliteConnection = createSqliteConnection({ logger });
    const config = new SqliteConfigStore({ sqliteConnection, logger });
    const identity = new SqliteIdentityStore({ sqliteConnection, logger });
    return new DataLayer({
      backend,
      sqliteConnection,
      stores: { config, identity }
    });
  }

  if (backend !== 'mongo' && backend !== 'mongodb') {
    logger?.warn?.(`[data] Unknown DATA_BACKEND=${backend}; falling back to MongoDB`);
  }

  const config = new MongoConfigStore({ databaseService, logger });
  const identity = new MongoIdentityStore({ databaseService, logger });
  return new DataLayer({
    backend: 'mongo',
    stores: { config, identity }
  });
}
