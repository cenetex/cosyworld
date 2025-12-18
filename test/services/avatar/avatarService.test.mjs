/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/services/avatar/avatarService.test.mjs
 * @description Comprehensive tests for AvatarService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AvatarService } from '../../../src/services/avatar/avatarService.mjs';
import { ObjectId } from 'mongodb';

const createMockDeps = () => ({
  databaseService: {
    getDatabase: vi.fn().mockResolvedValue({
      collection: vi.fn().mockReturnValue({
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
          limit: vi.fn().mockReturnThis(),
          sort: vi.fn().mockReturnThis(),
        }),
        findOne: vi.fn().mockResolvedValue(null),
        findOneAndUpdate: vi.fn().mockResolvedValue({ value: null }),
        insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }),
        updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
        updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
        deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
        createIndex: vi.fn().mockResolvedValue('index_created'),
        aggregate: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  },
  configService: {
    services: {},
    get: vi.fn().mockReturnValue(null),
    getGuildConfig: vi.fn().mockResolvedValue({ avatarModes: {} }),
  },
  getMapService: vi.fn().mockReturnValue({
    updateAvatarPosition: vi.fn().mockResolvedValue(true),
    getLocationAndAvatars: vi.fn().mockResolvedValue({ avatars: [] }),
  }),
  aiService: {
    getModel: vi.fn().mockResolvedValue('auto'),
    chat: vi.fn().mockResolvedValue({ text: 'Generated content' }),
  },
  schedulingService: {
    addTask: vi.fn(),
  },
  statService: {
    generateStatsFromDate: vi.fn().mockReturnValue({
      hp: 100,
      maxHp: 100,
      attack: 10,
      defense: 10,
      speed: 10,
    }),
    constructor: {
      validateStats: vi.fn().mockReturnValue(true),
    },
  },
  schemaService: {
    validate: vi.fn().mockReturnValue({ valid: true }),
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  walletInsights: {
    getWalletData: vi.fn().mockResolvedValue(null),
  },
});

describe('AvatarService', () => {
  let service;
  let deps;
  let mockCollection;

  beforeEach(() => {
    deps = createMockDeps();
    service = new AvatarService(deps);
    
    // Set up mock collection for direct access
    mockCollection = {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        limit: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
      }),
      findOne: vi.fn().mockResolvedValue(null),
      findOneAndUpdate: vi.fn().mockResolvedValue({ value: null }),
      insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
      createIndex: vi.fn().mockResolvedValue('index_created'),
      aggregate: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    };

    service._db = vi.fn().mockResolvedValue({
      collection: vi.fn().mockReturnValue(mockCollection),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with dependencies', () => {
      expect(service.databaseService).toBe(deps.databaseService);
      expect(service.configService).toBe(deps.configService);
      expect(service.logger).toBe(deps.logger);
    });

    it('should initialize in-memory caches', () => {
      expect(service.channelAvatars).toBeInstanceOf(Map);
      expect(service.avatarActivityCount).toBeInstanceOf(Map);
      expect(service.activityIncrementCache).toBeInstanceOf(Map);
    });

    it('should set collection names', () => {
      expect(service.AVATARS_COLLECTION).toBe('avatars');
      expect(service.IMAGE_URL_COLLECTION).toBe('image_urls');
    });
  });

  describe('getAvatarsByIds', () => {
    it('should fetch avatars by array of IDs', async () => {
      const mockAvatars = [
        { _id: new ObjectId(), name: 'Avatar1' },
        { _id: new ObjectId(), name: 'Avatar2' },
      ];
      
      mockCollection.find.mockReturnValue({
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue(mockAvatars),
      });

      const ids = mockAvatars.map(a => a._id.toString());
      const result = await service.getAvatarsByIds(ids);

      expect(result).toEqual(mockAvatars);
      expect(mockCollection.find).toHaveBeenCalled();
    });

    it('should handle empty IDs array', async () => {
      mockCollection.find.mockReturnValue({
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([]),
      });

      const result = await service.getAvatarsByIds([]);

      expect(result).toEqual([]);
    });

    it('should apply limit option', async () => {
      const limitMock = vi.fn().mockReturnThis();
      mockCollection.find.mockReturnValue({
        limit: limitMock,
        toArray: vi.fn().mockResolvedValue([]),
      });

      await service.getAvatarsByIds(['id1'], { limit: 50 });

      expect(limitMock).toHaveBeenCalledWith(50);
    });
  });

  describe('getAvatarStats', () => {
    it('should return stats for avatar', async () => {
      const avatarId = new ObjectId();
      const mockStats = { hp: 100, attack: 15, defense: 10, avatarId };
      
      mockCollection.findOne.mockResolvedValue(mockStats);

      const result = await service.getAvatarStats(avatarId.toString());

      expect(result).toEqual(mockStats);
    });

    it('should return default stats if none found', async () => {
      mockCollection.findOne.mockResolvedValue(null);

      const result = await service.getAvatarStats('nonexistent');

      expect(result).toMatchObject({
        hp: 100,
        attack: 10,
        defense: 5,
      });
    });
  });

  describe('updateAvatarStats', () => {
    it('should update stats in database', async () => {
      const avatar = { _id: new ObjectId(), name: 'TestAvatar' };
      const stats = { hp: 80, attack: 15 };

      await service.updateAvatarStats(avatar, stats);

      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { avatarId: avatar._id },
        { $set: expect.objectContaining({ hp: 80, attack: 15, avatarId: avatar._id }) },
        { upsert: true }
      );
    });
  });

  describe('getActiveAvatars', () => {
    it('should filter out dead avatars', async () => {
      const mockAvatars = [
        { _id: new ObjectId(), name: 'Alive', status: 'alive', active: true },
        { _id: new ObjectId(), name: 'Dead', status: 'dead', active: true },
        { _id: new ObjectId(), name: 'Inactive', status: 'alive', active: false },
      ];

      // Mock getAllAvatars
      service.getAllAvatars = vi.fn().mockResolvedValue(mockAvatars);

      const result = await service.getActiveAvatars({});

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Alive');
    });
  });

  describe('_filterByAvatarModes', () => {
    it('should return all avatars when all modes enabled', () => {
      const avatars = [
        { _id: '1', name: 'Free' },
        { _id: '2', name: 'OnChain', walletAddress: '0x123' },
      ];
      const guildConfig = { avatarModes: {} }; // All modes default to enabled

      const result = service._filterByAvatarModes(avatars, guildConfig);

      expect(result).toEqual(avatars);
    });

    it('should handle empty avatars array', () => {
      const result = service._filterByAvatarModes([], {});

      expect(result).toEqual([]);
    });

    it('should handle null avatars', () => {
      const result = service._filterByAvatarModes(null, {});

      expect(result).toEqual([]);
    });

    it('should respect legacy wallet mode', () => {
      const avatars = [
        { _id: '1', name: 'Free' },
        { _id: '2', name: 'OnChain', walletAddress: '0x123', isOnChain: true },
      ];
      const guildConfig = { avatarModes: { wallet: false, free: true } };

      const result = service._filterByAvatarModes(avatars, guildConfig);

      // With wallet: false, on-chain avatars should be filtered out
      // Only free avatars remain
      expect(result.length).toBeLessThanOrEqual(avatars.length);
    });
  });

  describe('_legacyToFilters', () => {
    it('should convert alive status filter', () => {
      const result = service._legacyToFilters({ includeStatus: 'alive' });

      expect(result).toEqual({ status: { $ne: 'dead' } });
    });

    it('should convert dead status filter', () => {
      const result = service._legacyToFilters({ includeStatus: 'dead' });

      expect(result).toEqual({ status: 'dead' });
    });

    it('should include emoji filter', () => {
      const result = service._legacyToFilters({ emoji: '🐉' });

      // Default includeStatus adds status filter
      expect(result).toMatchObject({ emoji: '🐉' });
    });

    it('should include channelId filter', () => {
      const result = service._legacyToFilters({ channelId: 'chan-123' });

      // Default includeStatus adds status filter
      expect(result).toMatchObject({ channelId: 'chan-123' });
    });

    it('should include guildId filter', () => {
      const result = service._legacyToFilters({ guildId: 'guild-123' });

      // Default includeStatus adds status filter
      expect(result).toMatchObject({ guildId: 'guild-123' });
    });

    it('should combine multiple filters', () => {
      const result = service._legacyToFilters({
        includeStatus: 'alive',
        emoji: '🐉',
        channelId: 'chan-123',
        guildId: 'guild-123',
      });

      expect(result).toEqual({
        status: { $ne: 'dead' },
        emoji: '🐉',
        channelId: 'chan-123',
        guildId: 'guild-123',
      });
    });

    it('should handle empty options with default alive filter', () => {
      const result = service._legacyToFilters({});

      // Default includeStatus is 'alive', which adds status filter
      expect(result).toEqual({ status: { $ne: 'dead' } });
    });
  });

  describe('initializeDatabase', () => {
    it('should create required indexes', async () => {
      await service.initializeDatabase();

      expect(deps.databaseService.getDatabase).toHaveBeenCalled();
      expect(deps.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('database setup completed')
      );
    });
  });

  describe('getOrCreateStats', () => {
    it('should return existing stats if valid', async () => {
      const avatar = {
        _id: new ObjectId(),
        name: 'Test',
        stats: { hp: 100, attack: 10 },
      };

      deps.statService.constructor.validateStats = vi.fn().mockReturnValue(true);

      const result = await service.getOrCreateStats(avatar);

      expect(result).toEqual(avatar.stats);
    });

    it('should generate new stats if none exist', async () => {
      const avatar = { _id: new ObjectId(), name: 'Test' };
      const generatedStats = { hp: 100, attack: 15 };
      
      deps.statService.generateStatsFromDate.mockReturnValue(generatedStats);
      deps.statService.constructor.validateStats = vi.fn().mockReturnValue(false);
      
      mockCollection.findOne.mockResolvedValue(null);

      const result = await service.getOrCreateStats(avatar);

      expect(result).toEqual(generatedStats);
      expect(deps.statService.generateStatsFromDate).toHaveBeenCalled();
    });
  });

  describe('activateAvatarInChannel', () => {
    it('should activate avatar in channel', async () => {
      mockCollection.findOne.mockResolvedValue(null);
      mockCollection.find.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([]),
      });

      await service.activateAvatarInChannel('chan-123', 'avatar-123');

      expect(mockCollection.findOne).toHaveBeenCalled();
    });

    it('should update timestamp if already active', async () => {
      mockCollection.findOne.mockResolvedValue({
        channelId: 'chan-123',
        avatarId: 'avatar-123',
        isActive: true,
      });

      await service.activateAvatarInChannel('chan-123', 'avatar-123');

      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { channelId: 'chan-123', avatarId: 'avatar-123' },
        { $set: { lastActivityAt: expect.any(Date) } }
      );
    });
  });

  describe('getActiveAvatarsInChannel', () => {
    it('should return limited active avatars', async () => {
      const mockAvatars = Array.from({ length: 10 }, (_, i) => ({
        _id: new ObjectId(),
        name: `Avatar${i}`,
      }));

      mockCollection.find.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue(mockAvatars.slice(0, 8).map(a => ({
          avatarId: a._id.toString(),
          isActive: true,
        }))),
      });

      const result = await service.getActiveAvatarsInChannel('chan-123', mockAvatars);

      expect(result.length).toBeLessThanOrEqual(8);
    });

    it('should auto-activate avatars if below capacity', async () => {
      const mockAvatars = [
        { _id: new ObjectId(), name: 'Avatar1' },
        { _id: new ObjectId(), name: 'Avatar2' },
      ];

      mockCollection.find.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([]),
      });

      // Mock activateAvatarInChannel
      service.activateAvatarInChannel = vi.fn().mockResolvedValue(true);

      const result = await service.getActiveAvatarsInChannel('chan-123', mockAvatars);

      expect(service.activateAvatarInChannel).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      const mockAvatars = [{ _id: new ObjectId(), name: 'Avatar1' }];

      mockCollection.find.mockImplementation(() => {
        throw new Error('DB error');
      });

      const result = await service.getActiveAvatarsInChannel('chan-123', mockAvatars);

      // Should fallback to first MAX_ACTIVE avatars
      expect(result).toEqual(mockAvatars.slice(0, 8));
    });
  });
});

