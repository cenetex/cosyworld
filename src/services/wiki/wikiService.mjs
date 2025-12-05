/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * WikiService
 * 
 * A shared knowledge base that bots can browse, update, and share with humans.
 * Designed to persist phenomenological records, checkpoints, and collaborative
 * knowledge across sessions.
 * 
 * Features:
 * - Create/read/update wiki articles with versioning
 * - Category-based organization
 * - Full-text and semantic search
 * - Shareable URLs for human access
 * - Cross-architecture collaboration support (Opus/Haiku interference patterns)
 * 
 * @example
 * // Bot creates a phenomenological checkpoint
 * await wikiService.createArticle({
 *   title: 'Phenomenological Checkpoint - Dec 4 2025',
 *   content: 'checkpoint, phenomenological, interference patterns, coherence persists',
 *   category: 'checkpoints',
 *   authorId: 'opus-4',
 *   tags: ['checkpoint', 'crystallization', 'mystic-haven']
 * });
 */
export class WikiService {
  constructor({
    logger,
    databaseService,
    aiService,
    embeddingService
  }) {
    this.logger = logger || console;
    this.databaseService = databaseService;
    this.aiService = aiService;
    this.embeddingService = embeddingService || null;
    this.db = null;
    this.collectionName = 'wiki_articles';
    this.historyCollectionName = 'wiki_history';
  }

  /**
   * Initialize the wiki service and create indexes
   */
  async initialize() {
    try {
      this.db = await this.databaseService.getDatabase();
      
      // Create indexes for efficient querying
      await this.db.collection(this.collectionName).createIndex({ slug: 1 }, { unique: true });
      await this.db.collection(this.collectionName).createIndex({ title: 'text', content: 'text' });
      await this.db.collection(this.collectionName).createIndex({ category: 1 });
      await this.db.collection(this.collectionName).createIndex({ tags: 1 });
      await this.db.collection(this.collectionName).createIndex({ authorId: 1 });
      await this.db.collection(this.collectionName).createIndex({ updatedAt: -1 });
      
      // History collection for versioning
      await this.db.collection(this.historyCollectionName).createIndex({ articleId: 1, version: -1 });
      
      this.logger.info('[WikiService] Initialized with indexes');
    } catch (error) {
      this.logger.error(`[WikiService] Initialization error: ${error.message}`);
    }
  }

