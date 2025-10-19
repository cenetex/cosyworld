/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import crypto from 'crypto';
import eventBus from '../../utils/eventBus.mjs';

/**
 * BackgroundImageAnalyzer - Processes image descriptions asynchronously
 * Uses URL hashing to avoid duplicate analysis
 */
export class BackgroundImageAnalyzer {
  constructor({ databaseService, aiService, logger }) {
    this.databaseService = databaseService;
    this.aiService = aiService;
    this.logger = logger;
    this.db = null;
    this.processingQueue = new Set(); // Track URLs currently being processed
    this.init();
  }

  async init() {
    // Listen for new messages with images
    eventBus.on('MESSAGE.CREATED', (data) => this.onMessageCreated(data));
    
    // Initialize DB connection
    try {
      this.db = await this.databaseService.getDatabase();
      await this.ensureIndexes();
    } catch (err) {
      this.logger.error(`[BackgroundImageAnalyzer] DB init failed: ${err.message}`);
    }
  }

  async ensureIndexes() {
    if (!this.db) return;
    try {
      await this.db.collection('image_analysis_cache').createIndexes([
        { key: { urlHash: 1 }, unique: true, background: true },
        { key: { url: 1 }, background: true },
        { key: { analyzedAt: -1 }, background: true },
        { key: { status: 1 }, background: true },
      ]);
      this.logger.info('[BackgroundImageAnalyzer] Indexes created');
    } catch (err) {
      this.logger.warn(`[BackgroundImageAnalyzer] Index creation warning: ${err.message}`);
    }
  }

  /**
   * Hash a URL to create a unique identifier
   */
  hashUrl(url) {
    return crypto.createHash('sha256').update(url).digest('hex');
  }