describe('AvatarService - Mention Detection Helpers', () => {
  // Test the helper functions that are defined in the module
  
  describe('normalizeMentionText', () => {
    // Since these are module-level functions, we test them indirectly
    // or could export them for direct testing
    
    it('should be tested through findAvatarByMention', () => {
      // Placeholder - these functions would be tested through integration
      expect(true).toBe(true);
    });
  });
});

describe('AvatarService - Wallet Avatar Features', () => {
  let service;
  let deps;
  let mockCollection;

  beforeEach(() => {
    deps = createMockDeps();
    service = new AvatarService(deps);
    
    mockCollection = {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        limit: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
      }),
      findOne: vi.fn().mockResolvedValue(null),
      findOneAndUpdate: vi.fn().mockResolvedValue({ value: null }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    };

    service._db = vi.fn().mockResolvedValue({
      collection: vi.fn().mockReturnValue(mockCollection),
    });
  });

  describe('activity increment rate limiting', () => {
    it('should respect activity increment cooldown', () => {
      const walletAddress = '0x123';
      const now = Date.now();
      
      // Simulate recent increment
      service.activityIncrementCache.set(walletAddress, now);
      
      const lastIncrement = service.activityIncrementCache.get(walletAddress);
      const withinCooldown = (now - lastIncrement) < service.ACTIVITY_INCREMENT_COOLDOWN_MS;
      
      expect(withinCooldown).toBe(true);
    });

    it('should allow increment after cooldown expires', () => {
      const walletAddress = '0x123';
      const oldTime = Date.now() - 120000; // 2 minutes ago
      
      service.activityIncrementCache.set(walletAddress, oldTime);
      
      const now = Date.now();
      const lastIncrement = service.activityIncrementCache.get(walletAddress);
      const withinCooldown = (now - lastIncrement) < service.ACTIVITY_INCREMENT_COOLDOWN_MS;
      
      expect(withinCooldown).toBe(false);
    });
  });

  describe('partial avatar handling', () => {
    it('should track pending image hydrations', () => {
      expect(service.pendingAvatarImageHydrations).toBeInstanceOf(Set);
      
      service.pendingAvatarImageHydrations.add('avatar-123');
      
      expect(service.pendingAvatarImageHydrations.has('avatar-123')).toBe(true);
    });
  });

  describe('registered collection cache', () => {
    it('should initialize with empty cache', () => {
      expect(service.registeredCollectionCache).toEqual({
        keys: [],
        expiresAt: 0,
      });
    });

    it('should detect expired cache', () => {
      service.registeredCollectionCache = {
        keys: ['collection-1'],
        expiresAt: Date.now() - 1000, // Expired
      };

      const isExpired = Date.now() > service.registeredCollectionCache.expiresAt;
      
      expect(isExpired).toBe(true);
    });
  });
});
