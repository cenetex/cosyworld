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

  async execute(message, params, avatar, services) {
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
        
        this.logger?.info?.(`[PotionTool] Searching for avatar: "${targetName}" in channel: ${message.channel.id}`);
        
        // First, get all avatars in this channel/location
        const { avatars: channelAvatars } = await this.avatarService.getMapService().getLocationAndAvatars(message.channel.id);
        
        this.logger?.info?.(`[PotionTool] Found ${channelAvatars?.length || 0} avatars in channel`);
        
        // Find target by name
        let targetAvatar = channelAvatars?.find(av => 
          av.name.toLowerCase() === targetName.toLowerCase()
        );
        
        // If not found, try partial match
        if (!targetAvatar) {
          this.logger?.info?.(`[PotionTool] Exact match failed, trying partial match`);
          targetAvatar = channelAvatars?.find(av => 
            av.name.toLowerCase().includes(targetName.toLowerCase())
          );
        }
        
        // If still not found, list available avatars
        if (!targetAvatar) {
          const avatarList = channelAvatars?.map(a => `${a.name} (${a.status || 'active'})`).join(', ') || 'none';
          this.logger?.info?.(`[PotionTool] Available avatars: ${avatarList}`);
          return `-# [${this.emoji} Avatar "${targetName}" not found. Available: ${avatarList}]`;
        }
        
        this.logger?.info?.(`[PotionTool] Found avatar: ${targetAvatar.name}, status: ${targetAvatar.status}`);

        
        // Check if target is knocked out
        if (targetAvatar.status !== 'knocked_out' && targetAvatar.status !== 'dead') {
          return `-# [${this.emoji} ${targetAvatar.name} is not knocked out and doesn't need revival.]`;
        }
        
        // Get the user's potion
        const potion = await this.itemService.ensureSoulboundPotion(avatar, { healValue: 10 });
        
        // Check if potion has charges
        const charges = Number(potion?.properties?.charges ?? 0);
        const rechargeAt = Number(potion?.properties?.rechargeAt ?? 0);
        
        // If no charges (and not yet recharged), exit
        if (charges <= 0) {
          const timeRemaining = rechargeAt ? `<t:${Math.floor(rechargeAt/1000)}:R>` : 'soon';
          return `-# [${this.emoji} Your potion has no charges. It will recharge ${timeRemaining}.]`;
        }
        
        // Use the potion - consume a charge
        await this.itemService.consumeSoulboundPotion(potion);

        // Revive the target avatar
        targetAvatar.status = 'active';
        targetAvatar.knockedOutUntil = null;
        await this.avatarService.updateAvatar(targetAvatar);

        // If target is in an active encounter, sync revival to encounter combatant
        try {
          const ces = services?.combatEncounterService;
          if (ces) {
            const encounter = ces.getEncounter?.(message.channel.id) || 
                              ces.getEncounterByChannelId?.(message.channel.id);
            if (encounter?.state === 'active') {
              const combatant = ces.getCombatant?.(encounter, targetAvatar._id);
              if (combatant) {
                // Restore to potion heal value and remove unconscious condition
                const healValue = Number(potion?.properties?.healValue ?? 10);
                combatant.currentHp = Math.max(combatant.currentHp || 0, healValue);
                combatant.conditions = (combatant.conditions || []).filter(c => c !== 'unconscious' && c !== 'dead');
                this.logger?.info?.(`[PotionTool] Synced revival of ${targetAvatar.name} to encounter (${combatant.currentHp} HP)`);
              }
            }
          }
        } catch (e) {
          this.logger?.warn?.(`[PotionTool] Encounter sync failed: ${e.message}`);
        }
        
        // Post success message
        const newCharges = Number(potion?.properties?.charges ?? 0);
        const newRechargeAt = Number(potion?.properties?.rechargeAt ?? 0);
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
