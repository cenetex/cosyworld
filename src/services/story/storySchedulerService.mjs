/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * StorySchedulerService
 * 
 * Manages timing and pacing of story beats.
 * Determines when to progress arcs, respects rate limits, and optimizes posting times.
 */
export class StorySchedulerService {
  constructor({ storyPlannerService, storyPostingService, configService, eventBus, logger }) {
    this.storyPlanner = storyPlannerService;
    this.storyPosting = storyPostingService;
    this.configService = configService;
    this.eventBus = eventBus;
    this.logger = logger || console;
    
    this.schedulerInterval = null;
    this.isRunning = false;
    
    // Default configuration
    this.config = {
      enabled: true,
      checkIntervalMinutes: 30, // Check every 30 minutes
      minTimeBetweenBeatsHours: 6,
      maxTimeBetweenBeatsHours: 48,
      preferredPostingHoursUTC: [9, 12, 15, 18, 21],
      allowPostingOutsidePreferredHours: true
    };
  }

  /**
   * Initialize scheduler
   */
  async initialize() {
    this.logger.info('[StoryScheduler] Initializing...');
    
    // Load config
    try {
      const storyConfig = await this.configService?.getConfig('story');
      if (storyConfig?.scheduling) {
        this.config = { ...this.config, ...storyConfig.scheduling };
      }
    } catch {
      this.logger.warn('[StoryScheduler] Could not load config, using defaults');
    }
    
    this.logger.info('[StoryScheduler] Initialized with config:', this.config);
  }

  /**
   * Start the scheduler
   */
  start() {
    if (this.isRunning) {
      this.logger.warn('[StoryScheduler] Already running');
      return;
    }
    
    if (!this.config.enabled) {
      this.logger.info('[StoryScheduler] Disabled in config');
      return;
    }
    
    this.logger.info('[StoryScheduler] Starting...');
    this.isRunning = true;
    
    // Run immediately
    this._checkAndProgress().catch(err => {
      this.logger.error('[StoryScheduler] Error in initial check:', err);
    });
    
    // Schedule periodic checks
    const intervalMs = this.config.checkIntervalMinutes * 60 * 1000;
    this.schedulerInterval = setInterval(() => {
      this._checkAndProgress().catch(err => {
        this.logger.error('[StoryScheduler] Error in scheduled check:', err);
      });
    }, intervalMs);
    
    this.logger.info(`[StoryScheduler] Running, checking every ${this.config.checkIntervalMinutes} minutes`);
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (!this.isRunning) {
      return;
    }
    
    this.logger.info('[StoryScheduler] Stopping...');
    
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
    
    this.isRunning = false;
    this.logger.info('[StoryScheduler] Stopped');
  }

  // ============================================================================
  // Scheduling Logic
  // ============================================================================

  /**
   * Check if we should progress stories and do so
   * @private
   */
  async _checkAndProgress() {
    try {
      this.logger.info('[StoryScheduler] Checking for story progression...');
      
      // Determine next action
      const action = await this.determineNextAction();
      
      if (action.action === 'wait') {
        this.logger.info('[StoryScheduler] No action needed at this time');
        if (action.reason) {
          this.logger.info(`[StoryScheduler] Reason: ${action.reason}`);
        }
        return;
      }
      
      if (action.action === 'start_arc') {
        this.logger.info('[StoryScheduler] Starting new story arc...');
        const arc = await this.storyPlanner.createNewArc();
        
        // Immediately activate it
        await this.storyPlanner.storyState.updateArcStatus(arc._id, 'active');
        
        this.logger.info(`[StoryScheduler] Started new arc: "${arc.title}"`);
        
        // Progress it immediately to post first chapter
        return await this._progressArc(arc._id);
      }
      
      if (action.action === 'progress_chapter' && action.arcId) {
        this.logger.info(`[StoryScheduler] Progressing arc ${action.arcId}...`);
        return await this._progressArc(action.arcId);
      }
      
    } catch (error) {
      this.logger.error('[StoryScheduler] Error in check and progress:', error);
    }
  }

