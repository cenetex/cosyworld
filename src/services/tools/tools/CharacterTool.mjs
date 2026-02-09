/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * CharacterTool - D&D character creation and management
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { BasicTool } from '../BasicTool.mjs';
import { CLASSES } from '../../../data/dnd/classes.mjs';
import { RACES, BACKGROUNDS } from '../../../data/dnd/races.mjs';
import { 
  createCharacterButtons, 
  addComponentsToResponse, 
  addEmbedTextSummary,
  createActionMenu,
  createCharacterCreationButtons,
  createClassSelectionButtons
} from '../dndButtonComponents.mjs';

export class CharacterTool extends BasicTool {
  constructor({ logger, characterService, avatarService, discordService, questService, tutorialQuestService, healthService, mapService }) {
    super();
    this.logger = logger || console;
    this.characterService = characterService;
    this.avatarService = avatarService;
    this.discordService = discordService;
    this.questService = questService;
    this.tutorialQuestService = tutorialQuestService;
    this.healthService = healthService || null;
    this.mapService = mapService || null;

    this.name = 'character';
    this.parameters = '<action> [options]';
    this.description = 'Manage D&D character: create, sheet, rest';
    this.emoji = '📜';
    this.isDndTool = true;
    this.replyNotification = true;
    this.cooldownMs = 5000;
  }

