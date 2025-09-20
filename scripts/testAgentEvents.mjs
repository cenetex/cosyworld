#!/usr/bin/env node
/** Quick smoke test for AgentEventService */
import 'dotenv/config';
import { container } from '../src/container.mjs';

const logger = container.resolve('logger');
const agentEventService = container.resolve('agentEventService');

async function run() {
  await agentEventService.ensureIndexes();
  const testAgentId = '0xTESTEVENTAGENT00000000000000000000000000000000000000000000000001';
  logger.info('Recording events for', testAgentId);
  await agentEventService.record(testAgentId, { type: 'genesis', actor: 'system', data: { note: 'genesis event'} });
  await agentEventService.record(testAgentId, { type: 'chat', actor: 'user:123', data: { message: 'hello world'} });
  const list = await agentEventService.list(testAgentId, { limit: 10 });
  const stats = await agentEventService.stats(testAgentId);
  logger.info('Recent events count='+list.length);
  logger.info('Stats', stats);
  console.log('Sample events:', list.map(e => ({ type: e.type, ts: e.ts, hash: e.hash.slice(0,10)+'...' })));
  process.exit(0);
}
run().catch(e => { logger.error(e); process.exit(1); });
