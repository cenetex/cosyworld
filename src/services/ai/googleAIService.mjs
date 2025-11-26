/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleGenAI } from '@google/genai';
import modelsConfig from '../../models.google.config.mjs';
import stringSimilarity from 'string-similarity';
import fs from 'fs/promises';
import { Blob } from 'buffer';
import { parseWithRetries } from '../../utils/jsonParse.mjs';
import { CircuitBreaker } from '../../utils/circuitBreaker.mjs';

export class GoogleAIService {
  constructor({
    configService,
  s3Service,
  aiModelService,
  logger
  }) {
    
    this.configService = configService;
    this.s3Service = s3Service;
  this.aiModelService = aiModelService;
    this.logger = logger;
    
    const config = this.configService.config.ai.google;
    this.apiKey = config.apiKey || process.env.GOOGLE_API_KEY;

    if (!this.apiKey) {
      console.error(`[${new Date().toISOString()}] [FATAL] Google API Key is missing. Please configure GOOGLE_API_KEY.`);
      this.googleAI = null;
      return;
    }

    this.provider = 'google';
    this.googleAI = new GoogleGenerativeAI(this.apiKey);
    // New GenAI client for Files API and advanced features
    this.genAI = new GoogleGenAI({ apiKey: this.apiKey });
    // File cache: hash -> { uri, mimeType, expiry }
    this._fileCache = new Map();
    this.FILE_CACHE_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours (Gemini files expire after 48h)
    this.model = config.defaultModel || 'gemini-2.0-flash-001';
    this.structured_model = config.structuredModel || this.model;
    this.rawModels = modelsConfig.rawModels;
    
    // Initialize circuit breaker for Google AI API
    this.circuitBreaker = new CircuitBreaker({
      name: 'GoogleAI',
      failureThreshold: 5,
      successThreshold: 2,
      resetTimeout: 60000, // 1 minute
      logger: this.logger,
      onStateChange: (newState, oldState) => {
        this.logger?.info?.(`[GoogleAI] Circuit breaker: ${oldState} → ${newState}`);
      }
    });

    // Default options for chat and completion
    this.defaultCompletionOptions = {
      temperature: 0.9,
  maxOutputTokens: 2000,
      topP: 0.95,
      topK: 40
    };

    this.defaultChatOptions = {
      model: this.model,
      temperature: 0.7,
  maxOutputTokens: 2000,
      topP: 0.95,
      topK: 40
    };

    this.defaultVisionOptions = {
      model: config.visionModel || 'gemini-2.5-flash',
      temperature: 0.5,
  maxOutputTokens: 400,
    };

    console.log(`[${new Date().toISOString()}] Initialized GoogleAIService with default model: ${this.model}`);
  }

  // Normalize a model id for Google SDK calls (expects bare id like "gemini-2.5-flash")
  _toApiModelId(modelId) {
    if (!modelId) return modelId;
    const id = modelId.replace(/:online$/, '').trim();
    return id.startsWith('models/') ? id.slice('models/'.length) : id;
  }

  // Normalize a model id to registry form (with 'models/' prefix) for availability checks
  _toRegistryModelId(modelId) {
    if (!modelId) return modelId;
    const id = modelId.replace(/:online$/, '').trim();
    return id.startsWith('models/') ? id : `models/${id}`;
  }

  async registerSupportedModels() {
    if (!this.rawModels || this.rawModels.length === 0) {
      console.warn('[GoogleAIService] No raw models available to register.');
      return;
    }

    const supportedModels = this.rawModels.filter(model => {
      const methods = model.supportedGenerationMethods || [];
      return methods.includes('generateContent') || methods.includes('bidiGenerateContent');
    }).map(model => ({
      model: model.name.replace('models/', ''),
      rarity: this.assignRarity(model.name),
      capabilities: model.supportedGenerationMethods,
    }));

    if (supportedModels.length === 0) {
      console.warn('[GoogleAIService] No models with required capabilities found.');
      return;
    }

    if (this.aiModelService?.registerModels) {
      this.aiModelService.registerModels('googleAI', supportedModels);
    } else {
      console.warn('[GoogleAIService] aiModelService not available, skipping model registration.');
    }

    console.info(`[GoogleAIService] Registered ${supportedModels.length} models with aiModelService.`);
  }

