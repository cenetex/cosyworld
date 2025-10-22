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
 * @param {Container} container - DI container
 */
export function registerStoryAdminRoutes(app, container) {
  const logger = container.resolve('logger');

  // Get all arcs
  app.get('/api/admin/story/arcs', async (req, res) => {
    try {
      const storyState = container.resolve('storyStateService');
      const { status, limit = 50 } = req.query;
      
      const filter = status ? { status } : {};
      const arcs = await storyState.getArcs(filter, { 
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
      const storyState = container.resolve('storyStateService');
      const arc = await storyState.getArc(req.params.id);
      
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
      const storyPlanner = container.resolve('storyPlannerService');
      const { theme, characters, locations } = req.body;
      
      const arc = await storyPlanner.createNewArc({
        theme,
        focusCharacters: characters,
        focusLocations: locations
      });
      
      // Activate the arc
      await storyPlanner.storyState.updateArcStatus(arc._id, 'active');
      
      res.json({ success: true, arc });
    } catch (error) {
      logger.error('[StoryAdmin] Error generating arc:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Manually progress arc (generate next beat)
  app.post('/api/admin/story/arcs/:id/progress', async (req, res) => {
    try {
      const storyPlanner = container.resolve('storyPlannerService');
      const storyPosting = container.resolve('storyPostingService');
      
      const result = await storyPlanner.progressArc(req.params.id);
      
      if (!result) {
        return res.json({ 
          success: true, 
          message: 'Arc completed',
          completed: true 
        });
      }
      
      const { arc, beat } = result;
      
      // Post the beat
      const postResult = await storyPosting.postBeat(arc, beat);
      
      res.json({ 
        success: true, 
        arc, 
        beat, 
        postResult 
      });
    } catch (error) {
      logger.error('[StoryAdmin] Error progressing arc:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Update arc status
  app.put('/api/admin/story/arcs/:id/status', async (req, res) => {
    try {
      const storyState = container.resolve('storyStateService');
      const { status } = req.body;
      
      if (!['planning', 'active', 'paused', 'completed', 'abandoned'].includes(status)) {
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid status' 
        });
      }
      
      const updated = await storyState.updateArcStatus(req.params.id, status);
      
      res.json({ success: updated });
    } catch (error) {
      logger.error('[StoryAdmin] Error updating arc status:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get statistics
  app.get('/api/admin/story/stats', async (req, res) => {
    try {
      const storyPlanner = container.resolve('storyPlannerService');
      const stats = await storyPlanner.getStatistics();
      
      res.json({ success: true, stats });
    } catch (error) {
      logger.error('[StoryAdmin] Error getting stats:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get scheduler status
  app.get('/api/admin/story/scheduler/status', async (req, res) => {
    try {
      const storyScheduler = container.resolve('storySchedulerService');
      const status = storyScheduler.getStatus();
      
      res.json({ success: true, status });
    } catch (error) {
      logger.error('[StoryAdmin] Error getting scheduler status:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Start scheduler
  app.post('/api/admin/story/scheduler/start', async (req, res) => {
    try {
      const storyScheduler = container.resolve('storySchedulerService');
      storyScheduler.start();
      
      res.json({ success: true, message: 'Scheduler started' });
    } catch (error) {
      logger.error('[StoryAdmin] Error starting scheduler:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Stop scheduler
  app.post('/api/admin/story/scheduler/stop', async (req, res) => {
    try {
      const storyScheduler = container.resolve('storySchedulerService');
      storyScheduler.stop();
      
      res.json({ success: true, message: 'Scheduler stopped' });
    } catch (error) {
      logger.error('[StoryAdmin] Error stopping scheduler:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Trigger manual progression
  app.post('/api/admin/story/scheduler/trigger', async (req, res) => {
    try {
      const storyScheduler = container.resolve('storySchedulerService');
      const result = await storyScheduler.triggerProgression();
      
      res.json({ success: true, result });
    } catch (error) {
      logger.error('[StoryAdmin] Error triggering progression:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get world context
  app.get('/api/admin/story/world/context', async (req, res) => {
    try {
      const worldContext = container.resolve('worldContextService');
      const context = await worldContext.getWorldContext();
      
      res.json({ success: true, context });
    } catch (error) {
      logger.error('[StoryAdmin] Error getting world context:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  logger.info('[StoryAdmin] Story admin routes registered');
}

export default registerStoryAdminRoutes;
