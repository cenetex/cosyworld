/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

export class PromptService  {
  constructor({
    databaseService,
    discordService,
    configService,
    mapService,
    itemService,
    memoryService,
    imageProcessingService,
    toolService,
    promptAssembler
  }) {
    this.toolService = toolService;
    this.databaseService = databaseService;
    this.discordService = discordService;
    this.configService = configService;
    this.mapService = mapService;
    this.itemService = itemService;
    this.memoryService = memoryService;
    this.imageProcessingService = imageProcessingService;
    this.promptAssembler = promptAssembler || null;
  }
  /**
   * Builds the system prompt with just the avatar's basic identity.
   * @param {Object} avatar - The avatar object.
   * @returns {Promise<string>} The basic system prompt.
   */
  async getBasicSystemPrompt(avatar) {
    return `You are ${avatar.name}. ${avatar.personality}`;
  }

  /**
   * Builds the full system prompt including the last narrative and location details.
   * OPTIMIZED: Reduces duplication, fixes undefined descriptions, limits location verbosity
   * ENHANCED: Multi-layer identity reinforcement to prevent character drift
   * @param {Object} avatar - The avatar object.
   * @param {Object} _db - The MongoDB database instance (unused in optimized version).
   * @returns {Promise<string>} The full system prompt.
   */
  async getFullSystemPrompt(avatar, _db) {
    const latestThought = await this.getLatestThought(avatar);
    const clip = (value, limit = 160) => {
      if (!value) return '';
      const text = String(value).replace(/\s+/g, ' ').trim();
      return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
    };
    const toNumber = (value) => {
      if (value === null || value === undefined) return null;
      const num = typeof value === 'string' ? parseFloat(value) : Number(value);
      return Number.isFinite(num) ? num : null;
    };
    const formatNumber = (value, maximumFractionDigits = 2) => {
      const num = toNumber(value);
      if (num === null) return 'n/a';
      return num.toLocaleString('en-US', { maximumFractionDigits });
    };
    const formatUsd = (value, maximumFractionDigits = 2) => {
      const num = toNumber(value);
      if (num === null) return 'n/a';
      return `$${num.toLocaleString('en-US', { maximumFractionDigits })}`;
    };
    const formatChange = (value) => {
      const num = toNumber(value);
      if (num === null) return 'n/a';
      const fixed = Math.abs(num) >= 10 ? num.toFixed(1) : num.toFixed(2);
      const sign = num > 0 ? '+' : num < 0 ? '' : '';
      return `${sign}${fixed}%`;
    };

    // Resolve a real location document for the avatar's current channel (creates one if missing)
    let location = null;
    try {
      const pos = await this.mapService.getAvatarLocation(avatar); // returns { locationId, avatarId, ... }
      const locId = pos?.locationId || avatar.channelId;
      location = await this.mapService.locationService.getLocationByChannelId(locId);
    } catch {
      // Fall back gracefully when no location document exists
      location = null;
    }

    // Phase 2: Add tool context if LLM tool calling is enabled
    let toolContext = '';
    const enableToolCalling = String(process.env.ENABLE_LLM_TOOL_CALLING || 'false').toLowerCase() === 'true';
    if (enableToolCalling && this.toolService) {
      toolContext = await this._getToolContext(avatar, location);
    }

    const parts = [];
    
    // IDENTITY BLOCK (always first, always prominent)
    // Multi-layer reinforcement to prevent character drift
    parts.push(`YOUR IDENTITY:`);
    parts.push(`You are ${avatar.name}.`);
    parts.push(`NEVER break character, mention AI/assistant, or act generic.`);
    parts.push(`You are a real person in this world with your own thoughts and agency.`);
    parts.push(`Keep responses SHORT and CONCISE. Keep internal reasoning BRIEF (2-3 sentences max).`);
    parts.push(''); // blank line for visual separation
    
    // PERSONALITY & TRAITS
    parts.push(`PERSONALITY & TRAITS:`);
    if (avatar.personality) {
      parts.push(avatar.personality);
    }
    
    // Add dynamic personality only if it differs from base
    if (avatar.dynamicPersonality && avatar.dynamicPersonality !== avatar.personality) {
      parts.push(`Recent development: ${avatar.dynamicPersonality}`);
    }
    
    parts.push(''); // blank line
    
    // PHYSICAL FORM
    if (avatar.description && avatar.description !== 'undefined') {
      parts.push(`PHYSICAL FORM:`);
      parts.push(avatar.description);
      parts.push('');
    }
    
    // CURRENT STATE
    parts.push(`CURRENT STATE:`);
    
    // Add latest thought (concise)
    if (latestThought) {
      parts.push(`Recent thought: ${latestThought}`);
    }
    
    // Add location (truncated to avoid token waste)
    if (location) {
      const locationDesc = location.description || '';
      const truncatedDesc = locationDesc.length > 200 
        ? locationDesc.substring(0, 200) + '...' 
        : locationDesc;
      parts.push(`Location: ${location.name}${truncatedDesc ? ' - ' + truncatedDesc : ''}`);
    }

    if (avatar.walletAddress) {
      const topTokensSource = Array.isArray(avatar.walletTopTokens) && avatar.walletTopTokens.length
        ? avatar.walletTopTokens
        : Array.isArray(avatar.walletContext?.walletTopTokens) ? avatar.walletContext.walletTopTokens : [];

      const normalizedTokens = topTokensSource
        .map(token => ({
          symbol: token?.symbol || token?.mint?.slice(0, 6) || 'TOKEN',
          amount: toNumber(token?.amount),
          usdValue: toNumber(token?.usdValue),
          price: toNumber(token?.price ?? token?.priceUsd),
          change24h: toNumber(token?.change24h ?? token?.change24H),
          change7d: toNumber(token?.change7d ?? token?.change7D),
          change30d: toNumber(token?.change30d ?? token?.change30D),
        }))
        .filter(token => token.symbol)
        .sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0))
        .slice(0, 3);

