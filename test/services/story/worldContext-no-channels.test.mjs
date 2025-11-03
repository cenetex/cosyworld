/**
 * @file Unit tests for WorldContextService with no channel activity
 * Tests the fallback behavior when there are no channel summaries
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorldContextService } from '../../../src/services/story/worldContextService.mjs';

describe('WorldContextService - No Channel Activity Scenario', () => {
  let worldContextService;
  let mockDb;
  let mockAvatarsCollection;
  let mockLocationsCollection;
  let mockItemsCollection;

  beforeEach(() => {
    mockAvatarsCollection = {
      find: vi.fn().mockReturnThis(),
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

  describe('No channel activity but avatars exist in database', () => {
    it('should include avatars in world context when meta-summary has 0 avatars', async () => {
      const mockAvatars = [
        { 
          _id: '68f98007be45067d3110efec', 
          name: 'Luma Velentis', 
          emoji: '🌌🔮💫', 
          description: 'A cosmic wanderer',
          lastActiveAt: new Date()
        },
        { 
          _id: '68f97308be45067d3110efd9', 
          name: 'Aiko Starshine', 
          emoji: '✨🔮💫', 
          description: 'A celestial guide',
          lastActiveAt: new Date()
        }
      ];

      mockAvatarsCollection.toArray.mockResolvedValue(mockAvatars);
      mockLocationsCollection.toArray.mockResolvedValue([]);
      mockItemsCollection.toArray.mockResolvedValue([]);

      const context = await worldContextService.getWorldContext({
        includeChannelSummaries: false,
        includeMetaSummary: false, // No meta-summary
        includeAvatars: true,
        includeLocations: false,
        includeItems: false
      });

      // Verify avatars are included
      expect(context.avatars).toBeDefined();
      expect(context.avatars).toHaveLength(2);
      expect(context.avatars[0].name).toBe('Luma Velentis');
      expect(context.avatars[1].name).toBe('Aiko Starshine');
    });

    it('should include avatars in formatted prompt when meta-summary is empty', async () => {
      const mockAvatars = [
        { 
          _id: '68f98007be45067d3110efec', 
          name: 'Luma Velentis', 
          emoji: '🌌🔮💫', 
          description: 'A cosmic wanderer',
          lastActiveAt: new Date()
        },
        { 
          _id: '68f97308be45067d3110efd9', 
          name: 'Aiko Starshine', 
          emoji: '✨🔮💫', 
          description: 'A celestial guide',
          lastActiveAt: new Date()
        }
      ];

      mockAvatarsCollection.toArray.mockResolvedValue(mockAvatars);
      mockLocationsCollection.toArray.mockResolvedValue([]);
      mockItemsCollection.toArray.mockResolvedValue([]);

      const context = await worldContextService.getWorldContext({
        includeChannelSummaries: false,
        includeMetaSummary: false,
        includeAvatars: true,
        includeLocations: false,
        includeItems: false
      });

      const formatted = worldContextService.formatContextForPrompt(context);

      // Verify the prompt includes avatar information
      expect(formatted).toContain('ACTIVE AVATARS');
      expect(formatted).toContain('Luma Velentis');
      expect(formatted).toContain('🌌🔮💫');
      expect(formatted).toContain('A cosmic wanderer');
      expect(formatted).toContain('Aiko Starshine');
      expect(formatted).toContain('✨🔮💫');
      expect(formatted).toContain('A celestial guide');
    });

    it('should use getAllAvatars when no recently active avatars exist', async () => {
      const mockAvatars = [
        { 
          _id: '68f98007be45067d3110efec', 
          name: 'Luma Velentis', 
          emoji: '🌌🔮💫', 
          description: 'A cosmic wanderer',
          createdAt: new Date('2025-01-01') // Old avatar, no lastActiveAt
        }
      ];

      // First two calls (getActiveAvatars with lastActiveAt and createdAt) return empty
      // Third call (getAllAvatars) returns the avatars
      mockAvatarsCollection.toArray
        .mockResolvedValueOnce([]) // getActiveAvatars - lastActiveAt query
        .mockResolvedValueOnce([]) // getActiveAvatars - createdAt fallback
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

      // Should have avatars from getAllAvatars fallback
      expect(context.avatars).toBeDefined();
      expect(context.avatars).toHaveLength(1);
      expect(context.avatars[0].name).toBe('Luma Velentis');
    });

    it('should properly set summary statistics when using fallback avatars', async () => {
      const mockAvatars = [
        { _id: '1', name: 'Avatar1', lastActiveAt: new Date() },
        { _id: '2', name: 'Avatar2', lastActiveAt: new Date() },
        { _id: '3', name: 'Avatar3', lastActiveAt: new Date() }
      ];

      mockAvatarsCollection.toArray.mockResolvedValue(mockAvatars);
      mockLocationsCollection.toArray.mockResolvedValue([]);
      mockItemsCollection.toArray.mockResolvedValue([]);

      const context = await worldContextService.getWorldContext({
        includeChannelSummaries: false,
        includeMetaSummary: false,
        includeAvatars: true,
        includeLocations: false,
        includeItems: false
      });

      // Verify summary stats reflect the actual avatars loaded
      expect(context.summary.totalAvatars).toBe(3);
      expect(context.summary.totalChannels).toBe(0); // No channels
    });

    it('should exclude global narrator from fallback avatars', async () => {
      const mockAvatars = [
        { 
          _id: '1', 
          name: 'Luma Velentis', 
          type: 'character',
          lastActiveAt: new Date() 
        }
        // CosyWorld narrator should already be filtered by query
      ];

      mockAvatarsCollection.toArray.mockResolvedValue(mockAvatars);
      mockLocationsCollection.toArray.mockResolvedValue([]);
      mockItemsCollection.toArray.mockResolvedValue([]);

      const context = await worldContextService.getWorldContext({
        includeChannelSummaries: false,
        includeMetaSummary: false,
        includeAvatars: true,
        includeLocations: false,
        includeItems: false
      });

      // Should only have non-narrator avatars
      expect(context.avatars).toHaveLength(1);
      expect(context.avatars[0].name).toBe('Luma Velentis');
      expect(context.avatars[0].type).not.toBe('global_narrator');
      
      // Verify the database query included the filter
      expect(mockAvatarsCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          type: { $ne: 'global_narrator' },
          status: { $ne: 'immortal' }
        })
      );
    });
  });
});
