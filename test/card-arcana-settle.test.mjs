import { afterEach, beforeEach, describe, expect, it } from "vitest";
import data from "../v2/card-game/arcana.json" with { type: "json" };
import { resetAvatar } from "../v2/card-game/avatar-reset.mjs";
import {
  deck,
  recordOf,
  settleArcana,
  validArcana,
} from "../v2/card-game/world/arcana.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  humanAvatarIds,
  legalActions,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";

const HERE = "arcanum-0";
const WAITED = "arcanum-1";

function act(s, kind, who = "vale") {
  const action = legalActions(s, who).find((a) => a.kind === kind);
  const result = play(s, action, s.revision, who);
  expect(result.ok).toBe(true);
  return result.state;
}

function shared(s, other) {
  s.sharedVersion = 1;
  s.controlledActors = ["vale", other];
  s.presentActors = ["vale", other];
  s.heldActors = ["vale", other];
  return s;
}

const other = humanAvatarIds.find((id) => id !== "vale");
const residentOf = (s) =>
  Object.keys(s.actors).find((id) => !humanAvatarIds.includes(id));
const waited = {
  kind: "did",
  key: "waited",
  match: { verb: "wait", actorId: "$traveler" },
};

let far;
beforeEach(() => {
  const s = createWorld({ seed: 3 });
  far = legalActions(s, "vale").find((a) => a.kind === "move").target;
  deck.cards = [
    { id: HERE, number: 0, proof: [{ kind: "actor_at", place: far }] },
    {
      id: WAITED,
      number: 1,
      proof: [{ kind: "any", conditions: [waited] }],
      desire: [{ kind: "place", target: "$home", step: { verb: "rest" } }],
    },
  ];
});
afterEach(() => {
  deck.cards = data.cards;
});

describe("settling after a play", () => {
  it("proves the dealt card when a play makes it true, and keeps it", () => {
    let s = createWorld({ seed: 3 });
    expect(s.actors.vale.arcana).toBeUndefined();
    s = act(s, "move");
    expect(s.actors.vale.place).toBe(far);
    expect(s.actors.vale.arcana).toEqual({ proved: [], did: [], dealt: HERE });
    s = act(s, "wait");
    expect(s.actors.vale.arcana).toEqual({
      proved: [HERE],
      did: [],
      dealt: WAITED,
    });
    s = act(s, "move");
    expect(recordOf(s, "vale").proved).toEqual([HERE]);
  });
  it("latches a did key of the dealt card and outlives the journal", () => {
    let s = act(createWorld({ seed: 3 }), "move");
    s = act(s, "wait");
    expect(recordOf(s, "vale").did).toEqual([]);
    s.log = [];
    s = act(s, "wait");
    expect(s.actors.vale.arcana).toEqual({
      proved: [HERE, WAITED],
      did: ["waited"],
    });
  });
  it("reads no deed for a card not dealt", () => {
    const s = createWorld({ seed: 3 });
    s.actors.vale.arcana = { proved: [], did: [], dealt: HERE };
    s.log.push({ seq: 1, verb: "wait", actorId: "vale" });
    settleArcana(s, "vale");
    expect(recordOf(s, "vale").did).toEqual([]);
  });
  it("does not count a generated line or another actor's line", () => {
    const s = createWorld({ seed: 3 });
    s.actors.vale.arcana = { proved: [HERE], did: [], dealt: WAITED };
    s.log.push(
      { seq: 1, verb: "wait", actorId: "vale", generated: true },
      { seq: 2, verb: "wait", actorId: other },
    );
    expect(recordOf(settleArcana(s, "vale"), "vale").did).toEqual([]);
  });
  it("reads with, without and present on a journal line", () => {
    const did = (extra) => [
      { kind: "did", key: "k", match: { verb: ["rest", "wait"] }, ...extra },
    ];
    const proved = (extra, entry) => {
      deck.cards = [{ id: HERE, number: 0, proof: did(extra) }];
      const s = createWorld({ seed: 3 });
      s.actors.vale.arcana = { proved: [], did: [], dealt: HERE };
      s.log.push({
        seq: 1,
        verb: "wait",
        actorId: "vale",
        cast: ["vale"],
        ...entry,
      });
      return recordOf(settleArcana(s, "vale"), "vale").proved.length === 1;
    };
    expect(proved({}, {})).toBe(true);
    expect(proved({}, { verb: "move" })).toBe(false);
    expect(proved({ with: ["sleep"] }, {})).toBe(false);
    expect(proved({ with: ["sleep"] }, { sleep: true })).toBe(true);
    expect(proved({ without: ["woke"] }, { woke: "noise" })).toBe(false);
    expect(proved({ without: ["woke"] }, {})).toBe(true);
    expect(proved({ present: ["$traveler"] }, {})).toBe(true);
    expect(proved({ present: ["$traveler"] }, { cast: [] })).toBe(false);
  });
  it("keeps each traveler's record apart", () => {
    let s = shared(createWorld({ seed: 3 }), other);
    s = act(s, "move");
    expect(recordOf(s, "vale").dealt).toBe(HERE);
    expect(recordOf(s, other).dealt).toBe(HERE);
    s = act(s, "wait");
    expect(recordOf(s, "vale").proved).toEqual([HERE]);
    expect(recordOf(s, other).proved).toEqual([]);
    const mine = structuredClone(s.actors.vale.arcana);
    s.actors[other].place = far;
    settleArcana(s, null, s.log.at(-1).seq);
    expect(s.actors[other].arcana).toEqual({
      proved: [HERE],
      did: [],
      dealt: WAITED,
    });
    expect(s.actors.vale.arcana).toEqual(mine);
  });
  it("gives no record to a resident or to an avatar nobody steers", () => {
    const s = act(createWorld({ seed: 3 }), "move");
    const resident = residentOf(s);
    s.actors[resident].place = far;
    s.actors[other].place = far;
    settleArcana(s, resident);
    settleArcana(s);
    expect(recordOf(s, "vale").proved).toEqual([HERE]);
    expect(s.actors[resident].arcana).toBeUndefined();
    expect(s.actors[other].arcana).toBeUndefined();
  });
  it("is gone when the avatar is reset", () => {
    let s = act(act(createWorld({ seed: 3 }), "move"), "wait");
    shared(s, other);
    expect(s.actors.vale.arcana.proved).toEqual([HERE]);
    resetAvatar(s, "vale");
    expect(s.actors.vale.arcana).toBeUndefined();
  });
  it("reads only the lines written since the mark it is given", () => {
    const fresh = () => {
      const s = createWorld({ seed: 3 });
      s.actors.vale.arcana = { proved: [HERE], did: [], dealt: WAITED };
      s.log.push({ seq: 4, verb: "wait", actorId: "vale" });
      return s;
    };
    expect(recordOf(settleArcana(fresh(), "vale", 4), "vale").did).toEqual([]);
    expect(recordOf(settleArcana(fresh(), "vale", 3), "vale").did).toEqual([
      "waited",
    ]);
  });
  it("latches the deed of a held avatar whose holder is away", () => {
    deck.cards = [
      {
        id: WAITED,
        number: 1,
        proof: [{ ...waited, key: "woke", with: ["woke"] }],
        desire: [{ kind: "place", target: "$home", step: { verb: "rest" } }],
      },
    ];
    const asleep = (held) => {
      let s = shared(createWorld({ seed: 3 }), other);
      s.controlledActors = ["vale"];
      s.presentActors = ["vale"];
      s.heldActors = held;
      s.actors[other].arcana = { proved: [], did: [], dealt: WAITED };
      s.actors[other].sleeping = {
        since: s.turn,
        place: s.actors[other].place,
        present: [other],
      };
      for (let i = 0; i < 60 && s.actors[other].sleeping; i++)
        s = act(s, "wait");
      expect(s.actors[other].sleeping).toBeUndefined();
      return s;
    };
    const s = asleep(["vale", other]);
    expect(s.actors[other].arcana).toEqual({
      proved: [],
      did: ["woke"],
      dealt: WAITED,
    });
    s.presentActors.push(other);
    s.controlledActors.push(other);
    s.log = [];
    expect(recordOf(settleArcana(s, other), other).proved).toEqual([WAITED]);
    expect(asleep(["vale"]).actors[other].arcana.did).toEqual([]);
  });
});

