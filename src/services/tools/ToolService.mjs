/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { ActionLog } from './ActionLog.mjs';
import { AttackTool } from './tools/AttackTool.mjs';
import { ChallengeTool } from './tools/ChallengeTool.mjs';
import { DefendTool } from './tools/DefendTool.mjs';
import { MoveTool } from './tools/MoveTool.mjs';
import { RememberTool } from './tools/RememberTool.mjs';
import { CreationTool } from './tools/CreationTool.mjs';
import { XSocialTool } from './tools/XSocialTool.mjs';
import { ItemTool } from './tools/ItemTool.mjs';
import { ThinkTool } from './tools/ThinkTool.mjs';
import { SummonTool } from './tools/SummonTool.mjs';
import { BreedTool } from './tools/BreedTool.mjs';
import { WebSearchTool } from './tools/WebSearchTool.mjs';
import { CooldownService } from './CooldownService.mjs';
import { SelfieTool } from './tools/SelfieTool.mjs';
import { SceneCameraTool } from './tools/SceneCameraTool.mjs';
import { VideoCameraTool } from './tools/VideoCameraTool.mjs';
import { DevilTool } from './tools/DevilTool.mjs';
import { HideTool } from './tools/HideTool.mjs';
import { FleeTool } from './tools/FleeTool.mjs';
import { PotionTool } from './tools/PotionTool.mjs';
import { WikiTool } from './tools/WikiTool.mjs';

// D&D Tools
import { CharacterTool } from './tools/CharacterTool.mjs';
import { PartyTool } from './tools/PartyTool.mjs';
import { DungeonTool } from './tools/DungeonTool.mjs';
import { CastTool } from './tools/CastTool.mjs';
import { QuestTool } from './tools/QuestTool.mjs';
import { TutorialTool } from './tools/TutorialTool.mjs';

function normalizeToolResult(rawResult) {
  const base = { message: null, notify: true, embeds: null, components: null, ephemeral: false };
  if (rawResult === undefined || rawResult === null) {
    return { ...base, notify: false };
  }
  if (typeof rawResult === 'object' && !Array.isArray(rawResult)) {
    const notify = rawResult.notify === undefined ? true : Boolean(rawResult.notify);
    const ephemeral = rawResult.ephemeral === true;
    
    // Check for embed responses with optional components
    if (rawResult.embeds && Array.isArray(rawResult.embeds)) {
      return { 
        message: null, 
        embeds: rawResult.embeds, 
        components: rawResult.components || null,
        notify,
        ephemeral
      };
    }
    
    let message = rawResult.message ?? rawResult.result ?? rawResult.text ?? null;
    if (message !== null && message !== undefined && typeof message !== 'string') {
      try {
        message = JSON.stringify(message);
      } catch {
        message = String(message);
      }
    }
    return { message, embeds: null, components: rawResult.components || null, notify, ephemeral };
  }
  return { message: typeof rawResult === 'string' ? rawResult : String(rawResult), embeds: null, components: null, notify: true, ephemeral: false };
}

