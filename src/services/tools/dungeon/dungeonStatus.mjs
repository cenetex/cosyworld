/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { roomImageCache } from '../../dnd/DungeonService.mjs';
import { buildDungeonActionRows } from '../../dnd/dungeonActions.mjs';

export function createDungeonStatus(tool, ui) {
  const handleAlreadyInDungeon = async (avatar) => {
    try {
      const sheet = await tool.characterService?.getSheet(avatar._id);
      if (sheet?.partyId) {
        const dungeon = await tool.dungeonService.getActiveDungeon(sheet.partyId);
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
      tool.logger.error('[DungeonTool] Error fetching active dungeon:', e);
    }
    return narrateError('Party already in a dungeon');
  };

  const narrateError = (message) => {
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
        color: 0x7C3AED,
        footer: { text: mapping.button ? 'Click below to continue your journey' : 'The path forward is unclear...' }
      }]
    };

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
  };

  const buildActiveDungeonResponse = async (dungeon, message, avatar) => {
    let threadId = dungeon.threadId;

    if (threadId && tool.discordService?.client) {
      try {
        const existingThread = await tool.discordService.client.channels.fetch(threadId);
        if (!existingThread || existingThread.archived) {
          tool.logger?.info?.(`[DungeonTool] Thread ${threadId} is archived/deleted, will create new one`);
          threadId = null;
          await tool.dungeonService.setThreadId(dungeon._id, null);
        }
      } catch (e) {
        tool.logger?.info?.(`[DungeonTool] Thread ${threadId} not accessible: ${e.message}`);
        threadId = null;
        await tool.dungeonService.setThreadId(dungeon._id, null).catch(() => {});
      }
    }

    if (!threadId && tool.discordService?.client && message?.channel?.id) {
      try {
        const channel = await tool.discordService.client.channels.fetch(message.channel.id);
        if (channel?.threads?.create) {
          const thread = await channel.threads.create({
            name: `⚔️ ${dungeon.name}`,
            autoArchiveDuration: 1440,
            reason: `Recovering dungeon thread for ${avatar?.name || 'party'}'s adventure`
          });
          threadId = thread.id;
          await tool.dungeonService.setThreadId(dungeon._id, threadId);
          tool.logger?.info?.(`[DungeonTool] Created missing thread for dungeon ${dungeon._id}`);

          const loadingMsg = await thread.send({
            embeds: [{
              author: { name: '🎲 The Dungeon Master' },
              title: '🏰 Restoring Your Adventure...',
              description: '*The ancient passages reveal themselves once more...*',
              color: 0x7C3AED,
              footer: { text: 'Loading dungeon state...' }
            }]
          });

          const currentRoom = dungeon.rooms.find(r => r.id === dungeon.currentRoom);
          const clearedCount = dungeon.rooms.filter(r => r.cleared).length;
          const totalRooms = dungeon.rooms.length;

          let roomImageUrl = null;
          try {
            if (tool.schemaService?.generateImage) {
              roomImageUrl = await roomImageCache.getOrGenerate(
                dungeon.theme,
                currentRoom?.type || 'combat',
                async () => {
                  const prompt = ui.getRoomImagePrompt(currentRoom, dungeon.theme);
                  return await tool.schemaService.generateImage(prompt, '16:9', {
                    purpose: 'dungeon_room',
                    category: 'dungeon',
                    tags: [dungeon.theme, currentRoom?.type || 'combat', 'dungeon', 'room'],
                    metadata: {
                      theme: dungeon.theme,
                      roomType: currentRoom?.type,
                      dungeonId: dungeon._id?.toString()
                    },
                    useCache: true,
                    cacheChance: 0.7
                  });
                }
              );
            }
          } catch (e) {
            tool.logger?.warn?.(`[DungeonTool] Room image generation failed: ${e.message}`);
          }

          const roomNarrative = await ui.getRoomNarrative(currentRoom, dungeon);
          const recoveryEmbed = {
            author: { name: '🎲 The Dungeon Master' },
            title: `⚔️ ${dungeon.name}`,
            description: `*Your adventure continues...*\n\n${roomNarrative}`,
            color: ui.getRoomColor(currentRoom?.type),
            fields: [
              { name: '📍 Location', value: `${ui.getRoomTitle(currentRoom?.type)} (${dungeon.currentRoom.replace('room_', '')}/${totalRooms})`, inline: true },
              { name: '✅ Progress', value: `${clearedCount}/${totalRooms} rooms cleared`, inline: true }
            ],
            footer: { text: 'Adventure thread restored' }
          };

          if (roomImageUrl) {
            recoveryEmbed.image = { url: roomImageUrl };
          }

          const recoveryMonsterThumb = (currentRoom?.encounter?.monsters?.length && !currentRoom.cleared)
            ? currentRoom.encounter.monsters.find(m => m.imageUrl)?.imageUrl
            : null;
          if (recoveryMonsterThumb) {
            recoveryEmbed.thumbnail = { url: recoveryMonsterThumb };
          }

          if (currentRoom?.encounter?.monsters?.length && !currentRoom.cleared) {
            recoveryEmbed.fields.push({
              name: '⚔️ Enemies Present',
              value: currentRoom.encounter.monsters.map(m => `${m.emoji || '👹'} ${m.name || m.id}`).join(', '),
              inline: false
            });
          }

          try {
            await loadingMsg.delete();
          } catch {}

          try {
            await thread.send({
              embeds: [recoveryEmbed],
              components: buildDungeonActionRows({ room: currentRoom, dungeon })
            });
            tool.logger?.info?.(`[DungeonTool] Posted recovery status to thread ${thread.id}`);
          } catch (sendErr) {
            tool.logger?.error?.(`[DungeonTool] Failed to post recovery status: ${sendErr.message}`);
            await thread.send(`🏰 **${dungeon.name}** - Your adventure continues in ${ui.getRoomTitle(currentRoom?.type)}`).catch(() => {});
          }
        }
      } catch (e) {
        tool.logger?.warn?.(`[DungeonTool] Failed to create recovery thread: ${e.message}`);
      }
    }

    const fields = [{
      name: '👉 Continue Your Adventure',
      value: threadId ? `<#${threadId}>` : '*Thread unavailable - use abandon to restart*',
      inline: false
    }];

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
  };

  const showStatus = async (avatar, channelId, activeDungeon, message, isThread = false) => {
    if (activeDungeon) {
      let threadId = activeDungeon.threadId;
      const isInDungeonThread = threadId && channelId === threadId;

      if (!isThread) {
        if (threadId && tool.discordService?.client?.channels?.fetch) {
          try {
            const existingThread = await tool.discordService.client.channels.fetch(threadId);
            if (!existingThread || existingThread.archived) {
              tool.logger?.info?.(`[DungeonTool] Thread ${threadId} is archived/deleted, will create new one`);
              threadId = null;
              await tool.dungeonService.setThreadId(activeDungeon._id, null);
            }
          } catch (e) {
            tool.logger?.info?.(`[DungeonTool] Thread ${threadId} not accessible: ${e.message}`);
            threadId = null;
            await tool.dungeonService.setThreadId(activeDungeon._id, null).catch(() => {});
          }
        }

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

        if (tool.discordService?.client && message?.channel?.id) {
          try {
            const channel = await tool.discordService.client.channels.fetch(message.channel.id);
            if (channel?.threads?.create) {
              const thread = await channel.threads.create({
                name: `⚔️ ${activeDungeon.name}`,
                autoArchiveDuration: 1440,
                reason: `Recovering dungeon thread for ${avatar?.name || 'party'}'s adventure`
              });
              await tool.dungeonService.setThreadId(activeDungeon._id, thread.id);
              tool.logger?.info?.(`[DungeonTool] Created recovery thread ${thread.id} for dungeon ${activeDungeon._id}`);

              const loadingMsg = await thread.send({
                embeds: [{
                  author: { name: '🎲 The Dungeon Master' },
                  title: '🏰 Restoring Your Adventure...',
                  description: '*The ancient passages reveal themselves once more...*',
                  color: 0x7C3AED,
                  footer: { text: 'Loading dungeon state...' }
                }]
              });

              const currentRoom = activeDungeon.rooms.find(r => r.id === activeDungeon.currentRoom);
              const clearedCount = activeDungeon.rooms.filter(r => r.cleared).length;
              const totalRooms = activeDungeon.rooms.length;

              let roomImageUrl = null;
              try {
                if (tool.schemaService?.generateImage) {
                  roomImageUrl = await roomImageCache.getOrGenerate(
                    activeDungeon.theme,
                    currentRoom?.type || 'combat',
                    async () => {
                      const prompt = ui.getRoomImagePrompt(currentRoom, activeDungeon.theme);
                      return await tool.schemaService.generateImage(prompt, '16:9', {
                        purpose: 'dungeon_room',
                        category: 'dungeon',
                        tags: [activeDungeon.theme, currentRoom?.type || 'combat', 'dungeon', 'room'],
                        metadata: {
                          theme: activeDungeon.theme,
                          roomType: currentRoom?.type,
                          dungeonId: activeDungeon._id?.toString()
                        },
                        useCache: true,
                        cacheChance: 0.7
                      });
                    }
                  );
                }
              } catch (e) {
                tool.logger?.warn?.(`[DungeonTool] Room image generation failed: ${e.message}`);
              }

              const roomNarrative = await ui.getRoomNarrative(currentRoom, activeDungeon);
              const recoveryEmbed = {
                author: { name: '🎲 The Dungeon Master' },
                title: `⚔️ ${activeDungeon.name}`,
                description: `*The ancient passages reveal themselves once more...*\n\n${roomNarrative}`,
                color: ui.getRoomColor(currentRoom?.type),
                fields: [
                  { name: '📍 Location', value: `${ui.getRoomTitle(currentRoom?.type)} (${activeDungeon.currentRoom.replace('room_', '')}/${totalRooms})`, inline: true },
                  { name: '✅ Progress', value: `${clearedCount}/${totalRooms} rooms cleared`, inline: true }
                ],
                footer: { text: 'Adventure thread restored • Your journey continues...' }
              };

              if (roomImageUrl) {
                recoveryEmbed.image = { url: roomImageUrl };
              }

              const statusMonsterThumb = (currentRoom?.encounter?.monsters?.length && !currentRoom.cleared)
                ? currentRoom.encounter.monsters.find(m => m.imageUrl)?.imageUrl
                : null;
              if (statusMonsterThumb) {
                recoveryEmbed.thumbnail = { url: statusMonsterThumb };
              }

              if (currentRoom?.encounter?.monsters?.length && !currentRoom.cleared) {
                recoveryEmbed.fields.push({
                  name: '⚔️ Enemies Present',
                  value: currentRoom.encounter.monsters.map(m => `${m.emoji || '👹'} ${m.name || m.id}`).join(', '),
                  inline: false
                });
              }

              try {
                await loadingMsg.delete();
              } catch {}

              try {
                await thread.send({
                  embeds: [recoveryEmbed],
                  components: buildDungeonActionRows({ room: currentRoom, dungeon: activeDungeon })
                });
                tool.logger?.info?.(`[DungeonTool] Posted recovery status to thread ${thread.id}`);
              } catch (sendErr) {
                tool.logger?.error?.(`[DungeonTool] Failed to post recovery status: ${sendErr.message}`);
                await thread.send(`🏰 **${activeDungeon.name}** - Your adventure continues in ${ui.getRoomTitle(currentRoom?.type)}`).catch(() => {});
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
            tool.logger?.warn?.(`[DungeonTool] Failed to create recovery thread: ${e.message}`);
          }
        }

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

      const currentRoom = activeDungeon.rooms.find(r => r.id === activeDungeon.currentRoom);
      const clearedCount = activeDungeon.rooms.filter(r => r.cleared).length;
      const totalRooms = activeDungeon.rooms.length;

      const roomNarrative = await ui.getRoomNarrative(currentRoom, activeDungeon);
      const embed = {
        author: { name: '🎲 The Dungeon Master' },
        title: `⚔️ ${activeDungeon.name}`,
        description: roomNarrative,
        color: ui.getRoomColor(currentRoom?.type),
        fields: [
          { name: '📍 Location', value: `${ui.getRoomTitle(currentRoom?.type)} (${activeDungeon.currentRoom.replace('room_', '')}/${totalRooms})`, inline: true },
          { name: '✅ Progress', value: `${clearedCount}/${totalRooms} rooms cleared`, inline: true }
        ]
      };

      if (currentRoom) {
        if (currentRoom.puzzle && !currentRoom.puzzle.solved) {
          embed.fields.push({
            name: '🧩 A Riddle Blocks Your Path',
            value: `*"${currentRoom.puzzle.riddle}"*`,
            inline: false
          });

          return {
            embeds: [embed],
            components: buildDungeonActionRows({ room: currentRoom, dungeon: activeDungeon })
          };
        } else if ((currentRoom.type === 'combat' || currentRoom.type === 'boss') && currentRoom.encounter?.monsters?.length && !currentRoom.cleared) {
          embed.fields.push({
            name: currentRoom.type === 'boss' ? '💀 Boss' : '⚔️ Enemies',
            value: currentRoom.encounter.monsters.map(m => `${m.emoji || '👹'} ${m.name || m.id}`).join(', '),
            inline: false
          });
          return {
            embeds: [embed],
            components: buildDungeonActionRows({ room: currentRoom, dungeon: activeDungeon })
          };
        } else if (currentRoom.type === 'treasure' && !currentRoom.cleared) {
          embed.fields.push({
            name: '💰 Treasure',
            value: 'Riches await collection!',
            inline: false
          });
          return {
            embeds: [embed],
            components: buildDungeonActionRows({ room: currentRoom, dungeon: activeDungeon })
          };
        } else {
          embed.fields.push({
            name: `${ui.getRoomEmoji(currentRoom.type)} Status`,
            value: ui.describeRoomBrief(currentRoom),
            inline: false
          });
        }
      }

      const ctx = await tool.dndTurnContextService?.buildForDungeon?.({ dungeon: activeDungeon, channelId, avatarId: avatar?._id })
        .catch(() => null);
      const components = ctx?.components || buildDungeonActionRows({ room: currentRoom, dungeon: activeDungeon });

      return {
        embeds: [embed],
        components
      };
    }

    const sheet = await tool.characterService?.getSheet(avatar._id);

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
  };

  return {
    handleAlreadyInDungeon,
    narrateError,
    buildActiveDungeonResponse,
    showStatus
  };
}
