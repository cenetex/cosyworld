/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { BasicTool } from '../BasicTool.mjs';

/**
 * VideoCameraTool
 * Captures a cinematic scene as a short video clip using Veo 3.1 with reference images.
 * Uses the most recently active avatars in the channel as reference images for character consistency.
 */
export class VideoCameraTool extends BasicTool {
  constructor({
    aiService,
    googleAIService = null,
    veoService,
    s3Service,
    locationService,
    avatarService,
    discordService,
    configService,
    logger
  }) {
    super();
    this.name = 'video camera';
    this.emoji = '🎥';
    this.description = 'Capture a cinematic widescreen video scene with recently active avatars (Veo 3.1 with audio).';
    this.replyNotification = true;
    this.cooldownMs = 10 * 60 * 1000; // 10 minutes

    this.aiService = aiService;
    this.googleAIService = googleAIService;
    this.veoService = veoService;
    this.s3Service = s3Service;
    this.locationService = locationService;
    this.avatarService = avatarService;
    this.discordService = discordService;
    this.configService = configService;
    this.logger = logger || console;
  }

  async execute(message, params, avatar) {
    try {
      const userPrompt = params?.length ? params.join(' ') : '';
      const channelId = message?.channel?.id;
      const guildId = message?.guild?.id || message?.guildId;
      if (!channelId) return '-# [ ❌ Error: Missing channel context. ]';

      if (!this.veoService) {
        return '-# [ ❌ Error: Veo service not available. ]';
      }

      // Check rate limit upfront
      if (this.veoService?.checkRateLimit && !this.veoService.checkRateLimit()) {
        return `-# [ ${this.emoji} Video generation cancelled: rate limit reached ]`;
      }

      // Gather location
      const location = await this.locationService.getLocationByChannelId(channelId).catch(() => null);

      // Get recently active avatars from channel history
      const recentAvatars = await this._getRecentlyActiveAvatars(channelId, guildId, avatar);
      
      // Select up to 3 avatars for reference images (Veo 3.1 limit)
      const selectedAvatars = recentAvatars.slice(0, 3);

      if (selectedAvatars.length === 0) {
        return '-# [ ❌ Error: No avatars with images found in channel. ]';
      }

      // Prepare reference images from avatar images
      const referenceImages = [];
      for (const av of selectedAvatars) {
        if (!av?.imageUrl) continue;
        try {
          const buf = await this.s3Service.downloadImage(av.imageUrl);
          referenceImages.push({
            data: buf.toString('base64'),
            mimeType: 'image/png',
            referenceType: 'asset' // Use 'asset' for character/subject references
          });
          this.logger?.info?.(` [VideoCamera] Added reference image for ${av.name}`);
        } catch (e) {
          this.logger?.warn?.(`[VideoCamera] Failed to load avatar image for ${av.name}: ${e?.message || e}`);
        }
      }

      if (referenceImages.length === 0) {
        return '-# [ ❌ Error: Failed to load avatar reference images. ]';
      }

      // Build cinematic prompt
      const avatarNames = selectedAvatars.map(a => a.name || 'Unknown').join(', ');
      const avatarDescriptions = selectedAvatars.map(a => {
        const desc = a.personality?.slice(0, 100) || a.description?.slice(0, 100) || '';
        return `${a.name}: ${desc}`;
      }).join('. ');
      
      const locLine = location?.name || 'an unknown location';
      const locDesc = location?.description?.slice(0, 150) || '';

      // Get recent channel context for better scene generation
      const recentMessages = await this.discordService?.getRecentMessages?.(channelId, 10) || [];
      const recentContext = recentMessages
        .slice(0, 5)
        .reverse()
        .map(m => m.content || '')
        .filter(c => c && !c.startsWith('-#'))
        .join('\n')
        .slice(0, 500);

      // Use LLM to generate a detailed cinematic scene description
      this.logger?.info?.(`[VideoCamera] Generating scene description with LLM...`);
      
      const scenePromptInstruction = `
You are a professional cinematographer and video director. Create a detailed, vivid scene description for a video generation AI (Veo 3.1).

CONTEXT:
Location: ${locLine}
Location Description: ${locDesc || 'Not specified'}

Characters in scene:
${selectedAvatars.map(a => `- ${a.name}: ${a.personality?.slice(0, 150) || a.description?.slice(0, 150) || 'No description'}`).join('\n')}

Recent conversation context:
${recentContext || 'No recent context'}

User's scene request: ${userPrompt || 'Create a natural, character-driven scene with subtle interactions'}

REQUIREMENTS:
1. Create a cinematic widescreen scene description (16:9 aspect ratio)
2. Describe what each character is doing, their expressions, and body language
3. Include specific camera movements (dolly, pan, tracking, etc.)
4. Specify lighting and atmosphere (golden hour, dramatic shadows, soft light, etc.)
5. Add detailed audio cues:
   - Character dialogue (use quotes for specific speech)
   - Sound effects (footsteps, environment sounds, object interactions)
   - Ambient noise (wind, water, crowd, music, etc.)
6. Maintain the anime/animation style aesthetic
7. Keep the scene dynamic but focused (8 second duration)
8. Ensure all ${selectedAvatars.length} characters are visible and active in the scene
9. Match the tone and energy of the recent conversation

OUTPUT FORMAT:
Write a single detailed paragraph (150-250 words) that vividly describes the scene. Include camera work, character actions, lighting, style, and comprehensive audio cues. Make it cinematic and engaging.

DO NOT include any preamble or meta-commentary. Start directly with the scene description.
      `.trim();

      let cinematicPrompt;
      try {
        const aiResponse = await this.aiService.generateCompletion(scenePromptInstruction, {
          systemPrompt: 'You are a master cinematographer creating detailed scene descriptions for AI video generation. Be vivid, specific, and cinematic.',
          temperature: 0.8, // More creative
          maxTokens: 400
        });

        cinematicPrompt = (typeof aiResponse === 'string' ? aiResponse : aiResponse?.text || aiResponse?.content || '').trim();
        
        // Fallback if response is too short or empty
        if (cinematicPrompt.length < 100) {
          throw new Error('Generated prompt too short');
        }

        this.logger?.info?.(`[VideoCamera] Generated scene prompt (${cinematicPrompt.length} chars)`);
      } catch (e) {
        this.logger?.warn?.(`[VideoCamera] LLM scene generation failed, using template: ${e?.message || e}`);
        
        // Fallback to template-based prompt
        cinematicPrompt = `
A cinematic widescreen scene at ${locLine}. ${locDesc}

Characters present: ${avatarNames}. ${avatarDescriptions}

${userPrompt || 'The scene unfolds with natural interactions and subtle movements.'}

Camera: Smooth dolly shot, maintaining a medium-wide composition that captures all characters. 
Style: Cinematic anime aesthetic with dramatic lighting and depth of field.
Audio: Ambient sounds of the environment, subtle character movements, atmospheric background.
        `.trim();
      }

      this.logger?.info?.(`[VideoCamera] Generating video with ${referenceImages.length} reference images`);

      // Generate video directly using Veo 3.1 with reference images
      try {
        const videos = await this.veoService.generateVideosWithReferenceImages({
          prompt: cinematicPrompt,
          referenceImages,
          model: 'veo-3.1-fast-generate-preview', // Use fast model by default
          config: {
            aspectRatio: '16:9', // Widescreen (required for reference images)
            durationSeconds: 8 // Required for reference images
            // Note: resolution and personGeneration are not supported with reference images
          }
        });

        const videoUrl = Array.isArray(videos) ? videos[0] : null;
        
        if (videoUrl) {
          // Schedule follow-up chatter from avatars in the scene
          this._scheduleFollowUpChatter(channelId, message, selectedAvatars, avatar);
          
          return `-# [ ${this.emoji} 🎬 [Cinematic Scene](${videoUrl}) ]\n-# [ 📹 Generated with Veo 3.1 • ${selectedAvatars.length} characters • Widescreen with audio ]`;
        }
        
        return `-# [ ${this.emoji} Video generation completed but no URL returned ]`;
      } catch (e) {
        this.logger?.error?.(`[VideoCamera] Veo 3.1 generation failed: ${e?.message || e}`);
        return `-# [ ❌ Error: Video generation failed - ${e?.message || 'unknown error'} ]`;
      }
    } catch (err) {
      this.logger?.error?.(`[VideoCamera] Execution error: ${err?.message || err}`);
      return `-# [ ❌ Error: ${err?.message || err} ]`;
    }
  }

