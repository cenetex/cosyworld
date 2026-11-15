import { afterEach, describe, expect, it } from "vitest";
import data from "../v2/card-game/arcana.json" with { type: "json" };
import { createPipWorld } from "../v2/card-game/pip-landing.mjs";
import { entityActive, neverBack } from "../v2/card-game/pack-registry.mjs";
import {
  heldOf,
  holdQuest,
  newWant,
  slotsUsed,
} from "../v2/card-game/want.mjs";
import {
  arcanaLevel,
  deck,
  nextSpread,
  recordOf,
  sells,
  spreadOf,
} from "../v2/card-game/world/arcana.mjs";
import { giveUpForGood } from "../v2/card-game/world/for-good.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  places,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";

const FOOL = "arcanum-0";
const WORLD = "arcanum-21";
const middle = data.cards
  .filter((card) => ![0, 21].includes(card.number))
  .map((card) => card.id)
  .sort();
const reload = (s) => decodeSave(encodeSave(s));
const act = (s, pick) => {
  const action = legalActions(s, "vale").find(pick);
  expect(action, "a legal play").toBeTruthy();
  const result = play(s, action, s.revision, "vale");
  expect(result.ok, result.error).toBe(true);
  return result.state;
};
const wait = (s) => act(s, (a) => a.kind === "wait" && !a.sleep && !a.guards);
const talk = (s) => act(s, (a) => a.kind === "talk" && a.target === "listener");
const pay = (s, item) =>
  act(
    s,
    (a) => a.kind === "give" && a.item === item && a.target === "listener",
  );
const discard = (s, tarot) =>
  act(s, (a) => a.kind === "drop" && !a.item && a.tarot === tarot);
const errand = (s, from = "keeper") => {
  holdQuest(
    s,
    "vale",
    newWant("place", s.actors.vale.place, s.turn),
    `quest:from:${from}`,
  );
  return wait(s);
};
const errands = (s, n) => {
  for (let i = 0; i < n; i++) s = errand(s);
  return s;
};
const faces = (s) => spreadOf(s, "vale").map((slot) => slot.face);
const cards = (s) => spreadOf(s, "vale").map((slot) => slot.card);
const foolDone = (s) => {
  for (const item of Object.values(s.items))
    if (item.holder === "vale") item.holder = "pond";
  const fresh = Object.keys(places).filter(
    (id) => !s.actors.vale.visited.includes(id),
  );
  s.actors.vale.visited = [...s.actors.vale.visited, ...fresh.slice(0, 6)];
  return wait(s);
};
const firstVisit = () => {
  let s = act(
    createPipWorld(5),
    (a) => a.kind === "talk" && a.target === "moth",
  );
  s.items.lamp.holder = "vale";
  s = act(
    s,
    (a) => a.kind === "give" && a.item === "lamp" && a.target === "moth",
  );
  s = errands(s, 2);
  expect(recordOf(s, "vale").calls).toBe(3);
  expect(entityActive(s, "listener")).toBe(true);
  return talk(s);
};
const level = (s, n, unlocked = [], extra = {}) => {
  s.actors.vale.upgrades = [...unlocked].sort();
  s.actors.vale.arcana = { proved: [], did: [], level: n, ...extra };
  return s;
};

afterEach(() => {
  deck.cards = data.cards;
});

describe("the Listener's first visit", () => {
  it("comes after three resident quests and gives the Fool face down, free", () => {
    const s = firstVisit();
    expect(spreadOf(s, "vale")).toMatchObject([{ card: FOOL, face: "down" }]);
    expect(recordOf(s, "vale")).toMatchObject({ calls: 0, need: [FOOL] });
    expect(slotsUsed(s.actors.vale)).toBe(1);
    expect(s.actors.vale.upgrades ?? []).not.toContain(FOOL);
    expect(arcanaLevel(s, "vale")).toBe(0);
    expect(entityActive(s, "listener")).toBe(false);
    expect(validateWorld(reload(s))).toBeTruthy();
  });

  it("makes room for the Fool by letting the bottom quest go", () => {
    let s = createPipWorld(5);
    for (const place of ["attic", "station", "forest-cottage"])
      holdQuest(
        s,
        "vale",
        newWant("place", place, s.turn),
        `quest:box:${place}`,
      );
    s.actors.vale.arcana = { proved: [], did: [], calls: 3 };
    s = talk(s);
    expect(heldOf(s.actors.vale)).toHaveLength(2);
    expect(cards(s)).toEqual([FOOL]);
  });
});