describe("the saved record", () => {
  it("is absent in a new world, and a saved one comes back the same", () => {
    const fresh = createWorld({ seed: 3 });
    expect(() => validateWorld(fresh)).not.toThrow();
    expect(recordOf(fresh, "vale")).toEqual({
      proved: [],
      did: [],
      dealt: null,
      base: {},
    });
    expect(fresh.actors.vale.arcana).toBeUndefined();
    const s = act(act(fresh, "move"), "wait");
    const back = decodeSave(encodeSave(s));
    expect(back.actors.vale.arcana).toEqual(s.actors.vale.arcana);
    expect(back.actors.vale.arcana.proved).toEqual([HERE]);
  });
  it("refuses a record of the wrong shape", () => {
    deck.cards = data.cards;
    const withRecord = (who, arcana) => {
      const s = createWorld({ seed: 3 });
      s.actors[who].arcana = arcana;
      return s;
    };
    const good = {
      proved: ["arcanum-0"],
      did: ["k"],
      dealt: "arcanum-2",
      base: { heard: 0 },
    };
    expect(() => validateWorld(withRecord("vale", good))).not.toThrow();
    const done = { proved: ["a", "b"], did: [] };
    expect(() => validateWorld(withRecord("vale", done))).not.toThrow();
    const meal = { proved: [], did: [], dealt: "arcanum-3" };
    expect(() => validateWorld(withRecord("vale", meal))).not.toThrow();
    const resident = residentOf(createWorld({ seed: 3 }));
    expect(validArcana(withRecord(other, good))).toBe(true);
    for (const [who, bad] of [
      ["vale", { ...good, held: [] }],
      ["vale", { ...good, dealt: "arcanum-0" }],
      ["vale", { ...good, dealt: "coin" }],
      ["vale", { ...good, base: undefined }],
      ["vale", { ...good, base: { heard: -1 } }],
      ["vale", { ...good, base: { heard: 0, visited: 0 } }],
      ["vale", { ...meal, base: {} }],
      ["vale", { proved: [], did: [], base: { heard: 0 } }],
      ["vale", { ...good, proved: ["b", "a"] }],
      ["vale", { ...good, proved: ["a", "a", "b"] }],
      ["vale", { ...good, extra: [] }],
      ["vale", { proved: ["a", "b"] }],
      ["vale", { ...good, did: [1] }],
      ["vale", { ...good, did: "k" }],
      ["vale", null],
      [resident, { proved: [], did: [] }],
    ])
      expect(() => validateWorld(withRecord(who, bad))).toThrow();
  });
});