  /**
   * Get recently active avatars by checking recent messages in the channel.
   * Returns avatars sorted by most recent activity.
   * @private
   */
  async _getRecentlyActiveAvatars(channelId, guildId, currentAvatar) {
    try {
      // Get recent messages to find active avatars
      const recentMessages = await this.discordService?.getRecentMessages?.(channelId, 50) || [];
      
      // Extract unique avatar IDs from webhook messages (ordered by recency)
      const avatarIds = new Set();
      const avatarIdList = []; // Preserve order
      
      // Add current avatar first if it has an image
      if (currentAvatar?._id && currentAvatar?.imageUrl) {
        avatarIds.add(String(currentAvatar._id));
        avatarIdList.push(String(currentAvatar._id));
      }

      // Extract avatar IDs from recent webhook messages
      for (const msg of recentMessages) {
        if (!msg?.webhookId) continue;
        
        // Try to extract avatar ID from webhook username or content
        const content = msg.content || '';
        
        // Look for avatar mentions or webhook patterns
        // Webhooks created by the system often have avatar IDs in metadata
        if (msg.author?.bot) {
          // Try to find avatar reference in message
          const matches = content.match(/\[.*?\]\(.*?\)/g) || [];
          for (const match of matches) {
            const urlMatch = match.match(/\((.*?)\)/);
            if (urlMatch && urlMatch[1]) {
              // Extract potential avatar ID from URLs or references
              const idMatch = urlMatch[1].match(/[a-f0-9]{24}/i);
              if (idMatch && !avatarIds.has(idMatch[0])) {
                avatarIds.add(idMatch[0]);
                avatarIdList.push(idMatch[0]);
              }
            }
          }
        }
      }

      // Fall back to getting all avatars in channel if we don't have enough from messages
      if (avatarIdList.length < 3) {
        const allAvatars = await this.avatarService.getAvatarsInChannel(channelId, guildId).catch(() => []);
        for (const av of allAvatars) {
          const id = String(av._id);
          if (!avatarIds.has(id) && av?.imageUrl) {
            avatarIds.add(id);
            avatarIdList.push(id);
          }
          if (avatarIdList.length >= 5) break; // Get up to 5 for selection
        }
      }

      // Fetch full avatar objects
      const avatars = [];
      for (const id of avatarIdList) {
        try {
          const av = await this.avatarService.getAvatarById(id);
          if (av && av.imageUrl) {
            avatars.push(av);
          }
        } catch (e) {
          this.logger?.debug?.(`[VideoCamera] Failed to fetch avatar ${id}: ${e?.message}`);
        }
      }

      return avatars;
    } catch (e) {
      this.logger?.warn?.(`[VideoCamera] Failed to get recent avatars: ${e?.message || e}`);
      
      // Fallback to all avatars in channel
      const present = await this.avatarService.getAvatarsInChannel(channelId, guildId).catch(() => []);
      const withImages = present.filter(av => av?.imageUrl);
      
      // Ensure current avatar is first if available
      if (currentAvatar?._id && currentAvatar?.imageUrl) {
        const filtered = withImages.filter(av => String(av._id) !== String(currentAvatar._id));
        return [currentAvatar, ...filtered];
      }
      
      return withImages;
    }
  }

