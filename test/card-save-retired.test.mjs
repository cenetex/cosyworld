import { describe, expect, it } from "vitest";
import "./helpers/still-cast.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
} from "../v2/card-game/world.mjs";
import {
  SAVE_SCHEMA,
  carryLocalProgress,
  retiredSave,
} from "../v2/card-game/legacy-saves.mjs";

// The rules 133 bump retired every earlier save: it is dropped, not lifted,
// and only what a traveler carries survives.
describe("saves from before the rules 133 bump", () => {
  const old = () => {
    const s = JSON.parse(encodeSave(createWorld({ seed: 7 })));
    s.schema = 7;
    s.actors.vale.xp = 9;
    s.actors.vale.level = 3;
    s.actors.vale.upgrades = ["scarf"];
    s.items.lamp.holder = "pond";
    return s;
  };

  it("reads an earlier schema as retired and a current one as live", () => {
    expect(SAVE_SCHEMA).toBe(8);
    expect(retiredSave(JSON.stringify(old()))).toMatchObject({ schema: 7 });
    expect(retiredSave(encodeSave(createWorld({ seed: 7 })))).toBeNull();
    expect(retiredSave("{")).toBeNull();
    expect(retiredSave("null")).toBeNull();
  });

  it("is refused by the loader, never half-loaded", () => {
    expect(() => decodeSave(JSON.stringify(old()))).toThrow(/fresh start/);
  });

  it("starts fresh and keeps only level, experience and upgrades", () => {
    const fresh = carryLocalProgress(createWorld({ seed: 7 }), old());
    const vale = fresh.actors.vale;
    expect([vale.xp, vale.level, vale.upgrades]).toEqual([9, 3, ["scarf"]]);
    // Nothing else of the old world comes along.
    expect(fresh.items.lamp.holder).not.toBe("pond");
    expect(fresh.turn).toBe(0);
    // The result is an ordinary current save.
    expect(decodeSave(encodeSave(fresh)).actors.vale.xp).toBe(9);
  });

  it("ignores progress it cannot trust", () => {
    const bad = old();
    bad.actors.vale.xp = -4;
    bad.actors.vale.upgrades = ["Bad Name", "scarf"];
    const vale = carryLocalProgress(createWorld({ seed: 7 }), bad).actors.vale;
    expect(vale.xp ?? 0).toBe(0);
    expect(vale.upgrades).toEqual(["scarf"]);
  });

  it("tells a corrupt save from a retired one and a current one", () => {
    const current = encodeSave(createWorld({ seed: 7 }));
    const corrupt = [
      "{",
      "null",
      JSON.stringify({ schema: 8, turn: "x" }),
      JSON.stringify({ schema: 99 }),
      JSON.stringify({ schema: 0 }),
      JSON.stringify({ turn: 3 }),
    ];
    for (const text of corrupt) {
      // Corrupt: not retired, and the loader keeps its recovery error.
      expect(retiredSave(text), text).toBeNull();
      expect(() => decodeSave(text), text).toThrow();
    }
    // Retired: read as a fresh start, never a loader error path.
    for (const schema of [6, 7])
      expect(retiredSave(JSON.stringify({ schema, turn: 4 }))).not.toBeNull();
    // Current: neither retired nor refused.
    expect(retiredSave(current)).toBeNull();
    expect(() => decodeSave(current)).not.toThrow();
  });

  it("round-trips a current save unchanged", () => {
    const world = createWorld({ seed: 7 });
    expect(decodeSave(encodeSave(world))).toEqual(world);
  });
});
