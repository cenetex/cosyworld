/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Telegram Plan Manager
 * Handles agent plan storage, retrieval, and context building
 */

import { randomUUID } from 'crypto';
import { PLAN_CONFIG } from './constants.mjs';

export class PlanManager {
  constructor({ logger, databaseService, cacheManager }) {
    this.logger = logger;
    this.databaseService = databaseService;
    this.cache = cacheManager;
  }

  /**
   * Remember an agent plan
   * @param {string} channelId - Channel ID
   * @param {Object} entry - Plan entry
   * @returns {Promise<Object|null>}
   */
  async rememberAgentPlan(channelId, entry = {}) {
    try {
      if (!channelId) return null;

      const normalizedSteps = Array.isArray(entry.steps)
        ? entry.steps
            .map(step => ({
              action: typeof step?.action === 'string' ? step.action : null,
              description: typeof step?.description === 'string' ? step.description : null,
              expectedOutcome: typeof step?.expectedOutcome === 'string' ? step.expectedOutcome : null
            }))
            .filter(step => step.description)
        : [];

      const normalized = {
        id: entry.id || randomUUID(),
        channelId: String(channelId),
        objective: entry.objective || 'Respond thoughtfully to the user',
        steps: normalizedSteps,
        confidence: typeof entry.confidence === 'number'
          ? Math.min(1, Math.max(0, entry.confidence))
          : null,
        createdAt: entry.createdAt ? new Date(entry.createdAt) : new Date(),
        userId: entry.userId || null,
        metadata: entry.metadata || null
      };

      // Update cache
      this.cache.addAgentPlan(normalized.channelId, normalized);

      // Persist to DB
      this._persistAgentPlanRecord(normalized).catch(err => {
        this.logger?.warn?.('[PlanManager] Failed to persist agent plan:', err?.message || err);
      });

      return normalized;
    } catch (error) {
      this.logger?.warn?.('[PlanManager] rememberAgentPlan error:', error?.message || error);
      return null;
    }
  }

  /**
   * Persist plan to database
   * @private
   */
  async _persistAgentPlanRecord(record) {
    if (!this.databaseService) return;
    try {
      // Note: Indexes are currently managed by MediaManager or TelegramService
      // We assume they exist or will be created.
      const db = await this.databaseService.getDatabase();
      await db.collection('telegram_agent_plans').insertOne({
        channelId: record.channelId,
        id: record.id,
        objective: record.objective,
        steps: record.steps,
        confidence: record.confidence,
        userId: record.userId || null,
        metadata: record.metadata || null,
        createdAt: record.createdAt instanceof Date ? record.createdAt : new Date(record.createdAt)
      });
    } catch (error) {
      this.logger?.warn?.('[PlanManager] Failed to store agent plan:', error?.message || error);
    }
  }

  /**
   * Load recent plans from database
   * @param {string} channelId 
   * @param {number} limit 
   */
  async loadFromDatabase(channelId, limit = PLAN_CONFIG.LIMIT) {
    if (!this.databaseService) return [];
    try {
      const db = await this.databaseService.getDatabase();
      const items = await db.collection('telegram_agent_plans')
        .find({ channelId: String(channelId) })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
      return items.map(item => ({
        ...item,
        createdAt: item.createdAt instanceof Date ? item.createdAt : new Date(item.createdAt)
      }));
    } catch (error) {
      this.logger?.warn?.('[PlanManager] Failed to load agent plans:', error?.message || error);
      return [];
    }
  }

  /**
   * Get recent plans
   * @param {string} channelId 
   * @param {number} limit 
   */
  async getRecentPlans(channelId, limit = 3) {
    if (!channelId) return [];
    const normalizedChannelId = String(channelId);
    
    // Check cache
    const cached = this.cache.getRecentPlans(normalizedChannelId);
    if (cached?.length) {
      return cached.slice(0, limit);
    }

    // Load from DB
    const fromDb = await this.loadFromDatabase(normalizedChannelId, Math.max(limit, PLAN_CONFIG.LIMIT));
    if (fromDb.length) {
      fromDb.forEach(plan => this.cache.addAgentPlan(normalizedChannelId, plan));
    }
    return fromDb.slice(0, limit);
  }

  /**
   * Build plan context for prompt
   * @param {string} channelId 
   * @param {number} limit 
   */
  async buildPlanContext(channelId, limit = 3) {
    const plans = await this.getRecentPlans(channelId, limit);
    if (!plans.length) {
      return {
        summary: 'Planning memory: No recent plans yet. When you anticipate multiple actions (speak, generate, post_tweet), call plan_actions to outline them before proceeding.',
        plans: []
      };
    }
    const summaryLines = plans.map((plan, idx) => {
      const stepsPreview = Array.isArray(plan.steps) && plan.steps.length
        ? plan.steps.slice(0, 2).map(step => `${(step.action || 'speak').toUpperCase()}: ${step.description}`).join(' → ')
        : 'SPEAK: reply naturally';
      const createdAt = plan.createdAt instanceof Date ? plan.createdAt : new Date(plan.createdAt);
      const timeLabel = createdAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return `${idx + 1}. (${timeLabel}) ${plan.objective} — ${stepsPreview}`;
    });
    return {
      summary: `Recent agent plans (most recent first):
${summaryLines.join('\n')}
Always consider calling plan_actions before executing media or tweet tools when multiple steps are needed.`,
      plans
    };
  }
}

export default PlanManager;
