/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { BasicTool } from '../BasicTool.mjs';

export class ThinkTool extends BasicTool {
  constructor({
    aiService,
    unifiedAIService,
    memoryService,
    discordService,
    promptService,
    databaseService,
    knowledgeService,
    schemaService,
    logger
  }) {
    super();

  this.aiService = aiService;
  this.unifiedAIService = unifiedAIService; // optional adapter
    this.memoryService = memoryService;
    this.discordService = discordService;
    this.promptService = promptService;
    this.databaseService = databaseService;
    this.knowledgeService = knowledgeService;
    this.schemaService = schemaService;
    this.logger = logger;

    this.name = 'think';
    this.description = 'Take a moment to reflect on a message or conversation, updating your thoughts and memories.';
    this.emoji = '💭';
  }

  getDescription() {
    return this.description;
  }

  async getSyntax() {
    return `${this.emoji} <message>`;
  }

  async getChannelContext(channel) {
    const messages = await channel.messages.fetch({ limit: 10 });
    return messages.map(m => `${m.author.username}: ${m.content}`).join('\n');
  }

  async execute(message, params, avatar) {
    try {
      let messageToRespondTo;
      if (message.reference) {
        const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
        messageToRespondTo = repliedMessage.content;
      } else if (params.length > 0) {
        messageToRespondTo = params.join(' ');
      } else {
        messageToRespondTo = 'Let your mind wander...';
      }

      const context = await this.getChannelContext(message.channel);
      let lastNarrative = '';
      try {
        lastNarrative = (await this.promptService.getLastNarrative(avatar, this.databaseService.getDatabase()))?.content || '';
      } catch {}

      const reflectionPrompt = `Based on this conversation:\n${context}\n\nLatest narrative:\n${lastNarrative}\nYou are about to respond to the message: "${messageToRespondTo}". Reflect in detail on the context, think carefully about the conversation and analyze its meaning.`;

  const ai = this.unifiedAIService || this.aiService;
  let reflection = await ai.chat([
        {
          role: 'system',
          content: avatar.prompt || `You are ${avatar.name}. ${avatar.personality}`
        },
        {
          role: 'user',
          content: reflectionPrompt
        }
      ], {
        model: avatar.model,
        temperature: 0.7,
        top_p: 0.95,
        frequency_penalty: 0,
        presence_penalty: 0.6,
        stream: false
      });
  if (reflection && typeof reflection === 'object' && reflection.text) reflection = reflection.text;

      await this.memoryService.addMemory(avatar._id, reflection);

      // Update avatar activity to keep world state fresh
      try {
        const db = await this.databaseService.getDatabase();
        await db.collection('avatars').updateOne(
          { _id: avatar._id },
          {
            $set: {
              lastActiveAt: new Date(),
              currentChannelId: message?.channel?.id,
              updatedAt: new Date().toISOString(),
              lastInteraction: 'think'
            },
            $inc: { reflections: 1 }
          }
        );
      } catch (actErr) {
        this.logger?.debug?.('ThinkTool activity update failed: ' + (actErr?.message || actErr));
      }

      // Extract knowledge points from reflection
      try {
        const schema = {
          name: 'KnowledgeExtraction',
          description: 'Extract key knowledge points from a reflection',
          schema: {
            type: 'object',
            properties: {
              knowledge_points: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of knowledge points or facts learned'
              }
            },
            required: ['knowledge_points'],
            additionalProperties: false
          }
        };

        const prompt = `Extract a concise list of key knowledge points or facts from the following reflection. Each should be a standalone fact or insight.

Reflection:
${reflection}

Return ONLY a JSON object with this exact structure:
{
  "knowledge_points": ["fact 1", "fact 2", "fact 3"]
}`;

        const result = await this.schemaService.executePipeline({ prompt, schema });
        
        // Handle various response formats
        const knowledgePoints = result.knowledge_points || result.knowledge || result.key_insights || [];
        
        if (Array.isArray(knowledgePoints) && knowledgePoints.length > 0) {
          for (const knowledge of knowledgePoints) {
            if (knowledge && typeof knowledge === 'string') {
              await this.knowledgeService.addKnowledgeTriple(avatar._id, 'knows', knowledge);
            }
          }
          this.logger?.debug?.(`Extracted ${knowledgePoints.length} knowledge points from reflection`);
        }
      } catch (kgError) {
        this.logger?.warn?.('Knowledge extraction failed:', kgError.message);
        // Don't fail the whole tool if knowledge extraction fails
      }

      if (avatar.innerMonologueChannel) {
        await this.discordService.sendAsWebhook(
          avatar.innerMonologueChannel, reflection, avatar
        );
      }

      return '-# [ Reflection Generated ]';
    } catch (error) {
      this.logger?.error('Error in ThinkTool:', error);
      return `-# [ ❌ Error: Failed to generate reflection: ${error.message} ]`;
    }
  }
}