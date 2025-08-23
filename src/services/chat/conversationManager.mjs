/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { handleCommands } from '../commands/commandHandler.mjs';

const GUILD_NAME = process.env.GUILD_NAME || 'The Guild';

export class ConversationManager  {
  constructor({
    logger,
    databaseService,
    aiService,
  unifiedAIService,
    discordService,
    avatarService,
    memoryService,
    promptService,
    configService,
    knowledgeService,
    mapService,
  toolService,
  presenceService
  }) {
    this.toolService = toolService;
    this.logger = logger || console;
    this.databaseService = databaseService;
    this.aiService = aiService;
  this.unifiedAIService = unifiedAIService; // optional adapter
    this.discordService = discordService;
    this.avatarService = avatarService;
    this.memoryService = memoryService;
    this.promptService = promptService;
    this.configService = configService;
    this.knowledgeService = knowledgeService;
    this.mapService = mapService;
  this.presenceService = presenceService; // optional; used for bot->bot mention cascades

    this.GLOBAL_NARRATIVE_COOLDOWN = 60 * 60 * 1000; // 1 hour
    this.lastGlobalNarrativeTime = 0;
    this.channelLastMessage = new Map();
    this.CHANNEL_COOLDOWN = 5 * 1000; // 5 seconds
    this.MAX_RESPONSES_PER_MESSAGE = 2;
    this.channelResponders = new Map();
    this.requiredPermissions = ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageWebhooks'];
  }

  /** Normalize arbitrary AI response into a safe string. Logs when response isn't a plain string. */
  _normalizeToText(response, context = 'response') {
    try {
      if (response == null) return '';
      if (typeof response === 'string') return response;
      if (typeof response === 'object') {
        if (typeof response.text === 'string') return response.text;
        // Common OpenAI-like shapes
        const maybe = response?.choices?.[0]?.message?.content
          || response?.message?.content
          || response?.content;
        if (typeof maybe === 'string') return maybe;
        // As a last resort, log and do not leak object dump to chat
        const keys = Object.keys(response);
        this.logger.warn?.(`[AI][normalize] Non-string ${context}; keys=${keys.join(',') || 'none'}`);
        return '';
      }
      // Numbers/booleans/etc: toString safely
      return String(response);
    } catch (e) {
      this.logger.warn?.(`[AI][normalize] Failed to normalize ${context}: ${e.message}`);
      return '';
    }
  }

  /** Ensure the avatar has a model assigned; persist if we pick one */
  async ensureAvatarModel(avatar) {
    try {
      if (!avatar?.model) {
        const picked = await this.aiService.selectRandomModel();
        if (picked) {
          avatar.model = picked;
          try { await this.avatarService.updateAvatar(avatar); } catch {}
          this.logger.info?.(`[AI] assigned model='${picked}' to avatar ${avatar?.name || avatar?._id}`);
        }
      }
    } catch (e) {
      this.logger.warn?.(`[AI] ensureAvatarModel failed: ${e.message}`);
    }
    return avatar?.model;
  }

