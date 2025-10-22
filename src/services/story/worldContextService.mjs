/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { ObjectId } from 'mongodb';

/**
 * WorldContextService
 * 
 * Aggregates and analyzes the current state of the CosyWorld universe.
 * Provides context about avatars, locations, items, and recent events for story generation.
 */
export class WorldContextService {
  constructor({ databaseService, logger }) {
    this.databaseService = databaseService;
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
    
    return await avatars
      .find({
        createdAt: { $gte: cutoffDate }
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Get all avatars
   * @param {number} limit - Maximum number of avatars
   * @returns {Promise<Array>}
   */
  async getAllAvatars(limit = 100) {
    const db = await this._db();
    const avatars = db.collection('avatars');
    
    return await avatars
      .find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  }

  /**
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
   * Get all locations
   * @returns {Promise<Array>}
   */
  async getLocations() {
    const db = await this._db();
    const locations = db.collection('locations');
    
    return await locations
      .find({})
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
   * @param {Object} options - Context options
   * @returns {Promise<Object>}
   */
  async getWorldContext(options = {}) {
    const {
      includeAvatars = true,
      includeLocations = true,
      includeItems = true,
      includeEvents = true,
      includeOpportunities = true,
      avatarLimit = 50,
      locationLimit = 20,
      itemLimit = 30
    } = options;
    
    const context = {
      timestamp: new Date(),
      summary: {}
    };
    
    // Gather all context in parallel
    const promises = [];
    
    if (includeAvatars) {
      promises.push(
        this.getActiveAvatars(avatarLimit)
          .then(avatars => { context.avatars = avatars; })
      );
    }
    
    if (includeLocations) {
      promises.push(
        this.getLocations()
          .then(locations => { 
            context.locations = locations.slice(0, locationLimit); 
          })
      );
    }
    
    if (includeItems) {
      promises.push(
        this.getItems(itemLimit)
          .then(items => { context.items = items; })
      );
    }
    
    if (includeEvents) {
      promises.push(
        this.getRecentEvents()
          .then(events => { context.recentEvents = events; })
      );
    }
    
    if (includeOpportunities) {
      promises.push(
        this.identifyStoryOpportunities()
          .then(opportunities => { context.opportunities = opportunities; })
      );
    }
    
    await Promise.all(promises);
    
    // Add summary statistics
    context.summary = {
      totalAvatars: context.avatars?.length || 0,
      totalLocations: context.locations?.length || 0,
      totalItems: context.items?.length || 0,
      recentEventCount: context.recentEvents?.length || 0,
      opportunityCount: context.opportunities?.length || 0
    };
    
    return context;
  }

  /**
   * Format world context for AI prompts
   * @param {Object} context - World context object
   * @returns {string}
   */
  formatContextForPrompt(context) {
    let prompt = '=== COSYWORLD CURRENT STATE ===\n\n';
    
    // Summary
    prompt += `Summary: ${context.summary.totalAvatars} avatars, ${context.summary.totalLocations} locations, ${context.summary.totalItems} items\n\n`;
    
    // Avatars
    if (context.avatars && context.avatars.length > 0) {
      prompt += '--- AVATARS ---\n';
      const avatarSample = context.avatars.slice(0, 20); // Limit for prompt size
      for (const avatar of avatarSample) {
        prompt += `• ID: ${avatar._id} | ${avatar.name} ${avatar.emoji || ''}: ${avatar.description || 'A denizen of CosyWorld'}\n`;
      }
      prompt += '\n';
    }
    
    // Locations
    if (context.locations && context.locations.length > 0) {
      prompt += '--- LOCATIONS ---\n';
      for (const location of context.locations.slice(0, 10)) {
        prompt += `• ID: ${location._id} | ${location.name}: ${location.description || 'A place in CosyWorld'}\n`;
      }
      prompt += '\n';
    }
    
    // Items
    if (context.items && context.items.length > 0) {
      prompt += '--- NOTABLE ITEMS ---\n';
      for (const item of context.items.slice(0, 10)) {
        prompt += `• ID: ${item._id} | ${item.name}: ${item.description || 'An item'}\n`;
      }
      prompt += '\n';
    }
    
    // Opportunities
    if (context.opportunities && context.opportunities.length > 0) {
      prompt += '--- STORY OPPORTUNITIES ---\n';
      for (const opp of context.opportunities) {
        prompt += `• ${opp.type}: ${opp.description} (priority: ${opp.priority})\n`;
      }
      prompt += '\n';
    }
    
    return prompt;
  }
}

export default WorldContextService;
