/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file src/services/marketplace/services/memoryQuery.mjs
 * @description Memory query service for marketplace
 */

/**
 * Memory Query Service
 * Search and retrieve memories from agents
 */
export class MemoryQueryService {
  constructor(container) {
    this.logger = container.logger || console;
    this.memoryService = container.memoryService;
    this.databaseService = container.databaseService;
  }

  getMetadata() {
    return {
      serviceId: 'memory-query',
      providerId: 'system',
      name: 'Memory Query',
      description: 'Search through agent memories and retrieve specific information',
      category: 'data',
      pricing: {
        model: 'per_request',
        amount: 0.1 * 1e6, // 0.1 USDC per query
        currency: 'USDC',
        decimals: 6,
      },
      endpoint: '/api/marketplace/services/memory-query/execute',
      network: 'base-sepolia',
      metadata: {
        estimatedTime: 'instant',
        maxResults: 10,
        features: ['semantic-search', 'time-filtering', 'importance-ranking'],
      },
    };
  }

  async execute(params, agentId) {
    const { query, targetAgentId, limit = 10, minImportance = 0 } = params;

    if (!query) {
      throw new Error('Query is required');
    }

    const searchAgentId = targetAgentId || agentId;

    this.logger.info(`[MemoryQuery] Agent ${agentId} querying memories for ${searchAgentId}`);

    try {
      const db = await this.databaseService.getDatabase();
      
      // Search memories
      const memories = await db.collection('agent_memories')
        .find({
          agentId: searchAgentId,
          $or: [
            { content: { $regex: query, $options: 'i' } },
            { tags: { $in: [query.toLowerCase()] } },
          ],
          importance: { $gte: minImportance },
        })
        .sort({ importance: -1, timestamp: -1 })
        .limit(limit)
        .toArray();

      // Log the query
      await db.collection('memory_queries').insertOne({
        queryAgentId: agentId,
        targetAgentId: searchAgentId,
        query,
        resultsCount: memories.length,
        createdAt: new Date(),
        paidAmount: this.getMetadata().pricing.amount,
      });

      return {
        success: true,
        query,
        resultsCount: memories.length,
        memories: memories.map(m => ({
          content: m.content,
          timestamp: m.timestamp,
          importance: m.importance,
          tags: m.tags,
        })),
      };
    } catch (error) {
      this.logger.error('[MemoryQuery] Failed:', error);
      throw new Error(`Memory query failed: ${error.message}`);
    }
  }
}
