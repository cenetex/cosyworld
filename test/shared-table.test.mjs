import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { newTable, applyTable, canVisit } from "../v2/card-game/world.mjs";

describe("shared card table authority", () => {
  it("matches the frozen C transcript for custody, full rooms, and seeded interleavings", () => {
    const actions = [];
    const add = (kind, actor, item = -1, target = -1) =>
      actions.push({ kind, actor, item, target });
    for (let a = 0; a < 8; a++) {
      add(1, a);
      add(3, a);
    }
    for (let a = 0; a < 8; a++) add(5, a, -1, 0);
    add(7, 0, 0);
    add(6, 1, 0);
    add(5, 1, -1, 1);
    add(5, 0, -1, 1);
    add(5, 4, -1, 0);
    add(8, 2, 2, 3);
    add(9, 3, 2);
    add(2, 3);
    add(1, 3);
    add(3, 3);
    let seed = 94832;
    const random = (n) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    for (let n = 0; n < 3000; n++)
      add(random(13), random(10) - 1, random(10) - 1, random(11) - 1);
    const transcript = createHash("sha256");
    const w = newTable();
    for (let n = 0; n < actions.length; n++) {
      const before = structuredClone(w);
      const code = applyTable(w, actions[n]);
      if (code) expect(w).toEqual(before);
      const expected = [
        code,
        w.version,
        ...w.claimed,
        ...w.present,
        ...w.places,
        ...w.holders,
        ...w.uses,
        ...w.homes,
        ...w.gates,
        w.turn,
      ];
      for (let a = 0; a < 8; a++)
        for (let p = 0; p < 9; p++) expected.push(Number(canVisit(w, a, p)));
      transcript.update(`${expected.join(" ")}\n`);
    }
    // The retired C driver emitted one line per action, with all visit checks.
    expect(transcript.digest("hex")).toBe(
      "e7f7452b8d5b4c1ca57d5f6efecefb8e3a8af11e886f8f7b09d4bcaea32fa86f",
    );
  });
});
