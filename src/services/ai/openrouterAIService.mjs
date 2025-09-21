/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import OpenAI from 'openai';
import models from '../../models.openrouter.config.mjs';
import { parseFirstJson, parseWithRetries } from '../../utils/jsonParse.mjs';

/**
 * Normalize an OpenRouter/OpenAI style error object into a concise, structured form.
 * NEVER include API keys or large payloads – only safe diagnostic fields.
 * @param {any} err
 * @returns {{status:number|null, code:string|null, type:string|null, providerMessage:string, userMessage:string}}
 */
function parseProviderError(err) {
  try {
    const status = err?.response?.status || err?.status || null;
    // OpenAI style: err.error { type, code, message }
    const raw = err?.error || err?.response?.data?.error || err?.data?.error || null;
    const type = raw?.type || err?.type || null;
    const code = raw?.code || err?.code || (status ? `HTTP_${status}` : null);
    // Prefer provider's message, fallback to generic
    const providerMessage = raw?.message || err?.message || 'Unknown provider error';
    // Public-friendly (avoid leaking internal texts like policy references)
    let userMessage = 'Upstream model request failed';
    if (status === 400) userMessage = 'Invalid request for selected model';
    else if (status === 401) userMessage = 'Authentication failed – check API key';
    else if (status === 402) userMessage = 'Model requires payment or is unavailable';
    else if (status === 403) userMessage = 'Access to model is forbidden';
    else if (status === 404) userMessage = 'Model not found';
    else if (status === 429) userMessage = 'Rate limit reached – slowing down';
    else if (status === 500) userMessage = 'Provider internal error';
    else if (status === 503) userMessage = 'Provider temporarily unavailable';
    return { status, code, type, providerMessage, userMessage };
  } catch (e) {
    return { status: null, code: null, type: null, providerMessage: e.message || 'parse error', userMessage: 'Unknown error' };
  }
}

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
    this.apiKey = this.configService.config.ai.openrouter.apiKey;
    this.baseURL = 'https://openrouter.ai/api/v1';
    this.defaultHeaders = {
      'HTTP-Referer': 'https://ratimics.com',
      'X-Title': 'cosyworld',
    };
    this.openai = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      defaultHeaders: this.defaultHeaders,
    });
  this.modelConfig = models;
  // Allow disabling fuzzy/automatic model remapping via env OPENROUTER_MODEL_LOCK=true
  this.modelLock = /^true$/i.test(process.env.OPENROUTER_MODEL_LOCK || 'false');
  this.traceModelSelection = /^true$/i.test(process.env.OPENROUTER_MODEL_TRACE || 'false');
  this.disableFallbacks = /^true$/i.test(process.env.OPENROUTER_DISABLE_MODEL_FALLBACKS || 'false');
    this._modelSupportCache = new Map();

    // Validate that the configured structured model can honor json_schema response format.
    this.ready = this._validateStructuredModelSupport(this.structured_model)
      .catch(err => {
        const msg = `[OpenRouterAIService] Structured model validation failed for ${this.structured_model}: ${err?.message || err}`;
        this.logger?.error?.(msg);
        throw err;
      });

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
    if (this.ready) await this.ready;
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

    await this._ensureModelSupportsStructuredOutputs(structuredOptions.model);

    try {
      const response = await this.chat(messages, structuredOptions);
      return typeof response === 'string' ? parseFirstJson(response) : response;
    } catch (err) {
      const parsed = parseProviderError(err);
      this.logger?.error?.('[OpenRouter][StructuredOutput] json_schema attempt failed', parsed);

      // Capability hint: if status 400 and we previously marked model as supporting response_format, note possible transient / schema error.
      try {
        if (parsed.status === 400) {
          const key = String(structuredOptions.model || '').toLowerCase();
          const supported = this._modelSupportCache.get(key);
          if (supported === true) {
            this.logger?.warn?.(`[OpenRouter][StructuredOutput] Model '${structuredOptions.model}' is cached as supporting response_format but returned 400 – possible schema incompatibility or provider regression.`);
          } else if (supported === false) {
            this.logger?.warn?.(`[OpenRouter][StructuredOutput] Model '${structuredOptions.model}' is NOT marked as supporting response_format; falling back immediately.`);
          }
        }
      } catch {}

  // Build concise schema instructions to coerce JSON without relying on response_format
  const schemaKeys = Object.keys(baseSchema?.properties || {});
  const example = JSON.stringify(Object.fromEntries(schemaKeys.map(k => [k, '...'])), null, 2);
      const instructions = `Respond ONLY with a single valid JSON object. It must match this shape (types can vary as appropriate):\n${example}\nDo not include any extra commentary or markdown.`;
      const fallbackMessages = [
        { role: 'system', content: instructions },
        { role: 'user', content: prompt }
      ];
      const withoutRF = { ...options, model: options.model || this.structured_model };
      try {
        const raw = await parseWithRetries(async () => {
          const r = await this.chat(fallbackMessages, withoutRF);
          return typeof r === 'string' ? r : JSON.stringify(r);
        }, { retries: 2, backoffMs: 600 });
        return raw;
      } catch (e2) {
        const p2 = parseProviderError(e2);
        this.logger?.warn?.('[OpenRouter][StructuredOutput] instruction-only parse failed, trying json_object', p2);
        // Final attempt: json_object (if the provider supports it) without schema
        try {
          const alt = await this.chat(messages, { ...withoutRF, response_format: { type: 'json_object' } });
          return typeof alt === 'string' ? parseFirstJson(alt) : alt;
        } catch (e3) {
          const p3 = parseProviderError(e3);
          this.logger?.error?.('[OpenRouter][StructuredOutput] all fallbacks failed', p3);
          throw new Error('Structured output was not valid JSON.');
        }
      }
    }
  }


  async generateCompletion(prompt, options = {}) {
    // Merge defaults with caller options and map model to an available one
    let selectedModel = options.model || this.model;
    const originalRequested = selectedModel;
    if (!this.modelLock) {
      try {
        const mapped = await this.getModel(selectedModel);
        if (mapped) selectedModel = mapped;
      } catch {}
    }
    if (this.traceModelSelection) {
      this.logger?.info?.(`[OpenRouter][trace] completion request model requested='${originalRequested}' normalized='${selectedModel}' lock=${this.modelLock}`);
    }
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
        const text = response.choices[0].text?.trim?.() || '';
        return options.returnEnvelope ? { text, raw: response, model: mergedOptions.model, provider: 'openrouter', error: null } : text;
    } catch (error) {
      const parsed = parseProviderError(error);
      this.logger.error('[OpenRouter][Completion] error', parsed);
      const status = parsed.status;
      return options.returnEnvelope ? { text: '', raw: null, model: mergedOptions.model, provider: 'openrouter', error: { code: parsed.code || (status === 429 ? 'RATE_LIMIT' : 'COMPLETION_ERROR'), message: parsed.userMessage } } : null;
    }
  }

  async chat(messages, options = {}, retries = 3) {
    if (this.ready) await this.ready;
  // Removed multi-model attempt tracking; single attempt only.
    // Merge defaults with caller options and map model to an available one
    let selectedModel = options.model || this.defaultChatOptions?.model || this.model;
    const originalRequested = selectedModel;
    if (!this.modelLock) {
      try {
        const mapped = await this.getModel(selectedModel);
        if (mapped) selectedModel = mapped;
      } catch {}
    }
    if (this.traceModelSelection) {
      this.logger?.info?.(`[OpenRouter][trace] chat request model requested='${originalRequested}' normalized='${selectedModel}' lock=${this.modelLock}`);
    }
    // Merge with correct precedence: defaults < selected model/messages < caller options
    const { model: _discardModel, ...rest } = options || {};
    const mergedOptions = {
      ...this.defaultChatOptions,
      model: selectedModel,
      messages: (messages || []).filter(m => m && m.content !== undefined),
      ...rest,
    };

    if (mergedOptions.response_format?.type === 'json_schema') {
      await this._ensureModelSupportsStructuredOutputs(mergedOptions.model);
    }

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

    if (mergedOptions.model !== 'openrouter/auto' && !this.modelIsAvailable(mergedOptions.model)) {
      this.logger.warn('Model not registered locally; sending as-is to provider:', mergedOptions.model);
    }

    this.logger.info(`Generating chat completion with model ${mergedOptions.model}...`);

    try {
    // Single model attempt
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
    const baseText = (scrub(result.content) || '...');
  return options.returnEnvelope ? { text: baseText, raw: response, model: mergedOptions.model, provider: 'openrouter', error: null } : baseText;
    } catch (error) {
      const parsed = parseProviderError(error);
      this.logger.error('[OpenRouter][Chat] error', parsed);
      const status = parsed.status;
      // Retry if the error is a rate limit error
      if (status === 429 && retries > 0) {
        this.logger.error('Retrying chat with OpenRouter in 5 seconds...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        return this.chat(messages, options, retries - 1);
      }
      // No fallback attempts retained.
      return options.returnEnvelope ? { text: '', raw: null, model: mergedOptions.model, provider: 'openrouter', error: { code: parsed.code || (status === 429 ? 'RATE_LIMIT' : 'CHAT_ERROR'), message: parsed.userMessage } } : null;
    }
  }

  /**
 * Retrieves a model by exact match or finds the closest match using fuzzy search.
 * @param {string} modelName - The name of the model to search for.
 * @returns {string|null} - The exact or closest matching model name, or null if no match is found.
 */
  async getModel(modelName) {
    if (!modelName) {
      if (this.traceModelSelection) this.logger?.warn?.('[OpenRouter][trace] getModel called without modelName; selecting random.');
      return await this.selectRandomModel();
    }
    // Normalize the model name by removing suffixes and applying fixups
    modelName = modelName.replace(/:(online|free)$/i, '').trim();
    // Map bare Gemini slugs to OpenRouter's provider-qualified Google slugs
    if (/^gemini[-/]/i.test(modelName)) {
      modelName = `google/${modelName}`;
    }
    const original = modelName;
    modelName = this._normalizePreferredModel(modelName);
    if (this.modelLock || this.disableFallbacks) {
      if (this.traceModelSelection && original !== modelName) {
        this.logger?.info?.(`[OpenRouter][trace] canonicalized '${original}' -> '${modelName}' (lock=${this.modelLock} disableFallbacks=${this.disableFallbacks})`);
      }
      // Return as-is; let upstream provider surface errors for unavailable models.
      return modelName;
    }
    try {
      const mapped = this.aiModelService.findClosestModel('openrouter', modelName);
      if (mapped && mapped !== modelName && this.traceModelSelection) {
        this.logger?.info?.(`[OpenRouter][trace] fuzzy mapped '${modelName}' -> '${mapped}'`);
      }
      if (mapped) return mapped;
      const name = modelName.replace(/^google\//, '').replace(/^x-ai\//, '').replace(/^openai\//, '').replace(/^meta-llama\//, 'meta-llama/');
      const fallback = this.aiModelService.findClosestModel('openrouter', name);
      if (fallback && fallback !== modelName && this.traceModelSelection) {
        this.logger?.info?.(`[OpenRouter][trace] provider-prefix stripped map '${modelName}' -> '${fallback}'`);
      }
      return fallback;
    } catch {
      return null;
    }
  }

  /** Normalize known problematic/external model names to safer equivalents */
  _normalizePreferredModel(name) {
    if (!name) return name;
    // Minimal canonicalization only (date-stamped variants → base). No tier downgrades.
    const canonical = new Map([
      ['openai/gpt-4o-2024-11-20', 'openai/gpt-4o'],
      ['openai/gpt-4o-2024-08-06', 'openai/gpt-4o'],
    ]);
    return canonical.get(name) || name;
  }

  // _getFallbackModels removed.

  async _validateStructuredModelSupport(model) {
    const name = String(model || '').trim();
    if (!name || name === 'openrouter/auto' || name === 'auto') {
      return;
    }
    await this._ensureModelSupportsStructuredOutputs(name);
    this.logger?.info?.(`[OpenRouterAIService] Structured model '${name}' supports json_schema response_format.`);
  }

  async _ensureModelSupportsStructuredOutputs(model) {
    const key = String(model || '').toLowerCase();
    if (!key || key === 'openrouter/auto' || key === 'auto') return;
    if (this._modelSupportCache.has(key)) {
      const supported = this._modelSupportCache.get(key);
      if (!supported) {
        throw new Error(`Model '${model}' is not compatible with response_format=json_schema.`);
      }
      return;
    }
    const supported = await this._modelSupportsStructuredOutputs(model);
    this._modelSupportCache.set(key, supported);
    if (!supported) {
      throw new Error(`Model '${model}' is not compatible with response_format=json_schema.`);
    }
  }

  async _modelSupportsStructuredOutputs(model) {
    try {
      const endpoints = await this._fetchModelEndpoints(model);
      if (!endpoints?.length) return false;
      const supports = endpoints.some(ep => {
        if (!ep || typeof ep !== 'object') return false;
        const params = Array.isArray(ep.supported_parameters) ? ep.supported_parameters : [];
        return params.map(p => String(p || '').toLowerCase()).some(p => p === 'response_format' || p.startsWith('response_format'));
      });
      return supports;
    } catch (err) {
      throw new Error(`Failed to verify structured output support for '${model}': ${err?.message || err}`);
    }
  }

  async _fetchModelEndpoints(model) {
    const [author, ...rest] = String(model || '').split('/');
    if (!author || !rest.length) {
      throw new Error(`Invalid OpenRouter model identifier '${model}'.`);
    }
    const slug = rest.join('/');
    const url = `${this.baseURL}/models/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/endpoints`;

    const headers = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    if (this.defaultHeaders) {
      Object.assign(headers, this.defaultHeaders);
    }

    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const json = await res.json();
    return json?.data?.endpoints || [];
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
      this.logger.error('[OpenRouter][Vision] error', parseProviderError(error));
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