describe("the visits after", () => {
  it("tells a Fool done unknowingly, unlocks it, raises the level and opens a sale", () => {
    let s = foolDone(firstVisit());
    expect(spreadOf(s, "vale")).toMatchObject([{ card: FOOL, face: "down" }]);
    expect(s.actors.vale.arcana.spread[0].done).toBe(true);
    expect(arcanaLevel(s, "vale")).toBe(0);
    s = talk(errands(s, 3));
    expect(spreadOf(s, "vale")).toEqual([]);
    expect(s.actors.vale.upgrades).toContain(FOOL);
    expect(arcanaLevel(s, "vale")).toBe(1);
    expect(recordOf(s, "vale").sale).toBe(true);
    expect(sells(s, "vale")).toBe(true);
    const told = s.log.findLast((e) => e.actorId === "listener");
    expect(told).toMatchObject({ kind: "narration", consequence: true });
    expect(told.witnesses).toEqual(["listener", "vale"]);
    expect(told.text).toContain("The Fool");
    expect(validateWorld(reload(s))).toBeTruthy();
  });

  it("turns a Fool not done face up, with no level", () => {
    let s = talk(errands(firstVisit(), 3));
    expect(faces(s)).toEqual(["up"]);
    expect(arcanaLevel(s, "vale")).toBe(0);
    expect(recordOf(s, "vale").sale).toBe(false);
    s = foolDone(s);
    expect(cards(s)).toEqual([]);
    expect(s.actors.vale.upgrades).toContain(FOOL);
    expect(arcanaLevel(s, "vale")).toBe(0);
    s = talk(errands(s, 3));
    expect(arcanaLevel(s, "vale")).toBe(1);
    expect(recordOf(s, "vale").sale).toBe(true);
  });

  it("gives a discarded Fool back free", () => {
    let s = discard(firstVisit(), 0);
    expect(cards(s)).toEqual([]);
    expect(s.log.findLast((e) => e.verb === "drop").itemId).toBeFalsy();
    s = talk(errands(s, 3));
    expect(spreadOf(s, "vale")).toMatchObject([{ card: FOOL, face: "down" }]);
  });
});

describe("a spread bought for a thing", () => {
  const bought = (unlocked) => {
    let s = act(
      createPipWorld(5),
      (a) => a.kind === "talk" && a.target === "moth",
    );
    level(s, 1, unlocked, { sale: true });
    s.items.bell.holder = "vale";
    expect(heldOf(s.actors.vale).map((w) => w.from)).toEqual([
      "quest:from:moth",
    ]);
    return pay(s, "bell");
  };

  it("deals a face-up and a face-down card it knows and a locked one it does not, in place of every quest", () => {
    const known = middle.slice(0, 4);
    const s = bought([FOOL, ...known]);
    expect(faces(s)).toEqual(["up", "down", "locked"]);
    const [up, down, locked] = s.actors.vale.arcana.spread;
    expect(known).toContain(up.card);
    expect(known).toContain(down.card);
    expect(middle.filter((id) => !known.includes(id))).toContain(locked.card);
    expect(recordOf(s, "vale").need).toEqual([up.card, locked.card].sort());
    expect(recordOf(s, "vale").sale).toBe(false);
    expect(heldOf(s.actors.vale)).toEqual([]);
    expect(s.actors.moth.want).toMatchObject({ kind: "item", target: "lamp" });
    expect(s.actors.vale.closed?.["quest:from:moth"]).toBeUndefined();
    expect(neverBack(s, "bell")).toBe(true);
    expect(validateWorld(reload(s))).toBeTruthy();
  });

  it("lets a done card leave its slot, and a resident's quest takes the slot", () => {
    let s = bought([FOOL, "arcanum-12"]);
    expect(cards(s)[0]).toBe("arcanum-12");
    expect(faces(s)).toEqual(["up", "locked"]);
    s = wait(s);
    expect(heldOf(s.actors.vale).map((w) => w.from)).toEqual([
      "quest:from:moth",
    ]);
    s = act(s, (a) => a.kind === "drop" && !a.item && a.quest === 0);
    expect(cards(s)).not.toContain("arcanum-12");
    expect(recordOf(s, "vale").done).toEqual(["arcanum-12"]);
    expect(slotsUsed(s.actors.vale)).toBe(1);
    expect(validateWorld(reload(s))).toBeTruthy();
  });

  it("gives no level for a discarded locked card, and sells a redraw at the next visit", () => {
    let s = bought([FOOL, "arcanum-12"]);
    const [, locked] = cards(s);
    s = discard(s, 1);
    expect(cards(s)).toEqual([]);
    expect(recordOf(s, "vale").done).toEqual(["arcanum-12"]);
    s = talk(errands(s, 3));
    expect(arcanaLevel(s, "vale")).toBe(1);
    expect(recordOf(s, "vale").need).toContain(locked);
    expect(recordOf(s, "vale").sale).toBe(true);
  });
});

