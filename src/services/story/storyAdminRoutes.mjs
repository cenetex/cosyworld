/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Story Admin API Endpoints
 * 
 * Provides HTTP endpoints for managing the storytelling system.
 * These routes should be mounted under /api/admin/story
 */

/**
 * Register story admin routes
 * @param {Express} app - Express app
 * @param {Object} deps - Explicit dependencies
 */
export function registerStoryAdminRoutes(app, deps = {}) {
  const {
    logger,
    storyStateService,
    storyPlannerService,
    storyPostingService,
    storySchedulerService,
    worldContextService,
  } = deps;

  if (!logger) {
    throw new Error('registerStoryAdminRoutes requires logger');
  }

  // Get all arcs
  app.get('/api/admin/story/arcs', async (req, res) => {
    try {
      const { status, limit = 50 } = req.query;
      
      const filter = status ? { status } : {};
      const arcs = await storyStateService.getArcs(filter, { 
        sort: { startedAt: -1 }, 
        limit: parseInt(limit) 
      });
      
      res.json({ success: true, arcs });
    } catch (error) {
      logger.error('[StoryAdmin] Error getting arcs:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get specific arc
  app.get('/api/admin/story/arcs/:id', async (req, res) => {
    try {
      const arc = await storyStateService.getArc(req.params.id);
      
      if (!arc) {
        return res.status(404).json({ success: false, error: 'Arc not found' });
      }
      
      res.json({ success: true, arc });
    } catch (error) {
      logger.error('[StoryAdmin] Error getting arc:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Generate new arc
  app.post('/api/admin/story/arcs/generate', async (req, res) => {
    try {
      const { theme, characters, locations } = req.body;
      
      const arc = await storyPlannerService.createNewArc({
        theme,
        focusCharacters: characters,
        focusLocations: locations
      });
      
      // Activate the arc
      await storyPlannerService.storyState.updateArcStatus(arc._id, 'active');
      
      res.json({ success: true, arc });
    } catch (error) {
      logger.error('[StoryAdmin] Error generating arc:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Manually progress arc (generate next chapter - 3 beats)
  app.post('/api/admin/story/arcs/:id/progress', async (req, res) => {
    try {
      const result = await storyPlannerService.progressArc(req.params.id);
      
      if (!result) {
        return res.json({ 
          success: true, 
          message: 'Arc completed',
          completed: true 
        });
      }
      
      const { arc, chapter, beats } = result;
      
      // Post each beat in the chapter
      const postResults = [];
      for (const beat of beats) {
        const postResult = await storyPostingService.postBeat(arc, beat);
        postResults.push({ beat, postResult });
      }
      
      res.json({ 
        success: true, 
        arc, 
        chapter,
        beats,
        postResults 
      });
    } catch (error) {
      logger.error('[StoryAdmin] Error progressing arc:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Update arc status
  app.put('/api/admin/story/arcs/:id/status', async (req, res) => {
    try {
      const { status } = req.body;
      
      if (!['planning', 'active', 'paused', 'completed', 'abandoned'].includes(status)) {
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid status' 
        });
      }
      
      const updated = await storyStateService.updateArcStatus(req.params.id, status);
      
      res.json({ success: updated });
    } catch (error) {
      logger.error('[StoryAdmin] Error updating arc status:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get statistics
  app.get('/api/admin/story/stats', async (req, res) => {
    try {
      const stats = await storyPlannerService.getStatistics();
      
      res.json({ success: true, stats });
    } catch (error) {
      logger.error('[StoryAdmin] Error getting stats:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get scheduler status
  app.get('/api/admin/story/scheduler/status', async (req, res) => {
    try {
      const status = storySchedulerService.getStatus();
      
      res.json({ success: true, status });
    } catch (error) {
      logger.error('[StoryAdmin] Error getting scheduler status:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Start scheduler
  app.post('/api/admin/story/scheduler/start', async (req, res) => {
    try {
      storySchedulerService.start();
      
      res.json({ success: true, message: 'Scheduler started' });
    } catch (error) {
      logger.error('[StoryAdmin] Error starting scheduler:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Stop scheduler
  app.post('/api/admin/story/scheduler/stop', async (req, res) => {
    try {
      storySchedulerService.stop();
      
      res.json({ success: true, message: 'Scheduler stopped' });
    } catch (error) {
      logger.error('[StoryAdmin] Error stopping scheduler:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Trigger manual progression
  app.post('/api/admin/story/scheduler/trigger', async (req, res) => {
    try {
      const result = await storySchedulerService.triggerProgression();
      
      res.json({ success: true, result });
    } catch (error) {
      logger.error('[StoryAdmin] Error triggering progression:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get world context
  app.get('/api/admin/story/world/context', async (req, res) => {
    try {
      const context = await worldContextService.getWorldContext();
      
      res.json({ success: true, context });
    } catch (error) {
      logger.error('[StoryAdmin] Error getting world context:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  logger.info('[StoryAdmin] Story admin routes registered');
}

export default registerStoryAdminRoutes;
