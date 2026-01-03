/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * TutorialTool - Discord tool for the tutorial quest system
 * Modern button-based ephemeral UI for guided onboarding
 */

import { BasicTool } from '../BasicTool.mjs';
import { 
  createTutorialButtons, 
  addComponentsToResponse, 
  createActionMenu,
  DND_BUTTON_STYLES
} from '../dndButtonComponents.mjs';

// Color palette for consistent modern UI
const COLORS = {
  PRIMARY: 0x6366F1,    // Indigo - main actions
  SUCCESS: 0x10B981,    // Green - completion
  WARNING: 0xFBBF24,    // Yellow - warnings
  ERROR: 0xEF4444,      // Red - errors
  MUTED: 0x6B7280,      // Gray - inactive
  INFO: 0x3B82F6        // Blue - info
};

export class TutorialTool extends BasicTool {
  constructor({ tutorialQuestService, characterService, partyService, dungeonService, discordService, logger }) {
    super();
    this.tutorialQuestService = tutorialQuestService;
    this.characterService = characterService;
    this.partyService = partyService;
    this.dungeonService = dungeonService;
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
   * Wrap response with ephemeral flag for user-only visibility
   * @private
   */
  _ephemeral(response) {
    if (typeof response === 'string') {
      return { message: response, ephemeral: true };
    }
    return { ...response, ephemeral: true };
  }

  getDescription() {
    return 'Begin or continue the D&D tutorial quest';
  }

  getUsage() {
    return '🎓 (opens tutorial menu)';
  }

  getHelp() {
    return {
      description: 'Begin or continue the D&D tutorial quest that teaches you the basics.',
      examples: ['🎓']
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

    // All tutorial responses use consistent UI
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
        const buttons = createTutorialButtons({ 
          canSkip: current.step.optional, 
          stepTrigger: current.step.trigger,
          hasCharacter: !!(await this.characterService?.getSheet?.(avatar._id)),
          isConditionMet: current.isConditionMet
        });
        return addComponentsToResponse({
          embeds: [{
            title: '🎭 Solo Mode',
            description: 'Solo mode is only available during the party formation step.',
            color: COLORS.WARNING,
            fields: [{
              name: '📍 Current Step',
              value: current.step.title,
              inline: false
            }]
          }]
        }, buttons);
      }

      // Advance past party step
      const result = await this.tutorialQuestService.advanceStep(avatar._id, 'party_ready');
      
      if (!result) {
        return this._errorEmbed('Failed to activate solo mode');
      }

      const hasCharacter = !!(await this.characterService?.getSheet?.(avatar._id));

      if (result.isQuestComplete) {
        const completionEmbed = this.tutorialQuestService.formatCompletionMessage(result.totalXpEarned);
        const buttons = createTutorialButtons({ isComplete: true, hasCharacter });
        return addComponentsToResponse(completionEmbed, buttons);
      }

      const nextStepConditionMet = await this.tutorialQuestService._isConditionMet(avatar._id, result.nextStep);
      const stepEmbed = this._buildStepEmbed(result.nextStep, avatar, {
        stepNumber: this.tutorialQuestService.getSteps().indexOf(result.nextStep) + 1,
        totalSteps: this.tutorialQuestService.getSteps().length,
        headerIcon: '🎭',
        headerText: 'Solo Mode Activated!',
        subText: 'Adventuring alone. You can still form a party later!',
        xpEarned: result.xpEarned,
        isConditionMet: nextStepConditionMet
      });

      const buttons = createTutorialButtons({ 
        canSkip: result.nextStep.optional, 
        stepTrigger: result.nextStep.trigger,
        hasCharacter,
        isConditionMet: nextStepConditionMet
      });
      return addComponentsToResponse(stepEmbed, buttons);
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

      const hasCharacter = !!(await this.characterService?.getSheet?.(avatar._id));

      // Only allow skipping optional steps
      if (!current.step.optional) {
        const buttons = createTutorialButtons({ 
          canSkip: false, 
          stepTrigger: current.step.trigger,
          hasCharacter,
          isConditionMet: current.isConditionMet
        });
        return addComponentsToResponse({
          embeds: [{
            title: '⚠️ Required Step',
            description: `**${current.step.title}** must be completed to continue.`,
            color: COLORS.WARNING,
            fields: [{
              name: '💡 How to proceed',
              value: current.step.instruction,
              inline: false
            }]
          }]
        }, buttons);
      }

      // Skip by triggering completion
      const result = await this.tutorialQuestService.advanceStep(avatar._id, current.step.trigger);
      
      if (!result) {
        return this._errorEmbed('Failed to skip step');
      }

      if (result.isQuestComplete) {
        const completionEmbed = this.tutorialQuestService.formatCompletionMessage(result.totalXpEarned);
        const buttons = createTutorialButtons({ isComplete: true, hasCharacter });
        return addComponentsToResponse(completionEmbed, buttons);
      }

      const nextStepConditionMet = await this.tutorialQuestService._isConditionMet(avatar._id, result.nextStep);
      const stepEmbed = this._buildStepEmbed(result.nextStep, avatar, {
        stepNumber: this.tutorialQuestService.getSteps().indexOf(result.nextStep) + 1,
        totalSteps: this.tutorialQuestService.getSteps().length,
        headerIcon: '⏭️',
        headerText: `Skipped: ${current.step.title}`,
        isConditionMet: nextStepConditionMet
      });

      const buttons = createTutorialButtons({ 
        canSkip: result.nextStep.optional, 
        stepTrigger: result.nextStep.trigger,
        hasCharacter,
        isConditionMet: nextStepConditionMet
      });
      return addComponentsToResponse(stepEmbed, buttons);
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

      const hasCharacter = !!(await this.characterService?.getSheet?.(avatar._id));

      // Verify condition is met
      if (!current.isConditionMet) {
        const buttons = createTutorialButtons({ 
          canSkip: current.step.optional, 
          stepTrigger: current.step.trigger,
          hasCharacter,
          isConditionMet: false
        });
        return addComponentsToResponse({
          embeds: [{
            title: '📋 Step In Progress',
            description: `Complete **${current.step.title}** to continue.`,
            color: COLORS.INFO,
            fields: [{
              name: '📝 Instructions',
              value: current.step.instruction,
              inline: false
            }]
          }]
        }, buttons);
      }

      // Advance by triggering completion
      const result = await this.tutorialQuestService.advanceStep(avatar._id, current.step.trigger);
      
      if (!result) {
        return this._errorEmbed('Failed to complete step');
      }

      if (result.isQuestComplete) {
        const completionEmbed = this.tutorialQuestService.formatCompletionMessage(result.totalXpEarned);
        const buttons = createTutorialButtons({ isComplete: true, hasCharacter });
        return addComponentsToResponse(completionEmbed, buttons);
      }

      const nextStepConditionMet = await this.tutorialQuestService._isConditionMet(avatar._id, result.nextStep);
      const stepEmbed = this._buildStepEmbed(result.nextStep, avatar, {
        stepNumber: this.tutorialQuestService.getSteps().indexOf(result.nextStep) + 1,
        totalSteps: this.tutorialQuestService.getSteps().length,
        headerIcon: '✅',
        headerText: result.xpEarned > 0 ? `+${result.xpEarned} XP earned!` : 'Step complete!',
        isConditionMet: nextStepConditionMet
      });

      const buttons = createTutorialButtons({ 
        canSkip: result.nextStep.optional, 
        stepTrigger: result.nextStep.trigger,
        hasCharacter,
        isConditionMet: nextStepConditionMet
      });
      return addComponentsToResponse(stepEmbed, buttons);
    } catch (e) {
      this.logger?.error?.('[TutorialTool] Complete step error:', e);
      return this._errorEmbed(`Failed to complete step: ${e.message}`);
    }
  }

