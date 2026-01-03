/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * DungeonTool - D&D dungeon crawling with AI DM narration
 * 
 * One active dungeon thread per channel. The dungeon command shows
 * the active adventure or starts a new one with atmospheric narration.
 */

import { BasicTool } from '../BasicTool.mjs';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export class DungeonTool extends BasicTool {
  constructor({ logger, dungeonService, partyService, characterService, discordService, questService, tutorialQuestService, schemaService, locationService, dungeonMasterService }) {
    super();
    this.logger = logger || console;
    this.dungeonService = dungeonService;
    this.partyService = partyService;
    this.characterService = characterService;
    this.discordService = discordService;
    this.questService = questService;
    this.tutorialQuestService = tutorialQuestService;
    this.schemaService = schemaService;
    this.locationService = locationService;
    this.dungeonMasterService = dungeonMasterService;

    this.name = 'dungeon';
    this.parameters = '[action]';
    this.description = 'Enter or continue a dungeon adventure';
    this.emoji = '🏰';
    this.isDndTool = true;
    this.replyNotification = true;
    this.cooldownMs = 3000;
  }

  getParameterSchema() {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Optional action: enter, map, move, solve, abandon'
        }
      },
      required: []
    };
  }

  async execute(message, params, avatar) {
    const channelId = message?.channel?.id;
    const action = (params[0] || '').toLowerCase();

    try {
      // Check for active dungeon in this channel/thread first
      let activeDungeon = await this.dungeonService.getActiveDungeonByChannel(channelId);
      
      // If not found by channel, check if the avatar's party has an active dungeon
      // This handles the case where we're in a different channel but party is in a dungeon
      if (!activeDungeon) {
        const sheet = await this.characterService?.getSheet(avatar._id);
        if (sheet?.partyId) {
          activeDungeon = await this.dungeonService.getActiveDungeon(sheet.partyId);
        }
      }

      // No action specified - show status or prompt to enter
      if (!action || action === 'status') {
        return await this._showStatus(avatar, channelId, activeDungeon, message);
      }

      // Route to specific actions
      switch (action) {
        case 'enter':
        case 'start':
        case 'begin':
          return await this._enter(avatar, params, message, channelId, activeDungeon);
        case 'map':
          return await this._showMap(avatar, activeDungeon);
        case 'move':
          return await this._move(avatar, params, activeDungeon, message);
        case 'fight':
        case 'attack':
        case 'battle':
          return await this._startCombat(avatar, activeDungeon, message);
        case 'loot':
        case 'treasure':
          return await this._loot(avatar, activeDungeon);
        case 'abandon':
        case 'flee':
        case 'leave':
          return await this._abandon(avatar, activeDungeon, channelId);
        case 'puzzle':
        case 'solve':
        case 'answer':
          return await this._solvePuzzle(avatar, params.slice(1), activeDungeon);
        default:
          // Treat unknown action as puzzle answer attempt if in dungeon with active puzzle
          if (activeDungeon) {
            const puzzle = await this.dungeonService.getPuzzle(activeDungeon._id);
            if (puzzle && !puzzle.solved) {
              return await this._solvePuzzle(avatar, params, activeDungeon);
            }
          }
          // Otherwise show status
          return await this._showStatus(avatar, channelId, activeDungeon, message);
      }
    } catch (error) {
      this.logger.error('[DungeonTool] Error:', error);
      
      // Special handling for "party already in dungeon" - need to show thread link
      if (error.message?.includes('Party already in a dungeon')) {
        return await this._handleAlreadyInDungeon(avatar);
      }
      
      return this._narrateError(error.message);
    }
  }

  /**
   * Handle "party already in dungeon" error with thread link
   */
  async _handleAlreadyInDungeon(avatar) {
    try {
      const sheet = await this.characterService?.getSheet(avatar._id);
      if (sheet?.partyId) {
        const dungeon = await this.dungeonService.getActiveDungeon(sheet.partyId);
        if (dungeon) {
          const threadLink = dungeon.threadId 
            ? `\n\n👉 **Continue your adventure:** <#${dungeon.threadId}>`
            : `\n\n*This dungeon has no thread. Use* \`🏰 dungeon abandon\` *to start fresh.*`;
          return {
            embeds: [{
              author: { name: '🎲 The Dungeon Master' },
              title: `⚔️ ${dungeon.name}`,
              description: `*Your party is already exploring the depths...*\n\nComplete or abandon your current adventure in **${dungeon.name}** first.${threadLink}`,
              color: 0x7C3AED,
              footer: { text: 'The dungeon awaits your return...' }
            }]
          };
        }
      }
    } catch (e) {
      this.logger.error('[DungeonTool] Error fetching active dungeon:', e);
    }
    // Fallback to generic message
    return this._narrateError('Party already in a dungeon');
  }

  /**
   * Create an atmospheric error message instead of technical error
   */
  _narrateError(message) {
    // Convert technical errors to atmospheric messages
    const errorNarratives = {
      'Party not found': '*The dungeon gates remain sealed. You must gather a party before venturing forth...*',
      'Party already in a dungeon': '*Your party is already exploring the depths. Complete your current adventure first.*',
      'No active dungeon': '*The ancient stones lie dormant. No dungeon awaits your exploration here.*',
      'not in a party': '*A lone adventurer cannot face these depths alone. Seek companions with* `👥 party create`'
    };

    // Find matching narrative or use generic
    let narrative = '*The shadows whisper of an unknown obstacle...*';
    for (const [key, value] of Object.entries(errorNarratives)) {
      if (message.toLowerCase().includes(key.toLowerCase())) {
        narrative = value;
        break;
      }
    }

    return {
      embeds: [{
        author: { name: '🎲 The Dungeon Master' },
        description: narrative,
        color: 0x7C3AED, // DM purple
        footer: { text: 'The path forward is unclear...' }
      }]
    };
  }

  /**
   * Build response for when party already has an active dungeon
   * Creates thread if missing (fixes corrupted state)
   */
  async _buildActiveDungeonResponse(dungeon, message, avatar) {
    let threadId = dungeon.threadId;
    
    // If no thread exists, create one to fix corrupted state
    if (!threadId && this.discordService?.client && message?.channel?.id) {
      try {
        const channel = await this.discordService.client.channels.fetch(message.channel.id);
        if (channel?.threads?.create) {
          const thread = await channel.threads.create({
            name: `⚔️ ${dungeon.name}`,
            autoArchiveDuration: 1440,
            reason: `Recovering dungeon thread for ${avatar?.name || 'party'}'s adventure`
          });
          threadId = thread.id;
          await this.dungeonService.setThreadId(dungeon._id, threadId);
          this.logger?.info?.(`[DungeonTool] Created missing thread for dungeon ${dungeon._id}`);
        }
      } catch (e) {
        this.logger?.warn?.(`[DungeonTool] Failed to create recovery thread: ${e.message}`);
      }
    }

    const fields = [{
      name: '👉 Continue Your Adventure',
      value: threadId ? `<#${threadId}>` : '*Thread unavailable - use abandon to restart*',
      inline: false
    }];

    // Add abandon button
    const abandonButton = new ButtonBuilder()
      .setCustomId('dnd_dungeon_abandon')
      .setLabel('Abandon Dungeon')
      .setEmoji('🚪')
      .setStyle(ButtonStyle.Danger);

    return {
      embeds: [{
        author: { name: '🎲 The Dungeon Master' },
        title: `⚔️ ${dungeon.name}`,
        description: `*Your party is already on an adventure...*`,
        color: 0x7C3AED,
        fields,
        footer: { text: 'Complete or abandon your current dungeon to start a new one' }
      }],
      components: [new ActionRowBuilder().addComponents(abandonButton)]
    };
  }

  /**
   * Show current dungeon status or prompt to start
   */
  async _showStatus(avatar, channelId, activeDungeon, _message) {
    if (activeDungeon) {
      // Active dungeon exists - show link to thread
      const threadId = activeDungeon.threadId;
      const currentRoom = activeDungeon.rooms.find(r => r.id === activeDungeon.currentRoom);
      const clearedCount = activeDungeon.rooms.filter(r => r.cleared).length;
      const totalRooms = activeDungeon.rooms.length;

      const embed = {
        author: { name: '🎲 The Dungeon Master' },
        title: `⚔️ ${activeDungeon.name}`,
        description: threadId 
          ? `*Your adventure continues in the depths...*\n\n**Continue in** <#${threadId}>`
          : `*Your party explores the ${activeDungeon.theme} dungeon...*`,
        color: 0x7C3AED,
        fields: [
          { name: '📍 Location', value: `Room ${activeDungeon.currentRoom.replace('room_', '')} of ${totalRooms}`, inline: true },
          { name: '✅ Progress', value: `${clearedCount}/${totalRooms} rooms cleared`, inline: true },
          { name: '🎭 Theme', value: activeDungeon.theme, inline: true }
        ],
        footer: { text: 'The dungeon awaits your next move...' }
      };

      // Show current room description
      if (currentRoom) {
        embed.fields.push({
          name: `${this._getRoomEmoji(currentRoom.type)} Current Room`,
          value: this._describeRoomBrief(currentRoom),
          inline: false
        });
      }

      const buttons = this._createStatusButtons(currentRoom, threadId);
      return { embeds: [embed], components: buttons };
    }

    // No active dungeon - prompt to start one
    const sheet = await this.characterService?.getSheet(avatar._id);
    
    if (!sheet?.partyId) {
      return {
        embeds: [{
          author: { name: '🎲 The Dungeon Master' },
          title: '🏰 The Dungeon Awaits',
          description: `*Ancient doors loom before you, sealed with arcane power...*\n\n**${avatar.name}**, you must first gather a party of brave adventurers before challenging the depths.`,
          color: 0x7C3AED,
          footer: { text: 'Use 👥 party create to form a party' }
        }],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('dnd_party_create')
              .setLabel('Create Party')
              .setEmoji('👥')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId('dnd_tutorial_start')
              .setLabel('Start Tutorial')
              .setEmoji('📚')
              .setStyle(ButtonStyle.Secondary)
          )
        ]
      };
    }

    // Has party - can start dungeon
    return {
      embeds: [{
        author: { name: '🎲 The Dungeon Master' },
        title: '🏰 The Dungeon Awaits',
        description: `*Ancient doors stand before your party, covered in moss and mystery...*\n\nWill you brave the unknown depths, **${avatar.name}**?`,
        color: 0x7C3AED,
        fields: [
          { name: '⚔️ Difficulty Options', value: '`Easy` • `Medium` • `Hard` • `Deadly`', inline: false }
        ],
        footer: { text: 'Choose wisely, adventurer...' }
      }],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('dnd_dungeon_enter_easy')
            .setLabel('Easy')
            .setEmoji('🌿')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('dnd_dungeon_enter_medium')
            .setLabel('Medium')
            .setEmoji('⚔️')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('dnd_dungeon_enter_hard')
            .setLabel('Hard')
            .setEmoji('🔥')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('dnd_dungeon_enter_deadly')
            .setLabel('Deadly')
            .setEmoji('💀')
            .setStyle(ButtonStyle.Danger)
        )
      ]
    };
  }

  /**
   * Enter a new dungeon - creates thread and posts atmospheric intro
   */
  async _enter(avatar, params, message, channelId, existingDungeon) {
    // Check if dungeon already active in this channel
    if (existingDungeon) {
      return await this._buildActiveDungeonResponse(existingDungeon, message, avatar);
    }

    const sheet = await this.characterService?.getSheet(avatar._id);
    if (!sheet?.partyId) {
      return this._narrateError('not in a party');
    }

    // Check if party has an active dungeon (might be in a different channel)
    const partyDungeon = await this.dungeonService.getActiveDungeon(sheet.partyId);
    if (partyDungeon) {
      return await this._buildActiveDungeonResponse(partyDungeon, message, avatar);
    }

    // Parse difficulty from params or button ID
    let difficulty = 'medium';
    const diffParam = (params[1] || '').toLowerCase();
    if (['easy', 'medium', 'hard', 'deadly'].includes(diffParam)) {
      difficulty = diffParam;
    }

    // Send loading message first
    let loadingMessage = null;
    if (this.discordService?.client && message?.channel?.id) {
      try {
        const channel = await this.discordService.client.channels.fetch(message.channel.id);
        loadingMessage = await channel.send({
          embeds: [{
            author: { name: '🎲 The Dungeon Master' },
            title: '🏰 Generating Dungeon...',
            description: `*The ancient stones shift and groan as the dungeon materializes from the void...*\n\n**Difficulty:** ${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}`,
            color: 0x7C3AED,
            footer: { text: 'Preparing your adventure...' }
          }]
        });
      } catch (e) {
        this.logger?.warn?.(`[DungeonTool] Failed to send loading message: ${e.message}`);
      }
    }

    // Generate the dungeon
    const dungeon = await this.dungeonService.generateDungeon(sheet.partyId, { 
      difficulty, 
      channelId 
    });

    // Update dungeon with channelId
    await this.dungeonService.setChannelId(dungeon._id, channelId);

    // Generate atmospheric entrance image
    let imageUrl = null;
    try {
      if (this.schemaService?.generateImage) {
        const prompt = `${dungeon.theme} dungeon entrance, ancient stone doorway, fantasy RPG art, atmospheric mist, torchlight, mysterious and ominous, detailed architecture`;
        imageUrl = await this.schemaService.generateImage(prompt, '16:9', {
          source: 'dungeon.enter',
          purpose: 'dungeon_entrance',
          theme: dungeon.theme
        });
      }
    } catch (e) {
      this.logger?.warn?.(`[DungeonTool] Image generation failed: ${e.message}`);
    }

    // Create a thread for the dungeon adventure
    let threadId = null;
    if (this.discordService?.client && message?.channel?.id) {
      try {
        const channel = await this.discordService.client.channels.fetch(message.channel.id);
        if (channel?.threads?.create) {
          const thread = await channel.threads.create({
            name: `⚔️ ${dungeon.name}`,
            autoArchiveDuration: 1440, // 24 hours
            reason: `Dungeon adventure for ${avatar.name}'s party`
          });
          threadId = thread.id;

          // Save thread ID to dungeon
          await this.dungeonService.setThreadId(dungeon._id, threadId);

          // Post the grand entrance in the thread
          const firstRoom = dungeon.rooms[0];
          const introEmbed = {
            author: { name: '🎲 The Dungeon Master' },
            title: `🏰 ${dungeon.name}`,
            description: this._generateEntranceNarrative(dungeon),
            color: this._getDifficultyColor(difficulty),
            fields: [
              { name: '📊 Difficulty', value: difficulty.charAt(0).toUpperCase() + difficulty.slice(1), inline: true },
              { name: '🚪 Rooms', value: `${dungeon.rooms.length}`, inline: true },
              { name: '🎭 Theme', value: dungeon.theme.charAt(0).toUpperCase() + dungeon.theme.slice(1), inline: true }
            ],
            footer: { text: 'Your adventure begins...' }
          };

          if (imageUrl) {
            introEmbed.image = { url: imageUrl };
          }

          // Post entrance description with buttons
          const entranceButtons = this._createRoomButtons(firstRoom);
          await thread.send({ embeds: [introEmbed], components: entranceButtons });

          // Post puzzle if entrance has one
          if (firstRoom.puzzle && !firstRoom.puzzle.solved) {
            await this._postPuzzleToThread(thread, firstRoom.puzzle);
          }
        }
      } catch (e) {
        this.logger?.warn?.(`[DungeonTool] Thread creation failed: ${e.message}`);
      }
    }

    // Trigger quest progress
    await this.questService?.onEvent?.(avatar._id, 'dungeon_entered', { difficulty });
    await this.tutorialQuestService?.onEvent?.(avatar._id, 'dungeon_entered', { difficulty });

    // Build the final response
    const finalEmbed = {
      author: { name: '🎲 The Dungeon Master' },
      title: `⚔️ ${dungeon.name}`,
      description: threadId
        ? `*The ancient doors creak open, revealing darkness beyond...*\n\n**Your adventure awaits in** <#${threadId}>`
        : `*The party ventures into a ${dungeon.theme} dungeon...*`,
      color: this._getDifficultyColor(difficulty),
      thumbnail: imageUrl ? { url: imageUrl } : undefined,
      footer: { text: `${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)} difficulty • ${dungeon.rooms.length} rooms` }
    };

    // Edit loading message if we have one, otherwise return the response
    if (loadingMessage) {
      try {
        await loadingMessage.edit({ embeds: [finalEmbed] });
        // Return null to indicate we've already sent the response
        return { _handled: true };
      } catch (e) {
        this.logger?.warn?.(`[DungeonTool] Failed to edit loading message: ${e.message}`);
      }
    }

    return { embeds: [finalEmbed] };
  }

  /**
   * Post puzzle riddle to thread
   */
  async _postPuzzleToThread(thread, puzzle) {
    const puzzleEmbed = {
      author: { name: '🎲 The Dungeon Master' },
      title: '🧩 A Riddle Blocks Your Path',
      description: `*Ancient runes glow as a voice echoes through the chamber...*\n\n**"${puzzle.riddle}"**`,
      color: 0x3B82F6,
      fields: [
        { name: '💡 How to Answer', value: 'Type your answer: `🏰 dungeon solve <answer>`', inline: false }
      ],
      footer: { text: `${puzzle.maxAttempts} attempts allowed` }
    };

    await thread.send({ 
      embeds: [puzzleEmbed],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('dnd_puzzle_hint')
            .setLabel('Get Hint')
            .setEmoji('💡')
            .setStyle(ButtonStyle.Secondary)
        )
      ]
    });
  }

  /**
   * Show dungeon map
   */
  async _showMap(avatar, dungeon) {
    if (!dungeon) {
      return this._narrateError('No active dungeon');
    }

    const map = this.dungeonService.getDungeonMap(dungeon);
    const currentRoom = dungeon.rooms.find(r => r.id === dungeon.currentRoom);

    const mapDisplay = map.map(r => {
      const marker = r.current ? '📍' : (r.cleared ? '✅' : this._getRoomEmoji(r.type));
      const label = r.id.replace('room_', 'R');
      return `${marker} ${label}${r.current ? ' ← **YOU**' : ''}`;
    }).join('\n');

    const exits = currentRoom?.connections?.map(c => {
      const room = dungeon.rooms.find(r => r.id === c);
      return `${this._getRoomEmoji(room?.type)} Room ${c.replace('room_', '')}`;
    }) || [];

    return {
      embeds: [{
        author: { name: '🎲 The Dungeon Master' },
        title: `🗺️ ${dungeon.name}`,
        description: '*You consult your mental map of the explored areas...*',
        color: 0x3B82F6,
        fields: [
          { name: '📍 Dungeon Map', value: mapDisplay || 'Unknown', inline: false },
          { name: '🚪 Available Exits', value: exits.join('\n') || 'None visible', inline: false }
        ]
      }],
      components: this._createNavigationButtons(currentRoom, dungeon)
    };
  }

  /**
   * Move to a different room
   */
  async _move(avatar, params, dungeon, _message) {
    if (!dungeon) {
      return this._narrateError('No active dungeon');
    }

    const roomId = params[1] || params.room;
    if (!roomId) {
      return await this._showMap(avatar, dungeon);
    }

    // Normalize room ID (allow "2" or "room_2")
    const targetRoom = roomId.startsWith('room_') ? roomId : `room_${roomId}`;

    const result = await this.dungeonService.enterRoom(dungeon._id, targetRoom);
    const room = result.room;

    // Generate room image
    let imageUrl = null;
    try {
      if (this.schemaService?.generateImage) {
        const prompt = this._getRoomImagePrompt(room, dungeon.theme);
        imageUrl = await this.schemaService.generateImage(prompt, '16:9', {
          source: 'dungeon.room',
          purpose: 'dungeon_room',
          roomType: room.type
        });
      }
    } catch (e) {
      this.logger?.warn?.(`[DungeonTool] Room image failed: ${e.message}`);
    }

    // Post to dungeon thread if available
    if (dungeon.threadId && this.discordService?.client) {
      try {
        const thread = await this.discordService.client.channels.fetch(dungeon.threadId);
        if (thread) {
          const roomEmbed = {
            author: { name: '🎲 The Dungeon Master' },
            title: `${this._getRoomEmoji(room.type)} ${this._getRoomTitle(room.type)}`,
            description: this._generateRoomNarrative(room, dungeon.theme),
            color: this._getRoomColor(room.type)
          };
          
          if (imageUrl) {
            roomEmbed.image = { url: imageUrl };
          }

          if (room.encounter?.monsters?.length && !room.cleared) {
            roomEmbed.fields = [{
              name: '👹 Enemies',
              value: room.encounter.monsters.map(m => 
                `${m.emoji || '👹'} **${m.name || m.id}** ×${m.count}`
              ).join('\n'),
              inline: false
            }];
          }

          await thread.send({ embeds: [roomEmbed], components: this._createRoomButtons(room) });
        }
      } catch (e) {
        this.logger?.warn?.(`[DungeonTool] Thread post failed: ${e.message}`);
      }
    }

    // Trigger quest progress
    await this.questService?.onEvent?.(avatar._id, 'explored');
    await this.tutorialQuestService?.onEvent?.(avatar._id, 'room_moved');

    return {
      embeds: [{
        author: { name: '🎲 The Dungeon Master' },
        description: `*The party moves deeper into the ${dungeon.theme} dungeon...*`,
        color: 0x3B82F6,
        footer: { text: dungeon.threadId ? `Continue in <#${dungeon.threadId}>` : 'The adventure continues...' }
      }]
    };
  }

  /**
   * Start combat in current room
   */
  async _startCombat(avatar, dungeon, _message) {
    if (!dungeon) {
      return this._narrateError('No active dungeon');
    }

    const room = dungeon.rooms.find(r => r.id === dungeon.currentRoom);
    if (!room?.encounter?.monsters?.length || room.cleared) {
      return {
        embeds: [{
          author: { name: '🎲 The Dungeon Master' },
          description: '*You look around, but find no enemies to fight in this chamber.*',
          color: 0x7C3AED
        }]
      };
    }

    // Combat would be started here via combatEncounterService
    // For now, mark room as having combat initiated
    return {
      embeds: [{
        author: { name: '🎲 The Dungeon Master' },
        title: '⚔️ COMBAT BEGINS!',
        description: `*Steel clashes against steel as battle erupts!*\n\nThe party faces **${room.encounter.monsters.map(m => m.name || m.id).join(', ')}**!`,
        color: 0xEF4444,
        footer: { text: 'Use 🗡️ attack to strike!' }
      }],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('dnd_combat_attack')
            .setLabel('Attack')
            .setEmoji('⚔️')
            .setStyle(ButtonStyle.Danger),
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
        )
      ]
    };
  }

  /**
   * Collect treasure in current room
   */
  async _loot(avatar, dungeon) {
    if (!dungeon) {
      return this._narrateError('No active dungeon');
    }

    const result = await this.dungeonService.collectTreasure(dungeon._id, dungeon.currentRoom);
    
    await this.tutorialQuestService?.onEvent?.(avatar._id, 'treasure_collected');

    const itemList = result.items.length > 0 
      ? result.items.join(', ') 
      : 'nothing but dust';

    return {
      embeds: [{
        author: { name: '🎲 The Dungeon Master' },
        title: '💰 Treasure Claimed!',
        description: `*${avatar.name} searches the room and discovers...*\n\n🪙 **${result.gold} gold pieces**\n📦 **${itemList}**`,
        color: 0xF59E0B
      }],
      components: this._createNavigationButtons(
        dungeon.rooms.find(r => r.id === dungeon.currentRoom),
        dungeon
      )
    };
  }

  /**
   * Abandon the current dungeon
   */
  async _abandon(avatar, dungeon, _channelId) {
    if (!dungeon) {
      return this._narrateError('No active dungeon');
    }

    await this.dungeonService.abandonDungeon(dungeon._id);

    // Archive the thread if it exists
    if (dungeon.threadId && this.discordService?.client) {
      try {
        const thread = await this.discordService.client.channels.fetch(dungeon.threadId);
        if (thread?.setArchived) {
          await thread.send({
            embeds: [{
              author: { name: '🎲 The Dungeon Master' },
              title: '🏃 Dungeon Abandoned',
              description: `*The party flees from the depths of **${dungeon.name}**...*\n\nThe dungeon remains unconquered, its treasures unclaimed.`,
              color: 0x6B7280
            }]
          });
          await thread.setArchived(true);
        }
      } catch (e) {
        this.logger?.warn?.(`[DungeonTool] Thread archive failed: ${e.message}`);
      }
    }

    return {
      embeds: [{
        author: { name: '🎲 The Dungeon Master' },
        title: '🏃 Escaped!',
        description: `*The party retreats from **${dungeon.name}**, living to fight another day...*`,
        color: 0x6B7280
      }],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('dnd_dungeon_enter_medium')
            .setLabel('Try Again')
            .setEmoji('🏰')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('dnd_character_short_rest')
            .setLabel('Rest')
            .setEmoji('☕')
            .setStyle(ButtonStyle.Secondary)
        )
      ]
    };
  }

  /**
   * Attempt to solve the entrance puzzle
   */
  async _solvePuzzle(avatar, params, dungeon) {
    if (!dungeon) {
      return this._narrateError('No active dungeon');
    }

    const answer = params.join(' ').trim();
    
    if (!answer) {
      const puzzle = await this.dungeonService.getPuzzle(dungeon._id);
      if (!puzzle || puzzle.solved) {
        return {
          embeds: [{
            author: { name: '🎲 The Dungeon Master' },
            description: '*No riddle blocks your path. The way forward is clear.*',
            color: 0x10B981
          }]
        };
      }

      return {
        embeds: [{
          author: { name: '🎲 The Dungeon Master' },
          title: '🧩 The Riddle',
          description: `*A voice echoes through the chamber...*\n\n**"${puzzle.riddle}"**`,
          color: 0x3B82F6,
          fields: [
            { name: '⏳ Attempts Remaining', value: `${puzzle.attemptsLeft}`, inline: true }
          ],
          footer: { text: 'Type: 🏰 dungeon solve <your answer>' }
        }]
      };
    }

    const result = await this.dungeonService.solvePuzzle(dungeon._id, answer);

    if (result.success) {
      await this.questService?.onEvent?.(avatar._id, 'puzzle_solved');
      await this.tutorialQuestService?.onEvent?.(avatar._id, 'puzzle_solved');

      // Post success to thread
      if (dungeon.threadId && this.discordService?.client) {
        try {
          const thread = await this.discordService.client.channels.fetch(dungeon.threadId);
          await thread?.send({
            embeds: [{
              author: { name: '🎲 The Dungeon Master' },
              title: '✨ Puzzle Solved!',
              description: `*${avatar.name} speaks the answer, and the ancient magic responds...*\n\n**"${answer}"**\n\nThe barrier fades away, revealing the path forward!`,
              color: 0x10B981,
              fields: result.xpAwarded ? [{ name: '⭐ XP Earned', value: `${result.xpAwarded}`, inline: true }] : []
            }]
          });
        } catch { /* ignore */ }
      }

      return {
        embeds: [{
          author: { name: '🎲 The Dungeon Master' },
          title: '✨ Correct!',
          description: '*The ancient runes glow bright, then fade. The way is open.*',
          color: 0x10B981
        }],
        components: this._createNavigationButtons(dungeon.rooms[0], dungeon)
      };
    }

    // Wrong answer
    return {
      embeds: [{
        author: { name: '🎲 The Dungeon Master' },
        title: result.failed ? '❌ The Riddle Remains Unsolved' : '🤔 Incorrect',
        description: result.failed 
          ? `*The magic seals the answer forever. The puzzle cannot be solved.*\n\n${result.message}`
          : `*"${answer}" echoes into silence. That is not the answer...*`,
        color: result.failed ? 0xEF4444 : 0xF59E0B,
        fields: result.hint ? [{ name: '💡 Hint', value: result.hint, inline: false }] : []
      }]
    };
  }

  // ==================== Helper Methods ====================

  _generateEntranceNarrative(dungeon) {
    const narratives = {
      crypt: '*Dusty cobwebs part as the ancient crypt doors grind open. The stench of death lingers in the cold air, and distant echoes hint at things best left undisturbed...*',
      cave: '*Water drips from stalactites as you enter the yawning cave mouth. Bioluminescent fungi cast an eerie glow on the wet stone walls...*',
      castle: '*Tattered banners flutter in an unfelt wind as you cross the threshold of the ruined castle. Suits of armor line the halls, their hollow eyes watching...*',
      ruins: '*Ancient stones crumble beneath your feet as you descend into the forgotten ruins. Once-great statues stand broken, their faces worn by time...*',
      sewers: '*The iron grate clangs shut behind you. Fetid water sloshes around your boots as you venture into the labyrinthine sewers below the city...*',
      forest: '*Gnarled roots form the entrance to this underground realm. The scent of earth and decay fills your nostrils as you descend into the fairy-haunted depths...*'
    };
    return narratives[dungeon.theme] || `*The party ventures into the mysterious ${dungeon.theme} dungeon...*`;
  }

  _generateRoomNarrative(room, _theme) {
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
    return baseNarratives[room.type] || '*The party enters a mysterious chamber...*';
  }

  _getRoomImagePrompt(room, theme) {
    const typePrompts = {
      combat: `${theme} dungeon combat chamber, enemies lurking, dark fantasy RPG, torchlight, battle arena`,
      boss: `${theme} dungeon boss lair, massive throne room, dark fantasy RPG, ominous atmosphere, powerful enemy`,
      treasure: `${theme} dungeon treasure room, piles of gold, glittering gems, fantasy RPG, warm torchlight`,
      puzzle: `${theme} dungeon puzzle chamber, ancient mechanisms, mystical runes, fantasy RPG, mysterious`,
      rest: `${theme} dungeon safe room, peaceful alcove, fantasy RPG, soft lighting, sanctuary`,
      shop: `${theme} underground merchant shop, magical wares, fantasy RPG, cozy lighting`,
      empty: `${theme} dungeon empty chamber, abandoned room, fantasy RPG, dust and cobwebs`,
      entrance: `${theme} dungeon entrance hall, grand doorway, fantasy RPG, atmospheric lighting`
    };
    return typePrompts[room.type] || `${theme} dungeon room, fantasy RPG art, atmospheric`;
  }

  _describeRoomBrief(room) {
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
    const descs = {
      treasure: '💰 Treasure awaits',
      rest: '🏕️ A safe place to rest',
      shop: '🛒 A merchant offers wares',
      empty: '🚪 An empty chamber'
    };
    return descs[room.type] || '❓ Unknown';
  }

  _getRoomEmoji(type) {
    const emojis = { combat: '⚔️', boss: '💀', treasure: '💰', puzzle: '🧩', rest: '🏕️', shop: '🛒', empty: '🚪', entrance: '🚪' };
    return emojis[type] || '❓';
  }

  _getRoomTitle(type) {
    const titles = { combat: 'Battle Chamber', boss: 'Boss Lair', treasure: 'Treasure Vault', puzzle: 'Puzzle Chamber', rest: 'Rest Area', shop: 'Merchant\'s Corner', empty: 'Empty Chamber', entrance: 'Dungeon Entrance' };
    return titles[type] || 'Unknown Chamber';
  }

  _getRoomColor(type) {
    const colors = { combat: 0xEF4444, boss: 0x7C3AED, treasure: 0xF59E0B, puzzle: 0x3B82F6, rest: 0x10B981, shop: 0x8B5CF6, empty: 0x6B7280, entrance: 0x3B82F6 };
    return colors[type] || 0x6B7280;
  }

  _getDifficultyColor(difficulty) {
    const colors = { easy: 0x10B981, medium: 0xF59E0B, hard: 0xEF4444, deadly: 0x7C3AED };
    return colors[difficulty] || 0xF59E0B;
  }

  _createStatusButtons(currentRoom, threadId) {
    const buttons = [];
    
    if (threadId) {
      // Just show a map button since thread link is in embed
      buttons.push(
        new ButtonBuilder()
          .setCustomId('dnd_dungeon_map')
          .setLabel('View Map')
          .setEmoji('🗺️')
          .setStyle(ButtonStyle.Secondary)
      );
    }
    
    buttons.push(
      new ButtonBuilder()
        .setCustomId('dnd_dungeon_abandon')
        .setLabel('Abandon')
        .setEmoji('🏃')
        .setStyle(ButtonStyle.Secondary)
    );

    return buttons.length > 0 ? [new ActionRowBuilder().addComponents(buttons)] : [];
  }

  _createRoomButtons(room) {
    if (room.cleared) {
      return this._createNavigationButtons(room, null);
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
    
    if (room.puzzle && !room.puzzle.solved) {
      buttons.push(
        new ButtonBuilder().setCustomId('dnd_puzzle_hint').setLabel('Hint').setEmoji('💡').setStyle(ButtonStyle.Primary)
      );
    }

    buttons.push(
      new ButtonBuilder().setCustomId('dnd_dungeon_map').setLabel('Map').setEmoji('🗺️').setStyle(ButtonStyle.Secondary)
    );

    return buttons.length > 0 ? [new ActionRowBuilder().addComponents(buttons.slice(0, 5))] : [];
  }

  _createNavigationButtons(room, _dungeon) {
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
  }
}
