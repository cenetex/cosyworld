#!/usr/bin/env node
import 'dotenv/config';
import { container } from '../src/container.mjs';
import { syncAvatarsForCollection } from '../src/services/collections/collectionSyncService.mjs';

const logger = container.resolve('logger');

async function main() {
  const COLLECTION = process.env.AVATAR_COLLECTION;
  const fileArg = process.argv.find(a => a.startsWith('--file='));
  const force = process.argv.includes('--force');
  if (!COLLECTION) {
    console.error('AVATAR_COLLECTION not set in environment (.env).');
    process.exit(1);
  }
  logger.info(`Starting NFT avatar sync for collection: ${COLLECTION}`);
  const res = await syncAvatarsForCollection({
    collectionId: COLLECTION,
    fileSource: fileArg ? fileArg.slice('--file='.length) : (process.env.AVATAR_COLLECTION_FILE || undefined),
    force,
  });
  logger.info(`NFT avatar sync complete. Success ${res.success}/${res.processed}, failures ${res.failures}.`);
  process.exit(res.failures ? 1 : 0);
}

main().catch(err => { console.error('Fatal sync error:', err); process.exit(1); });
