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
      
      // 5. Maintain user profiles
      await this.maintainUserProfiles(db);

    } catch (error) {
      this.logger.error(`[WikiGardener] Cycle failed: ${error.message}`);
    }
  }

  /**
   * Maintain wiki profiles for active citizens
   */
  async maintainUserProfiles(db) {
    this.logger.info('[WikiGardener] Checking citizen profiles...');
    
    try {
      // 1. Find top active users in last 7 days
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      
      const activeUsers = await db.collection('messages').aggregate([
        { 
          $match: { 
            createdAt: { $gte: sevenDaysAgo },
            authorName: { $exists: true, $ne: 'Unknown' },
            // Exclude bots if possible (heuristic: bots usually have 'Bot' in name or specific IDs, but for now just authorName)
            // We can filter out known bot names if we had a list
          } 
        },
        { 
          $group: { 
            _id: "$authorName", 
            count: { $sum: 1 }, 
            lastSeen: { $max: "$createdAt" }
          } 
        },
        { $match: { count: { $gt: 10 } } }, // Minimum 10 messages to be "active"
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]).toArray();

      if (activeUsers.length === 0) return;

      // 2. Check which users need a profile update/creation
      for (const user of activeUsers) {
        const username = user._id;
        // Skip if username looks like a bot (simple heuristic)
        if (username.toLowerCase().includes('bot') && !username.toLowerCase().includes('buy')) continue;

        // Check for existing article
        // We search by title exact match first
        const existing = await this.wikiService.search(username, { limit: 1, category: 'citizens' });
        let article = existing.find(a => a.title.toLowerCase() === username.toLowerCase());
        
        // If not found by exact title, try slug
        if (!article) {
            const slug = this.wikiService.generateSlug(username);
            article = await this.wikiService.getArticle(slug, false);
        }

        const needsUpdate = !article || 
          (article.lastVerifiedAt && new Date(article.lastVerifiedAt) < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)); // Update weekly

        if (needsUpdate) {
          this.logger.info(`[WikiGardener] Generating citizen profile for: ${username}`);
          await this.generateUserProfile(db, username, article);
          // Only process one user per cycle to be polite to rate limits
          break; 
        }
      }
    } catch (error) {
      this.logger.error(`[WikiGardener] User profile maintenance failed: ${error.message}`);
    }
  }

  async generateUserProfile(db, username, existingArticle) {
    // Fetch user's recent messages to analyze personality
    const messages = await db.collection('messages')
      .find({ authorName: username })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    if (messages.length === 0) return;

    const messageSample = messages.map(m => m.content).join('\n');
    const firstSeen = messages[messages.length - 1].createdAt;
    const lastSeen = messages[0].createdAt;

    const prompt = `You are a biographer for CosyWorld citizens. Write a wiki profile for the user "${username}".

USER MESSAGES SAMPLE:
${messageSample}

STATS:
- First observed: ${firstSeen}
- Last active: ${lastSeen}
- Total tracked messages (sample): ${messages.length}

INSTRUCTIONS:
1. Write a "Citizen Profile" in Markdown.
2. Describe their personality, communication style, and interests based on their messages.
3. Mention any specific topics they frequently discuss.
4. Keep it positive, mythical, and lore-friendly (treat them as a character in the world).
5. Do NOT include private info, only what is public in the chat.
6. If updating, preserve any existing "Notable Events" if they look manually added.

${existingArticle ? `EXISTING CONTENT TO RESPECT:\n${existingArticle.content}` : ''}

Return a JSON object with:
{
  "content": "Full markdown content",
  "summary": "2-3 sentence summary"
}`;

    try {
      const response = await this.ai.chat([
        { role: 'system', content: 'Output valid JSON only.' },
        { role: 'user', content: prompt }
      ], { response_format: { type: 'json_object' } });

      let result;
      let text = response.text || response;
      if (typeof text === 'string') {
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        result = JSON.parse(text);
      } else {
        result = text;
      }

      if (existingArticle) {
        await this.wikiService.updateArticle(
          existingArticle.slug,
          { 
            content: result.content, 
            summary: result.summary,
            category: 'citizens',
            tags: ['citizen', 'user', ...existingArticle.tags || []]
          },
          'system-gardener',
          'Wiki Gardener',
          'Routine profile update'
        );
      } else {
        await this.wikiService.createArticle({
          title: username,
          content: result.content,
          summary: result.summary,
          category: 'citizens',
          authorName: 'Wiki Gardener',
          tags: ['citizen', 'user']
        });
      }
    } catch (e) {
      this.logger.error(`[WikiGardener] Failed to generate profile for ${username}: ${e.message}`);
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
    } catch {
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
    } catch {
       // Fallback
       const text = await this.ai.chat([{ role: 'user', content: prompt }]);
       return { content: text.text || text, summary: null };
    }
  }
}
