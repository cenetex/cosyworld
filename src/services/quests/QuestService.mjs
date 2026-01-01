/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * QuestService - Core quest engine for tracking progress across multiple quest types
 */

import { ObjectId } from 'mongodb';

export class QuestService {
  constructor({ databaseService, characterService, partyService, dungeonService, discordService, logger }) {
    this.databaseService = databaseService;
    this.characterService = characterService;
    this.partyService = partyService;
    this.dungeonService = dungeonService;
    this.discordService = discordService;
    this.logger = logger;
    this._collection = null;
    this._quests = new Map(); // questId -> quest definition
  }

  async collection() {
    if (!this._collection) {
      const db = await this.databaseService.getDatabase();
      this._collection = db.collection('quest_progress');
      await this._ensureIndexes();
    }
    return this._collection;
  }

  async _ensureIndexes() {
    try {
      await this._collection.createIndex({ avatarId: 1, questId: 1 }, { unique: true });
      await this._collection.createIndex({ avatarId: 1, status: 1 });
    } catch (e) {
      this.logger?.warn?.('[QuestService] Index creation:', e.message);
    }
  }

  // ==================== Quest Registry ====================

  /**
   * Register a quest definition
   * @param {Object} quest - Quest definition object
   */
  registerQuest(quest) {
    if (!quest?.id) {
      this.logger?.error?.('[QuestService] Cannot register quest without id');
      return;
    }
    this._quests.set(quest.id, quest);
    this.logger?.info?.(`[QuestService] Registered quest: ${quest.id}`);
  }

  /**
   * Get a quest definition by ID
   */
  getQuest(questId) {
    return this._quests.get(questId);
  }

  /**
   * Get all registered quests
   */
  getAllQuests() {
    return Array.from(this._quests.values());
  }

  /**
   * Get quests by type
   */
  getQuestsByType(type) {
    return this.getAllQuests().filter(q => q.type === type);
  }

  // ==================== Progress Management ====================

  /**
   * Get progress for a specific quest
   */
  async getProgress(avatarId, questId) {
    const col = await this.collection();
    return col.findOne({ 
      avatarId: new ObjectId(avatarId), 
      questId 
    });
  }

  /**
   * Get all active quests for an avatar
   */
  async getActiveQuests(avatarId) {
    const col = await this.collection();
    const progressList = await col.find({ 
      avatarId: new ObjectId(avatarId), 
      status: 'active' 
    }).toArray();

    return progressList.map(p => ({
      progress: p,
      quest: this.getQuest(p.questId)
    })).filter(x => x.quest); // Filter out quests that no longer exist
  }

  /**
   * Get all completed quests for an avatar
   */
  async getCompletedQuests(avatarId) {
    const col = await this.collection();
    const progressList = await col.find({ 
      avatarId: new ObjectId(avatarId), 
      status: 'completed' 
    }).toArray();

    return progressList.map(p => ({
      progress: p,
      quest: this.getQuest(p.questId)
    })).filter(x => x.quest);
  }

  /**
   * Get available quests (not started, prerequisites met)
   */
  async getAvailableQuests(avatarId) {
    const completed = await this.getCompletedQuests(avatarId);
    const completedIds = new Set(completed.map(c => c.quest.id));
    
    const active = await this.getActiveQuests(avatarId);
    const activeIds = new Set(active.map(a => a.quest.id));

    return this.getAllQuests().filter(quest => {
      // Not already active or completed (unless repeatable)
      if (activeIds.has(quest.id)) return false;
      if (completedIds.has(quest.id) && !quest.repeatable) return false;
      
      // Prerequisites met
      if (quest.prerequisites?.length > 0) {
        const allPrereqsMet = quest.prerequisites.every(p => completedIds.has(p));
        if (!allPrereqsMet) return false;
      }
      
      return true;
    });
  }

  // ==================== Quest Lifecycle ====================

