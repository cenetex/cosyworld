/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import OpenAI from 'openai';
import models from '../../models.openrouter.config.mjs';
import { parseFirstJson } from '../../utils/jsonParse.mjs';

export class OpenRouterAIService {
  constructor({
    logger,
    aiModelService,
    configService,
  }) {
    this.logger = logger;
    this.aiModelService = aiModelService;
    this.configService = configService;

  // Resolve defaults from ConfigService (note: align with keys defined in ConfigService)
  const orCfg = this.configService?.config?.ai?.openrouter || {};
  this.model = orCfg.model || 'openai/gpt-4o-mini';
  this.structured_model = orCfg.structuredModel || 'openai/gpt-4o';
    this.openai = new OpenAI({
      apiKey: this.configService.config.ai.openrouter.apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://ratimics.com', // Optional, for including your app on openrouter.ai rankings.
        'X-Title': 'cosyworld', // Optional. Shows in rankings on openrouter.ai.
      },
    });
    this.modelConfig = models;

    // Register models with this.aiModelService
    this.aiModelService.registerModels('openrouter', models);

    // Default options that will be used if not overridden by the caller.
    this.defaultCompletionOptions = {
  max_tokens: 2000,
      temperature: 0.9,        // More randomness for creative output
      top_p: 0.95,             // Broader token selection for diversity
      frequency_penalty: 0.2,  // Moderate penalty to avoid repetitive loops
      presence_penalty: 0.3,   // Push for new ideas and concepts
    };

    // Note: Chat defaults differ from completions. They can be adjusted as needed.
    this.defaultChatOptions = {
      // Prefer configured chat model; fall back to a lightweight default
      model: orCfg.chatModel || 'meta-llama/llama-3.2-1b-instruct',
  max_tokens: 2000,
      // Creativity knobs
      temperature: 0.9,
      top_p: 0.95,
      frequency_penalty: 0.2,
      presence_penalty: 0.3,
    };