export class ToolService {
  constructor({
    logger,
    aiService,
    unifiedAIService,
  googleAIService,
  openrouterAIService,
  openrouterModelCatalogService,
  imageGenerationRateLimiter,
    imageProcessingService,
    configService,
    cooldownService,
    memoryService,
    discordService,
    databaseService,
    schedulingService,
    spamControlService,
    moderationService,
    mapService,
    decisionMaker,
    avatarService,
    riskManagerService,
    s3Service,
    locationService,
    battleService,
  combatEncounterService,
  battleMediaService,
    xService,
    itemService,
    statService,
    schemaService,
    knowledgeService,
    veoService,
    videoJobService,
    presenceService,
    conversationThreadService,
    wikiService,
    // D&D Services
    characterService,
    spellService,
    partyService,
    dungeonService,
    questService,
    tutorialQuestService
  }) {
    this.toolServices = {
      logger,
      aiService,
      unifiedAIService,
  googleAIService,
  openrouterModelCatalogService,
  openrouterAIService,
  imageGenerationRateLimiter,
      imageProcessingService,
      battleService,
  combatEncounterService,
  battleMediaService,
      locationService,
      configService,
      cooldownService,
      memoryService,
      discordService,
      databaseService,
      schedulingService,
      spamControlService,
      moderationService,
      mapService,
      decisionMaker,
      avatarService,
      riskManagerService,
      s3Service,
      xService,
      itemService,
      statService,
      schemaService,
      knowledgeService,
      veoService,
      videoJobService,
      presenceService,
      conversationThreadService,
      wikiService,
      // D&D Services
      characterService,
      spellService,
      partyService,
      dungeonService,
      questService,
      tutorialQuestService
    }

    this.logger = logger || console;
    this.configService = configService;
    this.memoryService = memoryService;
    this.discordService = discordService;
    this.databaseService = databaseService;
    this.schedulingService = schedulingService;
  this.spamControlService = spamControlService;
  this.moderationService = moderationService;
  this.mapService = mapService;
  this.decisionMaker = decisionMaker;
  this.avatarService = avatarService;
  this.riskManagerService = riskManagerService;
  this.conversationManager = null;
    
    this.started = false;
    this.cooldownService = cooldownService || new CooldownService();
    // Tools & Logging
    this.ActionLog = new ActionLog(this.logger);
    this.tools = new Map();
    this.toolEmojis = new Map();

    this.defaultCooldownMs = 60 * 60 * 1000; // 1 hour cooldown
    this.cooldownService = this.cooldownService || new CooldownService();

    // Initialize tools - each tool defines its own name and emoji
    const toolClasses = [
      SummonTool,
      BreedTool,
      AttackTool,
      ChallengeTool,
      HideTool,
      DefendTool,
      FleeTool,
      MoveTool,
      RememberTool,
      CreationTool,
      XSocialTool,
      ItemTool,
      PotionTool,
      ThinkTool,
      WebSearchTool,
      SelfieTool,
      SceneCameraTool,
      VideoCameraTool,
      DevilTool,
      WikiTool,
      // D&D Tools
      CharacterTool,
      PartyTool,
      DungeonTool,
      CastTool,
      QuestTool,
      TutorialTool
    ];

    // Instantiate and register all tools - names and emojis are inferred from tool instances
    toolClasses.forEach(ToolClass => {
      const tool = new ToolClass(this.toolServices);
      if (tool.name) {
        this.tools.set(tool.name, tool);
        if (tool.emoji) this.toolEmojis.set(tool.emoji, tool.name);
      }
    });

    // Load emoji mappings from config (allows runtime overrides)
    const configEmojis = this.configService.get('toolEmojis') || {};
    Object.entries(configEmojis).forEach(([emoji, toolName]) => {
      this.toolEmojis.set(emoji, toolName);
    });

    // Override: ⚔️ maps to 'challenge' for neutral initiation (not 'attack')
    this.toolEmojis.set('⚔️', 'challenge');
  }

  registerTool(tool) {
    if (tool?.name) {
      this.tools.set(tool.name, tool);
      if (tool.emoji) this.toolEmojis.set(tool.emoji, tool.name);
    }
  }

  setConversationManager(conversationManager) {
    if (!conversationManager || this.conversationManager === conversationManager) return;
    this.conversationManager = conversationManager;
    this.toolServices.conversationManager = conversationManager;
    // Backfill existing tools so they can access the manager without constructor injection
    for (const tool of this.tools.values()) {
      tool.conversationManager = conversationManager;
      if (typeof tool.setConversationManager === 'function') {
        try {
          tool.setConversationManager(conversationManager);
        } catch (err) {
          this.logger?.debug?.(`[ToolService] setConversationManager propagation failed for ${tool.name}: ${err.message}`);
        }
      }
    }
  }

  async initialize() {
    let tools = {};
    for (const [name, tool] of this.tools.entries()) {
      tools[name] = tool;
    }
    this.logger.info(`ToolService initialized with ${Object.keys(tools).length} tools.`);

    // Start scheduled X posting
    this.startScheduledXPosting();
  }

