/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export function createDungeonUi(tool) {
  const getRoomNarrative = async (room, dungeon) => {
    if (!room) {
      return '*The air is still as the party advances...*';
    }

    const truncate = (text, max = 220) => {
      const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
      if (!cleaned) return '';
      if (cleaned.length <= max) return cleaned;
      return `${cleaned.slice(0, max - 1).trim()}…`;
    };

    let continuityHint = '';
    try {
      const ctx = await tool.dndTurnContextService?.buildForDungeon?.({
        dungeon,
        channelId: dungeon?.locationChannelId || dungeon?.threadId || dungeon?.channelId || null
      });

      const parts = [];
      const summary = ctx?.channelSummary?.summary;
      if (summary) {
        parts.push(`Story so far: ${truncate(summary, 180)}`);
      }
      const localCount = Array.isArray(ctx?.localItems) ? ctx.localItems.length : 0;
      if (localCount > 0) {
        parts.push(`Loose items nearby: ${localCount}`);
      }

      if (parts.length > 0) {
        continuityHint = `\n\n-# ${parts.join(' • ')}`;
      }
    } catch {
      // ignore
    }

    if (tool.dungeonMasterService?.generateRoomDescription) {
      try {
        const narrative = await tool.dungeonMasterService.generateRoomDescription(room, dungeon);
        return `${narrative}${continuityHint}`;
      } catch (e) {
        tool.logger?.debug?.(`[DungeonTool] DM narration failed: ${e.message}`);
      }
    }

    return `${getFallbackRoomNarrative(room, dungeon?.theme)}${continuityHint}`;
  };

  const getFallbackRoomNarrative = (room, theme) => {
    if (room.cleared) {
      const clearedNarratives = {
        combat: '*The echoes of battle have faded. Fallen enemies lie still amid scattered weapons and broken shields.*',
        boss: '*The great beast lies defeated. An eerie calm fills the lair where once a terrible power ruled.*',
        treasure: '*Empty chests and bare pedestals — the riches have already been claimed.*',
        puzzle: '*The ancient mechanisms rest in their solved positions. Gears click softly, the way forward open.*',
        rest: '*The campfire embers still glow faintly. A familiar sanctuary, already used.*',
        shop: '*The merchant nods in recognition. Their wares have been picked over.*',
        empty: '*Dust and silence. Nothing new stirs in this empty chamber.*',
        entrance: '*The entrance stands open. The way forward — and backward — is clear.*'
      };
      return clearedNarratives[room.type] || `*This chamber has been cleared. The ${theme || 'mysterious'} dungeon is quieter here.*`;
    }

    const baseNarratives = {
      combat: '*Shadows shift in the darkness. You are not alone...*',
      boss: '*An overwhelming presence fills the chamber. Something ancient and powerful awaits...*',
      treasure: '*Gold glitters in the torchlight. Riches beyond measure lie scattered across the floor...*',
      puzzle: '*Strange mechanisms cover the walls. A test of wit awaits...*',
      rest: '*A rare sanctuary in the depths. The air here is calm and restorative...*',
      shop: '*A traveling merchant has somehow found their way here. Wares line makeshift shelves...*',
      empty: '*Dust and silence. This chamber holds nothing but memories...*',
      entrance: '*Ancient doors mark the boundary between the world above and the depths below...*'
    };
    return baseNarratives[room.type] || `*The party ventures deeper into the ${theme || 'mysterious'} dungeon...*`;
  };

  const getRoomImagePrompt = (room, theme) => {
    const monsterNames = room.encounter?.monsters?.length && !room.cleared
      ? room.encounter.monsters.map(m => m.name || m.id).join(', ')
      : null;

    if (room.cleared) {
      const clearedPrompts = {
        combat: `${theme} dungeon chamber after battle, defeated enemies, scattered weapons, dark fantasy RPG, aftermath`,
        boss: `${theme} dungeon boss lair after victory, fallen beast, empty throne, dark fantasy RPG, triumphant`,
        treasure: `${theme} dungeon empty treasure room, open chests, bare shelves, fantasy RPG, already looted`,
        rest: `${theme} dungeon campsite, cooling embers, used bedrolls, fantasy RPG, familiar sanctuary`,
        puzzle: `${theme} dungeon solved puzzle room, activated mechanisms, open passage, fantasy RPG`,
        shop: `${theme} underground merchant shop, picked-over wares, fantasy RPG`,
        empty: `${theme} dungeon empty chamber, abandoned room, fantasy RPG, dust and cobwebs`,
        entrance: `${theme} dungeon entrance hall, open doorway, fantasy RPG`
      };
      return clearedPrompts[room.type] || `${theme} dungeon cleared room, fantasy RPG art, atmospheric`;
    }

    const typePrompts = {
      combat: `${theme} dungeon combat chamber, ${monsterNames || 'enemies lurking'}, dark fantasy RPG, torchlight, battle arena`,
      boss: `${theme} dungeon boss lair, ${monsterNames || 'massive throne room'}, dark fantasy RPG, ominous atmosphere, powerful enemy`,
      treasure: `${theme} dungeon treasure room, piles of gold, glittering gems, fantasy RPG, warm torchlight`,
      puzzle: `${theme} dungeon puzzle chamber, ancient mechanisms, mystical runes, fantasy RPG, mysterious`,
      rest: `${theme} dungeon safe room, peaceful alcove, fantasy RPG, soft lighting, sanctuary`,
      shop: `${theme} underground merchant shop, magical wares, fantasy RPG, cozy lighting`,
      empty: `${theme} dungeon empty chamber, abandoned room, fantasy RPG, dust and cobwebs`,
      entrance: `${theme} dungeon entrance hall, grand doorway, fantasy RPG, atmospheric lighting`
    };
    return typePrompts[room.type] || `${theme} dungeon room, fantasy RPG art, atmospheric`;
  };

  const describeRoomBrief = (room) => {
    if (room.type === 'combat' && room.encounter?.monsters?.length && !room.cleared) {
      return `⚔️ ${room.encounter.monsters.map(m => m.name || m.id).join(', ')} await!`;
    }
    if (room.type === 'boss' && !room.cleared) {
      return '💀 A powerful foe awaits...';
    }
    if (room.cleared) {
      return '✅ Cleared';
    }
    if (room.puzzle && !room.puzzle.solved) {
      return '🧩 A riddle blocks the way';
    }
    if (room.type === 'entrance' && room.puzzle?.solved) {
      return '🚪 The path forward is open';
    }
    const descs = {
      treasure: '💰 Treasure awaits',
      rest: '🏕️ A safe place to rest',
      shop: '🛒 A merchant offers wares',
      empty: '🚪 An empty chamber',
      entrance: '🚪 Dungeon entrance'
    };
    return descs[room.type] || '❓ Unknown';
  };

  const getRoomEmoji = (type) => {
    const emojis = { combat: '⚔️', boss: '💀', treasure: '💰', puzzle: '🧩', rest: '🏕️', shop: '🛒', empty: '🚪', entrance: '🚪' };
    return emojis[type] || '❓';
  };

  const getRoomTitle = (type) => {
    const titles = { combat: 'Battle Chamber', boss: 'Boss Lair', treasure: 'Treasure Vault', puzzle: 'Puzzle Chamber', rest: 'Rest Area', shop: "Merchant's Corner", empty: 'Empty Chamber', entrance: 'Dungeon Entrance' };
    return titles[type] || 'Unknown Chamber';
  };

  const getRoomColor = (type) => {
    const colors = { combat: 0xEF4444, boss: 0x7C3AED, treasure: 0xF59E0B, puzzle: 0x3B82F6, rest: 0x10B981, shop: 0x8B5CF6, empty: 0x6B7280, entrance: 0x3B82F6 };
    return colors[type] || 0x6B7280;
  };

  const getDifficultyColor = (difficulty) => {
    const colors = { easy: 0x10B981, medium: 0xF59E0B, hard: 0xEF4444, deadly: 0x7C3AED };
    return colors[difficulty] || 0xF59E0B;
  };

  const createNavigationButtons = (room) => {
    const rows = [];
    const exits = room?.connections || [];

    if (exits.length > 0) {
      const navButtons = exits.slice(0, 5).map(exitId =>
        new ButtonBuilder()
          .setCustomId(`dnd_dungeon_move_${exitId}`)
          .setLabel(`Room ${exitId.replace('room_', '')}`)
          .setEmoji('🚪')
          .setStyle(ButtonStyle.Primary)
      );
      rows.push(new ActionRowBuilder().addComponents(navButtons));
    }

    const utilButtons = [
      new ButtonBuilder().setCustomId('dnd_dungeon_map').setLabel('Map').setEmoji('🗺️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('dnd_character_sheet').setLabel('Stats').setEmoji('📜').setStyle(ButtonStyle.Secondary)
    ];
    rows.push(new ActionRowBuilder().addComponents(utilButtons));

    return rows;
  };

  const createRoomButtons = (room) => {
    if (room.cleared) {
      return createNavigationButtons(room);
    }

    const buttons = [];

    if (room.type === 'combat' || room.type === 'boss') {
      buttons.push(
        new ButtonBuilder().setCustomId('dnd_combat_start').setLabel('Fight!').setEmoji('⚔️').setStyle(ButtonStyle.Danger)
      );
    }

    if (room.type === 'treasure' && room.encounter?.gold && !room.encounter?.collected) {
      buttons.push(
        new ButtonBuilder().setCustomId('dnd_dungeon_loot').setLabel('Loot').setEmoji('💰').setStyle(ButtonStyle.Success)
      );
    }

    if (room.type === 'rest') {
      buttons.push(
        new ButtonBuilder().setCustomId('dnd_dungeon_short_rest').setLabel('Short Rest').setEmoji('☕').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('dnd_dungeon_long_rest').setLabel('Long Rest').setEmoji('🏕️').setStyle(ButtonStyle.Success)
      );
    }

    if (room.puzzle && !room.puzzle.solved) {
      buttons.push(
        new ButtonBuilder().setCustomId('dnd_puzzle_answer').setLabel('Answer Riddle').setEmoji('🧩').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('dnd_puzzle_hint').setLabel('Hint').setEmoji('💡').setStyle(ButtonStyle.Primary)
      );
    }

    buttons.push(
      new ButtonBuilder().setCustomId('dnd_dungeon_map').setLabel('Map').setEmoji('🗺️').setStyle(ButtonStyle.Secondary)
    );

    if (room.type !== 'combat' && room.type !== 'boss' && room.connections?.length > 0) {
      const rows = [];
      rows.push(new ActionRowBuilder().addComponents(buttons.slice(0, 5)));

      const navButtons = room.connections.slice(0, 5).map(exitId =>
        new ButtonBuilder()
          .setCustomId(`dnd_dungeon_move_${exitId}`)
          .setLabel(`Room ${exitId.replace('room_', '')}`)
          .setEmoji('🚪')
          .setStyle(ButtonStyle.Primary)
      );
      rows.push(new ActionRowBuilder().addComponents(navButtons));

      return rows;
    }

    return buttons.length > 0 ? [new ActionRowBuilder().addComponents(buttons.slice(0, 5))] : [];
  };

  return {
    getRoomNarrative,
    getFallbackRoomNarrative,
    getRoomImagePrompt,
    describeRoomBrief,
    getRoomEmoji,
    getRoomTitle,
    getRoomColor,
    getDifficultyColor,
    createRoomButtons,
    createNavigationButtons
  };
}