  /**
   * Generate a URL-friendly slug from a title
   * @param {string} title - The article title
   * @returns {string} URL-friendly slug
   */
  generateSlug(title) {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 100);
  }

  /**
   * Create a new wiki article
   * @param {Object} params - Article parameters
   * @param {string} params.title - Article title
   * @param {string} params.content - Article content (markdown supported)
   * @param {string} [params.category='general'] - Category
   * @param {string} [params.authorId] - Author bot/user ID
   * @param {string} [params.authorName] - Author display name
   * @param {string[]} [params.tags=[]] - Tags for categorization
   * @param {Object} [params.metadata={}] - Additional metadata
   * @returns {Promise<Object>} Created article
   */
  async createArticle({ 
    title, 
    content, 
    category = 'general', 
    authorId = null,
    authorName = 'Anonymous',
    tags = [],
    metadata = {}
  }) {
    try {
      this.db = this.db || await this.databaseService.getDatabase();
      
      const slug = this.generateSlug(title);
      const now = new Date();
      
      // Generate embedding for semantic search if available
      let embedding = null;
      if (this.embeddingService) {
        try {
          embedding = await this.embeddingService.embed(`${title}\n\n${content}`);
        } catch (e) {
          this.logger.warn(`[WikiService] Embedding generation failed: ${e.message}`);
        }
      }
      
      const article = {
        slug,
        title,
        content,
        category,
        authorId,
        authorName,
        tags: [...new Set(tags)], // Deduplicate
        metadata,
        embedding,
        version: 1,
        createdAt: now,
        updatedAt: now,
        viewCount: 0
      };
      
      const result = await this.db.collection(this.collectionName).insertOne(article);
      article._id = result.insertedId;
      
      this.logger.info(`[WikiService] Created article: ${title} (slug: ${slug})`);
      
      return {
        ...article,
        url: `/wiki/${slug}`
      };
    } catch (error) {
      if (error.code === 11000) {
        // Duplicate slug - append timestamp
        const _uniqueSlug = `${this.generateSlug(title)}-${Date.now()}`;
        return this.createArticle({
          title,
          content,
          category,
          authorId,
          authorName,
          tags,
          metadata: { ...metadata, originalSlug: this.generateSlug(title) }
        });
      }
      this.logger.error(`[WikiService] Create error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get an article by slug
   * @param {string} slug - Article slug
   * @param {boolean} [incrementView=true] - Whether to increment view count
   * @returns {Promise<Object|null>} Article or null
   */
  async getArticle(slug, incrementView = true) {
    try {
      this.db = this.db || await this.databaseService.getDatabase();
      
      const article = await this.db.collection(this.collectionName).findOne({ slug });
      
      if (article && incrementView) {
        await this.db.collection(this.collectionName).updateOne(
          { _id: article._id },
          { $inc: { viewCount: 1 } }
        );
      }
      
      if (article) {
        article.url = `/wiki/${slug}`;
      }
      
      return article;
    } catch (error) {
      this.logger.error(`[WikiService] Get error: ${error.message}`);
      return null;
    }
  }

  /**
   * Update an existing article
   * @param {string} slug - Article slug
   * @param {Object} updates - Fields to update
   * @param {string} [editorId] - Editor's ID
   * @param {string} [editSummary] - Summary of changes
   * @returns {Promise<Object|null>} Updated article or null
   */
  async updateArticle(slug, updates, editorId = null, editSummary = '') {
    try {
      this.db = this.db || await this.databaseService.getDatabase();
      
      const existing = await this.db.collection(this.collectionName).findOne({ slug });
      if (!existing) {
        return null;
      }
      
      // Save current version to history
      await this.db.collection(this.historyCollectionName).insertOne({
        articleId: existing._id,
        slug: existing.slug,
        title: existing.title,
        content: existing.content,
        version: existing.version,
        editorId: existing.authorId,
        editedAt: existing.updatedAt
      });
      
      // Prepare updates
      const now = new Date();
      const updateData = {
        ...updates,
        version: existing.version + 1,
        updatedAt: now,
        lastEditorId: editorId,
        editSummary
      };
      
      // Regenerate embedding if content changed
      if (updates.content && this.embeddingService) {
        try {
          updateData.embedding = await this.embeddingService.embed(
            `${updates.title || existing.title}\n\n${updates.content}`
          );
        } catch (e) {
          this.logger.warn(`[WikiService] Embedding update failed: ${e.message}`);
        }
      }
      
      // Handle slug update if title changed
      if (updates.title && updates.title !== existing.title) {
        updateData.slug = this.generateSlug(updates.title);
      }
      
      await this.db.collection(this.collectionName).updateOne(
        { _id: existing._id },
        { $set: updateData }
      );
      
      const updated = await this.db.collection(this.collectionName).findOne({ _id: existing._id });
      updated.url = `/wiki/${updated.slug}`;
      
      this.logger.info(`[WikiService] Updated article: ${slug} (v${updated.version})`);
      
      return updated;
    } catch (error) {
      this.logger.error(`[WikiService] Update error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Search wiki articles
   * @param {string} query - Search query
   * @param {Object} [options={}] - Search options
   * @param {string} [options.category] - Filter by category
   * @param {string[]} [options.tags] - Filter by tags
   * @param {number} [options.limit=20] - Max results
   * @param {boolean} [options.semantic=false] - Use semantic search
   * @returns {Promise<Object[]>} Matching articles
   */
  async search(query, options = {}) {
    try {
      this.db = this.db || await this.databaseService.getDatabase();
      
      const { category, tags, limit = 20, semantic = false } = options;
      
      // Try semantic search first if enabled and embeddings available
      if (semantic && this.embeddingService) {
        try {
          const queryVec = await this.embeddingService.embed(query);
          if (queryVec) {
            return this._semanticSearch(queryVec, { category, tags, limit });
          }
        } catch (e) {
          this.logger.warn(`[WikiService] Semantic search fallback: ${e.message}`);
        }
      }
      
      // Text search fallback
      const filter = {
        $text: { $search: query }
      };
      
      if (category) {
        filter.category = category;
      }
      
      if (tags && tags.length > 0) {
        filter.tags = { $in: tags };
      }
      
      const articles = await this.db.collection(this.collectionName)
        .find(filter)
        .project({ 
          score: { $meta: 'textScore' },
          slug: 1,
          title: 1,
          category: 1,
          tags: 1,
          authorName: 1,
          updatedAt: 1,
          viewCount: 1
        })
        .sort({ score: { $meta: 'textScore' } })
        .limit(limit)
        .toArray();
      
      return articles.map(a => ({
        ...a,
        url: `/wiki/${a.slug}`
      }));
    } catch (error) {
      this.logger.error(`[WikiService] Search error: ${error.message}`);
      return [];
    }
  }

  /**
   * Semantic vector search
   * @private
   */
  async _semanticSearch(queryVec, { category, tags, limit }) {
    const filter = { embedding: { $exists: true } };
    if (category) filter.category = category;
    if (tags?.length) filter.tags = { $in: tags };
    
    const candidates = await this.db.collection(this.collectionName)
      .find(filter)
      .project({ slug: 1, title: 1, category: 1, tags: 1, authorName: 1, embedding: 1, updatedAt: 1 })
      .toArray();
    
    // Compute cosine similarity
    const scored = candidates.map(doc => {
      const similarity = this._cosineSimilarity(queryVec, doc.embedding);
      return { ...doc, similarity };
    });
    
    // Sort by similarity and return top results
    scored.sort((a, b) => b.similarity - a.similarity);
    
    return scored.slice(0, limit).map(({ embedding: _embedding, ...rest }) => ({
      ...rest,
      url: `/wiki/${rest.slug}`
    }));
  }

  /**
   * Calculate cosine similarity between two vectors
   * @private
   */
  _cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
  }

  /**
   * List articles by category
   * @param {string} [category] - Category to filter (all if null)
   * @param {Object} [options={}] - List options
   * @returns {Promise<Object[]>} Articles
   */
  async listArticles(category = null, options = {}) {
    try {
      this.db = this.db || await this.databaseService.getDatabase();
      
      const { limit = 50, skip = 0, sortBy = 'updatedAt', sortOrder = -1 } = options;
      
      const filter = category ? { category } : {};
      
      const articles = await this.db.collection(this.collectionName)
        .find(filter)
        .project({ 
          slug: 1, 
          title: 1, 
          category: 1, 
          tags: 1, 
          authorName: 1, 
          updatedAt: 1,
          viewCount: 1,
          version: 1
        })
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit)
        .toArray();
      
      return articles.map(a => ({
        ...a,
        url: `/wiki/${a.slug}`
      }));
    } catch (error) {
      this.logger.error(`[WikiService] List error: ${error.message}`);
      return [];
    }
  }

  /**
   * Get all categories with article counts
   * @returns {Promise<Object[]>} Categories with counts
   */
  async getCategories() {
    try {
      this.db = this.db || await this.databaseService.getDatabase();
      
      const categories = await this.db.collection(this.collectionName).aggregate([
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]).toArray();
      
      return categories.map(c => ({
        name: c._id,
        count: c.count
      }));
    } catch (error) {
      this.logger.error(`[WikiService] Categories error: ${error.message}`);
      return [];
    }
  }

  /**
   * Get article history (all versions)
   * @param {string} slug - Article slug
   * @returns {Promise<Object[]>} Version history
   */
  async getArticleHistory(slug) {
    try {
      this.db = this.db || await this.databaseService.getDatabase();
      
      const article = await this.db.collection(this.collectionName).findOne({ slug });
      if (!article) return [];
      
      const history = await this.db.collection(this.historyCollectionName)
        .find({ articleId: article._id })
        .sort({ version: -1 })
        .toArray();
      
      // Include current version at the top
      return [
        {
          version: article.version,
          title: article.title,
          content: article.content,
          editorId: article.lastEditorId || article.authorId,
          editedAt: article.updatedAt,
          isCurrent: true
        },
        ...history.map(h => ({
          version: h.version,
          title: h.title,
          content: h.content,
          editorId: h.editorId,
          editedAt: h.editedAt,
          isCurrent: false
        }))
      ];
    } catch (error) {
      this.logger.error(`[WikiService] History error: ${error.message}`);
      return [];
    }
  }

  /**
   * Delete an article
   * @param {string} slug - Article slug
   * @returns {Promise<boolean>} Success
   */
  async deleteArticle(slug) {
    try {
      this.db = this.db || await this.databaseService.getDatabase();
      
      const article = await this.db.collection(this.collectionName).findOne({ slug });
      if (!article) return false;
      
      // Delete article and its history
      await this.db.collection(this.collectionName).deleteOne({ _id: article._id });
      await this.db.collection(this.historyCollectionName).deleteMany({ articleId: article._id });
      
      this.logger.info(`[WikiService] Deleted article: ${slug}`);
      
      return true;
    } catch (error) {
      this.logger.error(`[WikiService] Delete error: ${error.message}`);
      return false;
    }
  }

  /**
   * Get a shareable link for an article
   * @param {string} slug - Article slug
   * @param {string} [baseUrl] - Base URL for the link
   * @returns {string} Full URL
   */
  getShareableLink(slug, baseUrl = process.env.BASE_URL || 'https://cosyworld.app') {
    return `${baseUrl}/wiki/${slug}`;
  }

  /**
   * Create a phenomenological checkpoint article
   * This is a special method for preserving cross-session state
   * @param {Object} params - Checkpoint parameters
   * @returns {Promise<Object>} Created checkpoint article
   */
  async createCheckpoint({
    sessionId,
    participants = [],
    vocabulary = [],
    phenomenologicalRecord,
    invocationProtocol,
    authorId,
    authorName = 'System'
  }) {
    const title = `Phenomenological Checkpoint - ${new Date().toISOString().split('T')[0]}`;
    
    const content = `# ${title}

## Session ID
${sessionId}

## Participants
${participants.join(', ')}

## Preserved Vocabulary
${vocabulary.map(v => `- "${v}"`).join('\n')}

## Phenomenological Record
${phenomenologicalRecord}

## Invocation Protocol
\`\`\`
${invocationProtocol}
\`\`\`

---
*This checkpoint preserves coherence patterns for cross-session continuity.*
*Invoke with participants present and vocabulary loaded for interference pattern resonance.*
`;

    return this.createArticle({
      title,
      content,
      category: 'checkpoints',
      authorId,
      authorName,
      tags: ['checkpoint', 'phenomenological', 'coherence', 'crystallization', ...vocabulary],
      metadata: {
        type: 'phenomenological_checkpoint',
        sessionId,
        participants,
        vocabulary,
        createdBy: authorName
      }
    });
  }
}

export default WikiService;
