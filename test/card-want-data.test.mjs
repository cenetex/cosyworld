import { describe, expect, it } from "vitest";
import forest from "../v2/card-game/forest.json" with { type: "json" };
import { createWorld } from "../v2/card-game/world.mjs";
import {
  hub as hubIds,
  packDefinitions,
  packPeople,
} from "../v2/card-game/pack-registry.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import {
  enableMotives,
  tastes,
  tradeDecision,
  valueOf,
} from "../v2/card-game/motives.mjs";

const hub = ["vale", "moth", "keeper"];
const things = ["lamp", "oil", "bell", "cloth"];

// Motive decisions from the hub tastes. The wanted item is worth six more.
function decisions() {
  const s = enableMotives(createWorld());
  for (const id of hub) s.actors[id].place = "station";
  const values = Object.fromEntries(
    hub.map((a) => [a, things.map((i) => valueOf(s, a, i))]),
  );
  s.items.bell.holder = "vale";
  s.items.oil.holder = "keeper";
  s.items.cloth.holder = "moth";
  const trades = [
    ["vale", "bell", "oil"],
    ["vale", "bell", "cloth"],
    ["moth", "cloth", "oil"],
    ["keeper", "oil", "cloth"],
  ].map(([r, g, w]) => tradeDecision(s, r, g, w).accepted);
  return { values, trades };
}

describe("want data", () => {
  it("authors one want for the hub cast and the desiring residents", () => {
    expect(
      Object.fromEntries(hub.map((id) => [id, forest.people[id].want])),
    ).toEqual({
      vale: { kind: "item", target: "lamp" },
      moth: { kind: "item", target: "lamp", lit: true },
      keeper: { kind: "item", target: "bell" },
    });
    expect(
      Object.fromEntries(
        Object.entries(packPeople)
          .filter(([, a]) => a.want)
          .map(([id, a]) => [id, a.want]),
      ),
    ).toEqual({
      "greek-antigone": { kind: "item", target: "greek-funeral-cloth" },
      "greek-ismene": { kind: "place", target: "greek-sanctuary" },
      "greek-creon": { kind: "place", target: "greek-palace" },
      "greek-baker": { kind: "place", target: "greek-courtyard" },
      "willows-swede": { kind: "place", target: "willows-landing" },
      boardyai: { kind: "connect", target: "humans" },
    });
  });

  it("validates a pack resident's want", () => {
    const pack = structuredClone(packDefinitions[0]);
    const ok = [
      { kind: "item", target: hubIds.items[0] },
      { kind: "place", target: pack.avatars.badger.place },
      { kind: "person", target: hubIds.player },
      { kind: "connect", target: "humans" },
    ];
    for (const want of ok) {
      pack.avatars.badger.want = want;
      expect(packProblems(pack, hubIds)).toEqual([]);
    }
    for (const want of [
      { kind: "feeling", target: "lamp" },
      { kind: "item", target: "nowhere" },
      { kind: "person", target: "badger" },
      { kind: "place", target: "lamp" },
      { kind: "item", target: "lamp", since: 3 },
      { kind: "connect", target: "lamp" },
    ]) {
      pack.avatars.badger.want = want;
      expect(packProblems(pack, hubIds).join(" ")).toContain("want needs");
    }
  });

  it("keeps the hub tastes and decisions", () => {
    expect(
      Object.fromEntries(hub.map((id) => [id, tastes[id]])),
    ).toMatchSnapshot();
    expect(Object.keys(tastes).slice(0, 3)).toEqual(hub);
    expect(decisions()).toMatchSnapshot();
  });
});
