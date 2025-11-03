/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import express from 'express';

export default function (db, services) {
  const router = express.Router();
  
  // Get aiModelService from the container
  const aiModelService = services?.aiModelService;
  
  if (!aiModelService) {
    console.error('[models route] aiModelService not available in container');
  }

  // Utility: Get all models from all services
  const getAllModels = () => {
    if (!aiModelService) return [];
    const openrouterModels = aiModelService.getAllModels('openrouter');
    const googleModels = aiModelService.getAllModels('googleAI');
    console.log(`[models route] Fetched ${openrouterModels.length} openrouter + ${googleModels.length} google models`);
    return [...openrouterModels, ...googleModels];
  };

  // Utility: Validate and sanitize query parameters
  const parseQuery = (query) => ({
    page: Math.max(1, parseInt(query.page) || 1),
    limit: Math.min(100, Math.max(1, parseInt(query.limit) || 50)),
    rarity: query.rarity?.toLowerCase() || null,
    search: query.search?.toLowerCase() || null,
  });

  // Utility: Sort models by rarity
  const rarityOrder = {
    legendary: 0,
    rare: 1,
    uncommon: 2,
    common: 3,
  };

  const sortByRarity = (a, b) => rarityOrder[a.rarity] - rarityOrder[b.rarity];

  // Route: Fetch models with pagination and filters
  router.get('/', async (req, res) => {
    try {
      const { page, limit, rarity, search } = parseQuery(req.query);
      const skip = (page - 1) * limit;

      // Fetch models from all registered services
      const allModels = getAllModels();
      
      let filteredModels = allModels;
      if (rarity) filteredModels = filteredModels.filter((m) => m.rarity.toLowerCase() === rarity);
      if (search) filteredModels = filteredModels.filter((m) => m.model.toLowerCase().includes(search));

      // Paginate and sort models
      const total = filteredModels.length;
      const paginatedModels = filteredModels.slice(skip, skip + limit).sort(sortByRarity);

      // Response
      res.json({
        models: paginatedModels,
        total,
        page,
        totalPages: Math.ceil(total / limit),
        limit,
        filters: {
          rarity: rarity || 'all',
          search: search || '',
        },
        metadata: {
          availableRarities: [...new Set(filteredModels.map((m) => m.rarity))].sort(sortByRarity),
        },
      });
    } catch (error) {
      console.error('Error fetching models:', error);
      res.status(500).json({
        error: 'Failed to fetch models',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  });

  // Route: Fetch all model configurations
  router.get('/config', async (req, res) => {
    try {
      // Combine models from all registered services
      const allModels = getAllModels();
      res.json(allModels);
    } catch (error) {
      console.error('Error fetching model config:', error);
      res.status(500).json({ error: 'Failed to fetch model configurations' });
    }
  });

  // Route: Fetch a single model by name
  router.get('/:modelName', async (req, res) => {
    try {
      const modelName = decodeURIComponent(req.params.modelName);
      
      // Search in all registered services
      const allModels = getAllModels();
      
      const model = allModels.find((m) => m.model === modelName);

      if (!model) {
        return res.status(404).json({ error: 'Model not found' });
      }

      res.json(model);
    } catch (error) {
      console.error('Error fetching model:', error);
      res.status(500).json({
        error: 'Failed to fetch model',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  });

  return router;
}



