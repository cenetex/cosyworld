import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const url = `http://127.0.0.1:${server.address().port}/privacy`;
  const a = await context.newPage(), b = await context.newPage();
  for (const page of [a, b]) {
    await page.goto(url);
    await page.evaluate(async () => {
      window.reset = await import("/card-game/account-reset-storage.mjs");
      const { openAuthoringStore } = await import("/card-game/authoring-local-store.mjs");
      window.store = await openAuthoringStore();
      reset.accountStorage.setItem("cosyworld.cards.test", "old");
      await store.putJob({ id: "test", draftKey: "draft", kind: "image" });
    });
  }
  await a.evaluate(() => reset.beginBrowserReset({ id: "first", userId: "test", revision: 0 }));
  assert.equal(await b.evaluate(async () => {
    try { await store.putJob({ id: "late", draftKey: "draft", kind: "image" }); return false; }
    catch { return true; }
  }), true);
  await a.evaluate(async () => {
    await reset.clearBrowserAccountData("first");
    reset.finishBrowserReset("first");
  });
  assert.equal(await b.evaluate(() => {
    try { reset.accountStorage.setItem("cosyworld.cards.test", "late"); return false; }
    catch { return true; }
  }), true);
  await a.reload();
  assert.deepEqual(await a.evaluate(async () => {
    const reset = await import("/card-game/account-reset-storage.mjs");
    const { openAuthoringStore } = await import("/card-game/authoring-local-store.mjs");
    const store = await openAuthoringStore();
    const result = [reset.accountStorage.getItem("cosyworld.cards.test"), await store.readJobs("draft")];
    store.close();
    return result;
  }), [null, []]);
  // A legacy client blocking deletion requires an explicit close and retry.
  await b.evaluate(async () => {
    window.blocker = await new Promise((resolve) => {
      const request = indexedDB.open("cosyworld.authoring:first", 3);
      request.onsuccess = () => resolve(request.result);
    });
  });
  assert.equal(await a.evaluate(async () => {
    window.reset = await import("/card-game/account-reset-storage.mjs");
    reset.beginBrowserReset({ id: "second", userId: "test", revision: 1 });
    try { await reset.clearBrowserAccountData("second"); return false; }
    catch { return reset.pendingBrowserReset().id === "second"; }
  }), true);
  await b.evaluate(() => blocker.close());
  await a.evaluate(async () => {
    await reset.clearBrowserAccountData("second");
    reset.finishBrowserReset("second");
  });
  console.log("account reset: real IndexedDB, two tabs, stale callbacks and blocked retry passed");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
