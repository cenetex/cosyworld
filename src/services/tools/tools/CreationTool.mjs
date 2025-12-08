/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { BasicTool } from '../BasicTool.mjs';

export class CreationTool extends BasicTool {
  /**
   * Constructs a new CreationTool.
   **/
  constructor({
    aiService,
    unifiedAIService,
    logger
  }) {
    super();

    this.aiService = unifiedAIService || aiService;
    this.logger = logger || console;
    this.name = 'create';
    this.emoji = '✨';
    this.description = 'Create custom narrative effects and abilities';
    
    this.cache = new Map(); // Cache for generated descriptions
  }

  /**
   * Get OpenAI-compatible parameter schema for this tool
   */
  getParameterSchema() {
    return {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Description of what to create or the ability to use'
        },
        target: {
          type: 'string',
          description: 'Optional target for the creation or ability'
        }
      },
      required: ['description']
    };
  }

  async execute(message, params, avatar) {
    try {
      // Handle both array params and structured params
      let description, target;
      if (typeof params === 'object' && !Array.isArray(params)) {
        description = params.description || params.prompt || '';
        target = params.target || '';
      } else {
        const paramArray = Array.isArray(params) ? params : [params];
        description = paramArray.join(' ');
        target = '';
      }

      if (!description || description.trim().length === 0) {
        return '-# [ ✨ Please describe what you want to create ]';
      }

      const cacheKey = `${avatar?.name || 'unknown'}_${description}_${target}`;
      if (this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey);
      }

      const prompt = this.buildPrompt(message, avatar, description, target);
      const narrative = await this.generateNarrative(prompt, avatar);
      
      // Format the narrative properly if it's not already formatted
      const formatted = narrative.trim().startsWith('-#') 
        ? narrative 
        : `-# [ ✨ ${narrative} ]`;
      
      this.cache.set(cacheKey, formatted);
      return formatted;
    } catch (error) {
      this.logger?.error?.('Error in CreationTool:', error);
      return `-# [ ❌ Creation failed: ${error.message} ]`;
    }
  }

  buildPrompt(message, avatar, description, target) {
    const characterName = avatar?.name || message?.author?.username || 'The adventurer';
    const targetText = target ? ` targeting ${target}` : '';
    
    return `In a fantasy RPG setting, describe the effects of ${characterName} 
using a creative ability: "${description}"${targetText}.

Guidelines:
- Keep the response under 100 words
- Focus on narrative impact and sensory details
- Include some element of chance (partial success, unexpected twist, etc.)
- Make it feel like part of a larger adventure story
- Write in third person, past tense`;
  }

  async generateNarrative(prompt, avatar) {
    if (!this.aiService) {
      throw new Error('AI service not available');
    }

    try {
      const response = await this.aiService.chat([
        { role: 'system', content: 'You are a creative fantasy RPG narrator. Write evocative, concise narrative descriptions.' },
        { role: 'user', content: prompt }
      ], {
        model: avatar?.model || process.env.STRUCTURED_MODEL,
        temperature: 0.7
      });

      // Handle various response formats
      if (typeof response === 'string') {
        return response;
      }
      if (response?.text) {
        return response.text;
      }
      if (response?.content) {
        return response.content;
      }
      
      throw new Error('Unexpected response format from AI');
    } catch (error) {
      this.logger?.error?.(`Error generating narrative: ${error.message}`);
      throw error;
    }
  }

  getDescription() {
    return 'Create custom narrative effects and abilities';
  }

  async getSyntax() {
    return `${this.emoji} <description> [target]`;
  }
}