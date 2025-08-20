/**
 * UnifiedAIService: Phase 0 adapter providing a normalized envelope over the existing provider aiService.
 * Quick wins: consistent envelope, reasoning extraction, error normalization.
 */
export class UnifiedAIService {
  constructor({ aiService, logger, configService }) {
    this.base = aiService; // underlying provider
    this.logger = logger || console;
    this.configService = configService;
  }

  /** Normalize raw result (string or object) into envelope */
  _toEnvelope(raw, { model, provider } = {}) {
    if (raw == null) {
      return { text: null, reasoning: null, toolCalls: null, model, provider, error: { code: 'NO_CONTENT', message: 'Empty response' } };
    }
    if (typeof raw === 'object' && raw.text) {
      return { model, provider, ...raw, error: raw.error || null };
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
    return { text, reasoning: reasoning.length ? reasoning.join('\n') : null, toolCalls: null, model, provider, error: null, raw };
  }

  async chat(messages, options = {}) {
    const t0 = Date.now();
    let raw;
    try {
      raw = await this.base.chat(messages, options);
      const env = this._toEnvelope(raw, { model: options.model, provider: this.base?.constructor?.name });
      env.usage = { latencyMs: Date.now() - t0 };
      return env;
    } catch (e) {
      return { text: null, reasoning: null, toolCalls: null, model: options.model, provider: this.base?.constructor?.name, error: { code: 'EXCEPTION', message: e.message } };
    }
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
