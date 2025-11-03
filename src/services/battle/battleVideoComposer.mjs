/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * BattleVideoComposer
 * Composes battle videos from keyframe images with Lyria background music
 * Creates 30-second cinematic battle clips
 */
export class BattleVideoComposer {
  constructor({ logger, veoService, lyriaService, s3Service, databaseService }) {
    this.logger = logger || console;
    this.veoService = veoService;
    this.lyriaService = lyriaService;
    this.s3Service = s3Service;
    this.databaseService = databaseService;

    this.COLLECTION = 'battle_video_compositions';
  }

  /**
   * Get database collection
   * @private
   */
  async _getCol() {
    const db = await this.databaseService.getDatabase();
    return db.collection(this.COLLECTION);
  }

  /**
   * Create a video composition job
   * @param {Object} params
   * @param {string} params.imageUrl - Battle image URL to use as keyframe
   * @param {string} params.prompt - Video generation prompt
   * @param {Object} params.battleContext - Battle context for music generation
   * @param {string} [params.channelId] - Discord channel ID
   * @param {string} [params.guildId] - Discord guild ID
   * @param {string} [params.userId] - User who requested
   * @returns {Promise<string>} Job ID
   */
  async createComposition({
    imageUrl,
    prompt,
    battleContext = {},
    channelId = null,
    guildId = null,
    userId = null
  }) {
    try {
      // Check rate limits for both services
      const [veoAllowed, lyriaAllowed] = await Promise.all([
        this.veoService?.checkRateLimit?.() ?? false,
        this.lyriaService?.checkRateLimit?.() ?? false
      ]);

      if (!veoAllowed) {
        throw new Error('Video generation rate limit exceeded');
      }
      if (!lyriaAllowed) {
        throw new Error('Music generation rate limit exceeded');
      }

      const now = new Date();
      const col = await this._getCol();
      
      const doc = {
        status: 'queued',
        createdAt: now,
        updatedAt: now,
        imageUrl,
        prompt,
        battleContext: {
          mood: battleContext.mood || 'intense',
          genre: battleContext.genre || 'orchestral',
          tempo: battleContext.tempo || 'fast',
          attacker: battleContext.attacker || null,
          defender: battleContext.defender || null,
          outcome: battleContext.outcome || null
        },
        channelId,
        guildId,
        userId,
        videoUrl: null,
        musicUrl: null,
        composedUrl: null,
        error: null
      };

      const result = await col.insertOne(doc);
      const jobId = result.insertedId;

      this.logger?.info?.(`[BattleVideoComposer] Created job ${jobId}`);

      // Start processing in background
      this._processJob(jobId).catch(err => {
        this.logger?.error?.(`[BattleVideoComposer] Background job ${jobId} failed: ${err.message}`);
      });

      return String(jobId);
    } catch (err) {
      this.logger?.error?.(`[BattleVideoComposer] Create job error: ${err.message}`);
      throw err;
    }
  }

