import { afterEach, describe, expect, it } from "vitest";
import data from "../v2/card-game/arcana.json" with { type: "json" };
import { createPipWorld } from "../v2/card-game/pip-landing.mjs";
import {
  DREAM_FROM,
  heldOf,
  levelOf,
  newWant,
  settleWants,
  sleepQuest,
} from "../v2/card-game/want.mjs";
import {
  deck,
  dreamCard,
  recordOf,
  settleArcana,
} from "../v2/card-game/world/arcana.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  holdChoice,
  homeOf,
  legalActions,
  places,
  play,
  validateWorld,
  wantAPI,
} from "../v2/card-game/world.mjs";

const FOOL = "arcanum-0";
const WORLD = "arcanum-21";
const realWorld = data.cards.find((card) => card.id === WORLD);
const at = (place) => ({ kind: "actor_at", place });
const dreams = (s) =>
  heldOf(s.actors.vale).filter((w) => w.from === DREAM_FROM);
const longRests = (s) =>
  s.log.filter((e) => e.actorId === "vale" && e.rest === "long").length;

function act(s, pick, who = "vale") {
  const action = legalActions(s, who).find(pick);
  expect(action, "a legal play").toBeTruthy();
  const result = play(s, action, s.revision, who);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}
const wait = (s) => act(s, (a) => a.kind === "wait" && !a.sleep);
function quiet(s) {
  for (const id of ["moth", "keeper"])
    Object.assign(s.actors[id], { want: null, content: true, metTurn: s.turn });
  for (const item of Object.values(s.items)) if (item.lit) item.lit = false;
  return s;
}
function longRest(s) {
  const before = longRests(s);
  for (let i = 0; i < 40 && longRests(s) === before; i++)
    s = act(s, (a, _, all) =>
      a.sleep || (a.kind === "wait" && !all.some((b) => b.sleep)),
    );
  expect(longRests(s)).toBe(before + 1);
  return s;
}
function synthetic(far, cards) {
  deck.cards = cards.map(([number, proof, extra]) => ({
    id: `arcanum-${number}`,
    number,
    proof: proof ?? [at(far)],
    ...extra,
  }));
}
function provedFool(cards) {
  const s = createWorld({ seed: 3 });
  const far = legalActions(s, "vale").find((a) => a.kind === "move").target;
  synthetic(far, cards);
  settleArcana(s, "vale");
  expect(recordOf(s, "vale").dealt).toBe(FOOL);
  s.actors.vale.place = far;
  settleArcana(s, "vale");
  expect(recordOf(s, "vale").proved).toEqual([FOOL]);
  s.actors.vale.place = homeOf("vale");
  return quiet(s);
}

afterEach(() => {
  deck.cards = data.cards;
});

describe("travelers level by cards", () => {
  it("raises the level from 0 to 1 when the Fool is proved", () => {
    let s = wait(createWorld({ seed: 3 }));
    expect(recordOf(s, "vale").dealt).toBe(FOOL);
    expect(levelOf(s, "vale")).toBe(0);
    s.actors.vale.place = "pond";
    for (const item of Object.values(s.items))
      if (item.holder === "vale") item.holder = "pond";
    const fresh = Object.keys(places).filter(
      (id) => !s.actors.vale.visited.includes(id),
    );
    s.actors.vale.visited = [...s.actors.vale.visited, ...fresh.slice(0, 6)];
    settleArcana(s, "vale");
    expect(recordOf(s, "vale").proved).toEqual([FOOL]);
    expect(levelOf(s, "vale")).toBe(1);
    expect(recordOf(s, "vale").dealt).not.toBeNull();
    expect(dreams(s)).toEqual([
      expect.objectContaining({
        kind: "place",
        target: homeOf("vale"),
        step: { verb: "rest" },
      }),
    ]);
    expect(validateWorld(decodeSave(encodeSave(s)))).toBeTruthy();
  });

  it("deals the next card with each proof and holds the sleep quest once", () => {
    const s = provedFool([[0], [1], [2], [21]]);
    const far = deck.cards[0].proof[0].place;
    expect(dreams(s)).toHaveLength(1);
    s.actors.vale.place = far;
    settleArcana(s, "vale");
    settleArcana(s, "vale");
    expect(recordOf(s, "vale").proved).toHaveLength(3);
    expect(recordOf(s, "vale").dealt).toBe(WORLD);
    expect(levelOf(s, "vale")).toBe(3);
    expect(dreams(s)).toHaveLength(1);
    expect(sleepQuest(s, "vale", { home: homeOf })).toBeNull();
    expect(dreams(s)).toHaveLength(1);
  });
});