  /**
   * Advance to next step (for optional steps)
   */
  async advanceNext(avatar) {
    return this.skipCurrentStep(avatar);
  }

  /**
   * Build a modern step embed with consistent styling
   * @private
   */
  _buildStepEmbed(step, avatar, options = {}) {
    const {
      stepNumber = 1,
      totalSteps = 1,
      headerIcon = '📖',
      headerText = null,
      subText = null,
      isConditionMet = false,
      totalXpEarned = 0,
      dungeonThreadId = null
    } = options;

    const progressBar = this._buildProgressBar(stepNumber, totalSteps);
    
    let description = step.description;
    if (subText) {
      description = `*${subText}*\n\n${description}`;
    }

    // Add dungeon thread link for dungeon-context steps
    let instruction = step.instruction;
    if (step.context === 'dungeon' && dungeonThreadId) {
      instruction = `👉 **Continue in the dungeon thread:** <#${dungeonThreadId}>\n\n${instruction}`;
    }

    const embed = {
      title: `${step.optional ? '○' : '●'} ${step.title}`,
      description,
      color: isConditionMet ? COLORS.SUCCESS : COLORS.PRIMARY,
      fields: [{
        name: isConditionMet ? '✅ Ready to complete' : '📝 Instructions',
        value: isConditionMet ? 'Click **Complete Step** to continue!' : instruction,
        inline: false
      }],
      footer: { 
        text: `Step ${stepNumber}/${totalSteps} ${progressBar} • ${step.xpReward} XP${totalXpEarned > 0 ? ` • Total: ${totalXpEarned} XP` : ''}`
      }
    };

    if (headerText) {
      embed.author = { name: `${headerIcon} ${headerText}` };
    }

    return { embeds: [embed] };
  }

