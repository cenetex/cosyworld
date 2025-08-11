#!/usr/bin/env node
/** Migration script to create agent_events collection + indexes and optionally backfill from agent_blocks. */
import 'dotenv/config';
import { container } from '../src/container.mjs';

const logger = container.resolve('logger');
const databaseService = container.resolve('databaseService');

async function migrate() {
  const db = await databaseService.getDatabase();
  logger.info('Ensuring agent_events collection...');
  try { await db.createCollection('agent_events'); } catch (err) { if (err.codeName !== 'NamespaceExists') throw err; }
  await db.collection('agent_events').createIndexes([
    { key: { agent_id: 1, ts: -1 }, name: 'agent_events_agent_ts' },
    { key: { hash: 1 }, name: 'agent_events_hash', unique: true },
    { key: { type: 1, ts: -1 }, name: 'agent_events_type_ts' }
  ]).catch(()=>{});

  // Optional backfill: convert existing agent_blocks to events (idempotent by hash)
  const doBackfill = process.argv.includes('--backfill-blocks');
  if (doBackfill) {
    logger.info('Backfilling events from agent_blocks...');
    const cursor = db.collection('agent_blocks').find({}, { projection: { agent_id:1, timestamp:1, action:1, params:1, resources:1, actor:1, attachments:1, block_hash:1 } });
    let inserted=0, skipped=0;
    while (await cursor.hasNext()) {
      const b = await cursor.next();
      const evt = {
        agent_id: b.agent_id,
        ts: b.timestamp,
        type: b.action,
        actor: b.actor || 'system',
        data: { params: b.params||{}, resources: b.resources||{} },
        attachments: b.attachments||[],
        v: '1.0',
        hash: b.block_hash // reuse existing hash
      };
  try {
        await db.collection('agent_events').updateOne({ hash: evt.hash }, { $setOnInsert: evt }, { upsert: true });
        inserted++;
  } catch { skipped++; }
    }
    logger.info(`Backfill complete inserted=${inserted} skipped=${skipped}`);
  }
  logger.info('✅ agent_events migration done');
  process.exit(0);
}

migrate().catch(e => { logger.error('Migration failed', e); process.exit(1); });
