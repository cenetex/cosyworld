import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
} from "../v2/card-game/world.mjs";
import { availableCards, cardActions } from "../v2/card-game/cards.mjs";

// A local save written by the 1.2.105 release (shared rules 57): Vale at
// Black pond, where the save had found Hoppy Cat's retired red thread.
const released = readFileSync(
  new URL("./fixtures/card-save-rules-57-pond-thread.json", import.meta.url),
  "utf8",
);
const THREAD = "hoppycat-pond-garden";
const GARDEN = "hoppycat-halfway-tea-garden";
const reachable = (s) =>
  legalActions(s, "vale")
    .filter((a) => ["move", "course"].includes(a.kind))
    .map((a) => a.target);
const exercise = (s) => {
  for (const id of availableCards(s)) cardActions(s, [id]);
  return legalActions(s);
};

describe("a loaded save follows the current content", () => {
  it("loads a rules 57 save without the retired road from Black pond", () => {
    const s = decodeSave(released);
    expect(s.actors.vale.place).toBe("pond");
    expect(s.crossings[THREAD].discovered).toBe(false);
    expect(reachable(s)).not.toContain(GARDEN);
    expect(() => exercise(s)).not.toThrow();
  });

  it("adds a thing the save lacks and drops one the content no longer has", () => {
    const s = JSON.parse(released);
    delete s.items.bell;
    delete s.items.cloth;
    s.items["retired-thing"] = { holder: "vale", history: [] };
    s.items.lamp.holder = "retired-thing";
    const loaded = decodeSave(JSON.stringify(s));
    expect(loaded.items.bell).toBeTruthy();
    expect(loaded.items.cloth).toBeTruthy();
    expect(loaded.items["retired-thing"]).toBeUndefined();
    // Vale keeps what the retired thing held.
    expect(loaded.items.lamp.holder).toBe("vale");
    expect(() => exercise(loaded)).not.toThrow();
  });

  it("offers a fresh start, never a crash, for a save it cannot read", () => {
    const s = JSON.parse(encodeSave(createWorld()));
    s.items = null;
    expect(() => decodeSave(JSON.stringify(s))).toThrow(/fresh start/);
    const broken = JSON.parse(released);
    broken.actors.vale = null;
    expect(() => decodeSave(JSON.stringify(broken))).toThrow(/fresh start/);
  });
});
