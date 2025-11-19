/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { GoogleGenAI, GenerateVideosOperation } from "@google/genai";
import fs from 'fs';
import path from 'path';
import os from 'os';

export class VeoService {
  constructor({ configService, logger, s3Service, databaseService }) {
    this.configService = configService;
    this.logger = logger || console;
    this.databaseService = databaseService;
    const config = this.configService.config.ai.google;
    this.apiKey = config.apiKey || process.env.GOOGLE_API_KEY;
    this.ai = new GoogleGenAI({ apiKey: this.apiKey });
    this.s3Service = s3Service;
  // Hard global cap (in-memory) to prevent abuse; can be customized via config/env
  this.GLOBAL_DAILY_CAP = Number(this.configService?.config?.ai?.veo?.rateLimit?.globalCap ?? 3);
  // Polling controls
  this.POLL_INTERVAL_MS = Number(process.env.VEO_POLL_INTERVAL_MS || 10000);
  this.MAX_POLL_MINUTES = Number(process.env.VEO_MAX_POLL_MINUTES || 10);
  }

  // DEPRECATED: In-memory tracking (kept for backward compatibility but not used for primary rate limiting)
  recentRequests = [];

  /**
   * Get database collection for video generation tracking
   * @private
   */
  async _getVideoGenerationCol() {
    const db = await this.databaseService.getDatabase();
    return db.collection('veo_video_generations');
  }

  /**
   * Check rate limits using persistent database storage
   * Ensures global daily cap is enforced even across server restarts
   * @returns {Promise<boolean>} True if generation is allowed, false if rate limited
   */
  async checkRateLimit() {
    try {
      const now = Date.now();
      const perMinuteLimit = this.configService?.config?.ai?.veo?.rateLimit?.perMinute ?? 1;
      const perDayLimit = this.configService?.config?.ai?.veo?.rateLimit?.perDay ?? 3;
      const globalDailyCap = this.GLOBAL_DAILY_CAP;

      const col = await this._getVideoGenerationCol();
      
      // Check per-minute limit (last 60 seconds)
      const oneMinuteAgo = new Date(now - 60 * 1000);
      const recentCount = await col.countDocuments({
        timestamp: { $gte: oneMinuteAgo },
        status: { $in: ['started', 'completed'] }
      });
      
      if (recentCount >= perMinuteLimit) {
        this.logger?.warn?.(`[VeoService] Per-minute rate limit exceeded (${recentCount}/${perMinuteLimit})`);
        return false;
      }

      // Check per-day limit (last 24 hours)
      const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
      const dailyCount = await col.countDocuments({
        timestamp: { $gte: oneDayAgo },
        status: { $in: ['started', 'completed'] }
      });
      
      if (dailyCount >= perDayLimit) {
        this.logger?.warn?.(`[VeoService] Per-day rate limit exceeded (${dailyCount}/${perDayLimit})`);
        return false;
      }

      // Enforce global daily cap (strictest limit)
      if (dailyCount >= globalDailyCap) {
        this.logger?.warn?.(`[VeoService] GLOBAL DAILY CAP exceeded (${dailyCount}/${globalDailyCap}) - THIS IS EXPENSIVE!`);
        return false;
      }

      // Log current usage
      this.logger?.info?.(`[VeoService] Rate limit check passed: ${dailyCount}/${globalDailyCap} videos today, ${recentCount}/${perMinuteLimit} last minute`);
      return true;
    } catch (err) {
      this.logger?.error?.(`[VeoService] Error checking rate limit: ${err.message}`);
      // Fail closed - deny generation if we can't check limits
      return false;
    }
  }

  /**
   * Record a video generation attempt in the database
   * @private
   * @param {string} operation - Operation type (generate, extend, interpolate, etc)
   * @param {string} status - Status (started, completed, failed)
   * @param {object} metadata - Additional metadata about the generation
   * @returns {Promise<object>} Inserted document
   */
  async _recordGeneration(operation, status, metadata = {}) {
    try {
      const col = await this._getVideoGenerationCol();
      const doc = {
        operation,
        status,
        timestamp: new Date(),
        metadata: {
          ...metadata,
          model: metadata.model || 'veo-3.1-generate-preview',
          dailyCount: null // Will be updated below
        }
      };

      const result = await col.insertOne(doc);
      
      // Update daily count in metadata
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const dailyCount = await col.countDocuments({
        timestamp: { $gte: oneDayAgo },
        status: { $in: ['started', 'completed'] }
      });
      
      await col.updateOne(
        { _id: result.insertedId },
        { $set: { 'metadata.dailyCount': dailyCount } }
      );

      this.logger?.info?.(`[VeoService] Recorded ${operation} (${status}): ${dailyCount}/${this.GLOBAL_DAILY_CAP} videos today`);
      
      return result;
    } catch (err) {
      this.logger?.error?.(`[VeoService] Error recording generation: ${err.message}`);
      throw err;
    }
  }

