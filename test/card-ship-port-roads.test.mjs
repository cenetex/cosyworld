// A ship is the quick way to a port, never a trap (#2049). The Charybdis
// sails the Black Pond route: Black Pond to the Wine-Dark Harbor and back
// with no cargo, on to Piraeus and the Hoppy Cat jetty only with cargo
// aboard. The Scylla sails the Far Shores from Pagasae without cargo.
// Marathon is a walk from Athens. Myrto's invitation opens the Scylla's
// landing at Troy. The land route from Piraeus through Athens,
// Eleusis, Cithaeron and the battlefield enters Thebes through the City Gate.
import { describe, expect, it } from "vitest";
import {
  createWorld,
  exits,
  legalActions,
  placeText,
  play,
} from "../v2/card-game/world.mjs";
import {
  entityActive,
  packDefinition,
  packDefinitions,
  packPeople,
  packThings,
  transports,
} from "../v2/card-game/pack-registry.mjs";
import {
  callTransport,
  knowsLane,
  laneConditions,
  lanePath,
  lanesFrom,
} from "../v2/card-game/pack-transport.mjs";
import { conditionMet } from "../v2/card-game/pack-rules.mjs";
import { ajaxTalk } from "./helpers/greek-ajax.mjs";
import { stowProvisions } from "./helpers/provisions.mjs";
import {
  greekStart,
  landRoad,
  openDoorStart,
  traveler,
} from "./helpers/open-door.mjs";
import { settleGate } from "./helpers/world-life.mjs";
import { settleGuards } from "../v2/card-game/resident-guard.mjs";

const pack = packDefinition("greek-drama");
const ships = new Set(Object.values(transports).map((t) => t.place));
const flags = (world, ...keys) => {
  for (const key of keys) world.packs["greek-drama"].flags[key] = true;
  return world;
};
const discovered = (world) => {
  world.crossings["pond-greek-harbor"].discovered = true;
  return world;
};
// Fresh, City Gate keys in always-open Attica, Ajax opening, and old full-scope worlds.
const stages = {
  opening: () => discovered(createWorld()),
  "open door": () => discovered(createWorld()),
  ajax: () => discovered(flags(createWorld(), "greek-ajax-open")),
  full: () =>
    discovered(
      createWorld({
        packScopes: Object.fromEntries(
          packDefinitions.filter((p) => p.release).map((p) => [p.id, "full"]),
        ),
      }),
    ),
};
const MARATHON = "greek-marathon";
const PAGASAE = "greek-pagasae";
const SCYLLA = "greek-scylla";
const CIVIC_AVENUE = "greek-civic-avenue";
const CITY_ROAD_FORK = "greek-city-road-fork";
const AJAX_LANDING = "greek-ajax-landing";
const EGYPT_TOMB = "greek-egypt-tomb";
const HOMECOMING_BEACH = "greek-troy-beach";
const AJAX_PLACES = pack.sections.find((s) => s.id === "greek-ajax").places;
const FAR_SHORES = [
  "greek-aulis",
  "greek-lemnos",
  "greek-thrace",
  "greek-tauris",
  "greek-sicily",
];
const FAR_SHORE_LANES = [
  [PAGASAE, "greek-lemnos"],
  ["greek-lemnos", "greek-thrace"],
  ["greek-thrace", "greek-tauris"],
  ["greek-lemnos", AJAX_LANDING],
  [PAGASAE, "greek-sicily"],
  [PAGASAE, EGYPT_TOMB],
  [PAGASAE, "greek-aulis"],
  ["greek-lemnos", HOMECOMING_BEACH],
];

const keysIn = (conditions = []) =>
  conditions.flatMap((c) => [
    ...(c.item ? [c.item] : []),
    ...keysIn(c.conditions),
    ...(c.condition ? keysIn([c.condition]) : []),
  ]);
const KEYS = [
  ...new Set([
    ...packDefinitions.flatMap((p) =>
      (p.routes || []).flatMap((r) => keysIn(r.requires)),
    ),
    ...Object.values(transports).flatMap((t) =>
      (t.lanes || []).flatMap((lane) => keysIn(lane.opensWith)),
    ),
  ]),
];

