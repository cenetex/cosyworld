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
    presenceService,
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
  this.presenceService = presenceService;
    this.logger = logger;

    this.name = 'summon';
    this.description = 'Summons a new avatar';
    this.emoji = '🔮'; // Default emoji
  // Limit: one summon per user per day (excluding admin override)
  this.DAILY_SUMMON_LIMIT = 18;
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
  // Always ensure DB reference (in case called before execute sets this.db)
  this.db = this.db || await this.databaseService.getDatabase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const count = await this.db.collection('daily_summons').countDocuments({ userId, timestamp: { $gte: today } });
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
  this.db = this.db || await this.databaseService.getDatabase();
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
  async execute(message, params = {}, _avatar) {
    try {
      this.db = await this.databaseService.getDatabase();
      // Parse command content robustly: remove leading emoji + optional word 'summon'
      const raw = message.content.trim();
      const content = raw
        .replace(/^<a?:\w+?:\d+>\s*/,'') // custom discord emoji
        .replace(/^\p{Extended_Pictographic}+\s*/u,'') // unicode emoji(s)
        .replace(/^(summon)\s+/i,'')
        .trim();
      const [avatarName] = content.split(/\n|[,.;:]/).map(l => l.trim()).filter(Boolean);
      if (!avatarName) {
        await this.discordService.replyToMessage(message, 'Provide a name or description to summon an avatar.');
        return '-# [ Summon aborted: no description provided. ]';
      }

      // Check for existing avatar
      const existingAvatar = await this.avatarService.getAvatarByName(avatarName);
      if (existingAvatar) {
        const alreadyHere = existingAvatar.channelId === message.channel.id;
        // Ensure avatar has an image
        if (!existingAvatar.imageUrl || typeof existingAvatar.imageUrl !== 'string' || existingAvatar.imageUrl.trim() === '') {
          try {
            this.logger.info(`Avatar ${existingAvatar.name} (${existingAvatar._id}) missing imageUrl. Regenerating.`);
            existingAvatar.imageUrl = await this.avatarService.generateAvatarImage(existingAvatar.description);
          } catch (e) {
            this.logger.warn(`Failed to regenerate image for ${existingAvatar.name}: ${e.message}`);
          }
        }
        if (!alreadyHere) {
          // Move avatar to this channel
            await this.mapService.updateAvatarPosition(existingAvatar, message.channel.id);
            existingAvatar.channelId = message.channel.id;
            await this.avatarService.updateAvatar(existingAvatar);
        }
        await this.discordService.reactToMessage(message, existingAvatar.emoji || '🔮');
        if (alreadyHere) {
          // Trigger brief speech instead of full panel
          try {
            const speech = await this.aiService.chat([
              { role: 'system', content: `You are ${existingAvatar.name}, ${existingAvatar.description}. Keep responses under 120 characters.` },
              { role: 'user', content: `You were just redundantly summoned again in the same spot. React briefly, maybe playfully.` }
            ], { model: existingAvatar.model });
            await this.discordService.sendAsWebhook(message.channel.id, speech || `${existingAvatar.name} acknowledges the summon.`, existingAvatar);
          } catch (e) {
            this.logger.warn(`Failed to generate brief speech for existing avatar: ${e.message}`);
          }
          return `-# ${this.emoji} [ ${existingAvatar.name} was already here. They respond. ]`;
        } else {
          // Arrival mini embed
          setTimeout(async () => {
            await this.discordService.sendMiniAvatarEmbed(existingAvatar, message.channel.id, `${existingAvatar.name} arrives.`);
          }, 800);
          return `-# ${this.emoji} [ ${existingAvatar.name} moves to this location. ]`;
        }
      }

      // Check summon limit (bypass for specific user ID, e.g., admin)
      const breed = Boolean(params.breed);
      const canSummon = message.author.id === '1175877613017895032' || (await this.checkDailySummonLimit(message.author.id));
    if (!canSummon) {
      // Friendly singular message (avoid spam)
      await this.discordService.replyToMessage(message, `You've already summoned an avatar today. (Daily limit: ${this.DAILY_SUMMON_LIMIT})`);
      return '-# [ Summon rejected: daily limit reached. ]';
      }

      // Get guild configuration
      const guildId = message.guildId || message.guild?.id;
      const guildConfig = await this.configService.getGuildConfig(guildId, true);
      let summonPrompt = guildConfig?.prompts?.summon || 'Create an avatar with the following description:';
  let _arweavePrompt = null;
      if (summonPrompt.match(/^(https:\/\/.*\.arweave\.net\/|ar:\/\/)/)) {
  _arweavePrompt = summonPrompt;
  summonPrompt = null;
      }
      // Generate stats for the avatar
      const creationDate = new Date();
      const stats = this.statService.generateStatsFromDate(creationDate);

      // Prepare avatar creation data
      const displayAuthor = message.author.displayName || message.author.username || 'Unknown Summoner';
      const prompt = (summonPrompt ? `Avatar Stats: ${JSON.stringify(stats)} \n\n${summonPrompt}` : `Avatar Stats: ${JSON.stringify(stats)}`) +
        `\n\nDesign an avatar with the above stats based on this message from ${displayAuthor}:\n\n\t${content}`;
      const avatarData = {
        prompt,
        channelId: message.channel.id
      };

      // Create new avatar
      const createdAvatar = await this.avatarService.createAvatar(avatarData);
      const wasExisting = createdAvatar?._existing === true;
      if (!createdAvatar) {
        await this.discordService.replyToMessage(message, 'Failed to create avatar. Try a more detailed description.');
        return '-# [ Failed to create avatar. The description may be too vague. ]';
      }

      if (!wasExisting) {
        // Only set initial stats & timestamps for brand new avatars
        createdAvatar.stats = stats;
        createdAvatar.createdAt = creationDate;
        createdAvatar.channelId = message.channel.id;
        await this.avatarService.updateAvatar(createdAvatar);
      } else {
        // Ensure channel/location sync for existing avatar name collision
        if (createdAvatar.channelId !== message.channel.id) {
          await this.mapService.updateAvatarPosition(createdAvatar, message.channel.id);
          createdAvatar.channelId = message.channel.id;
          await this.avatarService.updateAvatar(createdAvatar);
        }
        await this.discordService.reactToMessage(message, createdAvatar.emoji || '🔮');
        // Provide a lightweight acknowledgement instead of full intro/embed
        try {
          const brief = await this.aiService.chat([
            { role: 'system', content: `You are ${createdAvatar.name}, ${createdAvatar.description}. Keep response under 120 characters.` },
            { role: 'user', content: 'Someone attempted to summon you again, but you already exist. Acknowledge succinctly.' }
          ], { model: createdAvatar.model });
          await this.discordService.sendAsWebhook(message.channel.id, brief || `${createdAvatar.name} is already among you.`, createdAvatar);
        } catch (e) {
          this.logger.warn(`Re‑summon brief response failed: ${e.message}`);
        }
        return `-# ${this.emoji} [ Existing avatar ${createdAvatar.name} referenced; avoided duplicate introduction. ]`;
      }

      if (!createdAvatar || !createdAvatar.name) {
        await this.discordService.replyToMessage(message, 'Failed to create avatar. Try a more detailed description.');
        return '-# [ Failed to create avatar. The description may be too vague. ]';
      }

      // Generate introduction
      const introPrompt = guildConfig?.prompts?.introduction || 'You\'ve just arrived. Introduce yourself.';
      let intro = await this.aiService.chat(
        [
          {
            role: 'system',
            content: `You are ${createdAvatar.name}, described as: ${createdAvatar.description}. Your personality is: ${createdAvatar.personality}.`,
          },
          { role: 'user', content: introPrompt },
        ],
        { model: createdAvatar.model }
      );
      // Extract <think> tags from intro, store as thoughts & strip before sending
      try {
        const thinkRegex = /<think>(.*?)<\/think>/gs;
        const thoughts = [];
        const cleanedIntro = intro.replace(thinkRegex, (m, inner) => { thoughts.push(inner.trim()); return ''; }).trim();
        if (thoughts.length) {
          createdAvatar.thoughts = createdAvatar.thoughts || [];
            // Prepend new thoughts, keep only most recent 20
          thoughts.forEach(t => t && createdAvatar.thoughts.unshift({ content: t, timestamp: Date.now(), guildName: message.guild?.name || 'Unknown' }));
          createdAvatar.thoughts = createdAvatar.thoughts.slice(0, 20);
        }
        intro = cleanedIntro || '(The avatar arrives silently, deep in thought.)';
      } catch (e) {
        this.logger.warn(`Failed to process <think> tags in intro: ${e.message}`);
      }
      createdAvatar.dynamicPersonality = intro; // use cleaned intro as initial dynamic personality snapshot

      // Initialize avatar and react
      await this.avatarService.initializeAvatar(createdAvatar, message.channel.id);
      // Presence priority: mark start session & grant guaranteed early turns
      try {
        if (this.presenceService?.startSession) {
          await this.presenceService.startSession(message.channel.id, `${createdAvatar._id}`);
          await this.presenceService.grantNewSummonTurns(message.channel.id, `${createdAvatar._id}`, 3);
        }
      } catch (e) { this.logger?.warn?.(`Failed to grant new summon priority: ${e.message}`); }

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