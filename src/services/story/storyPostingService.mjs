/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * StoryPostingService
 * 
 * Handles posting of story beats to social platforms (Telegram, X).
 * Integrates with media generation services and manages the full posting workflow.
 */
export class StoryPostingService {
  constructor({ 
    telegramService,
    xService,
    googleAIService,
    aiService,
    veoService,
    narrativeGeneratorService,
    storyStateService,
    worldContextService,
    s3Service,
    eventBus,
    logger 
  }) {
    this.telegram = telegramService;
    this.x = xService;
    this.googleAI = googleAIService;
    this.aiService = aiService;
    this.veo = veoService;
    this.narrativeGenerator = narrativeGeneratorService;
    this.storyState = storyStateService;
    this.worldContext = worldContextService;
    this.s3Service = s3Service;
    this.eventBus = eventBus;
    this.logger = logger || console;
  }

  /**
   * Post a story beat to social platforms
   * @param {Object} arc - Story arc
   * @param {Object} beat - Story beat to post
   * @returns {Promise<Object>} Posting result
   */
  async postBeat(arc, beat) {
    try {
      this.logger.info(`[StoryPosting] Posting beat ${beat.sequenceNumber} for arc "${arc.title}"`);
      
      // Generate media based on visual prompt
      const mediaUrl = await this._generateMedia(beat, arc);
      
      if (!mediaUrl) {
        this.logger.error('[StoryPosting] Failed to generate media');
        return { success: false, error: 'Media generation failed' };
      }
      
      // Generate caption
      const caption = await this.narrativeGenerator.generateCaption(beat, arc, mediaUrl);
      
      // Post to social platforms
      const posts = await this._postToSocial(mediaUrl, caption, arc, beat);
      
      // Update beat with media URL and post IDs using beat ID for reliable identification
      // Find the beat index by ID (preferred) or fall back to sequenceNumber for old beats
      const beatIndex = beat.id 
        ? arc.beats.findIndex(b => b.id === beat.id)
        : beat.sequenceNumber - 1;
      
      if (beatIndex === -1) {
        this.logger.error(`[StoryPosting] Could not find beat with ID ${beat.id} in arc`);
        throw new Error('Beat not found in arc');
      }
      
      await this.storyState.updateArc(arc._id, {
        [`beats.${beatIndex}.generatedImageUrl`]: mediaUrl,
        [`beats.${beatIndex}.caption`]: caption,
        [`beats.${beatIndex}.socialPosts`]: posts
      });
      
      // Emit event
      this.eventBus.emit('STORY.BEAT.POSTED', {
        arcId: arc._id,
        arcTitle: arc.title,
        beatNumber: beat.sequenceNumber,
        mediaUrl,
        caption,
        posts
      });
      
      this.logger.info(`[StoryPosting] Successfully posted beat ${beat.sequenceNumber}`);
      
      return {
        success: true,
        mediaUrl,
        caption,
        posts
      };
      
    } catch (error) {
      this.logger.error('[StoryPosting] Error posting beat:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate media for beat using composition of real avatars
   * Uses the same composition logic as SceneCameraTool
   * Special handling for title cards
   * @private
   */
  async _generateMedia(beat, arc) {
    try {
      // Special handling for title cards - generate a poster-style image
      if (beat.type === 'title') {
        this.logger.info('[StoryPosting] Generating title card image...');
        return await this._generateTitleCardImage(beat, arc);
      }
      
      // Determine media type (for MVP, always use images)
      const useVideo = beat.type === 'climax' && this.veo && typeof this.veo.generateVideo === 'function';
      
      if (useVideo) {
        this.logger.info('[StoryPosting] Generating video for climax beat...');
        try {
          const videoResult = await this.veo.generateVideo({
            prompt: beat.visualPrompt,
            length: 5,
            aspectRatio: '16:9'
          });
          
          if (videoResult?.url) {
            return videoResult.url;
          }
        } catch (e) {
          this.logger.warn(`[StoryPosting] Video generation failed: ${e.message}`);
        }
        
        this.logger.warn('[StoryPosting] Falling back to image generation');
      }
      
      // Get avatar data from arc characters
      // If beat.characters is empty or undefined, use all arc characters
      const avatarIds = arc.characters
        .filter(char => {
          if (!char.avatarId) return false;
          // If beat has no characters specified, include all arc characters
          if (!beat.characters || beat.characters.length === 0) return true;
          // Otherwise, only include characters mentioned in this beat
          // Use flexible matching: check if beat character name is contained in arc character name
          return beat.characters.some(beatChar => {
            const beatName = beatChar.toLowerCase().trim();
            const arcName = char.avatarName.toLowerCase().trim();
            return arcName.includes(beatName) || beatName.includes(arcName) || arcName === beatName;
          });
        })
        .map(char => char.avatarId);
      
      // Fetch actual avatar documents (limit to 4 like SceneCameraTool)
      const avatars = avatarIds.length > 0
        ? (await this.worldContext.getAvatarsByIds(avatarIds)).slice(0, 4)
        : [];
      
      // Get location data if available
      let location = null;
      if (beat.location) {
        const locationData = arc.locations.find(loc => loc.locationName === beat.location);
        if (locationData?.locationId) {
          location = await this.worldContext.getLocation(locationData.locationId);
        }
      }
      
      // Collect images for composition: avatars + location (like SceneCameraTool)
      const images = [];
      for (const av of avatars) {
        if (!av?.imageUrl) continue;
        try {
          const buf = await this.s3Service.downloadImage(av.imageUrl);
          images.push({ data: buf.toString('base64'), mimeType: 'image/png', label: 'avatar' });
        } catch (e) {
          this.logger.warn(`[StoryPosting] Failed avatar image: ${e?.message || e}`);
        }
      }
      if (location?.imageUrl) {
        try {
          const buf = await this.s3Service.downloadImage(location.imageUrl);
          images.unshift({ data: buf.toString('base64'), mimeType: 'image/png', label: 'location' });
        } catch (e) {
          this.logger.warn(`[StoryPosting] Failed location image: ${e?.message || e}`);
        }
      }
      
      const subjectLine = avatars.map(a => `${a.name || 'Unknown'} ${a.emoji || ''}`.trim()).join(', ');
      const locLine = location ? `${location.name || 'Unknown Location'}` : (beat.location || 'Unknown Location');
      
      // Ensure visualPrompt is a string
      const visualPrompt = typeof beat.visualPrompt === 'string' 
        ? beat.visualPrompt 
        : 'A whimsical scene from CosyWorld, fantasy art style';
      
      const style = 'cinematic anime style, 16:9, soft lighting, detailed background, cohesive composition, no UI or watermark';
      const compositePrompt = `${visualPrompt}. Featuring: ${subjectLine}. Location: ${locLine}. ${style}`.trim();
      
      this.logger.info(`[StoryPosting] Composing image with ${images.length} images (${avatars.length} avatars + ${location ? 1 : 0} location) for arc "${arc.title}"`);
      
      // Build metadata (for upload/social, not for AI generation config)
      const metadata = {
        source: 'story.beat',
        purpose: 'story_beat',
        context: `Story: ${arc.title}, Beat ${beat.sequenceNumber}`
      };
      
      if (avatars[0]) {
        metadata.avatarId = String(avatars[0]._id || avatars[0].id);
        metadata.avatarName = avatars[0].name;
        metadata.avatarEmoji = avatars[0].emoji;
      }
      
      if (location) {
        metadata.locationName = location.name;
        metadata.locationDescription = location.description;
      }
      
      let imageUrl = null;
      
      // Prefer composition if we have multiple image sources (like SceneCameraTool)
      const tryCompose = async (provider) => {
        if (!provider?.composeImageWithGemini || images.length === 0) return null;
        try {
          return await provider.composeImageWithGemini(images, compositePrompt, metadata);
        } catch (e) {
          this.logger.warn('[StoryPosting] compose failed: ' + (e?.message || e));
          return null;
        }
      };
      
      // Fallback to normal generation
      const tryGenerate = async (provider) => {
        if (!provider) return null;
        try {
          if (typeof provider.generateImageFull === 'function') {
            return await provider.generateImageFull(compositePrompt, avatars[0], location, images.slice(0,1), { aspectRatio: '16:9', ...metadata });
          }
          if (typeof provider.generateImage === 'function') {
            if (provider === this.googleAI) {
              return await provider.generateImage(compositePrompt, '16:9', metadata);
            }
            return await provider.generateImage(compositePrompt, images, { aspectRatio: '16:9', ...metadata });
          }
        } catch (e) {
          this.logger.warn('[StoryPosting] generate failed: ' + (e?.message || e));
        }
        return null;
      };
      
      // Try composition first on primary AI service, then google, then fallback to generation
      imageUrl = await tryCompose(this.aiService) || await tryGenerate(this.aiService);
      if (!imageUrl && this.googleAI) {
        imageUrl = await tryCompose(this.googleAI) || await tryGenerate(this.googleAI);
      }
      
      if (!imageUrl) {
        this.logger.error('[StoryPosting] Image generation failed');
        return null;
      }
      
      return imageUrl;
      
    } catch (error) {
      this.logger.error('[StoryPosting] Error generating media:', error);
      return null;
    }
  }

  /**
   * Post to social platforms
   * @private
   */
  async _postToSocial(mediaUrl, caption, arc, beat) {
    const posts = {};
    
    // Post to Telegram
    try {
      if (this.telegram) {
        const telegramResult = await this.telegram.postGlobalMediaUpdate({
          mediaUrl,
          text: caption,
          type: 'image',
          source: 'story.beat',
          metadata: {
            arcId: arc._id.toString(),
            arcTitle: arc.title,
            beatNumber: beat.sequenceNumber,
            theme: arc.theme,
            emotionalTone: arc.emotionalTone
          }
        });
        
        if (telegramResult?.message_id) {
          posts.telegramMessageId = telegramResult.message_id;
          this.logger.info(`[StoryPosting] Posted to Telegram: ${telegramResult.message_id}`);
        }
      }
    } catch (error) {
      this.logger.error('[StoryPosting] Error posting to Telegram:', error);
    }
    
    // Post to X
    try {
      if (this.x) {
        const xResult = await this.x.postGlobalMediaUpdate({
          mediaUrl,
          text: caption,
          metadata: {
            arcId: arc._id.toString(),
            isStoryContent: true,
            beatNumber: beat.sequenceNumber
          }
        });
        
        if (xResult?.id) {
          posts.xTweetId = xResult.id;
          posts.xTweetUrl = `https://twitter.com/i/web/status/${xResult.id}`;
          this.logger.info(`[StoryPosting] Posted to X: ${xResult.id}`);
        }
      }
    } catch (error) {
      this.logger.error('[StoryPosting] Error posting to X:', error);
    }
    
    return posts;
  }

  /**
   * Generate a special title card image for the arc
   * Uses high-quality poster generation with all main characters
   * @private
   */
  async _generateTitleCardImage(beat, arc) {
    try {
      this.logger.info(`[StoryPosting] Generating title card for arc "${arc.title}"`);
      
      // Get ALL avatar data from arc characters for title card
      const avatarIds = arc.characters
        .filter(char => char.avatarId)
        .map(char => char.avatarId);
      
      // Fetch actual avatar documents (no limit for title cards - show everyone)
      const avatars = avatarIds.length > 0
        ? await this.worldContext.getAvatarsByIds(avatarIds)
        : [];
      
      // Get primary location
      let location = null;
      if (arc.locations && arc.locations.length > 0) {
        const primaryLocation = arc.locations[0];
        if (primaryLocation?.locationId) {
          location = await this.worldContext.getLocation(primaryLocation.locationId);
        }
      }
      
      // Collect images for composition
      const images = [];
      for (const av of avatars) {
        if (!av?.imageUrl) continue;
        try {
          const buf = await this.s3Service.downloadImage(av.imageUrl);
          images.push({ data: buf.toString('base64'), mimeType: 'image/png', label: 'avatar' });
        } catch (e) {
          this.logger.warn(`[StoryPosting] Failed avatar image: ${e?.message || e}`);
        }
      }
      if (location?.imageUrl) {
        try {
          const buf = await this.s3Service.downloadImage(location.imageUrl);
          images.unshift({ data: buf.toString('base64'), mimeType: 'image/png', label: 'location' });
        } catch (e) {
          this.logger.warn(`[StoryPosting] Failed location image: ${e?.message || e}`);
        }
      }
      
      // Build title card prompt with epic presentation
      const characterList = avatars.map(a => `${a.name || 'Unknown'} ${a.emoji || ''}`.trim()).join(', ');
      const locationName = location?.name || arc.locations[0]?.locationName || 'CosyWorld';
      
      const visualPrompt = beat.visualPrompt || 
        `Epic title card showcasing the story of ${arc.title}. Featuring ${characterList} in ${locationName}. ${arc.theme} theme, ${arc.emotionalTone} atmosphere.`;
      
      const style = 'Epic cinematic poster style, 16:9, dramatic lighting, title card composition, all main characters visible, fantasy art, no text or UI';
      const compositePrompt = `${visualPrompt} ${style}`.trim();
      
      this.logger.info(`[StoryPosting] Title card with ${images.length} images (${avatars.length} avatars + ${location ? 1 : 0} location)`);
      
      // Build metadata
      const metadata = {
        source: 'story.title_card',
        purpose: 'story_title_card',
        context: `Title Card: ${arc.title}`,
        arcId: String(arc._id),
        arcTitle: arc.title,
        theme: arc.theme,
        emotionalTone: arc.emotionalTone
      };
      
      let imageUrl = null;
      
      // Try composition first (preferred for title cards with multiple characters)
      if (images.length > 0) {
        try {
          if (this.aiService?.composeImageWithGemini) {
            imageUrl = await this.aiService.composeImageWithGemini(images, compositePrompt, metadata);
          } else if (this.googleAI?.composeImageWithGemini) {
            imageUrl = await this.googleAI.composeImageWithGemini(images, compositePrompt, metadata);
          }
        } catch (e) {
          this.logger.warn('[StoryPosting] Title card composition failed: ' + (e?.message || e));
        }
      }
      
      // Fallback to standard generation
      if (!imageUrl) {
        try {
          if (this.googleAI?.generateImage) {
            imageUrl = await this.googleAI.generateImage(compositePrompt, '16:9', metadata);
          } else if (this.aiService?.generateImage) {
            imageUrl = await this.aiService.generateImage(compositePrompt, images, { aspectRatio: '16:9', ...metadata });
          }
        } catch (e) {
          this.logger.warn('[StoryPosting] Title card generation failed: ' + (e?.message || e));
        }
      }
      
      if (!imageUrl) {
        this.logger.error('[StoryPosting] Title card image generation failed');
        return null;
      }
      
      this.logger.info(`[StoryPosting] Title card generated: ${imageUrl}`);
      return imageUrl;
      
    } catch (error) {
      this.logger.error('[StoryPosting] Error generating title card image:', error);
      return null;
    }
  }

  /**
   * Handle story beat posted event
   * This can be called by the scheduler or manually
   */
  async handleBeatGenerated({ arc, beat }) {
    return await this.postBeat(arc, beat);
  }
}

export default StoryPostingService;