  /**
   * Progress an arc (internal method that posts all beats in the chapter)
   * @private
   */
  async _progressArc(arcId) {
    try {
      const result = await this.storyPlanner.progressArc(arcId);
      
      if (!result) {
        this.logger.info('[StoryScheduler] Arc completed during progression');
        return null;
      }
      
      const { arc, chapter, beats } = result;
      
      this.logger.info(`[StoryScheduler] Generated chapter "${chapter.title}" with ${beats.length} beats for "${arc.title}"`);
      
      // Post each beat in the chapter to social platforms
      const postResults = [];
      if (this.storyPosting) {
        for (let i = 0; i < beats.length; i++) {
          const beat = beats[i];
          this.logger.info(`[StoryScheduler] Posting beat ${beat.sequenceNumber} (${i + 1}/${beats.length})...`);
          
          const postResult = await this.storyPosting.postBeat(arc, beat);
          
          if (postResult.success) {
            this.logger.info(`[StoryScheduler] Beat ${beat.sequenceNumber} posted successfully`);
          } else {
            this.logger.error(`[StoryScheduler] Failed to post beat ${beat.sequenceNumber}: ${postResult.error}`);
          }
          
          postResults.push({ beat, postResult });
          
          // Add delay between posts to avoid rate limits (except after last beat)
          if (i < beats.length - 1) {
            this.logger.info('[StoryScheduler] Waiting 3 seconds before next beat...');
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
        }
      }
      
      this.logger.info(`[StoryScheduler] Chapter "${chapter.title}" completed - posted ${postResults.filter(r => r.postResult.success).length}/${beats.length} beats successfully`);
      
      return { arc, chapter, beats, postResults };
      
    } catch (error) {
      this.logger.error('[StoryScheduler] Error progressing arc:', error);
      throw error;
    }
  }

  /**
   * Determine what action to take next
   * @returns {Promise<Object>} Action object
   */
  async determineNextAction() {
    try {
      // Check if we should start a new arc
      const shouldStartNew = await this.storyPlanner.shouldStartNewArc();
      if (shouldStartNew) {
        return { action: 'start_arc' };
      }
      
      // Check if we should progress an existing arc
      const arcToProgress = await this.selectArcToProgress();
      if (arcToProgress) {
        return { 
          action: 'progress_chapter', 
          arcId: arcToProgress._id 
        };
      }
      
      return { 
        action: 'wait',
        reason: 'No arcs ready to progress'
      };
      
    } catch (error) {
      this.logger.error('[StoryScheduler] Error determining next action:', error);
      return { action: 'wait', reason: 'Error occurred' };
    }
  }

  /**
   * Select an arc that's ready to progress
   * @returns {Promise<Object|null>}
   */
  async selectArcToProgress() {
    const activeArcs = await this.storyPlanner.storyState.getActiveArcs();
    
    if (activeArcs.length === 0) {
      return null;
    }
    
    const minInterval = this.config.minTimeBetweenBeatsHours * 60 * 60 * 1000;
    const maxInterval = this.config.maxTimeBetweenBeatsHours * 60 * 60 * 1000;
    const now = Date.now();
    
    // Filter arcs that are ready to progress
    const readyArcs = activeArcs.filter(arc => {
      const lastProgress = arc.lastProgressedAt || arc.startedAt;
      const timeSince = now - lastProgress.getTime();
      
      // Must be past minimum interval
      if (timeSince < minInterval) {
        return false;
      }
      
      // If past max interval, definitely progress
      if (timeSince >= maxInterval) {
        return true;
      }
      
      // Otherwise, check if it's an optimal posting time
      if (this.isOptimalPostingTime()) {
        return true;
      }
      
      // Allow progression outside preferred hours if configured
      return this.config.allowPostingOutsidePreferredHours;
    });
    
    if (readyArcs.length === 0) {
      return null;
    }
    
    // Sort by last progressed time (oldest first)
    readyArcs.sort((a, b) => {
      const aTime = (a.lastProgressedAt || a.startedAt).getTime();
      const bTime = (b.lastProgressedAt || b.startedAt).getTime();
      return aTime - bTime;
    });
    
    return readyArcs[0];
  }

  /**
   * Check if current time is optimal for posting
   * @returns {boolean}
   */
  isOptimalPostingTime() {
    const hour = new Date().getUTCHours();
    return this.config.preferredPostingHoursUTC.includes(hour);
  }

  /**
   * Get time until next optimal posting window
   * @returns {number} Milliseconds until next window
   */
  getTimeUntilNextOptimalWindow() {
    const now = new Date();
    const currentHour = now.getUTCHours();
    
    // Find next preferred hour
    const sortedHours = [...this.config.preferredPostingHoursUTC].sort((a, b) => a - b);
    
    let nextHour = sortedHours.find(h => h > currentHour);
    if (!nextHour) {
      // Wrap to next day
      nextHour = sortedHours[0] + 24;
    }
    
    const hoursUntil = nextHour - currentHour;
    const minutesUntil = 60 - now.getUTCMinutes();
    
    return (hoursUntil - 1) * 60 * 60 * 1000 + minutesUntil * 60 * 1000;
  }

  /**
   * Manually trigger story progression
   * @returns {Promise<Object|null>}
   */
  async triggerProgression() {
    this.logger.info('[StoryScheduler] Manual progression triggered');
    return await this._checkAndProgress();
  }

  /**
   * Get scheduler status
   * @returns {Object}
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      enabled: this.config.enabled,
      checkIntervalMinutes: this.config.checkIntervalMinutes,
      isOptimalPostingTime: this.isOptimalPostingTime(),
      minutesUntilNextOptimalWindow: Math.round(this.getTimeUntilNextOptimalWindow() / 60000)
    };
  }
}

export default StorySchedulerService;
