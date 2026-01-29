import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * Canonical action list for a dungeon room state.
 * Keep IDs aligned with existing button handlers.
 */
export function getDungeonRoomActions({ room, _dungeon } = {}) {
  if (!room) return [];

  // Un-cleared rooms
  if (!room.cleared) {
    if (room.type === 'combat' || room.type === 'boss') {
      return [
        [
          { id: 'dnd_combat_start', label: 'Start Battle', emoji: '⚔️', style: ButtonStyle.Danger },
          { id: 'dnd_dungeon_map', label: 'View Map', emoji: '🗺️', style: ButtonStyle.Secondary },
          { id: 'dnd_dungeon_abandon', label: 'Flee Dungeon', emoji: '🏃', style: ButtonStyle.Secondary }
        ]
      ];
    }

    if (room.type === 'entrance' && room.puzzle && !room.puzzle.solved) {
      return [
        [
          { id: 'dnd_puzzle_hint', label: 'Get Hint', emoji: '💡', style: ButtonStyle.Primary },
          { id: 'dnd_puzzle_answer', label: 'Answer Riddle', emoji: '🧩', style: ButtonStyle.Success },
          { id: 'dnd_dungeon_abandon', label: 'Leave', emoji: '🚪', style: ButtonStyle.Secondary }
        ]
      ];
    }

    if (room.type === 'treasure') {
      return [
        [
          { id: 'dnd_dungeon_loot', label: 'Collect Treasure', emoji: '💰', style: ButtonStyle.Success },
          { id: 'dnd_dungeon_map', label: 'View Map', emoji: '🗺️', style: ButtonStyle.Secondary }
        ]
      ];
    }

    if (room.type === 'rest') {
      return [
        [
          { id: 'dnd_character_short_rest', label: 'Short Rest', emoji: '☕', style: ButtonStyle.Primary },
          { id: 'dnd_character_long_rest', label: 'Long Rest', emoji: '🏕️', style: ButtonStyle.Success },
          { id: 'dnd_dungeon_map', label: 'Continue', emoji: '🚪', style: ButtonStyle.Secondary }
        ]
      ];
    }

    // Default for other uncleared rooms
    return [
      [
        { id: 'dnd_dungeon_map', label: 'View Map', emoji: '🗺️', style: ButtonStyle.Secondary },
        { id: 'dnd_dungeon_abandon', label: 'Leave Dungeon', emoji: '🚪', style: ButtonStyle.Secondary }
      ]
    ];
  }

  // Cleared rooms: navigation + utilities
  const rows = [];

  const exits = Array.isArray(room.connections) ? room.connections : [];
  if (exits.length > 0) {
    const navButtons = exits.slice(0, 5).map(exitId => ({
      id: `dnd_dungeon_move_${exitId}`,
      label: `Room ${String(exitId).replace('room_', '')}`,
      emoji: '🚪',
      style: ButtonStyle.Primary
    }));
    rows.push(...chunk(navButtons, 5));
  }

  rows.push([
    { id: 'dnd_dungeon_map', label: 'View Map', emoji: '🗺️', style: ButtonStyle.Secondary },
    { id: 'dnd_character_sheet', label: 'View Stats', emoji: '📜', style: ButtonStyle.Secondary }
  ]);

  return rows;
}

export function buildDungeonActionRows({ room, dungeon } = {}) {
  const actionRows = getDungeonRoomActions({ room, dungeon });
  return actionRows.map(row => new ActionRowBuilder().addComponents(
    row.map(a => new ButtonBuilder().setCustomId(a.id).setLabel(a.label).setEmoji(a.emoji).setStyle(a.style))
  ));
}
