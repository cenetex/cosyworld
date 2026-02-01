/**
 * Copyright (c) 2019-2026 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { UnifiedAIService } from './unifiedAIService.mjs';

const normalizeProvider = (value) => {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  if (!v) return null;
  if (v === 'openrouter' || v === 'open-router') return 'openrouter';
  return v;
};

export class AIRouterService {
  constructor({
    logger,
    configService,
    aiService,
    unifiedAIService,
    container,
  } = {}) {
    this.logger = logger || console;
    this.configService = configService || null;

    // Awilix is configured with strict resolution; do not access optional
    // deps during construction. Instead, resolve lazily via container.
    this.container = container || null;

    this.aiService = aiService || null;
    this.unifiedAIService = unifiedAIService || null;

    this._openrouter = null;
    this._swarm = null;
    this._ollama = null;
    this._google = null;

    this._wrapperCache = new Map();
  }

  _tryResolve(name) {
    try {
      return this.container?.resolve?.(name) || null;
    } catch {
      return null;
    }
  }

  _getOpenRouter() {
    if (this._openrouter) return this._openrouter;
    this._openrouter = this._tryResolve('openrouterAIService');
    return this._openrouter;
  }

  _getSwarm() {
    if (this._swarm) return this._swarm;
    this._swarm = this._tryResolve('swarmAIService');
    return this._swarm;
  }

  _getOllama() {
    if (this._ollama) return this._ollama;
    // Service is named OllamaService -> registration key `ollamaService`
    this._ollama = this._tryResolve('ollamaService');
    return this._ollama;
  }

  _getGoogle() {
    if (this._google) return this._google;
    this._google = this._tryResolve('googleAIService');
    return this._google;
  }

  getProviderForAvatar(avatar) {
    // Option C: per-avatar provider override.
    const explicit =
      avatar?.ai?.provider ||
      avatar?.aiProvider ||
      avatar?.llmProvider ||
      avatar?.provider;

    const normalized = normalizeProvider(explicit);
    if (normalized) return normalized;

    // Fallback: global provider (AI_SERVICE) or current aiService provider.
    const env = normalizeProvider(process.env.AI_SERVICE);
    if (env) return env;

    const current = normalizeProvider(this.aiService?.provider);
    if (current) return current;

    return 'openrouter';
  }

  _resolveBase(provider) {
    const p = normalizeProvider(provider);

    if (p === 'swarm') return this._getSwarm() || (this.aiService?.provider === 'swarm' ? this.aiService : null);
    if (p === 'openrouter') return this._getOpenRouter() || (this.aiService?.provider === 'openrouter' ? this.aiService : null);
    if (p === 'ollama') return this._getOllama() || (this.aiService?.provider === 'ollama' ? this.aiService : null);
    if (p === 'google') return this._getGoogle() || (this.aiService?.provider === 'google' ? this.aiService : null);

    return this.aiService;
  }

  _wrapperForBase(base) {
    if (!base) return null;

    // If the global unified wrapper already wraps this base, reuse it.
    if (this.unifiedAIService?.base === base) return this.unifiedAIService;

    const key = base?.constructor?.name || base?.provider || 'unknown';
    if (this._wrapperCache.has(key)) return this._wrapperCache.get(key);

    const wrapper = new UnifiedAIService({
      aiService: base,
      logger: this.logger,
      configService: this.configService,
    });

    this._wrapperCache.set(key, wrapper);
    return wrapper;
  }

  /**
   * Returns an AI instance suitable for `ConversationManager`.
   * Prefer unified wrappers for consistent envelope + retry behavior.
   */
  getAIForAvatar(avatar) {
    const provider = this.getProviderForAvatar(avatar);
    const base = this._resolveBase(provider);

    return this._wrapperForBase(base) || this.unifiedAIService || this.aiService;
  }

  /**
   * Returns base provider (useful for capability checks like vision support).
   */
  getBaseForAvatar(avatar) {
    const provider = this.getProviderForAvatar(avatar);
    return this._resolveBase(provider) || (this.unifiedAIService?.base || this.aiService);
  }

  getContextForAvatar(avatar) {
    const provider = this.getProviderForAvatar(avatar);
    const base = this.getBaseForAvatar(avatar);
    const ai = this.getAIForAvatar(avatar);
    return { provider, base, ai };
  }
}

export default AIRouterService;
