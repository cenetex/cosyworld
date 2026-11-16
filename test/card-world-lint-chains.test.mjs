import { describe, it, expect } from "vitest";
import { liveWorld, lintWorld, report } from "../v2/scripts/card-world-lint.mjs";
import { generateChains } from "../v2/scripts/card-quest-chains.mjs";

const place = (name, exits) => ({ name, exits });
function world() {
  const packsJson = {
    hub: { player: "vale", start: "pond", places: ["pond"], avatars: ["vale"], items: [], packEntries: { t: [{ joins: "hub", at: "pond", arrive: "a" }] } },
    packs: [
      {
        id: "t",
        entry: "a",
        release: { places: ["a", "b", "c"], avatars: ["r1", "r2", "r3", "r4"], items: ["cup", "key", "jar", "spoon", "bowl"], choices: [] },
        places: { a: place("Hall", ["b"]), b: place("Yard", ["a", "c"]), c: place("Shed", ["b"]), x: place("Vault", ["a"]) },
        avatars: {
          r1: { name: "Rhea", place: "a", want: { kind: "place", target: "a" } },
          r2: { name: "Bo", place: "b" },
          r3: { name: "Cy", place: "c" },
          r4: { name: "Di", place: "a" },
        },
        items: {
          cup: { name: "Cup", holder: "c" },
          jar: { name: "Jar", holder: "c" },
          spoon: { name: "Spoon", holder: "c" },
          key: { name: "Key", holder: "r2" },
          bowl: { name: "Bowl", holder: "b" },
          lost: { name: "Lost", holder: "x" },
        },
        choices: [
          { id: "leave", on: "depart", subject: "r3", effects: [] },
          { id: "break", subject: "r2", effects: [{ kind: "retire_item", item: "jar" }] },
        ],
        crossings: [{ id: "in", from: "pond", to: "a", requires: [] }, { id: "out", from: "a", to: "pond", requires: [] }],
      },
      {
        id: "u",
        entry: "m",
        places: { m: place("Mill", []) },
        avatars: { u1: { name: "Uma", place: "m" } },
        items: { flour: { name: "Flour", holder: "m" } },
        crossings: [{ id: "um", from: "pond", to: "m", requires: [] }, { id: "mu", from: "m", to: "pond", requires: [] }],
      },
    ],
  };
  const forest = { places: { pond: place("Pond", []) }, people: { vale: { name: "Vale" } }, opening: { actors: { vale: { place: "pond" } } } };
  return liveWorld(packsJson, forest);
}
const rule = (out, name, text = "") => out.findings.find((f) => f.rule === name && f.text.includes(text));

describe("card world lint", () => {
  it("leaves out unreleased content and says so", () => {
    const w = world();
    expect(w.places.x).toBeUndefined();
    expect(w.items.lost).toBeUndefined();
    expect(report(w, lintWorld(w))).toMatch(/never fails[\s\S]*Unreleased content is left out[^\n]*1 places/);
  });
  it("flags density, dead items, own wants and leaves", () => {
    const out = lintWorld(world());
    expect(rule(out, "L11 Density", "visible item cap").list).toEqual(["c:3"]);
    expect(rule(out, "Dead items").list).toEqual(expect.arrayContaining(["cup", "bowl"]));
    expect(rule(out, "Own wants").list).toEqual(["r1>a"]);
    expect(rule(out, "L1 Loop").list).toEqual(expect.arrayContaining(["c"]));
    expect(rule(out, "Three paths").list).toEqual(["r1>a:1"]);
    expect(rule(out, "L2 Entries").list).toEqual(expect.arrayContaining(["t"]));
  });
});

describe("card quest chains", () => {
  const draft = (seed, extra = {}) => generateChains(world(), { seed, packs: ["t", "u"], depth: 3, count: 4, ...extra });
  const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
  it("gives the same draft for the same seed", () => {
    expect(draft(7)).toEqual(draft(7));
    expect(new Set(seeds.map((s) => JSON.stringify(draft(s)))).size).toBeGreaterThan(1);
  });
  it("keeps the guard rails", () => {
    for (const s of seeds) {
      const d = draft(s);
      expect(JSON.stringify(d.chains)).not.toMatch(/"(r3|jar|vale)"/);
      for (const c of d.chains) expect(c.packs.length).toBe(1);
      const at = d.chains.flatMap((c) => c.locks.map((l) => l.at).filter(Boolean));
      expect(new Set(at).size).toBe(at.length);
    }
  });
  it("reads pack tags when given", () => {
    const d = draft(3, { packs: ["t"], tags: { t: { residents: ["r4"], things: ["cup"], places: ["b"] } } });
    expect(d.chains.map((c) => c.id)).toEqual(["quest:r4"]);
    expect(JSON.stringify(d.chains)).not.toMatch(/"(r2|bowl|spoon)"/);
  });
});
