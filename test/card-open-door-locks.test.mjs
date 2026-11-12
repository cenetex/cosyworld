// The Open Door's locks and its checklist (open-door-rework.md, sections B, D
// and G), on the real Greek pack. Each resident opens on its own present
// thing. The rules keep a resident's box pristine until someone has met it:
// a box re-closes while its resident is unmet, and once met it stays open
// (pack-registry.mjs, validatePackStates). No Open Door lock reads a flag.
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
// Put a thing somewhere by hand, as play could leave it. A made thing is
// made; the truce shows once Theseus has been met.
function put(s, item, holder) {
  s.usedUp = s.usedUp.filter((id) => id !== item);
  if (item === "greek-olive-branch") s.packs["greek-drama"].met["greek-theseus"] = 0;
  s.items[item].holder = holder;
  return s;
}
const far = "greek-courtyard";
// Walk in to a post from the road beside it, as a traveler arrives.
const beside = {
  "greek-eleusis": "greek-cithaeron",
  "greek-athens": "greek-road-athens-eleusis",
  "greek-piraeus": "greek-road-athens-piraeus",
  "greek-colonus": "greek-eleusis",
};
function arrive(s, at) {
  s.actors.vale.place = beside[at];
  const step = legalActions(s).find((a) => a.kind === "move" && a.target === at);
  const done = play(s, step, s.revision);
  if (!done.ok) throw new Error(done.error);
  return done.state;
}

describe("each resident opens on its own present thing", () => {
  for (const [who, { item, at, lying }] of Object.entries(OPEN_DOOR_LOCKS))
    it(`${who}: shut, opened by ${item} at ${at}, shut again while unmet, held once met`, () => {
      let s = createWorld();
      s.actors.vale.place = far;
      expect(entityActive(s, who)).toBe(false);
      expect(packPeople[who].sealed.at).toBe(at);
      // The box at its post says what opens it, in the rules' own words.
      const look = structuredClone(s);
      look.actors.vale.place = at;
      expect(lockWords(look, who, () => true)).toMatch(
        new RegExp(`^Bring ${packThings[item].name}`),
      );
      // Its thing arrives with nobody there: it opens by itself.
      s = wait(put(s, item, at));
      expect(entityActive(s, who)).toBe(true);
      // Its thing leaves before anyone has met it: it shuts again.
      s.items[item].holder = far;
      s = wait(s);
      expect(entityActive(s, who)).toBe(false);
      expect(s.actors[who].place).toBe(at);
      // Brought by a traveler, it opens and is met there.
      s = arrive(put(s, item, lying ? at : "vale"), at);
      expect(entityActive(s, who)).toBe(true);
      expect(s.packs["greek-drama"].met[who]).toBeDefined();
      // Met, it stays open with the thing gone, and the save stays sound.
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
        // Taken from him, the bar is down again.
        s.items[key].holder = "greek-courtyard";
        s = wait(s);
        expect(exits(s, from, "vale"), `${key} ${from}`).not.toContain(to);
      }
  });

  it("the urn is Aethra's to make, only while she stands at her altar", () => {
    expect(packThings["greek-ash-urn"].locked).toEqual({
      by: "greek-aethra",
      consumes: ["greek-funeral-cloth", "greek-oil-flask", "greek-olive-branch"],
    });
    expect(packThings["greek-ash-urn"].home).toBe("greek-eleusis");
    expect(packPeople["greek-aethra"].travels).toBe(false);
    expect(packThings["greek-olive-branch"].home).toBe("greek-courtyard");
  });
});

