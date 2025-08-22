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
import { OneirocomForumTool as ForumTool } from './tools/ForumTool.mjs';
import { CooldownService } from './CooldownService.mjs';
import { SelfieTool } from './tools/SelfieTool.mjs';
import { DevilTool } from './tools/DevilTool.mjs';
import { HideTool } from './tools/HideTool.mjs';
import { FleeTool } from './tools/FleeTool.mjs';

export class ToolService {
  constructor({
    logger,
    aiService,
  googleAIService,
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
    oneirocomForumService,
    veoService,
    presenceService
  }) {
    this.toolServices = {
      logger,
      aiService,
  googleAIService,
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
      forumService: oneirocomForumService,
      veoService,
      presenceService
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
    
    this.started = false;
    this.cooldownService = cooldownService || new CooldownService();
    // Tools & Logging
    this.ActionLog = new ActionLog(this.logger);
    this.tools = new Map();
    this.toolEmojis = new Map();

    this.defaultCooldownMs = 60 * 60 * 1000; // 1 hour cooldown
    this.cooldownService = this.cooldownService || new CooldownService();

    // Initialize tools
    const toolClasses = {
      summon: SummonTool,
      breed: BreedTool,
      // Keep AttackTool for explicit attack command, but move ⚔️ to 'challenge'
      attack: AttackTool,
      challenge: ChallengeTool,
  hide: HideTool,
      defend: DefendTool,
  flee: FleeTool,
      move: MoveTool,
      remember: RememberTool,
      create: CreationTool,
      x: XSocialTool,
      item: ItemTool,
      respond: ThinkTool,
      forum: ForumTool,
      camera: SelfieTool,
      devil: DevilTool
    };

  Object.entries(toolClasses).forEach(([name, ToolClass]) => {
      const tool = new ToolClass(this.toolServices);
      this.tools.set(name, tool);
      if (tool.emoji) this.toolEmojis.set(tool.emoji, name);
    });

    // Load emoji mappings from config
  const configEmojis = this.configService.get('toolEmojis') || {};
    Object.entries(configEmojis).forEach(([emoji, toolName]) => {
      this.toolEmojis.set(emoji, toolName);
    });

  // Ensure ⚔️ maps to 'challenge' by default for neutral initiation
  this.toolEmojis.set('⚔️', 'challenge');
  }

  registerTool(tool) {
    if (tool?.name) {
      this.tools.set(tool.name, tool);
      if (tool.emoji) this.toolEmojis.set(tool.emoji, tool.name);
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
   * Schedules periodic X posting using XSocialTool logic.
   * Posts every hour from a random authenticated avatar.
   */
  startScheduledXPosting(intervalMs = 60 * 60 * 1000) {
    const schedulingService = this.schedulingService;
    const avatarService = this.avatarService;
    const xSocialTool = this.tools.get('x');
    if (!schedulingService || !avatarService || !xSocialTool) {
      this.logger?.warn?.('[ToolService] Scheduled X posting not started: missing dependencies');
      return;
    }
    schedulingService.addTask('x-auto-post', async () => {
      try {
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
        this.logger?.info?.(`[ToolService] Scheduled X post for avatar ${avatar.name}`);
      } catch (err) {
        this.logger?.error?.('[ToolService] Scheduled X posting error:', err);
      }
    }, intervalMs);
    this.logger?.info?.('[ToolService] Scheduled X posting enabled');
  }

  extractToolCommands(text) {
    // Handle empty or invalid input
    if (!text) return { commands: [], cleanText: text || '', commandLines: [] };

    // Prepare emojis from toolEmojis map, escaping special regex characters
    const emojis = Array.from(this.toolEmojis.keys()).map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (emojis.length === 0) return { commands: [], cleanText: text, commandLines: [] };

    // Define the regex pattern to match commands and their parameters
    const pattern = new RegExp(`(^|\\s)(${emojis.join('|')})(?:\\s+((?:(?!${emojis.join('|')}).)*))?`, 'g');

    let match;
    const commands = [];
    const commandLines = [];
    let cleanText = text;

    // Iterate through all matches in the text
    while ((match = pattern.exec(text)) !== null) {
      const emoji = match[2];
      const paramsString = match[3] || '';
      const params = paramsString.trim().split(/\s+/).filter(Boolean);
      const toolName = this.toolEmojis.get(emoji);
      const fullMatch = match[0];
      commands.push({ command: toolName, emoji, params });
      commandLines.push(fullMatch.trim());
      // Remove the matched command from cleanText
      cleanText = cleanText.replace(fullMatch, '').trim();
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
   * @returns {Promise<string>} The tool's response
   */
  // Note: Some callers pass `context` as the 5th argument (omitting guildConfig).
  // To maintain backward compatibility, accept either 5th or 6th param as context.
  async executeTool(toolName, message, params, avatar, _guildConfig_or_context = {}, maybeContext) {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return `Tool '${toolName}' not found.`;
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
    if (inCombat && !combatAllowed.has(toolName)) {
      return `-# [ '${toolName}' not available during combat. Use 🗡️ attack, 🛡️ defend, 🫥 hide, or 🏃 flee. ]`;
    }

    let result;
    try {
      // Augment context with combatEncounterService if available
      if (this.toolServices?.combatEncounterService) {
        context.combatEncounterService = context.combatEncounterService || this.toolServices.combatEncounterService;
      }
      if (this.toolServices?.battleMediaService) {
        context.battleMediaService = context.battleMediaService || this.toolServices.battleMediaService;
      }
      // Provide discordService for downstream actions (e.g., KO movement)
      if (this.discordService && !context.discordService) context.discordService = this.discordService;
      result = await tool.execute(message, params, avatar, context);
      this.cooldownService.setUsed(toolName, avatar._id);
    } catch (error) {
      result = `Error executing ${toolName}: ${error.message}`;
    }

    try {
      await this.memoryService.addMemory(avatar._id, result);
      await this.ActionLog.logAction({
        channelId: message.channel.id,
        action: toolName,
        actorId: avatar._id,
        actorName: avatar.name,
        displayName: avatar.displayName || avatar.name,
        target: params.join(' '),
        result,
        tool: toolName,
        emoji: tool.emoji,
        isCustom: false,
        timestamp: Date.now(),
      });
    } catch (logError) {
      this.logger?.error(`Failed to log action '${toolName}': ${logError.message}`);
    }

    return result;
  }
}