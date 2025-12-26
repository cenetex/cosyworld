/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

import crypto from 'crypto';

/**
 * SecretsService
 * - Encrypts/decrypts sensitive values at rest (in memory or persisted later)
 * - Single root key: ENCRYPTION_KEY (32+ bytes recommended)
 * - Provides get/set helpers with optional namespacing
 * - Supports scoped secrets: global, bot, guild, and avatar scopes
 * 
 * Scope hierarchy (most specific to least):
 * 1. avatar - Per-avatar secrets (e.g., individual X account tokens)
 * 2. bot - Per-bot instance secrets (e.g., Discord bot token for "ProductionBot")
 * 3. guild - Per-Discord-guild overrides
 * 4. global - Shared across all bots (e.g., AI API keys)
 * 
 * @example
 * // Set a bot-scoped secret
 * await secretsService.set('DISCORD_BOT_TOKEN', 'xoxb-...', { botId: 'bot_abc123' });
 * 
 * // Get with fallback resolution
 * const token = await secretsService.getAsync('DISCORD_BOT_TOKEN', { botId: 'bot_abc123' });
 * // Will check: bot scope -> global scope
 */
export class SecretsService {
  /** @type {Set<string>} Valid scope types */
  static VALID_SCOPES = new Set(['global', 'bot', 'guild', 'avatar']);

  /** @type {Set<string>} Platform categories for organizing secrets */
  static PLATFORMS = new Set(['discord', 'x', 'telegram', 'ai', 'infrastructure', 'other']);

  constructor({ logger } = {}) {
    this.logger = logger || console;
    const key = process.env.ENCRYPTION_KEY || process.env.APP_SECRET || '';
    
    // In production, enforce strong encryption keys (32+ bytes)
    if (process.env.NODE_ENV === 'production') {
      if (!key || key.length < 32) {
        const msg = '[secrets] 🔒 FATAL: ENCRYPTION_KEY must be at least 32 bytes in production. ' +
          'Generate a strong key with: openssl rand -base64 32';
        this.logger?.error?.(msg);
        throw new Error('ENCRYPTION_KEY too weak for production use. Minimum 32 bytes required.');
      }
      this.logger.info('[secrets] ✓ Strong encryption key detected (32+ bytes)');
    } else if (!key || key.length < 16) {
      this.logger.warn('[secrets] Weak or missing ENCRYPTION_KEY; using a dev fallback. Do NOT use this in production.');
    }
    
    // Normalize key to 32 bytes (uses SHA-256 for consistency)
    this.key = crypto.createHash('sha256').update(key || 'dev-secret').digest();
    this.cache = new Map(); // in-memory encrypted store { compositeKey -> encB64 }
    this.db = null;
    this.collection = null;
  }

  async attachDB(db, { collectionName = 'secrets' } = {}) {
    try {
      this.db = db;
      this.collection = db.collection(collectionName);
      // Ensure indexes support scoped secrets (bot, guild, avatar)
      try {
        const indexes = await this.collection.indexes();
        // Drop old incompatible unique indexes
        const bad = (indexes || []).find(ix => 
          ix.unique && ix.key && ix.key.key === 1 && 
          !('scope' in ix.key) && !('scopeId' in ix.key) && !('guildId' in ix.key)
        );
        if (bad) {
          await this.collection.dropIndex(bad.name).catch((e) => {
            this.logger.warn('[secrets] drop old unique index failed:', e?.message || e);
          });
        }
      } catch (e) {
        this.logger.warn('[secrets] index introspection failed:', e?.message || e);
      }
      // New compound unique index supporting all scope types
      await this.collection.createIndex(
        { key: 1, scope: 1, scopeId: 1 }, 
        { unique: true, name: 'uniq_key_scope_scopeId' }
      );
      // Index for platform-based queries
      await this.collection.createIndex({ platform: 1 }, { name: 'idx_platform' });
      // Index for listing by scope
      await this.collection.createIndex({ scope: 1, scopeId: 1 }, { name: 'idx_scope' });

      // Load existing secrets into cache so synchronous get() works immediately
      try {
        const docs = await this.collection.find({}, { projection: { key: 1, value: 1, scope: 1, scopeId: 1, guildId: 1 } }).toArray();
        for (const d of docs) {
          if (d?.key && d?.value) {
            // Support both old (guildId) and new (scopeId) formats
            const scopeId = d.scopeId || d.guildId || null;
            const comp = this._ck(d.key, d.scope || 'global', scopeId);
            this.cache.set(comp, d.value);
          }
        }
        this.logger.info(`[secrets] Loaded ${docs.length} secrets into cache`);
      } catch (e) {
        this.logger.warn('[secrets] preload from DB failed:', e.message);
      }
      // Sync any cached (env-hydrated) secrets into DB if missing
      for (const [compKey, enc] of this.cache.entries()) {
        const { name, scope, scopeId } = this._parseCk(compKey);
        const filter = { key: name, scope: scope || 'global', scopeId: scopeId || null };
        const exists = await this.collection.findOne(filter);
        if (!exists) {
          await this.collection.updateOne(
            filter, 
            { $set: { key: name, scope: scope || 'global', scopeId: scopeId || null, value: enc, updatedAt: new Date() } }, 
            { upsert: true }
          );
        }
      }
    } catch (e) {
      this.logger.error('[secrets] attachDB failed:', e?.stack || e?.message || e);
    }
  }