  /**
   * Get statistics about video generation usage
   * @returns {Promise<object>} Usage statistics
   */
  async getUsageStats() {
    try {
      const col = await this._getVideoGenerationCol();
      const now = Date.now();
      const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
      const oneHourAgo = new Date(now - 60 * 60 * 1000);

      const [dailyCount, hourlyCount, totalCount, recentGenerations] = await Promise.all([
        col.countDocuments({
          timestamp: { $gte: oneDayAgo },
          status: { $in: ['started', 'completed'] }
        }),
        col.countDocuments({
          timestamp: { $gte: oneHourAgo },
          status: { $in: ['started', 'completed'] }
        }),
        col.countDocuments(),
        col.find({ timestamp: { $gte: oneDayAgo } })
          .sort({ timestamp: -1 })
          .limit(10)
          .toArray()
      ]);

      return {
        daily: {
          count: dailyCount,
          limit: this.GLOBAL_DAILY_CAP,
          remaining: Math.max(0, this.GLOBAL_DAILY_CAP - dailyCount),
          percentage: Math.round((dailyCount / this.GLOBAL_DAILY_CAP) * 100)
        },
        hourly: {
          count: hourlyCount
        },
        total: {
          allTime: totalCount
        },
        recentGenerations: recentGenerations.map(g => ({
          operation: g.operation,
          status: g.status,
          timestamp: g.timestamp,
          model: g.metadata?.model
        }))
      };
    } catch (err) {
      this.logger?.error?.(`[VeoService] Error getting usage stats: ${err.message}`);
      return null;
    }
  }

  /**
   * Generate videos from image(s) using Google Gemini Veo model.
   * @param {object} params
   * @param {string} params.prompt - Optional text prompt for video generation.
   * @param {{data: string, mimeType: string}[]} params.images - Array of base64-encoded images.
   * @param {object} [params.config] - Video generation configuration (aspectRatio, numberOfVideos, personGeneration, resolution, durationSeconds).
   * @param {string} [params.model] - Veo model to use (default "veo-3.1-generate-preview").
   * @returns {Promise<string[]>} - Array of video URIs.
   */
  async generateVideosFromImages({ prompt, images, config = { numberOfVideos: 1, personGeneration: "allow_adult" }, model = 'veo-3.1-generate-preview' }) {
    if (!this.ai) throw new Error('Veo AI client not initialized');
    if (!images || images.length === 0) throw new Error('At least one image is required');

    // Enforce rate limits (global + configured) - NOW ASYNC
    if (!(await this.checkRateLimit())) {
      this.logger?.warn?.('[VeoService] Global or configured rate limit reached. Skipping video generation.');
      await this._recordGeneration('generate_from_images', 'rate_limited', { prompt: prompt?.substring(0, 100), model });
      return [];
    }

    // Record generation attempt
    await this._recordGeneration('generate_from_images', 'started', { prompt: prompt?.substring(0, 100), model });

    // Prepare the image payload for image-to-video
    const first = images[0];
    const imageParam = {
      imageBytes: first.data,
      mimeType: first.mimeType
    };

    // Start video generation operation
    let operation = await this.ai.models.generateVideos({
      model,
      prompt,
      image: imageParam,
      config: {
        ...config,
        personGeneration: "allow_adult" // Required for image-to-video
      }
    });

    // Poll until complete
    operation = await this._pollOperation(operation);

    // Download and upload to S3
    const s3Urls = await this._downloadAndUploadVideos(operation);
    
    // Record successful completion
    await this._recordGeneration('generate_from_images', 'completed', { 
      prompt: prompt?.substring(0, 100), 
      model,
      videoCount: s3Urls.length 
    });

    return s3Urls;
  }

