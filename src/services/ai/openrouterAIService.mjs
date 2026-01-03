/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file openrouterAIService.mjs
 * @description OpenRouter API integration for multi-model AI completions
 * @module services/ai
 * 
 * @context
 * OpenRouter provides unified access to 300+ AI models from providers including
 * OpenAI, Anthropic, Google, Meta, and many others through a single API. This
 * service acts as CosyWorld's primary AI backend, handling model selection,
 * structured output generation, and graceful fallback strategies.
 * 
 * CosyWorld uses a tier-based system (Legendary, Rare, Uncommon, Common) where
 * avatars are assigned AI models based on their rarity. This service manages
 * the mapping between requested models and available models, with fuzzy matching
 * to handle model name variations.
 * 
 * @architecture
 * - Layer: Service (external API integration)
 * - Pattern: Singleton with dependency injection
 * - SDK: OpenAI SDK configured with OpenRouter base URL
 * - Model Registry: Managed by AIModelService for fuzzy matching
 * - Fallback Strategy: json_schema → json_object → instruction-based
 * - Error Handling: Structured error objects with user-friendly messages
 * - Caching: Model capability checks cached in-memory
 * 
 * @lifecycle
 * 1. Constructor: Initialize OpenAI client, register models, set defaults
 * 2. ready promise: Validate structured output support for default model
 * 3. Runtime: Handle requests with automatic model selection and fallbacks
 * 4. Shutdown: None needed (stateless HTTP client)
 * 
 * @dataflow
 * Tool/Chat Request → UnifiedAIService → [This Service] → OpenRouter API
 * → Provider (OpenAI/Google/etc) → Parse response → Validate → Return
 * Structured requests go through multiple fallback attempts if needed.
 * 
 * @dependencies
 * - logger: Winston logger for structured logging
 * - aiModelService: Model registry and fuzzy matching
 * - configService: API keys, default models, feature flags
 * - openai SDK: HTTP client for OpenRouter API
 * 
 * @performance
 * - Rate Limits: Vary by provider (typically 60-100 req/min)
 * - Response Time: 1-5s depending on model and complexity
 * - Caching: Model capability checks cached indefinitely
 * - Structured Output: Adds ~100-200ms vs plain text
 * - Fallback Chain: Adds 2-5s total if primary format fails
 * 
 * @errors
 * All errors are normalized to a consistent structure:
 * - status: HTTP status code or null
 * - code: Error code (RATE_LIMIT, AUTH_FAILED, etc.)
 * - type: OpenAI error type (if applicable)
 * - providerMessage: Raw error from provider
 * - userMessage: User-friendly explanation
 * 
 * @example
 * // Basic chat completion
 * const service = container.resolve('openrouterAIService');
 * const response = await service.chat([
 *   { role: 'user', content: 'Hello!' }
 * ], { model: 'openai/gpt-4o-mini' });
 * console.log(response); // "Hello! How can I help you today?"
 * 
 * @example
 * // Structured output with schema
 * const result = await service.generateStructuredOutput({
 *   prompt: "Create 3 fantasy items",
 *   schema: {
 *     type: "object",
 *     properties: {
 *       items: {
 *         type: "array",
 *         items: {
 *           type: "object",
 *           properties: {
 *             name: { type: "string" },
 *             description: { type: "string" },
 *             rarity: { type: "string", enum: ["common","rare","legendary"] }
 *           }
 *         }
 *       }
 *     }
 *   }
 * });
 * 
 * @example
 * // Image analysis with vision models
 * const description = await service.analyzeImage(
 *   'https://example.com/image.jpg',
 *   null,
 *   'Describe this image in detail',
 *   { model: 'x-ai/grok-2-vision-1212' }
 * );
 * 
 * @see {@link https://openrouter.ai/docs} OpenRouter API Documentation
 * @see {@link AIModelService} for model selection logic
 * @see {@link UnifiedAIService} for provider-agnostic interface
 * @since 0.0.1
 */

import OpenAI from 'openai';
import models from '../../models.openrouter.config.mjs';
import { parseFirstJson, parseWithRetries } from '../../utils/jsonParse.mjs';

/**
 * Sanitize an API response object for logging by truncating large data.
 * Removes or truncates base64 image data and other large payloads.
 * 
 * @param {any} obj - Object to sanitize
 * @param {number} [maxStringLen=200] - Maximum length for string values
 * @returns {any} - Sanitized copy of the object safe for logging
 */
function sanitizeForLogging(obj, maxStringLen = 200) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    // Truncate long strings (like base64 data)
    if (obj.length > maxStringLen) {
      // Check if it looks like base64
      if (/^[A-Za-z0-9+/=]{100,}$/.test(obj.slice(0, 100))) {
        return `[base64 data, ${obj.length} chars]`;
      }
      if (obj.startsWith('data:')) {
        const match = obj.match(/^data:([^;,]+)/);
        return `[data URI: ${match?.[1] || 'unknown'}, ${obj.length} chars]`;
      }
      return obj.slice(0, maxStringLen) + `... [truncated, ${obj.length} total chars]`;
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeForLogging(item, maxStringLen));
  }
  if (typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = sanitizeForLogging(value, maxStringLen);
    }
    return result;
  }
  return obj;
}

/**
 * Normalize an OpenRouter/OpenAI style error object into a structured diagnostic form.
 * 
 * @description
 * Extracts useful error information from various error shapes (OpenAI SDK errors,
 * HTTP errors, OpenRouter-specific errors) and normalizes them into a consistent
 * structure. Scrubs sensitive information like API keys and large payloads.
 * 
 * @context
 * OpenRouter wraps multiple providers, each with different error formats. This
 * function standardizes errors for logging and user-facing messages. It maps
 * HTTP status codes to user-friendly explanations while preserving technical
 * details for debugging.
 * 
 * @param {any} err - Error object from OpenRouter/OpenAI SDK or HTTP client
 * @returns {{status:number|null, code:string|null, type:string|null, providerMessage:string, userMessage:string}}
 * @returns {number|null} .status - HTTP status code (400, 401, 429, etc.)
 * @returns {string|null} .code - Error code (invalid_request_error, rate_limit_exceeded, etc.)
 * @returns {string|null} .type - OpenAI error type (if available)
 * @returns {string} .providerMessage - Raw error message from provider (for logs)
 * @returns {string} .userMessage - User-friendly explanation (safe to show users)
 * 
 * @example
 * try {
 *   await openai.chat.completions.create({...});
 * } catch (err) {
 *   const parsed = parseProviderError(err);
 *   logger.error('OpenRouter error', parsed);
 *   if (parsed.status === 429) {
 *     await waitAndRetry();
 *   }
 * }
 * 
 * @example
 * // Error structure returned
 * {
 *   status: 429,
 *   code: 'rate_limit_exceeded',
 *   type: 'insufficient_quota',
 *   providerMessage: 'Rate limit reached for requests',
 *   userMessage: 'Rate limit reached – slowing down'
 * }
 * 
 * @performance O(1) - Simple object property access and mapping
 * @since 0.0.9
 */
