import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { createWorld, decodeSave, exits } from "../v2/card-game/world.mjs";
import {
  entityActive,
  localRoadEnds,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";

const pack = packDefinition("greek-drama");
const places = pack.places;
const isRoad = (id) => Array.isArray(places[id]?.road);

// A town is a group of places joined by direct links, either way. Roads and
// the ship are not part of any town.
function towns() {
  const town = {};
  for (const start of Object.keys(places)) {
    if (isRoad(start) || start === "greek-ship" || town[start]) continue;
    const queue = [start];
    town[start] = start;
    while (queue.length) {
      const here = queue.shift();
      const back = Object.keys(places).filter((id) =>
        places[id].exits?.includes(here),
      );
      for (const next of [...(places[here].exits || []), ...back])
        if (!isRoad(next) && places[next] && !town[next]) {
          town[next] = start;
          queue.push(next);
        }
    }
  }
  return town;
}

const ROADS = [
  ["greek-road-sacred-way", "greek-athens", "greek-delphi"],
  ["greek-oeta", "greek-delphi", "greek-trachis"],
];
// Greek revision 16 makes the Far Shores one-place ship stops: their roads,
// Susa and the Scythian Crag retire.
const RETIRED = [
  "greek-road-royal",
  "greek-road-black-sea",
  "greek-road-colonists",
  "greek-susa",
  "greek-scythian-crag",
];
const FAR_SHORES = [
  "greek-lemnos",
  "greek-thrace",
  "greek-tauris",
  "greek-sicily",
];
const CUT = [
  ["greek-athens", "greek-delphi"],
  ["greek-delphi", "greek-trachis"],
  ["greek-piraeus", "greek-tauris"],
  ["greek-piraeus", "greek-sicily"],
  ["greek-aulis", "greek-greek-camp"],
];

describe("purposeful Greek roads", () => {
  it("joins distant towns by one road, never a direct link", () => {
    for (const [a, b] of CUT) {
      expect(places[a].exits, `${a} -> ${b}`).not.toContain(b);
      expect(places[b].exits, `${b} -> ${a}`).not.toContain(a);
    }
    const town = towns();
    for (const [road, a, b] of ROADS) {
      expect(places[road].road).toEqual([a, b]);
      expect(places[road].exits).toEqual([a, b]);
      expect(places[a].exits).toContain(road);
      expect(places[b].exits).toContain(road);
      expect(town[a], `${a} and ${b} are separate towns`).not.toBe(town[b]);
      const between = Object.keys(places).filter(
        (id) =>
          isRoad(id) &&
          places[id].road.every(
            (end) => town[end] === town[a] || town[end] === town[b],
          ) &&
          new Set(places[id].road.map((end) => town[end])).size === 2,
      );
      expect(between, `${a} and ${b} share one road`).toEqual([road]);
    }
    for (const id of RETIRED) expect(places[id].retired, id).toBe(true);
    for (const id of FAR_SHORES) expect(places[id].exits, id).toEqual([]);
    expect(town["greek-pherae"]).toBe(town["greek-trachis"]);
    expect(town["greek-thetis"]).toBe(town["greek-trachis"]);
    expect(town["greek-aulis"]).toBe(town["greek-gate"]);
    expect(town["greek-greek-camp"]).toBe(town["greek-troy"]);
  });

  it("makes every inter-town step in Greece a road or a sea lane", () => {
    const town = towns();
    for (const [id, place] of Object.entries(places)) {
      if (isRoad(id) || id === "greek-ship" || place.retired) continue;
      for (const next of place.exits || [])
        if (!isRoad(next))
          expect(town[next], `${id} -> ${next}`).toBe(town[id]);
    }
    // A road whose ends also link directly is folded into its town and is
    // never walked.
    for (const [id, place] of Object.entries(places))
      if (isRoad(id) && !localRoadEnds(id))
        expect(
          new Set(place.road.map((end) => town[end])).size,
          `${id} joins two towns`,
        ).toBe(2);
  });

  it("gives no two walkable roads the same backdrop", () => {
    const w = createWorld({ packScopes: { "greek-drama": "full" } });
    const seen = new Map();
    for (const [id, place] of Object.entries(places)) {
      if (!isRoad(id) || place.retired || !entityActive(w, id)) continue;
      const other = seen.get(place.backdrop);
      expect(other, `${id} shares ${place.backdrop} with ${other}`).toBe(
        undefined,
      );
      seen.set(place.backdrop, id);
    }
    for (const [road] of ROADS)
      expect(seen.get(places[road].backdrop)).toBe(road);
  });

  it("walks each new road in both directions in an open world", () => {
    const w = createWorld({ packScopes: { "greek-drama": "full" } });
    for (const [road, a, b] of ROADS) {
      expect(exits(w, a, "vale")).toContain(road);
      expect(exits(w, b, "vale")).toContain(road);
      expect(exits(w, road, "vale")).toEqual(expect.arrayContaining([a, b]));
    }
    for (const id of FAR_SHORES) expect(exits(w, id, "vale"), id).toEqual([]);
  });
});

const context = vm.createContext({});
vm.runInContext(
  readFileSync(
    new URL(
      "../v2/orchestrator-rust/src/card_shared/engine-v25.js",
      import.meta.url,
    ),
    "utf8",
  ),
  context,
);
function releasedWorld() {
  const world = JSON.parse(
    context.cardShared(JSON.stringify({ op: "create" })),
  ).world;
  delete world.opening;
  world.packs["greek-drama"].scope = "full";
  expect(world.packs["greek-drama"].revision).toBe(7);
  return world;
}

describe("purposeful road save upgrade", () => {
  it("turns known direct links into road paths and drops the cut ones", () => {
    const before = releasedWorld();
    before.actors.vale.place = "greek-sicily";
    before.routeKnowledge.vale = [
      ["greek-athens", "greek-delphi"],
      ["greek-delphi", "greek-trachis"],
      ["greek-susa", "greek-troy"],
      ["greek-piraeus", "greek-tauris"],
      ["greek-sicily", "greek-piraeus"],
      ["greek-aulis", "greek-greek-camp"],
      ["greek-susa", "greek-scythian-crag"],
      ["greek-trachis", "greek-oeta"],
      ["greek-gate", "greek-aulis"],
    ];
    const after = decodeSave(JSON.stringify(before));
    expect(after.packs["greek-drama"].revision).toBe(
      packDefinition("greek-drama").revision,
    );
    expect(after.routeKnowledge.vale).toEqual([
      ["greek-athens", "greek-road-sacred-way"],
      ["greek-road-sacred-way", "greek-delphi"],
      ["greek-delphi", "greek-oeta"],
      ["greek-oeta", "greek-trachis"],
      ["greek-trachis", "greek-oeta"],
      ["greek-gate", "greek-aulis"],
    ]);
    expect(after.memories["greek-road-sacred-way"]).toBeTruthy();
    expect(after.log).toEqual(before.log);
  });

  it("keeps a way home from Sicily and Tauris by the east sea", () => {
    const before = releasedWorld();
    before.actors.vale.place = "greek-sicily";
    before.actors.mara.place = "greek-tauris";
    before.actors.ash.place = "greek-scythian-crag";
    const after = decodeSave(JSON.stringify(before));
    // The Far Shores are ship stops; the ship always sails home to Marathon.
    expect(after.actors.vale.place).toBe("greek-sicily");
    expect(exits(after, "greek-sicily", "vale")).toEqual([]);
    const home = (from, to) =>
      pack.transports["greek-ship"].lanes.some(
        (l) =>
          !l.opensWith &&
          ((l.from === from && l.to === to) ||
            (!l.oneWay && l.from === to && l.to === from)),
      );
    expect(home("greek-sicily", "greek-marathon")).toBe(true);
    expect(home("greek-tauris", "greek-thrace")).toBe(true);
    expect(home("greek-thrace", "greek-lemnos")).toBe(true);
    expect(home("greek-lemnos", "greek-marathon")).toBe(true);
    expect(home("greek-ajax-landing", "greek-marathon")).toBe(true);
    // The crag folds into the temple it stood above.
    expect(after.actors.ash.place).not.toBe("greek-scythian-crag");
  });
});
