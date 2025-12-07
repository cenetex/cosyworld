/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

export class WikiGardenerService {
  constructor({ wikiService, databaseService, unifiedAIService, aiService, logger }) {
    this.wikiService = wikiService;
    this.databaseService = databaseService;
    this.ai = unifiedAIService || aiService;
    this.logger = logger || console;
    
    this.enabled = String(process.env.WIKI_GARDENER_ENABLED || 'true') === 'true';
    this.intervalMs = Number(process.env.WIKI_GARDENER_INTERVAL || 6 * 60 * 60 * 1000); // Default 6 hours
    this.timer = null;
  }

  start() {
    if (!this.enabled) {
      this.logger.info('[WikiGardener] Disabled via config');
      return;
    }

    this.logger.info(`[WikiGardener] Starting service (interval: ${this.intervalMs}ms)`);
    
    // Initial run after 1 minute to let system settle
    setTimeout(() => this.runCycle(), 60 * 1000);
    
    // Schedule periodic runs
    this.timer = setInterval(() => this.runCycle(), this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runCycle() {
    this.logger.info('[WikiGardener] Starting gardening cycle...');
    try {
      const db = await this.databaseService.getDatabase();
      
      // 1. Gather recent conversations (last 24h)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      // Try to find messages collection
      let recentMessages = [];
      try {
        recentMessages = await db.collection('messages')
          .find({ createdAt: { $gte: oneDayAgo } })
          .sort({ createdAt: 1 })
          .limit(500) // Limit to avoid token overflow
          .toArray();
      } catch (e) {
        this.logger.warn(`[WikiGardener] Could not fetch messages: ${e.message}`);
      }

      if (recentMessages.length < 10) {
        this.logger.info('[WikiGardener] Not enough recent messages to analyze.');
        return;
      }

      // Group messages by channel/thread to find coherent topics
      const conversations = this.groupMessages(recentMessages);
      const conversationSummary = conversations.map(c => 
        `Topic: ${c.channelName}\n${c.messages.map(m => `${m.author}: ${m.content}`).join('\n')}`
      ).join('\n\n');

      // 2. Get current wiki state (titles and categories)
      const articles = await this.wikiService.listArticles(null, { limit: 200 });
      const wikiState = articles.map(a => `- ${a.title} (${a.category})`).join('\n');

      // 3. Plan improvements using AI
      const plan = await this.planImprovements(conversationSummary, wikiState);
      
      if (!plan || plan.length === 0) {
        this.logger.info('[WikiGardener] No improvements planned.');
        return;
      }

      this.logger.info(`[WikiGardener] Executing ${plan.length} planned improvements...`);

      // 4. Execute plan
      for (const item of plan) {
        try {
          await this.executePlanItem(item, conversationSummary);
          // Wait a bit between actions to be polite to the AI API
          await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (e) {
          this.logger.error(`[WikiGardener] Failed to execute plan item ${item.action}: ${e.message}`);
        }
      }
      
      this.logger.info('[WikiGardener] Cycle completed successfully.');
      
    } catch (error) {
      this.logger.error(`[WikiGardener] Cycle failed: ${error.message}`);
    }
  }

  groupMessages(messages) {
    // Simple grouping by channelId
    const groups = {};
    for (const m of messages) {
      const key = m.channelId || 'unknown';
      if (!groups[key]) {
        groups[key] = {
          channelName: m.channelName || 'Unknown Channel',
          messages: []
        };
      }
      groups[key].messages.push({
        author: m.authorName || m.author || 'Unknown',
        content: m.content
      });
    }
    
    // Return top 5 most active channels
    return Object.values(groups)
      .sort((a, b) => b.messages.length - a.messages.length)
      .slice(0, 5);
  }

  async planImprovements(conversations, wikiState) {
    const prompt = `You are the Wiki Gardener for CosyWorld. Your job is to maintain the knowledge base.

CURRENT WIKI ARTICLES:
${wikiState}

RECENT CONVERSATIONS (last 24h):
${conversations}

Analyze the conversations and identify:
1. New topics that should be documented (missing from wiki).
2. Existing articles that need updates based on new information.

Return a JSON array of actions. Format:
[
  { "action": "create", "title": "Title", "reason": "Why this is needed", "context_focus": "What to focus on" },
  { "action": "update", "slug": "slug-of-article", "reason": "What changed", "context_focus": "New info to add" }
]

Limit to 3 most important actions. If nothing needs doing, return [].`;

    try {
      const response = await this.ai.chat([
        { role: 'system', content: 'You are a helpful knowledge base manager. Output only valid JSON.' },
        { role: 'user', content: prompt }
      ], { temperature: 0.2, response_format: { type: 'json_object' } });

      let text = response.text || response;
      // Clean up markdown code blocks if present
      if (typeof text === 'string') {
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        try {
            const result = JSON.parse(text);
            return Array.isArray(result) ? result : (result.actions || []);
        } catch {
            // Fallback if JSON parse fails
            return [];
        }
      }
      return text.actions || [];
    } catch (e) {
      this.logger.error(`[WikiGardener] Planning failed: ${e.message}`);
      return [];
    }
  }

  async executePlanItem(item, fullContext) {
    this.logger.info(`[WikiGardener] Executing: ${item.action} ${item.title || item.slug}`);
    
    if (item.action === 'create') {
      // Deduplication check: Search for semantically similar articles
      try {
        const similar = await this.wikiService.search(item.title, { limit: 1, semantic: true });
        if (similar.length > 0 && similar[0].similarity > 0.85) {
          this.logger.info(`[WikiGardener] Skipping creation of "${item.title}" - too similar to existing "${similar[0].title}" (${similar[0].slug})`);
          // Switch to update mode for the existing article
          item.action = 'update';
          item.slug = similar[0].slug;
        }
      } catch (e) {
        this.logger.warn(`[WikiGardener] Deduplication check failed: ${e.message}`);
      }
    }

    if (item.action === 'create') {
      const { content, summary } = await this.generateContent(item.title, item.context_focus, fullContext);
      await this.wikiService.createArticle({
        title: item.title,
        content,
        summary,
        category: 'auto-generated',
        authorName: 'Wiki Gardener',
        tags: ['auto-generated', 'gardener']
      });
      
    } else if (item.action === 'update') {
      const article = await this.wikiService.getArticle(item.slug, false);
      if (!article) return;
      
      const { content, summary } = await this.updateContent(article, item.context_focus, fullContext);
      await this.wikiService.updateArticle(
        item.slug,
        { content, summary },
        'system-gardener',
        'Wiki Gardener',
        item.reason
      );
    }
  }

  async generateContent(title, focus, context) {
    const prompt = `Write a wiki article titled "${title}".
    
FOCUS: ${focus}

SOURCE MATERIAL:
${context}

Return a JSON object with:
{
  "content": "The full article in Markdown.",
  "summary": "A concise 2-3 sentence summary for quick retrieval."
}`;

    try {
      const response = await this.ai.chat([
        { role: 'system', content: 'Output valid JSON only.' },
        { role: 'user', content: prompt }
      ], { response_format: { type: 'json_object' } });
      
      let text = response.text || response;
      if (typeof text === 'string') {
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(text);
      }
      return text;
    } catch (e) {
      // Fallback to text-only if JSON fails
      const text = await this.ai.chat([{ role: 'user', content: prompt }]);
      return { content: text.text || text, summary: null };
    }
  }

  async updateContent(article, focus, context) {
    const prompt = `Update this wiki article with new information.

CURRENT CONTENT:
${article.content}

NEW INFORMATION FOCUS: ${focus}

SOURCE MATERIAL:
${context}

Return a JSON object with:
{
  "content": "The fully updated article content in Markdown.",
  "summary": "A concise 2-3 sentence summary of the updated article."
}`;

    try {
      const response = await this.ai.chat([
        { role: 'system', content: 'Output valid JSON only.' },
        { role: 'user', content: prompt }
      ], { response_format: { type: 'json_object' } });

      let text = response.text || response;
      if (typeof text === 'string') {
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(text);
      }
      return text;
    } catch (e) {
       // Fallback
       const text = await this.ai.chat([{ role: 'user', content: prompt }]);
       return { content: text.text || text, summary: null };
    }
  }
}
