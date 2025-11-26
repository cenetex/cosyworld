/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Media Generation Service
 * 
 * Centralized service for all media generation (images, videos).
 * Provides:
 * - Provider abstraction (Gemini, Veo, etc.)
 * - Retry with exponential backoff
 * - Circuit breaker pattern
 * - Character design consistency
 * - Reference image handling
 * 
 * @module services/media/mediaGenerationService
 */

import { 
  MediaGenerationError, 
  RateLimitError, 
  ServiceUnavailableError,
  MediaErrorCodes,
  withRetry,
  parseServiceError 
} from '../../utils/errors.mjs';

/**
 * Circuit breaker states
 */
const CircuitState = {
  CLOSED: 'CLOSED',     // Normal operation
  OPEN: 'OPEN',         // Blocking requests
  HALF_OPEN: 'HALF_OPEN' // Testing recovery
};

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  retry: {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    backoffFactor: 2
  },
  circuitBreaker: {
    failureThreshold: 5,      // Open after 5 failures
    resetTimeoutMs: 60000,    // Try again after 1 minute
    halfOpenMaxRequests: 3    // Test with 3 requests before closing
  },
  aspectRatio: '9:16',        // Default vertical format for TikTok
  video: {
    durationSeconds: 8,
    numberOfVideos: 1
  }
};

/**
 * MediaGenerationService - Unified media generation with provider abstraction
 */
export class MediaGenerationService {
  /**
   * @param {Object} deps - Service dependencies
   * @param {Object} deps.googleAIService - Google AI/Gemini service
   * @param {Object} deps.veoService - Veo video generation service
   * @param {Object} deps.aiService - General AI service (fallback)
   * @param {Object} deps.logger - Logger instance
   * @param {Object} [deps.config] - Configuration overrides
   */
  constructor({ googleAIService, veoService, aiService, logger, config = {} }) {
    this.googleAIService = googleAIService;
    this.veoService = veoService;
    this.aiService = aiService;
    this.logger = logger;
    
    // Merge config with defaults
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      retry: { ...DEFAULT_CONFIG.retry, ...config.retry },
      circuitBreaker: { ...DEFAULT_CONFIG.circuitBreaker, ...config.circuitBreaker },
      video: { ...DEFAULT_CONFIG.video, ...config.video }
    };
    
    // Circuit breaker state per provider
    this._circuitBreakers = new Map();
    
    // Service exhaustion tracking (quota limits)
    this._serviceExhausted = new Map();
    
    this.logger?.info?.('[MediaGenerationService] Initialized');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Generate an image with automatic provider selection and retry
   * @param {string} prompt - Image generation prompt
   * @param {Object} [options] - Generation options
   * @param {string[]} [options.referenceImages] - Reference image URLs for character consistency
   * @param {Object} [options.characterDesign] - Character design configuration
   * @param {string} [options.aspectRatio] - Aspect ratio (default: '9:16')
   * @param {string} [options.source] - Source identifier for tracking
   * @param {string} [options.purpose] - Purpose identifier
   * @param {boolean} [options.fetchBinary] - Whether to return binary data
   * @returns {Promise<Object>} - { imageUrl, enhancedPrompt, binary? }
   */
  async generateImage(prompt, options = {}) {
    const {
      referenceImages = [],
      characterDesign = null,
      aspectRatio = this.config.aspectRatio,
      source = 'media_service',
      purpose = 'user_generated',
      fetchBinary = false
    } = options;

    // Check if service is exhausted
    if (this._isServiceExhausted('image')) {
      const resetTime = this._serviceExhausted.get('image');
      throw RateLimitError.quotaExceeded('image', resetTime, 'all');
    }

    // Apply character design to prompt
    let enhancedPrompt = prompt;
    const refImages = [...referenceImages];
    
    if (characterDesign?.enabled) {
      enhancedPrompt = this._applyCharacterPrompt(prompt, characterDesign);
      if (characterDesign.referenceImageUrl && !refImages.includes(characterDesign.referenceImageUrl)) {
        refImages.push(characterDesign.referenceImageUrl);
      }
    }

    this.logger?.info?.('[MediaGenerationService] Generating image', {
      prompt: prompt.substring(0, 100),
      hasReferenceImages: refImages.length > 0,
      aspectRatio,
      source
    });

    // Try providers in order with retry
    const providers = this._getImageProviders();
    let lastError = null;

    for (const provider of providers) {
      if (!this._checkCircuitBreaker(provider.name)) {
        this.logger?.debug?.(`[MediaGenerationService] Skipping ${provider.name} - circuit open`);
        continue;
      }

      try {
        const imageUrl = await this._executeWithRetry(
          () => this._generateImageWithProvider(provider, enhancedPrompt, {
            referenceImages: refImages,
            aspectRatio,
            source,
            purpose
          }),
          provider.name
        );

        if (imageUrl) {
          this._recordSuccess(provider.name);
          
          let binary = null;
          if (fetchBinary) {
            binary = await this._downloadImageAsBase64(imageUrl);
          }

          return { imageUrl, enhancedPrompt, binary };
        }
      } catch (err) {
        lastError = err;
        this._recordFailure(provider.name, err);
        this.logger?.warn?.(`[MediaGenerationService] ${provider.name} failed:`, err.message);
        
        // If quota error, mark all services as exhausted
        if (err instanceof RateLimitError || this._isQuotaError(err)) {
          this._markServiceExhausted('image', 60 * 60 * 1000); // 1 hour
          throw err;
        }
      }
    }

    throw lastError || new MediaGenerationError('All image providers failed', {
      code: MediaErrorCodes.GENERATION_FAILED,
      mediaType: 'image',
      retryable: false
    });
  }