  /**
   * Start a quest for an avatar
   */
  async startQuest(avatarId, questId) {
    const quest = this.getQuest(questId);
    if (!quest) {
      return { started: false, error: 'Quest not found' };
    }

    // Check if already active
    const existing = await this.getProgress(avatarId, questId);
    if (existing?.status === 'active') {
      return { started: false, error: 'Quest already active', progress: existing };
    }

    // Check if completed and not repeatable
    if (existing?.status === 'completed' && !quest.repeatable) {
      return { started: false, error: 'Quest already completed', progress: existing };
    }

    // Check prerequisites
    if (quest.prerequisites?.length > 0) {
      const completed = await this.getCompletedQuests(avatarId);
      const completedIds = new Set(completed.map(c => c.quest.id));
      const unmet = quest.prerequisites.filter(p => !completedIds.has(p));
      if (unmet.length > 0) {
        return { started: false, error: `Prerequisites not met: ${unmet.join(', ')}` };
      }
    }

    const progress = {
      avatarId: new ObjectId(avatarId),
      questId,
      status: 'active',
      currentStep: 0,
      completedSteps: [],
      totalXpEarned: 0,
      startedAt: new Date(),
      completedAt: null
    };

    const col = await this.collection();
    
    if (existing) {
      // Reset for repeatable quest
      await col.updateOne(
        { avatarId: new ObjectId(avatarId), questId },
        { $set: progress }
      );
    } else {
      await col.insertOne(progress);
    }

    this.logger?.info?.(`[QuestService] Started quest ${questId} for avatar ${avatarId}`);
    return { started: true, progress, quest, step: quest.steps[0] };
  }

  /**
   * Get current step for a quest, auto-advancing through completed conditions
   */
  async getCurrentStep(avatarId, questId) {
    const progress = await this.getProgress(avatarId, questId);
    if (!progress) return null;
    if (progress.status === 'completed') return { completed: true, progress };

    const quest = this.getQuest(questId);
    if (!quest) return null;

    // Auto-advance through already-completed conditions
    let currentStepIndex = progress.currentStep;
    let autoAdvanced = false;

    while (currentStepIndex < quest.steps.length) {
      const step = quest.steps[currentStepIndex];
      const isMet = await this._isConditionMet(avatarId, step);

      if (isMet) {
        const xpEarned = step.xpReward || 0;
        currentStepIndex++;
        autoAdvanced = true;

        const col = await this.collection();
        await col.updateOne(
          { avatarId: new ObjectId(avatarId), questId },
          {
            $set: { currentStep: currentStepIndex },
            $push: { completedSteps: step.id },
            $inc: { totalXpEarned: xpEarned }
          }
        );

        if (xpEarned > 0) {
          try {
            await this.characterService?.awardXP?.(avatarId, xpEarned);
          } catch { /* ignore */ }
        }

        this.logger?.info?.(`[QuestService] Auto-advanced past ${step.id} in ${questId} for avatar ${avatarId}`);
      } else {
        break;
      }
    }

    // Check if auto-advance completed the quest
    if (currentStepIndex >= quest.steps.length) {
      const col = await this.collection();
      await col.updateOne(
        { avatarId: new ObjectId(avatarId), questId },
        { $set: { status: 'completed', completedAt: new Date() } }
      );
      
      // Award completion rewards
      await this._awardCompletionRewards(avatarId, quest);
      
      const updatedProgress = await this.getProgress(avatarId, questId);
      return { completed: true, progress: updatedProgress, autoAdvanced };
    }

    const step = quest.steps[currentStepIndex];
    const updatedProgress = autoAdvanced ? await this.getProgress(avatarId, questId) : progress;
    
    return { 
      step, 
      quest,
      progress: updatedProgress, 
      stepNumber: currentStepIndex + 1, 
      totalSteps: quest.steps.length, 
      autoAdvanced 
    };
  }

