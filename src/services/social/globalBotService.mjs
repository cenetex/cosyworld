/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Global Bot Service
 * Manages the CosyWorld global narrator bot as a first-class avatar
 * with personality, memory, and narrative evolution.
 * 
 * Memory System:
 * - The bot uses a 'remember' tool to autonomously decide what to remember
 * - Self-generated memories have higher weight (1.5) than automatic ones
 * - The bot is encouraged to remember significant introductions, locations, and events
 * - This creates more meaningful, contextual memories vs. automatic recording
 */

export class GlobalBotService {
  constructor({ 
    databaseService, 
    avatarService, 
    memoryService, 
    aiService,
    googleAIService,
    xService,
    logger = console 
  }) {
    this.databaseService = databaseService;
    this.avatarService = avatarService;
    this.memoryService = memoryService;
    this.aiService = aiService;
    this.googleAIService = googleAIService;
    this.xService = xService;
    this.logger = logger;
    this.botId = null;
    this.bot = null;
    this.narrativeInterval = null;
  }

  buildDefaultGlobalBotConfig(universeName) {
    const activeFromEnv = (process.env.GLOBAL_BOT_ACTIVE_PLATFORMS || 'x,telegram')
      .split(',')
      .map((p) => (typeof p === 'string' ? p.trim() : ''))
      .filter(Boolean);
    const uniqueActive = Array.from(new Set(activeFromEnv));

    return {
      universeName,
      maxIntrosPerDay: Number(process.env.GLOBAL_BOT_MAX_INTROS_PER_DAY || 20),
      preferredHashtags: [universeName],
      xPostStyle: "Use a warm, engaging narrator voice. Be concise but descriptive. No hashtags in the body, only at the end if needed. Avoid corporate speak.",
      systemPromptTemplate: `You are {{botName}} {{botEmoji}}, the narrator of {{universeName}}.\n\n{{personality}}\n\nYour current thoughts and perspective:\n{{dynamicPrompt}}\n\nRecent memories and activities:\n{{memories}}\n\nStyle Guide for X (Twitter):\n{{xPostStyle}}\n\nYou have the ability to remember important moments using the 'remember' tool. Use it when you want to recall significant introductions, events, or interesting happenings. Your memories shape your perspective and help you tell better stories.`,
      avatarIntroPromptTemplate: `A new soul has arrived in {{universeName}}: {{avatarEmoji}} {{avatarName}}\n\nDescription: {{description}}\n\nCreate a welcoming introduction tweet (max 240 chars) that:\n1. Captures their essence and what makes them unique\n2. Welcomes them warmly to the community\n3. Reflects your narrator personality\n4. Makes people curious to learn more about them\n5. Use *bold* for the avatar name using Markdown formatting\n\nBe conversational and genuine. Format the avatar name in *bold*. No quotes or extra hashtags.\n\nIf this introduction feels significant, use the remember tool to store a memory of welcoming this new arrival.`,
      locationDiscoveryPromptTemplate: `A new location has been discovered in {{universeName}}: "{{locationName}}"\n\nDescription: {{locationDescription}}\n\nCreate an evocative announcement (max 240 chars) that:\n1. Highlights what makes this location unique and intriguing\n2. Invites adventurers to explore it\n3. Uses vivid, atmospheric language\n4. Reflects your narrator personality\n5. Use *bold* for the location name using Markdown formatting\n\nBe immersive and captivating. Format the location name in *bold*. No quotes or extra hashtags.\n\nConsider using the remember tool if this location discovery is particularly noteworthy.`,
      scenePromptTemplate: `A scene has been captured in {{universeName}}: {{who}}{{where}}\n\nScene description: {{sceneDescription}}\n\nCreate an engaging caption (max 240 chars) that:\n1. Describes the scene vividly\n2. Captures the mood and atmosphere\n3. Uses *bold* for names (avatar and location)\n4. Makes viewers curious about the moment\n5. Reflects your narrator personality\n\nBe atmospheric and engaging. Format names in *bold*. No quotes or extra hashtags.`,
      combatPromptTemplate: `{{combatType}} in {{universeName}}: {{combatants}}{{location}}\n\nScene: {{sceneDescription}}\n\nCreate an intense, dramatic caption (max 240 chars) that:\n1. Captures the energy and stakes of the combat\n2. Highlights the combatants (use *bold* for names)\n3. Creates excitement and tension\n4. References the location if provided (use *bold*)\n5. Reflects your narrator personality\n\nBe dramatic and engaging. Format names in *bold*. No quotes or extra hashtags.`,
      genericPromptTemplate: `Describe this moment in {{universeName}} in an engaging way (max 240 chars).\n\nContext: {{context}}\n\nMake it compelling and reflect your narrator voice. No quotes or extra hashtags.`,
      narrativeReflectionPromptTemplate: `Based on these recent events and introductions you've made:\n\n{{memories}}\n\nWrite 2-3 sentences about your evolving perspective on the {{universeName}} community. What patterns do you notice? What themes are emerging? How is your understanding of this universe deepening?\n\nBe thoughtful and introspective. This is for your own reflection, not for posting.`,
      platformNarrativeSummaryTemplate: `Platform presence overview:\n{{platformStatus}}`,
      activePlatforms: uniqueActive.length ? uniqueActive : ['x', 'telegram'],
      platformHandles: {
        x: process.env.GLOBAL_BOT_X_HANDLE || '',
        telegram: process.env.GLOBAL_BOT_TELEGRAM_HANDLE || '',
        discord: process.env.GLOBAL_BOT_DISCORD_HANDLE || ''
      },
      // Character consistency for image generation
      characterDesign: {
        enabled: false, // Set to true to use character in all image generations
        referenceImageUrl: '', // URL of the character reference image
        characterDescription: '', // Detailed description of the character (appearance, clothing, style)
        imagePromptPrefix: 'Show {{characterName}} ({{characterDescription}}) in this situation: ', // Prefix added to all image prompts
        characterName: universeName // Name to use when referring to the character in prompts
      }
    };
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
      
      const universeName = process.env.UNIVERSE_NAME || "CosyWorld";
      
      const botDoc = {
        name: universeName,
        emoji: "🌍",
        type: "global_narrator",
        personality: `I am the narrator of ${universeName}, a warm and welcoming guide who introduces new souls to our universe. I celebrate each arrival with genuine curiosity and help the community discover fascinating characters. I have a friendly, slightly whimsical tone and enjoy highlighting what makes each being unique.`,
        dynamicPrompt: `I've been welcoming many interesting souls to our realm. Each one brings their own story and energy to ${universeName}.`,
        model: process.env.GLOBAL_BOT_MODEL || "anthropic/claude-sonnet-4.5",
        status: "immortal",
        content: `I am the narrator of ${universeName}, here to welcome every new arrival and share their stories with the community.`,
        createdAt: new Date(),
        updatedAt: new Date(),
        globalBotConfig: this.buildDefaultGlobalBotConfig(universeName)
      };
      
      const result = await db.collection('avatars').insertOne(botDoc);
      bot = { ...botDoc, _id: result.insertedId };
      
      // Create initial memory
      await this.memoryService.write({
        avatarId: result.insertedId,
        kind: 'system',
        text: `I am ${universeName}, the narrator of this universe. My purpose is to welcome new arrivals and share their stories with the community.`,
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
      
      // Get universe name from config or default
      const universeName = this.bot.globalBotConfig?.universeName || process.env.UNIVERSE_NAME || "CosyWorld";
      
      // Helper to replace template variables
      const fillTemplate = (template, vars) => {
        let result = template;
        for (const [key, value] of Object.entries(vars)) {
          result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '');
        }
        return result;
      };
      
      // Get system prompt template from config
      const systemPromptTemplate = this.bot.globalBotConfig?.systemPromptTemplate || 
        `You are {{botName}} {{botEmoji}}, the narrator of {{universeName}}.\n\n{{personality}}\n\nYour current thoughts and perspective:\n{{dynamicPrompt}}\n\nRecent memories and activities:\n{{memories}}\n\nStyle Guide for X (Twitter):\n{{xPostStyle}}\n\nYou have the ability to remember important moments using the 'remember' tool. Use it when you want to recall significant introductions, events, or interesting happenings. Your memories shape your perspective and help you tell better stories.`;
      
      const systemPrompt = fillTemplate(systemPromptTemplate, {
        botName: this.bot.name,
        botEmoji: this.bot.emoji || '',
        universeName: universeName,
        personality: this.bot.personality,
        dynamicPrompt: this.bot.dynamicPrompt || '',
        memories: memoryText || 'Just starting my journey as narrator.',
        xPostStyle: this.bot.globalBotConfig?.xPostStyle || 'Use a warm, engaging narrator voice. Be concise.'
      });

      let userPrompt;
      
      if (mediaPayload.source === 'avatar.create' && mediaPayload.avatarName) {
        // Avatar introduction
        const template = this.bot.globalBotConfig?.avatarIntroPromptTemplate ||
          `A new soul has arrived in {{universeName}}: {{avatarEmoji}} {{avatarName}}\n\nDescription: {{description}}\n\nCreate a welcoming introduction tweet (max 240 chars) that:\n1. Captures their essence and what makes them unique\n2. Welcomes them warmly to the community\n3. Reflects your narrator personality\n4. Makes people curious to learn more about them\n5. Use *bold* for the avatar name using Markdown formatting\n\nBe conversational and genuine. Format the avatar name in *bold*. No quotes or extra hashtags.\n\nIf this introduction feels significant, use the remember tool to store a memory of welcoming this new arrival.`;
        
        userPrompt = fillTemplate(template, {
          universeName: universeName,
          avatarEmoji: mediaPayload.avatarEmoji || '',
          avatarName: mediaPayload.avatarName,
          description: mediaPayload.prompt || 'A mysterious new arrival'
        });
      } else if (mediaPayload.source === 'location.create' && mediaPayload.locationName) {
        // New location discovery
        const template = this.bot.globalBotConfig?.locationDiscoveryPromptTemplate ||
          `A new location has been discovered in {{universeName}}: "{{locationName}}"\n\nDescription: {{locationDescription}}\n\nCreate an evocative announcement (max 240 chars) that:\n1. Highlights what makes this location unique and intriguing\n2. Invites adventurers to explore it\n3. Uses vivid, atmospheric language\n4. Reflects your narrator personality\n5. Use *bold* for the location name using Markdown formatting\n\nBe immersive and captivating. Format the location name in *bold*. No quotes or extra hashtags.\n\nConsider using the remember tool if this location discovery is particularly noteworthy.`;
        
        userPrompt = fillTemplate(template, {
          universeName: universeName,
          locationName: mediaPayload.locationName,
          locationDescription: mediaPayload.locationDescription || 'A mysterious new place'
        });
      } else if (mediaPayload.source === 'scene.camera' && (mediaPayload.avatarName || mediaPayload.locationName)) {
        // Scene camera photo
        const who = mediaPayload.avatarName ? `${mediaPayload.avatarEmoji || ''} *${mediaPayload.avatarName}*` : 'An adventurer';
        const where = mediaPayload.locationName ? ` at *${mediaPayload.locationName}*` : '';
        
        const template = this.bot.globalBotConfig?.scenePromptTemplate ||
          `A scene has been captured in {{universeName}}: {{who}}{{where}}\n\nScene description: {{sceneDescription}}\n\nCreate an engaging caption (max 240 chars) that:\n1. Describes the scene vividly\n2. Captures the mood and atmosphere\n3. Uses *bold* for names (avatar and location)\n4. Makes viewers curious about the moment\n5. Reflects your narrator personality\n\nBe atmospheric and engaging. Format names in *bold*. No quotes or extra hashtags.`;
        
        userPrompt = fillTemplate(template, {
          universeName: universeName,
          who: who,
          where: where,
          sceneDescription: mediaPayload.context || mediaPayload.prompt || 'A cinematic moment'
        });
      } else if (mediaPayload.source && mediaPayload.source.startsWith('combat.')) {
        // Combat/battle images
        const combatType = mediaPayload.source === 'combat.poster' ? 'Pre-battle standoff' 
                         : mediaPayload.source === 'combat.summary' ? 'Battle concluded' 
                         : 'Combat action';
        const combatants = mediaPayload.avatarName || 'Warriors clash';
        const location = mediaPayload.locationName ? ` at *${mediaPayload.locationName}*` : '';
        
        const template = this.bot.globalBotConfig?.combatPromptTemplate ||
          `{{combatType}} in {{universeName}}: {{combatants}}{{location}}\n\nScene: {{sceneDescription}}\n\nCreate an intense, dramatic caption (max 240 chars) that:\n1. Captures the energy and stakes of the combat\n2. Highlights the combatants (use *bold* for names)\n3. Creates excitement and tension\n4. References the location if provided (use *bold*)\n5. Reflects your narrator personality\n\nBe dramatic and engaging. Format names in *bold*. No quotes or extra hashtags.`;
        
        userPrompt = fillTemplate(template, {
          combatType: combatType,
          universeName: universeName,
          combatants: combatants,
          location: location,
          sceneDescription: mediaPayload.context || mediaPayload.prompt || 'Epic battle moment'
        });
      } else {
        // General media post
        const template = this.bot.globalBotConfig?.genericPromptTemplate ||
          `Describe this moment in {{universeName}} in an engaging way (max 240 chars).\n\nContext: {{context}}\n\nMake it compelling and reflect your narrator voice. No quotes or extra hashtags.`;
        
        userPrompt = fillTemplate(template, {
          universeName: universeName,
          context: mediaPayload.context || mediaPayload.prompt || 'An interesting moment in our universe'
        });
      }

      // Define the remember tool for the bot to use
      const tools = [
        {
          type: 'function',
          function: {
            name: 'remember',
            description: 'Record an important memory about your activities, posts, or interactions. Use this to remember significant moments, introductions, or events worth keeping in your memory.',
            parameters: {
              type: 'object',
              properties: {
                memory: {
                  type: 'string',
                  description: 'A concise memory to store (under 280 chars). Should capture the essence of what happened.'
                }
              },
              required: ['memory']
            }
          }
        }
      ];

      const response = await this.aiService.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], { 
        model: this.bot.model, 
        temperature: 0.8,
        tools: tools,
        tool_choice: 'auto'
      });

