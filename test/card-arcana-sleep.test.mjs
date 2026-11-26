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
const collect = (s) =>
  act(
    s,
    (a) =>
      a.kind === "accept" && a.tarot !== undefined && a.label === "Collect",
  );
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
    s = act(
      s,
      (a, _, all) =>
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
function visit(s) {
  const record = (s.actors.vale.arcana ??= { proved: [], did: [] });
  record.calls = 3;
  s.actors.listener.place = s.actors.vale.place;
  return act(s, (a) => a.kind === "talk" && a.target === "listener");
}
const turnOver = (s) =>
  act(
    s,
    (a) => a.kind === "accept" && a.tarot === 0 && a.label === "Turn over",
  );
function leveledFool(cards) {
  let s = createWorld({ seed: 3 });
  const far = legalActions(s, "vale").find((a) => a.kind === "move").target;
  synthetic(far, cards);
  s = visit(s);
  expect(recordOf(s, "vale").spread).toEqual([{ card: FOOL, face: "down" }]);
  s.actors.vale.place = far;
  settleArcana(s, "vale");
  expect(recordOf(s, "vale").spread[0].done).toBeUndefined();
  s = collect(turnOver(s));
  expect(levelOf(s, "vale")).toBe(1);
  s.actors.vale.place = homeOf("vale");
  return quiet(s);
}

afterEach(() => {
  deck.cards = data.cards;
});

describe("travelers level by cards", () => {
  it("raises the level from 0 to 1 when the unlocked Fool is collected", () => {
    let s = createWorld({ seed: 3 });
    s.actors.vale.place = "pond";
    s = visit(s);
    expect(levelOf(s, "vale")).toBe(0);
    for (const item of Object.values(s.items))
      if (item.holder === "vale") item.holder = "pond";
    const fresh = Object.keys(places).filter(
      (id) => !s.actors.vale.visited.includes(id),
    );
    s.actors.vale.visited = [...s.actors.vale.visited, ...fresh.slice(0, 6)];
    s = wait(s);
    expect(recordOf(s, "vale").spread[0]).toMatchObject({
      card: FOOL,
      face: "down",
    });
    expect(levelOf(s, "vale")).toBe(0);
    s = turnOver(s);
    expect(levelOf(s, "vale")).toBe(0);
    s = collect(s);
    expect(recordOf(s, "vale").proved).toEqual([]);
    expect(s.actors.vale.upgrades).toContain(FOOL);
    expect(levelOf(s, "vale")).toBe(1);
    expect(dreams(s)).toEqual([
      expect.objectContaining({
        kind: "place",
        target: homeOf("vale"),
        step: { verb: "rest" },
      }),
    ]);
    expect(validateWorld(decodeSave(encodeSave(s)))).toBeTruthy();
  });

  it("holds the sleep quest once", () => {
    const s = leveledFool([[0], [1], [2], [21]]);
    expect(dreams(s)).toHaveLength(1);
    expect(sleepQuest(s, "vale", { home: homeOf })).toBeNull();
    expect(dreams(s)).toHaveLength(1);
  });
});

describe("the sleep quest and the dream", () => {
  it("is met by a long rest at home, which dreams a card not yet known", () => {
    let s = leveledFool([[0], [1], [2], [21]]);
    const next = dreamCard(s, "vale");
    expect(["arcanum-1", "arcanum-2"]).toContain(next);
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
    expect(validateWorld(decodeSave(encodeSave(s)))).toBeTruthy();
  });

  it("is not met by a long rest away from home", () => {
    let s = leveledFool([[0], [1], [2], [21]]);
    s.actors.vale.place = "forest-cottage";
    s.items.lamp.holder = "attic";
    s = wait(s);
    for (let i = 0; i < 12 && s.actors.vale.sleeping !== undefined; i++)
      s = act(s, (a) => a.sleep);
    s = act(s, (a) => a.sleep);
    expect(dreams(s)).toHaveLength(1);
    expect(s.actors.vale.glimpse).toBeUndefined();
  });

  it("dreams nothing when no unknown card is left", () => {
    let s = leveledFool([[0], [21]]);
    expect(dreams(s)).toHaveLength(1);
    s = longRest(s);
    expect(dreams(s)).toEqual([]);
    expect(s.actors.vale.glimpse).toBeUndefined();
    const woke = s.log.findLast((e) => e.actorId === "vale" && e.woke);
    expect(woke.dream).toBeUndefined();
  });
});

describe("experience", () => {
  it("never pays a traveler for a met want, a help or a box", () => {
    let s = createPipWorld(5);
    s = act(s, (a) => a.kind === "talk" && a.target === "moth");
    s = act(s, (a) => a.kind === "accept" && a.target === "moth");
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
