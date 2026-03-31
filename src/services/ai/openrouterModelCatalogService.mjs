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

/**
 * Fetch model details from the OpenRouter endpoints API.
 * This works for models not in the main catalog (like FLUX).
 * @param {string} modelId 
 * @param {object} logger - Optional logger for debugging
 * @returns {Promise<{exists: boolean, outputModalities: string[], inputModalities: string[], data: object|null, probeStatus: number|null}>}
 */
async function fetchModelEndpointInfo(modelId, logger = null) {
  const id = normalizeId(modelId);
  if (!id) return { exists: false, outputModalities: [], inputModalities: [], data: null, probeStatus: null };
  const [author, ...rest] = id.split('/');
  if (!author || !rest.length) return { exists: false, outputModalities: [], inputModalities: [], data: null, probeStatus: null };
  const slug = rest.join('/');
  const url = `https://openrouter.ai/api/v1/models/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/endpoints`;
  try {
    const res = await fetch(url, { headers: DEFAULT_HEADERS });
    logger?.debug?.(`[OpenrouterModelCatalog] Endpoint probe for ${id}: HTTP ${res.status}`);
    if (!res.ok) return { exists: false, outputModalities: [], inputModalities: [], data: null, probeStatus: res.status };
    const json = await res.json();
    const data = json?.data;
    if (!data) return { exists: false, outputModalities: [], inputModalities: [], data: null, probeStatus: res.status };
    const arch = data.architecture || {};
    return {
      exists: true,
      outputModalities: arch.output_modalities || [],
      inputModalities: arch.input_modalities || [],
      data,
      probeStatus: res.status
    };
  } catch (e) {
    logger?.debug?.(`[OpenrouterModelCatalog] Endpoint probe error for ${id}: ${e.message}`);
    return { exists: false, outputModalities: [], inputModalities: [], data: null, probeStatus: null };
  }
}

// Cache TTL for model capabilities in database (7 days)
const CAPABILITY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Cooldown for failed model probes (5 minutes) - allows re-probing after cooldown
const FAILED_PROBE_COOLDOWN_MS = 5 * 60 * 1000;

// TTL for degraded model status (15 minutes) - will retry after this
const DEGRADED_MODEL_TTL_MS = 15 * 60 * 1000;

export class OpenrouterModelCatalogService {
  constructor({ logger, aiModelService, databaseService } = {}) {
    this.logger = logger || console;
    this.aiModelService = aiModelService || null;
    this.databaseService = databaseService || null;

    this._modelsById = new Map(); // id(lower) -> raw model record
    this._imageCapableModels = new Set(); // models with image output modality
    this._imageOnlyModels = new Set(); // models that ONLY output images (no text)
    this._modelCapabilitiesCache = new Map(); // cache for dynamic endpoint lookups
    this._degradedModels = new Map(); // modelId -> { markedAt, reason } for models returning empty/bad responses
    this._dbCacheLoaded = false; // whether we've loaded from DB
    this._lastRefreshAt = 0;
    this._lastRefreshOk = false;
  }

  /**
   * Load cached model capabilities from database.
   * Called once on first capability lookup.
   */
  async _loadCapabilitiesFromDb() {
    if (this._dbCacheLoaded || !this.databaseService) return;
    this._dbCacheLoaded = true;
    
    try {
      const db = await this.databaseService.getDatabase();
      if (!db) return;
      
      const collection = db.collection('model_capabilities');
      const now = Date.now();
      const cutoff = now - CAPABILITY_CACHE_TTL_MS;
      
      // Load non-expired capabilities
      const docs = await collection.find({ cachedAt: { $gte: cutoff } }).toArray();
      
      for (const doc of docs) {
        const id = doc.modelId;
        if (!id) continue;
        
        // Only cache exists: true from DB - exists: false entries will be re-probed on next access
        // This prevents stale "not found" entries from blocking valid models
        if (doc.exists !== true) continue;
        
        const caps = {
          exists: doc.exists,
          outputModalities: doc.outputModalities || [],
          inputModalities: doc.inputModalities || [],
          isImageCapable: doc.isImageCapable || false,
          isImageOnly: doc.isImageOnly || false
        };
        
        this._modelCapabilitiesCache.set(id, caps);
        if (caps.isImageOnly) this._imageOnlyModels.add(id);
        if (caps.isImageCapable) this._imageCapableModels.add(id);
      }
      
      if (docs.length > 0) {
        this.logger?.debug?.(`[OpenrouterModelCatalog] Loaded ${docs.length} cached model capabilities from DB`);
      }
    } catch (e) {
      this.logger?.debug?.(`[OpenrouterModelCatalog] Failed to load capabilities from DB: ${e.message}`);
    }
  }

