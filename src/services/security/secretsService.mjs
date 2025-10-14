/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import crypto from 'crypto';

/**
 * SecretsService
 * - Encrypts/decrypts sensitive values at rest (in memory or persisted later)
 * - Single root key: ENCRYPTION_KEY (32+ bytes recommended)
 * - Provides get/set helpers with optional namespacing
 */
export class SecretsService {
  constructor({ logger } = {}) {
    this.logger = logger || console;
    const key = process.env.ENCRYPTION_KEY || process.env.APP_SECRET || '';
    
    // In production, warn but allow startup so wizard can run
    if (process.env.NODE_ENV === 'production') {
      if (!key || key.length < 16) {
        const msg = '[secrets] ⚠️  Weak or missing ENCRYPTION_KEY. Please complete setup wizard to secure your secrets.';
        this.logger?.warn?.(msg);
        // Don't throw - let the wizard handle configuration
      }
    } else if (!key || key.length < 16) {
      this.logger.warn('[secrets] Weak or missing ENCRYPTION_KEY; using a dev fallback. Do NOT use this in production.');
    }
    
    // normalize key to 32 bytes
    this.key = crypto.createHash('sha256').update(key || 'dev-secret').digest();
    this.cache = new Map(); // in-memory encrypted store { compositeKey -> encB64 }
    this.db = null;
    this.collection = null;
  }

