import { describe, expect, it } from "vitest";
import { createWorld, exits } from "../v2/card-game/world.mjs";
import {
  entityActive,
  localRoadEnds,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";
import { lanePath } from "../v2/card-game/pack-transport.mjs";

const pack = packDefinition("greek-drama");
const places = pack.places;
const isRoad = (id) => Array.isArray(places[id]?.road);
const shipPlaces = new Set(
  Object.values(pack.transports).map(({ place }) => place),
);
const isTownPlace = (id) => places[id] && !isRoad(id) && !shipPlaces.has(id);
const PAGASAE = "greek-pagasae";
const SCYLLA = "greek-scylla";

// A town is a group of places joined by direct links, either way. Roads and
// ships sit outside the towns.
function towns() {
  const town = {};
  for (const start of Object.keys(places)) {
    if (!isTownPlace(start) || town[start]) continue;
    const queue = [start];
    town[start] = start;
    while (queue.length) {
      const here = queue.shift();
      const back = Object.keys(places).filter((id) =>
        places[id].exits?.includes(here),
      );
      for (const next of [...(places[here].exits || []), ...back])
        if (isTownPlace(next) && !town[next]) {
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
  ["greek-road-scythia", "greek-tauris", "greek-scythian-crag"],
];
const RETIRED = ["greek-road-black-sea", "greek-road-colonists"];
const FAR_SHORES = [
  "greek-lemnos",
  "greek-thrace",
  "greek-tauris",
  "greek-sicily",
];
const CUT = [
  ["greek-athens", "greek-delphi"],
  ["greek-delphi", "greek-trachis"],
  ["greek-troy", "greek-susa"],
  ["greek-tauris", "greek-scythian-crag"],
  ["greek-piraeus", "greek-lemnos"],
  ["greek-piraeus", "greek-thrace"],
  ["greek-piraeus", "greek-tauris"],
  ["greek-piraeus", "greek-sicily"],
  ["greek-aulis", "greek-greek-camp"],
];

describe("purposeful Greek roads", () => {
  it("joins distant towns by one road, never a direct link", () => {
    // A retired place's one exit names the place that took it in.
    for (const [a, b] of CUT) {
      if (!places[a].retired)
        expect(places[a].exits, `${a} -> ${b}`).not.toContain(b);
      if (!places[b].retired)
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
    expect(town["greek-pherae"]).toBe(town["greek-trachis"]);
    expect(town["greek-thetis"]).toBe(town["greek-trachis"]);
    expect(town[PAGASAE]).toBe(town["greek-pherae"]);
    expect(town["greek-aulis"]).toBe(town["greek-gate"]);
    expect(town["greek-greek-camp"]).toBe(town["greek-troy"]);
  });

  it("makes every inter-town step in Greece a road or a sea lane", () => {
    const town = towns();
    for (const [id, place] of Object.entries(places)) {
      if (!isTownPlace(id) || place.retired) continue;
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

  it("offers each new road in both directions in a new world", () => {
    const w = createWorld();
    for (const [road, a, b] of ROADS) {
      expect(exits(w, a, "vale")).toContain(road);
      expect(exits(w, b, "vale")).toContain(road);
      expect(exits(w, road, "vale")).toEqual(expect.arrayContaining([a, b]));
    }
  });

  it("connects each Far Shore to Pagasae in both directions aboard the Scylla", () => {
    const w = createWorld();
    const ship = pack.transports[SCYLLA];
    expect(ship.at).toBe(PAGASAE);
    expect(exits(w, "greek-pherae", "vale")).toContain(PAGASAE);
    expect(exits(w, PAGASAE, "vale")).toContain("greek-pherae");
    expect(w.items["greek-provisions"].holder).not.toBe(SCYLLA);
    for (const id of [PAGASAE, ...FAR_SHORES]) {
      expect(entityActive(w, id), id).toBe(true);
      expect(ship.docks, id).toContain(id);
      expect(
        pack.crossings.some(
          (crossing) =>
            crossing.from === id &&
            crossing.transport === SCYLLA &&
            !crossing.retired,
        ),
        `${id} has a boarding crossing`,
      ).toBe(true);
    }
    for (const id of FAR_SHORES) {
      expect(lanePath(w, SCYLLA, PAGASAE, id), id).not.toBeNull();
      expect(lanePath(w, SCYLLA, id, PAGASAE), id).not.toBeNull();
    }
  });
});
