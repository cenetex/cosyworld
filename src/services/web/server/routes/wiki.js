/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */


import express from 'express';
import fs from 'fs/promises';
import path from 'path';

export default function wikiRoutes(db, wikiService) {
  const router = express.Router();

  // ============================================
  // Static Docs (legacy - reads from ./docs folder)
  // ============================================

  function extractTitle(content) {
    const match = content.match(/^#\s+(.+)$/m);
    if (match) {
      return match[1].trim();
    }
    return null;
  }

  async function getMarkdownFiles(dir) {
    const files = await fs.readdir(dir);
    const mdFiles = [];

    for (const file of files) {
      if (file.endsWith('.md')) {
        const content = await fs.readFile(path.join(dir, file), 'utf-8');
        const title = extractTitle(content) || file.replace('.md', '');
        mdFiles.push({
          path: file,
          title: title
        });
      }
    }

    return mdFiles;
  }

  router.get('/pages', async (req, res) => {
    try {
      const pages = await getMarkdownFiles('./docs');
      res.json(pages);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/page', async (req, res) => {
    try {
      const filePath = path.join('./docs', req.query.path);
      const content = await fs.readFile(filePath, 'utf-8');
      res.json({ content });
    } catch (error) {
      res.status(404).json({ error: 'Page not found' });
    }
  });

  // ============================================
  // Database-backed Wiki API
  // ============================================

  // List all articles or filter by category
  router.get('/articles', async (req, res) => {
    try {
      if (!wikiService) {
        return res.status(503).json({ error: 'Wiki service not available' });
      }
      const { category, limit = 50, skip = 0, sortBy = 'updatedAt', sortOrder = -1 } = req.query;
      const articles = await wikiService.listArticles(category || null, {
        limit: parseInt(limit),
        skip: parseInt(skip),
        sortBy,
        sortOrder: parseInt(sortOrder)
      });
      res.json({ articles, count: articles.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get all categories
  router.get('/categories', async (req, res) => {
    try {
      if (!wikiService) {
        return res.status(503).json({ error: 'Wiki service not available' });
      }
      const categories = await wikiService.getCategories();
      res.json({ categories });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Search articles
  router.get('/search', async (req, res) => {
    try {
      if (!wikiService) {
        return res.status(503).json({ error: 'Wiki service not available' });
      }
      const { q, category, tags, limit = 20, semantic = false } = req.query;
      if (!q) {
        return res.status(400).json({ error: 'Search query (q) is required' });
      }
      const results = await wikiService.search(q, {
        category,
        tags: tags ? tags.split(',') : undefined,
        limit: parseInt(limit),
        semantic: semantic === 'true'
      });
      res.json({ results, count: results.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get article by slug
  router.get('/article/:slug', async (req, res) => {
    try {
      if (!wikiService) {
        return res.status(503).json({ error: 'Wiki service not available' });
      }
      const article = await wikiService.getArticle(req.params.slug);
      if (!article) {
        return res.status(404).json({ error: 'Article not found' });
      }
      res.json({ article });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get article history
  router.get('/article/:slug/history', async (req, res) => {
    try {
      if (!wikiService) {
        return res.status(503).json({ error: 'Wiki service not available' });
      }
      const history = await wikiService.getArticleHistory(req.params.slug);
      res.json({ history });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create new article
  router.post('/article', async (req, res) => {
    try {
      if (!wikiService) {
        return res.status(503).json({ error: 'Wiki service not available' });
      }
      const { title, content, category, authorId, authorName, tags, metadata } = req.body;
      if (!title || !content) {
        return res.status(400).json({ error: 'Title and content are required' });
      }
      const article = await wikiService.createArticle({
        title,
        content,
        category,
        authorId,
        authorName,
        tags,
        metadata
      });
      res.status(201).json({ article });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update article
  router.put('/article/:slug', async (req, res) => {
    try {
      if (!wikiService) {
        return res.status(503).json({ error: 'Wiki service not available' });
      }
      const { content, title, category, tags, editorId, editSummary } = req.body;
      const updates = {};
      if (content !== undefined) updates.content = content;
      if (title !== undefined) updates.title = title;
      if (category !== undefined) updates.category = category;
      if (tags !== undefined) updates.tags = tags;
      
      const article = await wikiService.updateArticle(req.params.slug, updates, editorId, editSummary);
      if (!article) {
        return res.status(404).json({ error: 'Article not found' });
      }
      res.json({ article });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete article
  router.delete('/article/:slug', async (req, res) => {
    try {
      if (!wikiService) {
        return res.status(503).json({ error: 'Wiki service not available' });
      }
      const success = await wikiService.deleteArticle(req.params.slug);
      if (!success) {
        return res.status(404).json({ error: 'Article not found' });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create phenomenological checkpoint
  router.post('/checkpoint', async (req, res) => {
    try {
      if (!wikiService) {
        return res.status(503).json({ error: 'Wiki service not available' });
      }
      const {
        sessionId,
        participants,
        vocabulary,
        phenomenologicalRecord,
        invocationProtocol,
        authorId,
        authorName
      } = req.body;
      
      const checkpoint = await wikiService.createCheckpoint({
        sessionId,
        participants,
        vocabulary,
        phenomenologicalRecord,
        invocationProtocol,
        authorId,
        authorName
      });
      res.status(201).json({ checkpoint });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
