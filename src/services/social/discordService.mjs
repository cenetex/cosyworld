/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

// discordService.mjs
import {
  Client,
  GatewayIntentBits,
  Partials,
  WebhookClient,
} from 'discord.js';
import { ObjectId } from 'mongodb';
import { chunkMessage } from '../../utils/messageChunker.mjs';
import { processMessageLinks } from '../../utils/linkProcessor.mjs';
import { buildMiniAvatarEmbed, buildFullAvatarEmbed, buildMiniLocationEmbed, buildFullItemEmbed, buildFullLocationEmbed } from './discordEmbedLibrary.mjs';
import GuildConnectionRepository from '../../dal/GuildConnectionRepository.mjs';

export class DiscordService {
  constructor(services) {
    this.logger = services.logger;
    this.configService = services.configService;
    this.databaseService = services.databaseService;
  // Optional cross-service hooks
  this.getMapService = services.getMapService || null;
  this.avatarService = services.avatarService || null;
    // Repositories
    this.guildConnectionRepository = services.guildConnectionRepository || new GuildConnectionRepository({ databaseService: this.databaseService, logger: this.logger });
    
    this.webhookCache = new Map();
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
      ],
      partials: [Partials.Message, Partials.Channel, Partials.Reaction],
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
    if (this.client) {
      await this.client.destroy();
      this.logger.info('Disconnected from Discord.');
    }
  }

  setupEventListeners() {
    this.client.once('ready', async () => {
      this.logger.info(`Bot is ready as ${this.client.user.tag}`);
      await this.updateConnectedGuilds();
      await this.updateDetectedGuilds();
      this.client.guildWhitelist = new Map(); // Initialize guild whitelist cache
    });

    this.client.on('guildCreate', async guild => {
      this.logger.info(`Joined guild: ${guild.name} (${guild.id})`);
      await this.updateConnectedGuilds();
      await this.updateDetectedGuilds();
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
        if (!interaction.isButton()) return;
        
        // Check guild authorization for interactions
        if (interaction.guild) {
          const guildConfig = await this.configService.getGuildConfig(interaction.guild.id);
          const isAuthorized = guildConfig?.authorized === true || 
            (await this.configService.get("authorizedGuilds") || []).includes(interaction.guild.id);
          if (!isAuthorized) {
            this.logger.warn(`Interaction in unauthorized guild: ${interaction.guild.name} (${interaction.guild.id})`);
            return;
          }
        }
        
        const { customId } = interaction;
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

    // When a thread is created from a message, move the speaking avatar into that thread
    this.client.on('threadCreate', async (thread) => {
      try {
        // Only act on newly created threads under text channels
        if (!thread || !thread.parentId || !thread.guild) return;
        
        // Check guild authorization before moving avatars
        const guildConfig = await this.configService.getGuildConfig(thread.guild.id);
        const isAuthorized = guildConfig?.authorized === true || 
          (await this.configService.get("authorizedGuilds") || []).includes(thread.guild.id);
        if (!isAuthorized) {
          this.logger.warn(`Thread created in unauthorized guild: ${thread.guild.name} (${thread.guild.id}) - ignoring`);
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
      this.logger.info(`Updating ${allGuilds.length} detected guilds from Discord client's cache`);
      if (allGuilds.length > 0) {
        await this.guildConnectionRepository.upsertDetectedGuilds(allGuilds);
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
    try {
      const targetChannel = channel.isThread() ? await channel.parent.fetch() : channel;
      if (!targetChannel) throw new Error('Unable to fetch target channel');
      if (this.webhookCache.has(targetChannel.id)) return this.webhookCache.get(targetChannel.id);
      const webhooks = await targetChannel.fetchWebhooks();
      let webhook = webhooks.find(wh => wh.owner.id === this.client.user.id);
      if (!webhook) {
        webhook = await targetChannel.createWebhook({
          name: 'Multi-Avatar Bot Webhook',
          avatar: this.client.user.displayAvatarURL(),
        });
        this.logger.info(`Created webhook for channel ${targetChannel.id}`);
      }
      const webhookClient = new WebhookClient({ id: webhook.id, token: webhook.token });
      this.webhookCache.set(targetChannel.id, webhookClient);
      return webhookClient;
    } catch (error) {
      this.logger.error(`Failed to get/create webhook for channel ${channel.id}: ${error.message}`);
      return null;
    }
  }

  async sendAsWebhook(channelId, content, avatar) {
    try {
      this.validateAvatar(avatar);
      if (!channelId || typeof channelId !== 'string') throw new Error('Invalid channel ID');
      if (!content || typeof content !== 'string') throw new Error('Content is required and must be a string');
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) throw new Error('Channel not accessible or not text-based');
      const webhook = await this.getOrCreateWebhook(channel);
      if (!webhook) throw new Error('Failed to obtain webhook');
      const username = `${avatar.name.slice(0, 78)}${avatar.emoji || ''}`.slice(0, 80);
      const prefix = `${username}: `;
      const trimmed = content.startsWith(prefix) ? content.slice(prefix.length) : content;
      const preparedContent = processMessageLinks(trimmed, this.client);
      const chunks = chunkMessage(preparedContent);

      let sentMessage = null;

      for (const chunk of chunks) {
        sentMessage = await webhook.send({
          content: chunk,
          username: username.replace(/discord/ig, ''),
          avatarURL: avatar.imageUrl || this.client.user.displayAvatarURL(),
          threadId: channel.isThread() ? channelId : undefined,
        });
      }
      this.logger.info(`Sent message to channel ${channelId} as ${username}`);
      sentMessage.rati = {
        avatarId: avatar.id,
      };
      sentMessage.guild = channel.guild;
      sentMessage.channel = channel;
      this.databaseService.saveMessage(sentMessage);
      this.logger.info(`Saved message to database with ID ${sentMessage.id}`);
      return sentMessage;
    } catch (error) {
      this.logger.error(`Failed to send webhook message to ${channelId}: ${error.message}`);
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

      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) throw new Error('Channel not accessible or not text-based');

      const webhook = await this.getOrCreateWebhook(channel);
      if (!webhook) throw new Error('Failed to obtain webhook');

      await webhook.send({
        embeds: [embed],
        username: username ? username.slice(0, 80) : undefined,
        avatarURL,
        threadId: channel.isThread() ? channelId : undefined,
        components,
      });

      this.logger.info(`Sent embed to channel ${channelId} as ${username}`);
    } catch (error) {
      this.logger.error(`Failed to send embed to ${channelId}: ${error.message}`);
      throw error;
    }
  }

  async getGuildByChannelId(channelId) {
    this.logger.info(`Fetching guild for channel ID: ${channelId}`);
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) throw new Error('Channel not accessible or not text-based');
      const guild = await this.client.guilds.fetch(channel.guild.id);
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
      this.logger.info(`Reacted to message ${message.id} with ${emoji}`);
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
      if (!message || !replyContent || typeof replyContent !== 'string') {
        this.logger.error('Invalid message or reply content');
        return;
      }
      await message.reply(replyContent);
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
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) throw new Error('Channel not found or not text-based');
      const messages = await channel.messages.fetch({ limit });
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
}