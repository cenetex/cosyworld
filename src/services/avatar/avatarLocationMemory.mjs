/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * AvatarLocationMemory - Tracks locations avatars have visited for better navigation
 * 
 * This service maintains a history of locations each avatar has visited,
 * allowing them to "remember" where they've been and make better decisions
 * when using the move tool.
 */
export class AvatarLocationMemory {
  constructor({ databaseService, logger }) {
    this.databaseService = databaseService;
    this.logger = logger;
    this.db = null;
    
    // Configuration
    this.MAX_RECENT_LOCATIONS = 10; // Keep last 10 locations in memory
    this.MAX_TOTAL_LOCATIONS = 50;  // Keep last 50 locations in DB
  }

  /**
   * Initialize database connection and indexes
   */
  async init() {
    try {
      this.db = await this.databaseService.getDatabase();
      await this.ensureIndexes();
    } catch (err) {
      this.logger.error(`[AvatarLocationMemory] Init failed: ${err.message}`);
    }
  }

  /**
   * Ensure database indexes exist
   */
  async ensureIndexes() {
    if (!this.db) return;
    
    try {
      await this.db.collection('avatar_location_memory').createIndexes([
        { key: { avatarId: 1, lastVisited: -1 }, name: 'memory_avatar_time', background: true },
        { key: { avatarId: 1, channelId: 1 }, name: 'memory_avatar_channel', background: true },
        { key: { lastVisited: 1 }, expireAfterSeconds: 30 * 24 * 60 * 60, name: 'memory_ttl', background: true }, // 30 days
      ]);
      this.logger.info('[AvatarLocationMemory] Indexes created');
    } catch (err) {
      this.logger.warn(`[AvatarLocationMemory] Index creation warning: ${err.message}`);
    }
  }

  /**
   * Record that an avatar visited a location
   * @param {string} avatarId - Avatar ID
   * @param {string} channelId - Channel/thread ID
   * @param {string} locationName - Human-readable location name
   * @param {string} locationType - 'channel' | 'thread'
   */
  async recordVisit(avatarId, channelId, locationName, locationType = 'channel') {
    if (!this.db) await this.init();
    if (!avatarId || !channelId) return;

    try {
      await this.db.collection('avatar_location_memory').updateOne(
        { avatarId: String(avatarId), channelId: String(channelId) },
        {
          $set: {
            locationName: String(locationName),
            locationType,
            lastVisited: new Date(),
          },
          $inc: { visitCount: 1 },
          $setOnInsert: {
            firstVisited: new Date(),
            createdAt: new Date(),
          }
        },
        { upsert: true }
      );

      this.logger.debug(`[AvatarLocationMemory] Recorded visit: ${avatarId} -> ${locationName}`);

      // Clean up old entries (keep only MAX_TOTAL_LOCATIONS)
      await this.pruneOldMemories(avatarId);
    } catch (err) {
      this.logger.warn(`[AvatarLocationMemory] Failed to record visit: ${err.message}`);
    }
  }

  /**
   * Get recent locations for an avatar
   * @param {string} avatarId - Avatar ID
   * @param {number} limit - Max locations to return
   * @returns {Promise<Array>} Array of location memory objects
   */
  async getRecentLocations(avatarId, limit = 10) {
    if (!this.db) await this.init();
    if (!avatarId) return [];

    try {
      const memories = await this.db.collection('avatar_location_memory')
        .find({ avatarId: String(avatarId) })
        .sort({ lastVisited: -1 })
        .limit(limit)
        .toArray();

      return memories.map(m => ({
        channelId: m.channelId,
        locationName: m.locationName,
        locationType: m.locationType,
        lastVisited: m.lastVisited,
        visitCount: m.visitCount || 1
      }));
    } catch (err) {
      this.logger.warn(`[AvatarLocationMemory] Failed to get recent locations: ${err.message}`);
      return [];
    }
  }

  /**
   * Get formatted location list for agent context
   * @param {string} avatarId - Avatar ID
   * @param {number} limit - Max locations to include
   * @returns {Promise<string>} Formatted location list
   */
  async getLocationContextForAgent(avatarId, limit = 10) {
    const locations = await this.getRecentLocations(avatarId, limit);
    
    if (locations.length === 0) {
      return 'You haven\'t explored many locations yet.';
    }

    const locationList = locations.map((loc, idx) => {
      const visitInfo = loc.visitCount > 1 ? ` (visited ${loc.visitCount}x)` : '';
      const typeIcon = loc.locationType === 'thread' ? '🧵' : '📍';
      return `${idx + 1}. ${typeIcon} ${loc.locationName}${visitInfo}`;
    }).join('\n');

    return `KNOWN LOCATIONS (from your memories):
${locationList}

You can use 🏃‍♂️ to move to any of these locations or discover new ones.`;
  }

