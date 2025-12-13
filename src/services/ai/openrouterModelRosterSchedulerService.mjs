/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

const MODEL_PROVIDER_EMOJI = {
  google: '📡',
  openai: '🌀',
  anthropic: '✨',
  meta: '🧠',
  'meta-llama': '🧠',
  cohere: '🧩',
  perplexity: '🔍',
  qwen: '🕊️',
  nvidia: '⚡',
  'x-ai': '🚀',
  x: '🚀',
  deepseek: '🌊',
  baidu: '🐉',
  ai21: '🧮',
  mistralai: '🌬️',
  inflection: '🔶',
  'agentica-org': '🛰️',
  microsoft: '🪟',
  'nomic-ai': '🧭'
};

const MODEL_SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:.-]*$/i;

const normalizeModelIdentifier = (value = '') => {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/^['"`]+|['"`]+$/g, '');
  if (!trimmed) return null;
  const withoutSuffix = trimmed.replace(/:(online|free)$/i, '');
  if (!MODEL_SLUG_PATTERN.test(withoutSuffix)) return null;
  return withoutSuffix.toLowerCase();
};

const humanizeSlugTokens = (segment = '') => {
  if (!segment) return [];
  return segment
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(token => {
      const lower = token.toLowerCase();
      if (/^[a-z]{1,3}$/.test(lower)) return lower.toUpperCase();
      if (/^[a-z]+$/.test(lower)) return lower.charAt(0).toUpperCase() + lower.slice(1);
      return token;
    });
};

const formatModelDisplayName = (modelId = '') => {
  const normalized = normalizeModelIdentifier(modelId) || (typeof modelId === 'string' ? modelId.trim() : '');
  if (!normalized || !normalized.includes('/')) return null;
  const [providerRaw, restRaw] = normalized.split('/', 2);
  if (!restRaw) return null;
  const [slug, variantRaw] = restRaw.split(':');
  const baseTokens = humanizeSlugTokens(slug);
  const variantTokens = humanizeSlugTokens(variantRaw);
  const displayTokens = [...baseTokens, ...variantTokens].filter(Boolean);
  if (!displayTokens.length) return null;
  const displayName = displayTokens.join(' ');
  const providerLabel = providerRaw
    .split(/[-_]/)
    .filter(Boolean)
    .map(part => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(' ')
    .trim();
  return providerLabel ? `${displayName} (${providerLabel})` : displayName;
};

const stripHiddenTags = (text = '') => text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

export class OpenrouterModelRosterSchedulerService {
  constructor({
    logger,
    databaseService,
    configService,
    avatarService,
    mapService,
    statService,
    aiService,
    unifiedAIService,
    openrouterModelCatalogService,
  }) {
    this.logger = logger || console;
    this.databaseService = databaseService;
    this.configService = configService;
    this.avatarService = avatarService;
    this.mapService = mapService;
    this.statService = statService;
    this.aiService = aiService;
    this.unifiedAIService = unifiedAIService;
    this.openrouterModelCatalogService = openrouterModelCatalogService;

    this._timer = null;
    this._running = false;
    this._initialized = false;

    this.intervalMs = Number(process.env.OPENROUTER_MODEL_ROSTER_REFRESH_MS || 60 * 60 * 1000);
  }

  async initialize() {
    if (this._initialized) return;
    this._initialized = true;

    // Seed baseline without creating avatars to avoid a thundering herd on first deploy.
    await this._tick({ allowCreates: false, reason: 'startup-baseline' });

    this._timer = setInterval(() => {
      this._tick({ allowCreates: true, reason: 'hourly' }).catch(e => {
        this.logger?.warn?.(`[OpenrouterModelRosterScheduler] tick failed: ${e?.message || e}`);
      });
    }, this.intervalMs);

    this.logger?.info?.(`[OpenrouterModelRosterScheduler] Initialized (interval ${Math.round(this.intervalMs / 1000)}s)`);
  }

  async _db() {
    return await this.databaseService.getDatabase();
  }

  async _getEnabledGuildIds(db) {
    const raw = await this.configService.getAllGuildConfigs(db);
    const guildIds = [];

    for (const cfg of raw || []) {
      const guildId = cfg?.guildId;
      if (!guildId || guildId === 'global') continue;
      const modes = cfg?.avatarModes || {};
      const allowPureModel = modes.pureModel !== false;
      if (allowPureModel) guildIds.push(guildId);
    }

    return [...new Set(guildIds)];
  }

  async _getMostRecentlyActiveChannelId(db, guildId) {
    const doc = await db
      .collection('channel_activity')
      .find({ guildId })
      .sort({ lastActivityTimestamp: -1 })
      .limit(1)
      .next();
    return doc?._id || null;
  }

  async _describeModelAppearance(modelId, displayName) {
    const ai = this.unifiedAIService || this.aiService;
    if (!ai?.chat) {
      return `${displayName} manifests as converging bands of light and code, shimmering with its signature inference energy.`;
    }

    const corrId = `model-roster-seed:${modelId}:${Date.now()}`;
    const messages = [
      {
        role: 'system',
        content: `You are ${displayName}, the literal AI model manifesting as an avatar. Describe your visual form in 2 concise sentences. Focus on colors, materials, aura, and symbolism. Do not mention lacking a body, and avoid disclaimers about being virtual.`
      },
      { role: 'user', content: 'Describe how you appear when you step into the world as an avatar.' }
    ];

    try {
      const descriptionModel = process.env.FAST_MODEL || modelId;
      const result = await ai.chat(messages, { model: descriptionModel, corrId, returnEnvelope: true });
      const rawText = typeof result === 'object' && result?.text ? result.text : result;
      const cleaned = typeof rawText === 'string' ? stripHiddenTags(rawText) : '';
      if (cleaned) return cleaned;
    } catch (e) {
      this.logger?.debug?.(`[OpenrouterModelRosterScheduler] describeModelAppearance failed for ${modelId}: ${e?.message || e}`);
    }

    return `${displayName} manifests as converging bands of light and code, shimmering with its signature inference energy.`;
  }

  async _ensureRosterAvatarForGuild(db, modelId, guildId, channelId) {
    const normalized = normalizeModelIdentifier(modelId);
    if (!normalized) return null;

    // Hard guard: never create an avatar for a model that doesn't exist.
    if (this.openrouterModelCatalogService?.assertModelExists) {
      await this.openrouterModelCatalogService.assertModelExists(normalized);
    }

    const query = {
      status: { $ne: 'dead' },
      isPartial: { $ne: true },
      tags: 'model-roster',
      guildId,
      model: normalized,
    };

    const existing = await db.collection(this.avatarService.AVATARS_COLLECTION).findOne(query);
    if (existing) {
      // Ensure it is positioned in the most recently active channel.
      if (channelId && existing.channelId !== channelId) {
        try {
          await this.mapService.updateAvatarPosition(existing, channelId, existing.channelId);
        } catch (e) {
          this.logger?.debug?.(`[OpenrouterModelRosterScheduler] updateAvatarPosition failed for existing roster avatar: ${e?.message || e}`);
        }
        try {
          await db.collection(this.avatarService.AVATARS_COLLECTION).updateOne(
            { _id: existing._id },
            { $set: { channelId, updatedAt: new Date() } }
          );
        } catch {}
      }
      return { avatar: existing, created: false };
    }

    const displayName = formatModelDisplayName(normalized) || normalized;
    const providerKey = normalized.split('/', 1)[0]?.toLowerCase?.() || '';
    const emoji = MODEL_PROVIDER_EMOJI[providerKey] || '💠';
    const description = await this._describeModelAppearance(normalized, displayName);

    const creationDate = new Date();
    const stats = this.statService.generateStatsFromDate(creationDate);

    const baseDoc = {
      name: displayName,
      emoji,
      description,
      personality: '',
      model: normalized,
      channelId: channelId || null,
      guildId,
      summoner: 'system:model-roster',
      stats,
      summonsday: creationDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }),
      lives: 3,
      status: 'alive',
      createdAt: creationDate,
      updatedAt: creationDate,
      tags: ['model-roster'],
    };

    const res = await db.collection(this.avatarService.AVATARS_COLLECTION).insertOne(baseDoc);
    const inserted = { ...baseDoc, _id: res.insertedId };

    if (channelId) {
      try {
        await this.mapService.updateAvatarPosition(inserted, channelId, null);
      } catch (e) {
        this.logger?.debug?.(`[OpenrouterModelRosterScheduler] updateAvatarPosition failed for new roster avatar: ${e?.message || e}`);
      }
    }

    // Generate image asynchronously.
    (async () => {
      try {
        const uploadOptions = {
          source: 'avatar.model-roster',
          avatarId: inserted._id?.toString?.(),
          avatarName: inserted.name,
          avatarEmoji: inserted.emoji,
          prompt: inserted.description,
          context: `${inserted.emoji || '💠'} ${inserted.name} embodies its core form.`.trim(),
        };
        const imageUrl = await this.avatarService.generateAvatarImage(inserted.description, uploadOptions);
        if (imageUrl) {
          await db.collection(this.avatarService.AVATARS_COLLECTION).updateOne(
            { _id: inserted._id },
            { $set: { imageUrl } }
          );
        }
      } catch (e) {
        this.logger?.warn?.(`[OpenrouterModelRosterScheduler] image generation failed for ${displayName}: ${e?.message || e}`);
      }
    })();

    return { avatar: inserted, created: true };
  }

  async _tick({ allowCreates, reason } = {}) {
    if (this._running) return;
    this._running = true;

    try {
      const db = await this._db();

      await this.openrouterModelCatalogService?.refreshIfStale?.({ maxAgeMs: 60 * 60 * 1000 });
      const currentIds = this.openrouterModelCatalogService?.getAllModelIds?.() || [];
      if (!currentIds.length) {
        this.logger?.debug?.('[OpenrouterModelRosterScheduler] No models in catalog; skipping');
        return;
      }

      const stateCol = db.collection('openrouter_model_roster_state');
      const state = await stateCol.findOne({ _id: 'openrouter' });

      if (!state || !Array.isArray(state.knownModelIds) || state.knownModelIds.length === 0) {
        await stateCol.updateOne(
          { _id: 'openrouter' },
          { $set: { knownModelIds: currentIds, updatedAt: new Date(), note: 'baseline' } },
          { upsert: true }
        );
        this.logger?.info?.(`[OpenrouterModelRosterScheduler] Baseline stored (${currentIds.length} models) (${reason})`);
        return;
      }

      const known = new Set(state.knownModelIds.map(id => String(id).toLowerCase()));
      const newModelIds = currentIds.filter(id => !known.has(String(id).toLowerCase()));

      await stateCol.updateOne(
        { _id: 'openrouter' },
        { $set: { knownModelIds: currentIds, updatedAt: new Date(), lastReason: reason } }
      );

      if (!newModelIds.length) return;

      this.logger?.info?.(`[OpenrouterModelRosterScheduler] Detected ${newModelIds.length} new OpenRouter models (${reason})`);

      if (!allowCreates) return;

      const guildIds = await this._getEnabledGuildIds(db);
      if (!guildIds.length) return;

      for (const guildId of guildIds) {
        const channelId = await this._getMostRecentlyActiveChannelId(db, guildId);
        if (!channelId) continue;

        for (const modelId of newModelIds) {
          try {
            await this._ensureRosterAvatarForGuild(db, modelId, guildId, channelId);
          } catch (e) {
            this.logger?.warn?.(`[OpenrouterModelRosterScheduler] Failed to seed roster avatar for ${modelId} in guild ${guildId}: ${e?.message || e}`);
          }
        }
      }
    } finally {
      this._running = false;
    }
  }
}
