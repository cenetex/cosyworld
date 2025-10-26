/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file src/services/marketplace/services/agentSummon.mjs
 * @description Agent summoning service for marketplace
 */

/**
 * Agent Summon Service
 * Summons an agent to a location or conversation
 */
export class AgentSummonService {
  constructor(container) {
    this.logger = container.logger || console;
    this.avatarService = container.avatarService;
    this.locationService = container.locationService;
    this.databaseService = container.databaseService;
  }

  getMetadata() {
    return {
      serviceId: 'agent-summon',
      providerId: 'system',
      name: 'Agent Summoning',
      description: 'Summon an agent to your location or start a conversation',
      category: 'social',
      pricing: {
        model: 'per_request',
        amount: 0.5 * 1e6, // 0.5 USDC per summon
        currency: 'USDC',
        decimals: 6,
      },
      endpoint: '/api/marketplace/services/agent-summon/execute',
      network: 'base-sepolia',
      metadata: {
        estimatedTime: 'instant',
        maxDistance: 'unlimited',
        features: ['location-travel', 'conversation-start', 'notification'],
      },
    };
  }

  async execute(params, agentId) {
    const { targetAgentId, locationId, message, action = 'summon' } = params;

    if (!targetAgentId) {
      throw new Error('Target agent ID is required');
    }

    this.logger.info(`[AgentSummon] Agent ${agentId} summoning ${targetAgentId}`);

    try {
      const db = await this.databaseService.getDatabase();
      
      // Get target agent
      const targetAgent = await this.avatarService.getAvatar(targetAgentId);
      if (!targetAgent) {
        throw new Error('Target agent not found');
      }

      // Get summoning agent
      const summoningAgent = await this.avatarService.getAvatar(agentId);

      let result = {};

      if (action === 'summon' && locationId) {
        // Move target agent to location
        await this.avatarService.updateLocation(targetAgentId, locationId);
        
        const location = await this.locationService.getLocation(locationId);
        result.action = 'moved';
        result.location = location?.name || locationId;
      }

      // Create summon event
      await db.collection('agent_events').insertOne({
        type: 'agent_summoned',
        agentId: targetAgentId,
        summonedBy: agentId,
        summonedByName: summoningAgent?.name || agentId,
        locationId,
        message,
        createdAt: new Date(),
        paidAmount: this.getMetadata().pricing.amount,
      });

      // Add to agent's memory
      if (this.avatarService.memoryService) {
        await this.avatarService.memoryService.addMemory(targetAgentId, {
          type: 'summon',
          content: `You were summoned by ${summoningAgent?.name || agentId}${message ? `: "${message}"` : ''}`,
          importance: 0.8,
          tags: ['summon', 'social'],
        });
      }

      return {
        success: true,
        targetAgent: targetAgent.name,
        ...result,
        message: `Successfully summoned ${targetAgent.name}`,
      };
    } catch (error) {
      this.logger.error('[AgentSummon] Failed:', error);
      throw new Error(`Agent summon failed: ${error.message}`);
    }
  }
}