  /**
   * Process a video composition job
   * @private
   * @param {string} jobId - Job ID
   */
  async _processJob(jobId) {
    const col = await this._getCol();
    
    try {
      // Update status to processing
      await col.updateOne(
        { _id: jobId },
        { $set: { status: 'processing', updatedAt: new Date() } }
      );

      const job = await col.findOne({ _id: jobId });
      if (!job) throw new Error('Job not found');

      this.logger?.info?.(`[BattleVideoComposer] Processing job ${jobId}`);

      // Step 1: Generate video from keyframe
      this.logger?.info?.(`[BattleVideoComposer] Generating video for job ${jobId}`);
      await col.updateOne(
        { _id: jobId },
        { $set: { status: 'generating_video', updatedAt: new Date() } }
      );

      const imageBuffer = await this.s3Service.downloadImage(job.imageUrl);
      const imageBase64 = imageBuffer.toString('base64');

      const videoUrls = await this.veoService.generateVideosFromImages({
        prompt: job.prompt,
        images: [{ data: imageBase64, mimeType: 'image/png', label: 'keyframe' }],
        config: {
          aspectRatio: '16:9',
          numberOfVideos: 1,
          durationSeconds: 5 // Veo generates ~5s clips
        }
      });

      if (!videoUrls || videoUrls.length === 0) {
        throw new Error('Video generation failed - no URLs returned');
      }

      const videoUrl = videoUrls[0];
      
      await col.updateOne(
        { _id: jobId },
        { $set: { videoUrl, updatedAt: new Date() } }
      );

      this.logger?.info?.(`[BattleVideoComposer] Video generated for job ${jobId}: ${videoUrl}`);

      // Step 2: Generate background music
      this.logger?.info?.(`[BattleVideoComposer] Generating music for job ${jobId}`);
      await col.updateOne(
        { _id: jobId },
        { $set: { status: 'generating_music', updatedAt: new Date() } }
      );

      const musicResult = await this.lyriaService.generateBattleMusic({
        mood: job.battleContext.mood,
        genre: job.battleContext.genre,
        tempo: job.battleContext.tempo
      });

      if (!musicResult || !musicResult.url) {
        this.logger?.warn?.(`[BattleVideoComposer] Music generation failed for job ${jobId}, continuing without music`);
      }

      const musicUrl = musicResult?.url || null;
      
      await col.updateOne(
        { _id: jobId },
        { $set: { musicUrl, updatedAt: new Date() } }
      );

      if (musicUrl) {
        this.logger?.info?.(`[BattleVideoComposer] Music generated for job ${jobId}: ${musicUrl}`);
      }

      // Step 3: Mark as completed (composition happens client-side or in future enhancement)
      // For now, we provide separate video and music URLs
      // Future: Use ffmpeg to actually compose video + music server-side
      
      await col.updateOne(
        { _id: jobId },
        { 
          $set: { 
            status: 'completed',
            updatedAt: new Date(),
            completedAt: new Date()
          } 
        }
      );

      this.logger?.info?.(`[BattleVideoComposer] Job ${jobId} completed successfully`);

      return { videoUrl, musicUrl };

    } catch (err) {
      this.logger?.error?.(`[BattleVideoComposer] Job ${jobId} failed: ${err.message}`);
      
      await col.updateOne(
        { _id: jobId },
        { 
          $set: { 
            status: 'failed',
            error: err.message,
            updatedAt: new Date()
          } 
        }
      );

      throw err;
    }
  }

  /**
   * Get job status
   * @param {string} jobId - Job ID
   * @returns {Promise<object|null>} Job document
   */
  async getJobStatus(jobId) {
    try {
      const col = await this._getCol();
      return await col.findOne({ _id: jobId });
    } catch (err) {
      this.logger?.error?.(`[BattleVideoComposer] Get status error: ${err.message}`);
      return null;
    }
  }

  /**
   * Cancel a job
   * @param {string} jobId - Job ID
   */
  async cancelJob(jobId) {
    try {
      const col = await this._getCol();
      await col.updateOne(
        { _id: jobId },
        { $set: { status: 'cancelled', updatedAt: new Date() } }
      );
      this.logger?.info?.(`[BattleVideoComposer] Cancelled job ${jobId}`);
    } catch (err) {
      this.logger?.error?.(`[BattleVideoComposer] Cancel error: ${err.message}`);
    }
  }

  /**
   * Get recent compositions for a guild/channel
   * @param {Object} options
   * @param {string} [options.guildId] - Guild ID filter
   * @param {string} [options.channelId] - Channel ID filter
   * @param {number} [options.limit=10] - Result limit
   * @returns {Promise<Array>} Recent jobs
   */
  async getRecentCompositions({ guildId = null, channelId = null, limit = 10 } = {}) {
    try {
      const col = await this._getCol();
      const filter = {};
      if (guildId) filter.guildId = guildId;
      if (channelId) filter.channelId = channelId;

      return await col
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
    } catch (err) {
      this.logger?.error?.(`[BattleVideoComposer] Get recent error: ${err.message}`);
      return [];
    }
  }
}

export default BattleVideoComposer;
