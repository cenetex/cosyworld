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

  // Video generation controls
  // Always two-phase: battle image first, then video from that image only
  // Optional: enable videos for critical hits and/or deaths with probability
  const env = (k, d) => (process.env[k] ?? d);
  this.enableCriticalHitVideo = env('BATTLE_VIDEO_CRITICAL_ENABLED', 'true') === 'true';
  this.enableDeathVideo = env('BATTLE_VIDEO_DEATH_ENABLED', 'true') === 'true';
  this.criticalHitVideoChance = Math.max(0, Math.min(1, parseFloat(env('BATTLE_VIDEO_CRITICAL_CHANCE', '0.5')) || 0.5));
  this.deathVideoChance = Math.max(0, Math.min(1, parseFloat(env('BATTLE_VIDEO_DEATH_CHANCE', '1')) || 1));
  }

  async execute(message, params, avatar, services) {
    if (!params || !params[0]) {
      // Attempt AI intent parse if encounter active
      const encounterService = services?.combatEncounterService;
      if (encounterService) {
        try {
          const locationResult = await this.mapService.getLocationAndAvatars(message.channel.id);
          const intent = await encounterService.parseCombatIntent({ messageContent: message.content, avatarsInLocation: locationResult?.avatars || [] });
          if (intent?.action === 'attack' && intent?.target) {
            params = [intent.target];
          } else {
            return `-# [ ❌ Error: No target specified. ]`;
          }
        } catch {
          return `-# [ ❌ Error: No target specified. ]`;
        }
      } else {
        return `-# [ ❌ Error: No target specified. ]`;
      }
    }

    const targetName = params.join(' ').trim();

    try {
      // Find defender in location
      const locationResult = await this.mapService.getLocationAndAvatars(message.channel.id);
      if (!locationResult || !locationResult.location || !Array.isArray(locationResult.avatars)) {
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
      // Ensure encounter exists & both combatants present (no human command layer yet)
      try {
        const encounterService = services?.combatEncounterService;
        if (encounterService?.ensureEncounterForAttack) {
          const encounter = await encounterService.ensureEncounterForAttack({ channelId: message.channel.id, attacker: avatar, defender, sourceMessage: message });
          // Turn enforcement
          if (!encounterService.isTurn(encounter, avatar.id || avatar._id)) {
            return `-# ⏳ [ It's not **${avatar.name}**'s turn. ]`;
          }
        }
      } catch (e) {
        this.logger?.warn?.(`[AttackTool] encounter ensure failed: ${e.message}`);
      }
      // Delegate to battleService
      const result = await this.battleService.attack({ message, attacker: avatar, defender, services });
    // On attack outcomes that land, generate composite battle image
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

          // Build a strong scene prompt ensuring BOTH combatants appear in-frame
          const deathScene = `Final blow moment: ${avatar.name} defeats ${defender.name}. BOTH characters visible in the same shot, decisive impact, dramatic particles, 16:9 widescreen. Do NOT render a solo portrait; include both fighters.`;
          const koScene = `Knockout moment: ${avatar.name} drops ${defender.name}. BOTH characters visible in the same shot, dramatic impact, 16:9 widescreen. No solo portraits.`;
          const hitScene = `Cinematic strike: ${avatar.name} hits ${defender.name}. BOTH characters visible in the same shot, dynamic action, 16:9 widescreen. No solo portraits.`;
          const scenePrompt = result.result === 'dead' ? deathScene : (result.result === 'knockout' ? koScene : hitScene);

          // Helper tries compose then generate on a given provider
          const tryProvider = async (provider) => {
            if (!provider) return null;
            try {
              if (typeof provider.composeImageWithGemini === 'function') {
                const composed = await provider.composeImageWithGemini(
                  images,
                  scenePrompt
                );
                if (composed) return composed;
              }
            } catch (e) {
              this.logger?.warn?.(`[AttackTool] compose attempt failed: ${e.message}`);
            }
            try {
              if (typeof provider.generateImage === 'function') {
                const prompt = `${scenePrompt}\nDetails: ${avatar.name} (${avatar.description || 'attacker'}) vs ${defender.name} (${defender.description || 'defender'}).`;
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

          // Two-phase rule: only consider video generation if we successfully produced a battle scene image
          let videoUrl = null;
          const isCritical = !!result.critical;
          const isDeath = result.result === 'dead';
          const wantCriticalVideo = this.enableCriticalHitVideo && isCritical && Math.random() < this.criticalHitVideoChance;
          const wantDeathVideo = this.enableDeathVideo && isDeath && Math.random() < this.deathVideoChance;
          const allowVideo = !!this.veoService && (wantCriticalVideo || wantDeathVideo);

          // Optional rate limit gate if available
          const rateOk = !this.veoService?.checkRateLimit || this.veoService.checkRateLimit();

          if (imageUrl && allowVideo && rateOk) {
            try {
              // Always download the composed battle scene and use that as the sole source for video generation
              const sceneBuf = await this.s3Service.downloadImage(imageUrl);
              const baseImages = [{ data: sceneBuf.toString('base64'), mimeType: 'image/png', label: 'scene' }];
              const prompt = isDeath
                ? `Cinematic slow-motion final blow as ${avatar.name} defeats ${defender.name}. Epic, dramatic, particle effects.`
                : `Explosive critical hit by ${avatar.name} against ${defender.name}, dynamic camera, sparks, energy burst.`;
              const videos = await this.veoService.generateVideosFromImages({ prompt, images: baseImages });
              videoUrl = Array.isArray(videos) && videos[0];
            } catch (e) {
              this.logger?.warn?.(`[AttackTool] Veo video generation failed: ${e.message}`);
            }
          }

          if (imageUrl || videoUrl) {
            let extra = '';
            if (imageUrl) extra += `\n-# [ ${this.emoji} [Battle Scene](${imageUrl}) ]`;
            if (videoUrl) extra += `\n-# 🎬 [${isDeath ? 'Final Blow' : 'Critical Hit'} Clip](${videoUrl})`;
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