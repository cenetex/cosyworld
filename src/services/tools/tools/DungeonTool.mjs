/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * DungeonTool - D&D dungeon crawling
 */

import { BasicTool } from '../BasicTool.mjs';
import { 
  createDungeonButtons, 
  addComponentsToResponse, 
  addEmbedTextSummary,
  createActionMenu
} from '../dndButtonComponents.mjs';

export class DungeonTool extends BasicTool {
  constructor({ logger, dungeonService, partyService, characterService, discordService, questService, tutorialQuestService }) {
    super();
    this.logger = logger || console;
    this.dungeonService = dungeonService;
    this.partyService = partyService;
    this.characterService = characterService;
    this.discordService = discordService;
    this.questService = questService;
    this.tutorialQuestService = tutorialQuestService;

    this.name = 'dungeon';
    this.parameters = '<action> [options]';
    this.description = 'Dungeon crawling: enter, map, move, clear';
    this.emoji = '🏰';
    this.replyNotification = true;
    this.cooldownMs = 5000;
  }

  getParameterSchema() {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['enter', 'map', 'move', 'clear', 'loot', 'abandon'],
          description: 'Action to perform'
        },
        difficulty: {
          type: 'string',
          enum: ['easy', 'medium', 'hard', 'deadly'],
          description: 'Dungeon difficulty (for enter)'
        },
        room: {
          type: 'string',
          description: 'Room ID to move to'
        }
      },
      required: ['action']
    };
  }

  async execute(message, params, avatar) {
    const action = params[0] || params.action;

    try {
      switch (action) {
        case 'enter':
          return await this._enter(avatar, params);
        case 'map':
          return await this._showMap(avatar);
        case 'move':
          return await this._move(avatar, params);
        case 'clear':
          return await this._clear(avatar);
        case 'loot':
          return await this._loot(avatar);
        case 'abandon':
          return await this._abandon(avatar);
        default:
          return this._errorEmbed(`Unknown action: ${action}. Use: enter, map, move, clear, loot, abandon`);
      }
    } catch (error) {
      this.logger.error('[DungeonTool] Error:', error);
      return this._errorEmbed(error.message);
    }
  }

  _errorEmbed(message) {
    return {
      embeds: [{
        title: '🏰 Dungeon Error',
        description: message,
        color: 0xEF4444 // Red
      }]
    };
  }

  async _enter(avatar, params) {
    const sheet = await this.characterService.getSheet(avatar._id);
    if (!sheet?.partyId) {
      return this._errorEmbed(`${avatar.name} must be in a party to enter a dungeon.`);
    }

    const difficulty = params[1] || params.difficulty || 'medium';
    
    const dungeon = await this.dungeonService.generateDungeon(sheet.partyId, { difficulty });

    // Trigger quest progress (both quest systems)
    await this.questService?.onEvent?.(avatar._id, 'dungeon_entered', { difficulty });
    await this.tutorialQuestService?.onEvent?.(avatar._id, 'dungeon_entered', { difficulty });

    const roomCount = dungeon.rooms.length;
    const firstRoom = dungeon.rooms[0];

    const difficultyColors = { easy: 0x10B981, medium: 0xF59E0B, hard: 0xEF4444, deadly: 0x7C3AED };

    const response = {
      embeds: [{
        title: `🏰 ${dungeon.name}`,
        description: `The party enters a ${dungeon.theme} dungeon...`,
        color: difficultyColors[difficulty] || 0xF59E0B,
        fields: [
          { name: '📊 Difficulty', value: difficulty, inline: true },
          { name: '🚪 Rooms', value: `${roomCount}`, inline: true },
          { name: '🎭 Theme', value: dungeon.theme, inline: true },
          { name: `${this.dungeonService.getRoomEmoji(firstRoom.type)} First Room`, value: this._describeRoom(firstRoom), inline: false }
        ]
      }]
    };
    
    // Add dungeon action buttons
    const buttons = createDungeonButtons({ 
      currentRoom: firstRoom.id, 
      exits: [], 
      roomCleared: false 
    });
    return addEmbedTextSummary(addComponentsToResponse(response, buttons));
  }

  async _showMap(avatar) {
    const sheet = await this.characterService.getSheet(avatar._id);
    if (!sheet?.partyId) {
      return this._errorEmbed(`${avatar.name} is not in a party.`);
    }

    const dungeon = await this.dungeonService.getActiveDungeon(sheet.partyId);
    if (!dungeon) {
      return this._errorEmbed('No active dungeon. Use 🏰 dungeon enter to start one.');
    }

    const map = this.dungeonService.getDungeonMap(dungeon);

    // Trigger quest progress (both quest systems)
    await this.questService?.onEvent?.(avatar._id, 'map_viewed');
    await this.tutorialQuestService?.onEvent?.(avatar._id, 'dungeon_map_viewed');

    const mapDisplay = map.map(r => {
      const marker = r.current ? '📍' : (r.cleared ? '✅' : r.emoji);
      return `${marker} ${r.id.replace('room_', 'R')}${r.current ? ' ← YOU' : ''}`;
    }).join('\n');

    const currentRoom = dungeon.rooms.find(r => r.id === dungeon.currentRoom);
    const exitRooms = currentRoom.connections.map(c => {
      const room = dungeon.rooms.find(r => r.id === c);
      return { id: c, name: c.replace('room_', 'R'), emoji: this.dungeonService.getRoomEmoji(room.type) };
    });
    const exitsText = exitRooms.map(e => `${e.emoji} ${e.name}`).join(', ');

    const response = {
      embeds: [{
        title: `🗺️ ${dungeon.name}`,
        color: 0x3B82F6, // Blue
        fields: [
          { name: '📍 Map', value: mapDisplay || 'Empty', inline: false },
          { name: '🚪 Exits', value: exitsText || 'None', inline: false }
        ]
      }]
    };
    
    // Add navigation buttons
    const buttons = createDungeonButtons({ 
      currentRoom: currentRoom.id, 
      exits: exitRooms, 
      roomCleared: currentRoom.cleared,
      hasTreasure: currentRoom.encounter?.gold && !currentRoom.encounter?.collected
    });
    return addEmbedTextSummary(addComponentsToResponse(response, buttons));
  }

  async _move(avatar, params) {
    const sheet = await this.characterService.getSheet(avatar._id);
    if (!sheet?.partyId) {
      return this._errorEmbed(`${avatar.name} is not in a party.`);
    }

    const dungeon = await this.dungeonService.getActiveDungeon(sheet.partyId);
    if (!dungeon) {
      return this._errorEmbed('No active dungeon.');
    }

    const roomId = params[1] || params.room;
    if (!roomId) {
      return this._errorEmbed('Specify a room: 🏰 dungeon move <room_id>');
    }

    const { room } = await this.dungeonService.enterRoom(dungeon._id, roomId);

    // Trigger quest progress (both quest systems)
    await this.questService?.onEvent?.(avatar._id, 'explored');
    await this.tutorialQuestService?.onEvent?.(avatar._id, 'room_moved');

    const exitRooms = room.connections?.map(c => {
      const nextRoom = dungeon.rooms.find(r => r.id === c);
      return { id: c, name: c.replace('room_', 'R'), emoji: this.dungeonService.getRoomEmoji(nextRoom?.type) };
    }) || [];

    const response = {
      embeds: [{
        title: `🚶 Moving to ${roomId}`,
        description: `The party moves forward...`,
        color: 0x3B82F6, // Blue
        fields: [
          { name: `${this.dungeonService.getRoomEmoji(room.type)} Room`, value: this._describeRoom(room), inline: false }
        ]
      }]
    };
    
    // Add buttons based on room state
    const buttons = createDungeonButtons({ 
      currentRoom: room.id, 
      exits: exitRooms, 
      roomCleared: room.cleared,
      hasTreasure: room.encounter?.gold && !room.encounter?.collected
    });
    return addEmbedTextSummary(addComponentsToResponse(response, buttons));
  }

  async _clear(avatar) {
    const sheet = await this.characterService.getSheet(avatar._id);
    if (!sheet?.partyId) {
      return this._errorEmbed(`${avatar.name} is not in a party.`);
    }

    const dungeon = await this.dungeonService.getActiveDungeon(sheet.partyId);
    if (!dungeon) {
      return this._errorEmbed('No active dungeon.');
    }

    const result = await this.dungeonService.clearRoom(dungeon._id, dungeon.currentRoom);

    // Trigger quest progress (both quest systems)
    await this.questService?.onEvent?.(avatar._id, 'room_cleared');
    await this.tutorialQuestService?.onEvent?.(avatar._id, 'room_cleared');

    const fields = [{ name: '⭐ XP Earned', value: `${result.xpAwarded}`, inline: true }];

    if (result.dungeonComplete) {
      // Trigger quest completion for dungeon (both quest systems)
      await this.questService?.onEvent?.(avatar._id, 'dungeon_complete');
      await this.tutorialQuestService?.onEvent?.(avatar._id, 'dungeon_completed');
      
      const response = {
        embeds: [{
          title: '🎉 DUNGEON COMPLETE!',
          description: 'The party emerges victorious!',
          color: 0xF59E0B, // Gold
          fields
        }]
      };
      
      // Post-dungeon action buttons
      const buttons = createActionMenu([
        { id: 'dnd_dungeon_enter', label: 'New Dungeon', emoji: '🏰' },
        { id: 'dnd_character_long_rest', label: 'Long Rest', emoji: '🏕️' },
        { id: 'dnd_party_list', label: 'View Party', emoji: '👥' }
      ]);
      return addEmbedTextSummary(addComponentsToResponse(response, buttons));
    }

    const room = dungeon.rooms.find(r => r.id === dungeon.currentRoom);
    const exitRooms = room.connections.map(c => {
      const nextRoom = dungeon.rooms.find(r => r.id === c);
      return { id: c, name: c.replace('room_', 'R'), emoji: this.dungeonService.getRoomEmoji(nextRoom.type) };
    });
    const exitsText = exitRooms.map(e => `${e.emoji} ${e.name}`).join(', ');
    
    fields.push({ name: '🚪 Exits', value: exitsText || 'None', inline: false });

    const response = {
      embeds: [{
        title: '✅ Room Cleared!',
        description: 'The enemies have been defeated!',
        color: 0x10B981, // Green
        fields
      }]
    };
    
    // Add navigation buttons
    const buttons = createDungeonButtons({ 
      currentRoom: room.id, 
      exits: exitRooms, 
      roomCleared: true,
      hasTreasure: room.encounter?.gold && !room.encounter?.collected
    });
    return addEmbedTextSummary(addComponentsToResponse(response, buttons));
  }

  async _loot(avatar) {
    const sheet = await this.characterService.getSheet(avatar._id);
    if (!sheet?.partyId) {
      return this._errorEmbed(`${avatar.name} is not in a party.`);
    }

    const dungeon = await this.dungeonService.getActiveDungeon(sheet.partyId);
    if (!dungeon) {
      return this._errorEmbed('No active dungeon.');
    }

    const result = await this.dungeonService.collectTreasure(dungeon._id, dungeon.currentRoom);
    
    // Trigger quest event for treasure
    await this.tutorialQuestService?.onEvent?.(avatar._id, 'treasure_collected');

    const room = dungeon.rooms.find(r => r.id === dungeon.currentRoom);
    const exitRooms = room?.connections?.map(c => {
      const nextRoom = dungeon.rooms.find(r => r.id === c);
      return { id: c, name: c.replace('room_', 'R'), emoji: this.dungeonService.getRoomEmoji(nextRoom?.type) };
    }) || [];

    const response = {
      embeds: [{
        title: '💰 Treasure Collected!',
        color: 0xF59E0B, // Gold
        fields: [
          { name: '🪙 Gold', value: `${result.gold}`, inline: true },
          { name: '📦 Items', value: result.items.length > 0 ? result.items.join(', ') : 'None', inline: true }
        ]
      }]
    };
    
    // Add navigation buttons
    const buttons = createDungeonButtons({ 
      currentRoom: room?.id, 
      exits: exitRooms, 
      roomCleared: true,
      hasTreasure: false
    });
    return addEmbedTextSummary(addComponentsToResponse(response, buttons));
  }

  async _abandon(avatar) {
    const sheet = await this.characterService.getSheet(avatar._id);
    if (!sheet?.partyId) {
      return this._errorEmbed(`${avatar.name} is not in a party.`);
    }

    const dungeon = await this.dungeonService.getActiveDungeon(sheet.partyId);
    if (!dungeon) {
      return this._errorEmbed('No active dungeon.');
    }

    await this.dungeonService.abandonDungeon(dungeon._id);

    const response = {
      embeds: [{
        title: '🏃 Dungeon Abandoned',
        description: `The party flees from **${dungeon.name}**...`,
        color: 0x6B7280 // Gray
      }]
    };
    
    // Post-abandon action buttons
    const buttons = createActionMenu([
      { id: 'dnd_dungeon_enter', label: 'Try Again', emoji: '🏰' },
      { id: 'dnd_character_short_rest', label: 'Short Rest', emoji: '☕' }
    ]);
    return addEmbedTextSummary(addComponentsToResponse(response, buttons));
  }

  _describeRoom(room) {
    const descriptions = {
      combat: `⚔️ **Combat!** Enemies lurk in the shadows...`,
      boss: `💀 **BOSS ENCOUNTER!** A powerful foe awaits!`,
      treasure: `💰 **Treasure Room!** Riches glitter in the darkness.`,
      puzzle: `🧩 **Puzzle Room!** Strange mechanisms line the walls.`,
      rest: `🏕️ **Rest Area.** A safe place to recover.`,
      shop: `🛒 **Merchant!** A traveling trader offers wares.`,
      empty: `🚪 An empty chamber. Nothing of interest here.`,
      entrance: `🚪 The dungeon entrance. Adventure awaits!`
    };

    let desc = descriptions[room.type] || 'A mysterious room.';

    if (room.encounter?.monsters && !room.cleared) {
      const monsterList = room.encounter.monsters
        .map(m => `${m.count}x ${m.id}`)
        .join(', ');
      desc += `\n👹 **Enemies:** ${monsterList}`;
    }

    if (room.encounter?.gold && !room.encounter?.collected) {
      desc += `\n💰 **Treasure:** ~${room.encounter.gold} gold`;
    }

    if (room.cleared) {
      desc += '\n✅ *Cleared*';
    }

    return desc;
  }
}
