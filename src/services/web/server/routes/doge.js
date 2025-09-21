import { Router } from 'express';

function parseTraits(input) {
  if (!input) return null;
  if (typeof input === 'object' && !Array.isArray(input)) return input;
  try {
    const parsed = JSON.parse(input);
    return typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export default function dogeRoutes(services) {
  const router = Router();
  const collectionService = services?.doginalCollectionService;
  if (!collectionService) {
    throw new Error('doginalCollectionService is not registered in container');
  }

  router.get('/collections', async (req, res) => {
    try {
      const collections = await collectionService.listCollections();
      res.json({ collections });
    } catch (error) {
      services.logger?.error?.('[doge] collections error:', error);
      res.status(500).json({ error: 'Failed to load collections' });
    }
  });

  router.get('/collections/:slug/tokens', async (req, res) => {
    try {
      const { slug } = req.params;
      const { page, limit } = req.query;
      const traits = parseTraits(req.query.traits);
      const payload = await collectionService.getTokens({ slug, page, limit, traits });
      res.json(payload);
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) {
        services.logger?.error?.('[doge] tokens error:', error);
      }
      res.status(status).json({ error: error.message || 'Failed to fetch tokens' });
    }
  });

  router.post('/summon', async (req, res) => {
    try {
      const { collection, slug, collectionSlug, inscriptionNumber, inscriptionId, exclude, traits } = req.body || {};
      const collectionInput = collection || slug || collectionSlug;
      if (!collectionInput) {
        return res.status(400).json({ error: 'collection is required' });
      }
      const result = await collectionService.summonToken({
        collection: collectionInput,
        inscriptionNumber,
        inscriptionId,
        exclude,
        traits,
      });
      res.json(result);
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) {
        services.logger?.error?.('[doge] summon error:', error);
      }
      res.status(status).json({ error: error.message || 'Failed to summon token' });
    }
  });

  return router;
}