  getParameterSchema() {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'sheet', 'rest'],
          description: 'Action to perform'
        },
        race: {
          type: 'string',
          enum: Object.keys(RACES),
          description: 'Character race (for create)'
        },
        class: {
          type: 'string',
          enum: Object.keys(CLASSES),
          description: 'Character class (for create)'
        },
        background: {
          type: 'string',
          enum: Object.keys(BACKGROUNDS),
          description: 'Character background (for create)'
        },
        restType: {
          type: 'string',
          enum: ['short', 'long'],
          description: 'Rest type'
        }
      },
      required: ['action']
    };
  }

  _errorEmbed(message) {
    return {
      embeds: [{
        title: '📜 Character Error',
        description: message,
        color: 0xEF4444 // Red
      }]
    };
  }

  async execute(message, params, avatar) {
    const action = params[0] || params.action;

    try {
      switch (action) {
        case 'create':
          return await this._create(avatar, params);
        case 'race':
          // User selected a race, show class selection
          return await this._showClassSelection(avatar, params[1]);
        case 'sheet':
        case 'stats':
          // Show own public summary with inspect button (full sheet via button click)
          return await this._showPublicSummary(avatar);
        case 'rest':
          return await this._rest(avatar, params);
        case undefined:
        case '':
          // No action - if has sheet show summary, else show create menu
          return await this._showPublicSummary(avatar);
        default: {
          // Check if it might be a race name
          if (RACES[action]) {
            return await this._showClassSelection(avatar, action);
          }
          // Otherwise treat as a target name lookup (e.g. "📜 Kai")
          const targetName = params.join(' ');
          return await this._inspectTarget(message, avatar, targetName);
        }
      }
    } catch (error) {
      this.logger.error('[CharacterTool] Error:', error);
      return this._errorEmbed(error.message);
    }
  }

  /**
   * Show public summary card for an avatar (Name / Race / Class, no level).
   * If the avatar has no sheet, falls through to the race selection (create) flow.
   */
  async _showPublicSummary(avatar) {
    const sheet = await this.characterService.getSheet(avatar._id);
    if (!sheet) {
      return this._showRaceSelection(avatar);
    }

    const classDef = CLASSES[sheet.class];
    const raceDef = RACES[sheet.race];

    // Public summary: Name / Race / Class — no level, no stats
    const inspectButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`dnd_inspect_sheet_${String(avatar._id)}`)
        .setLabel('Inspect')
        .setEmoji('📜')
        .setStyle(ButtonStyle.Primary)
    );

    return {
      embeds: [{
        title: `${avatar.emoji || '📜'} ${avatar.name}`,
        description: `${raceDef?.name || sheet.race} ${classDef?.name || sheet.class}`,
        color: 0x7C3AED,
        thumbnail: avatar.imageUrl ? { url: avatar.imageUrl } : undefined,
        footer: { text: 'Click Inspect to learn more about this character' }
      }],
      components: [inspectButton]
    };
  }

  /**
   * Look up a target avatar by name and show their public summary card.
   * Falls back to the user's own summary if no match found.
   */
  async _inspectTarget(message, callerAvatar, targetName) {
    // Try exact name match first, then fuzzy
    let target = await this.avatarService.getAvatarByName(targetName);
    if (!target) {
      const fuzzy = await this.avatarService.fuzzyAvatarByName?.(targetName, { limit: 1 });
      target = fuzzy?.[0] || null;
    }

    // If we found a nearby avatar with a sheet, show their public card
    if (target) {
      const sheet = await this.characterService.getSheet(target._id);
      if (sheet) {
        const classDef = CLASSES[sheet.class];
        const raceDef = RACES[sheet.race];

        const inspectButton = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`dnd_inspect_sheet_${String(target._id)}`)
            .setLabel('Inspect')
            .setEmoji('📜')
            .setStyle(ButtonStyle.Primary)
        );

        return {
          embeds: [{
            title: `${target.emoji || '📜'} ${target.name}`,
            description: `${raceDef?.name || sheet.race} ${classDef?.name || sheet.class}`,
            color: 0x7C3AED,
            thumbnail: target.imageUrl ? { url: target.imageUrl } : undefined,
            footer: { text: 'Click Inspect to learn more about this character' }
          }],
          components: [inspectButton]
        };
      }
      // Target exists but no sheet
      return {
        embeds: [{
          title: `${target.emoji || '❓'} ${target.name}`,
          description: '*This character has no adventuring record.*',
          color: 0x6B7280,
          thumbnail: target.imageUrl ? { url: target.imageUrl } : undefined
        }]
      };
    }

    // No target found — fall back to own summary
    return await this._showPublicSummary(callerAvatar);
  }

  /**
   * Show race selection menu (character creation)
   */
  async _showRaceSelection(avatar) {
    return {
      embeds: [{
        title: '⚔️ Choose Your Race',
        description: `Select a race for **${avatar.name}**:`,
        color: 0x7C3AED,
        fields: [
          { name: '👤 Human', value: '+1 to all ability scores', inline: true },
          { name: '🧝 Elf', value: '+2 Dexterity, Darkvision', inline: true },
          { name: '🧔 Dwarf', value: '+2 Constitution, Resilience', inline: true },
          { name: '🧒 Halfling', value: '+2 Dexterity, Lucky', inline: true }
        ],
        footer: { text: 'Click a button to select your race' }
      }],
      components: createCharacterCreationButtons()
    };
  }

  /**
   * Show class selection after race is chosen
   */
  async _showClassSelection(avatar, selectedRace) {
    const race = selectedRace?.toLowerCase() || 'human';
    const raceDef = RACES[race];
    
    if (!raceDef) {
      return this._errorEmbed(`Unknown race: ${race}. Available: human, elf, dwarf, halfling`);
    }

    return {
      embeds: [{
        title: `🎭 Choose Your Class`,
        description: `**${avatar.name}** the **${raceDef.name}**\n\nNow select a class:`,
        color: 0x7C3AED,
        fields: [
          { name: '⚔️ Fighter', value: 'Master of martial combat', inline: true },
          { name: '🧙 Wizard', value: 'Arcane spellcaster', inline: true },
          { name: '🗡️ Rogue', value: 'Stealthy & cunning', inline: true },
          { name: '✝️ Cleric', value: 'Divine healer & warrior', inline: true },
          { name: '🏹 Ranger', value: 'Wilderness hunter', inline: true },
          { name: '🎵 Bard', value: 'Inspiring performer', inline: true }
        ],
        footer: { text: 'Click a button to complete character creation' }
      }],
      components: createClassSelectionButtons(race)
    };
  }

  async _create(avatar, params) {
    const race = params[1] || params.race || 'human';
    const className = params[2] || params.class || 'fighter';
    const background = params[3] || params.background || 'soldier';

    const sheet = await this.characterService.createCharacter(avatar._id, {
      className,
      race,
      background
    });

    // Trigger quest progress (both quest systems)
    await this.questService?.onEvent?.(avatar._id, 'character_created', { race, class: className });
    await this.tutorialQuestService?.onEvent?.(avatar._id, 'character_created', { race, class: className });

    const classDef = CLASSES[className];
    const raceDef = RACES[race];

    const response = {
      embeds: [{
        title: `✨ Character Created!`,
        description: `**${avatar.name}** is now a Level 1 ${raceDef.name} ${classDef.name}!`,
        color: 0x10B981, // Green
        fields: [
          { name: '📊 Hit Dice', value: `d${classDef.hitDice}`, inline: true },
          { name: '🎯 Proficiency', value: `+${sheet.proficiencyBonus}`, inline: true },
          { name: sheet.spellcasting ? '✨ Spellcasting' : '⚔️ Combat Style', 
            value: sheet.spellcasting ? sheet.spellcasting.ability : 'Martial class', 
            inline: true }
        ],
        footer: { text: 'Ready to adventure!' }
      }]
    };
    
    // Add action buttons
    const buttons = createActionMenu([
      { id: 'dnd_character_sheet', label: 'View Sheet', emoji: '📜' },
      { id: 'dnd_party_menu', label: 'Party', emoji: '👥' },
      { id: 'dnd_tutorial_status', label: 'Tutorial', emoji: '🎓' }
    ]);
    return addEmbedTextSummary(addComponentsToResponse(response, buttons));
  }

  async _showSheet(avatar) {
    const sheet = await this.characterService.getSheet(avatar._id);
    if (!sheet) {
      const response = {
        embeds: [{
          title: '📜 No Character Sheet',
          description: `${avatar.name} has no character sheet yet.`,
          color: 0x6B7280
        }]
      };
      const buttons = createActionMenu([
        { id: 'dnd_character_create', label: 'Create Character', emoji: '📜' }
      ]);
      return addEmbedTextSummary(addComponentsToResponse(response, buttons));
    }

    // Trigger quest progress (both quest systems)
    await this.questService?.onEvent?.(avatar._id, 'sheet_viewed');
    await this.tutorialQuestService?.onEvent?.(avatar._id, 'sheet_viewed');

    const classDef = CLASSES[sheet.class];
    const raceDef = RACES[sheet.race];
    const stats = avatar.stats || {};
    const abilityScores = sheet.abilityScores || {};

    let currentHp = stats.hp || 10;
    let maxHp = stats.maxHp || stats.hp || 10;
    if (this.healthService) {
      const state = await this.healthService.getHpState(avatar);
      if (state) {
        currentHp = state.currentHp ?? currentHp;
        maxHp = state.maxHp ?? maxHp;
      }
    }

    const hpBar = this._createBar(currentHp, maxHp, 10);
    
    // Format ability scores
    const statLine = ['str', 'dex', 'con', 'int', 'wis', 'cha']
      .map(s => {
        const score = abilityScores[s] || 10;
        const mod = Math.floor((score - 10) / 2);
        const sign = mod >= 0 ? '+' : '';
        return `**${s.toUpperCase()}** ${score} (${sign}${mod})`;
      })
      .join(' | ');

    let spellInfo = null;
    if (sheet.spellcasting) {
      const slots = Object.entries(sheet.spellcasting.slots || {})
        .map(([lvl, s]) => `L${lvl}: ${s.current}/${s.max}`)
        .join(' | ');
      spellInfo = slots || 'None';
    }

    const featureList = sheet.features
      .slice(0, 3)
      .map(f => f.uses ? `${f.name} (${f.uses.current}/${f.uses.max})` : f.name)
      .join('\n') || 'None';

    const fields = [
      { name: '📊 Ability Scores', value: statLine, inline: false },
      { name: '❤️ HP', value: `${hpBar} ${currentHp}/${maxHp}`, inline: false },
      { name: '🎯 Proficiency', value: `+${sheet.proficiencyBonus}`, inline: true },
      { name: '⭐ XP', value: `${sheet.experience}`, inline: true },
      { name: '🎲 Hit Dice', value: `${sheet.hitDice.current}/${sheet.hitDice.max}d${sheet.hitDice.size}`, inline: true },
      { name: '⚔️ Features', value: featureList, inline: false }
    ];

    if (spellInfo) {
      fields.splice(5, 0, { name: '✨ Spell Slots', value: spellInfo, inline: false });
    }

    const response = {
      embeds: [{
        title: `📜 ${avatar.name}`,
        description: `Level ${sheet.level} ${raceDef.name} ${classDef.name}`,
        color: 0x7C3AED, // Purple
        fields,
        thumbnail: avatar.imageUrl ? { url: avatar.imageUrl } : undefined
      }]
    };
    
    // Add character action buttons
    const buttons = createCharacterButtons({ 
      hasSpells: !!sheet.spellcasting, 
      canRest: true 
    });
    return addEmbedTextSummary(addComponentsToResponse(response, buttons));
  }

  async _rest(avatar, params) {
    const restType = params[1] || params.restType || 'short';
    
    const result = await this.characterService.rest(avatar._id, restType);
    const hpRestored = result?.hpRestored || 0;

    // Trigger quest progress (both quest systems)
    await this.questService?.onEvent?.(avatar._id, 'rested', { restType });
    await this.tutorialQuestService?.onEvent?.(avatar._id, restType === 'long' ? 'long_rest' : 'short_rest', { restType });

    const emoji = restType === 'long' ? '🏕️' : '☕';
    const hpMessage = hpRestored > 0 ? `\n💚 **+${hpRestored} HP** restored` : '';
    const restored = restType === 'long' 
      ? `All HP, spell slots, hit dice, and features restored!${hpMessage}`
      : `Short rest features restored!${hpMessage}`;

    const response = {
      embeds: [{
        title: `${emoji} ${restType === 'long' ? 'Long' : 'Short'} Rest`,
        description: `**${avatar.name}** takes a ${restType} rest.`,
        color: restType === 'long' ? 0x10B981 : 0x3B82F6, // Green or Blue
        fields: [{ name: '✨ Restored', value: restored, inline: false }]
      }]
    };
    
    // Add action buttons
    const buttons = createActionMenu([
      { id: 'dnd_character_sheet', label: 'View Sheet', emoji: '📜' },
      { id: 'dnd_dungeon_enter', label: 'Enter Dungeon', emoji: '🏰' }
    ]);
    return addEmbedTextSummary(addComponentsToResponse(response, buttons));
  }

  _createBar(current, max, length = 10) {
    const filled = Math.round((current / max) * length);
    return '█'.repeat(filled) + '░'.repeat(length - filled);
  }
}
