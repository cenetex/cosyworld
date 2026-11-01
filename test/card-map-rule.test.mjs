// The owner's map rule. Inside a town, places link directly. Between towns
// there is one road, and every walkable road has its own painting; or a sea
// lane. The towns below are declared from the map, so a new direct link
// between two towns fails here instead of quietly merging them.
import { describe, expect, it } from "vitest";
import forest from "../v2/card-game/forest.json" with { type: "json" };
import {
  crossings,
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
  ],
  // Athens has three districts. The Sacred Way joins the countryside to the
  // city, and the Long Walls join the city to its harbour.
  "athens-countryside": [
    "greek-eleusis",
    "greek-colonus",
    "greek-marathon",
    "greek-attic-farm",
    "greek-acharnae",
  ],
  "athens-city": [
    "greek-athens",
    "greek-assembly",
    "greek-acropolis",
    "greek-thinkery",
    "greek-demos-house",
    "greek-festival",
  ],
  "athens-harbour": ["greek-piraeus"],
  delphi: ["greek-delphi"],
  trachis: ["greek-trachis", "greek-pherae", "greek-thetis"],
  troy: [
    "greek-troy",
    "greek-greek-camp",
    "greek-trojan-camp",
    "greek-ajax-landing",
    "greek-ajax-household",
    "greek-ajax-grave",
  ],
  // The Far Shores are one-place ship stops on the east sea.
  lemnos: ["greek-lemnos"],
  thrace: ["greek-thrace"],
  tauris: ["greek-tauris"],
  sicily: ["greek-sicily"],
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

// A place within another links only to its parent and does not count toward
// its district's four places. The well and other places name it in `within`.
const INTERIORS = {
  "greek-acharnae": "greek-attic-farm",
  "greek-demos-house": "greek-assembly",
  "greek-festival": "greek-acropolis",
  ...Object.fromEntries(
    Object.entries(packPlaces)
      .filter(([, place]) => place.within)
      .map(([id, place]) => [id, place.within]),
  ),
};

// Every place has at most three links (owner decision, 2026-11-01): exits,
// roads, routes and crossings, counted even while closed, and reflections.
// Boarding a ship is one link however many lanes it sails, and the ship has
// no cap. A place within another does not count against its parent.
const LINK_CAP = 3;
// Still over the cap while their maps are redrawn. Remove each place as its
// pack lands: Hoppy Cat (#1785), Athens, Argos and the hub; Troy, the Greek
// Camp and the harbor's story doors belong to the Troy and Far Shores work.
const OVER_CAP_FOR_NOW = new Set([
  "pond",
  "hoppycat-halfway-tea-garden",
  "hoppycat-signal-jetty",
  "hoppycat-open-record-cathedral",
  "hoppycat-red-thread-belfry",
  "hoppycat-context-greenhouse",
  "hoppycat-concordance-tidelands",
  "hoppycat-settled-light-theatre",
  "greek-athens",
  "greek-argolid-road",
  "greek-harbor",
  "greek-eleusis",
  "greek-attic-farm",
  "greek-troy",
  "greek-greek-camp",
  "greek-marathon",
]);
const ships = new Set(Object.values(transports).map((t) => t.place));
function links() {
  const places = { ...forest.places, ...packPlaces };
  const out = new Map();
  const add = (from, to) => {
    if (ships.has(from) || INTERIORS[to] === from) return;
    out.set(from, (out.get(from) || new Set()).add(to));
  };
  for (const [id, place] of Object.entries(places))
    if (!place.retired && !(place.road && localRoadEnds(id)))
      for (const to of place.exits || []) if (!places[to]?.retired) add(id, to);
  for (const r of forest.reflectionRoutes || []) add(r.from, r.to);
  for (const pack of packDefinitions)
    for (const r of pack.routes || []) add(r.from, r.to);
  for (const c of crossings)
    if (!c.retired)
      add(c.from, c.transport ? transports[c.transport].place : c.to);
  return out;
}
const DISTRICTS = ["athens-countryside", "athens-city", "athens-harbour"];

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
      // A gated end leads onto its road by a route instead of an exit.
      for (const end of [a, b])
        expect(
          steps.some(([from, to]) => from === end && to === id),
          `${end} leads onto ${id}`,
        ).toBe(true);
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

  it("keeps each Athens district to four places, not counting interiors", () => {
    for (const district of DISTRICTS)
      expect(
        TOWNS[district].filter((id) => !INTERIORS[id]).length,
        district,
      ).toBeLessThanOrEqual(4);
    for (const [id, parent] of Object.entries(INTERIORS)) {
      expect(packPlaces[id].exits, id).toEqual([parent]);
      expect(packPlaces[parent].exits, parent).toContain(id);
      expect(town(id), id).toBe(town(parent));
    }
  });

  it("gives every place at most three links, and an interior only its parent", () => {
    for (const [id, to] of links())
      if (!OVER_CAP_FOR_NOW.has(id))
        expect(to.size, `${id}: ${[...to].join(", ")}`).toBeLessThanOrEqual(
          LINK_CAP,
        );
    for (const [id, parent] of Object.entries(INTERIORS))
      expect([...(links().get(id) || [])], id).toEqual([parent]);
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
      // Two seas: the west sea and, around the cape, the east sea.
      expect(lanes.length).toBeLessThanOrEqual(15);
      // Boarding is one link for a dock; the ship reaches at most four ports
      // from any one of them.
      for (const dock of ship.docks)
        expect(
          new Set(
            lanes.flatMap((l) =>
              l.from === dock ? [l.to] : l.to === dock ? [l.from] : [],
            ),
          ).size,
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
