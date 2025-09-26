import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { BotAccountService } from '../src/services/social/botAccountService.mjs';

class FakeDb {
  constructor() { this.records = []; }
  collection() {
    return {
      updateOne: async (filter, update, opts) => {
        const idx = this.records.findIndex(r => r.avatarId===filter.avatarId && r.platform===filter.platform);
        const data = { ...filter, ...update.$set };
        if (idx>=0) this.records[idx] = data; else this.records.push(data);
      },
      deleteOne: async (filter) => {
        this.records = this.records.filter(r => !(r.avatarId===filter.avatarId && r.platform===filter.platform));
      },
      find: (query) => ({ toArray: async () => this.records.filter(r => r.avatarId===query.avatarId) })
    };
  }
}

class FakeDatabaseService {
  constructor(db){ this.db=db; }
  async getDatabase(){ return this.db; }
}

test('BotAccountService link/unlink', async () => {
  const db = new FakeDb();
  const service = new BotAccountService({ logger: console, databaseService: new FakeDatabaseService(db) });

  await service.linkAccount('a1', 'discord', { accountId: 'd1' });
  let acc = await service.getAccounts('a1');
  assert.strictEqual(acc.length, 1);
  assert.strictEqual(acc[0].accountId, 'd1');

  await service.unlinkAccount('a1', 'discord');
  acc = await service.getAccounts('a1');
  assert.strictEqual(acc.length, 0);
});
