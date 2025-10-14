/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * ResponseCoordinator - Single entry point for all avatar response decisions
 * 
 * Replaces the parallel response paths in TurnScheduler and MessageHandler
 * with a unified, coordinated system that ensures:
 * - Only one avatar responds per message (configurable)
 * - Clear turn-taking protocol
 * - No duplicate responses via locking
 * - Coherent conversation flow
 */
export class ResponseCoordinator {
  constructor({
    logger,
    databaseService,
    presenceService,
    conversationManager,
    avatarService,
    decisionMaker,
    discordService,
  }) {
    this.logger = logger || console;
    this.databaseService = databaseService;
    this.presenceService = presenceService;
    this.conversationManager = conversationManager;
    this.avatarService = avatarService;
    this.decisionMaker = decisionMaker;
    this.discordService = discordService;

    // Configuration
    this.MAX_RESPONSES_PER_MESSAGE = Number(process.env.MAX_RESPONSES_PER_MESSAGE || 1);
    this.RESPONSE_LOCK_TTL_MS = 5000; // 5 seconds
    this.STICKY_AFFINITY_EXCLUSIVE = String(process.env.STICKY_AFFINITY_EXCLUSIVE || 'true').toLowerCase() === 'true';
    this.TURN_BASED_MODE = String(process.env.TURN_BASED_MODE || 'true').toLowerCase() === 'true';
  }

  async col(name) {
    return (await this.databaseService.getDatabase()).collection(name);
  }

  /**
   * Main coordination entry point
   * @param {Object} channel - Discord channel object
   * @param {Object} message - Discord message object (may be null for ambient)
   * @param {Object} context - Additional context (guildId, avatars, etc.)
   * @returns {Promise<Array>} Array of sent messages
   */
  async coordinateResponse(channel, message, context = {}) {
    try {
      const channelId = channel.id;
      
      // 1. Classify the trigger type
      const trigger = this.classifyTrigger(message, context);
      this.logger.debug?.(`[ResponseCoordinator] Trigger: ${trigger.type} in ${channelId}`);

      // 2. Get eligible avatars for this channel
      const guildId = context.guildId || message?.guild?.id;
      let eligibleAvatars = context.avatars || await this.avatarService.getAvatarsInChannel(channelId, guildId);
      
      if (!eligibleAvatars || eligibleAvatars.length === 0) {
        this.logger.debug?.(`[ResponseCoordinator] No avatars in channel ${channelId}`);
        return [];
      }

      // 3. Prioritize avatars if we have a message
      if (message) {
        try {
          eligibleAvatars = await this.avatarService.prioritizeAvatarsForMessage(eligibleAvatars, message);
        } catch (e) {
          this.logger.warn?.(`[ResponseCoordinator] Avatar prioritization failed: ${e.message}`);
        }
      }

      // 4. Select THE avatar(s) that should respond
      const selectedAvatars = await this.selectResponders(
        channel,
        message,
        eligibleAvatars,
        trigger,
        context
      );

      if (!selectedAvatars || selectedAvatars.length === 0) {
        this.logger.debug?.(`[ResponseCoordinator] No avatars selected for ${channelId}`);
        return [];
      }

      // 5. Generate responses with locking
      const responses = [];
      for (const avatar of selectedAvatars) {
        // Acquire lock to prevent duplicates
        const lockAcquired = await this.acquireResponseLock(channelId, avatar._id || avatar.id);
        if (!lockAcquired) {
          this.logger.debug?.(`[ResponseCoordinator] Lock not acquired for ${avatar.name} in ${channelId}`);
          continue;
        }

        try {
          // Generate and send the response
          const response = await this.generateResponse(avatar, channel, message, context);
          if (response) {
            responses.push(response);
            
            // Update presence state
            await this.presenceService.recordTurn(channelId, `${avatar._id || avatar.id}`);
            
            // Record conversation session
            if (message && !message.author.bot) {
              await this.updateConversationSession(channelId, message.author.id, avatar._id || avatar.id);
            }
          }
        } catch (e) {
          this.logger.error(`[ResponseCoordinator] Response generation failed for ${avatar.name}: ${e.message}`);
        } finally {
          // Always release lock
          await this.releaseResponseLock(channelId, avatar._id || avatar.id);
        }

        // Respect max responses limit
        if (responses.length >= this.MAX_RESPONSES_PER_MESSAGE) {
          break;
        }
      }

      return responses;
    } catch (error) {
      this.logger.error(`[ResponseCoordinator] Coordination error: ${error.message}`);
      return [];
    }
  }

