/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * TutorialQuestService - Guided onboarding quest for new D&D players
 */

import { ObjectId } from 'mongodb';

const TUTORIAL_STEPS = [
  {
    id: 'welcome',
    title: 'Welcome, Adventurer!',
    description: 'Welcome to the realm! Let me guide you through becoming a hero.',
    instruction: 'Say **"ready"** to begin your journey.',
    trigger: 'ready',
    xpReward: 0
  },
  {
    id: 'create_character',
    title: 'Choose Your Path',
    description: 'Every hero needs a race and class. Your choices shape your destiny.',
    instruction: 'Create your character with:\n📜 `character create <race> <class>`\n\n**Races:** human, elf, dwarf, halfling\n**Classes:** fighter, wizard, rogue, cleric, ranger, bard',
    trigger: 'character_created',
    xpReward: 50
  },
  {
    id: 'view_sheet',
    title: 'Know Thyself',
    description: 'Your character sheet shows your abilities, spells, and features.',
    instruction: 'View your character sheet:\n📜 `character sheet`',
    trigger: 'sheet_viewed',
    xpReward: 25
  },
  {
    id: 'learn_spells',
    title: 'The Art of Magic',
    description: 'Spellcasters wield arcane or divine power.',
    instruction: 'View your available spells:\n🪄 `cast`',
    trigger: 'spells_checked',
    optional: true,
    autoSkipCondition: 'not_spellcaster',
    xpReward: 25
  },
  {
    id: 'create_party',
    title: 'Strength in Numbers',
    description: 'Dungeons are dangerous. Form a party with fellow adventurers!',
    instruction: 'Create a party:\n👥 `party create <name>`\n\nOr say **"solo"** to adventure alone.',
    trigger: 'party_ready',
    xpReward: 25
  },
  {
    id: 'enter_dungeon',
    title: 'Into the Depths',
    description: 'The Tutorial Crypts await. A simple dungeon to test your mettle.',
    instruction: 'Enter the tutorial dungeon:\n🏰 `dungeon enter easy`',
    trigger: 'dungeon_entered',
    xpReward: 50
  },
  {
    id: 'view_map',
    title: 'Know Your Surroundings',
    description: 'The dungeon map shows rooms, exits, and your position.',
    instruction: 'View the dungeon map:\n🏰 `dungeon map`',
    trigger: 'map_viewed',
    xpReward: 25
  },
  {
    id: 'first_combat',
    title: 'Steel and Spell',
    description: 'Enemies block your path! Use attacks or spells to defeat them.',
    instruction: 'Fight the enemies in this room:\n🗡️ `attack <enemy>` or 🪄 `cast <spell> <enemy>`\n\nWhen victorious:\n🏰 `dungeon clear`',
    trigger: 'room_cleared',
    xpReward: 100
  },
  {
    id: 'explore',
    title: 'Deeper We Go',
    description: 'Move through the dungeon, clearing rooms and collecting treasure.',
    instruction: 'Move to the next room:\n🏰 `dungeon move <room_id>`\n\nCollect treasure:\n🏰 `dungeon loot`',
    trigger: 'explored',
    xpReward: 50
  },
  {
    id: 'complete_dungeon',
    title: 'Victory!',
    description: 'You\'ve conquered the Tutorial Crypts! You\'re ready for greater challenges.',
    instruction: 'Defeat the boss and complete the dungeon!',
    trigger: 'dungeon_complete',
    xpReward: 200
  },
  {
    id: 'rest',
    title: 'Rest and Recovery',
    description: 'After battle, rest to restore your abilities.',
    instruction: 'Take a long rest:\n📜 `character rest long`',
    trigger: 'rested',
    xpReward: 25
  }
];

export class TutorialQuestService {
  constructor({ databaseService, characterService, partyService, dungeonService, discordService, logger }) {
    this.databaseService = databaseService;
    this.characterService = characterService;
    this.partyService = partyService;
    this.dungeonService = dungeonService;
    this.discordService = discordService;
    this.logger = logger;
    this._collection = null;
  }

  async collection() {
    if (!this._collection) {
      const db = await this.databaseService.getDatabase();
      this._collection = db.collection('tutorial_progress');
      await this._ensureIndexes();
    }
    return this._collection;
  }

  async _ensureIndexes() {
    try {
      await this._collection.createIndex({ avatarId: 1 }, { unique: true });
    } catch (e) {
      this.logger?.warn?.('[TutorialQuestService] Index creation:', e.message);
    }
  }

  async getProgress(avatarId) {
    const col = await this.collection();
    return col.findOne({ avatarId: new ObjectId(avatarId) });
  }

  async startTutorial(avatarId) {
    const existing = await this.getProgress(avatarId);
    if (existing) {
      return { started: false, message: 'Tutorial already in progress.', progress: existing };
    }

    const progress = {
      avatarId: new ObjectId(avatarId),
      currentStep: 0,
      completedSteps: [],
      totalXpEarned: 0,
      startedAt: new Date(),
      completedAt: null
    };

    const col = await this.collection();
    await col.insertOne(progress);

    this.logger?.info?.(`[TutorialQuestService] Started tutorial for avatar ${avatarId}`);
    return { started: true, progress, step: TUTORIAL_STEPS[0] };
  }

