/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { BasicTool } from '../BasicTool.mjs';

export class CreationTool extends BasicTool {
  /**
   * Constructs a new CreationTool.
   **/
  constructor({
    aiService
  }) {
    super();

    this.aiService = unifiedAIService || aiService;
    this.googleAIService = googleAIService;
    this.openrouterAIService = openrouterAIService;
    this.imageGenerationRateLimiter = imageGenerationRateLimiter;
    this.s3Service = s3Service;
    this.locationService = locationService;
    this.avatarService = avatarService;
    this.discordService = discordService;
    this.logger = logger || console;
    this.name = 'create';
    this.emoji = '✨';
    this.description = 'Create custom narrative effects and abilities with visual imagery';
    this.replyNotification = true;
    this.cooldownMs = 30 * 1000; // 30 second cooldown
    
    // Rate limiting: 1 creation per day per user
    this._userCreationTimestamps = new Map(); // Map<userId, timestamp>
    this._dailyLimitMs = 24 * 60 * 60 * 1000; // 24 hours
  }

  /**
   * Check if user is rate limited (1 creation per day).
   * @param {string} userId 
   * @returns {{ allowed: boolean, waitMs?: number, reason?: string }}
   */
  _checkUserRateLimit(userId) {
    if (!userId) return { allowed: true };
    
    const now = Date.now();
    const lastCreation = this._userCreationTimestamps.get(userId);
    
    if (lastCreation) {
      const elapsed = now - lastCreation;
      if (elapsed < this._dailyLimitMs) {
        const waitMs = this._dailyLimitMs - elapsed;
        return { allowed: false, waitMs, reason: 'daily_limit' };
      }
    }
    
    return { allowed: true };
  }

  /**
   * Record a successful creation for rate limiting.
   * @param {string} userId 
   */
  _recordUserCreation(userId) {
    if (userId) {
      this._userCreationTimestamps.set(userId, Date.now());
    }
  }

