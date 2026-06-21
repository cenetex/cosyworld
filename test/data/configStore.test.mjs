import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SqliteConnection } from '../../src/data/sqlite/sqliteConnection.mjs';
import { SqliteConfigStore } from '../../src/data/sqlite/sqliteConfigStore.mjs';
import { createDataLayer } from '../../src/data/dataLayer.mjs';

describe('SqliteConfigStore', () => {
  let tempDir;
  let connection;
  let store;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cosyworld-data-'));
    connection = new SqliteConnection({
      dbPath: path.join(tempDir, 'cosyworld.sqlite'),
      logger: { info() {}, warn() {}, error() {} }
    });
    store = new SqliteConfigStore({
      sqliteConnection: connection,
      logger: { info() {}, warn() {}, error() {} }
    });
  });

  afterEach(async () => {
    connection?.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('persists setup completion state', async () => {
    expect(await store.getSetupStatus()).toMatchObject({
      setupComplete: false,
      adminWallet: null
    });

    await store.markSetupComplete({ adminWallet: 'wallet-1', completedAt: new Date('2026-01-02T03:04:05Z') });

    expect(await store.getSetupStatus()).toMatchObject({
      setupComplete: true,
      adminWallet: 'wallet-1',
      setupDate: '2026-01-02T03:04:05.000Z'
    });
  });

  it('updates and resets setup state', async () => {
    await store.markSetupComplete({ adminWallet: 'wallet-1' });
    await store.updateAdminWallet('wallet-2');

    expect(await store.getSetupStatus()).toMatchObject({
      setupComplete: true,
      adminWallet: 'wallet-2'
    });

    await store.resetSetup();

    expect(await store.getSetupStatus()).toMatchObject({
      setupComplete: false,
      adminWallet: null
    });
  });

  it('stores settings by key and scope', async () => {
    await store.setSetting('payment.x402.enabled', true);
    await store.setSetting('guild_defaults', { prompts: { summon: 'hello' } }, { scope: 'global_settings' });

    expect(await store.getSetting('payment.x402.enabled')).toBe(true);
    expect(await store.getSetting('guild_defaults', { scope: 'global_settings' })).toEqual({
      prompts: { summon: 'hello' }
    });

    expect(await store.listSettings({ keyPrefix: 'payment.' })).toEqual([
      expect.objectContaining({
        key: 'payment.x402.enabled',
        scope: 'global',
        value: true
      })
    ]);
  });

  it('stores guild configs as merged patches', async () => {
    await store.saveGuildConfig('guild-1', { whitelisted: true, prompts: { attack: 'swing' } });
    await store.saveGuildConfig('guild-1', { viewDetailsEnabled: false });

    expect(await store.getGuildConfig('guild-1')).toMatchObject({
      guildId: 'guild-1',
      whitelisted: true,
      viewDetailsEnabled: false,
      prompts: { attack: 'swing' }
    });

    expect(await store.listGuildConfigs()).toHaveLength(1);
  });
});

describe('createDataLayer', () => {
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

  it('selects the SQLite backend without requiring MongoDB', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cosyworld-layer-'));
    process.env.DATA_BACKEND = 'sqlite';
    process.env.SQLITE_DB_PATH = path.join(tempDir, 'cosyworld.sqlite');

    const dataLayer = createDataLayer({
      logger: { info() {}, warn() {}, error() {} },
      databaseService: {
        getDatabase() {
          throw new Error('Mongo should not be used for sqlite backend selection');
        }
      }
    });

    await dataLayer.initialize();
    await dataLayer.config.markSetupComplete({ adminWallet: 'wallet-3' });

    expect(dataLayer.backend).toBe('sqlite');
    expect(await dataLayer.config.getSetupStatus()).toMatchObject({
      setupComplete: true,
      adminWallet: 'wallet-3'
    });

    dataLayer.sqliteConnection.close();
  });
});
