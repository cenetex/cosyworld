// The owner's map rule. Inside a town, places link directly. Between towns
// there is one road, and every walkable road has its own painting; or a sea
// lane. The towns below are declared from the map, so a new direct link
// between two towns fails here instead of quietly merging them.
import { describe, expect, it } from "vitest";
import {
  localRoadEnds,
  packDefinitions,
  packPlaces,
  transports,
} from "../v2/card-game/pack-registry.mjs";

const TOWNS = {
  "wine-dark-harbor": [
    "greek-harbor",
    "greek-argolid-road",
    "greek-argos-sanctuary",
    "greek-corinth",
    "greek-troezen",
    // Story doors open from the harbor and the Argolid crossroads.
    "greek-egypt-tomb",
    "greek-troy-beach",
    "greek-argos-tomb",
    "greek-argos-palace",
    "greek-mycenae-palace",
    "greek-argive-farm",
  ],
  thebes: [
    "greek-courtyard",
    "greek-well",
    "greek-gate",
    "greek-sanctuary",
    "greek-palace",
    // Outside the walls but still Theban: the gate opens onto it directly,
    // by a route that needs the guard to hold the decree there. No road.
    "greek-battlefield",
    "greek-aulis",
    "greek-cithaeron",
  ],
  athens: [
    "greek-athens",
    "greek-assembly",
    "greek-acropolis",
    "greek-demos-house",
    "greek-thinkery",
    "greek-festival",
    "greek-attic-farm",
    "greek-colonus",
    "greek-acharnae",
    "greek-marathon",
  ],
  piraeus: ["greek-piraeus", "greek-eleusis"],
  delphi: ["greek-delphi"],
  trachis: ["greek-trachis", "greek-pherae", "greek-thetis"],
  troy: [
    "greek-troy",
    "greek-greek-camp",
    "greek-trojan-camp",
    "greek-thrace",
    "greek-lemnos",
    "greek-ajax-landing",
    "greek-ajax-household",
    "greek-ajax-grave",
  ],
  tauris: ["greek-tauris", "greek-scythian-crag"],
  sicily: ["greek-sicily"],
  susa: ["greek-susa"],
  "hoppy-cat-archive": [
    "hoppycat-signal-jetty",
    "hoppycat-halfway-tea-garden",
    "hoppycat-open-record-cathedral",
    "hoppycat-prism-foundry",
    "hoppycat-meraki-atelier",
    "hoppycat-goldfish-tank",
    "hoppycat-red-thread-belfry",
    "hoppycat-context-greenhouse",
    "hoppycat-settled-light-theatre",
    "hoppycat-concordance-tidelands",
  ],
  willows: ["willows-landing", "willows-camp"],
  "willows-bank": ["willows-bank"],
  "lonely-forest": [
    "forest-cottage",
    "forest-garden",
    "forest-oak",
    "forest-trail",
  ],
};

const town = (id) =>
  Object.entries(TOWNS).find(([, places]) => places.includes(id))?.[0] ?? id;
const docks = new Set(Object.values(transports).map((t) => t.place));
// A road that a direct local link has replaced, or that the pack marks
// retired, keeps its ID for saved history only.
const walkableRoad = (id) =>
  Array.isArray(packPlaces[id]?.road) && !localRoadEnds(id);
// Town places: not a road of any kind and not a ship.
const live = (id) =>
  Boolean(packPlaces[id]) &&
  !docks.has(id) &&
  !packPlaces[id].road &&
  !packPlaces[id].retired;
const roads = Object.keys(packPlaces).filter(walkableRoad);
// Every authored step: place exits and story routes. An old road that a
// direct local link has replaced is that direct link.
const folded = (from, to) =>
  packPlaces[to]?.road && localRoadEnds(to) && !packPlaces[to].retired
    ? packPlaces[to].road.find((end) => end !== from)
    : to;
const steps = [
  ...Object.entries(packPlaces).flatMap(([id, place]) =>
    (place.exits || []).map((to) => [id, folded(id, to)]),
  ),
  ...packDefinitions.flatMap((pack) =>
    (pack.routes || []).map(({ from, to }) => [from, to]),
  ),
];

describe("the map rule", () => {
  it("declares every town place once, and each one exists", () => {
    const listed = Object.values(TOWNS).flat();
    expect(new Set(listed).size).toBe(listed.length);
    for (const id of listed) expect(live(id), id).toBeTruthy();
  });

  it("links places directly only inside a town", () => {
    for (const [from, to] of steps)
      if (live(from) && live(to))
        expect(town(to), `${from} -> ${to} crosses towns`).toBe(town(from));
  });

  it("joins two towns with at most one walkable road, end to end", () => {
    const pairs = new Map();
    for (const id of roads) {
      const [a, b] = packPlaces[id].road;
      expect(packPlaces[id].exits, id).toEqual([a, b]);
      expect(town(a), `${id} stays inside ${town(a)}`).not.toBe(town(b));
      for (const end of [a, b])
        expect(packPlaces[end].exits, `${end} leads onto ${id}`).toContain(id);
      const key = [town(a), town(b)].sort().join("|");
      expect(pairs.get(key), `${key} has two roads`).toBeUndefined();
      pairs.set(key, id);
    }
  });

  it("gives every live exit a way back", () => {
    // Exits are one-way in the data. A retired road keeps its exits for saved
    // history only. One-way paths such as the ship's return to Black pond
    // and the Tea Garden thread are crossings, not exits.
    const back = new Set(steps.map(([from, to]) => `${from}>${to}`));
    for (const [id, place] of Object.entries(packPlaces))
      for (const to of localRoadEnds(id) || place.retired
        ? []
        : place.exits || [])
        if (!localRoadEnds(to))
          expect(back.has(`${to}>${id}`), `${id} -> ${to}`).toBe(true);
  });

  it("gives every walkable road its own painting", () => {
    const paintings = roads.map((id) => packPlaces[id].backdrop);
    expect(paintings.every(Boolean)).toBe(true);
    expect(new Set(paintings).size, paintings.join(", ")).toBe(roads.length);
  });

  it("makes every step between towns a road or a sea lane", () => {
    // A step that leaves a town goes onto a walkable road or a ship.
    for (const [from, to] of steps)
      if (live(from) && !live(to) && packPlaces[to])
        expect(
          walkableRoad(to) || docks.has(to),
          `${from} -> ${to} is neither a road nor a ship`,
        ).toBe(true);
    for (const ship of Object.values(transports)) {
      const lanes = ship.lanes || [];
      expect(lanes.length).toBeLessThanOrEqual(7);
      for (const dock of ship.docks)
        expect(
          lanes.filter((l) => l.from === dock || l.to === dock).length,
          dock,
        ).toBeLessThanOrEqual(4);
      for (const { from, to } of lanes)
        expect(town(from), `${from} ~ ${to}`).not.toBe(town(to));
    }
  });

  it("keeps one Athens–Piraeus road and one harbor–Thebes road", () => {
    const joining = (a, b) =>
      roads.filter((id) =>
        [a, b].every((end) => packPlaces[id].road.includes(end)),
      );
    expect(joining("greek-athens", "greek-piraeus")).toEqual([
      "greek-road-athens-piraeus",
    ]);
    expect(joining("greek-harbor", "greek-courtyard")).toEqual([
      "greek-road-thebes",
    ]);
    expect(packPlaces["greek-harbor"].exits).not.toContain("greek-courtyard");
    expect(packPlaces["greek-courtyard"].exits).not.toContain("greek-harbor");
  });
});