  /**
   * Handle an event that may advance quest progress
   */
  async onEvent(avatarId, eventName, data = {}) {
    const activeQuests = await this.getActiveQuests(avatarId);
    const results = [];

    for (const { quest, progress } of activeQuests) {
      const result = await this._advanceStep(avatarId, quest, progress, eventName, data);
      if (result) {
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Advance a specific quest step (called internally or by TutorialTool for backward compat)
   */
  async advanceStep(avatarId, questId, triggerId) {
    const progress = await this.getProgress(avatarId, questId);
    if (!progress || progress.status !== 'active') return null;

    const quest = this.getQuest(questId);
    if (!quest) return null;

    return this._advanceStep(avatarId, quest, progress, triggerId);
  }

  /**
   * Internal step advancement logic
   * @private
   */
  async _advanceStep(avatarId, quest, progress, triggerId, data = {}) {
    const currentStep = quest.steps[progress.currentStep];
    if (!currentStep) return null;

    // Check if trigger matches
    const isMatch = currentStep.trigger === triggerId ||
      (currentStep.optional && triggerId === 'skip');

    if (!isMatch) return null;

    const xpEarned = currentStep.xpReward || 0;
    const nextStepIndex = progress.currentStep + 1;
    const isComplete = nextStepIndex >= quest.steps.length;

    const col = await this.collection();
    await col.updateOne(
      { avatarId: new ObjectId(avatarId), questId: quest.id },
      {
        $set: { 
          currentStep: nextStepIndex,
          ...(isComplete ? { status: 'completed', completedAt: new Date() } : {})
        },
        $push: { completedSteps: currentStep.id },
        $inc: { totalXpEarned: xpEarned }
      }
    );

    if (xpEarned > 0) {
      try {
        await this.characterService?.awardXP?.(avatarId, xpEarned);
      } catch { /* ignore */ }
    }

    if (isComplete) {
      await this._awardCompletionRewards(avatarId, quest);
    }

    const nextStep = isComplete ? null : quest.steps[nextStepIndex];
    const updatedProgress = await this.getProgress(avatarId, quest.id);

    return {
      questId: quest.id,
      quest,
      completed: currentStep,
      xpEarned,
      isQuestComplete: isComplete,
      nextStep,
      totalXpEarned: updatedProgress.totalXpEarned
    };
  }

  /**
   * Award completion rewards
   * @private
   */
  async _awardCompletionRewards(avatarId, quest) {
    if (!quest.rewards) return;

    if (quest.rewards.xp) {
      try {
        await this.characterService?.awardXP?.(avatarId, quest.rewards.xp);
      } catch { /* ignore */ }
    }

    if (quest.rewards.title) {
      try {
        await this.characterService?.awardTitle?.(avatarId, quest.rewards.title);
      } catch { /* ignore */ }
    }

    // TODO: Award items when inventory system exists
  }

  /**
   * Abandon a quest
   */
  async abandonQuest(avatarId, questId) {
    const quest = this.getQuest(questId);
    if (!quest) return { abandoned: false, error: 'Quest not found' };

    // Cannot abandon tutorial-type quests
    if (quest.type === 'tutorial') {
      return { abandoned: false, error: 'Cannot abandon tutorial quests' };
    }

    const col = await this.collection();
    await col.updateOne(
      { avatarId: new ObjectId(avatarId), questId },
      { $set: { status: 'abandoned', abandonedAt: new Date() } }
    );

    return { abandoned: true };
  }

  /**
   * Reset a quest (delete progress, allowing restart)
   */
  async resetQuest(avatarId, questId) {
    const col = await this.collection();
    await col.deleteOne({ avatarId: new ObjectId(avatarId), questId });
    return this.startQuest(avatarId, questId);
  }

  // ==================== Condition Checking ====================

  /**
   * Check if a step's condition is already met
   * @private
   */
  async _isConditionMet(avatarId, step) {
    if (!step.condition) return false;

    try {
      switch (step.condition.type) {
        case 'has_sheet': {
          const sheet = await this.characterService?.getSheet?.(avatarId);
          return !!sheet;
        }
        case 'in_party': {
          const sheet = await this.characterService?.getSheet?.(avatarId);
          return !!sheet?.partyId;
        }
        case 'in_dungeon': {
          const sheet = await this.characterService?.getSheet?.(avatarId);
          if (!sheet?.partyId) return false;
          const dungeon = await this.dungeonService?.getActiveDungeon?.(sheet.partyId);
          return !!dungeon;
        }
        case 'is_spellcaster': {
          const sheet = await this.characterService?.getSheet?.(avatarId);
          return !!sheet?.spellcasting;
        }
        case 'not_spellcaster': {
          const sheet = await this.characterService?.getSheet?.(avatarId);
          return sheet && !sheet.spellcasting;
        }
        case 'level_min': {
          const sheet = await this.characterService?.getSheet?.(avatarId);
          return sheet && sheet.level >= (step.condition.value || 1);
        }
        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  // ==================== Formatting ====================

  /**
   * Format a step message as Discord embed
   */
  formatStepMessage(quest, step, stepNumber, totalSteps, xpEarned = 0) {
    const progressBar = this._makeProgressBar(stepNumber - 1, totalSteps);

    return {
      embeds: [{
        title: `📖 ${step.title}`,
        description: step.description,
        color: this._getQuestColor(quest.type),
        fields: [
          {
            name: '📋 What to do',
            value: step.instruction,
            inline: false
          },
          {
            name: '📊 Progress',
            value: `${progressBar} ${stepNumber}/${totalSteps}`,
            inline: true
          },
          {
            name: '⭐ Step Reward',
            value: `${step.xpReward || 0} XP`,
            inline: true
          }
        ],
        footer: { text: `Quest: ${quest.title}` }
      }]
    };
  }

  /**
   * Format quest completion message
   */
  formatCompletionMessage(quest, totalXpEarned) {
    const fields = [
      { name: '⭐ Total XP Earned', value: `${totalXpEarned} XP`, inline: true }
    ];

    if (quest.rewards?.title) {
      fields.push({ name: '🏆 Title Earned', value: quest.rewards.title, inline: true });
    }

    if (quest.rewards?.xp) {
      fields.push({ name: '🎁 Completion Bonus', value: `+${quest.rewards.xp} XP`, inline: true });
    }

    return {
      embeds: [{
        title: '🎉 Quest Complete!',
        description: `You have completed **${quest.title}**!`,
        color: 0x10B981,
        fields,
        footer: { text: 'Well done, adventurer!' }
      }]
    };
  }

  /**
   * Format quest list
   */
  formatQuestList(quests, title = 'Available Quests') {
    if (quests.length === 0) {
      return {
        embeds: [{
          title: `📚 ${title}`,
          description: 'No quests available.',
          color: 0x6B7280
        }]
      };
    }

    const questList = quests.map(q => {
      const emoji = q.emoji || this._getTypeEmoji(q.type);
      return `${emoji} **${q.title}** - ${q.description}`;
    }).join('\n');

    return {
      embeds: [{
        title: `📚 ${title}`,
        description: questList,
        color: 0x7C3AED,
        footer: { text: 'Use 📚 quest <name> to view details' }
      }]
    };
  }

  _makeProgressBar(completed, total, length = 10) {
    const filled = Math.round((completed / total) * length);
    return '█'.repeat(filled) + '░'.repeat(length - filled);
  }

  _getQuestColor(type) {
    const colors = {
      tutorial: 0x7C3AED,  // Purple
      story: 0x3B82F6,     // Blue
      side: 0x10B981,      // Green
      daily: 0xF59E0B,     // Amber
      achievement: 0xEF4444 // Red
    };
    return colors[type] || 0x6B7280;
  }

  _getTypeEmoji(type) {
    const emojis = {
      tutorial: '📚',
      story: '📜',
      side: '📋',
      daily: '🌅',
      achievement: '🏆'
    };
    return emojis[type] || '❓';
  }

  // ==================== Welcome DM (for first-time D&D users) ====================

  async hasSeenWelcome(discordUserId) {
    try {
      const db = await this.databaseService.getDatabase();
      const col = db.collection('dnd_welcome_seen');
      const doc = await col.findOne({ discordUserId });
      return !!doc;
    } catch {
      return false;
    }
  }

  async markWelcomeSeen(discordUserId) {
    try {
      const db = await this.databaseService.getDatabase();
      const col = db.collection('dnd_welcome_seen');
      await col.updateOne(
        { discordUserId },
        { $set: { discordUserId, seenAt: new Date() } },
        { upsert: true }
      );
    } catch (e) {
      this.logger?.warn?.('[QuestService] Failed to mark welcome seen:', e.message);
    }
  }

  getWelcomeEmbed() {
    return {
      embeds: [{
        title: '⚔️ Welcome to D&D Adventures!',
        description: 
          'I noticed you used a D&D command! Here\'s a quick start guide:\n\n' +
          '**📚 Start the Tutorial**\n' +
          'Type `📚 quest tutorial` to begin a guided journey.\n\n' +
          '**Quick Commands**\n' +
          '📜 `character create <race> <class>` - Create your hero\n' +
          '👥 `party create <name>` - Form a party\n' +
          '🏰 `dungeon enter easy` - Enter a dungeon\n' +
          '🪄 `cast <spell>` - Cast spells\n',
        color: 0x7C3AED,
        footer: { text: 'This is a one-time message. Have fun adventuring!' }
      }]
    };
  }
}
