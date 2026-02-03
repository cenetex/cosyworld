/**
 * AvatarOpenAIClient
 *
 * Small wrapper around the OpenAI JS SDK for OpenAI-compatible avatar APIs
 * (e.g. Swarm Avatar API).
 */

import OpenAI from 'openai';

export class AvatarOpenAIClient {
  constructor({ apiKey, baseURL } = {}) {
    if (!apiKey) throw new Error('apiKey is required');
    if (!baseURL) throw new Error('baseURL is required');

    this.apiKey = apiKey;
    this.baseURL = baseURL;

    this.openai = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
    });
  }

  normalizeModel(model) {
    if (!model) return null;
    const m = String(model).trim();
    if (!m) return null;
    if (m.includes(':')) return m;
    return `avatar:${m}`;
  }

  async listModels() {
    return this.openai.models.list();
  }

  async getModelDetails(modelId) {
    return this.openai.models.retrieve(modelId);
  }

  async chatCompletionsCreate({ model, messages, temperature, max_tokens, include_audio } = {}) {
    const normalizedModel = this.normalizeModel(model);
    if (!normalizedModel) throw new Error('model is required');
    if (!Array.isArray(messages)) throw new Error('messages must be an array');

    return this.openai.chat.completions.create({
      model: normalizedModel,
      messages,
      ...(typeof temperature === 'number' ? { temperature } : {}),
      ...(typeof max_tokens === 'number' ? { max_tokens } : {}),
      ...(typeof include_audio === 'boolean' ? { include_audio } : {}),
    });
  }
}

export default AvatarOpenAIClient;
