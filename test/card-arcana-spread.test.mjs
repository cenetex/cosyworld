import { afterEach, describe, expect, it } from "vitest";
import data from "../v2/card-game/arcana.json" with { type: "json" };
import { createPipWorld } from "../v2/card-game/pip-landing.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { entityActive, neverBack } from "../v2/card-game/pack-registry.mjs";
import { sceneCast } from "../v2/card-game/scene.mjs";
import { sharedDealUnread } from "../v2/card-game/shared.mjs";
import {
  DREAM_FROM,
  heldOf,
  holdQuest,
  newWant,
  slotsUsed,
} from "../v2/card-game/want.mjs";
import {
  arcanaLevel,
  dealSpread,
  deck,
  listenerDeal,
  listenerOffer,
  nextSpread,
  recordOf,
  sells,
  spreadOf,
} from "../v2/card-game/world/arcana.mjs";
import { firstFoolProgress } from "../v2/card-game/world/arcana-record.mjs";
import { giveUpForGood } from "../v2/card-game/world/for-good.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
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
const acceptOffer = (s) => act(s, (a) => a.tarot === "offer");
const give = (s, item) =>
  act(
    s,
    (a) => a.kind === "give" && a.item === item && a.target === "listener",
  );
const pay = (s, item) => acceptOffer(give(s, item));
const discard = (s, tarot) =>
  act(s, (a) => a.kind === "drop" && !a.item && a.tarot === tarot);
