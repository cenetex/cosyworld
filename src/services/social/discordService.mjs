/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

// discordService.mjs
import {
  Client,
  GatewayIntentBits,
  Partials,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { WebhookManager } from '../../utils/WebhookManager.mjs';
import { RateLimitHandler } from '../../utils/RateLimitHandler.mjs';
import { AuthorizationCache } from '../../utils/AuthorizationCache.mjs';
import { ObjectId } from 'mongodb';
import { chunkMessage } from '../../utils/messageChunker.mjs';
import { processMessageLinks } from '../../utils/linkProcessor.mjs';
import { filterContent, stripUrls } from '../../utils/contentFilter.mjs';
import { buildMiniAvatarEmbed, buildFullAvatarEmbed, buildMiniLocationEmbed, buildFullItemEmbed, buildFullLocationEmbed } from './discordEmbedLibrary.mjs';
import GuildConnectionRepository from '../../dal/GuildConnectionRepository.mjs';
import { createDiscordAdapter } from '../agent/platformAdapters.mjs';

export class DiscordService {
  constructor(services) {
    this.logger = services.logger;
    this.configService = services.configService;
    this.databaseService = services.databaseService;
    // Optional cross-service hooks (late-binding to avoid circular deps)
    this.getMapService = services.getMapService || null;
    this.getCombatEncounterService = services.getCombatEncounterService || null;
    this.avatarService = services.avatarService || null;
    this.globalBotService = services.globalBotService || null;
    this.getBuybotService = typeof services.getBuybotService === 'function'
      ? services.getBuybotService
      : () => services.buybotService;
    // Unified Chat Agent for @mention handling (late-binding to avoid circular deps)
    this.getUnifiedChatAgent = typeof services.getUnifiedChatAgent === 'function'
      ? services.getUnifiedChatAgent
      : () => services.unifiedChatAgent;
    // ToolService for direct tool invocation from button interactions
    this.getToolService = typeof services.getToolService === 'function'
      ? services.getToolService
      : () => services.toolService;
    // AI Service for agent responses
    this.aiService = services.aiService || null;
    // Repositories
    this.guildConnectionRepository = services.guildConnectionRepository || new GuildConnectionRepository({ databaseService: this.databaseService, logger: this.logger });
    
    // Mention handling state
    this._mentionReplyQueue = new Map(); // channelId -> { message, timestamp }
    this._mentionReplyDebounceMs = 2000; // Wait 2 seconds for more messages before responding
    
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
      ],
      partials: [Partials.Message, Partials.Channel, Partials.Reaction],
    });
    
    // Initialize rate limit handler for Discord API operations
    this.rateLimitHandler = new RateLimitHandler({
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      logger: this.logger,
    });
    
    // Initialize webhook manager with TTL-based caching (replaces simple webhookCache Map)
    this.webhookManager = new WebhookManager({
      ttlMs: 30 * 60 * 1000, // 30 minutes
      maxCacheSize: 1000,
      cleanupIntervalMs: 5 * 60 * 1000, // 5 minutes
      logger: this.logger,
      client: this.client,
    });
    
    // Legacy webhookCache for backwards compatibility (deprecated, use webhookManager)
    this.webhookCache = new Map();
    
    // Initialize authorization cache with TTL expiration
    this.authorizationCache = new AuthorizationCache({
      ttlMs: 5 * 60 * 1000, // 5 minutes for authorized guilds
      negativeTtlMs: 60 * 1000, // 1 minute for unauthorized guilds
      cleanupIntervalMs: 60 * 1000,
      logger: this.logger,
    });
    
    this.setupEventListeners();

    this.messageCache = new Map(); // Initialize message cache
  }

  async login() {
    const discordConfig = this.configService.getDiscordConfig();
    if (!discordConfig?.botToken) {
      this.logger.error('Discord bot token not configured.');
      throw new Error('Discord bot token is required');
    }
    await this.client.login(discordConfig.botToken);
    this.logger.info('Discord client logged in');
  }

  async shutdown() {
    // Shutdown managers first
    if (this.webhookManager) {
      this.webhookManager.shutdown();
    }
    if (this.authorizationCache) {
      this.authorizationCache.shutdown();
    }
    
    if (this.client) {
      await this.client.destroy();
      this.logger.info('Disconnected from Discord.');
    }
  }

  setupEventListeners() {
    this.client.once('clientReady', async () => {
      this.logger.info(`Bot is ready as ${this.client.user.tag}`);
      await this.updateConnectedGuilds();
      // Run guild detection in background to avoid blocking startup
      setImmediate(() => {
        this.updateDetectedGuilds().catch(err => 
          this.logger.error('Background guild detection failed:', err)
        );
      });
      this.client.guildWhitelist = new Map(); // Initialize guild whitelist cache
    });

    this.client.on('guildCreate', async guild => {
      this.logger.info(`Joined guild: ${guild.name} (${guild.id})`);
      await this.updateConnectedGuilds();
      // Run guild detection in background
      setImmediate(() => {
        this.updateDetectedGuilds().catch(err => 
          this.logger.error('Background guild detection failed:', err)
        );
      });
    });

    this.client.on('guildDelete', async guild => {
      try {
        this.logger.info(`Left guild: ${guild.name} (${guild.id})`);
        await this.guildConnectionRepository.removeConnectedGuild(guild.id);
      } catch (error) {
        this.logger.error(`Failed to remove guild ${guild.id} from database: ${error.message}`);
      }
    });

    this.client.on('interactionCreate', async interaction => {
      try {
        this.db = await this.databaseService.getDatabase();
        
        // Handle modal submissions
        if (interaction.isModalSubmit()) {
          await this._handleModalSubmit(interaction);
          return;
        }
        
        if (!interaction.isButton()) return;
        
        // Handle puzzle answer button - show modal
        if (interaction.customId === 'dnd_puzzle_answer') {
          await this._showPuzzleAnswerModal(interaction);
          return;
        }
        
        // Check guild authorization for interactions using the authorization cache
        if (interaction.guild) {
          const guildId = interaction.guild.id;
          const isAuthorized = await this.authorizationCache.check(guildId, async () => {
            const guildConfig = await this.configService.getGuildConfig(guildId);
            return guildConfig?.authorized === true || 
              (await this.configService.get("authorizedGuilds") || []).includes(guildId);
          });
          
          if (!isAuthorized) {
            this.logger.warn(`Interaction in unauthorized guild: ${interaction.guild.name} (${guildId})`);
            return;
          }
        }
        
        const { customId } = interaction;
        
        // Handle attack target selection buttons
        if (customId.startsWith('attack_target_')) {
          const targetToken = customId.replace('attack_target_', '');
          let targetName = targetToken;
          try {
            targetName = decodeURIComponent(targetToken);
          } catch {
            targetName = targetToken.replace(/_/g, ' ');
          }
          try {
            await interaction.deferUpdate();
            
            // Get avatar for the user who clicked
            const avatar = await this._getAvatarForInteraction(interaction);
            if (!avatar) {
              await interaction.followUp({ content: '❌ You need an avatar to attack!', flags: 64 });
              return;
            }
            
            // Execute attack directly via tool service
            const toolService = this.getToolService?.();
            if (toolService) {
              const result = await toolService.executeTool('attack', interaction.message, [targetName], avatar);
              if (result && typeof result === 'object' && (result.embeds || result.content)) {
                const channel = await this.client.channels.fetch(interaction.channel.id);
                if (channel) await channel.send(result);
              } else if (result && typeof result === 'string') {
                const channel = await this.client.channels.fetch(interaction.channel.id);
                if (channel) await channel.send(result);
              }
            } else {
              // Fallback: post message that will be handled by message handler
              const channel = await this.client.channels.fetch(interaction.channel.id);
              if (channel) {
                await channel.send({
                  content: `🗡️ attack ${targetName}`,
                  allowedMentions: { users: [] }
                });
              }
            }
          } catch (e) {
            this.logger?.error?.(`[DiscordService] Attack target button error: ${e.message}`);
            try {
              await interaction.followUp({ content: `❌ Failed to attack: ${e.message}`, flags: 64 });
            } catch {}
          }
          return;
        }
        
        // Handle D&D button interactions (dnd_*) - direct tool invocation with ephemeral responses
        if (customId.startsWith('dnd_')) {
          await this._handleDndButtonInteraction(interaction);
          return;
        }
        
        // Handle battle video generation button
        if (customId.startsWith('generate_battle_video_')) {
          const channelId = customId.replace('generate_battle_video_', '');
          
          try {
            // Check if interaction is already acknowledged or expired
            if (interaction.replied || interaction.deferred) {
              this.logger.warn?.('[DiscordService] Battle video button already processed');
              return;
            }
            
            let interactionExpired = false;
            
            // Try to acknowledge the button click
            try {
              await interaction.deferUpdate();
            } catch (deferError) {
              // Interaction expired - this is OK, we'll work around it
              const errMsg = String(deferError?.message || '').toLowerCase();
              if (errMsg.includes('unknown interaction') || errMsg.includes('interaction has already been acknowledged')) {
                this.logger.info?.('[DiscordService] Battle video button interaction expired - creating new status message');
                interactionExpired = true;
              } else {
                throw deferError; // Re-throw if it's a different error
              }
            }
            
            // Check if combat encounter service is available (late-binding to avoid circular deps)
            const combatEncounterService = this.getCombatEncounterService?.();
            if (!combatEncounterService) {
              if (interactionExpired) {
                const channel = await this.client.channels.fetch(channelId);
                await channel.send({ content: '❌ Combat system not available' });
              } else {
                await interaction.followUp({ content: '❌ Combat system not available', flags: 64 });
              }
              return;
            }
            
            // If interaction expired, create a new status message instead of using the original
            let statusMessageId = null;
            if (interactionExpired) {
              const channel = await this.client.channels.fetch(channelId);
              const statusMsg = await channel.send({ 
                content: '🎬 **Generating Battle Recap Videos...**\nPreparing scenes...' 
              });
              statusMessageId = statusMsg.id;
            } else {
              statusMessageId = interaction.message.id;
            }
            
            // Generate videos with live status updates
            const result = await combatEncounterService.generateBattleRecapVideos(
              channelId,
              statusMessageId
            );
            
            if (!result.success) {
              this.logger.warn?.(`[DiscordService] Battle video generation failed: ${result.error}`);
              
              // Provide user-friendly feedback for specific errors
              if (result.error === 'Video generation already in progress') {
                const channel = await this.client.channels.fetch(channelId);
                await channel.send({ content: '⏳ Video generation is already in progress. Please wait for it to complete.' });
              } else if (result.error === 'Video already generated for this combat') {
                const channel = await this.client.channels.fetch(channelId);
                await channel.send({ content: '✅ Battle recap video has already been generated for this combat.' });
              }
            }
            
          } catch (error) {
            this.logger.error?.(`[DiscordService] Battle video button error: ${error.message}`);
            try {
              // Try to send error message to the channel
              const channel = await this.client.channels.fetch(channelId);
              await channel.send({ content: `❌ Failed to generate battle videos: ${error.message}` });
            } catch (sendError) {
              this.logger.error?.(`[DiscordService] Failed to send error message: ${sendError.message}`);
            }
          }
          
          return; // Exit early after handling
        }
        
        // Handle existing view_full_ buttons
        if (!customId.startsWith('view_full_')) return;

        await interaction.deferReply({ flags: 64 });

        const parts = customId.split('_');
        const type = parts[2];
        const id = ObjectId.createFromHexString(parts.slice(3).join('_'));

        let embedData;
        if (type === 'avatar') {
          const avatar = await this.db.collection('avatars').findOne({ _id: id });
          if (!avatar) return interaction.editReply('Avatar not found.');
          embedData = buildFullAvatarEmbed(avatar);
        } else if (type === 'item') {
          const item = await this.db.collection('items').findOne({ _id: id });
          if (!item) return interaction.editReply('Item not found.');
          embedData = buildFullItemEmbed(item);
        } else if (type === 'location') {
          const location = await this.db.collection('locations').findOne({ _id: id });
          if (!location) return interaction.editReply('Location not found.');
          embedData = buildFullLocationEmbed(location);
        } else {
          return interaction.editReply('Unknown profile type.');
        }

        await interaction.editReply({ embeds: [embedData.embed], components: embedData.components || [] });
      } catch (error) {
        this.logger.error('Interaction handler error: ' + error.message);
        try {
          if (interaction.deferred || interaction.replied) {
            await interaction.editReply('Failed to load profile.');
          } else {
            await interaction.reply({ content: 'Failed to load profile.', flags: 64 });
          }
        } catch (err) {
          this.logger.error('Failed to send error reply: ' + err.message);
        }
      }
    });

    // Simple text command: !link to get a one-time code via DM
    this.client.on('messageCreate', async (message) => {
      try {
        if (message.author.bot) return;
        const content = (message.content || '').trim();
        if (!content.startsWith('!link')) return;
  await this.databaseService.getDatabase();

  // Resolve a single public origin and use it for both API and the DM link
  const rawPublicBase = process.env.PUBLIC_BASE_URL || process.env.API_URL || 'http://0.0.0.0:3000';
  let publicOrigin = 'http://0.0.0.0:3000';
  try { publicOrigin = new URL(rawPublicBase).origin; } catch {}
  const initiateUrl = `${publicOrigin}/api/link/initiate`;

        const res = await fetch(initiateUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ discordId: message.author.id, guildId: message.guild?.id })
        }).then(async r => {
          // Try to parse JSON even on non-2xx to surface server-provided error
          const data = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
          if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
          return data;
        });
        const code = res?.code;
        if (!code) throw new Error('Failed to obtain link code from API');

  // Build a fully-qualified link page URL on the same origin
  const url = `${publicOrigin}/link.html?code=${encodeURIComponent(code)}`;
        const embed = {
          title: 'Link your wallet',
          description: 'Click the button to open a secure page and sign a message to link your wallet to this Discord account. Code expires in 10 minutes.',
          color: 0x5865f2,
          fields: [{ name: 'Your code', value: `||${code}||` }]
        };
        await message.author.send({ embeds: [embed], components: [{ type: 1, components: [{ type: 2, style: 5, label: 'Open Link Page', url }] }] });
        if (message.channel?.isTextBased()) await message.reply('I DM’d you a secure link to link your wallet.');
      } catch (e) {
        this.logger.error('wallet link command failed: ' + e.message);
        try {
          if (message.channel?.isTextBased()) {
            await message.reply('Sorry, I could not start the wallet link flow. Please try again in a minute.');
          }
        } catch {}
      }
    });

    // @mention handler - respond when bot is mentioned using the unified chat agent
    this.client.on('messageCreate', async (message) => {
      try {
        // Ignore bot messages to prevent loops
        if (message.author.bot) return;
        
        // Check if bot was mentioned
        const botMentioned = message.mentions.has(this.client.user);
        const isReplyToBot = message.reference?.messageId && 
          (await message.channel.messages.fetch(message.reference.messageId).catch(() => null))?.author?.id === this.client.user.id;
        
        if (!botMentioned && !isReplyToBot) return;
        
        // Check guild authorization
        if (message.guild) {
          const guildId = message.guild.id;
          const isAuthorized = await this.authorizationCache.check(guildId, async () => {
            const guildConfig = await this.configService.getGuildConfig(guildId);
            return guildConfig?.authorized === true || 
              (await this.configService.get("authorizedGuilds") || []).includes(guildId);
          });
          
          if (!isAuthorized) {
            this.logger.debug?.(`@mention in unauthorized guild: ${message.guild.name} (${guildId}) - ignoring`);
            return;
          }
        }
        
        // Get the unified chat agent
        const agent = this.getUnifiedChatAgent?.();
        if (!agent) {
          this.logger.debug?.('[DiscordService] Unified chat agent not available for @mention response');
          return;
        }
        
        // Create platform adapter for Discord
        const adapter = createDiscordAdapter({
          logger: this.logger,
          discordService: this,
          message,
        });
        
        // Build channel ID with discord prefix for uniqueness across platforms
        const channelId = `discord:${message.channel.id}`;
        
        // Clean up the message content (remove the @mention)
        const cleanContent = message.content
          .replace(new RegExp(`<@!?${this.client.user.id}>`, 'g'), '')
          .trim();
        
        // Add to conversation history
        await agent.addToHistory(channelId, {
          from: message.author.displayName || message.author.username,
          text: cleanContent || '[mentioned the bot]',
          date: Math.floor(message.createdTimestamp / 1000),
          isBot: false,
          userId: message.author.id,
          messageId: message.id,
        });
        
        this.logger.info?.(`[DiscordService] Bot @mentioned by ${message.author.username} in ${message.channel.name || 'DM'}`);
        
        // Check content filter
        const filterResult = await agent.checkContentFilter(cleanContent);
        if (filterResult.blocked) {
          this.logger.info?.(`[DiscordService] Blocked @mention (${filterResult.type}): ${filterResult.reason}`);
          return;
        }
        
        // Normalize message for the agent
        const normalizedMessage = {
          text: cleanContent,
          authorName: message.author.displayName || message.author.username,
          authorUsername: message.author.username,
          userId: message.author.id,
          messageId: message.id,
          replyTo: message.reference?.messageId ? {
            message_id: message.reference.messageId,
          } : null,
        };
        
        // Generate response using the unified agent
        await agent.generateResponse({
          channelId,
          message: normalizedMessage,
          adapter,
          isMention: botMentioned,
          triggerType: botMentioned ? 'mention' : 'reply',
          messageImage: null, // TODO: Extract images from Discord messages if attached
        });
        
      } catch (error) {
        this.logger.error?.('[DiscordService] @mention handler error:', error);
        try {
          await message.reply("I'm having a bit of trouble right now. 💭");
        } catch {}
      }
    });

    // When a thread is created from a message, move the speaking avatar into that thread
    this.client.on('threadCreate', async (thread) => {
      try {
        // Only act on newly created threads under text channels
        if (!thread || !thread.parentId || !thread.guild) return;
        
        // Check guild authorization before moving avatars (using authorization cache)
        const guildId = thread.guild.id;
        const isAuthorized = await this.authorizationCache.check(guildId, async () => {
          const guildConfig = await this.configService.getGuildConfig(guildId);
          return guildConfig?.authorized === true || 
            (await this.configService.get("authorizedGuilds") || []).includes(guildId);
        });
        
        if (!isAuthorized) {
          this.logger.warn(`Thread created in unauthorized guild: ${thread.guild.name} (${guildId}) - ignoring`);;
          return;
        }
        
        const parentId = thread.parentId;
        // Try to fetch the starter message; if not available, skip
        let starter = null;
        try { starter = await thread.fetchStarterMessage(); } catch {}
        if (!starter) return;

        // We only care about messages sent by our webhook (avatar speech). Webhook messages have webhookId set.
        if (!starter.webhookId) return;

        // Resolve avatar by the webhook display name within the parent channel
        const avatarName = starter.author?.username;
        if (!avatarName) return;

        const db = await this.databaseService.getDatabase();
        if (!db) return;

        // Find the avatar that last spoke with this name in the parent channel
        const avatar = await db.collection('avatars').findOne({ name: avatarName, channelId: parentId });
        if (!avatar) return;
        if (String(avatar.channelId) === String(thread.id)) return; // already there

        // Move via MapService if available, else update directly
        try {
          if (this.getMapService) {
            await this.getMapService().updateAvatarPosition(avatar, thread.id, avatar.channelId);
          } else {
            await db.collection('avatars').updateOne(
              { _id: avatar._id },
              { $set: { channelId: thread.id, updatedAt: new Date() } }
            );
          }
          this.logger?.info?.(`Moved avatar '${avatar.name}' to new thread ${thread.id} from message starter.`);
        } catch (err) {
          this.logger?.warn?.(`Failed to move avatar '${avatarName}' to thread ${thread.id}: ${err.message}`);
        }
      } catch (e) {
        this.logger?.warn?.(`threadCreate handler failed: ${e.message}`);
      }
    });
  }

  // Utility Methods (moved from module scope to class)

  async updateConnectedGuilds() {
    this.db = await this.databaseService.getDatabase();
    if (!this.db) {
      this.logger.error('Database not connected, cannot update guilds');
      return;
    }
    try {
      const connectedGuilds = this.client.guilds.cache.map(guild => ({
        id: guild.id,
        name: guild.name,
        memberCount: guild.memberCount,
        icon: guild.icon,
        updatedAt: new Date(),
      }));
      this.logger.info(`Updating ${connectedGuilds.length} connected guilds`);
      if (connectedGuilds.length > 0) {
        await this.guildConnectionRepository.upsertConnectedGuilds(connectedGuilds);
      }
    } catch (error) {
      this.logger.error('Error updating connected guilds: ' + error.message);
      throw error;
    }
  }

  async updateDetectedGuilds() {
    // This can be slow if there are many guilds, so it should be called via setImmediate()
    this.db = await this.databaseService.getDatabase();
    if (!this.db) {
      this.logger.error('Database not connected, cannot update detected guilds');
      return;
    }
    try {
      const allGuilds = this.client.guilds.cache.map(guild => ({
        id: guild.id,
        name: guild.name,
        memberCount: guild.memberCount,
        icon: guild.icon,
        detectedAt: new Date(),
        updatedAt: new Date(),
      }));
      this.logger.info(`[Background] Updating ${allGuilds.length} detected guilds from Discord client's cache`);
      if (allGuilds.length > 0) {
        await this.guildConnectionRepository.upsertDetectedGuilds(allGuilds);
        this.logger.info(`[Background] Completed updating ${allGuilds.length} detected guilds`);
      }
    } catch (error) {
      this.logger.error('Error updating detected guilds: ' + error.message);
    }
  }

  validateAvatar(avatar) {
    if (!avatar || typeof avatar !== 'object') throw new Error('Avatar must be a valid object');
    if (!avatar.name || typeof avatar.name !== 'string') {
      this.logger.error('Invalid avatar object:', { avatar, avatarType: typeof avatar, hasName: !!avatar?.name, nameType: typeof avatar?.name });
      throw new Error('Avatar name is required and must be a string');
    }
  }

  async getOrCreateWebhook(channel) {
    if (!channel || !channel.isTextBased()) {
      this.logger.error('Invalid or non-text-based channel provided for webhook');
      return null;
    }
    
    // Use the new WebhookManager with TTL-based caching and rate limit handling
    return this.webhookManager.getOrCreate(channel);
  }

  async sendAsWebhook(channelId, content, avatar, options = {}) {
    try {
      this.validateAvatar(avatar);
      if (!channelId || typeof channelId !== 'string') throw new Error('Invalid channel ID');
      if (!content || typeof content !== 'string') throw new Error('Content is required and must be a string');
      
      // Extract proxy metadata if this is a proxied human message
      const { proxyUserId, isProxied: _isProxied } = options;
      
      // Get content filter settings from global bot config
      const contentFilters = this.globalBotService?.bot?.globalBotConfig?.contentFilters || {};
      const filterEnabled = contentFilters.enabled !== false;
      
      // Filter content for AI-generated messages (strip URLs, check for blocked content)
      let filteredContent = content;
      if (filterEnabled) {
        // Strip URLs from AI-generated content if blockUrls is enabled
        if (contentFilters.blockUrls !== false) {
          // Build list of allowed URL domains (CDN, S3, etc.) to preserve image links
          const allowedDomains = [
            ...(contentFilters.allowedUrlDomains || []),
            'cloudfront.net',     // AWS CloudFront CDN
            'amazonaws.com',      // AWS S3
            'cdn.discordapp.com', // Discord CDN
            'media.discordapp.net' // Discord media
          ];
          filteredContent = stripUrls(filteredContent, { 
            allowedDomains,
            preserveMarkdownLinks: true  // Preserve markdown links to media files
          });
        }
        
        // Get dynamically allowed tokens from buybot tracked tokens
        let dynamicAllowlist = { addresses: [], symbols: [] };
          const buybotService = this.getBuybotService?.();
          if (buybotService?.getAllTrackedTokensForAllowlist) {
          try {
              dynamicAllowlist = await buybotService.getAllTrackedTokensForAllowlist();
          } catch (err) {
            this.logger?.debug?.('[DiscordService] Failed to get dynamic token allowlist:', err.message);
          }
        }
        
        // Merge static config with dynamic allowlists
        const allowedCashtags = [
          ...(contentFilters.allowedCashtags || []),
          ...dynamicAllowlist.symbols
              ];
        const allowedAddresses = [
          ...(contentFilters.allowedAddresses || []),
          ...dynamicAllowlist.addresses
        ];
        
        // Check for other blocked content (crypto addresses, cashtags)
        const contentFilter = filterContent(filteredContent, {
          logger: this.logger,
          blockCryptoAddresses: contentFilters.blockCryptoAddresses !== false,
          blockCashtags: contentFilters.blockCashtags !== false,
          blockUrls: false, // Already stripped URLs above
          allowedCashtags,
          allowedAddresses
        });
        
        if (contentFilter.blocked) {
          this.logger?.warn?.(`[DiscordService] Blocked AI message (${contentFilter.type}): ${contentFilter.reason}`);
          return null; // Don't send blocked messages
        }
      }
      
      const channel = await this.rateLimitHandler.execute(
        () => this.client.channels.fetch(channelId),
        `Fetch channel ${channelId}`
      );
      if (!channel || !channel.isTextBased()) throw new Error('Channel not accessible or not text-based');
      
      const webhook = await this.getOrCreateWebhook(channel);
      if (!webhook) throw new Error('Failed to obtain webhook');
      
      const username = `${avatar.name.slice(0, 78)}${avatar.emoji || ''}`.slice(0, 80);
      const prefix = `${username}: `;
      const trimmed = filteredContent.startsWith(prefix) ? filteredContent.slice(prefix.length) : filteredContent;
      const preparedContent = processMessageLinks(trimmed, this.client);
      const chunks = chunkMessage(preparedContent);

      let sentMessage = null;
      const targetChannelId = channel.isThread() ? channelId : undefined;

      for (const chunk of chunks) {
        try {
          sentMessage = await this.rateLimitHandler.execute(
            () => webhook.send({
              content: chunk,
              username: username.replace(/discord/ig, ''),
              avatarURL: avatar.imageUrl || this.client.user.displayAvatarURL(),
              threadId: targetChannelId,
            }),
            `Send webhook message to ${channelId}`
          );
        } catch (sendError) {
          // Check if webhook was deleted externally and invalidate cache
          const wasInvalidated = this.webhookManager.handleWebhookError(
            channel.isThread() ? channel.parentId : channelId, 
            sendError
          );
          
          if (wasInvalidated) {
            // Retry with fresh webhook
            this.logger.info?.(`[DiscordService] Retrying with fresh webhook for channel ${channelId}`);
            const freshWebhook = await this.getOrCreateWebhook(channel);
            if (freshWebhook) {
              sentMessage = await this.rateLimitHandler.execute(
                () => freshWebhook.send({
                  content: chunk,
                  username: username.replace(/discord/ig, ''),
                  avatarURL: avatar.imageUrl || this.client.user.displayAvatarURL(),
                  threadId: targetChannelId,
                }),
                `Retry send webhook message to ${channelId}`
              );
            } else {
              throw sendError;
            }
          } else {
            throw sendError;
          }
        }
      }
      
      this.logger.debug?.(`Sent message to channel ${channelId} as ${username}`);
      
      // Store avatar ID for reply tracking when available (older encounters may omit avatar ids)
      const rawAvatarId = avatar?._id ?? avatar?.id;
      if (rawAvatarId !== undefined && rawAvatarId !== null) {
        const avatarId = rawAvatarId.toString();
        sentMessage.rati = {
          avatarId,
        };
        this.logger.info?.(`[DiscordService] Set avatarId=${avatarId} on message ${sentMessage.id} for ${avatar.name}`);
      } else {
        this.logger.warn?.(`[DiscordService] Missing avatar id for ${avatar.name}; skipping avatarId attachment on message ${sentMessage.id}`);
      }
      
      // Store proxy metadata if this message was proxied from a human user
      // This is critical for other AI systems to recognize this as a human-initiated message
      if (proxyUserId) {
        sentMessage.rati = sentMessage.rati || {};
        sentMessage.rati.proxyUserId = proxyUserId;
        sentMessage.rati.isProxied = true;
        this.logger.info?.(`[DiscordService] Marked message ${sentMessage.id} as proxied from user ${proxyUserId}`);
      }
      
      sentMessage.guild = channel.guild;
      sentMessage.channel = channel;
      
      // Log message object details before saving
      this.logger.debug?.(`[DiscordService] Saving message: id=${sentMessage.id}, guild=${sentMessage.guild?.id}, channel=${sentMessage.channel?.id}, webhookId=${sentMessage.webhookId}`);
      
      try {
        await this.databaseService.saveMessage(sentMessage);
        this.logger.debug?.(`[DiscordService] Message ${sentMessage.id} saved successfully`);
      } catch (saveError) {
        this.logger.error(`[DiscordService] Failed to save message ${sentMessage.id}: ${saveError.message}`);
      }
      
      this.logger.debug?.(`Saved message to database with ID ${sentMessage.id}`);
      return sentMessage;
    } catch (error) {
      this.logger.error(`Failed to send webhook message to ${channelId}: ${error.message}`);
    }
  }

  /**
   * Start a typing indicator in a channel that auto-refreshes until stopped.
   * Discord typing indicators last ~10 seconds, so we refresh every 8 seconds.
   * @param {string} channelId - The channel ID to show typing in
   * @returns {Function} A stop function to call when done typing
   */
  async startTyping(channelId) {
    if (!channelId) return () => {};
    
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased?.()) return () => {};
      
      // Send initial typing indicator
      await channel.sendTyping().catch(() => {});
      
      // Set up interval to refresh typing every 8 seconds (Discord typing lasts ~10s)
      const intervalId = setInterval(() => {
        channel.sendTyping().catch(() => {});
      }, 8000);
      
      // Return stop function
      return () => {
        clearInterval(intervalId);
      };
    } catch (error) {
      this.logger?.debug?.(`[DiscordService] Failed to start typing in ${channelId}: ${error.message}`);
      return () => {};
    }
  }

  /**
   * Send a one-time typing indicator to a channel.
   * @param {string} channelId - The channel ID to show typing in
   */
  async sendTyping(channelId) {
    if (!channelId) return;
    
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel?.isTextBased?.()) {
        await channel.sendTyping();
      }
    } catch (error) {
      this.logger?.debug?.(`[DiscordService] Failed to send typing to ${channelId}: ${error.message}`);
    }
  }

  async sendAvatarEmbed(avatar, targetChannelId, aiService) {
    this.validateAvatar(avatar);
    const channelId = targetChannelId || avatar.channelId;
    if (!channelId || typeof channelId !== 'string') {
      throw new Error('Invalid channel ID in avatar object');
    }
    try {
      const channel = await this.client.channels.fetch(channelId);
      const guildId = channel.guild?.id;
      const { embed, components } = buildFullAvatarEmbed(avatar, { guildId, aiService });
      await this.sendEmbedAsWebhook(channelId, embed, avatar.name, avatar.imageUrl, components);
    } catch (error) {
      this.logger.error(`Failed to send avatar embed to ${channelId}: ${error.message}`);
    }
  }

  async sendMiniAvatarEmbed(avatar, channelId, message = '') {
    try {
      const { embed, components } = buildMiniAvatarEmbed(avatar, message);
      await this.sendEmbedAsWebhook(channelId, embed, avatar.name, avatar.imageUrl, components);
    } catch (error) {
      this.logger.error(`Failed to send mini avatar embed: ${error.message}`);
    }
  }

  async sendLocationEmbed(location, items, avatars, channelId) {
    if (!channelId || typeof channelId !== 'string') {
      throw new Error('Invalid channel ID');
    }
    try {
      const { embed, components } = buildMiniLocationEmbed(location, items, avatars);
      
      // Validate location data before sending
      if (!location || !location.name) {
        this.logger.warn('Location missing name, using fallback');
      }
      
      await this.sendEmbedAsWebhook(channelId, embed, 'Location Update', this.client.user.displayAvatarURL(), components);
    } catch (error) {
      this.logger.error(`Failed to send location embed to ${channelId}: ${error.message}`, {
        locationName: location?.name,
        errorStack: error.stack
      });
      throw error;
    }
  }

  async sendEmbedAsWebhook(channelId, embed, username, avatarURL, components = []) {
    try {
      if (!channelId || typeof channelId !== 'string') throw new Error('Invalid channel ID');
      if (!embed) throw new Error('Embed is required');

      const channel = await this.rateLimitHandler.execute(
        () => this.client.channels.fetch(channelId),
        `Fetch channel ${channelId} for embed`
      );
      if (!channel || !channel.isTextBased()) throw new Error('Channel not accessible or not text-based');

      const webhook = await this.getOrCreateWebhook(channel);
      if (!webhook) throw new Error('Failed to obtain webhook');

      await this.rateLimitHandler.execute(
        () => webhook.send({
          embeds: [embed],
          username: username ? username.slice(0, 80) : undefined,
          avatarURL,
          threadId: channel.isThread() ? channelId : undefined,
          components,
        }),
        `Send embed to channel ${channelId}`
      );

      this.logger.debug?.(`Sent embed to channel ${channelId} as ${username}`);
    } catch (error) {
      // Handle webhook errors and invalidate cache if needed
      this.webhookManager.handleWebhookError(channelId, error);
      this.logger.error(`Failed to send embed to ${channelId}: ${error.message}`);
      throw error;
    }
  }

  async getGuildByChannelId(channelId) {
    this.logger.debug?.(`Fetching guild for channel ID: ${channelId}`);
    try {
      const channel = await this.rateLimitHandler.execute(
        () => this.client.channels.fetch(channelId),
        `Fetch channel ${channelId} for guild lookup`
      );
      if (!channel || !channel.isTextBased()) throw new Error('Channel not accessible or not text-based');
      const guild = await this.rateLimitHandler.execute(
        () => this.client.guilds.fetch(channel.guild.id),
        `Fetch guild ${channel.guild.id}`
      );
      return guild;
    }
    catch (error) {
      this.logger.error(`Failed to fetch guild for channel ID ${channelId}: ${error.message}`);
      throw error;
    }
  }

  async buildAvatarComponents(avatar) {
    const components = [];
    try {
      this.db = await this.databaseService.getDatabase();
  await this.db.collection('crossmint_dev').findOne({ avatarId: avatar._id, chain: 'base' });
      // Add button logic if needed (commented out in original)
    } catch (error) {
      this.logger.error(`Failed to fetch crossmint data for avatar ${avatar._id}: ${error.message}`);
    }
    return components;
  }

  generateProgressBar(value, increment, emoji) {
    const count = Math.min(Math.floor(value / increment), 10);
    return emoji.repeat(count);
  }

  getModelRarity(modelName) {
    const model = this.aiService.getModel(modelName);
    return model ? model.rarity : 'undefined';
  }

  async reactToMessage(message, emoji) {
    try {        
      if (!message) throw new Error('Message not found');
      if (!message.react) {
        // Try to fetch the message if it's a partial
        message = this.client.channels.cache.get(message.channel.id).messages.cache.get(message.id);
      }
      if (!message || !emoji || typeof emoji !== 'string') {
        this.logger.error('Invalid message or emoji for reaction');
        return;
      }
      await message.react(emoji);
      this.logger.debug?.(`Reacted to message ${message.id} with ${emoji}`);
    } catch (error) {
      this.logger.error(`Failed to react to message ${message?.id}: ${error?.message}`);
    }
  }

  async replyToMessage(message, replyContent) {
    try {
      if (!message.reply) {
        // Try to fetch the message if it's a partial
        message = this.client.channels.cache.get(message.channel.id).messages.cache.get(message.id);
        if (!message) throw new Error('Message not found');
      }
      if (!message || !replyContent) {
        this.logger.error('Invalid message or reply content');
        return;
      }
      
      // Handle object replies (embeds, components, etc.)
      if (typeof replyContent === 'object') {
        await message.reply(replyContent);
      } else if (typeof replyContent === 'string') {
        await message.reply(replyContent);
      } else {
        this.logger.error('Invalid reply content type');
        return;
      }
      
      this.logger.info(`Replied to message ${message.id}`);
    } catch (error) {
      this.logger.error(`Failed to reply to message ${message?.id}: ${error.message}`);
    }
  }

  async getRecentMessages(channelId, limit = 10) {
    if (!channelId || typeof channelId !== 'string' || limit < 1 || limit > 100) {
      this.logger.error('Invalid channel ID or limit for fetching messages');
      return [];
    }
    try {
      const channel = await this.rateLimitHandler.execute(
        () => this.client.channels.fetch(channelId),
        `Fetch channel ${channelId} for recent messages`
      );
      if (!channel || !channel.isTextBased()) throw new Error('Channel not found or not text-based');
      const messages = await this.rateLimitHandler.execute(
        () => channel.messages.fetch({ limit }),
        `Fetch ${limit} messages from channel ${channelId}`
      );
      return Array.from(messages.values());
    } catch (error) {
      this.logger.error(`Failed to fetch messages from ${channelId}: ${error.message}`);
      return [];
    }
  }

  /**
   * Ensure a thread with the given name exists under the provided channel.
   * Returns the thread channel ID. If channelId already refers to a thread, the
   * thread's parent will be used for creation. Case-insensitive name match.
   */
  async getOrCreateThread(channelId, threadName) {
    try {
      if (!channelId || !threadName) throw new Error('channelId and threadName are required');
      const baseChannel = await this.client.channels.fetch(channelId);
      if (!baseChannel) throw new Error('Base channel not found');
      const channel = baseChannel.isThread() ? await baseChannel.parent.fetch() : baseChannel;
      if (!channel?.isTextBased?.() || !channel?.threads) return channelId; // fallback: cannot create, return original

      // Try to find an existing thread by name (case-insensitive) among active and archived
      const lower = threadName.toLowerCase();
      try {
        // Check active threads cache first
        const existingActive = channel.threads.cache?.find(t => t.name?.toLowerCase() === lower);
        if (existingActive) return existingActive.id;
      } catch {}
      try {
        // Fetch active threads
        const active = await channel.threads.fetchActive();
        const foundActive = active?.threads?.find(t => t.name?.toLowerCase() === lower);
        if (foundActive) return foundActive.id;
      } catch {}
      try {
        // Fetch archived threads (public)
        const archived = await channel.threads.fetchArchived({ type: 'public' });
        const foundArchived = archived?.threads?.find(t => t.name?.toLowerCase() === lower);
        if (foundArchived) return foundArchived.id;
      } catch {}

      // Create a new thread
      const created = await channel.threads.create({
        name: threadName,
        autoArchiveDuration: 10080, // 7 days
        reason: `Auto-created ${threadName} thread`,
      });
      return created?.id || channelId;
    } catch (e) {
      this.logger?.warn?.(`getOrCreateThread failed for ${channelId}/${threadName}: ${e.message}`);
      return channelId; // fallback to base
    }
  }

  /**
   * Create a new thread under a channel (no reuse).
   * Returns the thread channel ID, or the original channelId on failure.
   */
  async createThread(channelId, threadName, options = {}) {
    try {
      if (!channelId || !threadName) throw new Error('channelId and threadName are required');
      const baseChannel = await this.client.channels.fetch(channelId);
      if (!baseChannel) throw new Error('Base channel not found');
      const channel = baseChannel.isThread() ? await baseChannel.parent.fetch() : baseChannel;
      if (!channel?.isTextBased?.() || !channel?.threads) return channelId;

      const created = await channel.threads.create({
        name: threadName,
        autoArchiveDuration: options.autoArchiveDuration || 10080, // 7 days
        reason: options.reason || `Auto-created ${threadName} thread`
      });
      return created?.id || channelId;
    } catch (e) {
      this.logger?.warn?.(`createThread failed for ${channelId}/${threadName}: ${e.message}`);
      return channelId;
    }
  }

  /**
   * Get avatar for a button interaction user
   * @param {ButtonInteraction} interaction - Discord button interaction
   * @returns {Promise<Object|null>} Avatar object or null
   */
  async _getAvatarForInteraction(interaction) {
    try {
      // Use the injected avatar service if available
      const avatarService = this.avatarService;
      if (!avatarService) {
        this.logger?.warn?.('[DiscordService] Avatar service not available');
        return null;
      }
      
      const userId = interaction.user?.id;
      const guildId = interaction.guild?.id;
      if (!userId) {
        this.logger?.warn?.('[DiscordService] No user ID in interaction');
        return null;
      }
      
      const avatar = await avatarService.getAvatarByUserId(userId, guildId);
      if (!avatar) {
        this.logger?.debug?.(`[DiscordService] No avatar found for user ${userId} in guild ${guildId}`);
      }
      return avatar;
    } catch (e) {
      this.logger?.warn?.(`[DiscordService] Failed to get avatar for interaction: ${e.message}`);
      return null;
    }
  }

  /**
   * Handle D&D button interactions by directly invoking tools
   * This enables ephemeral responses and cleaner UX
   * @param {ButtonInteraction} interaction - Discord button interaction
   * @returns {Promise<void>}
   */
  async _showPuzzleAnswerModal(interaction) {
    const modal = new ModalBuilder()
      .setCustomId('puzzle_answer_modal')
      .setTitle('🧩 Answer the Riddle');

    const answerInput = new TextInputBuilder()
      .setCustomId('puzzle_answer_input')
      .setLabel('Your Answer')
      .setPlaceholder('Enter your answer here...')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(100);

    const actionRow = new ActionRowBuilder().addComponents(answerInput);
    modal.addComponents(actionRow);

    await interaction.showModal(modal);
  }

  /**
   * Handle modal submissions
   * @param {ModalSubmitInteraction} interaction - Discord modal submit interaction
   * @returns {Promise<void>}
   */
  async _handleModalSubmit(interaction) {
    const { customId } = interaction;

    if (customId === 'puzzle_answer_modal') {
      const answer = interaction.fields.getTextInputValue('puzzle_answer_input');
      
      // Defer reply as ephemeral while we process
      await interaction.deferReply({ flags: 64 });

      try {
        // Get user's avatar
        const db = await this.databaseService.getDatabase();
        const avatar = await db.collection('avatars').findOne({ 
          summoner: interaction.user.id,
          personality: { $exists: true }
        });

        if (!avatar) {
          await interaction.editReply({ content: '❌ You need an avatar to answer puzzles. Use the 🎭 button to create one!' });
          return;
        }

        // Get tool service
        const toolService = this.getToolService?.();
        if (!toolService) {
          await interaction.editReply({ content: '❌ Tool service unavailable.' });
          return;
        }
        
        // Get dungeon tool from the tools Map
        const dungeonTool = toolService.tools?.get('dungeon');
        if (!dungeonTool) {
          await interaction.editReply({ content: '❌ Dungeon tool not found.' });
          return;
        }

        // Get active dungeon
        const channelId = interaction.channel.id;
        const activeDungeon = await dungeonTool.dungeonService?.getActiveDungeonByChannel(channelId);

        if (!activeDungeon) {
          await interaction.editReply({ content: '❌ No active dungeon found in this channel.' });
          return;
        }

        // Solve the puzzle
        const result = await dungeonTool._solvePuzzle(avatar, [answer], activeDungeon);

        // Send the result
        await interaction.editReply(result);
      } catch (error) {
        this.logger?.error?.(`[DiscordService] Modal submit error: ${error.message}`);
        try {
          await interaction.editReply({ content: `❌ Error: ${error.message}` });
        } catch { /* ignore */ }
      }
      return;
    }
  }

  /**
   * Handle D&D button interactions with ephemeral responses
   * This enables ephemeral responses and cleaner UX
   * @param {ButtonInteraction} interaction - Discord button interaction
   * @returns {Promise<void>}
   */
  async _handleDndButtonInteraction(interaction) {
    const { customId } = interaction;
    const userId = interaction.user.id;
    
    try {
      // Handle summon help button (doesn't require avatar)
      if (customId === 'dnd_show_summon_help') {
        const helpEmbed = new EmbedBuilder()
          .setAuthor({ name: '🔮 How to Summon Your Avatar' })
          .setDescription('**Summoning is easy!** Just type the summon emoji followed by any concept.\n\n' +
            '**Examples:**\n' +
            '• `🔮 a fierce elven ranger`\n' +
            '• `🔮 ancient dwarf blacksmith`\n' +
            '• `🔮 mysterious tiefling warlock`\n\n' +
            'Your avatar will be created with unique stats, appearance, and personality based on your description!')
          .setColor(0x7C3AED)
          .setFooter({ text: 'Your avatar will be bound to you and can join D&D adventures!' });
        
        await interaction.reply({ 
          embeds: [helpEmbed],
          flags: 64 // ephemeral
        });
        return;
      }

      // Get user's avatar using the centralized lookup
      const avatar = await this._getAvatarForInteraction(interaction);
      
      if (!avatar) {
        // Show helpful embed with summon button instead of error
        const embed = new EmbedBuilder()
          .setAuthor({ name: '🎲 Adventure Awaits!' })
          .setDescription('*You need an avatar to embark on D&D adventures.*\n\nSummon your first avatar by typing a concept in the channel, or click below to get started!')
          .setColor(0x7C3AED) // DM purple
          .setFooter({ text: 'Use 🔮 <concept> to summon any character you imagine' });
        
        const actionRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('dnd_show_summon_help')
            .setLabel('How to Summon')
            .setEmoji('🔮')
            .setStyle(ButtonStyle.Primary)
        );
        
        await interaction.reply({ 
          embeds: [embed],
          components: [actionRow],
          flags: 64 // ephemeral
        });
        return;
      }

      // Get tool service
      const toolService = this.getToolService?.();
      if (!toolService) {
        throw new Error('Tool service not available');
      }

      // Parse button ID to determine tool and action
      // Handle "Take Your Turn" button - shows ephemeral combat options or "not your turn"
      if (customId === 'dnd_combat_take_turn') {
        const combatService = toolService.getCombatService?.() || this.getCombatService?.();
        if (!combatService) {
          await interaction.reply({ content: '⚠️ Combat service not available.', flags: 64 });
          return;
        }
        
        const result = await combatService.handleTakeTurnButton(interaction);
        
        if (result.error && result.content) {
          await interaction.reply({ content: result.content, flags: 64 });
        } else if (result.error && result.embed) {
          await interaction.reply({ embeds: [result.embed], flags: 64 });
        } else {
          await interaction.reply({ 
            embeds: [result.embed], 
            components: result.components || [],
            flags: 64 
          });
        }
        return;
      }
      
      if (customId === 'dnd_combat_cancel') {
        await interaction.reply({ content: '✅ Action cancelled.', flags: 64 });
        return;
      }

      // Handle combat action buttons - validate it's the user's turn first
      const combatActionButtons = ['dnd_combat_attack', 'dnd_combat_defend', 'dnd_combat_flee', 'dnd_combat_cast', 'dnd_item_use'];
      if (combatActionButtons.includes(customId) || customId.startsWith('dnd_target_')) {
        const combatService = toolService.getCombatService?.() || this.getCombatService?.();
        if (combatService) {
          const validation = combatService.validateUserCombatAction(interaction.channelId, userId);
          if (!validation.valid) {
            const notYourTurnEmbed = new EmbedBuilder()
              .setAuthor({ name: '🎲 The Dungeon Master' })
              .setDescription(`*"Hold, adventurer! It is not your turn to act."*\n\n**Current Turn:** ${validation.currentTurnName || 'Unknown'}\n\n*Wait for your moment in the initiative order.*`)
              .setColor(0x95A5A6) // Gray
              .setFooter({ text: 'Patience is a virtue in combat...' });
            await interaction.reply({ embeds: [notYourTurnEmbed], flags: 64 });
            return;
          }
        }
      }

      const { toolName, params } = this._parseDndButtonId(customId);
      
      if (!toolName) {
        this.logger?.warn?.(`[DiscordService] Unknown D&D button: ${customId}`);
        const unknownEmbed = new EmbedBuilder()
          .setAuthor({ name: '🎲 The Dungeon Master' })
          .setDescription('*The magical runes on this button have faded with time...*')
          .setColor(0x7C3AED)
          .setFooter({ text: 'Try using a command directly instead' });
        await interaction.reply({ embeds: [unknownEmbed], flags: 64 });
        return;
      }

      // Handle combat auto mode specially
      if (toolName === 'combat_auto') {
        const combatService = toolService.getCombatService?.() || this.getCombatService?.();
        if (!combatService) {
          await interaction.reply({ content: '⚠️ Combat service not available.', flags: 64 });
          return;
        }
        
        // Validate it's the user's turn for auto mode too
        const validation = combatService.validateUserCombatAction(interaction.channelId, userId);
        if (!validation.valid) {
          const notYourTurnEmbed = new EmbedBuilder()
            .setAuthor({ name: '🎲 The Dungeon Master' })
            .setDescription(`*"Hold, adventurer! It is not your turn to act."*\n\n**Current Turn:** ${validation.currentTurnName || 'Unknown'}\n\n*You can only enable auto-mode on your turn.*`)
            .setColor(0x95A5A6)
            .setFooter({ text: 'Wait for your turn to enable auto-pilot...' });
          await interaction.reply({ embeds: [notYourTurnEmbed], flags: 64 });
          return;
        }
        
        const encounter = combatService.getEncounterByChannelId(interaction.channelId);
        if (!encounter || encounter.state !== 'active') {
          await interaction.reply({ content: '⚠️ No active combat in this channel.', flags: 64 });
          return;
        }
        
        // Find the combatant for this player's avatar
        const combatant = encounter.combatants.find(c => 
          combatService._normalizeId(c.avatarId) === combatService._normalizeId(avatar._id?.toString?.() || avatar._id)
        );
        
        if (!combatant || !combatant.isPlayerControlled) {
          await interaction.reply({ content: '⚠️ You don\'t have a character in this combat.', flags: 64 });
          return;
        }
        
        // Enable auto mode and acknowledge
        combatant.autoMode = true;
        combatant.awaitingAction = false;
        
        await interaction.reply({ 
          content: `🤖 **${combatant.name}** is now on auto-pilot! The AI will control them for the rest of combat.`,
          flags: 64 
        });
        
        // If this combatant was awaiting their turn, execute it now
        const currentId = combatService.getCurrentTurnAvatarId(encounter);
        if (combatService._normalizeId(currentId) === combatService._normalizeId(combatant.avatarId)) {
          combatService._executeTurn(encounter, combatant).catch(e => {
            this.logger?.error?.(`[DiscordService] Auto turn execution failed: ${e.message}`);

          });
        }
        return;
      }

      // Defer reply for potentially slow operations
      await interaction.deferReply({ flags: 64 }); // ephemeral

      // Create a mock message object for tool execution
      const mockMessage = {
        channel: interaction.channel,
        guild: interaction.guild,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        author: interaction.user,
        member: interaction.member,
        content: `${toolName} ${params.join(' ')}`.trim(),
        id: interaction.id,
        createdTimestamp: Date.now()
      };

      // Execute the tool
      const result = await toolService.executeTool(toolName, mockMessage, params, avatar, {});

      // If tool handled the response itself (e.g., editing a loading message), skip replying
      if (result?._handled) {
        // Still need to acknowledge the interaction
        await interaction.editReply({ content: '✅' }).catch(() => {});
        return;
      }

      // If result is null/undefined, the tool posted directly to the channel (e.g., combat action)
      // Delete the ephemeral reply to avoid duplicates
      if (result === null || result === undefined) {
        await interaction.deleteReply().catch(() => {});
        return;
      }

      // Format and send the response
      if (result?.embeds) {
        await interaction.editReply({
          embeds: result.embeds,
          components: result.components || []
        });
      } else if (result?.message) {
        await interaction.editReply({ content: result.message });
      } else if (typeof result === 'string') {
        await interaction.editReply({ content: result });
      } else {
        await interaction.editReply({ content: '✅ Action completed!' });
      }
    } catch (error) {
      this.logger?.error?.(`[DiscordService] D&D button handler error: ${error.message}`, {
        customId,
        userId,
        channelId: interaction.channelId,
        stack: error.stack?.slice(0, 500)
      });
      
      try {
        // V3 FIX: Categorize error and provide specific recovery actions
        const errorInfo = this._categorizeButtonError(error);
        const errorEmbed = new EmbedBuilder()
          .setAuthor({ name: '🎲 The Dungeon Master' })
          .setTitle(errorInfo.title)
          .setDescription(errorInfo.description)
          .setColor(errorInfo.color)
          .setFooter({ text: errorInfo.footer });
        
        // Build recovery buttons based on error category
        const recoveryRow = new ActionRowBuilder();
        
        if (errorInfo.category === 'ENCOUNTER_ENDED') {
          recoveryRow.addComponents(
            new ButtonBuilder()
              .setCustomId('dnd_dungeon_status')
              .setLabel('Check Status')
              .setEmoji('📜')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId('dnd_dungeon_enter')
              .setLabel('New Dungeon')
              .setEmoji('🏰')
              .setStyle(ButtonStyle.Secondary)
          );
        } else if (errorInfo.category === 'TARGET_MISSING') {
          recoveryRow.addComponents(
            new ButtonBuilder()
              .setCustomId('dnd_combat_take_turn')
              .setLabel('View Targets')
              .setEmoji('🎯')
              .setStyle(ButtonStyle.Primary)
          );
        } else {
          recoveryRow.addComponents(
            new ButtonBuilder()
              .setCustomId('dnd_dungeon_map')
              .setLabel('View Map')
              .setEmoji('🗺️')
              .setStyle(ButtonStyle.Primary)
          );
        }
        
        if (interaction.deferred) {
          await interaction.editReply({ embeds: [errorEmbed], components: [recoveryRow] });
        } else if (!interaction.replied) {
          await interaction.reply({ embeds: [errorEmbed], components: [recoveryRow], flags: 64 });
        }
      } catch (replyError) {
        this.logger?.error?.(`[DiscordService] Failed to send error reply: ${replyError.message}`);
      }
    }
  }

  /**
   * Categorize button interaction error for better UX
   * @private
   */
  _categorizeButtonError(error) {
    const msg = String(error?.message || '').toLowerCase();
    
    if (msg.includes('no active encounter') || msg.includes('encounter not found') || msg.includes('combat has ended')) {
      return {
        category: 'ENCOUNTER_ENDED',
        title: '⚔️ Combat Has Ended',
        description: '*The dust settles... This battle is already over.*\n\nThe encounter you were in has concluded. Check the channel for results or start a new adventure.',
        color: 0x95A5A6,
        footer: 'Combat ends when all enemies are defeated or all players flee'
      };
    }
    
    if (msg.includes('not your turn') || msg.includes('out of turn')) {
      return {
        category: 'WRONG_TURN',
        title: '⏳ Not Your Turn',
        description: '*"Hold, adventurer! The initiative order must be respected."*\n\nWait for your turn in the combat sequence before acting.',
        color: 0xF39C12,
        footer: 'Watch the turn announcements to know when to act'
      };
    }
    
    if (msg.includes('target not found') || msg.includes('ghost') || msg.includes('not found here')) {
      return {
        category: 'TARGET_MISSING',
        title: '👻 Target Not Found',
        description: '*Your strike meets only empty air...*\n\nThe target you selected is no longer valid. They may have been defeated or fled from combat.',
        color: 0xE74C3C,
        footer: 'Click View Targets to see available enemies'
      };
    }
    
    if (msg.includes('knocked out') || msg.includes('dead') || msg.includes('incapacitated')) {
      return {
        category: 'COMBATANT_DOWN',
        title: '💀 Unable to Act',
        description: '*Your strength fails you...*\n\nYou are incapacitated and cannot take actions at this time. Rest or receive healing to recover.',
        color: 0x1A1A1A,
        footer: 'Seek a rest room or healing potion'
      };
    }
    
    if (msg.includes('timeout') || msg.includes('expired')) {
      return {
        category: 'TIMEOUT',
        title: '⌛ Session Expired',
        description: '*The moment has passed...*\n\nYour combat session may have expired. Try starting combat again with the Fight button.',
        color: 0x9B59B6,
        footer: 'Combat waits for you - no rush!'
      };
    }
    
    // Default unknown error
    return {
      category: 'UNKNOWN',
      title: '🌀 Something Went Wrong',
      description: '*The magical energies dissipate unexpectedly...*\n\nAn unexpected error occurred. Try refreshing your view or using a command directly.',
      color: 0x7C3AED,
      footer: 'If this persists, try /dungeon status'
    };
  }

  /**
   * Parse a D&D button customId to determine tool and params
   * @param {string} customId - Button custom ID
   * @returns {{ toolName: string|null, params: string[] }}
   */
  _parseDndButtonId(customId) {
    // Button ID mapping: customId -> { tool, params }
    const buttonMappings = {
      // Tutorial buttons
      'dnd_tutorial_start': { tool: 'tutorial', params: ['start'] },
      'dnd_tutorial_ready': { tool: 'tutorial', params: ['ready'] },
      'dnd_tutorial_skip': { tool: 'tutorial', params: ['skip'] },
      'dnd_tutorial_next': { tool: 'tutorial', params: ['next'] },
      'dnd_tutorial_complete_step': { tool: 'tutorial', params: ['complete'] },
      'dnd_tutorial_solo': { tool: 'tutorial', params: ['solo'] },
      'dnd_tutorial_status': { tool: 'tutorial', params: ['status'] },
      'dnd_tutorial_reset': { tool: 'tutorial', params: ['reset'] },
      
      // Character buttons
      'dnd_character_menu': { tool: 'character', params: ['create'] },
      'dnd_character_sheet': { tool: 'character', params: ['stats'] },
      'dnd_character_rest': { tool: 'character', params: ['rest'] },
      'dnd_character_short_rest': { tool: 'character', params: ['rest', 'short'] },
      'dnd_character_long_rest': { tool: 'character', params: ['rest', 'long'] },
      
      // Party buttons
      'dnd_party_menu': { tool: 'party', params: [] },
      'dnd_party_create': { tool: 'party', params: ['create'] },
      'dnd_party_invite': { tool: 'party', params: ['invite'] },
      'dnd_party_kick': { tool: 'party', params: ['kick'] },
      'dnd_party_rename': { tool: 'party', params: ['rename'] },
      'dnd_party_roles': { tool: 'party', params: ['role'] },
      'dnd_party_leave': { tool: 'party', params: ['leave'] },
      
      // Dungeon buttons
      'dnd_dungeon_menu': { tool: 'dungeon', params: [] },
      'dnd_dungeon_enter': { tool: 'dungeon', params: [] },
      'dnd_dungeon_start': { tool: 'dungeon', params: ['start'] },
      'dnd_dungeon_status': { tool: 'dungeon', params: ['status'] },
      'dnd_dungeon_map': { tool: 'dungeon', params: ['map'] },
      'dnd_dungeon_loot': { tool: 'dungeon', params: ['loot'] },
      'dnd_dungeon_abandon': { tool: 'dungeon', params: ['abandon'] },
      'dnd_dungeon_clear': { tool: 'dungeon', params: ['fight'] },
      'dnd_combat_start': { tool: 'dungeon', params: ['fight'] },
      'dnd_puzzle_hint': { tool: 'dungeon', params: ['puzzle', 'hint'] },
      
      // Combat buttons
      'dnd_combat_attack': { tool: 'attack', params: [] },
      'dnd_combat_defend': { tool: 'defend', params: [] },
      'dnd_combat_flee': { tool: 'dungeon', params: ['flee'] },
      'dnd_combat_cast': { tool: 'cast', params: [] },
      'dnd_combat_auto': { tool: 'combat_auto', params: [] },
      'dnd_item_use': { tool: 'item', params: ['use'] },
      
      // Cast/spell button
      'dnd_cast_list': { tool: 'cast', params: [] },
      
      // Quest buttons
      'dnd_quest_menu': { tool: 'quest', params: [] },
      'dnd_quest_accept': { tool: 'quest', params: ['accept'] },
      'dnd_quest_complete': { tool: 'quest', params: ['complete'] }
    };

    // Check static mappings first
    if (buttonMappings[customId]) {
      return { toolName: buttonMappings[customId].tool, params: buttonMappings[customId].params };
    }

    // Handle dynamic button IDs with prefixes
    if (customId.startsWith('dnd_race_')) {
      const race = customId.replace('dnd_race_', '');
      return { toolName: 'character', params: ['race', race] };
    }
    
    if (customId.startsWith('dnd_class_')) {
      const parts = customId.replace('dnd_class_', '').split('_');
      const race = parts[0];
      const className = parts[1];
      return { toolName: 'character', params: ['create', race, className] };
    }
    
    if (customId.startsWith('dnd_dungeon_move_')) {
      const roomId = customId.replace('dnd_dungeon_move_', '');
      return { toolName: 'dungeon', params: ['move', roomId] };
    }
    
    if (customId.startsWith('dnd_dungeon_enter_')) {
      const dungeonId = customId.replace('dnd_dungeon_enter_', '');
      return { toolName: 'dungeon', params: ['enter', dungeonId] };
    }
    
    if (customId.startsWith('dnd_cast_')) {
      const spellId = customId.replace('dnd_cast_', '');
      return { toolName: 'cast', params: [spellId] };
    }
    
    if (customId.startsWith('dnd_target_')) {
      const targetId = customId.replace('dnd_target_', '');
      // Decode URL-encoded target name (handles spaces and special chars)
      try {
        const decodedTarget = decodeURIComponent(targetId);
        return { toolName: 'attack', params: [decodedTarget] };
      } catch {
        // Fallback: replace underscores with spaces for legacy buttons
        return { toolName: 'attack', params: [targetId.replace(/_/g, ' ')] };
      }
    }
    
    // Party dynamic buttons
    if (customId.startsWith('dnd_party_add_')) {
      const avatarId = customId.replace('dnd_party_add_', '');
      return { toolName: 'party', params: ['add', avatarId] };
    }
    
    if (customId.startsWith('dnd_party_remove_')) {
      const avatarId = customId.replace('dnd_party_remove_', '');
      return { toolName: 'party', params: ['remove', avatarId] };
    }
    
    if (customId.startsWith('dnd_party_invite_')) {
      const avatarId = customId.replace('dnd_party_invite_', '');
      return { toolName: 'party', params: ['add', avatarId] };
    }
    
    if (customId.startsWith('dnd_party_role_')) {
      const role = customId.replace('dnd_party_role_', '');
      return { toolName: 'party', params: ['role', role] };
    }
    
    if (customId.startsWith('dnd_party_list_')) {
      return { toolName: 'party', params: ['list'] };
    }

    if (customId.startsWith('dnd_loot_need_')) {
      const rollId = customId.replace('dnd_loot_need_', '');
      return { toolName: 'dungeon', params: ['loot', 'need', rollId] };
    }

    if (customId.startsWith('dnd_loot_greed_')) {
      const rollId = customId.replace('dnd_loot_greed_', '');
      return { toolName: 'dungeon', params: ['loot', 'greed', rollId] };
    }

    if (customId.startsWith('dnd_loot_pass_')) {
      const rollId = customId.replace('dnd_loot_pass_', '');
      return { toolName: 'dungeon', params: ['loot', 'pass', rollId] };
    }

    return { toolName: null, params: [] };
  }
}