  /**
   * Schedule follow-up chatter from other avatars in the scene.
   * @private
   */
  _scheduleFollowUpChatter(channelId, message, avatars, excludeAvatar) {
    try {
      setTimeout(async () => {
        try {
          const convoMgr = this.configService?.services?.conversationManager;
          const discord = this.discordService;
          if (!convoMgr || !discord) return;
          
          const channel = await discord.getChannelById?.(channelId) || message.channel;
          if (!channel) return;
          
          for (const av of avatars) {
            if (!av || (excludeAvatar && String(av._id) === String(excludeAvatar._id))) continue;
            try {
              await convoMgr.sendResponse(channel, av, null, { 
                overrideCooldown: true, 
                cascadeDepth: 1 
              });
            } catch (e) {
              this.logger?.debug?.(`[VideoCamera] Follow-up response failed for ${av.name}: ${e.message}`);
            }
          }
        } catch (inner) {
          this.logger?.debug?.('[VideoCamera] Follow-up scheduling error: ' + (inner?.message || inner));
        }
      }, 2000);
    } catch (e) {
      this.logger?.debug?.(`[VideoCamera] Failed to schedule follow-up: ${e?.message}`);
    }
  }

  getDescription() { return this.description; }
  async getSyntax() { return `${this.emoji} [optional description of the scene]`; }
}