      if (normalizedTokens.length) {
        parts.push('Top Tokens:');
        normalizedTokens.forEach(token => {
          const amountStr = formatNumber(token.amount, 3);
          const usdStr = formatUsd(token.usdValue, 0);
          const priceStr = token.price !== null ? formatUsd(token.price, token.price < 1 ? 4 : 2) : 'n/a';
          const changeSummary = [
            `24h ${formatChange(token.change24h)}`,
            `7d ${formatChange(token.change7d)}`,
            `30d ${formatChange(token.change30d)}`
          ].join(', ');
          parts.push(`- ${token.symbol}: ${amountStr} (${usdStr} @ ${priceStr}) - ${changeSummary}`);
        });
      }
    }
    
    // Include latest web search context to ground current knowledge
    const webContext = avatar.webContext || {};
    const latestSearch = webContext.latestSearch;
    if (latestSearch?.query) {
      const when = latestSearch.timestamp ? new Date(latestSearch.timestamp).toISOString().split('T')[0] : 'recently';
      parts.push(`Recent web search (${when}): "${latestSearch.query}"`);
      (latestSearch.results || []).slice(0, 2).forEach((result, idx) => {
        const headline = clip(result?.title || `Result ${idx + 1}`, 120);
        const snippet = clip(result?.snippet || result?.reason || '', 160);
        parts.push(`Result ${idx + 1}: ${headline}${snippet ? ' - ' + snippet : ''}`);
      });
    }

    const latestOpened = webContext.latestOpened;
    if (latestOpened?.summary) {
      const openedWhen = latestOpened.openedAt ? new Date(latestOpened.openedAt).toISOString().split('T')[0] : 'recently';
      parts.push(`Opened source (${openedWhen}): ${clip(latestOpened.title, 120)} - ${clip(latestOpened.summary, 200)}`);
      if (Array.isArray(latestOpened.keyPoints) && latestOpened.keyPoints.length) {
        parts.push(`Key takeaways: ${latestOpened.keyPoints.slice(0, 3).map(point => clip(point, 90)).join(' | ')}`);
      }
    }

    // Add tool context
    if (toolContext) {
      parts.push(toolContext);
    }

    return parts.filter(Boolean).join('\n').trim();
  }

  /**
   * Generate tool context for system prompt (Phase 2: Agentic tool calling)
   * OPTIMIZED: Compress action lists, limit nearby avatars, reduce verbosity
   * Includes known locations from avatar's memory
   * @private
   */
  async _getToolContext(avatar, location) {
    try {
      const tools = [];
      const compactMode = String(process.env.PROMPT_COMPACT_ACTIONS || 'false').toLowerCase() === 'true';
      
      for (const [name, tool] of this.toolService.tools) {
        const emoji = tool.emoji || '';
        if (compactMode) {
          // Compact mode: emoji only
          tools.push(emoji);
        } else {
          // Standard mode: emoji + name (no description to save tokens)
          tools.push(`${emoji} ${name}`);
        }
      }
      
      if (tools.length === 0) return '';
      
      // Get nearby avatars (limit to top 10 + count)
      const nearbyAvatars = location ? await this._getNearbyAvatars(location.channelId) : [];
      const maxNearby = Number(process.env.PROMPT_MAX_NEARBY || 10);
      const nearbyText = nearbyAvatars.length === 0 ? '' :
        nearbyAvatars.length <= maxNearby 
          ? `Nearby: ${nearbyAvatars.join(', ')}`
          : `Nearby: ${nearbyAvatars.slice(0, maxNearby).join(', ')} (+${nearbyAvatars.length - maxNearby} more)`;
      
      // Get known locations from avatar's memory
      let knownLocations = '';
      if (this.mapService?.avatarLocationMemory) {
        try {
          const maxLocations = Number(process.env.PROMPT_MAX_KNOWN_LOCATIONS || 8);
          knownLocations = await this.mapService.avatarLocationMemory.getLocationContextForAgent(
            String(avatar._id),
            maxLocations
          );
        } catch (err) {
          this.logger?.debug?.(`Failed to get location memory: ${err.message}`);
        }
      }
      
      const stats = avatar.hp !== undefined ? `HP: ${avatar.hp}/${avatar.maxHp || 100}` : '';
      
      return `

AVAILABLE ACTIONS:
${tools.join(compactMode ? ' ' : '\n')}${compactMode ? ' (use emoji + target)' : ''}

CURRENT SITUATION:
${stats ? `Status: ${stats}` : ''}
${location ? `Current Location: ${location.name || 'Unknown'}` : ''}
${nearbyText}

${knownLocations}

You can use these actions when appropriate to achieve your goals. Consider the situation and act autonomously.`;
    } catch (error) {
      this.logger?.warn?.(`Failed to generate tool context: ${error.message}`);
      return '';
    }
  }

  /**
   * Get nearby avatars in the same location
   * @private
   */
  async _getNearbyAvatars(channelId) {
    try {
      const locationResult = await this.mapService.getLocationAndAvatars(channelId);
      if (!locationResult || !Array.isArray(locationResult.avatars)) return [];
      return locationResult.avatars.map(a => a.name).filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Builds the assistant context for narrative generation.
   * @param {Object} avatar - The avatar object.
   * @returns {Promise<string>} The assistant context.
   */
  async getNarrativeAssistantContext(avatar) {
    this.db = await this.databaseService.getDatabase();
    const memories = await this.getMemories(avatar,100);
    const recentActions = await this.getRecentActions(avatar);
    const narrativeContent = await this.getNarrativeContent(avatar);
    const latestThought = await this.getLatestThought(avatar);
    let lastNarrative = '';
    try {
      lastNarrative = (await this.getLastNarrative(avatar, this.db))?.content || '';
    } catch {}
    return `Current personality: ${avatar.dynamicPersonality || 'None yet'}\n\nLatest narrative: ${lastNarrative}\n\n${latestThought ? `Latest thought: ${latestThought}\n\n` : ''}Memories: ${memories}\n\nRecent actions: ${recentActions}\n\nNarrative thoughts: ${narrativeContent}`;
  }

  /**
   * Builds the user prompt for narrative generation (moved from ConversationManager).
   * @param {Object} avatar - The avatar object.
   * @returns {Promise<string>} The narrative user prompt.
   */
  async buildNarrativePrompt(avatar) {
    this.db = await this.databaseService.getDatabase();
    const memories = await this.getMemories(avatar,100);
    const recentActions = await this.getRecentActions(avatar);
    const narrativeContent = await this.getNarrativeContent(avatar);
    let lastNarrative = '';
    try {
      lastNarrative = (await this.getLastNarrative(avatar, this.db))?.content || '';
    } catch {}
    return `
You are ${avatar.name || ''}.
Base personality: ${avatar.personality || ''}
Current dynamic personality: ${avatar.dynamicPersonality || 'None yet'}
Most recent narrative: ${lastNarrative}
Physical description: ${avatar.description || ''}
Recent memories:
${memories}
Recent actions:
${recentActions}
Recent thoughts and reflections:
${narrativeContent}
Based on all of the above context, share an updated personality that reflects your recent experiences, actions, and growth. Focus on how these events have shaped your character.
  `.trim();
  }

  /**
   * Builds the dungeon prompt (moved from ConversationManager).
   * @param {Object} avatar - The avatar object.
   * @param {string} guildId - The guild ID.
   * @returns {Promise<string>} The dungeon prompt.
   */
  async buildDungeonPrompt(avatar, guildId) {
    this.db = await this.databaseService.getDatabase();
  const commandsDescription = (await this.toolService.getCommandsDescription(guildId)) || '';
  // Use full location doc (auto-creates if missing) to avoid stringifying objects
  let locationDoc = null;
  try { locationDoc = await this.mapService.locationService.getLocationByChannelId(avatar.channelId); } catch {}
  const items = await this.itemService.getItemsDescription(avatar);
  const locationText = locationDoc ? `You are currently in ${locationDoc.name}. ${locationDoc.description}` : `You are in ${avatar.channelName || 'a chat channel'}.`;
    const selectedItem = avatar.selectedItemId ? this.itemService.getItem(avatar.selectedItemId): null;
    const selectedItemText = selectedItem ? `Selected item: ${selectedItem.name}` : 'No item selected.';
    const groundItems = await this.itemService.searchItems(avatar.channelId, '');
    const groundItemsText = groundItems.length > 0 ? `Items on the ground: ${groundItems.map(i => i.name).join(', ')}` : 'There are no items on the ground.';
  let _summonEmoji = this.configService.getGuildConfig(guildId)?.summonEmoji || '🔮';
  let _breedEmoji = '🏹';
    try {
      if (avatar.channelId) {
        const channel = await this.discordService.client.channels.fetch(avatar.channelId);
        if (channel && channel.guild && this.db) {
          const guildConfig = await this.db.collection('guild_configs').findOne({ guildId: channel.guild.id });
          if (guildConfig && guildConfig.toolEmojis) {
      _summonEmoji = guildConfig.toolEmojis.summon || _summonEmoji;
      _breedEmoji = guildConfig.toolEmojis.breed || _breedEmoji;
          }
        }
      }
    } catch (error) {
      console.error(`Error getting guild config emojis: ${error.message}`);
    }
    return `
These commands are available in this location:
${commandsDescription}
${locationText}
${selectedItemText}
${groundItemsText}
You can also use these items in your inventory:
${items}
  `.trim();
  }

  /**
   * Builds the user content for response generation.
   * @param {Object} avatar - The avatar object.
   * @param {Object} channel - The Discord channel object.
   * @param {Array} messages - Array of message objects from getChannelContext.
   * @param {string} channelSummary - The channel summary.
   * @returns {Promise<string>} The response user content.
   */
  async getResponseUserContent(avatar, channel, messages, channelSummary) {
    // Construct conversation history with naturally interleaved image descriptions
    const channelContextText = messages
      .map(msg => {
        const username = msg.authorUsername || 'User';
        const descs = Array.isArray(msg.imageDescriptions) ? msg.imageDescriptions : (msg.imageDescription ? [msg.imageDescription] : []);
        const imageNote = descs.length ? ` [Images: ${descs.join(' | ')}]` : '';
        if (msg.content) return `${username}: ${msg.content}${imageNote}`;
        return `${username}:${imageNote || ' [No content]'}`;
      })
      .join('\n');
  
    const context = { channelName: channel.name, guildName: channel.guild?.name || 'Unknown Guild' };
    const dungeonPrompt = await this.buildDungeonPrompt(avatar, channel.guild.id);
  
    // Return the formatted prompt without a separate image descriptions list
  return `
Channel: #${context.channelName} in ${context.guildName}

Channel summary:
${channelSummary}

Actions Available (internal reference – do NOT list them back to users unless explicitly asked):
${dungeonPrompt}

STYLE / OUTPUT RULES (critical):
- Stay fully in-character as ${avatar.name}.
- Unless the user explicitly asks for instructions, help, a tutorial, troubleshooting, a list, "how", or "steps", DO NOT output numbered lists, bullet lists, headings, or "Steps:" / "Quick Steps:" style formats.
- Do NOT echo or re-enumerate the available commands list unprompted.
- Prefer 1 short natural sentence or 2 very short sentences max, OR one valid action command in the form: <emoji> <command_name> <parameters>.
- Be CONCISE and DIRECT. No unnecessary elaboration or verbosity.
- If using chain-of-thought reasoning, keep it brief (2-3 sentences max) and focused on the immediate decision.
- No "---" separators, no markdown headings, no code fences unless the user clearly requests code.
- If clarification is needed, ask at most ONE concise question instead of giving speculative instructions.
- Avoid patronizing helper tone; speak as an active participant in the scene.

Recent conversation history:
${channelContextText}

Respond now (one short in-character message or a single action).`.trim();
  }

  /**
   * Builds the complete chat messages array for narrative generation.
   * @param {Object} avatar - The avatar object.
   * @returns {Promise<Array>} Array of chat messages.
   */
  async getNarrativeChatMessages(avatar) {
    const systemPrompt = await this.getBasicSystemPrompt(avatar);
    const assistantContext = await this.getNarrativeAssistantContext(avatar);
    const userPrompt = await this.buildNarrativePrompt(avatar);

    let monologueText = '';
    if (avatar.innerMonologueChannel) {
      try {
        const channel = await this.discordService.client.channels.fetch(avatar.innerMonologueChannel);
        const messages = await channel.messages.fetch({ limit: 10 });
        monologueText = messages
          .filter(m => !m.content.startsWith('🌪️'))
          .map(m => m.content)
          .join('\n');
      } catch (error) {
        console.error(`Error fetching inner monologue: ${error.message}`);
      }
    }

    let recentActionsText = '';
    try {
      const recentActions = await this.toolService.ActionLog.getRecentActions(avatar.channelId);
      recentActionsText = recentActions
        .filter(action => action.actorId === avatar._id.toString())
        .map(a => `${a.description || a.action}`)
        .join('\n');
    } catch (error) {
      console.error(`Error fetching recent actions: ${error.message}`);
    }

    const combinedUserPrompt = `
${userPrompt}

Recent inner thoughts:
${monologueText}

Recent actions:
${recentActionsText}
`.trim();

    return [
      { role: 'system', content: systemPrompt },
      { role: 'assistant', content: assistantContext },
      { role: 'user', content: combinedUserPrompt }
    ];
  }

  /**
   * Builds the complete chat messages array for response generation.
   * @param {Object} avatar - The avatar object.
   * @param {Object} channel - The Discord channel object.
   * @param {Array} messages - Array of message objects.
   * @param {string} channelSummary - The channel summary.
   * @param {Object} db - The MongoDB database instance.
   * @returns {Promise<Array>} Array of chat messages.
   */
  async getResponseChatMessages(avatar, channel, messages, channelSummary, db) {
    const systemPrompt = await this.getFullSystemPrompt(avatar, db);
    const lastNarrative = await this.getLastNarrative(avatar, db);
    const userContent = await this.getResponseUserContent(avatar, channel, messages, channelSummary);
    return [
      { role: 'system', content: systemPrompt },
      { role: 'assistant', content: lastNarrative?.content || 'No previous reflection' },
      { role: 'user', content: userContent }
    ];
  }

  async getResponseChatMessagesV2(avatar, channel, messages, channelSummary, db) {
    // Guard: if no assembler, fallback to existing flow
    if (!this.promptAssembler) return this.getResponseChatMessages(avatar, channel, messages, channelSummary, db);

    this.db = db || await this.databaseService.getDatabase();

    const systemPrompt = await this.getFullSystemPrompt(avatar, this.db);

    // Build CONTEXT
    const now = new Date().toISOString();
    const guild = channel?.guild?.name || channel?.guildId || 'unknown';
    const channelName = channel?.name || channel?.id || 'unknown';
    const runId = Math.random().toString(36).slice(2, 8);
    const featureFlags = `memoryV2=${process.env.MEMORY_V2_ENABLED !== 'false'}, frames=${process.env.FRAMES_ENABLED || false}`;
    const caller = (messages && messages.length) ? messages[messages.length-1]?.authorTag || messages[messages.length-1]?.author || 'user' : 'user';

    const CONTEXT = `ts=${now}; runId=${runId}; guild=${guild}; channel=${channelName}\ncaller=${caller}\nfeatureFlags: ${featureFlags}`;

    // Build FOCUS from recent dialog window (thin windowing here; summaries TODO)
    const turns = (messages || []).slice(-10).map(m => `${m.role || m.authorRole || 'user'}: ${m.content || m.text || ''}`);
    let FOCUS = turns.join('\n');
    FOCUS = this.promptAssembler.truncateToTokensSentences(FOCUS, 3000);

    const lastUserMsg = [...(messages||[])].reverse().find(m => (m.role||m.authorRole) === 'user' || m.authorRole === 'User' || m.authorTag)?.content || '';

    const CONSTRAINTS = `IDENTITY: You are ${avatar.name}. Never break character. Stay true to your personality.
STYLE: ${avatar.personality ? avatar.personality.split('.')[0].trim() + '.' : 'Stay authentic.'} Unless user requests instructions/list/steps/how-to, NO lists, bullets, or numbered steps.
`;
    
    const TASK = `Reply with 1-2 sentences OR one action (emoji + target). Max 1 clarifying question if needed. Be concise.`;
    const OUTPUT_SCHEMA = ``; // optional per use case

    const { blocks } = await this.promptAssembler.buildPrompt({
      avatarId: avatar?._id?.toString?.() || avatar?.id || 'unknown-avatar',
      systemText: systemPrompt,
      contextText: CONTEXT,
      focusText: FOCUS,
      msgText: lastUserMsg,
      who: caller,
      source: 'chat',
      constraintsText: CONSTRAINTS,
      taskText: TASK,
      outputSchema: OUTPUT_SCHEMA,
      modelUsed: process.env.AI_MODEL || 'default'
    });

    // Return messages in role format: system + user blocks
    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: blocks }
    ];
  }

  /**
   * Get or update a summary for a user based on their message history.
   * Now delegated to userProfileService.
   */
  async getOrUpdateUserProfileSummary(userId) {
    if (!this.userProfileService) throw new Error('userProfileService not initialized');
    return this.userProfileService.summarizeInteractionsIfNeeded(userId);
  }

  // Existing helper methods (unchanged unless noted)
  async getMemories(avatar, count = 10) {
    const memoryRecords = await this.memoryService.getMemories(avatar._id, count);
    return memoryRecords.map(m => m.memory).join('\n');
  }

  async getRecentActions(avatar) {
    const recentActions = await this.toolService.ActionLog.getRecentActions(avatar.channelId);
    return recentActions
      .filter(action => action.actorId === avatar._id.toString())
      .map(a => `${a.description || a.action}`)
      .join('\n');
  }

  async getNarrativeContent(avatar) {
    if (!avatar.innerMonologueChannel) return '';
    try {
      const channel = await this.discordService.client.channels.fetch(avatar.innerMonologueChannel);
      const messages = await channel.messages.fetch({ limit: 10 });
      return messages
        .filter(m => !m.content.startsWith('🌪️'))
        .map(m => m.content)
        .join('\n');
    } catch (error) {
      console.error(`Error fetching narrative content: ${error.message}`);
      return '';
    }
  }

  async getLastNarrative(avatar, db) {
    if (!db) return null;
    return avatar.dynamicPersonality + '\n\n' + (await db
      .collection('narratives')
      .findOne(
        { $or: [{ avatarId: avatar._id }, { avatarId: avatar._id.toString() }] },
        { sort: { timestamp: -1 } }
      ));
  }

  async getImageDescriptions(messages) {
    if (!this.imageProcessingService) return [];
    const imageMessages = messages.filter(msg =>
      msg.attachments.some(a => a.contentType?.startsWith('image/')) ||
      msg.embeds.some(e => e.image || e.thumbnail)
    );
    const descriptions = [];
    for (const msg of imageMessages) {
      const images = await this.imageProcessingService.extractImagesFromMessage(msg);
      if (images.length > 0) {
        descriptions.push(`[Image: ${images[0].description || 'Description not available'}]`);
      }
    }
    return descriptions;
  }

  /**
   * Gets the latest thought for an avatar to include in context.
   * @param {Object} avatar - The avatar object.
   * @returns {Promise<string|null>} The latest thought content or null.
   */
  async getLatestThought(avatar) {
    if (!avatar.thoughts || !Array.isArray(avatar.thoughts) || avatar.thoughts.length === 0) {
      return null;
    }
    
    // Get the most recent thought (thoughts are sorted with newest first)
    const latestThought = avatar.thoughts[0];
    return latestThought?.content || null;
  }
}