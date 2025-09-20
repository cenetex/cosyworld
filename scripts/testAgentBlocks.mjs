#!/usr/bin/env node
/**
 * Test AgentBlockService functionality
 */
import 'dotenv/config';
import { container } from '../src/container.mjs';

const agentBlockService = container.resolve('agentBlockService');
const logger = container.resolve('logger');

async function test() {
  // Test agent ID (use a deterministic one for testing)
  const testAgentId = '0x1234567890abcdef1234567890abcdef12345678901234567890abcdef12345678';
  
  logger.info('Testing AgentBlockService...');

  try {
    // Test 1: Get latest block (should be null initially)
    const latest = await agentBlockService.getLatestBlock(testAgentId);
    logger.info('Latest block:', latest ? `index ${latest.index}` : 'none');

    // Test 2: Get chain stats
    const stats = await agentBlockService.getChainStats(testAgentId);
    logger.info('Chain stats:', stats);

    // Test 3: Get blocks (should be empty)
    const blocks = await agentBlockService.getBlocks(testAgentId);
    logger.info(`Found ${blocks.length} blocks`);

    logger.info('✅ AgentBlockService test complete');
  } catch (error) {
    logger.error('Test failed:', error.message);
  }
  
  process.exit(0);
}

test().catch(e => {
  logger.error('Test error:', e);
  process.exit(1);
});
