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
    this.emoji = '🎓';
    this.description = 'Begin or continue the D&D tutorial quest';
    this.isDndTool = true;
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

    case 'complete':
      response = await this.completeCurrentStep(avatar);
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
   * Complete the current step when its condition is already met
   */
  async completeCurrentStep(avatar) {
    try {
      const current = await this.tutorialQuestService.getCurrentStep(avatar._id);
      
      if (!current || current.completed) {
        return this.showStatus(avatar);
      }

      // Verify condition is met
      if (!current.isConditionMet) {
        return {
          embeds: [{
            title: '⚠️ Step Not Complete',
            description: `**${current.step.title}** requirements haven't been met yet.`,
            color: 0xFBBF24,
            fields: [{
              name: '📋 What to do',
              value: current.step.instruction,
              inline: false
            }],
            footer: { text: 'Complete the step requirements first' }
          }]
        };
      }

      // Advance by triggering completion
      const result = await this.tutorialQuestService.advanceStep(avatar._id, current.step.trigger);
      
      if (!result) {
        return this._errorEmbed('Failed to complete step');
      }

      // Check if user already has a character sheet
      const hasCharacter = !!(await this.characterService?.getSheet?.(avatar._id));

      if (result.isQuestComplete) {
        const completionEmbed = this.tutorialQuestService.formatCompletionMessage(result.totalXpEarned);
        const buttons = createTutorialButtons({ isComplete: true, hasCharacter });
        return addEmbedTextSummary(addComponentsToResponse(completionEmbed, buttons));
      }

      const nextStepEmbed = this.tutorialQuestService.formatStepMessage(
        result.nextStep,
        this.tutorialQuestService.getSteps().indexOf(result.nextStep) + 1,
        this.tutorialQuestService.getSteps().length
      );

      // Check if the next step's condition is already met
      const nextStepConditionMet = await this.tutorialQuestService._isConditionMet(avatar._id, result.nextStep);

      nextStepEmbed.embeds[0].author = { 
        name: result.xpEarned > 0 
          ? `✅ Step complete! +${result.xpEarned} XP` 
          : '✅ Step complete!'
      };

      // If next step is also already complete, indicate that
      if (nextStepConditionMet) {
        nextStepEmbed.embeds[0].color = 0x10B981;
      }

      const buttons = createTutorialButtons({ 
        canSkip: result.nextStep.optional, 
        stepTrigger: result.nextStep.trigger,
        hasCharacter,
        isConditionMet: nextStepConditionMet
      });
      return addEmbedTextSummary(addComponentsToResponse(nextStepEmbed, buttons));
    } catch (e) {
      this.logger?.error?.('[TutorialTool] Complete step error:', e);
      return this._errorEmbed(`Failed to complete step: ${e.message}`);
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
        // Tutorial already exists, get current step
        const current = await this.tutorialQuestService.getCurrentStep(avatar._id);
        const hasCharacter = !!(await this.characterService?.getSheet?.(avatar._id));
        
        if (current.completed) {
          const completedEmbed = {
            embeds: [{
              title: '✅ Tutorial Already Complete!',
              description: 'You\'ve already completed the tutorial.',
              color: 0x10B981,
              footer: { text: 'Click Replay Tutorial to start over' }
            }]
          };
          const buttons = createTutorialButtons({ isComplete: true, hasCharacter });
          return addEmbedTextSummary(addComponentsToResponse(completedEmbed, buttons));
        }
        
        const stepEmbed = this.tutorialQuestService.formatStepMessage(
          current.step, current.stepNumber, current.totalSteps
        );
        
        if (current.isConditionMet) {
          stepEmbed.embeds[0].author = { name: '✅ Step already complete! Click Complete Step to continue.' };
          stepEmbed.embeds[0].color = 0x10B981;
        }
        
        const buttons = createTutorialButtons({ 
          canSkip: current.step.optional, 
          stepTrigger: current.step.trigger,
          hasCharacter,
          isConditionMet: current.isConditionMet
        });
        return addEmbedTextSummary(addComponentsToResponse(stepEmbed, buttons));
      }

      // New tutorial started - check current step
      const current = await this.tutorialQuestService.getCurrentStep(avatar._id);
      const hasCharacter = !!(await this.characterService?.getSheet?.(avatar._id));
      
      if (current.completed) {
        const completedEmbed = {
          embeds: [{
            title: '✅ Tutorial Complete!',
            description: 'You\'ve already done everything! Great job!',
            color: 0x10B981,
            fields: [{ name: '⭐ XP Earned', value: `${current.progress.totalXpEarned} XP`, inline: true }],
            footer: { text: 'Click Replay Tutorial to start over' }
          }]
        };
        const buttons = createTutorialButtons({ isComplete: true, hasCharacter });
        return addEmbedTextSummary(addComponentsToResponse(completedEmbed, buttons));
      }

      const stepEmbed = this.tutorialQuestService.formatStepMessage(
        current.step, current.stepNumber, current.totalSteps
      );
      
      // Add welcome header to the embed
      if (current.isConditionMet) {
        stepEmbed.embeds[0].author = { name: '✅ Step already complete! Click Complete Step to continue.' };
        stepEmbed.embeds[0].color = 0x10B981;
      } else {
        stepEmbed.embeds[0].author = { name: `⚔️ The Adventurer's Tutorial Quest` };
        stepEmbed.embeds[0].description = `Welcome, **${avatar.name}**!\n\n` +
          `This quest will teach you the ways of the adventurer.\n` +
          `Complete each step to earn XP and unlock your potential.\n\n` +
          `---\n\n` + (stepEmbed.embeds[0].description || '');
      }
      
      const buttons = createTutorialButtons({ 
        canSkip: current.step.optional, 
        stepTrigger: current.step.trigger,
        hasCharacter,
        isConditionMet: current.isConditionMet
      });
      return addEmbedTextSummary(addComponentsToResponse(stepEmbed, buttons));
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
              value: 'Click **Start Tutorial** below to begin your adventure!',
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
            description: 'You finished the tutorial.',
            color: 0x10B981, // Green
            fields: [{
              name: '⭐ Total XP Earned',
              value: `${current.progress.totalXpEarned} XP`,
              inline: true
            }],
            footer: { text: 'Ready for adventure!' }
          }]
        };
        // Add post-tutorial action buttons
        const buttons = createTutorialButtons({ isComplete: true, hasCharacter });
        return addEmbedTextSummary(addComponentsToResponse(completedEmbed, buttons));
      }

      const stepEmbed = this.tutorialQuestService.formatStepMessage(
        current.step, current.stepNumber, current.totalSteps
      );

      // Add notification if step condition is already met
      if (current.isConditionMet) {
        stepEmbed.embeds[0].author = { name: '✅ Step already complete! Click Complete Step to continue.' };
        stepEmbed.embeds[0].color = 0x10B981; // Green
      }

      // Add XP info to footer
      stepEmbed.embeds[0].footer.text += ` • ⭐ ${current.progress.totalXpEarned} XP earned`;
      
      // Add contextual buttons
      const buttons = createTutorialButtons({ 
        canSkip: current.step.optional, 
        stepTrigger: current.step.trigger,
        hasCharacter,
        isConditionMet: current.isConditionMet
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

      // Check if the next step's condition is already met
      const nextStepConditionMet = await this.tutorialQuestService._isConditionMet(avatar._id, result.nextStep);

      // Add celebration if XP was earned
      if (result.xpEarned > 0) {
        nextStepEmbed.embeds[0].author = {
          name: `✨ Step complete! +${result.xpEarned} XP`
        };
      }
      
      // If next step is already complete, show that
      if (nextStepConditionMet) {
        nextStepEmbed.embeds[0].author = { 
          name: result.xpEarned > 0 
            ? `✨ +${result.xpEarned} XP • Next step already complete!`
            : '✅ Step already complete! Click Complete Step to continue.'
        };
        nextStepEmbed.embeds[0].color = 0x10B981;
      }
      
      // Add contextual buttons for next step
      const buttons = createTutorialButtons({ 
        canSkip: result.nextStep.optional, 
        stepTrigger: result.nextStep.trigger,
        hasCharacter,
        isConditionMet: nextStepConditionMet
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
      const hasCharacter = !!(await this.characterService?.getSheet?.(avatar._id));
      
      const stepEmbed = this.tutorialQuestService.formatStepMessage(
        result.step, 1, this.tutorialQuestService.getSteps().length
      );
      
      // Check if first step's condition is already met (e.g., has character)
      const isConditionMet = await this.tutorialQuestService._isConditionMet(avatar._id, result.step);
      
      stepEmbed.embeds[0].author = { name: '🔄 Tutorial Reset!' };
      stepEmbed.embeds[0].description = 'Starting fresh...\n\n' + (stepEmbed.embeds[0].description || '');
      
      if (isConditionMet) {
        stepEmbed.embeds[0].color = 0x10B981;
      }
      
      // Add button for first step
      const buttons = createTutorialButtons({ 
        canSkip: result.step.optional, 
        stepTrigger: result.step.trigger,
        hasCharacter,
        isConditionMet
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
