/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * dndButtonComponents.mjs - Discord button components for D&D tools
 * Provides reusable button builders for interactive D&D gameplay
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

/**
 * Button style constants for D&D actions
 */
export const DND_BUTTON_STYLES = {
  ACTION: ButtonStyle.Primary,      // Blue - main actions
  DANGER: ButtonStyle.Danger,       // Red - combat/dangerous
  SUCCESS: ButtonStyle.Success,     // Green - positive actions
  SECONDARY: ButtonStyle.Secondary, // Gray - optional/minor
  LINK: ButtonStyle.Link           // Link button
};

/**
 * Create a single button
 * @param {Object} options - Button options
 * @returns {ButtonBuilder}
 */
export function createButton({ customId, label, emoji, style = ButtonStyle.Primary, disabled = false, url }) {
  const button = new ButtonBuilder()
    .setLabel(label)
    .setStyle(style)
    .setDisabled(disabled);
  
  if (emoji) button.setEmoji(emoji);
  if (url && style === ButtonStyle.Link) {
    button.setURL(url);
  } else if (customId) {
    button.setCustomId(customId);
  }
  
  return button;
}

/**
 * Create an action row with buttons
 * @param {Array<ButtonBuilder>} buttons - Array of buttons
 * @returns {ActionRowBuilder}
 */
export function createButtonRow(buttons) {
  return new ActionRowBuilder().addComponents(...buttons);
}

/**
 * Create tutorial navigation buttons
 * @param {Object} options - Current tutorial state
 * @returns {ActionRowBuilder[]}
 */
export function createTutorialButtons({ canSkip = false, isComplete = false, stepTrigger = null, hasCharacter = false, isConditionMet = false, needsDungeonEntry = false }) {
  const buttons = [];
  
  if (isComplete) {
    // Post-completion menu
    if (!hasCharacter) {
      buttons.push(
        createButton({ customId: 'dnd_character_menu', label: 'Create Character', emoji: '📜', style: ButtonStyle.Primary })
      );
    }
    buttons.push(
      createButton({ customId: 'dnd_party_menu', label: 'Party', emoji: '👥', style: ButtonStyle.Primary }),
      createButton({ customId: 'dnd_dungeon_menu', label: 'Dungeons', emoji: '🏰', style: ButtonStyle.Success }),
      createButton({ customId: 'dnd_tutorial_reset', label: 'Replay', emoji: '🔄', style: ButtonStyle.Secondary })
    );
  } else {
    // In-progress tutorial
    
    // If user needs to enter a dungeon first (for dungeon-context steps without active dungeon)
    if (needsDungeonEntry) {
      buttons.push(
        createButton({ customId: 'dnd_dungeon_enter', label: 'Enter Dungeon', emoji: '🏰', style: ButtonStyle.Success })
      );
      buttons.push(
        createButton({ customId: 'dnd_tutorial_status', label: 'View Progress', emoji: '📊', style: ButtonStyle.Secondary })
      );
      return [createButtonRow(buttons)];
    }
    
    // If condition is already met, show "Complete Step" button prominently
    if (isConditionMet) {
      buttons.push(
        createButton({ customId: 'dnd_tutorial_complete_step', label: 'Complete Step', emoji: '✅', style: ButtonStyle.Success })
      );
    }
    
    if (canSkip && !isConditionMet) {
      buttons.push(
        createButton({ customId: 'dnd_tutorial_skip', label: 'Skip Step', emoji: '⏭️', style: ButtonStyle.Secondary })
      );
    }
    
    // Add action button based on step trigger (only if condition not yet met)
    if (!isConditionMet) {
      if (stepTrigger === 'ready') {
        buttons.push(
          createButton({ customId: 'dnd_tutorial_ready', label: 'Ready!', emoji: '✨', style: ButtonStyle.Success })
        );
      } else if (stepTrigger === 'character_created') {
        buttons.push(
          createButton({ customId: 'dnd_character_menu', label: 'Create Character', emoji: '📜', style: ButtonStyle.Primary })
        );
      } else if (stepTrigger === 'sheet_viewed') {
        buttons.push(
          createButton({ customId: 'dnd_character_sheet', label: 'View Sheet', emoji: '📜', style: ButtonStyle.Primary })
        );
      } else if (stepTrigger === 'spells_checked') {
        buttons.push(
          createButton({ customId: 'dnd_cast_list', label: 'View Spells', emoji: '🔮', style: ButtonStyle.Primary })
        );
      } else if (stepTrigger === 'party_ready') {
        buttons.push(
          createButton({ customId: 'dnd_party_create', label: 'Create Party', emoji: '👥', style: ButtonStyle.Primary }),
          createButton({ customId: 'dnd_tutorial_solo', label: 'Go Solo', emoji: '🎭', style: ButtonStyle.Secondary })
        );
      } else if (stepTrigger === 'dungeon_entered') {
        buttons.push(
          createButton({ customId: 'dnd_dungeon_enter', label: 'Enter Dungeon', emoji: '🏰', style: ButtonStyle.Success })
        );
      } else if (stepTrigger === 'map_viewed') {
        buttons.push(
          createButton({ customId: 'dnd_dungeon_map', label: 'View Map', emoji: '🗺️', style: ButtonStyle.Primary })
        );
      } else if (stepTrigger === 'rested') {
        buttons.push(
          createButton({ customId: 'dnd_character_rest', label: 'Rest', emoji: '🛏️', style: ButtonStyle.Primary })
        );
      }
    }
    
    buttons.push(
      createButton({ customId: 'dnd_tutorial_status', label: 'View Progress', emoji: '📊', style: ButtonStyle.Secondary })
    );
  }
  
  return buttons.length > 0 ? [createButtonRow(buttons)] : [];
}

