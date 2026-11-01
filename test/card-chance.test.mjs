import { describe, expect, it } from "vitest";
import { createWorld } from "../v2/card-game/world.mjs";
import { conditionMet } from "../v2/card-game/pack-rules.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import { packDefinitions, hub } from "../v2/card-game/pack-registry.mjs";

// The otter and the boatman appear at the Willows landing by chance (#1626).
describe("the chance condition", () => {
  const otter = { kind: "chance", key: "otter", odds: 12, lasts: 2 };
  const at = (turn, seed) =>
    Object.assign(createWorld(), { turn, run: { seed } });
  it("holds for whole windows, about one in odds, the same on every table", () => {
    const hits = [];
    for (let turn = 0; turn < 2400; turn++)
      if (conditionMet(at(turn, 7), otter)) hits.push(turn);
    expect(hits.length).toBeGreaterThan(2400 / 12 / 2);
    expect(hits.length).toBeLessThan((2400 / 12) * 2);
    for (const turn of hits) expect(hits).toContain(turn ^ 1);
    expect(hits).toEqual(
      hits.filter((turn) => conditionMet(at(turn, 7), otter)),
    );
    const other = [...Array(2400).keys()].filter((turn) =>
      conditionMet(at(turn, 8), otter),
    );
    expect(other).not.toEqual(hits);
  });
  it("needs a key, odds and a short window", () => {
    const pack = structuredClone(
      packDefinitions.find((p) => p.id === "willows"),
    );
    pack.places["willows-landing"].requires = [{ ...otter, odds: 1 }];
    expect(packProblems(pack, hub).join(" ")).toContain("condition");
  });
});
