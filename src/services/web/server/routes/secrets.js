/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import express from 'express';
import { ensureAdmin } from '../middleware/authCookie.js';

const MASK = (v) => (typeof v === 'string' && v.length > 4 ? v[0] + '***' + v.slice(-2) : '***');

export default function createSecretsRouter(services) {
  const router = express.Router();
  const { secretsService } = services;

  router.use(ensureAdmin);

  // List known secrets (masked)
  router.get('/', async (req, res) => {
    const guildId = req.query.guildId || null;
    const keys = await secretsService.listKeys({ guildId });
    const items = [];
    for (const k of keys) {
      const r = await secretsService.getWithSource(k, { guildId });
      items.push({ key: k, value: r.value ? MASK(r.value) : null, source: r.source });
    }
    res.json({ items });
  });

  // Import secrets from a .env formatted payload in the body { envText: "KEY=VALUE\n..." }
  router.post('/import', express.json({ limit: '2mb' }), async (req, res) => {
    const { envText } = req.body || {};
    const guildId = req.query.guildId || null;
    if (!envText || typeof envText !== 'string') return res.status(400).json({ error: 'envText string required' });
    const lines = envText.split(/\r?\n/);
    let imported = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      // Remove optional surrounding single or double quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!key) continue;
  await secretsService.set(key, value, { guildId });
      imported++;
    }
    res.json({ ok: true, imported });
  });

  // Get single secret masked
  router.get('/:key', async (req, res) => {
    const key = req.params.key;
    const guildId = req.query.guildId || null;
    const { value, source } = await secretsService.getWithSource(key, { guildId });
    if (!value) return res.status(404).json({ error: 'Not found' });
    res.json({ key, value: MASK(value), source });
  });

  // Update/set secret
  router.post('/:key', express.json(), async (req, res) => {
    const key = req.params.key;
    const guildId = req.query.guildId || null;
    const { value } = req.body || {};
    if (!value || typeof value !== 'string') return res.status(400).json({ error: 'value required' });
    await secretsService.set(key, value, { guildId });
    res.json({ ok: true });
  });

  // Rotate: replace with new value or clear
  router.post('/:key/rotate', express.json(), async (req, res) => {
    const key = req.params.key;
    const guildId = req.query.guildId || null;
    const { value } = req.body || {};
    if (value && typeof value === 'string') {
      await secretsService.set(key, value, { guildId });
      return res.json({ ok: true });
    }
    // if value omitted, just clear
    await secretsService.delete(key, { guildId });
    res.json({ ok: true, cleared: true });
  });

  

  return router;
}
