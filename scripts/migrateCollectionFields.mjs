#!/usr/bin/env node
import 'dotenv/config';
import { container, containerReady } from '../src/container.mjs';

async function migrateCollectionFields() {
  await containerReady;
  const logger = container.resolve('logger');
  const databaseService = container.resolve('databaseService');
  const db = await databaseService.getDatabase();
  const avatars = db.collection('avatars');

  const cursor = avatars.find({
    $or: [
      { collection: { $exists: true } },
      { 'nft.collection': { $exists: false } },
    ],
  }).project({ _id: 1, collection: 1, nft: 1, name: 1 });

  let processed = 0;
  let migrated = 0;

  while (await cursor.hasNext()) {
    const avatar = await cursor.next();
    processed += 1;

    const setOps = {};
    const unsetOps = {};

    const legacyCollection = typeof avatar.collection === 'string' && avatar.collection.trim().length
      ? avatar.collection.trim()
      : null;
    const hasModernCollection = Boolean(avatar?.nft?.collection);

    if (!hasModernCollection && legacyCollection) {
      setOps['nft.collection'] = legacyCollection;
    }

    if (Object.prototype.hasOwnProperty.call(avatar, 'collection')) {
      unsetOps.collection = '';
    }

    if (!Object.keys(setOps).length && !Object.keys(unsetOps).length) {
      continue;
    }

    await avatars.updateOne(
      { _id: avatar._id },
      {
        ...(Object.keys(setOps).length ? { $set: setOps } : {}),
        ...(Object.keys(unsetOps).length ? { $unset: unsetOps } : {}),
      }
    );
    migrated += 1;

    if (migrated % 100 === 0) {
      logger.info?.(`[migrateCollectionFields] Updated ${migrated} / ${processed} avatars so far.`);
    }
  }

  logger.info?.(`[migrateCollectionFields] Completed. Processed ${processed}, migrated ${migrated} avatars.`);
  process.exit(0);
}

migrateCollectionFields().catch((err) => {
  console.error('[migrateCollectionFields] Fatal error:', err);
  process.exit(1);
});
