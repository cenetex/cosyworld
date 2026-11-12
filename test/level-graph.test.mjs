import { describe, expect, it } from "vitest";
import { CONDITION_KINDS } from "../v2/card-game/pack-schema.mjs";
import {
  LATCH_KINDS,
  LIVE_KINDS,
  buildPackGraph,
} from "../scripts/lib/level-graph.mjs";

const flag = (key, value = true) => ({ kind: "flag", key, value });
const act = (id, at, subject, requires, effects) => ({
  id,
  at,
  subject,
  label: id,
  text: id,
  on: "give",
  requires,
  effects,
});

// A made-up pack: a small town, a gated road, a gated resident and a recipe.
function synthetic() {
  return {
    id: "toy",
    name: "Toy",
    revision: 1,
    entry: "a",
    places: {
      a: { name: "A", exits: ["b", "road"] },
      b: { name: "B", exits: ["a"] },
      road: { name: "Road", road: true, exits: ["a"] },
      c: { name: "C", exits: [], retired: true },
      far: { name: "Far", exits: ["road"], requires: [flag("seen")] },
    },
    avatars: {
      mo: { name: "Mo", place: "b", requires: [flag("seen")] },
      su: { name: "Su", place: "a" },
    },
    items: {
      key: { name: "Key", holder: "a" },
      gem: { name: "Gem", holder: "b", requires: [flag("lit")] },
      pie: { name: "Pie", holder: "a", locked: { by: "su", consumes: ["key"] } },
    },
    routes: [
      {
        from: "a",
        to: "far",
        requires: [
          {
            kind: "any",
            conditions: [
              { kind: "item_near", item: "pie", place: "a" },
              { kind: "item_present", item: "gem", place: "a" },
            ],
          },
          { kind: "daylight", phase: "day" },
          { kind: "not", condition: flag("never") },
        ],
        sealed: { quest: { kind: "place", target: "far" } },
      },
    ],
    choices: [
      act("see", "b", "su", [{ kind: "holding", item: "key", role: "actor" }], [
        { kind: "set_flag", key: "seen", value: true },
      ]),
      act("light", "a", "su", [flag("seen")], [
        { kind: "set_flag", key: "lit", value: true },
        { kind: "set_flag", key: "never", value: true },
        { kind: "set_flag", key: "never", value: false },
      ]),
    ],
    crossings: [],
    transports: {},
  };
}
const hub = { places: ["pond"], packEntries: {} };
const gate = (graph, id) => graph.mission.gates.find((g) => g.id === id);

describe("level graph", () => {
  it("classifies every condition kind in the schema", () => {
    for (const kind of CONDITION_KINDS)
      expect(
        [...LATCH_KINDS, ...LIVE_KINDS, "any", "not"],
        `${kind} needs a place in level-graph.mjs`,
      ).toContain(kind);
  });

  it("builds the space graph with districts split at roads", () => {
    const g = buildPackGraph(synthetic(), hub);
    expect(g.space.nodes.map((n) => n.id)).not.toContain("c");
    expect(g.space.districts.map((d) => d.places)).toEqual([["a", "b", "far"]]);
    const to = (from, id) => g.space.edges.find((e) => e.from === from && e.to === id);
    expect(to("a", "b").gate).toBeNull();
    expect(to("road", "far")).toBeUndefined();
    expect(to("a", "far")).toMatchObject({ kind: "route", gate: "route:a>far" });
    expect(g.space.nodes.find((n) => n.id === "road").kind).toBe("road");
  });

  it("resolves gate conditions and their transitive prerequisites", () => {
    const g = buildPackGraph(synthetic(), hub);
    const r = gate(g, "route:a>far");
    expect(r.ids).toBe(
      "(pie is in a or gem is in a) and it is day and not (never is set)",
    );
    expect(r.follows).toBe("latches");
    // Every alternative counts; the negative flag does not.
    expect(r.prerequisites).toEqual({
      act: ["light", "see"],
      flag: ["lit", "seen"],
      item: ["gem", "key", "pie"],
      place: ["far"],
    });
    expect(r.latch).toEqual([]);
    expect(r.live.length).toBe(4);
    expect(gate(g, "item:pie").recipe).toEqual({ by: "su", consumes: ["key"] });
    expect(gate(g, "place:far").prerequisites.flag).toEqual(["seen"]);
  });

  it("records who sets and clears each flag and what each gates", () => {
    const g = buildPackGraph(synthetic(), hub);
    expect(g.mission.flags.seen).toMatchObject({ kind: "latch", setBy: ["act:see"] });
    expect(g.mission.flags.never).toMatchObject({
      kind: "toggle",
      clearedBy: ["act:light"],
    });
    expect(g.mission.flags.seen.gates).toContain("route:a>far");
    expect(g.mission.flags.seen.acts).toEqual(["act:light"]);
  });

  it("stops on a condition kind it does not know", () => {
    const pack = synthetic();
    pack.places.b.requires = [{ kind: "moonphase" }];
    expect(() => buildPackGraph(pack, hub)).toThrow(/moonphase/u);
  });

  it("is stable", () => {
    const one = buildPackGraph(synthetic(), hub);
    const two = buildPackGraph(synthetic(), hub);
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  });
});
