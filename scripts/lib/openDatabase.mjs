import dotenv from 'dotenv';

import { DatabaseService } from '../../src/services/foundation/databaseService.mjs';

dotenv.config();

export async function openDatabase({ logger = console } = {}) {
  DatabaseService.instance = null;
  const databaseService = new DatabaseService({ logger, configService: {} });
  const db = await databaseService.connect();
  if (!db) throw new Error('Database unavailable');
  return {
    db,
    backend: databaseService.backend,
    async close() {
      await databaseService.close();
    }
  };
}