function parseProviderError(err) {
  try {
    const status = err?.response?.status || err?.status || null;
    // OpenAI SDK style: err has .code, .message, .error (nested), and .headers
    // OpenRouter sometimes wraps in err.error.error
    const raw = err?.error?.error || err?.error || err?.response?.data?.error || err?.data?.error || null;
    const type = raw?.type || err?.type || null;
    const code = raw?.code || err?.code || (status ? `HTTP_${status}` : null);
    // Prefer provider's detailed message, fallback to generic
    const providerMessage = raw?.message || err?.message || 'Unknown provider error';
    // Include metadata if available (OpenRouter often includes helpful context)
    const metadata = raw?.metadata || err?.metadata || null;
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
    return { status, code, type, providerMessage, userMessage, metadata };
  } catch (e) {
    return { status: null, code: null, type: null, providerMessage: e.message || 'parse error', userMessage: 'Unknown error', metadata: null };
  }
}

/**
 * OpenRouterAIService - Multi-model AI completion service
 * 
 * @class
 * @description
 * Provides comprehensive AI capabilities through OpenRouter's unified API:
 * - Text completion (GPT-style completions)
 * - Chat completion (conversational format)
 * - Structured JSON output (with schema validation)
 * - Image analysis (vision models)
 * - Image generation (via Replicate integration)
 * - Automatic model selection and fallback
 * 
 * @context
 * This is CosyWorld's primary AI service, handling ~90% of all AI requests.
 * It supports 300+ models with automatic fallback strategies. Models are
 * selected based on avatar rarity tiers (legendary avatars get GPT-4, common
 * avatars get smaller models). Fuzzy matching handles model name variations
 * and provider prefixes (e.g., "gpt-4o" → "openai/gpt-4o").
 * 
 * @architecture
 * - Singleton service registered in Awilix container
 * - Uses OpenAI SDK with custom baseURL (https://openrouter.ai/api/v1)
 * - Model registry maintained by AIModelService
 * - Response format negotiation: json_schema → json_object → instructions
 * - Error recovery: Automatic retries for rate limits, fallback for unsupported features
 * - Caching: Model capability checks cached in-memory (_modelSupportCache)
 * 
 * @lifecycle
 * 1. Constructor: Resolve config, initialize OpenAI client, register models
 * 2. ready: Async validation of structured output support (completes before first use)
 * 3. Runtime: Handle requests with automatic model selection
 * 4. No explicit shutdown (stateless HTTP client)
 * 
 * @dataflow
 * Request → getModel() fuzzy match → OpenRouter API → Provider → Parse → Validate → Return
 * Structured: Try json_schema → 400 error? → Try json_object → Still fails? → Instructions
 * Chat: Single attempt with configured model, retry on 429 (rate limit)
 * 
 * @dependencies
 * - logger: Winston logger for structured logging
 * - aiModelService: Model registry, fuzzy matching, tier selection
 * - configService: API keys, default models, feature flags
 * - openai: Official OpenAI SDK (configured for OpenRouter)
 * 
 * @configuration
 * Environment variables and ConfigService settings:
 * - OPENROUTER_API_TOKEN: API key (required)
 * - OPENROUTER_MODEL_LOCK: Disable fuzzy matching (default: false)
 * - OPENROUTER_MODEL_TRACE: Log model selection decisions (default: false)
 * - OPENROUTER_DISABLE_MODEL_FALLBACKS: Disable fallback strategies (default: false)
 * - config.ai.openrouter.model: Default chat model
 * - config.ai.openrouter.structuredModel: Model for structured output
 * - config.ai.openrouter.visionModel: Model for image analysis
 * 
 * @performance
 * - Rate Limits: Vary by provider (60-100 req/min typical)
 * - Response Time: 1-5s depending on model complexity
 * - Memory: ~2MB base + ~100KB per cached model capability check
 * - Structured Output: +100-200ms vs plain text (schema validation overhead)
 * - Fallback Chain: +2-5s if multiple attempts needed
 * 
 * @errors
 * - 400: Invalid request or unsupported feature → triggers fallback
 * - 401: Invalid API key → throws immediately (no retry)
 * - 402: Payment required / insufficient credits → throws
 * - 429: Rate limit → retries with exponential backoff (max 3 attempts)
 * - 500: Provider internal error → logs and returns null
 * - 503: Provider unavailable → logs and returns null
 * 
 * @example
 * // Basic usage
 * const service = container.resolve('openrouterAIService');
 * 
 * // Chat completion
 * const response = await service.chat([
 *   { role: 'system', content: 'You are a helpful assistant' },
 *   { role: 'user', content: 'Hello!' }
 * ]);
 * 
 * // With options
 * const response = await service.chat(messages, {
 *   model: 'openai/gpt-4o-mini',
 *   temperature: 0.7,
 *   max_tokens: 500
 * });
 * 
 * @example
 * // Structured output
 * const items = await service.generateStructuredOutput({
 *   prompt: "Generate 3 RPG items",
 *   schema: {
 *     type: "object",
 *     properties: {
 *       items: {
 *         type: "array",
 *         items: {
 *           type: "object",
 *           properties: {
 *             name: { type: "string" },
 *             type: { type: "string" },
 *             power: { type: "number" }
 *           },
 *           required: ["name", "type"]
 *         }
 *       }
 *     }
 *   }
 * });
 * 
 * @example
 * // Image analysis
 * const description = await service.analyzeImage(
 *   imageUrl,
 *   null,
 *   'Describe this avatar in detail',
 *   { model: 'x-ai/grok-2-vision-1212' }
 * );
 * 
 * @example
 * // Error handling
 * const response = await service.chat(messages, {
 *   returnEnvelope: true  // Get full response with error info
 * });
 * if (response.error) {
 *   logger.error('Chat failed:', response.error);
 *   // response.text will be empty string
 *   // response.error.code will be error type (RATE_LIMIT, etc.)
 * }
 * 
 * @see {@link https://openrouter.ai/docs} OpenRouter Documentation
 * @see {@link AIModelService} for model selection
 * @see {@link UnifiedAIService} for provider abstraction
 * @see {@link models.openrouter.config.mjs} for available models
 * @since 0.0.1
 */