  encrypt(plain) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    // Stringify objects/arrays, convert primitives to string
    const stringValue = typeof plain === 'object' ? JSON.stringify(plain) : String(plain);
    const enc = Buffer.concat([cipher.update(stringValue, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64'); // [IV(12)|TAG(16)|DATA]
  }

  decrypt(b64) {
    const buf = Buffer.from(b64, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    // Try to parse as JSON, otherwise return as string
    try {
      return JSON.parse(dec);
    } catch {
      return dec;
    }
  }

  _ck(name, scope = 'global', scopeId = null) {
    return `${scope}:${scopeId || ''}:${name}`;
  }

  _parseCk(comp) {
    const [scope, scopeId, ...rest] = String(comp).split(':');
    const name = rest.join(':');
    return { scope, scopeId: scopeId || null, name };
  }

  /**
   * Determine the scope and scopeId from options
   * Supports legacy guildId parameter for backward compatibility
   * @private
   */
  _resolveScope(opts = {}) {
    const { guildId, botId, avatarId, scope: explicitScope } = opts;
    
    // Priority: explicit scope > avatarId > botId > guildId > global
    if (avatarId) return { scope: 'avatar', scopeId: avatarId };
    if (botId) return { scope: 'bot', scopeId: botId };
    if (guildId) return { scope: 'guild', scopeId: guildId };
    if (explicitScope && explicitScope !== 'global') {
      return { scope: explicitScope, scopeId: opts.scopeId || null };
    }
    return { scope: 'global', scopeId: null };
  }

  // Set a secret; supports botId, avatarId, or guildId for scoped secrets
  set(name, value, opts = {}) {
    const { scope, scopeId } = this._resolveScope(opts);
    const { platform } = opts;
    const enc = this.encrypt(value);
    this.cache.set(this._ck(name, scope, scopeId), enc);
    this.logger.info(`[secrets] set() called for key="${name}", scope="${scope}", scopeId="${scopeId || 'null'}", cached=true`);
    
    // Persist if DB bound
    if (this.collection) {
      const filter = { key: name, scope, scopeId: scopeId || null };
      const update = { 
        key: name, 
        scope, 
        scopeId: scopeId || null, 
        value: enc, 
        updatedAt: new Date(),
        // Only set platform if provided
        ...(platform ? { platform } : {}),
      };
      return this.collection.updateOne(
        filter,
        { $set: update },
        { upsert: true }
      ).then(() => {
        this.logger.info(`[secrets] set() persisted to DB for key="${name}"`);
        return true;
      }).catch((e) => { 
        this.logger.error('[secrets] set persist failed:', e.message); 
        return false; 
      });
    }
    this.logger.debug?.(`[secrets] set() for key="${name}" - no collection bound, only cached`);
    return true;
  }

  // Get from memory, or fallback to env for bootstrap (sync, global only)
  get(name, { envFallback = true } = {}) {
    // global only (sync)
    const enc = this.cache.get(this._ck(name, 'global'));
    if (enc) {
      try { return this.decrypt(enc); } catch (e) { this.logger.error('[secrets] decrypt failed:', e.message); }
    }
    if (envFallback) return process.env[name];
    return undefined;
  }

  /**
   * Get a secret asynchronously with scope resolution
   * Resolution order: avatar -> bot -> guild -> global -> env (if allowed)
   */
  async getAsync(name, opts = {}) {
    const { envFallback = true, guildId, botId, avatarId } = opts;
    
    this.logger.debug?.(`[secrets] getAsync() for key="${name}", botId=${botId}, avatarId=${avatarId}, guildId=${guildId}`);
    
    // Try each scope in order of specificity
    const scopes = [];
    if (avatarId) scopes.push({ scope: 'avatar', scopeId: avatarId });
    if (botId) scopes.push({ scope: 'bot', scopeId: botId });
    if (guildId) scopes.push({ scope: 'guild', scopeId: guildId });
    scopes.push({ scope: 'global', scopeId: null });
    
    for (const { scope, scopeId } of scopes) {
      const enc = await this._getFromScope(name, scope, scopeId);
      if (enc) {
        try { 
          const decrypted = this.decrypt(enc);
          this.logger.debug?.(`[secrets] getAsync() returning value from scope="${scope}" for key="${name}"`);
          return decrypted;
        } catch (e) { 
          this.logger.error('[secrets] decrypt failed:', e.message); 
        }
      }
    }
    
    if (envFallback) return process.env[name];
    return undefined;
  }

  /**
   * Get encrypted value from a specific scope
   * @private
   */
  async _getFromScope(name, scope, scopeId) {
    // Check cache first
    const cacheKey = this._ck(name, scope, scopeId);
    let enc = this.cache.get(cacheKey);
    
    if (!enc && this.collection) {
      try {
        const filter = { key: name, scope };
        if (scopeId) {
          filter.scopeId = scopeId;
        } else {
          filter.$or = [{ scopeId: null }, { scopeId: { $exists: false } }];
        }
        const doc = await this.collection.findOne(filter);
        if (doc?.value) {
          enc = doc.value;
          this.cache.set(cacheKey, enc);
        }
      } catch (e) {
        this.logger.error(`[secrets] _getFromScope query failed for scope=${scope}:`, e.message);
      }
    }
    
    return enc;
  }

  // Bulk load common secrets from env into encrypted cache for unified access
  hydrateFromEnv(keys = []) {
    for (const k of keys) {
      const v = process.env[k];
      if (v) this.set(k, v);
    }
    return true;
  }

  delete(name, opts = {}) {
    const { scope, scopeId } = this._resolveScope(opts);
    this.cache.delete(this._ck(name, scope, scopeId));
    if (this.collection) {
      const filter = { key: name, scope, scopeId: scopeId || null };
      return this.collection.deleteOne(filter).then(() => true).catch((e) => { 
        this.logger.error('[secrets] delete failed:', e.message); 
        return false; 
      });
    }
    return true;
  }

  /**
   * List secret keys with optional filtering
   * @param {Object} opts - Filter options
   * @param {string} [opts.guildId] - Filter by guild
   * @param {string} [opts.botId] - Filter by bot
   * @param {string} [opts.avatarId] - Filter by avatar
   * @param {string} [opts.platform] - Filter by platform (discord, x, telegram, ai, infrastructure)
   * @param {boolean} [opts.includeGlobal=true] - Include global secrets in results
   * @returns {Promise<Array<{key: string, scope: string, scopeId: string|null, platform: string|null}>>}
   */
  async listKeys(opts = {}) {
    const { guildId, botId, avatarId, platform, includeGlobal = true } = opts;
    const results = [];
    const seen = new Set();

    // Helper to add unique results
    const addResult = (key, scope, scopeId, plat) => {
      const id = `${scope}:${scopeId}:${key}`;
      if (!seen.has(id)) {
        seen.add(id);
        results.push({ key, scope, scopeId, platform: plat });
      }
    };

    // From cache
    for (const comp of this.cache.keys()) {
      const { name, scope, scopeId } = this._parseCk(comp);
      if (scope === 'global' && includeGlobal) {
        addResult(name, scope, scopeId, null);
      }
      if (avatarId && scope === 'avatar' && scopeId === avatarId) {
        addResult(name, scope, scopeId, null);
      }
      if (botId && scope === 'bot' && scopeId === botId) {
        addResult(name, scope, scopeId, null);
      }
      if (guildId && scope === 'guild' && scopeId === guildId) {
        addResult(name, scope, scopeId, null);
      }
    }

    // From database
    if (this.collection) {
      try {
        const query = { $or: [] };
        
        if (includeGlobal) {
          query.$or.push({ scope: 'global' });
          query.$or.push({ scope: { $exists: false } });
        }
        if (avatarId) query.$or.push({ scope: 'avatar', scopeId: avatarId });
        if (botId) query.$or.push({ scope: 'bot', scopeId: botId });
        if (guildId) query.$or.push({ scope: 'guild', scopeId: guildId });
        
        if (platform) {
          query.platform = platform;
        }
        
        if (query.$or.length === 0) {
          query.$or.push({ scope: 'global' });
        }

        const docs = await this.collection.find(query, { 
          projection: { key: 1, scope: 1, scopeId: 1, platform: 1 } 
        }).toArray();
        
        for (const d of docs) {
          addResult(d.key, d.scope || 'global', d.scopeId || null, d.platform || null);
        }
      } catch (e) {
        this.logger.error('[secrets] listKeys failed:', e.message);
      }
    }

    return results;
  }

  /**
   * Get a secret with source information
   * Useful for debugging where a secret value comes from
   */
  async getWithSource(name, opts = {}) {
    const { guildId, botId, avatarId, envFallback = true } = opts;

    // Try each scope in order
    const scopes = [];
    if (avatarId) scopes.push({ scope: 'avatar', scopeId: avatarId });
    if (botId) scopes.push({ scope: 'bot', scopeId: botId });
    if (guildId) scopes.push({ scope: 'guild', scopeId: guildId });
    scopes.push({ scope: 'global', scopeId: null });

    for (const { scope, scopeId } of scopes) {
      const enc = await this._getFromScope(name, scope, scopeId);
      if (enc) {
        try {
          return { value: this.decrypt(enc), source: scope, scopeId };
        } catch (e) {
          this.logger.error('[secrets] getWithSource decrypt failed:', e.message);
        }
      }
    }

    if (envFallback) {
      const env = process.env[name];
      if (env !== undefined) return { value: env, source: 'env', scopeId: null };
    }
    
    return { value: undefined, source: null, scopeId: null };
  }

  /**
   * List all secrets for a specific scope (for admin UI)
   * Returns metadata without decrypting values
   */
  async listSecretsForScope(scope, scopeId = null) {
    if (!this.collection) return [];

    const query = { scope };
    if (scopeId) {
      query.scopeId = scopeId;
    } else {
      query.$or = [{ scopeId: null }, { scopeId: { $exists: false } }];
    }

    const docs = await this.collection.find(query, {
      projection: { key: 1, scope: 1, scopeId: 1, platform: 1, updatedAt: 1 }
    }).toArray();

    return docs.map(d => ({
      key: d.key,
      scope: d.scope,
      scopeId: d.scopeId,
      platform: d.platform,
      updatedAt: d.updatedAt,
      hasValue: true, // Value exists but not returned for security
    }));
  }

  /**
   * Get a masked version of a secret value (for display)
   * Shows first 4 and last 4 characters if long enough
   */
  async getMaskedValue(name, opts = {}) {
    const value = await this.getAsync(name, { ...opts, envFallback: false });
    if (!value) return null;
    
    const str = String(value);
    if (str.length <= 8) return '••••••••';
    return `${str.slice(0, 4)}••••••••${str.slice(-4)}`;
  }

  /**
   * Rotate encryption key - re-encrypt all secrets with a new key
   * @param {string} newKey - New encryption key (must be 32+ bytes in production)
   * @returns {Promise<{success: boolean, reencrypted: number, errors: number}>}
   * @example
   * const stats = await secretsService.rotateKey(process.env.NEW_ENCRYPTION_KEY);
   * console.log(`Re-encrypted ${stats.reencrypted} secrets`);
   */
  async rotateKey(newKey) {
    if (!newKey || newKey.length < 32) {
      throw new Error('New encryption key must be at least 32 bytes');
    }

    this.logger.info('[secrets] 🔄 Starting key rotation...');
    const stats = { success: true, reencrypted: 0, errors: 0 };
    const decrypted = new Map(); // Store decrypted values temporarily

    try {
      // Step 1: Decrypt all secrets with old key
      for (const [compositeKey, encryptedValue] of this.cache.entries()) {
        try {
          const plainValue = this.decrypt(encryptedValue);
          decrypted.set(compositeKey, plainValue);
        } catch (error) {
          this.logger.error(`[secrets] Failed to decrypt ${compositeKey}:`, error.message);
          stats.errors++;
        }
      }

      // Step 2: Update to new key
      const oldKey = this.key;
      this.key = crypto.createHash('sha256').update(newKey).digest();

      // Step 3: Re-encrypt all secrets with new key
      for (const [compositeKey, plainValue] of decrypted.entries()) {
        try {
          const newEncrypted = this.encrypt(plainValue);
          this.cache.set(compositeKey, newEncrypted);

          // Update in database if attached
          if (this.collection) {
            const { name, scope, guildId } = this._parseCk(compositeKey);
            const filter = { key: name, scope: scope || 'global', guildId: guildId || null };
            await this.collection.updateOne(
              filter,
              { $set: { value: newEncrypted, updatedAt: new Date() } }
            );
          }

          stats.reencrypted++;
        } catch (error) {
          this.logger.error(`[secrets] Failed to re-encrypt ${compositeKey}:`, error.message);
          stats.errors++;
          // Rollback to old key on any error
          this.key = oldKey;
          stats.success = false;
          throw new Error(`Key rotation failed: ${error.message}`);
        }
      }

      this.logger.info(`[secrets] ✓ Key rotation complete: ${stats.reencrypted} secrets re-encrypted`);
      return stats;
    } catch (error) {
      this.logger.error('[secrets] Key rotation failed:', error.message);
      throw error;
    }
  }
}

