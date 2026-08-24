import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const index = fs.readFileSync(path.join(repoRoot, "v2/orchestrator-rust/src/index.html"), "utf8");

const ACTOR_ID_KEY = "cosyworld.actorId";
const ACTOR_SESSION_KEY = "cosyworld.actorSession";
const GATE_VERSION_KEY = "cosyworld.avatarGateVersion";
const EXPIRY_KEY = "cosyworld.actorSessionExpiresAtUnix";

function extractStoredAvatarCredentials() {
  const marker = "function storedAvatarCredentials() {";
  const start = index.indexOf(marker);
  expect(start, "index.html must define storedAvatarCredentials()").toBeGreaterThanOrEqual(0);
  let depth = 0;
  let end = -1;
  for (let at = start + marker.length - 1; at < index.length; at += 1) {
    const character = index[at];
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        end = at + 1;
        break;
      }
    }
  }
  expect(end, "storedAvatarCredentials() must be balanced").toBeGreaterThan(start);
  return new Function(
    "localStorage",
    "avatarGateVersion",
    "actorSessionExpiryStorageKey",
    `${index.slice(start, end)}\nreturn storedAvatarCredentials();`,
  );
}

function stubStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
}

describe("avatar credential persistence across client updates", () => {
  it("keeps stored credentials when the gate version has moved on", () => {
    const storage = stubStorage({
      [ACTOR_ID_KEY]: "8316",
      [ACTOR_SESSION_KEY]: "session-token-from-an-older-client",
      [GATE_VERSION_KEY]: "1",
      [EXPIRY_KEY]: "4102444800",
    });
    const storedAvatarCredentials = extractStoredAvatarCredentials();
    const credentials = storedAvatarCredentials(storage, "2", EXPIRY_KEY);
    expect(credentials).toEqual({
      actorId: 8316,
      actorSession: "session-token-from-an-older-client",
      actorSessionExpiresAtUnix: 4102444800,
    });
    expect(storage.getItem(ACTOR_SESSION_KEY)).toBe("session-token-from-an-older-client");
    expect(storage.getItem(GATE_VERSION_KEY)).toBe("2");
  });

  it("leaves matching-version credentials untouched", () => {
    const storage = stubStorage({
      [ACTOR_ID_KEY]: "8316",
      [ACTOR_SESSION_KEY]: "current-token",
      [GATE_VERSION_KEY]: "2",
      [EXPIRY_KEY]: "4102444800",
    });
    const storedAvatarCredentials = extractStoredAvatarCredentials();
    const credentials = storedAvatarCredentials(storage, "2", EXPIRY_KEY);
    expect(credentials.actorId).toBe(8316);
    expect(credentials.actorSession).toBe("current-token");
    expect(credentials.actorSessionExpiresAtUnix).toBe(4102444800);
    expect(storage.getItem(GATE_VERSION_KEY)).toBe("2");
  });

  it("treats partial credentials as absent and clears them", () => {
    for (const partial of [
      { [ACTOR_ID_KEY]: "8316" },
      { [ACTOR_ID_KEY]: "", [ACTOR_SESSION_KEY]: "orphan-token" },
      {},
    ]) {
      const storage = stubStorage(partial);
      const storedAvatarCredentials = extractStoredAvatarCredentials();
      const credentials = storedAvatarCredentials(storage, "2", EXPIRY_KEY);
      expect(credentials).toEqual({ actorId: 0, actorSession: "", actorSessionExpiresAtUnix: 0 });
      expect(storage.getItem(ACTOR_ID_KEY)).toBeNull();
      expect(storage.getItem(ACTOR_SESSION_KEY)).toBeNull();
      expect(storage.getItem(EXPIRY_KEY)).toBeNull();
    }
  });

  it("never removes credential keys while valid credentials are present", () => {
    const removalCalls = [];
    const storage = stubStorage({
      [ACTOR_ID_KEY]: "8316",
      [ACTOR_SESSION_KEY]: "token",
      [GATE_VERSION_KEY]: "0",
    });
    storage.removeItem = (key) => removalCalls.push(key);
    const storedAvatarCredentials = extractStoredAvatarCredentials();
    storedAvatarCredentials(storage, "2", EXPIRY_KEY);
    expect(removalCalls).toEqual([]);
  });
});
