/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { ObjectId } from 'mongodb';

/**
 * WorldContextService
 * 
 * Aggregates and analyzes the current state of the CosyWorld universe.
 * NOW USES CHANNEL SUMMARIES as primary source instead of raw events.
 * Provides context about avatars, locations, items, and channel activity for story generation.
 */
export class WorldContextService {
  constructor({ databaseService, channelSummaryService, logger }) {
    this.databaseService = databaseService;
    this.channelSummaryService = channelSummaryService;
    this.logger = logger || console;
  }

  async _db() {
    return await this.databaseService.getDatabase();
  }

  // ============================================================================
  // Avatars
  // ============================================================================

  /**
   * Get active avatars (recently created or active)
   * @param {number} limit - Maximum number of avatars
   * @param {number} daysSince - Consider avatars active within this many days
   * @returns {Promise<Array>}
   */
  async getActiveAvatars(limit = 50, daysSince = 30) {
    const db = await this._db();
    const avatars = db.collection('avatars');
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysSince);
    
    // Filter out system/global avatars (global narrator, system bots, etc.)
    const excludeFilter = {
      type: { $ne: 'global_narrator' },
      status: { $ne: 'immortal' }
    };
    
    // Try to find avatars with recent lastActiveAt timestamps
    const activeAvatars = await avatars
      .find({
        lastActiveAt: { $gte: cutoffDate },
        ...excludeFilter
      })
      .sort({ lastActiveAt: -1 })
      .limit(limit)
      .toArray();
    
    // If we found recently active avatars, return them
    if (activeAvatars && activeAvatars.length > 0) {
      return activeAvatars;
    }
    
