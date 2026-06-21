/**
 * Copyright (c) 2019-2026 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * @file src/services/web/server/routes/runtime.js
 * @description Runtime discovery for the canonical CosyWorld V2 player shard.
 */

import { Router } from 'express';

const DEFAULT_V2_PUBLIC_URL = 'http://127.0.0.1:3102';

function cleanUrl(value, fallback = DEFAULT_V2_PUBLIC_URL) {
  const raw = String(value || fallback).trim();
  try {
    const url = new URL(raw);
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    const fallbackUrl = new URL(fallback);
    return fallbackUrl.toString().replace(/\/$/, '');
  }
}

function isLocalHost(url) {
  return ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
}

function defaultGameUrl(publicUrl) {
  const url = new URL(publicUrl);
  if (isLocalHost(url) && !url.searchParams.has('wallet')) {
    url.searchParams.set('wallet', 'dev-wallet');
  }
  return url.toString();
}

function runtimeConfig() {
  const configuredPublicUrl = process.env.COSYWORLD_V2_PUBLIC_URL || process.env.COSYWORLD_V2_BASE_URL;
  const publicUrl = cleanUrl(configuredPublicUrl);
  const gameUrl = process.env.COSYWORLD_V2_GAME_URL
    ? cleanUrl(process.env.COSYWORLD_V2_GAME_URL, publicUrl)
    : defaultGameUrl(publicUrl);
  const origin = new URL(publicUrl).origin;

  return {
    productRuntime: 'v2',
    v2: {
      publicUrl,
      gameUrl,
      healthUrl: new URL('/health', origin).toString(),
      metaUrl: new URL('/meta', origin).toString(),
      configured: Boolean(configuredPublicUrl),
    },
    node: {
      role: 'companion',
      legacyWebPath: '/legacy/cosyworld',
      legacyApiPath: '/api/legacy/cosyworld',
    },
  };
}

export default function createRuntimeRoutes() {
  const router = Router();

  router.get('/', (req, res) => {
    res.json(runtimeConfig());
  });

  return router;
}

export { runtimeConfig };
