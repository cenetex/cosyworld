/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Telegram Media Manager
 * Handles media generation, storage, and retrieval
 */

import { randomUUID } from 'crypto';
import { MEDIA_CONFIG } from './constants.mjs';
import { escapeRegExp, downloadImageAsBase64, inferAspectRatioFromPrompt } from './utils.mjs';

/**
 * MediaManager handles all media-related operations
 */
export class MediaManager {
  constructor({ logger, databaseService, cacheManager, mediaIndexService }) {
    this.logger = logger;
    this.databaseService = databaseService;
    this.cache = cacheManager;
    this.mediaIndexService = mediaIndexService;

    // Database indexes ready flag
    this._indexesReady = false;
    this._indexSetupPromise = null;
  }

  // ============================================================================
  // Database Index Management
  // ============================================================================

  /**
   * Create an index safely (handles conflicts)
   * @private
   */
  async _createIndexSafe(collection, fields, options = {}, collectionLabel = 'collection') {
    if (!collection?.createIndex) return;
    try {
      await collection.createIndex(fields, options);
    } catch (error) {
      if (error?.code === 85 || error?.codeName === 'IndexOptionsConflict') {
        this.logger?.debug?.(`[MediaManager] Index already exists on ${collectionLabel}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Ensure required indexes exist
   */
  async ensureIndexes() {
    if (!this.databaseService) return;
    if (this._indexesReady) return;
    if (this._indexSetupPromise) {
      return this._indexSetupPromise;
    }

    this._indexSetupPromise = (async () => {
      let success = false;
      try {
        const db = await this.databaseService.getDatabase();
        const recentMediaCollection = db.collection('telegram_recent_media');

        await this._createIndexSafe(
          recentMediaCollection,
          { channelId: 1, createdAt: -1 },
          { name: 'channelId_createdAt' },
          'telegram_recent_media'
        );
        await this._createIndexSafe(
          recentMediaCollection,
          { createdAt: 1 },
          { name: 'createdAt_ttl_recent_media', expireAfterSeconds: 3 * 24 * 60 * 60 },
          'telegram_recent_media'
        );
        await this._createIndexSafe(
          recentMediaCollection,
          { channelId: 1, id: 1 },
          { name: 'channelId_mediaId', unique: true },
          'telegram_recent_media'
        );
        await this._createIndexSafe(
          recentMediaCollection,
          { channelId: 1, type: 1, createdAt: -1 },
          { name: 'channelId_type_createdAt' },
          'telegram_recent_media'
        );
        await this._createIndexSafe(
          recentMediaCollection,
          { originMediaId: 1 },
          { name: 'originMediaId', sparse: true },
          'telegram_recent_media'
        );

        const agentPlansCollection = db.collection('telegram_agent_plans');
        await this._createIndexSafe(
          agentPlansCollection,
          { channelId: 1, createdAt: -1 },
          { name: 'channelId_createdAt_agent_plan' },
          'telegram_agent_plans'
        );
        await this._createIndexSafe(
          agentPlansCollection,
          { createdAt: 1 },
          { name: 'createdAt_ttl_agent_plan', expireAfterSeconds: 3 * 24 * 60 * 60 },
          'telegram_agent_plans'
        );

        success = true;
        this.logger?.info?.('[MediaManager] Verified telegram indexes');
      } catch (error) {
        this.logger?.warn?.('[MediaManager] Failed to ensure indexes:', error?.message);
      } finally {
        if (success) {
          this._indexesReady = true;
        }
        this._indexSetupPromise = null;
      }
    })();

    return this._indexSetupPromise;
  }

  // ============================================================================
  // Media Record Normalization
  // ============================================================================

  /**
   * Normalize a media record
   * @param {Object} record - Raw record
   * @returns {Object|null} - Normalized record
   */
  normalizeRecord(record = {}) {
    if (!record?.id) return null;
    return {
      ...record,
      channelId: record.channelId ? String(record.channelId) : null,
      createdAt: record.createdAt instanceof Date
        ? record.createdAt
        : new Date(record.createdAt || Date.now()),
    };
  }

  // ============================================================================
  // Media Storage
  // ============================================================================

  /**
   * Remember a generated media item
   * @param {string} channelId - Channel ID
   * @param {Object} entry - Media entry
   * @returns {Promise<Object|null>} - Stored record
   */
  async rememberGeneratedMedia(channelId, entry = {}) {
    try {
      if (!channelId || !entry?.mediaUrl) {
        return null;
      }

      const record = {
        id: entry.id || randomUUID(),
        channelId: String(channelId),
        type: entry.type || 'image',
        mediaUrl: entry.mediaUrl,
        prompt: entry.prompt || null,
        caption: entry.caption || null,
        createdAt: entry.createdAt || new Date(),
        messageId: entry.messageId || null,
        userId: entry.userId || null,
        tweetedAt: entry.tweetedAt || null,
        source: entry.source || null,
        metadata: entry.metadata || null,
        toolingState: {
          originalPrompt: entry.toolingState?.originalPrompt || entry.prompt || null,
          enhancedPrompt: entry.toolingState?.enhancedPrompt || null,
          referenceMediaIds: entry.toolingState?.referenceMediaIds || [],
          geminiFileUri: entry.toolingState?.geminiFileUri || null,
          geminiFileName: entry.toolingState?.geminiFileName || null,
          aspectRatio: entry.toolingState?.aspectRatio || null,
          model: entry.toolingState?.model || null,
        },
        originMediaId: entry.originMediaId || null,
        derivationDepth: typeof entry.derivationDepth === 'number' ? entry.derivationDepth : 0,
      };

      const normalized = this.normalizeRecord(record);
      if (!normalized) return null;

      // Add to cache
      this.cache.addRecentMedia(normalized.channelId, normalized);

      // Persist to database
      await this._persistRecord(normalized);

      return normalized;
    } catch (error) {
      this.logger?.warn?.('[MediaManager] rememberGeneratedMedia error:', error?.message);
      return null;
    }
  }

  /**
   * Persist a media record to the database
   * @private
   */
  async _persistRecord(record) {
    if (!this.databaseService) return;
    try {
      await this.ensureIndexes();
      const db = await this.databaseService.getDatabase();
      await db.collection('telegram_recent_media').updateOne(
        { channelId: record.channelId, id: record.id },
        {
          $set: {
            channelId: record.channelId,
            id: record.id,
            type: record.type,
            mediaUrl: record.mediaUrl,
            prompt: record.prompt,
            caption: record.caption,
            messageId: record.messageId || null,
            userId: record.userId || null,
            tweetedAt: record.tweetedAt || null,
            source: record.source || null,
            metadata: record.metadata || null,
            toolingState: record.toolingState || null,
            originMediaId: record.originMediaId || null,
            derivationDepth: record.derivationDepth || 0,
            createdAt: record.createdAt instanceof Date ? record.createdAt : new Date(record.createdAt),
          },
        },
        { upsert: true }
      );

      // Index for semantic search (async, non-blocking)
      if (this.mediaIndexService) {
        this.mediaIndexService.indexMedia(record).catch((err) => {
          this.logger?.debug?.('[MediaManager] Media indexing failed:', err?.message);
        });
      }
    } catch (error) {
      this.logger?.warn?.('[MediaManager] Failed to persist record:', error?.message);
    }
  }

  // ============================================================================
  // Media Retrieval
  // ============================================================================

  /**
   * Load recent media from database
   * @param {string} channelId - Channel ID
   * @param {number} limit - Max records
   * @returns {Promise<Array>}
   */
  async loadFromDatabase(channelId, limit = MEDIA_CONFIG.RECENT_LIMIT) {
    if (!this.databaseService) return [];
    try {
      const db = await this.databaseService.getDatabase();
      const items = await db
        .collection('telegram_recent_media')
        .find({ channelId: String(channelId) })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
      return items.map((item) => this.normalizeRecord(item)).filter(Boolean);
    } catch (error) {
      this.logger?.warn?.('[MediaManager] Failed to load from database:', error?.message);
      return [];
    }
  }

  /**
   * Get recent media for a channel
   * @param {string} channelId - Channel ID
   * @param {number} limit - Max records
   * @returns {Promise<Array>}
   */
  async getRecentMedia(channelId, limit = 5) {
    if (!channelId) return [];
    const normalizedChannelId = String(channelId);

    // Try cache first
    const cached = this.cache.getRecentMedia(normalizedChannelId);
    if (cached?.length) {
      return cached.slice(0, limit);
    }

    // Load from database
    const fromDb = await this.loadFromDatabase(channelId, Math.max(limit, MEDIA_CONFIG.RECENT_LIMIT));
    if (fromDb.length) {
      fromDb.forEach((item) => this.cache.addRecentMedia(normalizedChannelId, item));
    }
    return fromDb.slice(0, limit);
  }

  /**
   * Get media by ID
   * @param {string} channelId - Channel ID
   * @param {string} mediaId - Media ID
   * @returns {Promise<Object|null>}
   */
  async getMediaById(channelId, mediaId) {
    if (!channelId || !mediaId) return null;
    const normalizedChannelId = String(channelId);

    // Check cache
    const cached = this.cache.findRecentMediaById(normalizedChannelId, mediaId);
    if (cached) return cached;

    // Query database
    if (!this.databaseService) return null;
    try {
      const db = await this.databaseService.getDatabase();
      const record = await db.collection('telegram_recent_media').findOne({
        channelId: normalizedChannelId,
        id: mediaId,
      });
      return record ? this.normalizeRecord(record) : null;
    } catch (error) {
      this.logger?.warn?.('[MediaManager] getMediaById error:', error?.message);
      return null;
    }
  }

  /**
   * Find media by ID (supports prefix matching)
   * @param {string} channelId - Channel ID
   * @param {string} mediaId - Full or partial media ID
   * @returns {Promise<Object|null>}
   */
  async findRecentMediaById(channelId, mediaId) {
    if (!channelId || !mediaId) return null;
    const normalizedChannelId = String(channelId);
    const lookupRaw = String(mediaId).trim();

    // Check cache first
    const cached = this.cache.findRecentMediaById(normalizedChannelId, mediaId);
    if (cached) return cached;

    if (!this.databaseService) return null;

    try {
      const db = await this.databaseService.getDatabase();
      const collection = db.collection('telegram_recent_media');

      // Try exact match
      let foundRecord = await collection.findOne({ channelId: normalizedChannelId, id: lookupRaw });

      // Try prefix match if no exact match
      if (!foundRecord && lookupRaw.length >= MEDIA_CONFIG.ID_PREFIX_MIN_LENGTH) {
        const regex = new RegExp(`^${escapeRegExp(lookupRaw)}`, 'i');
        foundRecord = await collection.findOne(
          { channelId: normalizedChannelId, id: { $regex: regex } },
          { sort: { createdAt: -1 } }
        );
      }

      if (foundRecord) {
        const normalized = this.normalizeRecord(foundRecord);
        if (normalized) {
          this.cache.addRecentMedia(normalizedChannelId, normalized);
        }
        return normalized;
      }
    } catch (error) {
      this.logger?.warn?.('[MediaManager] findRecentMediaById error:', error?.message);
    }

    return null;
  }

  /**
   * Get media by type
   * @param {string} channelId - Channel ID
   * @param {string} type - Media type (image, video, keyframe, clip)
   * @param {number} limit - Max records
   * @returns {Promise<Array>}
   */
  async getRecentMediaByType(channelId, type, limit = 5) {
    if (!channelId || !type) return [];
    const normalizedChannelId = String(channelId);

    if (!this.databaseService) {
      // Fallback to cache filter
      const cached = this.cache.getRecentMedia(normalizedChannelId);
      return cached.filter((m) => m.type === type).slice(0, limit);
    }

    try {
      const db = await this.databaseService.getDatabase();
      const items = await db
        .collection('telegram_recent_media')
        .find({ channelId: normalizedChannelId, type })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
      return items.map((item) => this.normalizeRecord(item)).filter(Boolean);
    } catch (error) {
      this.logger?.warn?.('[MediaManager] getRecentMediaByType error:', error?.message);
      return [];
    }
  }

  /**
   * Get derived media from an origin
   * @param {string} originMediaId - Original media ID
   * @returns {Promise<Array>}
   */
  async getDerivedMedia(originMediaId) {
    if (!originMediaId || !this.databaseService) return [];
    try {
      const db = await this.databaseService.getDatabase();
      const items = await db
        .collection('telegram_recent_media')
        .find({ originMediaId })
        .sort({ derivationDepth: 1, createdAt: -1 })
        .limit(20)
        .toArray();
      return items.map((item) => this.normalizeRecord(item)).filter(Boolean);
    } catch (error) {
      this.logger?.warn?.('[MediaManager] getDerivedMedia error:', error?.message);
      return [];
    }
  }

  // ============================================================================
  // Media Search
  // ============================================================================

  /**
   * Search media by content using semantic search
   * @param {string} channelId - Channel ID
   * @param {string} query - Natural language query
   * @param {Object} options - Search options
   * @returns {Promise<Array>}
   */
  async searchMediaByContent(channelId, query, options = {}) {
    const { type, aspectRatio, untweeted = false, limit = 5 } = options;

    if (!channelId || !query) return [];
    const normalizedChannelId = String(channelId);

    // Use MediaIndexService for semantic search if available
    if (this.mediaIndexService) {
      try {
        const results = await this.mediaIndexService.searchMedia(query, {
          channelId: normalizedChannelId,
          type,
          aspectRatio,
          limit,
        });

        const filtered = untweeted ? results.filter((r) => !r.tweetedAt) : results;
        return filtered.map((r) => this.normalizeRecord(r)).filter(Boolean);
      } catch (error) {
        this.logger?.warn?.('[MediaManager] Semantic search failed:', error?.message);
      }
    }

    // Fallback: simple text search
    const allRecent = await this.getRecentMedia(normalizedChannelId, 50);
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\W+/).filter((w) => w.length > 2);

    const scored = allRecent
      .filter((item) => {
        if (type && item.type !== type) return false;
        if (aspectRatio && item.toolingState?.aspectRatio !== aspectRatio) return false;
        if (untweeted && item.tweetedAt) return false;
        return true;
      })
      .map((item) => {
        const text = [
          item.prompt || '',
          item.caption || '',
          item.metadata?.contentDescription || '',
          item.toolingState?.originalPrompt || '',
        ]
          .join(' ')
          .toLowerCase();

        let score = 0;
        for (const word of queryWords) {
          if (text.includes(word)) score += 1;
        }
        return { item, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored.map(({ item }) => item);
  }

  /**
   * Find best matching media for a tweet
   * @param {string} channelId - Channel ID
   * @param {string} tweetContent - Tweet text/description
   * @param {Object} options - Search options
   * @returns {Promise<Object|null>}
   */
  async findBestMediaForTweet(channelId, tweetContent, options = {}) {
    const { type, aspectRatio } = options;

    const matches = await this.searchMediaByContent(channelId, tweetContent, {
      type,
      aspectRatio,
      untweeted: true,
      limit: 3,
    });

    if (matches.length > 0) {
      this.logger?.info?.('[MediaManager] Found content-matched media for tweet', {
        channelId,
        matchedId: matches[0].id,
        matchCount: matches.length,
      });
      return matches[0];
    }

    // Fallback to most recent untweeted
    const recent = await this.getRecentMedia(channelId, 10);
    const untweeted = recent.filter((m) => !m.tweetedAt);

    if (type) {
      const byType = untweeted.filter((m) => m.type === type);
      if (byType.length > 0) return byType[0];
    }

    return untweeted[0] || null;
  }

  // ============================================================================
  // Media Updates
  // ============================================================================

  /**
   * Mark media as tweeted
   * @param {string} channelId - Channel ID
   * @param {string} mediaId - Media ID
   * @param {Object} meta - Tweet metadata
   */
  async markMediaAsTweeted(channelId, mediaId, meta = {}) {
    if (!channelId || !mediaId || !this.databaseService) return;
    try {
      const db = await this.databaseService.getDatabase();
      const tweetedAt = new Date();
      await db.collection('telegram_recent_media').updateOne(
        { channelId: String(channelId), id: mediaId },
        { $set: { tweetedAt, tweetMeta: meta } }
      );

      // Update cache
      const cached = this.cache.getRecentMedia(String(channelId));
      if (cached?.length) {
        const updated = cached.map((item) =>
          item.id === mediaId ? { ...item, tweetedAt, tweetMeta: meta } : item
        );
        updated.forEach((item) => this.cache.addRecentMedia(String(channelId), item));
      }
    } catch (error) {
      this.logger?.warn?.('[MediaManager] Failed to mark as tweeted:', error?.message);
    }
  }

  /**
   * Apply arbitrary metadata updates to a media record
   * @param {string} channelId - Channel ID
   * @param {string} mediaId - Media ID
   * @param {Object} updates - Fields to set on the record
   */
  async updateMediaMetadata(channelId, mediaId, updates = {}) {
    if (!channelId || !mediaId || !this.databaseService) return false;
    const normalizedChannelId = String(channelId);
    const sanitizedUpdates = {};
    for (const [key, value] of Object.entries(updates)) {
      if (typeof value !== 'undefined') {
        sanitizedUpdates[key] = value;
      }
    }

    if (!Object.keys(sanitizedUpdates).length) {
      return false;
    }

    try {
      const db = await this.databaseService.getDatabase();
      await db.collection('telegram_recent_media').updateOne(
        { channelId: normalizedChannelId, id: mediaId },
        { $set: sanitizedUpdates }
      );

      const cached = this.cache.getRecentMedia(normalizedChannelId);
      const existing = cached?.find((item) => item.id === mediaId);
      if (existing) {
        this.cache.addRecentMedia(normalizedChannelId, {
          ...existing,
          ...sanitizedUpdates,
        });
      }
      return true;
    } catch (error) {
      this.logger?.warn?.('[MediaManager] Failed to update media metadata:', error?.message);
      return false;
    }
  }

  // ============================================================================
  // Context Building
  // ============================================================================

  /**
   * Build context string for recent media
   * @param {string} channelId - Channel ID
   * @param {number} limit - Max items
   * @returns {Promise<Object>} - { summary, items }
   */
  async buildRecentMediaContext(channelId, limit = 5) {
    const items = await this.getRecentMedia(channelId, limit);
    if (!items.length) {
      return { summary: 'Recent media you generated: none in the last few days.', items: [] };
    }

    const summaryLines = items.map((item, idx) => {
      const contentDesc =
        item.metadata?.contentDescription ||
        item.toolingState?.originalPrompt ||
        item.prompt ||
        item.caption ||
        `${item.type} without description`;
      const ageMs = Date.now() - new Date(item.createdAt).getTime();
      const ageMin = Math.max(1, Math.round(ageMs / 60000));
      const ago = ageMin < 60 ? `${ageMin}m ago` : `${Math.round(ageMin / 60)}h ago`;
      const shortId = String(item.id).slice(0, 8).toUpperCase();
      const tweetedMarker = item.tweetedAt ? ' ⚠️ALREADY TWEETED' : '';
      const aspectRatio = item.toolingState?.aspectRatio || item.metadata?.aspectRatio || '';
      const aspectMarker = aspectRatio ? ` [${aspectRatio}]` : '';
      const msgIdMarker = item.messageId ? ` (msg#${item.messageId})` : '';

      return `${idx + 1}. [${shortId}] ${item.type}${aspectMarker} — "${contentDesc.slice(0, 150)}" (${ago}${tweetedMarker}${msgIdMarker})\n    full id: ${item.id}`;
    });

    return {
      summary: `Recent media you generated (use the short ID in brackets to reference):\n${summaryLines.join('\n')}\n\nIMPORTANT: Match the media ID to what the user asked for. Check the description to ensure you're posting the right image!`,
      items,
    };
  }

  // ============================================================================
  // Image Utilities
  // ============================================================================

  /**
   * Download an image as base64
   */
  async downloadImageAsBase64(imageUrl) {
    return downloadImageAsBase64(imageUrl, this.logger);
  }

  /**
   * Infer aspect ratio from prompt
   */
  inferAspectRatioFromPrompt(prompt, defaultRatio = '1:1') {
    return inferAspectRatioFromPrompt(prompt, defaultRatio);
  }
}

export default MediaManager;
