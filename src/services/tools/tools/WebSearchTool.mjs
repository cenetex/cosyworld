/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { BasicTool } from '../BasicTool.mjs';

const MAX_RESULTS = 5;
const MAX_HISTORY = 5;
const MAX_OPENED = 5;
const PRIMARY_SEARCH_MODEL = (process.env.OPENROUTER_WEB_SEARCH_MODEL || '').trim() || 'perplexity/sonar-pro-search';
const CONFIGURED_FALLBACK_MODELS = (process.env.OPENROUTER_WEB_SEARCH_FALLBACKS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const DEFAULT_FALLBACK_MODELS = [
  'perplexity/sonar', // Fallback to standard sonar if pro fails
  'openai/gpt-4o-mini:online' // OpenRouter's :online suffix for web search
];
const ENABLE_EXA_PLUGIN = /^true$/i.test(process.env.OPENROUTER_WEB_SEARCH_USE_PLUGIN || 'false');

// Models that don't support response_format structured output
const UNSTRUCTURED_MODELS = new Set([
  'perplexity/sonar-pro-search',
  'perplexity/sonar',
  'perplexity/sonar-deep-research'
]);

/**
 * Check if a model requires unstructured (plain text) responses
 */
const isUnstructuredModel = (model) => {
  if (!model) return false;
  const lower = model.toLowerCase();
  // All perplexity models
  if (lower.startsWith('perplexity/')) return true;
  // Models with :online suffix (they're wrappers)
  if (lower.includes(':online')) return true;
  // Explicit set
  return UNSTRUCTURED_MODELS.has(lower);
};

/**
 * Parse JSON from text, handling markdown code blocks
 */
const parseJsonFromText = (text) => {
  if (!text) return null;
  if (typeof text === 'object') return text;
  
  let str = String(text).trim();
  
  // Remove markdown code blocks
  str = str.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  
  // Try to extract JSON object or array
  const jsonMatch = str.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (jsonMatch) {
    str = jsonMatch[0];
  }
  
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
};

const uniqueCaseInsensitive = (list) => {
  const seen = new Set();
  return list.filter(item => {
    if (!item) return false;
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const clipText = (value = '', limit = 220) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
};

const isoDate = () => new Date().toISOString().split('T')[0];

export class WebSearchTool extends BasicTool {
  constructor({
    schemaService,
    avatarService,
    aiService,
    unifiedAIService,
    logger
  }) {
    super();

    this.schemaService = schemaService;
    this.avatarService = avatarService;
    this.aiService = unifiedAIService || aiService;
    this.logger = logger;

    this.name = 'search';
    this.description = 'Search the live web, review results, and stash key findings for future context.';
    this.emoji = '🕸️';
    this.parameters = '<query | open <result-number>>';
    this.cooldownMs = 5 * 1000;

    this.primaryModel = PRIMARY_SEARCH_MODEL;
    const fallbackPool = uniqueCaseInsensitive([
      ...CONFIGURED_FALLBACK_MODELS,
      ...DEFAULT_FALLBACK_MODELS
    ]);
    const primaryKey = this.primaryModel.toLowerCase();
    this.fallbackModels = fallbackPool
      .filter(model => model.toLowerCase() !== primaryKey);
    this.enableExaPlugin = ENABLE_EXA_PLUGIN;
  }

  getDescription() {
    return this.description;
  }

  async getSyntax() {
    return `${this.emoji} ${this.name} ${this.parameters}`;
  }

  async execute(_message, params = [], avatar) {
    if (!params.length) {
      return '-# [ Provide a search query or "open <number>" to review a result. ]';
    }

    const [command, ...rest] = params;
    if (command.toLowerCase() === 'open') {
      if (!rest.length) {
        return '-# [ Specify which result to open, e.g. 🕸️ search open 1. ]';
      }
      const index = Number.parseInt(rest[0], 10);
      if (!Number.isInteger(index) || index < 1) {
        return '-# [ Invalid result number. Use the index from the most recent search. ]';
      }
      return this.openResult(avatar, index - 1);
    }

    const query = params.join(' ').trim();
    if (!query || query.length < 3) {
      return '-# [ Please provide a longer search query. ]';
    }
    return this.performSearch(avatar, query);
  }

  async performSearch(avatar, query) {
    const prompt = `Today is ${isoDate()}. Run a web search for "${query}".
Use the web search plugin results to identify the most relevant links.
Return JSON with fields:\n- "query": the resolved search phrase\n- "summary": 1-2 sentence overview\n- "results": up to ${MAX_RESULTS} objects containing { "title", "url", "snippet", "reason" }.
Focus on high-quality, current sources.`;

    const schema = {
      name: 'cosyworld-web-search-results',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          summary: { type: 'string' },
          results: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                url: { type: 'string' },
                snippet: { type: 'string' },
                reason: { type: 'string' }
              },
              required: ['title', 'url']
            }
          }
        },
        required: ['results'],
        additionalProperties: false
      }
    };

    let structured;
    let modelUsed = this.primaryModel;
    try {
      const result = await this._runStructuredRequest({
        prompt,
        schema,
        mode: 'search'
      });
      structured = result.data;
      modelUsed = result.model;
    } catch (err) {
      this.logger?.error?.(`[WebSearchTool] search failed: ${err.message}`);
      return `-# [ ❌ Web search failed: ${clipText(err.message, 90)} ]`;
    }

    const results = Array.isArray(structured?.results) ? structured.results : [];
    if (!results.length) {
      return `-# [ No web results for "${query}". ]`;
    }

    const normalizedResults = results.slice(0, MAX_RESULTS).map((res, idx) => ({
      title: clipText(res.title || `Result ${idx + 1}`, 160),
      url: String(res.url || '').trim(),
      snippet: clipText(res.snippet || res.reason || '', 240),
      reason: clipText(res.reason || '', 160)
    })).filter(res => Boolean(res.url));

    const webContext = this.ensureWebContext(avatar);
    const entry = {
      query: structured?.query || query,
      summary: clipText(structured?.summary || '', 280),
      results: normalizedResults,
      timestamp: Date.now(),
      model: modelUsed
    };

    webContext.latestSearch = entry;
    const history = Array.isArray(webContext.history) ? webContext.history : [];
    webContext.history = [entry, ...history].slice(0, MAX_HISTORY);
    // Preserve existing opened summaries.
    if (!Array.isArray(webContext.opened)) {
      webContext.opened = [];
    }
    avatar.webContext = webContext;

    try {
      await this.avatarService.updateAvatar(avatar);
    } catch (err) {
      this.logger?.error?.(`[WebSearchTool] failed to persist search history: ${err.message}`);
    }

    const lines = normalizedResults.map((res, idx) => {
      const reason = res.reason ? ` — ${res.reason}` : '';
      return `#${idx + 1}. ${res.title}${reason} (${res.url})`;
    });

    const header = entry.summary
      ? `🌐 Search results for "${entry.query}": ${entry.summary}`
      : `🌐 Search results for "${entry.query}"`;

    return [`-# [ ${clipText(header, 240)} ]`, ...lines.map(line => `-# [ ${clipText(line, 240)} ]`)].join('\n');
  }

  async openResult(avatar, index) {
    const webContext = this.ensureWebContext(avatar);
    const latest = webContext.latestSearch;
    if (!latest || !Array.isArray(latest.results) || !latest.results.length) {
      return '-# [ No stored search results. Run a search first. ]';
    }

    if (index < 0 || index >= latest.results.length) {
      return `-# [ Result #${index + 1} not available. Choose 1-${latest.results.length}. ]`;
    }

    const target = latest.results[index];
    if (!target?.url) {
      return '-# [ Selected result is missing a URL. Try another entry. ]';
    }

    const prompt = `Today is ${isoDate()}. Review the article at ${target.url}.
Use web browsing if needed to capture the latest information.
Return JSON with the fields:\n- "title": article title\n- "url": canonical URL\n- "summary": 2-3 sentence plain-language summary\n- "key_points": array of 3 short bullet-worthy takeaways\n- "follow_up": optional suggestions for ${avatar.name}.
Keep the tone neutral and factual.`;

    const schema = {
      name: 'cosyworld-web-article-summary',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          summary: { type: 'string' },
          key_points: {
            type: 'array',
            minItems: 1,
            items: { type: 'string' }
          },
          follow_up: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        required: ['summary', 'key_points'],
        additionalProperties: false
      }
    };

    let structured;
    let modelUsed = this.primaryModel;
    try {
      const result = await this._runStructuredRequest({
        prompt,
        schema,
        mode: 'open'
      });
      structured = result.data;
      modelUsed = result.model;
    } catch (err) {
      this.logger?.error?.(`[WebSearchTool] open failed: ${err.message}`);
      return `-# [ ❌ Failed to summarize ${target.url}: ${clipText(err.message, 90)} ]`;
    }

    const summaryEntry = {
      title: clipText(structured?.title || target.title || target.url, 160),
      url: structured?.url || target.url,
      summary: clipText(structured?.summary || '', 360),
      keyPoints: Array.isArray(structured?.key_points)
        ? structured.key_points.map(point => clipText(point, 180)).filter(Boolean)
        : [],
      followUp: Array.isArray(structured?.follow_up)
        ? structured.follow_up.map(item => clipText(item, 160)).filter(Boolean)
        : [],
      openedAt: Date.now(),
      model: modelUsed
    };

    webContext.latestOpened = summaryEntry;
    const opened = Array.isArray(webContext.opened) ? webContext.opened : [];
    webContext.opened = [summaryEntry, ...opened].slice(0, MAX_OPENED);
    webContext.latestSearch = {
      ...webContext.latestSearch,
      selectedIndex: index
    };
    avatar.webContext = webContext;

    try {
      await this.avatarService.updateAvatar(avatar);
    } catch (err) {
      this.logger?.error?.(`[WebSearchTool] failed to persist opened summary: ${err.message}`);
    }

    const lines = [
      `Summary: ${summaryEntry.summary}`,
      ...summaryEntry.keyPoints.map((point, idx) => `Key ${idx + 1}: ${point}`),
      ...(summaryEntry.followUp.length ? summaryEntry.followUp.map((item, idx) => `Next ${idx + 1}: ${item}`) : [])
    ];

    const header = `📖 ${summaryEntry.title} (${summaryEntry.url})`;
    return [`-# [ ${clipText(header, 240)} ]`, ...lines.map(line => `-# [ ${clipText(line, 240)} ]`)].join('\n');
  }

  ensureWebContext(avatar) {
    if (!avatar.webContext || typeof avatar.webContext !== 'object') {
      avatar.webContext = {};
    }
    return avatar.webContext;
  }

  /**
   * Run a request and parse JSON from the response.
   * For models that don't support structured output (Perplexity, :online),
   * we use plain chat and parse JSON from the text response.
   */
  async _runStructuredRequest({ prompt, schema, mode }) {
    const attempts = this._buildAttemptConfigs(mode);
    let lastError = null;

    for (const attempt of attempts) {
      try {
        let data;
        
        if (isUnstructuredModel(attempt.model)) {
          // Use plain chat for models that don't support response_format
          data = await this._runUnstructuredRequest(prompt, attempt);
        } else {
          // Use schema service for models that support structured output
          data = await this.schemaService.executePipeline({
            prompt,
            schema,
            options: attempt.options
          });
        }

        if (attempt.isFallback) {
          this.logger?.info?.(`[WebSearchTool] ${mode} succeeded with fallback model ${attempt.model}`);
        }

        return { data, model: attempt.model };
      } catch (err) {
        lastError = err;
        const message = err?.message || String(err);
        this.logger?.warn?.(`[WebSearchTool] ${mode} attempt failed (${attempt.model}): ${message}`);
      }
    }

    if (lastError) throw lastError;
    throw new Error('Unable to generate structured output');
  }

  /**
   * Run a plain chat request and parse JSON from the response.
   * Used for models like Perplexity that don't support response_format.
   */
  async _runUnstructuredRequest(prompt, attempt) {
    if (!this.aiService?.chat) {
      throw new Error('AI service not available for unstructured request');
    }

    const systemPrompt = `You are a web search assistant. Respond ONLY with valid JSON, no markdown or extra text.`;
    
    const response = await this.aiService.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ], {
      model: attempt.model,
      temperature: attempt.options?.temperature || 0.2,
      web_search_options: attempt.options?.web_search_options
    });

    // Extract text from response
    const text = response?.text || response?.content || (typeof response === 'string' ? response : '');
    
    if (!text) {
      throw new Error('Empty response from AI');
    }

    const parsed = parseJsonFromText(text);
    if (!parsed) {
      throw new Error('Failed to parse JSON from response');
    }

    return parsed;
  }

  _buildAttemptConfigs(mode) {
    const attempts = [];
    const pushAttempt = (model, isFallback) => {
      if (!model) return;
      const key = `${model}|${isFallback}`;
      if (attempts.some(entry => entry.key === key)) return;
      attempts.push({
        key,
        model,
        isFallback,
        options: this._createOptionsForModel(model, mode, this._shouldUsePlugin(model))
      });
    };

    pushAttempt(this.primaryModel, false);
    this.fallbackModels.forEach(model => pushAttempt(model, true));

    return attempts;
  }

  _createOptionsForModel(model, mode, usePlugin) {
    const maxResults = mode === 'search' ? MAX_RESULTS : 3;
    const options = {
      model,
      temperature: 0.2,
      web_search_options: {
        search_context_size: 'medium'
      }
    };

    if (usePlugin) {
      options.plugins = [
        {
          id: 'web',
          engine: 'exa',
          max_results: maxResults
        }
      ];
    }

    return options;
  }

  _shouldUsePlugin(model) {
    if (!this.enableExaPlugin) return false;
    if (!model) return false;
    const lower = model.toLowerCase();
    if (lower.startsWith('perplexity/')) return false;
    if (lower === 'openrouter/auto') return false;
    return true;
  }
}
