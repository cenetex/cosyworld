import { describe, it, expect } from 'vitest';
import { ResponseCoordinator } from '../../../src/services/chat/responseCoordinator.mjs';
import { AvatarService } from '../../../src/services/avatar/avatarService.mjs';

const createAvatarService = () => new AvatarService({
  databaseService: { getDatabase: async () => ({}) },
  configService: { get: () => null, services: {} },
  getMapService: () => null,
  aiService: {},
  schedulingService: {},
  statService: {},
  schemaService: {},
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  walletInsights: {}
});

const createPresenceService = () => ({
  col: async () => ({
    find: () => ({
      sort: () => ({
        limit: () => ({
          next: async () => null
        })
      })
    })
  }),
  consumeNewSummonTurn: () => {},
  recordTurn: () => {},
  cooldownActive: () => false,
  ensurePresence: () => {},
  recordMention: () => {},
  grantNewSummonTurns: () => {}
});

const createDecisionMaker = () => ({
  _getAffinityAvatarId: () => null,
  shouldRespond: () => true,
  _recordAffinity: () => {}
});

describe('ResponseCoordinator direct mention detection', () => {
  it('selects avatars when only partial first names are mentioned', async () => {
    const avatarService = createAvatarService();
    const coordinator = new ResponseCoordinator({
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      databaseService: { getDatabase: async () => ({}) },
      presenceService: createPresenceService(),
      conversationManager: null,
      avatarService,
      decisionMaker: createDecisionMaker(),
      discordService: {},
      conversationThreadService: null
    });

    const channel = { id: 'channel-1' };
    const message = { content: 'Roha, please handle this.', author: { bot: false, id: 'user-1' } };
    const avatars = [
      { _id: 'a2', name: 'Rohan', emoji: '🔥' },
      { _id: 'a3', name: 'Celeste', emoji: '💫' }
    ];

    const selected = await coordinator.selectResponders(channel, message, avatars, { type: 'human_message' });
    expect(selected.map(av => av._id)).toEqual(['a2']);
  });
});