  async checkChannelPermissions(channel) {
    try {
      if (!channel.guild) {
        this.logger.warn(`Channel ${channel.id} has no associated guild.`);
        return false;
      }
      const member = channel.guild.members.cache.get(this.discordService.client.user.id);
      if (!member) return false;
      const permissions = channel.permissionsFor(member);
      const missingPermissions = this.requiredPermissions.filter(perm => !permissions.has(perm));
      if (missingPermissions.length > 0) {
        this.logger.warn(`Missing permissions in channel ${channel.id}: ${missingPermissions.join(', ')}`);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.error(`Permission check error for channel ${channel.id}: ${error.message}`);
      return false;
    }
  }

  async generateNarrative(avatar) {
    try {
      this.db = await this.databaseService.getDatabase();
      if (!this.db) {
        this.logger.error('DB not initialized yet. Narrative generation aborted.');
        return null;
      }
      if (Date.now() - this.lastGlobalNarrativeTime < this.GLOBAL_NARRATIVE_COOLDOWN) {
        return null;
      }
      if (!avatar.model) {
        avatar.model = await this.aiService.selectRandomModel();
        await this.avatarService.updateAvatar(avatar);
      }

      const kgContext = await this.knowledgeService.queryKnowledgeGraph(avatar._id);
      const chatMessages = await this.promptService.getNarrativeChatMessages(avatar);

      // Inject KG context into user prompt
      if (chatMessages && chatMessages.length > 0) {
        const userMsg = chatMessages.find(m => m.role === 'user');
        if (userMsg) {
          userMsg.content = `Knowledge Graph:\n${kgContext}\n\n${userMsg.content}`;
        }
      }

  const ai = this.unifiedAIService || this.aiService;
  const corrId = `narrative:${avatar._id}:${Date.now()}`;
  this.logger.info?.(`[AI][generateNarrative] model=${avatar.model} provider=${this.unifiedAIService ? 'unified' : 'core'} corrId=${corrId}`);
  let narrative = await ai.chat(chatMessages, { model: avatar.model, max_tokens: 2048, corrId });
  if (narrative && typeof narrative === 'object' && narrative.text) narrative = narrative.text;
      if (!narrative) {
        this.logger.error(`No narrative generated for ${avatar.name}.`);
        return null;
      }

      await this.memoryService.storeNarrative(avatar._id, narrative);
      avatar = await this.memoryService.updateNarrativeHistory(avatar, narrative);
      avatar.prompt = await this.promptService.getFullSystemPrompt(avatar, this.db);
      avatar.dynamicPrompt = narrative;
      await this.avatarService.updateAvatar(avatar);
      this.lastGlobalNarrativeTime = Date.now();

      // Update KG with new narrative
      await this.knowledgeService.updateKnowledgeGraph(avatar._id, narrative);

      return narrative;
    } catch (error) {
      this.logger.error(`Error generating narrative for ${avatar.name}: ${error.message}`);
      throw error;
    }
  }

  async getLastNarrative(avatarId) {
    return this.memoryService.getLastNarrative(avatarId);
  }

  async storeNarrative(avatarId, content) {
    return this.memoryService.storeNarrative(avatarId, content);
  }

  async getChannelContext(channelId, limit = 50) {
    try {
      this.logger.info(`Fetching channel context for channel ${channelId}`);
      this.db = await this.databaseService.getDatabase();
      if (this.db) {
        try {
          const messagesCollection = this.db.collection('messages');
          const messages = await messagesCollection
            .find({ channelId })
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
          if (messages && messages.length > 0) {
            this.logger.debug(`Retrieved ${messages.length} messages from database for channel ${channelId}`);
            return messages.reverse();
          }
        } catch (dbError) {
          this.logger.error(`Database error fetching messages: ${dbError.message}`);
        }
      }
      const channel = await this.discordService.client.channels.fetch(channelId);
      if (!channel) {
        this.logger.warn(`Channel ${channelId} not found`);
        return [];
      }
      const discordMessages = await channel.messages.fetch({ limit });
      const formattedMessages = Array.from(discordMessages.values())
        .map(msg => ({
          messageId: msg.id,
          channelId: msg.channel.id,
          authorId: msg.author.id,
          authorUsername: msg.author.username,
          content: msg.content,
          hasImages: msg.attachments.some(a => a.contentType?.startsWith('image/')) || msg.embeds.some(e => e.image || e.thumbnail),
          imageDescription: null, // Rely on database for this
          timestamp: msg.createdTimestamp,
        }))
        .sort((a, b) => a.timestamp - b.timestamp);
      this.logger.debug(`Retrieved ${formattedMessages.length} messages from Discord API for channel ${channelId}`);
      if (this.db) {
        const messagesCollection = this.db.collection('messages');
        await Promise.all(formattedMessages.map(msg =>
          messagesCollection.updateOne(
            { messageId: msg.messageId },
            { $set: msg },
            { upsert: true }
          )
        ));
      }
      return formattedMessages;
    } catch (error) {
      this.logger.error(`Error fetching channel context for channel ${channelId}: ${error.message}`);
      return [];
    }
  }

  async getChannelSummary(avatarId, channelId) {
    this.db = await this.databaseService.getDatabase();
    if (!this.db) {
      this.logger.error('DB not initialized. Cannot fetch channel summary.');
      return '';
    }
    const summariesCollection = this.db.collection('channel_summaries');
    const messagesCollection = this.db.collection('messages');
    const summaryDoc = await summariesCollection.findOne({ avatarId, channelId });
    let messagesToSummarize = [];
    if (summaryDoc) {
      const lastUpdated = summaryDoc.lastUpdated;
      messagesToSummarize = await messagesCollection
        .find({ channelId, timestamp: { $gt: lastUpdated } })
        .sort({ timestamp: 1 })
        .toArray();
      if (messagesToSummarize.length < 50) return summaryDoc.summary;
    } else {
      messagesToSummarize = await messagesCollection
        .find({ channelId })
        .sort({ timestamp: -1 })
        .limit(50)
        .toArray();
      messagesToSummarize.reverse();
    }
    if (messagesToSummarize.length === 0) return summaryDoc ? summaryDoc.summary : '';
  const avatar = await this.avatarService.getAvatarById(avatarId);
    if (!avatar) {
      this.logger.error(`Avatar ${avatarId} not found for summarization.`);
      return summaryDoc ? summaryDoc.summary : '';
    }
  // Ensure avatar has a model before AI call
  await this.ensureAvatarModel(avatar);
    const messagesText = messagesToSummarize.map(msg =>
      `${msg.authorUsername || 'User'}: ${msg.content || '[No content]'}${msg.imageDescription ? ` [Image: ${msg.imageDescription}]` : ''}`
    ).join('\n');
    let prompt;
    if (summaryDoc) {
      prompt = `
  You are ${avatar.name}.
  Previous channel summary:
  ${summaryDoc.summary}
  New conversation:
  ${messagesText}
  Update the summary to incorporate the new conversation, focusing on key events, interactions, and how they relate to you.
      `.trim();
    } else {
      prompt = `
  You are ${avatar.name}.
  Summarize the following conversation from your perspective, focusing on key events, interactions, and how they relate to you.
  Conversation:
  ${messagesText}
      `.trim();
    }
  const ai = this.unifiedAIService || this.aiService;
  const corrId = `summary:${avatar._id}:${channelId}`;
  this.logger.info?.(`[AI][getChannelSummary] model=${avatar.model} provider=${this.unifiedAIService ? 'unified' : 'core'} corrId=${corrId}`);
  let summary = await ai.chat([
      { role: 'system', content: avatar.prompt || `You are ${avatar.name}. ${avatar.personality}` },
      { role: 'user', content: prompt }
  ], { model: avatar.model, max_tokens: 500, corrId });
  if (summary && typeof summary === 'object' && summary.text) summary = summary.text;
    if (!summary) {
      this.logger.error(`Failed to generate summary for avatar ${avatar.name} in channel ${channelId}`);
      return summaryDoc ? summaryDoc.summary : '';
    }
    const lastMessage = messagesToSummarize[messagesToSummarize.length - 1];
    const lastUpdated = lastMessage.timestamp;
    const lastMessageId = lastMessage.messageId;
    if (summaryDoc) {
      await summariesCollection.updateOne(
        { _id: summaryDoc._id },
        { $set: { summary, lastUpdated, lastMessageId } }
      );
    } else {
      await summariesCollection.insertOne({ avatarId, channelId, summary, lastUpdated, lastMessageId });
    }
    return summary;
  }

  async updateNarrativeHistory(avatar, content) {
    return this.memoryService.updateNarrativeHistory(avatar, content);
  }

  removeAvatarPrefix(response, avatar) {
    if (response == null) return '';
    const text = this._normalizeToText(response, 'prefix');
    const prefixes = [`${avatar.name} ${avatar.emoji}:`, `${avatar.emoji} ${avatar.name}:`, `${avatar.name}:`];
    for (const prefix of prefixes) {
      if (text.startsWith(prefix)) return text.slice(prefix.length).trim();
    }
    return text;
  }

  async sendResponse(channel, avatar, presetResponse = null, options = {}) {
  const { overrideCooldown = false, cascadeDepth = 0 } = options || {};
    // Gate speaking for KO/dead avatars
    try {
      const now = Date.now();
      if (avatar?.status === 'dead') return null;
      if (avatar?.status === 'knocked_out') return null;
      if (avatar?.knockedOutUntil && now < avatar.knockedOutUntil) return null;
    } catch {}
    this.db = await this.databaseService.getDatabase();
    if (!await this.checkChannelPermissions(channel)) {
      this.logger.error(`Cannot send response - missing permissions in channel ${channel.id}`);
      return null;
    }
    const lastMessageTime = this.channelLastMessage.get(channel.id) || 0;
  if (!overrideCooldown && Date.now() - lastMessageTime < this.CHANNEL_COOLDOWN) {
      this.logger.debug(`Channel ${channel.id} is on cooldown`);
      return null;
    }
    if (!this.channelResponders.has(channel.id)) this.channelResponders.set(channel.id, new Set());
    const responders = this.channelResponders.get(channel.id);
    if (responders.size >= this.MAX_RESPONSES_PER_MESSAGE) {
      this.logger.debug(`Channel ${channel.id} has reached maximum responses`);
      return null;
    }
    if (responders.has(avatar._id)) {
      this.logger.debug(`Avatar ${avatar.name} has already responded in channel ${channel.id}`);
      return null;
    }
    try {
      let response = presetResponse;
      if (!response) {
  // Ensure avatar has a model before AI call
  await this.ensureAvatarModel(avatar);
      const messages = await channel.messages.fetch({ limit: 50 });
      const imagePromptParts = [];
      let recentImageMessage = null;
      for (const msg of Array.from(messages.values()).reverse()) {
        if (msg.author.id === avatar._id) continue;
        const hasImages = msg.attachments.some(a => a.contentType?.startsWith('image/')) || msg.embeds.some(e => e.image || e.thumbnail);
        if (hasImages) {
          recentImageMessage = msg;
          break;
        }
      }
      if (recentImageMessage && this.aiService.supportsMultimodal) {
        const attachment = recentImageMessage.attachments.find(a => a.contentType?.startsWith('image/'));
        if (attachment) {
          imagePromptParts.push({ type: 'image_url', image_url: { url: attachment.url } });
          this.logger.info(`Using image URL ${attachment.url} for multimodal input`);
        }
      }
      const channelHistory = await this.getChannelContext(channel.id, 50);
      const channelSummary = await this.getChannelSummary(avatar._id, channel.id);
      let chatMessages;
      const useV2 = this.promptService?.promptAssembler && String(process.env.MEMORY_RECALL_ENABLED || 'true') === 'true';
      if (useV2 && typeof this.promptService.getResponseChatMessagesV2 === 'function') {
        chatMessages = await this.promptService.getResponseChatMessagesV2(avatar, channel, channelHistory, channelSummary, this.db);
      } else {
        chatMessages = await this.promptService.getResponseChatMessages(avatar, channel, channelHistory, channelSummary, this.db);
      }
      let userContent = chatMessages.find(msg => msg.role === 'user').content;
      if (this.aiService.supportsMultimodal && imagePromptParts.length > 0) {
        userContent = [...imagePromptParts, { type: 'text', text: userContent }];
        chatMessages = chatMessages.map(msg => msg.role === 'user' ? { role: 'user', content: userContent } : msg);
      }
  const ai = this.unifiedAIService || this.aiService;
  const corrId = `reply:${avatar._id}:${channel.id}:${Date.now()}`;
  this.logger.info?.(`[AI][sendResponse] model=${avatar.model} provider=${this.unifiedAIService ? 'unified' : 'core'} corrId=${corrId} messages=${chatMessages?.length || 0} override=${overrideCooldown}`);
  let result = await ai.chat(chatMessages, { model: avatar.model, max_tokens: 256, corrId });
      // Log non-string/atypical shapes for diagnostics
      try {
        if (result && typeof result !== 'string') {
          const keys = Object.keys(result || {});
          const preview = (() => { try { return JSON.stringify(result).slice(0, 500); } catch { return '[unstringifiable]'; } })();
          this.logger.debug?.(`[AI][sendResponse][${corrId}] non-string result; keys=${keys.join(',')}; preview=${preview}`);
        }
      } catch {}
      if (result && typeof result === 'object' && result.text) {
        response = result.text;
      } else {
        response = result;
      }
      if (!response) {
        this.logger.error(`Empty response generated for ${avatar.name}`);
        try {
          const preview = (() => { try { return JSON.stringify(result).slice(0, 500); } catch { return String(result); } })();
          this.logger.error(`[AI][sendResponse][${corrId}] empty response; rawPreview=${preview}`);
        } catch {}
        return null;
      }
      // Normalize and strip any avatar prefix before processing think tags
      response = this.removeAvatarPrefix(this._normalizeToText(response, 'send.raw'), avatar);
    }

    const finalText = this._normalizeToText(response, 'send.final');
      if (!finalText || finalText === '[object Object]') {
        try {
          const preview = (() => { try { return JSON.stringify(response).slice(0, 300); } catch { return String(response); } })();
      this.logger.warn?.(`[AI][sendResponse] Suppressing non-text output for ${avatar.name}; preview=${preview}`);
        } catch {}
        return null;
      }
      if (finalText && finalText.trim()) {
        const thinkRegex = /<think>(.*?)<\/think>/gs;
        const thoughts = [];
        const cleanedText = finalText.replace(thinkRegex, (match, thought) => {
          thoughts.push(thought.trim());
          return '';
        }).trim();
        
        if (thoughts.length > 0) {
          // Initialize thoughts array if it doesn't exist
          avatar.thoughts = avatar.thoughts || [];
          const guildName = GUILD_NAME;
          
          // Add new thoughts to the thoughts array
          thoughts.forEach(thought => {
            if (thought) {
              const thoughtData = { 
                content: thought, 
                timestamp: Date.now(), 
                guildName 
              };
              avatar.thoughts.unshift(thoughtData);
            }
          });
          
          // Keep only the most recent 20 thoughts
          avatar.thoughts = avatar.thoughts.slice(0, 20);
          
          // Also maintain backward compatibility by adding to narrativeHistory
          avatar.narrativeHistory = avatar.narrativeHistory || [];
          thoughts.forEach(thought => {
            if (thought) {
              const narrativeData = { timestamp: Date.now(), content: thought, guildName };
              avatar.narrativeHistory.unshift(narrativeData);
            }
          });
          avatar.narrativeHistory = avatar.narrativeHistory.slice(0, 5);
          avatar.narrativesSummary = avatar.narrativeHistory
            .map(r => `[${new Date(r.timestamp).toLocaleDateString()}] ${r.guildName}: ${r.content}`)
            .join('\n\n');
            
          await this.avatarService.updateAvatar(avatar);
        }
        
        // Send the cleaned text (without think tags) if there's any content left
        if (cleanedText) {
          let sentMessage = await this.discordService.sendAsWebhook(channel.id, cleanedText, avatar);
          if (!sentMessage) {
            this.logger.error(`Failed to send message in channel ${channel.id}`);
            return null;
          }
          
          // React with brain emoji if thoughts were detected
          if (thoughts.length > 0) {
            try {
              await this.discordService.reactToMessage(sentMessage, '🧠');
            } catch (error) {
              this.logger.error(`Failed to add brain reaction: ${error.message}`);
            }
          }
          
          let guild = await this.discordService.getGuildByChannelId(channel.id);
          if (!guild) {
            this.logger.error(`Guild not found for channel ${avatar.channelId}`);
            return null;
          }
          sentMessage.guildId = guild.id;
          sentMessage.channel = channel;

          handleCommands(sentMessage, {
            logger: this.logger,
            mapService: this.mapService,
            toolService: this.toolService,
            avatarService: this.avatarService,
            discordService: this.discordService,
            configService: this.configService
          }, avatar, this.getChannelContext(channel.id, 50));

          // After successfully sending a visible message, process bot->bot mentions (limited cascade)
          try {
            if (cleanedText && this.presenceService) {
              await this.handleAvatarMentions(channel, avatar, cleanedText, { cascadeDepth });
            }
          } catch (e) {
            this.logger.warn(`bot mention cascade failed: ${e.message}`);
          }
        }
        // If there was only think tags and no other content, still process thoughts but don't send a message
        else if (thoughts.length > 0) {
          // Just log that we processed thoughts without sending a message
          this.logger.debug(`Processed ${thoughts.length} thought(s) for ${avatar.name} without sending a message (think-only).`);
        }
      }
      this.channelLastMessage.set(channel.id, Date.now());
      this.channelResponders.get(channel.id).add(avatar._id);
      setTimeout(() => this.channelResponders.set(channel.id, new Set()), this.CHANNEL_COOLDOWN);
      return response;
    } catch (error) {
      this.logger.error(`CONVERSATION: Error sending response for ${avatar.name}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Detects when an avatar mentions other avatars and triggers limited immediate replies.
   * Rules:
   * - Only triggers once per originating send (cascadeDepth 0)
   * - Respects MAX_RESPONSES_PER_MESSAGE budget
   * - Uses simple word-boundary / emoji substring matching
   * - Grants a light mention boost (recordMention + optionally grant newSummon turn)
   */
  async handleAvatarMentions(channel, speakingAvatar, text, { cascadeDepth = 0 } = {}) {
    if (cascadeDepth > 0) return; // prevent deep recursion chains
    if (!channel || !speakingAvatar || !text) return;
    const guildId = channel.guild?.id;
    let others = [];
    try {
      others = await this.avatarService.getAvatarsInChannel(channel.id, guildId);
    } catch (e) { this.logger.warn(`mention cascade: failed to load avatars: ${e.message}`); return; }
    if (!Array.isArray(others) || !others.length) return;

    const lower = text.toLowerCase();
    const responders = this.channelResponders.get(channel.id) || new Set();
    const maxPerMessage = this.MAX_RESPONSES_PER_MESSAGE;
    if (responders.size >= maxPerMessage) return;

    const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mentioned = [];
    for (const av of others) {
      if (!av || av._id === speakingAvatar._id) continue;
      const name = String(av.name || '').trim();
      if (!name) continue;
      const nameLower = name.toLowerCase();
      // Use word boundary regex to reduce incidental substring hits (fallback to includes for CJK / emoji)
      let matched = false;
      if (/^[\p{L}\p{N}_'-]+$/u.test(name)) {
        const re = new RegExp(`(?:^|[^\p{L}\p{N}])${escapeRegExp(nameLower)}(?:$|[^\p{L}\p{N}])`, 'u');
        matched = re.test(lower);
      } else {
        matched = lower.includes(nameLower);
      }
      if (!matched && av.emoji) {
        const emo = String(av.emoji).trim();
        if (emo && lower.includes(emo.toLowerCase())) matched = true;
      }
      if (matched) mentioned.push(av);
    }
    if (!mentioned.length) return;

    // Limit cascade replies; env override BOT_MENTION_CASCADE_LIMIT else default 1
    const limit = Number(process.env.BOT_MENTION_CASCADE_LIMIT || 1);
    const slice = mentioned.slice(0, Math.max(0, limit));
    for (const target of slice) {
      if (responders.size >= maxPerMessage) break;
      try {
        // Presence updates & lightweight boost
        await this.presenceService.ensurePresence(channel.id, `${target._id}`);
        await this.presenceService.recordMention(channel.id, `${target._id}`);
        // Only grant a turn if they don't already have pending summon turns
        try {
          const presCol = await this.presenceService.col();
            const doc = await presCol.findOne({ channelId: channel.id, avatarId: `${target._id}` }, { projection: { newSummonTurnsRemaining: 1 } });
          if (!doc?.newSummonTurnsRemaining) {
            await this.presenceService.grantNewSummonTurns(channel.id, `${target._id}`, 1);
          }
        } catch {}
        // Attempt immediate reply (overrideCooldown to keep flow natural)
        await this.sendResponse(channel, target, null, { overrideCooldown: true, cascadeDepth: cascadeDepth + 1 });
      } catch (e) {
        this.logger.debug?.(`mention cascade send failed for ${target.name}: ${e.message}`);
      }
    }
  }
}