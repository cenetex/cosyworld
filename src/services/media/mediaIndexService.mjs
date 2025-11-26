/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Media Index Service
 * 
 * Provides semantic search and content indexing for generated media.
 * Enables finding the right media based on content description.
 * 
 * Features:
 * - Content embedding generation using AI
 * - Semantic search across media library
 * - Tag-based filtering
 * - Aspect ratio filtering
 * - Media type filtering
 * 
 * @module services/media/mediaIndexService
 */

/**
 * MediaIndexService - Semantic search and indexing for generated media
 */
export class MediaIndexService {
  /**
   * @param {Object} deps - Service dependencies
   * @param {Object} deps.databaseService - Database service
   * @param {Object} deps.googleAIService - Google AI service for embeddings
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor({ databaseService, googleAIService, logger }) {
    this.databaseService = databaseService;
    this.googleAIService = googleAIService;
    this.logger = logger;
    
    // Collection name for indexed media
    this.collectionName = 'telegram_recent_media';
    
    // Embedding model configuration
    this.embeddingModel = 'text-embedding-004';
    this.embeddingDimension = 768;
    
    // Cache for embeddings to avoid regeneration
    this._embeddingCache = new Map();
    this._cacheMaxSize = 1000;
    
    this.logger?.info?.('[MediaIndexService] Initialized');
  }

  /**
   * Generate an embedding for text content
   * @param {string} text - Text to embed
   * @returns {Promise<number[]|null>} - Embedding vector or null
   */
  async generateEmbedding(text) {
    if (!text || typeof text !== 'string' || !text.trim()) {
      return null;
    }
    
    const cacheKey = text.substring(0, 200); // Use truncated text as cache key
    if (this._embeddingCache.has(cacheKey)) {
      return this._embeddingCache.get(cacheKey);
    }
    
    try {
      // Use Google AI to generate embedding
      if (this.googleAIService?.generateEmbedding) {
        const embedding = await this.googleAIService.generateEmbedding(text, {
          model: this.embeddingModel
        });
        
        if (embedding && Array.isArray(embedding)) {
          // Cache the result
          this._cacheEmbedding(cacheKey, embedding);
          return embedding;
        }
      }
      
      // Fallback: Generate simple hash-based "embedding" for basic matching
      // This is not as good as real embeddings but allows basic functionality
      return this._generateSimpleEmbedding(text);
    } catch (error) {
      this.logger?.warn?.('[MediaIndexService] Failed to generate embedding:', error.message);
      return null;
    }
  }