  /**
   * Classify the type of trigger that initiated this response
   * @param {Object} message - Discord message or null
   * @param {Object} context - Additional context
   * @returns {Object} Trigger classification
   */
  classifyTrigger(message, context = {}) {
    // Explicit context override
    if (context.triggerType) {
      return { type: context.triggerType, source: 'context' };
    }

    // No message = ambient/scheduled
    if (!message) {
      return { type: 'ambient', source: 'scheduler' };
    }

    // Human message
    if (!message.author.bot) {
      // Direct @mention
      if (message.mentions?.users?.size > 0) {
        return { type: 'mention', source: 'direct', priority: 'high' };
      }

      // Name/emoji mention
      // (Will be refined in selectResponders)
      return { type: 'human_message', source: 'user', priority: 'medium' };
    }

    // Bot message
    return { type: 'bot_message', source: 'bot', priority: 'low' };
  }

  /**
   * Select the avatar(s) that should respond
   * This is the core logic that replaces multiple parallel selection mechanisms
   * @param {Object} channel - Discord channel
   * @param {Object} message - Discord message or null
   * @param {Array} eligibleAvatars - All avatars in channel
   * @param {Object} trigger - Trigger classification
   * @param {Object} _context - Additional context (reserved for future use)
   * @returns {Promise<Array>} Selected avatars (usually 1, max configured limit)
   */
  async selectResponders(channel, message, eligibleAvatars, trigger, _context = {}) {
    const channelId = channel.id;

    // PRIORITY 1: Explicit summon with guaranteed turns
    if (trigger.type === 'mention' || trigger.type === 'human_message') {
      try {
        const c = await this.presenceService.col();
        const priorityDoc = await c.find({ 
          channelId, 
          newSummonTurnsRemaining: { $gt: 0 } 
        })
        .sort({ lastSummonedAt: -1 })
        .limit(1)
        .next();
        
        if (priorityDoc) {
          const avatar = await this.avatarService.getAvatarById(priorityDoc.avatarId);
          if (avatar) {
            this.logger.info?.(`[ResponseCoordinator] Priority summon: ${avatar.name}`);
            // Consume the guaranteed turn
            await this.presenceService.consumeNewSummonTurn(channelId, priorityDoc.avatarId);
            return [avatar];
          }
        }
      } catch (e) {
        this.logger.warn?.(`[ResponseCoordinator] Priority summon check failed: ${e.message}`);
      }
    }

    // PRIORITY 2: Sticky affinity (user has been talking to specific avatar)
    if (message && !message.author.bot && this.STICKY_AFFINITY_EXCLUSIVE) {
      const stickyAvatarId = this.decisionMaker._getAffinityAvatarId(channelId, message.author.id);
      if (stickyAvatarId) {
        const stickyAvatar = eligibleAvatars.find(
          av => `${av._id || av.id}` === `${stickyAvatarId}`
        );
        if (stickyAvatar) {
          // Check if sticky avatar should respond
          const shouldRespond = await this.decisionMaker.shouldRespond(channel, stickyAvatar, message);
          if (shouldRespond) {
            this.logger.info?.(`[ResponseCoordinator] Sticky affinity: ${stickyAvatar.name}`);
            return [stickyAvatar];
          }
        }
      }
    }

    // PRIORITY 3: Direct mention by name/emoji
    if (message && message.content) {
      const mentionedAvatars = this.findMentionedAvatars(message.content, eligibleAvatars);
      if (mentionedAvatars.length > 0) {
        // Take first mentioned avatar
        const mentioned = mentionedAvatars[0];
        
        // Record sticky affinity for future
        if (!message.author.bot && this.decisionMaker._recordAffinity) {
          this.decisionMaker._recordAffinity(channelId, message.author.id, mentioned._id || mentioned.id);
        }
        
        this.logger.info?.(`[ResponseCoordinator] Direct mention: ${mentioned.name}`);
        return [mentioned];
      }
    }

    // PRIORITY 4: Turn-based selection (active speaker)
    if (this.TURN_BASED_MODE && message) {
      const activeSpeaker = await this.getActiveSpeaker(channelId, eligibleAvatars);
      if (activeSpeaker) {
        const shouldRespond = await this.decisionMaker.shouldRespond(channel, activeSpeaker, message);
        if (shouldRespond) {
          this.logger.info?.(`[ResponseCoordinator] Active speaker: ${activeSpeaker.name}`);
          return [activeSpeaker];
        }
      }
    }

    // PRIORITY 5: Presence-based scoring (for ambient or when no clear speaker)
    const ranked = await this.rankByPresence(channelId, eligibleAvatars);
    
    // For ambient triggers, ensure conversational diversity
    if (trigger.type === 'ambient') {
      // Get last 3 speakers in channel to avoid consecutive ambient responses from same avatar
      const recentSpeakers = await this.getRecentChannelSpeakers(channel, 3);
      const recentSpeakerAliases = new Set();
      for (const msg of recentSpeakers) {
        for (const alias of this.extractSpeakerAliases(msg)) {
          recentSpeakerAliases.add(alias);
        }
      }

      const lastSpeakerAliasSet = recentSpeakers.length > 0 ? new Set(this.extractSpeakerAliases(recentSpeakers[0])) : new Set();

      this.logger.debug?.(`[ResponseCoordinator] Recent speakers: ${recentSpeakers.map(m => m.author.username || m.author.id).join(', ')}`);
      
      // Filter out avatars who spoke in the last 3 messages (creates natural back-and-forth)
      const eligibleForAmbient = ranked.filter(r => {
        const avatarAliases = this.getAvatarAliases(r.avatar);
        const wasRecentSpeaker = avatarAliases.some(alias => recentSpeakerAliases.has(alias));
        
        if (wasRecentSpeaker) {
          this.logger.debug?.(`[ResponseCoordinator] Skipping ${r.avatar.name} - was recent speaker (ambient diversity)`);
          return false;
        }
        
        // Skip if on cooldown
        if (this.presenceService.cooldownActive(r.presenceDoc)) {
          this.logger.debug?.(`[ResponseCoordinator] Skipping ${r.avatar.name} - on cooldown`);
          return false;
        }
        
        return true;
      });
      
      if (eligibleForAmbient.length > 0) {
        const selected = eligibleForAmbient[0];
        this.logger.info?.(`[ResponseCoordinator] Ambient selected: ${selected.avatar.name} (score: ${selected.score.toFixed(2)})`);
        return [selected.avatar];
      }
      
      // If all avatars filtered out, allow a recent speaker but only if score is high enough
      // AND they weren't the very last speaker (most recent message)
      if (ranked.length > 0 && ranked[0].score > 0.5) {
        const fallback = ranked[0];
        const avatarAliases = this.getAvatarAliases(fallback.avatar);
        const wasLastSpeaker = avatarAliases.some(alias => lastSpeakerAliasSet.has(alias));

        // Don't allow the immediate last speaker
        if (wasLastSpeaker) {
          this.logger.debug?.(`[ResponseCoordinator] No ambient response - would repeat last speaker`);
          return [];
        }
        
        this.logger.warn?.(`[ResponseCoordinator] Ambient fallback: ${fallback.avatar.name} (score: ${fallback.score.toFixed(2)})`);
        return [fallback.avatar];
      }
      
      this.logger.debug?.(`[ResponseCoordinator] No eligible avatars for ambient response`);
      return [];
    }

    // PRIORITY 6: DecisionMaker evaluation (legacy fallback)
    // Check top-ranked avatars via DecisionMaker
    const limit = Math.min(3, this.MAX_RESPONSES_PER_MESSAGE);
    for (const ranked_item of ranked.slice(0, limit)) {
      const shouldRespond = await this.decisionMaker.shouldRespond(channel, ranked_item.avatar, message);
      if (shouldRespond) {
        this.logger.info?.(`[ResponseCoordinator] DecisionMaker selected: ${ranked_item.avatar.name}`);
        return [ranked_item.avatar];
      }
    }

    // No avatar selected
    return [];
  }