  /**
   * Generate a video with keyframe support
   * @param {string} prompt - Video generation prompt
   * @param {Object} [options] - Generation options
   * @param {Object} [options.keyframeImage] - Keyframe image { data, mimeType } or { url }
   * @param {Object[]} [options.referenceImages] - Reference images for consistency
   * @param {Object} [options.characterDesign] - Character design configuration
   * @param {string} [options.aspectRatio] - Aspect ratio (default: '9:16')
   * @param {number} [options.durationSeconds] - Video duration
   * @param {string} [options.source] - Source identifier
   * @returns {Promise<Object>} - { videoUrl, enhancedPrompt, keyframeUsed }
   */
  async generateVideo(prompt, options = {}) {
    const {
      keyframeImage = null,
      referenceImages = [],
      characterDesign = null,
      aspectRatio = this.config.aspectRatio,
      durationSeconds = this.config.video.durationSeconds,
      source = 'media_service'
    } = options;

    // Check if service is exhausted
    if (this._isServiceExhausted('video')) {
      const resetTime = this._serviceExhausted.get('video');
      throw MediaGenerationError.quotaExceeded('video', resetTime, 'veo');
    }

    if (!this.veoService) {
      throw new ServiceUnavailableError('Video generation service not available', {
        mediaType: 'video',
        provider: 'veo'
      });
    }

    // Apply character design
    let enhancedPrompt = prompt;
    if (characterDesign?.enabled) {
      enhancedPrompt = this._applyCharacterPrompt(prompt, characterDesign);
    }

    this.logger?.info?.('[MediaGenerationService] Generating video', {
      prompt: prompt.substring(0, 100),
      hasKeyframe: !!keyframeImage,
      hasReferenceImages: referenceImages.length > 0,
      aspectRatio,
      durationSeconds,
      source
    });

    const videoConfig = {
      numberOfVideos: 1,
      aspectRatio,
      durationSeconds
    };

    let videoUrls = null;
    let keyframeUsed = false;

    // Strategy 1: Use provided keyframe image
    if (keyframeImage) {
      try {
        const imageData = keyframeImage.data || await this._getImageData(keyframeImage.url);
        if (imageData) {
          videoUrls = await this._executeWithRetry(
            () => this.veoService.generateVideosFromImages({
              prompt: enhancedPrompt,
              images: [{
                data: imageData.data || imageData,
                mimeType: imageData.mimeType || 'image/png'
              }],
              config: videoConfig
            }),
            'veo-keyframe'
          );
          if (videoUrls?.length) {
            keyframeUsed = true;
          }
        }
      } catch (err) {
        this.logger?.warn?.('[MediaGenerationService] Keyframe video generation failed:', err.message);
        this._handleVideoError(err);
      }
    }

    // Strategy 2: Generate keyframe, then video
    if (!videoUrls?.length && !keyframeImage) {
      try {
        this.logger?.info?.('[MediaGenerationService] Generating keyframe for video');
        const keyframe = await this.generateImage(prompt, {
          referenceImages,
          characterDesign,
          aspectRatio,
          fetchBinary: true,
          source: `${source}.keyframe`
        });

        if (keyframe?.binary?.data) {
          videoUrls = await this._executeWithRetry(
            () => this.veoService.generateVideosFromImages({
              prompt: keyframe.enhancedPrompt || enhancedPrompt,
              images: [{
                data: keyframe.binary.data,
                mimeType: keyframe.binary.mimeType || 'image/png'
              }],
              config: videoConfig
            }),
            'veo-keyframe'
          );
          if (videoUrls?.length) {
            keyframeUsed = true;
            enhancedPrompt = keyframe.enhancedPrompt || enhancedPrompt;
          }
        }
      } catch (err) {
        this.logger?.warn?.('[MediaGenerationService] Keyframe-to-video failed:', err.message);
        this._handleVideoError(err);
      }
    }

    // Strategy 3: Use reference images for video
    if (!videoUrls?.length && (referenceImages.length > 0 || characterDesign?.referenceImageUrl)) {
      try {
        const refUrl = referenceImages[0] || characterDesign?.referenceImageUrl;
        const refData = await this._getImageData(refUrl);
        
        if (refData && this.veoService.generateVideosWithReferenceImages) {
          videoUrls = await this._executeWithRetry(
            () => this.veoService.generateVideosWithReferenceImages({
              prompt: enhancedPrompt,
              referenceImages: [{
                data: refData.data || refData,
                mimeType: refData.mimeType || 'image/png'
              }],
              config: videoConfig
            }),
            'veo-reference'
          );
        }
      } catch (err) {
        this.logger?.warn?.('[MediaGenerationService] Reference video generation failed:', err.message);
        this._handleVideoError(err);
      }
    }

    // Strategy 4: Text-to-video fallback
    if (!videoUrls?.length) {
      try {
        videoUrls = await this._executeWithRetry(
          () => this.veoService.generateVideos({
            prompt: enhancedPrompt,
            config: videoConfig
          }),
          'veo-text'
        );
      } catch (err) {
        this.logger?.error?.('[MediaGenerationService] Text-to-video failed:', err.message);
        this._handleVideoError(err);
        throw err;
      }
    }

    if (!videoUrls?.length) {
      throw new MediaGenerationError('Video generation returned no results', {
        code: MediaErrorCodes.GENERATION_FAILED,
        mediaType: 'video',
        provider: 'veo',
        retryable: false
      });
    }

    return {
      videoUrl: videoUrls[0],
      enhancedPrompt,
      keyframeUsed
    };
  }

