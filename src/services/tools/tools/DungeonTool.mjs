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
import { roomImageCache } from '../../dnd/DungeonService.mjs';

export class DungeonTool extends BasicTool {
  constructor({ logger, dungeonService, partyService, characterService, discordService, questService, tutorialQuestService, schemaService, locationService, dungeonMasterService, itemService }) {
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
    this.itemService = itemService;

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
    
    // Check if we're in a thread or main channel
    const isThread = message?.channel?.isThread?.() || false;

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
        return await this._showStatus(avatar, channelId, activeDungeon, message, isThread);
      }

      // Route to specific actions
      switch (action) {
        case 'enter':
        case 'start':
        case 'begin':
          return await this._enter(avatar, params, message, channelId, activeDungeon, isThread);
        case 'map':
          return await this._showMap(avatar, activeDungeon);
        case 'move':
          return await this._move(avatar, params, activeDungeon, message, isThread);
        case 'fight':
        case 'attack':
        case 'battle':
          return await this._startCombat(avatar, activeDungeon, message);
        case 'loot':
        case 'treasure':
          return await this._loot(avatar, params.slice(1), activeDungeon, message);
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
   * Create an atmospheric message with actionable buttons instead of technical error
   */
  _narrateError(message) {
    // Map errors to narratives and action buttons
    const errorMappings = {
      'Party not found': {
        narrative: '*The dungeon gates remain sealed. You must gather a party before venturing forth...*',
        button: { id: 'dnd_party_create', label: 'Create Party', emoji: '👥' }
      },
      'Party already in a dungeon': {
        narrative: '*Your party is already exploring the depths. Continue your current adventure!*',
        button: { id: 'dnd_dungeon_status', label: 'View Adventure', emoji: '🗺️' }
      },
      'No active dungeon': {
        narrative: '*No dungeon lies active. The ancient stones lie dormant. Begin a new adventure to explore the depths!*',
        button: { id: 'dnd_dungeon_start', label: 'Start Adventure', emoji: '⚔️' }
      },
      'not in a party': {
        narrative: '*A lone adventurer cannot face these depths alone. Gather companions for your journey!*',
        button: { id: 'dnd_party_create', label: 'Create Party', emoji: '👥' }
      },
      'Must clear current room': {
        narrative: '*The path forward is blocked! You must deal with the current challenge before advancing...*',
        button: { id: 'dnd_combat_start', label: 'Fight!', emoji: '⚔️' }
      },
      'Must solve the puzzle': {
        narrative: '*Ancient runes block your passage! You must solve the riddle to proceed...*',
        button: { id: 'dnd_puzzle_answer', label: 'Answer Riddle', emoji: '🧩' }
      },
      'Combat rooms must be cleared': {
        narrative: '*Enemies block your path! You cannot flee from this battle...*',
        button: { id: 'dnd_combat_start', label: 'Fight!', emoji: '⚔️' }
      }
    };

    // Find matching mapping or use generic
    let mapping = { 
      narrative: '*The shadows whisper of an unknown obstacle...*',
      button: null 
    };
    for (const [key, value] of Object.entries(errorMappings)) {
      if (message.toLowerCase().includes(key.toLowerCase())) {
        mapping = value;
        break;
      }
    }

    const response = {
      embeds: [{
        author: { name: '🎲 The Dungeon Master' },
        description: mapping.narrative,
        color: 0x7C3AED, // DM purple
        footer: { text: mapping.button ? 'Click below to continue your journey' : 'The path forward is unclear...' }
      }]
    };

    // Add action button if available
    if (mapping.button) {
      response.components = [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(mapping.button.id)
            .setLabel(mapping.button.label)
            .setEmoji(mapping.button.emoji)
            .setStyle(ButtonStyle.Primary)
        )
      ];
    }

    return response;
  }