  /**
   * Find avatars mentioned by name or emoji in content
   * @param {string} content - Message content
   * @param {Array} avatars - Available avatars
   * @returns {Array} Mentioned avatars
   */
  findMentionedAvatars(content, avatars) {
    const lower = content.toLowerCase();
    const mentioned = [];

    for (const avatar of avatars) {
      const name = String(avatar.name || '').toLowerCase();
      const emoji = String(avatar.emoji || '').toLowerCase();
      
      if (name && lower.includes(name)) {
        mentioned.push(avatar);
      } else if (emoji && lower.includes(emoji)) {
        mentioned.push(avatar);
      }
    }

    return mentioned;
  }

  /**
   * Get the current active speaker in a channel (turn-based mode)
   * @param {string} channelId - Channel ID
   * @param {Array} avatars - Available avatars
   * @returns {Promise<Object|null>} Active speaker avatar or null
   */
  async getActiveSpeaker(channelId, avatars) {
    try {
      const c = await this.presenceService.col();
      
      // Find avatar marked as active speaker
      const activeDoc = await c.findOne({
        channelId,
        conversationRole: 'active_speaker',
        state: 'present'
      });

      if (activeDoc) {
        return avatars.find(av => `${av._id || av.id}` === `${activeDoc.avatarId}`);
      }

      // No active speaker - select based on longest time since last turn
      const presenceDocs = await c.find({
        channelId,
        avatarId: { $in: avatars.map(av => `${av._id || av.id}`) }
      }).toArray();

      if (presenceDocs.length === 0) return null;

      // Sort by lastTurnAt (oldest first = highest priority)
      presenceDocs.sort((a, b) => {
        const aTime = a.lastTurnAt ? new Date(a.lastTurnAt).getTime() : 0;
        const bTime = b.lastTurnAt ? new Date(b.lastTurnAt).getTime() : 0;
        return aTime - bTime;
      });

      const chosen = presenceDocs[0];
      return avatars.find(av => `${av._id || av.id}` === `${chosen.avatarId}`);
    } catch (e) {
      this.logger.warn?.(`[ResponseCoordinator] getActiveSpeaker error: ${e.message}`);
      return null;
    }
  }