  assignRarity(modelName) {
    if (modelName.includes('pro')) return 'legendary';
    if (modelName.includes('flash')) return 'uncommon';
    return 'common';
  }

  async initialize() {
    await this.registerSupportedModels();
  }

  schemaToPromptInstructions(schema) {
    const props = schema.properties || {};
    const required = new Set(schema.required || []);
  
    const fields = Object.entries(props).map(([key, def]) => {
      const type = def.type || 'string';
      const req = required.has(key) ? '(required)' : '(optional)';
      const enumValues = def.enum ? ` Possible values: ${def.enum.join(', ')}.` : '';
      return `- ${key}: ${type} ${req}.${enumValues}`;
    }).join('\n');
  
    const jsonExample = JSON.stringify(
      Object.fromEntries(
        Object.keys(props).map(k => [k, '...'])
      ),
      null,
      2
    );
  
    return `
  Respond only with a valid JSON object (no commentary).
  The object must match this structure:
  
  ${jsonExample}
  
  Field definitions:
  ${fields}
    `.trim();
  }

  sanitizeSchema(schema) {
    if (!schema || typeof schema !== 'object') return schema;

    const clone = Array.isArray(schema) ? [] : {};
    for (const key in schema) {
      if (key === 'additionalProperties' || key === 'const') continue;

      const value = schema[key];
      if (typeof value === 'object' && value !== null) {
        clone[key] = this.sanitizeSchema(value);
      } else {
        clone[key] = value;
      }
    }

    // Determine if this is a schema definition (not a nested property)
    const isSchemaDef =
      ('properties' in schema || 'items' in schema || 'enum' in schema || 'anyOf' in schema || 'oneOf' in schema || Array.isArray(schema));

    if (!clone.type && isSchemaDef) {
      if (Array.isArray(clone)) clone.type = 'array';
      else clone.type = 'object';
    }

    // Convert OpenAI-style nullable types to Vertex AI compatible
    if (Array.isArray(schema.type) && schema.type.includes('null')) {
      const nonNullTypes = schema.type.filter(t => t !== 'null');
      if (nonNullTypes.length === 1) {
        clone.type = nonNullTypes[0];
        clone.nullable = true;
      } else if (nonNullTypes.length === 0) {
        clone.type = 'string';
        clone.nullable = true;
      } else {
        clone.type = nonNullTypes[0];
        clone.nullable = true;
      }
    }

    return clone;
  }

  // Removed legacy tryParseGeminiJSONResponse in favor of shared jsonParse utilities
  
  async generateStructuredOutput({ prompt, schema, options = {} }) {
    const started = Date.now();
    const actualSchema = schema?.schema || schema;
    const sanitizedSchema = this.sanitizeSchema(actualSchema);
    (function addOrdering(obj){
      if (!obj || typeof obj !== 'object') return;
      if (obj.type === 'object' && obj.properties && !obj.propertyOrdering) obj.propertyOrdering = Object.keys(obj.properties);
      if (obj.properties) Object.values(obj.properties).forEach(addOrdering);
      if (obj.items) addOrdering(obj.items);
    })(sanitizedSchema);
    const schemaInstructions = this.schemaToPromptInstructions(actualSchema);
    const fullPrompt = `${schemaInstructions}\n\n${prompt.trim()}`;
    try {
      const data = await parseWithRetries(() => this.generateCompletion(fullPrompt, {
        ...this.defaultCompletionOptions,
        ...options,
        model: this.structured_model,
        responseMimeType: 'application/json',
        responseSchema: sanitizedSchema,
      }), { retries: 2, backoffMs: 600 });
      return data;
    } catch (e) {
      this.logger?.warn?.(`[GoogleAIService] structured output parse failed after retries in ${Date.now()-started}ms: ${e.message}`);
      throw e;
    }
  }

