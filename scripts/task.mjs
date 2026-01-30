#!/usr/bin/env node
import 'dotenv/config';
import { container, containerReady } from '../src/container.mjs';

const safeResolve = (name) => {
  try { return container.resolve(name); } catch { return null; }
};

async function main() {
  // Wait for container to be fully initialized
  await containerReady;
  
  const logger = safeResolve('logger') || console;
  
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
      const guildId = args.guild || process.env.AVATAR_COLLECTION_GUILD || null;
      if (!collectionId) {
        console.error('Missing --key or AVATAR_COLLECTION');
        process.exit(1);
      }
      const res = await syncAvatarsForCollection({ collectionId, fileSource, force, guildId }, null, {
        logger,
        databaseService: safeResolve('databaseService'),
        s3Service: safeResolve('s3Service'),
        aiService: safeResolve('aiService'),
        unifiedAIService: safeResolve('unifiedAIService'),
        openrouterAIService: safeResolve('openrouterAIService') || safeResolve('openRouterAIService'),
        googleAIService: safeResolve('googleAIService'),
        ollamaAIService: safeResolve('ollamaAIService'),
        replicateAIService: safeResolve('replicateAIService'),
      });
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
    case 'backfill:avatar-maxhp': {
      const mod = await import('./backfill-avatar-maxhp.mjs');
      await (mod.default?.() ?? Promise.resolve());
      break;
    }
    case 'update:models': {
      const mod = await import('./updateModels.mjs');
      await (mod.default?.() ?? Promise.resolve());
      break;
    }
    case 'moltbook:register-avatars': {
      const mod = await import('./moltbookRegisterAvatars.mjs');
      const limit = args.limit ? Number(args.limit) : null;
      const random = flags.has('--random');
      const res = await (mod.default?.({ limit, random }) ?? Promise.resolve());
      if (res?.failed) process.exit(1);
      break;
    }
    case 'moltbook:heartbeat-now': {
      const mod = await import('./moltbookHeartbeatNow.mjs');
      const max = args.max ? Number(args.max) : null;
      const agentName = args.agentName || args.agent || args.username || null;
      const avatarId = args.avatarId || args.avatar || null;

      // Configure optional targets on the module function so it can run a single agent.
      if (mod.default) {
        mod.default._targetAgentName = agentName;
        mod.default._targetAvatarId = avatarId;
      }

      await (mod.default?.({ max }) ?? Promise.resolve());
      break;
    }
    case 'moltbook:swarm-missive-now': {
      const mod = await import('./moltbookSwarmMissiveNow.mjs');
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
      console.log('  backfill:avatar-maxhp Backfill avatar max HP from character sheets');
      console.log('  update:models         Refresh available models');
      console.log('  moltbook:register-avatars  Create Moltbook agents for avatars (optional: --limit=N)');
      console.log('  moltbook:heartbeat-now      Run Moltbook heartbeat tick immediately (optional: --max=N, --agentName=..., --avatarId=...)');
      console.log('  moltbook:swarm-missive-now  Post a swarm missive now (uses MOLTBOOK_SWARM_AGENT_NAME)');
      process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
