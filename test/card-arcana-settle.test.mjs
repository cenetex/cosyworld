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
const EMPTY = { proved: [], held: [], did: [] };

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

let far;
beforeEach(() => {
  const s = createWorld({ seed: 3 });
  far = legalActions(s, "vale").find((a) => a.kind === "move").target;
  deck.cards = [
    { id: HERE, number: 0, proof: [{ kind: "actor_at", place: far }] },
    {
      id: WAITED,
      number: 1,
      proof: [
        {
          kind: "any",
          conditions: [
            {
              kind: "did",
              key: "waited",
              match: { verb: "wait", actorId: "$traveler" },
            },
          ],
        },
      ],
    },
  ];
});
afterEach(() => {
  deck.cards = data.cards;
});

describe("settling after a play", () => {
  it("latches a state proof when a play makes it true, and keeps it", () => {
    let s = createWorld({ seed: 3 });
    expect(s.actors.vale.arcana).toBeUndefined();
    s = act(s, "move");
    expect(s.actors.vale.place).toBe(far);
    expect(s.actors.vale.arcana).toEqual({ ...EMPTY, proved: [HERE] });
    s = act(s, "move");
    expect(s.actors.vale.place).not.toBe(far);
    expect(recordOf(s, "vale").proved).toEqual([HERE]);
  });
  it("latches a did key from the journal and outlives the journal", () => {
    let s = act(createWorld({ seed: 3 }), "wait");
    expect(s.actors.vale.arcana).toEqual({
      proved: [WAITED],
      held: [],
      did: ["waited"],
    });
    s.log = [];
    s = act(s, "move");
    s = act(s, "move");
    expect(s.actors.vale.arcana).toEqual({
      proved: [HERE, WAITED],
      held: [],
      did: ["waited"],
    });
  });
  it("does not count a generated line or another actor's line", () => {
    const s = createWorld({ seed: 3 });
    s.log.push(
      { seq: 1, verb: "wait", actorId: "vale", generated: true },
      { seq: 2, verb: "wait", actorId: other },
    );
    expect(settleArcana(s, "vale").actors.vale.arcana).toBeUndefined();
  });
  it("reads with, without and present on a journal line", () => {
    const did = (extra) => [
      { kind: "did", key: "k", match: { verb: ["rest", "wait"] }, ...extra },
    ];
    const proved = (extra, entry) => {
      deck.cards = [{ id: HERE, number: 0, proof: did(extra) }];
      const s = createWorld({ seed: 3 });
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
    expect(recordOf(s, "vale").proved).toEqual([HERE]);
    expect(s.actors[other].arcana).toBeUndefined();
    const mine = structuredClone(s.actors.vale.arcana);
    s.actors[other].place = far;
    settleArcana(s);
    expect(s.actors[other].arcana).toEqual({ ...EMPTY, proved: [HERE] });
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
    let s = act(createWorld({ seed: 3 }), "move");
    shared(s, other);
    expect(s.actors.vale.arcana.proved).toEqual([HERE]);
    resetAvatar(s, "vale");
    expect(s.actors.vale.arcana).toBeUndefined();
  });
  it("gives a reset seat none of the last holder's deeds", () => {
    let s = shared(act(createWorld({ seed: 3 }), "wait"), other);
    expect(recordOf(s, "vale").did).toEqual(["waited"]);
    expect(s.log.some((e) => e.verb === "wait" && e.actorId === "vale")).toBe(
      true,
    );
    resetAvatar(s, "vale");
    s.controlledActors.push("vale");
    s.presentActors.push("vale");
    s.heldActors.push("vale");
    s = act(s, "move");
    expect(recordOf(s, "vale")).toEqual({
      ...EMPTY,
      proved: s.actors.vale.place === far ? [HERE] : [],
    });
  });
  it("reads only the lines written since the mark it is given", () => {
    const s = createWorld({ seed: 3 });
    s.log.push({ seq: 4, verb: "wait", actorId: "vale" });
    expect(settleArcana(s, "vale", 4).actors.vale.arcana).toBeUndefined();
    expect(recordOf(settleArcana(s, "vale", 3), "vale").did).toEqual([
      "waited",
    ]);
  });
  it("latches the deed of a held avatar whose holder is away", () => {
    deck.cards = [
      {
        id: WAITED,
        number: 1,
        proof: [
          {
            kind: "did",
            key: "woke",
            match: { verb: "wait", actorId: "$traveler" },
            with: ["woke"],
          },
        ],
      },
    ];
    const asleep = (held) => {
      let s = shared(createWorld({ seed: 3 }), other);
      s.controlledActors = ["vale"];
      s.presentActors = ["vale"];
      s.heldActors = held;
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
    expect(s.actors[other].arcana).toEqual({ ...EMPTY, did: ["woke"] });
    s.presentActors.push(other);
    s.controlledActors.push(other);
    s.log = [];
    expect(recordOf(settleArcana(s, other), other).proved).toEqual([WAITED]);
    expect(asleep(["vale"]).actors[other].arcana).toBeUndefined();
  });
});

describe("the saved record", () => {
  it("is absent in a new world, and a saved one comes back the same", () => {
    const fresh = createWorld({ seed: 3 });
    expect(() => validateWorld(fresh)).not.toThrow();
    expect(recordOf(fresh, "vale")).toEqual(EMPTY);
    expect(fresh.actors.vale.arcana).toBeUndefined();
    const s = act(act(fresh, "wait"), "move");
    const back = decodeSave(encodeSave(s));
    expect(back.actors.vale.arcana).toEqual(s.actors.vale.arcana);
    expect(back.actors.vale.arcana.proved).toEqual([HERE, WAITED]);
  });
  it("refuses a record of the wrong shape", () => {
    const withRecord = (who, arcana) => {
      const s = createWorld({ seed: 3 });
      s.actors[who].arcana = arcana;
      return s;
    };
    const good = { proved: ["a", "b"], held: ["b"], did: ["k"] };
    expect(() => validateWorld(withRecord("vale", good))).not.toThrow();
    const resident = residentOf(createWorld({ seed: 3 }));
    expect(validArcana(withRecord(other, good))).toBe(true);
    for (const [who, bad] of [
      ["vale", { ...good, held: ["c"] }],
      ["vale", { ...good, proved: ["b", "a"] }],
      ["vale", { ...good, proved: ["a", "a", "b"] }],
      ["vale", { ...good, extra: [] }],
      ["vale", { proved: ["a", "b"], held: ["b"] }],
      ["vale", { ...good, did: [1] }],
      ["vale", { ...good, did: "k" }],
      ["vale", null],
      [resident, EMPTY],
    ])
      expect(() => validateWorld(withRecord(who, bad))).toThrow();
  });
});
