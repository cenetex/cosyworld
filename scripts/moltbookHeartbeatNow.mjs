#!/usr/bin/env node
import 'dotenv/config';

import { container, containerReady } from '../src/container.mjs';
import { MoltbookHeartbeatService } from '../src/services/social/moltbookHeartbeatService.mjs';

const safeResolve = (name) => {
  try { return container.resolve(name); } catch { return null; }
};

export default async function moltbookHeartbeatNow({ max = null } = {}) {
  await containerReady;

  const logger = safeResolve('logger') || console;
  const databaseService = safeResolve('databaseService');

  if (!databaseService) {
    throw new Error('databaseService not available');
  }

  // Helpful preflight so this command is not silent.
  const db = await databaseService.getDatabase();
  const connectionCount = await db.collection('social_platform_connections').countDocuments({ platform: 'moltbook', status: 'connected' });
  logger.info(`[moltbook] heartbeat-now: connected avatars=${connectionCount}`);

  const service = new MoltbookHeartbeatService({
    logger,
    databaseService,
    schedulingService: safeResolve('schedulingService'),
    socialPlatformService: safeResolve('socialPlatformService'),
    avatarService: safeResolve('avatarService'),
    memoryService: safeResolve('memoryService'),
    aiService: safeResolve('aiService') || safeResolve('unifiedAIService') || safeResolve('openrouterAIService') || safeResolve('openRouterAIService'),
  });

  // Force a "run now" check without waiting ~4 hours.
  service.checkIntervalHours = 0.0001; // ~0.36s

  if (max && Number.isFinite(Number(max)) && Number(max) > 0) {
    service.maxAvatarsPerTick = Number(max);
  }

  await service.tick();
  logger.info('[moltbook] heartbeat-now: tick complete');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rest = process.argv.slice(2);
  const args = Object.fromEntries(rest.filter(a => a.includes('=')).map(a => {
    const i = a.indexOf('=');
    return [a.slice(0, i).replace(/^--/, ''), a.slice(i + 1)];
  }));

  const max = args.max ? Number(args.max) : null;

  moltbookHeartbeatNow({ max }).catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
}
