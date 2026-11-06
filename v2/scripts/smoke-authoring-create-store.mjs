import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
import { createServer } from "../card-game/serve.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await { chromium, webkit }[
  process.env.CARD_BROWSER || "chromium"
].launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/privacy`);
  const result = await page.evaluate(async () => {
    const { openAuthoringStore } = await import(
      "/card-game/authoring-local-store.mjs"
    );
    const { importPack, assetMetadata } = await import(
      "/card-game/authoring-draft.mjs"
    );
    const check = (value, label) => {
      if (!value) throw new Error(label);
    };
    const fails = async (run) => {
      let rejected = false;
      try {
        await run();
      } catch {
        rejected = true;
      }
      check(rejected, "operation must reject");
    };
    const bytes = new TextEncoder().encode("The ship carries a lantern. 雪"),
      meta = await assetMetadata("lore.md", "text/markdown", bytes),
      draft = importPack({
        title: "Crossing",
        document: "Accepted world notes",
        assets: [meta],
        pack: { places: { port: {}, ship: { requires: { quest: "key" } } } },
        bridge: { transports: { boat: { place: "ship", at: "port" } } },
      }),
      source = { draft, launch: { schemaVersion: 1, place: "ship" } };
    const legacy = await new Promise((resolve, reject) => {
      const request = indexedDB.open("cosyworld.authoring", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("drafts", { keyPath: "key" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = legacy.transaction("drafts", "readwrite");
      tx.objectStore("drafts").put({
        key: "legacy",
        generation: 7,
        ...source,
        assets: new Map([[meta.path, bytes]]),
      });
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    let upgraded = false;
    legacy.onversionchange = () => {
      upgraded = true;
      legacy.close();
    };
    const a = await openAuthoringStore(),
      b = await openAuthoringStore();
    check(
      upgraded && (await a.read("legacy")).generation === 7,
      "preserve version 1 draft",
    );
    await a.write("draft", source, 0, new Map([[meta.path, bytes]]));
    await fails(() => a.beginCreate("draft", "owner-a", 0));
    await fails(() => a.beginCreate("draft", "owner-a", 2));
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === "creates")
        throw new DOMException("Full", "QuotaExceededError");
      return add.apply(this, args);
    };
    try {
      await fails(() => a.beginCreate("draft", "owner-a", 1));
    } finally {
      IDBObjectStore.prototype.add = add;
    }
    check(
      (await a.readCreate("draft", "owner-a")) === null,
      "failed start leaves no operation",
    );
    const starts = await Promise.all([
      a.beginCreate("draft", "owner-a", 1),
      b.beginCreate("draft", "owner-a", 1),
    ]);
    check(
      starts[0].requestKey === starts[1].requestKey,
      "concurrent tabs share one request",
    );
    const pending = starts[0];
    bytes.fill(0);
    pending.assets.get(meta.path).fill(0);
    await a.write(
      "draft",
      { ...source, draft: { ...draft, title: "Later local edit" } },
      1,
    );
    await fails(() => b.beginCreate("draft", "owner-a", 2));
    const other = await b.beginCreate("draft", "owner-b", 2);
    check(
      other.requestKey !== pending.requestKey,
      "accounts keep separate requests",
    );
    const original = await a.readCreate("draft", "owner-a");
    check(
      original.draft.title === "Crossing" &&
        new TextDecoder().decode(original.assets.get(meta.path)).endsWith("雪"),
      "immutable snapshot and bytes",
    );
    const receipt = { ...draft, id: "private-pack", revision: 1 };
    await fails(() =>
      a.finishCreate("draft", "owner-b", original.requestKey, receipt),
    );
    await fails(() =>
      a.finishCreate("draft", "owner-a", "wrong-request", receipt),
    );
    await fails(() =>
      a.finishCreate("draft", "owner-a", original.requestKey, {
        ...receipt,
        title: "Wrong",
      }),
    );
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "creates")
        throw new DOMException("Full", "QuotaExceededError");
      return put.apply(this, args);
    };
    try {
      await fails(() =>
        a.finishCreate("draft", "owner-a", original.requestKey, receipt),
      );
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    a.close();
    b.close();
    return { requestKey: original.requestKey, receipt };
  });
  await page.reload();
  const saved = await page.evaluate(async ({ requestKey, receipt }) => {
    const { openAuthoringStore } = await import(
      "/card-game/authoring-local-store.mjs"
    );
    const a = await openAuthoringStore(),
      b = await openAuthoringStore();
    const pending = await a.readCreate("draft", "owner-a");
    assertPending();
    function assertPending() {
      if (
        pending.requestKey !== requestKey ||
        pending.receipt !== null ||
        pending.assets.size !== 1
      )
        throw new Error("reload must preserve the unacknowledged Create");
    }
    const sorted = JSON.parse(
      JSON.stringify(receipt, (_key, value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(
              Object.keys(value)
                .sort()
                .reverse()
                .map((key) => [key, value[key]]),
            )
          : value,
      ),
    );
    const done = await Promise.all([
      a.finishCreate("draft", "owner-a", requestKey, sorted),
      b.finishCreate("draft", "owner-a", requestKey, receipt),
    ]);
    let differentRejected = false;
    try {
      await a.finishCreate("draft", "owner-a", requestKey, {
        ...receipt,
        id: "other-pack",
      });
    } catch {
      differentRejected = true;
    }
    const current = await a.read("draft"),
      other = await a.readCreate("draft", "owner-b");
    a.close();
    b.close();
    return {
      ids: done.map(({ receipt }) => receipt.id),
      sizes: done.map(({ assets }) => assets.size),
      title: current.draft.title,
      files: current.assets.size,
      otherPending: other.receipt === null,
      differentRejected,
      launch: pending.launch,
      bridge: pending.draft.bridge,
    };
  }, result);
  assert.deepEqual(saved, {
    ids: ["private-pack", "private-pack"],
    sizes: [0, 0],
    title: "Later local edit",
    files: 1,
    otherPending: true,
    differentRejected: true,
    launch: { schemaVersion: 1, place: "ship" },
    bridge: { transports: { boat: { place: "ship", at: "port" } } },
  });
  await page.reload();
  assert.equal(
    await page.evaluate(async () => {
      const { openAuthoringStore } = await import(
        "/card-game/authoring-local-store.mjs"
      );
      const store = await openAuthoringStore();
      const value = await store.readCreate("draft", "owner-a");
      store.close();
      return value.receipt.id;
    }),
    "private-pack",
  );
  console.log(
    "Create store: migration, two tabs, account binding, quota recovery, exact reload and receipt passed",
  );
  await page.close();
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
