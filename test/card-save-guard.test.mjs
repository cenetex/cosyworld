import { describe, expect, it } from "vitest";
import { sealSave, writeSave } from "../v2/card-game/save-guard.mjs";
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
      expect(() => writeSave(store, KEY, world, codec)).toThrow();
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
      "unreadable",
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