  /**
   * Build response for when party already has an active dungeon
   * Creates thread if missing (fixes corrupted state)
   */
  async _buildActiveDungeonResponse(dungeon, message, avatar) {
    let threadId = dungeon.threadId;
    
    // Validate existing thread is still accessible
    if (threadId && this.discordService?.client) {
      try {
        const existingThread = await this.discordService.client.channels.fetch(threadId);
        if (!existingThread || existingThread.archived) {
          this.logger?.info?.(`[DungeonTool] Thread ${threadId} is archived/deleted, will create new one`);
          threadId = null;
          await this.dungeonService.setThreadId(dungeon._id, null);
        }
      } catch (e) {
        this.logger?.info?.(`[DungeonTool] Thread ${threadId} not accessible: ${e.message}`);
        threadId = null;
        await this.dungeonService.setThreadId(dungeon._id, null).catch(() => {});
      }
    }
    
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
          
          // Post immediate loading message so thread isn't empty
          const loadingMsg = await thread.send({
            embeds: [{
              author: { name: '🎲 The Dungeon Master' },
              title: '🏰 Restoring Your Adventure...',
              description: '*The ancient passages reveal themselves once more...*',
              color: 0x7C3AED,
              footer: { text: 'Loading dungeon state...' }
            }]
          });
          
          // Post initial content to the new thread
          const currentRoom = dungeon.rooms.find(r => r.id === dungeon.currentRoom);
          const clearedCount = dungeon.rooms.filter(r => r.cleared).length;
          const totalRooms = dungeon.rooms.length;
          
          // Try to get cached room image first, then generate if needed
          let roomImageUrl = null;
          try {
            if (this.schemaService?.generateImage) {
              roomImageUrl = await roomImageCache.getOrGenerate(
                dungeon.theme,
                currentRoom?.type || 'combat',
                async () => {
                  const prompt = this._getRoomImagePrompt(currentRoom, dungeon.theme);
                  return await this.schemaService.generateImage(prompt, '16:9', {
                    purpose: 'dungeon_room',
                    category: 'dungeon',
                    tags: [dungeon.theme, currentRoom?.type || 'combat', 'dungeon', 'room'],
                    metadata: { 
                      theme: dungeon.theme, 
                      roomType: currentRoom?.type,
                      dungeonId: dungeon._id?.toString()
                    },
                    useCache: true,
                    cacheChance: 0.7 // 70% chance to reuse cached image
                  });
                }
              );
            }
          } catch (e) {
            this.logger?.warn?.(`[DungeonTool] Room image generation failed: ${e.message}`);
          }
          
          const roomNarrative = await this._getRoomNarrative(currentRoom, dungeon);
          const recoveryEmbed = {
            author: { name: '🎲 The Dungeon Master' },
            title: `⚔️ ${dungeon.name}`,
            description: `*Your adventure continues...*\n\n${roomNarrative}`,
            color: this._getRoomColor(currentRoom?.type),
            fields: [
              { name: '📍 Location', value: `${this._getRoomTitle(currentRoom?.type)} (${dungeon.currentRoom.replace('room_', '')}/${totalRooms})`, inline: true },
              { name: '✅ Progress', value: `${clearedCount}/${totalRooms} rooms cleared`, inline: true }
            ],
            footer: { text: 'Adventure thread restored' }
          };
          
          if (roomImageUrl) {
            recoveryEmbed.image = { url: roomImageUrl };
          }
          
          // Add enemy info if present
          if (currentRoom?.encounter?.monsters?.length && !currentRoom.cleared) {
            recoveryEmbed.fields.push({
              name: '⚔️ Enemies Present',
              value: currentRoom.encounter.monsters.map(m => `${m.emoji || '👹'} ${m.name || m.id}`).join(', '),
              inline: false
            });
          }
          
          // Delete loading message and post actual status
          try {
            await loadingMsg.delete();
          } catch {
            // Ignore delete failures
          }
          
          // Post to thread with proper error handling
          try {
            await thread.send({ 
              embeds: [recoveryEmbed], 
              components: this._createRoomButtons(currentRoom) 
            });
            this.logger?.info?.(`[DungeonTool] Posted recovery status to thread ${thread.id}`);
          } catch (sendErr) {
            this.logger?.error?.(`[DungeonTool] Failed to post recovery status: ${sendErr.message}`);
            // Try a simpler message as fallback
            await thread.send(`🏰 **${dungeon.name}** - Your adventure continues in ${this._getRoomTitle(currentRoom?.type)}`).catch(() => {});
          }
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
  async _showStatus(avatar, channelId, activeDungeon, message, isThread = false) {
    if (activeDungeon) {
      let threadId = activeDungeon.threadId;
      const isInDungeonThread = threadId && channelId === threadId;
      
      // THREAD ENFORCEMENT: If we're NOT in a thread at all, always redirect
      // Never show full dungeon status/buttons in a main channel
      if (!isThread) {
        // Validate existing thread is still accessible before redirecting
        if (threadId && this.discordService?.client?.channels?.fetch) {
          try {
            const existingThread = await this.discordService.client.channels.fetch(threadId);
            if (!existingThread || existingThread.archived) {
              this.logger?.info?.(`[DungeonTool] Thread ${threadId} is archived/deleted, will create new one`);
              threadId = null;
              // Clear invalid threadId from dungeon
              await this.dungeonService.setThreadId(activeDungeon._id, null);
            }
          } catch (e) {
            // Thread doesn't exist or can't be accessed
            this.logger?.info?.(`[DungeonTool] Thread ${threadId} not accessible: ${e.message}`);
            threadId = null;
            await this.dungeonService.setThreadId(activeDungeon._id, null).catch(() => {});
          }
        }
        
        // If dungeon has a valid thread, redirect there
        if (threadId) {
          return {
            embeds: [{
              author: { name: '🎲 The Dungeon Master' },
              title: `⚔️ ${activeDungeon.name}`,
              description: `*Your adventure awaits...*\n\n**Continue in** <#${threadId}>`,
              color: 0x7C3AED,
              footer: { text: 'Dungeon commands only work in the adventure thread' }
            }]
          };
        }
        
        // No thread exists - try to create one and redirect
        if (this.discordService?.client && message?.channel?.id) {
          try {
            const channel = await this.discordService.client.channels.fetch(message.channel.id);
            if (channel?.threads?.create) {
              const thread = await channel.threads.create({
                name: `⚔️ ${activeDungeon.name}`,
                autoArchiveDuration: 1440,
                reason: `Recovering dungeon thread for ${avatar?.name || 'party'}'s adventure`
              });
              await this.dungeonService.setThreadId(activeDungeon._id, thread.id);
              this.logger?.info?.(`[DungeonTool] Created recovery thread ${thread.id} for dungeon ${activeDungeon._id}`);
              
              // Post initial loading message IMMEDIATELY so thread isn't empty
              const loadingMsg = await thread.send({
                embeds: [{
                  author: { name: '🎲 The Dungeon Master' },
                  title: '🏰 Restoring Your Adventure...',
                  description: '*The ancient passages reveal themselves once more...*',
                  color: 0x7C3AED,
                  footer: { text: 'Loading dungeon state...' }
                }]
              });
              
              // Post initial dungeon status to the new thread
              const currentRoom = activeDungeon.rooms.find(r => r.id === activeDungeon.currentRoom);
              const clearedCount = activeDungeon.rooms.filter(r => r.cleared).length;
              const totalRooms = activeDungeon.rooms.length;
              
              // Try to get cached room image first, then generate if needed
              let roomImageUrl = null;
              try {
                if (this.schemaService?.generateImage) {
                  roomImageUrl = await roomImageCache.getOrGenerate(
                    activeDungeon.theme,
                    currentRoom?.type || 'combat',
                    async () => {
                      const prompt = this._getRoomImagePrompt(currentRoom, activeDungeon.theme);
                      return await this.schemaService.generateImage(prompt, '16:9', {
                        purpose: 'dungeon_room',
                        category: 'dungeon',
                        tags: [activeDungeon.theme, currentRoom?.type || 'combat', 'dungeon', 'room'],
                        metadata: { 
                          theme: activeDungeon.theme, 
                          roomType: currentRoom?.type,
                          dungeonId: activeDungeon._id?.toString()
                        },
                        useCache: true,
                        cacheChance: 0.7 // 70% chance to reuse cached image
                      });
                    }
                  );
                }
              } catch (e) {
                this.logger?.warn?.(`[DungeonTool] Room image generation failed: ${e.message}`);
              }
              
              const roomNarrative = await this._getRoomNarrative(currentRoom, activeDungeon);
              const recoveryEmbed = {
                author: { name: '🎲 The Dungeon Master' },
                title: `⚔️ ${activeDungeon.name}`,
                description: `*The ancient passages reveal themselves once more...*\n\n${roomNarrative}`,
                color: this._getRoomColor(currentRoom?.type),
                fields: [
                  { name: '📍 Location', value: `${this._getRoomTitle(currentRoom?.type)} (${activeDungeon.currentRoom.replace('room_', '')}/${totalRooms})`, inline: true },
                  { name: '✅ Progress', value: `${clearedCount}/${totalRooms} rooms cleared`, inline: true }
                ],
                footer: { text: 'Adventure thread restored • Your journey continues...' }
              };
              
              if (roomImageUrl) {
                recoveryEmbed.image = { url: roomImageUrl };
              }
              
              // Add room-specific info
              if (currentRoom?.encounter?.monsters?.length && !currentRoom.cleared) {
                recoveryEmbed.fields.push({
                  name: '⚔️ Enemies Present',
                  value: currentRoom.encounter.monsters.map(m => `${m.emoji || '👹'} ${m.name || m.id}`).join(', '),
                  inline: false
                });
              }
              
              // Delete loading message and post full status
              try {
                await loadingMsg.delete();
              } catch {
                // Ignore delete failures
              }
              
              // Post to thread with action buttons
              try {
                await thread.send({ 
                  embeds: [recoveryEmbed], 
                  components: this._createRoomButtons(currentRoom) 
                });
                this.logger?.info?.(`[DungeonTool] Posted recovery status to thread ${thread.id}`);
              } catch (sendErr) {
                this.logger?.error?.(`[DungeonTool] Failed to post recovery status: ${sendErr.message}`);
                // Try a simpler message as fallback
                await thread.send(`🏰 **${activeDungeon.name}** - Your adventure continues in ${this._getRoomTitle(currentRoom?.type)}`).catch(() => {});
              }
              
              return {
                embeds: [{
                  author: { name: '🎲 The Dungeon Master' },
                  title: `⚔️ ${activeDungeon.name}`,
                  description: `*The ancient passages reveal themselves once more...*\n\n**Continue in** <#${thread.id}>`,
                  color: 0x7C3AED,
                  footer: { text: 'Adventure thread restored' }
                }]
              };
            }
          } catch (e) {
            this.logger?.warn?.(`[DungeonTool] Failed to create recovery thread: ${e.message}`);
          }
        }
        
        // Failed to create thread - show abandon option
        return {
          embeds: [{
            author: { name: '🎲 The Dungeon Master' },
            title: `⚔️ ${activeDungeon.name}`,
            description: `*Your adventure thread has been lost to the void...*\n\nAbandon this dungeon and start fresh, or try again.`,
            color: 0x7C3AED,
            footer: { text: 'Use abandon to start a new adventure' }
          }],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId('dnd_dungeon_abandon')
                .setLabel('Abandon Dungeon')
                .setEmoji('🚪')
                .setStyle(ButtonStyle.Danger)
            )
          ]
        };
      }
      
      // We're in a thread - but check if it's the RIGHT thread
      if (threadId && !isInDungeonThread) {
        return {
          embeds: [{
            author: { name: '🎲 The Dungeon Master' },
            title: `⚔️ ${activeDungeon.name}`,
            description: `*This is not your dungeon's thread...*\n\n**Continue in** <#${threadId}>`,
            color: 0x7C3AED
          }]
        };
      }
      
      // In the correct dungeon thread - show full room status
      const currentRoom = activeDungeon.rooms.find(r => r.id === activeDungeon.currentRoom);
      const clearedCount = activeDungeon.rooms.filter(r => r.cleared).length;
      const totalRooms = activeDungeon.rooms.length;

      const roomNarrative = await this._getRoomNarrative(currentRoom, activeDungeon);
      const embed = {
        author: { name: '🎲 The Dungeon Master' },
        title: `⚔️ ${activeDungeon.name}`,
        description: roomNarrative,
        color: this._getRoomColor(currentRoom?.type),
        fields: [
          { name: '📍 Location', value: `${this._getRoomTitle(currentRoom?.type)} (${activeDungeon.currentRoom.replace('room_', '')}/${totalRooms})`, inline: true },
          { name: '✅ Progress', value: `${clearedCount}/${totalRooms} rooms cleared`, inline: true }
        ]
      };

      // Show room-specific content
      if (currentRoom) {
        if (currentRoom.puzzle && !currentRoom.puzzle.solved) {
          // Unsolved puzzle - show riddle with answer button
          embed.fields.push({
            name: '🧩 A Riddle Blocks Your Path',
            value: `*"${currentRoom.puzzle.riddle}"*`,
            inline: false
          });
          
          return {
            embeds: [embed],
            components: [
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId('dnd_puzzle_answer')
                  .setLabel('Answer Riddle')
                  .setEmoji('🧩')
                  .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                  .setCustomId('dnd_puzzle_hint')
                  .setLabel('Get Hint')
                  .setEmoji('💡')
                  .setStyle(ButtonStyle.Primary)
              )
            ]
          };
        } else if ((currentRoom.type === 'combat' || currentRoom.type === 'boss') && currentRoom.encounter?.monsters?.length && !currentRoom.cleared) {
          // Combat or boss room - show enemies with Fight button
          embed.fields.push({
            name: currentRoom.type === 'boss' ? '💀 Boss' : '⚔️ Enemies',
            value: currentRoom.encounter.monsters.map(m => `${m.emoji || '👹'} ${m.name || m.id}`).join(', '),
            inline: false
          });
          return {
            embeds: [embed],
            components: this._createRoomButtons(currentRoom)
          };
        } else if (currentRoom.type === 'treasure' && !currentRoom.cleared) {
          // Treasure room
          embed.fields.push({
            name: '💰 Treasure',
            value: 'Riches await collection!',
            inline: false
          });
          return {
            embeds: [embed],
            components: this._createRoomButtons(currentRoom)
          };
        } else {
          // Other room types or cleared rooms
          embed.fields.push({
            name: `${this._getRoomEmoji(currentRoom.type)} Status`,
            value: this._describeRoomBrief(currentRoom),
            inline: false
          });
        }
      }

