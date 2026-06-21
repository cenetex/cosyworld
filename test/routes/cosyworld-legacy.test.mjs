import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import createCosyWorldRoutes from '../../src/services/web/server/routes/cosyworld.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/legacy/cosyworld', createCosyWorldRoutes({
    logger: {
      debug: vi.fn(),
      error: vi.fn(),
    },
  }));
  app.use('/api/cosyworld', createCosyWorldRoutes({
    logger: {
      debug: vi.fn(),
      error: vi.fn(),
    },
  }));
  return app;
}

describe('CosyWorld legacy Node route', () => {
  it('marks the Node chat prototype as legacy and points at the V2 runtime', async () => {
    const response = await request(createApp())
      .get('/api/legacy/cosyworld/state')
      .expect(200);

    expect(response.headers['x-cosyworld-runtime']).toBe('legacy-node-prototype');
    expect(response.headers['x-cosyworld-canonical-runtime']).toBe('v2/orchestrator-rust');
    expect(response.body.server).toMatchObject({
      mode: 'legacy-node-prototype',
      deprecated: true,
      canonicalRuntime: 'v2/orchestrator-rust',
      clientAuthoredSpeech: true,
      v2Contract: {
        serverAuthoredChat: true,
        clientAuthoredSpeech: false,
        primaryActionModel: 'one-button-world-command',
      },
    });
    expect(response.body.legacy).toMatchObject({
      status: 'legacy',
      canonicalRuntime: 'v2/orchestrator-rust',
    });
  });

  it('keeps the old /api/cosyworld path as a compatibility alias', async () => {
    const response = await request(createApp())
      .get('/api/cosyworld/state')
      .expect(200);

    expect(response.headers['x-cosyworld-runtime']).toBe('legacy-node-prototype');
    expect(response.body.legacy).toMatchObject({
      status: 'legacy',
      canonicalRuntime: 'v2/orchestrator-rust',
    });
  });
});