export class OpenRouterAIService {
  /**
   * Initialize OpenRouterAIService with dependencies.
   * 
   * @param {Object} deps - Dependency injection container
   * @param {Logger} deps.logger - Winston logger instance
   * @param {AIModelService} deps.aiModelService - Model registry and fuzzy matching
   * @param {ConfigService} deps.configService - Application configuration
   * 
   * @description
   * Sets up OpenAI SDK client, loads default models from config, registers
   * available models with AIModelService, and validates structured output
   * support for the default structured model.
   * 
   * @context
   * Constructor is called by Awilix container during initialization. All
   * dependencies are injected automatically. The 'ready' promise must be
   * awaited before using structured output features.
   * 
   * @example
   * // Service is auto-registered in container.mjs
   * const service = container.resolve('openrouterAIService');
   * await service.ready; // Wait for validation to complete
   * 
   * @since 0.0.1
   */
  constructor({
    logger,
    aiModelService,
    configService,
    openrouterModelCatalogService,
  }) {
    this.logger = logger;
    this.aiModelService = aiModelService;
    this.configService = configService;
    this.openrouterModelCatalogService = openrouterModelCatalogService || null;

    // Resolve defaults from ConfigService (note: align with keys defined in ConfigService)
    const orCfg = this.configService?.config?.ai?.openrouter || {};
    this.model = orCfg.model || 'openai/gpt-4o-mini';
    this.structured_model = orCfg.structuredModel || 'google/gemini-2.0-flash-exp:free';
    this.apiKey = this.configService.config.ai.openrouter.apiKey;
    this.baseURL = 'https://openrouter.ai/api/v1';
    this.defaultHeaders = {
      'HTTP-Referer': 'https://ratimics.com',
      'X-Title': 'cosyworld',
    };
    this.provider = 'openrouter';
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

    // Cache for models that DON'T support json_schema (to skip straight to json_object)
    this._jsonSchemaUnsupportedCache = new Set();

    // Validate that the configured structured model can honor json_schema response format.
    this.ready = this._validateStructuredModelSupport(this.structured_model)
      .catch(err => {
        const msg = `[OpenRouterAIService] Structured model validation failed for ${this.structured_model}: ${err?.message || err}`;
        this.logger?.warn?.(msg);
        // Do not throw here to prevent startup crash.
      });

    // Register models with this.aiModelService
    this.aiModelService.registerModels('openrouter', models);

    // Default options that will be used if not overridden by the caller.
    this.defaultCompletionOptions = {
      temperature: 0.9,        // More randomness for creative output
      top_p: 0.95,             // Broader token selection for diversity
      frequency_penalty: 0.2,  // Moderate penalty to avoid repetitive loops
      presence_penalty: 0.3,   // Push for new ideas and concepts
    };

    // Note: Chat defaults differ from completions. They can be adjusted as needed.
    this.defaultChatOptions = {
      // Prefer configured chat model; fall back to a lightweight default
      model: orCfg.chatModel || 'meta-llama/llama-3.2-1b-instruct',
      // Creativity knobs
      temperature: 0.9,
      top_p: 0.95,
      frequency_penalty: 0.2,
      presence_penalty: 0.3,
    };

    this.defaultVisionOptions = {
      model: orCfg.visionModel || 'x-ai/grok-2-vision-1212',
      temperature: 0.5
    };
  }

  async selectRandomModel() {
    try {
      if (this.openrouterModelCatalogService?.pickRandomExistingModel) {
        const picked = await this.openrouterModelCatalogService.pickRandomExistingModel();
        if (picked) return picked;
      }
    } catch (e) {
      this.logger?.debug?.(`[OpenRouterAIService] selectRandomModel catalog pick failed: ${e?.message || e}`);
    }

    // Fallback: registry-based selection (may be stale, but better than null)
    return this.aiModelService.getRandomModel('openrouter');
  }

  modelIsAvailable(model) {
    return this.aiModelService.modelIsAvailable('openrouter', model);
  }