/**
 * Create character creation menu with race/class select buttons
 * @returns {ActionRowBuilder[]}
 */
export function createCharacterCreationButtons() {
  const raceRow = new ActionRowBuilder().addComponents(
    createButton({ customId: 'dnd_race_human', label: 'Human', emoji: '👤', style: ButtonStyle.Primary }),
    createButton({ customId: 'dnd_race_elf', label: 'Elf', emoji: '🧝', style: ButtonStyle.Primary }),
    createButton({ customId: 'dnd_race_dwarf', label: 'Dwarf', emoji: '🧔', style: ButtonStyle.Primary }),
    createButton({ customId: 'dnd_race_halfling', label: 'Halfling', emoji: '🧒', style: ButtonStyle.Primary })
  );
  
  return [raceRow];
}

/**
 * Create class selection buttons (shown after race selection)
 * @param {string} selectedRace - The selected race
 * @returns {ActionRowBuilder[]}
 */
export function createClassSelectionButtons(selectedRace) {
  const classRow1 = new ActionRowBuilder().addComponents(
    createButton({ customId: `dnd_class_${selectedRace}_fighter`, label: 'Fighter', emoji: '⚔️', style: ButtonStyle.Danger }),
    createButton({ customId: `dnd_class_${selectedRace}_wizard`, label: 'Wizard', emoji: '🧙', style: ButtonStyle.Primary }),
    createButton({ customId: `dnd_class_${selectedRace}_rogue`, label: 'Rogue', emoji: '🗡️', style: ButtonStyle.Secondary })
  );
  
  const classRow2 = new ActionRowBuilder().addComponents(
    createButton({ customId: `dnd_class_${selectedRace}_cleric`, label: 'Cleric', emoji: '✝️', style: ButtonStyle.Success }),
    createButton({ customId: `dnd_class_${selectedRace}_ranger`, label: 'Ranger', emoji: '🏹', style: ButtonStyle.Success }),
    createButton({ customId: `dnd_class_${selectedRace}_bard`, label: 'Bard', emoji: '🎵', style: ButtonStyle.Primary })
  );
  
  return [classRow1, classRow2];
}

/**
 * Create party management buttons
 * @param {Object} options - Party state
 * @returns {ActionRowBuilder[]}
 */
export function createPartyButtons({ isLeader = false, partyId = null, channelAvatars = [] }) {
  const rows = [];
  const buttons = [];
  
  if (isLeader && partyId) {
    // Leader actions
    buttons.push(
      createButton({ customId: `dnd_party_list_${partyId}`, label: 'View Party', emoji: '👥', style: ButtonStyle.Primary })
    );
    
    // If there are avatars in channel, show invite buttons
    if (channelAvatars.length > 0) {
      const inviteButtons = channelAvatars.slice(0, 4).map(av => 
        createButton({ 
          customId: `dnd_party_invite_${av._id}`, 
          label: `Invite ${av.name.substring(0, 15)}`, 
          emoji: '➕', 
          style: ButtonStyle.Success 
        })
      );
      rows.push(createButtonRow(inviteButtons));
    }
  }
  
  buttons.push(
    createButton({ customId: 'dnd_party_leave', label: 'Leave Party', emoji: '🚪', style: ButtonStyle.Danger })
  );
  
  if (buttons.length > 0) {
    rows.unshift(createButtonRow(buttons));
  }
  
  return rows;
}

