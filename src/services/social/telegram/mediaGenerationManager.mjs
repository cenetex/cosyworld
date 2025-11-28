/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Telegram Media Generation Manager
 * Handles the complexity of generating media assets using various AI services
 * (Veo, Gemini, etc.) with fallbacks and optimizations.
 */

import { downloadImageAsBase64, inferAspectRatioFromPrompt } from './utils.mjs';

export class MediaGenerationManager {
  constructor({ logger, aiService, googleAIService, veoService, mediaGenerationService, globalBotService }) {
    this.logger = logger;
    this.aiService = aiService;
    this.googleAIService = googleAIService;
    this.veoService = veoService;
    this.mediaGenerationService = mediaGenerationService;
    this.globalBotService = globalBotService;
  }

  /**
   * Get character design configuration
   * @private
   */
  _getCharacterDesign(overrideDesign = null) {
    return overrideDesign ?? this.globalBotService?.bot?.globalBotConfig?.characterDesign;
  }

  /**
   * Apply character design prompt enhancements
   * @deprecated Use MediaGenerationService's internal handling instead
   */
  applyCharacterPrompt(prompt, overrideDesign = null) {
    const charDesign = this._getCharacterDesign(overrideDesign);
    if (!charDesign?.enabled) {
      return { prompt, charDesign };
    }

    let characterPrefix = charDesign.imagePromptPrefix || 'Show {{characterName}} ({{characterDescription}}) in this situation: ';
    characterPrefix = characterPrefix
      .replace(/\{\{characterName\}\}/g, charDesign.characterName || '')
      .replace(/\{\{characterDescription\}\}/g, charDesign.characterDescription || '');

    return { prompt: characterPrefix + prompt, charDesign };
  }

