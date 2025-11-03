/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { BasicTool } from '../BasicTool.mjs';

export class DevilTool extends BasicTool {
  constructor({ aiService, s3Service, locationService, avatarService, veoService, googleAIService = null }) {
    super();
    this.aiService = aiService;
    this.s3Service = s3Service;
    this.locationService = locationService;
    this.avatarService = avatarService;
    this.veoService = veoService;
    this.googleAIService = googleAIService; // optional fallback for image gen/compose

    this.name = 'corrupted whispers';
    this.emoji = '😈';
    this.description = 'Generate a corrupted image of the simulation based on a prompt and the avatars in the channel.';
    this.showInHelp = false;

    this.replyNotification = true;
    this.cooldownMs = 10 * 60 * 1000; // 10 minutes cooldown
    this.videoGenerationChance = 0.1;
  }

  async execute(message, params, avatar) {
    try {
      const prompt = params.length
        ? params.join(' ')
        : 'A corrupted image of the simulation.';
      const images = [];

      // Download the avatar image
      const avatarImageUrl = avatar.imageUrl;
      let avatarImage;
      if (avatarImageUrl) {
        const buf = await this.s3Service.downloadImage(avatarImageUrl);
        avatarImage = { data: buf.toString('base64'), mimeType: 'image/png', label: 'avatar' };
      }

      // Gather avatar images
      const channelAvatars = await this.avatarService.getAvatarsInChannel(message.channel.id, message.guildId);
      const mentioned = Array.from(
        this.avatarService.extractMentionedAvatars(message.content, channelAvatars)
      );
      mentioned.sort(() => Math.random() - 0.5);
      mentioned.splice(3); // Limit to 3 images
      for (const av of mentioned) {
        if (av.imageUrl) {
          const buf = await this.s3Service.downloadImage(av.imageUrl);
          images.push({ data: buf.toString('base64'), mimeType: 'image/png', label: 'avatar' });
        }
      }

      // Gather location image
      const location = await this.locationService.getLocationByChannelId(message.channel.id);
      if (location?.imageUrl) {
        const buf = await this.s3Service.downloadImage(location.imageUrl);
        images.push({ data: buf.toString('base64'), mimeType: 'image/png', label: 'location' });
      }

  // Compose using primary AI service first, then Google fallback if available
  let imageUrl;
  if (images.length > 0 && this.aiService?.composeImageWithGemini) {
        // shuffule images
        images.sort(() => Math.random() - 0.5);

        // Add avatar image if available
        if (avatarImage) {
          images.unshift(avatarImage);
        }

        // Add location image if available  
        if (location?.imageUrl) {
          const buf = await this.s3Service.downloadImage(location.imageUrl);
          images.unshift({ data: buf.toString('base64'), mimeType: 'image/png', label: 'location' });
        }


        // Limit to 3 images
        images.splice(3);
        // Compose image with Gemini
        imageUrl = await this.aiService.composeImageWithGemini(images,
          `Generate an image of the simulation based on the following prompt,
           \n\n${prompt}\n\n 
          only generate a hazy 80s dark cinematic anime style widescreen image:`,
        );
      }
      // If primary compose failed and Google is available, try Google compose
      if (!imageUrl && images.length > 0 && this.googleAIService?.composeImageWithGemini) {
        try {
          imageUrl = await this.googleAIService.composeImageWithGemini(images,
            `Generate an image of the simulation based on the following prompt,
             \n\n${prompt}\n\n 
            only generate a hazy 80s dark cinematic anime style widescreen image:`,
          );
        } catch (e) {
          this.logger?.warn?.('Google compose fallback failed:', e?.message || e);
        }
      }
      // Fallback to standard generation
      if (!imageUrl) {
        // Try primary service simple generation first
        imageUrl = await this.aiService.generateImage(prompt).catch(() => null);
      }
      if (!imageUrl && this.googleAIService) {
        try {
          // Prefer full-featured Google generation if avatar/location available for richer context
          imageUrl = await (this.googleAIService.generateImageFull
            ? this.googleAIService.generateImageFull(prompt, avatar, location, [], { aspectRatio: '16:9' })
            : this.googleAIService.generateImage(prompt, '16:9'));
        } catch (e) {
          this.logger?.warn?.('Google image generation fallback failed:', e?.message || e);
        }
      }
      if (!imageUrl) return '-# [ ❌ Error: Failed to generate Corrupted Whispers image. ]';

      // If veoService is available, generate video(s) from the corrupted image (now async rate check)
      if (this.veoService && Math.random() < this.videoGenerationChance && (await this.veoService.checkRateLimit())) {
        try {
          const buf = await this.s3Service.downloadImage(imageUrl);
          const base64 = buf.toString('base64');
          const videoUris = await this.veoService.generateVideosFromImages({
            prompt,
            images: [{ data: base64, mimeType: 'image/png' }],
            config: { aspectRatio: '16:9', numberOfVideos: 1  }
          });
          if (videoUris.length > 0) {
            return videoUris.map(uri => `-# [ ${this.emoji} [Corrupted Video](${uri}) ]`).join('\n');
          }
        } catch (videoErr) {
          this.logger?.error('Error generating corrupted video:', videoErr);
        }
      }

      // Fallback to image link
      return `-# [ ${this.emoji} [Corrupted Whispers](${imageUrl}) ]`;
    } catch (err) {
      return `-# [ ❌ Error: ${err.message} ]`;
    }
  }

  getDescription() {
    return this.description;
  }

  async getSyntax() {
    return `${this.emoji} [shield prompt]`;
  }
}