  /**
   * Save model capabilities to database.
   * Only persists exists: true entries to avoid caching false negatives.
   * @param {string} modelId 
   * @param {object} capabilities 
   */
  async _saveCapabilitiesToDb(modelId, capabilities) {
    if (!this.databaseService || !modelId) return;
    
    // Only persist successful probes - don't cache "not found" as it might be temporary
    if (capabilities?.exists !== true) return;
    
    try {
      const db = await this.databaseService.getDatabase();
      if (!db) return;
      
      const collection = db.collection('model_capabilities');
      await collection.updateOne(
        { modelId },
        {
          $set: {
            modelId,
            exists: capabilities.exists,
            outputModalities: capabilities.outputModalities || [],
            inputModalities: capabilities.inputModalities || [],
            isImageCapable: capabilities.isImageCapable || false,
            isImageOnly: capabilities.isImageOnly || false,
            cachedAt: Date.now()
          }
        },
        { upsert: true }
      );
    } catch (e) {
      this.logger?.debug?.(`[OpenrouterModelCatalog] Failed to save capabilities to DB: ${e.message}`);
    }
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

  /**
   * Get all models that support image output generation.
   * @returns {string[]} Array of model IDs that can generate images
   */
  getImageCapableModels() {
    return [...this._imageCapableModels];
  }

  /**
   * Check if a model supports image output generation (sync, cache-only).
   * Returns cached result if available, false otherwise.
   * For reliable detection, use isImageCapableAsync() which fetches from API.
   * @param {string} modelId 
   * @returns {boolean}
   */
  isImageCapable(modelId) {
    const id = normalizeId(modelId);
    if (!id) return false;
    // Check cached results only
    if (this._imageCapableModels.has(id)) return true;
    const cached = this._modelCapabilitiesCache.get(id);
    if (cached) return Boolean(cached.isImageCapable);
    // Not cached - caller should use isImageCapableAsync() for reliable detection
    return false;
  }

  /**
   * Check if a model is image-ONLY (cannot generate text, only images) - sync, cache-only.
   * These models need special handling - they should generate images instead of chat.
   * Returns cached result if available, false otherwise.
   * For reliable detection, use isImageOnlyAsync() which fetches from API.
   * @param {string} modelId 
   * @returns {boolean}
   */
  isImageOnly(modelId) {
    const id = normalizeId(modelId);
    if (!id) return false;
    // Check cache from dynamic lookups
    if (this._imageOnlyModels.has(id)) return true;
    // Check cached capabilities
    const cached = this._modelCapabilitiesCache.get(id);
    if (cached) {
      return cached.isImageOnly ?? false;
    }
    // Not cached - caller should use isImageOnlyAsync() for reliable detection
    return false;
  }

  /**
   * Fetch model capabilities from OpenRouter's endpoints API.
   * Caches the result in memory and database for future lookups.
   * This works for models not in the main catalog (like FLUX).
   * @param {string} modelId 
   * @returns {Promise<{exists: boolean, outputModalities: string[], inputModalities: string[], isImageCapable: boolean, isImageOnly: boolean}>}
   */
  async getModelCapabilities(modelId) {
    const id = normalizeId(modelId);
    if (!id) return { exists: false, outputModalities: [], inputModalities: [], isImageCapable: false, isImageOnly: false };
    
    // Load from DB on first access
    await this._loadCapabilitiesFromDb();
    
    // Check memory cache first - but only trust exists: true, since exists: false might be stale
    const cached = this._modelCapabilitiesCache.get(id);
    if (cached?.exists === true) {
      return cached;
    }
    
    // For exists: false, check if we're still in cooldown period before re-probing
    if (cached?.exists === false && cached?.lastProbeAt) {
      const elapsed = Date.now() - cached.lastProbeAt;
      if (elapsed < FAILED_PROBE_COOLDOWN_MS) {
        this.logger?.debug?.(`[OpenrouterModelCatalog] Model ${id} probe in cooldown (${Math.round((FAILED_PROBE_COOLDOWN_MS - elapsed) / 1000)}s remaining)`);
        return cached;
      }
      this.logger?.debug?.(`[OpenrouterModelCatalog] Re-probing model ${id} (cooldown expired)`);
    }
    
    // Check if we have it in the main catalog
    const catalogModel = this._modelsById.get(id);
    if (catalogModel) {
      const outputs = catalogModel.architecture?.output_modalities || [];
      const inputs = catalogModel.architecture?.input_modalities || [];
      const isImageCapable = outputs.includes('image');
      const isImageOnly = outputs.length > 0 && outputs.every(m => m === 'image');
      const result = { exists: true, outputModalities: outputs, inputModalities: inputs, isImageCapable, isImageOnly };
      this._modelCapabilitiesCache.set(id, result);
      if (isImageOnly) this._imageOnlyModels.add(id);
      if (isImageCapable) this._imageCapableModels.add(id);
      return result;
    }
    
    // Fetch from endpoints API
    const info = await fetchModelEndpointInfo(id, this.logger);
    if (!info.exists) {
      // If endpoints probe returned 404, the model might still be valid (new models aren't always in endpoints API)
      // Cache with lastProbeAt so we can re-probe after cooldown
      const result = { exists: false, outputModalities: [], inputModalities: [], isImageCapable: false, isImageOnly: false, probeStatus: info.probeStatus, lastProbeAt: Date.now() };
      this._modelCapabilitiesCache.set(id, result);
      return result;
    }
    
    const outputs = info.outputModalities;
    const inputs = info.inputModalities;
    const isImageCapable = outputs.includes('image');
    const isImageOnly = outputs.length > 0 && outputs.every(m => m === 'image');
    
    const result = { exists: true, outputModalities: outputs, inputModalities: inputs, isImageCapable, isImageOnly };
    this._modelCapabilitiesCache.set(id, result);
    
    // Update capability sets
    if (isImageOnly) {
      this._imageOnlyModels.add(id);
      this.logger?.info?.(`[OpenrouterModelCatalog] Detected image-ONLY model: ${id}`);
    }
    if (isImageCapable) {
      this._imageCapableModels.add(id);
    }
    
    // Cache minimal model existence
    if (!this._modelsById.has(id)) {
      this._modelsById.set(id, { id, architecture: { output_modalities: outputs, input_modalities: inputs } });
    }
    
    // Persist to database for future restarts
    await this._saveCapabilitiesToDb(id, result);
    
    return result;
  }

  /**
   * Get full model metadata including architecture info.
   * @param {string} modelId 
   * @returns {object|null}
   */
  getModelMetadata(modelId) {
    const id = normalizeId(modelId);
    return id ? this._modelsById.get(id) || null : null;
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
      const imageCapable = new Set();
      
      for (const item of list) {
        const id = normalizeId(item?.id);
        if (!id) continue;
        next.set(id, item);
        
        // Track models with image output capability
        const outputModalities = item?.architecture?.output_modalities;
        if (Array.isArray(outputModalities) && outputModalities.includes('image')) {
          imageCapable.add(id);
        }
      }

      this._modelsById = next;
      this._imageCapableModels = imageCapable;
      this._lastRefreshAt = now;
      this._lastRefreshOk = true;
      
      if (imageCapable.size > 0) {
        this.logger?.info?.(`[OpenrouterModelCatalog] Found ${imageCapable.size} image-capable models: ${[...imageCapable].join(', ')}`);
      }

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
   * Falls back to probing the model via multiple API endpoints.
   */
  async modelExists(modelId, { refreshIfNeeded = true } = {}) {
    const id = normalizeId(modelId);
    if (!id) return false;

    // Must have vendor/model format
    if (!id.includes('/')) {
      this.logger?.debug?.(`[OpenrouterModelCatalog] modelExists: '${id}' invalid format (no /)`);
      return false;
    }

    if (refreshIfNeeded) {
      if (!this._lastRefreshAt || !this._modelsById.size) {
        await this.refresh({ force: true });
      } else {
        await this.refreshIfStale({ maxAgeMs: 60 * 60 * 1000 });
      }
    }

    // Check main catalog first
    if (this._modelsById.has(id)) {
      this.logger?.debug?.(`[OpenrouterModelCatalog] modelExists: '${id}' found in catalog`);
      return true;
    }

    // Check if we've already cached this model's capabilities (including from successful API calls)
    const cached = this._modelCapabilitiesCache.get(id);
    if (cached?.exists === true) {
      this.logger?.debug?.(`[OpenrouterModelCatalog] modelExists: '${id}' found in capabilities cache`);
      return true;
    }

    // Try the endpoints API probe
    const capabilities = await this.getModelCapabilities(id);
    if (capabilities.exists) {
      this.logger?.debug?.(`[OpenrouterModelCatalog] modelExists: '${id}' confirmed via endpoints API`);
      return true;
    }

    // Endpoints API returned 404 - try probing the single-model API as final fallback
    // Some models work with chat but aren't in the endpoints API
    try {
      const [author, ...rest] = id.split('/');
      const slug = rest.join('/');
      const singleModelUrl = `https://openrouter.ai/api/v1/models/${encodeURIComponent(author)}/${encodeURIComponent(slug)}`;
      const res = await fetch(singleModelUrl, { headers: DEFAULT_HEADERS });
      this.logger?.debug?.(`[OpenrouterModelCatalog] Single model probe for ${id}: HTTP ${res.status}`);
      
      if (res.ok) {
        const json = await res.json();
        if (json?.data || json?.id) {
          // Model exists! Cache it
          this.logger?.info?.(`[OpenrouterModelCatalog] modelExists: '${id}' confirmed via single-model API`);
          const arch = json?.data?.architecture || json?.architecture || {};
          const outputs = arch.output_modalities || [];
          const inputs = arch.input_modalities || [];
          const isImageCapable = outputs.includes('image');
          const isImageOnly = outputs.length > 0 && outputs.every(m => m === 'image');
          
          this._modelCapabilitiesCache.set(id, { 
            exists: true, 
            outputModalities: outputs, 
            inputModalities: inputs, 
            isImageCapable, 
            isImageOnly 
          });
          this._modelsById.set(id, json.data || json);
          
          if (isImageOnly) this._imageOnlyModels.add(id);
          if (isImageCapable) this._imageCapableModels.add(id);
          
          return true;
        }
      }
    } catch (e) {
      this.logger?.debug?.(`[OpenrouterModelCatalog] Single model probe error for ${id}: ${e.message}`);
    }

    this.logger?.debug?.(`[OpenrouterModelCatalog] modelExists: '${id}' not found in any API`);
    return false;
  }

  /**
   * Mark a model as "known good" - it worked with OpenRouter even if not in catalog.
   * Call this after a successful API call to prevent future false negatives.
   * @param {string} modelId 
   * @param {object} options - Optional modality info from the API response
   */
  markModelAsValid(modelId, { outputModalities = [], inputModalities = [] } = {}) {
    const id = normalizeId(modelId);
    if (!id) return;
    
    // Don't override if we already have detailed info
    if (this._modelsById.has(id)) return;
    
    const cached = this._modelCapabilitiesCache.get(id);
    if (cached?.exists === true) return;
    
    const isImageCapable = outputModalities.includes('image');
    const isImageOnly = outputModalities.length > 0 && outputModalities.every(m => m === 'image');
    
    this._modelCapabilitiesCache.set(id, {
      exists: true,
      outputModalities,
      inputModalities,
      isImageCapable,
      isImageOnly
    });
    
    // Add to modelsById so modelExists returns true without API calls
    this._modelsById.set(id, { 
      id, 
      architecture: { 
        output_modalities: outputModalities, 
        input_modalities: inputModalities 
      } 
    });
    
    if (isImageOnly) this._imageOnlyModels.add(id);
    if (isImageCapable) this._imageCapableModels.add(id);
    
    this.logger?.debug?.(`[OpenrouterModelCatalog] Marked model as valid: ${id}`);
  }

  /**
   * Mark a model as degraded (returning empty/bad responses).
   * Will be reconsidered after DEGRADED_MODEL_TTL_MS.
   * @param {string} modelId 
   * @param {string} reason - Why it was marked degraded
   */
  markModelAsDegraded(modelId, reason = 'empty response') {
    const id = normalizeId(modelId);
    if (!id) return;
    
    this._degradedModels.set(id, {
      markedAt: Date.now(),
      reason
    });
    
    this.logger?.warn?.(`[OpenrouterModelCatalog] Marked model as degraded: ${id} (${reason})`);
  }

  /**
   * Check if a model is currently marked as degraded.
   * Expired entries are automatically cleared.
   * @param {string} modelId 
   * @returns {boolean}
   */
  isModelDegraded(modelId) {
    const id = normalizeId(modelId);
    if (!id) return false;
    
    const entry = this._degradedModels.get(id);
    if (!entry) return false;
    
    const age = Date.now() - entry.markedAt;
    if (age > DEGRADED_MODEL_TTL_MS) {
      // TTL expired - clear and allow retry
      this._degradedModels.delete(id);
      this.logger?.info?.(`[OpenrouterModelCatalog] Degraded status expired for model: ${id}`);
      return false;
    }
    
    return true;
  }

  /**
   * Get info about a degraded model, or null if not degraded.
   * @param {string} modelId 
   * @returns {{ markedAt: number, reason: string, ttlRemainingMs: number } | null}
   */
  getDegradedInfo(modelId) {
    const id = normalizeId(modelId);
    if (!id) return null;
    
    const entry = this._degradedModels.get(id);
    if (!entry) return null;
    
    const age = Date.now() - entry.markedAt;
    if (age > DEGRADED_MODEL_TTL_MS) {
      this._degradedModels.delete(id);
      return null;
    }
    
    return {
      ...entry,
      ttlRemainingMs: DEGRADED_MODEL_TTL_MS - age
    };
  }

  /**
   * Clear degraded status for a model (e.g., after successful response).
   * @param {string} modelId 
   */
  clearDegradedStatus(modelId) {
    const id = normalizeId(modelId);
    if (!id) return;
    
    if (this._degradedModels.has(id)) {
      this._degradedModels.delete(id);
      this.logger?.info?.(`[OpenrouterModelCatalog] Cleared degraded status for model: ${id}`);
    }
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

  /**
   * Async check if a model is image-ONLY (cannot generate text, only images).
   * Fetches from API if not in cache.
   * @param {string} modelId 
   * @returns {Promise<boolean>}
   */
  async isImageOnlyAsync(modelId) {
    const id = normalizeId(modelId);
    if (!id) return false;
    
    // Quick check for cached results
    if (this._imageOnlyModels.has(id)) return true;
    if (this._modelCapabilitiesCache.has(id)) {
      return this._modelCapabilitiesCache.get(id).isImageOnly;
    }
    
    // Fetch capabilities from API (will cache the result)
    const caps = await this.getModelCapabilities(modelId);
    return caps.isImageOnly;
  }

  /**
   * Async check if a model supports image output generation.
   * Fetches from API if not in cache.
   * @param {string} modelId 
   * @returns {Promise<boolean>}
   */
  async isImageCapableAsync(modelId) {
    const id = normalizeId(modelId);
    if (!id) return false;
    
    // Quick check for cached results
    if (this._imageCapableModels.has(id)) return true;
    if (this._modelCapabilitiesCache.has(id)) {
      return this._modelCapabilitiesCache.get(id).isImageCapable;
    }
    
    // Fetch capabilities from API (will cache the result)
    const caps = await this.getModelCapabilities(modelId);
    return caps.isImageCapable;
  }

  /**
   * Async check if a model accepts image input (vision/multimodal).
   * Fetches from API if not in cache.
   * @param {string} modelId 
   * @returns {Promise<boolean>}
   */
  async acceptsImageInputAsync(modelId) {
    const id = normalizeId(modelId);
    if (!id) return false;
    
    // Check cached capabilities
    if (this._modelCapabilitiesCache.has(id)) {
      const cached = this._modelCapabilitiesCache.get(id);
      return cached.inputModalities?.includes('image') || false;
    }
    
    // Fetch capabilities from API
    const caps = await this.getModelCapabilities(modelId);
    return caps.inputModalities?.includes('image') || false;
  }
}
