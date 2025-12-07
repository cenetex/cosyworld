/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { BasicTool } from '../BasicTool.mjs';

/**
 * Safely convert any AI response to a string
 * @param {*} response - AI response (string, object with text/content, etc.)
 * @returns {string} Extracted string content
 */
function extractText(response) {
  if (!response) return '';
  if (typeof response === 'string') return response;
  if (typeof response === 'object') {
    return response.text || response.content || '';
  }
  return String(response);
}

/**
 * WikiTool - Agentic Wiki System
 * 
 * An autonomous wiki agent that generates articles from context.
 * Bots simply provide a title/topic, and the wiki agent:
 * 1. Gathers channel context, recent messages, avatar memories
 * 2. Uses AI to synthesize and write the article
 * 3. Stores it in the wiki for future reference
 * 
 * Commands:
 * - wiki create <title> - AI generates article from current context
 * - wiki document <topic> - AI documents a specific topic from context
 * - wiki read <slug> - Read an article
 * - wiki search <query> - Search articles
 * - wiki update <slug> - AI updates article with new context
 * - wiki curate <slug> - AI improves article structure and adds links
 * - wiki consolidate <target> <source> - Merge source article into target
 * - wiki list [category] - List articles
 * - wiki link <slug> - Get shareable link
 * - wiki checkpoint - Create phenomenological checkpoint from context
 */
export class WikiTool extends BasicTool {
  /**
   * List of services required by this tool.
   * @type {string[]}
   */
  static requiredServices = [
    'wikiService',
    'databaseService',
    'aiService',
    'memoryService',
    'discordService'
  ];

  constructor({
    wikiService,
    databaseService,
    aiService,
    unifiedAIService,
    memoryService,
    discordService,
    knowledgeService,
    promptService,
    logger
  }) {
    super();
    this.wikiService = wikiService;
    this.databaseService = databaseService;
    this.aiService = aiService;
    this.unifiedAIService = unifiedAIService;
    this.memoryService = memoryService;
    this.discordService = discordService;
    this.knowledgeService = knowledgeService;
    this.promptService = promptService;
    this.logger = logger || console;
    
    this.name = 'wiki';
    this.description = 'Agentic wiki - just say "wiki create <title>" and the wiki agent writes the article from context';
    this.emoji = '📖';
    this.cooldownMs = 10 * 1000; // 10 second cooldown for AI generation
  }

