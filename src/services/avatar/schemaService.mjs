/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import fs from 'fs/promises';
import Replicate from 'replicate';
import crypto from 'crypto';
import { SchemaValidator } from '../../utils/schemaValidator.mjs';

export class SchemaService {
  constructor({
    aiService,
    configService,
    s3Service,
    databaseService
  }) {
    this.aiService = aiService;
    this.configService = configService;
    this.s3Service = s3Service;
    this.databaseService = databaseService;

    this.schemaValidator = new SchemaValidator();
    this._replicateClient = null;
    this._replicateToken = null;
    this._imageCollection = null;

    this.rarityRanges = [
      { rarity: 'common', min: 1, max: 12 },
      { rarity: 'uncommon', min: 13, max: 17 },
      { rarity: 'rare', min: 18, max: 19 },
      { rarity: 'legendary', min: 20, max: 20 }
    ];
  }

  /**
   * Get the generated_images collection with lazy initialization
   * @returns {Promise<Collection>}
   * @private
   */
  async _getImageCollection() {
    if (!this._imageCollection) {
      const db = await this.databaseService.getDatabase();
      this._imageCollection = db.collection('generated_images');
      // Ensure indexes exist
      try {
        await this._imageCollection.createIndex({ promptHash: 1 });
        await this._imageCollection.createIndex({ purpose: 1 });
        await this._imageCollection.createIndex({ category: 1 });
        await this._imageCollection.createIndex({ createdAt: -1 });
        await this._imageCollection.createIndex({ 'metadata.theme': 1, 'metadata.roomType': 1 });
      } catch {
        // Indexes may already exist
      }
    }
    return this._imageCollection;
  }

  /**
   * Generate a hash of a prompt for lookup
   * @param {string} prompt - The prompt text
   * @returns {string} - SHA256 hash
   * @private
   */
  _hashPrompt(prompt) {
    const normalized = (prompt || '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '');
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }

  /**
   * Save a generated image to the database for future reuse
   * @param {string} imageUrl - The S3 URL
   * @param {string} prompt - The generation prompt
   * @param {Object} [options] - Additional metadata
   * @returns {Promise<Object>} - The saved document
   */
  async saveGeneratedImage(imageUrl, prompt, options = {}) {
    const col = await this._getImageCollection();
    const doc = {
      imageUrl,
      prompt,
      promptHash: this._hashPrompt(prompt),
      aspectRatio: options.aspectRatio || '1:1',
      purpose: options.purpose || 'general',
      category: options.category || 'general',
      tags: options.tags || [],
      metadata: options.metadata || {},
      source: 'schemaService',
      usageCount: 0,
      createdAt: new Date(),
      lastUsedAt: null
    };
    const result = await col.insertOne(doc);
    return { ...doc, _id: result.insertedId };
  }

  /**
   * Find an existing image by exact prompt match
   * @param {string} prompt - The prompt to search for
   * @returns {Promise<Object|null>} - Matching image or null
   */
  async findCachedImage(prompt) {
    const col = await this._getImageCollection();
    const promptHash = this._hashPrompt(prompt);
    const image = await col.findOne({ promptHash });
    if (image) {
      // Update usage stats
      await col.updateOne(
        { _id: image._id },
        { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } }
      );
    }
    return image;
  }