  async execute(message, params, command) {
    try {
      const cacheKey = `${command}_${params.join('_')}`;
      if (this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey);
      }
      const prompt = this.buildPrompt(message, command, params);
      const narrative = await this.generateNarrative(prompt);
      // Format the narrative properly if it's not already formatted
      const formatted = narrative.trim().startsWith('-#') 
        ? narrative 
        : `-# [ ${narrative} ]`;
      this.cache.set(cacheKey, formatted);
      return formatted;
    } catch (error) {
      this.logger?.error('Error in CreationTool:', error);
      return `-# [ ❌ Error: Failed to generate narrative: ${error.message} ]`;
    }
  }

  buildPrompt(message, command, params) {
    return `In a fantasy RPG setting, describe the effects of a character named ${message.author.username} 
    using a special ability called "${command}" ${params.length ? `targeting ${params.join(' ')}` : ''}.
    Keep the response under 100 words and focus on narrative impact.
    Include some chance of failure or partial success.
    Make it feel like part of a larger adventure story.`;
  }

  async generateNarrative(prompt) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_KEY}`,
          'Content-Type': 'application/json'
        },
        target: {
          type: 'string',
          description: 'Optional target for the creation or ability'
        }
      },
      required: ['description']
    };
  }

  async execute(message, params, avatar) {
    try {
      // Check rate limit (1 per day per user)
      const userId = message?.author?.id || message?.user?.id;
      const rateLimitCheck = this._checkUserRateLimit(userId);
      if (!rateLimitCheck.allowed) {
        const hoursRemaining = Math.ceil(rateLimitCheck.waitMs / (60 * 60 * 1000));
        return `-# [ ✨ Your creative power is recharging... try again in ~${hoursRemaining} hour${hoursRemaining !== 1 ? 's' : ''} ]`;
      }

      // Handle both array params and structured params
      let description, target;
      if (typeof params === 'object' && !Array.isArray(params)) {
        description = params.description || params.prompt || '';
        target = params.target || '';
      } else {
        const paramArray = Array.isArray(params) ? params : [params];
        description = paramArray.join(' ');
        target = '';
      }

      // If no description provided, generate one based on avatar personality
      if (!description || description.trim().length === 0) {
        description = await this.generateCreativeIntent(avatar, message);
        if (!description) {
          return '-# [ ✨ The creative energy swirls but finds no form... ]';
        }
      }

      // Generate narrative first
      const prompt = this.buildPrompt(message, avatar, description, target);
      const narrative = await this.generateNarrative(prompt, avatar);

      // Attempt to generate an image of the effect
      let imageUrl = null;
      try {
        imageUrl = await this.generateEffectImage(message, avatar, description, narrative);
      } catch (imgErr) {
        this.logger?.warn?.(`[CreationTool] Image generation failed: ${imgErr.message}`);
      }

      // Format the result with optional image link
      let result;
      if (imageUrl) {
        result = `-# [ ✨ [Effect](${imageUrl}) ${narrative} ]`;
      } else {
        result = `-# [ ✨ ${narrative} ]`;
      }
      
      // Record successful creation for rate limiting
      this._recordUserCreation(userId);
      
      return result;
    } catch (error) {
      this.logger?.error?.('Error in CreationTool:', error);
      return `-# [ ❌ Creation failed: ${error.message} ]`;
    }
  }

  /**
   * Generate an image depicting the magical effect
   */
  async generateEffectImage(message, avatar, description, narrative) {
    // Gather context images for composition
    const images = [];
    
    // Avatar image
    if (avatar?.imageUrl && this.s3Service) {
      try {
        const buffer = await this.s3Service.downloadImage(avatar.imageUrl);
        images.push({ data: buffer.toString('base64'), mimeType: 'image/png', label: 'avatar' });
      } catch (e) {
        this.logger?.debug?.(`[CreationTool] Could not download avatar image: ${e.message}`);
      }
    }

    // Location image
    let location = null;
    if (message?.channel?.id && this.locationService) {
      try {
        location = await this.locationService.getLocationByChannelId(message.channel.id);
        if (location?.imageUrl) {
          const buffer = await this.s3Service.downloadImage(location.imageUrl);
          images.push({ data: buffer.toString('base64'), mimeType: 'image/png', label: 'location' });
        }
      } catch (e) {
        this.logger?.debug?.(`[CreationTool] Could not get location: ${e.message}`);
      }
    }

    // Build an evocative image prompt
    const characterName = avatar?.name || 'The adventurer';
    const locationName = location?.name || 'a mystical realm';
    
    const imagePrompt = `A dramatic magical effect visualization: ${characterName} casting "${description}" in ${locationName}. 
${narrative}
Style: Fantasy illustration, dramatic lighting, magical particle effects, ethereal glow, dynamic composition. 
The magic should be the focal point with vibrant energy emanating from the character.
No text, no UI elements, no watermarks.`;

    let imageUrl = null;

    // Helper to attempt composition with Gemini
    const tryCompose = async (provider) => {
      if (!provider?.composeImageWithGemini || images.length === 0) return null;
      try {
        return await provider.composeImageWithGemini(
          images,
          imagePrompt
        );
      } catch (e) {
        this.logger?.debug?.('[CreationTool] compose failed: ' + e.message);
        return null;
      }
    };

    // Helper to attempt simple generation
    const tryGenerate = async (provider) => {
      if (!provider) return null;
      try {
        if (typeof provider.generateImageFull === 'function') {
          return await provider.generateImageFull(imagePrompt, avatar, location, images.slice(0, 1), { aspectRatio: '1:1' });
        }
        if (typeof provider.generateImage === 'function') {
          if (provider === this.googleAIService) {
            return await provider.generateImage(imagePrompt, '1:1');
          }
          return await provider.generateImage(imagePrompt, images, { aspectRatio: '1:1' });
        }
      } catch (e) {
        this.logger?.debug?.('[CreationTool] generateImage failed: ' + e.message);
      }
      return null;
    };

    // Try primary AI service first
    imageUrl = await tryCompose(this.aiService) || await tryGenerate(this.aiService);
    
    // Try Google AI service if primary failed
    if (!imageUrl && this.googleAIService) {
      imageUrl = await tryCompose(this.googleAIService) || await tryGenerate(this.googleAIService);
    }

    // Try OpenRouter if available and rate limit allows
    if (!imageUrl && this.openrouterAIService) {
      try {
        const avatarId = avatar?._id?.toString() || avatar?.id?.toString();
        const rateLimitCheck = this.imageGenerationRateLimiter?.checkAllowed(avatarId);
        if (!rateLimitCheck || rateLimitCheck.allowed) {
          const result = await this.openrouterAIService.generateImageViaOpenRouter(imagePrompt, images, { aspectRatio: '1:1' });
          if (result?.imageUrl) {
            imageUrl = result.imageUrl;
          } else if (typeof result === 'string' && result.startsWith('http')) {
            imageUrl = result;
          }
        }
      } catch (e) {
        this.logger?.debug?.('[CreationTool] OpenRouter image generation failed: ' + e.message);
      }
    }

    return imageUrl;
  }

  /**
   * Generate a creative intent based on avatar personality when no description is provided
   */
  async generateCreativeIntent(avatar, message) {
    if (!this.aiService) return null;

    try {
      const characterName = avatar?.name || 'The mystic';
      const personality = avatar?.personality || avatar?.description || 'a mysterious being';
      const messageContent = message?.content?.replace(/✨/g, '').trim() || '';

      const intentPrompt = `You are ${characterName}, ${personality}.

You just invoked your creative power (✨). Based on your personality and nature, what do you create or manifest?
${messageContent ? `Recent context: "${messageContent}"` : ''}

Respond with ONLY a brief phrase (3-8 words) describing what you create. Examples:
- "a shield of crystalline light"
- "whispers that reveal hidden truths"
- "dancing flames of inspiration"
- "a mirror reflecting inner demons"

Your creation:`;

      const response = await this.aiService.chat([
        { role: 'user', content: intentPrompt }
      ], {
        model: avatar?.model || process.env.STRUCTURED_MODEL,
        temperature: 0.9
      });

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      this.logger?.error(`Error generating narrative: ${error.message}`);
      return "The mysterious power fizzles unexpectedly...";
    }
  }

  getDescription() {
    return 'Handle custom abilities and actions';
  }

  async getSyntax() {
    return `${this.emoji || ''} [target]`;
  }
}