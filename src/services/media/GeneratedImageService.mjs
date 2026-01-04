/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * GeneratedImageService - Persists and indexes all AI-generated images
 * 
 * Provides:
 * - Database indexing of all generated images with metadata
 * - Prompt-based lookup to find existing similar images
 * - Tag and category-based retrieval for reuse
 * - Cost tracking per image
 * - Usage statistics
 */

import { ObjectId } from 'mongodb';
import crypto from 'crypto';

/**
 * Generate a hash of a prompt for similarity matching
 * @param {string} prompt - The prompt text
 * @returns {string} - SHA256 hash of normalized prompt
 */
function hashPrompt(prompt) {
  const normalized = (prompt || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, ''); // Remove punctuation for fuzzy matching
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Extract keywords from a prompt for searchability
 * @param {string} prompt - The prompt text
 * @returns {string[]} - Array of keywords
 */
function extractKeywords(prompt) {
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were']);
  return (prompt || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length >= 3 && !stopWords.has(word));
}

export class GeneratedImageService {
  constructor({ databaseService, logger }) {
    this.databaseService = databaseService;
    this.logger = logger || console;
    this._collection = null;
  }

  /**
   * Get the generated_images collection with indexes
   * @returns {Promise<Collection>}
   */
  async collection() {
    if (!this._collection) {
      const db = await this.databaseService.getDatabase();
      this._collection = db.collection('generated_images');
      await this._ensureIndexes();
    }
    return this._collection;
  }

  /**
   * Ensure required indexes exist
   * @private
   */
  async _ensureIndexes() {
    try {
      await this._collection.createIndex({ promptHash: 1 });
      await this._collection.createIndex({ purpose: 1 });
      await this._collection.createIndex({ category: 1 });
      await this._collection.createIndex({ tags: 1 });
      await this._collection.createIndex({ createdAt: -1 });
      await this._collection.createIndex({ 'metadata.theme': 1 });
      await this._collection.createIndex({ 'metadata.roomType': 1 });
      await this._collection.createIndex({ keywords: 1 });
      // Compound index for dungeon room lookups
      await this._collection.createIndex({ 
        category: 1, 
        'metadata.theme': 1, 
        'metadata.roomType': 1 
      });
      this.logger?.info?.('[GeneratedImageService] Indexes created');
    } catch (e) {
      this.logger?.warn?.(`[GeneratedImageService] Index creation: ${e.message}`);
    }
  }

  /**
   * Save a generated image to the database
   * @param {Object} params - Image data
   * @param {string} params.imageUrl - The S3 URL of the image
   * @param {string} params.prompt - The generation prompt
   * @param {string} [params.purpose] - Purpose identifier (e.g., 'dungeon_room', 'avatar', 'item')
   * @param {string} [params.category] - Category for grouping (e.g., 'dungeon', 'story', 'character')
   * @param {string[]} [params.tags] - Searchable tags
   * @param {Object} [params.metadata] - Additional metadata (theme, roomType, etc.)
   * @param {string} [params.source] - Source service that generated the image
   * @param {number} [params.cost] - Estimated cost in cents
   * @returns {Promise<Object>} - The saved image document
   */
  async saveImage({
    imageUrl,
    prompt,
    purpose = 'general',
    category = 'general',
    tags = [],
    metadata = {},
    source = 'unknown',
    cost = 0
  }) {
    const col = await this.collection();
    
    const doc = {
      imageUrl,
      prompt,
      promptHash: hashPrompt(prompt),
      keywords: extractKeywords(prompt),
      purpose,
      category,
      tags: Array.isArray(tags) ? tags : [tags],
      metadata,
      source,
      cost,
      usageCount: 0,
      createdAt: new Date(),
      lastUsedAt: null
    };

    const result = await col.insertOne(doc);
    this.logger?.info?.(`[GeneratedImageService] Saved image ${result.insertedId} for ${purpose}`);
    
    return { ...doc, _id: result.insertedId };
  }

  /**
   * Find an existing image by exact prompt match
   * @param {string} prompt - The generation prompt
   * @returns {Promise<Object|null>} - Matching image or null
   */
  async findByPrompt(prompt) {
    const col = await this.collection();
    const promptHash = hashPrompt(prompt);
    
    const image = await col.findOne({ promptHash });
    if (image) {
      // Increment usage counter
      await col.updateOne(
        { _id: image._id },
        { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } }
      );
      this.logger?.debug?.(`[GeneratedImageService] Cache hit for prompt hash ${promptHash.slice(0, 8)}...`);
    }
    return image;
  }

  /**
   * Find images by purpose and metadata (for dungeon rooms, etc.)
   * @param {Object} query - Search query
   * @param {string} [query.purpose] - Purpose identifier
   * @param {string} [query.category] - Category
   * @param {string} [query.theme] - Theme (in metadata)
   * @param {string} [query.roomType] - Room type (in metadata)
   * @param {string[]} [query.tags] - Required tags (any match)
   * @param {number} [query.limit] - Max results (default: 10)
   * @returns {Promise<Object[]>} - Matching images
   */
  async findImages({ purpose, category, theme, roomType, tags, limit = 10 }) {
    const col = await this.collection();
    
    const filter = {};
    if (purpose) filter.purpose = purpose;
    if (category) filter.category = category;
    if (theme) filter['metadata.theme'] = theme;
    if (roomType) filter['metadata.roomType'] = roomType;
    if (tags?.length) filter.tags = { $in: tags };
    
    const images = await col.find(filter)
      .sort({ usageCount: 1, createdAt: -1 }) // Prefer less-used images for variety
      .limit(limit)
      .toArray();
    
    return images;
  }

  /**
   * Find a dungeon room image by theme and room type
   * Specifically designed for dungeon system reuse
   * @param {string} theme - Dungeon theme (e.g., 'crypt', 'cave')
   * @param {string} roomType - Room type (e.g., 'combat', 'treasure', 'entrance')
   * @param {Object} [options] - Options
   * @param {boolean} [options.random] - Return random match instead of least-used
   * @returns {Promise<Object|null>} - Matching image or null
   */
  async findDungeonRoomImage(theme, roomType, options = {}) {
    const col = await this.collection();
    
    const filter = {
      category: 'dungeon',
      'metadata.theme': theme,
      'metadata.roomType': roomType
    };
    
    const images = await col.find(filter)
      .sort({ usageCount: 1, createdAt: -1 })
      .limit(10)
      .toArray();
    
    if (images.length === 0) return null;
    
    // Select image (random or least-used)
    let selected;
    if (options.random && images.length > 1) {
      selected = images[Math.floor(Math.random() * images.length)];
    } else {
      selected = images[0]; // Least used
    }
    
    // Increment usage
    await col.updateOne(
      { _id: selected._id },
      { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } }
    );
    
    this.logger?.debug?.(`[GeneratedImageService] Reusing dungeon image for ${theme}/${roomType}`);
    return selected;
  }

  /**
   * Get or generate a dungeon room image
   * First checks cache, then generates if not found
   * @param {string} theme - Dungeon theme
   * @param {string} roomType - Room type
   * @param {Function} generateFn - Async function to generate image if not cached
   * @param {Object} [options] - Options
   * @param {number} [options.maxCached] - Max cached images before generating (default: 5)
   * @param {number} [options.reuseChance] - Probability of reusing cached (0-1, default: 0.7)
   * @returns {Promise<string>} - Image URL
   */
  async getOrGenerateDungeonImage(theme, roomType, generateFn, options = {}) {
    const { maxCached = 5, reuseChance = 0.7 } = options;
    const col = await this.collection();
    
    // Count existing images for this theme/roomType
    const count = await col.countDocuments({
      category: 'dungeon',
      'metadata.theme': theme,
      'metadata.roomType': roomType
    });
    
    // Decide whether to reuse or generate
    const shouldReuse = count > 0 && (count >= maxCached || Math.random() < reuseChance);
    
    if (shouldReuse) {
      const cached = await this.findDungeonRoomImage(theme, roomType, { random: true });
      if (cached?.imageUrl) {
        this.logger?.info?.(`[GeneratedImageService] Reusing cached ${theme}/${roomType} image (${count} cached)`);
        return cached.imageUrl;
      }
    }
    
    // Generate new image
    this.logger?.info?.(`[GeneratedImageService] Generating new ${theme}/${roomType} image (${count} cached)`);
    const imageUrl = await generateFn();
    
    if (imageUrl) {
      // Save to database for future reuse
      const prompt = `${theme} dungeon ${roomType} room`; // Approximate prompt for indexing
      await this.saveImage({
        imageUrl,
        prompt,
        purpose: 'dungeon_room',
        category: 'dungeon',
        tags: [theme, roomType, 'dungeon', 'room'],
        metadata: { theme, roomType },
        source: 'dungeon_generation',
        cost: 1 // Approximate cost in cents
      });
    }
    
    return imageUrl;
  }

  /**
   * Search images by keywords
   * @param {string} searchText - Search text
   * @param {Object} [filters] - Additional filters
   * @param {number} [limit] - Max results
   * @returns {Promise<Object[]>} - Matching images
   */
  async searchByKeywords(searchText, filters = {}, limit = 20) {
    const col = await this.collection();
    const keywords = extractKeywords(searchText);
    
    if (keywords.length === 0) return [];
    
    const filter = {
      keywords: { $in: keywords },
      ...filters
    };
    
    return col.find(filter)
      .sort({ usageCount: 1, createdAt: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Get usage statistics
   * @returns {Promise<Object>} - Statistics object
   */
  async getStats() {
    const col = await this.collection();
    
    const [
      totalImages,
      totalUsage,
      byCategory,
      byPurpose
    ] = await Promise.all([
      col.countDocuments({}),
      col.aggregate([{ $group: { _id: null, total: { $sum: '$usageCount' } } }]).toArray(),
      col.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }]).toArray(),
      col.aggregate([{ $group: { _id: '$purpose', count: { $sum: 1 } } }]).toArray()
    ]);
    
    return {
      totalImages,
      totalReuses: totalUsage[0]?.total || 0,
      byCategory: Object.fromEntries(byCategory.map(c => [c._id, c.count])),
      byPurpose: Object.fromEntries(byPurpose.map(p => [p._id, p.count]))
    };
  }

  /**
   * Delete old unused images to save storage
   * @param {number} maxAgeDays - Delete images older than this (default: 90)
   * @param {number} minUsageCount - Only delete if usage below this (default: 0)
   * @returns {Promise<number>} - Number of deleted images
   */
  async cleanupUnused(maxAgeDays = 90, minUsageCount = 0) {
    const col = await this.collection();
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
    
    const result = await col.deleteMany({
      createdAt: { $lt: cutoff },
      usageCount: { $lte: minUsageCount }
    });
    
    this.logger?.info?.(`[GeneratedImageService] Cleaned up ${result.deletedCount} unused images`);
    return result.deletedCount;
  }
}

export default GeneratedImageService;
