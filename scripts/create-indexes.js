#!/usr/bin/env node
/**
 * Database preparation script.
 *
 * SQLite is the default backend and runs schema migrations through
 * SqliteConnection. MongoDB remains supported only when DATA_BACKEND=mongo.
 */

import dotenv from 'dotenv';

import { DatabaseService } from '../src/services/foundation/databaseService.mjs';
import { createDataLayer } from '../src/data/dataLayer.mjs';

dotenv.config();

const logger = {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
  debug: () => {}
};

async function main() {
  const backend = String(process.env.DATA_BACKEND || process.env.STORAGE_DATA_BACKEND || 'sqlite').toLowerCase();
  console.log(`[database] Preparing ${backend} backend...`);

  DatabaseService.instance = null;
  const databaseService = new DatabaseService({ logger, configService: {} });
  const db = await databaseService.connect();
  if (!db) throw new Error('Database unavailable');

  const dataLayer = createDataLayer({ logger, databaseService });
  await dataLayer.initialize();

  await databaseService.createIndexes();

  if (backend === 'sqlite') {
    console.log(`[database] SQLite schema ready at ${databaseService.sqliteConnection?.dbPath || process.env.SQLITE_DB_PATH || 'data/cosyworld.sqlite'}`);
  } else {
    console.log('[database] MongoDB indexes ready');
  }

  await databaseService.close();
}

main().catch((error) => {
  console.error('[database] Preparation failed:', error?.stack || error?.message || error);
  process.exit(1);
});
