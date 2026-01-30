#!/usr/bin/env node
import 'dotenv/config';

import { container, containerReady } from '../src/container.mjs';

const safeResolve = (name) => {
  try { return container.resolve(name); } catch { return null; }
};

export default async function moltbookSwarmMissiveNow() {
  await containerReady;

  const logger = safeResolve('logger') || console;
  const service = safeResolve('moltbookSwarmMissiveService');

  if (!service?.tick) {
    throw new Error('moltbookSwarmMissiveService not available');
  }

  await service.tick();
  logger.info('[moltbook] swarm-missive-now: complete');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  moltbookSwarmMissiveNow().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
