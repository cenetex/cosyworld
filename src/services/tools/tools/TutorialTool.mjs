/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * TutorialTool - Discord tool for the tutorial quest system
 */

import { BasicTool } from '../BasicTool.mjs';

export class TutorialTool extends BasicTool {
  constructor({ tutorialQuestService, characterService, discordService, logger }) {
    super();
    this.tutorialQuestService = tutorialQuestService;
    this.characterService = characterService;
    this.discordService = discordService;
    this.logger = logger;

    this.name = 'tutorial';
    this.emoji = '📚';
    this.description = 'Begin or continue the D&D tutorial quest';
    this.replyNotification = true;
    this.cooldownMs = 5000;
  }

  getDescription() {
    return 'Begin or continue the D&D tutorial quest';
  }

  getUsage() {
    return '📚 tutorial [start|status|skip|reset]';
  }

  parseArgs(input) {
    const parts = input.trim().toLowerCase().split(/\s+/);
    const subcommand = parts[0] || 'status';
    return { subcommand };
  }

  async execute(message, params, avatar) {
    const subcommand = params[0] || 'status';

    switch (subcommand) {
    case 'start':
    case 'begin':
      return this.startTutorial(avatar);
      
    case 'status':
    case 'current':
    case '':
      return this.showStatus(avatar);
      
    case 'reset':
      return this.resetTutorial(avatar);
      
    case 'ready':
      return this.handleTrigger(avatar, 'ready');

    case 'solo':
      return this.handleTrigger(avatar, 'party_ready');

    default:
      // Check if it's a trigger word
      return this.handleTrigger(avatar, subcommand);
    }
  }

  async startTutorial(avatar) {
    try {
      const result = await this.tutorialQuestService.startTutorial(avatar._id);

      if (!result.started) {
        // Tutorial already exists, get current step (which will auto-advance)
        const current = await this.tutorialQuestService.getCurrentStep(avatar._id);
        if (current.completed) {
          const completedEmbed = {
            embeds: [{
              title: '✅ Tutorial Already Complete!',
              description: 'You\'ve already completed the tutorial.',
              color: 0x10B981,
              footer: { text: 'Use 📚 tutorial reset to start over' }
            }]
          };
          if (current.autoAdvanced) {
            completedEmbed.embeds[0].author = { name: '✨ Progress detected! Skipped completed steps.' };
          }
          return completedEmbed;
        }
        
        const stepEmbed = this.tutorialQuestService.formatStepMessage(
          current.step, current.stepNumber, current.totalSteps
        );
        if (current.autoAdvanced) {
          stepEmbed.embeds[0].author = { name: '✨ Progress detected! Skipped completed steps.' };
        }
        return stepEmbed;
      }

      // New tutorial started - also check for auto-advancement
      const current = await this.tutorialQuestService.getCurrentStep(avatar._id);
      
      if (current.completed) {
        return {
          embeds: [{
            title: '✅ Tutorial Complete!',
            description: 'You\'ve already done everything! Great job!',
            color: 0x10B981,
            author: { name: '✨ Progress detected! All steps already complete.' },
            fields: [{ name: '⭐ XP Earned', value: `${current.progress.totalXpEarned} XP`, inline: true }],
            footer: { text: 'Use 📚 tutorial reset to replay' }
          }]
        };
      }

      const stepEmbed = this.tutorialQuestService.formatStepMessage(
        current.step, current.stepNumber, current.totalSteps
      );
      
      // Add welcome header to the embed
      if (current.autoAdvanced) {
        stepEmbed.embeds[0].author = { name: '✨ Progress detected! Skipped completed steps.' };
      } else {
        stepEmbed.embeds[0].author = { name: `⚔️ The Adventurer's Tutorial Quest` };
        stepEmbed.embeds[0].description = `Welcome, **${avatar.name}**!\n\n` +
          `This quest will teach you the ways of the adventurer.\n` +
          `Complete each step to earn XP and unlock your potential.\n\n` +
          `---\n\n` + (stepEmbed.embeds[0].description || '');
      }
      
      return stepEmbed;
    } catch (e) {
      this.logger?.error?.('[TutorialTool] Start error:', e);
      return this._errorEmbed(`Failed to start tutorial: ${e.message}`);
    }
  }