  /**
   * Generate an image asset using available services with fallback
   * @param {Object} options
   * @param {string} options.prompt - The prompt
   * @param {string} [options.conversationContext] - Context
   * @param {string} [options.userId] - User ID
   * @param {string} [options.username] - Username
   * @param {string} [options.aspectRatio='1:1'] - Aspect ratio
   * @param {string} [options.source='telegram'] - Source identifier
   * @param {boolean} [options.fetchBinary=false] - Whether to return binary data
   * @returns {Promise<{imageUrl: string, enhancedPrompt: string, binary: string|null}>}
   */
  async generateImageAsset({
    prompt,
    conversationContext = '',
    userId = null,
    username = null,
    aspectRatio = '1:1',
    source = 'telegram',
    fetchBinary = false
  }) {
    // Infer aspect ratio from prompt if not explicitly set or if set to default
    const effectiveAspectRatio = inferAspectRatioFromPrompt(prompt, aspectRatio);
    
    this.logger?.info?.('[MediaGenerationManager] Generating image asset', { 
      prompt: prompt.substring(0, 100), 
      userId, username, source, 
      effectiveAspectRatio,
      usingMediaGenerationService: !!this.mediaGenerationService
    });

    // Get character design configuration
    const charDesign = this._getCharacterDesign();

    // Primary path: Use MediaGenerationService (unified provider with retry/circuit breaker)
    if (this.mediaGenerationService) {
      try {
        // Note: MediaGenerationService handles character design application internally
        const result = await this.mediaGenerationService.generateImage(prompt, {
          characterDesign: charDesign,
          aspectRatio: effectiveAspectRatio,
          source,
          purpose: 'user_generated',
          fetchBinary
        });
        
        this.logger?.info?.('[MediaGenerationManager] MediaGenerationService image success', { 
          imageUrl: result.imageUrl?.substring(0, 50),
          aspectRatio: effectiveAspectRatio
        });
        
        return {
          imageUrl: result.imageUrl,
          enhancedPrompt: result.enhancedPrompt || prompt,
          binary: result.binary || null
        };
      } catch (err) {
        this.logger?.warn?.('[MediaGenerationManager] MediaGenerationService failed, trying fallbacks:', err.message);
        // Fall through to legacy providers
      }
    }

    // Fallback path: Try legacy providers directly (for backward compatibility)
    // Manually apply character prompt for legacy providers
    const { prompt: promptWithCharacter } = this.applyCharacterPrompt(prompt, charDesign);
    let imageUrl = null;
    let enhancedPrompt = prompt;
    const referenceImages = charDesign?.referenceImageUrl ? [charDesign.referenceImageUrl] : [];

    if (this.globalBotService?.generateImage) {
      try {
        this.logger?.debug?.('[MediaGenerationManager] Trying globalBotService.generateImage fallback');
        imageUrl = await this.globalBotService.generateImage(prompt, {
          source,
          purpose: 'user_generated',
          enhanceWithDirector: true,
          context: conversationContext,
          referenceImages,
          characterDesign: charDesign,
          aspectRatio: effectiveAspectRatio
        });
      } catch (err) {
        this.logger?.warn?.('[MediaGenerationManager] globalBotService image generation failed:', err.message);
      }
    }

    if (!imageUrl) {
      enhancedPrompt = promptWithCharacter;

      if (this.aiService?.generateImage) {
        try {
          imageUrl = await this.aiService.generateImage(enhancedPrompt, referenceImages, {
            source,
            purpose: 'user_generated',
            context: enhancedPrompt,
            aspectRatio: effectiveAspectRatio
          });
        } catch (err) {
          this.logger?.warn?.('[MediaGenerationManager] aiService image generation failed:', err.message);
        }
      }
    }

    if (!imageUrl && this.googleAIService?.generateImage) {
      try {
        // Use composition when reference images are available
        if (referenceImages.length > 0 && this.googleAIService.composeImageWithGemini) {
          const refImageData = await downloadImageAsBase64(referenceImages[0], this.logger);
          if (refImageData) {
            imageUrl = await this.googleAIService.composeImageWithGemini(
              [{ data: refImageData.data, mimeType: refImageData.mimeType, label: 'character_reference' }],
              enhancedPrompt,
              { source, purpose: 'user_generated', context: enhancedPrompt, aspectRatio: effectiveAspectRatio, characterReference: true }
            );
          }
        }
        // Fallback to regular generation if composition failed or no refs
        if (!imageUrl) {
          imageUrl = await this.googleAIService.generateImage(enhancedPrompt, effectiveAspectRatio, {
            source,
            purpose: 'user_generated',
            context: enhancedPrompt
          });
        }
      } catch (err) {
        this.logger?.warn?.('[MediaGenerationManager] googleAIService image generation failed:', err.message);
      }
    }

    if (!imageUrl) {
      throw new Error('All image generation services failed');
    }

    let binary = null;
    if (fetchBinary) {
      const result = await downloadImageAsBase64(imageUrl, this.logger);
      if (result) {
        binary = result.data; // Base64 string
      }
    }

    this.logger?.info?.('[MediaGenerationManager] Image asset ready', { imageUrl, aspectRatio: effectiveAspectRatio });
    return { imageUrl, enhancedPrompt, binary };
  }

  /**
   * Edit an existing image using AI
   * @param {Object} options
   * @returns {Promise<{imageUrl: string, enhancedPrompt: string}>}
   */
  async editImage({ prompt, imageUrl, source = 'telegram', originalPrompt = '' }) {
    const imageData = await downloadImageAsBase64(imageUrl, this.logger);
    if (!imageData) {
      throw new Error('Failed to download source image');
    }

    const { prompt: enhancedPrompt } = this.applyCharacterPrompt(prompt);
    let editedImageUrl = null;

    if (this.googleAIService?.composeImageWithGemini) {
      try {
        editedImageUrl = await this.googleAIService.composeImageWithGemini(
          [{ data: imageData.data, mimeType: imageData.mimeType, label: 'image_to_edit' }],
          enhancedPrompt,
          { source, purpose: 'user_edit', context: enhancedPrompt }
        );
      } catch (err) {
        this.logger?.warn?.('[MediaGenerationManager] Gemini image edit failed:', err.message);
      }
    }

    // Fallback: generate a new image
    if (!editedImageUrl) {
      const combinedPrompt = `Edit the following image according to these instructions: ${prompt}. Original image description: ${originalPrompt || 'No description available'}`;
      const asset = await this.generateImageAsset({
        prompt: combinedPrompt,
        source: source + '_fallback'
      });
      editedImageUrl = asset?.imageUrl;
    }

    if (!editedImageUrl) {
      throw new Error('Image editing failed');
    }

    return { imageUrl: editedImageUrl, enhancedPrompt };
  }

