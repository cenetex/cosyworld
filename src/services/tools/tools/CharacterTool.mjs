/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * CharacterTool - D&D character creation and management
 */

import { BasicTool } from '../BasicTool.mjs';
import { CLASSES } from '../../../data/dnd/classes.mjs';
import { RACES, BACKGROUNDS } from '../../../data/dnd/races.mjs';

export class CharacterTool extends BasicTool {
  constructor({ logger, characterService, avatarService, discordService, questService }) {
    super();
    this.logger = logger || console;
    this.characterService = characterService;
    this.avatarService = avatarService;
    this.discordService = discordService;
    this.questService = questService;

    this.name = 'character';
    this.parameters = '<action> [options]';
    this.description = 'Manage D&D character: create, sheet, rest';
    this.emoji = '📜';
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
        case 'sheet':
          return await this._showSheet(avatar);
        case 'rest':
          return await this._rest(avatar, params);
        default:
          return this._errorEmbed(`Unknown action: ${action}. Use: create, sheet, rest`);
      }
    } catch (error) {
      this.logger.error('[CharacterTool] Error:', error);
      return this._errorEmbed(error.message);
    }
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

    // Trigger quest progress
    await this.questService?.onEvent?.(avatar._id, 'character_created', { race, class: className });

    const classDef = CLASSES[className];
    const raceDef = RACES[race];

    return {
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
        footer: { text: 'Use 📜 character sheet to view full details' }
      }]
    };
  }

  async _showSheet(avatar) {
    const sheet = await this.characterService.getSheet(avatar._id);
    if (!sheet) {
      return {
        embeds: [{
          title: '📜 No Character Sheet',
          description: `${avatar.name} has no character sheet yet.`,
          color: 0x6B7280,
          footer: { text: 'Use 📜 character create <race> <class> to create one' }
        }]
      };
    }

    // Trigger quest progress
    await this.questService?.onEvent?.(avatar._id, 'sheet_viewed');

    const classDef = CLASSES[sheet.class];
    const raceDef = RACES[sheet.race];
    const stats = avatar.stats || {};
    const abilityScores = sheet.abilityScores || {};

    const hpBar = this._createBar(stats.hp || 10, stats.hp || 10, 10);
    
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
      { name: '❤️ HP', value: `${hpBar} ${stats.hp || 10}`, inline: false },
      { name: '🎯 Proficiency', value: `+${sheet.proficiencyBonus}`, inline: true },
      { name: '⭐ XP', value: `${sheet.experience}`, inline: true },
      { name: '🎲 Hit Dice', value: `${sheet.hitDice.current}/${sheet.hitDice.max}d${sheet.hitDice.size}`, inline: true },
      { name: '⚔️ Features', value: featureList, inline: false }
    ];

    if (spellInfo) {
      fields.splice(5, 0, { name: '✨ Spell Slots', value: spellInfo, inline: false });
    }

    return {
      embeds: [{
        title: `📜 ${avatar.name}`,
        description: `Level ${sheet.level} ${raceDef.name} ${classDef.name}`,
        color: 0x7C3AED, // Purple
        fields,
        thumbnail: avatar.imageUrl ? { url: avatar.imageUrl } : undefined
      }]
    };
  }

  async _rest(avatar, params) {
    const restType = params[1] || params.restType || 'short';
    
    await this.characterService.rest(avatar._id, restType);

    // Trigger quest progress
    await this.questService?.onEvent?.(avatar._id, 'rested', { restType });

    const emoji = restType === 'long' ? '🏕️' : '☕';
    const restored = restType === 'long' 
      ? 'All spell slots, hit dice, and features restored!'
      : 'Short rest features restored!';

    return {
      embeds: [{
        title: `${emoji} ${restType === 'long' ? 'Long' : 'Short'} Rest`,
        description: `**${avatar.name}** takes a ${restType} rest.`,
        color: restType === 'long' ? 0x10B981 : 0x3B82F6, // Green or Blue
        fields: [{ name: '✨ Restored', value: restored, inline: false }]
      }]
    };
  }

  _createBar(current, max, length = 10) {
    const filled = Math.round((current / max) * length);
    return '█'.repeat(filled) + '░'.repeat(length - filled);
  }
}