  /**
   * Rank avatars by presence score
   * @param {string} channelId - Channel ID
   * @param {Array} avatars - Available avatars
   * @returns {Promise<Array>} Ranked avatars with scores
   */
  async rankByPresence(channelId, avatars) {
    try {
      const c = await this.presenceService.col();
      const presenceDocs = await c.find({
        channelId,
        avatarId: { $in: avatars.map(av => `${av._id || av.id}`) }
      }).toArray();

      const ranked = [];
      for (const doc of presenceDocs) {
        const avatar = avatars.find(av => `${av._id || av.id}` === `${doc.avatarId}`);
        if (!avatar) continue;

        const score = this.presenceService.scoreInitiative(doc, {});
        ranked.push({ avatar, presenceDoc: doc, score });
      }

      // Sort by score (highest first)
      ranked.sort((a, b) => b.score - a.score);
      return ranked;
    } catch (e) {
      this.logger.warn?.(`[ResponseCoordinator] rankByPresence error: ${e.message}`);
      return avatars.map(av => ({ avatar: av, presenceDoc: null, score: 0 }));
    }
  }

  normalizeAlias(value) {
    if (!value && value !== 0) return '';
    return String(value).trim().toLowerCase();
  }

  stripEmojis(value) {
    if (!value && value !== 0) return '';
    const str = String(value);
    try {
      return str.replace(/\p{Extended_Pictographic}/gu, '').replace(/\s+/g, ' ').trim();
    } catch {
      // Fallback range for environments without Unicode property escapes
      return str.replace(/[\u{1F300}-\u{1FAFF}]/gu, '').replace(/\s+/g, ' ').trim();
    }
  }