describe("the Open Door checklist, computed from the pack", () => {
  it("gives every key two readers or more", () => {
    const counts = Object.fromEntries(
      OPEN_DOOR_KEYS.map((key) => [key, readersOf(pack, key).length]),
    );
    for (const [key, n] of Object.entries(counts))
      expect(n, key).toBeGreaterThanOrEqual(2);
    // Six keys are read in more than one storyline.
    expect(readersOf(pack, "greek-olive-branch")).toEqual(
      expect.arrayContaining([
        "gate:greek-gate>greek-battlefield",
        "recipe:greek-ash-urn",
        "want:greek-adrastus",
      ]),
    );
  });

  it("reads no flag in any Open Door lock, gate or key", () => {
    const attica = new Set(
      Object.values(OPEN_DOOR_LOCKS).map((l) => l.at),
    );
    const read = [
      ...Object.keys(OPEN_DOOR_LOCKS).flatMap((id) => [
        ...(packPeople[id].requires || []),
        ...(packPeople[id].appearsWhen || []),
      ]),
      ...OPEN_DOOR_KEYS.flatMap((id) => packThings[id].requires || []),
      ...pack.routes
        .filter((r) => attica.has(r.from) || attica.has(r.to) || r.from === "greek-gate")
        .flatMap((r) => r.requires || []),
    ];
    expect(storyConditions(read)).toEqual([]);
    // Nothing in the pack names the old chain's steps.
    expect(JSON.stringify(pack.choices)).not.toMatch(/greek-(open-door|homecoming)-/);
    // The Sacred Way is a road: no gate.
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
    // petition, truce, urn, mourner
    expect(depths["greek-argive-mother"]).toBe(4);
    expect(chain.gate("greek-gate", "greek-battlefield")).toBeLessThanOrEqual(4);
  });

  it("gives everyone in the Open Door cast a want", () => {
    for (const id of OPEN_DOOR_CAST)
      expect(packPeople[id].want ?? packPeople[id].wants, id).toBeTruthy();
    // Each lock is its resident's own: it also latches on meeting them.
    for (const id of Object.keys(OPEN_DOOR_LOCKS))
      expect(
        conditionsIn(packPeople[id].requires).some(
          (c) => c.kind === "met" && c.actor === id,
        ),
        id,
      ).toBe(true);
  });
});

// Wherever one key comes to rest (any place a new world can reach, or a
// Theban's hands), the save stays sound, each Open Door box is open or its
// opener can be fetched, and every place reached still leads home. Reach is
// the open ways now, plus the Theban gate and the sea lane when what opens
// them can be fetched from where the traveler already reaches.
describe("no placement of a key seals a resident or a road", () => {
  const base = createWorld();
  base.crossings["pond-greek-harbor"].discovered = true;
  const places = pack.release.places.filter(
    (id) => !pack.places[id].retired && entityActive(base, id) && id !== "greek-ship",
  );
  const hands = ["vale", "greek-guard", "greek-baker", "greek-creon", "greek-shipmaster"];
  const placeOf = (s, id) => {
    let h = s.items[id].holder;
    while (s.items[h]) h = s.items[h].holder;
    return s.actors[h]?.place ?? h;
  };
  function reach(s, from) {
    const seen = new Set([from]);
    const fetchable = (id) => {
      if (!s.usedUp.includes(id)) return seen.has(placeOf(s, id));
      const lock = packThings[id].locked;
      return Boolean(lock) && seen.has(packThings[id].home) && lock.consumes.every(fetchable);
    };
    for (let grew = true; grew; ) {
      grew = false;
      const add = (to) => {
        if (to && !seen.has(to)) seen.add(to), (grew = true);
      };
      for (const at of [...seen]) {
        s.actors.vale.place = at;
        for (const to of exits(s, at, "vale")) if (to !== "greek-ship") add(to);
      }
      if (["greek-creon-writ", "greek-olive-branch"].some(fetchable)) {
        if (seen.has("greek-gate")) add("greek-battlefield");
        if (seen.has("greek-battlefield")) add("greek-gate");
      }
      // The shade's word, at his hour, opens the Hollow (owner-kept).
      if (seen.has("greek-battlefield")) add("greek-polynices-hollow");
      if (seen.has("greek-piraeus")) add("greek-harbor");
      if (seen.has("greek-harbor") && fetchable("greek-provisions")) add("greek-piraeus");
    }
    return seen;
  }
  const cases = [];
  for (const key of OPEN_DOOR_KEYS)
    for (const holder of [...places, ...hands]) cases.push([key, holder]);

  it(`covers ${OPEN_DOOR_KEYS.length} keys over every reachable place and Theban hand`, () => {
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
      const reached = reach(structuredClone(s), "greek-harbor");
      for (const [who, { item, at }] of Object.entries(OPEN_DOOR_LOCKS)) {
        if (entityActive(s, who)) continue;
        const opener = item === "greek-ash-urn" ? "greek-ash-urn" : item;
        const ok =
          reached.has(at) &&
          (s.usedUp.includes(opener)
            ? packThings[opener].locked.consumes.every((c) => reached.has(placeOf(s, c)))
            : reached.has(placeOf(s, opener)));
        if (!ok) stuck.push(`${key}@${holder}: ${who} sealed`);
      }
      for (const place of ["greek-eleusis", "greek-athens", "greek-colonus", "greek-piraeus", "greek-battlefield"])
        if (!reached.has(place)) stuck.push(`${key}@${holder}: ${place} unreachable`);
      for (const place of reached)
        if (!reach(structuredClone(s), place).has("greek-harbor"))
          stuck.push(`${key}@${holder}: no way home from ${place}`);
    }
    expect(stuck).toEqual([]);
  });
});
