import { afterEach, describe, expect, it } from "vitest";
import data from "../v2/card-game/arcana.json" with { type: "json" };
import { createPipWorld } from "../v2/card-game/pip-landing.mjs";
import { entityActive, neverBack } from "../v2/card-game/pack-registry.mjs";
import {
  DREAM_FROM,
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
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  nameOf,
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
const askers = ["keeper", "badger", "moth"];
const errands = (s, n) => {
  for (let i = 0; i < n; i++) s = errand(s, askers[i % askers.length]);
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
    act(createPipWorld(5), (a) => a.kind === "talk" && a.target === "moth"),
    (a) => a.kind === "accept" && a.target === "moth",
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
    expect(s.log.findLast((e) => e.actorId === "listener")).toMatchObject({
      text: "The Listener gives Vale a face-down card.",
      consequence: true,
    });
    expect(recordOf(s, "vale")).toMatchObject({ calls: 0, need: [FOOL] });
    expect(slotsUsed(s.actors.vale)).toBe(1);
    expect(s.actors.vale.upgrades ?? []).not.toContain(FOOL);
    expect(arcanaLevel(s, "vale")).toBe(0);
    expect(entityActive(s, "listener")).toBe(false);
    expect(validateWorld(reload(s))).toBeTruthy();
  });

  it("waits for three different residents, not three quests from one", () => {
    let s = createPipWorld(5);
    for (let i = 0; i < 3; i++) s = errand(s, "keeper");
    expect(recordOf(s, "vale")).toMatchObject({ calls: 1, callers: ["keeper"] });
    expect(entityActive(s, "listener")).toBe(false);
    expect(validateWorld(reload(s))).toBeTruthy();
    s = errand(errand(s, "moth"), "badger");
    expect(recordOf(s, "vale")).toMatchObject({
      calls: 3,
      callers: ["badger", "keeper", "moth"],
    });
    expect(entityActive(s, "listener")).toBe(true);
    s = talk(s);
    expect(recordOf(s, "vale")).toMatchObject({ calls: 0, callers: [] });
    expect(s.actors.vale.arcana.callers).toBeUndefined();
  });

  it("loads a record saved before callers were kept", () => {
    const s = createPipWorld(5);
    s.actors.vale.arcana = { proved: [], did: [], calls: 2 };
    const back = errand(reload(s), "keeper");
    expect(recordOf(back, "vale")).toMatchObject({ calls: 3, callers: ["keeper"] });
    expect(entityActive(back, "listener")).toBe(true);
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
    const told = s.log.filter((e) => e.actorId === "listener").slice(-2);
    for (const entry of told) {
      expect(entry).toMatchObject({ kind: "narration", consequence: true });
      expect(entry.witnesses).toEqual(["listener", "vale"]);
    }
    expect(told[0].text).toContain("turns over The Fool");
    expect(told[1].text).toBe("Vale rises a level.");
    expect(told[1].text).not.toMatch(/\d/u);
    expect(validateWorld(reload(s))).toBeTruthy();
  });

  it("turns a Fool not done face up, with no level", () => {
    let s = talk(errands(firstVisit(), 3));
    expect(faces(s)).toEqual(["up"]);
    expect(s.log.findLast((e) => e.actorId === "listener").text).toMatch(
      /^The Listener turns over The Fool, still to do: /u,
    );
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

describe("the Listener's words", () => {
  const turned = (seen) => {
    let s = firstVisit();
    const place = "forest-cottage";
    s.actors.vale.visited = s.actors.vale.visited.filter((id) => id !== place);
    if (seen) s.actors.vale.visited.push(place);
    s.actors.vale.arcana.spread.push({
      card: "arcanum-4",
      face: "down",
      bind: { place },
    });
    s = talk(errands(s, 3));
    expect(faces(s)).toEqual(["up", "up"]);
    return s.log.findLast((e) => e.text.includes("The Emperor")).text;
  };

  it("names a place on a turned card only once the traveler has found it", () => {
    expect(turned(false)).not.toContain(nameOf("forest-cottage"));
    expect(turned(true)).toContain(nameOf("forest-cottage"));
  });
});

describe("a spread bought for a thing", () => {
  const bought = (unlocked) => {
    let s = act(
      act(createPipWorld(5), (a) => a.kind === "talk" && a.target === "moth"),
      (a) => a.kind === "accept" && a.target === "moth",
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
    expect(heldOf(s.actors.vale)).toEqual([]);
    s.actors.moth.place = s.actors.vale.place;
    s = act(act(s, (a) => a.kind === "talk" && a.target === "moth"), (a) => a.kind === "accept");
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

describe("a redraw and a card given up", () => {
  it("deals a different locked card after the last one was discarded", () => {
    let s = createPipWorld(5);
    level(s, 1, [FOOL, "arcanum-12"], { sale: true });
    s.items.bell.holder = "vale";
    s = pay(s, "bell");
    const first = s.actors.vale.arcana.spread.find((slot) => slot.face === "locked");
    s = discard(s, cards(s).indexOf(first.card));
    s = talk(errands(s, 3));
    expect(recordOf(s, "vale").sale).toBe(true);
    s.items.lamp.holder = "vale";
    s = pay(s, "lamp");
    const again = s.actors.vale.arcana.spread.find((slot) => slot.face === "locked");
    expect(again.card).not.toBe(first.card);
    expect(validateWorld(reload(s))).toBeTruthy();
  });

  it("takes a thing for good while the Nameless Card is owed, and that proves it", () => {
    let s = createPipWorld(5);
    level(s, 12, [FOOL, "arcanum-12"], {
      calls: 3,
      need: ["arcanum-13"],
      spread: [{ card: "arcanum-13", face: "locked" }],
    });
    s.items.bell.holder = "vale";
    expect(sells(s, "vale")).toBe(false);
    s = pay(s, "bell");
    expect(neverBack(s, "bell")).toBe(true);
    expect(s.actors.vale.upgrades).toContain("arcanum-13");
    expect(cards(s)).toEqual([]);
    s = talk(s);
    expect(arcanaLevel(s, "vale")).toBe(13);
    expect(recordOf(s, "vale").sale).toBe(true);
    expect(validateWorld(reload(s))).toBeTruthy();
  });

  it("leaves no keeper's hands holding a hub thing given up for good", () => {
    for (const item of ["oil", "cloth"]) {
      let s = createPipWorld(5);
      level(s, 1, [FOOL], { sale: true });
      s.items[item].holder = "vale";
      s = wait(pay(s, item));
      expect(neverBack(s, item)).toBe(true);
      expect(s.items[item].history).toEqual([]);
      expect(s.actors[s.items[item].holder]).toBeUndefined();
      expect(validateWorld(reload(s))).toBeTruthy();
    }
  });
});

describe("the Listener's fetch quests", () => {
  const emptyHanded = (s) => {
    for (const item of Object.values(s.items))
      if (item.holder === "vale") item.holder = "pond";
    return s;
  };
  const fetches = (s) =>
    heldOf(s.actors.vale).filter((w) => w.from?.startsWith("quest:listener:"));

  it("offers three, sharing one slot, beside a dream quest", () => {
    let s = emptyHanded(createPipWorld(5));
    level(s, 1, [FOOL], { sale: true });
    holdQuest(s, "vale", newWant("place", "attic", s.turn), DREAM_FROM);
    s = wait(s);
    expect(fetches(s)).toHaveLength(3);
    expect(heldOf(s.actors.vale).some((w) => w.from === DREAM_FROM)).toBe(true);
    expect(slotsUsed(s.actors.vale)).toBeLessThanOrEqual(3);
    expect(validateWorld(reload(s))).toBeTruthy();
  });

  it("makes room among full slots by letting the bottom quest go", () => {
    let s = emptyHanded(createPipWorld(5));
    level(s, 1, [FOOL], { sale: true });
    for (const place of ["attic", "station", "forest-cottage"])
      holdQuest(s, "vale", newWant("place", place, s.turn), `quest:box:${place}`);
    s = wait(s);
    expect(fetches(s)).toHaveLength(3);
    expect(slotsUsed(s.actors.vale)).toBe(3);
    expect(validateWorld(reload(s))).toBeTruthy();
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

  it("reaches the World on the straight path", () => {
    let s = level(createPipWorld(5), 1, [FOOL]);
    const dealt = new Set();
    for (let i = 0; i < 30 && arcanaLevel(s, "vale") < 21; i++) {
      const spread = nextSpread(s, "vale");
      expect(spread.length).toBeGreaterThan(0);
      const shown = spread.filter((slot) => slot.face !== "down");
      const need = (shown.length ? shown : spread).map((slot) => slot.card).sort();
      for (const id of need) dealt.add(id);
      s.actors.vale.upgrades = [...new Set([...s.actors.vale.upgrades, ...need])].sort();
      Object.assign(s.actors.vale.arcana, { calls: 3, need, done: need });
      delete s.actors.vale.arcana.sale;
      s = talk(s);
    }
    expect(dealt.has(WORLD)).toBe(true);
    expect(arcanaLevel(s, "vale")).toBe(21);
    expect(s.actors.vale.upgrades.filter((id) => id.startsWith("arcanum-"))).toHaveLength(22);
  });

  it("pins the Devil's thing at the deal and moves it only when it is gone for good", () => {
    deck.cards = data.cards.filter((c) => c.id === "arcanum-15");
    let s = act(
      act(createPipWorld(5), (a) => a.kind === "talk" && a.target === "moth"),
      (a) => a.kind === "accept" && a.target === "moth",
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

describe("an imported local save", () => {
  it("brings no cards into the passkey's deck", () => {
    const s = createWorld({ seed: 5 });
    s.actors.vale.upgrades = ["scarf"];
    s.actors.vale.arcana = {
      proved: data.cards.map((card) => card.id).sort(),
      did: [],
    };
    const { world } = dispatchShared({ op: "create", save: encodeSave(s) });
    expect(
      (world.actors.vale.upgrades || []).filter((id) => id.startsWith("arcanum-")),
    ).toEqual([]);
  });
});

describe("a world saved by rules 140", () => {
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
