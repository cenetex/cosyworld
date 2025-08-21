/**
 * UnifiedAIService: Phase 0 adapter providing a normalized envelope over the existing provider aiService.
 * Quick wins: consistent envelope, reasoning extraction, error normalization.
 */
export class UnifiedAIService {
  constructor({ aiService, logger, configService }) {
    this.base = aiService; // underlying provider
    this.logger = logger || console;
    this.configService = configService;
  this.maxRetries = Number(process.env.AI_MAX_RETRIES || 2);
  this.baseBackoffMs = Number(process.env.AI_RETRY_BASE_MS || 400);
  this.maxConcurrency = Number(process.env.AI_MAX_CONCURRENCY || 6);
  this._inFlight = 0;
  this._queue = [];
  }

  /** Convenience helper to extract plain text from an envelope or raw */
  static unwrap(result) {
    if (result == null) return null;
    if (typeof result === 'string') return result;
    if (typeof result === 'object') return result.text || null;
    return String(result);
  }

  /** Normalize raw result (string or object) into envelope */
  _toEnvelope(raw, { model, provider } = {}) {
    // Pass through if already looks like envelope (has text or error key and provider)
    if (raw && typeof raw === 'object' && (Object.prototype.hasOwnProperty.call(raw,'text') || Object.prototype.hasOwnProperty.call(raw,'error')) && (raw.provider || raw.model || raw.usage)) {
      const env = { model, provider, ...raw };
      if (!env.model) env.model = model;
      if (!env.provider) env.provider = provider;
      this._estimateTokens(env);
      return env;
    }
    if (raw == null) {
      return { text: null, reasoning: null, toolCalls: null, model, provider, error: { code: 'NO_CONTENT', message: 'Empty response' } };
    }
    if (typeof raw === 'object' && raw.text) {
  const env = { model, provider, ...raw, error: raw.error || null };
  if (!env.usage) env.usage = {};
  this._estimateTokens(env);
  return env;
    }
    let text = String(raw);
    let reasoning = [];
    try {
      const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
      let m;
      while ((m = thinkRegex.exec(text)) !== null) {
        if (m[1]?.trim()) reasoning.push(m[1].trim());
      }
      if (reasoning.length) text = text.replace(thinkRegex, '').trim();
    } catch {}
  const env = { text, reasoning: reasoning.length ? reasoning.join('\n') : null, toolCalls: null, model, provider, error: null, raw };
  env.usage = env.usage || {};
  this._estimateTokens(env);
  return env;
  }

  async chat(messages, options = {}) {
    const t0 = Date.now();
    let attempt = 0;
    let lastErr = null;
    const corr = options.corrId ? `[corrId=${options.corrId}] ` : '';
    const release = await this._acquireSlot();
  // Force providers to return envelope form
  const baseOptions = { ...options, returnEnvelope: true };
    while (attempt <= this.maxRetries) {
      try {
    const raw = await this.base.chat(messages, baseOptions);
    const env = this._toEnvelope(raw, { model: baseOptions.model, provider: this.base?.constructor?.name });
        env.usage = { latencyMs: Date.now() - t0, attempts: attempt + 1 };
        if (attempt > 0) env.meta = { recovered: true };
        env.corrId = options.corrId || null;
  this._estimateTokens(env);
        release();
        return env;
      } catch (e) {
        lastErr = e;
        const classified = this._classifyError(e);
        const retryable = classified.retryable && attempt < this.maxRetries;
        if (!retryable) {
          release();
          return { text: null, reasoning: null, toolCalls: null, model: options.model, provider: this.base?.constructor?.name, error: { code: classified.code, message: e.message, attempts: attempt + 1 }, corrId: options.corrId || null };
        }
        const delay = this._computeBackoff(attempt, classified.retryAfterMs);
        this.logger.warn?.(`${corr}[unifiedAI] retry ${attempt+1}/${this.maxRetries} in ${delay}ms code=${classified.code}`);
        await new Promise(r => setTimeout(r, delay));
        attempt++;
      }
    }
    release();
    return { text: null, reasoning: null, toolCalls: null, model: options.model, provider: this.base?.constructor?.name, error: { code: 'UNKNOWN_FAILURE', message: lastErr?.message || 'Unknown AI failure', attempts: attempt }, corrId: options.corrId || null };
  }

