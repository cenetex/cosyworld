import { describe, expect, it } from "vitest";
import {
  createWorld,
  exits,
  legalActions,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
import {
  entityActive,
  packDefinition,
  packPeople,
  packThings,
} from "../v2/card-game/pack-registry.mjs";
import { lockWords } from "../v2/card-game/cards.mjs";
import { transportExits } from "../v2/card-game/pack-transport.mjs";
import {
  OPEN_DOOR_CAST,
  OPEN_DOOR_KEYS,
  OPEN_DOOR_LOCKS,
} from "./helpers/open-door.mjs";
import {
  conditionsIn,
  forcedChain,
  readersOf,
  storyConditions,
} from "./helpers/open-door-check.mjs";

const pack = packDefinition("greek-drama");
const wait = (s) => {
  const action = legalActions(s).find((a) => a.kind === "wait" && !a.sleep);
  const done = play(s, action, s.revision);
  if (!done.ok) throw new Error(done.error);
  return done.state;
};
function put(s, item, holder) {
  s.usedUp = s.usedUp.filter((id) => id !== item);
  if (item === "greek-olive-branch")
    s.packs["greek-drama"].met["greek-theseus"] = 0;
  s.items[item].holder = holder;
  return s;
}
const far = "greek-courtyard";
const beside = {
  "greek-eleusis": "greek-cithaeron",
  "greek-athens": "greek-road-athens-eleusis",
  "greek-piraeus": "greek-road-athens-piraeus",
  "greek-colonus": "greek-attic-farm",
};
function arrive(s, at) {
  s.actors.vale.place = beside[at];
  const step = legalActions(s).find(
    (a) => a.kind === "move" && a.target === at,
  );
  const done = play(s, step, s.revision);
  if (!done.ok) throw new Error(done.error);
  return done.state;
}

describe("each resident opens on its own present thing", () => {
  for (const [who, { item, at }] of Object.entries(OPEN_DOOR_LOCKS))
    it(`${who}: shut, opened by ${item} at ${at}, shut again while unmet, held once met`, () => {
      let s = createWorld();
      s.actors.vale.place = far;
      expect(entityActive(s, who)).toBe(false);
      expect(packPeople[who].sealed.at).toBe(at);
      const look = structuredClone(s);
      look.actors.vale.place = at;
      expect(lockWords(look, who, () => true)).toMatch(
        new RegExp(`^(Bring|Lay) ${packThings[item].name}`, "i"),
      );
      s = wait(put(s, item, at));
      expect(entityActive(s, who)).toBe(true);
      s.items[item].holder = far;
      s = wait(s);
      expect(entityActive(s, who)).toBe(false);
      expect(s.actors[who].place).toBe(at);
      s = arrive(put(s, item, "vale"), at);
      expect(entityActive(s, who)).toBe(true);
      expect(s.packs["greek-drama"].met[who]).toBeDefined();
      s.items[item].holder = far;
      s.actors.vale.place = far;
      s = wait(s);
      expect(entityActive(s, who)).toBe(true);
      expect(() => validateWorld(s)).not.toThrow();
    });

  it("the Theban gate opens on the writ or the truce in the guard's hands, from both sides", () => {
    for (const key of ["greek-creon-writ", "greek-olive-branch"])
      for (const [from, to] of [
        ["greek-gate", "greek-battlefield"],
        ["greek-battlefield", "greek-gate"],
      ]) {
        let s = createWorld();
        s.actors.vale.place = from;
        s = wait(s);
        expect(exits(s, from, "vale"), `${key} ${from}`).not.toContain(to);
        s = wait(put(s, key, "greek-guard"));
        expect(exits(s, from, "vale"), `${key} ${from}`).toContain(to);
        s.items[key].holder = "greek-courtyard";
        s = wait(s);
        expect(exits(s, from, "vale"), `${key} ${from}`).not.toContain(to);
      }
  });

  it("the urn is Aethra's to make, only while she stands at her altar", () => {
    expect(packThings["greek-ash-urn"].locked).toEqual({
      by: "greek-aethra",
      consumes: ["greek-oil-flask", "greek-olive-branch"],
    });
    expect(packThings["greek-ash-urn"].home).toBe("greek-eleusis");
    expect(packPeople["greek-aethra"].travels).toBe(false);
    expect(packThings["greek-olive-branch"].home).toBe("greek-courtyard");
  });

  it("Thaleia can bake with Water while the Wheat remains in Thebes", () => {
    const s = put(createWorld(), "greek-wheat", "greek-courtyard");
    put(s, "greek-water-jar", "vale");
    s.crossings["pond-greek-harbor"].discovered = true;
    s.actors.vale.place = "greek-piraeus";
    s.usedUp = [...new Set([...s.usedUp, "greek-bread"])];
    expect(s.items["greek-wheat"].holder).toBe("greek-courtyard");
    expect(entityActive(s, "greek-quay-host")).toBe(true);
    const action = legalActions(s).find(
      (a) =>
        a.kind === "give" &&
        a.item === "greek-water-jar" &&
        a.target === "greek-quay-host",
    );
    expect(action).toBeDefined();
    const done = play(s, action, s.revision);
    expect(done.ok, done.error).toBe(true);
    expect(done.state.items["greek-bread"].holder).toBe("greek-piraeus");
    expect(done.state.items["greek-wheat"].holder).toBe("greek-courtyard");
    expect(
      done.state.packs["greek-drama"].receipts["greek-piraeus-bake-bread"],
    ).toBeDefined();
  });
});

describe("the Open Door checklist, computed from the pack", () => {
  it("gives every key two readers or more", () => {
    const counts = Object.fromEntries(
      OPEN_DOOR_KEYS.map((key) => [key, readersOf(pack, key).length]),
    );
    for (const [key, n] of Object.entries(counts))
      expect(n, key).toBeGreaterThanOrEqual(2);
    expect(readersOf(pack, "greek-olive-branch")).toEqual(
      expect.arrayContaining([
        "gate:greek-gate>greek-battlefield",
        "recipe:greek-ash-urn",
        "want:greek-adrastus",
      ]),
    );
  });

  it("reads no story outcome or receipt in any Open Door lock, gate or key", () => {
    const attica = new Set(Object.values(OPEN_DOOR_LOCKS).map((l) => l.at));
    const read = [
      ...Object.keys(OPEN_DOOR_LOCKS).flatMap((id) => [
        ...(packPeople[id].requires || []),
        ...(packPeople[id].appearsWhen || []),
        ...(packPeople[id].passWhen || []),
      ]),
      ...OPEN_DOOR_KEYS.flatMap((id) => packThings[id].requires || []),
      ...pack.routes
        .filter(
          (r) =>
            attica.has(r.from) || attica.has(r.to) || r.from === "greek-gate",
        )
        .flatMap((r) => [...(r.requires || []), ...(r.travelerRequires || [])]),
    ];
    expect(storyConditions(read)).toEqual([]);
    expect(
      conditionsIn(read).filter((condition) => condition.kind === "receipt"),
    ).toEqual([]);
    expect(
      pack.routes.filter((r) => r.to === "greek-road-athens-eleusis"),
    ).toEqual([]);
  });

  it("forces no chain longer than four", () => {
    const chain = forcedChain(pack);
    const depths = Object.fromEntries(
      Object.keys(OPEN_DOOR_LOCKS).map((id) => [id, chain.lock(id)]),
    );
    expect(Math.max(...Object.values(depths))).toBeLessThanOrEqual(4);
    expect(depths["greek-argive-mother"]).toBe(4);
    expect(chain.gate("greek-gate", "greek-battlefield")).toBeLessThanOrEqual(
      4,
    );
  });

  it("gives everyone in the Open Door cast a want", () => {
    for (const id of OPEN_DOOR_CAST)
      expect(packPeople[id].want ?? packPeople[id].wants, id).toBeTruthy();
    for (const id of Object.keys(OPEN_DOOR_LOCKS))
      expect(
        conditionsIn(packPeople[id].requires).some(
          (c) => c.kind === "met" && c.actor === id,
        ),
        id,
      ).toBe(true);
  });
});

describe("no placement of a key seals a resident or a road", () => {
  const scylla = pack.transports["greek-scylla"];
  const hands = [
    "vale",
    "greek-guard",
    "greek-baker",
    "greek-creon",
    "greek-shipmaster",
  ];
  const holderOf = (s, id) => {
    let h = s.items[id].holder;
    while (s.items[h]) h = s.items[h].holder;
    return h;
  };
  function walkingExits(s) {
    const walked = new Map();
    return (at) => {
      if (!walked.has(at)) {
        const before = s.actors.vale.place;
        s.actors.vale.place = at;
        const ways = exits(s, at, "vale").filter(
          (to) => to !== "greek-ship" && to !== scylla.place,
        );
        s.actors.vale.place = before;
        if (scylla.docks.includes(at))
          ways.push(scylla.place, ...transportExits(s, scylla.place, at));
        walked.set(at, ways);
      }
      return walked.get(at);
    };
  }
  function reach(s, from, waysFrom) {
    const seen = new Set([from]);
    const queue = [from];
    const add = (to) => {
      if (!seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    };
    const fetchable = (id) => canFetch(s, id, seen);
    if (from === scylla.place)
      for (const berth of transportExits(s, scylla.place)) add(berth);
    for (let i = 0; i < queue.length; i++) {
      const at = queue[i];
      if (at !== scylla.place) for (const to of waysFrom(at)) add(to);
      if (["greek-creon-writ", "greek-olive-branch"].some(fetchable)) {
        if (seen.has("greek-gate")) add("greek-battlefield");
        if (seen.has("greek-battlefield")) add("greek-gate");
      }
      if (seen.has("greek-battlefield")) add("greek-polynices-hollow");
      if (seen.has("greek-piraeus")) add("greek-harbor");
      if (seen.has("greek-harbor") && fetchable("greek-provisions"))
        add("greek-piraeus");
    }
    return seen;
  }
  function canFetch(s, item, reached) {
    if (!s.usedUp.includes(item)) {
      const holder = holderOf(s, item);
      return (
        holder === "vale" || reached.has(s.actors[holder]?.place ?? holder)
      );
    }
    const lock = packThings[item].locked;
    return (
      Boolean(lock) &&
      reached.has(packThings[item].home) &&
      lock.consumes.every((ingredient) => canFetch(s, ingredient, reached))
    );
  }
  it(`covers ${OPEN_DOOR_KEYS.length} keys on the mainland, the Scylla, its reachable shores, and in Theban hands`, () => {
    const opening = createWorld();
    opening.crossings["pond-greek-harbor"].discovered = true;
    opening.actors.vale.place = "greek-harbor";
    const talk = legalActions(opening).find(
      (a) => a.kind === "talk" && a.target === "greek-shipmaster",
    );
    expect(talk).toBeDefined();
    const told = play(opening, talk, opening.revision);
    expect(told.ok, told.error).toBe(true);
    const base = told.state;
    expect(base.packs["greek-drama"].flags["greek-ajax-open"]).toBe(true);
    const places = pack.release.places.filter(
      (id) =>
        !pack.places[id].retired &&
        entityActive(base, id) &&
        id !== "greek-ship",
    );
    const cases = OPEN_DOOR_KEYS.flatMap((key) =>
      [...places, ...hands].map((holder) => [key, holder]),
    );
    const stuck = [];
    for (const [key, holder] of cases) {
      let s = put(structuredClone(base), key, holder);
      s.actors.vale.place = "greek-harbor";
      try {
        s = wait(s);
      } catch (e) {
        stuck.push(`${key}@${holder}: ${e.message}`);
        continue;
      }
      const waysFrom = walkingExits(s);
      const reached = reach(s, "greek-harbor", waysFrom);
      for (const [who, { item, at }] of Object.entries(OPEN_DOOR_LOCKS)) {
        if (entityActive(s, who)) continue;
        if (!reached.has(at) || !canFetch(s, item, reached))
          stuck.push(`${key}@${holder}: ${who} sealed`);
      }
      for (const place of [
        "greek-eleusis",
        "greek-athens",
        "greek-colonus",
        "greek-piraeus",
        "greek-battlefield",
      ])
        if (!reached.has(place))
          stuck.push(`${key}@${holder}: ${place} unreachable`);
      for (const place of reached)
        if (!reach(s, place, waysFrom).has("greek-harbor"))
          stuck.push(`${key}@${holder}: no way home from ${place}`);
    }
    expect(stuck).toEqual([]);
  });
});
