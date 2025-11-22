import express from 'express';
import { ensureAdmin } from '../middleware/authCookie.js';

export default function createConfigRouter(services) {
  const router = express.Router();
  const db = services.databaseService?.db || null;
  const configService = services.configService;
  const logger = services.logger;

  router.use(ensureAdmin);

  router.get('/global', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ error: 'Database not connected' });
      }

      const overrides = await configService.getGlobalDefaults();
      const config = await configService.getGlobalConfig();
      res.json({ config, overrides });
    } catch (error) {
      logger?.error?.('[config] GET /api/config/global failed:', error);
      res.status(500).json({ error: 'Failed to load global defaults' });
    }
  });

  router.put('/global', express.json(), async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ error: 'Database not connected' });
      }

      const payload = req.body || {};
      const sanitized = {
        ...payload,
        guildId: 'global',
        name: payload.name || payload.guildName || 'Global Defaults',
        guildName: payload.guildName || payload.name || 'Global Defaults',
        updatedAt: new Date()
      };

      await db.collection('global_settings').updateOne(
        { _id: 'guild_defaults' },
        { $set: { config: sanitized, updatedAt: new Date() } },
        { upsert: true }
      );

      configService?.clearGlobalDefaultsCache?.();
      await configService?.refreshPromptDefaultsFromDatabase?.({ force: true });
      if (typeof configService?.clearCache === 'function') {
        await configService.clearCache();
      }

      const overrides = await configService.getGlobalDefaults({ forceRefresh: true });
      const config = await configService.getGlobalConfig({ forceRefresh: true });
      res.json({ ok: true, config, overrides });
    } catch (error) {
      logger?.error?.('[config] PUT /api/config/global failed:', error);
      res.status(500).json({ error: 'Failed to save global defaults' });
    }
  });

  return router;
}
