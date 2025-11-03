/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import fs from 'fs/promises';
import Replicate from 'replicate';
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

    this.rarityRanges = [
      { rarity: 'common', min: 1, max: 12 },
      { rarity: 'uncommon', min: 13, max: 17 },
      { rarity: 'rare', min: 18, max: 19 },
      { rarity: 'legendary', min: 20, max: 20 }
    ];
  }

  async generateImage(prompt, aspectRatio = '1:1', uploadOptions = {}) {
    try {
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
