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
        chapterVideos: arc.chapterVideos || {},
        episodeVideos: arc.episodeVideos || null,
        beats: (arc.beats || [])
          .map(beat => ({
            id: beat.id,
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
            id: beat.id,
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
   * POST /api/stories/chapters/:arcId/:chapterNumber/animate
   * Generate a video composition from chapter keyframes
   */
  app.post('/api/stories/chapters/:arcId/:chapterNumber/animate', async (req, res) => {
    try {
      const { arcId, chapterNumber } = req.params;
      const chapterNum = parseInt(chapterNumber);
      
      // Validate arcId
      if (!arcId || arcId === 'undefined' || arcId === 'null') {
        logger.error(`[StoryPublicAPI] Invalid arcId received: ${arcId}`);
        return res.status(400).json({
          success: false,
          error: 'Invalid arc ID provided'
        });
      }
      
      logger.info(`[StoryPublicAPI] Animating chapter ${chapterNum} of arc ${arcId}`);

      // Get the arc
      const arc = await storyStateService.getArc(arcId);
      if (!arc) {
        return res.status(404).json({
          success: false,
          error: 'Story arc not found'
        });
      }

      // Calculate beat indices for this chapter (3 beats per chapter)
      const startBeatIndex = (chapterNum - 1) * 3;
      const endBeatIndex = startBeatIndex + 3;
      const chapterBeats = (arc.beats || []).slice(startBeatIndex, endBeatIndex);

      if (chapterBeats.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Chapter not found or incomplete'
        });
      }

      // Check if all beats have images
      const imageUrls = chapterBeats
        .filter(beat => beat.generatedImageUrl)
        .map(beat => beat.generatedImageUrl);

      if (imageUrls.length < chapterBeats.length) {
        return res.status(400).json({
          success: false,
          error: `Chapter incomplete: only ${imageUrls.length} of ${chapterBeats.length} beats have images`
        });
      }

      // Get veoService from services container
      const { veoService, s3Service } = services;
      
      if (!veoService) {
        logger.error('[StoryPublicAPI] Chapter Animation: VeoService not available in services container');
        logger.error('[StoryPublicAPI] Available services:', Object.keys(services));
        return res.status(503).json({
          success: false,
          error: 'Video generation service not available'
        });
      }
      
      logger.info('[StoryPublicAPI] Chapter Animation: VeoService found, checking rate limits...');

      // Check rate limits
      const rateLimitOk = await veoService.checkRateLimit();
      if (!rateLimitOk) {
        return res.status(429).json({
          success: false,
          error: 'Video generation rate limit exceeded. Please try again later.'
        });
      }

      // Download all chapter images as base64 keyframes
      const keyframes = [];
      for (const imageUrl of imageUrls) {
        try {
          const imageBuffer = await s3Service.downloadImage(imageUrl);
          keyframes.push({
            data: imageBuffer.toString('base64'),
            mimeType: 'image/png',
            label: 'keyframe'
          });
        } catch (err) {
          logger.error(`[StoryPublicAPI] Failed to download image ${imageUrl}:`, err);
        }
      }

      if (keyframes.length === 0) {
        return res.status(500).json({
          success: false,
          error: 'Failed to download chapter images'
        });
      }

      // Build video prompt from chapter content
      const chapterDescription = chapterBeats
        .map(beat => beat.description)
        .join(' ');
      
      const basePrompt = `Cinematic animation of "${arc.title}" Chapter ${chapterNum}: ${chapterDescription}. Smooth transitions between scenes, ${arc.emotionalTone} atmosphere, ${arc.theme} theme.`;

      // Use first/last frame interpolation for multi-beat chapters (3 beats = 2 transitions)
      // For single beat, use standard image-to-video
      const allVideoClips = []; // Store {url, fromBeat, toBeat}
      
      if (keyframes.length === 1) {
        // Single keyframe: use standard image-to-video
        logger.info(`[StoryPublicAPI] Generating single-beat chapter video (6s)`);
        
        let videoUrls;
        try {
          videoUrls = await veoService.generateVideosFromImages({
            prompt: basePrompt,
            images: keyframes,
            config: {
              aspectRatio: '16:9',
              numberOfVideos: 1,
              durationSeconds: 6
            }
          });
          
          if (videoUrls && videoUrls.length > 0) {
            allVideoClips.push({
              url: videoUrls[0],
              fromBeat: 0,
              toBeat: 0
            });
          }
        } catch (veoError) {
          logger.error('[StoryPublicAPI] Chapter Animation: Single-beat video generation failed:', veoError);
          return res.status(500).json({
            success: false,
            error: 'Video generation failed',
            details: veoError.message
          });
        }
      } else {
        // Multiple keyframes: generate transition videos between consecutive beats
        const numTransitions = keyframes.length - 1;
        const clipDuration = 6; // 6 seconds per transition
        
        logger.info(`[StoryPublicAPI] Generating ${numTransitions} transition(s) for chapter with ${keyframes.length} beats`);
        
        for (let i = 0; i < numTransitions; i++) {
          const firstFrame = keyframes[i];
          const lastFrame = keyframes[i + 1];
          
          const clipPrompt = `${basePrompt} Beat ${i + 1} to ${i + 2}.`;
          
          try {
            const videoUrls = await veoService.generateVideosWithInterpolation({
              prompt: clipPrompt,
              firstFrame,
              lastFrame,
              config: {
                aspectRatio: '16:9',
                numberOfVideos: 1,
                durationSeconds: clipDuration,
                personGeneration: 'allow_adult'
              }
            });
            
            if (videoUrls && videoUrls.length > 0) {
              allVideoClips.push({
                url: videoUrls[0],
                fromBeat: i,
                toBeat: i + 1
              });
              logger.info(`[StoryPublicAPI] Chapter transition ${i + 1}/${numTransitions} generated`);
            }
          } catch (veoError) {
            logger.error(`[StoryPublicAPI] Chapter Animation: Transition ${i + 1} failed:`, veoError);
            // Continue with other transitions
          }
        }
      }

      if (allVideoClips.length === 0) {
        logger.error('[StoryPublicAPI] Chapter Animation: No videos generated');
        return res.status(500).json({
          success: false,
          error: 'Video generation failed - no videos were generated'
        });
      }

      logger.info(`[StoryPublicAPI] Chapter animation complete: ${allVideoClips.length} video(s) generated`);

      // Store generated videos in arc metadata for future reference
      const chapterVideos = arc.chapterVideos || {};
      chapterVideos[`chapter_${chapterNum}`] = {
        videoClips: allVideoClips, // [{url, fromBeat, toBeat}, ...]
        videoUrls: allVideoClips.map(clip => clip.url), // Backward compatibility
        generatedAt: new Date(),
        beatCount: chapterBeats.length
      };
      
      await storyStateService.updateArc(arcId, { chapterVideos });
      logger.info(`[StoryPublicAPI] Stored chapter ${chapterNum} videos in arc metadata`);

      res.json({
        success: true,
        videoClips: allVideoClips,
        videoUrls: allVideoClips.map(clip => clip.url), // Backward compatibility
        videoUrl: allVideoClips[0].url,
        clipCount: allVideoClips.length,
        chapter: {
          arcId: arc._id.toString(),
          chapterNumber: chapterNum,
          beatCount: chapterBeats.length,
          title: arc.title
        }
      });

    } catch (error) {
      logger.error('[StoryPublicAPI] Error animating chapter:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate chapter video',
        details: error.message
      });
    }
  });

  /**
   * POST /api/stories/episodes/:arcId/animate
   * Generate a video composition from all beats in an entire episode (arc)
   */
  app.post('/api/stories/episodes/:arcId/animate', async (req, res) => {
    try {
      const { arcId } = req.params;
      
      // Validate arcId
      if (!arcId || arcId === 'undefined' || arcId === 'null') {
        logger.error(`[StoryPublicAPI] Invalid arcId received for episode: ${arcId}`);
        return res.status(400).json({
          success: false,
          error: 'Invalid arc ID provided'
        });
      }
      
      logger.info(`[StoryPublicAPI] Animating entire episode ${arcId}`);

      // Get the arc
      const arc = await storyStateService.getArc(arcId);
      if (!arc) {
        return res.status(404).json({
          success: false,
          error: 'Episode not found'
        });
      }

      // Get all beats with images
      const imageUrls = (arc.beats || [])
        .filter(beat => beat.generatedImageUrl)
        .map(beat => beat.generatedImageUrl);

      if (imageUrls.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Episode has no completed beats with images'
        });
      }

      // Limit to max 9 keyframes for episode-length videos
      const maxKeyframes = 9;
      const selectedImages = imageUrls.length > maxKeyframes
        ? imageUrls.filter((_, i) => i % Math.ceil(imageUrls.length / maxKeyframes) === 0).slice(0, maxKeyframes)
        : imageUrls;

      logger.info(`[StoryPublicAPI] Episode Animation: Selected ${selectedImages.length} keyframes from ${imageUrls.length} total beats`);

      // Get veoService from services container
      const { veoService, s3Service } = services;
      
      if (!veoService) {
        logger.error('[StoryPublicAPI] Episode Animation: VeoService not available in services container');
        logger.error('[StoryPublicAPI] Available services:', Object.keys(services));
        return res.status(503).json({
          success: false,
          error: 'Video generation service not available - VeoService not initialized'
        });
      }
      
      if (!s3Service) {
        logger.error('[StoryPublicAPI] Episode Animation: S3Service not available in services container');
        return res.status(503).json({
          success: false,
          error: 'Storage service not available'
        });
      }
      
      logger.info('[StoryPublicAPI] Episode Animation: VeoService and S3Service found, checking rate limits...');

      // Check rate limits
      const rateLimitOk = await veoService.checkRateLimit();
      if (!rateLimitOk) {
        return res.status(429).json({
          success: false,
          error: 'Video generation rate limit exceeded. Please try again later.'
        });
      }

      // Download selected images as base64 keyframes
      const keyframes = [];
      for (const imageUrl of selectedImages) {
        try {
          const imageBuffer = await s3Service.downloadImage(imageUrl);
          keyframes.push({
            data: imageBuffer.toString('base64'),
            mimeType: 'image/png',
            label: 'keyframe'
          });
        } catch (err) {
          logger.error(`[StoryPublicAPI] Failed to download image ${imageUrl}:`, err);
        }
      }

      if (keyframes.length === 0) {
        return res.status(500).json({
          success: false,
          error: 'Failed to download episode images'
        });
      }

      // Check if we have existing chapter videos to reuse
      const chapterVideos = arc.chapterVideos || {};
      const beatsPerChapter = 3;
      const totalChapters = Math.ceil((arc.beats || []).length / beatsPerChapter);
      
      // Collect existing chapter videos
      const existingChapterVideos = [];
      let newTransitionsNeeded = [];
      
      for (let chapterNum = 1; chapterNum <= totalChapters; chapterNum++) {
        const chapterKey = `chapter_${chapterNum}`;
        if (chapterVideos[chapterKey] && chapterVideos[chapterKey].videoUrls) {
          existingChapterVideos.push(...chapterVideos[chapterKey].videoUrls);
          logger.info(`[StoryPublicAPI] Reusing ${chapterVideos[chapterKey].videoUrls.length} existing video(s) for chapter ${chapterNum}`);
        } else {
          // Mark this chapter's transitions for generation
          const startIdx = (chapterNum - 1) * beatsPerChapter;
          const endIdx = Math.min(startIdx + beatsPerChapter, keyframes.length);
          for (let i = startIdx; i < endIdx - 1; i++) {
            newTransitionsNeeded.push(i);
          }
        }
      }
      
      logger.info(`[StoryPublicAPI] Episode Animation: Reusing ${existingChapterVideos.length} existing chapter videos, generating ${newTransitionsNeeded.length} new transitions`);

      // Build video prompt from arc metadata
      const basePrompt = `Cinematic transition in "${arc.title}". A ${arc.theme} story with ${arc.emotionalTone} atmosphere. Smooth animation between moments, dramatic pacing, cohesive visual flow.`;

      // Use Veo's first/last frame interpolation to generate videos between consecutive keyframes
      // This creates smooth transitions between each pair of story beats
      // Target: 6-8 seconds per transition to reach ~30+ seconds total
      const clipDuration = 6; // 6 seconds per transition
      
      // Start with existing chapter videos
      const allVideoClips = []; // [{url, fromBeat, toBeat}, ...]
      
      // Add existing chapter videos with their beat mapping
      for (let chapterNum = 1; chapterNum <= totalChapters; chapterNum++) {
        const chapterKey = `chapter_${chapterNum}`;
        if (chapterVideos[chapterKey] && chapterVideos[chapterKey].videoClips) {
          allVideoClips.push(...chapterVideos[chapterKey].videoClips);
        } else if (chapterVideos[chapterKey] && chapterVideos[chapterKey].videoUrls) {
          // Backward compatibility: convert old format to new format
          const startBeat = (chapterNum - 1) * beatsPerChapter;
          chapterVideos[chapterKey].videoUrls.forEach((url, i) => {
            allVideoClips.push({
              url,
              fromBeat: startBeat + i,
              toBeat: startBeat + i + 1
            });
          });
        }
      }
      
      // Track newly generated videos by chapter for storage
      const newChapterVideos = {};
      
      // Generate only the new transitions needed and track by chapter
      for (let idx = 0; idx < newTransitionsNeeded.length; idx++) {
        const i = newTransitionsNeeded[idx];
        const firstFrame = keyframes[i];
        const lastFrame = keyframes[i + 1];
        
        // Determine which chapter this transition belongs to
        const chapterNum = Math.floor(i / beatsPerChapter) + 1;
        const chapterKey = `chapter_${chapterNum}`;
        
        const clipPrompt = `${basePrompt} Transition ${idx + 1} of ${newTransitionsNeeded.length}.`;
        logger.info(`[StoryPublicAPI] Generating transition ${idx + 1}/${newTransitionsNeeded.length} (keyframe ${i} → ${i + 1}) for chapter ${chapterNum}`);

        let videoUrls;
        try {
          videoUrls = await veoService.generateVideosWithInterpolation({
            prompt: clipPrompt,
            firstFrame,
            lastFrame,
            config: {
              aspectRatio: '16:9',
              numberOfVideos: 1,
              durationSeconds: clipDuration,
              personGeneration: 'allow_adult'
            }
          });

          if (videoUrls && videoUrls.length > 0) {
            const videoUrl = videoUrls[0];
            const videoClip = {
              url: videoUrl,
              fromBeat: i,
              toBeat: i + 1
            };
            allVideoClips.push(videoClip);
            
            // Track this video for the chapter
            if (!newChapterVideos[chapterKey]) {
              newChapterVideos[chapterKey] = [];
            }
            newChapterVideos[chapterKey].push(videoClip);
            
            logger.info(`[StoryPublicAPI] Transition ${idx + 1} generated for chapter ${chapterNum}: ${videoUrl}`);
          }
        } catch (veoError) {
          logger.error(`[StoryPublicAPI] Episode Animation: Transition ${idx + 1} generation failed:`, veoError);
          logger.error(`[StoryPublicAPI] Error details:`, {
            message: veoError.message,
            stack: veoError.stack,
            transitionIndex: idx + 1
          });
          // Continue with other transitions even if one fails
        }
      }

      if (allVideoClips.length === 0) {
        logger.error('[StoryPublicAPI] Episode Animation: No transition videos were generated successfully');
        return res.status(500).json({
          success: false,
          error: 'Video generation failed - no transition videos were generated'
        });
      }

      logger.info(`[StoryPublicAPI] Episode animation complete: ${allVideoClips.length} transition video(s) (${existingChapterVideos.length} reused, ${newTransitionsNeeded.length} new)`);

      // Merge new chapter videos with existing ones
      const updatedChapterVideos = { ...(arc.chapterVideos || {}) };
      for (const [chapterKey, videoClips] of Object.entries(newChapterVideos)) {
        updatedChapterVideos[chapterKey] = {
          videoClips: videoClips,
          videoUrls: videoClips.map(clip => clip.url), // Backward compatibility
          generatedAt: new Date(),
          beatCount: beatsPerChapter
        };
        logger.info(`[StoryPublicAPI] Stored ${videoClips.length} video(s) for ${chapterKey}`);
      }

      // Store both episode videos and updated chapter videos
      await storyStateService.updateArc(arcId, {
        chapterVideos: updatedChapterVideos,
        episodeVideos: {
          videoClips: allVideoClips,
          videoUrls: allVideoClips.map(clip => clip.url), // Backward compatibility
          generatedAt: new Date(),
          totalBeats: arc.beats?.length || 0,
          reusedCount: existingChapterVideos.length,
          newCount: newTransitionsNeeded.length
        }
      });
      logger.info(`[StoryPublicAPI] Stored episode videos and ${Object.keys(newChapterVideos).length} new chapter video(s) in arc metadata`);

      res.json({
        success: true,
        videoClips: allVideoClips,
        videoUrls: allVideoClips.map(clip => clip.url), // Backward compatibility
        videoUrl: allVideoClips[0]?.url, // First transition for backwards compatibility
        clipCount: allVideoClips.length,
        totalDuration: allVideoClips.length * clipDuration,
        reusedCount: existingChapterVideos.length,
        newCount: newTransitionsNeeded.length,
        episode: {
          arcId: arc._id.toString(),
          title: arc.title,
          totalBeats: arc.beats?.length || 0,
          keyframesUsed: keyframes.length,
          chapterCount: Math.ceil((arc.beats?.length || 0) / 3)
        }
      });

    } catch (error) {
      logger.error('[StoryPublicAPI] Error animating episode:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate episode video',
        details: error.message
      });
    }
  });

  /**
   * GET /api/stories/chapters/:arcId/:chapterNumber/videos
   * Get video status for a specific chapter
   */
  app.get('/api/stories/chapters/:arcId/:chapterNumber/videos', async (req, res) => {
    try {
      const { arcId, chapterNumber } = req.params;
      
      const arc = await storyStateService.getArc(arcId);
      if (!arc) {
        return res.status(404).json({
          success: false,
          error: 'Story arc not found'
        });
      }

      const chapterKey = `chapter_${chapterNumber}`;
      const chapterVideos = arc.chapterVideos?.[chapterKey];

      if (!chapterVideos || (!chapterVideos.videoClips && !chapterVideos.videoUrls)) {
        return res.json({
          success: true,
          hasVideos: false,
          status: 'not_generated'
        });
      }

      // Support both new format (videoClips) and old format (videoUrls)
      const videoClips = chapterVideos.videoClips || chapterVideos.videoUrls?.map((url, i) => ({
        url,
        fromBeat: i,
        toBeat: i + 1
      })) || [];

      res.json({
        success: true,
        hasVideos: true,
        status: 'complete',
        videoClips: videoClips,
        videoUrls: videoClips.map(clip => clip.url), // Backward compatibility
        generatedAt: chapterVideos.generatedAt,
        clipCount: videoClips.length
      });

    } catch (error) {
      logger.error('[StoryPublicAPI] Error checking chapter video status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to check video status'
      });
    }
  });

  /**
   * GET /api/stories/episodes/:arcId/videos
   * Get video status for an episode
   */
  app.get('/api/stories/episodes/:arcId/videos', async (req, res) => {
    try {
      const { arcId } = req.params;
      
      const arc = await storyStateService.getArc(arcId);
      if (!arc) {
        return res.status(404).json({
          success: false,
          error: 'Episode not found'
        });
      }

      const episodeVideos = arc.episodeVideos;

      if (!episodeVideos || (!episodeVideos.videoClips && !episodeVideos.videoUrls)) {
        return res.json({
          success: true,
          hasVideos: false,
          status: 'not_generated'
        });
      }

      // Support both new format (videoClips) and old format (videoUrls)
      const videoClips = episodeVideos.videoClips || episodeVideos.videoUrls?.map((url, i) => ({
        url,
        fromBeat: i,
        toBeat: i + 1
      })) || [];

      res.json({
        success: true,
        hasVideos: true,
        status: 'complete',
        videoClips: videoClips,
        videoUrls: videoClips.map(clip => clip.url), // Backward compatibility
        generatedAt: episodeVideos.generatedAt,
        clipCount: videoClips.length,
        reusedCount: episodeVideos.reusedCount,
        newCount: episodeVideos.newCount
      });

    } catch (error) {
      logger.error('[StoryPublicAPI] Error checking episode video status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to check video status'
      });
    }
  });

  /**
   * POST /api/stories/chapters/:arcId/:chapterNumber/concatenate
   * Concatenate chapter videos into a single file using ffmpeg
   */
  app.post('/api/stories/chapters/:arcId/:chapterNumber/concatenate', async (req, res) => {
    try {
      const { arcId, chapterNumber } = req.params;
      
      const arc = await storyStateService.getArc(arcId);
      if (!arc) {
        return res.status(404).json({
          success: false,
          error: 'Story arc not found'
        });
      }

      const chapterKey = `chapter_${chapterNumber}`;
      const chapterVideos = arc.chapterVideos?.[chapterKey];

      if (!chapterVideos || (!chapterVideos.videoClips && !chapterVideos.videoUrls)) {
        return res.status(404).json({
          success: false,
          error: 'No videos found for this chapter'
        });
      }

      // Get video URLs
      const videoUrls = chapterVideos.videoClips?.map(clip => clip.url) || chapterVideos.videoUrls || [];

      if (videoUrls.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'No video URLs available'
        });
      }

      // Check if already concatenated
      if (chapterVideos.concatenatedUrl) {
        logger.info(`[StoryPublicAPI] Returning existing concatenated video for chapter ${chapterNumber}`);
        return res.json({
          success: true,
          videoUrl: chapterVideos.concatenatedUrl,
          cached: true
        });
      }

      logger.info(`[StoryPublicAPI] Concatenating ${videoUrls.length} videos for chapter ${chapterNumber}`);

      // Get services
      const { s3Service } = services;
      if (!s3Service) {
        return res.status(503).json({
          success: false,
          error: 'Storage service not available'
        });
      }

      // Import video utils
      const { concatenateVideos } = await import('../../utils/videoUtils.mjs');
      
      // Concatenate videos and upload result
      const concatenatedUrl = await concatenateVideos(videoUrls, s3Service, {
        prefix: `story-videos/${arcId}/chapter-${chapterNumber}`
      });

      // Store concatenated URL
      const updatedChapterVideos = { ...(arc.chapterVideos || {}) };
      updatedChapterVideos[chapterKey] = {
        ...chapterVideos,
        concatenatedUrl,
        concatenatedAt: new Date()
      };
      
      await storyStateService.updateArc(arcId, { chapterVideos: updatedChapterVideos });
      logger.info(`[StoryPublicAPI] Stored concatenated video URL for chapter ${chapterNumber}`);

      res.json({
        success: true,
        videoUrl: concatenatedUrl,
        cached: false
      });

    } catch (error) {
      logger.error('[StoryPublicAPI] Error concatenating chapter videos:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to concatenate videos',
        details: error.message
      });
    }
  });

  /**
   * POST /api/stories/episodes/:arcId/concatenate
   * Concatenate episode videos into a single file using ffmpeg
   */
  app.post('/api/stories/episodes/:arcId/concatenate', async (req, res) => {
    try {
      const { arcId } = req.params;
      
      const arc = await storyStateService.getArc(arcId);
      if (!arc) {
        return res.status(404).json({
          success: false,
          error: 'Episode not found'
        });
      }

      const episodeVideos = arc.episodeVideos;

      if (!episodeVideos || (!episodeVideos.videoClips && !episodeVideos.videoUrls)) {
        return res.status(404).json({
          success: false,
          error: 'No videos found for this episode'
        });
      }

      // Get video URLs
      const videoUrls = episodeVideos.videoClips?.map(clip => clip.url) || episodeVideos.videoUrls || [];

      if (videoUrls.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'No video URLs available'
        });
      }

      // Check if already concatenated
      if (episodeVideos.concatenatedUrl) {
        logger.info(`[StoryPublicAPI] Returning existing concatenated video for episode ${arcId}`);
        return res.json({
          success: true,
          videoUrl: episodeVideos.concatenatedUrl,
          cached: true
        });
      }

      logger.info(`[StoryPublicAPI] Concatenating ${videoUrls.length} videos for episode ${arcId}`);

      // Get services
      const { s3Service } = services;
      if (!s3Service) {
        return res.status(503).json({
          success: false,
          error: 'Storage service not available'
        });
      }

      // Import video utils
      const { concatenateVideos } = await import('../../utils/videoUtils.mjs');
      
      // Concatenate videos and upload result
      const concatenatedUrl = await concatenateVideos(videoUrls, s3Service, {
        prefix: `story-videos/${arcId}/episode`
      });

      // Store concatenated URL
      await storyStateService.updateArc(arcId, {
        episodeVideos: {
          ...episodeVideos,
          concatenatedUrl,
          concatenatedAt: new Date()
        }
      });
      logger.info(`[StoryPublicAPI] Stored concatenated video URL for episode ${arcId}`);

      res.json({
        success: true,
        videoUrl: concatenatedUrl,
        cached: false
      });

    } catch (error) {
      logger.error('[StoryPublicAPI] Error concatenating episode videos:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to concatenate videos',
        details: error.message
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
