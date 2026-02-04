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

  const getSwarmModelsFromDb = async () => {
    try {
      if (!db) return [];
      const rows = await db.collection('external_avatar_models')
        .find({ provider: 'swarm' }, { projection: { _id: 0, modelId: 1, capabilities: 1, avatar: 1, owned_by: 1, created: 1 } })
        .sort({ modelId: 1 })
        .toArray();
      return (rows || [])
        .filter(r => r?.modelId)
        .map(r => ({
          provider: 'swarm',
          model: r.modelId,
          rarity: 'common',
          contextLength: r?.capabilities?.context_length || null,
          capabilities: r?.capabilities || null,
          owned_by: r?.owned_by || null,
          created: r?.created || null,
          source: 'external_avatar_models',
        }));
    } catch (e) {
      console.warn('[models route] Failed to load swarm models from DB:', e?.message || e);
      return [];
    }
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

      // Add Swarm avatar models (ingested into DB) when available
      const swarmDbModels = await getSwarmModelsFromDb();
      const combined = [...allModels, ...swarmDbModels];

      // De-dupe (provider+model when provider exists, else model)
      const seen = new Set();
      const deduped = [];
      for (const m of combined) {
        const key = `${m?.provider || 'default'}::${m?.model || ''}`;
        if (!m?.model || seen.has(key)) continue;
        seen.add(key);
        deduped.push(m);
      }

      res.json(deduped);
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



