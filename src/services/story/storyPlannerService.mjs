/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * StoryPlannerService
 * 
 * High-level narrative orchestration and arc management.
 * Decides when to start new arcs, which arcs to progress, and how to react to world events.
 */
export class StoryPlannerService {
  constructor({ 
    storyStateService, 
    worldContextService, 
    narrativeGeneratorService,
    configService,
    logger 
  }) {
    this.storyState = storyStateService;
    this.worldContext = worldContextService;
    this.narrativeGenerator = narrativeGeneratorService;
    this.configService = configService;
    this.logger = logger || console;
    
    // Default configuration
    this.config = {
      maxConcurrentArcs: 3,
      minTimeBetweenNewArcs: 24 * 60 * 60 * 1000, // 24 hours
      targetBeatsPerArc: { min: 4, max: 8 },
      characterRotationWindowDays: 7,
      themeVarietyWindow: 3 // Last N arcs should have different themes
    };
  }

  /**
   * Initialize planner
   */
  async initialize() {
    this.logger.info('[StoryPlanner] Initializing...');
    
    // Load config from config service if available
    try {
      const storyConfig = await this.configService?.getConfig('story');
      if (storyConfig) {
        this.config = { ...this.config, ...storyConfig };
      }
    } catch {
      this.logger.warn('[StoryPlanner] Could not load story config, using defaults');
    }
    
    this.logger.info('[StoryPlanner] Initialized with config:', this.config);
  }

  // ============================================================================
  // Arc Planning & Management
  // ============================================================================

  /**
   * Determine if we should start a new story arc
   * @returns {Promise<boolean>}
   */
  async shouldStartNewArc() {
    try {
      // Check concurrent arc limit
      const activeArcs = await this.storyState.getActiveArcs();
      if (activeArcs.length >= this.config.maxConcurrentArcs) {
        this.logger.info('[StoryPlanner] Max concurrent arcs reached');
        return false;
      }
      
      // Check time since last arc start
      const recentArcs = await this.storyState.getArcs(
        {},
        { sort: { startedAt: -1 }, limit: 1 }
      );
      
      if (recentArcs.length > 0) {
        const lastArcStart = recentArcs[0].startedAt;
        const timeSinceLast = Date.now() - lastArcStart.getTime();
        
        if (timeSinceLast < this.config.minTimeBetweenNewArcs) {
          this.logger.info('[StoryPlanner] Too soon since last arc start');
          return false;
        }
      }
      
      // Check for story opportunities
      const context = await this.worldContext.getWorldContext();
      const hasOpportunities = context.opportunities && context.opportunities.length > 0;
      
      if (!hasOpportunities && activeArcs.length > 0) {
        this.logger.info('[StoryPlanner] No compelling opportunities, have active arcs');
        return false;
      }
      
      this.logger.info('[StoryPlanner] Conditions met for new arc');
      return true;
      
    } catch (error) {
      this.logger.error('[StoryPlanner] Error checking if should start arc:', error);
      return false;
    }
  }

  /**
   * Create and plan a new story arc
   * @param {Object} options - Arc generation options
   * @returns {Promise<Object>} Created arc
   */
  async createNewArc(options = {}) {
    try {
      this.logger.info('[StoryPlanner] Creating new story arc...');
      
      // Get world context
      const worldContext = await this.worldContext.getWorldContext();
      
      // Ensure theme variety
      const recentThemes = await this._getRecentThemes();
      if (options.theme && recentThemes.includes(options.theme)) {
        this.logger.info(`[StoryPlanner] Theme ${options.theme} was recent, selecting different theme`);
        delete options.theme;
      }
      
      // Select characters that haven't been featured recently
      const unfeaturedCharacters = await this.storyState.getUnfeaturedCharacters(
        this.config.characterRotationWindowDays
      );
      
      // Generate target beats count
      const targetBeats = Math.floor(
        Math.random() * (this.config.targetBeatsPerArc.max - this.config.targetBeatsPerArc.min + 1) +
        this.config.targetBeatsPerArc.min
      );
      
      // Generate arc
      const arcData = await this.narrativeGenerator.generateArc(worldContext, {
        ...options,
        targetBeats,
        unfeaturedCharacters
      });
      
      // Persist arc
      const createdArc = await this.storyState.createArc(arcData);
      
      // Update character states for featured characters
      if (createdArc.characters) {
        for (const char of createdArc.characters) {
          if (char.avatarId) {
            await this.storyState.updateCharacterState(char.avatarId, {
              currentArc: createdArc._id,
              'storyStats.lastFeaturedAt': new Date(),
              $inc: { 
                'storyStats.totalArcsParticipated': 1,
                'storyStats.protagonistCount': char.role === 'protagonist' ? 1 : 0
              }
            });
          }
        }
      }
      
      this.logger.info(`[StoryPlanner] Created arc: "${createdArc.title}" (${createdArc._id})`);
      
      return createdArc;
      
    } catch (error) {
      this.logger.error('[StoryPlanner] Error creating arc:', error);
      throw error;
    }
  }