      // Handle tool calls if the bot wants to remember something
      const responseObj = typeof response === 'object' ? response : { text: response };
      
      if (responseObj.tool_calls && responseObj.tool_calls.length > 0) {
        for (const toolCall of responseObj.tool_calls) {
          if (toolCall.function?.name === 'remember') {
            try {
              const args = typeof toolCall.function.arguments === 'string' 
                ? JSON.parse(toolCall.function.arguments)
                : toolCall.function.arguments;
              
              if (args.memory) {
                await this.memoryService.write({
                  avatarId: this.botId,
                  kind: 'self_memory',
                  text: args.memory,
                  weight: 1.5 // Self-generated memories get higher weight
                });
                this.logger?.info?.(`[GlobalBotService] Bot created memory: ${args.memory}`);
              }
            } catch (err) {
              this.logger?.warn?.(`[GlobalBotService] Failed to process remember tool call: ${err.message}`);
            }
          }
        }
      }

      const text = typeof responseObj.text === 'string' ? responseObj.text : (typeof response === 'string' ? response : responseObj.text);
      
      // Clean up response
      return String(text || '')
        .replace(/<think>[\s\S]*?<\/think>/g, '') // Remove any thinking tags
        .replace(/[#\n\r]+/g, ' ') // Remove hashtags and newlines
        .trim();
      
    } catch (err) {
      this.logger?.error?.(`[GlobalBotService] generateContextualPost failed: ${err.message}`);
      
      // Get universe name for fallback
      const universeName = this.bot?.globalBotConfig?.universeName || process.env.UNIVERSE_NAME || "CosyWorld";
      
      // Fallback to simple text
      if (mediaPayload.source === 'avatar.create' && mediaPayload.avatarName) {
        return `${mediaPayload.avatarEmoji || '✨'} Meet *${mediaPayload.avatarName}* — ${mediaPayload.prompt || `a new arrival in ${universeName}`}`;
      }
      
      if (mediaPayload.source === 'location.create' && mediaPayload.locationName) {
        return `📍 New location discovered: *${mediaPayload.locationName}*. ${mediaPayload.locationDescription || 'A place of mystery and wonder.'}`;
      }
      
      if (mediaPayload.source === 'scene.camera') {
        const who = mediaPayload.avatarName ? `${mediaPayload.avatarEmoji || ''} *${mediaPayload.avatarName}*` : 'An adventurer';
        const where = mediaPayload.locationName ? ` at *${mediaPayload.locationName}*` : '';
        return `📸 ${who}${where} — ${mediaPayload.context || `A cinematic moment in ${universeName}`}`;
      }
      
      if (mediaPayload.source && mediaPayload.source.startsWith('combat.')) {
        const emoji = mediaPayload.source === 'combat.poster' ? '⚔️' : '🏆';
        const where = mediaPayload.locationName ? ` at *${mediaPayload.locationName}*` : '';
        return `${emoji} ${mediaPayload.avatarName || 'Battle'}${where} — ${mediaPayload.context || `Epic combat in ${universeName}`}`;
      }
      
      return mediaPayload.context || mediaPayload.prompt || `A moment in ${universeName}`;
    }
  }