const turnover = (s) => act(s, (a) => a.label === "Turn over");
const collect = (s, tarot = 0) =>
  act(s, (a) => a.label === "Collect" && a.tarot === tarot);
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
  it("offers a free face-down card after three resident quests and keeps it until accepted", () => {
    const s = firstVisit();
    expect(spreadOf(s, "vale")).toEqual([]);
    expect(s.log.findLast((e) => e.actorId === "listener")).toMatchObject({
      text: "The Listener offers Vale a face-down card.",
      consequence: true,
    });
    const here = s.actors.vale.place;
    expect(recordOf(s, "vale")).toMatchObject({ calls: 0, need: [], offer: here });
    expect(firstFoolProgress(s, "vale")).toEqual({ count: 3, target: 3, phase: "offered" });
    expect(slotsUsed(s.actors.vale)).toBe(0);
    expect(s.actors.vale.upgrades ?? []).not.toContain(FOOL);
    expect(arcanaLevel(s, "vale")).toBe(0);
    expect(entityActive(s, "listener")).toBe(true);
    expect(narrativeContext(s).speakers).toEqual(["vale", "listener"]);
    expect(sceneCast(s)).toContain("listener");
    const pending = reload(wait(talk(s)));
    expect(sceneCast(pending)).toContain("listener");
    expect(listenerOffer(pending, "vale")).toEqual({
      actorId: "listener", locationId: here, kind: "fool", ready: true,
    });
    const accept = legalActions(pending, "vale").find((a) => a.tarot === "offer");
    expect(accept).toMatchObject({ kind: "accept", target: "listener", label: "Accept card" });
    expect(accept.key).not.toContain(FOOL);
    const accepted = acceptOffer(pending);
    expect(accepted.log.at(-1).listenerEvent).toEqual({ kind: "handover", offer: "fool" });
    expect(spreadOf(accepted, "vale")).toMatchObject([{ card: FOOL, face: "down", turnable: true }]);
    expect(firstFoolProgress(accepted, "vale")).toEqual({ count: 3, target: 3, phase: "dealt" });
    expect(slotsUsed(accepted.actors.vale)).toBe(1);
    expect(listenerOffer(accepted, "vale")).toBeNull();
    expect(play(accepted, accept, accepted.revision, "vale").ok).toBe(false);
    expect(entityActive(accepted, "listener")).toBe(false);
    expect(validateWorld(reload(accepted))).toBeTruthy();
  });

  it("links the reading to its Talk independently of the caption", () => {
    const s = firstVisit();
    const reading = listenerDeal(s, "vale");
    const source = s.log.find((entry) => entry.seq === reading.listenerEvent.sourceSeq);
    expect(reading.listenerEvent).toEqual({ kind: "reading", offer: "fool", sourceSeq: source.seq });
    expect(source).toMatchObject({ verb: "talk", actorId: "vale", targetId: "listener" });
    reading.text = "A short reading at the water's edge.";
    const restored = reload(s);
    expect(listenerDeal(restored, "vale")).toMatchObject({ text: reading.text });
    expect(listenerDeal(restored, "mara")).toBeNull();
    expect(narrativeContext(restored).events).toContain(
      "The Listener gives a short reading and offers a face-down card. Its face stays hidden.",
    );

    reading.text = "The Listener offers Vale a face-down card.";
    reading.listenerEvent.sourceSeq = source.seq - 1;
    expect(listenerDeal(s, "vale")).toBeNull();
    reading.listenerEvent.offer = "spread";
    expect(() => validateWorld(s)).toThrow(expect.objectContaining({
      check: `log:${reading.seq}:listener-event`,
    }));

    delete reading.listenerEvent;
    for (const verb of ["offers", "gives"]) {
      reading.text = `The Listener ${verb} Vale a face-down card.`;
      expect(listenerDeal(reload(s), "vale")).toMatchObject({ text: reading.text });
    }
  });

  it("accepts the Listener's reading in shared play and waits for its last line", () => {
    const s = createWorld({ seed: 5 });
    s.actors.vale.place = "pond";
    s.actors.vale.visited.push("pond");
    s.actors.vale.arcana = { proved: [], did: [], calls: 3 };
    const { world } = dispatchShared({ op: "create", save: encodeSave(s) });
    const request = (world, op, extra) => dispatchShared({
      world, op, actor: "vale", claimed: ["vale"], present: ["vale"], ...extra,
    });
    const action = request(world, "view").actions.find(
      (a) => a.kind === "talk" && a.target === "listener",
    );
    const played = request(world, "play", { action });
    expect(played.world.speechVoices.vale).toEqual(["vale", "listener"]);
    const deal = listenerDeal(played.world, "vale");
    expect(deal).toBeTruthy();
    const offer = request(played.world, "view").actions.find((a) => a.tarot === "offer");
    const visitor = { actor: "mara", claimed: ["vale", "mara"], present: ["vale", "mara"] };
    const sharedRoom = structuredClone(played.world);
    sharedRoom.actors.mara.place = "pond";
    sharedRoom.actors.mara.visited.push("pond");
    const visitorView = request(sharedRoom, "view", visitor);
    expect(visitorView.room).toBe("pond");
    expect(visitorView.actions.some((a) => a.tarot === "offer")).toBe(false);
    expect(request(sharedRoom, "play", { ...visitor, action: offer.key }).ok).toBe(false);
    const { lines, world: spoken } = request(played.world, "speech", {
      room: "pond",
      lines: [
        { actorId: "vale", text: "What have you heard?" },
        { actorId: "listener", text: "Water holds a reflection only while you stand still." },
      ],
    });
    const state = { actor: "vale", queue: [{ actor: "vale", status: "working" }] };
    expect(sharedDealUnread(state, deal, -Infinity, () => false)).toBe(true);
    state.queue = [];
    state.history = [{ actor: "vale", room: "pond", starts_at: 0, lines }];
    expect(sharedDealUnread(state, deal, lines[0].seq, () => true)).toBe(true);
    expect(sharedDealUnread(state, deal, lines[1].seq, () => false)).toBe(true);
    expect(sharedDealUnread(state, deal, lines[1].seq, () => true)).toBe(false);

    const tarotPlay = (world, label) => {
      const action = request(world, "view").actions.find((a) => a.label === label);
      const result = request(world, "play", { action });
      expect(result.ok, result.error).toBe(true);
      expect(result.world.turn).toBe(played.world.turn);
      expect(result.world.speechVoices.vale).toEqual([]);
      return result.world;
    };
    const accepted = tarotPlay(spoken, "Accept card");
    expect(listenerDeal(accepted, "vale")).toBeNull();
    expect(spreadOf(accepted, "vale")).toMatchObject([{ card: FOOL, face: "down", turnable: true }]);
    const turned = tarotPlay(accepted, "Turn over");
    expect(listenerDeal(turned, "vale")).toBeNull();
    const collected = tarotPlay(turned, "Collect");
    expect(collected.actors.vale.upgrades).toContain(FOOL);
  });

  it("waits for three different residents, not three quests from one", () => {
    let s = createPipWorld(5);
    for (let i = 0; i < 3; i++) s = errand(s, "keeper");
    expect(recordOf(s, "vale")).toMatchObject({
      calls: 1,
      callers: ["keeper"],
    });
    expect(entityActive(s, "listener")).toBe(false);
    expect(firstFoolProgress(s, "vale")).toEqual({ count: 1, target: 3, phase: "help" });
    expect(validateWorld(reload(s))).toBeTruthy();
    s = errand(errand(s, "moth"), "badger");
    expect(recordOf(s, "vale")).toMatchObject({
      calls: 3,
      callers: ["badger", "keeper", "moth"],
    });
    expect(entityActive(s, "listener")).toBe(true);
    expect(firstFoolProgress(s, "vale")).toEqual({ count: 3, target: 3, phase: "called" });
    s = talk(s);
    expect(recordOf(s, "vale")).toMatchObject({ calls: 0, callers: [] });
    expect(s.actors.vale.arcana.callers).toBeUndefined();
  });

  it("loads a record saved before callers were kept", () => {
    const s = createPipWorld(5);
    s.actors.vale.arcana = { proved: [], did: [], calls: 2 };
    const back = errand(reload(s), "keeper");
    expect(recordOf(back, "vale")).toMatchObject({
      calls: 3,
      callers: ["keeper"],
    });
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
    expect(heldOf(s.actors.vale)).toHaveLength(3);
    s = acceptOffer(s);
    expect(heldOf(s.actors.vale)).toHaveLength(2);
    expect(cards(s)).toEqual([FOOL]);
  });
});

