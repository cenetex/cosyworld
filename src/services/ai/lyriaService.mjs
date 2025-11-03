/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * LyriaService
 * Interface for Google's Lyria music generation API
 * Generates 30-second instrumental music tracks from text prompts
 */
import axios from 'axios';

export class LyriaService {
  constructor({ configService, logger, s3Service, databaseService }) {
    this.configService = configService;
    this.logger = logger || console;
    this.s3Service = s3Service;
    this.databaseService = databaseService;
    
    // Get Google Cloud credentials
    const googleConfig = this.configService?.config?.ai?.google || {};
    this.projectId = googleConfig.projectId || process.env.GOOGLE_CLOUD_PROJECT_ID;
    this.location = googleConfig.location || process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
    
    // Rate limiting
    this.DAILY_CAP = Number(process.env.LYRIA_DAILY_CAP || 10);
    this.PER_HOUR_LIMIT = Number(process.env.LYRIA_PER_HOUR_LIMIT || 5);
  }

  /**
   * Get database collection for music generation tracking
   * @private
   */
  async _getMusicGenerationCol() {
    const db = await this.databaseService.getDatabase();
    return db.collection('lyria_music_generations');
  }

  /**
   * Check rate limits for music generation
   * @returns {Promise<boolean>} True if generation is allowed
   */
  async checkRateLimit() {
    try {
      const now = Date.now();
      const col = await this._getMusicGenerationCol();
      
      // Check hourly limit
      const oneHourAgo = new Date(now - 60 * 60 * 1000);
      const hourlyCount = await col.countDocuments({
        timestamp: { $gte: oneHourAgo },
        status: { $in: ['started', 'completed'] }
      });
      
      if (hourlyCount >= this.PER_HOUR_LIMIT) {
        this.logger?.warn?.(`[LyriaService] Hourly rate limit exceeded (${hourlyCount}/${this.PER_HOUR_LIMIT})`);
        return false;
      }

      // Check daily limit
      const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
      const dailyCount = await col.countDocuments({
        timestamp: { $gte: oneDayAgo },
        status: { $in: ['started', 'completed'] }
      });
      
      if (dailyCount >= this.DAILY_CAP) {
        this.logger?.warn?.(`[LyriaService] Daily cap exceeded (${dailyCount}/${this.DAILY_CAP})`);
        return false;
      }

      this.logger?.info?.(`[LyriaService] Rate check passed: ${dailyCount}/${this.DAILY_CAP} today, ${hourlyCount}/${this.PER_HOUR_LIMIT} this hour`);
      return true;
    } catch (err) {
      this.logger?.error?.(`[LyriaService] Rate limit check error: ${err.message}`);
      return false;
    }
  }

  /**
   * Record a music generation attempt
   * @private
   */
  async _recordGeneration(status, metadata = {}) {
    try {
      const col = await this._getMusicGenerationCol();
      const doc = {
        status,
        timestamp: new Date(),
        metadata: {
          ...metadata,
          model: 'lyria-002'
        }
      };
      await col.insertOne(doc);
      
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const dailyCount = await col.countDocuments({
        timestamp: { $gte: oneDayAgo },
        status: { $in: ['started', 'completed'] }
      });
      
      this.logger?.info?.(`[LyriaService] Recorded (${status}): ${dailyCount}/${this.DAILY_CAP} tracks today`);
    } catch (err) {
      this.logger?.error?.(`[LyriaService] Record error: ${err.message}`);
    }
  }