  /**
   * Generate videos using Veo 3.1 with either text-only prompt or image + prompt.
   * If images are provided, the first image is used as the seed/frame reference; otherwise text-to-video is used.
   * @param {object} params
   * @param {string} params.prompt - Required text prompt when no image is provided.
   * @param {{data: string, mimeType: string}[]} [params.images] - Optional array of base64-encoded images.
   * @param {object} [params.config] - Video generation configuration (aspectRatio, numberOfVideos, negativePrompt, personGeneration, resolution, durationSeconds).
   * @param {string} [params.model] - Veo model to use (default "veo-3.1-generate-preview").
   * @returns {Promise<string[]>} - Array of S3 URLs to generated videos.
   */
  async generateVideos({ prompt, images, config = { numberOfVideos: 1 }, model = 'veo-3.1-generate-preview' }) {
    if (!this.ai) throw new Error('Veo AI client not initialized');
    const hasImages = Array.isArray(images) && images.length > 0;
    if (!hasImages && !prompt) throw new Error('Prompt is required when no image is provided');

    // Enforce rate limits - NOW ASYNC
    if (!(await this.checkRateLimit())) {
      this.logger?.warn?.('[VeoService] Global or configured rate limit reached. Skipping video generation.');
      await this._recordGeneration('generate', 'rate_limited', { prompt: prompt?.substring(0, 100), model });
      return [];
    }

    // Record generation attempt
    await this._recordGeneration('generate', 'started', { 
      prompt: prompt?.substring(0, 100), 
      model,
      hasImages 
    });

    // Prepare optional image payload
    let imageParam;
    if (hasImages) {
      const first = images[0];
      imageParam = {
        imageBytes: first.data,
        mimeType: first.mimeType
      };
    }

    // Determine correct personGeneration based on input type
    const personGeneration = hasImages ? "allow_adult" : "allow_all";

    // Ensure durationSeconds is a number if present
    const videoConfig = {
      ...config,
      personGeneration
    };
    if (videoConfig.durationSeconds) {
      videoConfig.durationSeconds = Number(videoConfig.durationSeconds);
    }

    // Start operation (text-to-video when no image)
    let operation = await this.ai.models.generateVideos({
      model,
      prompt,
      ...(imageParam ? { image: imageParam } : {}),
      config: videoConfig
    });

    // Poll until complete
    operation = await this._pollOperation(operation);

    // Download and upload to S3
    const s3Urls = await this._downloadAndUploadVideos(operation);
    
    // Record successful completion
    await this._recordGeneration('generate', 'completed', { 
      prompt: prompt?.substring(0, 100), 
      model,
      videoCount: s3Urls.length 
    });

    return s3Urls;
  }

  /**
   * Generate videos using Veo 3.1 with reference images to guide the content.
   * Supports up to 3 reference images (person, character, or product) to preserve appearance.
   * Note: personGeneration and resolution parameters are NOT supported with reference images.
   * @param {object} params
   * @param {string} params.prompt - Text prompt describing the video to generate.
   * @param {{data: string, mimeType: string, referenceType: string}[]} params.referenceImages - Array of 1-3 reference images with type ('asset' or 'style').
   * @param {object} [params.config] - Video generation configuration (aspectRatio must be '16:9', durationSeconds must be 8).
   * @param {string} [params.model] - Veo model to use (default "veo-3.1-generate-preview").
   * @returns {Promise<string[]>} - Array of S3 URLs to generated videos.
   */
  async generateVideosWithReferenceImages({ prompt, referenceImages, config = { aspectRatio: '16:9', durationSeconds: "8" }, model = 'veo-3.1-generate-preview' }) {
    if (!this.ai) throw new Error('Veo AI client not initialized');
    if (!prompt) throw new Error('Prompt is required');
    if (!Array.isArray(referenceImages) || referenceImages.length === 0 || referenceImages.length > 3) {
      throw new Error('Must provide 1-3 reference images');
    }

    // Enforce rate limits - NOW ASYNC
    if (!(await this.checkRateLimit())) {
      this.logger?.warn?.('[VeoService] Global or configured rate limit reached. Skipping video generation.');
      await this._recordGeneration('generate_with_references', 'rate_limited', { prompt: prompt?.substring(0, 100), model });
      return [];
    }

    // Record generation attempt
    await this._recordGeneration('generate_with_references', 'started', { 
      prompt: prompt?.substring(0, 100), 
      model,
      referenceCount: referenceImages.length 
    });

    // Prepare reference images payload
    const refImages = referenceImages.map(ref => ({
      image: {
        imageBytes: ref.data,
        mimeType: ref.mimeType || 'image/png'
      },
      referenceType: ref.referenceType || 'asset'
    }));

    // Start operation with reference images
    let operation = await this.ai.models.generateVideos({
      model,
      prompt,
      config: {
        ...config,
        referenceImages: refImages,
        durationSeconds: Number(config.durationSeconds || 8), // Required when using reference images
        personGeneration: "allow_adult" // Required for reference images
      }
    });

    // Poll until complete
    operation = await this._pollOperation(operation);

    // Download and upload to S3
    const s3Urls = await this._downloadAndUploadVideos(operation);
    
    // Record successful completion
    await this._recordGeneration('generate_with_references', 'completed', { 
      prompt: prompt?.substring(0, 100), 
      model,
      videoCount: s3Urls.length 
    });

    return s3Urls;
  }

