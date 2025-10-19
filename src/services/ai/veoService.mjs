/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { GoogleGenAI } from "@google/genai";
import fs from 'fs';
import path from 'path';
import os from 'os';

export class VeoService {
  constructor({ configService, logger, s3Service }) {
    this.configService = configService;
    this.logger = logger || console;
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

  recentRequests = [];

  checkRateLimit() {
    const now = Date.now();
  const perMinuteLimit = this.configService?.config?.ai?.veo?.rateLimit?.perMinute ?? 1;
  const perDayLimit = this.configService?.config?.ai?.veo?.rateLimit?.perDay ?? 3;

    // Filter recent requests within the last minute
    const recentRequests = this.recentRequests.filter(req => now - req.timestamp < 60 * 1000);
    if (recentRequests.length >= perMinuteLimit) {
      return false; // Rate limit exceeded
    }

    // Filter recent requests within the last day
    const dailyRequests = this.recentRequests.filter(req => now - req.timestamp < 24 * 60 * 60 * 1000);
  if (dailyRequests.length >= perDayLimit) return false; // Config daily limit exceeded
  // Enforce stricter global cap
  if (dailyRequests.length >= this.GLOBAL_DAILY_CAP) return false;
    return true;
  }

  /**
   * Generate videos from image(s) using Google Gemini Veo model.
   * @param {object} params
   * @param {string} params.prompt - Optional text prompt for video generation.
   * @param {{data: string, mimeType: string}[]} params.images - Array of base64-encoded images.
   * @param {object} [params.config] - Video generation configuration (aspectRatio, numberOfVideos, resolution, durationSeconds, etc).
   * @param {string} [params.model] - Veo model to use (default "veo-3.1-generate-preview").
   * @returns {Promise<string[]>} - Array of video URIs.
   */
  async generateVideosFromImages({ prompt, images, config = { numberOfVideos: 1, personGeneration: "allow_adult"  }, model = 'veo-3.1-generate-preview' }) {
    if (!this.ai) throw new Error('Veo AI client not initialized');
    if (!images || images.length === 0) throw new Error('At least one image is required');

    // Enforce rate limits (global + configured)
    if (!this.checkRateLimit()) {
      this.logger?.warn?.('[VeoService] Global or configured rate limit reached. Skipping video generation.');
      return [];
    }

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
      config
    });
    this.recentRequests.push({ operation: 'generate', timestamp: Date.now() });

    // Poll until complete
    operation = await this._pollOperation(operation);

