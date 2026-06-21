import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import createRuntimeRoutes, { runtimeConfig } from '../../src/services/web/server/routes/runtime.js';

const ORIGINAL_ENV = {
  COSYWORLD_V2_PUBLIC_URL: process.env.COSYWORLD_V2_PUBLIC_URL,
  COSYWORLD_V2_BASE_URL: process.env.COSYWORLD_V2_BASE_URL,
  COSYWORLD_V2_GAME_URL: process.env.COSYWORLD_V2_GAME_URL,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function createApp() {
  const app = express();
  app.use('/api/runtime', createRuntimeRoutes());
  return app;
}

describe('runtime routes', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('defaults to the local V2 shard with a dev wallet game URL', async () => {
    delete process.env.COSYWORLD_V2_PUBLIC_URL;
    delete process.env.COSYWORLD_V2_BASE_URL;
    delete process.env.COSYWORLD_V2_GAME_URL;

    const response = await request(createApp())
      .get('/api/runtime')
      .expect(200);

    expect(response.body).toMatchObject({
      productRuntime: 'v2',
      v2: {
        publicUrl: 'http://127.0.0.1:3102',
        gameUrl: 'http://127.0.0.1:3102/?wallet=dev-wallet',
        healthUrl: 'http://127.0.0.1:3102/health',
        metaUrl: 'http://127.0.0.1:3102/meta',
        configured: false,
      },
      node: {
        role: 'companion',
        legacyWebPath: '/legacy/cosyworld',
        legacyApiPath: '/api/legacy/cosyworld',
      },
    });
  });

  it('uses the configured public V2 URL and explicit game URL in production', () => {
    process.env.COSYWORLD_V2_PUBLIC_URL = 'https://play.cosyworld.example/';
    process.env.COSYWORLD_V2_GAME_URL = 'https://play.cosyworld.example/?shard=official';

    expect(runtimeConfig()).toMatchObject({
      v2: {
        publicUrl: 'https://play.cosyworld.example',
        gameUrl: 'https://play.cosyworld.example/?shard=official',
        healthUrl: 'https://play.cosyworld.example/health',
        metaUrl: 'https://play.cosyworld.example/meta',
        configured: true,
      },
    });
  });
});