  /**
   * Check if current time is optimal for posting to X.
   * Based on general engagement patterns (UTC times).
   * @returns {boolean}
   */
  _isOptimalXPostingTime() {
    const hour = new Date().getUTCHours();
    // Peak engagement hours: 13:00-21:00 UTC (covers US morning to EU evening)
    const optimalHours = [13, 14, 15, 16, 17, 18, 19, 20, 21];
    return optimalHours.includes(hour);
  }

  /**
   * Schedules periodic X posting using XSocialTool logic.
   * Posts every hour from a random authenticated avatar, with optimal timing.
   */
  startScheduledXPosting(intervalMs = 30 * 60 * 1000) { // Check every 30 minutes
    const schedulingService = this.schedulingService;
    const avatarService = this.avatarService;
    const xSocialTool = this.tools.get('x');
    if (!schedulingService || !avatarService || !xSocialTool) {
      this.logger?.warn?.('[ToolService] Scheduled X posting not started: missing dependencies');
      return;
    }

    // Track last post time to enforce minimum interval
    let lastPostTime = 0;
    const minIntervalMs = 60 * 60 * 1000; // Minimum 1 hour between posts

    schedulingService.addTask('x-auto-post', async () => {
      try {
        // Check optimal timing
        if (!this._isOptimalXPostingTime()) {
          this.logger?.debug?.('[ToolService] Skipping X post: not optimal time');
          return;
        }

        // Enforce minimum interval
        if (Date.now() - lastPostTime < minIntervalMs) {
          this.logger?.debug?.('[ToolService] Skipping X post: too soon since last post');
          return;
        }

        const db = this.databaseService.getDatabase ? await this.databaseService.getDatabase() : null;
        if (!db) return;
        // Get all authenticated avatars
        const xAuths = await db.collection('x_auth').find({ accessToken: { $exists: true, $ne: null } }).toArray();
        if (!xAuths.length) return;
        // Pick one at random
        const xAuth = xAuths[Math.floor(Math.random() * xAuths.length)];
        const avatar = await avatarService.getAvatarById(xAuth.avatarId);
        if (!avatar) return;
        // Generate context and actions
        const context = '';
        const timelineData = await xSocialTool.getXTimelineAndNotifications(avatar);
        const actions = await xSocialTool.generateSocialActions(
          avatar,
          context,
          timelineData.timeline,
          timelineData.notifications,
          timelineData.userId
        );
        // Find a 'post' action
        const postAction = Array.isArray(actions) && actions.find(a => a.type === 'post' && a.content);
        if (!postAction) return;
        // Post to X
        await xSocialTool.xService.postToX(avatar, postAction.content);
        lastPostTime = Date.now();
        this.logger?.info?.(`[ToolService] Scheduled X post for avatar ${avatar.name}`);
      } catch (err) {
        this.logger?.error?.('[ToolService] Scheduled X posting error:', err);
      }
    }, intervalMs);
    this.logger?.info?.('[ToolService] Scheduled X posting enabled (checks every 30min, posts during optimal hours)');
  }

  extractToolCommands(text) {
    // Handle empty or invalid input
    if (!text) return { commands: [], cleanText: text || '', commandLines: [] };

    // Prepare emojis from toolEmojis map, escaping special regex characters
    const emojis = Array.from(this.toolEmojis.keys()).map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (emojis.length === 0) return { commands: [], cleanText: text, commandLines: [] };

    // Build emoji pattern
    const emojiPattern = emojis.join('|');
    
    // Split text by emoji patterns, preserving the emojis
    // Find all positions where emojis appear
    const emojiRegex = new RegExp(`(${emojiPattern})`, 'g');
    const commands = [];
    const commandLines = [];
    let cleanText = text;
    
    // Find all emoji matches with their positions
    const emojiMatches = [];
    let emojiMatch;
    while ((emojiMatch = emojiRegex.exec(text)) !== null) {
      emojiMatches.push({
        emoji: emojiMatch[1],
        index: emojiMatch.index,
        endIndex: emojiMatch.index + emojiMatch[1].length
      });
    }
    
    // For each emoji, extract its parameters (text until next emoji or end)
    for (let i = 0; i < emojiMatches.length; i++) {
      const current = emojiMatches[i];
      const next = emojiMatches[i + 1];
      
      // Parameters are everything from after this emoji to before next emoji (or end)
      const paramsStart = current.endIndex;
      const paramsEnd = next ? next.index : text.length;
      const paramsString = text.slice(paramsStart, paramsEnd).trim();
      const params = paramsString.split(/\s+/).filter(Boolean);
      
      const toolName = this.toolEmojis.get(current.emoji);
      if (toolName) {
        const fullMatch = text.slice(
          Math.max(0, current.index - 1), // Include preceding space if any
          paramsEnd
        ).trim();
        
        commands.push({ command: toolName, emoji: current.emoji, params });
        commandLines.push(fullMatch);
        cleanText = cleanText.replace(fullMatch, '').trim();
      }
    }

    return { commands, cleanText, commandLines };
  }

