/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * DungeonMasterService - AI-powered Dungeon Master for narrative D&D experience
 * Provides atmospheric narration, turn prompts, and immersive storytelling
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

// DM persona configuration
const DM_PERSONA = {
  name: 'The Dungeon Master',
  emoji: '🎲',
  avatar: 'https://i.imgur.com/DM_avatar.png', // Placeholder - should be configured
  color: 0x7C3AED // Purple for DM messages
};

// Narrative templates for different situations
const NARRATIVE_TEMPLATES = {
  roomEntry: {
    combat: [
      'The air grows thick with tension as hostile eyes gleam from the shadows...',
      'A guttural growl echoes through the chamber. You are not alone.',
      'Weapons glint in the dim light. Battle is inevitable.'
    ],
    treasure: [
      'Golden light spills from an ornate chest, beckoning adventurers forward.',
      'Riches beyond measure lay scattered across ancient pedestals.',
      'The glitter of gold catches your eye. Fortune favors the bold.'
    ],
    puzzle: [
      'Strange runes pulse with arcane energy across the sealed doorway.',
      'Ancient mechanisms click and whir, awaiting the correct sequence.',
      'A riddle echoes through the chamber, its answer the key to progress.'
    ],
    rest: [
      'A rare sanctuary in the darkness. The air here is calm and restorative.',
      'Soft light filters through crystal formations, creating a peaceful haven.',
      'This chamber offers respite from the dangers that lurk beyond.'
    ],
    boss: [
      'The very air trembles with malevolent power. Something ancient awaits...',
      'A throne of bone sits at the chamber\'s heart. Its occupant stirs.',
      'This is it. The final confrontation. Steel your resolve, adventurers.'
    ],
    entrance: [
      'Ancient doors groan open, revealing darkness within. Your adventure begins.',
      'The threshold between safety and peril. There is no turning back.',
      'Torchlight flickers against weathered stone. The dungeon awaits.'
    ]
  },
  
  combatStart: [
    '⚔️ **ROLL FOR INITIATIVE!**\n\nSteel clashes against steel as battle erupts!',
    '⚔️ **COMBAT BEGINS!**\n\nThe time for words has passed. Let blades speak now!',
    '⚔️ **TO ARMS!**\n\nFate will be decided by sword and spell this day!'
  ],
  
  turnPrompt: [
    '{name}, the battlefield awaits your command. What do you do?',
    'It is {name}\'s turn to act! Choose wisely, adventurer.',
    'All eyes turn to {name}. The next move could change everything.',
    '{name} steps into the fray! What action will you take?'
  ],
  
  attackResult: {
    hit: [
      '{attacker}\'s strike finds its mark! {defender} takes **{damage}** damage!',
      'A devastating blow from {attacker}! {defender} staggers, taking **{damage}** damage!',
      'Steel meets flesh as {attacker} deals **{damage}** damage to {defender}!'
    ],
    miss: [
      '{attacker}\'s attack goes wide! {defender} narrowly escapes harm.',
      'A swing and a miss! {defender} evades {attacker}\'s assault.',
      '{attacker}\'s blade cuts only air as {defender} dodges aside.'
    ],
    critical: [
      '🎯 **CRITICAL HIT!** {attacker}\'s devastating blow deals **{damage}** damage to {defender}!',
      '💥 **CRITICAL!** {attacker} finds the perfect opening, dealing **{damage}** damage!',
      '⚡ **CRITICAL STRIKE!** {attacker}\'s attack is utterly devastating! **{damage}** damage!'
    ]
  },
  
  death: [
    '💀 {name} falls, their light extinguished from this world.',
    '☠️ With a final gasp, {name} collapses. Their journey ends here.',
    '💀 {name}\'s body crumples to the ground. A warrior has fallen.'
  ],
  
  knockout: [
    '💤 {name} collapses, unconscious but alive. They will need rest to recover.',
    '😵 {name} falls to their knees, strength failing. They cannot continue.',
    '💤 Overwhelmed, {name} loses consciousness. The battle rages on without them.'
  ],
  
  victory: [
    '🏆 **VICTORY!** The enemies have been vanquished!',
    '⚔️ **BATTLE WON!** You stand triumphant over your fallen foes!',
    '🎉 **ENEMIES DEFEATED!** Catch your breath, for more challenges await.'
  ],
  
  puzzleSolved: [
    '✨ The ancient mechanisms hum to life! The way forward opens.',
    '🔓 Brilliant! The riddle is solved and the path revealed.',
    '💡 Your wisdom proves true! The magical barriers dissipate.'
  ]
};