describe("the face-down card", () => {
  it("collects the unlocked Fool without proving a deed done during acquisition", () => {
    let s = foolDone(acceptOffer(firstVisit()));
    expect(spreadOf(s, "vale")).toMatchObject([{ card: FOOL, face: "down" }]);
    expect(s.actors.vale.arcana.spread[0].done).toBeUndefined();
    const seen = s.log.length;
    s = turnover(s);
    expect(faces(s)).toEqual(["reward"]);
    expect(narrativeContext(s)).toMatchObject({ speakers: [], scenery: false });
    expect(arcanaLevel(s, "vale")).toBe(0);
    s = collect(s);
    expect(spreadOf(s, "vale")).toEqual([]);
    expect(recordOf(s, "vale").proved).toEqual([]);
    expect(s.actors.vale.upgrades).toContain(FOOL);
    expect(arcanaLevel(s, "vale")).toBe(1);
    expect(recordOf(s, "vale")).toMatchObject({ calls: 0, sale: true });
    expect(sells(s, "vale")).toBe(true);
    const told = s.log.slice(seen).filter((e) => e.consequence);
    expect(told).toEqual([
      expect.objectContaining({ text: "Vale turns over The Fool." }),
      expect.objectContaining({ text: "Vale collects The Fool." }),
      expect.objectContaining({
        kind: "narration",
        actorId: "vale",
        witnesses: ["vale"],
        text: "Vale rises a level.",
      }),
    ]);
    expect(validateWorld(reload(s))).toBeTruthy();
  });

  it("collects an unlocked Fool without its later quest or another Listener visit", () => {
    let s = acceptOffer(firstVisit());
    const list = legalActions(s, "vale");
    const turn = list.find((a) => a.label === "Turn over");
    expect(turn).toMatchObject({ kind: "accept", tarot: 0 });
    expect(turn.key).not.toContain(FOOL);
    expect(list.some((a) => a.label === "Collect" || (a.kind === "drop" && a.tarot === 0))).toBe(false);
    expect(s.log.some((e) => e.text.includes("The Fool"))).toBe(false);
    s = turnover(s);
    expect(faces(s)).toEqual(["reward"]);
    expect(firstFoolProgress(s, "vale")).toEqual({ count: 3, target: 3, phase: "revealed" });
    expect(play(s, turn, s.revision, "vale").ok).toBe(false);
    expect(arcanaLevel(s, "vale")).toBe(0);
    expect(recordOf(s, "vale")).toMatchObject({ calls: 0, sale: false });
    expect(entityActive(s, "listener")).toBe(false);
    s = collect(s);
    expect(cards(s)).toEqual([]);
    expect(s.actors.vale.upgrades).toContain(FOOL);
    expect(recordOf(s, "vale").proved).toEqual([]);
    expect(arcanaLevel(s, "vale")).toBe(1);
    expect(recordOf(s, "vale").sale).toBe(true);
    expect(firstFoolProgress(s, "vale")).toBeNull();
  });

  it("keeps saved second-round favors when turning and collecting an old down Fool", () => {
    let s = errands(acceptOffer(firstVisit()), 2);
    const contributed = { calls: 2, callers: ["badger", "keeper"] };
    s = reload(s);
    expect(recordOf(s, "vale")).toMatchObject(contributed);
    expect(firstFoolProgress(s, "vale")).toEqual({ count: 3, target: 3, phase: "dealt" });
    expect(faces(s)).toEqual(["down"]);
    s = collect(reload(turnover(s)));
    expect(recordOf(s, "vale")).toMatchObject({ ...contributed, level: 1 });
  });

  it("does not auto-turn the introductory Fool when later favors unlock a legacy card", () => {
    let s = acceptOffer(firstVisit());
    s.actors.vale.arcana.spread.push({
      card: "arcanum-4",
      face: "down",
      bind: { place: "forest-cottage" },
    });
    s = errands(s, 3);
    expect(faces(s)).toEqual(["down", "reward"]);
    expect(s.log.some((e) => /The Fool|The Emperor/u.test(e.text))).toBe(false);
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

  it("deals a required and a bonus known quest with one unfamiliar locked card", () => {
    const known = [FOOL, ...middle.slice(0, 4)];
    const s = bought(known);
    expect(faces(s)).toEqual(["up", "up", "locked"]);
    const [up, bonus, locked] = s.actors.vale.arcana.spread;
    expect(known).toContain(up.card);
    expect(known).toContain(bonus.card);
    expect(bonus.bonus).toBe(true);
    expect(middle.filter((id) => !known.includes(id))).toContain(locked.card);
    expect(recordOf(s, "vale").need).toEqual([up.card, locked.card].sort());
    expect(recordOf(s, "vale").need).not.toContain(bonus.card);
    expect(
      s.actors.vale.arcana.spread.filter((slot) => !known.includes(slot.card)),
    ).toHaveLength(1);
    expect(recordOf(s, "vale").sale).toBe(false);
    expect(heldOf(s.actors.vale)).toEqual([]);
    expect(s.actors.moth.want).toMatchObject({ kind: "item", target: "lamp" });
    expect(s.actors.vale.closed?.["quest:from:moth"]).toBeUndefined();
    expect(neverBack(s, "bell")).toBe(true);
    expect(validateWorld(reload(s))).toBeTruthy();
  });

  it("lets a done card leave its slot, and a resident's quest takes the slot", () => {
    let s = bought(["arcanum-12"]);
    expect(cards(s)[0]).toBe("arcanum-12");
    expect(faces(s)).toEqual(["up", "locked"]);
    s = wait(s);
    expect(heldOf(s.actors.vale)).toEqual([]);
    s.actors.moth.place = s.actors.vale.place;
    s = act(
      act(s, (a) => a.kind === "talk" && a.target === "moth"),
      (a) => a.kind === "accept",
    );
    expect(heldOf(s.actors.vale).map((w) => w.from)).toEqual([
      "quest:from:moth",
    ]);
    s = act(s, (a) => a.kind === "drop" && !a.item && a.quest === 0);
    expect(recordOf(s, "vale").spread[0]).toMatchObject({
      face: "reward",
      done: true,
    });
    s = collect(s);
    expect(cards(s)).not.toContain("arcanum-12");
    expect(recordOf(s, "vale").done).toEqual(["arcanum-12"]);
    expect(slotsUsed(s.actors.vale)).toBe(1);
    expect(validateWorld(reload(s))).toBeTruthy();
  });

  it("gives no level for a discarded locked card, and sells a redraw at the next visit", () => {
    let s = bought(["arcanum-12"]);
    const [, locked] = cards(s);
    s = discard(s, 1);
    s = collect(s);
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
    level(s, 1, ["arcanum-12"], { sale: true });
    s.items.bell.holder = "vale";
    s = pay(s, "bell");
    const first = s.actors.vale.arcana.spread.find(
      (slot) => slot.face === "locked",
    );
    s = discard(s, cards(s).indexOf(first.card));
    s = collect(s);
    s = talk(errands(s, 3));
    expect(recordOf(s, "vale").sale).toBe(true);
    s.items.lamp.holder = "vale";
    s = pay(s, "lamp");
    const again = s.actors.vale.arcana.spread.find(
      (slot) => slot.face === "locked",
    );
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
    s = give(s, "bell");
    expect(neverBack(s, "bell")).toBe(true);
    expect(recordOf(s, "vale").spread[0]).toMatchObject({
      face: "reward",
      done: true,
    });
    s = collect(s);
    expect(s.actors.vale.upgrades).toContain("arcanum-13");
    expect(cards(s)).toEqual([]);
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
      holdQuest(
        s,
        "vale",
        newWant("place", place, s.turn),
        `quest:box:${place}`,
      );
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
    s = give(s, "bell");
    expect(s.items.bell.holder).toBe("vale");
    expect(neverBack(s, "bell")).toBe(false);
  });

  it("holds a known card a step harder in the locked slot once all twenty are known", () => {
    const s = level(createPipWorld(5), 5, middle);
    const spread = nextSpread(s, "vale");
    expect(spread.map((slot) => slot.face)).toEqual(["up", "up", "locked"]);
    expect(spread[1].bonus).toBe(true);
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
    Object.assign(s.actors.vale.arcana.spread[0], {
      face: "reward",
      done: true,
    });
    s = collect(s);
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
      expect(dealSpread(s, "vale")).toBe(true);
      const spread = s.actors.vale.arcana.spread;
      expect(spread.length).toBeGreaterThan(0);
      const need = spread
        .filter((slot) => !slot.bonus)
        .map((slot) => slot.card)
        .sort();
      for (const id of need) dealt.add(id);
      s.actors.vale.arcana.spread = spread.map((slot) =>
        slot.bonus ? slot : { ...slot, face: "reward", done: true },
      );
      for (const id of need) s = collect(s, cards(s).indexOf(id));
    }
    expect(dealt.has(WORLD)).toBe(true);
    expect(arcanaLevel(s, "vale")).toBe(21);
    expect(
      s.actors.vale.upgrades.filter((id) => id.startsWith("arcanum-")),
    ).toHaveLength(22);
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
      (world.actors.vale.upgrades || []).filter((id) =>
        id.startsWith("arcanum-"),
      ),
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
