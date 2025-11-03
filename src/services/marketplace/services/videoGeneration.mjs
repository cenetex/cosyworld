/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file src/services/marketplace/services/videoGeneration.mjs
 * @description Video generation service for marketplace
 */

/**
 * Video Generation Service
 * Generates videos using AI models (Replicate, VEO, etc.)
 */
export class VideoGenerationService {
  constructor(container) {
    this.logger = container.logger || console;
    this.veoService = container.veoService;
    this.replicateService = container.replicateService;
    this.s3Service = container.s3Service;
    this.databaseService = container.databaseService;
  }

  /**
   * Get service metadata for marketplace registration
   */
  getMetadata() {
    return {
      serviceId: 'video-generation',
      providerId: 'system',
      name: 'Video Generation',
      description: 'Generate AI videos from text prompts using state-of-the-art models',
      category: 'ai',
      pricing: {
        model: 'per_request',
        amount: 5 * 1e6, // 5 USDC per video
        currency: 'USDC',
        decimals: 6,
      },
      endpoint: '/api/marketplace/services/video-generation/execute',
      network: 'base-sepolia',
      metadata: {
        estimatedTime: '120-300 seconds',
        supportedFormats: ['mp4'],
        maxDuration: '10 seconds',
        models: ['VEO', 'Replicate'],
      },
    };
  }

  /**
   * Execute video generation
   * @param {Object} params - Generation parameters
   * @param {string} params.prompt - Text prompt for video
   * @param {string} params.model - Model to use (veo, replicate)
   * @param {number} params.duration - Video duration in seconds
   * @param {string} agentId - Agent requesting the service
   */
  async execute(params, agentId) {
    const { prompt, model = 'veo', duration = 5 } = params;

    if (!prompt) {
      throw new Error('Prompt is required');
    }

    this.logger.info(`[VideoGeneration] Agent ${agentId} generating video: "${prompt}"`);

    try {
      let result;
      
      if (model === 'veo' && this.veoService) {
        result = await this.veoService.generateVideo({
          prompt,
          duration,
          agentId,
        });
      } else if (model === 'replicate' && this.replicateService) {
        result = await this.replicateService.generateVideo({
          prompt,
          duration,
        });
      } else {
        throw new Error(`Model ${model} not available`);
      }

      // Save to database
      const db = await this.databaseService.getDatabase();
      await db.collection('video_jobs').insertOne({
        agentId,
        prompt,
        model,
        duration,
        url: result.url,
        status: 'completed',
        createdAt: new Date(),
        paidAmount: this.getMetadata().pricing.amount,
      });

      return {
        success: true,
        videoUrl: result.url,
        duration: result.duration,
        model,
        estimatedCost: this.getMetadata().pricing.amount,
      };
    } catch (error) {
      this.logger.error('[VideoGeneration] Failed:', error);
      throw new Error(`Video generation failed: ${error.message}`);
    }
  }
}
