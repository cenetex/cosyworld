#!/usr/bin/env node
import 'dotenv/config';
import { container, containerReady } from '../src/container.mjs';

/**
 * Ingest avatars from an OpenAI-compatible avatar API (e.g. Swarm).
 *
 * Stores results into `external_avatar_models` collection.
 */
export default async function ingestSwarmAvatars({ provider = 'swarm', limit = null } = {}) {
  await containerReady;

  const logger = (() => {
    try {
      return container.resolve('logger');
    } catch {
      return console;
    }
  })();

  const databaseService = container.resolve('databaseService');
  await databaseService.connect();
  const db = await databaseService.getDatabase();

  // Prefer the existing SwarmAIService if registered and configured.
  let swarmAIService = null;
  try {
    swarmAIService = container.resolve('swarmAIService');
  } catch {
    swarmAIService = null;
  }

  if (!swarmAIService?.listModels) {
    logger.error('[ingest:swarm-avatars] swarmAIService not available');
    return { failed: true };
  }

  logger.info(`[ingest:swarm-avatars] Fetching models from provider=${provider} baseURL=${swarmAIService.baseURL}`);

  const models = await swarmAIService.listModels();
  const list = Array.isArray(models?.data) ? models.data : Array.isArray(models?.body?.data) ? models.body.data : [];

  const rows = (limit ? list.slice(0, limit) : list).map((m) => ({
    provider,
    modelId: m?.id || null,
    owned_by: m?.owned_by || null,
    created: m?.created || null,
    capabilities: m?.capabilities || null,
    avatar: m?.avatar || null,
    raw: m,
    updatedAt: new Date(),
  }));

  const col = db.collection('external_avatar_models');

  let upserted = 0;
  for (const row of rows) {
    if (!row.modelId) continue;
    await col.updateOne(
      { provider: row.provider, modelId: row.modelId },
      { $set: row, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
    upserted++;
  }

  logger.info(`[ingest:swarm-avatars] Upserted ${upserted}/${rows.length} models into external_avatar_models`);
  return { failed: false, upserted, total: rows.length };
}
