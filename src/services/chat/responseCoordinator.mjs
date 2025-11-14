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
    conversationThreadService,
  }) {
    this.logger = logger || console;
    this.databaseService = databaseService;
    this.presenceService = presenceService;
    this.conversationManager = conversationManager;
    this.avatarService = avatarService;
    this.decisionMaker = decisionMaker;
    this.discordService = discordService;
  this.conversationThreadService = conversationThreadService;

    // Configuration
    this.MAX_RESPONSES_PER_MESSAGE = Number(process.env.MAX_RESPONSES_PER_MESSAGE || 1);
    this.RESPONSE_LOCK_TTL_MS = Number(process.env.RESPONSE_LOCK_TTL_MS || 5000);
    this.STICKY_AFFINITY_EXCLUSIVE = String(process.env.STICKY_AFFINITY_EXCLUSIVE || 'true').toLowerCase() === 'true';
    this.TURN_BASED_MODE = String(process.env.TURN_BASED_MODE || 'true').toLowerCase() === 'true';
    
    // Cache for recent speakers to reduce Discord API calls
    this.recentSpeakersCache = new Map(); // channelId -> { speakers: [], at: timestamp }
    this.SPEAKER_CACHE_TTL = Number(process.env.SPEAKER_CACHE_TTL_MS || 60000); // 1 minute default
    
    // Cache statistics for monitoring
    this.cacheStats = {
      hits: 0,
      misses: 0,
      totalRequests: 0,
      lastReset: Date.now()
    };
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
      const threadSelections = context.threadSelections || {};
      for (const avatar of selectedAvatars) {
        this.logger.debug?.(`[ResponseCoordinator] Attempting response from ${avatar.name}`);
        
        // Acquire lock to prevent duplicates
        const lockAcquired = await this.acquireResponseLock(channelId, avatar._id || avatar.id);
        if (!lockAcquired) {
          this.logger.info?.(`[ResponseCoordinator] Lock not acquired for ${avatar.name} in ${channelId} - another response in progress`);
          continue;
        }

        try {
          this.logger.debug?.(`[ResponseCoordinator] Lock acquired, generating response for ${avatar.name}`);
          // Generate and send the response
          const avatarId = `${avatar._id || avatar.id}`;
          const responseContext = {
            ...context,
            conversationThread: threadSelections[avatarId] || context.conversationThread || null
          };
          const response = await this.generateResponse(avatar, channel, message, responseContext);
          if (response) {
            this.logger.debug?.(`[ResponseCoordinator] Response generated successfully for ${avatar.name}`);
            responses.push(response);
            
            // Update presence state
            await this.presenceService.recordTurn(channelId, `${avatar._id || avatar.id}`);
            
            // Record conversation session
            if (message && !message.author.bot) {
              await this.updateConversationSession(channelId, message.author.id, avatar._id || avatar.id);
            }
          } else {
            this.logger.warn?.(`[ResponseCoordinator] generateResponse returned null/empty for ${avatar.name}`);
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

    // PRIORITY 0 (HIGHEST): User replied to an avatar's message
    // This is the most direct form of engagement and should trigger immediate response
    if (message?.repliedToAvatarId) {
      this.logger.info?.(`[ResponseCoordinator] 🔗 REPLY DETECTED - Message is a reply to avatar ${message.repliedToAvatarName} (ID: ${message.repliedToAvatarId})`);
      
      try {
        // Find the replied-to avatar in eligible avatars
        let repliedToAvatar = eligibleAvatars.find(
          av => `${av._id || av.id}` === `${message.repliedToAvatarId}`
        );

        if (!repliedToAvatar) {
          this.logger.warn?.(`[ResponseCoordinator] Replied-to avatar ${message.repliedToAvatarName} not in eligible avatars list (${eligibleAvatars.length} avatars), attempting to fetch`);
        } else {
          this.logger.info?.(`[ResponseCoordinator] ✅ Found replied-to avatar ${repliedToAvatar.name} in eligible avatars`);
        }

        // If avatar is not in channel, try to fetch and move them
        if (!repliedToAvatar) {
          try {
            repliedToAvatar = await this.avatarService.getAvatarById(message.repliedToAvatarId);
            if (repliedToAvatar) {
              this.logger.info?.(`[ResponseCoordinator] Fetched replied-to avatar ${repliedToAvatar.name} from database`);
              
              // Move avatar to this channel if they exist elsewhere
              if (String(repliedToAvatar.channelId) !== String(channelId)) {
                this.logger.info?.(`[ResponseCoordinator] Moving replied-to avatar ${repliedToAvatar.name} from channel ${repliedToAvatar.channelId} to ${channelId}`);
                const mapService = this.avatarService.mapService;
                if (mapService?.updateAvatarPosition) {
                  await mapService.updateAvatarPosition(repliedToAvatar, channelId, repliedToAvatar.channelId);
                  this.logger.info?.(`[ResponseCoordinator] Used MapService to move avatar`);
                } else {
                  // Direct update if no map service
                  const db = await this.databaseService.getDatabase();
                  await db.collection('avatars').updateOne(
                    { _id: repliedToAvatar._id },
                    { $set: { channelId: channelId, updatedAt: new Date() } }
                  );
                  this.logger.info?.(`[ResponseCoordinator] Direct DB update to move avatar`);
                }
                repliedToAvatar.channelId = channelId;
              }
              
              // Activate the avatar in this channel
              await this.avatarService.activateAvatarInChannel(channelId, message.repliedToAvatarId);
              this.logger.info?.(`[ResponseCoordinator] ✅ Activated replied-to avatar ${repliedToAvatar.name} in channel`);
            }
          } catch (fetchErr) {
            this.logger.error?.(`[ResponseCoordinator] Failed to fetch/move replied-to avatar: ${fetchErr.message}`);
          }
        }

        if (repliedToAvatar) {
          // Even if avatar is on cooldown, we should respond to direct replies
          // This creates a natural conversation flow
          this.logger.info?.(`[ResponseCoordinator] 🎯 REPLY PRIORITY: ${repliedToAvatar.name} will respond to reply (overriding all other priorities)`);
          return [repliedToAvatar];
        } else {
          this.logger.error?.(`[ResponseCoordinator] ❌ Could not find or fetch replied-to avatar ${message.repliedToAvatarName} (ID: ${message.repliedToAvatarId})`);
        }
      } catch (e) {
        this.logger.error?.(`[ResponseCoordinator] Reply detection failed: ${e.message}`, e.stack);
      }
    } else {
      this.logger.debug?.(`[ResponseCoordinator] No reply detected (message.repliedToAvatarId: ${message?.repliedToAvatarId || 'undefined'})`);
    }

    const threadResult = await this.getThreadParticipant(channelId, eligibleAvatars);
    if (threadResult) {
      if (!_context.threadSelections) _context.threadSelections = {};
      const key = `${threadResult.avatar._id || threadResult.avatar.id}`;
      _context.threadSelections[key] = threadResult.thread;
      this.logger.info?.(`[ResponseCoordinator] Thread participant: ${threadResult.avatar.name}`);
      return [threadResult.avatar];
    }

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
      try {
        const stickyAvatarId = this.decisionMaker._getAffinityAvatarId(channelId, message.author.id);
        if (stickyAvatarId) {
          const stickyAvatar = eligibleAvatars.find(
            av => `${av._id || av.id}` === `${stickyAvatarId}`
          );
          if (stickyAvatar) {
            // Check if sticky avatar should respond
            const shouldRespond = await this.decisionMaker.shouldRespond(channel, stickyAvatar, message);
            if (shouldRespond) {
              // CRITICAL: Extend the sticky affinity TTL since user is still actively engaging
              // This keeps the avatar "locked on" to this user as long as they keep talking
              this.decisionMaker._recordAffinity(channelId, message.author.id, stickyAvatarId);
              this.logger.info?.(`[ResponseCoordinator] Sticky affinity: ${stickyAvatar.name} (TTL refreshed)`);
              return [stickyAvatar];
            }
          }
        }
      } catch (e) {
        this.logger.warn?.(`[ResponseCoordinator] Sticky affinity check failed: ${e.message}`);
      }
    }

    // PRIORITY 3: Direct mention by name/emoji
    if (message && message.content) {
      try {
        const mentionedAvatars = this.avatarService?.matchAvatarsByContent
          ? this.avatarService.matchAvatarsByContent(message.content, eligibleAvatars, { limit: 1 })
          : [];
        if (mentionedAvatars.length > 0) {
          // Take first mentioned avatar
          const mentioned = mentionedAvatars[0];
          
          // Record sticky affinity for future
          if (!message.author.bot && this.decisionMaker._recordAffinity) {
            try {
              this.decisionMaker._recordAffinity(channelId, message.author.id, mentioned._id || mentioned.id);
            } catch (e) {
              this.logger.debug?.(`[ResponseCoordinator] Failed to record affinity: ${e.message}`);
            }
          }
          
          this.logger.info?.(`[ResponseCoordinator] Direct mention: ${mentioned.name}`);
          return [mentioned];
        }
      } catch (e) {
        this.logger.warn?.(`[ResponseCoordinator] Mention detection failed: ${e.message}`);
      }
    }

    // PRIORITY 4: Turn-based selection (active speaker)
    if (this.TURN_BASED_MODE && message) {
      try {
        const activeSpeaker = await this.getActiveSpeaker(channelId, eligibleAvatars);
        if (activeSpeaker) {
          const shouldRespond = await this.decisionMaker.shouldRespond(channel, activeSpeaker, message);
          if (shouldRespond) {
            this.logger.info?.(`[ResponseCoordinator] Active speaker: ${activeSpeaker.name}`);
            return [activeSpeaker];
          }
        }
      } catch (e) {
        this.logger.warn?.(`[ResponseCoordinator] Turn-based selection failed: ${e.message}`);
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
      
      // Lower threshold fallback for edge cases (score > 0.3)
      if (ranked.length > 0 && ranked[0].score > 0.3) {
        const fallback = ranked[0];
        const avatarAliases = this.getAvatarAliases(fallback.avatar);
        const wasLastSpeaker = avatarAliases.some(alias => lastSpeakerAliasSet.has(alias));

        // Don't allow the immediate last speaker
        if (!wasLastSpeaker) {
          this.logger.info?.(`[ResponseCoordinator] Ambient low-score fallback: ${fallback.avatar.name} (score: ${fallback.score.toFixed(2)})`);
          return [fallback.avatar];
        }
      }
      
      this.logger.warn?.(`[ResponseCoordinator] No eligible avatars for ambient (${ranked.length} total, best score: ${ranked[0]?.score?.toFixed(2) || 'N/A'})`);
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

  async getThreadParticipant(channelId, eligibleAvatars) {
    if (!this.conversationThreadService) return null;
    try {
      const threads = this.conversationThreadService.getActiveThreads(channelId) || [];
      if (!threads.length) return null;
      for (const thread of threads) {
        const participant = eligibleAvatars.find(av => {
          const avatarId = `${av._id || av.id}`;
          if (!thread.participants?.has?.(avatarId)) return false;
          if (thread.lastSpeakerId && thread.lastSpeakerId === avatarId) return false;
          return true;
        });
        if (participant) {
          return { avatar: participant, thread };
        }
      }
    } catch (err) {
      this.logger.debug?.(`[ResponseCoordinator] Thread participant lookup failed: ${err.message}`);
    }
    return null;
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
      // Optimized query with projection - only fetch fields needed for scoring
      const presenceDocs = await c.find({
        channelId,
        avatarId: { $in: avatars.map(av => `${av._id || av.id}`) }
      }, {
        projection: {
          avatarId: 1,
          lastTurnAt: 1,
          lastSummonedAt: 1,
          lastMentionedAt: 1,
          state: 1,
          topicTags: 1,
          priorityPins: 1,
          fatigue: 1
        }
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

  /**
   * Normalize a value to a lowercase trimmed string for case-insensitive comparison.
   * Handles null, undefined, numbers, and other types safely.
   * 
   * @param {*} value - Value to normalize (string, number, boolean, etc.)
   * @returns {string} Normalized lowercase string, or empty string if value is null/undefined
   * 
   * @example
   * normalizeAlias('MyAvatar')  // 'myavatar'
   * normalizeAlias('  HERO  ')  // 'hero'
   * normalizeAlias(null)        // ''
   * normalizeAlias(123)         // '123'
   */
  normalizeAlias(value) {
    if (!value && value !== 0) return '';
    return String(value).trim().toLowerCase();
  }

  /**
   * Strip emoji characters from a string while preserving regular text.
   * Handles both standard Unicode emojis and extended pictographic characters.
   * 
   * @param {*} value - String to process (coerced to string if not already)
   * @returns {string} String with emojis removed and whitespace normalized
   * 
   * @example
   * stripEmojis('Hero 🔥⚔️')           // 'Hero'
   * stripEmojis('Dragon   🐉  Fire')  // 'Dragon Fire'
   * stripEmojis('NoEmojis')            // 'NoEmojis'
   * 
   * @performance
   * Uses Unicode property escapes for accurate emoji detection.
   * Falls back to basic ranges for older Node versions.
   */
  stripEmojis(value) {
    if (!value && value !== 0) return '';
    const str = String(value);
    try {
      // Modern approach: Use Unicode property escapes for comprehensive emoji removal
      return str
        .replace(/\p{Extended_Pictographic}/gu, '')  // Extended pictographic emojis
        .replace(/\p{Emoji_Presentation}/gu, '')     // Emoji presentation characters
        .replace(/\s+/g, ' ')
        .trim();
    } catch {
      // Fallback for environments without Unicode property escapes
      return str
        .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')  // Emoticons, symbols, pictographs
        .replace(/[\u{2600}-\u{26FF}]/gu, '')    // Miscellaneous symbols
        .replace(/[\u{2700}-\u{27BF}]/gu, '')    // Dingbats
        .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')  // Supplemental symbols and pictographs
        .replace(/[\u{1F600}-\u{1F64F}]/gu, '')  // Emoticons
        .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')  // Transport and map symbols
        .replace(/[\u{2300}-\u{23FF}]/gu, '')    // Miscellaneous technical
        .replace(/[\u{FE00}-\u{FE0F}]/gu, '')    // Variation selectors
        .replace(/\s+/g, ' ')
        .trim();
    }
  }

  /**
   * Extract all possible identifier aliases from a Discord message for speaker matching.
   * Includes author ID, username, display name, nicknames, and webhook ID.
   * All values are normalized (lowercase, trimmed) for consistent comparison.
   * 
   * @param {Object} message - Discord message object (from discord.js)
   * @param {Object} message.author - Message author object
   * @param {string} message.author.id - Discord user ID
   * @param {string} [message.author.username] - Discord username
   * @param {string} [message.author.globalName] - Global display name
   * @param {string} [message.author.displayName] - User's display name
   * @param {Object} [message.member] - Guild member object (if in guild)
   * @param {string} [message.member.nickname] - Server nickname
   * @param {string} [message.webhookId] - Webhook ID (for bot messages)
   * @returns {Array<string>} Array of normalized alias strings
   * 
   * @example
   * // For webhook message from "Hero ⚔️"
   * extractSpeakerAliases(msg)
   * // Returns: ['webhook_id', 'hero ⚔️', 'hero', ...]
   * 
   * @example
   * // For user message
   * extractSpeakerAliases(msg)
   * // Returns: ['user_id', 'username', 'displayname', 'nickname', ...]
   */
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

  /**
   * Generate all possible identifier aliases for an avatar for matching purposes.
   * Includes avatar ID, name, display name, emoji combinations, and custom aliases.
   * All values are normalized for case-insensitive comparison.
   * 
   * @param {Object} avatar - Avatar object from database
   * @param {string|ObjectId} avatar._id - MongoDB ObjectId
   * @param {string} [avatar.id] - Alternative ID field
   * @param {string} avatar.name - Avatar name
   * @param {string} [avatar.emoji] - Avatar emoji (e.g., '⚔️', '🔥')
   * @param {string} [avatar.displayName] - Display name if different from name
   * @param {Array<string>} [avatar.aliases] - Custom aliases array
   * @returns {Array<string>} Array of normalized alias strings
   * 
   * @example
   * getAvatarAliases({ 
   *   _id: '507f1f77bcf86cd799439011',
   *   name: 'Fire Dragon',
   *   emoji: '🔥',
   *   aliases: ['Pyro', 'Inferno']
   * })
   * // Returns: ['507f1f77bcf86cd799439011', 'fire dragon', 'firedragon', 
   * //           'fire dragon🔥', '🔥fire dragon', 'pyro', 'inferno', ...]
   * 
   * @performance
   * Typical return: 5-10 aliases per avatar
   * Used frequently in ambient speaker filtering
   */
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
   * Uses in-memory cache to reduce Discord API calls
   * @param {Object} channel - Discord channel object
   * @param {number} limit - Number of recent speakers to return
   * @returns {Promise<Array>} Array of recent messages from bot avatars
   */
  async getRecentChannelSpeakers(channel, limit = 3) {
    try {
      this.cacheStats.totalRequests++;
      
      // Check cache first
      const cached = this.recentSpeakersCache.get(channel.id);
      if (cached && Date.now() - cached.at < this.SPEAKER_CACHE_TTL) {
        this.cacheStats.hits++;
        this.logger.debug?.(`[ResponseCoordinator] Using cached speakers for ${channel.id} (hit rate: ${this.getCacheHitRate().toFixed(1)}%)`);
        return cached.speakers.slice(0, limit);
      }
      
      this.cacheStats.misses++;
      
      const messages = await channel.messages.fetch({ limit: 20 });
      const botMessages = [];
      
      // Find recent bot messages (avatar speech) - cache more than we need
      for (const msg of messages.values()) {
        if ((msg.author.bot || msg.webhookId) && botMessages.length < 10) {
          botMessages.push(msg);
        }
      }
      
      // Update cache
      this.recentSpeakersCache.set(channel.id, { 
        speakers: botMessages, 
        at: Date.now() 
      });
      
      return botMessages.slice(0, limit);
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
   * Clean up expired speaker cache entries to prevent memory growth
   */
  cleanupExpiredSpeakerCache() {
    const now = Date.now();
    let removed = 0;
    
    for (const [channelId, cached] of this.recentSpeakersCache.entries()) {
      if (now - cached.at > this.SPEAKER_CACHE_TTL) {
        this.recentSpeakersCache.delete(channelId);
        removed++;
      }
    }
    
    if (removed > 0) {
      this.logger.debug?.(`[ResponseCoordinator] Cleaned ${removed} expired speaker cache entries`);
    }
    
    return removed;
  }

  /**
   * Get cache hit rate as a percentage
   * @returns {number} Hit rate percentage (0-100)
   */
  getCacheHitRate() {
    if (this.cacheStats.totalRequests === 0) return 0;
    return (this.cacheStats.hits / this.cacheStats.totalRequests) * 100;
  }

  /**
   * Get detailed cache statistics for monitoring
   * @returns {Object} Cache statistics
   */
  getCacheStats() {
    return {
      ...this.cacheStats,
      hitRate: this.getCacheHitRate(),
      cacheSize: this.recentSpeakersCache.size,
      uptime: Date.now() - this.cacheStats.lastReset
    };
  }

  /**
   * Reset cache statistics (useful for monitoring windows)
   */
  resetCacheStats() {
    const oldStats = { ...this.cacheStats };
    this.cacheStats = {
      hits: 0,
      misses: 0,
      totalRequests: 0,
      lastReset: Date.now()
    };
    return oldStats;
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
        cascadeDepth: context.cascadeDepth || 0,
        conversationThread: context.conversationThread || null
      };

      this.logger.debug?.(`[ResponseCoordinator] generateResponse called for ${avatar.name} in channel ${channel.id}`);

      // CRITICAL: Verify avatar is still in this channel before responding
      // An avatar may have moved during tool execution (e.g., MoveTool)
      // If avatar has moved, we should respond in their NEW location
      try {
        const freshAvatar = await this.avatarService.getAvatarById(avatar._id || avatar.id);
        if (freshAvatar && String(freshAvatar.channelId) !== String(channel.id)) {
          this.logger.info?.(`[ResponseCoordinator] Avatar ${avatar.name} moved to ${freshAvatar.channelId}, redirecting response`);
          
          // Fetch the new channel
          const newChannel = await this.discordService.client.channels.fetch(freshAvatar.channelId);
          if (newChannel) {
            // Update avatar reference with fresh data
            avatar = freshAvatar;
            channel = newChannel;
          } else {
            this.logger.warn?.(`[ResponseCoordinator] Could not fetch new channel ${freshAvatar.channelId}, using original`);
          }
        }
      } catch (e) {
        this.logger.warn?.(`[ResponseCoordinator] Failed to check avatar location: ${e.message}`);
        // Continue with original channel if check fails
      }

      this.logger.debug?.(`[ResponseCoordinator] Calling conversationManager.sendResponse for ${avatar.name}`);
      const result = await this.conversationManager.sendResponse(channel, avatar, null, options);
      
      if (!result) {
        this.logger.warn?.(`[ResponseCoordinator] conversationManager.sendResponse returned null for ${avatar.name}`);
      }
      
      return result;
    } catch (e) {
      this.logger.error(`[ResponseCoordinator] generateResponse error for ${avatar.name}: ${e.message}`);
      this.logger.error(`[ResponseCoordinator] Stack: ${e.stack}`);
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
      
      // Also refresh the sticky affinity TTL since this avatar just responded to this user
      // This ensures the avatar continues to be "locked on" to this user as long as they're actively conversing
      if (this.decisionMaker?._recordAffinity) {
        this.decisionMaker._recordAffinity(channelId, userId, avatarId);
      }
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

    // Clean up expired affinity records every 5 minutes
    if (this.decisionMaker?.cleanupExpiredAffinity) {
      schedulingService.addTask(
        'decision-maker-affinity-cleanup',
        () => this.decisionMaker.cleanupExpiredAffinity(),
        5 * 60 * 1000
      );
    }

    // Clean up expired speaker cache every 2 minutes
    schedulingService.addTask(
      'speaker-cache-cleanup',
      () => this.cleanupExpiredSpeakerCache(),
      2 * 60 * 1000
    );

    this.logger.info('[ResponseCoordinator] Maintenance tasks started');
  }
}

export default ResponseCoordinator;
