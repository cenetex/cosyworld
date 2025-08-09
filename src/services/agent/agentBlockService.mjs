/**
 * AgentBlock Service - manages per-agent append-only block chains
 */
export class AgentBlockService {
  constructor({ databaseService, logger, eventBus = null, agentEventService = null }) {
    this.db = databaseService;
    this.logger = logger;
    this.eventBus = eventBus;
    // Optional new event service for migration path
    this.agentEventService = agentEventService || null;
  }

  async getDatabase() {
    return await this.db.getDatabase();
  }

  /**
   * Get latest block for an agent
   */
  async getLatestBlock(agentId) {
    const db = await this.getDatabase();
    return await db.collection('agent_blocks')
      .findOne({ agent_id: agentId }, { sort: { index: -1 } });
  }

  /**
   * Get block by hash
   */
  async getBlockByHash(blockHash) {
    const db = await this.getDatabase();
    return await db.collection('agent_blocks').findOne({ block_hash: blockHash });
  }

  /**
   * Get blocks for agent with pagination
   */
  async getBlocks(agentId, { cursor = null, limit = 50 } = {}) {
    const db = await this.getDatabase();
    const query = { agent_id: agentId };
    if (cursor) {
      query.index = { $lt: cursor };
    }
    return await db.collection('agent_blocks')
      .find(query)
      .sort({ index: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Append new block to agent chain
   */
  async appendBlock(agentId, blockData) {
    if (this.agentEventService) {
      // Migration path: also record simplified event alongside block for consumers.
      try {
        await this.agentEventService.record(agentId, {
          type: blockData.action,
          actor: blockData.actor || 'system',
          data: { params: blockData.params || {}, resources: blockData.resources || {} },
          attachments: blockData.attachments || []
        });
      } catch (e) {
        this.logger.warn(`AgentEvent mirror failed for ${agentId}: ${e.message}`);
      }
    }
    const db = await this.getDatabase();
    
    // Validate agent exists
    const agent = await db.collection('avatars').findOne({ agentId });
    if (!agent) throw new Error(`Agent ${agentId} not found`);

    // Get previous block
    const previous = await this.getLatestBlock(agentId);
    
    // Build block with proper linking
    const { buildBlock } = await import('../utils/agentIdentity.mjs');
    const block = buildBlock({
      previous,
      core: {
        v: '0.2',
        agent_id: agentId,
        timestamp: Date.now(),
        actor: blockData.actor || 'system',
        witnesses: blockData.witnesses || [],
        action: blockData.action,
        params: blockData.params || {},
        resources: blockData.resources || {},
        attachments: blockData.attachments || [],
        cosy_v: '0.1',
        origin: {
          chain: agent.nft?.chain || 'ethereum',
          contract: agent.originContract,
          token_id: agent.nft?.tokenId
        }
      }
    });

    // TODO: Upload to IPFS/Arweave for CID
    block.cid = null; // placeholder
    block.checkpoint_epoch = null;
    block.provisional = true;

    // Insert block
    await db.collection('agent_blocks').insertOne(block);
    
    // Update agent's latest block index
    await db.collection('avatars').updateOne(
      { agentId },
      { $set: { last_block_index: block.index } }
    );

    this.logger.info(`Appended block ${block.index} for agent ${agentId}`);
    
    // Emit event for receipts/UI
    this.eventBus?.emit('agent_block_created', { agentId, block });

    return block;
  }

  /**
   * Create initial blocks for agent (onboarding sequence)
   */
  async createGenesisBlocks(agentId, actions = ['genesis', 'welcome', 'introduction']) {
    const blocks = [];
    for (const action of actions) {
      const block = await this.appendBlock(agentId, {
        action,
        params: { auto_generated: true },
        actor: 'system'
      });
      blocks.push(block);
    }
    return blocks;
  }

  /**
   * Get stats for agent chain
   */
  async getChainStats(agentId) {
    const db = await this.getDatabase();
    const latest = await this.getLatestBlock(agentId);
    const totalBlocks = await db.collection('agent_blocks').countDocuments({ agent_id: agentId });
    const pendingCheckpoint = await db.collection('agent_blocks')
      .countDocuments({ agent_id: agentId, checkpoint_epoch: null });

    return {
      agentId,
      totalBlocks,
      latestIndex: latest?.index || -1,
      latestHash: latest?.block_hash,
      pendingCheckpoint
    };
  }
}
