/**
 * Copyright (c) 2019-2026 Cenetex Inc.
 * Licensed under the MIT License.
 */

import OpenAI from 'openai';
import { BaseAIService } from './baseAIService.mjs';

export class SwarmAIService extends BaseAIService {
  constructor({ logger, configService } = {}) {
    super({ configService });
    this.logger = logger || console;

    const cfg = this.configService?.config?.ai?.swarm || {};

    this.provider = 'swarm';
    this.apiKey = cfg.apiKey || process.env.SWARM_API_KEY || null;
    this.baseURL = cfg.baseURL || process.env.SWARM_API_BASE_URL || 'https://swarm.rati.chat/api/v1';

    this.model = cfg.chatModel || cfg.model || process.env.SWARM_MODEL || 'avatar:rati';

    this.defaultChatOptions = {
      model: this.model,
      temperature: 0.8,
      max_tokens: 1000,
    };

    this.openai = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
    });
  }

  _normalizeModel(model) {
    if (!model) return this.model;
    const m = String(model).trim();
    if (!m) return this.model;

    // Swarm API supports either "avatar:name" or just "name" per docs.
    if (m.includes(':')) return m;
    return `avatar:${m}`;
  }

  async chat(messages, options = {}, retries = 2) {
    if (!this.apiKey) {
      throw new Error('SWARM_API_KEY not configured');
    }

    const { model: requestedModel, returnEnvelope, ...rest } = options || {};
    const model = this._normalizeModel(requestedModel || this.defaultChatOptions.model);

    const merged = {
      ...this.defaultChatOptions,
      model,
      messages: (messages || []).filter((m) => m && m.content !== undefined),
      ...rest,
    };

    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await this.openai.chat.completions.create(merged);
        const text = String(response?.choices?.[0]?.message?.content || '').trim();

        if (returnEnvelope) {
          return {
            text,
            raw: response,
            model,
            provider: this.provider,
          };
        }

        return text;
      } catch (e) {
        lastErr = e;
        // Minimal retry: only on obvious transient failures.
        const status = e?.status || e?.response?.status || null;
        if (attempt < retries && (status === 429 || status === 500 || status === 502 || status === 503)) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        break;
      }
    }

    throw lastErr || new Error('Swarm chat failed');
  }

  async generateCompletion(prompt, options = {}) {
    const res = await this.chat([{ role: 'user', content: String(prompt || '') }], options);
    return typeof res === 'string' ? res : String(res?.text || '');
  }

  async listModels() {
    if (!this.apiKey) throw new Error('SWARM_API_KEY not configured');
    // OpenAI SDK maps to GET /models
    return this.openai.models.list();
  }

  async getModelDetails(modelId) {
    if (!this.apiKey) throw new Error('SWARM_API_KEY not configured');
    return this.openai.models.retrieve(modelId);
  }
}

export default SwarmAIService;
