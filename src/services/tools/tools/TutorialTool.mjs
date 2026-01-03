/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * TutorialTool - Discord tool for the tutorial quest system
 */

import { BasicTool } from '../BasicTool.mjs';
import { 
  createTutorialButtons, 
  addComponentsToResponse, 
  addEmbedTextSummary,
  createActionMenu
} from '../dndButtonComponents.mjs';

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
    return 'Begin or continue the D&D tutorial quest';
  }

  getUsage() {
    return '📚 tutorial [start|status|skip|next|solo|reset]';
  }

  getHelp() {
    return {
      description: 'Begin or continue the D&D tutorial quest that teaches you the basics.',
      subcommands: {
        'start': 'Begin the tutorial (or resume where you left off)',
        'status': 'Show your current progress',
        'skip': 'Skip the current step (optional steps only)',
        'next': 'Move to the next step (optional steps only)',
        'solo': 'Skip party formation and adventure alone',
        'reset': 'Reset and start the tutorial over'
      },
      examples: [
        '📚 tutorial start',
        '📚 tutorial skip',
        '📚 tutorial solo'
      ]
    };
  }

  parseArgs(input) {
    const parts = input.trim().toLowerCase().split(/\s+/);
    const subcommand = parts[0] || 'status';
    return { subcommand };
  }

  async execute(message, params, avatar) {
    const subcommand = params[0] || 'status';
    let response;

    switch (subcommand) {
    case 'start':
    case 'begin':
      response = await this.startTutorial(avatar);
      break;
      
    case 'status':
    case 'current':
    case '':
      response = await this.showStatus(avatar);
      break;
      
    case 'reset':
      response = await this.resetTutorial(avatar);
      break;
      
    case 'ready':
      response = await this.handleTrigger(avatar, 'ready');
      break;

    case 'solo':
      response = await this.handleSolo(avatar);
      break;

    case 'skip':
      response = await this.skipCurrentStep(avatar);
      break;

    case 'next':
      response = await this.advanceNext(avatar);
      break;

    default:
      // Check if it's a trigger word
      response = await this.handleTrigger(avatar, subcommand);
    }

    return response;
  }

  /**
   * Handle solo mode - marks party step as complete for solo adventurers
   */
  async handleSolo(avatar) {
    try {
      const current = await this.tutorialQuestService.getCurrentStep(avatar._id);
      
      if (!current || current.completed) {
        return this.showStatus(avatar);
      }

      // Only allow solo during party step
      if (current.step.trigger !== 'party_ready') {
        return {
          embeds: [{
            title: '🎭 Solo Mode',
            description: 'Solo mode is only available during the party formation step.',
            color: 0xFBBF24,
            footer: { text: 'Current step: ' + current.step.title }
          }]
        };
      }

      // Advance past party step
      const result = await this.tutorialQuestService.advanceStep(avatar._id, 'party_ready');
      
      if (!result) {
        return this._errorEmbed('Failed to activate solo mode');
      }

      if (result.isQuestComplete) {
        return this.tutorialQuestService.formatCompletionMessage(result.totalXpEarned);
      }

      const nextStepEmbed = this.tutorialQuestService.formatStepMessage(
        result.nextStep,
        this.tutorialQuestService.getSteps().indexOf(result.nextStep) + 1,
        this.tutorialQuestService.getSteps().length
      );

      nextStepEmbed.embeds[0].author = { name: '🎭 Solo Mode Activated!' };
      nextStepEmbed.embeds[0].description = 
        'You\'ve chosen to adventure alone. You can still create or join a party later!\n\n' + 
        (nextStepEmbed.embeds[0].description || '');

      return nextStepEmbed;
    } catch (e) {
      this.logger?.error?.('[TutorialTool] Solo error:', e);
      return this._errorEmbed(`Failed to enable solo mode: ${e.message}`);
    }
  }

  /**
   * Skip the current tutorial step (for optional steps only)
   */
  async skipCurrentStep(avatar) {
    try {
      const current = await this.tutorialQuestService.getCurrentStep(avatar._id);
      
      if (!current || current.completed) {
        return this.showStatus(avatar);
      }

      // Only allow skipping optional steps
      if (!current.step.optional) {
        return {
          embeds: [{
            title: '⚠️ Cannot Skip',
            description: `**${current.step.title}** is a required step and cannot be skipped.`,
            color: 0xFBBF24,
            fields: [{
              name: '💡 Hint',
              value: current.step.hint || 'Complete this step to continue.',
              inline: false
            }],
            footer: { text: 'Only optional steps can be skipped' }
          }]
        };
      }

      // Skip by triggering completion
      const result = await this.tutorialQuestService.advanceStep(avatar._id, current.step.trigger);
      
      if (!result) {
        return this._errorEmbed('Failed to skip step');
      }

      if (result.isQuestComplete) {
        return this.tutorialQuestService.formatCompletionMessage(result.totalXpEarned);
      }

      const nextStepEmbed = this.tutorialQuestService.formatStepMessage(
        result.nextStep,
        this.tutorialQuestService.getSteps().indexOf(result.nextStep) + 1,
        this.tutorialQuestService.getSteps().length
      );

      nextStepEmbed.embeds[0].author = { name: `⏭️ Skipped: ${current.step.title}` };

      return nextStepEmbed;
    } catch (e) {
      this.logger?.error?.('[TutorialTool] Skip error:', e);
      return this._errorEmbed(`Failed to skip step: ${e.message}`);
    }
  }

  /**
   * Advance to next step (for optional steps)
   */
  async advanceNext(avatar) {
    // Same as skip for now
    return this.skipCurrentStep(avatar);
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
      
      // Check if user already has a character sheet
      const hasCharacter = !!(await this.characterService?.getSheet?.(avatar._id));

      if (!current) {
        const response = {
          embeds: [{
            title: '📚 Tutorial Quest',
            description: 'You haven\'t started the tutorial yet!',
            color: 0x6B7280, // Gray
            fields: [{
              name: '🚀 Get Started',
              value: 'Click the button below or type `📚 tutorial start` to begin!',
              inline: false
            }]
          }]
        };
        const buttons = createActionMenu([
          { id: 'dnd_tutorial_start', label: 'Start Tutorial', emoji: '📚' }
        ]);
        return addEmbedTextSummary(addComponentsToResponse(response, buttons));
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
            footer: { text: 'Ready for adventure!' }
          }]
        };
        if (current.autoAdvanced) {
          completedEmbed.embeds[0].author = { name: '✨ Progress detected! Skipped completed steps.' };
        }
        // Add post-tutorial action buttons
        const buttons = createTutorialButtons({ isComplete: true, hasCharacter });
        return addEmbedTextSummary(addComponentsToResponse(completedEmbed, buttons));
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
      
      // Add contextual buttons
      const buttons = createTutorialButtons({ 
        canSkip: current.step.optional, 
        stepTrigger: current.step.trigger,
        hasCharacter
      });
      return addEmbedTextSummary(addComponentsToResponse(stepEmbed, buttons));
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

      // Check if user already has a character sheet
      const hasCharacter = !!(await this.characterService?.getSheet?.(avatar._id));

      if (result.isQuestComplete) {
        const completionEmbed = this.tutorialQuestService.formatCompletionMessage(result.totalXpEarned);
        // Add post-tutorial action buttons
        const buttons = createTutorialButtons({ isComplete: true, hasCharacter });
        return addEmbedTextSummary(addComponentsToResponse(completionEmbed, buttons));
      }

      const nextStepEmbed = this.tutorialQuestService.formatStepMessage(
        result.nextStep,
        this.tutorialQuestService.getSteps().indexOf(result.nextStep) + 1,
        this.tutorialQuestService.getSteps().length
      );

      // Add celebration if XP was earned (and note auto-advanced steps)
      if (result.xpEarned > 0) {
        const autoNote = result.autoAdvanced 
          ? ` (skipped ${result.autoAdvancedSteps.length} completed step${result.autoAdvancedSteps.length > 1 ? 's' : ''})` 
          : '';
        nextStepEmbed.embeds[0].author = {
          name: `✨ Step complete! +${result.xpEarned} XP${autoNote}`
        };
      } else if (result.autoAdvanced) {
        nextStepEmbed.embeds[0].author = {
          name: `✨ Skipped ${result.autoAdvancedSteps.length} completed step${result.autoAdvancedSteps.length > 1 ? 's' : ''}!`
        };
      }
      
      // Add contextual buttons for next step
      const buttons = createTutorialButtons({ 
        canSkip: result.nextStep.optional, 
        stepTrigger: result.nextStep.trigger,
        hasCharacter
      });
      return addEmbedTextSummary(addComponentsToResponse(nextStepEmbed, buttons));
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
      
      // Add button for first step
      const buttons = createTutorialButtons({ 
        canSkip: result.step.optional, 
        stepTrigger: result.step.trigger 
      });
      return addEmbedTextSummary(addComponentsToResponse(stepEmbed, buttons));
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
