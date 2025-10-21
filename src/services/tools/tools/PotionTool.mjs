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
    this.description = 'Use your soulbound healing potion to revive knocked out avatars, or manage it with select/store. Usage: 🧪 <avatar name> to revive, or 🧪 [select|store] to manage.';
    this.emoji = '🧪';
    this.replyNotification = true;
  }

  async execute(message, params, avatar) {
    try {
      if (!message.channel?.guild) {
        return `-# [${this.emoji} This command can only be used in a guild!]`;
      }
      
      const firstParam = (params?.[0] || '').toLowerCase();
      
      // If first param is 'select' or 'store', manage the potion
      if (firstParam === 'select' || firstParam === 'store') {
        const potion = await this.itemService.ensureSoulboundPotion(avatar, { healValue: 10 });
        let placed = '';
        
        if (firstParam === 'select') {
          avatar.selectedItemId = potion._id;
          if (avatar.storedItemId && avatar.storedItemId.equals?.(potion._id)) {
            avatar.storedItemId = null;
          }
          placed = ' (selected)';
          await this.avatarService.updateAvatar(avatar);
        } else if (firstParam === 'store') {
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
      }
      
      // If param is an avatar name, try to revive that avatar
      if (params && params.length > 0) {
        const targetName = params.join(' ').trim();
        
        // Find the target avatar by name in the same guild
        const db = await this.avatarService.db || await this.avatarService.databaseService.getDatabase();
        const targetAvatar = await db.collection('avatars').findOne({
          guildId: message.channel.guild.id,
          name: { $regex: new RegExp(`^${targetName}$`, 'i') }
        });
        
        if (!targetAvatar) {
          return `-# [${this.emoji} Avatar "${targetName}" not found in this guild.]`;
        }
        
        // Check if target is knocked out
        if (targetAvatar.status !== 'knocked_out' && targetAvatar.status !== 'dead') {
          return `-# [${this.emoji} ${targetAvatar.name} is not knocked out and doesn't need revival.]`;
        }
        
        // Get the user's potion
        const potion = await this.itemService.ensureSoulboundPotion(avatar, { healValue: 10 });
        
        // Check if potion has charges
        const charges = Number(potion?.properties?.charges ?? 0);
        const rechargeAt = Number(potion?.properties?.rechargeAt ?? 0);
        
        // If no charges but recharge time has passed, restore a charge
        if (charges <= 0 && rechargeAt && Date.now() >= rechargeAt) {
          const itemsCol = db.collection('items');
          await itemsCol.updateOne(
            { _id: potion._id },
            { $set: { 'properties.charges': 1, 'properties.rechargeAt': null, updatedAt: new Date() } }
          );
          potion.properties.charges = 1;
          potion.properties.rechargeAt = null;
        } else if (charges <= 0) {
          const timeRemaining = rechargeAt ? `<t:${Math.floor(rechargeAt/1000)}:R>` : 'soon';
          return `-# [${this.emoji} Your potion has no charges. It will recharge ${timeRemaining}.]`;
        }
        
        // Use the potion - consume a charge
        const itemsCol = db.collection('items');
        const newCharges = charges - 1;
        const rechargeMs = Number(potion.properties?.rechargeMs || 48 * 60 * 60 * 1000); // 48 hours default
        const newRechargeAt = newCharges <= 0 ? Date.now() + rechargeMs : null;
        
        await itemsCol.updateOne(
          { _id: potion._id },
          { 
            $set: { 
              'properties.charges': newCharges, 
              'properties.rechargeAt': newRechargeAt,
              updatedAt: new Date() 
            } 
          }
        );
        
        // Revive the target avatar
        const avatarsCol = db.collection('avatars');
        await avatarsCol.updateOne(
          { _id: targetAvatar._id },
          { 
            $set: { 
              status: 'active',
              knockedOutUntil: null,
              updatedAt: new Date()
            } 
          }
        );
        
        // Post success message
        const chargesRemaining = newCharges > 0 ? `${newCharges} charge(s) remaining.` : `Recharging. Ready <t:${Math.floor(newRechargeAt/1000)}:R>.`;
        return `-# [${this.emoji} ${avatar.name} used their potion to revive ${targetAvatar.name}! ${chargesRemaining}]`;
      }
      
      // No params - just show the potion status
      const potion = await this.itemService.ensureSoulboundPotion(avatar, { healValue: 10 });
      
      // Auto-select if no item selected
      let placed = '';
      if (!avatar.selectedItemId) {
        avatar.selectedItemId = potion._id;
        placed = ' (selected)';
        await this.avatarService.updateAvatar(avatar);
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
      return `-# [ ❌ Error with potion: ${err.message} ]`;
    }
  }

  getDescription() {
    return 'Use your soulbound healing potion to revive knocked out avatars, or manage it. Usage: 🧪 <avatar name> to revive, or 🧪 [select|store] to manage.';
  }

  async getSyntax() {
    return '🧪 [<avatar name>|select|store]';
  }
}
