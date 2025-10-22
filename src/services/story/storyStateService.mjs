/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { ObjectId } from 'mongodb';

/**
 * StoryStateService
 * 
 * Manages persistence and state tracking for story arcs, beats, and character states.
 * Provides CRUD operations for the storytelling system.
 */
export class StoryStateService {
  constructor({ databaseService, logger }) {
    this.databaseService = databaseService;
    this.logger = logger || console;
  }

  async _db() {
    return await this.databaseService.getDatabase();
  }

  // ============================================================================
  // Story Arcs
  // ============================================================================

  /**
   * Create a new story arc
   * @param {Object} arcData - Story arc data
   * @returns {Promise<Object>} Created arc with _id
   */
  async createArc(arcData) {
    const db = await this._db();
    const arcs = db.collection('story_arcs');

    const arc = {
      ...arcData,
      status: arcData.status || 'planning',
      completedBeats: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await arcs.insertOne(arc);
    return { ...arc, _id: result.insertedId };
  }

  /**
   * Get story arc by ID
   * @param {string|ObjectId} arcId - Arc ID
   * @returns {Promise<Object|null>}
   */
  async getArc(arcId) {
    const db = await this._db();
    const arcs = db.collection('story_arcs');
    return await arcs.findOne({ _id: new ObjectId(arcId) });
  }

  /**
   * Get active story arcs
   * @returns {Promise<Array>}
   */
  async getActiveArcs() {
    const db = await this._db();
    const arcs = db.collection('story_arcs');
    return await arcs.find({ status: 'active' }).toArray();
  }

  /**
   * Get all arcs with optional filters
   * @param {Object} filter - MongoDB filter
   * @param {Object} options - Query options (limit, sort, etc.)
   * @returns {Promise<Array>}
   */
  async getArcs(filter = {}, options = {}) {
    const db = await this._db();
    const arcs = db.collection('story_arcs');
    
    let query = arcs.find(filter);
    
    if (options.sort) query = query.sort(options.sort);
    if (options.limit) query = query.limit(options.limit);
    if (options.skip) query = query.skip(options.skip);
    
    return await query.toArray();
  }

  /**
   * Update story arc
   * @param {string|ObjectId} arcId - Arc ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<boolean>} Success status
   */
  async updateArc(arcId, updates) {
    const db = await this._db();
    const arcs = db.collection('story_arcs');
    
    const result = await arcs.updateOne(
      { _id: new ObjectId(arcId) },
      { 
        $set: { 
          ...updates, 
          updatedAt: new Date() 
        } 
      }
    );
    
    return result.modifiedCount > 0;
  }

  /**
   * Add a beat to a story arc
   * @param {string|ObjectId} arcId - Arc ID
   * @param {Object} beatData - Beat data
   * @returns {Promise<Object>} Updated arc
   */
  async addBeat(arcId, beatData) {
    const db = await this._db();
    const arcs = db.collection('story_arcs');
    
    const beat = {
      ...beatData,
      postedAt: beatData.postedAt || new Date()
    };
    
    const result = await arcs.findOneAndUpdate(
      { _id: new ObjectId(arcId) },
      { 
        $push: { beats: beat },
        $inc: { completedBeats: 1 },
        $set: { 
          lastProgressedAt: new Date(),
          updatedAt: new Date()
        }
      },
      { returnDocument: 'after' }
    );
    
    if (!result) {
      throw new Error(`Failed to update arc ${arcId}`);
    }
    
    return result;
  }

  /**
   * Update arc status
   * @param {string|ObjectId} arcId - Arc ID
   * @param {string} status - New status
   * @returns {Promise<boolean>}
   */
  async updateArcStatus(arcId, status) {
    const db = await this._db();
    const arcs = db.collection('story_arcs');
    
    const updates = { status, updatedAt: new Date() };
    if (status === 'completed') {
      updates.completedAt = new Date();
    }
    
    const result = await arcs.updateOne(
      { _id: new ObjectId(arcId) },
      { $set: updates }
    );
    
    return result.modifiedCount > 0;
  }

  // ============================================================================
  // Character States
  // ============================================================================

  /**
   * Get or create character state
   * @param {string|ObjectId} avatarId - Avatar ID
   * @returns {Promise<Object>}
   */
  async getCharacterState(avatarId) {
    const db = await this._db();
    const states = db.collection('story_character_states');
    
    let state = await states.findOne({ avatarId: new ObjectId(avatarId) });
    
    if (!state) {
      // Create default state
      state = {
        avatarId: new ObjectId(avatarId),
        currentArc: null,
        emotionalState: 'neutral',
        relationships: [],
        inventory: [],
        locationHistory: [],
        characterDevelopment: {
          traits: [],
          achievements: [],
          challenges: [],
          growthSummary: ''
        },
        storyStats: {
          totalArcsParticipated: 0,
          protagonistCount: 0,
          lastFeaturedAt: null,
          favoriteLocation: null,
          characterSignature: ''
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      await states.insertOne(state);
    }
    
    return state;
  }

  /**
   * Update character state
   * @param {string|ObjectId} avatarId - Avatar ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<boolean>}
   */
  async updateCharacterState(avatarId, updates) {
    const db = await this._db();
    const states = db.collection('story_character_states');
    
    const result = await states.updateOne(
      { avatarId: new ObjectId(avatarId) },
      { 
        $set: { 
          ...updates, 
          updatedAt: new Date() 
        } 
      },
      { upsert: true }
    );
    
    return result.modifiedCount > 0 || result.upsertedCount > 0;
  }

  /**
   * Add relationship between characters
   * @param {string|ObjectId} avatarId - Primary avatar ID
   * @param {string|ObjectId} withAvatarId - Related avatar ID
   * @param {string} relationship - Relationship type
   * @param {number} strength - Relationship strength (0-10)
   * @param {string|ObjectId} arcId - Arc where relationship developed
   * @returns {Promise<boolean>}
   */
  async addRelationship(avatarId, withAvatarId, relationship, strength = 5, arcId = null) {
    const db = await this._db();
    const states = db.collection('story_character_states');
    
    const result = await states.updateOne(
      { avatarId: new ObjectId(avatarId) },
      { 
        $push: {
          relationships: {
            withAvatarId: new ObjectId(withAvatarId),
            relationship,
            strength,
            developedInArc: arcId ? new ObjectId(arcId) : null,
            createdAt: new Date()
          }
        },
        $set: { updatedAt: new Date() }
      },
      { upsert: true }
    );
    
    return result.modifiedCount > 0 || result.upsertedCount > 0;
  }

  /**
   * Record character visit to location
   * @param {string|ObjectId} avatarId - Avatar ID
   * @param {string|ObjectId} locationId - Location ID
   * @param {string|ObjectId} arcId - Arc ID
   * @param {string} memorableEvent - Optional event description
   * @returns {Promise<boolean>}
   */
  async recordLocationVisit(avatarId, locationId, arcId, memorableEvent = '') {
    const db = await this._db();
    const states = db.collection('story_character_states');
    
    const result = await states.updateOne(
      { avatarId: new ObjectId(avatarId) },
      { 
        $push: {
          locationHistory: {
            locationId: new ObjectId(locationId),
            arrivedAt: new Date(),
            arcId: new ObjectId(arcId),
            memorableEvent
          }
        },
        $set: { updatedAt: new Date() }
      },
      { upsert: true }
    );
    
    return result.modifiedCount > 0 || result.upsertedCount > 0;
  }

  /**
   * Get characters who haven't been featured recently
   * @param {number} daysSince - Days since last feature
   * @returns {Promise<Array>}
   */
  async getUnfeaturedCharacters(daysSince = 7) {
    const db = await this._db();
    const states = db.collection('story_character_states');
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysSince);
    
    return await states.find({
      $or: [
        { 'storyStats.lastFeaturedAt': null },
        { 'storyStats.lastFeaturedAt': { $lt: cutoffDate } }
      ]
    }).toArray();
  }

  // ============================================================================
  // Memory Summaries
  // ============================================================================

  /**
   * Create a memory summary
   * @param {Object} summaryData - Summary data
   * @returns {Promise<Object>}
   */
  async createSummary(summaryData) {
    const db = await this._db();
    const summaries = db.collection('story_memory_summaries');
    
    const summary = {
      ...summaryData,
      usageCount: 0,
      lastUsed: null,
      createdAt: new Date()
    };
    
    const result = await summaries.insertOne(summary);
    return { ...summary, _id: result.insertedId };
  }

  /**
   * Get summaries by type and reference
   * @param {string} type - Summary type
   * @param {string|ObjectId} referenceId - Reference ID
   * @returns {Promise<Array>}
   */
  async getSummaries(type, referenceId = null) {
    const db = await this._db();
    const summaries = db.collection('story_memory_summaries');
    
    const filter = { type };
    if (referenceId) {
      filter.referenceId = new ObjectId(referenceId);
    }
    
    return await summaries
      .find(filter)
      .sort({ significance: -1, createdAt: -1 })
      .toArray();
  }

  /**
   * Get recent summaries for context
   * @param {number} limit - Number of summaries
   * @returns {Promise<Array>}
   */
  async getRecentSummaries(limit = 10) {
    const db = await this._db();
    const summaries = db.collection('story_memory_summaries');
    
    return await summaries
      .find({})
      .sort({ significance: -1, createdAt: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Increment summary usage
   * @param {string|ObjectId} summaryId - Summary ID
   * @returns {Promise<boolean>}
   */
  async incrementSummaryUsage(summaryId) {
    const db = await this._db();
    const summaries = db.collection('story_memory_summaries');
    
    const result = await summaries.updateOne(
      { _id: new ObjectId(summaryId) },
      { 
        $inc: { usageCount: 1 },
        $set: { lastUsed: new Date() }
      }
    );
    
    return result.modifiedCount > 0;
  }

  // ============================================================================
  // Statistics & Metrics
  // ============================================================================

  /**
   * Get story statistics
   * @returns {Promise<Object>}
   */
  async getStatistics() {
    const db = await this._db();
    const arcs = db.collection('story_arcs');
    
    const [totalArcs, activeArcs, completedArcs, avgDuration] = await Promise.all([
      arcs.countDocuments(),
      arcs.countDocuments({ status: 'active' }),
      arcs.countDocuments({ status: 'completed' }),
      arcs.aggregate([
        { $match: { status: 'completed', startedAt: { $exists: true }, completedAt: { $exists: true } } },
        { 
          $project: { 
            duration: { $subtract: ['$completedAt', '$startedAt'] } 
          } 
        },
        { 
          $group: { 
            _id: null, 
            avgDuration: { $avg: '$duration' } 
          } 
        }
      ]).toArray()
    ]);
    
    return {
      totalArcs,
      activeArcs,
      completedArcs,
      averageArcDurationMs: avgDuration[0]?.avgDuration || 0,
      averageArcDurationDays: avgDuration[0]?.avgDuration 
        ? (avgDuration[0].avgDuration / (1000 * 60 * 60 * 24)).toFixed(1)
        : 0
    };
  }
}

export default StoryStateService;