  /**
   * Select which arc should progress next
   * @returns {Promise<Object|null>}
   */
  async selectArcToProgress() {
    try {
      const activeArcs = await this.storyState.getActiveArcs();
      
      if (activeArcs.length === 0) {
        return null;
      }
      
      // Sort by last progressed time (oldest first)
      activeArcs.sort((a, b) => {
        const aTime = a.lastProgressedAt ? a.lastProgressedAt.getTime() : a.startedAt.getTime();
        const bTime = b.lastProgressedAt ? b.lastProgressedAt.getTime() : b.startedAt.getTime();
        return aTime - bTime;
      });
      
      // Return the arc that hasn't been progressed in the longest time
      return activeArcs[0];
      
    } catch (error) {
      this.logger.error('[StoryPlanner] Error selecting arc:', error);
      return null;
    }
  }

  /**
   * Progress a story arc by generating and posting next beat
   * @param {string|ObjectId} arcId - Arc ID
   * @param {Object} worldContext - Current world context (optional)
   * @returns {Promise<Object>} Generated beat
   */
  async progressArc(arcId, worldContext = null) {
    try {
      this.logger.info(`[StoryPlanner] Progressing arc ${arcId}...`);
      
      // Get arc
      const arc = await this.storyState.getArc(arcId);
      if (!arc) {
        throw new Error(`Arc ${arcId} not found`);
      }
      
      // Check if arc is complete
      if (arc.completedBeats >= arc.plannedBeats) {
        this.logger.info(`[StoryPlanner] Arc complete, marking as completed`);
        await this.completeArc(arcId);
        return null;
      }
      
      // Get world context if not provided
      if (!worldContext) {
        worldContext = await this.worldContext.getWorldContext();
      }
      
      // Generate next beat
      const beat = await this.narrativeGenerator.generateBeat(arc, worldContext);
      
      // Add beat to arc
      const updatedArc = await this.storyState.addBeat(arcId, beat);
      
      this.logger.info(`[StoryPlanner] Generated beat ${beat.sequenceNumber} for arc "${arc.title}"`);
      
      return { arc: updatedArc, beat };
      
    } catch (error) {
      this.logger.error('[StoryPlanner] Error progressing arc:', error);
      throw error;
    }
  }

  /**
   * Complete a story arc
   * @param {string|ObjectId} arcId - Arc ID
   * @returns {Promise<void>}
   */
  async completeArc(arcId) {
    try {
      this.logger.info(`[StoryPlanner] Completing arc ${arcId}...`);
      
      const arc = await this.storyState.getArc(arcId);
      if (!arc) {
        throw new Error(`Arc ${arcId} not found`);
      }
      
      // Generate summary
      const summary = await this.narrativeGenerator.summarizeArc(arc);
      
      // Update arc status
      await this.storyState.updateArc(arcId, {
        status: 'completed',
        summary,
        completedAt: new Date()
      });
      
      // Create memory summary
      await this.storyState.createSummary({
        type: 'arc_summary',
        referenceId: arcId,
        timeframe: {
          start: arc.startedAt,
          end: new Date()
        },
        summary,
        keyEvents: arc.beats.map(b => b.description),
        characterDevelopments: arc.characters.map(c => ({
          avatarId: c.avatarId,
          development: c.characterArc
        })),
        significance: 8 // Default high significance
      });
      
      // Clear current arc from character states
      if (arc.characters) {
        for (const char of arc.characters) {
          if (char.avatarId) {
            await this.storyState.updateCharacterState(char.avatarId, {
              currentArc: null
            });
          }
        }
      }
      
      this.logger.info(`[StoryPlanner] Completed arc: "${arc.title}"`);
      
    } catch (error) {
      this.logger.error('[StoryPlanner] Error completing arc:', error);
      throw error;
    }
  }

