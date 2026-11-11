import { beforeFuneral } from "./fixtures/card-upgraded-items.mjs";
// A ship is the quick way to a port, never a trap (#2049). The Charybdis
// sails the Black Pond route: Black Pond to the Wine-Dark Harbor and back
// with no cargo, on to Piraeus and the Hoppy Cat jetty only with cargo
// aboard, and every way back toward Black Pond free. So every dock it sails
// to reaches home on foot or by a free leg, even with every gate shut.
// Marathon, Troy and the Far Shores are rumours (rules 94): no way leads
// there. The land route, Piraeus to Athens, Eleusis, Cithaeron and the
// battlefield, enters Thebes only through the City Gate. The roads home must
// not walk around the Greek story gates: each gate is checked by search over
// every place a traveler could walk to and every thing they could carry or
// hand over on the way.
import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  exits,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import {
  entityActive,
  latchRoutes,
  packDefinition,
  packDefinitions,
  packPeople,
  packThings,
  transports,
} from "../v2/card-game/pack-registry.mjs";
import {
  callTransport,
  laneConditions,
  lanesFrom,
} from "../v2/card-game/pack-transport.mjs";
import { conditionMet } from "../v2/card-game/pack-rules.mjs";
import { stowProvisions } from "./helpers/provisions.mjs";
import { openDoorStart } from "./helpers/open-door.mjs";
import { sailTo } from "./helpers/voyage.mjs";
import { greekErrands } from "./helpers/greek-opening.mjs";
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
// A new world, each lasting opening, and an old full-scope world.
const stages = {
  opening: () => discovered(createWorld()),
  "open door": () => discovered(flags(createWorld(), "greek-open-door-open")),
  ajax: () =>
    discovered(flags(createWorld(), "greek-open-door-open", "greek-ajax-open")),
  full: () =>
    discovered(
      createWorld({
        packScopes: Object.fromEntries(
          packDefinitions.filter((p) => p.release).map((p) => [p.id, "full"]),
        ),
      }),
    ),
};
// Rumours: no way leads to them in a world of this release, even once the
// Ajax flag is set. The island and far-shore stops retired into Piraeus.
const RUMOURS = [
  "greek-marathon",
  "greek-road-north",
  "greek-ajax-landing",
  "greek-greek-camp",
  "greek-ajax-household",
  "greek-ajax-grave",
];
const FAR_SHORES = [
  "greek-lemnos",
  "greek-thrace",
  "greek-tauris",
  "greek-sicily",
];

// Every thing a route or a sea lane names in its conditions: the keys that
// open ways.
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

// Whether a traveler waiting at a dock can always call the empty ship there:
// someone else may have called it to any other active dock, its riders and
// cargo gone ashore there. The call is the rules' own, one lane a round.
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

// Where a traveler can get to. On foot, and by every free sea lane if `free`.
// With `ship`, also any sea lane whose conditions some carried thing aboard
// could meet joins its docks. A lane counts only from a dock the traveler can
// call the empty ship to, wherever it lies.
// Every key not `pinned` that lies in a place already reached can be carried
// to any reached place, set down there, laid on deck, or handed to a
// resident there; each hand-over that opens a gate latches it, as play does.
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
        latchRoutes(s);
        // A latched gate's guard stands aside, as a play settles it.
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

// The worst case for a walker: every key is somewhere out of reach and no
// gate has ever opened, or only the given gates. What is still walkable then
// is walkable always.
const CITY_GATE = "greek-gate>greek-battlefield";
function worstCase(world, opened = []) {
  const s = structuredClone(world);
  delete s.openedRoutes;
  if (opened.length) s.openedRoutes = opened;
  for (const id of KEYS) if (s.items[id]) s.items[id].holder = "greek-ship";
  return s;
}
const start = (dock) =>
  packDefinitions.find((p) => p.places[dock])?.entry ?? "station";