  _computeBackoff(attempt, retryAfterMs) {
    if (retryAfterMs) return retryAfterMs;
    const base = this.baseBackoffMs * Math.pow(2, attempt);
    const jitter = Math.floor(Math.random() * 150);
    return base + jitter;
  }

  _classifyError(e) {
    const msg = (e?.message || '').toLowerCase();
    const code = e?.code || e?.status || '';
    // Detect HTTP style objects
    const status = typeof e?.status === 'number' ? e.status : (e?.response?.status);
    if (status === 401 || msg.includes('unauthorized')) return { code: 'AUTH', retryable: false };
    if (status === 403) return { code: 'FORBIDDEN', retryable: false };
    if (status === 400 || msg.includes('invalid') || msg.includes('malformed')) return { code: 'INVALID_REQUEST', retryable: false };
    if (status === 404) return { code: 'NOT_FOUND', retryable: false };
    if (status === 429 || msg.includes('rate limit')) {
      const ra = Number(e?.response?.headers?.['retry-after'] || e?.retryAfter || 0) * 1000 || null;
      return { code: 'RATE_LIMIT', retryable: true, retryAfterMs: ra };
    }
    if (status >= 500 && status < 600) return { code: 'SERVER_ERROR', retryable: true };
    if (msg.includes('timeout') || msg.includes('network')) return { code: 'NETWORK', retryable: true };
    return { code: code || 'EXCEPTION', retryable: false };
  }

  _estimateTokens(env) {
    if (!env || !env.text) return;
    try {
      // Very rough heuristic: 1 token ≈ 4 chars (English) -> use 3.5 to be conservative
      const completionTokens = Math.max(1, Math.ceil(env.text.length / 3.5));
      const reasoningTokens = env.reasoning ? Math.ceil(String(env.reasoning).length / 3.5) : 0;
      env.usage = env.usage || {};
      if (!env.usage.completionTokens) env.usage.completionTokens = completionTokens + reasoningTokens;
      if (!env.usage.promptTokens && env.rawPrompt) {
        env.usage.promptTokens = Math.ceil(env.rawPrompt.length / 3.5);
      }
      if (env.usage.promptTokens && env.usage.completionTokens) {
        env.usage.totalTokens = env.usage.promptTokens + env.usage.completionTokens;
      }
    } catch {}
  }

  async _acquireSlot() {
    if (!this.maxConcurrency || this.maxConcurrency <= 0) return () => {};
    if (this._inFlight < this.maxConcurrency) {
      this._inFlight++;
      return () => this._releaseSlot();
    }
    return await new Promise(resolve => {
      this._queue.push(() => {
        this._inFlight++;
        resolve(() => this._releaseSlot());
      });
    });
  }

  _releaseSlot() {
    this._inFlight = Math.max(0, this._inFlight - 1);
    const next = this._queue.shift();
    if (next) next();
  }

  async structured({ prompt, schema, options = {} }) {
    if (typeof this.base.generateStructuredOutput === 'function') {
      try {
        const data = await this.base.generateStructuredOutput({ prompt, schema, options });
        return { text: JSON.stringify(data), reasoning: null, toolCalls: null, model: options.model, provider: this.base?.constructor?.name, data, error: null };
      } catch (e) {
        return { text: null, data: null, error: { code: 'STRUCTURED_ERROR', message: e.message } };
      }
    }
    const schemaText = typeof schema === 'object' ? JSON.stringify(schema) : String(schema || '');
    const messages = [
      { role: 'system', content: 'Return ONLY valid JSON satisfying the provided schema. No commentary.' },
      { role: 'user', content: `Schema:\n${schemaText}\n\nPrompt:\n${prompt}` }
    ];
    return await this.chat(messages, { ...options });
  }
}

export default UnifiedAIService;
