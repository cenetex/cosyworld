/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

// ItemTool.mjs
import { BasicTool } from '../BasicTool.mjs';

export class ItemTool extends BasicTool {
  /**
   * List of services required by this tool.
   * @type {string[]}
   **/
  static requiredServices = [
    'avatarService',
    'itemService',
    'discordService',
  ];
  constructor({
    avatarService,
    itemService,
    discordService,
    logger,
  }) {
    super();

    this.avatarService = avatarService;
    this.itemService = itemService;
    this.discordService = discordService;
    this.logger = logger;
    
    this.name = 'item';
  this.description = 'Manage items: take, drop, use, store, craft, or get your soulbound potion. Usage: 📦 take <item>, 📦 drop <item>, 📦 use, 📦 store, 📦 craft <item1> <item2>, or 📦 potion [select|store].';
    this.emoji = '📦';
    this.replyNotification = true;
  }

  /**
   * Get parameter schema for LLM tool calling
   */
  getParameterSchema() {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['use', 'craft', 'take', 'drop', 'store', 'potion'],
          description: 'The item action to perform'
        },
        target: {
          type: 'string',
          description: 'Item name or additional parameters (for take, drop, craft actions)'
        }
      },
      required: ['action']
    };
  }

  async postItemDetails(channelId, item) {
    await this.discordService.sendAsWebhook(channelId, item.imageUrl, item);
    await this.discordService.sendAsWebhook(channelId, `**${item.name}**\n\n${item.description}`, item);
  }

  async execute(message, params, avatar, services = {}) {
    if (!message.channel.guild) {
      return `-# [${this.emoji} This command can only be used in a guild!]`;
    }
    if (!params || params.length < 1) {
      return `-# [${this.emoji} Usage: !item <use|craft|take|drop|store|potion> [params]]`;
    }

    // No longer using avatar.inventory; only selectedItemId and storedItemId (item IDs)
    const subcommand = params[0].toLowerCase();
    const locationId = message.channel.id;
    const db = this.avatarService.db;

    try {
      switch (subcommand) {
        case 'use': {
          if (!avatar.selectedItemId) {
            return `-# [${this.emoji} You have no selected item to use.]`;
          }
          const item = await db.collection('items').findOne({ _id: avatar.selectedItemId });
          if (!item) {
            return `-# [${this.emoji} Selected item not found in inventory.]`;
          }
          const extraContext = params.slice(1).join(' ').trim();
          const response = await this.itemService.useItem(avatar, item, message.channel.id, extraContext, services);
          return response;
        }
        case 'take': {
          const itemName = params.slice(1).join(' ').trim();
          if (!itemName) {
            return `-# [${this.emoji} Specify the name of the item to take.]`;
          }
          if (avatar.selectedItemId && avatar.storedItemId) {
            return `-# [${this.emoji} You can only hold 2 items. Use 'store' or 'drop' to free a slot.]`;
          }
          let item = await this.itemService.takeItem(avatar, itemName, locationId);
          if (!item) {
            // No item found at location, try to create one
            item = await this.itemService.findOrCreateItem(itemName, locationId);
            if (!item) {
              return `-# [${this.emoji} No item named "${itemName}" found, and item creation failed or daily limit reached.]`;
            }
            // Assign the new item to the avatar
            await this.itemService.assignItemToAvatar(avatar._id, item);
          }
          // Assign to selected or stored slot
          if (!avatar.selectedItemId) {
            avatar.selectedItemId = item._id;
          } else {
            avatar.storedItemId = item._id;
          }
          await this.avatarService.updateAvatar(avatar);
          await this.postItemDetails(message.channel.id, item);
          return `-# [${this.emoji} You picked up ${item.name}.]`;
        }
        case 'store': {
          if (!avatar.selectedItemId) {
            return `-# [${this.emoji} You have no selected item to store.]`;
          }
          if (avatar.storedItemId) {
            // Swap selected and stored
            const temp = avatar.selectedItemId;
            avatar.selectedItemId = avatar.storedItemId;
            avatar.storedItemId = temp;
            await this.avatarService.updateAvatar(avatar);
            return `-# [${this.emoji} Swapped your held and stored items.]`;
          } else {
            avatar.storedItemId = avatar.selectedItemId;
            avatar.selectedItemId = null;
            await this.avatarService.updateAvatar(avatar);
            return `-# [${this.emoji} Stored your current item. You can now take another.]`;
          }
        }
        case 'drop': {
          // Drop selected or named item
          let itemId = null;
          let item = null;
          const itemName = params.slice(1).join(' ').trim();
          if (itemName) {
            // Try to find closest match among held items
            const heldIds = [avatar.selectedItemId, avatar.storedItemId].filter(Boolean);
            const heldItems = heldIds.length > 0 ? (await db.collection('items').find({ _id: { $in: heldIds } }).toArray()) : [];
            item = this.findClosestItem(heldItems, itemName);
            itemId = item ? item._id : null;
          }

          if (!itemId && avatar.selectedItemId) {
            itemId = avatar.selectedItemId;
          }

          if (!itemId) {
            return `-# [${this.emoji} No item specified or found to drop.]`;
          }
          // Fetch item and attempt to drop first (prevents clearing slots if disallowed)
          item = await db.collection('items').findOne({ _id: itemId });
          const dropped = await this.itemService.dropItem(avatar, item, locationId);
          if (!dropped) {
            return `-# [${this.emoji} You cannot drop ${item?.name || 'that item'} (it may be soulbound).]`;
          }
          // Remove from avatar only after successful drop
          if (avatar.selectedItemId && avatar.selectedItemId.equals(itemId)) avatar.selectedItemId = null;
          if (avatar.storedItemId && avatar.storedItemId.equals(itemId)) avatar.storedItemId = null;
          await this.avatarService.updateAvatar(avatar);
          return `-# [${this.emoji} You dropped ${item.name}.]`;
        }
        case 'potion': {
          // Ensure the avatar has their soulbound, recharging healing potion
          const behavior = (params[1] || '').toLowerCase(); // optional: select|store
          const potion = await this.itemService.ensureSoulboundPotion(avatar, { healValue: 10 });
          let placed = '';
          // Optionally select or store it for convenience
          if (behavior === 'select' || (!avatar.selectedItemId)) {
            avatar.selectedItemId = potion._id;
            if (avatar.storedItemId && avatar.storedItemId.equals(potion._id)) {
              avatar.storedItemId = null;
            }
            placed = ' (selected)';
            await this.avatarService.updateAvatar(avatar);
          } else if (behavior === 'store' || !avatar.storedItemId) {
            if (!avatar.storedItemId || (avatar.storedItemId && !avatar.storedItemId.equals(potion._id))) {
              avatar.storedItemId = potion._id;
              placed = ' (stored)';
              await this.avatarService.updateAvatar(avatar);
            }
          }

          // Show the item and status
          try { await this.postItemDetails(message.channel.id, potion); } catch {}
          const charges = Number(potion?.properties?.charges ?? 0);
          const rechargeAt = Number(potion?.properties?.rechargeAt ?? 0);
          let status = charges > 0
            ? `Ready to use. Charges: ${charges}.`
            : rechargeAt
              ? `Recharging. Ready <t:${Math.floor(rechargeAt/1000)}:R>.`
              : 'Recharging soon.';
          return `-# [${this.emoji} Ensured your Soulbound Potion${placed}. ${status}]`;
        }
        case 'craft': {
          if (!avatar.selectedItemId || !avatar.storedItemId) {
            return `-# [${this.emoji} You must hold two items to craft.]`;
          }
          const item1 = await db.collection('items').findOne({ _id: avatar.selectedItemId });
          const item2 = await db.collection('items').findOne({ _id: avatar.storedItemId });
          if (!item1 || !item2) {
            return `-# [${this.emoji} You do not have the specified items in your inventory.]`;
          }
          const inputItems = [item1, item2];
          const newItem = await this.itemService.createCraftedItem(inputItems, avatar._id);
          if (!newItem) {
            return `-# [${this.emoji} Cannot craft item: daily item creation limit reached or failed to generate item.]`;
          }
          // Remove both from avatar, add new crafted item
          avatar.selectedItemId = newItem._id;
          avatar.storedItemId = null;
          await this.avatarService.updateAvatar(avatar);
          await this.postItemDetails(message.channel.id, newItem);
          return `-# [${this.emoji} You have crafted a new item: ${newItem.name}]`;
        }
        default:
          return `-# [${this.emoji} Invalid subcommand. Use !item <use|craft|take|drop|store|potion> [params]]`;
      }
    } catch (error) {
      this.logger?.error('Error in ItemTool execute:', error);
      return `-# [ ❌ Error: Failed to process item command: ${error.message} ]`;
    }
  }

  findClosestItem(items, query) {
    if (!items || items.length === 0) return null;
    query = query.toLowerCase();
    let bestMatch = null;
    let bestScore = Infinity;
    for (const item of items) {
      const name = item.name.toLowerCase();
      const dist = this.levenshteinDistance(query, name);
      if (dist < bestScore) {
        bestScore = dist;
        bestMatch = item;
      }
    }
    // Accept only reasonably close matches
    return bestScore <= Math.max(3, query.length / 2) ? bestMatch : null;
  }

  levenshteinDistance(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    return matrix[b.length][a.length];
  }

  getDescription() {
  return 'Manage items: take, drop, use, store, craft, or get your soulbound potion. Usage: 📦 take <item>, 📦 drop <item>, 📦 use, 📦 store, 📦 craft <item1> <item2>, or 📦 potion [select|store].';
  }

  async getSyntax() {
  return '📦 take|use|store|craft|drop|potion <item1> <item2>';
  }
}