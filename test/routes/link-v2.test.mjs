import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import bs58 from 'bs58';
import nacl from 'tweetnacl';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDataLayer } from '../../src/data/dataLayer.mjs';
import createLinkRouter from '../../src/services/web/server/routes/link.js';

const quietLogger = { info() {}, warn() {}, error() {}, debug() {} };

function createWallet() {
  const keypair = nacl.sign.keyPair();
  const address = bs58.encode(keypair.publicKey);
  return { address, secretKey: keypair.secretKey };
}

function signMessageHex(message, secretKey) {
  const messageBytes = new TextEncoder().encode(message);
  return Buffer.from(nacl.sign.detached(messageBytes, secretKey)).toString('hex');
}

describe('link routes with V2 IdentityStore', () => {
  const originalBackend = process.env.DATA_BACKEND;
  const originalSqlitePath = process.env.SQLITE_DB_PATH;
  let tempDir;
  let dataLayer;
  let app;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cosyworld-link-v2-'));
    process.env.DATA_BACKEND = 'sqlite';
    process.env.SQLITE_DB_PATH = path.join(tempDir, 'cosyworld.sqlite');

    dataLayer = createDataLayer({
      logger: quietLogger,
      databaseService: {
        getDatabase() {
          throw new Error('Mongo should not be used by V2 link route');
        }
      }
    });
    await dataLayer.initialize();

    const services = { dataLayer, logger: quietLogger };
    app = express();
    app.use(express.json());
    app.use('/api/link', createLinkRouter(services));
  });

  afterEach(async () => {
    dataLayer?.sqliteConnection?.close();
    await fs.rm(tempDir, { recursive: true, force: true });

    if (originalBackend === undefined) delete process.env.DATA_BACKEND;
    else process.env.DATA_BACKEND = originalBackend;

    if (originalSqlitePath === undefined) delete process.env.SQLITE_DB_PATH;
    else process.env.SQLITE_DB_PATH = originalSqlitePath;
  });

  it('links a Discord identity to a Solana wallet through the V2 store', async () => {
    const wallet = createWallet();

    const initiateRes = await request(app)
      .post('/api/link/initiate')
      .send({ discordId: 'discord-123', guildId: 'guild-456' })
      .expect(200);

    const challengeRes = await request(app)
      .get('/api/link/challenge')
      .set('Host', 'cosyworld.test')
      .query({ code: initiateRes.body.code })
      .expect(200);

    const signature = signMessageHex(challengeRes.body.message, wallet.secretKey);
    const completeRes = await request(app)
      .post('/api/link/complete')
      .set('Host', 'cosyworld.test')
      .send({
        code: initiateRes.body.code,
        chain: 'solana',
        address: wallet.address,
        signature,
        message: challengeRes.body.message
      })
      .expect(200);

    expect(completeRes.body.success).toBe(true);
    expect(completeRes.body.linked).toMatchObject({
      discordId: 'discord-123',
      guildId: 'guild-456',
      chain: 'solana',
      address: wallet.address
    });
    expect(completeRes.body.linked.userId).toBeTruthy();
    expect(completeRes.body.linked.walletId).toBeTruthy();

    const db = dataLayer.sqliteConnection.connect();
    const identity = db.prepare(`
      SELECT * FROM external_identities
      WHERE provider = 'discord' AND provider_user_id = 'discord-123'
    `).get();
    expect(identity.user_id).toBe(completeRes.body.linked.userId);
    expect(JSON.parse(identity.profile_json)).toEqual({ guildId: 'guild-456' });

    await request(app)
      .get('/api/link/challenge')
      .set('Host', 'cosyworld.test')
      .query({ code: initiateRes.body.code })
      .expect(410);
  });

  it('does not consume a code when signature verification fails', async () => {
    const wallet = createWallet();
    const wrongWallet = createWallet();

    const initiateRes = await request(app)
      .post('/api/link/initiate')
      .send({ discordId: 'discord-789', guildId: 'guild-456' })
      .expect(200);

    const challengeRes = await request(app)
      .get('/api/link/challenge')
      .set('Host', 'cosyworld.test')
      .query({ code: initiateRes.body.code })
      .expect(200);

    await request(app)
      .post('/api/link/complete')
      .set('Host', 'cosyworld.test')
      .send({
        code: initiateRes.body.code,
        chain: 'solana',
        address: wallet.address,
        signature: signMessageHex(challengeRes.body.message, wrongWallet.secretKey),
        message: challengeRes.body.message
      })
      .expect(401);

    await request(app)
      .post('/api/link/complete')
      .set('Host', 'cosyworld.test')
      .send({
        code: initiateRes.body.code,
        chain: 'solana',
        address: wallet.address,
        signature: signMessageHex(challengeRes.body.message, wallet.secretKey),
        message: challengeRes.body.message
      })
      .expect(200);
  });
});
