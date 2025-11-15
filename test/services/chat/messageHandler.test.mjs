import { describe, it, expect } from 'vitest';
import { MessageHandler } from '../../../src/services/chat/messageHandler.mjs';

function createHandler() {
  const noop = () => {};
  return new MessageHandler({
    logger: { info: noop, warn: noop, error: noop, debug: noop },
    toolService: null,
    discordService: { client: { on: noop, channels: { cache: new Map() } } },
    databaseService: {},
    configService: null,
    spamControlService: { shouldProcessMessage: async () => true },
    schedulingService: { stop: noop },
    turnScheduler: null,
    avatarService: { prioritizeAvatarsForMessage: async avatars => avatars },
    decisionMaker: null,
    conversationManager: {},
    riskManagerService: {},
    moderationService: { refreshDynamicRegex: noop, moderateMessageContent: noop, moderateBacklogIfNeeded: noop },
    mapService: null,
    responseCoordinator: null,
    buybotService: null
  });
}

describe('MessageHandler avatar mode filtering', () => {
  it('detects pure-model-only guilds correctly', () => {
    const handler = createHandler();
    expect(handler._isPureModelOnlyGuild({ avatarModes: { free: false, onChain: false, collection: false, pureModel: true } })).toBe(true);
    expect(handler._isPureModelOnlyGuild({ avatarModes: { free: true, onChain: false, collection: false, pureModel: true } })).toBe(false);
    expect(handler._isPureModelOnlyGuild({ avatarModes: { free: false, onChain: true, collection: false, pureModel: true } })).toBe(false);
    expect(handler._isPureModelOnlyGuild({ avatarModes: { free: false, onChain: false, collection: true, pureModel: true } })).toBe(false);
    expect(handler._isPureModelOnlyGuild({ avatarModes: { free: false, onChain: false, collection: false, pureModel: false } })).toBe(false);
  });

  it('honors legacy wallet mode for backwards compatibility', () => {
    const handler = createHandler();
    expect(handler._isPureModelOnlyGuild({ avatarModes: { free: false, wallet: false, pureModel: true } })).toBe(true);
    expect(handler._isPureModelOnlyGuild({ avatarModes: { free: false, wallet: true, pureModel: true } })).toBe(false);
  });

  it('filters non-model avatars when guild is pure-model-only', () => {
    const handler = createHandler();
    const guildConfig = { avatarModes: { free: false, onChain: false, collection: false, pureModel: true } };
    const avatars = [
      { _id: '1', name: 'Roster', tags: ['model-roster'] },
      { _id: '2', name: 'Freeform', tags: [] },
      { _id: '3', name: 'System', summoner: 'system:model-roster' }
    ];

    const filtered = handler._filterAvatarsByGuildModes(avatars, guildConfig);
    expect(filtered.map(av => av._id)).toEqual(['1', '3']);
  });

  it('filters on-chain avatars when onChain mode disabled', () => {
    const handler = createHandler();
    const guildConfig = { avatarModes: { free: true, onChain: false, collection: true, pureModel: true } };
    const avatars = [
      { _id: '1', name: 'Free', tags: [] },
      { _id: '2', name: 'Wallet', walletAddress: '0x123', summoner: 'wallet:0x123' },
      { _id: '3', name: 'Collection', source: 'nft-sync' }
    ];

    const filtered = handler._filterAvatarsByGuildModes(avatars, guildConfig);
    expect(filtered.map(av => av._id)).toEqual(['1', '3']);
  });

  it('filters collection avatars when collection mode disabled', () => {
    const handler = createHandler();
    const guildConfig = { avatarModes: { free: true, onChain: true, collection: false, pureModel: true } };
    const avatars = [
      { _id: '1', name: 'Free', tags: [] },
      { _id: '2', name: 'Wallet', walletAddress: '0x123', summoner: 'wallet:0x123' },
      { _id: '3', name: 'Collection', source: 'nft-sync' }
    ];

    const filtered = handler._filterAvatarsByGuildModes(avatars, guildConfig);
    expect(filtered.map(av => av._id)).toEqual(['1', '2']);
  });

  it('keeps all avatars when all modes enabled', () => {
    const handler = createHandler();
    const guildConfig = { avatarModes: { free: true, onChain: true, collection: true, pureModel: true } };
    const avatars = [
      { _id: '1', name: 'Free', tags: [] },
      { _id: '2', name: 'Wallet', walletAddress: '0x123' },
      { _id: '3', name: 'Collection', source: 'nft-sync' },
      { _id: '4', name: 'Model', tags: ['model-roster'] }
    ];

    const filtered = handler._filterAvatarsByGuildModes(avatars, guildConfig);
    expect(filtered).toEqual(avatars);
  });
});