  async getCurrentStep(avatarId) {
    const progress = await this.getProgress(avatarId);
    if (!progress) return null;
    if (progress.completedAt) return { completed: true, progress };
    
    // Auto-advance through already-completed conditions
    let currentStepIndex = progress.currentStep;
    let autoAdvanced = false;
    
    while (currentStepIndex < TUTORIAL_STEPS.length) {
      const step = TUTORIAL_STEPS[currentStepIndex];
      const isMet = await this._isConditionMet(avatarId, step);
      
      if (isMet) {
        // Condition already met, advance silently
        const xpEarned = step.xpReward || 0;
        currentStepIndex++;
        autoAdvanced = true;
        
        // Update progress in DB
        const col = await this.collection();
        await col.updateOne(
          { avatarId: new ObjectId(avatarId) },
          { 
            $set: { currentStep: currentStepIndex },
            $push: { completedSteps: step.id },
            $inc: { totalXpEarned: xpEarned }
          }
        );
        
        // Award XP if character exists
        if (xpEarned > 0) {
          try {
            await this.characterService?.awardXP?.(avatarId, xpEarned);
          } catch { /* ignore */ }
        }
        
        this.logger?.info?.(`[TutorialQuestService] Auto-advanced past ${step.id} for avatar ${avatarId}`);
      } else {
        break;
      }
    }
    
    // Check if auto-advance completed the tutorial
    if (currentStepIndex >= TUTORIAL_STEPS.length) {
      const col = await this.collection();
      await col.updateOne(
        { avatarId: new ObjectId(avatarId) },
        { $set: { completedAt: new Date() } }
      );
      const updatedProgress = await this.getProgress(avatarId);
      return { completed: true, progress: updatedProgress, autoAdvanced };
    }
    
    const step = TUTORIAL_STEPS[currentStepIndex];
    const updatedProgress = autoAdvanced ? await this.getProgress(avatarId) : progress;
    return { step, progress: updatedProgress, stepNumber: currentStepIndex + 1, totalSteps: TUTORIAL_STEPS.length, autoAdvanced };
  }

