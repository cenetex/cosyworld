/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * StoryPlanService
 * 
 * Manages evolving story plans that guide narrative generation.
 * Plans are created at the start of a story arc and evolve as chapters progress.
 * 
 * Structure:
 * - Story Arc: High-level narrative (spans multiple days/chapters)
 * - Chapter: 3 beats published per day
 * - Beat: Single story post/update
 * - Plan: Dynamic outline that evolves as story progresses
 */
export class StoryPlanService {
  constructor({ databaseService, logger }) {
    this.databaseService = databaseService;
    this.logger = logger || console;
  }

  async _db() {
    return await this.databaseService.getDatabase();
  }

  // ============================================================================
  // Plan Management
  // ============================================================================

  /**
   * Create a new story plan for an arc
   * @param {Object} arcId - The story arc ID
   * @param {Object} initialPlan - Initial plan structure from AI
   * @param {Object} worldContext - Current world context used for planning
   * @returns {Promise<Object>} Created plan
   */
  async createPlan(arcId, initialPlan, worldContext) {
    try {
      const db = await this._db();
      const plans = db.collection('story_plans');
      
      const plan = {
        arcId,
        version: 1,
        status: 'active',
        
        // Plan structure
        overallTheme: initialPlan.overallTheme || '',
        plannedChapters: initialPlan.chapters || [],
        currentChapter: 0,
        
        // Evolution tracking
        evolutionHistory: [{
          version: 1,
          timestamp: new Date(),
          reason: 'initial_creation',
          changes: 'Initial plan created'
        }],
        
        // Context snapshot
        worldContextSnapshot: {
          timestamp: worldContext.timestamp,
          totalChannels: worldContext.summary.totalChannels,
          totalAvatars: worldContext.summary.totalAvatars,
          keyThemes: worldContext.summary.keyThemes,
          metaSummary: worldContext.metaSummary?.summary
        },
        
        // Metadata
        createdAt: new Date(),
        lastUpdated: new Date()
      };
      
      await plans.insertOne(plan);
      this.logger.info(`[StoryPlan] Created plan for arc ${arcId}, ${plan.plannedChapters.length} chapters planned`);
      
      return plan;
      
    } catch (error) {
      this.logger.error('[StoryPlan] Error creating plan:', error);
      throw error;
    }
  }

  /**
   * Get the active plan for an arc
   * @param {Object} arcId - Arc ID
   * @returns {Promise<Object|null>} Active plan
   */
  async getActivePlan(arcId) {
    const db = await this._db();
    const plans = db.collection('story_plans');
    
    return await plans.findOne({
      arcId,
      status: 'active'
    });
  }

  /**
   * Get all plans for an arc (including historical)
   * @param {Object} arcId - Arc ID
   * @returns {Promise<Array>} All plans
   */
  async getAllPlansForArc(arcId) {
    const db = await this._db();
    const plans = db.collection('story_plans');
    
    return await plans
      .find({ arcId })
      .sort({ version: -1 })
      .toArray();
  }

  /**
   * Evolve the plan based on new world context and story progress
   * @param {Object} arcId - Arc ID
   * @param {Object} worldContext - Current world context
   * @param {Object} aiService - AI service for generating evolution
   * @param {string} reason - Reason for evolution
   * @returns {Promise<Object>} Updated plan
   */
  async evolvePlan(arcId, worldContext, aiService, reason = 'chapter_completion') {
    try {
      const db = await this._db();
      const plans = db.collection('story_plans');
      
      const currentPlan = await this.getActivePlan(arcId);
      if (!currentPlan) {
        throw new Error(`No active plan found for arc ${arcId}`);
      }
      
      // Generate evolution prompt
      const evolutionPrompt = this._buildEvolutionPrompt(currentPlan, worldContext);
      
      this.logger.info(`[StoryPlan] Evolving plan for arc ${arcId}, reason: ${reason}`);
      
      // Get AI suggestions for evolution
      let evolvedPlan = null;
      if (aiService) {
        try {
          const response = await aiService.chat([
            { role: 'user', content: evolutionPrompt }
          ], {
            model: 'anthropic/claude-sonnet-4',
            max_tokens: 1500,
            temperature: 0.7
          });
          
          const responseText = String(response?.text || response || '').trim();
          
          // Parse response (expecting JSON)
          try {
            evolvedPlan = JSON.parse(responseText);
          } catch {
            // If not JSON, extract key information
            this.logger.warn('[StoryPlan] AI response was not JSON, using text');
            evolvedPlan = {
              theme: currentPlan.overallTheme,
              chapters: currentPlan.plannedChapters,
              evolutionNote: responseText
            };
          }
        } catch (error) {
          this.logger.error('[StoryPlan] Error generating evolution:', error);
          // Keep current plan
          evolvedPlan = {
            theme: currentPlan.overallTheme,
            chapters: currentPlan.plannedChapters
          };
        }
      }
      
      // Update plan
      const newVersion = currentPlan.version + 1;
      const evolution = {
        version: newVersion,
        timestamp: new Date(),
        reason,
        changes: evolvedPlan.evolutionNote || 'Plan evolved based on world state',
        worldContextSnapshot: {
          timestamp: worldContext.timestamp,
          totalChannels: worldContext.summary.totalChannels,
          totalAvatars: worldContext.summary.totalAvatars,
          keyThemes: worldContext.summary.keyThemes
        }
      };
      
      await plans.updateOne(
        { _id: currentPlan._id },
        {
          $set: {
            version: newVersion,
            overallTheme: evolvedPlan.theme || currentPlan.overallTheme,
            plannedChapters: evolvedPlan.chapters || currentPlan.plannedChapters,
            lastUpdated: new Date()
          },
          $push: {
            evolutionHistory: evolution
          }
        }
      );
      
      this.logger.info(`[StoryPlan] Plan evolved to version ${newVersion}`);
      
      return await plans.findOne({ _id: currentPlan._id });
      
    } catch (error) {
      this.logger.error('[StoryPlan] Error evolving plan:', error);
      throw error;
    }
  }

