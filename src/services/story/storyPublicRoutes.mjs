/**
 * @fileoverview Public-facing story routes for displaying story arcs and beats
 * @module services/story/storyPublicRoutes
 */

/**
 * Register public story routes
 * @param {Object} app - Express app
 * @param {Object} services - Service container
 */
export function registerStoryPublicRoutes(app, services) {
  const { storyStateService, logger } = services;

  /**
   * GET /api/stories
   * Get all story arcs with their beats for public display
   */
  app.get('/api/stories', async (req, res) => {
    try {
      logger.info('[StoryPublicAPI] Fetching all stories for public view');

      // Get all arcs sorted by creation date (newest first)
      const arcs = await storyStateService.getAllArcs({
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });

      // Get statistics
      const stats = await storyStateService.getStatistics();

      // Calculate total beats
      const totalBeats = arcs.reduce((sum, arc) => sum + (arc.beats?.length || 0), 0);

      // Format arcs for public consumption
      const formattedArcs = arcs.map(arc => ({
        id: arc._id.toString(),
        title: arc.title,
        theme: arc.theme,
        emotionalTone: arc.emotionalTone,
        status: arc.status,
        plannedBeats: arc.plannedBeats,
        createdAt: arc.createdAt,
        updatedAt: arc.updatedAt,
        completedAt: arc.completedAt,
        characters: arc.characters || [],
        locations: arc.locations || [],
        beats: (arc.beats || [])
          .map(beat => ({
            sequenceNumber: beat.sequenceNumber,
            type: beat.type,
            description: beat.description,
            location: beat.location,
            characters: beat.characters || [],
            generatedImageUrl: beat.generatedImageUrl,
            caption: beat.caption,
            postedAt: beat.postedAt
          }))
      }));

      res.json({
        success: true,
        stats: {
          totalArcs: stats.totalArcs,
          activeArcs: stats.activeArcs,
          completedArcs: stats.completedArcs,
          totalBeats
        },
        arcs: formattedArcs
      });

    } catch (error) {
      logger.error('[StoryPublicAPI] Error fetching stories:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to load stories'
      });
    }
  });

  /**
   * GET /api/stories/:arcId
   * Get a specific story arc with all its beats
   */
  app.get('/api/stories/:arcId', async (req, res) => {
    try {
      const { arcId } = req.params;
      logger.info(`[StoryPublicAPI] Fetching story arc ${arcId}`);

      const arc = await storyStateService.getArc(arcId);

      if (!arc) {
        return res.status(404).json({
          success: false,
          error: 'Story not found'
        });
      }

      // Format arc for public consumption
      const formattedArc = {
        id: arc._id.toString(),
        title: arc.title,
        theme: arc.theme,
        emotionalTone: arc.emotionalTone,
        status: arc.status,
        plannedBeats: arc.plannedBeats,
        createdAt: arc.createdAt,
        updatedAt: arc.updatedAt,
        completedAt: arc.completedAt,
        summary: arc.summary,
        characters: arc.characters || [],
        locations: arc.locations || [],
        beats: (arc.beats || [])
          .map(beat => ({
            sequenceNumber: beat.sequenceNumber,
            type: beat.type,
            description: beat.description,
            location: beat.location,
            characters: beat.characters || [],
            visualPrompt: beat.visualPrompt,
            generatedImageUrl: beat.generatedImageUrl,
            caption: beat.caption,
            postedAt: beat.postedAt,
            socialPosts: beat.socialPosts
          }))
      };

      res.json({
        success: true,
        arc: formattedArc
      });

    } catch (error) {
      logger.error('[StoryPublicAPI] Error fetching story arc:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to load story'
      });
    }
  });

  /**
   * GET /stories
   * Serve the stories HTML page
   */
  app.get('/stories', (req, res) => {
    res.sendFile('stories.html', { root: './public' });
  });

  logger.info('[StoryPublicAPI] Public story routes registered');
}

export default registerStoryPublicRoutes;
