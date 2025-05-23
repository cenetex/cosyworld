import { handleCommands } from "../commands/commandHandler.mjs";
const CONSTRUCTION_ROADBLOCK_EMOJI = '🚧';

/**
 * Handles Discord messages by processing commands, managing avatars, generating responses,
 * and performing structured content moderation.
 */
export class MessageHandler  {
  /**
   * Constructs the MessageHandler with required services.
   * @param {Object} dependencies - An object containing all necessary service dependencies.
   */
  constructor({
    logger,
    toolService,
    discordService,
    databaseService,
    configService,
    spamControlService,
    schedulingService,
    avatarService,
    decisionMaker,
    conversationManager,
    riskManagerService,
    moderationService,
    mapService,
  }) {
    this.logger = logger || console;
    this.toolService = toolService;
    this.discordService = discordService;
    this.databaseService = databaseService;
    this.configService = configService;
    this.spamControlService = spamControlService;
    this.schedulingService = schedulingService;
    this.avatarService = avatarService;
    this.decisionMaker = decisionMaker;
    this.conversationManager = conversationManager;
    this.riskManagerService = riskManagerService;
    this.moderationService = moderationService;
    this.mapService = mapService;

    this.client = this.discordService.client;
    this.started = false;

    /**
     * Static regex patterns for immediate moderation triggers.
     * URL detection is always included.
     */
    this.staticModerationRegexes = [
      /(https?:\/\/[^\s]+)/i
    ];

    /**
     * Dynamic AI-generated regex pattern (string or null).
     */
    this.dynamicModerationRegex = null;
  }

  async start() {
    if (this.started) {
      this.logger.warn("MessageHandler is already started.");
      return;
    }
    this.started = true;
    this.client.on('messageCreate', (message) => this.handleMessage(message));
    this.logger.info('MessageHandler started.');

    await this.moderationService.refreshDynamicRegex();
  }

  async stop() {
    this.schedulingService.stop();
    this.logger.info('MessageHandler stopped.');
  }

  /**
   * Processes a Discord message through various stages including authorization, spam control,
   * image analysis, command handling, avatar management, and content moderation.
   * @param {Object} message - The Discord message object to process.
   */
  async handleMessage(message) {

    if (this.discordService.messageCache) {
      // Check if the message is already cached
      const cachedMessage = this.discordService.messageCache.get(message.id);
      if (cachedMessage) {
        this.logger.debug(`Message ${message.id} is already cached.`);
        return;
      }
      // Cache the message to avoid reprocessing
      this.discordService.messageCache.set(message.id, message);
      this.logger.debug(`Caching message ${message.id}.`);
    }

    // Persist the message to the database
    await this.databaseService.saveMessage(message);

    const channel = message.channel;
    if (channel && channel.name) {
      if (process.env.NODE_ENV === 'development') {
        // In dev mode, only respond in channels starting with the construction roadblock emoji
        if (!channel.name.startsWith(CONSTRUCTION_ROADBLOCK_EMOJI)) {
          // Ignore messages in channels that do not start with the construction roadblock emoji
          this.logger.debug(`Dev mode: Ignoring message in channel ${channel.name} as it does not start with 🚧.`);
          return;
        }
      } else {
        // In production, ignore channels that start with the construction roadblock emoji
        if (channel.name.startsWith(CONSTRUCTION_ROADBLOCK_EMOJI)) {
          this.logger.debug(`Prod mode: Ignoring message in construction channel ${channel.name}.`);
          return;
        }
      }
    }

    // Ensure the message is from a guild
    if (!message.guild) {
      this.logger.debug("Message not in a guild, skipping.");
      return;
    }

    // Check guild authorization
    if (!(await this.isGuildAuthorized(message))) {
      this.logger.warn(`Guild ${message.guild.name} (${message.guild.id}) not authorized.`);
      return;
    }

    // Apply spam control
    if (!(await this.spamControlService.shouldProcessMessage(message))) {
      this.logger.debug("Message skipped by spam control.");
      return;
    }

    // Analyze images and enhance message object
    await this.handleImageAnalysis(message);

    // Check if the message is from the bot itself
    if (message.author.bot) {
      this.logger.debug("Message is from the bot itself, skipping.");
      return;
    }

    // Check if the message is a command
    const avatar = (await this.avatarService.summonUserAvatar(message)).avatar;
    if (avatar) {
      await handleCommands(message, {
        logger: this.logger,
        toolService: this.toolService,
        discordService: this.discordService,
        mapService: this.mapService,
        configService: this.configService,
      }, avatar, this.conversationManager.getChannelContext(message.channel.id));
    }

    const channelId = message.channel.id;
    const guildId = message.guild.id;

    // Mark the channel as active
    await this.databaseService.markChannelActive(channelId, guildId);

    // Process the channel (initial pass, e.g., for immediate responses)
    await this.processChannel(channelId, message);

    // Structured moderation: analyze links and assign threat level
    await this.moderationService.moderateMessageContent(message);

    // Structured moderation: backlog moderation if needed
    await this.moderationService.moderateBacklogIfNeeded(message.channel);

    this.logger.debug(`Message processed successfully in channel ${channelId}`);
  }

