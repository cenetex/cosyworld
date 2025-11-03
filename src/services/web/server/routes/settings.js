/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import express from 'express';
import { ensureAdmin } from '../middleware/authCookie.js';

const ALLOWED_SETTING_KEYS = [
  'toolEmojis.summon',
  'features.breeding',
  'features.combat',
  'features.itemCreation',
  'features.moderation',
  'viewDetailsEnabled',
  'enableWebSearchTool',
  'webSearchToolChannelId',
  'summonEmoji'
];

const PROMPT_PREFIX = 'prompts.';

function flattenPromptKeys(obj, prefix = 'prompts') {
  if (!obj || typeof obj !== 'object') return [];
  const keys = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = `${prefix}.${key}`;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flattenPromptKeys(value, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

function get(obj, path) {
  return path.split('.').reduce((o, p) => (o && Object.prototype.hasOwnProperty.call(o, p) ? o[p] : undefined), obj);
}

export default function createSettingsRouter(services) {
  const router = express.Router();
  const db = services.databaseService?.db || null;
  const configService = services.configService;
  const secretsService = services.secretsService;

  router.use(ensureAdmin);

  // Helper to get global overrides document
  async function getGlobalOverrides() {
    try {
      return (await db.collection('global_settings').findOne({ _id: 'guild_defaults' })) || { _id: 'guild_defaults', config: {} };
    } catch {
      return { _id: 'guild_defaults', config: {} };
    }
  }

  // GET /api/settings?guildId=...
  router.get('/', async (req, res) => {
    try {
      const guildId = req.query.guildId || null;

      // Build settings (non-secret) effective view
      const baseDefaults = configService.getDefaultGuildConfig('global');
      const globalOverrides = await getGlobalOverrides();
      const globalConfig = configService.constructor.deepMerge(
        { ...baseDefaults },
        globalOverrides.config || {}
      );

      let guildDoc = null;
      if (guildId) {
        guildDoc = await db.collection('guild_configs').findOne({ guildId });
      }

      const settings = [];
      for (const key of ALLOWED_SETTING_KEYS) {
        const fromGuild = guildDoc ? get(guildDoc, key) : undefined;
        const fromGlobal = get(globalConfig, key);
        const source = fromGuild !== undefined ? 'guild' : 'global';
        const value = fromGuild !== undefined ? fromGuild : fromGlobal;
        settings.push({ key, value, source });
      }

      const promptKeys = new Set();
      flattenPromptKeys(baseDefaults.prompts || {}).forEach(k => promptKeys.add(k));
      flattenPromptKeys(globalOverrides.config?.prompts || {}).forEach(k => promptKeys.add(k));
      if (guildDoc?.prompts) {
        flattenPromptKeys(guildDoc.prompts).forEach(k => promptKeys.add(k));
      }

      for (const key of Array.from(promptKeys).sort()) {
        const fromGuild = guildDoc ? get(guildDoc, key) : undefined;
        const fromGlobal = get(globalConfig, key);
        const source = fromGuild !== undefined ? 'guild' : 'global';
        const value = fromGuild !== undefined ? fromGuild : fromGlobal;
        settings.push({ key, value, source });
      }

      // Build secrets effective view
      const secretKeys = await secretsService.listKeys({ guildId });
      const secrets = [];
      for (const k of secretKeys) {
        const r = await secretsService.getWithSource(k, { guildId });
        const masked = r.value ? (typeof r.value === 'string' && r.value.length > 4 ? r.value[0] + '***' + r.value.slice(-2) : '***') : null;
        secrets.push({ key: k, value: masked, source: r.source });
      }

      res.json({ settings, secrets });
    } catch (e) {
      services.logger.error('GET /api/settings failed:', e);
      res.status(500).json({ error: 'Failed to load settings' });
    }
  });

  // POST /api/settings/set/:key?guildId=
  router.post('/set/:key', express.json(), async (req, res) => {
    const key = req.params.key;
    const guildId = req.query.guildId || null;
    const { value } = req.body || {};
  const isPromptKey = key.startsWith(PROMPT_PREFIX) && key.length > PROMPT_PREFIX.length;
  if (!isPromptKey && !ALLOWED_SETTING_KEYS.includes(key)) return res.status(400).json({ error: 'Key not allowed' });
    try {
      if (guildId) {
        await db.collection('guild_configs').updateOne(
          { guildId },
          { $set: { [key]: value, updatedAt: new Date() } },
          { upsert: true }
        );
      } else {
        await db.collection('global_settings').updateOne(
          { _id: 'guild_defaults' },
          { $set: { [`config.${key}`]: value, updatedAt: new Date() } },
          { upsert: true }
        );
      }

      if (configService && key.startsWith('prompts.')) {
        try {
          if (guildId) {
            await configService.clearCache(guildId);
          } else {
            await configService.refreshPromptDefaultsFromDatabase({ force: true });
            await configService.clearCache();
          }
        } catch (refreshError) {
          services.logger?.warn?.('[settings] Failed to refresh prompt defaults after set', refreshError);
        }
      }
      res.json({ ok: true });
    } catch (e) {
      services.logger.error('POST /api/settings/set failed:', e);
      res.status(500).json({ error: 'Failed to set setting' });
    }
  });

  // POST /api/settings/clear/:key?guildId=
  router.post('/clear/:key', async (req, res) => {
    const key = req.params.key;
    const guildId = req.query.guildId || null;
  const isPromptKey = key.startsWith(PROMPT_PREFIX) && key.length > PROMPT_PREFIX.length;
  if (!isPromptKey && !ALLOWED_SETTING_KEYS.includes(key)) return res.status(400).json({ error: 'Key not allowed' });
    try {
      if (guildId) {
        await db.collection('guild_configs').updateOne(
          { guildId },
          { $unset: { [key]: '' }, $set: { updatedAt: new Date() } }
        );
      } else {
        await db.collection('global_settings').updateOne(
          { _id: 'guild_defaults' },
          { $unset: { [`config.${key}`]: '' }, $set: { updatedAt: new Date() } }
        );
      }

      if (configService && key.startsWith('prompts.')) {
        try {
          if (guildId) {
            await configService.clearCache(guildId);
          } else {
            await configService.refreshPromptDefaultsFromDatabase({ force: true });
            await configService.clearCache();
          }
        } catch (refreshError) {
          services.logger?.warn?.('[settings] Failed to refresh prompt defaults after clear', refreshError);
        }
      }
      res.json({ ok: true, cleared: true });
    } catch (e) {
      services.logger.error('POST /api/settings/clear failed:', e);
      res.status(500).json({ error: 'Failed to clear setting' });
    }
  });

  return router;
}