  /**
   * Build a text progress bar
   * @private
   */
  _buildProgressBar(current, total) {
    const filled = Math.round((current / total) * 5);
    const empty = 5 - filled;
    return '▓'.repeat(filled) + '░'.repeat(empty);
  }

  /**
   * Get the active dungeon thread ID for an avatar
   * @private
   */
  async _getDungeonThreadId(avatarId) {
    try {
      const sheet = await this.characterService?.getSheet?.(avatarId);
      if (!sheet?.partyId) return null;
      
      const dungeon = await this.dungeonService?.getActiveDungeon?.(sheet.partyId);
      return dungeon?.threadId || null;
    } catch {
      return null;
    }
  }

  async startTutorial(avatar) {
    try {
      const result = await this.tutorialQuestService.startTutorial(avatar._id);
      const hasCharacter = !!(await this.characterService?.getSheet?.(avatar._id));

      // Get current step info
      const current = await this.tutorialQuestService.getCurrentStep(avatar._id);

      if (current.completed) {
        const buttons = createTutorialButtons({ isComplete: true, hasCharacter });
        return addComponentsToResponse({
          embeds: [{
            title: '🏆 Tutorial Complete!',
            description: 'You\'ve mastered the basics, adventurer!',
            color: COLORS.SUCCESS,
            fields: [
              { name: '⭐ XP Earned', value: `${current.progress.totalXpEarned} XP`, inline: true },
              { name: '📊 Status', value: 'Ready for adventure!', inline: true }
            ],
            footer: { text: 'Click Replay to start over' }
          }]
        }, buttons);
      }

      const stepEmbed = this._buildStepEmbed(current.step, avatar, {
        stepNumber: current.stepNumber,
        totalSteps: current.totalSteps,
        headerIcon: result.started ? '⚔️' : '📖',
        headerText: result.started ? `Welcome, ${avatar.name}!` : 'Resuming Tutorial',
        subText: result.started ? 'Begin your journey to become a hero.' : null,
        isConditionMet: current.isConditionMet,
        totalXpEarned: current.progress.totalXpEarned
      });

      const buttons = createTutorialButtons({ 
        canSkip: current.step.optional, 
        stepTrigger: current.step.trigger,
        hasCharacter,
        isConditionMet: current.isConditionMet
      });
      return addComponentsToResponse(stepEmbed, buttons);
    } catch (e) {
      this.logger?.error?.('[TutorialTool] Start error:', e);
      return this._errorEmbed(`Failed to start tutorial: ${e.message}`);
    }
  }