  async generateCompletion(prompt, options = {}) {
    if (!this.googleAI) throw new Error("Google AI client not initialized.");

    let modelId = options.model || this.model;
    // If provided model isn't in our registry, fallback to a known good model
    if (!this.modelIsAvailable(modelId)) {
      console.warn(`[GoogleAIService] Model "${modelId}" not in registry, selecting fallback.`);
      modelId = await this.selectRandomModel();
    }

  const { model: _model, thinkingConfig, systemInstruction, ...restOptions } = options;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const gen = this.googleAI.getGenerativeModel({ model: this._toApiModelId(modelId), ...(systemInstruction ? { systemInstruction } : {}) });
        const result = await gen.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              ...this.defaultCompletionOptions,
              ...restOptions,
              ...(thinkingConfig ? { thinkingConfig } : {}),
            },
          });
          const text = result.response.text();
          return options.returnEnvelope ? { text, raw: result, model: modelId, provider: 'google', error: null } : text;
      } catch (error) {
        const retryInfo = this._parseRetryDelay(error);
        if (retryInfo.shouldRetry && attempt < 2) {
          console.warn(`[GoogleAIService] Quota exceeded, retrying after ${retryInfo.delayMs}ms (attempt ${attempt + 1})`);
          await new Promise(res => setTimeout(res, retryInfo.delayMs));
          continue;
        }
        if (retryInfo.isQuotaError) {
          console.warn(`[GoogleAIService] Quota exceeded: ${error.message}`);
            return options.returnEnvelope ? { text: null, raw: null, model: modelId, provider: 'google', error: { code: 'QUOTA', message: 'Google AI quota exceeded. Please try again later.' } } : null;
        }
        console.error(`[${new Date().toISOString()}] Completion error:`, error.message);
        throw error;
      }
    }
  }

  async chat(history, options = {}) {
    if (!this.googleAI) throw new Error("Google AI client not initialized.");
  
    if (!Array.isArray(history) || history.length === 0) {
      throw new Error("History must be a non-empty array.");
    }
  
    const normalizedHistory = history.map(msg => ({
      ...msg,
      role: msg.role === 'assistant' ? 'model' : msg.role
    }));
  
    const lastMessage = normalizedHistory[normalizedHistory.length - 1];
    if (lastMessage.role !== 'user') {
      throw new Error("The last message in history must have the role 'user'.");
    }
  
  const systemMessages = normalizedHistory.filter(msg => msg.role === 'system');
  const computedSystemInstruction = systemMessages.map(msg => msg.content).join('\n');
  
    let chatHistory = normalizedHistory
      .slice(0, -1)
      .filter(msg => msg.role !== 'system');
  
    if (chatHistory.length === 0 || chatHistory[0].role !== 'user') {
      console.warn("Inserting dummy user message to satisfy Google chat constraints.");
      chatHistory.unshift({
        role: 'user',
        content: 'Hi.'
      });
    }
  
    const formattedHistory = chatHistory.map(msg => ({
      role: msg.role,
      parts: [{ text: msg.content }]
    }));
  
  let modelId = options.model || this.model;
  if (!this.modelIsAvailable(modelId)) {
      console.warn(`Model "${modelId}" not available, selecting fallback.`);
      modelId = await this.selectRandomModel();
    }
  
    const { thinkingConfig, systemInstruction: userSystemInstruction } = options;
  const generativeModel = this.googleAI.getGenerativeModel({ model: this._toApiModelId(modelId) });
  
    const generationConfig = {
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: options.maxOutputTokens ?? 3000,
      topP: options.topP ?? 0.95,
      topK: options.topK ?? 40,
      responseMimeType: options.schema ? 'application/json' : 'text/plain',
      ...(options.schema && { responseSchema: options.schema }),
        ...(thinkingConfig ? { thinkingConfig } : {}),
    };
  
    const chatSession = generativeModel.startChat({
      history: formattedHistory,
      generationConfig,
        ...((userSystemInstruction || computedSystemInstruction) && {
          systemInstruction: {
            role: 'system',
            parts: [{ text: userSystemInstruction || computedSystemInstruction }]
          }
        })
    });
  
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // Wrap Google AI API call with circuit breaker
        const result = await this.circuitBreaker.execute(async () => {
          return await chatSession.sendMessage([{ text: lastMessage.content }]);
        });
        
          return options.returnEnvelope ? { text: result.response.text(), raw: result, model: modelId, provider: 'google', error: null } : result.response.text();
      } catch (error) {
        // Check if error is from circuit breaker
        if (error.message?.includes('Circuit breaker OPEN')) {
          this.logger?.warn?.('[GoogleAIService] Circuit breaker is open, skipping retry');
          return options.returnEnvelope ? { 
            text: null, 
            raw: null, 
            model: modelId, 
            provider: 'google', 
            error: { code: 'CIRCUIT_OPEN', message: error.message } 
          } : null;
        }
        
        const retryInfo = this._parseRetryDelay(error);
        if (retryInfo.shouldRetry && attempt < 2) {
          console.warn(`[GoogleAIService] Quota exceeded during chat, retrying after ${retryInfo.delayMs}ms (attempt ${attempt + 1})`);
          await new Promise(res => setTimeout(res, retryInfo.delayMs));
          continue;
        }
        if (retryInfo.isQuotaError) {
          console.warn(`[GoogleAIService] Quota exceeded during chat: ${error.message}`);
            return options.returnEnvelope ? { text: null, raw: null, model: modelId, provider: 'google', error: { code: 'QUOTA', message: 'Google AI quota exceeded. Please try again later.' } } : null;
        }
        console.error(`[${new Date().toISOString()}] Google AI service error:`, error.message);
          return options.returnEnvelope ? { text: null, raw: null, model: modelId, provider: 'google', error: { code: 'CHAT_ERROR', message: error.message } } : null;
      }
    }
  }

  _parseRetryDelay(error) {
    let retryDelaySec = 0;
    let isQuotaError = false;
    let shouldRetry = false;

    try {
      const match = error.message.match(/"retryDelay":"(\d+)(s|m)"/);
      if (match) {
        const value = parseInt(match[1], 10);
        const unit = match[2];
        retryDelaySec = unit === 'm' ? value * 60 : value;
        shouldRetry = true;
      }
      if (error.message.includes('429') && error.message.includes('quota')) {
        isQuotaError = true;
      }
    } catch {}

    return {
      delayMs: retryDelaySec * 1000 || 5000, // default 5s if not found
      isQuotaError,
      shouldRetry
    };
  }

  async selectRandomModel() {
  if (!this.rawModels || !Array.isArray(this.rawModels)) {
      console.warn('[GoogleAIService] rawModels is not initialized or is not an array.');
      return this.model; // Fallback to default model
    }
  // Prefer models that support generateContent (text/vision)
  const candidates = this.rawModels.filter(m => (m.supportedGenerationMethods || []).includes('generateContent'));
  const list = candidates.length ? candidates : this.rawModels;
  const randomIndex = Math.floor(Math.random() * list.length);
  // Return API id (strip 'models/' prefix)
  return this._toApiModelId(list[randomIndex].name);
  }

  modelIsAvailable(model) {
    if (!this.rawModels || !Array.isArray(this.rawModels)) {
      console.warn('[GoogleAIService] rawModels is not initialized or is not an array.');
      return false;
    }

    if (!model) return false;
  const target = this._toRegistryModelId(model);
  return this.rawModels.some(m => m.name === target);
  }
  
  async getModel(modelName) {
    if (!modelName) {
      console.warn('No model name provided for retrieval.');
      return await this.selectRandomModel();
    }

    modelName = modelName.replace(/:online$/, '').trim();
    // Use this.rawModels to get model names
    const modelNames = (this.rawModels || []).map(model => model.name.replace('models/', ''));

    if (modelNames.includes(modelName)) {
      return modelName;
    }

    const { bestMatch } = stringSimilarity.findBestMatch(modelName, modelNames);

    if (bestMatch.rating > 0.5) {
      console.info(`Fuzzy match found: "${modelName}" -> "${bestMatch.target}" (score: ${bestMatch.rating})`);
      return bestMatch.target;
    }

    console.warn(`No close match found for model: "${modelName}", defaulting to random model.`);
    return await this.selectRandomModel();
  }

  filterModelsByCapabilities(requiredCapabilities = ['text']) {
    return this.rawModels.filter(model => {
      const capabilities = model.supportedGenerationMethods || [];
      return requiredCapabilities.every(cap => capabilities.includes(cap));
    });
  }

  async getFilteredModel(requiredCapabilities = ['text']) {
    const filteredModels = this.filterModelsByCapabilities(requiredCapabilities);
    if (filteredModels.length > 0) {
      return filteredModels[0].name.replace('models/', '');
    }
    console.warn('No models found matching required capabilities. Falling back to default model.');
    return this.model;
  }

  /**
   * Main implementation for image generation (was generateImage).
   * @private
   */
  async _generateImageImpl(prompt, avatar = null, location = null, items = [], options = {}) {
    if (!this.googleAI) throw new Error("Google AI client not initialized.");
    if (!this.s3Service) throw new Error("s3Service not initialized.");

    // Extract purpose for upload metadata
    const uploadPurpose = options.purpose || 'general';
    
    // Build rich upload options for social media context
    const uploadOptions = { 
      purpose: uploadPurpose, 
      source: options.source || 'scene.camera',
      prompt: prompt,
    };
    
    // Add avatar context if provided
    if (avatar) {
      uploadOptions.avatarId = String(avatar._id || avatar.id || '');
      uploadOptions.avatarName = avatar.name || null;
      uploadOptions.avatarEmoji = avatar.emoji || null;
      uploadOptions.context = `${avatar.name || 'An avatar'} ${avatar.emoji || ''} ${prompt}`.trim();
    }
    
    // Add location context if provided
    if (location) {
      uploadOptions.locationName = location.name || null;
      uploadOptions.locationDescription = location.description || null;
      if (!uploadOptions.context) {
        uploadOptions.context = `At ${location.name || 'a location'}: ${prompt}`.trim();
      } else {
        uploadOptions.context = `${uploadOptions.context} at ${location.name}`.trim();
      }
    }
    
    // Add guild context if provided
    if (options.guildId) {
      uploadOptions.guildId = options.guildId;
    }

    // Remove metadata fields from options (not for generation config)
    let aspectRatio;
    if (options && options.aspectRatio) {
      aspectRatio = options.aspectRatio;
      delete options.aspectRatio;
    }
    // Remove all metadata fields that are for S3/upload only
    delete options.purpose;
    delete options.source;
    delete options.context;
    delete options.avatarId;
    delete options.avatarName;
    delete options.avatarEmoji;
    delete options.locationName;
    delete options.locationDescription;
    delete options.guildId;

    let fullPrompt = prompt ? prompt.trim() : '';
    // Note: aspectRatio is now handled in imageConfig, not prompt
    if (avatar) {
      fullPrompt += `\nSubject: ${avatar.name || ''} ${avatar.emoji || ''}. Description: ${avatar.description || ''}`;
    }
    if (location) {
      fullPrompt += `\nLocation: ${location.name || ''}. Description: ${location.description || ''}`;
    }
    if (items && items.length > 0) {
      const itemList = items.map(item => `${item.name || ''}: ${item.description || ''}`).join('; ');
      fullPrompt += `\nItems held: ${itemList}`;
    }

    // Retry logic: up to 3 attempts, making the prompt more explicit each time
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      let attemptPrompt = fullPrompt;
      if (attempt > 0) {
        attemptPrompt += `\nOnly respond with an image. Do not include any text. If you cannot generate an image, try again.`;
      } else {
        attemptPrompt += `\nOnly respond with an image.`;
      }
      try {
        const generativeModel = this.googleAI.getGenerativeModel({ model: 'gemini-3-pro-image-preview' });
        // Only include supported options for image generation
        const { temperature, maxOutputTokens, topP, topK } = { ...this.defaultCompletionOptions, ...options };
        const generationConfig = { 
          temperature, 
          maxOutputTokens, 
          topP, 
          topK, 
          ...options,
          responseModalities: ['text', 'image'],
        };
        
        // Add imageConfig if aspectRatio is present
        if (aspectRatio) {
          generationConfig.imageConfig = {
            aspectRatio: aspectRatio
          };
        }

        // Remove penalty fields if present (always for image models)
        delete generationConfig.frequencyPenalty;
        delete generationConfig.presencePenalty;
        
        const response = await generativeModel.generateContent({
          contents: [{ role: 'user', parts: [{ text: attemptPrompt }] }],
          generationConfig,
        });
        // Find the first image part
        for (const part of response.response.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData) {
            // Save base64 image to temp file
            const buffer = Buffer.from(part.inlineData.data, 'base64');
            await fs.mkdir('./images', { recursive: true });
            const tempFile = `./images/gemini_${Date.now()}_${Math.floor(Math.random()*10000)}.png`;
            await fs.writeFile(tempFile, buffer);
            const s3url = await this.s3Service.uploadImage(tempFile, uploadOptions);
            await fs.unlink(tempFile);
            return s3url;
          }
        }
        // If no image, try again
        lastError = new Error('No image generated');
      } catch (err) {
        lastError = err;
        this.logger?.warn(`[GoogleAIService] Gemini image generation attempt ${attempt+1} failed: ${err.message}`);
      }
    }
    this.logger?.error(`[GoogleAIService] Gemini image generation failed after retries: ${lastError?.message}`);
    throw lastError || new Error('Image generation failed');
  }

  /**
   * Overload to match SchemaService: generateImage(prompt, aspectRatio)
   * Calls the main implementation with aspectRatio mapped to options.
   * @param {string} prompt
   * @param {string} [aspectRatio]
   * @param {object} [options] - Additional options like purpose
   * @returns {Promise<string|Array<string>>}
   */
  async generateImage(prompt, aspectRatio, options = {}) {
    // If aspectRatio is not provided, call the main method as usual
    if (aspectRatio === undefined) {
      return await this._generateImageImpl(prompt);
    }
    // Map aspectRatio to options and call the main method
    return await this._generateImageImpl(prompt, null, null, [], { ...options, aspectRatio });
  }

  /**
   * Full-featured generateImage for avatar/location/items/options.
   * @param {string} prompt
   * @param {object} [avatar]
   * @param {object} [location]
   * @param {Array<object>} [items]
   * @param {object} [options]
   * @returns {Promise<string|Array<string>>}
   */
  async generateImageFull(prompt, avatar = null, location = null, items = [], options = {}) {
    return await this._generateImageImpl(prompt, avatar, location, items, options);
  }

  /**
   * Generate a composed image from up to 14 images (avatar, location, item) using Gemini's image editing.
   * @param {object[]} images - Array of { data: base64, mimeType: string, label: string } (max 14).
   * @param {string} prompt - Text prompt describing the desired composition.
   * @param {object} [options] - Optional config (model, etc).
   * @returns {Promise<string|null>} - base64 image string or null.
   */
  async composeImageWithGemini(images, prompt, options = {}) {
    if (!this.googleAI) throw new Error("Google AI client not initialized.");
    if (!this.s3Service) throw new Error("s3Service not initialized.");
    if (!Array.isArray(images) || images.length === 0) throw new Error("At least one image is required");
    if (images.length > 14) images = images.slice(0, 14); // Limit to 14 images
    
    // Extract purpose for upload metadata and remove from generation config
    const uploadPurpose = options.purpose || 'general';
    
    // Build rich upload options for social media context
    const uploadOptions = { 
      purpose: uploadPurpose, 
      source: options.source || 'scene.camera',
      prompt: prompt,
      context: options.context || prompt,
    };
    
    // Pass through any avatar/location metadata from options
    if (options.avatarId) uploadOptions.avatarId = options.avatarId;
    if (options.avatarName) uploadOptions.avatarName = options.avatarName;
    if (options.avatarEmoji) uploadOptions.avatarEmoji = options.avatarEmoji;
    if (options.locationName) uploadOptions.locationName = options.locationName;
    if (options.locationDescription) uploadOptions.locationDescription = options.locationDescription;
    if (options.guildId) uploadOptions.guildId = options.guildId;
    
    // Extract model and purpose before passing to generation config
    const { 
      purpose: _purpose, 
      model, 
      avatarId: _avatarId, 
      avatarName: _avatarName, 
      avatarEmoji: _avatarEmoji, 
      locationName: _locationName, 
      locationDescription: _locationDescription, 
      guildId: _guildId, 
      context: _context, 
      source: _source,
      prompt: _prompt, // Remove prompt from options if present
      aspectRatio,
      characterReference, // Flag to indicate character reference mode
      ...genOptions 
    } = options;
    
    // Build a single content object with role 'user' and a parts array
    const parts = [];
    
    // Check if any images are labeled as character references
    const hasCharacterRef = images.some(img => 
      img.label === 'character_reference' || img.label === 'reference'
    ) || characterReference;
    
    // Add reference instruction if we have character references
    if (hasCharacterRef) {
      parts.push({ 
        text: `IMPORTANT: The attached image(s) show the character's appearance that MUST be maintained in the generated image. Study the character's face, body shape, clothing, colors, and distinctive features carefully. The generated image must depict this EXACT same character with consistent visual identity.\n\n` 
      });
    }
    
    // Add images with labels
    for (const img of images) {
      if (img.label) {
        parts.push({ text: `[${img.label.toUpperCase()}]:` });
      }
      parts.push({
        inline_data: {
          mime_type: img.mimeType || 'image/png',
          data: img.data,
        }
      });
    }
    
    // Add the main prompt with character consistency reminder if needed
    if (hasCharacterRef) {
      parts.push({ 
        text: `\n\nNow generate a new image following this prompt while maintaining EXACT character consistency with the reference image above:\n\n${prompt}` 
      });
    } else {
      parts.push({ text: prompt });
    }
    
    const contents = [{ role: 'user', parts }];

    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const generativeModel = this.googleAI.getGenerativeModel({ model: model || 'gemini-3-pro-image-preview' });
        // Remove penalty fields and other unsupported fields (always for image models)
        // Only include valid generation config fields
        const validConfigFields = ['temperature', 'maxOutputTokens', 'topP', 'topK', 'responseModalities', 'candidateCount', 'stopSequences'];
        const generationConfig = {
          ...Object.fromEntries(
            Object.entries({ ...this.defaultCompletionOptions, ...genOptions })
              .filter(([key]) => validConfigFields.includes(key))
          ),
          responseModalities: ['text', 'image']
        };
        
        if (aspectRatio) {
            generationConfig.imageConfig = { aspectRatio };
        }

        const response = await generativeModel.generateContent({
          contents: contents,
          generationConfig,
        });
        for (const part of response.response.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData) {
            const buffer = Buffer.from(part.inlineData.data, 'base64');
            await fs.mkdir('./images', { recursive: true });
            const tempFile = `./images/gemini_compose_${Date.now()}_${Math.floor(Math.random()*10000)}.png`;
            await fs.writeFile(tempFile, buffer);
            const s3url = await this.s3Service.uploadImage(tempFile, uploadOptions);
            await fs.unlink(tempFile);
            return s3url;
          }
        }
        lastError = new Error('No image generated');
      } catch (err) {
        lastError = err;
        this.logger?.warn(`[GoogleAIService] Gemini compose image attempt ${attempt+1} failed: ${err.message}`);
      }
    }
    this.logger?.error(`[GoogleAIService] Gemini compose image failed after retries: ${lastError?.message}`);
    throw lastError || new Error('Image composition failed');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Gemini Files API
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Compute a simple hash for cache key from buffer content
   * @private
   */
  _computeBufferHash(buffer) {
    if (!buffer) return null;
    // Simple FNV-1a hash for speed (not cryptographic)
    let hash = 2166136261;
    for (let i = 0; i < Math.min(buffer.length, 8192); i++) {
      hash ^= buffer[i];
      hash = (hash * 16777619) >>> 0;
    }
    return `${hash.toString(16)}_${buffer.length}`;
  }

  /**
   * Upload a file to Gemini Files API for reuse across requests
   * @param {Buffer|string} data - File data as Buffer or base64 string
   * @param {string} mimeType - MIME type of the file
   * @param {Object} [options] - Optional configuration
   * @param {string} [options.displayName] - Display name for the file
   * @param {boolean} [options.skipCache] - Skip cache lookup/storage
   * @returns {Promise<{ uri: string, mimeType: string, name: string }>}
   */
  async uploadFile(data, mimeType, options = {}) {
    if (!this.genAI) {
      throw new Error('GoogleGenAI client not initialized');
    }

    // Convert base64 to buffer if needed
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'base64');
    const hash = this._computeBufferHash(buffer);

    // Check cache first
    if (!options.skipCache && hash) {
      const cached = this._fileCache.get(hash);
      if (cached && Date.now() < cached.expiry) {
        this.logger?.debug?.(`[GoogleAIService] File cache hit: ${hash}`);
        return { uri: cached.uri, mimeType: cached.mimeType, name: cached.name };
      }
      // Clean up expired entry
      if (cached) {
        this._fileCache.delete(hash);
      }
    }

    try {
      // Upload via Files API
      const uploadResult = await this.genAI.files.upload({
        file: new Blob([buffer], { type: mimeType }),
        config: {
          mimeType,
          displayName: options.displayName || `upload_${Date.now()}`
        }
      });

      const result = {
        uri: uploadResult.uri,
        mimeType: uploadResult.mimeType || mimeType,
        name: uploadResult.name
      };

      // Cache the result
      if (!options.skipCache && hash) {
        this._fileCache.set(hash, {
          ...result,
          expiry: Date.now() + this.FILE_CACHE_TTL_MS
        });
        this.logger?.debug?.(`[GoogleAIService] File cached: ${hash} -> ${result.uri}`);
      }

      this.logger?.info?.(`[GoogleAIService] Uploaded file to Gemini: ${result.name}`);
      return result;
    } catch (err) {
      this.logger?.error?.(`[GoogleAIService] File upload failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Get file info from Gemini Files API
   * @param {string} name - File name (from upload response)
   * @returns {Promise<Object>}
   */
  async getFile(name) {
    if (!this.genAI) {
      throw new Error('GoogleGenAI client not initialized');
    }
    try {
      return await this.genAI.files.get({ name });
    } catch (err) {
      this.logger?.warn?.(`[GoogleAIService] getFile failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Delete a file from Gemini Files API
   * @param {string} name - File name to delete
   * @returns {Promise<void>}
   */
  async deleteFile(name) {
    if (!this.genAI) {
      throw new Error('GoogleGenAI client not initialized');
    }
    try {
      await this.genAI.files.delete({ name });
      // Remove from cache if present
      for (const [hash, entry] of this._fileCache.entries()) {
        if (entry.name === name) {
          this._fileCache.delete(hash);
          break;
        }
      }
      this.logger?.info?.(`[GoogleAIService] Deleted file: ${name}`);
    } catch (err) {
      this.logger?.warn?.(`[GoogleAIService] deleteFile failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Prune expired entries from file cache
   */
  pruneFileCache() {
    const now = Date.now();
    let pruned = 0;
    for (const [hash, entry] of this._fileCache.entries()) {
      if (now >= entry.expiry) {
        this._fileCache.delete(hash);
        pruned++;
      }
    }
    if (pruned > 0) {
      this.logger?.debug?.(`[GoogleAIService] Pruned ${pruned} expired file cache entries`);
    }
    return pruned;
  }

  /**
   * Get file cache statistics
   * @returns {{ size: number, validEntries: number }}
   */
  getFileCacheStats() {
    const now = Date.now();
    let valid = 0;
    for (const entry of this._fileCache.values()) {
      if (now < entry.expiry) valid++;
    }
    return { size: this._fileCache.size, validEntries: valid };
  }
}