const placeOf = (s, item) => {
  let holder = s.items[item]?.holder;
  for (let i = 0; s.items[holder] && i < 8; i++)
    holder = s.items[holder].holder;
  return s.actors[holder]?.place ?? holder;
};

// Recall the empty ship after its passengers and cargo unload elsewhere.
function callable(world, dock) {
  return Object.entries(transports)
    .filter(([, t]) => t.docks.includes(dock))
    .some(([id, t]) =>
      t.docks
        .filter((from) => entityActive(world, from))
        .every((from) => {
          const s = structuredClone(world);
          for (const a of Object.values(s.actors))
            if (a.place === t.place) a.place = from;
          for (const item of Object.values(s.items))
            if (item.holder === t.place) item.holder = from;
          Object.assign(s.transports[id], {
            phase: "docked",
            dock: from,
            destination: null,
            riders: [],
            recall: null,
          });
          for (
            let i = 0;
            i < t.docks.length && s.transports[id].dock !== dock;
            i++
          ) {
            s.turn += 1;
            callTransport(s, dock);
          }
          return s.transports[id].dock === dock;
        }),
    );
}

// Find foot routes and free sea lanes with `free`. With `ship`, count lanes
// whose cargo conditions can be met and whose dock can call the empty ship.
// Every key not `pinned` that lies in a place already reached can be carried
// to any reached place, set down there, laid on deck, or handed to a
// resident there; each hand-over opens a gate only while it holds, as play does.
// Keys come by trade and by making too (rules 102): a resident in a reached
// place who wants a thing the traveler can bring hands over what it holds,
// and a maker at home with each of its makings to hand makes its locked
// thing. So the search is generous to the traveler: a gated place it never
// reaches cannot be reached by any order of walking, carrying, trading,
// making and giving.
function reach(
  world,
  from,
  { pinned = [], ship = false, free = false, local = true } = {},
) {
  const s = structuredClone(world);
  const seen = new Set([from]);
  const keep = (to) =>
    !ships.has(to) && (!local || to.startsWith("greek-")) && !seen.has(to);
  const wanted = (id) =>
    s.actors[id]?.want?.kind === "item" ? s.actors[id].want.target : null;
  // The keys, the things residents want and hold for trade, and the locked
  // things with their makings.
  const goods = [
    ...new Set([
      ...KEYS,
      ...Object.keys(packPeople).flatMap((id) =>
        wanted(id)
          ? [
              wanted(id),
              ...Object.keys(s.items).filter((i) => s.items[i].holder === id),
            ]
          : [],
      ),
      ...Object.keys(packThings).flatMap((id) =>
        packThings[id].locked ? [id, ...packThings[id].locked.consumes] : [],
      ),
    ]),
  ];
  const carriable = () =>
    goods.filter(
      (id) =>
        s.items[id] &&
        !pinned.includes(id) &&
        entityActive(s, id) &&
        (s.items[id].holder === "vale" || seen.has(placeOf(s, id))) &&
        !packPeople[s.items[id].holder],
    );
  const calls = new Map();
  const lanes = (dock) => {
    if (!(ship || free)) return [];
    if (!calls.has(dock)) calls.set(dock, callable(s, dock));
    return calls.get(dock)
      ? Object.values(transports).flatMap((t) =>
          t.docks.includes(dock) ? lanesFrom(t, dock) : [],
        )
      : [];
  };
  for (let grew = true; grew; ) {
    grew = false;
    for (const place of [...seen]) {
      const residents = Object.keys(packPeople).filter(
        (id) => entityActive(s, id) && s.actors[id]?.place === place,
      );
      // A trade: what a resident holds, for the thing it wants.
      for (const id of residents)
        if (carriable().includes(wanted(id)))
          for (const item of goods)
            if (s.items[item]?.holder === id && !pinned.includes(item)) {
              s.items[item].holder = place;
              grew = true;
            }
      // A making: the maker at home, each thing it consumes in its hands or
      // to hand, makes the locked thing where it waits.
      for (const id of goods) {
        const lock = packThings[id]?.locked,
          home = packThings[id]?.home;
        if (
          lock &&
          home === place &&
          s.usedUp?.includes(id) &&
          !pinned.includes(id) &&
          s.actors[lock.by]?.place === home &&
          lock.consumes.every(
            (c) => s.items[c]?.holder === lock.by || carriable().includes(c),
          )
        ) {
          s.usedUp = s.usedUp.filter((u) => u !== id);
          s.items[id].holder = home;
          grew = true;
        }
      }
      const options = [[null, null]];
      for (const item of carriable())
        for (const holder of [place, "vale", ...residents, ...ships])
          options.push([item, holder]);
      for (const [item, holder] of options) {
        const before = item && s.items[item].holder;
        const was = s.actors.vale.place;
        s.actors.vale.place = place;
        if (item) s.items[item].holder = holder;
        settleGuards(s);
        const found = exits(s, place, "vale").filter(keep);
        for (const to of lanes(place)) {
          const gate = laneConditions(place, to) || [];
          if (!ship && gate.length) continue;
          if (
            keep(to) &&
            entityActive(s, to) &&
            gate.every((c) => conditionMet(s, c, null, "greek-drama", "vale"))
          )
            found.push(to);
        }
        if (item) s.items[item].holder = before;
        s.actors.vale.place = was;
        for (const to of found)
          if (!seen.has(to)) {
            seen.add(to);
            grew = true;
          }
      }
    }
  }
  return seen;
}

