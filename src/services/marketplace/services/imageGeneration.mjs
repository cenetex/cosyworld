/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file src/services/marketplace/services/imageGeneration.mjs
 * @description Image generation service for marketplace
 */

/**
 * Image Generation Service
 * Generates images using AI models
 */
export class ImageGenerationService {
  constructor(container) {
    this.logger = container.logger || console;
    this.replicateService = container.replicateService;
    this.openrouterAIService = container.openrouterAIService;
    this.s3Service = container.s3Service;
    this.databaseService = container.databaseService;
  }

  getMetadata() {
    return {
      serviceId: 'image-generation',
      providerId: 'system',
      name: 'Image Generation',
      description: 'Generate AI images from text prompts using FLUX, Stable Diffusion, and other models',
      category: 'ai',
      pricing: {
        model: 'per_request',
        amount: 1 * 1e6, // 1 USDC per image
        currency: 'USDC',
        decimals: 6,
      },
      endpoint: '/api/marketplace/services/image-generation/execute',
      network: 'base-sepolia',
      metadata: {
        estimatedTime: '10-30 seconds',
        supportedFormats: ['png', 'jpg'],
        resolution: '1024x1024',
        models: ['FLUX', 'Stable Diffusion', 'DALL-E'],
      },
    };
  }

  async execute(params, agentId) {
    const { prompt, model = 'flux', width = 1024, height = 1024, style } = params;

    if (!prompt) {
      throw new Error('Prompt is required');
    }

    this.logger.info(`[ImageGeneration] Agent ${agentId} generating image: "${prompt}"`);

    try {
      let imageUrl;

      if (this.replicateService) {
        const result = await this.replicateService.generateImage({
          prompt,
          model,
          width,
          height,
        });
        imageUrl = result.output?.[0] || result.url;
      } else {
        throw new Error('Image generation service not available');
      }

      // Save to database
      const db = await this.databaseService.getDatabase();
      await db.collection('generated_images').insertOne({
        agentId,
        prompt,
        model,
        imageUrl,
        width,
        height,
        style,
        createdAt: new Date(),
        paidAmount: this.getMetadata().pricing.amount,
      });

      return {
        success: true,
        imageUrl,
        prompt,
        model,
        dimensions: { width, height },
      };
    } catch (error) {
      this.logger.error('[ImageGeneration] Failed:', error);
      throw new Error(`Image generation failed: ${error.message}`);
    }
  }
}
