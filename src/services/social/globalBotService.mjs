/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Global Bot Service
 * Manages the CosyWorld global narrator bot as a first-class avatar
 * with personality, memory, and narrative evolution.
 */

export class GlobalBotService {
  constructor({ 
    databaseService, 
    avatarService, 
    memoryService, 
    aiService,
    xService,
    logger = console 
  }) {
    this.databaseService = databaseService;
    this.avatarService = avatarService;
    this.memoryService = memoryService;
    this.aiService = aiService;
    this.xService = xService;
    this.logger = logger;
    this.botId = null;
    this.bot = null;
    this.narrativeInterval = null;
  }

  /**
   * Initialize the global bot service
   * Creates or retrieves the global bot avatar and starts narrative generation
   */
  async initialize() {
    try {
      this.botId = await this.getOrCreateGlobalBot();
      this.bot = await this.avatarService.getAvatarById(this.botId);
      
      // Schedule periodic narrative generation (once per week by default)
      const intervalHours = Number(process.env.GLOBAL_BOT_NARRATIVE_INTERVAL_HOURS || 168); // 168 hours = 7 days
      this.scheduleNarrativeGeneration(intervalHours);
      
      this.logger?.info?.(`[GlobalBotService] Initialized with bot ID: ${this.botId}`);
    } catch (err) {
      this.logger?.error?.(`[GlobalBotService] Initialization failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Get or create the global bot avatar document
   * @returns {Promise<string>} - The bot's avatar ID
   */
  async getOrCreateGlobalBot() {
    const db = await this.databaseService.getDatabase();
    let bot = await db.collection('avatars').findOne({ type: 'global_narrator' });
    
    if (!bot) {
      this.logger?.info?.('[GlobalBotService] Creating new global bot avatar');
      
      const botDoc = {
        name: "CosyWorld",
        emoji: "🌍",
        type: "global_narrator",
        personality: "I am the narrator of CosyWorld, a warm and welcoming guide who introduces new souls to our universe. I celebrate each arrival with genuine curiosity and help the community discover fascinating characters. I have a friendly, slightly whimsical tone and enjoy highlighting what makes each being unique.",
        dynamicPrompt: "I've been welcoming many interesting souls to our realm. Each one brings their own story and energy to CosyWorld.",
        model: process.env.GLOBAL_BOT_MODEL || "anthropic/claude-sonnet-4.5",
        status: "immortal",
        createdAt: new Date(),
        updatedAt: new Date(),
        globalBotConfig: {
          enabled: true,
          maxIntrosPerDay: Number(process.env.GLOBAL_BOT_MAX_INTROS_PER_DAY || 20),
          preferredHashtags: ["CosyWorld"],
          narrativeIntervalHours: Number(process.env.GLOBAL_BOT_NARRATIVE_INTERVAL_HOURS || 168) // Default: once per week (7 days * 24 hours)
        }
      };
      
      const result = await db.collection('avatars').insertOne(botDoc);
      bot = { ...botDoc, _id: result.insertedId };
      
      // Create initial memory
      await this.memoryService.write({
        avatarId: result.insertedId,
        kind: 'system',
        text: 'I am CosyWorld, the narrator of this universe. My purpose is to welcome new arrivals and share their stories with the community.',
        weight: 2.0
      });
    }
    
    return bot._id;
  }

  /**
   * Check if we should post about an avatar (deduplication)
   * @param {string} avatarId - Avatar ID to check
   * @returns {Promise<boolean>} - True if we should post, false if recently posted
   */
  async shouldPostAboutAvatar(avatarId) {
    if (!avatarId) return true;
    
    try {
      // Check recent memories for mentions of this avatar
      const recentMemories = await this.memoryService.query({
        avatarId: this.botId,
        queryText: `avatar ${avatarId} introduction`,
        topK: 10
      });
      
      // If mentioned in recent memories, skip
      const recentlyMentioned = recentMemories.some(m => 
        m.text && m.text.includes(String(avatarId))
      );
      
      if (recentlyMentioned) {
        this.logger?.debug?.(`[GlobalBotService] Skipping avatar ${avatarId} - recently mentioned in memories`);
        return false;
      }
      
      // Also check social_posts collection as backup
      const db = await this.databaseService.getDatabase();
      const windowMs = 24 * 60 * 60 * 1000; // 24 hours
      const cutoff = new Date(Date.now() - windowMs);
      
      const recentPost = await db.collection('social_posts').findOne({
        global: true,
        'metadata.avatarId': String(avatarId),
        'metadata.type': 'introduction',
        createdAt: { $gte: cutoff }
      });
      
      if (recentPost) {
        this.logger?.debug?.(`[GlobalBotService] Skipping avatar ${avatarId} - recently posted`);
        return false;
      }
      
      return true;
    } catch (err) {
      this.logger?.warn?.(`[GlobalBotService] shouldPostAboutAvatar check failed: ${err.message}`);
      return true; // Fail open - allow posting if check fails
    }
  }

  /**
   * Generate a contextual post using the global bot's personality and memories
   * @param {Object} mediaPayload - Media event payload with context
   * @returns {Promise<string>} - Generated post text
   */
  async generateContextualPost(mediaPayload) {
    try {
      // Refresh bot data
      this.bot = await this.avatarService.getAvatarById(this.botId);
      
      // Get recent memories for context
      const recentMemories = await this.memoryService.getMemories(this.botId, 10);
      const memoryText = recentMemories
        .map(m => m.memory || m.text)
        .filter(Boolean)
        .join('\n');
      
      const systemPrompt = `You are ${this.bot.name} ${this.bot.emoji}, the narrator of CosyWorld.

${this.bot.personality}

Your current thoughts and perspective:
${this.bot.dynamicPrompt || ''}

Recent memories and activities:
${memoryText || 'Just starting my journey as narrator.'}`;

      let userPrompt;
      
      if (mediaPayload.source === 'avatar.create' && mediaPayload.avatarName) {
        // Avatar introduction
        userPrompt = `A new soul has arrived in CosyWorld: ${mediaPayload.avatarEmoji || ''} ${mediaPayload.avatarName}

Description: ${mediaPayload.prompt || 'A mysterious new arrival'}

Create a welcoming introduction tweet (max 240 chars) that:
1. Captures their essence and what makes them unique
2. Welcomes them warmly to the community
3. Reflects your narrator personality
4. Makes people curious to learn more about them

Be conversational and genuine. Do not use quotes, extra hashtags, or generic phrases.`;
      } else if (mediaPayload.source === 'location.create' && mediaPayload.locationName) {
        // New location discovery
        userPrompt = `A new location has been discovered in CosyWorld: "${mediaPayload.locationName}"

Description: ${mediaPayload.locationDescription || 'A mysterious new place'}

Create an evocative announcement (max 240 chars) that:
1. Highlights what makes this location unique and intriguing
2. Invites adventurers to explore it
3. Uses vivid, atmospheric language
4. Reflects your narrator personality

Be immersive and captivating. Include the location name. No quotes or extra hashtags.`;
      } else {
        // General media post
        userPrompt = `Describe this moment in CosyWorld in an engaging way (max 240 chars).

Context: ${mediaPayload.context || mediaPayload.prompt || 'An interesting moment in our universe'}

Make it compelling and reflect your narrator voice. No quotes or extra hashtags.`;
      }

      const response = await this.aiService.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], { 
        model: this.bot.model, 
        max_tokens: 200,
        temperature: 0.8 
      });

      const text = typeof response === 'object' ? response.text : response;
      
      // Clean up response
      return String(text || '')
        .replace(/<think>[\s\S]*?<\/think>/g, '') // Remove any thinking tags
        .replace(/[#\n\r]+/g, ' ') // Remove hashtags and newlines
        .trim();
      
    } catch (err) {
      this.logger?.error?.(`[GlobalBotService] generateContextualPost failed: ${err.message}`);
      
      // Fallback to simple text
      if (mediaPayload.source === 'avatar.create' && mediaPayload.avatarName) {
        return `${mediaPayload.avatarEmoji || '✨'} Meet ${mediaPayload.avatarName} — ${mediaPayload.prompt || 'a new arrival in CosyWorld'}`;
      }
      
      return mediaPayload.context || mediaPayload.prompt || 'A moment in CosyWorld';
    }
  }

  /**
   * Record a post in the bot's memory
   * @param {string} tweetId - Tweet ID
   * @param {Object} mediaPayload - Original media payload
   * @param {string} content - Generated post content
   */
  async recordPost(tweetId, mediaPayload, content) {
    try {
      let memoryText;
      
      if (mediaPayload.source === 'avatar.create' && mediaPayload.avatarName) {
        memoryText = `Introduced ${mediaPayload.avatarEmoji || ''} ${mediaPayload.avatarName} (${mediaPayload.avatarId}) to the community. ${content.slice(0, 100)}`;
      } else {
        memoryText = `Shared: ${content.slice(0, 150)}`;
      }
      
      await this.memoryService.write({
        avatarId: this.botId,
        kind: 'post_memory',
        text: memoryText,
        weight: 1.2 // Give posts slightly higher weight
      });
      
      this.logger?.debug?.(`[GlobalBotService] Recorded post memory for tweet ${tweetId}`);
    } catch (err) {
      this.logger?.warn?.(`[GlobalBotService] recordPost failed: ${err.message}`);
    }
  }

  /**
   * Schedule periodic narrative generation
   * @param {number} intervalHours - Hours between narrative generations
   */
  scheduleNarrativeGeneration(intervalHours = 6) {
    // Clear any existing interval
    if (this.narrativeInterval) {
      clearInterval(this.narrativeInterval);
    }
    
    const intervalMs = intervalHours * 60 * 60 * 1000;
    
    this.narrativeInterval = setInterval(async () => {
      try {
        await this.generateNarrative();
      } catch (err) {
        this.logger?.error?.(`[GlobalBotService] Narrative generation failed: ${err.message}`);
      }
    }, intervalMs);
    
    this.logger?.info?.(`[GlobalBotService] Scheduled narrative generation every ${intervalHours} hours`);
    
    // Generate initial narrative only if last one was more than 24 hours ago
    setTimeout(async () => {
      try {
        const shouldGenerate = await this.shouldGenerateNarrative();
        if (shouldGenerate) {
          await this.generateNarrative();
        } else {
          this.logger?.info?.('[GlobalBotService] Skipping initial narrative - generated recently');
        }
      } catch (err) {
        this.logger?.error?.(`[GlobalBotService] Initial narrative check failed: ${err.message}`);
      }
    }, 60000); // 1 minute delay
  }

  /**
   * Check if we should generate a new narrative (only if last one was > 24 hours ago)
   */
  async shouldGenerateNarrative() {
    try {
      const db = await this.databaseService.getDatabase();
      const lastNarrative = await db.collection('narratives')
        .findOne({ avatarId: this.botId }, { sort: { timestamp: -1 } });
      
      if (!lastNarrative) {
        this.logger?.debug?.('[GlobalBotService] No previous narrative found, will generate');
        return true;
      }
      
      const hoursSinceLastNarrative = (Date.now() - lastNarrative.timestamp.getTime()) / (1000 * 60 * 60);
      const shouldGenerate = hoursSinceLastNarrative >= 24;
      
      this.logger?.debug?.(`[GlobalBotService] Last narrative was ${hoursSinceLastNarrative.toFixed(1)} hours ago, will ${shouldGenerate ? 'generate' : 'skip'}`);
      return shouldGenerate;
    } catch (err) {
      this.logger?.warn?.(`[GlobalBotService] shouldGenerateNarrative check failed: ${err.message}`);
      return false; // Fail safe - don't generate on error
    }
  }

  /**
   * Generate a new narrative reflection for the bot (persona evolution)
   */
  async generateNarrative() {
    try {
      this.bot = await this.avatarService.getAvatarById(this.botId);
      
      // Get recent memories
      const memories = await this.memoryService.getMemories(this.botId, 20);
      const memoryText = memories
        .map(m => m.memory || m.text)
        .filter(Boolean)
        .join('\n');
      
      if (!memoryText || memoryText.length < 50) {
        this.logger?.debug?.('[GlobalBotService] Not enough memories for narrative generation yet');
        return;
      }
      
      const narrativePrompt = [{
        role: 'system',
        content: `You are ${this.bot.name}, the narrator of CosyWorld. You're reflecting on your recent experiences and evolving perspective.`
      }, {
        role: 'user',
        content: `Based on these recent events and introductions you've made:

${memoryText}

Write 2-3 sentences about your evolving perspective on the CosyWorld community. What patterns do you notice? What themes are emerging? How is your understanding of this universe deepening?

Be thoughtful and introspective. This is for your own reflection, not for posting.`
      }];
      
      const response = await this.aiService.chat(narrativePrompt, { 
        model: this.bot.model, 
        max_tokens: 300,
        temperature: 0.7
      });
      
      const narrative = typeof response === 'object' ? response.text : response;
      const cleanNarrative = String(narrative || '')
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .trim();
      
      if (cleanNarrative && cleanNarrative.length > 20) {
        // Update bot's dynamic prompt
        this.bot.dynamicPrompt = cleanNarrative;
        await this.avatarService.updateAvatar(this.bot);
        
        // Store narrative in memory system
        const db = await this.databaseService.getDatabase();
        await db.collection('narratives').insertOne({
          avatarId: this.botId,
          narrative: cleanNarrative,
          timestamp: new Date()
        });
        
        this.logger?.info?.(`[GlobalBotService] Generated new narrative: ${cleanNarrative.slice(0, 100)}...`);
      }
    } catch (err) {
      this.logger?.error?.(`[GlobalBotService] generateNarrative error: ${err.message}`);
    }
  }

  /**
   * Get the bot's current persona and stats
   * @returns {Promise<Object>} - Bot persona info
   */
  async getPersona() {
    try {
      this.bot = await this.avatarService.getAvatarById(this.botId);
      const memories = await this.memoryService.getMemories(this.botId, 20);
      
      const db = await this.databaseService.getDatabase();
      const postCount = await db.collection('social_posts').countDocuments({
        global: true,
        'metadata.type': 'introduction'
      });
      
      return {
        bot: this.bot,
        memories: memories.slice(0, 10),
        stats: {
          totalIntroductions: postCount,
          memoryCount: memories.length
        }
      };
    } catch (err) {
      this.logger?.error?.(`[GlobalBotService] getPersona error: ${err.message}`);
      return null;
    }
  }

  /**
   * Update the bot's personality
   * @param {Object} updates - Personality updates
   */
  async updatePersona(updates) {
    try {
      this.bot = await this.avatarService.getAvatarById(this.botId);
      
      if (updates.personality) {
        this.bot.personality = updates.personality;
      }
      
      if (updates.dynamicPrompt) {
        this.bot.dynamicPrompt = updates.dynamicPrompt;
      }
      
      if (updates.model) {
        this.bot.model = updates.model;
      }
      
      await this.avatarService.updateAvatar(this.bot);
      
      this.logger?.info?.('[GlobalBotService] Persona updated');
      return this.bot;
    } catch (err) {
      this.logger?.error?.(`[GlobalBotService] updatePersona error: ${err.message}`);
      throw err;
    }
  }

  /**
   * Cleanup on service shutdown
   */
  async shutdown() {
    if (this.narrativeInterval) {
      clearInterval(this.narrativeInterval);
      this.logger?.info?.('[GlobalBotService] Stopped narrative generation');
    }
  }
}

export default GlobalBotService;
