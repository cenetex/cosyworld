import { container, containerReady } from '../src/container.mjs';

async function main() {
  await containerReady;
  const memoryService = container.resolve('memoryService') || container.resolve('memoryservice');
  const db = container.resolve('databaseService');
  await db.connect();
  const avatarId = 'test-avatar';
  for (let i=0;i<10;i++) {
    await memoryService.write({ avatarId, kind: 'chat', text: `hello ${i}`, weight: 1.0 });
  }
  const res = await memoryService.query({ avatarId, queryText: 'hello 5', topK: 5 });
  console.log(JSON.stringify(res, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
