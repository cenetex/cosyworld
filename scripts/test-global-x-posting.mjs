#!/usr/bin/env node
/**
 * Lightweight harness to sanity check XService.postGlobalMediaUpdate metrics branches.
 * This avoids real network calls by monkey-patching fetch & TwitterApi.
 * Run with: `node scripts/test-global-x-posting.mjs`
 */
// NOTE: We must define the TwitterApi shim BEFORE importing the service so that the service uses it.
class MockV2 {
  async uploadMedia() { return 'media123'; }
  async tweet() { return { data: { id: 'tweet123' } }; }
  async createMediaMetadata() { return true; }
  async me() { return { data: { username: 'mockuser' } }; }
}
class MockV1 { async uploadMedia() { return 'media123'; } }
class TwitterApiShim { constructor() { return { v2: new MockV2(), v1: new MockV1() }; } }
global.TwitterApi = TwitterApiShim;
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
class TestXService extends XService {}

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
  console.log('TEST: posting valid media');
  await svc.postGlobalMediaUpdate({ mediaUrl: 'https://example.com/image.png', text: 'Hello world' });
  // 2. Hourly cap reached simulation (set cap to 1, second valid post should be capped)
  process.env.X_GLOBAL_POST_HOURLY_CAP = '1';
  console.log('TEST: posting second valid media (should cap)');
  await svc.postGlobalMediaUpdate({ mediaUrl: 'https://example.com/image2.png', text: 'Should cap' });
  // 3. Invalid media URL
  console.log('TEST: posting invalid media url');
  await svc.postGlobalMediaUpdate({ mediaUrl: 'notaurl', text: 'X' });
  const metrics = svc.getGlobalPostingMetrics();
  console.log('\nGlobal Posting Metrics Snapshot:', JSON.stringify(metrics, null, 2));
  console.log('Social posts stored:', fakeDbState.social_posts.length);
}

main().catch(e => { console.error(e); process.exit(1); });
