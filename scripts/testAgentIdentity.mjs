#!/usr/bin/env node
/**
 * Test agent identity utilities
 */
import { computeAgentId, resolveChainId, computeBlockHash, buildBlock } from '../src/utils/agentIdentity.mjs';

console.log('Testing Agent Identity Utils...\n');

// Test chain ID resolution
console.log('Chain ID Tests:');
console.log('ethereum:', resolveChainId('ethereum'));
console.log('solana:', resolveChainId('solana'));
console.log('explicit override:', resolveChainId('ethereum', 999));

// Test agent ID computation
console.log('\nAgent ID Tests:');
const testCases = [
  { chainId: 1, originContract: '0x1234567890123456789012345678901234567890', tokenId: 42n },
  { chainId: 1, originContract: 'SolanaMintAddress12345', tokenId: 100n },
  { chainId: 0x534f4c41, originContract: 'DifferentContract', tokenId: 1n }
];

for (const [i, test] of testCases.entries()) {
  try {
    const agentId = computeAgentId(test);
    console.log(`Test ${i + 1}: ${agentId}`);
  } catch (e) {
    console.log(`Test ${i + 1}: ERROR - ${e.message}`);
  }
}

// Test block building
console.log('\nBlock Building Tests:');
const genesis = buildBlock({
  previous: null,
  core: {
    v: '0.2',
    agent_id: '0x123abc',
    timestamp: Date.now(),
    actor: '0xuser',
    action: 'genesis',
    params: {},
    resources: {},
    attachments: [],
    cosy_v: '0.1',
    origin: { chain: 'ethereum', contract: '0x456', token_id: '1' }
  }
});

console.log('Genesis block:', {
  index: genesis.index,
  parent_hash: genesis.parent_hash,
  block_hash: genesis.block_hash?.slice(0, 10) + '...'
});

const next = buildBlock({
  previous: genesis,
  core: {
    v: '0.2',
    agent_id: '0x123abc',
    timestamp: Date.now() + 1000,
    actor: '0xuser',
    action: 'chat',
    params: { message: 'hello world' },
    resources: {},
    attachments: [],
    cosy_v: '0.1',
    origin: { chain: 'ethereum', contract: '0x456', token_id: '1' }
  }
});

console.log('Next block:', {
  index: next.index,
  parent_hash: next.parent_hash?.slice(0, 10) + '...',
  block_hash: next.block_hash?.slice(0, 10) + '...'
});

console.log('\n✅ Agent Identity Utils test complete');
