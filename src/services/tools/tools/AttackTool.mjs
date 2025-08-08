/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { BasicTool } from '../BasicTool.mjs';

export class AttackTool extends BasicTool {
  constructor({
    logger,
    configService,
    avatarService,
    databaseService,
    statService,
    mapService,
    conversationManager,
    diceService,
    battleService,
    aiService,
  googleAIService,
    s3Service,
  veoService,
  discordService,
  }) {

    super();
    this.logger = logger || console;
    this.configService = configService;
    this.avatarService = avatarService;
    this.databaseService = databaseService;
    this.statService = statService;
    this.mapService = mapService;
    this.conversationManager = conversationManager;
    this.diceService = diceService;
    this.battleService = battleService;
    this.aiService = aiService;
  this.discordService = discordService;
  // Optional secondary googleAIService for image/video if primary provider (e.g., OpenRouter) lacks it
  this.googleAIService = googleAIService;
    this.s3Service = s3Service;
  this.veoService = veoService; // optional video generation

    this.name = 'attack';
    this.parameters = '<target>';
    this.description = 'Attacks the specified avatar';
    this.emoji = '⚔️';
    this.replyNotification = true;
    this.cooldownMs = 30 * 1000; // 30 seconds cooldown
  }

  async execute(message, params, avatar, services) {
    if (!params || !params[0]) {
      return `-# [ ❌ Error: No target specified. ]`;
    }

  const targetName = params.join(' ');

    try {
      // Find defender in location
      const locationResult = await this.mapService.getLocationAndAvatars(message.channel.id);
      if (!locationResult || !locationResult.location || !locationResult.avatars) {
        return `-# 🤔 [ The avatar can't be found! ]`;
      }
      const defender = locationResult.avatars.find(a => a.name.toLowerCase() === targetName.toLowerCase());
      if (!defender) {
        // React to source message to indicate invalid local target without verbose reply
        if (this.discordService?.reactToMessage) {
          this.discordService.reactToMessage(message, '👀');
        }
        return `-# 🫠 [ Target '${targetName}' not found here. ]`;
      }
      if (defender.status === 'dead') {
        return `-# ⚰️ [ **${defender.name}** is already dead! Have some *respect* for the fallen. ]`;
      }
      // Delegate to battleService
      const result = await this.battleService.attack({ message, attacker: avatar, defender, services });
      // On hit, generate composite battle image
  if ((result.result === 'hit' || result.result === 'dead' || result.result === 'knockout') && this.s3Service) {
        try {
          const images = [];
          if (avatar.imageUrl) {
            const buf = await this.s3Service.downloadImage(avatar.imageUrl);
            images.push({ data: buf.toString('base64'), mimeType: 'image/png', label: 'attacker' });
          }
          if (defender.imageUrl) {
            const buf = await this.s3Service.downloadImage(defender.imageUrl);
            images.push({ data: buf.toString('base64'), mimeType: 'image/png', label: 'defender' });
          }
          const locImgUrl = locationResult.location?.imageUrl;
          if (locImgUrl) {
            const buf = await this.s3Service.downloadImage(locImgUrl);
            images.push({ data: buf.toString('base64'), mimeType: 'image/png', label: 'location' });
          }
          // Limit to three images
          images.splice(3);
          let imageUrl;
          const primary = this.aiService;
          const secondary = this.googleAIService && this.googleAIService !== primary ? this.googleAIService : null;

          // Helper tries compose then generate on a given provider
          const tryProvider = async (provider) => {
            if (!provider) return null;
            try {
              if (typeof provider.composeImageWithGemini === 'function') {
                const composed = await provider.composeImageWithGemini(
                  images,
                  `Generate a cinematic battle scene of ${avatar.name} attacking ${defender.name}.`
                );
                if (composed) return composed;
              }
            } catch (e) {
              this.logger?.warn?.(`[AttackTool] compose attempt failed: ${e.message}`);
            }
            try {
              if (typeof provider.generateImage === 'function') {
                const prompt = `Cinematic battle scene of ${avatar.name}, ${avatar.description} attacking ${defender.name}, ${defender.description}.`;
                const gen = await provider.generateImage(prompt);
                if (gen) return gen;
              }
            } catch (e) {
              this.logger?.warn?.(`[AttackTool] generate attempt failed: ${e.message}`);
            }
            return null;
          };

          // Try primary provider first
          imageUrl = await tryProvider(primary);
          // Fallback to secondary (Google) if primary failed
            if (!imageUrl) imageUrl = await tryProvider(secondary);

          let videoUrl = null;
          const shouldGenerateVideo = this.veoService && (result.critical || result.result === 'dead');
          if (shouldGenerateVideo) {
            try {
              // Use any existing composed image (download it) or first source image for video generation
              let baseImages = images;
              if (!baseImages.length && imageUrl) {
                try {
                  const buf = await this.s3Service.downloadImage(imageUrl);
                  baseImages = [{ data: buf.toString('base64'), mimeType: 'image/png', label: 'scene' }];
                } catch {}
              }
              if (baseImages.length) {
                const prompt = result.result === 'dead'
                  ? `Cinematic slow-motion final blow as ${avatar.name} defeats ${defender.name}. Epic, dramatic, particle effects.`
                  : `Explosive critical hit by ${avatar.name} against ${defender.name}, dynamic camera, sparks, energy burst.`;
                const videos = await this.veoService.generateVideosFromImages({ prompt, images: baseImages });
                videoUrl = Array.isArray(videos) && videos[0];
              }
            } catch (e) {
              this.logger?.warn?.(`[AttackTool] Veo video generation failed: ${e.message}`);
            }
          }

          if (imageUrl || videoUrl) {
            let extra = '';
            if (imageUrl) extra += `\n-# [ ${this.emoji} [Battle Scene](${imageUrl}) ]`;
            if (videoUrl) extra += `\n-# 🎬 [Battle Clip](${videoUrl})`;
            return `${result.message}${extra}`;
          }
        } catch (err) {
          this.logger.error(`Image generation error: ${err.message}`);
        }
      }
      return result.message;
    } catch (error) {
      this.logger.error(`Attack error: ${error.message}`);
      return `-# [ ❌ Error: Attack failed. Please try again later. ]`;
    }
  }

  getDescription() {
    return 'Attack another avatar';
  }

  async getSyntax() {
    return `${this.emoji} <target>`;
  }
}