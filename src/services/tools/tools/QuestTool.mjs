/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * QuestTool - Discord tool for the quest system
 */

import { BasicTool } from '../BasicTool.mjs';

export class QuestTool extends BasicTool {
  constructor({ questService, characterService, discordService, logger }) {
    super();
    this.questService = questService;
    this.characterService = characterService;
    this.discordService = discordService;
    this.logger = logger;

    this.name = 'quest';
    this.emoji = '📋';
    this.description = 'View and manage quests';
    this.isDndTool = true;
    this.replyNotification = true;
    this.cooldownMs = 3000;
  }

  /**
   * Mark a response as ephemeral (user-only visibility)
   * @private
   */
  _makeEphemeral(response) {
    if (typeof response === 'string') {
      return { message: response, ephemeral: true };
    }
    return { ...response, ephemeral: true };
  }

  getDescription() {
    return 'View and manage your quests';
  }

  getUsage() {
    return '� quest [list|active|available|completed]';
  }

  async execute(message, params, avatar) {
    const subcommand = params[0]?.toLowerCase();
    const questId = params[1]?.toLowerCase();

    switch (subcommand) {
    // List commands
    case 'list':
    case 'quests':
      return this.listQuests(avatar);

    case 'active':
      return this.listActiveQuests(avatar);

    case 'available':
      return this.listAvailableQuests(avatar);

    case 'completed':
      return this.listCompletedQuests(avatar);

    // Quest actions
    case 'start':
    case 'begin':
      return this.startQuest(avatar, questId);

    case 'status':
    case 'view':
      return this.showQuestStatus(avatar, questId);

    case 'reset':
      return this.resetQuest(avatar, questId);

    case 'abandon':
      return this.abandonQuest(avatar, questId);

    // Tutorial shortcuts (backward compat)
    case 'tutorial':
      if (!questId) {
        return this.showQuestStatus(avatar, 'tutorial');
      }
      if (questId === 'start') return this.startQuest(avatar, 'tutorial');
      if (questId === 'reset') return this.resetQuest(avatar, 'tutorial');
      return this.showQuestStatus(avatar, 'tutorial');

    // Special triggers for tutorial
    case 'ready':
      return this.handleTrigger(avatar, 'tutorial', 'ready');

    case 'solo':
      return this.handleTrigger(avatar, 'tutorial', 'party_ready');

    case undefined:
    case '':
      // No action - show quest menu
      return this.listQuests(avatar);

    default:
      // Check if subcommand is a quest ID
      const quest = this.questService.getQuest(subcommand);
      if (quest) {
        return this.showQuestStatus(avatar, subcommand);
      }
      
      // Check if it's a trigger word for active tutorial
      return this.handleTrigger(avatar, 'tutorial', subcommand);
    }
  }

  // ==================== List Commands ====================

  async listQuests(avatar) {
    try {
      const [active, available, completed] = await Promise.all([
        this.questService.getActiveQuests(avatar._id),
        this.questService.getAvailableQuests(avatar._id),
        this.questService.getCompletedQuests(avatar._id)
      ]);

      const fields = [];

      if (active.length > 0) {
        const activeList = active.map(({ quest, progress }) => {
          const _step = quest.steps[progress.currentStep];
          return `${quest.emoji || '📋'} **${quest.title}** - Step ${progress.currentStep + 1}/${quest.steps.length}`;
        }).join('\n');
        fields.push({ name: '⚔️ Active Quests', value: activeList, inline: false });
      }

      if (available.length > 0) {
        const availList = available.slice(0, 5).map(q => {
          return `${q.emoji || '📋'} **${q.title}** - ${q.description}`;
        }).join('\n');
        fields.push({ 
          name: '📋 Available Quests', 
          value: availList + (available.length > 5 ? `\n*...and ${available.length - 5} more*` : ''),
          inline: false 
        });
      }

      if (completed.length > 0) {
        fields.push({ 
          name: '✅ Completed', 
          value: `${completed.length} quest${completed.length > 1 ? 's' : ''} completed`,
          inline: true 
        });
      }

      if (fields.length === 0) {
        return {
          embeds: [{
            title: '📚 Quest Journal',
            description: 'No quests available yet. Begin your adventure!',
            color: 0x6B7280,
            footer: { text: 'Use 📚 quest tutorial to start the tutorial' }
          }]
        };
      }

      return {
        embeds: [{
          title: '📚 Quest Journal',
          color: 0x7C3AED,
          fields,
          footer: { text: 'Use 📚 quest <name> to view details • 📚 quest start <name> to begin' }
        }]
      };
    } catch (e) {
      this.logger?.error?.('[QuestTool] List error:', e);
      return this._errorEmbed(`Failed to list quests: ${e.message}`);
    }
  }