export class DungeonMasterService {
  constructor({ 
    logger, 
    discordService, 
    unifiedAIService, 
    aiService,
    schemaService,
    configService 
  }) {
    this.logger = logger || console;
    this.discordService = discordService;
    this.unifiedAIService = unifiedAIService;
    this.aiService = aiService;
    this.schemaService = schemaService;
    this.configService = configService;
    
    // DM persona settings
    this.dmName = DM_PERSONA.name;
    this.dmEmoji = DM_PERSONA.emoji;
    this.dmColor = DM_PERSONA.color;
  }

  /**
   * Get the AI service to use
   * @private
   */
  _getAI() {
    return this.unifiedAIService || this.aiService;
  }

  /**
   * Pick a random template from an array
   * @private
   */
  _pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /**
   * Replace template variables
   * @private
   */
  _fillTemplate(template, vars = {}) {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }
    return result;
  }

  /**
   * Create a DM embed with consistent styling
   * @param {Object} options - Embed options
   * @returns {Object} Discord embed object
   */
  createDMEmbed({ title, description, fields = [], image = null, thumbnail = null, footer = null }) {
    const embed = {
      author: { name: `${this.dmEmoji} ${this.dmName}` },
      title,
      description,
      color: this.dmColor,
      fields,
      timestamp: new Date().toISOString()
    };
    
    if (image) embed.image = { url: image };
    if (thumbnail) embed.thumbnail = { url: thumbnail };
    if (footer) embed.footer = { text: footer };
    
    return embed;
  }

  /**
   * Generate an AI-powered room description
   * @param {Object} room - The room object
   * @param {Object} dungeon - The dungeon object
   * @returns {Promise<string>} AI-generated description
   */
  async generateRoomDescription(room, dungeon) {
    const ai = this._getAI();
    if (!ai) {
      // Fallback to template
      return this._pickRandom(NARRATIVE_TEMPLATES.roomEntry[room.type] || NARRATIVE_TEMPLATES.roomEntry.combat);
    }

    try {
      const prompt = `You are a Dungeon Master narrating a ${dungeon.theme} dungeon. 
Describe a ${room.type} room in 2-3 atmospheric sentences. Be dramatic but concise.
${room.encounter?.monsters?.length ? `Enemies present: ${room.encounter.monsters.map(m => m.name).join(', ')}` : ''}
${room.puzzle ? `There is a riddle: "${room.puzzle.riddle}"` : ''}`;

      let response = await ai.chat([
        { role: 'system', content: 'You are a dramatic D&D Dungeon Master. Keep descriptions to 2-3 sentences maximum.' },
        { role: 'user', content: prompt }
      ]);
      
      if (response?.text) response = response.text;
      return response || this._pickRandom(NARRATIVE_TEMPLATES.roomEntry[room.type] || NARRATIVE_TEMPLATES.roomEntry.combat);
    } catch (e) {
      this.logger?.warn?.(`[DM] AI room description failed: ${e.message}`);
      return this._pickRandom(NARRATIVE_TEMPLATES.roomEntry[room.type] || NARRATIVE_TEMPLATES.roomEntry.combat);
    }
  }

  /**
   * Narrate room entry with embed and action buttons
   * @param {Object} options - Room entry details
   * @returns {Object} Discord message payload with embed and buttons
   */
  async narrateRoomEntry({ room, dungeon, _party, _channelId }) {
    const description = await this.generateRoomDescription(room, dungeon);
    
    const fields = [];
    
    // Show monsters if combat room
    if (room.encounter?.monsters?.length && !room.cleared) {
      const monsterList = room.encounter.monsters
        .map(m => `${m.emoji || '👹'} **${m.name || m.id}** ×${m.count}`)
        .join('\n');
      fields.push({ name: '👹 Enemies', value: monsterList, inline: true });
    }
    
    // Show puzzle if present
    if (room.puzzle && !room.puzzle.solved) {
      fields.push({ 
        name: '🧩 Riddle', 
        value: `*"${room.puzzle.riddle}"*`, 
        inline: false 
      });
    }
    
    // Show treasure if present
    if (room.encounter?.gold && !room.encounter?.collected) {
      fields.push({ 
        name: '💰 Treasure', 
        value: `~${room.encounter.gold} gold awaits`, 
        inline: true 
      });
    }

    const embed = this.createDMEmbed({
      title: `${this.getRoomEmoji(room.type)} ${this.getRoomTitle(room.type)}`,
      description,
      fields,
      footer: `${dungeon.name} • Room ${room.id.replace('room_', '')}`
    });

    // Create action buttons based on room state
    const buttons = this.createRoomActionButtons(room, dungeon);

    return {
      embeds: [embed],
      components: buttons
    };
  }

  /**
   * Get emoji for room type
   */
  getRoomEmoji(type) {
    const emojis = {
      combat: '⚔️', treasure: '💰', puzzle: '🧩', rest: '🏕️',
      shop: '🛒', empty: '🚪', boss: '💀', entrance: '🚪'
    };
    return emojis[type] || '❓';
  }

  /**
   * Get title for room type
   */
  getRoomTitle(type) {
    const titles = {
      combat: 'Battle Chamber',
      treasure: 'Treasure Room',
      puzzle: 'Puzzle Chamber',
      rest: 'Rest Area',
      shop: 'Merchant\'s Corner',
      empty: 'Empty Chamber',
      boss: 'Boss Lair',
      entrance: 'Dungeon Entrance'
    };
    return titles[type] || 'Unknown Chamber';
  }

  /**
   * Create action buttons for current room state
   */
  createRoomActionButtons(room, _dungeon) {
    const rows = [];
    
    if (!room.cleared) {
      // Combat/Puzzle actions
      if (room.type === 'combat' || room.type === 'boss') {
        const combatRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('dnd_combat_start')
            .setLabel('Start Battle')
            .setEmoji('⚔️')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('dnd_dungeon_map')
            .setLabel('View Map')
            .setEmoji('🗺️')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('dnd_dungeon_abandon')
            .setLabel('Flee Dungeon')
            .setEmoji('🏃')
            .setStyle(ButtonStyle.Secondary)
        );
        rows.push(combatRow);
      } else if (room.type === 'entrance' && room.puzzle && !room.puzzle.solved) {
        const puzzleRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('dnd_puzzle_hint')
            .setLabel('Get Hint')
            .setEmoji('💡')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('dnd_puzzle_answer')
            .setLabel('Answer Riddle')
            .setEmoji('🧩')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('dnd_dungeon_abandon')
            .setLabel('Leave')
            .setEmoji('🚪')
            .setStyle(ButtonStyle.Secondary)
        );
        rows.push(puzzleRow);
      } else if (room.type === 'treasure') {
        const treasureRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('dnd_dungeon_loot')
            .setLabel('Collect Treasure')
            .setEmoji('💰')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('dnd_dungeon_map')
            .setLabel('View Map')
            .setEmoji('🗺️')
            .setStyle(ButtonStyle.Secondary)
        );
        rows.push(treasureRow);
      } else if (room.type === 'rest') {
        const restRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('dnd_character_short_rest')
            .setLabel('Short Rest')
            .setEmoji('☕')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('dnd_character_long_rest')
            .setLabel('Long Rest')
            .setEmoji('🏕️')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('dnd_dungeon_map')
            .setLabel('Continue')
            .setEmoji('🚪')
            .setStyle(ButtonStyle.Secondary)
        );
        rows.push(restRow);
      }
    } else {
      // Room cleared - show navigation
      const exits = room.connections || [];
      if (exits.length > 0) {
        const navButtons = exits.slice(0, 5).map((exitId, _i) =>
          new ButtonBuilder()
            .setCustomId(`dnd_dungeon_move_${exitId}`)
            .setLabel(`Room ${exitId.replace('room_', '')}`)
            .setEmoji('🚪')
            .setStyle(ButtonStyle.Primary)
        );
        rows.push(new ActionRowBuilder().addComponents(navButtons));
      }
      
      // Add utility buttons
      const utilRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('dnd_dungeon_map')
          .setLabel('View Map')
          .setEmoji('🗺️')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('dnd_character_sheet')
          .setLabel('View Stats')
          .setEmoji('📜')
          .setStyle(ButtonStyle.Secondary)
      );
      rows.push(utilRow);
    }

    return rows;
  }

  /**
   * Announce combat start with dramatic narration
   */
  async announceCombatStart({ encounter, _channelId }) {
    const narration = this._pickRandom(NARRATIVE_TEMPLATES.combatStart);
    
    // Build initiative order display
    const initiativeList = encounter.initiativeOrder?.map((id, i) => {
      const participant = encounter.participants?.find(p => String(p._id || p.id) === String(id));
      const name = participant?.name || 'Unknown';
      const emoji = participant?.isMonster ? '👹' : '⚔️';
      return `${i + 1}. ${emoji} **${name}**`;
    }).join('\n') || 'Initiative order pending...';

    const embed = this.createDMEmbed({
      title: '⚔️ Combat Begins!',
      description: narration,
      fields: [
        { name: '📋 Initiative Order', value: initiativeList, inline: false }
      ]
    });

    return { embeds: [embed] };
  }

  /**
   * Prompt a player for their turn with action buttons
   */
  async promptTurn({ avatar, encounter, _channelId }) {
    const template = this._pickRandom(NARRATIVE_TEMPLATES.turnPrompt);
    const prompt = this._fillTemplate(template, { name: avatar.name });

    const embed = this.createDMEmbed({
      title: `🎲 ${avatar.name}'s Turn`,
      description: prompt,
      fields: [
        { name: '❤️ HP', value: `${avatar.stats?.hp || '?'}/${avatar.stats?.maxHp || '?'}`, inline: true },
        { name: '🛡️ AC', value: `${avatar.stats?.ac || '?'}`, inline: true },
        { name: '⏱️ Round', value: `${encounter.round || 1}`, inline: true }
      ],
      thumbnail: avatar.imageUrl
    });

    // Create action buttons for combat
    const rows = [];
    
    // Get enemies
    const enemies = encounter.participants?.filter(p => p.isMonster && p.stats?.hp > 0) || [];
    const _allies = encounter.participants?.filter(p => !p.isMonster && p.stats?.hp > 0 && String(p._id) !== String(avatar._id)) || [];

    // Main action row
    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('dnd_combat_attack')
        .setLabel('Attack')
        .setEmoji('⚔️')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('dnd_combat_cast')
        .setLabel('Cast Spell')
        .setEmoji('🪄')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('dnd_combat_defend')
        .setLabel('Defend')
        .setEmoji('🛡️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('dnd_combat_flee')
        .setLabel('Flee')
        .setEmoji('🏃')
        .setStyle(ButtonStyle.Secondary)
    );
    rows.push(actionRow);

    // Target selection row (if enemies exist)
    if (enemies.length > 0) {
      const targetButtons = enemies.slice(0, 5).map(enemy => {
        // Use avatarId or _id or id for stable target selection
        const targetId = enemy.avatarId || enemy._id || enemy.id || enemy.name;
        return new ButtonBuilder()
          .setCustomId(`dnd_target_${encodeURIComponent(String(targetId))}`)
          .setLabel(`${enemy.name} (${enemy.stats?.hp}HP)`.slice(0, 80))
          .setEmoji(enemy.emoji || '👹')
          .setStyle(ButtonStyle.Danger);
      });
      rows.push(new ActionRowBuilder().addComponents(targetButtons));
    }

    return {
      embeds: [embed],
      components: rows
    };
  }

  /**
   * Narrate an attack result
   */
  narrateAttack({ attacker, defender, damage, hit, critical }) {
    let template;
    if (critical) {
      template = this._pickRandom(NARRATIVE_TEMPLATES.attackResult.critical);
    } else if (hit) {
      template = this._pickRandom(NARRATIVE_TEMPLATES.attackResult.hit);
    } else {
      template = this._pickRandom(NARRATIVE_TEMPLATES.attackResult.miss);
    }

    return this._fillTemplate(template, {
      attacker: attacker.name,
      defender: defender.name,
      damage: damage || 0
    });
  }

  /**
   * Narrate a death or knockout
   */
  narrateDefeat({ avatar, isDeath }) {
    const templates = isDeath ? NARRATIVE_TEMPLATES.death : NARRATIVE_TEMPLATES.knockout;
    return this._fillTemplate(this._pickRandom(templates), { name: avatar.name });
  }

  /**
   * Narrate combat victory
   */
  async narrateVictory({ encounter, _channelId }) {
    const narration = this._pickRandom(NARRATIVE_TEMPLATES.victory);
    
    const embed = this.createDMEmbed({
      title: '🏆 Victory!',
      description: narration,
      fields: [
        { name: '⏱️ Rounds', value: `${encounter.round || 1}`, inline: true }
      ]
    });

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('dnd_dungeon_loot')
        .setLabel('Search Bodies')
        .setEmoji('🔍')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('dnd_dungeon_map')
        .setLabel('Continue')
        .setEmoji('🚪')
        .setStyle(ButtonStyle.Success)
    );

    return {
      embeds: [embed],
      components: [buttons]
    };
  }

  /**
   * Send a DM message to a channel
   */
  async sendDMMessage(channelId, payload) {
    if (!this.discordService?.client) {
      this.logger?.warn?.('[DM] No Discord client available');
      return;
    }

    try {
      const channel = await this.discordService.client.channels.fetch(channelId);
      if (channel?.isTextBased()) {
        await channel.send(payload);
      }
    } catch (e) {
      this.logger?.error?.(`[DM] Failed to send message: ${e.message}`);
    }
  }
}
