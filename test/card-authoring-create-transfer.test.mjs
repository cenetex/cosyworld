import { expect, it, vi } from "vitest";
import { importPack, assetMetadata } from "../v2/card-game/authoring-draft.mjs";
import { transferAuthoringCreate as transfer } from "../v2/card-game/authoring-create-transfer.mjs";
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
async function fixture() {
  const assets = new Map([["one.txt", Uint8Array.of(1)], ["same.txt", Uint8Array.of(1)], ["two.txt", Uint8Array.of(2)]]);
  const draft = importPack({ title: "Crossing", document: "Saved original notes", pack: { id: "shore", places: { pier: {} } },
    assets: await Promise.all([...assets].map(([path, bytes]) => assetMetadata(path, "text/plain", bytes))) });
  const operation = { draftKey: "local", owner: "user-one", requestKey: "12345678-1234-4234-8234-123456789abc",
    generation: 1, draft, launch: { schemaVersion: 1, place: "pier" }, assets, receipt: null };
  let durable = structuredClone(operation), localDraft = structuredClone(draft);
  const store = {
    readCreate: vi.fn(async () => structuredClone(durable)),
    finishCreate: vi.fn(async (_key, _owner, _request, receipt) => {
      durable = { ...durable, receipt, assets: new Map() }; return structuredClone(durable);
    }),
  };
  const sentDraft = structuredClone(draft), receipt = { ...draft, id: "private-one", revision: 1 };
  let account = "user-one", active = 0, peak = 0;
  const fetch = vi.fn(async (url, options) => {
    expect(options).toMatchObject({ credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" });
    expect(options.headers).toMatchObject({ "X-Authoring-Owner": "user-one", "Idempotency-Key": operation.requestKey });
    if (url === "/auth/account") return json({ authenticated: true, user_id: account });
    if (account !== options.headers["X-Authoring-Owner"]) return json({ error: "Open the first account." }, 409);
    if (options.method === "PUT") {
      active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 1)); active--;
      const meta = await assetMetadata("file.txt", "text/plain", options.body);
      expect(url).toBe(`/card-game/authoring/assets/${meta.sha256}`);
      return json({ sha256: meta.sha256, size: meta.size });
    }
    expect(JSON.parse(options.body)).toEqual({ schemaVersion: sentDraft.schemaVersion, title: sentDraft.title,
      document: sentDraft.document, pack: sentDraft.pack, bridge: sentDraft.bridge, assets: sentDraft.assets, sources: sentDraft.sources,
      launch: operation.launch });
    return json(receipt);
  });
  return { operation, store, fetch, receipt, get durable() { return durable; }, get local() { return localDraft; },
    rename() { localDraft.title = "A later local edit"; }, switchAccount() { account = "user-two"; }, get peak() { return peak; } };
}
it("uploads each verified SHA once in order and acknowledges the original source", async () => {
  const f = await fixture(); f.operation.draft.title = "Changed caller copy"; f.rename();
  const result = await transfer(f.store, f.operation, { fetch: f.fetch });
  expect(result).toEqual(f.receipt); expect(f.peak).toBe(1);
  expect(f.fetch.mock.calls.map(([, options]) => options.method)).toEqual(["GET", "PUT", "PUT", "POST"]);
  expect(f.local.title).toBe("A later local edit"); expect(f.durable.assets.size).toBe(0);
  f.fetch.mockClear();
  expect(await transfer(f.store, f.operation, { fetch: f.fetch })).toEqual(result);
  expect(f.fetch).toHaveBeenCalledTimes(1); expect(f.store.finishCreate).toHaveBeenCalledTimes(1);
});
it("retries a lost Create reply from durable bytes and keeps the first receipt", async () => {
  const f = await fixture(), postBodies = []; let committed = false;
  const fetch = async (url, options) => {
    const response = await f.fetch(url, options);
    if (options.method === "POST") {
      postBodies.push(options.body);
      if (!committed) { committed = true; throw new TypeError("Connection closed after commit"); }
    }
    return response;
  };
  await expect(transfer(f.store, f.operation, { fetch })).rejects.toThrow(/after commit/);
  expect(f.durable.receipt).toBeNull(); expect(f.store.finishCreate).not.toHaveBeenCalled();
  f.rename();
  const reopened = await f.store.readCreate("local", "user-one");
  expect(await transfer(f.store, reopened, { fetch })).toEqual(f.receipt);
  expect(postBodies).toHaveLength(2); expect(postBodies[0]).toBe(postBodies[1]);
  expect(f.local.title).toBe("A later local edit");
});
it("preserves pending bytes after a local receipt-write failure", async () => {
  const f = await fixture(); f.store.finishCreate.mockRejectedValueOnce(new Error("Quota full"));
  await expect(transfer(f.store, f.operation, { fetch: f.fetch })).rejects.toThrow(/Quota/);
  expect(f.durable.assets.size).toBe(3); expect(f.durable.receipt).toBeNull();
  expect(await transfer(f.store, f.operation, { fetch: f.fetch })).toEqual(f.receipt);
});
it("checks the account once and binds each later upload to that account", async () => {
  const f = await fixture(); f.switchAccount();
  await expect(transfer(f.store, f.operation, { fetch: f.fetch })).rejects.toMatchObject({ status: 409 });
  expect(f.fetch).toHaveBeenCalledTimes(1);
  const g = await fixture();
  const fetch = async (url, options) => { const result = await g.fetch(url, options); if (options.method === "PUT") g.switchAccount(); return result; };
  await expect(transfer(g.store, g.operation, { fetch })).rejects.toMatchObject({ status: 409 });
  expect(g.fetch.mock.calls.filter(([url]) => url === "/auth/account")).toHaveLength(1);
  expect(g.store.finishCreate).not.toHaveBeenCalled(); expect(g.durable.assets.size).toBe(3);
});
it.each([401, 413, 429, 503])( "keeps status %s available for recovery without acknowledging", async status => {
  const f = await fixture();
  const fetch = async (url, options) => url === "/auth/account" ? f.fetch(url, options) : json({ error: "Retry saved Create." }, status);
  await expect(transfer(f.store, f.operation, { fetch })).rejects.toMatchObject({ status });
  expect(f.store.finishCreate).not.toHaveBeenCalled(); expect(f.durable.receipt).toBeNull();
});
it("rejects corrupt saved bytes and mismatched file or world receipts", async () => {
  const f = await fixture(); f.durable.assets.get("two.txt")[0] = 9;
  await expect(transfer(f.store, f.operation, { fetch: f.fetch })).rejects.toThrow(/digest/);
  expect(f.fetch).toHaveBeenCalledTimes(1);
  for (const changed of ["file", "world"]) {
    const g = await fixture();
    const fetch = async (url, options) => {
      const response = await g.fetch(url, options);
      if (changed === "file" && options.method === "PUT") return json({ sha256: "0".repeat(64), size: 1 });
      if (changed === "world" && options.method === "POST") return json({ ...g.receipt, title: "Different" });
      return response;
    };
    await expect(transfer(g.store, g.operation, { fetch })).rejects.toThrow(/receipt/);
    expect(g.store.finishCreate).not.toHaveBeenCalled();
  }
});
it("bounds streamed replies and cancels a stalled response body", async () => {
  const f = await fixture(), cancel = vi.fn();
  const oversized = new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(65537)); }, cancel }));
  await expect(transfer(f.store, f.operation, { fetch: async () => oversized })).rejects.toThrow(/too large/);
  expect(cancel).toHaveBeenCalled();
  const stalled = new Response(new ReadableStream({ cancel }));
  await expect(transfer(f.store, f.operation, { fetch: async () => stalled, timeoutMs: 10 })).rejects.toMatchObject({ name: "TimeoutError" });
  const controller = new AbortController(); controller.abort();
  await expect(transfer(f.store, f.operation, { fetch: f.fetch, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(f.fetch).not.toHaveBeenCalled(); expect(f.store.finishCreate).not.toHaveBeenCalled();
});
