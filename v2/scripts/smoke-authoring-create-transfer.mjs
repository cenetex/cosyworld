import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium, webkit } from "playwright";
import { createServer } from "../card-game/serve.mjs";
const server = createServer();
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await (process.env.CARD_BROWSER === "webkit" ? webkit : chromium).launch({ headless: true });
try {
  const page = await browser.newPage();
  let key, committed, uploads = 0, posts = 0, accounts = 0;
  await page.route("**/auth/account", async route => {
    accounts++; await route.fulfill({ json: { authenticated: true, user_id: "owner" } });
  });
  await page.route("**/card-game/authoring/assets/*", async route => {
    const request = route.request(), bytes = request.postDataBuffer(); uploads++;
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    assert.equal(request.headers()["x-authoring-owner"], "owner");
    key ??= request.headers()["idempotency-key"];
    assert.equal(request.headers()["idempotency-key"], key);
    assert(request.url().endsWith(sha256));
    await route.fulfill({ json: { sha256, size: bytes.length } });
  });
  await page.route("**/card-game/authoring/packs", async route => {
    const request = route.request(), input = request.postDataJSON(); posts++;
    assert.equal(request.headers()["x-authoring-owner"], "owner");
    assert.equal(request.headers()["idempotency-key"], key);
    assert.deepEqual(input.launch, { schemaVersion: 1, place: "pier" });
    const { launch: _launch, ...source } = input;
    const receipt = { ...source, id: "private-world", revision: 1 };
    if (!committed) { committed = receipt; return route.abort("failed"); }
    assert.deepEqual(receipt, committed); await route.fulfill({ json: committed });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/privacy`);
  const first = await page.evaluate(async () => {
    const { openAuthoringStore } = await import("/card-game/authoring-local-store.mjs");
    const { importPack, assetMetadata } = await import("/card-game/authoring-draft.mjs");
    const { transferAuthoringCreate } = await import("/card-game/authoring-create-transfer.mjs");
    const store = await openAuthoringStore(), bytes = new TextEncoder().encode("Accepted story. 雪");
    const one = await assetMetadata("one.txt", "text/plain", bytes), two = { ...one, path: "two.txt" };
    const draft = importPack({ title: "First", pack: { id: "shore", places: { pier: {} } }, assets: [one, two] });
    await store.write("local", { draft, launch: { schemaVersion: 1, place: "pier" } }, 0,
      new Map([[one.path, bytes], [two.path, bytes]]));
    const operation = await store.beginCreate("local", "owner", 1);
    await store.write("local", { ...(await store.read("local")), draft: { ...draft, title: "Later local edit" } }, 1);
    let failed = false;
    try { await transferAuthoringCreate(store, operation); } catch { failed = true; }
    const pending = await store.readCreate("local", "owner"); store.close();
    return { failed, requestKey: pending.requestKey, receipt: pending.receipt, files: pending.assets.size };
  });
  assert.deepEqual(first, { failed: true, requestKey: key, receipt: null, files: 2 });
  await page.reload();
  const second = await page.evaluate(async () => {
    const { openAuthoringStore } = await import("/card-game/authoring-local-store.mjs");
    const { transferAuthoringCreate } = await import("/card-game/authoring-create-transfer.mjs");
    const store = await openAuthoringStore(), operation = await store.readCreate("local", "owner");
    const receipt = await transferAuthoringCreate(store, operation), local = await store.read("local");
    const saved = await store.readCreate("local", "owner"); store.close();
    return { receipt, title: local.draft.title, generation: local.generation, files: saved.assets.size };
  });
  assert.deepEqual(second, { receipt: committed, title: "Later local edit", generation: 2, files: 0 });
  await page.reload();
  const third = await page.evaluate(async () => {
    const { openAuthoringStore } = await import("/card-game/authoring-local-store.mjs");
    const { transferAuthoringCreate } = await import("/card-game/authoring-create-transfer.mjs");
    const store = await openAuthoringStore();
    try { return await transferAuthoringCreate(store, await store.readCreate("local", "owner")); }
    finally { store.close(); }
  });
  assert.deepEqual(third, committed); assert.deepEqual({ uploads, posts, accounts }, { uploads: 2, posts: 2, accounts: 3 });
  console.log("Create transfer: real IndexedDB, unique uploads, lost reply, reload retry, exact receipt and later local edits passed");
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
