import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AvatarService } from '../../../src/services/avatar/avatarService.mjs';

const baseDeps = () => ({
  databaseService: { getDatabase: vi.fn() },
  configService: { services: {}, get: vi.fn() },
  getMapService: () => null,
  aiService: { getModel: vi.fn().mockResolvedValue('model') },
  schedulingService: {},
  statService: {},
  schemaService: {},
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  walletInsights: {}
});

describe('AvatarService.createAvatar', () => {
  let service;
  let collection;

  beforeEach(() => {
    service = new AvatarService(baseDeps());
    collection = {
      findOneAndUpdate: vi.fn().mockResolvedValue({
        value: {
          _id: 'abc',
          name: 'Test Avatar',
          description: 'desc',
          emoji: '🙂',
          imageUrl: 'https://example.com/avatar.png'
        },
        lastErrorObject: { upserted: 'abc' }
      })
    };

    service._db = vi.fn().mockResolvedValue({
      collection: () => collection
    });

    service.generateAvatarDetails = vi.fn().mockResolvedValue({
      name: 'Test Avatar',
      description: 'A friendly face',
      personality: 'kind',
      emoji: '🙂',
      model: 'auto'
    });
    service._validateAndSanitizeName = vi.fn().mockReturnValue('Test Avatar');
    service._checkExistingAvatar = vi.fn().mockResolvedValue(null);
    service.generateAvatarImage = vi.fn().mockResolvedValue('https://example.com/avatar.png');
  });

  it('sets updatedAt only via $set to avoid operator conflicts', async () => {
    await service.createAvatar({ prompt: 'Create hero', summoner: 'tester', guildId: 'g1', channelId: 'c1' });

    expect(collection.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [, updateDoc] = collection.findOneAndUpdate.mock.calls[0];

    expect(updateDoc.$setOnInsert).toBeDefined();
    expect(updateDoc.$setOnInsert.updatedAt).toBeUndefined();
    expect(updateDoc.$set).toEqual({ updatedAt: expect.any(Date) });
  });
});
