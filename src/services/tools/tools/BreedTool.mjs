/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { BasicTool } from '../BasicTool.mjs';
import { SummonTool } from './SummonTool.mjs';

export class BreedTool extends BasicTool {
  constructor({
    mapService,
    conversationManager,
    avatarService,
    configService,
    databaseService,
    aiService,
    statService,
    logger,
    memoryService,
    discordService,
  }) {
    super();

    this.avatarService = avatarService;
    this.configService = configService;
    this.memoryService = memoryService;
    this.databaseService = databaseService;
    this.statService = statService;
    this.logger = logger;
    this.mapService = mapService;
    this.conversationManager = conversationManager;
    this.aiService = aiService;
    this.discordService = discordService;

    
    this.name = 'breed';
    this.description = 'Breeds two avatars together';
    this.emoji = '🏹';
    this.replyNotification = true;
    this.cooldownMs = 10 * 1000; // 1 minute cooldown
  }

  getDescription() {
    return 'Breeds two existing avatars to create a new one';
  }

  async getSyntax() {
    return `${this.emoji} <avatar1> <avatar2>`;
  }

  async getMemories(avatar, count = 10) {
    const memoryRecords = await this.memoryService.getMemories(avatar._id, count);
    return memoryRecords.map(m => m.memory).join('\n');
  }

  async execute(message, params, avatar, context) {
    try {
      const commandLine = message.content.trim().substring(2).trim();
      const avatars = await this.avatarService.getAvatarsInChannel(message.channel.id, message.guildId);
      const mentionedAvatars = Array.from(this.avatarService.extractMentionedAvatars(commandLine, avatars))
        .sort(() => Math.random() - 0.5)
        .slice(-2);

      if (mentionedAvatars.length !== 2) {
        return "-# [ Failed to breed: Both mentioned avatars must be in this channel. ]";
      }

      const [avatar1, avatar2] = mentionedAvatars;
      if (avatar1._id === avatar2._id) {
        return "-# [ Failed to breed: Cannot breed an avatar with itself. ]";
      }

      const checkRecentBreed = async (avatar) => {
        const lastBred = await this.avatarService.getLastBredDate(avatar._id.toString());
        return lastBred && (Date.now() - new Date(lastBred) < 24 * 60 * 60 * 1000);
      };

      if (await checkRecentBreed(avatar1) || await checkRecentBreed(avatar2)) {
        return "-# [ Failed to breed: Avatar recently bred. ]";
      }

      await this.discordService.replyToMessage(message, `Breeding ${avatar1.name} with ${avatar2.name}...`);
      
      const avatar1memories = await this.getMemories(avatar1, 100);
      const avatar2memories = await this.getMemories(avatar2, 100);

      const prompt = `Breed the following avatars to combine them, develop a short backstory for the offspring:\n\n` +
        `AVATAR 1: ${avatar1.name} - ${avatar1.prompt}\n${avatar1.description}\n${avatar1.personality}\n\nMemories\n\n${avatar1memories}\n\n` +
        `AVATAR 2: ${avatar2.name} - ${avatar2.prompt}\n${avatar2.description}\n${avatar2.personality}\n\nMemories\n\n${avatar2memories}\n\n` +
        `Combine their attributes creatively, avoiding cosmic or mystical elements and aiming for a down-to-earth feel.`;

      const originalContent = message.content;
      message.content = `${this.configService.getGuildConfig(message.guildId).summonEmoji} ${prompt}`;

      console.log('BreedTool: executing SummonTool with prompt:', message.content);
      const summonTool = new SummonTool({
        discordService: this.discordService,
        mapService: this.mapService,
        conversationManager: this.conversationManager,
        avatarService: this.avatarService,
        configService: this.configService,
        databaseService: this.databaseService,
        aiService: this.aiService,
        statService: this.statService,
        logger: this.logger,
      });
      const result = await summonTool.execute(message, { 
        breed: true, attributes: { parents: [avatar1._id, avatar2._id] } }, avatar, context);
      message.content = originalContent;
      
      return `${result}`;
    } catch (error) {
      this.logger?.error('Error in BreedTool:', error);
      return `-# [ ❌ Error: Failed to breed avatars: ${error.message} ]`;
    }
  }
}