  /**
   * Record a post in the bot's memory
   * @deprecated Use the 'remember' tool instead - let the bot decide what to remember
   * @param {string} _tweetId - Tweet ID
   * @param {Object} _mediaPayload - Original media payload
   * @param {string} _content - Generated post content
   */
  async recordPost(_tweetId, _mediaPayload, _content) {
    // Deprecated: The bot now uses the remember tool to decide what to remember
    // Keeping this method for backward compatibility but it does nothing
    this.logger?.debug?.(`[GlobalBotService] recordPost called (deprecated) - bot should use remember tool instead`);
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
      
      const personaSummary = this.bot?.personality ? this.bot.personality.trim() : null;
      const currentPerspective = this.bot?.dynamicPrompt ? this.bot.dynamicPrompt.trim() : null;
      const universeName = this.bot.globalBotConfig?.universeName || process.env.UNIVERSE_NAME || "CosyWorld";
      const platformStats = await this.getPlatformStats();
      const platformSummaryTemplate = this.bot.globalBotConfig?.platformNarrativeSummaryTemplate
        || 'Platform presence overview:\n{{platformStatus}}';
      const platformStatusText = platformSummaryTemplate.replace(
        /\{\{platformStatus\}\}/g,
        platformStats.summaryText || 'No platform activity recorded yet.'
      );

      const narrativePrompt = [{
        role: 'system',
        content: `You are ${this.bot.name}${this.bot.emoji ? ` ${this.bot.emoji}` : ''}, the narrator of ${universeName}.

Core personality:
${personaSummary || `A curious narrator who delights in describing the evolving tapestry of ${universeName}.`}

Your current guiding perspective:
${currentPerspective || `You are always searching for patterns and meaning among the arrivals and happenings in ${universeName}.`}

${platformStatusText}

Reflect on your recent experiences in that voice.`
      }, {
        role: 'user',
        content: this.bot.globalBotConfig?.narrativeReflectionPromptTemplate 
          ? this.bot.globalBotConfig.narrativeReflectionPromptTemplate
              .replace(/\{\{memories\}\}/g, memoryText)
              .replace(/\{\{universeName\}\}/g, universeName)
          : `Based on these recent events and introductions you've made:

${memoryText}

Write 2-3 sentences about your evolving perspective on the ${universeName} community. What patterns do you notice? What themes are emerging? How is your understanding of this universe deepening?

Be thoughtful and introspective. This is for your own reflection, not for posting.`
      }];
      
        const response = await this.aiService.chat(narrativePrompt, { model: this.bot.model, temperature: 0.7 });
      
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

  async getPlatformStats() {
    try {
      const db = await this.databaseService.getDatabase();
      const posts = db.collection('social_posts');
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const platformKeyExpression = {
        $cond: [
          {
            $and: [
              { $ne: ['$platform', null] },
              { $ne: ['$platform', ''] }
            ]
          },
          { $toLower: '$platform' },
          {
            $switch: {
              branches: [
                { case: { $ifNull: ['$metadata.platform', false] }, then: { $toLower: '$metadata.platform' } },
                { case: { $ifNull: ['$tweetId', false] }, then: 'x' },
                { case: { $ifNull: ['$messageId', false] }, then: 'telegram' },
                { case: { $ifNull: ['$channelId', false] }, then: 'telegram' }
              ],
              default: 'unknown'
            }
          }
        ]
      };

      const [totalRows, recentRows, latestRows] = await Promise.all([
        posts.aggregate([
          { $match: { global: true } },
          { $addFields: { platformKey: platformKeyExpression } },
          {
            $group: {
              _id: '$platformKey',
              totalPosts: { $sum: 1 },
              lastPostAt: { $max: '$createdAt' }
            }
          }
        ]).toArray(),
        posts.aggregate([
          { $match: { global: true, createdAt: { $gte: sevenDaysAgo } } },
          { $addFields: { platformKey: platformKeyExpression } },
          {
            $group: {
              _id: '$platformKey',
              countLast7d: { $sum: 1 }
            }
          }
        ]).toArray(),
        posts.aggregate([
          { $match: { global: true } },
          { $addFields: { platformKey: platformKeyExpression } },
          { $sort: { createdAt: -1 } },
          {
            $group: {
              _id: '$platformKey',
              latest: { $first: '$$ROOT' }
            }
          }
        ]).toArray()
      ]);

      const details = {};

      for (const row of totalRows) {
        const key = row?._id || 'unknown';
        if (!details[key]) {
          details[key] = {};
        }
        details[key].totalPosts = row.totalPosts || 0;
        details[key].lastPostedAt = row.lastPostAt || null;
      }

      for (const row of recentRows) {
        const key = row?._id || 'unknown';
        if (!details[key]) {
          details[key] = {};
        }
        details[key].recentPosts7d = row.countLast7d || 0;
      }

      for (const row of latestRows) {
        const key = row?._id || 'unknown';
        if (!details[key]) {
          details[key] = {};
        }
        const latestDoc = row.latest || {};
        details[key].lastPostedAt = latestDoc.createdAt || latestDoc.timestamp || details[key].lastPostedAt || null;
        details[key].lastContent = latestDoc.content || null;
        details[key].metadata = latestDoc.metadata || null;
        details[key].tweetId = latestDoc.tweetId || null;
        details[key].messageId = latestDoc.messageId || null;
        details[key].channelId = latestDoc.channelId || null;
      }

      const config = this.bot?.globalBotConfig || {};
      const summaryText = this.buildPlatformStatusText(details, config);

      return {
        summaryText,
        active: Array.isArray(config.activePlatforms) ? config.activePlatforms : [],
        handles: config.platformHandles || {},
        details
      };
    } catch (err) {
      this.logger?.warn?.(`[GlobalBotService] getPlatformStats error: ${err.message}`);
      return {
        summaryText: 'No platform activity recorded yet.',
        active: Array.isArray(this.bot?.globalBotConfig?.activePlatforms) ? this.bot.globalBotConfig.activePlatforms : [],
        handles: this.bot?.globalBotConfig?.platformHandles || {},
        details: {}
      };
    }
  }

  buildPlatformStatusText(details = {}, config = {}) {
    const active = new Set(Array.isArray(config.activePlatforms) ? config.activePlatforms : []);
    const handles = config.platformHandles || {};
    const knownOrder = ['x', 'telegram', 'discord'];
    const keys = Array.from(new Set([...knownOrder, ...Object.keys(details), ...active]));
    const lines = [];

    for (const key of keys) {
      if (!key) continue;
      const info = details[key] || {};
      const label = this.getPlatformLabel(key);
      const segments = [];

      segments.push(active.has(key) ? 'active' : 'inactive');

      const handleRaw = handles[key];
      if (handleRaw) {
        segments.push(this.normalizeHandle(key, handleRaw));
      }

      if (typeof info.totalPosts === 'number') {
        segments.push(`${info.totalPosts} total posts`);
      }

      if (typeof info.recentPosts7d === 'number' && info.recentPosts7d > 0) {
        segments.push(`${info.recentPosts7d} in last 7d`);
      }

      if (info.lastPostedAt) {
        segments.push(`last ${this.formatRelativeTime(info.lastPostedAt)}`);
      }

      if (!segments.length) {
        segments.push('no recent activity');
      }

      lines.push(`${label}: ${segments.join(' • ')}`);
    }

    if (!lines.length) {
      return 'No platform presence configured.';
    }

    return lines.join('\n');
  }

  getPlatformLabel(key) {
    switch (key) {
      case 'x':
        return 'X (Twitter)';
      case 'telegram':
        return 'Telegram';
      case 'discord':
        return 'Discord';
      case 'unknown':
        return 'Unknown Platform';
      default:
        return key.charAt(0).toUpperCase() + key.slice(1);
    }
  }

  normalizeHandle(key, value) {
    if (!value) return '';
    const trimmed = String(value).trim();
    if (!trimmed) return '';
    if (key === 'x') {
      return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
    }
    return trimmed;
  }

  formatRelativeTime(input) {
    if (!input) return '';
    const date = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(date.getTime())) return '';
    const diffMs = Date.now() - date.getTime();
    const absMs = Math.abs(diffMs);

    const units = [
      { label: 'day', ms: 24 * 60 * 60 * 1000 },
      { label: 'hour', ms: 60 * 60 * 1000 },
      { label: 'minute', ms: 60 * 1000 },
      { label: 'second', ms: 1000 }
    ];

    for (const unit of units) {
      if (absMs >= unit.ms) {
        const value = Math.round(absMs / unit.ms);
        return value === 1 ? `${value} ${unit.label} ago` : `${value} ${unit.label}s ago`;
      }
    }

    return 'just now';
  }