// The worst case for a walker: every key is somewhere out of reach. What is
// still walkable then is walkable always.
function worstCase(world) {
  const s = structuredClone(world);
  for (const id of KEYS) if (s.items[id]) s.items[id].holder = "greek-ship";
  return s;
}
// Piraeus lies outside the Theban walls.
const OUTSIDE_WALLS = ["greek-piraeus"];

describe("ports reachable on foot or by a free leg home", () => {
  it("calls at Piraeus before Dione's invitation, with cargo aboard", () => {
    // Piraeus is Thebes's sea exit: the provisions or a Hoppy Cat thing
    // aboard sail there at once. Its road inland needs no invitation: the sea
    // route to Athens is an alternative to the land route (no burial).
    // Myrto has packed a load of provisions (rules 95).
    const s = stowProvisions(stages.opening(), "greek-harbor");
    expect(entityActive(s, "greek-piraeus")).toBe(true);
    expect(entityActive(s, "greek-road-athens-piraeus")).toBe(true);
    expect(reach(s, "greek-harbor", { ship: true }).has("greek-piraeus")).toBe(
      true,
    );
    const bare = { pinned: KEYS, free: true, local: false };
    expect(reach(worstCase(s), "greek-harbor", bare).has("greek-piraeus")).toBe(
      false,
    );
    // Carried aboard, the provisions open nothing: they must lie on deck
    // (rules 102). The City Gate's keys stay out of reach, so the land road
    // to Piraeus is shut too.
    const carried = structuredClone(s);
    carried.items["greek-provisions"].holder = "vale";
    carried.actors.vale.place = "greek-ship";
    expect(
      reach(carried, "greek-harbor", {
        pinned: [
          "greek-provisions",
          "greek-creon-writ",
          "greek-decree",
          "greek-olive-branch",
        ],
        ship: true,
      }).has("greek-piraeus"),
    ).toBe(false);
    // The provisions on deck or something from Hoppy Cat aboard: the cargo
    // rule for each leg out beyond the harbor. The leg home to Black Pond
    // is free.
    const cargo = laneConditions("greek-harbor", "greek-piraeus");
    // Only the provisions lying on deck open it: no Hoppy Cat alternative.
    expect(cargo).toEqual([
      { kind: "item_at", item: "greek-provisions", place: "greek-ship" },
    ]);
    for (const from of ["greek-piraeus", "pond"])
      expect(laneConditions(from, "hoppycat-signal-jetty")).toEqual([
        {
          kind: "pack_item_present",
          pack: "hoppycat-archive",
          place: "greek-ship",
        },
      ]);
    expect(laneConditions("hoppycat-signal-jetty", "pond")).toBe(null);
    expect(laneConditions("pond", "greek-harbor")).toBe(null);
    expect(laneConditions("greek-harbor", "pond")).toBe(null);
  });

  for (const stage of ["opening", "open door", "ajax"])
    it(`keeps Marathon on land and reaches Ajax by sea after the invitation: ${stage}`, () => {
      const s = stages[stage]();
      const opened = stage === "ajax";
      expect(entityActive(s, MARATHON)).toBe(true);
      for (const id of AJAX_PLACES)
        expect(entityActive(s, id), id).toBe(opened);
      for (const id of FAR_SHORES) expect(entityActive(s, id), id).toBe(true);
      const seen = reach(s, "greek-harbor", { ship: true, local: false });
      expect(seen.has(MARATHON)).toBe(true);
      expect(seen.has(PAGASAE)).toBe(true);
      expect(has(seen, FAR_SHORES)).toEqual(FAR_SHORES);
      expect(has(seen, AJAX_PLACES)).toEqual(opened ? AJAX_PLACES : []);
      for (const t of Object.values(transports))
        expect(t.docks).not.toContain(MARATHON);
    });

  it("connects the Far Shores to Pagasae by two-way cargo-free Scylla lanes", () => {
    const ship = transports[SCYLLA];
    expect(ship.at).toBe(PAGASAE);
    expect(ship.shipmaster).toBe("greek-pagasae-pilot");
    expect(new Set(ship.docks)).toEqual(
      new Set([PAGASAE, ...FAR_SHORES, AJAX_LANDING, EGYPT_TOMB, HOMECOMING_BEACH]),
    );
    expect(ship.lanes).toHaveLength(FAR_SHORE_LANES.length);
    for (const [from, to] of FAR_SHORE_LANES) {
      expect(lanesFrom(ship, from)).toContain(to);
      expect(lanesFrom(ship, to)).toContain(from);
      expect(laneConditions(from, to)).toBeNull();
      expect(laneConditions(to, from)).toBeNull();
    }
    const s = stages.opening();
    for (const dock of FAR_SHORES) {
      expect(lanePath(s, SCYLLA, dock, PAGASAE)?.at(-1), dock).toBe(PAGASAE);
      expect(lanePath(s, "greek-ship", dock, "pond"), dock).toBeNull();
    }
  });

  it("opens the Scylla's three story berths only for their own commitments", () => {
    const s = stages.opening();
    expect(lanePath(s, SCYLLA, PAGASAE, AJAX_LANDING)).toBeNull();
    expect(lanePath(s, SCYLLA, PAGASAE, EGYPT_TOMB)).toBeNull();
    expect(lanePath(s, SCYLLA, PAGASAE, HOMECOMING_BEACH)).toBeNull();
    expect(exits(s, "greek-harbor", "vale")).not.toContain(EGYPT_TOMB);

    s.packs["greek-drama"].flags["greek-ajax-open"] = true;
    expect(lanePath(s, SCYLLA, PAGASAE, AJAX_LANDING)).toEqual([
      PAGASAE,
      "greek-lemnos",
      AJAX_LANDING,
    ]);
    expect(lanePath(s, SCYLLA, AJAX_LANDING, PAGASAE)).toEqual([
      AJAX_LANDING,
      "greek-lemnos",
      PAGASAE,
    ]);
    expect(lanePath(s, "greek-ship", "greek-harbor", AJAX_LANDING)).toBeNull();
    expect(entityActive(s, "greek-road-north")).toBe(false);
    expect(exits(s, "greek-harbor", "vale")).not.toContain("greek-road-north");
    expect(exits(s, AJAX_LANDING, "vale")).not.toContain("greek-road-north");
    expect(exits(s, AJAX_LANDING, "vale")).toContain("greek-greek-camp");

    delete s.packs["greek-drama"].flags["greek-ajax-open"];
    s.packs["greek-drama"].choices["greek-helen-account"] = "troy";
    expect(lanePath(s, SCYLLA, PAGASAE, EGYPT_TOMB)).toBeNull();
    expect(lanePath(s, SCYLLA, PAGASAE, AJAX_LANDING)).toBeNull();
    expect(lanePath(s, SCYLLA, PAGASAE, HOMECOMING_BEACH)).toEqual([
      PAGASAE, "greek-lemnos", HOMECOMING_BEACH,
    ]);
    expect(lanePath(s, SCYLLA, HOMECOMING_BEACH, PAGASAE)).toEqual([
      HOMECOMING_BEACH, "greek-lemnos", PAGASAE,
    ]);
    expect(exits(s, "greek-harbor", "vale")).not.toContain(HOMECOMING_BEACH);
    expect(exits(s, HOMECOMING_BEACH, "vale")).not.toContain("greek-harbor");
    expect(exits(s, HOMECOMING_BEACH, "vale")).not.toContain(AJAX_LANDING);
    s.packs["greek-drama"].choices["greek-helen-account"] = "egypt";
    expect(lanePath(s, SCYLLA, PAGASAE, HOMECOMING_BEACH)).toBeNull();
    expect(lanePath(s, SCYLLA, PAGASAE, EGYPT_TOMB)).toEqual([
      PAGASAE,
      EGYPT_TOMB,
    ]);
    expect(exits(s, "greek-harbor", "vale")).not.toContain(EGYPT_TOMB);
    expect(exits(s, EGYPT_TOMB, "vale")).not.toContain("greek-harbor");
  });

  it("walks to Pagasae, sails to the Ajax landing and returns to the Wine-Dark Harbor cargo-free", () => {
    const start = traveler(greekStart()).move("harbor");
    expect(placeText(start.s, "greek-harbor")).toContain("Theban Harbor Road");
    expect(placeText(start.s, "greek-harbor")).toContain("Argos and Corinth");
    start.act("talk", { target: "greek-shipmaster" });
    expect(start.s.packs["greek-drama"].flags["greek-ajax-open"]).toBe(true);
    stowProvisions(start.s, "greek-harbor");
    const t = landRoad(start.move("road-thebes", "courtyard"));
    const overland = [
      "greek-gate",
      "greek-battlefield",
      "greek-cithaeron",
      "greek-eleusis",
      "greek-road-athens-eleusis",
      "greek-athens",
      CIVIC_AVENUE,
      "greek-road-sacred-way",
      "greek-delphi",
      "greek-oeta",
      "greek-trachis",
      "greek-pherae",
      PAGASAE,
    ];
    const waypoints = {
      "greek-eleusis": "Sacred Way",
      "greek-athens": "Civic Avenue",
      [CIVIC_AVENUE]: "Delphi",
      "greek-delphi": "The Oeta Road",
      "greek-oeta": "through Trachis",
      "greek-trachis": "down to Pherae",
      "greek-pherae": "Pagasae Anchorage",
      [PAGASAE]: "Ask Philon",
    };
    for (const place of overland) {
      t.act("move", { target: place });
      if (waypoints[place])
        expect(placeText(t.s, place)).toContain(waypoints[place]);
    }
    expect(t.s.actors.vale.place).toBe(PAGASAE);
    expect(exits(t.s, PAGASAE, "vale")).toContain("greek-pherae");

    expect(knowsLane(t.s, "vale", PAGASAE, "greek-lemnos")).toBe(false);
    t.waitFor("pagasae-pilot");
    t.s = ajaxTalk(t.s, `lane:${PAGASAE}>greek-lemnos`, {
      target: "greek-pagasae-pilot",
    });
    const sail = (dock) =>
      t.move(SCYLLA).act("course", { target: dock }).act("wait").move(dock);
    sail("greek-lemnos");
    sail(AJAX_LANDING);
    t.move("greek-greek-camp", AJAX_LANDING);
    sail("greek-lemnos");
    sail(PAGASAE);
    for (const target of [
      ...overland.slice(0, -1).reverse(),
      "greek-courtyard",
      "greek-road-thebes",
      "greek-harbor",
    ])
      t.act("move", { target });
    expect(t.s.actors.vale.place).toBe("greek-harbor");
    expect(t.s.actors.vale.visited).not.toContain("greek-ship");
    expect(t.s.items["greek-provisions"].holder).toBe("greek-harbor");
  });

  it("walks the land route home from Piraeus along the open Long Walls", () => {
    let s = openDoorStart();
    s = holding(s, "greek-creon-writ", "greek-guard");
    for (const a of Object.values(s.actors))
      if (a.place === "greek-ship") a.place = "greek-piraeus";
    s.actors.vale.place = "greek-piraeus";
    Object.assign(s.transports["greek-ship"], {
      phase: "docked",
      dock: "greek-piraeus",
      destination: null,
      riders: [],
      since: s.turn - 1,
      recall: null,
    });
    stowProvisions(s, "greek-ship");
    callTransport(s, "greek-harbor");
    stowProvisions(s, "greek-harbor");
    expect(s.transports["greek-ship"].dock).toBe("greek-harbor");
    // The Long Walls are open from the start; no truce opens them.
    expect(exits(s, "greek-piraeus", "vale")).toEqual([
      "greek-road-athens-piraeus",
    ]);
    const step = (fields) => {
      const action = legalActions(s, "vale").find((a) =>
        Object.entries(fields).every(([k, v]) => a[k] === v),
      );
      expect(action, JSON.stringify(fields)).toBeTruthy();
      const result = play(s, action, s.revision);
      expect(result.ok, result.error).toBe(true);
      s = result.state;
    };
    expect(pack.places["greek-road-coast"].retired).toBe(true);
    for (const target of [
      "greek-road-athens-piraeus",
      CITY_ROAD_FORK,
      CIVIC_AVENUE,
      "greek-athens",
      "greek-road-athens-eleusis",
      "greek-eleusis",
      "greek-cithaeron",
      "greek-battlefield",
      "greek-gate",
      "greek-courtyard",
      "greek-road-thebes",
      "greek-harbor",
    ])
      step({ kind: "move", target });
    expect(s.actors.vale.place).toBe("greek-harbor");
  });
});

