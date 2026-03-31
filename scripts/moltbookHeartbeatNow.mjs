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

  // If a specific agentName/avatarId is provided, run only that connection.
  // This is helpful for debugging and to "poke" a single agent immediately.
  const targetAgentName = moltbookHeartbeatNow._targetAgentName || null;
  const targetAvatarId = moltbookHeartbeatNow._targetAvatarId || null;

  if (!targetAgentName && !targetAvatarId) {
    await service.tick();
    logger.info('[moltbook] heartbeat-now: tick complete');
    return;
  }

  const query = { platform: 'moltbook', status: 'connected' };
  if (targetAvatarId) query.avatarId = targetAvatarId;
  if (targetAgentName) query['metadata.agentName'] = targetAgentName;

  const conn = await db.collection('social_platform_connections').findOne(query);
  if (!conn) {
    throw new Error(`[moltbook] heartbeat-now: no connected moltbook avatar found for ${targetAvatarId ? `avatarId=${targetAvatarId}` : ''}${targetAgentName ? ` agentName=${targetAgentName}` : ''}`.trim());
  }

  await service._ensureStateCollection();
  const avatarId = String(conn.avatarId);
  const state = await service._getState(avatarId);
  await service._runForAvatar(conn, state);

  logger.info(`[moltbook] heartbeat-now: completed for avatarId=${avatarId}${targetAgentName ? ` agentName=${targetAgentName}` : ''}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rest = process.argv.slice(2);
  const args = Object.fromEntries(rest.filter(a => a.includes('=')).map(a => {
    const i = a.indexOf('=');
    return [a.slice(0, i).replace(/^--/, ''), a.slice(i + 1)];
  }));

  const max = args.max ? Number(args.max) : null;
  const agentName = args.agentName || args.agent || args.username || null;
  const avatarId = args.avatarId || args.avatar || null;

  // Pass targets through function properties so we don't change the call signature
  // used by scripts/task.mjs.
  moltbookHeartbeatNow._targetAgentName = agentName;
  moltbookHeartbeatNow._targetAvatarId = avatarId;

  moltbookHeartbeatNow({ max }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
