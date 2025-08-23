/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

// PotionTool.mjs
import { BasicTool } from '../BasicTool.mjs';

export class PotionTool extends BasicTool {
  static requiredServices = [
    'avatarService',
    'itemService',
    'discordService',
    'logger',
  ];

  constructor({ avatarService, itemService, discordService, logger }) {
    super();
    this.avatarService = avatarService;
    this.itemService = itemService;
    this.discordService = discordService;
    this.logger = logger || console;

    this.name = 'potion';
    this.description = 'Ensure your personal, soulbound healing potion (recharges every 48h). Optionally select or store it.';
    this.emoji = '🧪';
    this.replyNotification = true;
  }

  async execute(message, params, avatar) {
    try {
      if (!message.channel?.guild) {
        return `-# [${this.emoji} This command can only be used in a guild!]`;
      }
      const behavior = (params?.[0] || '').toLowerCase(); // select|store|''
      const potion = await this.itemService.ensureSoulboundPotion(avatar, { healValue: 10 });

      // Optionally place it
      let placed = '';
      if (behavior === 'select' || !avatar.selectedItemId) {
        avatar.selectedItemId = potion._id;
        if (avatar.storedItemId && avatar.storedItemId.equals?.(potion._id)) {
          avatar.storedItemId = null;
        }
        placed = ' (selected)';
        await this.avatarService.updateAvatar(avatar);
      } else if (behavior === 'store' || !avatar.storedItemId) {
        if (!avatar.storedItemId || (avatar.storedItemId && !avatar.storedItemId.equals?.(potion._id))) {
          avatar.storedItemId = potion._id;
          placed = ' (stored)';
          await this.avatarService.updateAvatar(avatar);
        }
      }

      // Post item visuals and details
      try {
        await this.discordService.sendAsWebhook(message.channel.id, potion.imageUrl, potion);
        await this.discordService.sendAsWebhook(message.channel.id, `**${potion.name}**\n\n${potion.description}`, potion);
      } catch {}

      const charges = Number(potion?.properties?.charges ?? 0);
      const rechargeAt = Number(potion?.properties?.rechargeAt ?? 0);
      const status = charges > 0
        ? `Ready to use. Charges: ${charges}.`
        : rechargeAt
          ? `Recharging. Ready <t:${Math.floor(rechargeAt/1000)}:R>.`
          : 'Recharging soon.';

      return `-# [${this.emoji} Ensured your Soulbound Potion${placed}. ${status}]`;
    } catch (err) {
      this.logger?.error?.('[PotionTool] Error:', err);
      return `-# [ ❌ Error ensuring potion: ${err.message} ]`;
    }
  }

  getDescription() {
    return 'Ensure your personal, soulbound healing potion (48h recharge). Optionally select or store it.';
  }

  async getSyntax() {
    return '🧪 [select|store]';
  }
}