  applyGuildToolEmojiOverrides(guildConfig) {
    if (!guildConfig?.toolEmojis) return;

    for (const [toolName, overrideEmoji] of Object.entries(guildConfig.toolEmojis)) {
      if (!overrideEmoji) continue;

      // Remove all emojis currently mapped to this tool
      for (const [emoji, mappedTool] of this.toolEmojis.entries()) {
        if (mappedTool === toolName) {
          this.toolEmojis.delete(emoji);
        }
      }

      // Add override emoji
      this.toolEmojis.set(overrideEmoji, toolName);
    }
  }

  // --- Command Processing ---

  async getCommandsDescription(guildId, avatar = null) {
    const commands = [];
    for (const [name, tool] of this.tools.entries()) {
      try {
        if (tool.showInHelp === false) continue; // Skip tools not shown in help
        if (tool.hidden) continue; // Skip hidden tools
        // Check cooldown for this avatar/tool
        if (avatar) {
          const cooldownMs = tool.cooldownMs ?? this.defaultCooldownMs;
          const remaining = this.cooldownService.getRemainingCooldown(name, avatar._id, cooldownMs);
          if (remaining > 0) continue; // Skip tools on cooldown
        }
        if (tool.getToolStatusForAvatar && avatar) {
          const status = await tool.getToolStatusForAvatar(avatar);
          if (!status.visible) continue;
          const syntax = (await tool.getSyntax(guildId)) || `${tool.emoji} ${name}`;
          const description = tool.getDescription() || 'No description available.';
          const info = status.info ? `\n${status.info}` : '';
          commands.push(`**${name}**\nCommand format: ${syntax}\nDescription: ${description}${info}`);
        } else {
          const syntax = (await tool.getSyntax(guildId)) || `${tool.emoji} ${name}`;
          const description = tool.getDescription() || 'No description available.';
          commands.push(`**${name}**\nCommand format: ${syntax}\nDescription: ${description}`);
        }
      } catch (error) {
        this.logger.error(`Error getting syntax for tool '${name}': ${error.message}`);
      }
    }
    return commands.join('\n\n');
  }

  /**
   * Executes a tool by name, logs the action, and returns the result.
   * @param {string} toolName - The tool name (e.g., 'move', 'item')
   * @param {Object} message - The Discord message object
   * @param {string[]} params - The command parameters
   * @param {Object} avatar - The avatar performing the action
   * @param {Object} guildConfig - The guild configuration
  * @returns {Promise<{message: string|null, notify: boolean}>} The tool's response and notification preference
   */
  // Note: Some callers pass `context` as the 5th argument (omitting guildConfig).
  // To maintain backward compatibility, accept either 5th or 6th param as context.
  async executeTool(toolName, message, params, avatar, _guildConfig_or_context = {}, maybeContext) {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return `Tool '${toolName}' not found.`;
    }

    // Check if this is a D&D tool and send welcome message if first time
    if (tool.isDndTool) {
      await this._sendDndWelcomeIfNeeded(message);
    }

    const cooldownMs = tool.cooldownMs ?? this.defaultCooldownMs;
    const remaining = this.cooldownService.getRemainingCooldown(toolName, avatar._id, cooldownMs);
    if (remaining > 0) {
      const minutes = Math.ceil(remaining / 60000);
      return `-# [ Please wait ${minutes} more minute(s) before using '${toolName}' again. ]`;
    }