  /**
   * Extend an existing video
   * @param {string} videoUrl - Source video URL
   * @param {string} prompt - Extension prompt
   * @param {Object} [options] - Extension options
   * @returns {Promise<Object>} - { videoUrl }
   */
  async extendVideo(videoUrl, prompt, options = {}) {
    if (!this.veoService?.extendVideo) {
      throw new ServiceUnavailableError('Video extension not available', {
        mediaType: 'video',
        provider: 'veo'
      });
    }

    const { durationSeconds = 8 } = options;

    this.logger?.info?.('[MediaGenerationService] Extending video', {
      sourceUrl: videoUrl,
      prompt: prompt.substring(0, 100),
      durationSeconds
    });

    const result = await this._executeWithRetry(
      () => this.veoService.extendVideo({
        videoUrl,
        prompt,
        config: { durationSeconds }
      }),
      'veo-extend'
    );

    return { videoUrl: result };
  }

  /**
   * Edit an image using reference
   * @param {Object} sourceImage - Source image { url } or { data, mimeType }
   * @param {string} editPrompt - Edit instructions
   * @param {Object} [options] - Edit options
   * @returns {Promise<Object>} - { imageUrl }
   */
  async editImage(sourceImage, editPrompt, options = {}) {
    const { characterDesign = null, aspectRatio = this.config.aspectRatio } = options;

    // Get source image data
    const sourceData = sourceImage.data 
      ? sourceImage 
      : await this._getImageData(sourceImage.url);

    if (!sourceData) {
      throw MediaGenerationError.mediaNotFound('source', 'image');
    }

    // Apply character design
    let enhancedPrompt = editPrompt;
    if (characterDesign?.enabled) {
      enhancedPrompt = this._applyCharacterPrompt(editPrompt, characterDesign);
    }

    this.logger?.info?.('[MediaGenerationService] Editing image', {
      prompt: editPrompt.substring(0, 100),
      hasCharacterDesign: !!characterDesign?.enabled
    });

    // Use Gemini composition for editing
    if (this.googleAIService?.composeImageWithGemini) {
      const imageUrl = await this._executeWithRetry(
        () => this.googleAIService.composeImageWithGemini(
          [{ data: sourceData.data, mimeType: sourceData.mimeType, label: 'source_image' }],
          enhancedPrompt,
          { aspectRatio }
        ),
        'gemini-edit'
      );

      if (imageUrl) {
        return { imageUrl, enhancedPrompt };
      }
    }

    throw new MediaGenerationError('Image editing not available', {
      code: MediaErrorCodes.SERVICE_UNAVAILABLE,
      mediaType: 'image',
      retryable: false
    });
  }

