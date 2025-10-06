import { resolveAdminAvatarId } from '../social/adminAvatarResolver.mjs';
/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { handleCommands } from "../commands/commandHandler.mjs";
import { ToolPlannerService } from "../tools/ToolPlannerService.mjs";
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
  turnScheduler,
    avatarService,
    decisionMaker,
    conversationManager,
    riskManagerService,
    moderationService,
    mapService,
    responseCoordinator,
  }) {
    this.logger = logger || console;
    this.toolService = toolService;
    this.discordService = discordService;
    this.databaseService = databaseService;
    this.configService = configService;
    this.spamControlService = spamControlService;
    this.schedulingService = schedulingService;
  this.turnScheduler = turnScheduler;
    this.avatarService = avatarService;
    this.decisionMaker = decisionMaker;
    this.conversationManager = conversationManager;
    this.riskManagerService = riskManagerService;
    this.moderationService = moderationService;
    this.mapService = mapService;
    this.responseCoordinator = responseCoordinator;

    // Feature flag for unified coordinator
    this.USE_COORDINATOR = String(process.env.UNIFIED_RESPONSE_COORDINATOR || 'false').toLowerCase() === 'true';

  // Lazy-initialized tool planner; constructed in start() to ensure services are ready
  this.toolPlanner = null;

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

    // Initialize tool planner
    try {
      this.toolPlanner = new ToolPlannerService({
        logger: this.logger,
        configService: this.configService,
        toolService: this.toolService,
        schedulingService: this.schedulingService,
      });
    } catch (e) {
      this.logger.warn?.(`ToolPlanner init failed: ${e.message}`);
      this.toolPlanner = null;
    }
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
    const corrId = `msg:${message.id}`;
    return this.logger.withCorrelation ? this.logger.withCorrelation(corrId, () => this._handleMessageInner(message)) : this._handleMessageInner(message);
  }

  async _handleMessageInner(message) {

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

  // Analyze images and enhance message object BEFORE persisting so captions are saved
  await this.handleImageAnalysis(message);

  // Persist the message to the database (now enriched with image fields)
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

    // (Images already analyzed above before save)

    // Optional: Auto-post images to X for admin account with channel summary
    try {
      const autoX = String(process.env.X_AUTO_POST_IMAGES || 'false').toLowerCase();
      if (autoX === 'true' && message.hasImages && this.toolService?.xService) {
        // Resolve admin identity
        let admin = null;
        try {
          const envId = resolveAdminAvatarId();
          if (envId && /^[a-f0-9]{24}$/i.test(envId)) {
            admin = await this.avatarService.getAvatarById(envId);
          } else {
            const aiCfg = this.configService?.getAIConfig?.(process.env.AI_SERVICE);
            const model = aiCfg?.chatModel || aiCfg?.model || process.env.OPENROUTER_CHAT_MODEL || process.env.GOOGLE_AI_CHAT_MODEL || 'default';
            const safe = String(model).toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
            admin = { _id: `model:${safe}`, name: `System (${model})`, username: process.env.X_ADMIN_USERNAME || undefined };
          }
        } catch {}
        if (admin) {
          // Compute a short channel summary context
          let summary = await this.conversationManager.getChannelSummary(admin._id, message.channel.id);
          if (typeof summary !== 'string') summary = String(summary || '').slice(0, 180);
          const caption = `${message.imageDescription || 'Image'} — ${summary}`.slice(0, 240);
          const imgUrl = message.primaryImageUrl || (Array.isArray(message.imageUrls) ? message.imageUrls[0] : null);
          if (imgUrl) {
            try { await this.toolService.xService.postImageToX(admin, imgUrl, caption); } catch (e) { this.logger.warn?.(`Auto X image post failed: ${e.message}`); }
          }
        }
      }
    } catch (e) { this.logger.debug?.(`auto X image post skipped: ${e.message}`); }

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
    // Fast-lane: try targeted avatar responses via scheduler leases first
    try {
      if (this.turnScheduler) {
        await this.turnScheduler.onHumanMessage(channelId, message);
      }
    } catch (e) {
      this.logger.warn(`Fast-lane scheduling error: ${e.message}`);
    }

    await this.processChannel(channelId, message);

    // Structured moderation: analyze links and assign threat level
    await this.moderationService.moderateMessageContent(message);

    // Structured moderation: backlog moderation if needed
    await this.moderationService.moderateBacklogIfNeeded(message.channel);

    // Agentic tool planning phase (post-response, general chat only)
    try {
      if (this.toolPlanner && !message.author.bot) {
        const context = this.conversationManager.getChannelContext(message.channel.id) || {};
        await this.toolPlanner.planAndMaybeExecute(message, (await this.avatarService.getAvatarByUserId(message.author.id, message.guild.id)) || (await this.avatarService.summonUserAvatar(message)).avatar, context);
      }
    } catch (e) {
      this.logger.debug?.(`Agentic planner skipped: ${e.message}`);
    }

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

    let imageDescriptions = [];
    let imageDescription = null;
    let imageUrls = [];
    let primaryImageUrl = null;
    if (hasImages) {
      // Collect all candidate image URLs from attachments and embeds
      try {
        const attachmentUrls = Array.from(message.attachments?.values?.() || [])
          .filter(a => a?.contentType?.startsWith('image/'))
          .map(a => a.url)
          .filter(Boolean);
        const embedUrls = (message.embeds || []).map(e => e?.image?.url || e?.thumbnail?.url).filter(Boolean);
        const allUrls = [...attachmentUrls, ...embedUrls].filter(Boolean);
        // Deduplicate while preserving order
        const seen = new Set();
        imageUrls = allUrls.filter(u => { if (seen.has(u)) return false; seen.add(u); return true; });
        primaryImageUrl = imageUrls[0] || null;
      } catch {}

      // Analyze each image URL if analyzer available, otherwise provide a generic caption
      if (this.toolService.aiService?.analyzeImage && imageUrls.length) {
        for (const url of imageUrls) {
          try {
            const caption = await this.toolService.aiService.analyzeImage(
              url,
              undefined,
              'Write a concise, neutral caption (<=120 chars) that describes this image for context.'
            );
            imageDescriptions.push((caption && String(caption).trim()) || 'Image (no caption).');
          } catch (e) {
            this.logger.warn?.(`Image caption failed for ${url}: ${e.message}`);
            imageDescriptions.push('Image (caption unavailable).');
          }
        }
      } else if (hasImages) {
        // No analyzer; fallback generic
        imageDescriptions = imageUrls.map(() => 'Image present.');
      }

      // Derive a combined one-line description for legacy consumers
      if (imageDescriptions.length) {
        imageDescription = imageDescriptions.length === 1
          ? imageDescriptions[0]
          : imageDescriptions.map((c, i) => `${i + 1}) ${c}`).join(' | ');
        this.logger.info(`Generated ${imageDescriptions.length} image caption(s) for message ${message.id}`);
      }
    }

    message.imageDescriptions = imageDescriptions;
    message.imageDescription = imageDescription;
    message.hasImages = hasImages;
    message.imageUrls = imageUrls;
    message.primaryImageUrl = primaryImageUrl;
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

      // If users mention an avatar by name/emoji anywhere in the guild, move that avatar to this channel
      try {
        if (message?.content && message.guild?.id) {
          const globalMentions = await this.avatarService.findMentionedAvatarsInGuild(message.content, message.guild.id, 3);
          if (globalMentions?.length) {
            const mapSvc = this.mapService || (this.toolService?.toolServices?.mapService);
            for (const av of globalMentions) {
              try {
                if (String(av.channelId) !== String(channelId) && mapSvc?.updateAvatarPosition) {
                  await mapSvc.updateAvatarPosition(av, channelId, av.channelId);
                  this.logger.debug?.(`Moved mentioned avatar ${av.name} to ${channelId}`);
                }
              } catch (moveErr) {
                this.logger.warn?.(`Failed moving mentioned avatar ${av.name}: ${moveErr.message}`);
              }
            }
          }
        }
      } catch {}

      let eligibleAvatars = await this.avatarService.getAvatarsInChannel(channelId, message.guild.id);
      // Reorder by priority: in-channel already, then owned by user, then exact name matches
      try {
        eligibleAvatars = await this.avatarService.prioritizeAvatarsForMessage(eligibleAvatars, message);
      } catch {}
      if (!eligibleAvatars || eligibleAvatars.length === 0) {
        this.logger.debug(`No avatars found in channel ${channelId}.`);
        return;
      }

      // Quick pass: if user explicitly mentions an avatar by name/emoji, set stickiness
      try {
        if (message?.author && !message.author.bot && typeof message.content === 'string' && message.content.trim()) {
          const lower = message.content.toLowerCase();
          const mentioned = eligibleAvatars.find(av => {
            const name = String(av.name || '').toLowerCase();
            const emo = String(av.emoji || '').toLowerCase();
            if (!name && !emo) return false;
            return (name && lower.includes(name)) || (emo && lower.includes(emo));
          });
          if (mentioned && this.decisionMaker?._recordAffinity) {
            const avId = `${mentioned._id || mentioned.id}`;
            this.decisionMaker._recordAffinity(channelId, message.author.id, avId);
            this.logger.debug?.(`Affinity recorded for user ${message.author.id} -> avatar ${avId} in ${channelId}`);
          }
        }
      } catch {}

      // Use ResponseCoordinator if enabled
      if (this.USE_COORDINATOR && this.responseCoordinator) {
        await this.responseCoordinator.coordinateResponse(channel, message, {
          guildId: message.guild.id,
          avatars: eligibleAvatars
        });
        return;
      }

      // Legacy path (original implementation)
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