// The places behind each Greek story gate, and the ways in that a traveler
// should never find by walking around it. The City Gate guards the city;
// the battlefield and Cithaeron lie outside it.
const BATTLEFIELD = ["greek-battlefield", "greek-cithaeron"];
const THEBES = [
  "greek-courtyard",
  "greek-well",
  "greek-palace",
  "greek-sanctuary",
  "greek-gate",
  "greek-road-thebes",
  "greek-harbor",
];
const COUNTRYSIDE = [
  "greek-cithaeron",
  "greek-eleusis",
  "greek-eleusis-lower-precinct",
  "greek-colonus",
];
const CITY = [
  "greek-athens",
  CIVIC_AVENUE,
  CITY_ROAD_FORK,
  "greek-road-athens-piraeus",
];
const holding = (world, item, holder) => {
  world.items[item].holder = holder;
  if (item === "greek-creon-writ" && holder === "greek-guard") {
    // An open-gate fixture supplies both authority papers and personal trust.
    world.items["greek-decree"].holder = holder;
    world.actors[holder].trust.vale = 1;
  }
  return settleGate(world);
};
const has = (seen, ids) => ids.filter((id) => seen.has(id));

describe("the roads home keep the Greek story gates", () => {
  for (const stage of ["opening", "open door", "ajax"])
    it(`keeps the battlefield behind the City Gate: ${stage}`, () => {
      const s = stages[stage]();
      const starts = ["greek-harbor"];
      for (const from of starts) {
        // Keep the Decree with its guard and the Writ out of reach.
        // Carrying, trading and making other goods cannot open his gate.
        const before = reach(s, from, {
          pinned: ["greek-creon-writ", "greek-decree"],
        });
        expect(has(before, BATTLEFIELD), from).toEqual([]);
        // Nor with the decree alone: the guard holds it from the start.
        const decree = reach(s, from, {
          pinned: ["greek-creon-writ", "greek-decree", "greek-bread"],
        });
        expect(has(decree, BATTLEFIELD), from).toEqual([]);
        // With both papers, the guard admits this trusted traveller.
        const after = reach(
          holding(structuredClone(s), "greek-creon-writ", "greek-guard"),
          from,
        );
        expect(after.has("greek-battlefield"), from).toBe(true);
        expect(has(after, [...AJAX_PLACES, "greek-troy"]), from).toEqual([]);
        expect(has(after, FAR_SHORES), from).toEqual([]);
      }
      // The search itself finds the gate's key by the chain of rules 102:
      // Dione bakes the bread from the water jar and her wheat, the bread
      // buys the guard's decree, and the decree buys Creon's writ.
      expect(s.usedUp).toContain("greek-bread");
      expect(reach(s, "greek-harbor").has("greek-battlefield")).toBe(true);
    });

  for (const stage of ["open door", "ajax"])
    it(`keeps Thebes behind the City Gate from outside the walls: ${stage}`, () => {
      const s = stages[stage]();
      for (const from of [...OUTSIDE_WALLS, "greek-cithaeron"]) {
        // Without the guard holding Creon's writ, a walker from Attica
        // reaches the battlefield but never the city: the guard bars his
        // gate both ways.
        const before = reach(s, from, {
          pinned: ["greek-creon-writ", "greek-decree"],
        });
        expect(before.has("greek-battlefield"), from).toBe(true);
        expect(has(before, THEBES), from).toEqual([]);
        // Both papers and personal trust open the city to the land route.
        const after = reach(
          holding(structuredClone(s), "greek-creon-writ", "greek-guard"),
          from,
          { pinned: ["greek-creon-writ", "greek-decree"] },
        );
        expect(has(after, THEBES), from).toEqual(THEBES);
      }
    });

  for (const stage of ["open door", "ajax"])
    it(`walks on from the battlefield to the countryside, the Agora and Piraeus: ${stage}`, () => {
      const s = holding(stages[stage](), "greek-creon-writ", "greek-guard");
      const outcomes = ["greek-burial-account", "greek-creon-writ"];
      const starts = ["greek-harbor"];
      for (const from of starts) {
        const before = reach(s, from, { pinned: outcomes });
        expect(before.has("greek-battlefield")).toBe(true);
        // The Battlefield–Cithaeron road, the countryside, the Sacred Way and
        // the Long Walls are plain roads, whatever the Theban outcome.
        expect(has(before, COUNTRYSIDE), from).toEqual(COUNTRYSIDE);
        expect(has(before, CITY), from).toEqual(CITY);
        expect(before.has("greek-piraeus"), from).toBe(true);
      }
    });

  for (const stage of ["open door", "ajax"])
    it(`opens the Agora to a sea arrival and to a walker alike: ${stage}`, () => {
      // Myrto has packed a load of provisions (rules 95).
      const s = holding(
        stowProvisions(stages[stage](), "greek-harbor"),
        "greek-creon-writ",
        "greek-guard",
      );
      const keys = [
        "greek-burial-petition",
        "greek-olive-branch",
        "greek-provisions",
      ];
      // On foot, with no petition, truce or provisions: the Sacred Way and
      // the Long Walls need nothing.
      const walked = reach(s, "greek-harbor", { pinned: keys });
      expect(has(walked, CITY)).toEqual(CITY);
      expect(walked.has("greek-piraeus")).toBe(true);
      // The provisions aboard sail to Piraeus, and the Long Walls lead in.
      const sailed = reach(s, "greek-harbor", {
        pinned: keys.filter((id) => id !== "greek-provisions"),
        ship: true,
      });
      expect(sailed.has("greek-piraeus")).toBe(true);
      expect(has(reach(s, "greek-piraeus", { pinned: keys }), CITY)).toEqual(
        CITY,
      );
    });
});

// A save from rules 93 (Greek revision 17) still holds the Coast Road and the
// Northern Road's gate at the sanctuary. It loads without a fresh start: the
// road's travelers and things come ashore at Piraeus, and the retired gates
// and steps are forgotten (rules 94). The Rust road upgrade test loads a
// shared rules 93 world saved before the invitation.

// A rules 93 world with travelers and things at Marathon and Troy, and the
// ship bound for Marathon. Rules 94 makes them rumours: whoever and whatever
// visited comes back, the ship comes in to Piraeus with its riders, the
// rumours' own people and things wait unmet at home, and their story steps
// are forgotten.
