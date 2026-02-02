/**
 * Simple TTL + max-size map.
 *
 * API intentionally mirrors the subset of Map used in this repo (get/set/delete/has).
 */
export class TTLMap {
  constructor({ ttlMs = 5 * 60 * 1000, maxSize = 5000, cleanupIntervalMs = 60 * 1000 } = {}) {
    this.ttlMs = Number(ttlMs) || 0;
    this.maxSize = Number(maxSize) || 0;
    this._map = new Map();

    this._cleanupTimer = null;
    if (cleanupIntervalMs && cleanupIntervalMs > 0) {
      this._cleanupTimer = setInterval(() => {
        try {
          this._purgeExpired();
          this._enforceMaxSize();
        } catch {
          // ignore
        }
      }, cleanupIntervalMs);
      // Prevent keeping the process alive just for cleanup.
      this._cleanupTimer.unref?.();
    }
  }

  shutdown() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
  }

  _now() {
    return Date.now();
  }

  _purgeExpired() {
    if (!this.ttlMs || this.ttlMs <= 0) return;
    const now = this._now();

    for (const [key, entry] of this._map.entries()) {
      if (!entry || entry.expiresAt == null) {
        this._map.delete(key);
        continue;
      }
      if (entry.expiresAt <= now) {
        this._map.delete(key);
      }
    }
  }

  _enforceMaxSize() {
    if (!this.maxSize || this.maxSize <= 0) return;
    while (this._map.size > this.maxSize) {
      const oldestKey = this._map.keys().next().value;
      if (oldestKey === undefined) break;
      this._map.delete(oldestKey);
    }
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  get(key) {
    const entry = this._map.get(key);
    if (!entry) return undefined;

    if (this.ttlMs && this.ttlMs > 0) {
      const now = this._now();
      if (entry.expiresAt <= now) {
        this._map.delete(key);
        return undefined;
      }
    }

    return entry.value;
  }

  set(key, value) {
    // Refresh insertion order (used for max-size eviction)
    if (this._map.has(key)) this._map.delete(key);

    const expiresAt = this.ttlMs && this.ttlMs > 0 ? this._now() + this.ttlMs : Number.POSITIVE_INFINITY;
    this._map.set(key, { value, expiresAt });

    // Opportunistic cleanup
    this._purgeExpired();
    this._enforceMaxSize();

    return this;
  }

  delete(key) {
    return this._map.delete(key);
  }

  clear() {
    this._map.clear();
  }

  get size() {
    this._purgeExpired();
    return this._map.size;
  }
}

export default TTLMap;