      return { 
        embeds: [embed],
        components: this._createNavigationButtons(currentRoom, activeDungeon)
      };
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
  async _enter(avatar, params, message, channelId, existingDungeon, _isThread = false) {
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

    // Generate atmospheric entrance image using cache for reuse
    let imageUrl = null;
    try {
      if (this.schemaService?.generateImage) {
        imageUrl = await roomImageCache.getOrGenerate(
          dungeon.theme,
          'entrance',
          async () => {
            const prompt = `${dungeon.theme} dungeon entrance, ancient stone doorway, fantasy RPG art, atmospheric mist, torchlight, mysterious and ominous, detailed architecture`;
            return await this.schemaService.generateImage(prompt, '16:9', {
              purpose: 'dungeon_room',
              category: 'dungeon',
              tags: [dungeon.theme, 'entrance', 'dungeon', 'room'],
              metadata: { 
                theme: dungeon.theme, 
                roomType: 'entrance',
                dungeonId: dungeon._id?.toString()
              },
              useCache: true,
              cacheChance: 0.7 // 70% chance to reuse cached image
            });
          }
        );
      }
    } catch (e) {
      this.logger?.warn?.(`[DungeonTool] Image generation failed: ${e.message}`);
    }

    // Create a thread for the dungeon adventure
    let threadId = null;
    if (this.discordService?.client && message?.channel?.id) {
      try {
        let channel = await this.discordService.client.channels.fetch(message.channel.id);
        
        // If we're already in a thread, get the parent channel to create a new thread there
        // This handles the case where a dungeon was cleared and user starts a new one from the old thread
        if (channel?.isThread?.()) {
          const parentChannel = channel.parent;
          if (parentChannel) {
            this.logger?.info?.(`[DungeonTool] In thread ${channel.id}, creating new dungeon thread in parent ${parentChannel.id}`);
            channel = parentChannel;
          }
        }
        
        if (channel?.threads?.create) {
          const thread = await channel.threads.create({
            name: `⚔️ ${dungeon.name}`,
            autoArchiveDuration: 1440, // 24 hours
            reason: `Dungeon adventure for ${avatar.name}'s party`
          });
          threadId = thread.id;

          // Post immediate loading feedback to thread (C-5 fix)
          const loadingEmbed = await thread.send({
            embeds: [{
              author: { name: '🎲 The Dungeon Master' },
              title: '🏰 Preparing Your Adventure...',
              description: `*The ancient stones shift and groan as reality bends to reveal the dungeon...*\n\n⏳ **Generating location...**\n⏳ **Populating monsters...**\n⏳ **Placing treasure...**\n⏳ **Creating atmosphere...**`,
              color: 0x7C3AED,
              footer: { text: 'The dungeon materializes before you...' }
            }]
          });

          // Save thread ID to dungeon
          await this.dungeonService.setThreadId(dungeon._id, threadId);

          // Generate entrance image (can take time)
          let threadImageUrl = imageUrl;
          if (!threadImageUrl && this.schemaService?.generateImage) {
            try {
              // Update loading message with progress
              await loadingEmbed.edit({
                embeds: [{
                  author: { name: '🎲 The Dungeon Master' },
                  title: '🏰 Preparing Your Adventure...',
                  description: `*The ancient stones shift and groan as reality bends to reveal the dungeon...*\n\n✅ **Location generated**\n✅ **Monsters populated**\n✅ **Treasure placed**\n⏳ **Generating entrance artwork...**`,
                  color: 0x7C3AED,
                  footer: { text: 'Almost ready...' }
                }]
              });
            } catch {
              // Ignore edit failures
            }
          }

          // Delete loading message now that we're ready
          try {
            await loadingEmbed.delete();
          } catch {
            // Ignore delete failures
          }

          // Post the grand entrance in the thread
          const firstRoom = dungeon.rooms[0];
          const entranceNarrative = await this._getRoomNarrative(firstRoom, dungeon);
          const introEmbed = {
            author: { name: '🎲 The Dungeon Master' },
            title: `🏰 ${dungeon.name}`,
            description: entranceNarrative,
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
        { 
          name: '📝 How to Answer', 
          value: 'Click **Answer Riddle** below to submit your answer', 
          inline: false 
        }
      ],
      footer: { text: `${puzzle.maxAttempts} attempts remaining • Wrong answers lose an attempt` }
    };

    await thread.send({ 
      embeds: [puzzleEmbed],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('dnd_puzzle_answer')
            .setLabel('Answer Riddle')
            .setEmoji('🧩')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('dnd_puzzle_hint')
            .setLabel('Get Hint')
            .setEmoji('💡')
            .setStyle(ButtonStyle.Primary)
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
  async _move(avatar, params, dungeon, _message, isThread = false) {
    if (!dungeon) {
      return this._narrateError('No active dungeon');
    }
    
    // If we're not in the dungeon thread, redirect there
    if (dungeon.threadId && !isThread) {
      return {
        embeds: [{
          author: { name: '🎲 The Dungeon Master' },
          title: `⚔️ ${dungeon.name}`,
          description: `*Your adventure continues...*\n\n**Use dungeon commands in** <#${dungeon.threadId}>`,
          color: 0x7C3AED
        }]
      };
    }

    const roomId = params[1] || params.room;
    if (!roomId) {
      return await this._showMap(avatar, dungeon);
    }

    // Normalize room ID (allow "2" or "room_2")
    const targetRoom = roomId.startsWith('room_') ? roomId : `room_${roomId}`;

    let result;
    try {
      result = await this.dungeonService.enterRoom(dungeon._id, targetRoom);
    } catch (e) {
      // Convert room entry errors to atmospheric messages
      return this._narrateError(e.message);
    }
    const room = result.room;

    // Generate room image using cache for cost savings
    let imageUrl = null;
    try {
      if (this.schemaService?.generateImage) {
        // Use room image cache with declining probability
        imageUrl = await roomImageCache.getOrGenerate(
          dungeon.theme,
          room.type,
          async () => {
            const prompt = this._getRoomImagePrompt(room, dungeon.theme);
            return await this.schemaService.generateImage(prompt, '16:9', {
              purpose: 'dungeon_room',
              category: 'dungeon',
              tags: [dungeon.theme, room.type, 'dungeon', 'room'],
              metadata: { 
                theme: dungeon.theme, 
                roomType: room.type,
                dungeonId: dungeon._id?.toString()
              },
              useCache: true,
              cacheChance: 0.7 // 70% chance to reuse cached image
            });
          }
        );
      }
    } catch (e) {
      this.logger?.warn?.(`[DungeonTool] Room image failed: ${e.message}`);
    }

    const roomNarrative = await this._getRoomNarrative(room, dungeon);

    // Post to dungeon thread if available
    if (dungeon.threadId && this.discordService?.client) {
      try {
        const thread = await this.discordService.client.channels.fetch(dungeon.threadId);
        if (thread) {
          const roomEmbed = {
            author: { name: '🎲 The Dungeon Master' },
            title: `${this._getRoomEmoji(room.type)} ${this._getRoomTitle(room.type)}`,
            description: roomNarrative,
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

    // If we're in the dungeon thread, show the full room embed (already posted above or direct response)
    if (isThread) {
      const roomEmbed = {
        author: { name: '🎲 The Dungeon Master' },
        title: `${this._getRoomEmoji(room.type)} ${this._getRoomTitle(room.type)}`,
        description: roomNarrative,
        color: this._getRoomColor(room.type)
      };
      
      if (imageUrl) {
        roomEmbed.image = { url: imageUrl };
      }

      if (room.encounter?.monsters?.length && !room.cleared) {
        roomEmbed.fields = [{
          name: '👹 Enemies',
          value: room.encounter.monsters.map(m => 
            `${m.emoji || '👹'} **${m.name || m.id}** ×${m.count || 1}`
          ).join('\n'),
          inline: false
        }];
      }

      // If room has unsolved puzzle, show the riddle
      if (room.puzzle && !room.puzzle.solved) {
        roomEmbed.fields = roomEmbed.fields || [];
        roomEmbed.fields.push({
          name: '🧩 A Riddle Blocks Your Path',
          value: `*"${room.puzzle.riddle}"*`,
          inline: false
        });
      }

      return { 
        embeds: [roomEmbed], 
        components: this._createRoomButtons(room)
      };
    }

    // Not in thread - show redirect message
    const description = dungeon.threadId 
      ? `*The party moves deeper into the ${dungeon.theme} dungeon...*\n\n**Continue in** <#${dungeon.threadId}>`
      : `*The party moves deeper into the ${dungeon.theme} dungeon...*`;

    return {
      embeds: [{
        author: { name: '🎲 The Dungeon Master' },
        description,
        color: 0x3B82F6,
        footer: { text: 'The adventure continues...' }
      }]
    };
  }

  /**
   * Start combat in current room
   * C-1/C-2 fix: Actually integrates with DungeonService.startRoomCombat
   * THREAD ENFORCEMENT: Combat only starts in threads, never in main channels
   */
  async _startCombat(avatar, dungeon, message) {
    if (!dungeon) {
      return this._narrateError('No active dungeon');
    }

    // THREAD ENFORCEMENT: Never start combat in a main channel
    const isThread = message?.channel?.isThread?.() || false;
    if (!isThread) {
      const threadId = dungeon.threadId;
      if (threadId) {
        return {
          embeds: [{
            author: { name: '🎲 The Dungeon Master' },
            title: `⚔️ ${dungeon.name}`,
            description: `*The battle awaits, but not here...*\n\n**Fight in** <#${threadId}>`,
            color: 0x7C3AED,
            footer: { text: 'Combat only happens in dungeon threads' }
          }]
        };
      }
      // No thread - this shouldn't happen, but handle gracefully
      return {
        embeds: [{
          author: { name: '🎲 The Dungeon Master' },
          description: `*The dungeon has no active thread. Use* 🏰 *to restore it.*`,
          color: 0x7C3AED
        }]
      };
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

    // We're in a thread - use this channel for combat
    const combatChannelId = message?.channel?.id;

    // C-1/C-2 fix: Actually start combat via DungeonService integration
    try {
      const encounter = await this.dungeonService.startRoomCombat(
        dungeon._id,
        room.id,
        combatChannelId
      );

      if (encounter) {
        // Combat started successfully - CombatEncounterService is now managing it
        const monsterList = room.encounter.monsters
          .map(m => `${m.emoji || '👹'} **${m.name || m.id}** ×${m.count || 1}`)
          .join('\n');

        return {
          embeds: [{
            author: { name: '🎲 The Dungeon Master' },
            title: '⚔️ COMBAT BEGINS!',
            description: `*Steel clashes against steel as battle erupts!*\n\n**Enemies:**\n${monsterList}\n\n*Initiative has been rolled. The battle is managed by the combat system.*`,
            color: 0xEF4444,
            footer: { text: 'May fortune favor the bold!' }
          }]
        };
      }
    } catch (combatError) {
      this.logger?.warn?.(`[DungeonTool] Failed to start combat via service: ${combatError.message}`);
      // Fall through to manual combat UI if service fails
    }

    // Fallback: Show combat UI if CombatEncounterService not available or failed
    return {
      embeds: [{
        author: { name: '🎲 The Dungeon Master' },
        title: '⚔️ COMBAT BEGINS!',
        description: `*Steel clashes against steel as battle erupts!*\n\nThe party faces **${room.encounter.monsters.map(m => m.name || m.id).join(', ')}**!`,
        color: 0xEF4444,
        footer: { text: 'Use the buttons below or 🗡️ attack to strike!' }
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
   * Collect treasure in current room or handle loot roll decisions
   */
  async _loot(avatar, params, dungeon, message) {
    if (!dungeon) {
      return this._narrateError('No active dungeon');
    }

    const subAction = (params?.[0] || '').toLowerCase();
    if (['need', 'greed', 'pass'].includes(subAction)) {
      const rollId = params?.[1];
      return this._handleLootChoice(avatar, dungeon, subAction, rollId, message);
    }

    const result = await this.dungeonService.collectTreasure(dungeon._id, dungeon.currentRoom);
    
    await this.tutorialQuestService?.onEvent?.(avatar._id, 'treasure_collected');

    // Format items properly - items are objects with { id, name, count, emoji, rarity }
    const itemList = result.items.length > 0 
      ? result.items.map(item => {
          const emoji = item.emoji || '📦';
          const name = item.name || item.id || 'Unknown Item';
          const count = item.count > 1 ? ` x${item.count}` : '';
          return `${emoji} ${name}${count}`;
        }).join('\n') 
      : 'nothing but dust';

    const response = {
      embeds: [{
        author: { name: '🎲 The Dungeon Master' },
        title: '💰 Treasure Claimed!',
        description: `*${avatar.name} searches the room and discovers...*\n\n🪙 **${result.gold} gold pieces**\n\n${itemList}`,
        color: 0xF59E0B
      }],
      components: this._createNavigationButtons(
        dungeon.rooms.find(r => r.id === dungeon.currentRoom),
        dungeon
      )
    };

    if (result?.storedItemIds?.length && this.partyService?.createLootRoll) {
      await this._startLootRolls(result.storedItemIds, dungeon, avatar, message);
    }

    return response;
  }

  async _startLootRolls(itemIds, dungeon, avatar, message) {
    if (!this.discordService?.client || !this.partyService) return;
    const channelId = dungeon.threadId || message?.channel?.id;
    if (!channelId) return;

    let channel;
    try {
      channel = await this.discordService.client.channels.fetch(channelId);
    } catch (e) {
      this.logger?.warn?.(`[DungeonTool] Failed to fetch loot channel: ${e.message}`);
      return;
    }

    for (const itemId of itemIds) {
      try {
        const item = await this.itemService?.getItem?.(itemId);
        const roll = await this.partyService.createLootRoll({
          partyId: dungeon.partyId,
          itemId,
          channelId,
          createdBy: avatar._id
        });

        const { embed, components } = this._buildLootRollMessage(item, roll);
        const rollMessage = await channel.send({ embeds: [embed], components });
        await this.partyService.setLootRollMessage(roll._id, rollMessage.id);
      } catch (e) {
        this.logger?.warn?.(`[DungeonTool] Failed to start loot roll: ${e.message}`);
      }
    }
  }

  async _handleLootChoice(avatar, dungeon, choice, rollId, _message) {
    if (!rollId) {
      return this._narrateError('No loot roll found');
    }

    let roll = null;
    try {
      roll = await this.partyService.getLootRoll(rollId);
    } catch {
      roll = null;
    }

    if (!roll) {
      return this._narrateError('No loot roll found');
    }

    const party = await this.partyService.getParty(roll.partyId);
    const isMember = party?.members?.some(m => String(m.avatarId) === String(avatar._id));
    if (!isMember) {
      return this._narrateError('Party not found');
    }

    const now = Date.now();
    const expired = roll.expiresAt && new Date(roll.expiresAt).getTime() <= now;

    if (expired && roll.status === 'pending') {
      const resolved = await this.partyService.resolveLootRoll(roll, { resolvedBy: avatar._id });
      await this._updateLootRollMessage(resolved);
      return {
        embeds: [{
          author: { name: '🎲 The Dungeon Master' },
          title: '⏳ Loot Roll Closed',
          description: '*The moment has passed. The treasure is claimed as fate decides...*',
          color: 0x6B7280
        }]
      };
    }

    const result = await this.partyService.submitLootChoice(rollId, avatar._id, choice);
    if (result.alreadyResolved) {
      return {
        embeds: [{
          author: { name: '🎲 The Dungeon Master' },
          title: '✅ Loot Already Resolved',
          description: '*This treasure has already been claimed.*',
          color: 0x6B7280
        }]
      };
    }
    if (result.alreadySubmitted) {
      return {
        embeds: [{
          author: { name: '🎲 The Dungeon Master' },
          title: '📝 Choice Already Made',
          description: '*You have already declared your intent for this treasure.*',
          color: 0x6B7280
        }]
      };
    }

    roll = result.roll || roll;
    const totalMembers = party?.members?.length || 0;
    const choiceCount = roll.choices?.length || 0;
    const shouldResolve = totalMembers > 0 && choiceCount >= totalMembers;

    if (shouldResolve) {
      const resolved = await this.partyService.resolveLootRoll(roll, { resolvedBy: avatar._id });
      await this._updateLootRollMessage(resolved);
    }

    const rollText = typeof result.rollValue === 'number'
      ? `Roll: **${result.rollValue}**`
      : 'You passed on this item.';

    return {
      embeds: [{
        author: { name: '🎲 The Dungeon Master' },
        title: '🎲 Loot Roll Recorded',
        description: `*Your decision is sealed.*\n\n**Choice:** ${choice.toUpperCase()}\n${rollText}`,
        color: 0x7C3AED
      }]
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

    const puzzle = await this.dungeonService.getPuzzle(dungeon._id);
    
    // Handle special commands: hint, skip
    const firstParam = params[0]?.toLowerCase();
    
    if (firstParam === 'hint') {
      if (!puzzle || puzzle.solved) {
        return {
          embeds: [{
            author: { name: '🎲 The Dungeon Master' },
            description: '*No riddle blocks your path. The way forward is clear.*',
            color: 0x10B981
          }]
        };
      }
      
      const hint = puzzle.hint || 'The ancient magic offers no further guidance...';
      return {
        embeds: [{
          author: { name: '🎲 The Dungeon Master' },
          title: '💡 A Hint From the Ancients',
          description: `*Mystical energy swirls, revealing a clue...*\n\n**${hint}**`,
          color: 0x8B5CF6,
          fields: [
            { name: '🧩 The Riddle', value: `"${puzzle.riddle}"`, inline: false },
            { name: '⏳ Attempts Remaining', value: `${puzzle.attemptsLeft}`, inline: true }
          ],
          footer: { text: 'Reply with your answer in this thread!' }
        }]
      };
    }

    const answer = params.join(' ').trim();
    
    if (!answer) {
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
          footer: { text: 'Reply with your answer in this thread!' }
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

  async _getRoomNarrative(room, dungeon) {
    if (!room) {
      return '*The air is still as the party advances...*';
    }

    if (this.dungeonMasterService?.generateRoomDescription) {
      try {
        return await this.dungeonMasterService.generateRoomDescription(room, dungeon);
      } catch (e) {
        this.logger?.debug?.(`[DungeonTool] DM narration failed: ${e.message}`);
      }
    }

    return this._getFallbackRoomNarrative(room, dungeon?.theme);
  }

  _getFallbackRoomNarrative(room, theme) {
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
  }

  _buildLootRollMessage(item, roll) {
    const itemName = item?.name || 'Mysterious Loot';
    const itemEmoji = item?.emoji || '🎁';
    const timeLeftMs = roll?.expiresAt ? new Date(roll.expiresAt).getTime() - Date.now() : null;
    const timeLeft = timeLeftMs && timeLeftMs > 0 ? Math.ceil(timeLeftMs / 1000) : null;
    const timerText = timeLeft ? `⏳ ${timeLeft}s remaining` : '⏳ Limited time';

    const embed = {
      author: { name: '🎲 The Dungeon Master' },
      title: `🎲 Loot Roll: ${itemEmoji} ${itemName}`,
      description: `*A treasure glints in the torchlight...*\n\nChoose your intent: **Need**, **Greed**, or **Pass**.\n\n${timerText}`,
      color: 0x7C3AED,
      footer: { text: 'Highest roll wins (Need over Greed)' }
    };

    const rollId = roll._id?.toString?.() || String(roll._id);
    const components = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`dnd_loot_need_${rollId}`)
          .setLabel('Need')
          .setEmoji('🎲')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`dnd_loot_greed_${rollId}`)
          .setLabel('Greed')
          .setEmoji('💰')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`dnd_loot_pass_${rollId}`)
          .setLabel('Pass')
          .setEmoji('❌')
          .setStyle(ButtonStyle.Secondary)
      )
    ];

    return { embed, components };
  }

  async _updateLootRollMessage(roll) {
    if (!roll?.messageId || !roll?.channelId || !this.discordService?.client) return;

    try {
      const channel = await this.discordService.client.channels.fetch(roll.channelId);
      const msg = await channel.messages.fetch(roll.messageId);
      const item = await this.itemService?.getItem?.(roll.itemId);
      const embed = await this._buildLootRollResultEmbed(roll, item);
      await msg.edit({ embeds: [embed], components: [] });
    } catch (e) {
      this.logger?.warn?.(`[DungeonTool] Failed to update loot roll message: ${e.message}`);
    }
  }

  async _buildLootRollResultEmbed(roll, item) {
    const itemName = item?.name || 'Mysterious Loot';
    const itemEmoji = item?.emoji || '🎁';
    const resultLines = await this._formatLootRollResults(roll);
    const winnerName = await this._resolveLootWinnerName(roll);

    const outcome = roll?.winner
      ? `🏆 **Winner:** ${winnerName} (${roll.winner.choice.toUpperCase()} ${roll.winner.roll})`
      : 'No one claimed the item. It remains in shared inventory.';

    return {
      author: { name: '🎲 The Dungeon Master' },
      title: `✅ Loot Roll Resolved: ${itemEmoji} ${itemName}`,
      description: `${outcome}\n\n${resultLines}`,
      color: 0x10B981
    };
  }

  async _formatLootRollResults(roll) {
    const party = await this.partyService.getPartyWithAvatars(roll.partyId);
    const nameById = new Map(
      (party?.members || []).map(m => [String(m.avatarId), m.avatar?.name || 'Adventurer'])
    );

    const choices = roll.choices || [];
    if (choices.length === 0) {
      return '*No responses recorded.*';
    }

    const lines = choices.map(choice => {
      const name = nameById.get(String(choice.avatarId)) || 'Adventurer';
      if (choice.choice === 'pass') {
        return `- ${name}: PASS`;
      }
      return `- ${name}: ${choice.choice.toUpperCase()} (${choice.roll})`;
    });

    return lines.join('\n');
  }

  async _resolveLootWinnerName(roll) {
    if (!roll?.winner?.avatarId) return 'Unknown Adventurer';
    try {
      const party = await this.partyService.getPartyWithAvatars(roll.partyId);
      const member = party?.members?.find(m => String(m.avatarId) === String(roll.winner.avatarId));
      return member?.avatar?.name || 'Adventurer';
    } catch {
      return 'Adventurer';
    }
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
    // Handle entrance with solved puzzle
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
    
    // Rest room: offer short and long rest options
    if (room.type === 'rest') {
      buttons.push(
        new ButtonBuilder().setCustomId('dnd_character_short_rest').setLabel('Short Rest').setEmoji('☕').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('dnd_character_long_rest').setLabel('Long Rest').setEmoji('🏕️').setStyle(ButtonStyle.Success)
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

    // For non-combat/boss rooms, also show navigation if available
    if (room.type !== 'combat' && room.type !== 'boss' && room.connections?.length > 0) {
      const rows = [];
      rows.push(new ActionRowBuilder().addComponents(buttons.slice(0, 5)));
      
      // Add navigation buttons in a second row
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