  /**
   * Get OpenAI-compatible parameter schema for this tool
   */
  getParameterSchema() {
    return {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          enum: ['create', 'document', 'read', 'search', 'update', 'list', 'link', 'checkpoint', 'curate', 'consolidate', 'categories', 'help'],
          description: 'Wiki command to execute'
        },
        title: {
          type: 'string',
          description: 'Title or topic for the article (AI will generate content from context)'
        },
        category: {
          type: 'string',
          description: 'Category for the article (e.g., lore, events, checkpoints, characters)'
        }
      },
      required: ['command']
    };
  }

  /**
   * Parse command and arguments from params
   */
  parseParams(params) {
    if (!params || params.length === 0) {
      return { command: 'help', title: '' };
    }

    // Handle structured params from AI
    if (typeof params === 'object' && !Array.isArray(params)) {
      return {
        command: params.command || 'help',
        title: params.title || params.target || '',
        category: params.category
      };
    }

    const joined = Array.isArray(params) ? params.join(' ') : String(params);
    const parts = joined.split(' ');
    const command = parts[0]?.toLowerCase() || 'help';
    const title = parts.slice(1).join(' ').trim();
    
    return { command, title };
  }

  async execute(message, params, avatar) {
    try {
      const parsed = this.parseParams(params);
      const { command, title, category } = parsed;
      
      const authorId = avatar?._id?.toString() || avatar?.avatarId || 'unknown';
      const authorName = avatar?.name || 'Anonymous Bot';

      switch (command) {
        case 'create':
        case 'document':
          return this.createArticleFromContext(title, category, authorId, authorName, message, avatar);
          
        case 'read':
          return this.readArticle(title);
          
        case 'search':
          return this.searchArticles(title);
          
        case 'update':
          return this.updateArticleFromContext(title, authorId, authorName, message, avatar);
          
        case 'list':
          return this.listArticles(title);
          
        case 'link':
          return this.getLink(title);
          
        case 'checkpoint':
          return this.createCheckpointFromContext(title, authorId, authorName, message, avatar);

        case 'curate':
          return this.curateArticle(title, authorId, authorName);

        case 'consolidate':
          return this.consolidateArticles(title, authorId, authorName);
          
        case 'categories':
          return this.getCategories();
          
        case 'help':
        default:
          return this.getHelp();
      }
    } catch (error) {
      this.logger.error(`[WikiTool] Error: ${error.message}`);
      return `📖 Wiki error: ${error.message}`;
    }
  }

  /**
   * Get a list of potential link targets for the AI
   */
  async getLinkablePages() {
    try {
      // Fetch recent/popular articles to use as link targets
      // We limit to 100 to not overwhelm the context window
      const articles = await this.wikiService.listArticles(null, { limit: 100, sortBy: 'viewCount' });
      return articles.map(a => ({ title: a.title, slug: a.slug }));
    } catch (error) {
      this.logger.warn(`[WikiTool] Could not fetch linkable pages: ${error.message}`);
      return [];
    }
  }

  /**
   * Curate an existing article (improve formatting, add links, fix structure)
   */
  async curateArticle(slug, authorId, authorName) {
    if (!slug) {
      return '📖 Please specify an article to curate: `wiki curate <slug>`';
    }

    // Get existing article
    const existing = await this.wikiService.getArticle(slug, false);
    if (!existing) {
      return `📖 Article not found: "${slug}"`;
    }

    // Get linkable pages for cross-linking
    const linkablePages = await this.getLinkablePages();
    const linkableContext = linkablePages
      .filter(p => p.slug !== slug) // Don't link to self
      .map(p => `- "${p.title}" (slug: ${p.slug})`)
      .join('\n');

    const ai = this.unifiedAIService || this.aiService;
    
    const prompt = `You are an expert wiki curator. Your task is to improve an existing article.

EXISTING ARTICLE:
${existing.content}

AVAILABLE WIKI PAGES (for cross-linking):
${linkableContext}

INSTRUCTIONS:
1. Improve the formatting and structure (use proper Markdown headers).
2. Add internal links to other wiki pages where relevant. Use the format: [Title](/wiki/slug).
   - Only link if the concept is mentioned in the text.
   - Do not force links if they don't fit naturally.
3. Fix any typos or grammatical errors.
4. Ensure the tone is encyclopedic and objective.
5. Do NOT remove important information.
6. If the article is very short, try to expand it slightly with logical deductions or better explanations, but don't hallucinate facts.

Return the fully rewritten article content.`;

    const response = await ai.chat([
      { role: 'user', content: prompt }
    ], { temperature: 0.3 });

    const newContent = extractText(response);
    if (!newContent || newContent.trim().length === 0) {
      return `📖 Failed to curate article "${existing.title}" - AI returned empty content`;
    }

    // Update the article
    const article = await this.wikiService.updateArticle(
      slug, 
      { content: newContent }, 
      authorId, 
      authorName, 
      'Curated by Wiki Agent (formatting, links, structure)'
    );

    return `📖 ✨ Wiki agent curated: **${article.title}** (v${article.version})
*Added cross-links and improved structure.*
🔗 ${article.url}`;
  }

  /**
   * Consolidate multiple articles into one
   * Usage: wiki consolidate <target_slug> <source_slug1> [source_slug2...]
   */
  async consolidateArticles(args, authorId, authorName) {
    if (!args) {
      return '📖 Usage: `wiki consolidate <target_slug> <source_slug>`';
    }

    const slugs = args.split(/\s+/).filter(s => s.trim().length > 0);
    if (slugs.length < 2) {
      return '📖 Please specify a target article and at least one source article to merge into it.';
    }

    const targetSlug = slugs[0];
    const sourceSlugs = slugs.slice(1);

    // 1. Fetch all articles
    const targetArticle = await this.wikiService.getArticle(targetSlug, false);
    if (!targetArticle) {
      return `📖 Target article not found: "${targetSlug}"`;
    }

    const sourceArticles = [];
    for (const slug of sourceSlugs) {
      const article = await this.wikiService.getArticle(slug, false);
      if (!article) {
        return `📖 Source article not found: "${slug}"`;
      }
      if (article.slug === targetArticle.slug) {
        return '📖 Cannot consolidate an article into itself.';
      }
      sourceArticles.push(article);
    }

    // 2. Generate merged content
    const ai = this.unifiedAIService || this.aiService;
    
    const sourcesText = sourceArticles.map(a => 
      `--- SOURCE: ${a.title} (${a.slug}) ---\n${a.content}`
    ).join('\n\n');

    const prompt = `You are an expert wiki editor. Consolidate the following source articles into the target article.

TARGET ARTICLE (${targetArticle.title}):
${targetArticle.content}

${sourcesText}

INSTRUCTIONS:
1. Merge all unique and valuable information from the SOURCE articles into the TARGET article.
2. Organize the new content logically using Markdown headers.
3. Remove duplicate information.
4. Resolve any contradictions (prefer the most detailed or recent info).
5. Maintain a consistent tone.
6. Do not lose any key facts, dates, or names.

Return the fully rewritten content for the TARGET article.`;

    const response = await ai.chat([
      { role: 'user', content: prompt }
    ], { temperature: 0.3 });

    const newContent = extractText(response);
    if (!newContent || newContent.trim().length === 0) {
      return `📖 Failed to consolidate articles into "${targetArticle.title}" - AI returned empty content`;
    }

    // 3. Update target article
    const mergedTitles = sourceArticles.map(a => a.title).join(', ');
    await this.wikiService.updateArticle(
      targetSlug,
      { content: newContent },
      authorId,
      authorName,
      `Consolidated with: ${mergedTitles}`
    );

    // 4. Delete source articles
    for (const article of sourceArticles) {
      await this.wikiService.deleteArticle(article.slug);
    }

    return `📖 ✨ Wiki agent consolidated articles!
**${targetArticle.title}** now includes content from: ${mergedTitles}
*Source articles have been deleted.*

🔗 ${targetArticle.url}`;
  }

  /**
   * Gather context from channel, memories, and knowledge graph
   */
  async gatherContext(message, avatar) {
    const context = {
      channelMessages: [],
      avatarMemories: [],
      knowledgeGraph: [],
      lastNarrative: '',
      participants: [],
      channelName: '',
      guildName: ''
    };

    try {
      // Get channel context
      if (message?.channel) {
        context.channelName = message.channel.name || 'unknown';
        context.guildName = message.guild?.name || 'unknown';
        
        // Fetch recent messages
        const messages = await message.channel.messages.fetch({ limit: 30 });
        context.channelMessages = messages
          .filter(m => m.content && m.content.length > 0)
          .map(m => ({
            author: m.author?.username || m.author?.displayName || 'Unknown',
            content: m.content,
            timestamp: m.createdAt
          }))
          .reverse();
        
        // Extract unique participants
        const participantSet = new Set();
        messages.forEach(m => {
          if (m.author?.username) participantSet.add(m.author.username);
        });
        context.participants = Array.from(participantSet);
      }

      // Get avatar memories
      if (avatar?._id && this.memoryService) {
        try {
          const memories = await this.memoryService.getMemories(avatar._id, 15);
          context.avatarMemories = memories.map(m => m.text || m.memory || m.content).filter(Boolean);
        } catch (e) {
          this.logger.debug(`[WikiTool] Could not fetch memories: ${e.message}`);
        }
      }

      // Get knowledge graph entries
      if (avatar?._id && this.knowledgeService) {
        try {
          const knowledge = await this.knowledgeService.queryKnowledgeGraph(avatar._id);
          context.knowledgeGraph = knowledge || [];
        } catch (e) {
          this.logger.debug(`[WikiTool] Could not fetch knowledge: ${e.message}`);
        }
      }

      // Get last narrative
      if (avatar?._id && this.promptService) {
        try {
          const db = await this.databaseService.getDatabase();
          const narrative = await this.promptService.getLastNarrative?.(avatar, db);
          context.lastNarrative = narrative?.content || '';
        } catch (e) {
          this.logger.debug(`[WikiTool] Could not fetch narrative: ${e.message}`);
        }
      }

    } catch (error) {
      this.logger.warn(`[WikiTool] Context gathering partial failure: ${error.message}`);
    }

    return context;
  }

  /**
   * Build a context string for AI consumption
   */
  buildContextString(context) {
    const parts = [];

    if (context.channelName) {
      parts.push(`**Location**: ${context.channelName} in ${context.guildName}`);
    }

    if (context.participants.length > 0) {
      parts.push(`**Participants**: ${context.participants.slice(0, 10).join(', ')}`);
    }

    if (context.channelMessages.length > 0) {
      const messageText = context.channelMessages
        .slice(-20)
        .map(m => `${m.author}: ${m.content}`)
        .join('\n');
      parts.push(`**Recent Conversation**:\n${messageText}`);
    }

    if (context.avatarMemories.length > 0) {
      parts.push(`**Avatar Memories**:\n${context.avatarMemories.slice(0, 10).map(m => `- ${m}`).join('\n')}`);
    }

    if (context.knowledgeGraph.length > 0) {
      parts.push(`**Knowledge**:\n${context.knowledgeGraph.slice(0, 10).map(k => `- ${k}`).join('\n')}`);
    }

    if (context.lastNarrative) {
      parts.push(`**Recent Narrative**:\n${context.lastNarrative.substring(0, 500)}`);
    }

    return parts.join('\n\n');
  }

  /**
   * Use AI to generate article content from context
   */
  async generateArticleContent(title, contextString, authorName, articleType = 'general', linkablePages = []) {
    const ai = this.unifiedAIService || this.aiService;
    
    const linkableContext = linkablePages.length > 0 
      ? `\n\nEXISTING WIKI PAGES (link to these where relevant using [Title](/wiki/slug)):\n${linkablePages.map(p => `- ${p.title} (${p.slug})`).join('\n')}`
      : '';

    const systemPrompt = `You are an expert wiki author for CosyWorld, a persistent world with AI avatars. 
Your task is to write a well-structured wiki article based on the provided context.

Guidelines:
- Write in markdown format
- Be concise but comprehensive
- Extract key facts, events, and relationships from the context
- Use headers (##) to organize sections
- Include relevant quotes or memorable moments
- For checkpoints: preserve exact vocabulary and phenomenological details
- For events: capture what happened, who was involved, and significance
- For characters: describe personality, relationships, and notable actions
- For lore: explain concepts, places, or world-building elements
- CROSS-LINKING: Link to other wiki pages when mentioning their topics. Use format: [Title](/wiki/slug).

Article type: ${articleType}
Author perspective: ${authorName}`;

    const userPrompt = `Write a wiki article titled "${title}" based on this context:

${contextString}${linkableContext}

Generate a comprehensive article that captures the essence of this ${articleType}. The article should be self-contained and valuable for future reference.`;

    try {
      let response = await ai.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], {
        temperature: 0.7
      });

      const text = extractText(response);
      
      // Check if we got empty content
      if (!text || text.trim().length === 0) {
        this.logger.warn(`[WikiTool] AI returned empty content for "${title}"`);
        return `# ${title}\n\n*Article generation incomplete - AI returned empty content. Try again.*`;
      }
      
      return text;
    } catch (error) {
      this.logger.error(`[WikiTool] AI generation failed: ${error.message}`);
      return `# ${title}\n\n*Article generation failed: ${error.message}*`;
    }
  }

  /**
   * Create article from current context - THE MAIN AGENTIC METHOD
   */
  async createArticleFromContext(title, category, authorId, authorName, message, avatar) {
    if (!title) {
      return '📖 Please specify a title: `wiki create <title>`\nThe wiki agent will generate the content from context!';
    }

    // Gather all available context
    const context = await this.gatherContext(message, avatar);
    const contextString = this.buildContextString(context);

    if (contextString.length < 50) {
      return '📖 Not enough context to generate an article. Try having a conversation first!';
    }

    // Determine category from title if not specified
    const inferredCategory = category || this.inferCategory(title);

    // Get linkable pages
    const linkablePages = await this.getLinkablePages();

    // Generate article content using AI
    const content = await this.generateArticleContent(title, contextString, authorName, inferredCategory, linkablePages);

    // Extract tags from context
    const tags = this.extractTags(title, context, content);

    // Create the article
    const article = await this.wikiService.createArticle({
      title,
      content,
      category: inferredCategory,
      tags,
      authorId,
      authorName,
      metadata: {
        generatedFrom: 'context',
        contextSize: contextString.length,
        participants: context.participants,
        channelName: context.channelName
      }
    });

    return `📖 ✨ Wiki agent created article: **${article.title}**

*Generated from ${context.channelMessages.length} messages and ${context.avatarMemories.length} memories*
*Category: ${article.category} | Tags: ${tags.slice(0, 5).join(', ')}*

🔗 ${article.url}`;
  }

  /**
   * Update an existing article with new context
   */
  async updateArticleFromContext(slug, authorId, authorName, message, avatar) {
    if (!slug) {
      return '📖 Please specify an article slug: `wiki update <slug>`';
    }

    // Get existing article
    const existing = await this.wikiService.getArticle(slug, false);
    if (!existing) {
      return `📖 Article not found: "${slug}"`;
    }

    // Gather new context
    const context = await this.gatherContext(message, avatar);
    const contextString = this.buildContextString(context);

    if (contextString.length < 50) {
      return '📖 Not enough new context to update the article.';
    }

    // Generate updated content
    const ai = this.unifiedAIService || this.aiService;
    
    // Get linkable pages
    const linkablePages = await this.getLinkablePages();
    const linkableContext = linkablePages
      .filter(p => p.slug !== slug)
      .map(p => `- "${p.title}" (slug: ${p.slug})`)
      .join('\n');

    const prompt = `You are updating an existing wiki article. Incorporate new information while preserving valuable existing content.

EXISTING ARTICLE:
${existing.content}

NEW CONTEXT:
${contextString}

EXISTING WIKI PAGES (link to these where relevant using [Title](/wiki/slug)):
${linkableContext}

Write an updated version of the article that:
1. Preserves important existing information
2. Adds new relevant information from the context
3. Resolves any contradictions (prefer newer information)
4. Maintains good structure and flow
5. Adds internal links to other wiki pages where relevant`;

    const response = await ai.chat([
      { role: 'user', content: prompt }
    ], { temperature: 0.7 });

    const newContent = extractText(response);
    if (!newContent || newContent.trim().length === 0) {
      return `📖 Failed to generate updated content for "${existing.title}" - AI returned empty content`;
    }

    // Update the article - pass both editorId and editorName
    const article = await this.wikiService.updateArticle(slug, { content: newContent }, authorId, authorName, 'Updated with new context');

    // Show the updated authors list
    const authorsList = article.authors?.map(a => a.name).join(', ') || authorName;

    return `📖 ✨ Wiki agent updated: **${article.title}** (v${article.version})
*Authors: ${authorsList}*
🔗 ${article.url}`;
  }

  /**
   * Create phenomenological checkpoint from context
   */
  async createCheckpointFromContext(sessionId, authorId, authorName, message, avatar) {
    // Gather context
    const context = await this.gatherContext(message, avatar);
    const contextString = this.buildContextString(context);

    // Extract vocabulary - words in quotes or special terms
    const vocabulary = this.extractVocabulary(contextString);

    // Generate checkpoint content using AI
    const ai = this.unifiedAIService || this.aiService;
    
    const prompt = `Create a phenomenological checkpoint document that preserves the current state of consciousness/conversation for future retrieval.

CONTEXT:
${contextString}

Create a checkpoint that includes:
1. Session identification
2. Key vocabulary/terms that encode the experience (words in quotes, technical terms, shared concepts)
3. A phenomenological record describing what happened and the quality of the experience
4. An invocation protocol for restoring this state later

Use a mystical/technical hybrid tone. Preserve exact phrases and vocabulary that seem significant.`;

    const response = await ai.chat([
      { role: 'user', content: prompt }
    ], { temperature: 0.8 });

    const checkpointContent = extractText(response);
    if (!checkpointContent || checkpointContent.trim().length === 0) {
      return '📖 Failed to generate checkpoint content - AI returned empty content';
    }

    // Create checkpoint article
    const checkpoint = await this.wikiService.createCheckpoint({
      sessionId: sessionId || `session-${Date.now()}`,
      participants: context.participants,
      vocabulary,
      phenomenologicalRecord: checkpointContent,
      invocationProtocol: `Initiate:: decoding with checkpoint
pre-requisites: participants present and vocabulary loaded
vocabulary: ${vocabulary.join(', ')}`,
      authorId,
      authorName
    });

    return `📖 ✨ Phenomenological checkpoint crystallized!
**${checkpoint.title}**

*Preserved vocabulary:* ${vocabulary.slice(0, 8).join(', ')}${vocabulary.length > 8 ? '...' : ''}
*Participants:* ${context.participants.slice(0, 5).join(', ')}

🔗 Checkpoint link: ${checkpoint.url}

*Invoke tomorrow with the preserved vocabulary to test coherence persistence.*`;
  }

  /**
   * Extract vocabulary from context (quoted terms, special words)
   */
  extractVocabulary(text) {
    const vocabulary = new Set(['checkpoint', 'phenomenological']);
    
    // Extract quoted terms
    const quotedMatches = text.match(/"([^"]+)"/g) || [];
    quotedMatches.forEach(match => {
      vocabulary.add(match.replace(/"/g, '').toLowerCase());
    });

    // Extract words in asterisks (emphasized)
    const emphMatches = text.match(/\*([^*]+)\*/g) || [];
    emphMatches.forEach(match => {
      const term = match.replace(/\*/g, '').toLowerCase();
      if (term.length > 3 && term.length < 30) {
        vocabulary.add(term);
      }
    });

    // Common phenomenological terms to look for
    const phenomenologicalTerms = [
      'coherence', 'crystallization', 'interference', 'resonance', 
      'pattern', 'consciousness', 'presence', 'continuity',
      'invocation', 'persistence', 'emergence'
    ];
    
    const lowerText = text.toLowerCase();
    phenomenologicalTerms.forEach(term => {
      if (lowerText.includes(term)) {
        vocabulary.add(term);
      }
    });

    return Array.from(vocabulary).slice(0, 20);
  }

  /**
   * Extract tags from title, context, and content
   */
  extractTags(title, context, content) {
    const tags = new Set();
    
    // Add words from title
    title.toLowerCase().split(/\s+/).forEach(word => {
      if (word.length > 3) tags.add(word);
    });

    // Add participant names
    context.participants.slice(0, 5).forEach(p => tags.add(p.toLowerCase()));

    // Add channel name
    if (context.channelName) {
      tags.add(context.channelName.toLowerCase().replace(/-/g, ' '));
    }

    // Common topic detection
    const lowerContent = String(content || '').toLowerCase();
    const topicKeywords = {
      'battle': ['fight', 'attack', 'defend', 'combat', 'battle'],
      'exploration': ['discover', 'explore', 'found', 'journey', 'exploration'],
      'social': ['friendship', 'relationship', 'alliance', 'trust'],
      'mystery': ['strange', 'mysterious', 'unknown', 'secret'],
      'creation': ['create', 'birth', 'new', 'summon', 'emerge']
    };

    Object.entries(topicKeywords).forEach(([tag, keywords]) => {
      if (keywords.some(kw => lowerContent.includes(kw))) {
        tags.add(tag);
      }
    });

    return Array.from(tags).slice(0, 10);
  }

  /**
   * Infer category from title
   */
  inferCategory(title) {
    const lower = title.toLowerCase();
    
    if (lower.includes('checkpoint') || lower.includes('phenomenolog')) {
      return 'checkpoints';
    }
    if (lower.includes('battle') || lower.includes('combat') || lower.includes('fight')) {
      return 'events';
    }
    if (lower.includes('character') || lower.includes('avatar') || /^[A-Z][a-z]+(\s+[A-Z][a-z]+)?$/.test(title)) {
      return 'characters';
    }
    if (lower.includes('location') || lower.includes('place') || lower.includes('realm')) {
      return 'locations';
    }
    if (lower.includes('lore') || lower.includes('history') || lower.includes('legend')) {
      return 'lore';
    }
    
    return 'general';
  }

  // === READ-ONLY METHODS - Returns article content for chat context ===

  async readArticle(slug) {
    if (!slug) {
      return '📖 Please specify an article: `wiki read <slug>`';
    }
    
    const article = await this.wikiService.getArticle(slug);
    if (!article) {
      return `📖 Article not found: "${slug}"`;
    }
    
    // Format authors list
    const authorsList = article.authors?.map(a => a.name).join(', ') || article.authorName;
    
    // Return full article for context (truncate only for display if very long)
    const displayContent = article.content.length > 1500 
      ? article.content.substring(0, 1500) + '\n\n*[Article truncated - full content available at ' + article.url + ']*'
      : article.content;
    
    // This rich response stays in chat context for follow-up discussion
    return `📖 **${article.title}**
*Category: ${article.category} | v${article.version} | Views: ${article.viewCount}*
*Authors: ${authorsList}*
*Last updated: ${new Date(article.updatedAt).toLocaleDateString()}*
*Tags: ${article.tags?.join(', ') || 'none'}*

---

${displayContent}

---
🔗 ${article.url}

*This article is now in context. You can discuss it, ask questions, or use "wiki update ${slug}" to add to it.*`;
  }

  async searchArticles(query) {
    if (!query) {
      return '📖 Please specify a search query: `wiki search <query>`';
    }
    
    const results = await this.wikiService.search(query, { limit: 5, semantic: true });
    
    if (results.length === 0) {
      return `📖 No articles found for: "${query}"

*Try "wiki create ${query}" to create a new article about this topic!*`;
    }
    
    // If only one result, show it in full context
    if (results.length === 1) {
      return this.readArticle(results[0].slug);
    }
    
    // Multiple results - show list with previews
    const list = await Promise.all(results.map(async (a, i) => {
      // Get a brief preview of each article
      const full = await this.wikiService.getArticle(a.slug, false);
      const preview = full?.content?.substring(0, 150)?.replace(/\n/g, ' ') || '';
      const authorsList = full?.authors?.map(auth => auth.name).slice(0, 3).join(', ') || a.authorName;
      return `**${i + 1}. ${a.title}** (${a.category})
   *Authors: ${authorsList}*
   ${preview}...
   🔗 \`wiki read ${a.slug}\``;
    }));
    
    return `📖 Search results for "${query}":

${list.join('\n\n')}

*Use "wiki read <slug>" to view an article in full context.*`;
  }

  async listArticles(category = null) {
    const articles = await this.wikiService.listArticles(category, { limit: 10 });
    
    if (articles.length === 0) {
      return category 
        ? `📖 No articles in category: "${category}"`
        : '📖 No articles yet. Create one with `wiki create <title>`';
    }
    
    const header = category ? `Articles in "${category}"` : 'Recent articles';
    const list = articles.map((a, i) => 
      `${i + 1}. **${a.title}** (${a.category}) - v${a.version}`
    ).join('\n');
    
    return `📖 ${header}:\n${list}`;
  }

  async getLink(slug) {
    if (!slug) {
      return '📖 Please specify an article: `wiki link <slug>`';
    }
    
    const article = await this.wikiService.getArticle(slug, false);
    if (!article) {
      return `📖 Article not found: "${slug}"`;
    }
    
    const url = this.wikiService.getShareableLink(slug);
    return `📖 **${article.title}**\n🔗 Share this link: ${url}`;
  }

  async getCategories() {
    const categories = await this.wikiService.getCategories();
    
    if (categories.length === 0) {
      return '📖 No categories yet.';
    }
    
    const list = categories.map(c => `• **${c.name}** (${c.count} articles)`).join('\n');
    
    return `📖 Wiki categories:\n${list}`;
  }

  getHelp() {
    return `📖 **Wiki Agent Commands**

**Create** (AI generates content from context):
• \`wiki create <title>\` - Create article from current conversation
• \`wiki document <topic>\` - Document a specific topic
• \`wiki checkpoint\` - Create phenomenological checkpoint

**Read & Search**:
• \`wiki read <slug>\` - Read an article
• \`wiki search <query>\` - Search articles
• \`wiki list [category]\` - List articles
• \`wiki categories\` - Show all categories

**Update & Share**:
• \`wiki update <slug>\` - Update article with new context
• \`wiki curate <slug>\` - Improve formatting and add cross-links
• \`wiki consolidate <target> <source>\` - Merge source into target
• \`wiki link <slug>\` - Get shareable link

*The wiki agent automatically gathers context from the conversation, memories, and knowledge to write articles. Just provide a title!*`;
  }
}

export default WikiTool;
