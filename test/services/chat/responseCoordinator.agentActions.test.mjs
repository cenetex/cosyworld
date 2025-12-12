import { describe, it, expect } from 'vitest';
import { ResponseCoordinator } from '../../../src/services/chat/responseCoordinator.mjs';

const createDb = () => {
  const locks = new Map();
  return {
    collection: (name) => {
      if (name !== 'response_locks') {
        return {
          insertOne: async () => ({ acknowledged: true }),
          deleteOne: async () => ({ acknowledged: true }),
        };
      }
      return {
        insertOne: async (doc) => {
          if (locks.has(doc._id)) {
            const err = new Error('duplicate key error');
            throw err;
          }
          locks.set(doc._id, doc);
          return { acknowledged: true };
        },
        deleteOne: async (q) => {
          locks.delete(q._id);
          return { acknowledged: true };
        },
      };
    },
  };
};

describe('ResponseCoordinator agentic actions', () => {
  it('skips generateResponse when agent says wait', async () => {
    let sendCalls = 0;

    const coordinator = new ResponseCoordinator({
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      databaseService: { getDatabase: async () => createDb() },
      presenceService: {
        recordTurn: async () => {},
      },
      conversationManager: { sendResponse: async () => { sendCalls++; return { id: 'm1' }; } },
      avatarService: { getAvatarsInChannel: async () => [{ _id: 'a1', name: 'Ava' }], prioritizeAvatarsForMessage: async (a) => a },
      decisionMaker: { shouldRespond: async () => true, _getAffinityAvatarId: () => null, _recordAffinity: () => {} },
      discordService: { client: { channels: { fetch: async () => null } } },
      conversationThreadService: null,
      encounterService: null,
      avatarAgentService: { decideAction: async () => ({ action: 'wait' }) },
    });

    // Force selection to avoid testing selection heuristics
    coordinator.selectResponders = async () => [{ _id: 'a1', name: 'Ava' }];

    const res = await coordinator.coordinateResponse(
      { id: 'c1' },
      { content: 'hi', author: { bot: false }, guild: { id: 'g1' } },
      { guildId: 'g1', avatars: [{ _id: 'a1', name: 'Ava' }] }
    );

    expect(res).toEqual([]);
    expect(sendCalls).toBe(0);
  });

  it('disengage disables conversation mode and marks cooldown', async () => {
    let disabled = 0;
    let turns = 0;

    const coordinator = new ResponseCoordinator({
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      databaseService: { getDatabase: async () => createDb() },
      presenceService: {
        disableConversationMode: async () => { disabled++; },
        recordTurn: async () => { turns++; },
      },
      conversationManager: { sendResponse: async () => ({ id: 'm1' }) },
      avatarService: { getAvatarsInChannel: async () => [{ _id: 'a1', name: 'Ava' }], prioritizeAvatarsForMessage: async (a) => a },
      decisionMaker: { shouldRespond: async () => true, _getAffinityAvatarId: () => null, _recordAffinity: () => {} },
      discordService: { client: { channels: { fetch: async () => null } } },
      conversationThreadService: null,
      encounterService: { leaveEncounter: async () => {} },
      avatarAgentService: { decideAction: async () => ({ action: 'disengage' }) },
    });

    coordinator.selectResponders = async () => [{ _id: 'a1', name: 'Ava' }];

    const res = await coordinator.coordinateResponse(
      { id: 'c1' },
      { content: 'hi', author: { bot: false }, guild: { id: 'g1' } },
      { guildId: 'g1', avatars: [{ _id: 'a1', name: 'Ava' }] }
    );

    expect(res).toEqual([]);
    expect(disabled).toBe(1);
    expect(turns).toBe(1);
  });
});
