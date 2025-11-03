/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

import express from 'express';

/**
 * Story Archive API Routes
 * Handles archive browsing, chapter navigation, and character continuity
 */
export function createStoryArchiveRoutes({ storyArchiveService, logger }) {
  const router = express.Router();
  const log = logger || console;

  /**
   * GET /api/stories/latest
   * Get the latest chapters (current + 2 most recent)
   */
  router.get('/latest', async (req, res) => {
    try {
      const { arcId } = req.query;
      const result = await storyArchiveService.getLatestChapters(arcId);
      res.json(result);
    } catch (error) {
      log.error('[Archive API] Error getting latest chapters:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  });

  /**
   * GET /api/stories/archive
   * Get archived chapters (paginated)
   * Query params: page, limit, arcId
   */
  router.get('/archive', async (req, res) => {
    try {
      const {
        page = 1,
        limit = 10,
        arcId = null,
        view = 'arcs' // 'arcs' | 'chapters'
      } = req.query;

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      const result = (String(view).toLowerCase() === 'chapters')
        ? await storyArchiveService.getArchivedChapters({
            page: pageNum,
            limit: limitNum,
            arcId
          })
        : await storyArchiveService.getArchivedArcs({
            page: pageNum,
            limit: limitNum
          });

      res.json(result);
    } catch (error) {
      log.error('[Archive API] Error getting archive:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  });

  /**
   * GET /api/stories/chapters/:arcId/:chapterNumber
   * Get a specific chapter
   */
  router.get('/chapters/:arcId/:chapterNumber', async (req, res) => {
    try {
      const { arcId, chapterNumber } = req.params;
      const result = await storyArchiveService.getChapter(
        arcId,
        parseInt(chapterNumber)
      );
      res.json(result);
    } catch (error) {
      log.error('[Archive API] Error getting chapter:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  });

  /**
   * GET /api/stories/core-characters
   * Get the core character roster (12 characters used across arcs)
   */
  router.get('/core-characters', async (req, res) => {
    try {
      const result = await storyArchiveService.getCoreCharacters();
      res.json(result);
    } catch (error) {
      log.error('[Archive API] Error getting core characters:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  });

  /**
   * GET /api/stories/stats
   * Get archive statistics
   */
  router.get('/stats', async (req, res) => {
    try {
      const result = await storyArchiveService.getArchiveStats();
      res.json(result);
    } catch (error) {
      log.error('[Archive API] Error getting stats:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  });

  /**
   * POST /api/stories/arc/:arcId/summary
   * Generate AI summary for an arc
   */
  router.post('/arc/:arcId/summary', async (req, res) => {
    try {
      const { arcId } = req.params;
      const summary = await storyArchiveService.generateArcSummary(arcId);
      res.json({
        success: true,
        summary
      });
    } catch (error) {
      log.error('[Archive API] Error generating summary:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  });

  return router;
}

export default createStoryArchiveRoutes;
