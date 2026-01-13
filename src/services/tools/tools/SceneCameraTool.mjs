/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { BasicTool } from '../BasicTool.mjs';

/**
 * SceneCameraTool
 * Composes a cinematic scene image that includes multiple avatars present in the channel
 * and the current location background.
 */
export class SceneCameraTool extends BasicTool {
  constructor({
    aiService,
    googleAIService = null,
    s3Service,
    locationService,
    avatarService,
    logger
  }) {
    super();
    this.name = 'camera';
    this.emoji = '📷';
    this.description = 'Capture a cinematic scene of avatars currently in the channel.';
    this.replyNotification = true;
    this.cooldownMs = 2 * 60 * 1000; // 2 minutes

    this.aiService = aiService;
    this.googleAIService = googleAIService;
    this.s3Service = s3Service;
    this.locationService = locationService;
    this.avatarService = avatarService;
    this.logger = logger || console;
  }

  async execute(message, params, avatar) {
    try {
      const userPrompt = params?.length ? params.join(' ') : '';
      const channelId = message?.channel?.id;
      const guildId = message?.guild?.id || message?.guildId;
      if (!channelId) return '-# [ ❌ Error: Missing channel context. ]';

      // Record activity for the invoking avatar
      try {
        if (avatar && this.avatarService?.updateAvatar) {
          avatar.lastActiveAt = new Date();
          avatar.currentChannelId = channelId;
          await this.avatarService.updateAvatar(avatar);
        }
      } catch (e) {
        this.logger?.debug?.('[SceneCamera] Activity update failed: ' + (e?.message || e));
      }

      // Resolve location and avatars present
      const location = await this.locationService.getLocationByChannelId(channelId).catch(() => null);
      const present = await this.avatarService.getAvatarsInChannel(channelId, guildId).catch(() => []);

      // Select up to 4 avatars (prioritize the calling avatar first if present)
      const list = [];
      if (avatar) list.push(avatar);
      for (const av of present) {
        if (!list.find(x => String(x._id) === String(av._id))) list.push(av);
        if (list.length >= 4) break;
      }

      // Collect images for composition: avatars + location
      const images = [];
      for (const av of list) {
        if (!av?.imageUrl) continue;
        try {
          const buf = await this.s3Service.downloadImage(av.imageUrl);
          images.push({ data: buf.toString('base64'), mimeType: 'image/png', label: 'avatar' });
        } catch (e) {
          this.logger?.warn?.(`[SceneCamera] Failed avatar image: ${e?.message || e}`);
        }
      }
      if (location?.imageUrl) {
        try {
          const buf = await this.s3Service.downloadImage(location.imageUrl);
          images.unshift({ data: buf.toString('base64'), mimeType: 'image/png', label: 'location' });
        } catch (e) {
          this.logger?.warn?.(`[SceneCamera] Failed location image: ${e?.message || e}`);
        }
      }

      const subjectLine = list.map(a => `${a.name || 'Unknown'} ${a.emoji || ''}`.trim()).join(', ');
      const locLine = location ? `${location.name || 'Unknown Location'}` : 'Unknown Location';
      const style = 'cinematic anime style, 16:9, soft lighting, detailed background, cohesive composition, no UI or watermark';
      const compositePrompt = `Create a cinematic scene featuring: ${subjectLine}. Location: ${locLine}. ${userPrompt}`.trim();

      // Build metadata for social media posts
      const metadata = {
        source: 'scene.camera',
        purpose: 'general',
        guildId: guildId,
        context: `${compositePrompt}. ${style}`,
      };
      
      // Add primary avatar info (the one who took the photo)
      if (avatar) {
        metadata.avatarId = String(avatar._id || avatar.id);
        metadata.avatarName = avatar.name;
        metadata.avatarEmoji = avatar.emoji;
      }
      
      // Add location info
      if (location) {
        metadata.locationName = location.name;
        metadata.locationDescription = location.description;
      }

      let imageUrl = null;

      // Prefer composition if we have multiple image sources
      const tryCompose = async (provider) => {
        if (!provider?.composeImageWithGemini || images.length === 0) return null;
        try {
          return await provider.composeImageWithGemini(images, `${compositePrompt}\nRender in ${style}.`, metadata);
        } catch (e) {
          this.logger?.warn?.('[SceneCamera] compose failed: ' + (e?.message || e));
          return null;
        }
      };

      // Fallback to normal generation (with optional richer API)
      const tryGenerate = async (provider) => {
        if (!provider) return null;
        try {
          const basePrompt = `${compositePrompt}. Render in ${style}.`;
          if (typeof provider.generateImageFull === 'function') {
            return await provider.generateImageFull(basePrompt, avatar, location, images.slice(0,1), { aspectRatio: '16:9', ...metadata });
          }
          if (typeof provider.generateImage === 'function') {
            if (provider === this.googleAIService) {
              return await provider.generateImage(basePrompt, '16:9', metadata);
            }
            return await provider.generateImage(basePrompt, images, { aspectRatio: '16:9', ...metadata });
          }
        } catch (e) {
          this.logger?.warn?.('[SceneCamera] generate failed: ' + (e?.message || e));
        }
        return null;
      };

      imageUrl = await tryCompose(this.aiService) || await tryGenerate(this.aiService);
      if (!imageUrl && this.googleAIService) {
        imageUrl = await tryCompose(this.googleAIService) || await tryGenerate(this.googleAIService);
      }

      if (!imageUrl) return '-# [ ❌ Error: Failed to capture scene. ]';
      // FEATURE: After successfully generating an image, trigger lightweight follow-up responses
      // from avatars included in the scene (excluding the invoking avatar which already "spoke").
      // This creates more lively interaction after a camera snapshot.
      try {
        // Defer reactions slightly so the original snapshot post appears first.
        setTimeout(async () => {
          try {
            // Fetch fresh list to avoid stale references; reuse previously selected list for determinism
            const convoMgr = this.configService?.services?.conversationManager;
            const discord = this.discordService;
            if (!convoMgr || !discord) return;
            const channel = await discord.getChannelById?.(channelId) || message.channel;
            if (!channel) return;
            for (const av of list) {
              if (!av || (avatar && String(av._id) === String(avatar._id))) continue;
              // Best-effort ensure model; ignore cooldown for immediate chatter
              try {
                await convoMgr.sendResponse(channel, av, null, { overrideCooldown: true, cascadeDepth: 1 });
              } catch (e) {
                this.logger?.debug?.(`[SceneCamera] follow-up response failed for ${av.name}: ${e.message}`);
              }
            }
          } catch (inner) {
            this.logger?.debug?.('[SceneCamera] follow-up scheduling error: ' + (inner?.message || inner));
          }
        }, 1500);
      } catch {}
      return `-# [ ${this.emoji} [Scene](${imageUrl}) ]`;
    } catch (err) {
      return `-# [ ❌ Error: ${err?.message || err} ]`;
    }
  }

  getDescription() { return this.description; }
  async getSyntax() { return `${this.emoji} [optional description of the scene]`; }
}
