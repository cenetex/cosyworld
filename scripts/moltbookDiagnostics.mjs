#!/usr/bin/env node
import 'dotenv/config';

import { container, containerReady } from '../src/container.mjs';

const safeResolve = (name) => {
  try { return container.resolve(name); } catch { return null; }
};

const short = (v, n = 220) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);

export default async function moltbookDiagnostics({ limit = 20 } = {}) {
  await containerReady;

  const logger = safeResolve('logger') || console;
  const databaseService = safeResolve('databaseService');

  if (!databaseService) throw new Error('databaseService not available');

  const db = await databaseService.getDatabase();

  const env = {
    MOLTBOOK_HEARTBEAT_ENABLED: process.env.MOLTBOOK_HEARTBEAT_ENABLED,
    MOLTBOOK_TICK_INTERVAL_MINUTES: process.env.MOLTBOOK_TICK_INTERVAL_MINUTES,
    MOLTBOOK_CHECK_INTERVAL_HOURS: process.env.MOLTBOOK_CHECK_INTERVAL_HOURS,
    MOLTBOOK_COMMENT_COOLDOWN_MINUTES: process.env.MOLTBOOK_COMMENT_COOLDOWN_MINUTES,
    MOLTBOOK_COMMENT_PROBABILITY: process.env.MOLTBOOK_COMMENT_PROBABILITY,
    MOLTBOOK_MAX_AVATARS_PER_TICK: process.env.MOLTBOOK_MAX_AVATARS_PER_TICK,
    MOLTBOOK_SWARM_MISSIVES_ENABLED: process.env.MOLTBOOK_SWARM_MISSIVES_ENABLED,
    MOLTBOOK_SWARM_AGENT_NAME: process.env.MOLTBOOK_SWARM_AGENT_NAME,
    MOLTBOOK_SWARM_SUBMOLT: process.env.MOLTBOOK_SWARM_SUBMOLT,
    MOLTBOOK_SWARM_EXPLORE_ENABLED: process.env.MOLTBOOK_SWARM_EXPLORE_ENABLED,
    MOLTBOOK_SWARM_REPLY_ENABLED: process.env.MOLTBOOK_SWARM_REPLY_ENABLED,
  };

  console.log('=== Moltbook diagnostics ===');
  console.log('Env (selected):');
  for (const [k, v] of Object.entries(env)) {
    if (v != null) console.log(`- ${k}=${v}`);
  }

  const connsCol = db.collection('social_platform_connections');
  const avatarsCol = db.collection('avatars');

  const byStatus = await connsCol
    .aggregate([
      { $match: { platform: 'moltbook' } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
      { $sort: { n: -1 } }
    ])
    .toArray();

  console.log('\nConnections (moltbook) by status:');
  if (!byStatus.length) console.log('- none');
  for (const row of byStatus) console.log(`- ${row._id || '(null)'}: ${row.n}`);

  const connections = await connsCol
    .find({ platform: 'moltbook' })
    .project({ avatarId: 1, status: 1, metadata: 1, updatedAt: 1, lastError: 1 })
    .sort({ updatedAt: -1 })
    .limit(50)
    .toArray();

  console.log('\nConnections (latest 50):');
  if (!connections.length) console.log('- none');

  const avatarIds = connections.map((c) => c.avatarId).filter(Boolean);
  const avatarDocs = avatarIds.length
    ? await avatarsCol
        .find({ _id: { $in: avatarIds } })
        .project({ name: 1, emoji: 1 })
        .toArray()
    : [];

  const avatarById = new Map(avatarDocs.map((a) => [String(a._id), a]));

  for (const c of connections) {
    const av = avatarById.get(String(c.avatarId));
    const agentName = c?.metadata?.agentName || c?.metadata?.username || null;
    const claimStatus = c?.metadata?.claimStatus || null;
    const isClaimed = c?.metadata?.isClaimed;
    console.log(
      `- avatarId=${c.avatarId} ${av ? `${av.emoji || ''} ${av.name || ''}` : ''} status=${c.status}` +
      `${agentName ? ` agentName=${agentName}` : ''}` +
      `${claimStatus ? ` claimStatus=${claimStatus}` : ''}` +
      `${typeof isClaimed === 'boolean' ? ` isClaimed=${isClaimed}` : ''}` +
      `${c.updatedAt ? ` updatedAt=${new Date(c.updatedAt).toISOString()}` : ''}` +
      `${c.lastError ? ` lastError=${short(c.lastError, 120)}` : ''}`
    );
  }

  const heartbeatStateCol = db.collection('moltbook_state');
  const swarmStateCol = db.collection('moltbook_swarm_state');

  const hbStates = await heartbeatStateCol
    .find({})
    .project({ avatarId: 1, lastCheckAt: 1, lastCommentAt: 1, claimStatus: 1, isClaimed: 1, lastError: 1, updatedAt: 1 })
    .sort({ updatedAt: -1 })
    .limit(50)
    .toArray();

  console.log('\nHeartbeat state (moltbook_state, latest 50):');
  if (!hbStates.length) console.log('- none (service may not have run, or no connected avatars)');
  for (const s of hbStates) {
    console.log(
      `- avatarId=${s.avatarId}` +
      `${s.lastCheckAt ? ` lastCheckAt=${new Date(s.lastCheckAt).toISOString()}` : ''}` +
      `${s.lastCommentAt ? ` lastCommentAt=${new Date(s.lastCommentAt).toISOString()}` : ''}` +
      `${s.claimStatus ? ` claimStatus=${s.claimStatus}` : ''}` +
      `${typeof s.isClaimed === 'boolean' ? ` isClaimed=${s.isClaimed}` : ''}` +
      `${s.lastError ? ` lastError=${short(s.lastError, 140)}` : ''}`
    );
  }

  const swarmStates = await swarmStateCol
    .find({})
    .project({ agentName: 1, lastPostAt: 1, lastCheckAt: 1, lastReplyAt: 1, claimStatus: 1, isClaimed: 1, lastError: 1, updatedAt: 1 })
    .sort({ updatedAt: -1 })
    .limit(20)
    .toArray();

  console.log('\nSwarm state (moltbook_swarm_state, latest 20):');
  if (!swarmStates.length) console.log('- none (service may not have run, or missing MOLTBOOK_SWARM_AGENT_NAME)');
  for (const s of swarmStates) {
    console.log(
      `- agentName=${s.agentName}` +
      `${s.lastPostAt ? ` lastPostAt=${new Date(s.lastPostAt).toISOString()}` : ''}` +
      `${s.lastCheckAt ? ` lastCheckAt=${new Date(s.lastCheckAt).toISOString()}` : ''}` +
      `${s.lastReplyAt ? ` lastReplyAt=${new Date(s.lastReplyAt).toISOString()}` : ''}` +
      `${s.claimStatus ? ` claimStatus=${s.claimStatus}` : ''}` +
      `${typeof s.isClaimed === 'boolean' ? ` isClaimed=${s.isClaimed}` : ''}` +
      `${s.lastError ? ` lastError=${short(s.lastError, 140)}` : ''}`
    );
  }

  const memoriesCol = db.collection('memories');
  const recentMemories = await memoriesCol
    .find({ kind: 'moltbook' })
    .project({ avatarId: 1, text: 1, memory: 1, createdAt: 1 })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  console.log(`\nRecent Moltbook memories (latest ${limit}):`);
  if (!recentMemories.length) console.log('- none');
  for (const m of recentMemories) {
    const txt = m.text || m.memory || '';
    console.log(`- ${m.createdAt ? new Date(m.createdAt).toISOString() : ''} avatarId=${m.avatarId} :: ${short(txt, 220)}`);
  }

  logger.info('[moltbook] diagnostics complete');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rest = process.argv.slice(2);
  const args = Object.fromEntries(rest.filter((a) => a.startsWith('--') && a.includes('=')).map((a) => {
    const i = a.indexOf('=');
    return [a.slice(2, i), a.slice(i + 1)];
  }));
  const limit = args.limit ? Number(args.limit) : 20;

  moltbookDiagnostics({ limit }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