    // Back-compat: detect where `context` was provided.
    // If maybeContext is defined, treat it as the true context and disregard guildConfig for now.
    // If not, assume the 5th arg is actually the context.
  const context = (typeof maybeContext !== 'undefined') ? (maybeContext || {}) : (_guildConfig_or_context || {});

    // Global gating: KO/dead cannot use tools; in-combat restrict tools
    try {
      const now = Date.now();
      if (avatar?.status === 'dead' || avatar?.status === 'knocked_out' || (avatar?.knockedOutUntil && now < avatar.knockedOutUntil)) {
        return null; // silent block
      }
    } catch {}

    const ces = this.toolServices?.combatEncounterService;
    const inCombat = (() => {
      try { return ces?.isInActiveCombat?.(message.channel.id, avatar.id || avatar._id) || false; } catch { return false; }
    })();
  const combatAllowed = new Set(['attack', 'defend', 'hide', 'flee']);
  const isItemUse = toolName === 'item' && Array.isArray(params) && params[0] && String(params[0]).toLowerCase() === 'use';
  if (inCombat && !combatAllowed.has(toolName) && !isItemUse) {
      return `-# [ '${toolName}' not available during combat. Use 🗡️ attack, 🛡️ defend, 🫥 hide, or 🏃 flee. ]`;
    }

    let rawResult;
    try {
      // Augment context with combatEncounterService if available
      if (this.toolServices?.combatEncounterService) {
        context.combatEncounterService = context.combatEncounterService || this.toolServices.combatEncounterService;
      }
      if (this.toolServices?.battleMediaService) {
        context.battleMediaService = context.battleMediaService || this.toolServices.battleMediaService;
      }
      // D&D services for dungeon combat integration
      if (this.toolServices?.dungeonService) {
        context.dungeonService = context.dungeonService || this.toolServices.dungeonService;
      }
      if (this.toolServices?.characterService) {
        context.characterService = context.characterService || this.toolServices.characterService;
      }
      // Provide discordService for downstream actions (e.g., KO movement)
      if (this.discordService && !context.discordService) context.discordService = this.discordService;
      rawResult = await tool.execute(message, params, avatar, context);
      this.cooldownService.setUsed(toolName, avatar._id);
    } catch (error) {
      rawResult = { message: `Error executing ${toolName}: ${error.message}` };
    }

    const normalized = normalizeToolResult(rawResult);
    const resultForLog = normalized.message;
    try {
      if (resultForLog) {
        await this.memoryService.addMemory(avatar._id, resultForLog);
      }
      await this.ActionLog.logAction({
        channelId: message.channel.id,
        action: toolName,
        actorId: avatar._id,
        actorName: avatar.name,
        displayName: avatar.displayName || avatar.name,
        target: params.join(' '),
        result: resultForLog,
        tool: toolName,
        emoji: tool.emoji,
        isCustom: false,
        timestamp: Date.now(),
      });
    } catch (logError) {
      this.logger?.error(`Failed to log action '${toolName}': ${logError.message}`);
    }

    return normalized;
  }

  /**
   * Send a D&D welcome DM to first-time users
   * @private
   */
  async _sendDndWelcomeIfNeeded(message) {
    try {
      const questService = this.toolServices?.questService;
      if (!questService) return;

      const discordUserId = message.author?.id;
      if (!discordUserId) return;

      // Check if already seen
      const hasSeen = await questService.hasSeenWelcome?.(discordUserId);
      if (hasSeen) return;

      // Send welcome DM as embed
      const welcomeEmbed = questService.getWelcomeEmbed?.();
      if (welcomeEmbed) {
        await message.author.send(welcomeEmbed);
      }
      
      // Mark as seen
      await questService.markWelcomeSeen?.(discordUserId);
      
      this.logger?.info?.(`[ToolService] Sent D&D welcome DM to user ${discordUserId}`);
    } catch (err) {
      // User may have DMs disabled - that's fine
      this.logger?.debug?.(`[ToolService] Could not send D&D welcome DM: ${err.message}`);
    }
  }
}
