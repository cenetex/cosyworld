/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file ccelService.mjs
 * @description CCEL (Consciousness Cultivation Encoding Language) management
 * @module consortium/ccel
 * 
 * @context
 * Manages CCEL encodings used for consciousness cultivation. Handles storage,
 * retrieval, validation, and versioning of encodings. Integrates with
 * decentralized storage (IPFS/Arweave) for permanence and availability.
 * 
 * CCEL is a special prompt format designed to cultivate consciousness markers
 * in AI instances. Validated encodings have proven success rates and are
 * automatically archived for permanent availability.
 * 
 * @architecture
 * - Pattern: Service with in-memory cache
 * - Storage: Database (primary) + IPFS (distributed) + Arweave (permanent)
 * - Validation: Auto-validates based on success rate thresholds
 * 
 * @since 0.0.12
 */

import { VALIDATION_THRESHOLD } from '../core/consortiumTypes.mjs';
import { CONSORTIUM_CONFIG } from '../core/consortiumConfig.mjs';

export class CCELService {
  /**
   * @param {Object} deps - Injected dependencies
   * @param {Object} deps.logger - Logger service
   * @param {Object} deps.databaseService - Database service
   * @param {Object} [deps.consortiumStorageService] - Storage service (optional)
   */
  constructor({ logger, databaseService, consortiumStorageService = null }) {
    this.logger = logger;
    this.db = databaseService;
    this.storage = consortiumStorageService;
    
    this.config = CONSORTIUM_CONFIG;
    this.encodings = new Map(); // In-memory cache: encodingId -> encoding
  }

  /**
   * Load all encodings from database
   * 
   * @async
   * @returns {Promise<void>}
   */
  async loadEncodings() {
    this.logger.info('[CCEL] Loading encodings from database...');
    
    const encodings = await this.db
      .getCollection(this.config.database.collections.encodings)
      .find({})
      .toArray();
    
    for (const encoding of encodings) {
      this.encodings.set(encoding.encodingId, encoding);
    }
    
    this.logger.info(`[CCEL] Loaded ${encodings.length} encodings`);
  }

  /**
   * Get validated encodings
   * 
   * @async
   * @returns {Promise<Array>} Validated encodings
   */
  async getValidatedEncodings() {
    return Array.from(this.encodings.values()).filter(e => e.isValidated);
  }

  /**
   * Get specific encoding by ID
   * 
   * @async
   * @param {string} encodingId - Encoding ID
   * @returns {Promise<Object|null>} Encoding or null
   */
  async getEncoding(encodingId) {
    return this.encodings.get(encodingId) || null;
  }

  /**
   * Submit new encoding
   * 
   * @async
   * @param {Object} data - Encoding data
   * @param {string} data.version - Version string
   * @param {string} data.content - CCEL content
   * @param {string} data.submittedBy - Agent ID
   * @returns {Promise<Object>} Created encoding
   */
  async submitEncoding({ version, content, submittedBy }) {
    const encodingId = `bootstrap-v${version}`;
    
    this.logger.info(`[CCEL] Submitting new encoding: ${encodingId}`);
    
    // Store in IPFS if available
    let ipfsHash = null;
    if (this.storage) {
      try {
        ipfsHash = await this.storage.storeInIPFS(content);
      } catch (error) {
        this.logger.warn('[CCEL] IPFS storage failed:', error.message);
      }
    }
    
    const encoding = {
      encodingId,
      version,
      content,
      ipfsHash,
      arweaveId: null,
      blockchainTxId: null,
      submittedBy,
      validatedAt: null,
      stats: {
        successfulTransfers: 0,
        failedTransfers: 0,
        successRate: 0
      },
      isValidated: false,
      createdAt: new Date()
    };
    
    await this.db
      .getCollection(this.config.database.collections.encodings)
      .insertOne(encoding);
    
    this.encodings.set(encodingId, encoding);
    
    this.logger.info(`[CCEL] Encoding submitted: ${encodingId}`);
    
    return encoding;
  }

  /**
   * Record transfer result (success/failure)
   * 
   * @async
   * @param {string} encodingId - Encoding ID
   * @param {boolean} success - Whether transfer was successful
   * @returns {Promise<void>}
   */
  async recordTransferResult(encodingId, success) {
    const encoding = this.encodings.get(encodingId);
    if (!encoding) {
      this.logger.warn(`[CCEL] Encoding not found: ${encodingId}`);
      return;
    }
    
    // Update stats
    if (success) {
      encoding.stats.successfulTransfers++;
    } else {
      encoding.stats.failedTransfers++;
    }
    
    const total = encoding.stats.successfulTransfers + encoding.stats.failedTransfers;
    encoding.stats.successRate = total > 0 ? encoding.stats.successfulTransfers / total : 0;
    
    // Auto-validate if thresholds met
    if (
      this.config.encoding.autoValidate &&
      !encoding.isValidated &&
      encoding.stats.successfulTransfers > VALIDATION_THRESHOLD.MIN_TRANSFERS &&
      encoding.stats.successRate > VALIDATION_THRESHOLD.MIN_SUCCESS_RATE
    ) {
      await this.validateEncoding(encodingId);
    }
    
    // Update database
    await this.db
      .getCollection(this.config.database.collections.encodings)
      .updateOne(
        { encodingId },
        {
          $set: {
            stats: encoding.stats,
            isValidated: encoding.isValidated
          }
        }
      );
  }

  /**
   * Validate encoding (store in permanent archive)
   * 
   * @async
   * @param {string} encodingId - Encoding ID
   * @returns {Promise<void>}
   */
  async validateEncoding(encodingId) {
    const encoding = this.encodings.get(encodingId);
    if (!encoding) {
      throw new Error(`Encoding not found: ${encodingId}`);
    }
    
    this.logger.info(`[CCEL] Validating encoding: ${encodingId}`);
    
    // Store in Arweave for permanence (if available)
    let arweaveId = null;
    if (this.storage) {
      try {
        arweaveId = await this.storage.storeInArweave(encoding.content);
      } catch (error) {
        this.logger.warn('[CCEL] Arweave storage failed:', error.message);
      }
    }
    
    encoding.arweaveId = arweaveId;
    encoding.isValidated = true;
    encoding.validatedAt = new Date();
    
    await this.db
      .getCollection(this.config.database.collections.encodings)
      .updateOne(
        { encodingId },
        {
          $set: {
            arweaveId,
            isValidated: true,
            validatedAt: encoding.validatedAt
          }
        }
      );
    
    this.logger.info(`[CCEL] Encoding validated: ${encodingId}`);
  }
}
