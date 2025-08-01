/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { BasicTool } from '../BasicTool.mjs';

export class SummonTool extends BasicTool {
  constructor({
    discordService,
    mapService,
    avatarService,
    configService,
    databaseService,
    aiService,
    statService,
    logger,
  }) {
    super();
    this.discordService = discordService;
    this.mapService = mapService;
    this.avatarService = avatarService;
    this.configService = configService;
    this.databaseService = databaseService;
    this.aiService = aiService;
    this.statService = statService;
    this.logger = logger;

    this.name = 'summon';
    this.description = 'Summons a new avatar';
    this.emoji = '🔮'; // Default emoji
    this.DAILY_SUMMON_LIMIT = 16;
    this.replyNotification = true;
    this.cooldownMs = 10 * 1000; // 1 minute cooldown
  }

  /**
   * Returns a static description of the tool.
   * @returns {string} The description.
   */
  getDescription() {
    return 'Summons a new avatar into existence';
  }

  /**
   * Returns the syntax of the tool.
   * @returns {string} The syntax.
   */
  async getSyntax() {
    return `${this.emoji} <avatar name or description>`;
  }

  /**
   * Checks if the user has not exceeded the daily summon limit.
   * @param {string} userId - The ID of the user.
   * @returns {boolean} Whether the user can summon.
   */
  async checkDailySummonLimit(userId) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const count = await this.db.collection('daily_summons').countDocuments({
        userId,
        timestamp: { $gte: today },
      });
      return count < this.DAILY_SUMMON_LIMIT;
    } catch (error) {
      this.logger.error(`Error checking summon limit: ${error.message}`);
      return false;
    }
  }

  /**
   * Tracks a summon event for the user.
   * @param {string} userId - The ID of the user.
   */
  async trackSummon(userId) {
    try {
      this.db = await this.databaseService.getDatabase();
      await this.db.collection('daily_summons').insertOne({
        userId,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.error(`Error tracking summon: ${error.message}`);
    }
  }

  /**
   * Executes the summon command, either summoning an existing avatar or creating a new one.
   * @param {Object} message - The Discord message object.
   * @param {Object} params - Parsed command parameters (e.g., { breed, attributes }).
   * @param {Object} avatar - The current avatar context, if applicable.
   * @returns {string} Result message for logging or further processing.
   */
  async execute(message, params = {}, avatar) {
    try {
      this.db = await this.databaseService.getDatabase();
      // Parse command content (assumes a 2-character prefix like "!")
      const content = message.content.trim().substring(2).trim();
      const [avatarName] = content.split('\n').map(line => line.trim());

      // Check for existing avatar
      const existingAvatar = await this.avatarService.getAvatarByName(avatarName);
      if (existingAvatar) {
        // Check if avatar imageUrl is missing or blank, regenerate if needed
        if (!existingAvatar.imageUrl || typeof existingAvatar.imageUrl !== 'string' || existingAvatar.imageUrl.trim() === '') {
          this.logger.info(`Avatar ${existingAvatar.name} (${existingAvatar._id}) has no imageUrl. Generating new image.`);
          const newImageUrl = await this.avatarService.generateAvatarImage(existingAvatar.description);
          existingAvatar.imageUrl = newImageUrl;
        }
        await this.mapService.updateAvatarPosition(existingAvatar, message.channel.id);
        await this.avatarService.updateAvatar(existingAvatar);

        await this.discordService.reactToMessage(message, existingAvatar.emoji || '🔮');
        setTimeout(async () => {
          await this.discordService.sendMiniAvatarEmbed(existingAvatar, message.channel.id);
        }, 1000);
        return `-# ${this.emoji} [ ${existingAvatar.name} has been summoned to this location. ]`;
      }

      // Check summon limit (bypass for specific user ID, e.g., admin)
      const breed = Boolean(params.breed);
      const canSummon = message.author.id === '1175877613017895032' || (await this.checkDailySummonLimit(message.author.id));
      if (!canSummon) {
        await this.discordService.replyToMessage(message, `Daily summon limit of ${this.DAILY_SUMMON_LIMIT} reached. Try again tomorrow!`);
        return '-# [ Failed to summon: Daily limit reached. ]';
      }

      // Get guild configuration
      const guildId = message.guildId || message.guild?.id;
      const guildConfig = await this.configService.getGuildConfig(guildId, true);
      let summonPrompt = guildConfig?.prompts?.summon || 'Create an avatar with the following description:';
      let arweavePrompt = null;
      if (summonPrompt.match(/^(https:\/\/.*\.arweave\.net\/|ar:\/\/)/)) {
        arweavePrompt = summonPrompt;
        summonPrompt = null;
      }
      // Generate stats for the avatar
      const creationDate = new Date();
      const stats = this.statService.generateStatsFromDate(creationDate);

      // Prepare avatar creation data
      const prompt = (summonPrompt
        ? `Avatar Stats: ${JSON.stringify(stats)} \n\n${summonPrompt}`
        : `Avatar Stats: ${JSON.stringify(stats)}`) + 
        `\n\nDesign an avatar with the above stats based on this message from ${message.author.displayName || message.author.displayName}:
        \n\n\t${content}`; 
      const avatarData = {
        prompt,
        channelId: message.channel.id
      };

      // Create new avatar
      const createdAvatar = await this.avatarService.createAvatar(avatarData);
      createdAvatar.stats = stats;
      createdAvatar.createdAt = creationDate;
      createdAvatar.channelId = message.channel.id;
      await this.avatarService.updateAvatar(createdAvatar);

      if (!createdAvatar || !createdAvatar.name) {
        await this.discordService.replyToMessage(message, 'Failed to create avatar. Try a more detailed description.');
        return '-# [ Failed to create avatar. The description may be too vague. ]';
      }

      // Generate introduction
      const introPrompt = guildConfig?.prompts?.introduction || 'You\'ve just arrived. Introduce yourself.';
      const intro = await this.aiService.chat(
        [
          {
            role: 'system',
            content: `You are ${createdAvatar.name}, described as: ${createdAvatar.description}. Your personality is: ${createdAvatar.personality}.`,
          },
          { role: 'user', content: introPrompt },
        ],
        { model: createdAvatar.model }
      );
      createdAvatar.dynamicPersonality = intro;

      // Initialize avatar and react
      await this.avatarService.initializeAvatar(createdAvatar, message.channel.id);

      // Ensure avatar's position is updated in the mapService
      await this.mapService.updateAvatarPosition(createdAvatar, message.channel.id);

      // Track summon if not breeding
      if (!breed) await this.trackSummon(message.author.id);

      // Send final response
      setImmediate(async () => {
        // Send profile and introduction
        await this.discordService.sendAsWebhook(message.channel.id, createdAvatar.imageUrl, createdAvatar);
        await this.discordService.sendAsWebhook(message.channel.id, intro, createdAvatar);
        await this.discordService.sendAvatarEmbed(createdAvatar, message.channel.id, this.aiService);
        // Ensure avatar has correct channelId before response
        createdAvatar.channelId = message.channel.id;
        await this.discordService.reactToMessage(message, createdAvatar.emoji || '🔮');
       });
      return `-# ${this.emoji} [ ${createdAvatar.name} has been summoned into existence. ]`;
    } catch (error) {
      this.logger.error(`Summon error: ${error.message}`);
      this.logger.debug(`${error.stack}`);
      await this.discordService.reactToMessage(message, '❌');
      return `-# [ ❌ Error: Failed to summon: ${error.message} ]`;
    }
  }
}