  /**
   * Get access token for Google Cloud API
   * @private
   */
  async _getAccessToken() {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      const { stdout } = await execAsync('gcloud auth print-access-token');
      return stdout.trim();
    } catch (err) {
      this.logger?.error?.(`[LyriaService] Failed to get access token: ${err.message}`);
      throw new Error('Failed to authenticate with Google Cloud');
    }
  }

  /**
   * Generate instrumental music from a text prompt
   * @param {Object} options
   * @param {string} options.prompt - Description of the music to generate (US English)
   * @param {string} [options.negativePrompt] - What to exclude from the music
   * @param {number} [options.seed] - Seed for deterministic generation
   * @param {number} [options.sampleCount=1] - Number of samples (cannot use with seed)
   * @returns {Promise<Array<{audioContent: string, mimeType: string, url?: string}>>} Generated audio samples
   */
  async generateMusic({ prompt, negativePrompt = null, seed = null, sampleCount = 1 }) {
    try {
      // Check rate limits
      if (!(await this.checkRateLimit())) {
        throw new Error('Rate limit exceeded for music generation');
      }

      await this._recordGeneration('started', { prompt });

      // Get access token
      const accessToken = await this._getAccessToken();
      
      // Build request
      const endpoint = `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}/publishers/google/models/lyria-002:predict`;
      
      const requestBody = {
        instances: [
          {
            prompt: String(prompt),
            ...(negativePrompt && { negative_prompt: String(negativePrompt) }),
            ...(seed !== null && { seed: Number(seed) })
          }
        ],
        parameters: {
          ...(seed === null && sampleCount > 1 && { sample_count: Number(sampleCount) })
        }
      };

      this.logger?.info?.(`[LyriaService] Generating music: "${prompt}"`);

      // Make API request
      const response = await axios.post(endpoint, requestBody, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 120000 // 2 minute timeout
      });

      const predictions = response.data?.predictions || [];
      
      if (predictions.length === 0) {
        throw new Error('No audio generated');
      }

      // Upload to S3 if service available
      const results = [];
      for (let i = 0; i < predictions.length; i++) {
        const prediction = predictions[i];
        const audioContent = prediction.audioContent;
        const mimeType = prediction.mimeType || 'audio/wav';
        
        let url = null;
        if (this.s3Service && audioContent) {
          try {
            const buffer = Buffer.from(audioContent, 'base64');
            const filename = `lyria-${Date.now()}-${i}.wav`;
            url = await this.s3Service.uploadBuffer(buffer, filename, { contentType: mimeType });
            this.logger?.info?.(`[LyriaService] Uploaded to S3: ${url}`);
          } catch (uploadErr) {
            this.logger?.warn?.(`[LyriaService] S3 upload failed: ${uploadErr.message}`);
          }
        }
        
        results.push({
          audioContent,
          mimeType,
          url
        });
      }

      await this._recordGeneration('completed', { prompt, count: results.length });
      
      this.logger?.info?.(`[LyriaService] Generated ${results.length} music track(s)`);
      return results;

    } catch (err) {
      await this._recordGeneration('failed', { prompt, error: err.message });
      this.logger?.error?.(`[LyriaService] Generation failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Generate battle music based on combat context
   * @param {Object} context
   * @param {string} context.mood - Battle mood (intense, dramatic, epic, etc.)
   * @param {string} [context.genre] - Music genre preference
   * @param {string} [context.tempo] - Tempo (fast, medium, slow)
   * @returns {Promise<{audioContent: string, mimeType: string, url?: string}|null>}
   */
  async generateBattleMusic({ mood = 'intense', genre = 'orchestral', tempo = 'fast' }) {
    const prompts = {
      intense: `An intense ${genre} battle theme with ${tempo} tempo, driving percussion, dramatic brass sections, and urgent string melodies`,
      dramatic: `A dramatic ${genre} combat score with ${tempo} tempo, powerful orchestration, epic brass fanfares, and sweeping strings`,
      epic: `An epic ${genre} battle anthem with ${tempo} tempo, massive orchestral hits, heroic brass, choir-like synths, and thunderous percussion`,
      tense: `A tense ${genre} confrontation theme with ${tempo} tempo, suspenseful strings, ominous brass, and building tension`,
      triumphant: `A triumphant ${genre} victory theme with ${tempo} tempo, celebratory brass, soaring strings, and energetic percussion`
    };

    const prompt = prompts[mood] || prompts.intense;
    const negativePrompt = 'vocals, singing, lyrics, speech';

    try {
      const results = await this.generateMusic({ prompt, negativePrompt, sampleCount: 1 });
      return results[0] || null;
    } catch (err) {
      this.logger?.warn?.(`[LyriaService] Battle music generation failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Get usage statistics
   * @returns {Promise<object>} Usage stats
   */
  async getUsageStats() {
    try {
      const col = await this._getMusicGenerationCol();
      const now = Date.now();
      const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
      const oneHourAgo = new Date(now - 60 * 60 * 1000);

      const [dailyCount, hourlyCount, totalCount] = await Promise.all([
        col.countDocuments({
          timestamp: { $gte: oneDayAgo },
          status: { $in: ['started', 'completed'] }
        }),
        col.countDocuments({
          timestamp: { $gte: oneHourAgo },
          status: { $in: ['started', 'completed'] }
        }),
        col.countDocuments({})
      ]);

      return {
        daily: {
          count: dailyCount,
          limit: this.DAILY_CAP,
          remaining: Math.max(0, this.DAILY_CAP - dailyCount)
        },
        hourly: {
          count: hourlyCount,
          limit: this.PER_HOUR_LIMIT,
          remaining: Math.max(0, this.PER_HOUR_LIMIT - hourlyCount)
        },
        total: totalCount
      };
    } catch (err) {
      this.logger?.error?.(`[LyriaService] Stats error: ${err.message}`);
      return null;
    }
  }
}

export default LyriaService;
