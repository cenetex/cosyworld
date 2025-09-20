/**
 * AgentEventService - simplified event-sourced history replacing per-agent block chains.
 * Each event document structure:
 *   {
 *     agent_id: <string>,        // deterministic agent id
 *     ts: <number>,              // millisecond timestamp
 *     type: <string>,            // action / event type
 *     actor: <string>,           // who performed the action
 *     data: <object>,            // params/resources combined payload
 *     attachments: <array>,      // optional attachments
 *     v: '1.0',                  // schema version
 *     hash: <string>             // keccak256 hash of canonical payload for integrity
 *   }
 */
import pkg from 'js-sha3';
const { keccak_256 } = pkg;

function canonical(obj) {
  if (obj === null || obj === undefined) return 'null';
  if (Array.isArray(obj)) return '[' + obj.map(canonical).join(',') + ']';
  if (typeof obj === 'object') {
    const keys = Object.keys(obj).sort();
    return '{' + keys.map(k => JSON.stringify(k)+':'+canonical(obj[k])).join(',') + '}';
  }
  if (typeof obj === 'number') return JSON.stringify(String(obj));
  return JSON.stringify(obj);
}

export class AgentEventService {
  constructor({ databaseService, logger, eventBus = null }) {
    this.dbService = databaseService;
    this.logger = logger;
    this.eventBus = eventBus;
  }
  async getDatabase() { return await this.dbService.getDatabase(); }

  async ensureIndexes() {
    const db = await this.getDatabase();
    await db.collection('agent_events').createIndexes([
      { key: { agent_id: 1, ts: -1 }, name: 'agent_events_agent_ts' },
      { key: { hash: 1 }, name: 'agent_events_hash', unique: true },
      { key: { type: 1, ts: -1 }, name: 'agent_events_type_ts' }
    ]).catch(()=>{});
  }

  buildEvent({ agentId, type, actor='system', data={}, attachments=[] }) {
    const base = { agent_id: agentId, ts: Date.now(), type, actor, data, attachments, v: '1.0' };
    const hashInput = canonical({ agent_id: base.agent_id, ts: base.ts, type: base.type, actor: base.actor, data: base.data, attachments: base.attachments, v: base.v });
    base.hash = '0x'+keccak_256(hashInput);
    return base;
  }

  async record(agentId, { type, actor, data, attachments }) {
    if (!agentId) throw new Error('agentId required');
    if (!type) throw new Error('type required');
    const db = await this.getDatabase();
    const evt = this.buildEvent({ agentId, type, actor, data, attachments });
    await db.collection('agent_events').insertOne(evt);
    this.eventBus?.emit('agent_event_recorded', { agentId, event: evt });
    return evt;
  }

  async list(agentId, { limit=50, beforeTs=null } = {}) {
    const db = await this.getDatabase();
    const q = { agent_id: agentId };
    if (beforeTs) q.ts = { $lt: beforeTs };
    return await db.collection('agent_events').find(q).sort({ ts: -1 }).limit(limit).toArray();
  }

  async stats(agentId) {
    const db = await this.getDatabase();
    const total = await db.collection('agent_events').countDocuments({ agent_id: agentId });
    const latest = await db.collection('agent_events').findOne({ agent_id: agentId }, { sort: { ts: -1 } });
    return { agentId, totalEvents: total, latestTs: latest?.ts || null, lastType: latest?.type || null };
  }
}

export default AgentEventService;
