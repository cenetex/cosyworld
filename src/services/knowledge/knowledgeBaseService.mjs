/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Knowledge Base Service
 * 
 * Provides RAG (Retrieval Augmented Generation) capabilities by querying
 * the WikiService for relevant articles.
 * 
 * @module services/knowledge/knowledgeBaseService
 */

export class KnowledgeBaseService {
  constructor({ wikiService, logger }) {
    this.wikiService = wikiService;
    this.logger = logger;
  }

  /**
   * Initialize the service
   */
  async initialize() {
    // No-op for now, as WikiService handles its own initialization
    this.logger?.info?.('[KnowledgeBaseService] Initialized (backed by WikiService)');
  }

  /**
   * Search for relevant context
   * @param {string} query - User query
   * @param {number} limit - Max results
   * @returns {Promise<Array>} - Array of { content, score, source }
   */
  async search(query, limit = 3) {
    if (!query || !this.wikiService) return [];

    try {
      // Use WikiService's semantic search
      const results = await this.wikiService.search(query, { 
        limit, 
        semantic: true 
      });

      // Map to expected format
      return results.map(article => {
        // Use summary if available, otherwise fall back to content truncation
        // We prefer the summary as it's designed for context injection
        let content = article.summary;
        
        if (!content) {
             content = article.content && article.content.length > 1500 
              ? article.content.substring(0, 1500) + '...' 
              : article.content;
        }

        return {
          content: content,
          score: article.similarity || 0,
          source: `Wiki: ${article.title}`,
          metadata: {
              slug: article.slug,
              category: article.category
          }
        };
      });
    } catch (error) {
      this.logger?.warn?.('[KnowledgeBaseService] Search failed:', error.message);
      return [];
    }
  }
}
