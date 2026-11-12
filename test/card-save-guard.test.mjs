import { describe, expect, it } from "vitest";
import {
  attemptPlay,
  loadFault,
  openSave,
  saveDiagnostic,
  sealSave,
  writeSave,
} from "../v2/card-game/save-guard.mjs";
import { installBackupControls } from "../v2/card-game/local-saves.mjs";
import { SAVE_SCHEMA } from "../v2/card-game/legacy-saves.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";

const codec = { encode: encodeSave, read: decodeSave };
const KEY = "table";

function storage(initial) {
  const values = new Map(initial ? [[KEY, initial]] : []);
  let writes = 0;
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      writes++;
      values.set(key, value);
    },
    writes: () => writes,
  };
}

function played(turns = 3) {
  let world = createWorld();
  for (let i = 0; i < turns; i++) {
    const result = play(world, legalActions(world)[0]);
    if (result.ok) world = result.state;
  }
  return world;
}

describe("a save is written only when it reads back", () => {
  it("writes the bytes that the loader accepts", () => {
    const world = played();
    const store = storage();
    const text = writeSave(store, KEY, world, codec);
    expect(store.getItem(KEY)).toBe(text);
    expect(encodeSave(decodeSave(text))).toBe(text);
  });

  it.each([
    ["a top-level field", (world) => (world.turn = -1)],
    ["a nested field", (world) => (Object.values(world.items)[0].holder = "no-such-holder")],
    ["a removed section", (world) => delete world.actors],
  ])("keeps the last good save when %s is invalid", (_name, spoil) => {
    const good = encodeSave(played());
    const store = storage(good);
    const world = played(5);
    spoil(world);
    for (let i = 0; i < 3; i++)
      expect(() => writeSave(store, KEY, world, codec)).toThrow(
        expect.objectContaining({ code: "save.invariant.encode" }),
      );
    expect(store.writes()).toBe(0);
    expect(store.getItem(KEY)).toBe(good);
    expect(() => decodeSave(store.getItem(KEY))).not.toThrow();
  });

  it("refuses bytes the loader rejects even when the encoder accepts them", () => {
    const store = storage("last good");
    const lossy = {
      encode: (world) => JSON.stringify(world),
      read: (text) => {
        if (JSON.parse(text).turn === null) throw new Error("unreadable");
      },
    };
    expect(() => writeSave(store, KEY, { turn: NaN }, lossy)).toThrow(
      expect.objectContaining({ code: "save.invariant.readback" }),
    );
    expect(store.writes()).toBe(0);
    expect(store.getItem(KEY)).toBe("last good");
    expect(writeSave(store, KEY, { turn: 4 }, lossy)).toBe('{"turn":4}');
  });

  it("never reads back into the world being saved", () => {
    const world = { turn: 1 };
    const seen = [];
    const text = sealSave(world, {
      encode: (value) => JSON.stringify(value),
      read: (value) => seen.push(value),
    });
    expect(seen).toEqual([text]);
    expect(world).toEqual({ turn: 1 });
  });
});

describe("each save failure has its own kind", () => {
  const open = (text) => openSave(text, { read: decodeSave, schema: SAVE_SCHEMA });
  const codeOf = (run) => {
    try {
      run();
    } catch (error) {
      return error.code;
    }
    return null;
  };

  it("turns a thrown play into a refusal that keeps the world", () => {
    const world = played();
    const before = encodeSave(world);
    for (let i = 0; i < 3; i++) {
      const result = attemptPlay(() => {
        throw new Error("private detail");
      }, codec);
      expect(result).toMatchObject({
        ok: false,
        fault: { kind: "transition", code: "save.transition.play" },
      });
      expect(result.error).not.toMatch(/private|new game|fresh start/i);
    }
    expect(encodeSave(world)).toBe(before);
  });

  it("refuses a successor that could not be saved", () => {
    const world = played();
    const bad = structuredClone(world);
    bad.turn = -1;
    const result = attemptPlay(() => ({ ok: true, state: bad }), codec);
    expect(result.ok).toBe(false);
    expect(result.state).toBeUndefined();
    expect(result.fault.code).toBe("save.transition.successor");
    expect(result.fault.cause.code).toBe("save.invariant.encode");
  });

  it("passes ordinary rejections and good plays through", () => {
    const world = played();
    const refusal = { ok: false, error: "Not now." };
    expect(attemptPlay(() => refusal, codec)).toBe(refusal);
    const good = attemptPlay(() => play(world, legalActions(world)[0]), codec);
    expect(good.ok).toBe(true);
    expect(good.fault).toBeUndefined();
  });

  it("names unavailable storage apart from an invalid world", () => {
    const full = {
      getItem: () => "last good",
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(codeOf(() => writeSave(full, KEY, played(), codec))).toBe(
      "save.storage.write",
    );
    expect(full.getItem(KEY)).toBe("last good");
    expect(loadFault(new Error("offline"), null).kind).toBe("storage");
    expect(loadFault(new Error("odd"), "{}").kind).toBe("incompatible");
  });

  it("names why a save cannot be opened", () => {
    const good = encodeSave(played());
    expect(open(good).turn).toBe(JSON.parse(good).turn);
    expect(codeOf(() => open("not a save"))).toBe("save.incompatible.parse");
    expect(
      codeOf(() => open(JSON.stringify({ ...JSON.parse(good), schema: SAVE_SCHEMA + 1 }))),
    ).toBe("save.incompatible.schema");
    expect(
      codeOf(() => open(JSON.stringify({ ...JSON.parse(good), turn: -1 }))),
    ).toBe("save.incompatible.rules");
  });

  it("keeps the saved game when an import cannot be opened", async () => {
    const good = encodeSave(played());
    const store = storage(good);
    const nodes = { "local-settings": {}, "local-save-status": {}, "local-export": {}, "local-import": {} };
    installBackupControls({
      slot: KEY,
      backups: { queue: async () => true },
      getSave: () => good,
      validate: open,
      storage: store,
      doc: { getElementById: (id) => nodes[id] },
      reload: () => {},
    });
    const bad = JSON.stringify({ ...JSON.parse(good), turn: -1 });
    for (let i = 0; i < 2; i++)
      await nodes["local-import"].onchange({
        target: { files: [{ size: bad.length, text: async () => bad }] },
      });
    expect(store.writes()).toBe(0);
    expect(store.getItem(KEY)).toBe(good);
    expect(nodes["local-save-status"].textContent).toMatch(/cannot be opened/);
  });

  it("reports a code and safe ids, never the save", () => {
    const world = played();
    const fault = attemptPlay(() => {
      throw new Error("secret words");
    }, codec).fault;
    const report = saveDiagnostic(fault, {
      world,
      action: { kind: "give", item: "some-item", note: "Secret words here" },
      build: "v0 · rules 0",
    });
    expect(report).toEqual({
      code: "save.transition.play",
      schema: SAVE_SCHEMA,
      turn: world.turn,
      revision: world.revision,
      ids: ["give", "some-item"],
      build: "v0 · rules 0",
    });
    expect(JSON.stringify(report)).not.toMatch(/secret/i);
  });
});
