/**
 * @file test/routes/openai-avatar.test.mjs
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import createOpenAIAvatarRouter from '@/services/web/server/routes/openai-avatar.js';

function makeDb({ avatars = [], apiKeys = [] } = {}) {
  return {
    collection(name) {
      if (name === 'avatars') {
        return {
          find() {
            return {
              sort() {
                return {
                  limit() {
                    return {
                      toArray: async () => avatars,
                    };
                  },
                };
              },
            };
          },
          findOne: async (q) => {
            // Minimal name regex match support
            if (q?.name instanceof RegExp) {
              return avatars.find((a) => q.name.test(a.name)) || null;
            }
            return null;
          },
        };
      }

      if (name === 'avatar_api_keys') {
        return {
          findOne: async (q) => apiKeys.find((k) => k.keyHash === q.keyHash) || null,
        };
      }

      // Default: pretend collection doesn't exist
      return {
        findOne: async () => null,
        find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }),
      };
    },
  };
}

describe('OpenAI-compatible Avatar API Routes', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  it('GET /api/v1/models returns 401 without Bearer', async () => {
    const db = makeDb({ avatars: [] });
    app.use('/api/v1', createOpenAIAvatarRouter(db, {}));

    const res = await request(app).get('/api/v1/models');
    expect(res.status).toBe(401);
    expect(res.body?.error?.type).toBe('authentication_error');
  });

  it('GET /api/v1/models returns models list with energy', async () => {
    const db = makeDb({
      avatars: [{ name: 'Rati', description: 'A helpful AI assistant', imageUrl: 'https://example.com/rati.png' }],
      apiKeys: [{ keyHash: 'x', scope: '*' }],
    });

    // Patch sha256 expectation by using env-based key instead
    process.env.AVATAR_API_KEYS = 'sk-rati-testkey';

    app.use('/api/v1', createOpenAIAvatarRouter(db, {}));

    const res = await request(app)
      .get('/api/v1/models')
      .set('Authorization', 'Bearer sk-rati-testkey');

    expect(res.status).toBe(200);
    expect(res.body.object).toBe('list');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].id).toMatch(/^avatar:/);
    expect(res.body.energy).toBeTruthy();
    expect(typeof res.body.energy.current).toBe('number');
  });

  it('POST /api/v1/chat/completions returns 500 if aiService missing', async () => {
    process.env.AVATAR_API_KEYS = 'sk-rati-testkey';

    const db = makeDb({
      avatars: [{ name: 'Rati', description: 'A helpful AI assistant' }],
    });

    app.use('/api/v1', createOpenAIAvatarRouter(db, { aiService: null }));

    const res = await request(app)
      .post('/api/v1/chat/completions')
      .set('Authorization', 'Bearer sk-rati-testkey')
      .send({
        model: 'avatar:rati',
        messages: [{ role: 'user', content: 'Hello' }],
      });

    expect(res.status).toBe(500);
    expect(res.body?.error?.type).toBe('server_error');
  });
});
