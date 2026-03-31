/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { roomImageCache } from '../../dnd/DungeonService.mjs';
import { buildDungeonActionRows } from '../../dnd/dungeonActions.mjs';

export function createDungeonActions(tool, ui, status) {
  const postPuzzleToThread = async (thread, puzzle) => {
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
  };

  const showMap = async (_avatar, dungeon) => {
    if (!dungeon) {
      return status.narrateError('No active dungeon');
    }

    const map = tool.dungeonService.getDungeonMap(dungeon);
    const currentRoom = dungeon.rooms.find(r => r.id === dungeon.currentRoom);

    const mapDisplay = map.map(r => {
      const marker = r.current ? '📍' : (r.cleared ? '✅' : ui.getRoomEmoji(r.type));
      const label = r.id.replace('room_', 'R');
      return `${marker} ${label}${r.current ? ' ← **YOU**' : ''}`;
    }).join('\n');

    const exits = currentRoom?.connections?.map(c => {
      const room = dungeon.rooms.find(r => r.id === c);
      return `${ui.getRoomEmoji(room?.type)} Room ${c.replace('room_', '')}`;
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
      components: buildDungeonActionRows({ room: currentRoom, dungeon })
    };
  };

  const move = async (avatar, params, dungeon, _message, isThread = false) => {
    if (!dungeon) {
      return status.narrateError('No active dungeon');
    }

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
      return await showMap(avatar, dungeon);
    }

    const targetRoom = roomId.startsWith('room_') ? roomId : `room_${roomId}`;

    let result;
    try {
      result = await tool.dungeonService.enterRoom(dungeon._id, targetRoom);
    } catch (e) {
      return status.narrateError(e.message);
    }
    const room = result.room;
    dungeon = result.dungeon || dungeon;

    let imageUrl = null;
    try {
      if (tool.schemaService?.generateImage) {
        imageUrl = await roomImageCache.getOrGenerate(
          dungeon.theme,
          room.type,
          async () => {
            const prompt = ui.getRoomImagePrompt(room, dungeon.theme);
            return await tool.schemaService.generateImage(prompt, '16:9', {
              purpose: 'dungeon_room',
              category: 'dungeon',
              tags: [dungeon.theme, room.type, 'dungeon', 'room'],
              metadata: {
                theme: dungeon.theme,
                roomType: room.type,
                dungeonId: dungeon._id?.toString()
              },
              useCache: true,
              cacheChance: 0.7
            });
          }
        );
      }
    } catch (e) {
      tool.logger?.warn?.(`[DungeonTool] Room image failed: ${e.message}`);
    }

    const roomNarrative = await ui.getRoomNarrative(room, dungeon);

    let postedToThread = false;

    if (dungeon.threadId && tool.discordService?.client) {
      try {
        const thread = await tool.discordService.client.channels.fetch(dungeon.threadId);
        if (thread) {
          const roomEmbed = {
            author: { name: '🎲 The Dungeon Master' },
            title: `${ui.getRoomEmoji(room.type)} ${ui.getRoomTitle(room.type)}`,
            description: roomNarrative,
            color: ui.getRoomColor(room.type)
          };

          if (imageUrl) {
            roomEmbed.image = { url: imageUrl };
          }

          const monsterThumb = (!room.cleared && room.encounter?.monsters?.length)
            ? room.encounter.monsters.find(m => m.imageUrl)?.imageUrl
            : null;
          if (monsterThumb) {
            roomEmbed.thumbnail = { url: monsterThumb };
          }

          const roomFields = [];
          if (room.cleared) {
            roomFields.push({ name: '✅ Cleared', value: 'This room has been cleared.', inline: true });
          }
          if (room.encounter?.monsters?.length && !room.cleared) {
            roomFields.push({
              name: '👹 Enemies',
              value: room.encounter.monsters.map(m =>
                `${m.emoji || '👹'} **${m.name || m.id}** ×${m.count}`
              ).join('\n'),
              inline: false
            });
          }
          if (room.puzzle && !room.puzzle?.solved) {
            roomFields.push({ name: '🧩 Riddle', value: `*"${room.puzzle.riddle}"*`, inline: false });
          } else if (room.puzzle?.solved) {
            roomFields.push({ name: '🧩 Solved', value: 'The riddle has been answered.', inline: true });
          }
          if (roomFields.length) roomEmbed.fields = roomFields;

          const ctx = await tool.dndTurnContextService?.buildForDungeon?.({ dungeon, channelId: dungeon.threadId, avatarId: avatar?._id })
            .catch(() => null);
          const components = ctx?.components || buildDungeonActionRows({ room, dungeon });
          await thread.send({ embeds: [roomEmbed], components });
          postedToThread = true;
        }
      } catch (e) {
        tool.logger?.warn?.(`[DungeonTool] Thread post failed: ${e.message}`);
      }
    }

    await tool.questService?.onEvent?.(avatar._id, 'explored');
    await tool.tutorialQuestService?.onEvent?.(avatar._id, 'room_moved');

    if (isThread && postedToThread) {
      return null;
    }

    if (isThread) {
      const roomEmbed = {
        author: { name: '🎲 The Dungeon Master' },
        title: `${ui.getRoomEmoji(room.type)} ${ui.getRoomTitle(room.type)}`,
        description: roomNarrative,
        color: ui.getRoomColor(room.type)
      };

      if (imageUrl) {
        roomEmbed.image = { url: imageUrl };
      }

      const fallbackMonsterThumb = (!room.cleared && room.encounter?.monsters?.length)
        ? room.encounter.monsters.find(m => m.imageUrl)?.imageUrl
        : null;
      if (fallbackMonsterThumb) {
        roomEmbed.thumbnail = { url: fallbackMonsterThumb };
      }

      const fallbackFields = [];
      if (room.cleared) {
        fallbackFields.push({ name: '✅ Cleared', value: 'This room has been cleared.', inline: true });
      }
      if (room.encounter?.monsters?.length && !room.cleared) {
        fallbackFields.push({
          name: '👹 Enemies',
          value: room.encounter.monsters.map(m =>
            `${m.emoji || '👹'} **${m.name || m.id}** ×${m.count || 1}`
          ).join('\n'),
          inline: false
        });
      }

      if (room.puzzle && !room.puzzle.solved) {
        fallbackFields.push({
          name: '🧩 A Riddle Blocks Your Path',
          value: `*"${room.puzzle.riddle}"*`,
          inline: false
        });
      } else if (room.puzzle?.solved) {
        fallbackFields.push({ name: '🧩 Solved', value: 'The riddle has been answered.', inline: true });
      }
      if (fallbackFields.length) roomEmbed.fields = fallbackFields;

      const ctx = await tool.dndTurnContextService?.buildForDungeon?.({ dungeon, channelId: dungeon.threadId || dungeon.channelId || null, avatarId: avatar?._id })
        .catch(() => null);
      const components = ctx?.components || buildDungeonActionRows({ room, dungeon });

      return {
        embeds: [roomEmbed],
        components
      };
    }

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
  };

  const startCombat = async (avatar, dungeon, message) => {
    if (!dungeon) {
      return status.narrateError('No active dungeon');
    }

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
      return {
        embeds: [{
          author: { name: '🎲 The Dungeon Master' },
          description: `*The dungeon has no active thread. Use* 🏰 *to restore it.*`,
          color: 0x7C3AED
        }]
      };
    }

    let room = dungeon.rooms.find(r => r.id === dungeon.currentRoom);

    const needsEncounter = ['combat', 'boss'].includes(room?.type);
    const hasNoMonsters = !room?.encounter?.monsters?.length;

    if (needsEncounter && hasNoMonsters && !room?.cleared) {
      tool.logger?.info?.(`[DungeonTool] Repairing empty encounter in ${room.type} room`);
      const repairedDungeon = await tool.dungeonService.repairDungeonEncounters(dungeon._id);
      if (repairedDungeon) {
        dungeon = repairedDungeon;
        room = dungeon.rooms.find(r => r.id === dungeon.currentRoom);
      }
    }

    if (!room?.encounter?.monsters?.length || room.cleared) {
      return {
        embeds: [{
          author: { name: '🎲 The Dungeon Master' },
          description: '*You look around, but find no enemies to fight in this chamber.*',
          color: 0x7C3AED
        }]
      };
    }

    const combatChannelId = message?.channel?.id;

    try {
      const encounter = await tool.dungeonService.startRoomCombat(
        dungeon._id,
        room.id,
        combatChannelId
      );

      if (encounter) {
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
      tool.logger?.warn?.(`[DungeonTool] Failed to start combat via service: ${combatError.message}`);
    }

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
  };

  const loot = async (avatar, params, dungeon, message) => {
    if (!dungeon) {
      return status.narrateError('No active dungeon');
    }

    const subAction = (params?.[0] || '').toLowerCase();
    if (['need', 'greed', 'pass'].includes(subAction)) {
      const rollId = params?.[1];
      return handleLootChoice(avatar, dungeon, subAction, rollId, message);
    }

    const result = await tool.dungeonService.collectTreasure(dungeon._id, dungeon.currentRoom);

    await tool.tutorialQuestService?.onEvent?.(avatar._id, 'treasure_collected');

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
      components: ui.createNavigationButtons(
        dungeon.rooms.find(r => r.id === dungeon.currentRoom)
      )
    };

    if (result?.storedItemIds?.length && tool.partyService?.createLootRoll) {
      await startLootRolls(result.storedItemIds, dungeon, avatar, message);
    }

    return response;
  };

  const startLootRolls = async (itemIds, dungeon, avatar, message) => {
    if (!tool.discordService?.client || !tool.partyService) return;
    const channelId = dungeon.threadId || message?.channel?.id;
    if (!channelId) return;

    let channel;
    try {
      channel = await tool.discordService.client.channels.fetch(channelId);
    } catch (e) {
      tool.logger?.warn?.(`[DungeonTool] Failed to fetch loot channel: ${e.message}`);
      return;
    }

    for (const itemId of itemIds) {
      try {
        const item = await tool.itemService?.getItem?.(itemId);
        const roll = await tool.partyService.createLootRoll({
          partyId: dungeon.partyId,
          itemId,
          channelId,
          createdBy: avatar._id
        });

        const { embed, components } = buildLootRollMessage(item, roll);
        const rollMessage = await channel.send({ embeds: [embed], components });
        await tool.partyService.setLootRollMessage(roll._id, rollMessage.id);
      } catch (e) {
        tool.logger?.warn?.(`[DungeonTool] Failed to start loot roll: ${e.message}`);
      }
    }
  };

  const handleLootChoice = async (avatar, _dungeon, choice, rollId, _message) => {
    if (!rollId) {
      return status.narrateError('No loot roll found');
    }

    let roll = null;
    try {
      roll = await tool.partyService.getLootRoll(rollId);
    } catch {
      roll = null;
    }

    if (!roll) {
      return status.narrateError('No loot roll found');
    }

    const party = await tool.partyService.getParty(roll.partyId);
    const isMember = party?.members?.some(m => String(m.avatarId) === String(avatar._id));
    if (!isMember) {
      return status.narrateError('Party not found');
    }

    const now = Date.now();
    const expired = roll.expiresAt && new Date(roll.expiresAt).getTime() <= now;

    if (expired && roll.status === 'pending') {
      const resolved = await tool.partyService.resolveLootRoll(roll, { resolvedBy: avatar._id });
      await updateLootRollMessage(resolved);
      return {
        embeds: [{
          author: { name: '🎲 The Dungeon Master' },
          title: '⏳ Loot Roll Closed',
          description: '*The moment has passed. The treasure is claimed as fate decides...*',
          color: 0x6B7280
        }]
      };
    }

    const result = await tool.partyService.submitLootChoice(rollId, avatar._id, choice);
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
      const resolved = await tool.partyService.resolveLootRoll(roll, { resolvedBy: avatar._id });
      await updateLootRollMessage(resolved);
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
  };

  const buildLootRollMessage = (item, roll) => {
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
  };

  const updateLootRollMessage = async (roll) => {
    if (!roll?.messageId || !roll?.channelId || !tool.discordService?.client) return;

    try {
      const channel = await tool.discordService.client.channels.fetch(roll.channelId);
      const msg = await channel.messages.fetch(roll.messageId);
      const item = await tool.itemService?.getItem?.(roll.itemId);
      const embed = await buildLootRollResultEmbed(roll, item);
      await msg.edit({ embeds: [embed], components: [] });
    } catch (e) {
      tool.logger?.warn?.(`[DungeonTool] Failed to update loot roll message: ${e.message}`);
    }
  };

  const buildLootRollResultEmbed = async (roll, item) => {
    const itemName = item?.name || 'Mysterious Loot';
    const itemEmoji = item?.emoji || '🎁';
    const resultLines = await formatLootRollResults(roll);
    const winnerName = await resolveLootWinnerName(roll);

    const outcome = roll?.winner
      ? `🏆 **Winner:** ${winnerName} (${roll.winner.choice.toUpperCase()} ${roll.winner.roll})`
      : 'No one claimed the item. It remains in shared inventory.';

    return {
      author: { name: '🎲 The Dungeon Master' },
      title: `✅ Loot Roll Resolved: ${itemEmoji} ${itemName}`,
      description: `${outcome}\n\n${resultLines}`,
      color: 0x10B981
    };
  };

  const formatLootRollResults = async (roll) => {
    const party = await tool.partyService.getPartyWithAvatars(roll.partyId);
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
  };

  const resolveLootWinnerName = async (roll) => {
    if (!roll?.winner?.avatarId) return 'Unknown Adventurer';
    try {
      const party = await tool.partyService.getPartyWithAvatars(roll.partyId);
      const member = party?.members?.find(m => String(m.avatarId) === String(roll.winner.avatarId));
      return member?.avatar?.name || 'Adventurer';
    } catch {
      return 'Adventurer';
    }
  };

  const abandon = async (avatar, dungeon, _channelId) => {
    if (!dungeon) {
      return status.narrateError('No active dungeon');
    }

    await tool.dungeonService.abandonDungeon(dungeon._id);

    if (dungeon.threadId && tool.discordService?.client) {
      try {
        const thread = await tool.discordService.client.channels.fetch(dungeon.threadId);
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
        tool.logger?.warn?.(`[DungeonTool] Thread archive failed: ${e.message}`);
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
  };

  const solvePuzzle = async (avatar, params, dungeon) => {
    if (!dungeon) {
      return status.narrateError('No active dungeon');
    }

    const puzzle = await tool.dungeonService.getPuzzle(dungeon._id);

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
          footer: { text: 'Click Answer Riddle below to submit your answer' }
        }],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('dnd_puzzle_answer').setLabel('Answer Riddle').setEmoji('🧩').setStyle(ButtonStyle.Success)
          )
        ]
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
          footer: { text: 'Click Answer Riddle below to submit your answer' }
        }],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('dnd_puzzle_answer').setLabel('Answer Riddle').setEmoji('🧩').setStyle(ButtonStyle.Success)
          )
        ]
      };
    }

    const result = await tool.dungeonService.solvePuzzle(dungeon._id, answer);

    if (result.success) {
      await tool.questService?.onEvent?.(avatar._id, 'puzzle_solved');
      await tool.tutorialQuestService?.onEvent?.(avatar._id, 'puzzle_solved');

      try {
        dungeon = await tool.dungeonService.getDungeon(dungeon._id);
      } catch {}

      const entranceRoom = dungeon?.rooms?.find(r => r.type === 'entrance') || dungeon?.rooms?.[0];
      const navigationComponents = buildDungeonActionRows({ room: entranceRoom, dungeon });

      if (dungeon.threadId && tool.discordService?.client) {
        try {
          const thread = await tool.discordService.client.channels.fetch(dungeon.threadId);
          await thread?.send({
            embeds: [{
              author: { name: '🎲 The Dungeon Master' },
              title: '✨ Puzzle Solved!',
              description: `*${avatar.name} speaks the answer, and the ancient magic responds...*\n\n**"${answer}"**\n\nThe barrier fades away, revealing the path forward!`,
              color: 0x10B981,
              fields: result.xpAwarded ? [{ name: '⭐ XP Earned', value: `${result.xpAwarded}`, inline: true }] : []
            }],
            components: navigationComponents
          });
        } catch {}
      }

      return null;
    }

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
  };

  const restInDungeonRoom = async (avatar, params, dungeon) => {
    if (!dungeon) {
      return status.narrateError('No active dungeon');
    }

    const restType = (params?.[0] || 'short').toLowerCase();
    const isLong = restType === 'long';
    const emoji = isLong ? '🏕️' : '☕';

    const currentRoom = dungeon.rooms.find(r => r.id === dungeon.currentRoom);
    if (!currentRoom || currentRoom.type !== 'rest') {
      return status.narrateError('Seek a rest room');
    }

    if (currentRoom.cleared && currentRoom.clearedAt) {
      const elapsed = Date.now() - new Date(currentRoom.clearedAt).getTime();
      const REST_RESET_MS = 24 * 60 * 60 * 1000;
      if (elapsed < REST_RESET_MS) {
        const hoursLeft = Math.ceil((REST_RESET_MS - elapsed) / (60 * 60 * 1000));
        return {
          embeds: [{
            author: { name: '🎲 The Dungeon Master' },
            title: '🏕️ Rest Area On Cooldown',
            description: '*The campfire smolders low. This sanctuary needs time to restore its magic.*',
            color: 0xF59E0B,
            fields: [
              { name: '⏳ Available In', value: `~${hoursLeft} hour${hoursLeft !== 1 ? 's' : ''}`, inline: true }
            ]
          }]
        };
      }
      const roomIndex = dungeon.rooms.findIndex(r => r.id === currentRoom.id);
      if (roomIndex !== -1) {
        try {
          await tool.dungeonService._maybeResetRestRoom(dungeon, currentRoom, roomIndex);
        } catch {}
      }
    }

    const result = await tool.characterService.rest(avatar._id, restType);
    const hpRestored = result?.hpRestored || 0;

    await tool.questService?.onEvent?.(avatar._id, 'rested', { restType });
    await tool.tutorialQuestService?.onEvent?.(avatar._id, isLong ? 'long_rest' : 'short_rest', { restType });

    let clearResult = null;
    try {
      clearResult = await tool.dungeonService.clearRoom(dungeon._id, currentRoom.id);
      await tool.tutorialQuestService?.onEvent?.(avatar._id, 'room_cleared');
    } catch {}

    const refreshedDungeon = await tool.dungeonService.getDungeon(dungeon._id);
    const refreshedRoom = refreshedDungeon?.rooms?.find(r => r.id === refreshedDungeon.currentRoom) || currentRoom;

    const hpMessage = hpRestored > 0 ? `\n💚 **+${hpRestored} HP** restored` : '';
    const restored = isLong
      ? `All HP, spell slots, hit dice, and features restored!${hpMessage}`
      : `Short rest features restored!${hpMessage}`;

    const clearedText = clearResult?.alreadyCleared
      ? '✅ This rest room was already cleared.'
      : '✅ The rest room is now cleared — you can continue.';

    return {
      embeds: [{
        author: { name: '🎲 The Dungeon Master' },
        title: `${emoji} ${isLong ? 'Long' : 'Short'} Rest`,
        description: `**${avatar.name}** takes a ${restType} rest.`,
        color: isLong ? 0x10B981 : 0x3B82F6,
        fields: [
          { name: '✨ Restored', value: restored, inline: false },
          { name: '🚪 Progress', value: clearedText, inline: false }
        ]
      }],
      components: buildDungeonActionRows({ room: refreshedRoom, dungeon: refreshedDungeon || dungeon })
    };
  };

  const enter = async (avatar, params, message, channelId, existingDungeon) => {
    if (existingDungeon) {
      return await status.buildActiveDungeonResponse(existingDungeon, message, avatar);
    }

    const sheet = await tool.characterService?.getSheet(avatar._id);
    if (!sheet?.partyId) {
      return status.narrateError('not in a party');
    }

    const partyDungeon = await tool.dungeonService.getActiveDungeon(sheet.partyId);
    if (partyDungeon) {
      return await status.buildActiveDungeonResponse(partyDungeon, message, avatar);
    }

    let difficulty = 'medium';
    const diffParam = (params[1] || '').toLowerCase();
    if (['easy', 'medium', 'hard', 'deadly'].includes(diffParam)) {
      difficulty = diffParam;
    }

    let loadingMessage = null;
    if (tool.discordService?.client && message?.channel?.id) {
      try {
        const channel = await tool.discordService.client.channels.fetch(message.channel.id);
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
        tool.logger?.warn?.(`[DungeonTool] Failed to send loading message: ${e.message}`);
      }
    }

    const dungeon = await tool.dungeonService.generateDungeon(sheet.partyId, {
      difficulty,
      channelId
    });

    await tool.dungeonService.setChannelId(dungeon._id, channelId);

    let imageUrl = null;
    try {
      if (tool.schemaService?.generateImage) {
        imageUrl = await roomImageCache.getOrGenerate(
          dungeon.theme,
          'entrance',
          async () => {
            const prompt = `${dungeon.theme} dungeon entrance, ancient stone doorway, fantasy RPG art, atmospheric mist, torchlight, mysterious and ominous, detailed architecture`;
            return await tool.schemaService.generateImage(prompt, '16:9', {
              purpose: 'dungeon_room',
              category: 'dungeon',
              tags: [dungeon.theme, 'entrance', 'dungeon', 'room'],
              metadata: {
                theme: dungeon.theme,
                roomType: 'entrance',
                dungeonId: dungeon._id?.toString()
              },
              useCache: true,
              cacheChance: 0.7
            });
          }
        );
      }
    } catch (e) {
      tool.logger?.warn?.(`[DungeonTool] Image generation failed: ${e.message}`);
    }

    let threadId = null;
    if (tool.discordService?.client && message?.channel?.id) {
      try {
        let channel = await tool.discordService.client.channels.fetch(message.channel.id);

        if (channel?.isThread?.()) {
          const parentChannel = channel.parent;
          if (parentChannel) {
            tool.logger?.info?.(`[DungeonTool] In thread ${channel.id}, creating new dungeon thread in parent ${parentChannel.id}`);
            channel = parentChannel;
          }
        }

        if (channel?.threads?.create) {
          const thread = await channel.threads.create({
            name: `⚔️ ${dungeon.name}`,
            autoArchiveDuration: 1440,
            reason: `Dungeon adventure for ${avatar.name}'s party`
          });
          threadId = thread.id;

          const loadingEmbed = await thread.send({
            embeds: [{
              author: { name: '🎲 The Dungeon Master' },
              title: '🏰 Preparing Your Adventure...',
              description: `*The ancient stones shift and groan as reality bends to reveal the dungeon...*\n\n⏳ **Generating location...**\n⏳ **Populating monsters...**\n⏳ **Placing treasure...**\n⏳ **Creating atmosphere...**`,
              color: 0x7C3AED,
              footer: { text: 'The dungeon materializes before you...' }
            }]
          });

          await tool.dungeonService.setThreadId(dungeon._id, threadId);

          let threadImageUrl = imageUrl;
          if (!threadImageUrl && tool.schemaService?.generateImage) {
            try {
              await loadingEmbed.edit({
                embeds: [{
                  author: { name: '🎲 The Dungeon Master' },
                  title: '🏰 Preparing Your Adventure...',
                  description: `*The ancient stones shift and groan as reality bends to reveal the dungeon...*\n\n✅ **Location generated**\n✅ **Monsters populated**\n✅ **Treasure placed**\n⏳ **Generating entrance artwork...**`,
                  color: 0x7C3AED,
                  footer: { text: 'Almost ready...' }
                }]
              });
            } catch {}
          }

          try {
            await loadingEmbed.delete();
          } catch {}

          const firstRoom = dungeon.rooms[0];
          const entranceNarrative = await ui.getRoomNarrative(firstRoom, dungeon);
          const introEmbed = {
            author: { name: '🎲 The Dungeon Master' },
            title: `🏰 ${dungeon.name}`,
            description: entranceNarrative,
            color: ui.getDifficultyColor(difficulty),
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

          const entranceButtons = buildDungeonActionRows({ room: firstRoom, dungeon });
          await thread.send({ embeds: [introEmbed], components: entranceButtons });

          if (firstRoom.puzzle && !firstRoom.puzzle.solved) {
            await postPuzzleToThread(thread, firstRoom.puzzle);
          }
        }
      } catch (e) {
        tool.logger?.warn?.(`[DungeonTool] Thread creation failed: ${e.message}`);
      }
    }

    await tool.questService?.onEvent?.(avatar._id, 'dungeon_entered', { difficulty });
    await tool.tutorialQuestService?.onEvent?.(avatar._id, 'dungeon_entered', { difficulty });

    const finalEmbed = {
      author: { name: '🎲 The Dungeon Master' },
      title: `⚔️ ${dungeon.name}`,
      description: threadId
        ? `*The ancient doors creak open, revealing darkness beyond...*\n\n**Your adventure awaits in** <#${threadId}>`
        : `*The party ventures into a ${dungeon.theme} dungeon...*`,
      color: ui.getDifficultyColor(difficulty),
      thumbnail: imageUrl ? { url: imageUrl } : undefined,
      footer: { text: `${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)} difficulty • ${dungeon.rooms.length} rooms` }
    };

    if (loadingMessage) {
      try {
        await loadingMessage.edit({ embeds: [finalEmbed] });
        return { _handled: true };
      } catch (e) {
        tool.logger?.warn?.(`[DungeonTool] Failed to edit loading message: ${e.message}`);
      }
    }

    return { embeds: [finalEmbed] };
  };

  return {
    enter,
    showMap,
    move,
    startCombat,
    loot,
    startLootRolls,
    handleLootChoice,
    abandon,
    solvePuzzle,
    restInDungeonRoom,
    postPuzzleToThread
  };
}