  /**
   * Checks if the guild is authorized to use the bot.
   * @param {Object} message - The Discord message object.
   * @returns {Promise<boolean>} True if authorized, false otherwise.
   */
  async isGuildAuthorized(message) {
    if (!message.guild) return false;
    try {
      const guildId = message.guild.id;
      if (!this.client.authorizedGuilds?.get(guildId)) {
        const db = await this.databaseService.getDatabase();
        if (!db) return false;
        const guildConfig = await this.configService.getGuildConfig(guildId);
        const isAuthorized =
          guildConfig?.authorized === true ||
          (await this.configService.get("authorizedGuilds") || []).includes(guildId);
        this.client.authorizedGuilds = this.client.authorizedGuilds || new Map();
        this.client.authorizedGuilds.set(guildId, isAuthorized);
      }
      return this.client.authorizedGuilds.get(guildId);
    } catch (error) {
      this.logger.error(`Error checking guild authorization: ${error.message}`);
      return false;
    }
  }

  /**
   * Analyzes images in the message and attaches descriptions.
   * @param {Object} message - The Discord message object to enhance.
   */
  async handleImageAnalysis(message) {
    const hasImages =
      message.attachments?.some((a) => a.contentType?.startsWith("image/")) ||
      message.embeds?.some((e) => e.image || e.thumbnail);

    let imageDescription = null;
    if (hasImages && this.toolService.aiService?.analyzeImage) {
      const attachment = message.attachments?.find((a) =>
        a.contentType?.startsWith("image/")
      );
      try {
        if (attachment) {
          imageDescription = await this.toolService.aiService.analyzeImage(attachment.url);
        } else if (message.embeds?.length) {
          // Try to analyze the first embed image if present
          const embedImg = message.embeds.find(e => e.image?.url)?.image?.url || message.embeds.find(e => e.thumbnail?.url)?.thumbnail?.url;
          if (embedImg) {
            imageDescription = await this.toolService.aiService.analyzeImage(embedImg);
          }
        }
        if (imageDescription) {
          this.logger.info(`Generated image description for message ${message.id}: ${imageDescription}`);
        } else {
          imageDescription = "Image analysis failed or returned no description.";
        }
      } catch (error) {
        this.logger.error(`Error analyzing image for message ${message.id}: ${error.message}`);
        imageDescription = "Image analysis failed.";
      }
    } else if (hasImages) {
      imageDescription = "Image present but analysis method not available.";
    }

    message.imageDescription = imageDescription;
    message.hasImages = hasImages;
  }

  /**
   * Processes the channel by selecting avatars and considering responses.
   * @param {string} channelId - The ID of the channel to process.
   * @param {Object} message - The Discord message object.
   */
  async processChannel(channelId, message) {
    try {
      const channel = this.discordService.client.channels.cache.get(channelId);
      if (!channel) {
        this.logger.error(`Channel ${channelId} not found in cache.`);
        return;
      }

      const eligibleAvatars = await this.avatarService.getAvatarsInChannel(channelId, message.guild.id);
      if (!eligibleAvatars || eligibleAvatars.length === 0) {
        this.logger.debug(`No avatars found in channel ${channelId}.`);
        return;
      }

      const avatarsToConsider = this.decisionMaker.selectAvatarsToConsider(
        eligibleAvatars,
        message
      ).slice(0, 5);
      await Promise.all(
        avatarsToConsider.map(async (avatar) => {
          const shouldRespond = await this.decisionMaker.shouldRespond(channel, avatar, message);
          if (shouldRespond) {
            await this.conversationManager.sendResponse(channel, avatar);
          }
        })
      );
    } catch (error) {
      this.logger.error(`Error processing channel ${channelId}: ${error.message}`);
      throw error;
    }
  }
}