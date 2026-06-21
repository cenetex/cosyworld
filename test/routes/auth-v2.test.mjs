import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import bs58 from 'bs58';
import nacl from 'tweetnacl';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDataLayer } from '../../src/data/dataLayer.mjs';
import { attachUserFromCookie } from '../../src/services/web/server/middleware/authCookie.js';
import createAuthRouter from '../../src/services/web/server/routes/auth.js';

const quietLogger = { info() {}, warn() {}, error() {}, debug() {} };

function createWallet() {
  const keypair = nacl.sign.keyPair();
  const address = bs58.encode(keypair.publicKey);
  return { address, secretKey: keypair.secretKey };
}

function signNonce(nonce, secretKey) {
  const message = new TextEncoder().encode(nonce);
  return Array.from(nacl.sign.detached(message, secretKey));
}

describe('auth routes with V2 IdentityStore', () => {
  const originalBackend = process.env.DATA_BACKEND;
  const originalSqlitePath = process.env.SQLITE_DB_PATH;
  const originalAdminWallet = process.env.ADMIN_WALLET;
  const originalAdminWallets = process.env.ADMIN_WALLETS;
  let tempDir;
  let dataLayer;
  let app;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cosyworld-auth-v2-'));
    process.env.DATA_BACKEND = 'sqlite';
    process.env.SQLITE_DB_PATH = path.join(tempDir, 'cosyworld.sqlite');
    delete process.env.ADMIN_WALLET;
    delete process.env.ADMIN_WALLETS;

    dataLayer = createDataLayer({
      logger: quietLogger,
      databaseService: {
        getDatabase() {
          throw new Error('Mongo should not be used by V2 auth route');
        }
      }
    });
    await dataLayer.initialize();

    const services = { dataLayer, logger: quietLogger };
    app = express();
    app.locals.services = services;
    app.use(express.json());
    app.use(attachUserFromCookie);
    app.use('/api/auth', createAuthRouter(services));
  });

  afterEach(async () => {
    dataLayer?.sqliteConnection?.close();
    await fs.rm(tempDir, { recursive: true, force: true });

    if (originalBackend === undefined) delete process.env.DATA_BACKEND;
    else process.env.DATA_BACKEND = originalBackend;

    if (originalSqlitePath === undefined) delete process.env.SQLITE_DB_PATH;
    else process.env.SQLITE_DB_PATH = originalSqlitePath;

    if (originalAdminWallet === undefined) delete process.env.ADMIN_WALLET;
    else process.env.ADMIN_WALLET = originalAdminWallet;

    if (originalAdminWallets === undefined) delete process.env.ADMIN_WALLETS;
    else process.env.ADMIN_WALLETS = originalAdminWallets;
  });

  it('logs in with a signed nonce, creates a session cookie, and resolves /me', async () => {
    const wallet = createWallet();
    const nonceRes = await request(app)
      .post('/api/auth/nonce')
      .send({ address: wallet.address })
      .expect(200);

    const signature = signNonce(nonceRes.body.nonce, wallet.secretKey);

    const agent = request.agent(app);
    const verifyRes = await agent
      .post('/api/auth/verify')
      .send({ address: wallet.address, nonce: nonceRes.body.nonce, signature })
      .expect(200);

    expect(verifyRes.body).toMatchObject({
      ok: true,
      user: { walletAddress: wallet.address, isAdmin: true }
    });
    expect(verifyRes.headers['set-cookie']?.join(';')).toContain('authToken=');

    const meRes = await agent.get('/api/auth/me').expect(200);
    expect(meRes.body.user).toMatchObject({
      walletAddress: wallet.address,
      isAdmin: true
    });
    expect(meRes.body.user.userId).toBeTruthy();
  });

  it('honors explicit admin wallet allow-list', async () => {
    const wallet = createWallet();
    process.env.ADMIN_WALLET = wallet.address;

    const nonceRes = await request(app)
      .post('/api/auth/nonce')
      .send({ address: wallet.address })
      .expect(200);
    const signature = signNonce(nonceRes.body.nonce, wallet.secretKey);

    const verifyRes = await request(app)
      .post('/api/auth/verify')
      .send({ address: wallet.address, nonce: nonceRes.body.nonce, signature })
      .expect(200);

    expect(verifyRes.body.user.isAdmin).toBe(true);
  });

  it('revokes the V2 session on logout', async () => {
    const wallet = createWallet();
    const nonceRes = await request(app)
      .post('/api/auth/nonce')
      .send({ address: wallet.address })
      .expect(200);
    const signature = signNonce(nonceRes.body.nonce, wallet.secretKey);

    const agent = request.agent(app);
    await agent
      .post('/api/auth/verify')
      .send({ address: wallet.address, nonce: nonceRes.body.nonce, signature })
      .expect(200);

    await agent.post('/api/auth/logout').expect(200);

    const meRes = await agent.get('/api/auth/me').expect(200);
    expect(meRes.body.user).toBeNull();
  });
});
