#!/usr/bin/env node
/**
 * Database migration for AgentBlocks feature
 * Creates collections and indexes for agent chains
 */
import 'dotenv/config';
import { container } from '../src/container.mjs';

const logger = container.resolve('logger');
const databaseService = container.resolve('databaseService');

async function migrate() {
  const db = await databaseService.getDatabase();
  
  logger.info('Creating AgentBlock collections and indexes...');

  // agent_blocks collection
  try {
    await db.createCollection('agent_blocks');
    logger.info('Created agent_blocks collection');
  } catch (e) {
    if (e.codeName !== 'NamespaceExists') throw e;
    logger.info('agent_blocks collection already exists');
  }

  // Create indexes for agent_blocks
  const agentBlocksIndexes = [
    { key: { agent_id: 1, index: 1 }, options: { unique: true, name: 'agent_blocks_id_index' } },
    { key: { block_hash: 1 }, options: { unique: true, name: 'agent_blocks_hash' } },
    { key: { cid: 1 }, options: { sparse: true, name: 'agent_blocks_cid' } },
    { key: { timestamp: 1 }, options: { name: 'agent_blocks_timestamp' } },
    { key: { checkpoint_epoch: 1 }, options: { sparse: true, name: 'agent_blocks_checkpoint' } }
  ];

  for (const idx of agentBlocksIndexes) {
    try {
      await db.collection('agent_blocks').createIndex(idx.key, idx.options);
      logger.info(`Created index: ${idx.options.name}`);
    } catch (e) {
      if (e.codeName !== 'IndexOptionsConflict') logger.warn(`Index warning: ${e.message}`);
    }
  }

  // checkpoints collection
  try {
    await db.createCollection('checkpoints');
    logger.info('Created checkpoints collection');
  } catch (e) {
    if (e.codeName !== 'NamespaceExists') throw e;
    logger.info('checkpoints collection already exists');
  }

  const checkpointIndexes = [
    { key: { epoch: 1 }, options: { unique: true, name: 'checkpoints_epoch' } },
    { key: { submitted_at: 1 }, options: { name: 'checkpoints_submitted' } }
  ];

  for (const idx of checkpointIndexes) {
    try {
      await db.collection('checkpoints').createIndex(idx.key, idx.options);
      logger.info(`Created index: ${idx.options.name}`);
    } catch (e) {
      if (e.codeName !== 'IndexOptionsConflict') logger.warn(`Index warning: ${e.message}`);
    }
  }

  // mint_receipts collection
  try {
    await db.createCollection('mint_receipts');
    logger.info('Created mint_receipts collection');
  } catch (e) {
    if (e.codeName !== 'NamespaceExists') throw e;
    logger.info('mint_receipts collection already exists');
  }

  const mintReceiptIndexes = [
    { key: { agent_id: 1, block_index: 1 }, options: { name: 'mint_receipts_agent_block' } },
    { key: { status: 1 }, options: { name: 'mint_receipts_status' } },
    { key: { created_at: 1 }, options: { name: 'mint_receipts_created' } }
  ];

  for (const idx of mintReceiptIndexes) {
    try {
      await db.collection('mint_receipts').createIndex(idx.key, idx.options);
      logger.info(`Created index: ${idx.options.name}`);
    } catch (e) {
      if (e.codeName !== 'IndexOptionsConflict') logger.warn(`Index warning: ${e.message}`);
    }
  }

  // Add agentId index to avatars if missing
  try {
    await db.collection('avatars').createIndex({ agentId: 1 }, { sparse: true, name: 'avatars_agent_id' });
    logger.info('Created avatars.agentId index');
  } catch (e) {
    if (e.codeName !== 'IndexOptionsConflict') logger.warn(`Index warning: ${e.message}`);
  }

  logger.info('✅ Database migration complete');
  process.exit(0);
}

migrate().catch(e => {
  logger.error('Migration failed:', e);
  process.exit(1);
});