  async listActiveQuests(avatar) {
    try {
      const active = await this.questService.getActiveQuests(avatar._id);
      
      if (active.length === 0) {
        return {
          embeds: [{
            title: '⚔️ Active Quests',
            description: 'You have no active quests.',
            color: 0x6B7280,
            footer: { text: 'Use 📚 quest available to see what\'s available' }
          }]
        };
      }

      const questList = active.map(({ quest, progress }) => {
        const step = quest.steps[progress.currentStep];
        const progressBar = this._makeProgressBar(progress.currentStep, quest.steps.length);
        return `${quest.emoji || '📋'} **${quest.title}**\n${progressBar} Step ${progress.currentStep + 1}/${quest.steps.length}: ${step?.title || 'Complete'}`;
      }).join('\n\n');

      return {
        embeds: [{
          title: '⚔️ Active Quests',
          description: questList,
          color: 0x3B82F6,
          footer: { text: 'Use 📚 quest <name> to view current step' }
        }]
      };
    } catch (e) {
      this.logger?.error?.('[QuestTool] Active list error:', e);
      return this._errorEmbed(`Failed to list active quests: ${e.message}`);
    }
  }

  async listAvailableQuests(avatar) {
    try {
      const available = await this.questService.getAvailableQuests(avatar._id);
      const quests = available.map(q => ({ ...q }));
      return this.questService.formatQuestList(quests, 'Available Quests');
    } catch (e) {
      this.logger?.error?.('[QuestTool] Available list error:', e);
      return this._errorEmbed(`Failed to list available quests: ${e.message}`);
    }
  }

  async listCompletedQuests(avatar) {
    try {
      const completed = await this.questService.getCompletedQuests(avatar._id);
      
      if (completed.length === 0) {
        return {
          embeds: [{
            title: '✅ Completed Quests',
            description: 'You haven\'t completed any quests yet.',
            color: 0x6B7280
          }]
        };
      }

      const questList = completed.map(({ quest, progress }) => {
        return `${quest.emoji || '📋'} **${quest.title}** - ⭐ ${progress.totalXpEarned} XP`;
      }).join('\n');

      return {
        embeds: [{
          title: '✅ Completed Quests',
          description: questList,
          color: 0x10B981
        }]
      };
    } catch (e) {
      this.logger?.error?.('[QuestTool] Completed list error:', e);
      return this._errorEmbed(`Failed to list completed quests: ${e.message}`);
    }
  }

  // ==================== Quest Actions ====================

  async startQuest(avatar, questId) {
    if (!questId) {
      return this._errorEmbed('Specify a quest: 📚 quest start <quest_id>');
    }

    try {
      const result = await this.questService.startQuest(avatar._id, questId);

      if (!result.started) {
        if (result.error === 'Quest already active') {
          // Just show current status
          return this.showQuestStatus(avatar, questId);
        }
        return this._errorEmbed(result.error);
      }

      // Get current step (which may auto-advance)
      const current = await this.questService.getCurrentStep(avatar._id, questId);

      if (current.completed) {
        return this.questService.formatCompletionMessage(result.quest, current.progress.totalXpEarned);
      }

      const stepEmbed = this.questService.formatStepMessage(
        current.quest, current.step, current.stepNumber, current.totalSteps
      );

      stepEmbed.embeds[0].author = { name: `🎯 Quest Started: ${result.quest.title}` };

      if (current.autoAdvanced) {
        stepEmbed.embeds[0].author = { name: '✨ Progress detected! Skipped completed steps.' };
      }

      return stepEmbed;
    } catch (e) {
      this.logger?.error?.('[QuestTool] Start error:', e);
      return this._errorEmbed(`Failed to start quest: ${e.message}`);
    }
  }

