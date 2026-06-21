#!/usr/bin/env node
/**
 * Reset first-run setup state for the configured data backend.
 */

import readline from 'readline';

import dotenv from 'dotenv';

import { createDataLayer } from '../src/data/dataLayer.mjs';
import { DatabaseService } from '../src/services/foundation/databaseService.mjs';

dotenv.config();

const args = process.argv.slice(2);
const flags = {
  confirm: args.includes('--confirm'),
  keepSecrets: args.includes('--keep-secrets'),
  help: args.includes('--help') || args.includes('-h')
};

if (flags.help) {
  console.log(`
Reset CosyWorld setup state.

Usage:
  npm run reset-setup
  node scripts/reset-setup.mjs [options]

Options:
  --confirm        Skip confirmation prompt
  --keep-secrets   Keep existing secrets
  --help, -h       Show this help message

This clears the V2 setup status from the configured backend. SQLite is used by
default; MongoDB is used only when DATA_BACKEND=mongo.
`);
  process.exit(0);
}

const logger = {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
  debug: () => {}
};

function confirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(['yes', 'y'].includes(answer.toLowerCase()));
    });
  });
}

async function resetSetup() {
  console.log('\nReset CosyWorld setup state\n');

  const backend = String(process.env.DATA_BACKEND || process.env.STORAGE_DATA_BACKEND || 'sqlite').toLowerCase();
  console.log(`Backend: ${backend}`);
  if (backend === 'sqlite') {
    console.log(`SQLite: ${process.env.SQLITE_DB_PATH || (process.env.NODE_ENV === 'production' ? '/data/cosyworld.sqlite' : 'data/cosyworld.sqlite')}\n`);
  } else {
    console.log(`MongoDB: ${(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017').replace(/\/\/.*@/, '//***@')}\n`);
  }

  if (!flags.confirm) {
    console.log('WARNING: This will reset setup status.');
    if (!flags.keepSecrets) console.log('It will also clear persisted secrets.');
    const ok = await confirm('Continue? (yes/no): ');
    if (!ok) {
      console.log('\nReset cancelled.\n');
      process.exit(0);
    }
  }

  DatabaseService.instance = null;
  const databaseService = new DatabaseService({ logger, configService: {} });
  const db = await databaseService.connect();
  if (!db) throw new Error('Database unavailable');

  const dataLayer = createDataLayer({ logger, databaseService });
  await dataLayer.initialize();

  await dataLayer.config.resetSetup();
  console.log('Cleared setup status');

  if (!flags.keepSecrets) {
    const result = await db.collection('secrets').deleteMany({});
    console.log(`Cleared ${result.deletedCount} persisted secret(s)`);
  } else {
    console.log('Kept persisted secrets');
  }

  await databaseService.close();

  console.log('\nSetup reset complete.');
  console.log('Restart the app and open /admin/setup.\n');
}

resetSetup().catch((error) => {
  console.error('\nReset failed:', error?.stack || error?.message || error);
  process.exit(1);
});
