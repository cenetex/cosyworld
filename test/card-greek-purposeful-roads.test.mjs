import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { createWorld, decodeSave, exits } from "../v2/card-game/world.mjs";
import {
  entityActive,
  localRoadEnds,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";
import { upgradeGreekOneRoadSave } from "../v2/card-game/legacy-saves.mjs";
import { ajaxCamp } from "./helpers/greek-ajax.mjs";

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
  ["greek-road-royal", "greek-troy", "greek-susa"],
  ["greek-road-black-sea", "greek-thrace", "greek-tauris"],
  ["greek-road-colonists", "greek-corinth", "greek-sicily"],
];
const CUT = [
  ["greek-athens", "greek-delphi"],
  ["greek-delphi", "greek-trachis"],
  ["greek-troy", "greek-susa"],
  ["greek-piraeus", "greek-tauris"],
  ["greek-piraeus", "greek-sicily"],
  ["greek-aulis", "greek-greek-camp"],
  ["greek-susa", "greek-scythian-crag"],
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
    expect(town["greek-scythian-crag"]).toBe(town["greek-tauris"]);
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
    expect(exits(w, "greek-tauris", "vale")).toContain("greek-scythian-crag");
    expect(exits(w, "greek-scythian-crag", "vale")).toEqual(["greek-tauris"]);
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
      ["greek-susa", "greek-road-royal"],
      ["greek-road-royal", "greek-troy"],
      ["greek-trachis", "greek-oeta"],
      ["greek-gate", "greek-aulis"],
    ]);
    for (const road of [
      "greek-road-sacred-way",
      "greek-road-royal",
      "greek-road-black-sea",
      "greek-road-colonists",
    ])
      expect(after.memories[road]).toBeTruthy();
    expect(after.log).toEqual(before.log);
  });

  it("keeps a way home from Sicily and Tauris", () => {
    const before = releasedWorld();
    before.actors.vale.place = "greek-sicily";
    before.actors.mara.place = "greek-tauris";
    before.actors.ash.place = "greek-scythian-crag";
    const after = decodeSave(JSON.stringify(before));
    // Sicily is on the Corinth side: the Colonists' Road leads home.
    expect(after.actors.vale.place).toBe("greek-sicily");
    expect(exits(after, "greek-sicily", "vale")).toEqual([
      "greek-road-colonists",
    ]);
    // Without the Trojan invitation the ship does not call on that side.
    // Travelers there go back the way they came.
    expect(after.actors.mara.place).toBe("greek-piraeus");
    expect(after.actors.ash.place).toBe("greek-aulis");
  });

  it("leaves Black Sea travelers in place once the Trojan landing is open", () => {
    // A world where the Trojan invitation was accepted, set back one revision.
    const after = ajaxCamp();
    after.packs["greek-drama"].revision = 7;
    after.packs["greek-drama"].scope = "full";
    after.actors.mara.place = "greek-tauris";
    upgradeGreekOneRoadSave(after);
    expect(after.packs["greek-drama"].revision).toBe(8);
    expect(after.actors.mara.place).toBe("greek-tauris");
    expect(exits(after, "greek-tauris", "mara")).toContain(
      "greek-road-black-sea",
    );
  });
});