  /**
   * Extend a Veo-generated video by 7 seconds (up to 20 times).
   * @param {object} params
   * @param {string} params.videoUrl - URL or S3 path to the Veo-generated video to extend.
   * @param {string} params.prompt - Text prompt describing how to extend the video.
   * @param {object} [params.config] - Video generation configuration.
   * @param {string} [params.model] - Veo model to use (default "veo-3.1-generate-preview").
   * @returns {Promise<string[]>} - Array of S3 URLs to extended videos (combines input + extension).
   */
  async extendVideo({ videoUrl, prompt, config = { personGeneration: "allow_adult" }, model = 'veo-3.1-generate-preview' }) {
    if (!this.ai) throw new Error('Veo AI client not initialized');
    if (!videoUrl) throw new Error('Video URL is required');
    if (!prompt) throw new Error('Prompt is required');

    // Enforce rate limits - NOW ASYNC
    if (!(await this.checkRateLimit())) {
      this.logger?.warn?.('[VeoService] Global or configured rate limit reached. Skipping video generation.');
      await this._recordGeneration('extend_video', 'rate_limited', { prompt: prompt?.substring(0, 100), model });
      return [];
    }

    // Record generation attempt
    await this._recordGeneration('extend_video', 'started', { 
      prompt: prompt?.substring(0, 100), 
      model,
      videoUrl: videoUrl?.substring(0, 100) 
    });

    // Download the video
    let videoBuffer;
    try {
      videoBuffer = await this.s3Service.downloadImage(videoUrl);
    } catch (e) {
      this.logger?.warn?.(`[VeoService] Failed to download video: ${e.message}`);
      await this._recordGeneration('extend_video', 'failed', { error: e.message });
      throw new Error(`Failed to download video from ${videoUrl}`);
    }

    // Prepare video payload
    const videoParam = {
      videoBytes: videoBuffer.toString('base64'),
      mimeType: 'video/mp4'
    };

    // Start extension operation
    let operation = await this.ai.models.generateVideos({
      model,
      prompt,
      video: videoParam,
      config: {
        ...config,
        durationSeconds: Number(config.durationSeconds || 8), // Required for extension
        resolution: "720p", // Required for extension
        personGeneration: "allow_all" // Required for extension
      }
    });

    // Poll until complete
    operation = await this._pollOperation(operation);

    // Download and upload to S3
    const s3Urls = await this._downloadAndUploadVideos(operation);
    
    // Record successful completion
    await this._recordGeneration('extend_video', 'completed', { 
      prompt: prompt?.substring(0, 100), 
      model,
      videoCount: s3Urls.length 
    });

    return s3Urls;
  }

  /**
   * Generate videos using first and last frame interpolation (Veo 3.1).
   * @param {object} params
   * @param {string} params.prompt - Text prompt describing the transition between frames.
   * @param {{data: string, mimeType: string}} params.firstFrame - First frame image.
   * @param {{data: string, mimeType: string}} params.lastFrame - Last frame image.
   * @param {object} [params.config] - Video generation configuration.
   * @param {string} [params.model] - Veo model to use (default "veo-3.1-generate-preview").
   * @returns {Promise<string[]>} - Array of S3 URLs to generated videos.
   */
  async generateVideosWithInterpolation({ prompt, firstFrame, lastFrame, config = { personGeneration: "allow_adult", durationSeconds: "8" }, model = 'veo-3.1-generate-preview' }) {
    if (!this.ai) throw new Error('Veo AI client not initialized');
    if (!prompt) throw new Error('Prompt is required');
    if (!firstFrame || !lastFrame) throw new Error('Both firstFrame and lastFrame are required');

    // Enforce rate limits - NOW ASYNC
    if (!(await this.checkRateLimit())) {
      this.logger?.warn?.('[VeoService] Global or configured rate limit reached. Skipping video generation.');
      await this._recordGeneration('interpolate', 'rate_limited', { prompt: prompt?.substring(0, 100), model });
      return [];
    }

    // Record generation attempt
    await this._recordGeneration('interpolate', 'started', { 
      prompt: prompt?.substring(0, 100), 
      model 
    });

    // Prepare image payloads
    const firstFrameParam = {
      imageBytes: firstFrame.data,
      mimeType: firstFrame.mimeType || 'image/png'
    };
    const lastFrameParam = {
      imageBytes: lastFrame.data,
      mimeType: lastFrame.mimeType || 'image/png'
    };

    // Start interpolation operation
    let operation = await this.ai.models.generateVideos({
      model,
      prompt,
      image: firstFrameParam,
      config: {
        ...config,
        lastFrame: lastFrameParam,
        durationSeconds: Number(config.durationSeconds || 8), // Required for interpolation
        personGeneration: "allow_adult" // Required for interpolation
      }
    });

    // Poll until complete
    operation = await this._pollOperation(operation);

    // Download and upload to S3
    const s3Urls = await this._downloadAndUploadVideos(operation);
    
    // Record successful completion
    await this._recordGeneration('interpolate', 'completed', { 
      prompt: prompt?.substring(0, 100), 
      model,
      videoCount: s3Urls.length 
    });

    return s3Urls;
  }