  /**
   * Check if an image has already been analyzed
   */
  async isAnalyzed(url) {
    if (!this.db) return false;
    try {
      const urlHash = this.hashUrl(url);
      const cached = await this.db.collection('image_analysis_cache').findOne(
        { urlHash, status: 'completed' },
        { projection: { _id: 1 } }
      );
      return !!cached;
    } catch (err) {
      this.logger.warn(`[BackgroundImageAnalyzer] isAnalyzed check failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Get cached analysis for a URL
   */
  async getCachedAnalysis(url) {
    if (!this.db) return null;
    try {
      const urlHash = this.hashUrl(url);
      const cached = await this.db.collection('image_analysis_cache').findOne(
        { urlHash, status: 'completed' }
      );
      return cached?.description || null;
    } catch (err) {
      this.logger.warn(`[BackgroundImageAnalyzer] getCachedAnalysis failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Analyze an image and cache the result
   */
  async analyzeAndCache(url, messageId = null) {
    const urlHash = this.hashUrl(url);
    
    // Prevent duplicate processing
    if (this.processingQueue.has(urlHash)) {
      this.logger.debug(`[BackgroundImageAnalyzer] Already processing ${urlHash.slice(0, 8)}...`);
      return null;
    }

    // Check if already analyzed
    if (await this.isAnalyzed(url)) {
      this.logger.debug(`[BackgroundImageAnalyzer] Already cached ${urlHash.slice(0, 8)}...`);
      return await this.getCachedAnalysis(url);
    }

    this.processingQueue.add(urlHash);

    try {
      if (!this.db) {
        this.db = await this.databaseService.getDatabase();
      }

      // Mark as processing
      await this.db.collection('image_analysis_cache').updateOne(
        { urlHash },
        {
          $set: {
            url,
            status: 'processing',
            startedAt: new Date(),
            messageId,
          },
          $setOnInsert: {
            createdAt: new Date(),
          }
        },
        { upsert: true }
      );

      // Perform AI analysis
      let description = null;
      if (this.aiService?.analyzeImage) {
        try {
          const result = await this.aiService.analyzeImage(
            url,
            undefined,
            'Write a concise, neutral caption (<=120 chars).'
          );
          description = result && String(result).trim() ? String(result).trim() : null;
        } catch (aiErr) {
          this.logger.warn(`[BackgroundImageAnalyzer] AI analysis failed: ${aiErr.message}`);
        }
      }

      // Update cache with result
      await this.db.collection('image_analysis_cache').updateOne(
        { urlHash },
        {
          $set: {
            description,
            status: 'completed',
            analyzedAt: new Date(),
            error: null,
          }
        }
      );

      // Update the message if we have a messageId
      if (messageId && description) {
        await this.updateMessageDescription(messageId, url, description);
      }

      this.logger.info(`[BackgroundImageAnalyzer] Analyzed ${urlHash.slice(0, 8)}... - ${description ? 'success' : 'no description'}`);
      
      return description;
    } catch (err) {
      // Mark as failed
      try {
        await this.db.collection('image_analysis_cache').updateOne(
          { urlHash },
          {
            $set: {
              status: 'failed',
              error: err.message,
              failedAt: new Date(),
            }
          }
        );
      } catch {}

      this.logger.error(`[BackgroundImageAnalyzer] Failed to analyze ${urlHash.slice(0, 8)}...: ${err.message}`);
      return null;
    } finally {
      this.processingQueue.delete(urlHash);
    }
  }

  /**
   * Update message with image description
   */
  async updateMessageDescription(messageId, imageUrl, description) {
    if (!this.db || !messageId || !description) return;

    try {
      const result = await this.db.collection('messages').updateOne(
        { messageId, primaryImageUrl: imageUrl },
        {
          $set: {
            imageDescription: description,
            imageDescriptionUpdatedAt: new Date(),
          }
        }
      );

      if (result.modifiedCount > 0) {
        this.logger.debug(`[BackgroundImageAnalyzer] Updated message ${messageId} with description`);
      }
    } catch (err) {
      this.logger.warn(`[BackgroundImageAnalyzer] Failed to update message ${messageId}: ${err.message}`);
    }
  }

  /**
   * Handle new messages with images
   */
  async onMessageCreated(data) {
    try {
      const { message } = data;
      if (!message?.primaryImageUrl) return;

      // Queue analysis in background (don't await)
      this.analyzeAndCache(message.primaryImageUrl, message.messageId).catch(err => {
        this.logger.warn(`[BackgroundImageAnalyzer] Background analysis failed: ${err.message}`);
      });

      // Process additional images if present
      if (Array.isArray(message.imageUrls) && message.imageUrls.length > 1) {
        for (const url of message.imageUrls.slice(1)) {
          if (url && url !== message.primaryImageUrl) {
            this.analyzeAndCache(url, null).catch(err => {
              this.logger.warn(`[BackgroundImageAnalyzer] Background analysis failed: ${err.message}`);
            });
          }
        }
      }
    } catch (err) {
      this.logger.warn(`[BackgroundImageAnalyzer] onMessageCreated handler failed: ${err.message}`);
    }
  }

  /**
   * Batch process messages with unanalyzed images
   * Can be called periodically or manually to backfill
   */
  async backfillImageDescriptions(limit = 100) {
    if (!this.db) {
      this.db = await this.databaseService.getDatabase();
    }

    try {
      const messages = await this.db.collection('messages')
        .find({
          hasImages: true,
          primaryImageUrl: { $exists: true, $ne: null },
          imageDescription: { $in: [null, ''] }
        })
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();

      this.logger.info(`[BackgroundImageAnalyzer] Backfilling ${messages.length} messages`);

      // Process in batches of 5 to avoid overwhelming the AI service
      const batchSize = 5;
      for (let i = 0; i < messages.length; i += batchSize) {
        const batch = messages.slice(i, i + batchSize);
        await Promise.all(
          batch.map(msg => 
            this.analyzeAndCache(msg.primaryImageUrl, msg.messageId)
              .catch(err => this.logger.warn(`Backfill failed for ${msg.messageId}: ${err.message}`))
          )
        );
        
        // Small delay between batches
        if (i + batchSize < messages.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      this.logger.info(`[BackgroundImageAnalyzer] Backfill complete`);
    } catch (err) {
      this.logger.error(`[BackgroundImageAnalyzer] Backfill failed: ${err.message}`);
    }
  }

  /**
   * Get stats about image analysis cache
   */
  async getStats() {
    if (!this.db) return null;

    try {
      const stats = await this.db.collection('image_analysis_cache').aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]).toArray();

      const result = {
        total: 0,
        completed: 0,
        processing: 0,
        failed: 0,
        queueSize: this.processingQueue.size,
      };

      for (const stat of stats) {
        result[stat._id] = stat.count;
        result.total += stat.count;
      }

      return result;
    } catch (err) {
      this.logger.error(`[BackgroundImageAnalyzer] getStats failed: ${err.message}`);
      return null;
    }
  }
}