  // ============================================================================
  // Event Reactions
  // ============================================================================

  /**
   * React to new avatar creation
   * @param {string|ObjectId} avatarId - New avatar ID
   * @returns {Promise<void>}
   */
  async onAvatarCreated(avatarId) {
    try {
      this.logger.info(`[StoryPlanner] New avatar created: ${avatarId}`);
      
      // Check if we should create a "new arrival" arc
      const activeArcs = await this.storyState.getActiveArcs();
      const hasNewArrivalArc = activeArcs.some(arc => arc.theme === 'journey');
      
      if (!hasNewArrivalArc && activeArcs.length < this.config.maxConcurrentArcs) {
        this.logger.info('[StoryPlanner] Creating new arrival arc for avatar');
        
        // Create arc featuring the new avatar
        await this.createNewArc({
          theme: 'journey',
          focusAvatarId: avatarId
        });
      }
      
    } catch (error) {
      this.logger.error('[StoryPlanner] Error handling avatar creation:', error);
    }
  }

  /**
   * React to location creation
   * @param {string|ObjectId} locationId - New location ID
   * @returns {Promise<void>}
   */
  async onLocationCreated(locationId) {
    try {
      this.logger.info(`[StoryPlanner] New location created: ${locationId}`);
      
      // Consider creating a discovery arc for new location
      const activeArcs = await this.storyState.getActiveArcs();
      
      if (activeArcs.length < this.config.maxConcurrentArcs) {
        this.logger.info('[StoryPlanner] Creating discovery arc for new location');
        
        await this.createNewArc({
          theme: 'discovery',
          focusLocationId: locationId
        });
      }
      
    } catch (error) {
      this.logger.error('[StoryPlanner] Error handling location creation:', error);
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Get recent story themes for variety
   * @private
   * @returns {Promise<Array<string>>}
   */
  async _getRecentThemes() {
    const recentArcs = await this.storyState.getArcs(
      {},
      { 
        sort: { startedAt: -1 }, 
        limit: this.config.themeVarietyWindow 
      }
    );
    
    return recentArcs.map(arc => arc.theme).filter(Boolean);
  }

  /**
   * Get statistics about story system
   * @returns {Promise<Object>}
   */
  async getStatistics() {
    return await this.storyState.getStatistics();
  }

  /**
   * Pause an arc
   * @param {string|ObjectId} arcId - Arc ID
   * @returns {Promise<boolean>}
   */
  async pauseArc(arcId) {
    return await this.storyState.updateArcStatus(arcId, 'paused');
  }

  /**
   * Resume a paused arc
   * @param {string|ObjectId} arcId - Arc ID
   * @returns {Promise<boolean>}
   */
  async resumeArc(arcId) {
    return await this.storyState.updateArcStatus(arcId, 'active');
  }

  /**
   * Abandon an arc
   * @param {string|ObjectId} arcId - Arc ID
   * @returns {Promise<boolean>}
   */
  async abandonArc(arcId) {
    const arc = await this.storyState.getArc(arcId);
    
    if (arc?.characters) {
      // Clear current arc from characters
      for (const char of arc.characters) {
        if (char.avatarId) {
          await this.storyState.updateCharacterState(char.avatarId, {
            currentArc: null
          });
        }
      }
    }
    
    return await this.storyState.updateArcStatus(arcId, 'abandoned');
  }
}

export default StoryPlannerService;