  /**
   * Helper method to poll an operation until completion.
   * @private
   */
  async _pollOperation(operation) {
    const startedAt = Date.now();
    const deadline = startedAt + this.MAX_POLL_MINUTES * 60 * 1000;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    
    const getOp = async () => {
      const opName = operation?.name || operation?.operation?.name || null;
      try {
        if (opName && this.ai?.operations?.getVideosOperation) {
          try {
            // Ensure we have a proper GenerateVideosOperation instance with _fromAPIResponse method
            let opInstance = operation;
            if (!opInstance || typeof opInstance._fromAPIResponse !== 'function') {
              opInstance = new GenerateVideosOperation();
              if (operation) Object.assign(opInstance, operation);
              if (!opInstance.name) opInstance.name = opName;
            }
            return await this.ai.operations.getVideosOperation({ operation: opInstance });
          } catch (inner) {
            this.logger?.info?.(`[VeoService] getVideosOperation error: ${inner?.message || inner}`);
            // Fallback to internal method if available and public method fails
            if (this.ai.operations.getVideosOperationInternal) {
               try {
                 const rawOp = await this.ai.operations.getVideosOperationInternal({ operationName: opName });
                 // Return raw JSON which has .done property
                 return rawOp;
               } catch (e2) {
                 this.logger?.warn?.(`[VeoService] getVideosOperationInternal error: ${e2?.message}`);
               }
            }
          }
        }
      } catch (e) {
        this.logger?.warn?.(`[VeoService] getVideosOperation error (name=${opName || 'n/a'}): ${e?.message || e}`);
      }
      try {
        if (opName && this.ai?.operations?.getOperation) {
          return await this.ai.operations.getOperation({ name: opName });
        }
      } catch (e) {
        this.logger?.warn?.(`[VeoService] getOperation error (name=${opName || 'n/a'}): ${e?.message || e}`);
      }
      return operation;
    };

    while (!operation?.done) {
      if (Date.now() > deadline) {
        throw new Error('VEO_TIMEOUT: video generation did not complete within allotted time');
      }
      await sleep(this.POLL_INTERVAL_MS);
      operation = await getOp();
      const pct = operation?.metadata?.progressPercent || operation?.metadata?.progress || null;
      if (pct != null) this.logger?.info?.(`[VeoService] video generation progress: ${pct}%`);
    }

    return operation;
  }

  /**
   * Helper method to download videos from URIs and upload to S3.
   * @private
   */
  async _downloadAndUploadVideos(operation) {
    // Extract URIs from various response shapes
    const vids = operation?.response?.generatedVideos
      || operation?.response?.videos
      || operation?.response?.generated_videos
      || [];
    const uris = (Array.isArray(vids) ? vids : [vids]).map(gen => {
      const uri = gen?.video?.uri || gen?.uri || null;
      return uri ? `${uri}${uri.includes('?') ? '&' : '?'}key=${this.apiKey}` : null;
    }).filter(Boolean);

    // Download and upload to S3
    const s3Urls = [];
    const browserHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Connection': 'keep-alive',
    };
    
    for (let i = 0; i < uris.length; i++) {
      const uri = uris[i];
      try {
        this.logger.info(`Downloading video from ${uri}`);
        const buffer = await this.s3Service.downloadImage(uri, browserHeaders);
        const ext = path.extname(new URL(uri).pathname) || '.mp4';
        const tempFile = path.join(os.tmpdir(), `veo_video_${Date.now()}_${i}${ext}`);
        fs.writeFileSync(tempFile, buffer);
        this.logger.info(`Uploading video to S3: ${tempFile}`);
        // Skip event emission - let the caller emit with full context
        const s3Url = await this.s3Service.uploadImage(tempFile, { skipEventEmit: true });
        s3Urls.push(s3Url);
      } catch (error) {
        this.logger.error(`Error processing video ${uri}: ${error.message}`);
      }
    }

    return s3Urls;
  }
}