  /**
   * Generate a video using Veo
   * @param {Object} options
   * @param {string} options.prompt
   * @param {Object} [options.config]
   * @returns {Promise<string[]>} List of video URLs
   */
  async generateVideo({
    prompt,
    config,
    style,
    camera,
    negativePrompt,
    traceId,
    channelId,
    keyframeImage = null,
    referenceImages = []
  }) {
    const charDesign = this._getCharacterDesign();
    
    // Log character design status for debugging
    this.logger?.info?.('[MediaGenerationManager] generateVideo called', {
      hasCharacterDesign: !!charDesign?.enabled,
      characterRefUrl: charDesign?.referenceImageUrl ? 'present' : 'none',
      passedReferenceImages: referenceImages.length,
      hasKeyframe: !!keyframeImage,
      prompt: prompt?.substring(0, 80)
    });
    
    if (this.mediaGenerationService) {
      const result = await this.mediaGenerationService.generateVideo(prompt, {
        aspectRatio: config?.aspectRatio,
        durationSeconds: config?.durationSeconds,
        style,
        camera,
        negativePrompt,
        traceId,
        channelId,
        characterDesign: charDesign,
        ...(keyframeImage ? { keyframeImage } : {}),
        referenceImages
      });
      return [result.videoUrl];
    }

    // Fallback to direct Veo service
    if (!this.veoService) {
      throw new Error('Veo service not available');
    }
    
    if (keyframeImage?.url) {
      const keyframeData = await downloadImageAsBase64(keyframeImage.url, this.logger);
      if (keyframeData) {
        return await this.veoService.generateVideosFromImages({
          prompt,
          images: [{ data: keyframeData.data, mimeType: keyframeData.mimeType }],
          config: config || { aspectRatio: '9:16', numberOfVideos: 1 }
        });
      }
    }
    
    return await this.veoService.generateVideos({
      prompt,
      config: config || { aspectRatio: '9:16', numberOfVideos: 1 }
    });
  }

  /**
   * Generate a video from an image using Veo
   * @param {Object} options
   * @param {string} options.prompt
   * @param {string} options.imageUrl
   * @param {Object} [options.config]
   * @returns {Promise<string[]>} List of video URLs
   */
  async generateVideoFromImage({ prompt, imageUrl, config }) {
    if (this.mediaGenerationService) {
      const result = await this.mediaGenerationService.generateVideo(prompt, {
        keyframeImage: { url: imageUrl },
        aspectRatio: config?.aspectRatio,
        durationSeconds: config?.durationSeconds,
        characterDesign: this._getCharacterDesign()
      });
      return [result.videoUrl];
    }

    // Fallback to direct Veo service
    if (!this.veoService) {
      throw new Error('Veo service not available');
    }

    // Download image
    const imageData = await downloadImageAsBase64(imageUrl, this.logger);
    if (!imageData) {
      throw new Error('Failed to download source image');
    }

    return await this.veoService.generateVideosFromImages({
      prompt,
      images: [{ data: imageData.data, mimeType: imageData.mimeType }],
      config: config || { aspectRatio: '9:16', numberOfVideos: 1 }
    });
  }
}

export default MediaGenerationManager;
