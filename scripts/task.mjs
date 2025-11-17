#!/usr/bin/env node
import 'dotenv/config';
import { container, containerReady } from '../src/container.mjs';

async function main() {
  // Wait for container to be fully initialized
  await containerReady;
  
  const logger = container.resolve('logger');
  
  const [,, cmd, ...rest] = process.argv;
  const args = Object.fromEntries(rest.filter(a=>a.includes('=')).map(a=>{
    const i = a.indexOf('=');
    return [a.slice(0,i).replace(/^--/,''), a.slice(i+1)];
  }));
  const flags = new Set(rest.filter(a=>a.startsWith('--') && !a.includes('=')));

  switch (cmd) {
    case 'sync:collection': {
      const { syncAvatarsForCollection } = await import('../src/services/collections/collectionSyncService.mjs');
      const collectionId = args.key || process.env.AVATAR_COLLECTION;
      const fileSource = args.file || process.env.AVATAR_COLLECTION_FILE;
      const force = flags.has('--force');
      if (!collectionId) {
        console.error('Missing --key or AVATAR_COLLECTION');
        process.exit(1);
      }
      const res = await syncAvatarsForCollection({ collectionId, fileSource, force });
      logger.info(`Sync done: success ${res.success}/${res.processed}, failures ${res.failures}`);
      process.exit(res.failures ? 1 : 0);
    }
    case 'migrate:agent-blocks': {
      const mod = await import('./migrateAgentBlocks.mjs');
      await mod.default?.() ?? Promise.resolve();
      break;
    }
    case 'migrate:agent-events': {
      const mod = await import('./migrateAgentEvents.mjs');
      await (mod.default?.() ?? Promise.resolve());
      break;
    }
    case 'backfill:agent-ids': {
      const mod = await import('./backfillAgentIds.mjs');
      await (mod.default?.() ?? Promise.resolve());
      break;
    }
    case 'update:models': {
      const mod = await import('./updateModels.mjs');
      await (mod.default?.() ?? Promise.resolve());
      break;
    }
    default:
      console.log('Usage: task <command> [--key=...] [--file=...] [--force]');
      console.log('Commands:');
      console.log('  sync:collection       Sync avatars for a collection');
      console.log('  migrate:agent-blocks  Run agent blocks migration');
      console.log('  migrate:agent-events  Run agent events migration');
      console.log('  backfill:agent-ids    Backfill agent IDs');
      console.log('  update:models         Refresh available models');
      process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
