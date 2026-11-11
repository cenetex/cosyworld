import { test } from "vitest";
import assert from "node:assert/strict";
import {
  createAccountStorage, beginBrowserReset, pendingBrowserReset,
  clearBrowserAccountData, finishBrowserReset, cancelBrowserReset, clearBrowserSessionData,
} from "../v2/card-game/account-reset-storage.mjs";
const request = { id: "reset-1", userId: "alice", revision: 0 };
function storage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key: (i) => [...values.keys()][i],
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}
const databases = (event = "onsuccess", names = []) => ({
  deleteDatabase(name) {
    names.push(name);
    const result = {};
    queueMicrotask(() => result[event]());
    return result;
  },
});
test("reset fences old pages, clears browser games and preserves preferences", async () => {
  const raw = storage(), old = createAccountStorage(raw), names = [];
  for (const key of ["cosyworld.reflected-shore.v1.bak", "cosyworld.cards.other", "cosyworld.local.upgrades", "cosyworld-card-signed-words"])
    old.setItem(key, "old");
  old.setItem("cosyworld.room-music", "off");
  old.setItem("unrelated", "keep");
  old.setItem("cosyworld.play-counts", "off");
  beginBrowserReset(request, raw);
  assert.deepEqual(pendingBrowserReset(raw), request);
  assert.throws(() => old.setItem("cosyworld.cards.other", "late"), /Reload/);
  assert.throws(() => createAccountStorage(raw).getItem("cosyworld.cards.other"), /Reload/);
  assert.throws(() => finishBrowserReset(request.id, raw));
  await clearBrowserAccountData(request.id, raw, databases("onsuccess", names));
  finishBrowserReset(request.id, raw);
  assert.equal(pendingBrowserReset(raw), null);
  assert.deepEqual(names, ["cosyworld.authoring"]);
  assert.throws(() => old.setItem("cosyworld.cards.other", "late"), /Reload/);
  const fresh = createAccountStorage(raw);
  assert.equal(fresh.getItem("cosyworld.cards.other"), null);
  assert.equal(fresh.getItem("cosyworld.room-music"), "off");
  assert.equal(fresh.getItem("unrelated"), "keep");
  assert.equal(fresh.getItem("cosyworld.play-counts"), "off");
  // Even a tab running pre-reset code cannot recreate current data.
  raw.setItem("cosyworld.cards.other", "legacy late callback");
  assert.equal(fresh.getItem("cosyworld.cards.other"), null);
  fresh.setItem("cosyworld.cards.other", "new game");
  assert.equal(fresh.getItem("cosyworld.cards.other"), "new game");
  assert.equal(fresh.databaseName, "cosyworld.authoring:reset-1");
  beginBrowserReset({ ...request, id: "reset-2" }, raw);
  await clearBrowserAccountData("reset-2", raw, databases("onsuccess", names));
  assert.deepEqual(names, ["cosyworld.authoring", "cosyworld.authoring:reset-1"]);
});
test("blocked database cleanup stays pending and retries after reload", async () => {
  const raw = storage();
  beginBrowserReset(request, raw);
  await assert.rejects(clearBrowserAccountData(request.id, raw, databases("onblocked")), /Close other/);
  assert.deepEqual(pendingBrowserReset(raw), request);
  assert.throws(() => cancelBrowserReset(request.id, raw));
  assert.throws(() => finishBrowserReset(request.id, raw));
  await clearBrowserAccountData(request.id, raw, databases());
  finishBrowserReset(request.id, raw);
  assert.equal(pendingBrowserReset(raw), null);
});
test("definitive server refusal preserves games but requires a reload", () => {
  const raw = storage(), old = createAccountStorage(raw);
  old.setItem("cosyworld.cards.one", "save");
  beginBrowserReset(request, raw);
  cancelBrowserReset(request.id, raw);
  assert.throws(() => old.getItem("cosyworld.cards.one"));
  assert.equal(createAccountStorage(raw).getItem("cosyworld.cards.one"), "save");
});

test("session hints use the browser epoch and stale tabs cannot restore them", async () => {
  const raw = storage(), session = storage(), old = createAccountStorage(session, raw);
  old.setItem("cosyworld.invite", "old world");
  beginBrowserReset(request, raw);
  assert.throws(() => old.setItem("cosyworld.menu", "old avatar"));
  clearBrowserSessionData(session);
  assert.equal(session.length, 0);
  await clearBrowserAccountData(request.id, raw, databases());
  finishBrowserReset(request.id, raw);
  session.setItem("cosyworld.invite", "legacy callback");
  assert.equal(createAccountStorage(session, raw).getItem("cosyworld.invite"), null);
});