  extractSpeakerAliases(message) {
    const aliases = new Set();
    if (!message) return aliases;

    const add = (val) => {
      const normalized = this.normalizeAlias(val);
      if (normalized) aliases.add(normalized);
    };

    const author = message.author || {};
    add(author.id);
    add(author.username);
    add(author.globalName);
    add(author.displayName);
    add(this.stripEmojis(author.username));
    add(this.stripEmojis(author.globalName));
    add(message.member?.nickname);
    add(this.stripEmojis(message.member?.nickname));
    add(message.webhookId);

    return Array.from(aliases);
  }

  getAvatarAliases(avatar) {
    const aliases = new Set();
    if (!avatar) return Array.from(aliases);

    const add = (val) => {
      const normalized = this.normalizeAlias(val);
      if (normalized) aliases.add(normalized);
    };

    const id = avatar._id || avatar.id;
    add(id);
    add(avatar.name);
    add(this.stripEmojis(avatar.name));
    if (avatar.emoji) {
      add(`${avatar.name || ''}${avatar.emoji}`);
      add(`${avatar.emoji}${avatar.name || ''}`);
    }
    add(avatar.displayName);
    add(this.stripEmojis(avatar.displayName));
    if (Array.isArray(avatar.aliases)) {
      for (const alias of avatar.aliases) {
        add(alias);
        add(this.stripEmojis(alias));
      }
    }

    return Array.from(aliases);
  }

  /**
   * Acquire a response lock to prevent duplicate responses
   * @param {string} channelId - Channel ID
   * @param {string} avatarId - Avatar ID
   * @returns {Promise<boolean>} True if lock acquired
   */
  async acquireResponseLock(channelId, avatarId) {
    try {
      const locks = await this.col('response_locks');
      const lockId = `${channelId}:${avatarId}`;
      const expiresAt = new Date(Date.now() + this.RESPONSE_LOCK_TTL_MS);

      const result = await locks.insertOne({
        _id: lockId,
        channelId,
        avatarId,
        acquiredAt: new Date(),
        expiresAt
      });

      return result.acknowledged;
    } catch (e) {
      // Duplicate key = lock already held
      if (String(e?.message || '').includes('duplicate key')) {
        return false;
      }
      this.logger.warn?.(`[ResponseCoordinator] Lock acquisition error: ${e.message}`);
      return false;
    }
  }

  /**
   * Release a response lock
   * @param {string} channelId - Channel ID
   * @param {string} avatarId - Avatar ID
   */
  async releaseResponseLock(channelId, avatarId) {
    try {
      const locks = await this.col('response_locks');
      const lockId = `${channelId}:${avatarId}`;
      await locks.deleteOne({ _id: lockId });
    } catch (e) {
      this.logger.warn?.(`[ResponseCoordinator] Lock release error: ${e.message}`);
    }
  }

  /**
   * Get the last speaker in a channel (for ambient diversity)
   * @param {Object} channel - Discord channel object
   * @returns {Promise<Object|null>} Last message or null
   */
  async getLastChannelSpeaker(channel) {
    try {
      const messages = await channel.messages.fetch({ limit: 10 });
      
      // Find the most recent bot message (avatar speech)
      for (const msg of messages.values()) {
        if (msg.author.bot || msg.webhookId) {
          return msg;
        }
      }
      
      return null;
    } catch (e) {
      this.logger.warn?.(`[ResponseCoordinator] getLastChannelSpeaker error: ${e.message}`);
      return null;
    }
  }

