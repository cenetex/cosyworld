import { resolveAdminAvatarId } from '../social/adminAvatarResolver.mjs';
import { isModelRosterAvatar } from '../avatar/helpers/isModelRosterAvatar.mjs';
import { isCollectionAvatar, isOnChainAvatar } from '../avatar/helpers/walletAvatarClassifiers.mjs';
import { extractMessageLinks, fetchMessageContext, buildContextSummary } from '../discord/messageLinksHelper.mjs';
/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { handleCommands } from "../commands/commandHandler.mjs";
import { handleBuybotCommands } from "../commands/buybotCommandHandler.mjs";
import { ToolPlannerService } from "../tools/ToolPlannerService.mjs";

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
    buybotService,
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
    this.buybotService = buybotService;

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

  _isPureModelOnlyGuild(guildConfig) {
    const modes = guildConfig?.avatarModes || {};
    const allowModelSummons = modes.pureModel !== false;
    
    // Backwards compat: if legacy 'wallet' exists, use it instead of split modes
    const hasLegacyWallet = modes.wallet !== undefined;
    if (hasLegacyWallet) {
      return Boolean(allowModelSummons && modes.free === false && modes.wallet === false);
    }
    
    return Boolean(allowModelSummons && modes.free === false && modes.onChain === false && modes.collection === false);
  }

  _filterAvatarsByGuildModes(avatars = [], guildConfig = null) {
    if (!Array.isArray(avatars) || avatars.length === 0) {
      return [];
    }

    const modes = guildConfig?.avatarModes || {};
    
    // Backwards compatibility: if old 'wallet' setting exists, map to both new modes
    const hasLegacyWallet = modes.wallet !== undefined;
    const allowOnChain = hasLegacyWallet ? modes.wallet !== false : modes.onChain !== false;
    const allowCollection = hasLegacyWallet ? modes.wallet !== false : modes.collection !== false;
    const allowFree = modes.free !== false;
    const allowPureModel = modes.pureModel !== false;

    // If all modes enabled, no filtering needed
    if (allowFree && allowOnChain && allowCollection && allowPureModel) {
      return avatars;
    }

    return avatars.filter(avatar => {
      if (allowPureModel && isModelRosterAvatar(avatar)) return true;
      if (allowCollection && isCollectionAvatar(avatar)) return true;
      if (allowOnChain && isOnChainAvatar(avatar)) return true;
      if (allowFree && !isModelRosterAvatar(avatar) && !isCollectionAvatar(avatar) && !isOnChainAvatar(avatar)) return true;
      return false;
    });
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

    // === CRITICAL: Check guild authorization FIRST before any processing ===
    // Ensure the message is from a guild
    if (!message.guild) {
      this.logger.debug("Message not in a guild, skipping.");
      return;
    }

    // Check guild authorization BEFORE any database operations or side effects
    if (!(await this.isGuildAuthorized(message))) {
      this.logger.warn(`Guild ${message.guild.name} (${message.guild.id}) not authorized - ignoring message.`);
      return;
    }

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

  // Handle reply tracking - detect if this message is a reply to an avatar
  await this.handleReplyTracking(message);

  // Handle Discord message links - fetch referenced messages and context
  await this.handleMessageLinks(message);

  // Persist the message to the database (now enriched with image fields)
  await this.databaseService.saveMessage(message);

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

    // Check for buybot commands first (!ca, !ca-remove, !ca-list)
    const content = message.content.trim();
    if (content.match(/^[!/]ca(-remove|-list)?(\s|$)/i)) {
      const handled = await handleBuybotCommands(message, {
        buybotService: this.buybotService,
        discordService: this.discordService,
        logger: this.logger,
      });
      if (handled) {
        return; // Command handled, don't process further
      }
    }

    // Check if the message is a command
    const summonResult = await this.avatarService.summonUserAvatar(message);
    const avatar = summonResult?.avatar;
    if (avatar) {
      await handleCommands(message, {
        logger: this.logger,
        toolService: this.toolService,
        discordService: this.discordService,
        mapService: this.mapService,
        configService: this.configService,
      }, avatar, await this.conversationManager.getChannelContext(message.channel.id));
    } else {
      this.logger.warn?.('[MessageHandler] Skipping command handling - failed to summon user avatar');
    }

  const channelId = message.channel.id;
    const guildId = message.guild.id;

    let moderationEnabled = true;
    try {
      const guildConfig = await this.configService.getGuildConfig(guildId);
      const features = guildConfig?.features || {};
      moderationEnabled = features.moderation !== false;
    } catch (err) {
      this.logger.warn?.(`Failed to load guild config for ${guildId}: ${err.message}`);
    }

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
    if (moderationEnabled) {
      await this.moderationService.moderateMessageContent(message);

      // Structured moderation: backlog moderation if needed
      await this.moderationService.moderateBacklogIfNeeded(message.channel);
    } else {
      this.logger.debug?.(`Structured moderation disabled for guild ${guildId}`);
    }

    // Agentic tool planning phase (post-response, general chat only)
    try {
      if (this.toolPlanner && !message.author.bot) {
        const context = await this.conversationManager.getChannelContext(message.channel.id);
        let plannerAvatar = await this.avatarService.getAvatarByUserId(message.author.id, message.guild.id);
        if (!plannerAvatar) {
          plannerAvatar = avatar || (await this.avatarService.summonUserAvatar(message))?.avatar || null;
        }
        if (!plannerAvatar) {
          this.logger.debug?.('[MessageHandler] Agentic planner skipped: no avatar available for planner context');
        } else {
          await this.toolPlanner.planAndMaybeExecute(message, plannerAvatar, context);
        }
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
   * Handles Discord message reply tracking to identify which avatar should respond.
   * When a user replies to an avatar's message, we want that avatar to respond immediately.
   * @param {Object} message - The Discord message object to analyze.
   */
  async handleReplyTracking(message) {
    // Check if this message is a reply
    if (!message.reference?.messageId) {
      this.logger.debug(`[ReplyTracking] No message.reference found - not a reply`);
      return;
    }

    this.logger.info(`[ReplyTracking] 🔗 Detected reply to message ${message.reference.messageId}`);

    try {
      // Find the avatar that sent this message by looking up in the database
      const db = await this.databaseService.getDatabase();
      if (!db) {
        this.logger.error(`[ReplyTracking] Database not available`);
        return;
      }

      // FAST PATH: Look up the original message in our database by messageId
      // This gives us the avatarId directly without name matching issues
      const originalMessage = await db.collection('messages').findOne({
        messageId: message.reference.messageId
      });

      this.logger.info(`[ReplyTracking] Database lookup result: ${originalMessage ? 'found' : 'not found'}, avatarId: ${originalMessage?.avatarId || 'none'}`);

      let avatar = null;

      if (originalMessage?.avatarId) {
        this.logger.info(`[ReplyTracking] ✅ Found original message in DB with avatarId: ${originalMessage.avatarId}`);
        
        // Get the avatar directly by ID
        const ObjectId = (await import('mongodb')).ObjectId;
        avatar = await db.collection('avatars').findOne({
          _id: typeof originalMessage.avatarId === 'string' && ObjectId.isValid(originalMessage.avatarId)
            ? new ObjectId(originalMessage.avatarId)
            : originalMessage.avatarId
        });

        if (avatar) {
          this.logger.info(`[ReplyTracking] ✅ Direct avatar lookup successful: ${avatar.name}`);
        } else {
          this.logger.warn(`[ReplyTracking] Avatar ID ${originalMessage.avatarId} found in message but avatar doesn't exist`);
        }
      } else {
        this.logger.info(`[ReplyTracking] Original message not in DB or no avatarId, falling back to Discord API lookup`);
      }

      // FALLBACK: If we don't have the message in DB or no avatarId, fetch from Discord
      if (!avatar) {
        this.logger.info(`[ReplyTracking] Fetching message from Discord API`);
        
        // Fetch the original message being replied to
        const repliedToMessage = await message.channel.messages.fetch(message.reference.messageId);
        if (!repliedToMessage) {
          this.logger.warn(`[ReplyTracking] Could not fetch replied-to message ${message.reference.messageId}`);
          return;
        }

        this.logger.info(`[ReplyTracking] Fetched original message from ${repliedToMessage.author.username} (webhookId: ${repliedToMessage.webhookId || 'none'}, bot: ${repliedToMessage.author.bot})`);

        // Check if the replied-to message was from our bot (webhook or bot user)
        const isFromBot = repliedToMessage.webhookId || repliedToMessage.author.bot;
        if (!isFromBot) {
          this.logger.info(`[ReplyTracking] Replied-to message is not from an avatar (user message)`);
          return;
        }

        // Look up the avatar by matching the message in our database
        // Webhook messages use the avatar's name as the author username
        // Format: "Name" or "Name🔮" (name + emoji)
        const webhookUsername = repliedToMessage.author.username;
        if (!webhookUsername) {
          this.logger.warn(`[ReplyTracking] No username found in replied-to message`);
          return;
        }

        this.logger.info(`[ReplyTracking] Looking up avatar with webhook username: "${webhookUsername}" in guild ${message.guild.id}`);

        // Try multiple lookup strategies since webhook username = name + emoji
        // Strategy 1: Exact match on name (if webhook didn't include emoji)
        avatar = await db.collection('avatars').findOne({
          name: webhookUsername,
          guildId: message.guild.id
        });

        // Strategy 2: Try removing common emoji patterns and match on name
        if (!avatar) {
          // Remove trailing emojis (most common pattern: "Name🔮")
          const nameWithoutEmoji = webhookUsername.replace(/[\p{Emoji}\p{Emoji_Modifier}\p{Emoji_Component}\p{Emoji_Presentation}]+$/gu, '').trim();
          if (nameWithoutEmoji && nameWithoutEmoji !== webhookUsername) {
            this.logger.info(`[ReplyTracking] Trying without emoji: "${nameWithoutEmoji}"`);
            avatar = await db.collection('avatars').findOne({
              name: nameWithoutEmoji,
              guildId: message.guild.id
            });
          }
        }

        // Strategy 3: Match where webhook username = name + emoji concatenated
        if (!avatar) {
          this.logger.info(`[ReplyTracking] Trying to match name+emoji pattern`);
          const avatarsInGuild = await db.collection('avatars')
            .find({ guildId: message.guild.id })
            .limit(100)
            .toArray();
          
          // Check if any avatar's name+emoji matches the webhook username
          avatar = avatarsInGuild.find(av => {
            const nameWithEmoji = `${av.name}${av.emoji || ''}`;
            return nameWithEmoji === webhookUsername;
          });

          if (avatar) {
            this.logger.info(`[ReplyTracking] Found match via name+emoji concatenation: ${avatar.name}`);
          }
        }

        // Strategy 4: Try matching by name only (without guildId) if still not found
        // This handles cases where the avatar exists but in a different guild context
        if (!avatar) {
          this.logger.info(`[ReplyTracking] Trying name-only lookup (no guildId restriction)`);
          
          // Try exact match
          avatar = await db.collection('avatars').findOne({
            name: webhookUsername
          });
          
          // Try without emoji
          if (!avatar) {
            const nameWithoutEmoji = webhookUsername.replace(/[\p{Emoji}\p{Emoji_Modifier}\p{Emoji_Component}\p{Emoji_Presentation}]+$/gu, '').trim();
            if (nameWithoutEmoji && nameWithoutEmoji !== webhookUsername) {
              avatar = await db.collection('avatars').findOne({
                name: nameWithoutEmoji
              });
            }
          }
          
          // Try name+emoji pattern
          if (!avatar) {
            const allAvatars = await db.collection('avatars')
              .find({})
              .limit(200)
              .toArray();
            
            avatar = allAvatars.find(av => {
              const nameWithEmoji = `${av.name}${av.emoji || ''}`;
              return nameWithEmoji === webhookUsername;
            });
          }
          
          if (avatar) {
            this.logger.info(`[ReplyTracking] ✅ Found match via name-only lookup: ${avatar.name} (guildId: ${avatar.guildId}, channelId: ${avatar.channelId})`);
          }
        }

        if (!avatar) {
          this.logger.warn(`[ReplyTracking] ❌ Could not find avatar with webhook username "${webhookUsername}" in guild ${message.guild.id}`);
          // Try to find any avatar with similar name for debugging
          const allAvatars = await db.collection('avatars').find({ guildId: message.guild.id }).limit(10).toArray();
          this.logger.info(`[ReplyTracking] Available avatars in guild: ${allAvatars.map(a => `${a.name}${a.emoji || ''}`).join(', ')}`);
        }
      }

      if (avatar) {
        this.logger.info(`[ReplyTracking] ✅ User ${message.author.username} replied to avatar ${avatar.name}'s message - MARKING FOR PRIORITY RESPONSE`);
        
        // Add reply context to message for ResponseCoordinator to use
        message.repliedToAvatarId = avatar._id.toString();
        message.repliedToAvatarName = avatar.name;
        
        this.logger.info(`[ReplyTracking] Set message.repliedToAvatarId = ${message.repliedToAvatarId}`);
        
        // Also record affinity if decisionMaker is available
        if (this.decisionMaker?._recordAffinity && !message.author.bot) {
          try {
            this.decisionMaker._recordAffinity(
              message.channel.id,
              message.author.id,
              avatar._id.toString()
            );
            this.logger.info(`[ReplyTracking] Affinity recorded for reply: user ${message.author.id} -> avatar ${avatar.name}`);
          } catch (e) {
            this.logger.warn(`[ReplyTracking] Failed to record affinity for reply: ${e.message}`);
          }
        }
      }
    } catch (error) {
      this.logger.error(`[ReplyTracking] Error handling reply tracking: ${error.message}`, error.stack);
    }
  }

  /**
   * Handles Discord message links - fetches referenced messages and their context
   * When a user includes a Discord message link, we fetch the message and surrounding context
   * @param {Object} message - The Discord message object to analyze
   */
  async handleMessageLinks(message) {
    if (!message.content || typeof message.content !== 'string') {
      return;
    }

    try {
      // Extract all Discord message links from the content
      const messageLinks = extractMessageLinks(message.content);
      
      if (messageLinks.length === 0) {
        this.logger.debug('[MessageLinks] No Discord message links found');
        return;
      }

      this.logger.info(`[MessageLinks] Found ${messageLinks.length} Discord message link(s)`);

      // Fetch context for each linked message
      const contextSummaries = [];
      for (const link of messageLinks) {
        this.logger.debug(`[MessageLinks] Fetching context for ${link.url}`);
        
        // Fetch the message and surrounding context
        const context = await fetchMessageContext(
          this.discordService.client,
          link.channelId,
          link.messageId,
          { before: 3, after: 2 }, // 3 messages before, 2 after
          this.logger
        );

        // Build a formatted summary
        const summary = buildContextSummary(context, link);
        contextSummaries.push(summary);
        
        if (context.target) {
          this.logger.info(`[MessageLinks] Successfully fetched context for message ${link.messageId}`);
        } else {
          this.logger.warn(`[MessageLinks] Could not fetch message ${link.messageId}`);
        }
      }

      // Attach the context summaries to the message object
      // This will be available when building prompts for AI
      if (contextSummaries.length > 0) {
        message.referencedMessageContext = contextSummaries.join('\n\n');
        this.logger.info(`[MessageLinks] Attached ${contextSummaries.length} message context(s) to message`);
      }
    } catch (error) {
      this.logger.error(`[MessageLinks] Error handling message links: ${error.message}`, error.stack);
    }
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

      const guildId = message?.guild?.id || null;
      let guildConfig = null;
      if (guildId && this.configService?.getGuildConfig) {
        try {
          guildConfig = await this.configService.getGuildConfig(guildId);
        } catch (err) {
          this.logger.warn?.(`[MessageHandler] Failed to load guild config for ${guildId}: ${err.message}`);
        }
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
                
                // Activate the mentioned avatar in this channel (deactivating stalest if needed)
                await this.avatarService.activateAvatarInChannel(channelId, String(av._id));
                this.logger.debug?.(`Activated mentioned avatar ${av.name} in ${channelId}`);
              } catch (moveErr) {
                this.logger.warn?.(`Failed moving/activating mentioned avatar ${av.name}: ${moveErr.message}`);
              }
            }
          }
        }
      } catch {}

      let eligibleAvatars = await this.avatarService.getAvatarsInChannel(channelId, message.guild.id);
      eligibleAvatars = this._filterAvatarsByGuildModes(eligibleAvatars, guildConfig);
      
      // Filter wallet avatars to only respond in channels with buybot notifications
      try {
        const buybotService = this.services?.cradle?.buybotService || this.services?.buybotService;
        if (buybotService && buybotService.hasbuybotNotifications) {
          const hasBuybot = await buybotService.hasbuybotNotifications(channelId);
          if (!hasBuybot) {
            // Remove wallet avatars (both onChain and collection) from non-buybot channels
            eligibleAvatars = eligibleAvatars.filter(avatar => {
              const isWallet = isOnChainAvatar(avatar) || isCollectionAvatar(avatar);
              if (isWallet) {
                this.logger.debug?.(`[MessageHandler] Filtered wallet avatar ${avatar.name} - no buybot notifications in channel ${channelId}`);
                return false;
              }
              return true;
            });
          }
        }
      } catch (filterError) {
        this.logger.warn?.(`[MessageHandler] Failed to filter wallet avatars by buybot status: ${filterError.message}`);
      }
      
      // Reorder by priority: in-channel already, then owned by user, then exact name matches
      try {
        eligibleAvatars = await this.avatarService.prioritizeAvatarsForMessage(eligibleAvatars, message);
      } catch {}
      if (!eligibleAvatars || eligibleAvatars.length === 0) {
        this.logger.debug(`No avatars found in channel ${channelId}.`);
        return;
      }

      // Quick pass: if user explicitly mentions an avatar by name/emoji, set stickiness and activate
      try {
        if (message?.author && !message.author.bot && typeof message.content === 'string' && message.content.trim()) {
          let mentioned = null;
          if (this.avatarService?.matchAvatarsByContent) {
            const mentionMatches = this.avatarService.matchAvatarsByContent(message.content, eligibleAvatars, { limit: 1 });
            mentioned = mentionMatches[0];
          } else {
            const lower = message.content.toLowerCase();
            mentioned = eligibleAvatars.find(av => {
              const name = String(av.name || '').toLowerCase();
              const emo = String(av.emoji || '').toLowerCase();
              if (!name && !emo) return false;
              return (name && lower.includes(name)) || (emo && lower.includes(emo));
            });
          }
          if (mentioned) {
            const avId = `${mentioned._id || mentioned.id}`;
            
            // Record affinity
            if (this.decisionMaker?._recordAffinity) {
              this.decisionMaker._recordAffinity(channelId, message.author.id, avId);
              this.logger.debug?.(`Affinity recorded for user ${message.author.id} -> avatar ${avId} in ${channelId}`);
            }
            
            // Activate the mentioned avatar (may deactivate stalest if at capacity)
            try {
              await this.avatarService.activateAvatarInChannel(channelId, avId);
              this.logger.debug?.(`Activated mentioned avatar ${mentioned.name} in ${channelId}`);
            } catch (activateErr) {
              this.logger.warn?.(`Failed to activate mentioned avatar: ${activateErr.message}`);
            }
          }
        }
      } catch {}

      // Use ResponseCoordinator for all responses
      await this.responseCoordinator.coordinateResponse(channel, message, {
        guildId: message.guild.id,
        avatars: eligibleAvatars
      });
    } catch (error) {
      this.logger.error(`Error processing channel ${channelId}: ${error.message}`);
      throw error;
    }
  }
}