    this.defaultVisionOptions = {
      model: orCfg.visionModel || 'x-ai/grok-2-vision-1212',
      temperature: 0.5,
  max_tokens: 400,
    };
  }

  async selectRandomModel() {
    return this.aiModelService.getRandomModel('openrouter');
  }

  modelIsAvailable(model) {
    return this.aiModelService.modelIsAvailable('openrouter', model);
  }

  /**
 * Generates structured output using OpenRouter-compatible models and OpenAI-style schema.
 * @param {Object} config
 * @param {string} config.prompt - The user prompt to send.
 * @param {Object} config.schema - A JSON schema describing the expected structure.
 * @param {Object} config.options - Additional chat options (e.g., model, temperature).
 * @returns {Promise<Object>} - The parsed and validated JSON object from the model.
 */
  async generateStructuredOutput({ prompt, schema, options = {} }) {
    const messages = [
      { role: 'user', content: prompt }
    ];

    const baseSchema = typeof schema === 'object' && schema ? schema : { type: 'object' };
    const jsonSchemaPayload = {
      name: baseSchema.title || 'Schema',
      schema: baseSchema,
      strict: true,
    };
    const structuredOptions = {
      model: options.model || this.structured_model,
      response_format: { type: 'json_schema', json_schema: jsonSchemaPayload },
      ...options,
    };

    try {
      const response = await this.chat(messages, structuredOptions);
      return typeof response === 'string' ? parseFirstJson(response) : response;
    } catch (err) {
      this.logger.error('Failed to parse structured output from OpenRouter:', err);
      // Retry once with json_object to coerce raw JSON without schema validation
      try {
        const alt = await this.chat(messages, { ...structuredOptions, response_format: { type: 'json_object' } });
        return typeof alt === 'string' ? parseFirstJson(alt) : alt;
      } catch (e2) {
        this.logger.error('Fallback json_object parse also failed:', e2);
        throw new Error('Structured output was not valid JSON.');
      }
    }
  }


  async generateCompletion(prompt, options = {}) {
    // Merge defaults with caller options and map model to an available one
    let selectedModel = options.model || this.model;
    try {
      const mapped = await this.getModel(selectedModel);
      if (mapped) selectedModel = mapped;
    } catch {}
    // Do not allow options.model to override the normalized model
    const { model: _omitModel, ...rest } = options || {};
    const mergedOptions = {
      ...this.defaultCompletionOptions,
      model: selectedModel,
      prompt,
      ...rest,
    };

    try {
      const response = await this.openai.completions.create(mergedOptions);
      if (!response || !response.choices || response.choices.length === 0) {
        this.logger.error('Invalid response from OpenRouter during completion generation.');
        return options.returnEnvelope ? { text: '', raw: response, model: mergedOptions.model, provider: 'openrouter', error: { code: 'EMPTY', message: 'No choices' } } : null;
      }
  const text = response.choices[0].text.trim();
  return options.returnEnvelope ? { text, raw: response, model: mergedOptions.model, provider: 'openrouter', error: null } : text;
    } catch (error) {
      this.logger.error('Error while generating completion from OpenRouter:', error);
      // Try a safe fallback model once on 400/404
      const status = error?.response?.status || error?.status;
      if ((status === 400 || status === 404) && selectedModel !== this.defaultChatOptions?.model) {
        try {
          const fallbackModel = this.defaultChatOptions?.model || this.model || 'openai/gpt-4o-mini';
          const resp = await this.openai.completions.create({ ...mergedOptions, model: fallbackModel });
          const text = resp?.choices?.[0]?.text?.trim?.() || '';
          return options.returnEnvelope ? { text, raw: resp, model: fallbackModel, provider: 'openrouter', error: null } : text || null;
        } catch {}
      }
      return options.returnEnvelope ? { text: '', raw: null, model: mergedOptions.model, provider: 'openrouter', error: { code: status === 429 ? 'RATE_LIMIT' : 'COMPLETION_ERROR', message: error.message } } : null;
    }
  }

  async chat(messages, options = {}, retries = 3) {
    const attempted = new Set();
    // Merge defaults with caller options and map model to an available one
    let selectedModel = options.model || this.defaultChatOptions?.model || this.model;
    try {
      const mapped = await this.getModel(selectedModel);
      if (mapped) selectedModel = mapped;
    } catch {}
    // Merge with correct precedence: defaults < selected model/messages < caller options
    const { model: _discardModel, ...rest } = options || {};
    const mergedOptions = {
      ...this.defaultChatOptions,
      model: selectedModel,
      messages: (messages || []).filter(m => m && m.content !== undefined),
      ...rest,
    };

    // Ensure we always have a concrete model string
    if (!mergedOptions.model) {
      mergedOptions.model = this.defaultChatOptions?.model || this.model || 'openrouter/auto';
    }

    if (options.schema) {
      const baseSchema = typeof options.schema === 'object' && options.schema ? options.schema : { type: 'object' };
      mergedOptions.response_format = {
        type: 'json_schema',
        json_schema: { name: baseSchema.title || 'Schema', schema: baseSchema, strict: true },
      };
    }

    // Verify that the chosen model is available. If not, map or fall back.
    let fallback = false;
  if (mergedOptions.model !== 'openrouter/auto' && !this.modelIsAvailable(mergedOptions.model)) {
      this.logger.error('Invalid model provided to chat:', mergedOptions.model);
      const mapped = await this.getModel(mergedOptions.model);
      if (mapped && this.modelIsAvailable(mapped)) {
        mergedOptions.model = mapped;
      } else {
        mergedOptions.model = this.defaultChatOptions?.model || this.model || 'openrouter/auto';
        fallback = true;
      }
    }

    this.logger.info(`Generating chat completion with model ${mergedOptions.model}...`);

    try {
  attempted.add(mergedOptions.model);
  const response = await this.openai.chat.completions.create(mergedOptions);
      if (!response) {
        this.logger.error('Null response from OpenRouter during chat.');
        return options.returnEnvelope ? { text: '', raw: null, model: mergedOptions.model, provider: 'openrouter', error: { code: 'EMPTY', message: 'Null response' } } : null;
      }

      if (response.error) {
        this.logger.error('Error in OpenRouter response:', response.error);
        return null;
      }

      if (!response.choices || response.choices.length === 0) {
  this.logger.error('Unexpected response format from OpenRouter:', response);
  this.logger.info('Response:', JSON.stringify(response, null, 2));
  return options.returnEnvelope ? { text: '', raw: response, model: mergedOptions.model, provider: 'openrouter', error: { code: 'FORMAT', message: 'No choices' } } : null;
      }
      const result = response.choices[0].message;

      // If response is meant to be structured JSON, preserve it
      if (mergedOptions.response_format?.type === 'json_object') {
        return result.content;
      }

      // Handle function/tool calls if present
      if (result.tool_calls) {
        // Return a serialized representation so downstream logging does not show [object Object]
        try {
          return JSON.stringify({ tool_calls: result.tool_calls }, null, 2);
        } catch {
          return '[tool_calls returned – serialization failed]';
        }
      }

        // Normalize content that might be an array of segments
        let normalizedContent = result.content;
        if (Array.isArray(normalizedContent)) {
          try {
            normalizedContent = normalizedContent.map(p => (typeof p === 'string' ? p : p?.text || p?.content || ''))
              .filter(Boolean)
              .join('\n')
              .trim();
          } catch {}
        }
        if (!normalizedContent && !result.reasoning) {
        this.logger.error('Invalid response from OpenRouter during chat.');
        this.logger.info(JSON.stringify(result, null, 2));
        const txt = '\n-# [⚠️ No response from OpenRouter]';
        return options.returnEnvelope ? { text: txt, raw: response, model: mergedOptions.model, provider: 'openrouter', error: null } : txt;
      }

      // Do not inject <think> tags into visible content; keep reasoning separate
      result.content = normalizedContent;

      // Final safety scrub to ensure no <think> tags leak
      const scrub = (s) => {
        try {
          return String(s || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        } catch { return String(s || '').trim(); }
      };
      const baseText = (scrub(result.content) || '...') + (fallback ? `\n-# [⚠️ Fallback model (${mergedOptions.model}) used.]` : '');
  return options.returnEnvelope ? { text: baseText, raw: response, model: mergedOptions.model, provider: 'openrouter', error: null } : baseText;
    } catch (error) {
      this.logger.error('Error while chatting with OpenRouter:', error);
      const status = error?.response?.status || error?.status;
      // Retry if the error is a rate limit error
      if (status === 429 && retries > 0) {
        this.logger.error('Retrying chat with OpenRouter in 5 seconds...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        return this.chat(messages, options, retries - 1);
      }
      // On 400/402/404 (invalid/unavailable/paid-only), try prioritized fallbacks once per call
      if ((status === 400 || status === 402 || status === 404) && retries > 0) {
        const candidates = await this._getFallbackModels(mergedOptions.model);
        for (const m of candidates) {
          if (!m || attempted.has(m)) continue;
          try {
            this.logger.info(`Retrying with fallback model ${m}...`);
            attempted.add(m);
            const resp = await this.openai.chat.completions.create({ ...mergedOptions, model: m });
            const choice = resp?.choices?.[0]?.message;
            if (!choice) continue;
            const scrub = (s) => {
              try { return String(s || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(); }
              catch { return String(s || '').trim(); }
            };
            const content = scrub(choice.content);
            const baseText = (content || '...') + (m !== mergedOptions.model ? `\n-# [⚠️ Fallback model (${m}) used.]` : '');
            return options.returnEnvelope ? { text: baseText, raw: resp, model: m, provider: 'openrouter', error: null } : baseText;
          } catch (e) {
            const st = e?.response?.status || e?.status;
            this.logger.warn?.(`Fallback model ${m} failed (${st || 'ERR'}). Trying next...`);
          }
        }
      }
      return options.returnEnvelope ? { text: '', raw: null, model: mergedOptions.model, provider: 'openrouter', error: { code: status === 429 ? 'RATE_LIMIT' : 'CHAT_ERROR', message: error.message } } : null;
    }
  }

  /**
 * Retrieves a model by exact match or finds the closest match using fuzzy search.
 * @param {string} modelName - The name of the model to search for.
 * @returns {string|null} - The exact or closest matching model name, or null if no match is found.
 */
  async getModel(modelName) {
    if (!modelName) {
      console.warn('No model name provided for retrieval.');
      return await this.selectRandomModel();
    }
    // Normalize the model name by removing suffixes and applying fixups
    modelName = modelName.replace(/:(online|free)$/i, '').trim();
    // Map bare Gemini slugs to OpenRouter's provider-qualified Google slugs
    if (/^gemini[-/]/i.test(modelName)) {
      modelName = `google/${modelName}`;
    }
    modelName = this._normalizePreferredModel(modelName);
    try {
      const mapped = this.aiModelService.findClosestModel('openrouter', modelName);
      if (mapped) return mapped;
      // Heuristics: strip provider prefixes from other ecosystems
      const name = modelName.replace(/^google\//, '').replace(/^x-ai\//, '').replace(/^openai\//, '').replace(/^meta-llama\//, 'meta-llama/');
      const fallback = this.aiModelService.findClosestModel('openrouter', name);
      return fallback;
    } catch {
      return null;
    }
  }

  /** Normalize known problematic/external model names to safer equivalents */
  _normalizePreferredModel(name) {
    if (!name) return name;
    const fixes = new Map([
      // OpenAI dated variants
      ['openai/gpt-4o-2024-11-20', 'openai/gpt-4o'],
      ['openai/gpt-4o-2024-08-06', 'openai/gpt-4o'],
      // Yi / 01.ai family
      ['01-ai/yi-large', 'openai/gpt-oss-20b'],
      // GLM variants
      ['thudm/glm-z1-32b', 'thudm/glm-4-32b'],
      // QwQ free variant normalizations
      ['qwen/qwq-32b', 'qwen/qwq-32b'],
    ]);
    return fixes.get(name) || name;
  }

  /** Produce a prioritized list of fallback models, filtered to those we "know" are available */
  async _getFallbackModels(badModel) {
    const cleaned = String(badModel || '').replace(/:(online|free)$/i, '');
    const candidatesRaw = [
      this._normalizePreferredModel(cleaned),
      'openai/gpt-4o',
      'openai/gpt-4.1',
      'openai/gpt-4o-mini',
      'anthropic/claude-3.7-sonnet',
      'meta-llama/llama-3.3-70b-instruct',
      'mistralai/mixtral-8x7b-instruct',
      'google/gemini-2.5-pro',
    ];
    const uniq = [...new Set(candidatesRaw)].filter(Boolean);
    // Keep only those present in our registered model list to improve success odds
    return uniq.filter(m => this.modelIsAvailable(m));
  }


  /**
   * Analyzes an image and returns a description using OpenRouter's API.
   * Supports both image URLs and base64/mimeType input.
   * @param {string|Buffer} imageInput - The URL of the image or base64 buffer.
   * @param {string} [mimeType] - The mime type if using base64.
   * @param {string} [prompt] - The prompt to use for image analysis.
   * @param {Object} [options] - Additional options for the API request.
   * @returns {Promise<string|null>} - The description of the image or null if analysis fails.
   */
  async analyzeImage(imageInput, mimeType, prompt = "Describe this image in detail.", options = {}) {
    try {
      let messages;
      if (typeof imageInput === 'string' && (!mimeType || imageInput.startsWith('http'))) {
        // imageInput is a URL
        messages = [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageInput } },
            ],
          },
        ];
      } else if (imageInput && mimeType) {
        // imageInput is base64 or buffer
        messages = [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageInput}` } },
            ],
          },
        ];
      } else {
        this.logger.error('Invalid image input for analysis.');
        return null;
      }

      // Map/resolve the vision model and merge options safely
      let visionModel = options.model || this.defaultVisionOptions?.model;
      try {
        const mapped = await this.getModel(visionModel);
        if (mapped) visionModel = mapped;
      } catch {}

      const { model: _visionModelOmit, ...rest } = options || {};
      const visionOpts = {
        ...this.defaultVisionOptions,
        model: visionModel,
        messages,
        ...rest,
      };

      let response = await this.openai.chat.completions.create(visionOpts);

      if (!response || !response.choices || response.choices.length === 0) {
        this.logger.error('Invalid response from OpenRouter during image analysis.');
        return null;
      }

      const content = response.choices[0].message.content?.trim();
      if (!content) {
        this.logger.error('OpenRouter image analysis returned empty content.');
        return null;
      }
      return content;
    } catch (error) {
      // On model issues (400/404), retry once with default chat model as last resort
      const status = error?.response?.status || error?.status;
      if (status === 400 || status === 404) {
        try {
          const fallbackModel = this.defaultChatOptions?.model || this.model || 'openai/gpt-4o-mini';
          const response = await this.openai.chat.completions.create({
            model: fallbackModel,
            messages: [
              { role: 'user', content: [{ type: 'text', text: prompt }] },
            ],
            max_tokens: this.defaultVisionOptions?.max_tokens || 200,
            temperature: this.defaultVisionOptions?.temperature || 0.5,
          });
          const content = response?.choices?.[0]?.message?.content?.trim?.();
          return content || null;
  } catch {}
      }
      this.logger.error('Error analyzing image with OpenRouter:', error);
      return null;
    }
  }

  /**
   * Generate an image using the selected model. If the model is Replicate/flux-dev-lora, use ReplicateService.
   * @param {string} prompt
   * @param {object|array} [images] - Array of image URLs/base64 or single image. Only one is supported for Replicate; if multiple, one is chosen at random.
   * @param {object} [options]
   * @returns {Promise<string|null>} - The URL or base64 of the generated image.
   */
  async generateImage(prompt, images = [], options = {}) {
    // Check if the selected model is Replicate/flux-dev-lora
    const model = options.model || this.model;
    if (model && model.includes('flux-dev-lora')) {
      if (!this.services?.replicateService) {
        this.logger?.error?.('ReplicateService not available in services');
        return null;
      }
      // Accepts images as array or single image
      const imageArr = Array.isArray(images) ? images : images ? [images] : [];
      return await this.services.replicateService.generateImage(prompt, imageArr, options);
    }
    // Fallback to OpenRouter's own image generation (if supported)
    // ...existing code for OpenRouter image generation (if any)...
    this.logger?.warn?.('No image generation implemented for this model in OpenRouterAIService.');
    return null;
  }

  /**
   * Compose an image from multiple sources. If Replicate/flux-dev-lora, use ReplicateService.
   * @param {array} images
   * @param {string} prompt
   * @param {object} [options]
   * @returns {Promise<string|null>}
   */
  async composeImage(images, prompt, options = {}) {
    const model = options.model || this.model;
    if (model && model.includes('flux-dev-lora')) {
      if (!this.services?.replicateService) {
        this.logger?.error?.('ReplicateService not available in services');
        return null;
      }
      // Compose: randomly pick one image, pass to Replicate
      const imageArr = Array.isArray(images) ? images : images ? [images] : [];
      return await this.services.replicateService.generateImage(prompt, imageArr, options);
    }
    // ...existing code for OpenRouter composeImage (if any)...
    this.logger?.warn?.('No composeImage implemented for this model in OpenRouterAIService.');
    return null;
  }
}