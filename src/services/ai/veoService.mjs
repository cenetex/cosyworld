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
   * @param {object} [params.config] - Video generation configuration (aspectRatio, numberOfVideos, etc).
   * @param {string} [params.model] - Veo model to use (default "veo-2.0-generate-001").
   * @returns {Promise<string[]>} - Array of video URIs.
   */
  async generateVideosFromImages({ prompt, images, config = { numberOfVideos: 1, personGeneration: "allow_adult"  }, model = 'veo-2.0-generate-001' }) {
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

    // Poll until complete with robust fallbacks and timeout
    const startedAt = Date.now();
    const deadline = startedAt + this.MAX_POLL_MINUTES * 60 * 1000;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const getOp = async () => {
  const opName = operation?.name || operation?.operation?.name || null;
      // Prefer named operation lookups; avoid passing raw objects to SDK methods.
      try {
        if (opName && this.ai?.operations?.getVideosOperation) {
          // Some SDK versions expect { operation: { name } } instead of { name }
          try {
            return await this.ai.operations.getVideosOperation({ operation: { name: opName } });
          } catch (inner) {
            // Fallback to alternate signature; include inner error in verbose log
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
      // If we have no name, return the last known operation object and hope it updates in-place.
      return operation;
    };

    // If operation already done, skip loop
    while (!operation?.done) {
      if (Date.now() > deadline) {
        throw new Error('VEO_TIMEOUT: video generation did not complete within allotted time');
      }
      await sleep(this.POLL_INTERVAL_MS);
      operation = await getOp();
      const pct = operation?.metadata?.progressPercent || operation?.metadata?.progress || null;
      if (pct != null) this.logger?.info?.(`[VeoService] video generation progress: ${pct}%`);
    }

    // Extract URIs from various response shapes
    const vids = operation?.response?.generatedVideos
      || operation?.response?.videos
      || operation?.response?.generated_videos
      || [];
    const uris = (Array.isArray(vids) ? vids : [vids]).map(gen => {
      const uri = gen?.video?.uri || gen?.uri || null;
      return uri ? `${uri}${uri.includes('?') ? '&' : '?'}key=${this.apiKey}` : null;
    }).filter(Boolean);

    // Download each video, upload to S3, and collect the S3 URLs
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