/**
 * Create dungeon navigation buttons
 * @param {Object} options - Dungeon state
 * @returns {ActionRowBuilder[]}
 */
export function createDungeonButtons({ exits = [], roomCleared = false, hasTreasure = false }) {
  const rows = [];
  
  // Main action row
  const actionButtons = [
    createButton({ customId: 'dnd_dungeon_map', label: 'View Map', emoji: '🗺️', style: ButtonStyle.Secondary })
  ];
  
  if (!roomCleared) {
    actionButtons.push(
      createButton({ customId: 'dnd_dungeon_clear', label: 'Clear Room', emoji: '⚔️', style: ButtonStyle.Danger })
    );
  } else if (hasTreasure) {
    actionButtons.push(
      createButton({ customId: 'dnd_dungeon_loot', label: 'Collect Loot', emoji: '💰', style: ButtonStyle.Success })
    );
  }
  
  actionButtons.push(
    createButton({ customId: 'dnd_dungeon_abandon', label: 'Flee', emoji: '🏃', style: ButtonStyle.Secondary })
  );
  
  rows.push(createButtonRow(actionButtons));
  
  // Movement row - one button per exit
  if (exits.length > 0 && roomCleared) {
    const moveButtons = exits.slice(0, 5).map(exit => 
      createButton({ 
        customId: `dnd_dungeon_move_${exit.id || exit}`, 
        label: exit.name || exit.id || exit,
        emoji: exit.emoji || '🚪',
        style: ButtonStyle.Primary 
      })
    );
    rows.push(createButtonRow(moveButtons));
  }
  
  return rows;
}

/**
 * Create combat action buttons
 * @param {Object} options - Combat state
 * @returns {ActionRowBuilder[]}
 */
export function createCombatButtons({ isPlayerTurn = false, canCast = false, canFlee = false, targets = [] }) {
  const rows = [];
  
  if (!isPlayerTurn) {
    return [createButtonRow([
      createButton({ customId: 'dnd_combat_wait', label: 'Waiting...', emoji: '⏳', style: ButtonStyle.Secondary, disabled: true })
    ])];
  }
  
  // Action buttons
  const actionButtons = [
    createButton({ customId: 'dnd_combat_attack', label: 'Attack', emoji: '⚔️', style: ButtonStyle.Danger })
  ];
  
  if (canCast) {
    actionButtons.push(
      createButton({ customId: 'dnd_combat_cast', label: 'Cast Spell', emoji: '🪄', style: ButtonStyle.Primary })
    );
  }
  
  actionButtons.push(
    createButton({ customId: 'dnd_combat_defend', label: 'Defend', emoji: '🛡️', style: ButtonStyle.Secondary })
  );
  
  if (canFlee) {
    actionButtons.push(
      createButton({ customId: 'dnd_combat_flee', label: 'Flee', emoji: '🏃', style: ButtonStyle.Secondary })
    );
  }
  
  rows.push(createButtonRow(actionButtons));
  
  // Target selection row
  if (targets.length > 0) {
    const targetButtons = targets.slice(0, 5).map((target, i) => 
      createButton({ 
        customId: `dnd_target_${encodeURIComponent(String(target.combatantId || target.avatarId || target.id || i))}`, 
        label: target.name?.substring(0, 15) || `Target ${i+1}`,
        emoji: target.emoji || '🎯',
        style: ButtonStyle.Secondary 
      })
    );
    rows.push(createButtonRow(targetButtons));
  }
  
  return rows;
}

/**
 * Create character sheet buttons
 * @param {Object} options - Character state
 * @returns {ActionRowBuilder[]}
 */
export function createCharacterButtons({ hasSpells = false, canRest = true }) {
  const buttons = [
    createButton({ customId: 'dnd_character_sheet', label: 'View Sheet', emoji: '📜', style: ButtonStyle.Primary })
  ];
  
  if (hasSpells) {
    buttons.push(
      createButton({ customId: 'dnd_character_spells', label: 'View Spells', emoji: '🪄', style: ButtonStyle.Primary })
    );
  }
  
  if (canRest) {
    buttons.push(
      createButton({ customId: 'dnd_character_short_rest', label: 'Short Rest', emoji: '☕', style: ButtonStyle.Secondary }),
      createButton({ customId: 'dnd_character_long_rest', label: 'Long Rest', emoji: '🏕️', style: ButtonStyle.Success })
    );
  }
  
  return [createButtonRow(buttons)];
}

