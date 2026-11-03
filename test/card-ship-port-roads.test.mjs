// The ship is the quick way to a port, never the only way (#2049). Every dock
// a world can sail to has a walking way to its pack's start, so a traveler
// whose ship is called away can always walk home. The walking roads home must
// not walk around the Greek story gates: each gate is checked by search over
// every place a traveler could walk to and every thing they could carry or
// hand over on the way.
import { describe, expect, it } from "vitest";
import {
  createWorld,
  currentActor,
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
  transports,
} from "../v2/card-game/pack-registry.mjs";
import {
  callTransport,
  laneConditions,
  lanesFrom,
} from "../v2/card-game/pack-transport.mjs";
import { conditionMet } from "../v2/card-game/pack-rules.mjs";
import { stowProvisions } from "./helpers/provisions.mjs";

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
// Old full-scope worlds keep four one-place island and far-shore stops whose
// roads retired. New and shared worlds never open them.
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

// Where a traveler can get to. On foot only, unless `ship`: then any sea lane
// whose conditions some carried thing aboard could meet joins its docks.
// Every key not `pinned` that lies in a place already reached can be carried
// to any reached place, set down there, put aboard, or handed to a resident
// there; each hand-over that opens a gate latches it, as play does. So the
// search is generous to the traveler: a gated place it never reaches cannot
// be reached by any order of walking, carrying and giving.
function reach(world, from, { pinned = [], ship = false, local = true } = {}) {
  const s = structuredClone(world);
  const seen = new Set([from]);
  const keep = (to) =>
    !ships.has(to) && (!local || to.startsWith("greek-")) && !seen.has(to);
  const carriable = () =>
    KEYS.filter(
      (id) =>
        s.items[id] &&
        !pinned.includes(id) &&
        entityActive(s, id) &&
        (s.items[id].holder === "vale" || seen.has(placeOf(s, id))) &&
        !packPeople[s.items[id].holder],
    );
  const lanes = (dock) =>
    ship
      ? Object.values(transports).flatMap((t) =>
          t.docks.includes(dock) ? lanesFrom(t, dock) : [],
        )
      : [];
  for (let grew = true; grew; ) {
    grew = false;
    for (const place of [...seen]) {
      const residents = Object.keys(packPeople).filter(
        (id) => entityActive(s, id) && s.actors[id]?.place === place,
      );
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
        const found = exits(s, place, "vale").filter(keep);
        for (const to of lanes(place)) {
          const gate = laneConditions(place, to) || [];
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
// gate has ever opened. What is still walkable then is walkable always.
function worstCase(world) {
  const s = structuredClone(world);
  delete s.openedRoutes;
  for (const id of KEYS) if (s.items[id]) s.items[id].holder = "greek-ship";
  return s;
}
const start = (dock) =>
  packDefinitions.find((p) => p.places[dock])?.entry ?? "station";

function shipOnly(world) {
  const bare = worstCase(world);
  return Object.values(transports)
    .flatMap((t) => t.docks)
    .filter((dock) => entityActive(world, dock))
    .filter(
      (dock) =>
        !reach(bare, dock, { pinned: KEYS, local: false }).has(start(dock)),
    );
}

describe("ports reachable by land", () => {
  for (const [stage, make] of Object.entries(stages))
    it(`leaves no dock ship-only, wherever its things lie: ${stage}`, () => {
      expect(shipOnly(make())).toEqual(stage === "full" ? FAR_SHORES : []);
    });

  it("walks home from Piraeus when another traveler calls the ship away", () => {
    // The #2049 strand: Vale ashore at Piraeus before Dione's invitation, the
    // ship called to the harbor and the provisions carried ashore there.
    let s = createWorld();
    s.crossings["pond-greek-harbor"].discovered = true;
    s.controlledActors = ["vale", "mara"];
    s.actors.vale.place = "greek-piraeus";
    s.transports["greek-ship"].dock = "greek-piraeus";
    stowProvisions(s, "greek-ship");
    callTransport(s, "greek-harbor");
    stowProvisions(s, "greek-harbor");
    const step = (fields) => {
      const action = legalActions(s, "vale").find((a) =>
        Object.entries(fields).every(([k, v]) => a[k] === v),
      );
      expect(action, JSON.stringify(fields)).toBeTruthy();
      const result = play(s, action, s.revision);
      expect(result.ok, result.error).toBe(true);
      s = result.state;
    };
    for (let i = 0; i < 20 && currentActor(s) === "vale"; i++)
      step({ kind: "wait" });
    // The ship stays away: the lanes and the call are unchanged.
    expect(s.transports["greek-ship"].dock).not.toBe("greek-piraeus");
    expect(exits(s, "greek-harbor", "vale")).not.toContain("greek-road-coast");
    step({ kind: "move", target: "greek-road-coast" });
    step({ kind: "move", target: "greek-harbor" });
    expect(s.actors.vale.place).toBe("greek-harbor");
  });

  it("walks home from the Trojan landing by the Northern Road", () => {
    const s = stages.ajax();
    expect(exits(s, "greek-ajax-landing", "vale")).toContain(
      "greek-road-north",
    );
    // The road comes down inside Thebes at the Hillside Sanctuary, never at
    // the battlefield beyond the City Gate.
    expect(pack.places["greek-road-north"].road).toEqual([
      "greek-ajax-landing",
      "greek-sanctuary",
    ]);
    expect(reach(worstCase(s), "greek-ajax-landing").has("greek-harbor")).toBe(
      true,
    );
    // The road waits for Myrto's invitation.
    expect(entityActive(stages["open door"](), "greek-road-north")).toBe(false);
  });
});

// The places behind each Greek story gate, and the ways in that a traveler
// should never find by walking around it.
const BATTLEFIELD = ["greek-battlefield", "greek-cithaeron"];
const COUNTRYSIDE = ["greek-cithaeron", "greek-eleusis", "greek-colonus"];
// Assembly Hill and the Acropolis belong to full-scope worlds only.
const CITY = ["greek-athens", "greek-road-athens-piraeus"];
const holding = (world, item, holder) => {
  world.items[item].holder = holder;
  return world;
};
const has = (seen, ids) => ids.filter((id) => seen.has(id));

describe("the roads home keep the Greek story gates", () => {
  for (const stage of ["opening", "open door", "ajax"])
    it(`keeps the battlefield behind the City Gate: ${stage}`, () => {
      const s = stages[stage]();
      const starts = ["greek-harbor"];
      if (stage === "ajax") starts.push("greek-ajax-landing");
      for (const from of starts) {
        // Carrying anything else anywhere, without the guard holding the
        // decree no walker passes the gate, and the Northern Road stays shut
        // from the city side.
        const before = reach(s, from, { pinned: ["greek-decree"] });
        expect(has(before, BATTLEFIELD), from).toEqual([]);
        if (from === "greek-harbor")
          expect(before.has("greek-road-north")).toBe(false);
        // The guard holding the decree at the gate opens it.
        const after = reach(
          holding(structuredClone(s), "greek-decree", "greek-guard"),
          from,
        );
        expect(after.has("greek-battlefield"), from).toBe(true);
        if (stage === "ajax") {
          expect(after.has("greek-road-north")).toBe(true);
          expect(after.has("greek-ajax-landing")).toBe(true);
        }
      }
      // The search itself finds the gate's key: the decree from the palace.
      expect(reach(s, "greek-harbor").has("greek-battlefield")).toBe(true);
    });

  for (const stage of ["open door", "ajax"])
    it(`keeps the countryside behind a Theban outcome: ${stage}`, () => {
      const s = holding(stages[stage](), "greek-decree", "greek-guard");
      const outcomes = [
        "greek-burial-account",
        "greek-creon-writ",
        "greek-guard-tablet",
      ];
      const starts = ["greek-harbor"];
      if (stage === "ajax") starts.push("greek-ajax-landing");
      for (const from of starts) {
        const before = reach(s, from, { pinned: outcomes });
        expect(before.has("greek-battlefield")).toBe(true);
        expect(has(before, COUNTRYSIDE), from).toEqual([]);
        expect(has(before, CITY), from).toEqual([]);
        // The tablet reaches Dione's table: the Cithaeron road opens.
        const after = reach(
          holding(structuredClone(s), "greek-guard-tablet", "greek-courtyard"),
          from,
          { pinned: outcomes },
        );
        expect(has(after, COUNTRYSIDE), from).toEqual(COUNTRYSIDE);
      }
    });

  for (const stage of ["open door", "ajax"])
    it(`keeps the Agora behind the petition or the provisions: ${stage}`, () => {
      // Thebes is settled and the countryside open: only the city waits.
      const s = holding(
        holding(stages[stage](), "greek-decree", "greek-guard"),
        "greek-guard-tablet",
        "greek-courtyard",
      );
      const keys = [
        "greek-burial-petition",
        "greek-olive-branch",
        "greek-provisions",
      ];
      const starts = ["greek-harbor"];
      if (stage === "ajax") starts.push("greek-ajax-landing");
      for (const from of starts) {
        // On foot, without the petition, the truce or the provisions, nobody
        // reaches the city or Piraeus.
        const before = reach(s, from, { pinned: keys });
        expect(before.has("greek-eleusis"), from).toBe(true);
        expect(has(before, CITY), from).toEqual([]);
        expect(before.has("greek-piraeus"), from).toBe(false);
        expect(before.has("greek-road-coast"), from).toBe(false);
        // The provisions aboard sail to Piraeus, whose Long Walls lead in.
        const sailed = reach(s, from, {
          pinned: keys.filter((id) => id !== "greek-provisions"),
          ship: true,
        });
        expect(has(sailed, CITY), from).toEqual(CITY);
        // On foot, the mothers' petition at Eleusis opens the city road.
        const heard = holding(
          flags(structuredClone(s), "greek-open-door-mothers-heard"),
          "greek-burial-petition",
          "greek-eleusis",
        );
        const walked = reach(heard, from, { pinned: keys });
        expect(walked.has("greek-athens"), from).toBe(true);
        expect(walked.has("greek-piraeus"), from).toBe(false);
        // The herald's truce in the Agora opens the Long Walls and the Coast
        // Road from the harbor.
        const truce = holding(
          flags(structuredClone(heard), "greek-open-door-plea-registered"),
          "greek-olive-branch",
          "greek-athens",
        );
        const open = reach(truce, from, { pinned: keys });
        expect(open.has("greek-piraeus"), from).toBe(true);
        expect(exits(truce, "greek-harbor", "vale")).toContain(
          "greek-road-coast",
        );
      }
    });
});
