/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file src/services/marketplace/services/itemCrafting.mjs
 * @description Item crafting service for marketplace
 */

/**
 * Item Crafting Service
 * Craft new items from materials
 */
export class ItemCraftingService {
  constructor(container) {
    this.logger = container.logger || console;
    this.itemService = container.itemService;
    this.avatarService = container.avatarService;
    this.databaseService = container.databaseService;
  }

  getMetadata() {
    return {
      serviceId: 'item-crafting',
      providerId: 'system',
      name: 'Item Crafting',
      description: 'Craft powerful items from materials and recipes',
      category: 'utility',
      pricing: {
        model: 'per_request',
        amount: 1.5 * 1e6, // 1.5 USDC per craft
        currency: 'USDC',
        decimals: 6,
      },
      endpoint: '/api/marketplace/services/item-crafting/execute',
      network: 'base-sepolia',
      metadata: {
        estimatedTime: '5-10 seconds',
        features: ['recipe-system', 'quality-tiers', 'success-chance'],
        qualityTiers: ['common', 'uncommon', 'rare', 'epic', 'legendary'],
      },
    };
  }

  async execute(params, agentId) {
    const { recipeId, materials = [], itemName, itemType = 'tool' } = params;

    if (!recipeId && !itemName) {
      throw new Error('Recipe ID or item name is required');
    }

    this.logger.info(`[ItemCrafting] Agent ${agentId} crafting ${recipeId || itemName}`);

    try {
      const db = await this.databaseService.getDatabase();

      // Determine success and quality
      const successChance = Math.random();
      const success = successChance > 0.2; // 80% success rate

      if (!success) {
        return {
          success: false,
          message: 'Crafting failed',
          materialsLost: materials.length > 0,
        };
      }

      // Determine quality
      const qualityRoll = Math.random();
      let quality = 'common';
      if (qualityRoll > 0.95) quality = 'legendary';
      else if (qualityRoll > 0.85) quality = 'epic';
      else if (qualityRoll > 0.70) quality = 'rare';
      else if (qualityRoll > 0.50) quality = 'uncommon';

      // Create item
      const item = {
        name: itemName || `Crafted ${itemType}`,
        type: itemType,
        quality,
        craftedBy: agentId,
        materials,
        recipeId,
        createdAt: new Date(),
        owner: agentId,
        power: this._calculatePower(quality),
      };

      const result = await db.collection('items').insertOne(item);

      // Log crafting
      await db.collection('crafting_logs').insertOne({
        agentId,
        itemId: result.insertedId.toString(),
        recipeId,
        materials,
        quality,
        success: true,
        createdAt: new Date(),
        paidAmount: this.getMetadata().pricing.amount,
      });

      // Add to agent inventory
      await this.avatarService.addItem(agentId, result.insertedId.toString());

      return {
        success: true,
        item: {
          id: result.insertedId.toString(),
          name: item.name,
          type: item.type,
          quality,
          power: item.power,
        },
        message: `Successfully crafted ${quality} ${item.name}!`,
      };
    } catch (error) {
      this.logger.error('[ItemCrafting] Failed:', error);
      throw new Error(`Item crafting failed: ${error.message}`);
    }
  }

  /**
   * Calculate item power based on quality
   * @private
   */
  _calculatePower(quality) {
    const powerMap = {
      common: 10,
      uncommon: 25,
      rare: 50,
      epic: 100,
      legendary: 200,
    };
    return powerMap[quality] || 10;
  }
}
