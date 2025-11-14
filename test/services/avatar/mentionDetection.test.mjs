import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AvatarService } from '../../../src/services/avatar/avatarService.mjs';

const createService = () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return new AvatarService({
    databaseService: { getDatabase: vi.fn() },
    configService: { get: vi.fn(), services: {} },
    getMapService: () => null,
    aiService: {},
    schedulingService: {},
    statService: {},
    schemaService: {},
    logger,
    walletInsights: {}
  });
};

describe('AvatarService matchAvatarsByContent', () => {
  let service;
  let avatars;

  beforeEach(() => {
    service = createService();
    avatars = [
      { _id: 'a1', name: 'Artemis', emoji: '🌙' },
      { _id: 'a2', name: 'Rohan', emoji: '🔥' },
      { _id: 'a3', name: 'Li', emoji: '🎻' }
    ];
  });

  it('orders matches by appearance in text', () => {
    const result = service.matchAvatarsByContent('Please have Rohan and then Artemis pose.', avatars);
    expect(result.map(av => av._id)).toEqual(['a2', 'a1']);
  });

  it('respects exclusions and uses emoji + short-name fallbacks', () => {
    const result = service.matchAvatarsByContent('🌙 and Li should join.', avatars, {
      excludeAvatarIds: ['a3']
    });
    expect(result.map(av => av._id)).toEqual(['a1']);
  });

  it('fetches channel avatars when not provided', async () => {
    const spy = vi.fn().mockResolvedValue(avatars);
    service.getAvatarsInChannel = spy;
    const result = await service.detectMentionedAvatarsInChannel('Rohan please!', 'c1', 'g1');
    expect(spy).toHaveBeenCalledWith('c1', 'g1');
    expect(result.map(av => av._id)).toEqual(['a2']);
  });
});