  async generateImage(prompt, aspectRatio = '1:1', uploadOptions = {}) {
    try {
      // Check if caching is enabled and look for cached image
      const useCache = uploadOptions.useCache !== false;
      const cacheChance = uploadOptions.cacheChance ?? 0.0; // 0% chance to reuse by default (variety first)
      
      if (useCache && cacheChance > 0 && Math.random() < cacheChance) {
        const cached = await this.findCachedImage(prompt);
        if (cached?.imageUrl) {
          console.log(`[SchemaService] Reusing cached image for prompt: ${prompt.slice(0, 50)}...`);
          return cached.imageUrl;
        }
      }

      const replicateConfig = this.configService.getAIConfig('replicate') || {};
      const apiToken = replicateConfig.apiToken || process.env.REPLICATE_API_TOKEN;
      if (!apiToken) {
        throw new Error('Replicate API token is not configured. Set it in admin settings.');
      }

      if (!this._replicateClient || this._replicateToken !== apiToken) {
        this._replicateClient = new Replicate({ auth: apiToken });
        this._replicateToken = apiToken;
      }

      const loraTrigger = replicateConfig.loraTriggerWord || replicateConfig.loraTrigger || '';
      const loraWeights = replicateConfig.lora_weights || replicateConfig.loraWeights || null;
      const modelVersion = replicateConfig.model || replicateConfig.baseModel || 'black-forest-labs/flux-dev-lora';

      const decoratedPrompt = `${loraTrigger} ${prompt} ${loraTrigger}`.trim();

      const replicateInput = {
        prompt: decoratedPrompt,
        go_fast: false,
        guidance: 3,
        lora_scale: 1,
        megapixels: '1',
        num_outputs: 1,
        aspect_ratio: aspectRatio,
        output_format: 'png',
        output_quality: 80,
        prompt_strength: 0.8,
        num_inference_steps: 28
      };

      if (loraWeights) {
        replicateInput.lora_weights = loraWeights;
      }

      const output = await this._replicateClient.run(
        modelVersion,
        {
          input: replicateInput
        }
      );

      const firstResult = Array.isArray(output) ? output[0] : output?.output?.[0] || output;
      let imageUrl = null;
      if (typeof firstResult === 'string') {
        imageUrl = firstResult;
      } else if (firstResult && typeof firstResult.url === 'string') {
        imageUrl = firstResult.url;
      } else if (firstResult && typeof firstResult.toString === 'function') {
        imageUrl = firstResult.toString();
      }

      if (!imageUrl) {
        throw new Error('Replicate did not return an image URL');
      }

      const imageBuffer = await this.s3Service.downloadImage(`${imageUrl}`);
      const localFilename = `./images/generated_${Date.now()}.png`;
      await fs.mkdir('./images', { recursive: true });
      await fs.writeFile(localFilename, imageBuffer);
      const s3url = await this.s3Service.uploadImage(localFilename, uploadOptions);
      
      // Save to database for future reference and potential reuse
      try {
        await this.saveGeneratedImage(s3url, prompt, {
          aspectRatio,
          purpose: uploadOptions.purpose || 'general',
          category: uploadOptions.category || 'general',
          tags: uploadOptions.tags || [],
          metadata: uploadOptions.metadata || {}
        });
        console.log(`[SchemaService] Saved generated image to database: ${s3url.slice(-30)}`);
      } catch (saveError) {
        // Don't fail the generation if saving fails
        console.error('[SchemaService] Failed to save image to database:', saveError.message);
      }
      
      return s3url;
    } catch (error) {
      console.error('Error generating image:', error);
      throw error;
    }
  }


  determineRarity() {
    const roll = Math.floor(Math.random() * 20) + 1;
    return this.rarityRanges.find(range => roll >= range.min && roll <= range.max)?.rarity || 'common';
  }

  /**
   * Executes a structured prompting pipeline using Gemini-compatible structured output.
   * @param {Object} config - Configuration for the pipeline.
   * @param {string} config.prompt - The base prompt to use.
   * @param {Object} config.schema - The schema to validate the output against.
   * @param {Object} [config.options] - Additional options (e.g., temperature).
   * @returns {Promise<Object>} - The validated output.
   */
  async executePipeline({ prompt, schema, options = {} }) {
    if (!schema) throw new Error('Schema is required for structured prompting.');

    try {
      const result = await this.aiService.generateStructuredOutput({
        prompt,
        schema,
        options,
      });

      const actualSchema = schema?.schema || schema;
      this.validateAgainstSchema(result, actualSchema);

      return result;
    } catch (error) {
      const msg = error.message || '';
      const truncated = msg.length > 500 ? msg.slice(0, 500) + '... [truncated]' : msg;
      console.error('Error in structured prompting pipeline:', truncated);
      throw new Error(truncated);
    }
  }

  /**
   * Validates an object against a schema.
   * @param {Object} data - The object to validate.
   * @param {Object} schema - The schema to validate against.
   * @throws {Error} - If validation fails.
   */
  validateAgainstSchema(data, schema) {
    const validation = this.schemaValidator.validate(data, schema);
    if (!validation.valid) {
      throw new Error(`Validation failed: ${JSON.stringify(validation.errors)}`);
    }
  }
}