  /**
   * Check if a media type is currently available
   * @param {string} mediaType - 'image' or 'video'
   * @returns {boolean}
   */
  isAvailable(mediaType) {
    if (this._isServiceExhausted(mediaType)) {
      return false;
    }
    
    if (mediaType === 'video') {
      return !!this.veoService;
    }
    
    return !!(this.googleAIService || this.aiService);
  }

  /**
   * Get service status
   * @returns {Object} - Status of all providers
   */
  getStatus() {
    return {
      image: {
        available: this.isAvailable('image'),
        exhausted: this._isServiceExhausted('image'),
        exhaustedUntil: this._serviceExhausted.get('image') || null,
        providers: this._getImageProviders().map(p => ({
          name: p.name,
          circuitState: this._getCircuitState(p.name)
        }))
      },
      video: {
        available: this.isAvailable('video'),
        exhausted: this._isServiceExhausted('video'),
        exhaustedUntil: this._serviceExhausted.get('video') || null,
        circuitState: this._getCircuitState('veo')
      }
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE METHODS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get ordered list of image providers
   * @private
   */
  _getImageProviders() {
    const providers = [];
    
    if (this.googleAIService) {
      providers.push({
        name: 'gemini',
        service: this.googleAIService,
        supportsComposition: !!this.googleAIService.composeImageWithGemini
      });
    }
    
    if (this.aiService?.generateImage) {
      providers.push({
        name: 'aiService',
        service: this.aiService,
        supportsComposition: false
      });
    }
    
    return providers;
  }

  /**
   * Generate image with a specific provider
   * @private
   */
  async _generateImageWithProvider(provider, prompt, options) {
    const { referenceImages = [], aspectRatio, source, purpose } = options;

    // Use composition for reference images if supported
    if (referenceImages.length > 0 && provider.supportsComposition) {
      const refData = await this._getImageData(referenceImages[0]);
      if (refData) {
        return await provider.service.composeImageWithGemini(
          [{ data: refData.data || refData, mimeType: refData.mimeType || 'image/png', label: 'reference' }],
          prompt,
          { aspectRatio, source, purpose }
        );
      }
    }

    // Standard generation
    if (provider.name === 'gemini') {
      return await provider.service.generateImage(prompt, aspectRatio, { source, purpose });
    }
    
    return await provider.service.generateImage(prompt, referenceImages, { source, purpose });
  }

  /**
   * Execute a function with retry logic
   * @private
   */
  async _executeWithRetry(fn, providerName) {
    return await withRetry(fn, {
      ...this.config.retry,
      shouldRetry: (err) => {
        // Don't retry quota errors
        if (err instanceof RateLimitError || this._isQuotaError(err)) {
          return false;
        }
        // Don't retry content policy errors
        if (err.code === MediaErrorCodes.CONTENT_BLOCKED) {
          return false;
        }
        return err.retryable !== false;
      },
      onRetry: (err, attempt, delay) => {
        this.logger?.warn?.(`[MediaGenerationService] Retry ${attempt} for ${providerName} in ${delay}ms:`, err.message);
      }
    });
  }

  /**
   * Apply character design to prompt
   * @private
   */
  _applyCharacterPrompt(prompt, charDesign) {
    if (!charDesign?.enabled) return prompt;

    let prefix = charDesign.imagePromptPrefix || 'Show {{characterName}} ({{characterDescription}}) in this situation: ';
    prefix = prefix
      .replace(/\{\{characterName\}\}/g, charDesign.characterName || '')
      .replace(/\{\{characterDescription\}\}/g, charDesign.characterDescription || '');

    return prefix + prompt;
  }

  /**
   * Download image and convert to base64
   * @private
   */
  async _downloadImageAsBase64(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      return {
        data: buffer.toString('base64'),
        mimeType: response.headers.get('content-type') || 'image/png'
      };
    } catch (err) {
      this.logger?.error?.('[MediaGenerationService] Failed to download image:', err.message);
      return null;
    }
  }

  /**
   * Get image data from URL or existing data
   * @private
   */
  async _getImageData(urlOrData) {
    if (!urlOrData) return null;
    if (typeof urlOrData === 'object' && urlOrData.data) {
      return urlOrData;
    }
    return await this._downloadImageAsBase64(urlOrData);
  }

  /**
   * Handle video generation error
   * @private
   */
  _handleVideoError(err) {
    if (this._isQuotaError(err)) {
      this._markServiceExhausted('video', 60 * 60 * 1000);
    }
  }

  /**
   * Check if error is a quota/rate limit error
   * @private
   */
  _isQuotaError(err) {
    const message = err?.message || '';
    const status = err?.status || err?.code;
    return (
      status === 'RESOURCE_EXHAUSTED' ||
      status === 429 ||
      message.includes('quota') ||
      message.includes('RESOURCE_EXHAUSTED') ||
      message.includes('rate limit')
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CIRCUIT BREAKER
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get or create circuit breaker state for a provider
   * @private
   */
  _getCircuitBreaker(providerName) {
    if (!this._circuitBreakers.has(providerName)) {
      this._circuitBreakers.set(providerName, {
        state: CircuitState.CLOSED,
        failures: 0,
        lastFailure: null,
        halfOpenRequests: 0
      });
    }
    return this._circuitBreakers.get(providerName);
  }

  /**
   * Check if circuit breaker allows request
   * @private
   */
  _checkCircuitBreaker(providerName) {
    const breaker = this._getCircuitBreaker(providerName);
    
    if (breaker.state === CircuitState.CLOSED) {
      return true;
    }
    
    if (breaker.state === CircuitState.OPEN) {
      // Check if reset timeout has passed
      const elapsed = Date.now() - breaker.lastFailure;
      if (elapsed >= this.config.circuitBreaker.resetTimeoutMs) {
        breaker.state = CircuitState.HALF_OPEN;
        breaker.halfOpenRequests = 0;
        this.logger?.info?.(`[MediaGenerationService] Circuit half-open for ${providerName}`);
        return true;
      }
      return false;
    }
    
    // Half-open: allow limited requests
    if (breaker.halfOpenRequests < this.config.circuitBreaker.halfOpenMaxRequests) {
      breaker.halfOpenRequests++;
      return true;
    }
    
    return false;
  }

  /**
   * Get circuit state name
   * @private
   */
  _getCircuitState(providerName) {
    return this._getCircuitBreaker(providerName).state;
  }

  /**
   * Record successful request
   * @private
   */
  _recordSuccess(providerName) {
    const breaker = this._getCircuitBreaker(providerName);
    
    if (breaker.state === CircuitState.HALF_OPEN) {
      // Recovery successful
      breaker.state = CircuitState.CLOSED;
      breaker.failures = 0;
      this.logger?.info?.(`[MediaGenerationService] Circuit closed for ${providerName} - recovered`);
    } else {
      breaker.failures = 0;
    }
  }

  /**
   * Record failed request
   * @private
   */
  _recordFailure(providerName, error) {
    const breaker = this._getCircuitBreaker(providerName);
    breaker.failures++;
    breaker.lastFailure = Date.now();
    
    if (breaker.state === CircuitState.HALF_OPEN) {
      // Failed during recovery - open again
      breaker.state = CircuitState.OPEN;
      this.logger?.warn?.(`[MediaGenerationService] Circuit re-opened for ${providerName}`);
    } else if (breaker.failures >= this.config.circuitBreaker.failureThreshold) {
      breaker.state = CircuitState.OPEN;
      this.logger?.warn?.(`[MediaGenerationService] Circuit opened for ${providerName} after ${breaker.failures} failures`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SERVICE EXHAUSTION
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Check if service is exhausted (quota reached)
   * @private
   */
  _isServiceExhausted(mediaType) {
    const exhaustedUntil = this._serviceExhausted.get(mediaType);
    if (!exhaustedUntil) return false;
    
    if (Date.now() >= exhaustedUntil) {
      this._serviceExhausted.delete(mediaType);
      return false;
    }
    
    return true;
  }

  /**
   * Mark service as exhausted for a duration
   * @private
   */
  _markServiceExhausted(mediaType, durationMs) {
    const resetTime = Date.now() + durationMs;
    this._serviceExhausted.set(mediaType, resetTime);
    this.logger?.warn?.(`[MediaGenerationService] ${mediaType} service exhausted until ${new Date(resetTime).toISOString()}`);
  }
}

export default MediaGenerationService;