    // Download and upload to S3
    return await this._downloadAndUploadVideos(operation);
  }

  /**
   * Generate videos using Veo 3.1 with either text-only prompt or image + prompt.
   * If images are provided, the first image is used as the seed/frame reference; otherwise text-to-video is used.
   * @param {object} params
   * @param {string} params.prompt - Required text prompt when no image is provided.
   * @param {{data: string, mimeType: string}[]} [params.images] - Optional array of base64-encoded images.
   * @param {object} [params.config] - Video generation configuration (aspectRatio, numberOfVideos, negativePrompt, resolution, durationSeconds, etc).
   * @param {string} [params.model] - Veo model to use (default "veo-3.1-generate-preview").
   * @returns {Promise<string[]>} - Array of S3 URLs to generated videos.
   */
  async generateVideos({ prompt, images, config = { numberOfVideos: 1, personGeneration: "allow_adult" }, model = 'veo-3.1-generate-preview' }) {
    if (!this.ai) throw new Error('Veo AI client not initialized');
    const hasImages = Array.isArray(images) && images.length > 0;
    if (!hasImages && !prompt) throw new Error('Prompt is required when no image is provided');

    // Enforce rate limits
    if (!this.checkRateLimit()) {
      this.logger?.warn?.('[VeoService] Global or configured rate limit reached. Skipping video generation.');
      return [];
    }

    // Prepare optional image payload
    let imageParam;
    if (hasImages) {
      const first = images[0];
      imageParam = {
        imageBytes: first.data,
        mimeType: first.mimeType
      };
    }

    // Start operation (text-to-video when no image)
    let operation = await this.ai.models.generateVideos({
      model,
      prompt,
      ...(imageParam ? { image: imageParam } : {}),
      config
    });
    this.recentRequests.push({ operation: 'generate', timestamp: Date.now() });

    // Poll until complete
    operation = await this._pollOperation(operation);

    // Download and upload to S3
    return await this._downloadAndUploadVideos(operation);
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
  async generateVideosWithReferenceImages({ prompt, referenceImages, config = { aspectRatio: '16:9', durationSeconds: 8 }, model = 'veo-3.1-generate-preview' }) {
    if (!this.ai) throw new Error('Veo AI client not initialized');
    if (!prompt) throw new Error('Prompt is required');
    if (!Array.isArray(referenceImages) || referenceImages.length === 0 || referenceImages.length > 3) {
      throw new Error('Must provide 1-3 reference images');
    }

    // Enforce rate limits
    if (!this.checkRateLimit()) {
      this.logger?.warn?.('[VeoService] Global or configured rate limit reached. Skipping video generation.');
      return [];
    }

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
        durationSeconds: 8 // Required when using reference images
      }
    });
    this.recentRequests.push({ operation: 'generate_with_references', timestamp: Date.now() });

    // Poll until complete
    operation = await this._pollOperation(operation);

    // Download and upload to S3
    return await this._downloadAndUploadVideos(operation);
  }

  /**
   * Extend a Veo-generated video by 7 seconds (up to 20 times).
   * @param {object} params
   * @param {string} params.videoUrl - URL or S3 path to the Veo-generated video to extend.
   * @param {string} params.prompt - Text prompt describing how to extend the video.
   * @param {object} [params.config] - Video generation configuration (must use 720p resolution).
   * @param {string} [params.model] - Veo model to use (default "veo-3.1-generate-preview").
   * @returns {Promise<string[]>} - Array of S3 URLs to extended videos (combines input + extension).
   */
  async extendVideo({ videoUrl, prompt, config = { resolution: '720p', personGeneration: "allow_adult" }, model = 'veo-3.1-generate-preview' }) {
    if (!this.ai) throw new Error('Veo AI client not initialized');
    if (!videoUrl) throw new Error('Video URL is required');
    if (!prompt) throw new Error('Prompt is required');

    // Enforce rate limits
    if (!this.checkRateLimit()) {
      this.logger?.warn?.('[VeoService] Global or configured rate limit reached. Skipping video generation.');
      return [];
    }

    // Download the video
    let videoBuffer;
    try {
      videoBuffer = await this.s3Service.downloadImage(videoUrl);
    } catch (e) {
      this.logger?.warn?.(`[VeoService] Failed to download video: ${e.message}`);
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
        resolution: '720p' // Required for extensions
      }
    });
    this.recentRequests.push({ operation: 'extend_video', timestamp: Date.now() });

    // Poll until complete
    operation = await this._pollOperation(operation);

    // Download and upload to S3
    return await this._downloadAndUploadVideos(operation);
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
  async generateVideosWithInterpolation({ prompt, firstFrame, lastFrame, config = { personGeneration: "allow_adult", durationSeconds: 8 }, model = 'veo-3.1-generate-preview' }) {
    if (!this.ai) throw new Error('Veo AI client not initialized');
    if (!prompt) throw new Error('Prompt is required');
    if (!firstFrame || !lastFrame) throw new Error('Both firstFrame and lastFrame are required');

    // Enforce rate limits
    if (!this.checkRateLimit()) {
      this.logger?.warn?.('[VeoService] Global or configured rate limit reached. Skipping video generation.');
      return [];
    }

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
        durationSeconds: 8 // Required for interpolation
      }
    });
    this.recentRequests.push({ operation: 'interpolate', timestamp: Date.now() });

    // Poll until complete
    operation = await this._pollOperation(operation);

    // Download and upload to S3
    return await this._downloadAndUploadVideos(operation);
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
            return await this.ai.operations.getVideosOperation({ operation: { name: opName } });
          } catch (inner) {
            this.logger?.info?.(`[VeoService] getVideosOperation alt signature after error: ${inner?.message || inner}`);
            return await this.ai.operations.getVideosOperation({ name: opName });
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
        const s3Url = await this.s3Service.uploadImage(tempFile);
        s3Urls.push(s3Url);
      } catch (error) {
        this.logger.error(`Error processing video ${uri}: ${error.message}`);
      }
    }

    return s3Urls;
  }
}
