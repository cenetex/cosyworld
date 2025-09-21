#!/usr/bin/env node
/**
 * Lightweight harness to sanity check XService.postGlobalMediaUpdate metrics branches.
 * This avoids real network calls by monkey-patching fetch & TwitterApi.
 * Run with: `node scripts/test-global-x-posting.mjs`
 */
import XService from '../src/services/social/xService.mjs';

// --- Mocks ---
global.fetch = async (url) => {
  if (String(url).includes('bad')) {
    return { ok: false, status: 404, statusText: 'Not Found' };
  }
  // Return tiny fake PNG bytes
  return {
    ok: true,
    headers: new Map([['content-type', 'image/png']]),
    arrayBuffer: async () => new Uint8Array([137,80,78,71]).buffer
  };
};

// Minimal internal factory to mimic TwitterApi API surface used by XService
function makeTwitterClientMock() {
  return {
    v2: {
      uploadMedia: async () => 'media123',
      tweet: async () => ({ data: { id: 'tweet123' } }),
      createMediaMetadata: async () => true,
      me: async () => ({ data: { username: 'mockuser' } })
    },
    v1: {
      uploadMedia: async () => 'media123'
    }
  };
}

class TestXService extends XService {
  // Override internal creation by wrapping postGlobalMediaUpdate after super
  constructor(deps) { super(deps); }
  // Monkey patch inside method usage by temporarily replacing global TwitterApi reference pattern.
  // Simpler: override a helper the service implicitly relies on (none exists), so we intercept directly by shadowing TwitterApi variable through closure rebind.
  _makeTwitterClient() { return makeTwitterClientMock(); }
  // Wrap original method to inject our mock
  async postGlobalMediaUpdate(opts = {}, services = {}) {
    const original = global.TwitterApi;
    try {
      global.TwitterApi = function() { return this._makeTwitterClient(); }.bind(this);
      return await super.postGlobalMediaUpdate(opts, services);
    } finally {
      global.TwitterApi = original;
    }
  }
}

// Fake database service
const fakeDbState = {
  x_auth: [ { avatarId: 'A1', accessToken: 'plaintext-token', updatedAt: new Date(), global: true, expiresAt: new Date(Date.now()+3600_000) } ],
  social_posts: []
};
const databaseService = {
  async getDatabase() {
    return {
      collection: (name) => ({
        findOne: async (q) => {
          if (name === 'x_auth') {
            if (q.global) return fakeDbState.x_auth.find(a => a.global) || null;
            return fakeDbState.x_auth[0] || null;
          }
          if (name === 'x_post_config') return null; // force implicit path
          return null;
        },
        updateOne: async () => {},
        insertOne: async (doc) => { if (name === 'social_posts') fakeDbState.social_posts.push(doc); },
      })
    };
  }
};

const logger = { info: console.log, warn: console.warn, error: console.error, debug: ()=>{} };
const configService = { get: () => null };

async function main() {
  const svc = new TestXService({ logger, databaseService, configService });
  // 1. Successful post
  await svc.postGlobalMediaUpdate({ mediaUrl: 'https://example.com/image.png', text: 'Hello world' });
  // 2. Invalid media URL
  await svc.postGlobalMediaUpdate({ mediaUrl: 'notaurl', text: 'X' });
  // 3. Hourly cap reached simulation
  process.env.X_GLOBAL_POST_HOURLY_CAP = '1';
  await svc.postGlobalMediaUpdate({ mediaUrl: 'https://example.com/image2.png', text: 'Second should cap' });
  const metrics = svc.getGlobalPostingMetrics();
  console.log('\nGlobal Posting Metrics Snapshot:', JSON.stringify(metrics, null, 2));
  console.log('Social posts stored:', fakeDbState.social_posts.length);
}

main().catch(e => { console.error(e); process.exit(1); });