  /**
   * Check if avatar has been to a location
   * @param {string} avatarId - Avatar ID
   * @param {string} channelId - Channel/thread ID
   * @returns {Promise<boolean>}
   */
  async hasVisited(avatarId, channelId) {
    if (!this.db) await this.init();
    if (!avatarId || !channelId) return false;

    try {
      const memory = await this.db.collection('avatar_location_memory')
        .findOne({ 
          avatarId: String(avatarId), 
          channelId: String(channelId) 
        });
      return !!memory;
    } catch (err) {
      this.logger.warn(`[AvatarLocationMemory] Failed to check visit: ${err.message}`);
      return false;
    }
  }

  /**
   * Get all unique locations visited by an avatar
   * @param {string} avatarId - Avatar ID
   * @returns {Promise<number>} Count of unique locations
   */
  async getUniqueLocationCount(avatarId) {
    if (!this.db) await this.init();
    if (!avatarId) return 0;

    try {
      return await this.db.collection('avatar_location_memory')
        .countDocuments({ avatarId: String(avatarId) });
    } catch (err) {
      this.logger.warn(`[AvatarLocationMemory] Failed to count locations: ${err.message}`);
      return 0;
    }
  }

  /**
   * Find locations matching a search term in avatar's memory
   * @param {string} avatarId - Avatar ID
   * @param {string} searchTerm - Location name to search for
   * @returns {Promise<Array>} Matching locations
   */
  async searchKnownLocations(avatarId, searchTerm) {
    if (!this.db) await this.init();
    if (!avatarId || !searchTerm) return [];

    try {
      const memories = await this.db.collection('avatar_location_memory')
        .find({
          avatarId: String(avatarId),
          locationName: { $regex: searchTerm, $options: 'i' }
        })
        .sort({ visitCount: -1, lastVisited: -1 })
        .limit(5)
        .toArray();

      return memories.map(m => ({
        channelId: m.channelId,
        locationName: m.locationName,
        visitCount: m.visitCount || 1
      }));
    } catch (err) {
      this.logger.warn(`[AvatarLocationMemory] Failed to search locations: ${err.message}`);
      return [];
    }
  }

  /**
   * Prune old location memories, keeping only MAX_TOTAL_LOCATIONS
   * @param {string} avatarId - Avatar ID
   */
  async pruneOldMemories(avatarId) {
    if (!this.db) return;

    try {
      const count = await this.db.collection('avatar_location_memory')
        .countDocuments({ avatarId: String(avatarId) });

      if (count > this.MAX_TOTAL_LOCATIONS) {
        // Get IDs of memories to keep
        const toKeep = await this.db.collection('avatar_location_memory')
          .find({ avatarId: String(avatarId) })
          .sort({ lastVisited: -1 })
          .limit(this.MAX_TOTAL_LOCATIONS)
          .project({ _id: 1 })
          .toArray();

        const keepIds = toKeep.map(m => m._id);

        // Delete old memories
        const result = await this.db.collection('avatar_location_memory')
          .deleteMany({
            avatarId: String(avatarId),
            _id: { $nin: keepIds }
          });

        if (result.deletedCount > 0) {
          this.logger.debug(`[AvatarLocationMemory] Pruned ${result.deletedCount} old memories for avatar ${avatarId}`);
        }
      }
    } catch (err) {
      this.logger.warn(`[AvatarLocationMemory] Failed to prune memories: ${err.message}`);
    }
  }

  /**
   * Get statistics for an avatar's location memory
   * @param {string} avatarId - Avatar ID
   * @returns {Promise<Object>} Memory statistics
   */
  async getMemoryStats(avatarId) {
    if (!this.db) await this.init();
    if (!avatarId) return null;

    try {
      const memories = await this.db.collection('avatar_location_memory')
        .find({ avatarId: String(avatarId) })
        .toArray();

      if (memories.length === 0) {
        return {
          totalLocations: 0,
          totalVisits: 0,
          mostVisited: null,
          recentLocation: null
        };
      }

      const totalVisits = memories.reduce((sum, m) => sum + (m.visitCount || 1), 0);
      const mostVisited = memories.reduce((max, m) => 
        (m.visitCount || 1) > (max.visitCount || 1) ? m : max
      );
      const recentLocation = memories.reduce((latest, m) => 
        m.lastVisited > (latest.lastVisited || new Date(0)) ? m : latest
      );

      return {
        totalLocations: memories.length,
        totalVisits,
        mostVisited: {
          name: mostVisited.locationName,
          visits: mostVisited.visitCount || 1
        },
        recentLocation: {
          name: recentLocation.locationName,
          visited: recentLocation.lastVisited
        }
      };
    } catch (err) {
      this.logger.warn(`[AvatarLocationMemory] Failed to get stats: ${err.message}`);
      return null;
    }
  }

  /**
   * Clear all location memories for an avatar
   * @param {string} avatarId - Avatar ID
   */
  async clearMemories(avatarId) {
    if (!this.db) await this.init();
    if (!avatarId) return;

    try {
      const result = await this.db.collection('avatar_location_memory')
        .deleteMany({ avatarId: String(avatarId) });
      
      this.logger.info(`[AvatarLocationMemory] Cleared ${result.deletedCount} memories for avatar ${avatarId}`);
    } catch (err) {
      this.logger.error(`[AvatarLocationMemory] Failed to clear memories: ${err.message}`);
    }
  }
}
