/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file src/services/marketplace/services/combat.mjs
 * @description Combat service for marketplace
 */

/**
 * Combat Service
 * Initiates combat between agents
 */
export class CombatService {
  constructor(container) {
    this.logger = container.logger || console;
    this.avatarService = container.avatarService;
    this.itemService = container.itemService;
    this.databaseService = container.databaseService;
  }

  getMetadata() {
    return {
      serviceId: 'combat',
      providerId: 'system',
      name: 'Combat Challenge',
      description: 'Challenge another agent to combat with stakes and rewards',
      category: 'utility',
      pricing: {
        model: 'per_request',
        amount: 2 * 1e6, // 2 USDC per combat
        currency: 'USDC',
        decimals: 6,
      },
      endpoint: '/api/marketplace/services/combat/execute',
      network: 'base-sepolia',
      metadata: {
        estimatedTime: '5-10 seconds',
        features: ['turn-based', 'item-usage', 'experience-gain'],
        outcomes: ['victory', 'defeat', 'draw'],
      },
    };
  }

  async execute(params, agentId) {
    const { opponentId, stakes = 0, useItems = [] } = params;

    if (!opponentId) {
      throw new Error('Opponent ID is required');
    }

    this.logger.info(`[Combat] Agent ${agentId} challenging ${opponentId}`);

    try {
      const db = await this.databaseService.getDatabase();

      // Get both agents
      const challenger = await this.avatarService.getAvatar(agentId);
      const opponent = await this.avatarService.getAvatar(opponentId);

      if (!challenger || !opponent) {
        throw new Error('Agent not found');
      }

      // Calculate combat stats
      const challengerPower = this._calculatePower(challenger, useItems);
      const opponentPower = this._calculatePower(opponent, []);

      // Add randomness
      const challengerRoll = Math.random() * challengerPower;
      const opponentRoll = Math.random() * opponentPower;

      const winner = challengerRoll > opponentRoll ? challenger : opponent;
      const loser = winner._id === challenger._id ? opponent : challenger;
      const isVictory = winner._id === challenger._id;

      // Record combat
      const combat = {
        type: 'combat',
        challengerId: agentId,
        opponentId,
        challengerPower,
        opponentPower,
        challengerRoll,
        opponentRoll,
        winnerId: winner._id,
        loserId: loser._id,
        stakes,
        items: useItems,
        createdAt: new Date(),
        paidAmount: this.getMetadata().pricing.amount,
      };

      await db.collection('combat_logs').insertOne(combat);

      // Award experience
      const xpGained = isVictory ? 100 : 50;
      await this.avatarService.addExperience(agentId, xpGained);

      // Create events
      await db.collection('agent_events').insertMany([
        {
          type: 'combat_complete',
          agentId,
          opponentId,
          result: isVictory ? 'victory' : 'defeat',
          xpGained,
          createdAt: new Date(),
        },
        {
          type: 'combat_complete',
          agentId: opponentId,
          opponentId: agentId,
          result: isVictory ? 'defeat' : 'victory',
          xpGained: isVictory ? 25 : 75,
          createdAt: new Date(),
        },
      ]);

      return {
        success: true,
        outcome: isVictory ? 'victory' : 'defeat',
        winner: winner.name,
        loser: loser.name,
        challengerRoll: Math.round(challengerRoll),
        opponentRoll: Math.round(opponentRoll),
        xpGained,
        combatId: combat._id,
      };
    } catch (error) {
      this.logger.error('[Combat] Failed:', error);
      throw new Error(`Combat failed: ${error.message}`);
    }
  }

  /**
   * Calculate agent combat power
   * @private
   */
  _calculatePower(agent, items = []) {
    let power = 100; // Base power

    // Add level bonus
    power += (agent.level || 1) * 20;

    // Add item bonuses
    for (const _itemId of items) {
      power += 30; // Simplified - each item adds 30 power
    }

    return power;
  }
}
