/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * Tutorial Quest Definition
 */

export const TUTORIAL_QUEST = {
  id: 'tutorial',
  type: 'tutorial',
  title: 'The Adventurer\'s Path',
  description: 'Learn the ways of the hero through a guided journey.',
  emoji: '📚',
  repeatable: true,
  autoStart: true, // Starts on first D&D tool use
  prerequisites: [],
  steps: [
    {
      id: 'welcome',
      title: 'Welcome, Adventurer!',
      description: 'Welcome to the realm! Let me guide you through becoming a hero.',
      instruction: 'Say **"ready"** to begin your journey.',
      trigger: 'ready',
      xpReward: 0
    },
    {
      id: 'create_character',
      title: 'Choose Your Path',
      description: 'Every hero needs a race and class. Your choices shape your destiny.',
      instruction: 'Create your character with:\n📜 `character create <race> <class>`\n\n**Races:** human, elf, dwarf, halfling\n**Classes:** fighter, wizard, rogue, cleric, ranger, bard',
      trigger: 'character_created',
      condition: { type: 'has_sheet' },
      xpReward: 50
    },
    {
      id: 'view_sheet',
      title: 'Know Thyself',
      description: 'Your character sheet shows your abilities, spells, and features.',
      instruction: 'View your character sheet:\n📜 `character sheet`',
      trigger: 'sheet_viewed',
      condition: { type: 'has_sheet' },
      xpReward: 25
    },
    {
      id: 'learn_spells',
      title: 'The Art of Magic',
      description: 'Spellcasters wield arcane or divine power.',
      instruction: 'View your available spells:\n🪄 `cast`',
      trigger: 'spells_checked',
      condition: { type: 'not_spellcaster' }, // Auto-skip if not a caster
      optional: true,
      xpReward: 25
    },
    {
      id: 'create_party',
      title: 'Strength in Numbers',
      description: 'Dungeons are dangerous. Form a party with fellow adventurers!',
      instruction: 'Create a party:\n👥 `party create <name>`\n\nOr say **"solo"** to adventure alone.',
      trigger: 'party_ready',
      condition: { type: 'in_party' },
      xpReward: 25
    },
    {
      id: 'enter_dungeon',
      title: 'Into the Depths',
      description: 'The Tutorial Crypts await. A simple dungeon to test your mettle.',
      instruction: 'Enter the tutorial dungeon:\n🏰 `dungeon enter easy`',
      trigger: 'dungeon_entered',
      condition: { type: 'in_dungeon' },
      xpReward: 50
    },
    {
      id: 'view_map',
      title: 'Know Your Surroundings',
      description: 'The dungeon map shows rooms, exits, and your position.',
      instruction: 'View the dungeon map:\n🏰 `dungeon map`',
      trigger: 'map_viewed',
      condition: { type: 'in_dungeon' },
      xpReward: 25
    },
    {
      id: 'first_combat',
      title: 'Steel and Spell',
      description: 'Enemies block your path! Use attacks or spells to defeat them.',
      instruction: 'Fight the enemies in this room:\n🗡️ `attack <enemy>` or 🪄 `cast <spell> <enemy>`\n\nWhen victorious:\n🏰 `dungeon clear`',
      trigger: 'room_cleared',
      xpReward: 100
    },
    {
      id: 'explore',
      title: 'Deeper We Go',
      description: 'Move through the dungeon, clearing rooms and collecting treasure.',
      instruction: 'Move to the next room:\n🏰 `dungeon move <room_id>`\n\nCollect treasure:\n🏰 `dungeon loot`',
      trigger: 'explored',
      xpReward: 50
    },
    {
      id: 'complete_dungeon',
      title: 'Victory!',
      description: 'You\'ve conquered the Tutorial Crypts! You\'re ready for greater challenges.',
      instruction: 'Defeat the boss and complete the dungeon!',
      trigger: 'dungeon_complete',
      xpReward: 200
    },
    {
      id: 'rest',
      title: 'Rest and Recovery',
      description: 'After battle, rest to restore your abilities.',
      instruction: 'Take a long rest:\n📜 `character rest long`',
      trigger: 'rested',
      xpReward: 25
    }
  ],
  rewards: {
    xp: 0,
    title: 'Apprentice Adventurer'
  }
};
