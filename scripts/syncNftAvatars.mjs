#!/usr/bin/env node
import 'dotenv/config';
import { container, containerReady } from '../src/container.mjs';
import { syncAvatarsForCollection } from '../src/services/collections/collectionSyncService.mjs';
import path from 'path';

const logger = container.resolve('logger');

async function main() {
  await containerReady;
  const args = process.argv.slice(2);

  const optionValue = (flag) => {
    for (let i = 0; i < args.length; i += 1) {
      const current = args[i];
      if (current === `--${flag}`) {
        return args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
      }
      if (current.startsWith(`--${flag}=`)) {
        return current.slice(flag.length + 3);
      }
    }
    return null;
  };

  const force = args.includes('--force');

  let collectionId = optionValue('collection') || process.env.AVATAR_COLLECTION || null;

  let fileSource = optionValue('file');
  if (!fileSource) {
    const inlineFile = args.find(arg => arg.startsWith('--file='));
    if (inlineFile) fileSource = inlineFile.slice('--file='.length);
  }
  if (!fileSource) {
    fileSource = process.env.AVATAR_COLLECTION_FILE || undefined;
  }

  if (!collectionId && fileSource) {
    const inferred = path.basename(fileSource).replace(/\.json$/i, '');
    if (inferred && inferred !== fileSource) {
      collectionId = inferred;
      logger.info(`No collection provided; inferred '${collectionId}' from file path.`);
    }
  }

  if (!collectionId) {
    console.error('Collection ID not provided. Use --collection=<slug> or set AVATAR_COLLECTION.');
    process.exit(1);
  }

  const guildId = optionValue('guild') || process.env.AVATAR_COLLECTION_GUILD || null;

  logger.info(`Starting NFT avatar sync for collection: ${collectionId}${guildId ? ` (guild ${guildId})` : ''}`);
  const res = await syncAvatarsForCollection({
    collectionId,
    fileSource,
    force,
    guildId,
  });
  logger.info(`NFT avatar sync complete. Success ${res.success}/${res.processed}, failures ${res.failures}.`);
  process.exit(res.failures ? 1 : 0);
}

main().catch(err => { console.error('Fatal sync error:', err); process.exit(1); });