    // Fallback: Use createdAt for avatars without lastActiveAt (legacy data)
    return await avatars
      .find({
        createdAt: { $gte: cutoffDate },
        ...excludeFilter
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Get all avatars (excluding system/global avatars)
   * @param {number} limit - Maximum number of avatars
   * @returns {Promise<Array>}
   */
  async getAllAvatars(limit = 100) {
    const db = await this._db();
    const avatars = db.collection('avatars');
    
    // Filter out system/global avatars
    return await avatars
      .find({
        type: { $ne: 'global_narrator' },
        status: { $ne: 'immortal' }
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  }  /**
   * Get avatar by ID
   * @param {string|ObjectId} avatarId - Avatar ID
   * @returns {Promise<Object|null>}
   */
  async getAvatar(avatarId) {
    const db = await this._db();
    const avatars = db.collection('avatars');
    
    return await avatars.findOne({ _id: new ObjectId(avatarId) });
  }

  /**
   * Get avatars by IDs
   * @param {Array<string|ObjectId>} avatarIds - Array of avatar IDs
   * @returns {Promise<Array>}
   */
  async getAvatarsByIds(avatarIds) {
    const db = await this._db();
    const avatars = db.collection('avatars');
    
    const objectIds = avatarIds.map(id => new ObjectId(id));
    
    return await avatars
      .find({ _id: { $in: objectIds } })
      .toArray();
  }

  /**
   * Get recently created avatars
   * @param {number} limit - Number of avatars
   * @param {number} hours - Within this many hours
   * @returns {Promise<Array>}
   */
  async getRecentlyCreatedAvatars(limit = 10, hours = 24) {
    const db = await this._db();
    const avatars = db.collection('avatars');
    
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - hours);
    
    return await avatars
      .find({ createdAt: { $gte: cutoffDate } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  }

  // ============================================================================
  // Locations
  // ============================================================================

  /**
   * Get locations, prioritized by recent activity
   * Sort order: lastSummaryUpdate desc, then updatedAt desc, then createdAt desc
   * @param {number} limit - Max number of locations to return (default 100)
   * @returns {Promise<Array>}
   */
  async getLocations(limit = 100) {
    const db = await this._db();
    const locations = db.collection('locations');

    return await locations
      .find({})
      .sort({ lastSummaryUpdate: -1, updatedAt: -1, createdAt: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Get location by ID
   * @param {string|ObjectId} locationId - Location ID
   * @returns {Promise<Object|null>}
   */
  async getLocation(locationId) {
    const db = await this._db();
    const locations = db.collection('locations');
    
    return await locations.findOne({ _id: new ObjectId(locationId) });
  }

  /**
   * Get random locations for story
   * @param {number} count - Number of locations
   * @returns {Promise<Array>}
   */
  async getRandomLocations(count = 3) {
    const db = await this._db();
    const locations = db.collection('locations');
    
    return await locations
      .aggregate([
        { $sample: { size: count } }
      ])
      .toArray();
  }

  // ============================================================================
  // Items
  // ============================================================================

  /**
   * Get items
   * @param {number} limit - Maximum number of items
   * @returns {Promise<Array>}
   */
  async getItems(limit = 100) {
    const db = await this._db();
    const items = db.collection('items');
    
    return await items
      .find({})
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Get item by ID
   * @param {string|ObjectId} itemId - Item ID
   * @returns {Promise<Object|null>}
   */
  async getItem(itemId) {
    const db = await this._db();
    const items = db.collection('items');
    
    return await items.findOne({ _id: new ObjectId(itemId) });
  }

  /**
   * Get random items for story
   * @param {number} count - Number of items
   * @returns {Promise<Array>}
   */
  async getRandomItems(count = 3) {
    const db = await this._db();
    const items = db.collection('items');
    
    return await items
      .aggregate([
        { $sample: { size: count } }
      ])
      .toArray();
  }

  // ============================================================================
  // Events & Activity
  // ============================================================================

  /**
   * Get recent significant events
   * @param {Date} since - Get events since this date
   * @param {number} limit - Maximum number of events
   * @returns {Promise<Array>}
   */
  async getRecentEvents(since = null, limit = 50) {
    const db = await this._db();
    const events = db.collection('agent_events');
    
    if (!since) {
      since = new Date();
      since.setHours(since.getHours() - 24); // Last 24 hours by default
    }
    
    return await events
      .find({
        ts: { $gte: since }
      })
      .sort({ ts: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Detect significant story opportunities from recent activity
   * @returns {Promise<Array>}
   */
  async identifyStoryOpportunities() {
    const opportunities = [];
    
    // Check for new avatars
    const recentAvatars = await this.getRecentlyCreatedAvatars(5, 48);
    if (recentAvatars.length > 0) {
      opportunities.push({
        type: 'new_arrivals',
        description: `${recentAvatars.length} new avatar(s) have arrived in CosyWorld`,
        avatars: recentAvatars,
        priority: 8
      });
    }
    
    // Check for combat events
    const db = await this._db();
    const recentCombat = await db.collection('agent_events')
      .find({
        type: 'combat',
        ts: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      })
      .limit(10)
      .toArray();
    
    if (recentCombat.length > 2) {
      opportunities.push({
        type: 'conflict',
        description: `Multiple combat events detected (${recentCombat.length} encounters)`,
        events: recentCombat,
        priority: 7
      });
    }
    
    // Check for location activity
    const locationActivity = await db.collection('avatar_location_memory')
      .aggregate([
        {
          $match: {
            lastVisited: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
          }
        },
        {
          $group: {
            _id: '$channelId',
            visitCount: { $sum: 1 },
            avatars: { $addToSet: '$avatarId' }
          }
        },
        {
          $match: { visitCount: { $gte: 3 } }
        },
        { $sort: { visitCount: -1 } },
        { $limit: 5 }
      ])
      .toArray();
    
    if (locationActivity.length > 0) {
      opportunities.push({
        type: 'popular_locations',
        description: `Active locations with frequent visits`,
        locations: locationActivity,
        priority: 6
      });
    }
    
    return opportunities.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get avatar relationships from interactions
   * @param {string|ObjectId} avatarId - Avatar ID (optional, all if not provided)
   * @returns {Promise<Array>}
   */
  async getAvatarRelationships(avatarId = null) {
    const db = await this._db();
    const messages = db.collection('messages');
    
    const filter = {};
    if (avatarId) {
      filter.avatarId = new ObjectId(avatarId);
    }
    
    // Get messages and analyze co-occurrence
    const recentMessages = await messages
      .find(filter)
      .sort({ timestamp: -1 })
      .limit(1000)
      .toArray();
    
    // Group by channel to find avatars that interact in same spaces
    const channelAvatars = {};
    for (const msg of recentMessages) {
      if (!channelAvatars[msg.channelId]) {
        channelAvatars[msg.channelId] = new Set();
      }
      if (msg.avatarId) {
        channelAvatars[msg.channelId].add(msg.avatarId.toString());
      }
    }
    
    const relationships = [];
    for (const [channelId, avatarSet] of Object.entries(channelAvatars)) {
      if (avatarSet.size > 1) {
        relationships.push({
          channelId,
          avatars: Array.from(avatarSet),
          interactionCount: avatarSet.size
        });
      }
    }
    
    return relationships;
  }

  // ============================================================================
  // World Context Aggregation
  // ============================================================================

  /**
   * Get comprehensive world context for story generation
   * PRIMARY SOURCE: Channel summaries + meta-summary
   * SECONDARY: Active avatars, locations, items
   * @param {Object} options - Context options
   * @param {Object} aiService - AI service for meta-summary generation
   * @returns {Promise<Object>}
   */
  async getWorldContext(options = {}, aiService = null) {
    const {
      includeChannelSummaries = true,
      includeMetaSummary = true,
      includeAvatars = true,
      includeLocations = true,
      includeItems = true,
      hoursOfActivity = 24,
      avatarLimit = 50,
      locationLimit = 20,
      itemLimit = 30
    } = options;
    
    const context = {
      timestamp: new Date(),
      summary: {},
      metaSummary: null,
      channelSummaries: []
    };
    
    // PRIORITY 1: Get channel summaries and meta-summary
    if (this.channelSummaryService) {
      try {
        // Get recently active channel summaries
        if (includeChannelSummaries) {
          context.channelSummaries = await this.channelSummaryService.getRecentlyActiveChannels(
            hoursOfActivity,
            20 // Max 20 channels
          );
          this.logger.info(`[WorldContext] Loaded ${context.channelSummaries.length} channel summaries`);

          // Fallback: if none found, attempt a quick refresh and widen the window
          if (!context.channelSummaries || context.channelSummaries.length === 0) {
            try {
              this.logger.info('[WorldContext] No recent channel summaries found, attempting refresh...');
              await this.channelSummaryService.refreshAllSummaries({ maxAge: 24 }).catch(() => null);
              // Retry with a wider window (last 7 days) and same limit
              context.channelSummaries = await this.channelSummaryService.getRecentlyActiveChannels(168, 20);
              this.logger.info(`[WorldContext] After refresh, loaded ${context.channelSummaries.length} channel summaries`);
            } catch (e) {
              this.logger.warn('[WorldContext] Refresh fallback failed:', e.message);
            }
          }

          // Secondary fallback: pull latest summaries regardless of activity window
          if (!context.channelSummaries || context.channelSummaries.length === 0) {
            try {
              context.channelSummaries = await this.channelSummaryService.getAllChannelSummaries(null, 20);
              this.logger.info(`[WorldContext] Fallback to all summaries loaded ${context.channelSummaries.length}`);
            } catch (e) {
              this.logger.warn('[WorldContext] Fallback to all summaries failed:', e.message);
              context.channelSummaries = [];
            }
          }
        }
        
        // Generate meta-summary (summarize the summaries)
        if (includeMetaSummary && aiService) {
          context.metaSummary = await this.channelSummaryService.generateMetaSummary(aiService, {
            hoursOfActivity,
            maxChannels: 20,
            includeAvatars: true,
            includeLocations: true
          });
          this.logger.info(`[WorldContext] Generated meta-summary with ${context.metaSummary.activeAvatarIds.length} avatars`);
        }
      } catch (error) {
        this.logger.error('[WorldContext] Error loading channel summaries:', error);
      }
    }
    
    // PRIORITY 2: Get active avatars (from meta-summary or direct query)
    if (includeAvatars) {
      if (context.metaSummary?.avatars && context.metaSummary.avatars.length > 0) {
        // Use avatars from meta-summary (already enriched)
        context.avatars = context.metaSummary.avatars;
      } else {
        // Fallback to direct query - try active first, then all avatars
        context.avatars = await this.getActiveAvatars(avatarLimit);
        if (!context.avatars || context.avatars.length === 0) {
          context.avatars = await this.getAllAvatars(avatarLimit);
        }
      }
    }
    
    // PRIORITY 3: Get locations (from meta-summary or direct query)
    if (includeLocations) {
      if (context.metaSummary?.locations) {
        context.locations = context.metaSummary.locations;
      } else {
        // Prefer most recently active locations
        context.locations = await this.getLocations(locationLimit);
      }
    }
    
    // PRIORITY 4: Get items
    if (includeItems) {
      context.items = await this.getItems(itemLimit);
    }
    
    // Derive story opportunities from recent activity (best-effort)
    try {
      context.opportunities = await this.identifyStoryOpportunities();
    } catch (e) {
      this.logger?.warn?.('[WorldContext] identifyStoryOpportunities failed:', e.message);
      context.opportunities = [];
    }
    
    // Add summary statistics
    context.summary = {
      totalChannels: context.channelSummaries?.length || 0,
      totalAvatars: context.avatars?.length || 0,
      totalLocations: context.locations?.length || 0,
      totalItems: context.items?.length || 0,
      hasMetaSummary: !!context.metaSummary,
      keyThemes: context.metaSummary?.keyThemes || []
    };
    
    return context;
  }

  /**
   * Format world context for AI prompts
   * NOW PRIORITIZES CHANNEL SUMMARIES AND META-SUMMARY
   * @param {Object} context - World context object
   * @returns {string}
   */
  formatContextForPrompt(context) {
    let prompt = '=== COSYWORLD CURRENT STATE ===\n\n';
    
    // Meta-summary (the big picture)
    if (context.metaSummary) {
      prompt += '--- WORLD OVERVIEW (Meta-Summary) ---\n';
      prompt += context.metaSummary.summary + '\n\n';
      
      if (context.metaSummary.keyThemes && context.metaSummary.keyThemes.length > 0) {
        prompt += `Key Themes: ${context.metaSummary.keyThemes.join(', ')}\n\n`;
      }
    }
    
    // Channel summaries (what's happening in conversations)
    if (context.channelSummaries && context.channelSummaries.length > 0) {
      prompt += '--- RECENT CHANNEL ACTIVITY ---\n';
      for (const cs of context.channelSummaries.slice(0, 10)) {
        prompt += `• ${cs.platform}/${cs.channelName || cs.channelId}:\n`;
        prompt += `  ${cs.summary}\n`;
        prompt += `  (${cs.activeAvatarIds?.length || 0} active avatars)\n\n`;
      }
    }
    
    // Active Avatars (from meta-summary or direct)
    if (context.avatars && context.avatars.length > 0) {
      prompt += '--- ACTIVE AVATARS ---\n';
      const avatarSample = context.avatars.slice(0, 20);
      for (const avatar of avatarSample) {
        // Ensure ID is a string (convert ObjectId if needed)
        const id = avatar.id 
          ? avatar.id.toString() 
          : avatar._id 
            ? avatar._id.toString() 
            : null;
        const name = avatar.name;
        const emoji = avatar.emoji || '';
        const desc = avatar.description || 'A resident of CosyWorld';
        const imageUrl = avatar.imageUrl ? ' [has image]' : '';
        prompt += `• ${name} ${emoji} (ID: ${id}): ${desc}${imageUrl}\n`;
      }
      prompt += '\n';
    }
    
    // Locations
    if (context.locations && context.locations.length > 0) {
      prompt += '--- KNOWN LOCATIONS ---\n';
      for (const location of context.locations.slice(0, 10)) {
        // Ensure ID is a string (convert ObjectId if needed)
        const id = location.id 
          ? location.id.toString() 
          : location._id 
            ? location._id.toString() 
            : null;
        const name = location.name;
        const desc = location.description || 'A place in CosyWorld';
        prompt += `• ${name} (ID: ${id}): ${desc}\n`;
      }
      prompt += '\n';
    }
    
    // Items
    if (context.items && context.items.length > 0) {
      prompt += '--- NOTABLE ITEMS ---\n';
      for (const item of context.items.slice(0, 10)) {
        prompt += `• ${item.name} (ID: ${item._id}): ${item.description || 'An item'}\n`;
      }
      prompt += '\n';
    }
    
    // Statistics
    prompt += '--- STATISTICS ---\n';
    prompt += `Active Channels: ${context.summary.totalChannels || 0}\n`;
    prompt += `Active Avatars: ${context.summary.totalAvatars || 0}\n`;
    prompt += `Known Locations: ${context.summary.totalLocations || 0}\n`;
    prompt += `Notable Items: ${context.summary.totalItems || 0}\n\n`;
    
    return prompt;
  }
}

export default WorldContextService;