  async showStatus(avatar) {
    try {
      const current = await this.tutorialQuestService.getCurrentStep(avatar._id);
      const hasCharacter = !!(await this.characterService?.getSheet?.(avatar._id));

      // Not started yet - show welcome screen
      if (!current) {
        const buttons = createActionMenu([
          { id: 'dnd_tutorial_start', label: 'Begin Tutorial', emoji: '🎓', style: DND_BUTTON_STYLES.SUCCESS }
        ]);
        return addComponentsToResponse({
          embeds: [{
            title: '🎓 Adventurer\'s Tutorial',
            description: 'Learn the ways of dungeon delving in this guided quest.',
            color: COLORS.PRIMARY,
            fields: [
              { 
                name: '📚 What You\'ll Learn', 
                value: '• Create your character\n• Form a party\n• Explore dungeons\n• Battle monsters', 
                inline: true 
              },
              { 
                name: '🎁 Rewards', 
                value: '• Experience points\n• Game knowledge\n• Adventure readiness', 
                inline: true 
              }
            ],
            footer: { text: 'Takes about 10 minutes' }
          }]
        }, buttons);
      }

      // Completed
      if (current.completed) {
        const buttons = createTutorialButtons({ isComplete: true, hasCharacter });
        return addComponentsToResponse({
          embeds: [{
            title: '🏆 Tutorial Complete!',
            description: 'You\'ve completed all tutorial steps.',
            color: COLORS.SUCCESS,
            fields: [
              { name: '⭐ Total XP', value: `${current.progress.totalXpEarned} XP`, inline: true },
              { name: '✅ Steps Done', value: `${current.totalSteps}/${current.totalSteps}`, inline: true }
            ],
            footer: { text: 'Ready for real adventures!' }
          }]
        }, buttons);
      }

      // In progress - show current step
      const stepEmbed = this._buildStepEmbed(current.step, avatar, {
        stepNumber: current.stepNumber,
        totalSteps: current.totalSteps,
        isConditionMet: current.isConditionMet,
        totalXpEarned: current.progress.totalXpEarned
      });

      const buttons = createTutorialButtons({ 
        canSkip: current.step.optional, 
        stepTrigger: current.step.trigger,
        hasCharacter,
        isConditionMet: current.isConditionMet
      });
      return addComponentsToResponse(stepEmbed, buttons);
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

      const hasCharacter = !!(await this.characterService?.getSheet?.(avatar._id));

      if (result.isQuestComplete) {
        const buttons = createTutorialButtons({ isComplete: true, hasCharacter });
        return addComponentsToResponse({
          embeds: [{
            title: '🎉 Tutorial Complete!',
            description: 'Congratulations! You\'ve completed the Adventurer\'s Tutorial.',
            color: COLORS.SUCCESS,
            fields: [
              { name: '⭐ Total XP', value: `${result.totalXpEarned} XP`, inline: true },
              { name: '🏅 Achievement', value: 'Tutorial Graduate', inline: true }
            ],
            footer: { text: 'You\'re ready for real adventures!' }
          }]
        }, buttons);
      }

      const nextStepConditionMet = await this.tutorialQuestService._isConditionMet(avatar._id, result.nextStep);
      const stepEmbed = this._buildStepEmbed(result.nextStep, avatar, {
        stepNumber: this.tutorialQuestService.getSteps().indexOf(result.nextStep) + 1,
        totalSteps: this.tutorialQuestService.getSteps().length,
        headerIcon: '✨',
        headerText: result.xpEarned > 0 ? `+${result.xpEarned} XP earned!` : 'Step complete!',
        isConditionMet: nextStepConditionMet
      });

      const buttons = createTutorialButtons({ 
        canSkip: result.nextStep.optional, 
        stepTrigger: result.nextStep.trigger,
        hasCharacter,
        isConditionMet: nextStepConditionMet
      });
      return addComponentsToResponse(stepEmbed, buttons);
    } catch (e) {
      this.logger?.error?.('[TutorialTool] Trigger error:', e);
      return this.showStatus(avatar);
    }
  }

  async resetTutorial(avatar) {
    try {
      const result = await this.tutorialQuestService.resetTutorial(avatar._id);
      const hasCharacter = !!(await this.characterService?.getSheet?.(avatar._id));
      const isConditionMet = await this.tutorialQuestService._isConditionMet(avatar._id, result.step);
      
      const stepEmbed = this._buildStepEmbed(result.step, avatar, {
        stepNumber: 1,
        totalSteps: this.tutorialQuestService.getSteps().length,
        headerIcon: '🔄',
        headerText: 'Tutorial Reset!',
        subText: 'Starting fresh...',
        isConditionMet
      });
      
      const buttons = createTutorialButtons({ 
        canSkip: result.step.optional, 
        stepTrigger: result.step.trigger,
        hasCharacter,
        isConditionMet
      });
      return addComponentsToResponse(stepEmbed, buttons);
    } catch (e) {
      this.logger?.error?.('[TutorialTool] Reset error:', e);
      return this._errorEmbed(`Failed to reset: ${e.message}`);
    }
  }

  /**
   * Create a styled error embed
   * @private
   */
  _errorEmbed(message) {
    return {
      embeds: [{
        title: '❌ Error',
        description: message,
        color: COLORS.ERROR
      }]
    };
  }
}
