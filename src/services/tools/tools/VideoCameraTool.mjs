/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { BasicTool } from '../BasicTool.mjs';

/**
 * VideoCameraTool
 * Captures a scene (like SceneCameraTool) and requests a short video clip via VeoService.
 */
export class VideoCameraTool extends BasicTool {
  constructor({
    aiService,
    googleAIService = null,
    veoService,
    s3Service,
    locationService,
    avatarService,
    logger
  }) {
    super();
    this.name = 'video camera';
    this.emoji = '🎥';
    this.description = 'Capture a cinematic scene as a short video with avatars present in the channel.';
    this.replyNotification = true;
    this.cooldownMs = 10 * 60 * 1000; // 10 minutes

    this.aiService = aiService;
    this.googleAIService = googleAIService;
    this.veoService = veoService;
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

      // Gather location and present avatars
      const location = await this.locationService.getLocationByChannelId(channelId).catch(() => null);
      const present = await this.avatarService.getAvatarsInChannel(channelId, guildId).catch(() => []);

      // Select up to 4 avatars, include calling avatar first
      const list = [];
      if (avatar) list.push(avatar);
      for (const av of present) {
        if (!list.find(x => String(x._id) === String(av._id))) list.push(av);
        if (list.length >= 4) break;
      }

      // Prepare images for composition
      const images = [];
      for (const av of list) {
        if (!av?.imageUrl) continue;
        try {
          const buf = await this.s3Service.downloadImage(av.imageUrl);
          images.push({ data: buf.toString('base64'), mimeType: 'image/png', label: 'avatar' });
        } catch (e) { this.logger?.warn?.(`[VideoCamera] avatar image: ${e?.message || e}`); }
      }
      if (location?.imageUrl) {
        try {
          const buf = await this.s3Service.downloadImage(location.imageUrl);
          images.unshift({ data: buf.toString('base64'), mimeType: 'image/png', label: 'location' });
        } catch (e) { this.logger?.warn?.(`[VideoCamera] location image: ${e?.message || e}`); }
      }

      const subjectLine = list.map(a => `${a.name || 'Unknown'} ${a.emoji || ''}`.trim()).join(', ');
      const locLine = location ? `${location.name || 'Unknown Location'}` : 'Unknown Location';
      const style = 'cinematic anime style, 16:9, subtle motion, no UI, no watermark';
      const compositePrompt = `Cinematic scene video featuring: ${subjectLine}. Location: ${locLine}. ${userPrompt}`.trim();

      // 1) Create a keyframe image via compose or generation
      let imageUrl = null;
      const tryCompose = async (p) => {
        if (!p?.composeImageWithGemini || images.length === 0) return null;
        try { return await p.composeImageWithGemini(images, `${compositePrompt}\nRender in ${style}.`);
        } catch (e) { this.logger?.warn?.('[VideoCamera] compose failed: ' + (e?.message || e)); return null; }
      };
      const tryGenerate = async (p) => {
        if (!p) return null;
        try {
          const basePrompt = `${compositePrompt}. Render in ${style}.`;
          if (typeof p.generateImageFull === 'function') {
            return await p.generateImageFull(basePrompt, avatar, location, images.slice(0,1), { aspectRatio: '16:9' });
          }
          if (typeof p.generateImage === 'function') {
            if (p === this.googleAIService) return await p.generateImage(basePrompt, '16:9');
            return await p.generateImage(basePrompt, images, { aspectRatio: '16:9' });
          }
        } catch (e) { this.logger?.warn?.('[VideoCamera] generate failed: ' + (e?.message || e)); }
        return null;
      };
      imageUrl = await tryCompose(this.aiService) || await tryGenerate(this.aiService);
      if (!imageUrl && this.googleAIService) {
        imageUrl = await tryCompose(this.googleAIService) || await tryGenerate(this.googleAIService);
      }
      if (!imageUrl) return '-# [ ❌ Error: Failed to capture scene keyframe. ]';

      // 2) Inline video generation using VeoService (like BattleMediaService)
      if (!this.veoService) {
        return `-# [ ${this.emoji} [Scene Keyframe](${imageUrl}) ]`;
      }
      try {
        if (this.veoService?.checkRateLimit && !this.veoService.checkRateLimit()) {
          return `-# [ ${this.emoji} [Scene Keyframe](${imageUrl}) ]\n-# [ video cancelled: rate limit ]`;
        }
        const sceneBuf = await this.s3Service.downloadImage(imageUrl);
        const baseImages = [{ data: sceneBuf.toString('base64'), mimeType: 'image/png', label: 'scene' }];
        const videos = await this.veoService.generateVideosFromImages({ prompt: compositePrompt, images: baseImages, config: { numberOfVideos: 1, personGeneration: "allow_adult" } });
        const vid = Array.isArray(videos) ? videos[0] : null;
        if (vid) {
          return `-# [ ${this.emoji} [Scene Keyframe](${imageUrl}) ]\n-# [ 🎞️ [Scene Clip](${vid}) ]`;
        }
        return `-# [ ${this.emoji} [Scene Keyframe](${imageUrl}) ]`;
      } catch (e) {
        this.logger?.warn?.('[VideoCamera] inline video generation failed: ' + (e?.message || e));
        return `-# [ ${this.emoji} [Scene Keyframe](${imageUrl}) ]`;
      }
    } catch (err) {
      return `-# [ ❌ Error: ${err?.message || err} ]`;
    }
  }

  getDescription() { return this.description; }
  async getSyntax() { return `${this.emoji} [optional description of the scene]`; }
}