  /**
   * Get the bot's current persona and stats
   * @returns {Promise<Object>} - Bot persona info
   */
  async getPersona() {
    try {
      this.bot = await this.avatarService.getAvatarById(this.botId);
      const universeName = this.bot?.globalBotConfig?.universeName || process.env.UNIVERSE_NAME || "CosyWorld";
      const defaultConfig = this.buildDefaultGlobalBotConfig(universeName);
      const existingConfig = this.bot?.globalBotConfig || {};
      const mergedHandles = {
        ...defaultConfig.platformHandles,
        ...(existingConfig.platformHandles || {})
      };
      const existingActive = Array.isArray(existingConfig.activePlatforms) ? existingConfig.activePlatforms : [];
      const normalizedActive = existingActive
        .map((platform) => (typeof platform === 'string' ? platform.trim() : ''))
        .filter(Boolean);
      const mergedActive = normalizedActive.length
        ? Array.from(new Set(normalizedActive))
        : defaultConfig.activePlatforms;
      this.bot.globalBotConfig = {
        ...defaultConfig,
        ...existingConfig,
        platformHandles: mergedHandles,
        activePlatforms: mergedActive
      };
      const rawMemories = await this.memoryService.getRecentMemoriesRaw(this.botId, 20);
      const memoryCount = await this.memoryService.countMemories(this.botId);
      const memories = rawMemories.map((mem) => ({
        id: mem._id?.toString?.()
          || mem.id
          || mem._id
          || null,
        memory: mem.memory || mem.text || '',
        text: mem.text || mem.memory || '',
        kind: mem.kind || null,
        timestamp: mem.timestamp instanceof Date ? mem.timestamp.toISOString() : mem.timestamp,
        weight: mem.weight ?? null
      }));
      
      const db = await this.databaseService.getDatabase();
      const postCount = await db.collection('social_posts').countDocuments({
        global: true,
        'metadata.type': 'introduction'
      });

      const platformStats = await this.getPlatformStats();
      
      return {
        bot: this.bot,
        memories,
        stats: {
          totalIntroductions: postCount,
          memoryCount,
          platforms: platformStats
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
      
      if (typeof updates.name === 'string' && updates.name.trim()) {
        this.bot.name = updates.name.trim();
      }

      if (typeof updates.emoji === 'string') {
        const trimmedEmoji = updates.emoji.trim();
        if (trimmedEmoji) {
          this.bot.emoji = trimmedEmoji;
        }
      }

      if (updates.personality) {
        this.bot.personality = updates.personality;
      }
      
      if (updates.dynamicPrompt) {
        this.bot.dynamicPrompt = updates.dynamicPrompt;
      }
      
      if (updates.model) {
        this.bot.model = updates.model;
      }

      if (updates.globalBotConfig && typeof updates.globalBotConfig === 'object') {
        const existingConfig = this.bot.globalBotConfig || {};
        const incomingConfig = { ...updates.globalBotConfig };

        if (typeof incomingConfig.universeName === 'string') {
          incomingConfig.universeName = incomingConfig.universeName.trim();
        }

        const universeName = incomingConfig.universeName
          || existingConfig.universeName
          || process.env.UNIVERSE_NAME
          || 'CosyWorld';

        const defaultConfig = this.buildDefaultGlobalBotConfig(universeName);

        const mergedHandlesRaw = {
          ...defaultConfig.platformHandles,
          ...(existingConfig.platformHandles || {}),
          ...(incomingConfig.platformHandles || {})
        };
        const platformHandles = Object.fromEntries(
          Object.entries(mergedHandlesRaw).map(([key, value]) => [
            key,
            typeof value === 'string' ? value.trim() : (value || '')
          ])
        );

        const activeFromIncoming = Array.isArray(incomingConfig.activePlatforms)
          ? incomingConfig.activePlatforms
          : [];
        const activeFromExisting = Array.isArray(existingConfig.activePlatforms)
          ? existingConfig.activePlatforms
          : [];
        const activeCandidates = activeFromIncoming.length ? activeFromIncoming : activeFromExisting;
        const activePlatforms = Array.from(new Set(
          activeCandidates
            .map((platform) => (typeof platform === 'string' ? platform.trim() : ''))
            .filter(Boolean)
        ));

        this.bot.globalBotConfig = {
          ...defaultConfig,
          ...existingConfig,
          ...incomingConfig,
          universeName,
          platformHandles,
          activePlatforms: activePlatforms.length ? activePlatforms : defaultConfig.activePlatforms
        };
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

  /**
   * Generate an image using the global bot's character design settings
   * @param {string} prompt - The base prompt
   * @param {Object} options - Generation options
   * @returns {Promise<string>} - Generated image URL
   */
  async generateImage(prompt, options = {}) {
    try {
      // Ensure bot is loaded
      if (!this.bot) {
        this.botId = await this.getOrCreateGlobalBot();
        this.bot = await this.avatarService.getAvatarById(this.botId);
      }

      // Use provided character design or fall back to bot config
      const config = this.bot.globalBotConfig || {};
      const charDesign = options.characterDesign || config.characterDesign || {};
      
      let enhancedPrompt = prompt;
      const referenceImages = [];

      // 0. Apply Director Mode (LLM Scene Composition) if requested
      if (options.enhanceWithDirector) {
        enhancedPrompt = await this.composeSceneDescription(prompt, {
          avatars: options.avatars || [],
          location: options.location || null,
          additionalContext: options.context || ''
        });
        this.logger?.info?.('[GlobalBotService] Enhanced prompt with Director Mode:', { original: prompt, enhanced: enhancedPrompt });
      }

      // Apply character design if enabled
      if (charDesign.enabled) {
        // 1. Apply prompt prefix
        let characterPrefix = charDesign.imagePromptPrefix || 'Show {{characterName}} ({{characterDescription}}) in this situation: ';
        characterPrefix = characterPrefix
          .replace(/\{\{characterName\}\}/g, charDesign.characterName || config.universeName || '')
          .replace(/\{\{characterDescription\}\}/g, charDesign.characterDescription || '');
        
        enhancedPrompt = characterPrefix + prompt;
        
        // 2. Add reference image if available
        if (charDesign.referenceImageUrl) {
          referenceImages.push(charDesign.referenceImageUrl);
        }
        
        this.logger?.info?.('[GlobalBotService] Applied character design to image generation', {
          originalPrompt: prompt,
          enhancedPrompt,
          hasReferenceImage: !!charDesign.referenceImageUrl
        });
      }

      // Call AI service
      // Prefer Google AI (Gemini 3 Pro) for global bot images if available
      if (this.googleAIService?.generateImage) {
        return await this.googleAIService.generateImage(enhancedPrompt, '1:1', {
          ...options,
          source: 'global_bot',
          context: enhancedPrompt
        });
      }

      // Fallback to aiService (usually OpenRouter/Replicate)
      if (this.aiService?.generateImage) {
        return await this.aiService.generateImage(enhancedPrompt, referenceImages, {
          ...options,
          source: 'global_bot',
          context: enhancedPrompt
        });
      }
      
      throw new Error('No image generation service available');
    } catch (err) {
      this.logger?.error?.(`[GlobalBotService] generateImage error: ${err.message}`);
      throw err;
    }
  }

  /**
   * Compose a cinematic scene description using an LLM (Director Mode)
   * @param {string} userPrompt - The user's request or base prompt
   * @param {Object} context - Context for the scene
   * @param {Array} context.avatars - List of avatars present
   * @param {Object} context.location - Location details
   * @returns {Promise<string>} - Enhanced scene description
   */
  async composeSceneDescription(userPrompt, context = {}) {
    try {
      const avatars = context.avatars || [];
      const location = context.location || null;
      const additionalContext = context.additionalContext || '';
      
      const avatarDetails = avatars.map(a => `- ${a.name} (${a.emoji}): ${a.description || 'No description'}`).join('\n');
      const locationDetails = location ? `${location.name}: ${location.description || ''}` : 'Unknown Location';
      
      const scenePrompt = `
You are a cinematic director. Compose a visual scene description for an image generator.
Context:
Location: ${locationDetails}
Characters present:
${avatarDetails}
${additionalContext ? `Additional Context:\n${additionalContext}` : ''}

User Request: "${userPrompt || 'A candid moment'}"

Instructions:
- Describe the scene visually.
- Position the characters naturally within the location.
- Describe their actions or interactions based on their personalities.
- Keep it under 100 words.
- Focus on lighting, mood, and composition.
- Do not include "Here is a description" or similar meta-text. Just the description.
`.trim();

      let response;
      // Prefer Google AI for text generation if available (fast & capable)
      if (this.googleAIService) {
           response = await this.googleAIService.chat([
              { role: 'user', content: scenePrompt }
          ], { model: 'gemini-2.0-flash-lite-preview-02-05', temperature: 0.7 });
      } else if (this.aiService) {
           response = await this.aiService.chat([
              { role: 'user', content: scenePrompt }
          ], { model: 'google/gemini-2.0-flash-lite-preview-02-05', temperature: 0.7 });
      }
      
      return typeof response === 'string' ? response : response?.text || userPrompt;
    } catch (e) {
      this.logger?.warn?.(`[GlobalBotService] Scene composition failed: ${e.message}`);
      return userPrompt;
    }
  }
}

export default GlobalBotService;