/**
 * Create a simple action menu
 * @param {Array} actions - Array of {id, label, emoji, style} objects
 * @returns {ActionRowBuilder[]}
 */
export function createActionMenu(actions) {
  const rows = [];
  
  // Group into rows of 5 (Discord limit)
  for (let i = 0; i < actions.length; i += 5) {
    const rowActions = actions.slice(i, i + 5);
    const buttons = rowActions.map(action => 
      createButton({
        customId: action.id,
        label: action.label,
        emoji: action.emoji,
        style: action.style || ButtonStyle.Primary,
        disabled: action.disabled || false
      })
    );
    rows.push(createButtonRow(buttons));
  }
  
  return rows;
}

/**
 * Helper to add components to an embed response
 * @param {Object} embedResponse - Existing embed response object
 * @param {ActionRowBuilder[]} components - Button rows to add
 * @returns {Object} Updated response with components
 */
export function addComponentsToResponse(embedResponse, components) {
  if (!components || components.length === 0) return embedResponse;
  
  return {
    ...embedResponse,
    components
  };
}

/**
 * Convert an embed to include a text summary for AI visibility
 * This helps AI agents understand embed content in message history
 * @param {Object} embedResponse - Embed response object
 * @returns {Object} Response with content summary added
 */
export function addEmbedTextSummary(embedResponse) {
  if (!embedResponse.embeds || embedResponse.embeds.length === 0) {
    return embedResponse;
  }
  
  const embed = embedResponse.embeds[0];
  const parts = [];
  
  if (embed.title) parts.push(`[${embed.title}]`);
  if (embed.description) parts.push(embed.description);
  
  if (embed.fields) {
    for (const field of embed.fields) {
      parts.push(`${field.name}: ${field.value}`);
    }
  }
  
  if (embed.footer?.text) parts.push(`(${embed.footer.text})`);
  
  // Add content as invisible/minimal text that AI can read
  // Using || to avoid overwriting existing content
  const summary = parts.join(' | ');
  
  return {
    ...embedResponse,
    content: embedResponse.content || `📋 ${summary}`
  };
}

/**
 * Create main D&D action menu
 * @param {Object} options - Player state
 * @returns {ActionRowBuilder[]}
 */
export function createMainDndMenu({ hasCharacter = false, hasParty = false, inDungeon = false }) {
  const row1 = [];
  const row2 = [];
  
  if (!hasCharacter) {
    row1.push(
      createButton({ customId: 'dnd_character_menu', label: 'Create Character', emoji: '📜', style: ButtonStyle.Primary })
    );
  } else {
    row1.push(
      createButton({ customId: 'dnd_character_sheet', label: 'Character', emoji: '📜', style: ButtonStyle.Primary })
    );
  }

  // DM controls (only when already in an adventure context)
  if (inDungeon) {
    row2.push(
      createButton({ customId: 'dnd_dm_menu', label: 'DM', emoji: '🎛️', style: ButtonStyle.Secondary })
    );
  }
  
  row1.push(
    createButton({ customId: 'dnd_party_menu', label: 'Party', emoji: '👥', style: ButtonStyle.Primary })
  );
  
  if (inDungeon) {
    row1.push(
      createButton({ customId: 'dnd_dungeon_menu', label: 'Dungeon', emoji: '🏰', style: ButtonStyle.Danger })
    );
  } else if (hasParty || hasCharacter) {
    row1.push(
      createButton({ customId: 'dnd_dungeon_menu', label: 'Dungeons', emoji: '🏰', style: ButtonStyle.Success })
    );
  }
  
  row2.push(
    createButton({ customId: 'dnd_quest_menu', label: 'Quests', emoji: '📋', style: ButtonStyle.Secondary }),
    createButton({ customId: 'dnd_tutorial_start', label: 'Tutorial', emoji: '🎓', style: ButtonStyle.Secondary })
  );
  
  if (hasCharacter) {
    row2.push(
      createButton({ customId: 'dnd_cast_list', label: 'Spells', emoji: '🪄', style: ButtonStyle.Primary })
    );
  }
  
  const rows = [createButtonRow(row1)];
  if (row2.length > 0) rows.push(createButtonRow(row2));
  
  return rows;
}
