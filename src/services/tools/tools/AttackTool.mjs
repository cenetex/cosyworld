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
    s3Service,
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
    this.s3Service = s3Service;

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
      if (!defender) return `-# 🫠 [ Target '${targetName}' not found in this area. ]`;
      if (defender.status === 'dead') {
        return `-# ⚰️ [ **${defender.name}** is already dead! Have some *respect* for the fallen. ]`;
      }
      // Delegate to battleService
      const result = await this.battleService.attack({ message, attacker: avatar, defender, services });
      // On hit, generate composite battle image
      if (result.result === 'hit' && this.aiService && this.s3Service) {
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
          if (this.aiService.composeImageWithGemini) {
            imageUrl = await this.aiService.composeImageWithGemini(
              images,
              `Generate a cinematic battle scene of ${avatar.name} attacking ${defender.name}.`
            );
          }
          if (!imageUrl) {
            const prompt = `Cinematic battle scene of ${avatar.name}, ${avatar.description} attacking ${defender.name}, ${defender.description}.`;
            imageUrl = await this.aiService.generateImage(prompt);
          }
          if (imageUrl) {
            return `${result.message}\n-# [ ${this.emoji} [Battle Scene](${imageUrl}) ]`;
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