function shipOnly(world, opened = []) {
  const bare = worstCase(world, opened);
  return Object.values(transports)
    .flatMap((t) => t.docks)
    .filter((dock) => entityActive(world, dock))
    .filter(
      (dock) =>
        !reach(bare, dock, { pinned: KEYS, free: true, local: false }).has(
          start(dock),
        ),
    );
}

// Piraeus lies outside the Theban walls.
const OUTSIDE_WALLS = ["greek-piraeus"];

describe("ports reachable on foot or by a free leg home", () => {
  for (const [stage, make] of Object.entries(stages))
    it(`strands no dock, with the City Gate open or shut: ${stage}`, () => {
      expect(shipOnly(make(), [CITY_GATE])).toEqual([]);
      expect(shipOnly(make())).toEqual([]);
      expect(transports["greek-ship"].docks).toEqual([
        "pond",
        "greek-harbor",
        "greek-piraeus",
        "hoppycat-signal-jetty",
      ]);
    });

  for (const stage of ["opening", "open door", "ajax"])
    it(`sails home from Piraeus and the Hoppy Cat jetty with no cargo: ${stage}`, () => {
      // Every way back toward Black Pond is free on the Charybdis, so a
      // traveler at Piraeus is never stranded behind the shut City Gate.
      const s = worstCase(stages[stage]());
      for (const dock of ["greek-piraeus", "hoppycat-signal-jetty"]) {
        const home = reach(s, dock, { pinned: KEYS, free: true, local: false });
        expect(home.has("greek-harbor"), dock).toBe(true);
        expect(home.has("pond"), dock).toBe(true);
      }
      expect(laneConditions("greek-piraeus", "greek-harbor")).toBe(null);
      expect(laneConditions("hoppycat-signal-jetty", "greek-piraeus")).toBe(
        null,
      );
    });

  it("calls at Piraeus before Dione's invitation, with cargo aboard", () => {
    // Piraeus is Thebes's sea exit: the provisions or a Hoppy Cat thing
    // aboard sail there at once. Its road inland waits for the invitation.
    // Myrto has packed a load of provisions (rules 95).
    const s = stowProvisions(stages.opening(), "greek-harbor");
    expect(entityActive(s, "greek-piraeus")).toBe(true);
    expect(entityActive(s, "greek-road-athens-piraeus")).toBe(false);
    expect(reach(s, "greek-harbor", { ship: true }).has("greek-piraeus")).toBe(
      true,
    );
    const bare = { pinned: KEYS, free: true, local: false };
    expect(reach(worstCase(s), "greek-harbor", bare).has("greek-piraeus")).toBe(
      false,
    );
    // Carried aboard, the provisions open nothing: they must lie on deck
    // (rules 102).
    const carried = structuredClone(s);
    carried.items["greek-provisions"].holder = "vale";
    carried.actors.vale.place = "greek-ship";
    expect(
      reach(carried, "greek-harbor", {
        pinned: ["greek-provisions"],
        ship: true,
      }).has("greek-piraeus"),
    ).toBe(false);
    // The provisions on deck or something from Hoppy Cat aboard: the cargo
    // rule for each leg out beyond the harbor. The leg home to Black Pond
    // is free.
    const cargo = laneConditions("greek-harbor", "greek-piraeus");
    expect(cargo[0].conditions).toEqual([
      { kind: "item_at", item: "greek-provisions", place: "greek-ship" },
      {
        kind: "pack_item_present",
        pack: "hoppycat-archive",
        place: "greek-ship",
      },
    ]);
    expect(
      laneConditions(
        "greek-piraeus",
        "hoppycat-signal-jetty",
      )[0].conditions.map((c) => c.item ?? c.pack),
    ).toEqual(["greek-provisions", "hoppycat-archive"]);
    expect(laneConditions("pond", "greek-harbor")).toBe(null);
    expect(laneConditions("greek-harbor", "pond")).toBe(null);
  });

  for (const stage of ["opening", "open door", "ajax"])
    it(`keeps Marathon, Troy and the Far Shores as rumours: ${stage}`, () => {
      const s = stages[stage]();
      for (const id of RUMOURS) expect(entityActive(s, id), id).toBe(false);
      for (const id of FAR_SHORES) expect(pack.places[id].retired).toBe(true);
      // Every walk, carry and voyage from the harbor stays short of them.
      const seen = reach(s, "greek-harbor", { ship: true, local: false });
      expect(has(seen, [...RUMOURS, ...FAR_SHORES])).toEqual([]);
      // Nobody is sent there: no want, no lane.
      for (const t of Object.values(transports))
        expect(has(new Set(t.docks), [...RUMOURS, ...FAR_SHORES])).toEqual([]);
    });

  it("calls the empty ship back to Piraeus before the invitation", () => {
    // The Piraeus strand (#2049 review): Vale lands with the provisions and
    // carries them ashore, and Mara at the harbor calls the empty ship away.
    // Piraeus has no road yet. The cargo rule binds only a voyage with
    // riders, so Vale's wait calls the ship back and the free lane home
    // takes her and the provisions to the harbor.
    let s = greekErrands({ water: false }).arrival;
    expect(s.packs["greek-drama"].flags["greek-open-door-open"]).not.toBe(true);
    s.controlledActors = ["vale"];
    s.actors.vale.place = "greek-piraeus";
    stowProvisions(s, "vale");
    Object.assign(s.transports["greek-ship"], {
      phase: "docked",
      dock: "greek-piraeus",
      destination: null,
      riders: [],
      recall: null,
    });
    callTransport(s, "greek-harbor");
    expect(s.transports["greek-ship"].dock).toBe("greek-harbor");
    expect(exits(s, "greek-piraeus", "vale")).toEqual([]);
    const boards = () =>
      legalActions(s, "vale").find(
        (a) => a.kind === "move" && a.target === "greek-ship",
      );
    for (let i = 0; i < 8 && !boards(); i++) {
      const result = play(
        s,
        legalActions(s, "vale").find((a) => a.kind === "wait"),
        s.revision,
      );
      expect(result.ok, result.error).toBe(true);
      s = result.state;
    }
    expect(s.transports["greek-ship"].dock).toBe("greek-piraeus");
    const result = play(s, boards(), s.revision);
    expect(result.ok, result.error).toBe(true);
    s = sailTo(result.state, "greek-harbor", { actor: "vale" });
    expect(s.actors.vale.place).toBe("greek-harbor");
    expect(s.items["greek-provisions"].holder).toBe("vale");
  });

  // Skipped: replays a recorded save through the removed Theban-response
  // branch; retired with the fixtures in package 6 fixtures.
  it.skip("walks the land route home from Piraeus once the truce opens the Long Walls", () => {
    // After the invitation: Vale ashore at Piraeus, the ship called to the
    // harbor and the provisions carried ashore there. Until the herald's
    // truce the quays have no road (the call brings the ship back, above).
    // With the truce the Long Walls open, and the guard holding Creon's
    // writ opens the City Gate, so the land route leads home.
    let s = openDoorStart("burial");
    // The defiant burial went through the guard; the live gate never
    // latches (rules 102), so it opens only while he holds the writ.
    expect(s.openedRoutes || []).not.toContain(CITY_GATE);
    s = holding(s, "greek-creon-writ", "greek-guard");
    // Roaming residents aboard go ashore: the ship is empty.
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
    expect(exits(s, "greek-piraeus", "vale")).toEqual([]);
    // The truce latched both ends of the Long Walls.
    s.openedRoutes = [
      ...s.openedRoutes,
      "greek-athens>greek-road-athens-piraeus",
      "greek-piraeus>greek-road-athens-piraeus",
    ].sort();
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
const COUNTRYSIDE = ["greek-cithaeron", "greek-eleusis", "greek-colonus"];
// Assembly Hill and the Acropolis belong to full-scope worlds only.
const CITY = ["greek-athens", "greek-road-athens-piraeus"];
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
        expect(has(after, RUMOURS), from).toEqual([]);
      }
      // The search itself finds the gate's key by the chain of rules 102:
      // Dione bakes the bread from the water jar and her wheat, the bread
      // buys the guard's decree, and the decree buys Creon's writ.
      expect(s.usedUp).toContain("greek-bread");
      expect(reach(s, "greek-harbor").has("greek-battlefield")).toBe(true);
    });

  for (const stage of ["open door", "ajax"])
    it(`keeps Thebes behind the City Gate from outside the walls: ${stage}`, () => {
      // The herald's truce in the Agora opens the Long Walls from Piraeus.
      const s = flags(stages[stage](), "greek-open-door-plea-registered");
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
    it(`keeps the City Gate shut while the open road reaches the countryside: ${stage}`, () => {
      const s = holding(stages[stage](), "greek-creon-writ", "greek-guard");
      const outcomes = ["greek-burial-account", "greek-creon-writ"];
      const starts = ["greek-harbor"];
      for (const from of starts) {
        const before = reach(s, from, { pinned: outcomes });
        expect(before.has("greek-battlefield")).toBe(true);
        // The Battlefield–Cithaeron road and the connected countryside stay
        // open even while the Theban outcome and City Gate remain unresolved.
        expect(has(before, COUNTRYSIDE), from).toEqual(COUNTRYSIDE);
        expect(has(before, CITY), from).toEqual([]);
      }
    });

  for (const stage of ["open door", "ajax"])
    it(`keeps the Agora behind the petition or the truce: ${stage}`, () => {
      // Thebes is settled and the countryside open: only the city waits.
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
      const starts = ["greek-harbor"];
      for (const from of starts) {
        // On foot, without the petition, the truce or the provisions, nobody
        // reaches the city or Piraeus.
        const before = reach(s, from, { pinned: keys });
        expect(before.has("greek-eleusis"), from).toBe(true);
        expect(has(before, CITY), from).toEqual([]);
        expect(before.has("greek-piraeus"), from).toBe(false);
        // The provisions aboard sail to Piraeus, but its Long Walls wait for
        // the truce: a sea arrival stays at the quays, with the free voyage
        // home (#2049 review).
        const sailed = reach(s, from, {
          pinned: keys.filter((id) => id !== "greek-provisions"),
          ship: true,
        });
        expect(sailed.has("greek-piraeus"), from).toBe(true);
        expect(has(sailed, CITY), from).toEqual([]);
        // On foot, the mothers' petition at Eleusis opens the city road.
        const heard = holding(
          flags(structuredClone(s), "greek-open-door-mothers-heard"),
          "greek-burial-petition",
          "greek-eleusis",
        );
        const walked = reach(heard, from, { pinned: keys });
        expect(walked.has("greek-athens"), from).toBe(true);
        expect(walked.has("greek-piraeus"), from).toBe(false);
        // The herald's truce in the Agora opens the Long Walls both ways.
        const truce = holding(
          flags(structuredClone(heard), "greek-open-door-plea-registered"),
          "greek-olive-branch",
          "greek-athens",
        );
        const open = reach(truce, from, { pinned: keys });
        expect(open.has("greek-piraeus"), from).toBe(true);
        const landed = reach(truce, "greek-piraeus", { pinned: keys });
        expect(has(landed, CITY), from).toEqual(CITY);
      }
    });
});

// The exposure ending: the guard's tablet settles Thebes and the City Gate
// never opens. A sea arrival stays at Piraeus until the truce, and the truce
// is only reached through the gate, so the land route waits. Everywhere a
// traveler can get to still leads home with every key carried off.
describe("the exposure ending with the City Gate shut", () => {
  // Skipped: replays a recorded save through the removed Theban-response
  // branch; retired with the fixtures in package 6 fixtures.
  it.skip("strands nobody", () => {
    // Myrto has packed a load of provisions (rules 95).
    const s = stowProvisions(
      openDoorStart("exposure", { gate: false }),
      "greek-harbor",
    );
    expect(s.openedRoutes || []).not.toContain(CITY_GATE);
    const reached = reach(s, "greek-harbor", {
      pinned: ["greek-creon-writ", "greek-decree"],
      ship: true,
      local: false,
    });
    expect(reached.has("greek-piraeus")).toBe(true);
    expect(has(reached, [...CITY, ...COUNTRYSIDE, ...BATTLEFIELD])).toEqual([]);
    const bare = structuredClone(s);
    for (const id of KEYS)
      if (bare.items[id]) bare.items[id].holder = "greek-ship";
    const stranded = [...reached].filter(
      (place) =>
        !reach(bare, place, { pinned: KEYS, free: true, local: false }).has(
          "pond",
        ),
    );
    expect(stranded).toEqual([]);
  });
});

// A save from rules 93 (Greek revision 17) still holds the Coast Road and the
// Northern Road's gate at the sanctuary. It loads without a fresh start: the
// road's travelers and things come ashore at Piraeus, and the retired gates
// and steps are forgotten (rules 94). The Rust road upgrade test loads a
// shared rules 93 world saved before the invitation.
describe("a rules 93 save on the Coast Road", () => {
  // Skipped: replays a recorded save through the removed Theban-response
  // branch; retired with the fixtures in package 6 fixtures.
  it.skip("comes ashore at Piraeus after the invitation", () => {
    const s = JSON.parse(encodeSave(openDoorStart("burial")));
    s.packs["greek-drama"].revision = 17;
    beforeFuneral(s);
    s.actors.vale.place = "greek-road-coast";
    s.items["greek-water-jar"].holder = "greek-road-coast";
    // The herald's truce had opened the Long Walls from the Agora, and the
    // decree had latched the City Gate open.
    s.openedRoutes = [
      ...(s.openedRoutes || []),
      CITY_GATE,
      "greek-athens>greek-road-athens-piraeus",
      "greek-harbor>greek-road-coast",
      "greek-sanctuary>greek-road-north",
    ].sort();
    s.routeKnowledge["greek-rhapsode"] = [
      ["greek-piraeus", "greek-road-coast"],
      ["greek-road-coast", "greek-harbor"],
      ["greek-road-north", "greek-sanctuary"],
    ];
    const w = decodeSave(JSON.stringify(s));
    // Later revisions add the forecourt, the live City Gate and the funeral.
    expect(w.packs["greek-drama"].revision).toBe(
      packDefinition("greek-drama").revision,
    );
    expect(w.actors.vale.place).toBe("greek-piraeus");
    expect(w.items["greek-water-jar"].holder).toBe("greek-piraeus");
    // Revision 20 forgets the City Gate's old latch: the gate reads live,
    // open only while the guard holds Creon's writ.
    expect(w.openedRoutes).not.toContain(CITY_GATE);
    // Rules 94 opens the Long Walls from both ends with the truce.
    expect(w.openedRoutes).toContain("greek-piraeus>greek-road-athens-piraeus");
    expect(w.openedRoutes).not.toContain("greek-harbor>greek-road-coast");
    expect(w.openedRoutes).not.toContain("greek-sanctuary>greek-road-north");
    const edges = w.routeKnowledge["greek-rhapsode"],
      known = edges.flat();
    expect(known).not.toContain("greek-road-coast");
    expect(edges).not.toContainEqual(["greek-road-north", "greek-sanctuary"]);
    // The Northern Road's known step became the walk from its new end at
    // the harbor up to the sanctuary.
    expect(edges).toContainEqual(["greek-road-north", "greek-harbor"]);
    expect(exits(w, "greek-piraeus", "vale")).toEqual([
      "greek-road-athens-piraeus",
    ]);
  });
});

// A rules 93 world with travelers and things at Marathon and Troy, and the
// ship bound for Marathon. Rules 94 makes them rumours: whoever and whatever
// visited comes back, the ship comes in to Piraeus with its riders, the
// rumours' own people and things wait unmet at home, and their story steps
// are forgotten.
describe("a rules 93 save at Marathon and Troy", () => {
  const saved = (vale, ship, edit = () => {}) => {
    const s = JSON.parse(encodeSave(openDoorStart("burial")));
    // Roaming residents aboard go ashore: only Vale may ride.
    for (const a of Object.values(s.actors))
      if (a.place === "greek-ship") a.place = "greek-harbor";
    edit(s);
    s.packs["greek-drama"].revision = 17;
    beforeFuneral(s);
    s.actors.vale.place = vale;
    s.items["greek-water-jar"].holder = "greek-marathon";
    s.items["greek-ajax-shield"].holder = "greek-ajax-landing";
    s.transports["greek-ship"] = {
      ...s.transports["greek-ship"],
      phase: "sea",
      riders: [],
      ...ship,
    };
    s.routeKnowledge.vale = [
      ...(s.routeKnowledge.vale || []),
      ["sea:greek-piraeus", "sea:greek-marathon"],
    ];
    return decodeSave(JSON.stringify(s));
  };
  const home = (w, from) =>
    reach(worstCase(w), from, { pinned: KEYS, free: true, local: false }).has(
      "greek-harbor",
    );

  // Skipped: replays a recorded save through the removed Theban-response
  // branch; retired with the fixtures in package 6 fixtures.
  it.skip("brings travelers and things back to reachable places", () => {
    const w = saved("greek-ajax-landing", {
      dock: "greek-marathon",
      destination: "greek-ajax-landing",
    });
    // Troy's visitor comes down the Northern Road to the harbor.
    expect(w.actors.vale.place).toBe("greek-harbor");
    expect(w.items["greek-water-jar"].holder).toBe("greek-piraeus");
    // The shield waits at the camp, unseen, with the Trojan story; the
    // altar keeper stays home.
    expect(w.items["greek-ajax-shield"].holder).toBe("greek-greek-camp");
    expect(w.actors["greek-marathon-keeper"].place).toBe("greek-marathon");
    // The empty ship comes in to Piraeus, which sails home free.
    expect(w.transports["greek-ship"]).toMatchObject({
      phase: "docked",
      dock: "greek-piraeus",
      destination: null,
    });
    expect(w.routeKnowledge.vale).not.toContainEqual([
      "sea:greek-piraeus",
      "sea:greek-marathon",
    ]);
    expect(home(w, "greek-piraeus")).toBe(true);
  });

  // Skipped: replays a recorded save through the removed Theban-response
  // branch; retired with the fixtures in package 6 fixtures.
  it.skip("lets go of quests that name the rumours, a player's and a resident's", () => {
    const want = (kind, target) => ({ kind, target, since: 0, refusals: 0 });
    const w = saved(
      "greek-harbor",
      { dock: "greek-piraeus", destination: "greek-harbor" },
      (s) => {
        s.actors.vale.want = want("person", "greek-marathon-keeper");
        s.actors.vale.under = [
          want("place", "greek-ajax-grave"),
          want("place", "greek-eleusis"),
        ];
        s.actors["greek-baker"].want = want("item", "greek-marathon-record");
        delete s.actors["greek-baker"].under;
      },
    );
    // Vale keeps the quest that leads somewhere; the rest are let go.
    expect(w.actors.vale.want).toMatchObject(want("place", "greek-eleusis"));
    expect(w.actors.vale.under).toBeUndefined();
    expect(w.actors["greek-baker"].want?.target).not.toBe(
      "greek-marathon-record",
    );
  });

  // Skipped: replays a recorded save through the removed Theban-response
  // branch; retired with the fixtures in package 6 fixtures.
  it.skip("lands a ship bound for Marathon at Piraeus with its riders", () => {
    const w = saved("greek-ship", {
      dock: "greek-piraeus",
      destination: "greek-marathon",
    });
    expect(w.actors.vale.place).toBe("greek-ship");
    expect(w.transports["greek-ship"]).toMatchObject({
      phase: "arrived",
      dock: "greek-piraeus",
      destination: null,
      riders: ["vale"],
    });
    expect(home(w, "greek-piraeus")).toBe(true);
  });
});