  async showQuestStatus(avatar, questId) {
    // Default to tutorial if no quest specified
    const targetQuestId = questId || 'tutorial';

    try {
      const current = await this.questService.getCurrentStep(avatar._id, targetQuestId);

      if (!current) {
        // Quest not started
        const quest = this.questService.getQuest(targetQuestId);
        if (!quest) {
          return this._errorEmbed(`Quest not found: ${targetQuestId}`);
        }

        return {
          embeds: [{
            title: `${quest.emoji || '📋'} ${quest.title}`,
            description: quest.description,
            color: 0x6B7280,
            fields: [
              { name: '📊 Steps', value: `${quest.steps.length} steps`, inline: true },
              { name: '⭐ Total XP', value: `${quest.steps.reduce((s, x) => s + (x.xpReward || 0), 0)} XP`, inline: true }
            ],
            footer: { text: `Use 📚 quest start ${targetQuestId} to begin` }
          }]
        };
      }

      if (current.completed) {
        const quest = this.questService.getQuest(targetQuestId);
        return {
          embeds: [{
            title: '✅ Quest Complete!',
            description: `You've completed **${quest?.title || targetQuestId}**!`,
            color: 0x10B981,
            fields: [{ name: '⭐ Total XP Earned', value: `${current.progress.totalXpEarned} XP`, inline: true }],
            footer: { text: 'Use 📚 quest reset to replay' }
          }]
        };
      }

      const stepEmbed = this.questService.formatStepMessage(
        current.quest, current.step, current.stepNumber, current.totalSteps
      );

      if (current.autoAdvanced) {
        stepEmbed.embeds[0].author = { name: '✨ Progress detected! Skipped completed steps.' };
      }

      // Add XP info
      stepEmbed.embeds[0].footer.text += ` • ⭐ ${current.progress.totalXpEarned} XP earned`;

      return stepEmbed;
    } catch (e) {
      this.logger?.error?.('[QuestTool] Status error:', e);
      return this._errorEmbed(`Failed to get quest status: ${e.message}`);
    }
  }

  async resetQuest(avatar, questId) {
    const targetQuestId = questId || 'tutorial';

    try {
      const result = await this.questService.resetQuest(avatar._id, targetQuestId);

      if (!result.started) {
        return this._errorEmbed(result.error || 'Failed to reset quest');
      }

      const current = await this.questService.getCurrentStep(avatar._id, targetQuestId);
      const stepEmbed = this.questService.formatStepMessage(
        current.quest, current.step, current.stepNumber, current.totalSteps
      );

      stepEmbed.embeds[0].author = { name: '🔄 Quest Reset!' };
      
      if (current.autoAdvanced) {
        stepEmbed.embeds[0].author = { name: '🔄 Quest Reset! ✨ Skipped completed steps.' };
      }

      return stepEmbed;
    } catch (e) {
      this.logger?.error?.('[QuestTool] Reset error:', e);
      return this._errorEmbed(`Failed to reset quest: ${e.message}`);
    }
  }

  async abandonQuest(avatar, questId) {
    if (!questId) {
      return this._errorEmbed('Specify a quest: 📚 quest abandon <quest_id>');
    }

    try {
      const result = await this.questService.abandonQuest(avatar._id, questId);

      if (!result.abandoned) {
        return this._errorEmbed(result.error);
      }

      return {
        embeds: [{
          title: '🚪 Quest Abandoned',
          description: `You have abandoned the quest.`,
          color: 0x6B7280,
          footer: { text: 'You can start it again later with 📚 quest start' }
        }]
      };
    } catch (e) {
      this.logger?.error?.('[QuestTool] Abandon error:', e);
      return this._errorEmbed(`Failed to abandon quest: ${e.message}`);
    }
  }

  // ==================== Trigger Handling ====================

  async handleTrigger(avatar, questId, triggerId) {
    try {
      const result = await this.questService.advanceStep(avatar._id, questId, triggerId);

      if (!result) {
        // Not a valid trigger, show status
        return this.showQuestStatus(avatar, questId);
      }

      if (result.isQuestComplete) {
        return this.questService.formatCompletionMessage(result.quest, result.totalXpEarned);
      }

      const nextStepEmbed = this.questService.formatStepMessage(
        result.quest, 
        result.nextStep,
        result.quest.steps.indexOf(result.nextStep) + 1,
        result.quest.steps.length
      );

      if (result.xpEarned > 0) {
        nextStepEmbed.embeds[0].author = { name: `✨ Step complete! +${result.xpEarned} XP` };
      }

      return nextStepEmbed;
    } catch (e) {
      this.logger?.error?.('[QuestTool] Trigger error:', e);
      return this.showQuestStatus(avatar, questId);
    }
  }

  // ==================== Helpers ====================

  _errorEmbed(message) {
    return {
      embeds: [{
        title: '❌ Quest Error',
        description: message,
        color: 0xEF4444
      }]
    };
  }

  _makeProgressBar(completed, total, length = 10) {
    const filled = Math.round((completed / total) * length);
    return '█'.repeat(filled) + '░'.repeat(length - filled);
  }
}
