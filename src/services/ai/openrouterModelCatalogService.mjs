/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

const DEFAULT_HEADERS = {
  'HTTP-Referer': 'https://ratimics.com',
  'X-Title': 'cosyworld'
};

const normalizeId = (value) => {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/^['"`]+|['"`]+$/g, '');
  if (!trimmed) return null;
  return trimmed.replace(/:(online|free)$/i, '').toLowerCase();
};

async function probeModelExistsViaEndpoints(modelId) {
  const id = normalizeId(modelId);
  if (!id) return false;
  const [author, ...rest] = id.split('/');
  if (!author || !rest.length) return false;
  const slug = rest.join('/');
  const url = `https://openrouter.ai/api/v1/models/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/endpoints`;
  try {
    const res = await fetch(url, { headers: DEFAULT_HEADERS });
    return res.ok;
  } catch {
    return false;
  }
}

export class OpenrouterModelCatalogService {
  constructor({ logger, aiModelService } = {}) {
    this.logger = logger || console;
    this.aiModelService = aiModelService || null;

    this._modelsById = new Map(); // id(lower) -> raw model record
    this._lastRefreshAt = 0;
    this._lastRefreshOk = false;
  }

  get lastRefreshAt() {
    return this._lastRefreshAt;
  }

  get size() {
    return this._modelsById.size;
  }

  getAllModelIds() {
    return [...this._modelsById.keys()];
  }

  hasModel(modelId) {
    const id = normalizeId(modelId);
    if (!id) return false;
    return this._modelsById.has(id);
  }

  async refreshIfStale({ maxAgeMs = 60 * 60 * 1000, force = false } = {}) {
    const now = Date.now();
    if (!force && this._lastRefreshAt && now - this._lastRefreshAt < maxAgeMs) {
      return { refreshed: false, ok: this._lastRefreshOk, count: this._modelsById.size, newModelIds: [] };
    }
    return await this.refresh({ force: true });
  }

  async refresh({ force = false } = {}) {
    const now = Date.now();
    if (!force && this._lastRefreshAt && now - this._lastRefreshAt < 10_000) {
      return { refreshed: false, ok: this._lastRefreshOk, count: this._modelsById.size, newModelIds: [] };
    }

    const previousIds = new Set(this._modelsById.keys());

    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', { headers: DEFAULT_HEADERS });
      if (!res.ok) {
        this._lastRefreshAt = now;
        this._lastRefreshOk = false;
        this.logger?.warn?.(`[OpenrouterModelCatalog] refresh failed: HTTP ${res.status} ${res.statusText}`);
        return { refreshed: true, ok: false, count: this._modelsById.size, newModelIds: [] };
      }

      const json = await res.json();
      const list = Array.isArray(json?.data) ? json.data : [];

      const next = new Map();
      for (const item of list) {
        const id = normalizeId(item?.id);
        if (!id) continue;
        next.set(id, item);
      }

      this._modelsById = next;
      this._lastRefreshAt = now;
      this._lastRefreshOk = true;

      const newModelIds = [];
      for (const id of next.keys()) {
        if (!previousIds.has(id)) newModelIds.push(id);
      }

      // Keep AIModelService in sync so fuzzy lookup can see new models.
      // Preserve existing rarities when possible.
      try {
        if (this.aiModelService) {
          const existing = this.aiModelService.getAllModels('openrouter') || [];
          const rarityById = new Map(existing.map(m => [normalizeId(m.model), m.rarity]).filter(([k]) => k));
          const merged = [...next.keys()].map(id => ({ model: id, rarity: rarityById.get(id) || 'common' }));
          if (merged.length) this.aiModelService.registerModels('openrouter', merged);
        }
      } catch (e) {
        this.logger?.debug?.(`[OpenrouterModelCatalog] Failed to sync AIModelService registry: ${e?.message || e}`);
      }

      return { refreshed: true, ok: true, count: next.size, newModelIds };
    } catch (e) {
      this._lastRefreshAt = now;
      this._lastRefreshOk = false;
      this.logger?.warn?.(`[OpenrouterModelCatalog] refresh threw: ${e?.message || e}`);
      return { refreshed: true, ok: false, count: this._modelsById.size, newModelIds: [] };
    }
  }

  /**
   * Strict existence check (uses cached catalog; refreshes if empty or stale).
   */
  async modelExists(modelId, { refreshIfNeeded = true } = {}) {
    const id = normalizeId(modelId);
    if (!id) return false;

    if (refreshIfNeeded) {
      if (!this._lastRefreshAt || !this._modelsById.size) {
        await this.refresh({ force: true });
      } else {
        await this.refreshIfStale({ maxAgeMs: 60 * 60 * 1000 });
      }
    }

    if (this._modelsById.has(id)) return true;

    // If the global catalog isn't available (or the model is brand new), fall back to probing
    // the per-model endpoints route which returns 200 only for real models.
    const probed = await probeModelExistsViaEndpoints(id);
    if (probed) {
      // Cache the existence minimally so subsequent checks are fast.
      this._modelsById.set(id, this._modelsById.get(id) || { id });
    }
    return probed;
  }

  async assertModelExists(modelId) {
    const id = normalizeId(modelId);
    if (!id) throw new Error('Invalid model identifier');
    const exists = await this.modelExists(id, { refreshIfNeeded: true });
    if (!exists) throw new Error(`OpenRouter model not found: ${id}`);
    return id;
  }

  /**
   * Pick a random model that is known to exist in the current catalog.
   * Falls back to the current AIModelService registry if the catalog is empty.
   */
  async pickRandomExistingModel({ rarity = null } = {}) {
    await this.refreshIfStale({ maxAgeMs: 60 * 60 * 1000 });

    let candidates = this.getAllModelIds();
    if (!candidates.length && this.aiModelService) {
      candidates = (this.aiModelService.getAllModels('openrouter') || []).map(m => normalizeId(m.model)).filter(Boolean);
    }

    if (!candidates.length) return null;

    if (rarity && this.aiModelService) {
      const filtered = (this.aiModelService.getAllModels('openrouter') || [])
        .filter(m => m?.rarity === rarity)
        .map(m => normalizeId(m.model))
        .filter(Boolean);
      if (filtered.length) candidates = filtered;
    }

    const idx = Math.floor(Math.random() * candidates.length);
    return candidates[idx] || null;
  }
}
