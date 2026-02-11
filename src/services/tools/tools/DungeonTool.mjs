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
import { createDungeonUi } from '../dungeon/dungeonUi.mjs';
import { createDungeonStatus } from '../dungeon/dungeonStatus.mjs';
import { createDungeonActions } from '../dungeon/dungeonActions.mjs';

export class DungeonTool extends BasicTool {
  constructor({ logger, dungeonService, partyService, characterService, discordService, questService, tutorialQuestService, schemaService, locationService, dungeonMasterService, itemService, dndTurnContextService }) {
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
    this.dndTurnContextService = dndTurnContextService;

    this.ui = createDungeonUi(this);
    this.status = createDungeonStatus(this, this.ui);
    this.actions = createDungeonActions(this, this.ui, this.status);

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
        return await this.status.showStatus(avatar, channelId, activeDungeon, message, isThread);
      }

      // Route to specific actions
      switch (action) {
        case 'enter':
        case 'start':
        case 'begin':
          return await this.actions.enter(avatar, params, message, channelId, activeDungeon, isThread);
        case 'map':
          return await this.actions.showMap(avatar, activeDungeon);
        case 'rest':
          return await this.actions.restInDungeonRoom(avatar, params.slice(1), activeDungeon);
        case 'move':
          return await this.actions.move(avatar, params, activeDungeon, message, isThread);
        case 'fight':
        case 'attack':
        case 'battle':
          return await this.actions.startCombat(avatar, activeDungeon, message);
        case 'loot':
        case 'treasure':
          return await this.actions.loot(avatar, params.slice(1), activeDungeon, message);
        case 'abandon':
        case 'flee':
        case 'leave':
          return await this.actions.abandon(avatar, activeDungeon, channelId);
        case 'puzzle':
        case 'solve':
        case 'answer':
          return await this.actions.solvePuzzle(avatar, params.slice(1), activeDungeon);
        default:
          // Treat unknown action as puzzle answer attempt if in dungeon with active puzzle
          if (activeDungeon) {
            const puzzle = await this.dungeonService.getPuzzle(activeDungeon._id);
            if (puzzle && !puzzle.solved) {
              return await this.actions.solvePuzzle(avatar, params, activeDungeon);
            }
          }
          // Otherwise show status
          return await this.status.showStatus(avatar, channelId, activeDungeon, message);
      }
    } catch (error) {
      this.logger.error('[DungeonTool] Error:', error);
      
      // Special handling for "party already in dungeon" - need to show thread link
      if (error.message?.includes('Party already in a dungeon')) {
        return await this.status.handleAlreadyInDungeon(avatar);
      }

      return this.status.narrateError(error.message);
    }
  }
}
