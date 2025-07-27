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
  }

  recentRequests = [];

  checkRateLimit() {
    const now = Date.now();
    const perMinuteLimit = this.configService.config.ai.veo.rateLimit.perMinute;
    const perDayLimit = this.configService.config.ai.veo.rateLimit.perDay;

    // Filter recent requests within the last minute
    const recentRequests = this.recentRequests.filter(req => now - req.timestamp < 60 * 1000);
    if (recentRequests.length >= perMinuteLimit) {
      return false; // Rate limit exceeded
    }

    // Filter recent requests within the last day
    const dailyRequests = this.recentRequests.filter(req => now - req.timestamp < 24 * 60 * 60 * 1000);
    if (dailyRequests.length >= perDayLimit) {
      return false; // Daily limit exceeded
    }
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

    this.recentRequests.push({
      operation: 'generate',
      timestamp: Date.now()
    });

    

    // Poll until complete
    while (!operation.done) {
      await new Promise(r => setTimeout(r, 10000));
      operation = await this.ai.operations.getVideosOperation({ operation });
    }

    // Build URIs with API key
    const uris = (operation.response.generatedVideos || []).map(gen => {
      const uri = gen.video?.uri;
      return uri ? `${uri}&key=${this.apiKey}` : null;
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