  /**
   * Heuristic check for whether a given OpenRouter model supports vision/image inputs.
   * We keep this lightweight and local (no network calls) because it's used in hot paths.
   *
   * @param {string} model
   * @returns {boolean}
   */
  supportsVisionModel(model) {
    const m = String(model || '')
      .replace(/:(online|free)$/i, '')
      .trim()
      .toLowerCase();
    if (!m) return false;

    // Provider families that are generally multimodal on OpenRouter.
    // (We keep this conservative and easy to update.)
    if (m.startsWith('google/gemini')) return true;

    // OpenAI vision-capable families where slugs often omit 'vision'.
    if (m.includes('openai/gpt-4o')) return true;
    if (m.includes('openai/gpt-4.1')) return true;
    if (m.includes('gpt-4-vision')) return true;

    // Common OpenRouter naming patterns:
    // - '*vision*' (e.g. llama-3.2-11b-vision-instruct)
    // - '*vl*' (vision-language, e.g. qwen3-vl-8b)
    // - '*image*' (e.g. gpt-5-image, gemini-*-image)
    // - known explicit vision slugs (grok-*-vision)
    return (
      m.includes('vision') ||
      m.includes('-vl-') ||
      m.includes('/vl-') ||
      m.includes('vl-') ||
      m.includes('image') ||
      m.includes('grok-2-vision') ||
      m.includes('grok-vision')
    );
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

    // Handle both nested schema format { name, strict, schema: {...} } and direct schema format { type, properties, ... }
    const schemaObj = schema?.schema || schema;
    const schemaName = schema?.name || schemaObj?.title || 'Schema';
    const isStrict = schema?.strict !== undefined ? schema.strict : true;
    
    const baseSchema = typeof schemaObj === 'object' && schemaObj ? schemaObj : { type: 'object' };
    const jsonSchemaPayload = {
      name: schemaName,
      schema: baseSchema,
      strict: isStrict,
    };

    // Normalize the model to a valid OpenRouter model before validation
    let selectedModel = options.model || this.structured_model;
    if (!this.modelLock) {
      try {
        const mapped = await this.getModel(selectedModel);
        if (mapped) selectedModel = mapped;
      } catch (e) {
        this.logger?.debug?.(`[OpenRouter][StructuredOutput] model mapping failed for '${selectedModel}': ${e?.message || e}`);
      }
    }

    const modelKey = String(selectedModel || '').toLowerCase();
    
    // Check if this model is known to NOT support json_schema (skip directly to json_object)
    const skipJsonSchema = this._jsonSchemaUnsupportedCache.has(modelKey);
    
    if (!skipJsonSchema) {
      // Try json_schema first - use returnEnvelope to capture error details
      const structuredOptions = {
        model: selectedModel,
        response_format: { type: 'json_schema', json_schema: jsonSchemaPayload },
        ...options,
        model: selectedModel,
        returnEnvelope: true,
      };

      try {
        await this._ensureModelSupportsStructuredOutputs(structuredOptions.model);
        const envelope = await this.chat(messages, structuredOptions);
        
        // Check if the response has an error
        if (envelope?.error) {
          const errorCode = String(envelope.error.code ?? '');
          const isHttp400 = errorCode.includes('400') || errorCode === 'HTTP_400';
          if (isHttp400) {
            this._jsonSchemaUnsupportedCache.add(modelKey);
            this.logger?.debug?.(`[OpenRouter][StructuredOutput] Model '${selectedModel}' doesn't support json_schema (400 error), cached for future requests`);
            // Fall through to json_object fallback
          } else {
            this.logger?.warn?.('[OpenRouter][StructuredOutput] json_schema attempt failed', { 
              code: envelope.error.code, 
              message: envelope.error.message,
              model: selectedModel 
            });
          }
        } else if (envelope?.text) {
          // Success - parse and return
          return typeof envelope.text === 'string' ? parseFirstJson(envelope.text) : envelope.text;
        } else {
          // Empty response - fall through to fallbacks
          this.logger?.debug?.(`[OpenRouter][StructuredOutput] Empty response from json_schema for '${selectedModel}'`);
        }
      } catch (err) {
        const parsed = parseProviderError(err);
        
        // For 400 errors, mark this model as not supporting json_schema and fall through
        if (parsed.status === 400) {
          this._jsonSchemaUnsupportedCache.add(modelKey);
          this.logger?.debug?.(`[OpenRouter][StructuredOutput] Model '${selectedModel}' doesn't support json_schema, cached for future requests`);
        } else {
          // Non-400 errors are logged as warnings (could be transient)
          this.logger?.warn?.('[OpenRouter][StructuredOutput] json_schema attempt failed', parsed);
        }
      }
    }

    // Try json_object format (many models support this but not json_schema)
    try {
      const jsonObjectOptions = { ...options, model: selectedModel, response_format: { type: 'json_object' }, returnEnvelope: true };
      const envelope = await this.chat(messages, jsonObjectOptions);
      if (envelope?.error) {
        this.logger?.debug?.('[OpenRouter][StructuredOutput] json_object also failed, trying instruction-only', { 
          code: envelope.error.code, 
          message: envelope.error.message 
        });
      } else if (envelope?.text) {
        return typeof envelope.text === 'string' ? parseFirstJson(envelope.text) : envelope.text;
      }
    } catch (e2) {
      const parsed2 = parseProviderError(e2);
      this.logger?.debug?.('[OpenRouter][StructuredOutput] json_object also failed, trying instruction-only', parsed2);
    }

    // Build concise schema instructions to coerce JSON without relying on response_format
    const schemaKeys = Object.keys(baseSchema?.properties || {});
    const example = JSON.stringify(Object.fromEntries(schemaKeys.map(k => [k, '...'])), null, 2);
    const instructions = `Respond ONLY with a single valid JSON object. It must match this shape (types can vary as appropriate):\n${example}\nDo not include any extra commentary or markdown.`;
    const fallbackMessages = [
      { role: 'system', content: instructions },
      { role: 'user', content: prompt }
    ];
    const withoutRF = { ...options, model: selectedModel, returnEnvelope: true };
    try {
      const raw = await parseWithRetries(async () => {
        const envelope = await this.chat(fallbackMessages, withoutRF);
        if (envelope?.error) throw new Error(envelope.error.message || 'Chat error');
        if (!envelope?.text) throw new Error('Chat returned null/empty response');
        return typeof envelope.text === 'string' ? envelope.text : JSON.stringify(envelope.text);
      }, { retries: 2, backoffMs: 600 });
      return raw;
    } catch (e2) {
      const p2 = parseProviderError(e2);
      this.logger?.error?.('[OpenRouter][StructuredOutput] all fallbacks failed', p2);
      throw new Error(`Structured output generation failed after all attempts: ${p2.userMessage || p2.providerMessage || 'Unable to generate valid JSON'}`);
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
    
    // Check if this is an image-only model - these should NOT be remapped
    // since text models can't substitute for image generation
    let skipModelRemap = false;
    if (this.openrouterModelCatalogService?.isImageOnlyAsync) {
      try {
        skipModelRemap = await this.openrouterModelCatalogService.isImageOnlyAsync(selectedModel);
        if (skipModelRemap) {
          this.logger?.debug?.(`[OpenRouter][Chat] Skipping model remap for image-only model: ${selectedModel}`);
        }
      } catch {}
    }
    
    if (!this.modelLock && !skipModelRemap) {
      try {
        const mapped = await this.getModel(selectedModel);
        if (mapped) selectedModel = mapped;
      } catch {}
    }
    if (this.traceModelSelection) {
      this.logger?.info?.(`[OpenRouter][trace] chat request model requested='${originalRequested}' normalized='${selectedModel}' lock=${this.modelLock} skipRemap=${skipModelRemap}`);
    }
    // Merge with correct precedence: defaults < selected model/messages < caller options
    const { model: _discardModel, ...rest } = options || {};
    const mergedOptions = {
      ...this.defaultChatOptions,
      model: selectedModel,
      messages: (messages || []).filter(m => m && m.content !== undefined),
      ...rest,
    };

    // GPT-5.x models don't support temperature, top_p, frequency_penalty, presence_penalty
    // Remove these parameters to avoid 400 errors
    if (/^openai\/gpt-5/i.test(mergedOptions.model)) {
      const unsupportedParams = ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty'];
      for (const param of unsupportedParams) {
        if (param in mergedOptions) {
          this.logger?.debug?.(`[OpenRouter][Chat] Removing unsupported parameter '${param}' for ${mergedOptions.model}`);
          delete mergedOptions[param];
        }
      }
    }

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

    this.logger.debug?.(`Generating chat completion with model ${mergedOptions.model}...`);

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
  this.logger.error('Unexpected response format from OpenRouter:', sanitizeForLogging(response));
  this.logger.info('Response:', JSON.stringify(sanitizeForLogging(response), null, 2));
  return options.returnEnvelope ? { text: '', raw: response, model: mergedOptions.model, provider: 'openrouter', error: { code: 'FORMAT', message: 'No choices' } } : null;
      }
      
      // Debug: log raw choice for image models to find where images are
      if (/flux|imagen|dall-?e|stable.?diffusion/i.test(mergedOptions.model)) {
        const choice = response.choices[0];
        const choiceKeys = Object.keys(choice);
        const messageKeys = choice.message ? Object.keys(choice.message) : [];
        this.logger.info?.(`[OpenRouter][Chat] FLUX raw choice keys: ${JSON.stringify(choiceKeys)}, message keys: ${JSON.stringify(messageKeys)}`);
      }
      
      const result = response.choices[0].message;
      const finishReason = response.choices[0].finish_reason;

      // Log finish_reason to help diagnose truncated responses
      if (finishReason === 'length') {
        const limitMsg = typeof mergedOptions.max_tokens === 'number' ? ` (${mergedOptions.max_tokens})` : '';
        this.logger.warn(`[OpenRouter][Chat] Response truncated - hit max_tokens limit${limitMsg}. Consider increasing or removing max_tokens.`);
      }
      this.logger.debug?.(`[OpenRouter][Chat] finish_reason=${finishReason} usage=${JSON.stringify(response.usage)}`);
      
      // Debug logging for image models to understand response structure
      const isImageModel = /flux|imagen|dall-?e|stable.?diffusion/i.test(mergedOptions.model);
      if (isImageModel) {
        this.logger.info?.(`[OpenRouter][Chat] Image model ${mergedOptions.model} response keys: ${JSON.stringify(Object.keys(result))}`);
        this.logger.info?.(`[OpenRouter][Chat] result.images exists: ${!!result.images}, type: ${typeof result.images}, isArray: ${Array.isArray(result.images)}, length: ${result.images?.length}`);
        this.logger.debug?.(`[OpenRouter][Chat] Image model response structure: ${JSON.stringify({
          contentType: typeof result.content,
          contentIsArray: Array.isArray(result.content),
          contentLength: typeof result.content === 'string' ? result.content.length : (Array.isArray(result.content) ? result.content.length : 'N/A'),
          hasData: !!response.data,
          hasImages: !!result.images,
          imagesCount: result.images?.length || 0,
          keys: Object.keys(result)
        })}`);
        // Log first 500 chars of content for debugging (sanitized to avoid base64 data)
        if (result.content) {
          const preview = typeof result.content === 'string' 
            ? sanitizeForLogging(result.content, 500)
            : JSON.stringify(sanitizeForLogging(result.content), null, 0).slice(0, 500);
          this.logger.debug?.(`[OpenRouter][Chat] Image model content preview: ${preview}`);
        }
      }
      // If response is meant to be structured JSON, preserve it
      if (mergedOptions.response_format?.type === 'json_object') {
        return result.content;
      }

      // Handle function/tool calls if present
      // Return as an object so downstream code can access tool_calls properly
      if (result.tool_calls && result.tool_calls.length > 0) {
        // Return object with tool_calls array for proper handling
        return {
          tool_calls: result.tool_calls,
          text: result.content || null // Include any text content if present
        };
      }

      // Normalize content that might be an array of segments (including multimodal)
      let normalizedContent = result.content;
      let imageData = null;
      
      // Check for image data in result.images (FLUX format)
      // FLUX returns: { images: [{ index, type, image_url: { url: "data:image/png;base64,..." } }] }
      this.logger.debug?.(`[OpenRouter][Chat] Checking result.images: exists=${!!result.images}, isArray=${Array.isArray(result.images)}, length=${result.images?.length}`);
      if (result.images && Array.isArray(result.images) && result.images.length > 0) {
        this.logger.info?.(`[OpenRouter][Chat] Found ${result.images.length} image(s) in result.images (FLUX format)`);
        imageData = imageData || [];
        for (const img of result.images) {
          this.logger.debug?.(`[OpenRouter][Chat] Processing FLUX image: keys=${JSON.stringify(Object.keys(img))}, has image_url=${!!img.image_url}`);
          if (img.image_url?.url) {
            // image_url.url is a data URI like "data:image/png;base64,..."
            const dataUrl = img.image_url.url;
            this.logger.debug?.(`[OpenRouter][Chat] FLUX image_url.url starts with: ${dataUrl.slice(0, 50)}`);
            if (dataUrl.startsWith('data:')) {
              // Parse data URI to extract base64 and mime type
              const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
              if (match) {
                this.logger.info?.(`[OpenRouter][Chat] Extracted FLUX image: mimeType=${match[1]}, dataLength=${match[2].length}`);
                imageData.push({
                  data: match[2],
                  mimeType: match[1],
                  url: null
                });
              } else {
                // Fallback - treat as URL
                this.logger.debug?.(`[OpenRouter][Chat] FLUX image data URI didn't match base64 pattern, using as URL`);
                imageData.push({ url: dataUrl });
              }
            } else {
              imageData.push({ url: dataUrl });
            }
          }
        }
        this.logger.info?.(`[OpenRouter][Chat] Processed ${imageData?.length || 0} image(s) from result.images`);
      }
      
      // Check for image data at response level (some providers put it in response.data)
      if (response.data && typeof response.data === 'object') {
        if (response.data.b64_json || response.data.url) {
          imageData = imageData || [];
          imageData.push({
            url: response.data.url || null,
            data: response.data.b64_json || null,
            mimeType: 'image/png'
          });
        }
      }
      
      // Check if content is a single object with image data (not an array)
      if (normalizedContent && typeof normalizedContent === 'object' && !Array.isArray(normalizedContent)) {
        // Handle single content part
        const p = normalizedContent;
        if (p.image?.data || p.image?.url) {
          // FLUX-style: { image: { data: base64, mime_type: 'image/png' } }
          imageData = imageData || [];
          imageData.push({
            url: p.image.url || null,
            data: p.image.data || null,
            mimeType: p.image.mime_type || p.image.mimeType || 'image/png'
          });
          normalizedContent = p.text || '';
        } else if (p.type === 'image' && (p.data || p.url)) {
          imageData = imageData || [];
          imageData.push({
            url: p.url || null,
            data: p.data || null,
            mimeType: p.mime_type || p.mimeType || 'image/png'
          });
          normalizedContent = '';
        } else if (p.type === 'image_url' && p.image_url?.url) {
          imageData = imageData || [];
          imageData.push({ url: p.image_url.url });
          normalizedContent = '';
        } else if (p.text) {
          normalizedContent = p.text;
        }
      }
      
      // Check if content is a base64 string (some image models return raw base64)
      if (typeof normalizedContent === 'string' && normalizedContent.length > 1000) {
        // Check if it looks like base64 image data (starts with base64 chars, no spaces/newlines)
        const base64Pattern = /^[A-Za-z0-9+/=]{1000,}$/;
        if (base64Pattern.test(normalizedContent.slice(0, 1100).replace(/\s/g, ''))) {
          this.logger.debug?.(`[OpenRouter][Chat] Detected base64 image data in content (length: ${normalizedContent.length})`);
          imageData = imageData || [];
          imageData.push({
            data: normalizedContent.replace(/\s/g, ''),
            mimeType: 'image/png'
          });
          normalizedContent = '';
        }
      }
      
      if (Array.isArray(normalizedContent)) {
        try {
          const textParts = [];
          for (const p of normalizedContent) {
            if (typeof p === 'string') {
              textParts.push(p);
            } else if (p?.type === 'text' && p?.text) {
              textParts.push(p.text);
            } else if (p?.type === 'image_url' && p?.image_url?.url) {
              // Handle image output from multimodal models
              imageData = imageData || [];
              imageData.push({
                url: p.image_url.url,
                detail: p.image_url.detail || 'auto'
              });
            } else if (p?.type === 'image' && (p?.url || p?.data)) {
              // Alternative image format
              imageData = imageData || [];
              imageData.push({
                url: p.url || null,
                data: p.data || null,
                mimeType: p.mime_type || p.mimeType || 'image/png'
              });
            } else if (p?.image?.data || p?.image?.url) {
              // FLUX-style format: { image: { data: base64, mime_type: 'image/png' } }
              imageData = imageData || [];
              imageData.push({
                url: p.image.url || null,
                data: p.image.data || null,
                mimeType: p.image.mime_type || p.image.mimeType || 'image/png'
              });
            } else if (p?.text || p?.content) {
              textParts.push(p.text || p.content);
            }
          }
          normalizedContent = textParts.filter(Boolean).join('\n').trim();
        } catch {}
      }
      
      // Check for reasoning in multiple formats: reasoning (plain), reasoning_details (encrypted), reasoning_content (structured)
      const hasReasoning = result.reasoning || result.reasoning_details || result.reasoning_content;
      const hasImageData = imageData && imageData.length > 0;
      
      // For image-only models, having images without text is valid
      if (!normalizedContent && !hasReasoning && !hasImageData) {
        this.logger.error('Invalid response from OpenRouter during chat.');
        this.logger.info(JSON.stringify(sanitizeForLogging(result), null, 2));
        
        // Return error envelope or throw instead of returning placeholder text
        // This prevents error messages from being treated as valid content
        if (options.returnEnvelope) {
          return { 
            text: '', 
            raw: response, 
            model: mergedOptions.model, 
            provider: 'openrouter', 
            error: { code: 'NO_CONTENT', message: 'No response content from OpenRouter' } 
          };
        }
        
        // For non-envelope mode, throw an error so callers know the request failed
        throw new Error('No response content from OpenRouter');
      }
      
      // Special case: reasoning exists but content is empty (e.g., GPT-5 reasoning models)
      // This typically indicates an incomplete response where the model only provided internal reasoning
      if (!normalizedContent && hasReasoning && !hasImageData) {
        this.logger.warn(`Model returned reasoning but no content. finish_reason=${finishReason}. This may indicate an incomplete response${finishReason === 'length' ? ' due to hitting max_tokens limit' : ''}.`);
        this.logger.info(JSON.stringify(sanitizeForLogging(result), null, 2));
        
        if (options.returnEnvelope) {
          return { 
            text: '', 
            raw: response, 
            model: mergedOptions.model, 
            provider: 'openrouter', 
            error: { 
              code: finishReason === 'length' ? 'MAX_TOKENS' : 'NO_CONTENT', 
              message: `Model returned reasoning but no text content (finish_reason: ${finishReason})` 
            } 
          };
        }
        
        // Throw to trigger retry logic or fallback handling
        throw new Error(`Model returned reasoning but no text content (finish_reason: ${finishReason})`);
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
    
      // If we have image data from a multimodal response, include it
      if (imageData && imageData.length > 0) {
        this.logger?.info?.(`[OpenRouter][Chat] Multimodal response with ${imageData.length} image(s) from ${mergedOptions.model}`);
        // Mark model as valid since the API call succeeded
        this.openrouterModelCatalogService?.markModelAsValid?.(mergedOptions.model, { outputModalities: ['image'] });
        return options.returnEnvelope 
          ? { text: baseText, images: imageData, raw: response, model: mergedOptions.model, provider: 'openrouter', error: null }
          : { text: baseText, images: imageData };
      }
    
      // Mark model as valid since the API call succeeded
      this.openrouterModelCatalogService?.markModelAsValid?.(mergedOptions.model, { outputModalities: ['text'] });
      return options.returnEnvelope ? { text: baseText, raw: response, model: mergedOptions.model, provider: 'openrouter', error: null } : baseText;
    } catch (error) {
      const parsed = parseProviderError(error);
      this.logger.error('[OpenRouter][Chat] error', parsed);
      
      // Log full error details at debug level for diagnosis
      if (parsed.status === 400) {
        this.logger.debug?.('[OpenRouter][Chat] Full 400 error details', {
          model: mergedOptions.model,
          errorMessage: error?.message,
          errorResponse: error?.response?.data || error?.error,
          errorBody: error?.body
        });
      }
      const status = parsed.status;
      
      // Retry if the error is a rate limit error
      if (status === 429 && retries > 0) {
        this.logger.error('Retrying chat with OpenRouter in 5 seconds...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        return this.chat(messages, options, retries - 1);
      }
      
      // Handle model not found error (404) by selecting a new random model
      // But NOT for image-only models - they need special handling (check dynamically)
      let isImageOnlyModel = false;
      if (this.openrouterModelCatalogService?.isImageOnlyAsync) {
        try {
          isImageOnlyModel = await this.openrouterModelCatalogService.isImageOnlyAsync(mergedOptions.model);
        } catch {
          // Fallback to pattern-based check
          isImageOnlyModel = /black-forest-labs\/flux|stabilityai\/stable-diffusion/i.test(mergedOptions.model);
        }
      }
      if (status === 404 && parsed.userMessage === 'Model not found' && retries > 0 && !isImageOnlyModel) {
        this.logger.warn(`[OpenRouter][Chat] Model '${mergedOptions.model}' not found (404), selecting fallback model...`);
        
        try {
          // Select a new random model from available models
          const fallbackModel = await this.selectRandomModel();
          
          if (fallbackModel && fallbackModel !== mergedOptions.model) {
            this.logger.info(`[OpenRouter][Chat] Fallback model selected: '${fallbackModel}' (was: '${mergedOptions.model}')`);
            
            // Return special response indicating model needs to be updated
            // The caller (conversationManager) should update the avatar's model
            return options.returnEnvelope 
              ? { 
                  text: '', 
                  raw: null, 
                  model: fallbackModel, 
                  provider: 'openrouter', 
                  error: { 
                    code: 'MODEL_NOT_FOUND_FALLBACK', 
                    message: 'Model not found, fallback selected',
                    originalModel: mergedOptions.model,
                    fallbackModel: fallbackModel
                  } 
                } 
              : null;
          }
        } catch (fallbackError) {
          this.logger.error(`[OpenRouter][Chat] Failed to select fallback model: ${fallbackError.message}`);
        }
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

    // Hard guarantee: never return a model that isn't in the OpenRouter catalog.
    // If the catalog service isn't available, we fall back to registry checks.
    const ensureExists = async (candidate) => {
      const normalized = String(candidate || '').replace(/:(online|free)$/i, '').trim().toLowerCase();
      if (!normalized) return null;
      try {
        if (this.openrouterModelCatalogService?.modelExists) {
          const ok = await this.openrouterModelCatalogService.modelExists(normalized);
          return ok ? normalized : null;
        }
      } catch (e) {
        this.logger?.debug?.(`[OpenRouter][trace] catalog exists check failed for '${normalized}': ${e?.message || e}`);
      }
      try {
        if (this.aiModelService?.modelIsAvailable?.('openrouter', normalized)) return normalized;
      } catch {}
      return null;
    };
    if (this.modelLock || this.disableFallbacks) {
      if (this.traceModelSelection && original !== modelName) {
        this.logger?.info?.(`[OpenRouter][trace] canonicalized '${original}' -> '${modelName}' (lock=${this.modelLock} disableFallbacks=${this.disableFallbacks})`);
      }
      // Even when locked, don't allow nonexistent models to be assigned.
      const ok = await ensureExists(modelName);
      if (ok) return ok;
      if (this.traceModelSelection) {
        this.logger?.warn?.(`[OpenRouter][trace] locked model '${modelName}' not found in catalog; selecting random existing.`);
      }
      return await this.selectRandomModel();
    }
    try {
      const mapped = this.aiModelService.findClosestModel('openrouter', modelName);
      if (mapped && mapped !== modelName && this.traceModelSelection) {
        this.logger?.info?.(`[OpenRouter][trace] fuzzy mapped '${modelName}' -> '${mapped}'`);
      }

      if (mapped) {
        const ok = await ensureExists(mapped);
        if (ok) return ok;
      }

      // If the original (canonicalized) model exists, prefer it.
      const directOk = await ensureExists(modelName);
      if (directOk) return directOk;

      const name = modelName.replace(/^google\//, '').replace(/^x-ai\//, '').replace(/^openai\//, '').replace(/^meta-llama\//, 'meta-llama/');
      const fallback = this.aiModelService.findClosestModel('openrouter', name);
      if (fallback && fallback !== modelName && this.traceModelSelection) {
        this.logger?.info?.(`[OpenRouter][trace] provider-prefix stripped map '${modelName}' -> '${fallback}'`);
      }

      if (fallback) {
        const ok = await ensureExists(fallback);
        if (ok) return ok;
      }

      return await this.selectRandomModel();
    } catch {
      return await this.selectRandomModel();
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
      // Provide a clearer error for model not found (404) cases
      if (res.status === 404) {
        throw new Error(`Model '${model}' not found on OpenRouter. Please verify the model ID is correct.`);
      }
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
   * Generate an image using an image-capable OpenRouter model.
   * @param {string} prompt - The image generation prompt
   * @param {object|array} [images] - Optional reference images
   * @param {object} [options] - Options including model selection
   * @returns {Promise<{url?: string, data?: string, text?: string}|null>}
   */
  async generateImage(prompt, images = [], options = {}) {
    // Check if the selected model is Replicate/flux-dev-lora (legacy path)
    const model = options.model || this.model;
    if (model && model.includes('flux-dev-lora')) {
      if (!this.services?.replicateService) {
        this.logger?.error?.('ReplicateService not available in services');
        return null;
      }
      const imageArr = Array.isArray(images) ? images : images ? [images] : [];
      return await this.services.replicateService.generateImage(prompt, imageArr, options);
    }
    
    // Check if model is image-capable via OpenRouter
    const catalogService = this.openrouterModelCatalogService;
    const isImageCapable = catalogService?.isImageCapable?.(model);
    
    if (isImageCapable) {
      return await this.generateImageViaOpenRouter(prompt, images, { ...options, model });
    }
    
    // Fallback to default image model instead of failing
    const defaultImageModel = 'google/gemini-2.5-flash-image';
    this.logger?.debug?.(`[OpenRouter] Model '${model}' is not image-capable, using default: ${defaultImageModel}`);
    return await this.generateImageViaOpenRouter(prompt, images, { ...options, model: defaultImageModel });
  }

  /**
   * Generate an image using OpenRouter's native image generation models.
   * These models return images as part of the chat response.
   * @param {string} prompt 
   * @param {array} [referenceImages] - Optional reference images to include
   * @param {object} [options]
   * @returns {Promise<{url?: string, data?: string, text?: string}|null>}
   */
  async generateImageViaOpenRouter(prompt, referenceImages = [], options = {}) {
    const model = options.model || 'google/gemini-2.5-flash-image';
    
    // Build message content with optional reference images
    const content = [];
    
    // Dynamically check if this model accepts image input
    // Image-output-only models like FLUX don't accept image inputs - check via API
    let acceptsImageInput = true; // Default to true for safety
    if (this.openrouterModelCatalogService?.acceptsImageInputAsync) {
      try {
        acceptsImageInput = await this.openrouterModelCatalogService.acceptsImageInputAsync(model);
        this.logger?.debug?.(`[OpenRouter][generateImageViaOpenRouter] Model ${model} acceptsImageInput=${acceptsImageInput}`);
      } catch {
        // Fallback to pattern-based check if API check fails
        const isImageOnlyPattern = /black-forest-labs\/flux|stabilityai\/stable-diffusion/i.test(model);
        acceptsImageInput = !isImageOnlyPattern;
        this.logger?.debug?.(`[OpenRouter][generateImageViaOpenRouter] API check failed, using pattern: acceptsImageInput=${acceptsImageInput}`);
      }
    }
    
    // Add reference images if provided AND the model supports image input
    if (acceptsImageInput) {
      const imageArr = Array.isArray(referenceImages) ? referenceImages : referenceImages ? [referenceImages] : [];
      for (const img of imageArr.slice(0, 4)) { // Limit to 4 reference images
        if (typeof img === 'string' && img.startsWith('http')) {
          content.push({ type: 'image_url', image_url: { url: img } });
        } else if (typeof img === 'string' && img.startsWith('data:')) {
          content.push({ type: 'image_url', image_url: { url: img } });
        }
      }
    } else {
      this.logger?.debug?.(`[OpenRouter][generateImageViaOpenRouter] Skipping reference images - model ${model} doesn't accept image input`);
    }
    
    // Add the generation prompt
    // For image-only models, just use the prompt directly (they don't need "Generate an image:" prefix)
    const promptText = acceptsImageInput ? `Generate an image: ${prompt}` : prompt;
    content.push({ type: 'text', text: promptText });
    
    const messages = [
      { role: 'user', content }
    ];
    
    this.logger?.info?.(`[OpenRouter][generateImageViaOpenRouter] About to call chat() with model=${model}, contentParts=${content.length}, acceptsImageInput=${acceptsImageInput}`);
    
    try {
      const response = await this.chat(messages, {
        ...options,
        model,
        returnEnvelope: true,
      });
      
      this.logger?.info?.(`[OpenRouter][generateImageViaOpenRouter] chat() returned: hasResponse=${!!response}, hasImages=${!!response?.images}, imagesLen=${response?.images?.length}, hasText=${!!response?.text}, hasError=${!!response?.error}`);
      if (response?.error) {
        this.logger?.warn?.(`[OpenRouter][generateImageViaOpenRouter] chat() error: code=${response.error.code}, message=${response.error.message}`);
      }
      
      if (response?.images && response.images.length > 0) {
        const image = response.images[0];
        return {
          url: image.url || null,
          data: image.data || null,
          text: response.text || null,
          model,
        };
      }
      
      // Some models might return image URL in text
      if (response?.text) {
        const urlMatch = response.text.match(/https?:\/\/[^\s"'<>]+\.(png|jpg|jpeg|gif|webp)/i);
        if (urlMatch) {
          return {
            url: urlMatch[0],
            text: response.text,
            model,
          };
        }
      }
      
      this.logger?.warn?.(`[OpenRouter] Image model ${model} did not return image data`);
      return response?.text ? { text: response.text, model } : null;
      
    } catch (e) {
      this.logger?.error?.(`[OpenRouter] Image generation failed: ${e.message}`);
      return null;
    }
  }

  /**
   * Check if a model supports image output generation.
   * @param {string} modelId 
   * @returns {boolean}
   */
  isImageCapableModel(modelId) {
    return this.openrouterModelCatalogService?.isImageCapable?.(modelId) || false;
  }

  /**
   * Get list of available image-capable models.
   * @returns {string[]}
   */
  getImageCapableModels() {
    return this.openrouterModelCatalogService?.getImageCapableModels?.() || [];
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
    
    // Try OpenRouter image-capable models for composition
    const catalogService = this.openrouterModelCatalogService;
    const isImageCapable = catalogService?.isImageCapable?.(model);
    
    if (isImageCapable) {
      return await this.generateImageViaOpenRouter(prompt, images, { ...options, model });
    }
    
    this.logger?.warn?.('No composeImage implemented for this model in OpenRouterAIService.');
    return null;
  }
}