  async showStatus(avatar) {
    try {
      const current = await this.tutorialQuestService.getCurrentStep(avatar._id);

      if (!current) {
        return {
          embeds: [{
            title: '📚 Tutorial Quest',
            description: 'You haven\'t started the tutorial yet!',
            color: 0x6B7280, // Gray
            fields: [{
              name: '🚀 Get Started',
              value: 'Type `📚 tutorial start` to begin your adventure!',
              inline: false
            }]
          }]
        };
      }

      if (current.completed) {
        const completedEmbed = {
          embeds: [{
            title: '✅ Tutorial Complete!',
            description: `You finished the tutorial${current.autoAdvanced ? ' (auto-detected progress)' : ''}.`,
            color: 0x10B981, // Green
            fields: [{
              name: '⭐ Total XP Earned',
              value: `${current.progress.totalXpEarned} XP`,
              inline: true
            }],
            footer: { text: 'Use 📚 tutorial reset to replay' }
          }]
        };
        if (current.autoAdvanced) {
          completedEmbed.embeds[0].author = { name: '✨ Progress detected! Skipped completed steps.' };
        }
        return completedEmbed;
      }

      const stepEmbed = this.tutorialQuestService.formatStepMessage(
        current.step, current.stepNumber, current.totalSteps
      );

      // Add auto-advance notification if applicable
      if (current.autoAdvanced) {
        stepEmbed.embeds[0].author = { name: '✨ Progress detected! Skipped completed steps.' };
      }

      // Add XP info to footer
      stepEmbed.embeds[0].footer.text += ` • ⭐ ${current.progress.totalXpEarned} XP earned`;

      return stepEmbed;
    } catch (e) {
      this.logger?.error?.('[TutorialTool] Status error:', e);
      return this._errorEmbed(`Failed to get status: ${e.message}`);
    }
  }

  async handleTrigger(avatar, triggerId) {
    try {
      const result = await this.tutorialQuestService.advanceStep(avatar._id, triggerId);

      if (!result) {
        // Not a valid trigger for current step, just show status
        return this.showStatus(avatar);
      }

      if (result.isQuestComplete) {
        return this.tutorialQuestService.formatCompletionMessage(result.totalXpEarned);
      }

      const nextStepEmbed = this.tutorialQuestService.formatStepMessage(
        result.nextStep,
        this.tutorialQuestService.getSteps().indexOf(result.nextStep) + 1,
        this.tutorialQuestService.getSteps().length
      );

      // Add celebration if XP was earned
      if (result.xpEarned > 0) {
        nextStepEmbed.embeds[0].author = {
          name: `✨ Step complete! +${result.xpEarned} XP`
        };
      }

      return nextStepEmbed;
    } catch (e) {
      this.logger?.error?.('[TutorialTool] Trigger error:', e);
      return this.showStatus(avatar);
    }
  }

  async resetTutorial(avatar) {
    try {
      const result = await this.tutorialQuestService.resetTutorial(avatar._id);
      const stepEmbed = this.tutorialQuestService.formatStepMessage(
        result.step, 1, this.tutorialQuestService.getSteps().length
      );
      
      stepEmbed.embeds[0].author = { name: '🔄 Tutorial Reset!' };
      stepEmbed.embeds[0].description = 'Starting fresh...\n\n' + (stepEmbed.embeds[0].description || '');
      
      return stepEmbed;
    } catch (e) {
      this.logger?.error?.('[TutorialTool] Reset error:', e);
      return this._errorEmbed(`Failed to reset: ${e.message}`);
    }
  }

  _errorEmbed(message) {
    return {
      embeds: [{
        title: '❌ Error',
        description: message,
        color: 0xEF4444 // Red
      }]
    };
  }
}
