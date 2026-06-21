import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDataLayer } from '../../src/data/dataLayer.mjs';
import { SqliteConnection } from '../../src/data/sqlite/sqliteConnection.mjs';
import { SqliteIdentityStore } from '../../src/data/sqlite/sqliteIdentityStore.mjs';

const quietLogger = { info() {}, warn() {}, error() {}, debug() {} };

describe('SqliteIdentityStore', () => {
  let tempDir;
  let connection;
  let store;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cosyworld-identity-'));
    connection = new SqliteConnection({
      dbPath: path.join(tempDir, 'cosyworld.sqlite'),
      logger: quietLogger
    });
    store = new SqliteIdentityStore({ sqliteConnection: connection, logger: quietLogger });
  });

  afterEach(async () => {
    connection?.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('creates users with normalized wallets and display addresses', async () => {
    const first = await store.upsertWalletUser({
      address: '0xAbC0000000000000000000000000000000001234',
      chain: 'base',
      isAdmin: true
    });

    const second = await store.upsertWalletUser({
      address: '0xabc0000000000000000000000000000000001234',
      chain: 'base'
    });

    expect(second.user.id).toBe(first.user.id);
    expect(second.wallet.id).toBe(first.wallet.id);
    expect(second.wallet.normalizedAddress).toBe('0xabc0000000000000000000000000000000001234');

    const found = await store.findUserByWallet('0xABC0000000000000000000000000000000001234', { chain: 'base' });
    expect(found).toMatchObject({ id: first.user.id, isAdmin: true });
  });

  it('updates admin status and resolves users by id', async () => {
    const { user } = await store.upsertWalletUser({ address: 'SoLWallet111', chain: 'solana' });
    expect(user.isAdmin).toBe(false);

    await store.setAdminStatus({ userId: user.id, isAdmin: true });

    expect(await store.findUserById(user.id)).toMatchObject({
      id: user.id,
      isAdmin: true
    });
  });

  it('creates and consumes wallet challenges once', async () => {
    const challenge = await store.createWalletChallenge({
      address: 'SoLWallet222',
      chain: 'solana',
      purpose: 'login',
      nonce: 'nonce-1',
      message: 'Sign nonce-1'
    });

    const consumed = await store.consumeWalletChallenge({
      address: 'SoLWallet222',
      chain: 'solana',
      purpose: 'login',
      nonce: 'nonce-1'
    });

    expect(consumed).toMatchObject({
      id: challenge.id,
      purpose: 'login',
      message: 'Sign nonce-1'
    });

    expect(await store.consumeWalletChallenge({ challengeId: challenge.id })).toBeNull();
  });

  it('creates revocable sessions that resolve current user state', async () => {
    const { user } = await store.upsertWalletUser({ address: 'SoLWallet333' });
    const session = await store.createSession({ userId: user.id, metadata: { ip: '127.0.0.1' } });

    expect(await store.getSession(session.id)).toMatchObject({
      id: session.id,
      userId: user.id,
      metadata: { ip: '127.0.0.1' },
      user: { id: user.id, isAdmin: false }
    });

    await store.revokeSession(session.id);
    expect(await store.getSession(session.id)).toBeNull();
  });

  it('links external identities to users', async () => {
    const { user } = await store.upsertWalletUser({ address: 'SoLWallet444' });
    await store.linkExternalIdentity({
      userId: user.id,
      provider: 'discord',
      providerUserId: 'discord-123',
      profile: { username: 'rat' }
    });

    const row = connection.connect()
      .prepare('SELECT * FROM external_identities WHERE provider = ? AND provider_user_id = ?')
      .get('discord', 'discord-123');

    expect(row.user_id).toBe(user.id);
    expect(JSON.parse(row.profile_json)).toEqual({ username: 'rat' });
  });

  it('creates and consumes OAuth state once', async () => {
    const state = await store.createOAuthState({
      provider: 'x',
      owner: { kind: 'avatar', id: 'avatar-1' },
      codeVerifier: 'verifier',
      scopes: ['tweet.write'],
      payload: { walletId: 'wallet-1' }
    });

    const consumed = await store.consumeOAuthState({ provider: 'x', state: state.state });

    expect(consumed).toMatchObject({
      provider: 'x',
      owner: { kind: 'avatar', id: 'avatar-1' },
      codeVerifier: 'verifier',
      scopes: ['tweet.write'],
      payload: { walletId: 'wallet-1' }
    });

    expect(await store.consumeOAuthState({ provider: 'x', state: state.state })).toBeNull();
  });

  it('stores provider credentials by explicit owner', async () => {
    await store.saveProviderCredential({
      provider: 'x',
      owner: { kind: 'global', id: 'global' },
      credential: { accessToken: 'encrypted-access', refreshToken: 'encrypted-refresh' },
      profile: { username: 'cosy' },
      scopes: ['tweet.write'],
      expiresAt: '2026-01-01T00:00:00.000Z'
    });

    expect(await store.getProviderCredential({
      provider: 'x',
      owner: { kind: 'global', id: 'global' }
    })).toMatchObject({
      provider: 'x',
      owner: { kind: 'global', id: 'global' },
      credential: { accessToken: 'encrypted-access', refreshToken: 'encrypted-refresh' },
      profile: { username: 'cosy' },
      scopes: ['tweet.write']
    });

    expect(await store.deleteProviderCredential({
      provider: 'x',
      owner: { kind: 'global', id: 'global' }
    })).toBe(true);

    expect(await store.getProviderCredential({
      provider: 'x',
      owner: { kind: 'global', id: 'global' }
    })).toBeNull();
  });
});

describe('dataLayer.identity', () => {
  const originalBackend = process.env.DATA_BACKEND;
  const originalSqlitePath = process.env.SQLITE_DB_PATH;
  let tempDir;

  afterEach(async () => {
    if (originalBackend === undefined) delete process.env.DATA_BACKEND;
    else process.env.DATA_BACKEND = originalBackend;

    if (originalSqlitePath === undefined) delete process.env.SQLITE_DB_PATH;
    else process.env.SQLITE_DB_PATH = originalSqlitePath;

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('initializes identity store in SQLite mode without MongoDB', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cosyworld-layer-identity-'));
    process.env.DATA_BACKEND = 'sqlite';
    process.env.SQLITE_DB_PATH = path.join(tempDir, 'cosyworld.sqlite');

    const dataLayer = createDataLayer({
      logger: quietLogger,
      databaseService: {
        getDatabase() {
          throw new Error('Mongo should not be used for sqlite backend selection');
        }
      }
    });

    await dataLayer.initialize();
    const { user } = await dataLayer.identity.upsertWalletUser({ address: 'SoLWallet555' });

    expect(dataLayer.identity).toBeTruthy();
    expect(await dataLayer.identity.findUserById(user.id)).toMatchObject({ id: user.id });

    dataLayer.sqliteConnection.close();
  });
});