  /**
   * Generate a simple hash-based embedding as fallback
   * @param {string} text - Text to embed
   * @returns {number[]} - Simple embedding vector
   * @private
   */
  _generateSimpleEmbedding(text) {
    // Simple word-based embedding using term frequency
    const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    const wordFreq = new Map();
    
    for (const word of words) {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    }
    
    // Create a deterministic embedding based on word hashes
    const embedding = new Array(128).fill(0);
    
    for (const [word, freq] of wordFreq) {
      const hash = this._simpleHash(word);
      const idx = Math.abs(hash) % embedding.length;
      embedding[idx] += freq / words.length;
    }
    
    // Normalize
    const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0)) || 1;
    return embedding.map(v => v / magnitude);
  }

  /**
   * Simple string hash function
   * @param {string} str - String to hash
   * @returns {number} - Hash value
   * @private
   */
  _simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
  }

  /**
   * Cache an embedding
   * @param {string} key - Cache key
   * @param {number[]} embedding - Embedding vector
   * @private
   */
  _cacheEmbedding(key, embedding) {
    // Evict oldest entries if cache is full
    if (this._embeddingCache.size >= this._cacheMaxSize) {
      const firstKey = this._embeddingCache.keys().next().value;
      this._embeddingCache.delete(firstKey);
    }
    this._embeddingCache.set(key, embedding);
  }

  /**
   * Index a media record with content embedding
   * @param {Object} mediaRecord - Media record to index
   * @returns {Promise<Object>} - Indexed record with embedding
   */
  async indexMedia(mediaRecord) {
    if (!mediaRecord?.id) {
      return mediaRecord;
    }

    try {
      // Build content description from available fields
      const contentText = this._buildContentDescription(mediaRecord);
      
      // Generate embedding
      const embedding = await this.generateEmbedding(contentText);
      
      // Extract tags from content
      const tags = this._extractTags(mediaRecord);
      
      // Update record with indexing data
      const indexedData = {
        contentDescription: contentText,
        contentEmbedding: embedding,
        tags,
        indexedAt: new Date()
      };

      // Persist to database
      if (this.databaseService) {
        const db = await this.databaseService.getDatabase();
        await db.collection(this.collectionName).updateOne(
          { id: mediaRecord.id },
          { $set: indexedData }
        );
      }

      return { ...mediaRecord, ...indexedData };
    } catch (error) {
      this.logger?.warn?.('[MediaIndexService] Failed to index media:', error.message);
      return mediaRecord;
    }
  }

  /**
   * Build a content description from media record fields
   * @param {Object} record - Media record
   * @returns {string} - Content description
   * @private
   */
  _buildContentDescription(record) {
    const parts = [];
    
    // Type
    if (record.type) {
      parts.push(record.type);
    }
    
    // Existing content description
    if (record.metadata?.contentDescription) {
      parts.push(record.metadata.contentDescription);
    }
    
    // Original prompt
    if (record.toolingState?.originalPrompt) {
      parts.push(record.toolingState.originalPrompt);
    } else if (record.prompt) {
      parts.push(record.prompt);
    }
    
    // Caption
    if (record.caption && record.caption !== record.prompt) {
      parts.push(record.caption);
    }
    
    // Aspect ratio
    if (record.toolingState?.aspectRatio) {
      parts.push(`aspect ratio ${record.toolingState.aspectRatio}`);
    }
    
    return parts.join(' | ');
  }

  /**
   * Extract tags from a media record
   * @param {Object} record - Media record
   * @returns {string[]} - Extracted tags
   * @private
   */
  _extractTags(record) {
    const tags = new Set();
    
    // Add type as tag
    if (record.type) {
      tags.add(record.type);
    }
    
    // Add aspect ratio as tag
    if (record.toolingState?.aspectRatio) {
      tags.add(record.toolingState.aspectRatio);
    }
    
    // Extract keywords from prompt/description
    const text = [
      record.prompt || '',
      record.caption || '',
      record.metadata?.contentDescription || ''
    ].join(' ').toLowerCase();
    
    // Common media-related keywords to tag
    const keywords = [
      'landscape', 'portrait', 'square', 'banner', 'widescreen',
      'sunset', 'sunrise', 'night', 'day', 'morning', 'evening',
      'city', 'nature', 'ocean', 'mountain', 'forest', 'beach',
      'person', 'character', 'avatar', 'face', 'selfie',
      'abstract', 'artistic', 'cinematic', 'photorealistic',
      'video', 'animation', 'loop', 'motion'
    ];
    
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        tags.add(keyword);
      }
    }
    
    return Array.from(tags);
  }

  /**
   * Search media by semantic similarity
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @param {string} [options.channelId] - Filter by channel
   * @param {string} [options.type] - Filter by media type
   * @param {string} [options.aspectRatio] - Filter by aspect ratio
   * @param {number} [options.limit=10] - Maximum results
   * @returns {Promise<Object[]>} - Matching media records
   */
  async searchMedia(query, options = {}) {
    const {
      channelId,
      type,
      aspectRatio,
      limit = 10
    } = options;

    if (!this.databaseService) {
      return [];
    }

    try {
      const db = await this.databaseService.getDatabase();
      const collection = db.collection(this.collectionName);
      
      // Build filter
      const filter = {};
      if (channelId) {
        filter.channelId = String(channelId);
      }
      if (type) {
        filter.type = type;
      }
      if (aspectRatio) {
        filter['toolingState.aspectRatio'] = aspectRatio;
      }

      // Check if we have vector search available (MongoDB Atlas)
      const hasVectorSearch = await this._checkVectorSearchCapability(collection);
      
      if (hasVectorSearch) {
        return this._vectorSearch(collection, query, filter, limit);
      } else {
        // Fall back to text-based search
        return this._textSearch(collection, query, filter, limit);
      }
    } catch (error) {
      this.logger?.warn?.('[MediaIndexService] Search failed:', error.message);
      return [];
    }
  }

  /**
   * Check if vector search is available
   * @param {Object} collection - MongoDB collection
   * @returns {Promise<boolean>}
   * @private
   */
  async _checkVectorSearchCapability(collection) {
    try {
      // Check for vector search index
      const indexes = await collection.listSearchIndexes?.().toArray?.();
      return indexes?.some(idx => idx.type === 'vectorSearch');
    } catch {
      return false;
    }
  }

  /**
   * Perform vector similarity search (MongoDB Atlas)
   * @param {Object} collection - MongoDB collection
   * @param {string} query - Search query
   * @param {Object} filter - Additional filters
   * @param {number} limit - Max results
   * @returns {Promise<Object[]>}
   * @private
   */
  async _vectorSearch(collection, query, filter, limit) {
    const queryEmbedding = await this.generateEmbedding(query);
    if (!queryEmbedding) {
      return this._textSearch(collection, query, filter, limit);
    }

    try {
      const results = await collection.aggregate([
        {
          $vectorSearch: {
            index: 'media_content_vector',
            path: 'contentEmbedding',
            queryVector: queryEmbedding,
            numCandidates: limit * 10,
            limit: limit,
            filter: Object.keys(filter).length > 0 ? filter : undefined
          }
        },
        {
          $project: {
            _id: 0,
            id: 1,
            type: 1,
            mediaUrl: 1,
            prompt: 1,
            caption: 1,
            createdAt: 1,
            toolingState: 1,
            metadata: 1,
            contentDescription: 1,
            tags: 1,
            score: { $meta: 'vectorSearchScore' }
          }
        }
      ]).toArray();

      return results;
    } catch (error) {
      this.logger?.warn?.('[MediaIndexService] Vector search failed, falling back to text:', error.message);
      return this._textSearch(collection, query, filter, limit);
    }
  }

  /**
   * Perform text-based search (fallback)
   * @param {Object} collection - MongoDB collection
   * @param {string} query - Search query
   * @param {Object} filter - Additional filters
   * @param {number} limit - Max results
   * @returns {Promise<Object[]>}
   * @private
   */
  async _textSearch(collection, query, filter, limit) {
    // Use regex matching on content description and prompts
    const queryWords = query.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    
    if (queryWords.length === 0) {
      // Return recent items if no query
      return collection.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
    }

    // Build OR query for fuzzy matching
    const searchFilter = {
      ...filter,
      $or: [
        { contentDescription: { $regex: queryWords.join('|'), $options: 'i' } },
        { prompt: { $regex: queryWords.join('|'), $options: 'i' } },
        { caption: { $regex: queryWords.join('|'), $options: 'i' } },
        { 'metadata.contentDescription': { $regex: queryWords.join('|'), $options: 'i' } },
        { tags: { $in: queryWords } }
      ]
    };

    const results = await collection.find(searchFilter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .project({
        _id: 0,
        id: 1,
        type: 1,
        mediaUrl: 1,
        prompt: 1,
        caption: 1,
        createdAt: 1,
        toolingState: 1,
        metadata: 1,
        contentDescription: 1,
        tags: 1
      })
      .toArray();

    return results;
  }

  /**
   * Find media similar to an existing record
   * @param {string} mediaId - Source media ID
   * @param {Object} options - Search options
   * @returns {Promise<Object[]>} - Similar media records
   */
  async findSimilarMedia(mediaId, options = {}) {
    const { channelId, limit = 5 } = options;

    if (!this.databaseService) {
      return [];
    }

    try {
      const db = await this.databaseService.getDatabase();
      const collection = db.collection(this.collectionName);
      
      // Get the source record
      const sourceRecord = await collection.findOne({ id: mediaId });
      if (!sourceRecord) {
        return [];
      }

      // Build search query from source content
      const searchQuery = this._buildContentDescription(sourceRecord);
      
      // Search for similar, excluding the source
      const results = await this.searchMedia(searchQuery, {
        channelId,
        type: sourceRecord.type,
        limit: limit + 1 // Get one extra to filter out source
      });

      // Filter out the source record
      return results.filter(r => r.id !== mediaId).slice(0, limit);
    } catch (error) {
      this.logger?.warn?.('[MediaIndexService] findSimilarMedia failed:', error.message);
      return [];
    }
  }

  /**
   * Get media matching specific criteria
   * @param {Object} criteria - Search criteria
   * @returns {Promise<Object[]>} - Matching media
   */
  async getMediaByCriteria(criteria = {}) {
    const {
      channelId,
      type,
      aspectRatio,
      tags,
      untweeted = false,
      limit = 10
    } = criteria;

    if (!this.databaseService) {
      return [];
    }

    try {
      const db = await this.databaseService.getDatabase();
      const collection = db.collection(this.collectionName);
      
      const filter = {};
      
      if (channelId) {
        filter.channelId = String(channelId);
      }
      if (type) {
        filter.type = type;
      }
      if (aspectRatio) {
        filter['toolingState.aspectRatio'] = aspectRatio;
      }
      if (tags && tags.length > 0) {
        filter.tags = { $all: tags };
      }
      if (untweeted) {
        filter.tweetedAt = null;
      }

      return collection.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
    } catch (error) {
      this.logger?.warn?.('[MediaIndexService] getMediaByCriteria failed:', error.message);
      return [];
    }
  }

  /**
   * Ensure required indexes exist
   * @returns {Promise<void>}
   */
  async ensureIndexes() {
    if (!this.databaseService) return;

    try {
      const db = await this.databaseService.getDatabase();
      const collection = db.collection(this.collectionName);

      // Create index for content-based searches
      await collection.createIndex(
        { contentDescription: 'text', prompt: 'text', caption: 'text' },
        { name: 'content_text_search', background: true }
      ).catch(() => {}); // Ignore if exists

      // Create index for tag-based searches
      await collection.createIndex(
        { tags: 1 },
        { name: 'tags_index', background: true }
      ).catch(() => {}); // Ignore if exists

      // Create index for indexed status
      await collection.createIndex(
        { indexedAt: 1 },
        { name: 'indexedAt_index', background: true, sparse: true }
      ).catch(() => {}); // Ignore if exists

      this.logger?.info?.('[MediaIndexService] Ensured indexes');
    } catch (error) {
      this.logger?.warn?.('[MediaIndexService] Failed to create indexes:', error.message);
    }
  }

  /**
   * Backfill embeddings for existing media
   * @param {Object} options - Backfill options
   * @returns {Promise<Object>} - Backfill statistics
   */
  async backfillEmbeddings(options = {}) {
    const { channelId, batchSize = 50, maxRecords = 500 } = options;

    if (!this.databaseService) {
      return { processed: 0, failed: 0 };
    }

    try {
      const db = await this.databaseService.getDatabase();
      const collection = db.collection(this.collectionName);
      
      // Find records without embeddings
      const filter = {
        contentEmbedding: { $exists: false }
      };
      if (channelId) {
        filter.channelId = String(channelId);
      }

      const cursor = collection.find(filter).limit(maxRecords);
      
      let processed = 0;
      let failed = 0;
      let batch = [];

      while (await cursor.hasNext()) {
        const record = await cursor.next();
        batch.push(record);

        if (batch.length >= batchSize) {
          const results = await Promise.allSettled(
            batch.map(r => this.indexMedia(r))
          );
          
          processed += results.filter(r => r.status === 'fulfilled').length;
          failed += results.filter(r => r.status === 'rejected').length;
          
          batch = [];
          
          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Process remaining batch
      if (batch.length > 0) {
        const results = await Promise.allSettled(
          batch.map(r => this.indexMedia(r))
        );
        processed += results.filter(r => r.status === 'fulfilled').length;
        failed += results.filter(r => r.status === 'rejected').length;
      }

      this.logger?.info?.(`[MediaIndexService] Backfill complete: ${processed} processed, ${failed} failed`);
      return { processed, failed };
    } catch (error) {
      this.logger?.error?.('[MediaIndexService] Backfill failed:', error.message);
      return { processed: 0, failed: 0, error: error.message };
    }
  }
}