  async attachDB(db, { collectionName = 'secrets' } = {}) {
    try {
      this.db = db;
      this.collection = db.collection(collectionName);
      // Ensure indexes support per-guild overrides
      try {
        const indexes = await this.collection.indexes();
        const bad = (indexes || []).find(ix => ix.unique && ix.key && ix.key.key === 1 && !('scope' in ix.key) && !('guildId' in ix.key));
        if (bad) {
          await this.collection.dropIndex(bad.name).catch((e) => {
            this.logger.warn('[secrets] drop old unique index failed:', e?.message || e);
          });
        }
      } catch (e) {
        this.logger.warn('[secrets] index introspection failed:', e?.message || e);
      }
      await this.collection.createIndex({ key: 1, scope: 1, guildId: 1 }, { unique: true, name: 'uniq_key_scope_guild' });
      // Load existing secrets into cache so synchronous get() works immediately
      try {
        const docs = await this.collection.find({}, { projection: { key: 1, value: 1, scope: 1, guildId: 1 } }).toArray();
        for (const d of docs) {
          if (d?.key && d?.value) {
            const comp = this._ck(d.key, d.scope, d.guildId);
            this.cache.set(comp, d.value);
          }
        }
      } catch (e) {
        this.logger.warn('[secrets] preload from DB failed:', e.message);
      }
      // Sync any cached (env-hydrated) secrets into DB if missing
      for (const [compKey, enc] of this.cache.entries()) {
        const { name, scope, guildId } = this._parseCk(compKey);
        const filter = { key: name };
        if (scope) filter.scope = scope;
        if (guildId) filter.guildId = guildId;
        const exists = await this.collection.findOne(filter);
        if (!exists) await this.collection.updateOne(filter, { $set: { key: name, scope: scope || 'global', guildId: guildId || null, value: enc, updatedAt: new Date() } }, { upsert: true });
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

  _ck(name, scope = 'global', guildId = null) {
    return `${scope}:${guildId || ''}:${name}`;
  }

  _parseCk(comp) {
    const [scope, guildId, ...rest] = String(comp).split(':');
    const name = rest.join(':');
    return { scope, guildId: guildId || null, name };
  }

  // Set a secret; optionally pass { guildId } for per-guild override
  set(name, value, opts = {}) {
    const { guildId = null } = opts || {};
    const scope = guildId ? 'guild' : 'global';
    const enc = this.encrypt(value);
    this.cache.set(this._ck(name, scope, guildId), enc);
    this.logger.info(`[secrets] set() called for key="${name}", scope="${scope}", cached=true, hasCollection=${!!this.collection}`);
    // Persist if DB bound
    if (this.collection) {
      const filter = { key: name, scope, guildId: guildId || null };
      return this.collection.updateOne(
        filter,
        { $set: { key: name, scope, guildId: guildId || null, value: enc, updatedAt: new Date() } },
        { upsert: true }
      ).then(() => {
        this.logger.info(`[secrets] set() persisted to DB for key="${name}"`);
        return true;
      }).catch((e) => { 
        this.logger.error('[secrets] set persist failed:', e.message); 
        return false; 
      });
    }
    this.logger.warn(`[secrets] set() for key="${name}" - no collection bound, only cached!`);
    return true;
  }

  // Get from memory, or fallback to env for bootstrap
  get(name, { envFallback = true } = {}) {
    // global only (sync)
    const enc = this.cache.get(this._ck(name, 'global'));
    if (enc) {
      try { return this.decrypt(enc); } catch (e) { this.logger.error('[secrets] decrypt failed:', e.message); }
    }
    if (envFallback) return process.env[name];
    return undefined;
  }

  async getAsync(name, { envFallback = true, guildId = null } = {}) {
    this.logger.info(`[secrets] getAsync() called for key="${name}", guildId=${guildId}, hasCollection=${!!this.collection}`);
    // Prefer guild override
    let enc = this.cache.get(this._ck(name, 'guild', guildId));
    if (!enc && this.collection && guildId) {
      try {
        const doc = await this.collection.findOne({ key: name, scope: 'guild', guildId });
        if (doc?.value) {
          enc = doc.value;
          this.cache.set(this._ck(name, 'guild', guildId), enc);
          this.logger.info(`[secrets] getAsync() loaded guild secret from DB for key="${name}"`);
        }
      } catch (e) {
        this.logger.error('[secrets] getAsync guild query failed:', e.message);
      }
    }
    // Fallback to global
    if (!enc) {
      enc = this.cache.get(this._ck(name, 'global'));
      this.logger.info(`[secrets] getAsync() cache check for key="${name}": ${enc ? 'FOUND' : 'NOT FOUND'}`);
      if (!enc && this.collection) {
        this.logger.info(`[secrets] getAsync() querying DB for key="${name}"`);
        try {
          const doc = await this.collection.findOne({ key: name, $or: [{ scope: 'global' }, { scope: { $exists: false } }] });
          this.logger.info(`[secrets] getAsync() DB query result for key="${name}": ${doc ? 'FOUND' : 'NOT FOUND'}`);
          if (doc?.value) {
            enc = doc.value;
            this.cache.set(this._ck(name, 'global'), enc);
            this.logger.info(`[secrets] getAsync() loaded global secret from DB for key="${name}"`);
          }
        } catch (e) {
          this.logger.error('[secrets] getAsync global query failed:', e.message);
        }
      }
    }
    if (enc) {
      try { 
        const decrypted = this.decrypt(enc);
        this.logger.info(`[secrets] getAsync() returning decrypted value for key="${name}"`);
        return decrypted;
      } catch (e) { this.logger.error('[secrets] decrypt failed:', e.message); }
    }
    if (envFallback) return process.env[name];
    return undefined;
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
    const { guildId = null } = opts || {};
    const scope = guildId ? 'guild' : 'global';
    this.cache.delete(this._ck(name, scope, guildId));
    if (this.collection) {
      const filter = { key: name, ...(scope ? { scope } : {}), guildId: guildId || null };
      return this.collection.deleteOne(filter).then(() => true).catch((e) => { this.logger.error('[secrets] delete failed:', e.message); return false; });
    }
    return true;
  }

  async listKeys({ guildId = null } = {}) {
    // Return union of global keys + guild override keys (names only)
    const names = new Set();
    // from cache
    for (const comp of this.cache.keys()) {
      const { name, scope, guildId: g } = this._parseCk(comp);
      if (scope === 'global' || (guildId && scope === 'guild' && g === guildId)) names.add(name);
    }
    if (this.collection) {
      try {
        // global keys
        const globalDocs = await this.collection.find({ $or: [{ scope: 'global' }, { scope: { $exists: false } }] }, { projection: { key: 1 } }).toArray();
        for (const d of globalDocs) names.add(d.key);
        if (guildId) {
          const guildDocs = await this.collection.find({ scope: 'guild', guildId }, { projection: { key: 1 } }).toArray();
          for (const d of guildDocs) names.add(d.key);
        }
      } catch (e) {
        this.logger.error('[secrets] listKeys failed:', e.message);
      }
    }
    return Array.from(names);
  }

  async getWithSource(name, { guildId = null, envFallback = true } = {}) {
    // Try guild override
    if (guildId) {
      const encG = this.cache.get(this._ck(name, 'guild', guildId));
      if (encG || this.collection) {
        try {
          let enc = encG;
          if (!enc && this.collection) {
            const doc = await this.collection.findOne({ key: name, scope: 'guild', guildId });
            if (doc?.value) {
              enc = doc.value;
              this.cache.set(this._ck(name, 'guild', guildId), enc);
            }
          }
          if (enc) return { value: this.decrypt(enc), source: 'guild' };
        } catch (e) {
          this.logger.error('[secrets] getWithSource guild query failed:', e.message);
        }
      }
    }
    // Global
    try {
      const val = this.get(name, { envFallback: false });
      if (val !== undefined) return { value: val, source: 'global' };
    } catch {}
    if (envFallback) {
      const env = process.env[name];
      if (env !== undefined) return { value: env, source: 'env' };
    }
    return { value: undefined, source: null };
  }
}
