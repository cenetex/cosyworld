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
    veoService,
    narrativeGeneratorService,
    storyStateService,
    eventBus,
    logger 
  }) {
    this.telegram = telegramService;
    this.x = xService;
    this.googleAI = googleAIService;
    this.veo = veoService;
    this.narrativeGenerator = narrativeGeneratorService;
    this.storyState = storyStateService;
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
      
      // Update beat with media URL and post IDs
      await this.storyState.updateArc(arc._id, {
        [`beats.${beat.sequenceNumber - 1}.generatedImageUrl`]: mediaUrl,
        [`beats.${beat.sequenceNumber - 1}.caption`]: caption,
        [`beats.${beat.sequenceNumber - 1}.socialPosts`]: posts
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
   * Generate media for beat
   * @private
   */
  async _generateMedia(beat, arc) {
    try {
      // Determine media type (for MVP, always use images)
      const useVideo = beat.type === 'climax' && this.veo; // Use video for climactic moments
      
      if (useVideo) {
        this.logger.info('[StoryPosting] Generating video for climax beat...');
        const videoResult = await this.veo.generateVideo({
          prompt: beat.visualPrompt,
          length: 5,
          aspectRatio: '16:9'
        });
        
        if (videoResult?.url) {
          return videoResult.url;
        }
        
        this.logger.warn('[StoryPosting] Video generation failed, falling back to image');
      }
      
      // Generate image
      this.logger.info('[StoryPosting] Generating image...');
      
      // Ensure visualPrompt is a string
      const visualPrompt = typeof beat.visualPrompt === 'string' 
        ? beat.visualPrompt 
        : 'A whimsical scene from CosyWorld, fantasy art style';
      
      const imageResult = await this.googleAI.generateImage(
        visualPrompt,  // First parameter: prompt string
        '1:1',         // Second parameter: aspectRatio
        {              // Third parameter: options
          source: 'story.beat',
          purpose: 'story_beat',
          context: `Story: ${arc.title}, Beat ${beat.sequenceNumber}`
        }
      );
      
      // generateImage returns URL string directly, not an object
      if (imageResult && typeof imageResult === 'string') {
        return imageResult;
      }
      
      this.logger.error('[StoryPosting] Image generation failed');
      return null;
      
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
   * Handle story beat posted event
   * This can be called by the scheduler or manually
   */
  async handleBeatGenerated({ arc, beat }) {
    return await this.postBeat(arc, beat);
  }
}

export default StoryPostingService;