  /**
   * Mark a chapter as completed and advance to next
   * @param {Object} arcId - Arc ID
   * @param {number} chapterNumber - Completed chapter number
   * @returns {Promise<Object>} Updated plan
   */
  async completeChapter(arcId, chapterNumber) {
    const db = await this._db();
    const plans = db.collection('story_plans');
    
    const plan = await this.getActivePlan(arcId);
    if (!plan) {
      throw new Error(`No active plan for arc ${arcId}`);
    }
    
    await plans.updateOne(
      { _id: plan._id },
      {
        $set: {
          currentChapter: chapterNumber + 1,
          lastUpdated: new Date()
        }
      }
    );
    
    this.logger.info(`[StoryPlan] Completed chapter ${chapterNumber} for arc ${arcId}`);
    
    return await plans.findOne({ _id: plan._id });
  }

  /**
   * Complete a plan (when arc finishes)
   * @param {Object} arcId - Arc ID
   * @returns {Promise<Object>} Completed plan
   */
  async completePlan(arcId) {
    const db = await this._db();
    const plans = db.collection('story_plans');
    
    await plans.updateOne(
      { arcId, status: 'active' },
      {
        $set: {
          status: 'completed',
          completedAt: new Date(),
          lastUpdated: new Date()
        }
      }
    );
    
    this.logger.info(`[StoryPlan] Completed plan for arc ${arcId}`);
    
    return await this.getActivePlan(arcId);
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Build evolution prompt for AI
   * @private
   */
  _buildEvolutionPrompt(currentPlan, worldContext) {
    let prompt = '=== STORY PLAN EVOLUTION REQUEST ===\n\n';
    
    prompt += '--- CURRENT PLAN ---\n';
    prompt += `Theme: ${currentPlan.overallTheme}\n`;
    prompt += `Current Chapter: ${currentPlan.currentChapter + 1}/${currentPlan.plannedChapters.length}\n\n`;
    
    prompt += 'Planned Chapters:\n';
    for (let i = 0; i < currentPlan.plannedChapters.length; i++) {
      const chapter = currentPlan.plannedChapters[i];
      const status = i < currentPlan.currentChapter ? '✓ DONE' : 
                     i === currentPlan.currentChapter ? '→ CURRENT' : '  PLANNED';
      prompt += `${status} Chapter ${i + 1}: ${chapter.title || chapter.summary || 'Untitled'}\n`;
      if (chapter.summary) {
        prompt += `    ${chapter.summary}\n`;
      }
    }
    prompt += '\n';
    
    prompt += '--- CURRENT WORLD STATE ---\n';
    if (worldContext.metaSummary) {
      prompt += worldContext.metaSummary.summary + '\n\n';
      if (worldContext.metaSummary.keyThemes?.length > 0) {
        prompt += `Current Themes: ${worldContext.metaSummary.keyThemes.join(', ')}\n\n`;
      }
    }
    
    prompt += `Active Channels: ${worldContext.summary.totalChannels}\n`;
    prompt += `Active Avatars: ${worldContext.summary.totalAvatars}\n\n`;
    
    prompt += '--- EVOLUTION TASK ---\n';
    prompt += 'Review the current story plan and world state. Suggest how the plan should evolve:\n';
    prompt += '1. Should the overall theme adapt to current world events?\n';
    prompt += '2. Should remaining chapters be adjusted?\n';
    prompt += '3. Should new chapters be added or removed?\n';
    prompt += '4. Are there new story opportunities to incorporate?\n\n';
    
    prompt += 'Respond with JSON in this format:\n';
    prompt += '{\n';
    prompt += '  "theme": "Updated or current theme",\n';
    prompt += '  "chapters": [\n';
    prompt += '    {"title": "Chapter Title", "summary": "Brief summary", "beats": ["beat1", "beat2", "beat3"]}\n';
    prompt += '  ],\n';
    prompt += '  "evolutionNote": "Why these changes were made"\n';
    prompt += '}\n';
    
    return prompt;
  }

  /**
   * Get the next chapter to generate
   * @param {Object} arcId - Arc ID
   * @returns {Promise<Object|null>} Next chapter info
   */
  async getNextChapter(arcId) {
    const plan = await this.getActivePlan(arcId);
    if (!plan) return null;
    
    if (plan.currentChapter >= plan.plannedChapters.length) {
      // Plan complete
      return null;
    }
    
    return {
      chapterNumber: plan.currentChapter,
      chapter: plan.plannedChapters[plan.currentChapter],
      totalChapters: plan.plannedChapters.length
    };
  }
}

export default StoryPlanService;
