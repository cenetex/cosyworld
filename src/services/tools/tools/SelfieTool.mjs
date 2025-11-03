/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { BasicTool } from '../BasicTool.mjs';

export class SelfieTool extends BasicTool {
  constructor({
    aiService,
    googleAIService,
    imageProcessingService,
    xService,
    discordService,
    s3Service,
    locationService,
    avatarService,
    itemService,
  databaseService,
  logger
  }) {
    super();
  this.logger = logger || console;
    this.aiService = aiService;
    this.googleAIService = googleAIService; // optional secondary provider w/ image support
    this.imageProcessingService = imageProcessingService;
    this.xService = xService;
    this.discordService = discordService;
    this.s3Service = s3Service;
    this.locationService = locationService;
    this.avatarService = avatarService;
    this.itemService = itemService;
    this.databaseService = databaseService;
    
    this.name = 'selfie';
    this.emoji = '🤳';
    this.description = 'Take a selfie and post it to social media.';
    this.replyNotification = true;
    this.cooldownMs = 60 * 1000; // 1 minute cooldown
  }

  async execute(message, params, avatar) {
    try {
      const prompt = params.length ? params.join(' ') : `A snapshot of the avatar ${avatar.name} in the current scene.`;
      // Try to gather avatar, location, and item images as base64
      let images = [];
      // Avatar image
      if (avatar.imageUrl) {
        const buffer = await this.s3Service.downloadImage(avatar.imageUrl);
        images.push({ data: buffer.toString('base64'), mimeType: 'image/png', label: 'avatar' });
      }
      // Fetch location (async)
      let location = null;
      try {
        location = await this.locationService.getLocationByChannelId(message.channel.id);
      } catch (e) {
        this.logger?.warn?.(`[SelfieTool] Failed to resolve location for channel ${message.channel.id}: ${e.message}`);
      }
      // Location image (if available)
      if (location?.imageUrl) {
        try {
          const buffer = await this.s3Service.downloadImage(location.imageUrl);
          images.push({ data: buffer.toString('base64'), mimeType: 'image/png', label: 'location' });
        } catch (e) {
          this.logger?.warn?.('[SelfieTool] Could not download location image: ' + e.message);
        }
      }
      // Item image (if avatar has a selected item with imageUrl)
      const item = avatar.inventory?.find(i => i.selected && i.imageUrl) || avatar.inventory?.[0];
      if (item && item.imageUrl) {
        const buffer = await this.s3Service.downloadImage(item.imageUrl);
        images.push({ data: buffer.toString('base64'), mimeType: 'image/png', label: 'item' });
      }

      let contextPrompt = '';
      if (avatar) {
        contextPrompt += `\nSubject: ${avatar.name || ''} ${avatar.emoji || ''}. Description: ${avatar.description || ''}`;
      }
      if (location) {
        contextPrompt += `\nLocation: ${location.name || ''}. Description: ${location.description || ''}`;
      }
      if (item) {
        contextPrompt += `\nItem held: ${item.name || ''}. Description: ${item.description || ''}`;
      }


      let imageUrl;

      // Helper to attempt composition with a provider having composeImageWithGemini
      const tryCompose = async (provider) => {
        if (!provider?.composeImageWithGemini || images.length === 0) return null;
        try {
          const scenePrompt = `You are a master photographer. Create an atmospheric instant-film selfie (polaroid aesthetic) with slight film grain.
Context Subjects: ${contextPrompt}\nDesired emotional tone: ${prompt}`;
          return await provider.composeImageWithGemini(
            images,
            `Generate a classic polaroid-style candid snapshot of the provided subjects. DO NOT add UI chrome or watermarks. ${scenePrompt}`
          );
        } catch (e) {
          this.logger?.warn?.('[SelfieTool] compose failed: ' + e.message);
          return null;
        }
      };

      // Helper to attempt simple generation
      const tryGenerate = async (provider) => {
        if (!provider) return null;
        try {
          const genPrompt = `Candid selfie of ${avatar.name} (${avatar.description}). ${prompt}`;
          // Prefer richer API if available (googleAIService)
          if (typeof provider.generateImageFull === 'function') {
            return await provider.generateImageFull(genPrompt, avatar, location, images.slice(0,1), { aspectRatio: '1:1' });
          }
          if (typeof provider.generateImage === 'function') {
            // Heuristic: googleAIService.generateImage expects (prompt, aspectRatio?)
            if (provider === this.googleAIService) {
              return await provider.generateImage(genPrompt, '1:1');
            }
            return await provider.generateImage(genPrompt, images, { aspectRatio: '1:1' });
          }
        } catch (e) {
          this.logger?.warn?.('[SelfieTool] generateImage failed: ' + e.message);
        }
        return null;
      };

      // Attempt with primary provider (compose then generate)
      imageUrl = await tryCompose(this.aiService) || await tryGenerate(this.aiService);
      // Attempt with secondary (Google) provider if primary failed
      if (!imageUrl && this.googleAIService) {
        imageUrl = await tryCompose(this.googleAIService) || await tryGenerate(this.googleAIService);
      }
      // Fallback: use avatarService schema image generator to synthesize a variant
      if (!imageUrl && this.avatarService?.generateAvatarImage) {
        try {
          // Pass metadata for proper event emission
          const uploadOptions = {
            source: 'avatar.selfie',
            avatarName: avatar.name,
            avatarEmoji: avatar.emoji,
            avatarId: avatar._id,
            prompt: `${avatar.name}: ${avatar.description}. ${prompt}`,
            context: `${avatar.emoji || '📸'} ${avatar.name} takes a selfie — ${prompt}`.trim()
          };
          imageUrl = await this.avatarService.generateAvatarImage(`${avatar.name}: ${avatar.description}. ${prompt}`, uploadOptions);
        } catch (e) {
          this.logger?.warn?.('[SelfieTool] avatarService fallback failed: ' + e.message);
        }
      }
      // Final fallback: reuse existing avatar image
      if (!imageUrl && avatar.imageUrl) {
        imageUrl = avatar.imageUrl; // Better than total failure
      }

      if (!imageUrl) return `-# [ ❌ Error: Failed to generate image after all fallbacks. ]`;

      let postedToX = false;
      let xResult = '';
      const isXAuthorized = await this.xService.isXAuthorized(avatar._id.toString());
      if (isXAuthorized) {
        try {
          xResult = await this.xService.postImageToX(avatar, imageUrl, prompt);
          postedToX = true;
        } catch (error) {
          this.logger?.error('Error posting to X:', error);
          postedToX = false;
        }
      }
      return postedToX ? xResult : `-# [ 📸 [Snapshot taken.](${imageUrl}) ]`;
    } catch (error) {
      this.logger?.error('Error in CameraTool:', error);
      return `-# [ ❌ Error: Failed to take snapshot: ${error.message} ]`;
    }
  }

  getDescription() {
  return 'Take a snapshot and post it to social media (X or simulated feed).';
  }

  async getSyntax() {
    return `${this.emoji} [description of scene]`;
  }
}