describe("what the Listener deals", () => {
  it("never takes a price when nothing would be dealt", () => {
    let s = createPipWorld(5);
    level(s, 21, [...data.cards.map((c) => c.id)], { sale: true });
    s.items.bell.holder = "vale";
    expect(nextSpread(s, "vale")).toEqual([]);
    expect(sells(s, "vale")).toBe(false);
    s = pay(s, "bell");
    expect(s.items.bell.holder).toBe("vale");
    expect(neverBack(s, "bell")).toBe(false);
  });

  it("holds a known card a step harder in the locked slot once all twenty are known", () => {
    const s = level(createPipWorld(5), 5, middle);
    const spread = nextSpread(s, "vale");
    expect(spread.map((slot) => slot.face)).toEqual(["up", "down", "locked"]);
    expect(middle).toContain(spread[2].card);
    expect(spread[2].scale).toBe(2);
    expect(spread[0].scale).toBeUndefined();
    expect(new Set(spread.map((slot) => slot.card)).size).toBe(3);
    const hard = nextSpread(level(createPipWorld(5), 12, middle), "vale");
    expect(hard[0].scale).toBe(2);
    expect(hard[1].scale).toBeUndefined();
    expect(hard[2].scale).toBe(3);
  });

  it("deals the World alone at level twenty, and stops at twenty-one", () => {
    const all = data.cards.map((c) => c.id).filter((id) => id !== WORLD);
    let s = level(createPipWorld(5), 20, all, { sale: true });
    expect(nextSpread(s, "vale")).toEqual([{ card: WORLD, face: "locked" }]);
    s.items.bell.holder = "vale";
    s = pay(s, "bell");
    expect(cards(s)).toEqual([WORLD]);
    s.actors.vale.arcana.spread = [];
    delete s.actors.vale.arcana.spread;
    s.actors.vale.arcana.done = [WORLD];
    s = talk(errands(s, 3));
    expect(arcanaLevel(s, "vale")).toBe(21);
    expect(recordOf(s, "vale").sale).toBe(false);
    s = errands(s, 3);
    expect(recordOf(s, "vale").calls).toBe(3);
    expect(entityActive(s, "listener")).toBe(false);
  });

  it("pins the Devil's thing at the deal and moves it only when it is gone for good", () => {
    deck.cards = data.cards.filter((c) => c.id === "arcanum-15");
    let s = act(
      createPipWorld(5),
      (a) => a.kind === "talk" && a.target === "moth",
    );
    level(s, 1, [], { sale: true });
    s.items.bell.holder = "vale";
    s = pay(s, "bell");
    const pinned = s.actors.vale.arcana.spread[0].bind.thing;
    expect(pinned).toBeTruthy();
    for (const id of Object.keys(s.actors))
      if (s.actors[id].want?.target === pinned) s.actors[id].want = null;
    s = wait(s);
    expect(spreadOf(s, "vale")[0].binding.thing).toBe(pinned);
    giveUpForGood(s, pinned);
    s = wait(s);
    const moved = s.actors.vale.arcana.spread?.[0]?.bind.thing;
    expect(moved).not.toBe(pinned);
    expect(validateWorld(reload(s))).toBeTruthy();
  });
});

describe("a world saved by rules 139", () => {
  it("loads with its dealt card back in the deck, its level kept and its cards unlocked", () => {
    const s = createWorld({ seed: 5 });
    const saved = JSON.parse(encodeSave(s));
    saved.actors.vale.arcana = {
      proved: [FOOL, "arcanum-3"],
      did: ["shared-meal"],
      dealt: "arcanum-5",
      base: { trusting: 0 },
    };
    const loaded = decodeSave(JSON.stringify(saved));
    expect(loaded.actors.vale.arcana).toEqual({
      proved: [FOOL, "arcanum-3"],
      did: ["shared-meal"],
      level: 2,
    });
    expect(loaded.actors.vale.upgrades).toEqual(
      expect.arrayContaining([FOOL, "arcanum-3"]),
    );
    expect(arcanaLevel(loaded, "vale")).toBe(2);
    expect(validateWorld(loaded)).toBe(loaded);
  });
});
