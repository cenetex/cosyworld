import crypto from 'crypto';

// Simple provider-agnostic embedding service
export class EmbeddingService {
  constructor({ logger, configService, googleAIService = null, aiService = null } = {}) {
    this.logger = logger || console;
    this.config = configService?.config || {};
    this.google = googleAIService || null;
    this.ai = aiService || null; // OpenRouter AI service may expose embeddings
    this.cache = new Map(); // key -> vector
    this.provider = process.env.MEMORY_PROVIDER || 'google';
    this.model = process.env.EMBEDDING_MODEL || 'text-embedding-004';
  }

  sha1(input) {
    return crypto.createHash('sha1').update(input).digest('hex');
  }

  async embed(text) {
    const key = this.sha1(`${this.provider}:${this.model}:${text}`);
    if (this.cache.has(key)) return this.cache.get(key);

    let vec;
    try {
      vec = await this._embedViaProvider(text);
    } catch (e) {
      this.logger?.warn?.(`[EmbeddingService] Provider failed (${this.provider}): ${e.message}. Falling back to local embeddings.`);
      vec = this._localEmbed(text);
    }
    if (!Array.isArray(vec)) vec = this._localEmbed(text);
    this.cache.set(key, vec);
    return vec;
  }

  async _embedViaProvider(text) {
    const provider = (process.env.MEMORY_PROVIDER || this.provider).toLowerCase();
    if (provider === 'google' && this.google?.googleAI) {
      // Google GenAI embeddings via text-embedding-004
      const modelName = this.model || 'text-embedding-004';
      const model = this.google.googleAI.getGenerativeModel({ model: modelName });
      const res = await model.embedContent({ content: { parts: [{ text }] } });
      const vec = res?.embedding?.values;
      if (!vec) throw new Error('No embedding values from Google');
      return vec;
    }
    if (provider === 'openrouter' && this.ai?.embed) {
      // Expect aiService.embed(text, { model })
      const out = await this.ai.embed(text, { model: this.model });
      if (Array.isArray(out)) return out;
      if (out?.data?.[0]?.embedding) return out.data[0].embedding;
      if (out?.embedding) return out.embedding;
      throw new Error('No embedding from OpenRouter provider');
    }
    // Unknown or local
    return this._localEmbed(text);
  }

  _localEmbed(text, dims = 256) {
    // Cheap locality-sensitive hash embedding for fallback/testing
    const bytes = Buffer.from(this.sha1(text), 'hex');
    const out = new Array(dims).fill(0);
    for (let i = 0; i < dims; i++) {
      const b = bytes[i % bytes.length];
      out[i] = ((b / 255) - 0.5) * 2; // [-1, 1]
    }
    return out;
  }
}

export default EmbeddingService;