  /**
   * Check if a step's condition is already met
   * @private
   */
  async _isConditionMet(avatarId, step) {
    try {
      switch (step.trigger) {
        case 'character_created':
        case 'sheet_viewed': {
          // Check if character sheet exists
          const sheet = await this.characterService?.getSheet?.(avatarId);
          return !!sheet;
        }
        case 'party_ready': {
          // Check if in a party
          const sheet = await this.characterService?.getSheet?.(avatarId);
          return !!sheet?.partyId;
        }
        case 'dungeon_entered':
        case 'map_viewed':
        case 'room_cleared':
        case 'explored':
        case 'dungeon_complete': {
          // Check if active dungeon exists
          const sheet = await this.characterService?.getSheet?.(avatarId);
          if (!sheet?.partyId) return false;
          const dungeon = await this.dungeonService?.getActiveDungeon?.(sheet.partyId);
          if (step.trigger === 'dungeon_entered' || step.trigger === 'map_viewed') {
            return !!dungeon;
          }
          return false; // Other dungeon triggers require active action
        }
        case 'spells_checked': {
          // Auto-skip for non-spellcasters
          const sheet = await this.characterService?.getSheet?.(avatarId);
          if (!sheet) return false;
          // If no spellcasting, auto-skip this step
          return !sheet.spellcasting;
        }
        case 'rested':
          // Can't auto-detect rest
          return false;
        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  async advanceStep(avatarId, triggerId) {
    const progress = await this.getProgress(avatarId);
    if (!progress || progress.completedAt) return null;

    const currentStep = TUTORIAL_STEPS[progress.currentStep];
    
    // Check if trigger matches (or step is optional and skipped)
    const isMatch = currentStep.trigger === triggerId || 
                    (currentStep.optional && (triggerId === 'skip' || triggerId === currentStep.trigger));
    
    if (!isMatch) return null;

    const xpEarned = currentStep.xpReward || 0;
    const nextStepIndex = progress.currentStep + 1;
    const isComplete = nextStepIndex >= TUTORIAL_STEPS.length;

    const updates = {
      currentStep: nextStepIndex,
      $push: { completedSteps: currentStep.id },
      $inc: { totalXpEarned: xpEarned }
    };

    if (isComplete) {
      updates.completedAt = new Date();
    }

    const col = await this.collection();
    await col.updateOne(
      { avatarId: new ObjectId(avatarId) },
      { 
        $set: { currentStep: nextStepIndex, ...(isComplete ? { completedAt: new Date() } : {}) },
        $push: { completedSteps: currentStep.id },
        $inc: { totalXpEarned: xpEarned }
      }
    );

    // Award XP through character service if character exists
    if (xpEarned > 0) {
      try {
        await this.characterService.awardXP(avatarId, xpEarned);
      } catch {
        // Character might not exist yet
      }
    }

    const nextStep = isComplete ? null : TUTORIAL_STEPS[nextStepIndex];

    return {
      completed: currentStep,
      xpEarned,
      isQuestComplete: isComplete,
      nextStep,
      totalXpEarned: progress.totalXpEarned + xpEarned
    };
  }

  async skipTutorial(avatarId) {
    const col = await this.collection();
    await col.updateOne(
      { avatarId: new ObjectId(avatarId) },
      { $set: { completedAt: new Date(), skipped: true } },
      { upsert: true }
    );
    return { skipped: true };
  }

  async resetTutorial(avatarId) {
    const col = await this.collection();
    await col.deleteOne({ avatarId: new ObjectId(avatarId) });
    return this.startTutorial(avatarId);
  }

  formatStepMessage(step, stepNumber, totalSteps) {
    const progressBar = this._makeProgressBar(stepNumber - 1, totalSteps);
    
    return {
      embeds: [{
        title: `📖 ${step.title}`,
        description: step.description,
        color: 0x7C3AED, // Purple
        fields: [
          {
            name: '📋 What to do',
            value: step.instruction,
            inline: false
          }
        ],
        footer: {
          text: `Step ${stepNumber}/${totalSteps} ${progressBar}${step.optional ? ' • Optional - say "skip" to continue' : ''}`
        }
      }]
    };
  }

  formatCompletionMessage(totalXp) {
    return {
      embeds: [{
        title: '🎉 TUTORIAL COMPLETE! 🎉',
        description: 'You\'ve mastered the basics of adventuring!',
        color: 0x10B981, // Green
        fields: [
          {
            name: '🏆 Rewards',
            value: `⭐ **${totalXp} XP** earned\n🏅 Title: *Apprentice Adventurer*`,
            inline: true
          },
          {
            name: '🚀 What\'s Next',
            value: '• `👥 party invite <name>` - Add friends\n• `🏰 dungeon enter medium` - Harder dungeons\n• Learn new spells & abilities\n• Join or start a campaign!',
            inline: true
          }
        ],
        footer: {
          text: 'Good luck, adventurer!'
        },
        thumbnail: {
          url: 'https://cdn-icons-png.flaticon.com/512/3468/3468377.png' // Trophy icon
        }
      }]
    };
  }

  _makeProgressBar(current, total) {
    const filled = Math.floor((current / total) * 10);
    const empty = 10 - filled;
    return '▓'.repeat(filled) + '░'.repeat(empty);
  }

  /**
   * Get the ephemeral welcome embed for first-time users
   * This is shown privately to explain how the D&D system works
   * @returns {Object} Discord embed object
   */
  getWelcomeEmbed() {
    return {
      embeds: [{
        title: '⚔️ Welcome to D&D Mode!',
        description: '*This message is only visible to you.*\n\nYou\'ve discovered the D&D roleplaying system! Here\'s how it works:',
        color: 0x7C3AED, // Purple
        fields: [
          {
            name: '🎮 Quick Start',
            value: '1. **Create a character:** `📜 character create <race> <class>`\n2. **Form a party:** `👥 party create <name>`\n3. **Enter a dungeon:** `🏰 dungeon enter easy`',
            inline: false
          },
          {
            name: '📋 Commands',
            value: '📜 `character` - Create/view character\n👥 `party` - Manage your party\n🏰 `dungeon` - Explore dungeons\n🪄 `cast` - Cast spells\n🗡️ `attack` - Attack enemies\n📚 `tutorial` - Start tutorial',
            inline: true
          },
          {
            name: '🎲 Classes',
            value: '**Fighter** - Weapon master\n**Wizard** - Arcane spells\n**Rogue** - Stealth & tricks\n**Cleric** - Divine healer\n**Ranger** - Wilderness\n**Bard** - Performer',
            inline: true
          },
          {
            name: '🧝 Races',
            value: '**Human** - Versatile\n**Elf** - Graceful & magical\n**Dwarf** - Tough & resilient\n**Halfling** - Lucky & nimble',
            inline: true
          }
        ],
        footer: {
          text: 'Type 📚 tutorial start for a guided walkthrough!'
        },
        thumbnail: {
          url: 'https://cdn-icons-png.flaticon.com/512/6545/6545894.png' // D20 dice icon
        }
      }]
    };
  }

  /**
   * Check if a user has seen the welcome message
   */
  async hasSeenWelcome(discordUserId) {
    const col = await this.collection();
    const record = await col.findOne({ discordUserId, type: 'welcome_seen' });
    return !!record;
  }

  /**
   * Mark that a user has seen the welcome message
   */
  async markWelcomeSeen(discordUserId) {
    const col = await this.collection();
    await col.updateOne(
      { discordUserId, type: 'welcome_seen' },
      { $set: { discordUserId, type: 'welcome_seen', seenAt: new Date() } },
      { upsert: true }
    );
  }

  getSteps() {
    return TUTORIAL_STEPS;
  }
}
