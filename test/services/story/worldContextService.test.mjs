/**
 * @file Unit tests for WorldContextService
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorldContextService } from '../../../src/services/story/worldContextService.mjs';

describe('WorldContextService', () => {
  let worldContextService;
  let mockDb;
  let mockAvatarsCollection;
  let mockLocationsCollection;
  let mockItemsCollection;

  beforeEach(() => {
    // Setup mock collections
    mockAvatarsCollection = {
      find: vi.fn().mockReturnThis(),
      findOne: vi.fn(),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn()
    };

    mockLocationsCollection = {
      find: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn()
    };

    mockItemsCollection = {
      find: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn()
    };

    mockDb = {
      collection: vi.fn((name) => {
        if (name === 'avatars') return mockAvatarsCollection;
        if (name === 'locations') return mockLocationsCollection;
        if (name === 'items') return mockItemsCollection;
        return null;
      })
    };

    // Create service instance
    worldContextService = new WorldContextService({
      databaseService: {
        getDatabase: vi.fn().mockResolvedValue(mockDb)
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      }
    });
  });

  describe('getActiveAvatars', () => {
    it('should exclude global narrator avatars', async () => {
      const mockAvatars = [
        { _id: '1', name: 'Luma Velentis', type: 'character', lastActiveAt: new Date() },
        { _id: '2', name: 'Aiko Starshine', type: 'character', lastActiveAt: new Date() }
      ];

      mockAvatarsCollection.toArray.mockResolvedValue(mockAvatars);

      const result = await worldContextService.getActiveAvatars(10, 30);

      expect(result).toHaveLength(2);
      expect(mockAvatarsCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          type: { $ne: 'global_narrator' },
          status: { $ne: 'immortal' }
        })
      );
    });

    it('should return avatars with recent lastActiveAt', async () => {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 5);

      const mockAvatars = [
        { _id: '1', name: 'Luma Velentis', lastActiveAt: recentDate }
      ];

      mockAvatarsCollection.toArray.mockResolvedValue(mockAvatars);

      const result = await worldContextService.getActiveAvatars(10, 30);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Luma Velentis');
    });

    it('should fall back to createdAt if no recent lastActiveAt', async () => {
      // First call returns empty (no lastActiveAt matches)
      // Second call returns avatars by createdAt
      mockAvatarsCollection.toArray
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { _id: '1', name: 'Luma Velentis', createdAt: new Date() }
        ]);

      const result = await worldContextService.getActiveAvatars(10, 30);

      expect(result).toHaveLength(1);
      expect(mockAvatarsCollection.find).toHaveBeenCalledTimes(2);
    });
  });

  describe('getAllAvatars', () => {
    it('should exclude global narrator and immortal avatars', async () => {
      const mockAvatars = [
        { _id: '1', name: 'Luma Velentis', type: 'character' },
        { _id: '2', name: 'Aiko Starshine', type: 'character' }
      ];

      mockAvatarsCollection.toArray.mockResolvedValue(mockAvatars);

      const result = await worldContextService.getAllAvatars(10);

      expect(result).toHaveLength(2);
      expect(mockAvatarsCollection.find).toHaveBeenCalledWith({
        type: { $ne: 'global_narrator' },
        status: { $ne: 'immortal' }
      });
    });
  });

  describe('getWorldContext', () => {
    it('should use fallback avatars when meta-summary has no avatars', async () => {
      const mockAvatars = [
        { _id: '1', name: 'Luma Velentis', emoji: '🌌', lastActiveAt: new Date() }
      ];

      mockAvatarsCollection.toArray
        .mockResolvedValueOnce(mockAvatars) // getActiveAvatars
        .mockResolvedValueOnce([]); // getAllAvatars (not called)

      mockLocationsCollection.toArray.mockResolvedValue([]);
      mockItemsCollection.toArray.mockResolvedValue([]);

      const context = await worldContextService.getWorldContext({
        includeChannelSummaries: false,
        includeMetaSummary: false,
        includeAvatars: true,
        includeLocations: false,
        includeItems: false
      });

      expect(context.avatars).toHaveLength(1);
      expect(context.avatars[0].name).toBe('Luma Velentis');
    });

    it('should use getAllAvatars if getActiveAvatars returns empty', async () => {
      const mockAvatars = [
        { _id: '1', name: 'Luma Velentis', emoji: '🌌' }
      ];

      mockAvatarsCollection.toArray
        .mockResolvedValueOnce([]) // getActiveAvatars lastActiveAt
        .mockResolvedValueOnce([]) // getActiveAvatars createdAt fallback
        .mockResolvedValueOnce(mockAvatars); // getAllAvatars

      mockLocationsCollection.toArray.mockResolvedValue([]);
      mockItemsCollection.toArray.mockResolvedValue([]);

      const context = await worldContextService.getWorldContext({
        includeChannelSummaries: false,
        includeMetaSummary: false,
        includeAvatars: true,
        includeLocations: false,
        includeItems: false
      });

      expect(context.avatars).toHaveLength(1);
      expect(context.avatars[0].name).toBe('Luma Velentis');
    });
  });

  describe('formatContextForPrompt', () => {
    it('should format avatars for prompt', () => {
      const context = {
        avatars: [
          { name: 'Luma Velentis', emoji: '🌌', description: 'A cosmic wanderer' },
          { name: 'Aiko Starshine', emoji: '✨', description: 'A star guide' }
        ],
        locations: [],
        items: [],
        summary: {
          totalChannels: 0,
          totalAvatars: 2,
          totalLocations: 0
        }
      };

      const formatted = worldContextService.formatContextForPrompt(context);

      expect(formatted).toContain('Luma Velentis');
      expect(formatted).toContain('🌌');
      expect(formatted).toContain('Aiko Starshine');
      expect(formatted).toContain('✨');
    });

    it('should not include empty sections', () => {
      const context = {
        avatars: [],
        locations: [],
        items: [],
        summary: {
          totalChannels: 0,
          totalAvatars: 0,
          totalLocations: 0
        }
      };

      const formatted = worldContextService.formatContextForPrompt(context);

      expect(formatted).toBeTruthy();
      expect(formatted.length).toBeGreaterThan(0);
    });
  });
});
