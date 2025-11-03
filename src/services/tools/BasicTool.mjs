/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

export class BasicTool {

  constructor() { 
    this.replyNotification = false; //process.env.NODE_ENV === 'development' ? true : false;
    this.cooldownMs = 60 * 1000; // default 1 minute cooldown
  }

  async execute(_message, _params, _avatar, _services) {
    throw new Error('Tool must implement execute method');
  }

  getDescription() {
    // Return description if set, otherwise throw error for tools that must override
    if (this.description) {
      return this.description;
    }
    throw new Error('Tool must implement getDescription method or set this.description');
  }

  /**
   * Get OpenAI-compatible parameter schema for this tool
   * Override this method to provide specific parameter definitions
   * @returns {Object} JSON Schema object describing tool parameters
   */
  getParameterSchema() {
    // Default: single optional target parameter
    // Most tools take a target/params string - override for specific schemas
    return {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Target or parameters for this action'
        }
      },
      required: []
    };
  }

  toolEmojisGuildCache = new Map();

  async getEmoji(guildId) {
    if (!this.configService) return this.emoji;
    try {
      const guildConfig = await this.configService.getGuildConfig(
        guildId
      );

      if (guildConfig?.toolEmojis?.attack) {
        return guildConfig.toolEmojis.attack;
      }
      return this.emoji;
    } catch (error) {
      console.error(`Error getting attack emoji from config: ${error.message}`);
      return this.emoji;
    }
  }

  async getSyntax(guildId) {
    const emoji = await this.getEmoji(guildId);
    return `${emoji} ${this.name || ''} ${this.parameters || ''}`;
  }
}