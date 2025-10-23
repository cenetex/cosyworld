/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Character Continuity Service
 * 
 * Manages character consistency across story arcs:
 * - Maintains a pool of 12 core characters
 * - Tracks character usage and relationships
 * - Ensures story continuity through character reuse
 * - Manages character development across arcs
 */
export class CharacterContinuityService {
  constructor({ storyStateService, avatarService, logger }) {
    this.storyState = storyStateService;
    this.avatarService = avatarService;
    this.logger = logger || console;
    
    this.config = {
      corePoolSize: 12,
      minRestPeriod: 2, // Minimum arcs before reusing a character
      maxActiveCharacters: 5 // Max characters per arc
    };
  }

  /**
   * Initialize or update the core character pool
   * @returns {Promise<Object>} Core character pool
   */
  async initializeCorePool() {
    try {
      this.logger.info('[CharacterContinuity] Initializing core character pool...');
      
      // Check if pool already exists
      const existingPool = await this.storyState.getCharacterPool();
      if (existingPool && existingPool.characters.length > 0) {
        this.logger.info(`[CharacterContinuity] Pool already exists with ${existingPool.characters.length} characters`);
        return existingPool;
      }
      
      // Get avatars from avatar service
      const avatarsResult = await this.avatarService.listActiveAvatars();
      const avatars = avatarsResult.avatars || [];
      
      if (avatars.length === 0) {
        throw new Error('No avatars available to create character pool');
      }
      
      // Select first N avatars for core pool
      const coreAvatars = avatars.slice(0, this.config.corePoolSize);
      
      // Create character pool
      const pool = {
        characters: coreAvatars.map(avatar => ({
          avatarId: avatar._id,
          avatarName: avatar.agentName,
          description: avatar.description,
          personality: avatar.personality,
          appearances: 0,
          roles: [],
          relationships: [],
          lastFeatured: null,
          arcs: []
        })),
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      // Save pool
      await this.storyState.saveCharacterPool(pool);
      
      this.logger.info(`[CharacterContinuity] Created core pool with ${pool.characters.length} characters`);
      return pool;
      
    } catch (error) {
      this.logger.error('[CharacterContinuity] Error initializing pool:', error);
      throw error;
    }
  }

  /**
   * Select characters for a new story arc
   * Uses intelligent rotation to maintain continuity
   * @param {Object} options - Selection options
   * @param {number} options.count - Number of characters to select
   * @param {string} options.theme - Story theme for role matching
   * @param {Array} options.excludeIds - Character IDs to exclude
   * @returns {Promise<Array>} Selected characters
   */
  async selectCharactersForArc(options = {}) {
    try {
      const {
        count = 5,
        excludeIds = []
      } = options;
      
      // Get or initialize pool
      let pool = await this.storyState.getCharacterPool();
      if (!pool || pool.characters.length === 0) {
        pool = await this.initializeCorePool();
      }
      
      // Filter available characters
      let available = pool.characters.filter(char => 
        !excludeIds.includes(char.avatarId.toString())
      );
      
      // Sort by last featured (oldest first) and appearances (least used first)
      available.sort((a, b) => {
        // Characters never used should come first
        if (!a.lastFeatured && b.lastFeatured) return -1;
        if (a.lastFeatured && !b.lastFeatured) return 1;
        
        // Then by last featured date (oldest first)
        if (a.lastFeatured && b.lastFeatured) {
          const dateDiff = new Date(a.lastFeatured) - new Date(b.lastFeatured);
          if (dateDiff !== 0) return dateDiff;
        }
        
        // Finally by appearances (least used first)
        return a.appearances - b.appearances;
      });
      
      // Select top N characters
      const selected = available.slice(0, Math.min(count, available.length));
      
      if (selected.length < count) {
        this.logger.warn(`[CharacterContinuity] Only ${selected.length} characters available (requested ${count})`);
      }
      
      this.logger.info(`[CharacterContinuity] Selected ${selected.length} characters for new arc`);
      
      return selected.map(char => ({
        avatarId: char.avatarId,
        avatarName: char.avatarName,
        description: char.description,
        personality: char.personality,
        previousRoles: char.roles.slice(-3), // Last 3 roles
        previousArcs: char.arcs.slice(-3) // Last 3 arcs
      }));
      
    } catch (error) {
      this.logger.error('[CharacterContinuity] Error selecting characters:', error);
      throw error;
    }
  }

  /**
   * Update character pool after arc completion
   * @param {string|ObjectId} arcId - Completed arc ID
   * @returns {Promise<void>}
   */
  async updatePoolAfterArc(arcId) {
    try {
      const arc = await this.storyState.getArc(arcId);
      if (!arc || !arc.characters) {
        return;
      }
      
      const pool = await this.storyState.getCharacterPool();
      if (!pool) {
        this.logger.warn('[CharacterContinuity] No pool found, skipping update');
        return;
      }
      
      // Update each character that appeared in the arc
      for (const arcChar of arc.characters) {
        const poolChar = pool.characters.find(c => 
          c.avatarId.toString() === arcChar.avatarId.toString()
        );
        
        if (poolChar) {
          poolChar.appearances++;
          poolChar.roles.push(arcChar.role);
          poolChar.lastFeatured = new Date();
          poolChar.arcs.push({
            arcId: arc._id,
            arcTitle: arc.title,
            role: arcChar.role,
            completedAt: arc.completedAt || new Date()
          });
          
          // Keep only last 10 roles/arcs to prevent bloat
          if (poolChar.roles.length > 10) {
            poolChar.roles = poolChar.roles.slice(-10);
          }
          if (poolChar.arcs.length > 10) {
            poolChar.arcs = poolChar.arcs.slice(-10);
          }
        }
      }
      
      pool.updatedAt = new Date();
      await this.storyState.saveCharacterPool(pool);
      
      this.logger.info(`[CharacterContinuity] Updated pool after arc: ${arc.title}`);
      
    } catch (error) {
      this.logger.error('[CharacterContinuity] Error updating pool:', error);
      throw error;
    }
  }

  /**
   * Get character history and relationships
   * @param {string|ObjectId} avatarId - Avatar ID
   * @returns {Promise<Object>} Character history
   */
  async getCharacterHistory(avatarId) {
    try {
      const pool = await this.storyState.getCharacterPool();
      if (!pool) {
        throw new Error('Character pool not initialized');
      }
      
      const character = pool.characters.find(c => 
        c.avatarId.toString() === avatarId.toString()
      );
      
      if (!character) {
        throw new Error('Character not in core pool');
      }
      
      // Get detailed arc information
      const arcDetails = await Promise.all(
        character.arcs.map(async arcRef => {
          const arc = await this.storyState.getArc(arcRef.arcId);
          return {
            arcId: arcRef.arcId,
            arcTitle: arc?.title || arcRef.arcTitle,
            role: arcRef.role,
            completedAt: arcRef.completedAt,
            summary: arc?.summary,
            coCharacters: arc?.characters?.filter(c => 
              c.avatarId.toString() !== avatarId.toString()
            ).map(c => ({
              avatarId: c.avatarId,
              avatarName: c.avatarName,
              role: c.role
            }))
          };
        })
      );
      
      return {
        success: true,
        character: {
          avatarId: character.avatarId,
          avatarName: character.avatarName,
          description: character.description,
          personality: character.personality,
          appearances: character.appearances,
          lastFeatured: character.lastFeatured,
          recentRoles: character.roles.slice(-5),
          relationships: character.relationships
        },
        arcs: arcDetails,
        totalArcs: arcDetails.length
      };
      
    } catch (error) {
      this.logger.error('[CharacterContinuity] Error getting character history:', error);
      throw error;
    }
  }

  /**
   * Get character relationship network
   * @returns {Promise<Object>} Relationship graph
   */
  async getCharacterNetwork() {
    try {
      const pool = await this.storyState.getCharacterPool();
      if (!pool) {
        throw new Error('Character pool not initialized');
      }
      
      // Build relationship matrix
      const relationships = new Map();
      
      // Get all arcs
      const arcs = await this.storyState.getArcs({
        status: { $in: ['completed', 'active'] }
      });
      
      // For each arc, connect characters who appeared together
      for (const arc of arcs) {
        if (!arc.characters || arc.characters.length < 2) continue;
        
        // Connect each pair
        for (let i = 0; i < arc.characters.length; i++) {
          for (let j = i + 1; j < arc.characters.length; j++) {
            const char1 = arc.characters[i].avatarId.toString();
            const char2 = arc.characters[j].avatarId.toString();
            
            const key = [char1, char2].sort().join(':');
            
            if (!relationships.has(key)) {
              relationships.set(key, {
                character1: char1,
                character2: char2,
                appearances: 0,
                arcs: []
              });
            }
            
            const rel = relationships.get(key);
            rel.appearances++;
            rel.arcs.push(arc._id);
          }
        }
      }
      
      return {
        success: true,
        characters: pool.characters.map(c => ({
          id: c.avatarId.toString(),
          name: c.avatarName,
          appearances: c.appearances
        })),
        relationships: Array.from(relationships.values())
      };
      
    } catch (error) {
      this.logger.error('[CharacterContinuity] Error getting character network:', error);
      throw error;
    }
  }

  /**
   * Get pool statistics
   * @returns {Promise<Object>} Pool stats
   */
  async getPoolStats() {
    try {
      const pool = await this.storyState.getCharacterPool();
      if (!pool) {
        return {
          success: false,
          message: 'Character pool not initialized'
        };
      }
      
      const chars = pool.characters;
      
      return {
        success: true,
        totalCharacters: chars.length,
        avgAppearances: chars.reduce((sum, c) => sum + c.appearances, 0) / chars.length,
        mostUsed: chars.slice().sort((a, b) => b.appearances - a.appearances).slice(0, 5),
        leastUsed: chars.slice().sort((a, b) => a.appearances - b.appearances).slice(0, 5),
        neverUsed: chars.filter(c => c.appearances === 0).length,
        createdAt: pool.createdAt,
        updatedAt: pool.updatedAt
      };
      
    } catch (error) {
      this.logger.error('[CharacterContinuity] Error getting pool stats:', error);
      throw error;
    }
  }
}

export default CharacterContinuityService;
