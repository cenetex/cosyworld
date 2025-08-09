#!/usr/bin/env node
/** Backfill deterministic agentId for existing avatars lacking it. */
import 'dotenv/config';
import { container } from '../src/container.mjs';
import { computeAgentId, resolveChainId, normalizeTokenId } from '../src/utils/agentIdentity.mjs';

const logger = container.resolve('logger');
const databaseService = container.resolve('databaseService');

async function run() {
  const db = await databaseService.getDatabase();
  const avatars = db.collection('avatars');
  const chainName = process.env.NFT_CHAIN || 'ethereum';
  const chainId = resolveChainId(chainName, process.env.NFT_CHAIN_ID);
  const collection = process.env.AVATAR_COLLECTION;
  let updated = 0, skipped = 0, missing = 0;
  const cursor = avatars.find({ $or: [ { agentId: { $exists: false } }, { agentId: null } ] });
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    const tokenId = doc?.nft?.tokenId;
    const originContract = doc?.nft?.collection || collection;
    if (tokenId == null || !originContract) { missing++; continue; }
    try {
  const tokenNumeric = normalizeTokenId(tokenId);
  const agentId = computeAgentId({ chainId, originContract, tokenId: tokenNumeric });
      await avatars.updateOne({ _id: doc._id }, { $set: { agentId, chainId, originContract } });
      updated++;
    } catch (e) {
      logger.warn(`Skip avatar ${doc._id}: ${e.message}`); skipped++;
    }
  }
  logger.info(`AgentId backfill done updated=${updated} skipped=${skipped} missing=${missing}`);
  process.exit(0);
}

run().catch(e => { logger.error(e); process.exit(1); });