  /**
   * Get recent speakers in a channel (improved diversity checking)
   * @param {Object} channel - Discord channel object
   * @param {number} limit - Number of recent speakers to return
   * @returns {Promise<Array>} Array of recent messages from bot avatars
   */
  async getRecentChannelSpeakers(channel, limit = 3) {
    try {
      const messages = await channel.messages.fetch({ limit: 20 });
      const botMessages = [];
      
      // Find recent bot messages (avatar speech)
      for (const msg of messages.values()) {
        if ((msg.author.bot || msg.webhookId) && botMessages.length < limit) {
          botMessages.push(msg);
        }
      }
      
      return botMessages;
    } catch (e) {
      this.logger.warn?.(`[ResponseCoordinator] getRecentChannelSpeakers error: ${e.message}`);
      return [];
    }
  }

  /**
   * Clean up expired locks (should be called periodically)
   */
  async cleanupExpiredLocks() {
    try {
      const locks = await this.col('response_locks');
      const result = await locks.deleteMany({
        expiresAt: { $lt: new Date() }
      });
      if (result.deletedCount > 0) {
        this.logger.debug?.(`[ResponseCoordinator] Cleaned ${result.deletedCount} expired locks`);
      }
    } catch (e) {
      this.logger.warn?.(`[ResponseCoordinator] Lock cleanup error: ${e.message}`);
    }
  }

  /**
   * Generate response for an avatar
   * @param {Object} avatar - Avatar object
   * @param {Object} channel - Discord channel
   * @param {Object} message - Discord message or null
   * @param {Object} context - Additional context
   * @returns {Promise<Object|null>} Sent message or null
   */
  async generateResponse(avatar, channel, message, context = {}) {
    try {
      const options = {
        overrideCooldown: context.overrideCooldown || false,
        cascadeDepth: context.cascadeDepth || 0
      };

      return await this.conversationManager.sendResponse(channel, avatar, null, options);
    } catch (e) {
      this.logger.error(`[ResponseCoordinator] generateResponse error: ${e.message}`);
      return null;
    }
  }

  /**
   * Update conversation session tracking
   * @param {string} channelId - Channel ID
   * @param {string} userId - User ID
   * @param {string} avatarId - Avatar ID
   */
  async updateConversationSession(channelId, userId, avatarId) {
    try {
      const sessions = await this.col('conversation_sessions');
      await sessions.updateOne(
        { channelId, userId },
        {
          $set: {
            avatarId,
            lastInteractionAt: new Date(),
            updatedAt: new Date()
          },
          $inc: { messageCount: 1 },
          $setOnInsert: { startedAt: new Date() }
        },
        { upsert: true }
      );
    } catch (e) {
      this.logger.warn?.(`[ResponseCoordinator] Session update error: ${e.message}`);
    }
  }

  /**
   * Get active conversation session for a user in a channel
   * @param {string} channelId - Channel ID
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} Session data or null
   */
  async getConversationSession(channelId, userId) {
    try {
      const sessions = await this.col('conversation_sessions');
      const session = await sessions.findOne({ channelId, userId });
      
      // Expire old sessions (over 30 minutes)
      if (session && session.lastInteractionAt) {
        const age = Date.now() - new Date(session.lastInteractionAt).getTime();
        if (age > 30 * 60 * 1000) {
          await sessions.deleteOne({ _id: session._id });
          return null;
        }
      }
      
      return session;
    } catch (e) {
      this.logger.warn?.(`[ResponseCoordinator] Session retrieval error: ${e.message}`);
      return null;
    }
  }

  /**
   * Start periodic maintenance tasks
   */
  startMaintenance(schedulingService) {
    if (!schedulingService) {
      this.logger.warn('[ResponseCoordinator] No schedulingService provided for maintenance');
      return;
    }

    // Clean up expired locks every minute
    schedulingService.addTask(
      'response-coordinator-cleanup',
      () => this.cleanupExpiredLocks(),
      60 * 1000
    );

    this.logger.info('[ResponseCoordinator] Maintenance tasks started');
  }
}

export default ResponseCoordinator;
