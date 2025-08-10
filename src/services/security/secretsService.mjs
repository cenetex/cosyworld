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
    if (!key || key.length < 16) {
      this.logger.warn('[secrets] Weak or missing ENCRYPTION_KEY; use a strong 32+ char key in production');
    }
    // normalize key to 32 bytes
    this.key = crypto.createHash('sha256').update(key || 'dev-secret').digest();
  this.cache = new Map(); // in-memory encrypted store { name -> encB64 }
    this.db = null;
    this.collection = null;
  }

  async attachDB(db, { collectionName = 'secrets' } = {}) {
    try {
      this.db = db;
      this.collection = db.collection(collectionName);
      // optional index
      await this.collection.createIndex({ key: 1 }, { unique: true });
      // Load existing secrets into cache so synchronous get() works immediately
      try {
        const docs = await this.collection.find({}, { projection: { key: 1, value: 1 } }).toArray();
        for (const d of docs) {
          if (d?.key && d?.value) this.cache.set(d.key, d.value);
        }
      } catch (e) {
        this.logger.warn('[secrets] preload from DB failed:', e.message);
      }
      // Sync any cached (env-hydrated) secrets into DB if missing
      for (const [key, enc] of this.cache.entries()) {
        const exists = await this.collection.findOne({ key });
        if (!exists) await this.collection.updateOne({ key }, { $set: { key, value: enc, updatedAt: new Date() } }, { upsert: true });
      }
    } catch (e) {
      this.logger.error('[secrets] attachDB failed:', e.message);
    }
  }

  encrypt(plain) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
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
    return dec;
  }

  // Set a secret; optionally pass { persist: false } for memory-only for now
  set(name, value, opts = {}) {
    const enc = this.encrypt(value);
    this.cache.set(name, enc);
    // Persist if DB bound
    if (this.collection) {
      return this.collection.updateOne(
        { key: name },
        { $set: { key: name, value: enc, updatedAt: new Date() } },
        { upsert: true }
      ).then(() => true).catch((e) => { this.logger.error('[secrets] set persist failed:', e.message); return false; });
    }
    return true;
  }

  // Get from memory, or fallback to env for bootstrap
  get(name, { envFallback = true } = {}) {
    const enc = this.cache.get(name);
    if (enc) {
      try { return this.decrypt(enc); } catch (e) { this.logger.error('[secrets] decrypt failed:', e.message); }
    }
    if (envFallback) return process.env[name];
    return undefined;
  }

  async getAsync(name, { envFallback = true } = {}) {
    let enc = this.cache.get(name);
    if (!enc && this.collection) {
      try {
        const doc = await this.collection.findOne({ key: name });
        if (doc?.value) {
          enc = doc.value;
          this.cache.set(name, enc);
        }
      } catch (e) {
        this.logger.error('[secrets] getAsync query failed:', e.message);
      }
    }
    if (enc) {
      try { return this.decrypt(enc); } catch (e) { this.logger.error('[secrets] decrypt failed:', e.message); }
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

  delete(name) {
    this.cache.delete(name);
    if (this.collection) {
      return this.collection.deleteOne({ key: name }).then(() => true).catch((e) => { this.logger.error('[secrets] delete failed:', e.message); return false; });
    }
    return true;
  }

  async listKeys() {
    // Return union of cache + DB keys
    const keys = new Set([...this.cache.keys()]);
    if (this.collection) {
      try {
        const cursor = this.collection.find({}, { projection: { key: 1 } });
        const docs = await cursor.toArray();
        for (const d of docs) keys.add(d.key);
      } catch (e) {
        this.logger.error('[secrets] listKeys failed:', e.message);
      }
    }
    return Array.from(keys);
  }
}