describe("the sleep quest and the dream", () => {
  it("is met by a long rest at home, which dreams the card after the dealt one", () => {
    let s = provedFool([[0], [1], [2], [21]]);
    const dealt = recordOf(s, "vale").dealt;
    const next = dreamCard(s, "vale");
    expect(next).not.toBeNull();
    expect([FOOL, dealt]).not.toContain(next);
    const xp = s.actors.vale.xp;
    s = longRest(s);
    expect(dreams(s)).toEqual([]);
    expect(s.actors.vale.xp).toBe(xp);
    expect(s.actors.vale.glimpse).toEqual({
      level: 3,
      kind: "arcanum",
      id: next,
      at: homeOf("vale"),
    });
    const woke = s.log.findLast((e) => e.actorId === "vale" && e.woke);
    expect(woke).toMatchObject({ rest: "long", dream: "glimpse" });
    expect(recordOf(s, "vale").dealt).toBe(dealt);
    expect(validateWorld(decodeSave(encodeSave(s)))).toBeTruthy();
  });

  it("is not met by a long rest away from home", () => {
    let s = provedFool([[0], [1], [2], [21]]);
    s.actors.vale.place = "forest-cottage";
    s.items.lamp.holder = "attic";
    s = wait(s);
    for (let i = 0; i < 12 && s.actors.vale.sleeping !== undefined; i++)
      s = act(s, (a) => a.sleep);
    s = act(s, (a) => a.sleep);
    expect(dreams(s)).toHaveLength(1);
    expect(s.actors.vale.glimpse).toBeUndefined();
  });

  it("dreams nothing when no undealt card is left", () => {
    let s = provedFool([[0], [21]]);
    expect(recordOf(s, "vale").dealt).toBe(WORLD);
    expect(dreams(s)).toHaveLength(1);
    s = longRest(s);
    expect(dreams(s)).toEqual([]);
    expect(s.actors.vale.glimpse).toBeUndefined();
    const woke = s.log.findLast((e) => e.actorId === "vale" && e.woke);
    expect(woke.dream).toBeUndefined();
  });

  it("raises the level when the World is proved by a rest at home, and deals nothing after", () => {
    let s = provedFool([[0], [21, realWorld.proof, { desire: realWorld.desire }]]);
    expect(recordOf(s, "vale").dealt).toBe(WORLD);
    s = longRest(s);
    expect(recordOf(s, "vale").proved).toEqual([FOOL, WORLD]);
    expect(recordOf(s, "vale").dealt).toBeNull();
    expect(levelOf(s, "vale")).toBe(2);
    expect(dreams(s)).toEqual([]);
    expect(s.actors.vale.glimpse).toBeUndefined();
  });
});

describe("experience", () => {
  it("never pays a traveler for a met want, a help or a box", () => {
    let s = createPipWorld(5);
    s = act(s, (a) => a.kind === "talk" && a.target === "moth");
    s.items.lamp.holder = "vale";
    const xp = s.actors.vale.xp;
    s = act(s, (a) => a.kind === "give" && a.target === "moth");
    expect(s.actors.vale.closed["quest:from:moth"]).toBeTruthy();
    expect(s.actors.vale.xp).toBe(xp);
    const opening = createWorld({ opening: true, seed: 17 });
    const before = opening.actors.vale.xp;
    holdChoice(opening, "vale", { item: null, revision: opening.revision });
    expect(opening.opened).toEqual({ pond: ["vale"] });
    expect(opening.actors.vale.xp).toBe(before);
  });

  it("still pays residents and raises their level", () => {
    const s = createWorld();
    Object.assign(s.actors.keeper, { xp: 2, level: 2 });
    s.actors.keeper.want = newWant("place", s.actors.keeper.place, 0);
    const level = levelOf(s, "keeper");
    settleWants(s, ["keeper"], wantAPI(s));
    expect(s.actors.keeper.xp).toBe(3);
    expect(levelOf(s, "keeper")).toBeGreaterThan(level);
  });
});

describe("a rules 135 world", () => {
  it("loads without the halfway marker, an old glimpse or a held Sleep at home", () => {
    const s = createWorld({ seed: 3 });
    const pond = newWant("place", "pond", 0);
    const saved = JSON.parse(encodeSave(s));
    Object.assign(saved.actors.vale, {
      xp: 0,
      level: 1,
      halfwayIssued: 2,
      glimpse: { level: 2, kind: "place", id: "pond", at: "attic" },
      want: {
        ...newWant("place", "attic", 0),
        quest: { level: 2, left: 1 },
        step: { verb: "rest" },
        from: "quest:level",
      },
      under: [pond],
    });
    const loaded = decodeSave(JSON.stringify(saved));
    const vale = loaded.actors.vale;
    expect(vale.halfwayIssued).toBeUndefined();
    expect(vale.glimpse).toBeUndefined();
    expect(heldOf(vale)).toEqual([pond]);
    expect(vale.under).toBeUndefined();
    expect(levelOf(loaded, "vale")).toBe(0);
    expect(validateWorld(loaded)).toBeTruthy();
  });
});
