import { describe, expect, it } from "vitest";
import { createPipWorld } from "../v2/card-game/pip-landing.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { countResidentQuest, owesGiving } from "../v2/card-game/world/arcana-record.mjs";
import {
  arcanumTerms, candidates, dealSpread, nextSpread, recordOf, sells, takes,
} from "../v2/card-game/world/arcana.mjs";
import { boxDefs } from "../v2/card-game/world/boxes.mjs";
import { giveUpForGood } from "../v2/card-game/world/for-good.mjs";
import {
  createWorld, decodeSave, encodeSave, holdChoice, legalActions, places, play, validateWorld,
} from "../v2/card-game/world.mjs";

const FOOL = "arcanum-0", MAGICIAN = "arcanum-1", PRIESTESS = "arcanum-2";
const reload = (s) => decodeSave(encodeSave(s));
const quiet = (s) => holdChoice(s, "vale", { item: null, revision: s.revision });
const reward = (s) => legalActions(s, "vale").find((a) => a.label === "Collect");
const claim = (s) => {
  const result = play(s, reward(s), s.revision, "vale");
  expect(result.ok, result.error).toBe(true);
  return result.state;
};
const initial = () => {
  const s = createPipWorld(5);
  s.actors.vale.arcana = {
    proved: [], did: [], need: [FOOL],
    spread: [{ card: FOOL, face: "down", base: { visited: s.actors.vale.visited.length } }],
  };
  return s;
};
const helpThree = (s) => {
  for (const id of ["keeper", "moth", "badger"]) countResidentQuest(s.actors.vale, id);
  quiet(s);
  return s;
};
const finishFool = (s) => {
  for (const item of Object.values(s.items))
    if (item.holder === "vale") item.holder = "pond";
  const visited = s.actors.vale.visited;
  visited.push(...Object.keys(places).filter((id) => !visited.includes(id)).slice(0, 6));
  quiet(s);
};

describe("earned tarot rewards", () => {
  it("collects the helper objective quietly without proving the Fool's later deed", () => {
    let s = initial();
    finishFool(s);
    expect(s.actors.vale.arcana.spread[0].done).toBeUndefined();
    s = reload(helpThree(s));
    expect(s.actors.vale.arcana.spread[0]).toMatchObject({ face: "reward" });
    expect(s.actors.vale.upgrades || []).not.toContain(FOOL);
    expect(arcanumTerms(s, "vale", 0)).toEqual([]);
    expect(legalActions(s).some((a) => a.kind === "drop" && a.tarot === 0)).toBe(false);
    const action = reward(s), before = { turn: s.turn, revision: s.revision };
    expect(action).toMatchObject({ kind: "accept", tarot: 0, label: "Collect" });
    expect(action.key).toContain(`:tarot:0:${FOOL}`);
    expect(play(s, action, s.revision - 1).ok).toBe(false);
    s = claim(s);
    expect(s.turn).toBe(before.turn);
    expect(s.revision).toBe(before.revision + 1);
    expect(recordOf(s, "vale")).toMatchObject({ level: 1, proved: [], spread: [], need: [] });
    expect(s.actors.vale.upgrades).toContain(FOOL);
    expect(s.log.slice(-2).map((e) => e.text)).toEqual(["Vale collects The Fool.", "Vale rises a level."]);
    expect(play(s, action, s.revision).ok).toBe(false);
    expect(validateWorld(reload(s))).toBeTruthy();
  });

  it("draws the collected Fool as a fresh canonical quest", () => {
    let s = claim(helpThree(initial()));
    expect(nextSpread(s, "vale")).toContainEqual(expect.objectContaining({ card: FOOL, face: "up" }));
    expect(dealSpread(s, "vale")).toBe(true);
    expect(reward(s)).toBeUndefined();
    finishFool(s);
    expect(s.actors.vale.arcana.spread.find((slot) => slot.card === FOOL)).toMatchObject({ face: "reward", done: true });
    expect(recordOf(s, "vale").proved).not.toContain(FOOL);
    s = claim(s);
    expect(recordOf(s, "vale").proved).toContain(FOOL);
    expect(recordOf(s, "vale").level).toBe(1);
  });

  it("makes the second known card a canonical bonus without another helper gate", () => {
    const s = createPipWorld(5);
    s.actors.vale.upgrades = [FOOL, MAGICIAN, PRIESTESS];
    s.actors.vale.arcana = { proved: [], did: [], level: 2 };
    expect(dealSpread(s, "vale")).toBe(true);
    const bonus = s.actors.vale.arcana.spread.find((slot) => slot.bonus);
    expect(bonus).toMatchObject({ card: MAGICIAN, face: "up", bonus: true });
    expect(recordOf(s, "vale").need).not.toContain(bonus.card);
    expect(s.actors.vale.arcana.spread.filter((slot) => !s.actors.vale.upgrades.includes(slot.card))).toHaveLength(1);
    s.opened = { [boxDefs()[0].id]: ["vale"] };
    quiet(s);
    expect(bonus.face).toBe("reward");
    const after = claim(s);
    expect(recordOf(after, "vale")).toMatchObject({ level: 2, calls: 0, proved: [MAGICIAN] });
    expect(recordOf(after, "vale").need).not.toContain(MAGICIAN);
  });

  it("pins legacy progression before collecting a new canonical proof", () => {
    const s = createPipWorld(5);
    s.actors.vale.upgrades = [FOOL];
    s.actors.vale.arcana = {
      proved: [FOOL], did: [], need: [MAGICIAN],
      spread: [{ card: MAGICIAN, face: "reward", done: true, base: { opened: 0 } }],
    };
    expect(recordOf(claim(s), "vale")).toMatchObject({ level: 2, proved: [FOOL, MAGICIAN], need: [] });
  });

  it("keeps earned rewards despite lost bindings and stale sale state", () => {
    const s = createPipWorld(5), food = candidates(s, "item", "food")[0];
    s.actors.vale.arcana = {
      proved: [], did: [], level: 3, sale: true, need: ["arcanum-3"],
      spread: [{ card: "arcanum-3", face: "reward", done: true, bind: { thing: food, someone: "moth" } }],
    };
    expect(giveUpForGood(s, food)).toBe(true);
    quiet(s);
    const slot = structuredClone(s.actors.vale.arcana.spread[0]);
    expect(sells(s, "vale")).toBe(false);
    expect(nextSpread(s, "vale")).toEqual([]);
    expect(dealSpread(s, "vale")).toBe(false);
    expect(reload(s).actors.vale.arcana.spread).toEqual([slot]);
    const after = claim(s);
    expect(after.actors.vale.arcana.proved).toContain("arcanum-3");
    expect(recordOf(after, "vale")).toMatchObject({ paid: false, spread: [] });
    s.actors.vale.arcana.spread = [{ card: "arcanum-13", face: "reward", done: true }];
    expect(owesGiving(s, "vale")).toBe(false);
    expect(takes(s, "vale")).toBe(false);
  });

  it("keeps one paid draw when its gift also earns a bonus reward", () => {
    let s = createWorld({ seed: 5 });
    s.actors.vale.upgrades = [FOOL, "arcanum-13"];
    s.actors.vale.arcana = {
      proved: [], did: [], level: 2, sale: true,
      spread: [{ card: "arcanum-13", face: "up", bonus: true }],
    };
    s.actors.listener.place = s.actors.vale.place;
    s.items.bell.holder = "vale";
    expect(sells(s, "vale")).toBe(true);
    const gift = legalActions(s, "vale").find((a) =>
      a.kind === "give" && a.target === "listener" && a.item === "bell");
    const given = play(s, gift, s.revision, "vale");
    expect(given.ok, given.error).toBe(true);
    s = reload(given.state);
    expect(recordOf(s, "vale")).toMatchObject({
      paid: true, spread: [{ card: "arcanum-13", face: "reward", bonus: true, done: true }],
    });
    expect(s.usedUp).toContain("bell");
    expect(sells(s, "vale")).toBe(false);
    expect(takes(s, "vale")).toBe(false);
    expect(dealSpread(s, "vale")).toBe(false);
    const turn = s.turn;
    s = claim(s);
    expect(s.turn).toBe(turn);
    expect(recordOf(s, "vale")).toMatchObject({ paid: false, sale: false, level: 2, proved: ["arcanum-13"] });
    expect(recordOf(s, "vale").spread.length).toBeGreaterThan(0);
    expect(recordOf(s, "vale").spread.every((slot) => slot.face !== "reward")).toBe(true);
    const dealt = structuredClone(recordOf(s, "vale").spread);
    quiet(s);
    expect(recordOf(reload(s), "vale").spread).toEqual(dealt);
  });

  it("migrates the 209 Fool screenshot without awarding a level or false proof", () => {
    const old = initial();
    old.actors.vale.upgrades = [FOOL];
    old.actors.vale.arcana.spread[0].face = "up";
    const s = reload(reload(old));
    expect(recordOf(s, "vale")).toMatchObject({ level: null, proved: [], spread: [{ face: "reward" }] });
    expect(s.actors.vale.upgrades).toEqual([FOOL]);
    expect(recordOf(claim(s), "vale")).toMatchObject({ level: 1, proved: [] });
    old.actors.vale.arcana.spread[0].face = "down";
    expect(reload(old).actors.vale.arcana.spread[0]).not.toHaveProperty("bonus");
  });

  it.each([false, true])("migrates a known down slot with canonical completion=%s", (done) => {
    const old = createPipWorld(5);
    old.actors.vale.upgrades = [FOOL, MAGICIAN];
    old.actors.vale.arcana = {
      proved: [FOOL], did: [], level: 2, calls: 2, callers: ["keeper", "moth"],
      need: [MAGICIAN, PRIESTESS],
      spread: [{ card: MAGICIAN, face: "down", base: { opened: 0 }, ...(done ? { done: true } : {}) }],
    };
    const s = reload(old), record = recordOf(s, "vale");
    expect(record).toMatchObject({ level: 2, calls: 2, proved: [FOOL], need: [PRIESTESS] });
    expect(record.spread[0]).toMatchObject({ face: done ? "reward" : "up", bonus: true });
    if (done) expect(recordOf(claim(s), "vale")).toMatchObject({ level: 2, proved: [FOOL, MAGICIAN] });
    else expect(reward(s)).toBeUndefined();
    old.actors.vale.arcana.spread[0] = { card: MAGICIAN, face: "up", base: { opened: 0 } };
    old.actors.vale.arcana.need = [PRIESTESS];
    expect(reload(old).actors.vale.arcana.spread[0]).toMatchObject({ face: "up", bonus: true });
  });

  it("replays shared Collect from the same saved reward and rejects a second claim", () => {
    const context = { actor: "vale", claimed: ["vale"], present: ["vale"] };
    const start = dispatchShared({ op: "create", save: encodeSave(helpThree(initial())) }).world;
    const action = dispatchShared({ ...context, op: "view", world: start }).actions.find((a) => a.label === "Collect");
    const request = { ...context, op: "play", world: start, revision: start.revision, action };
    const first = dispatchShared(request), replay = dispatchShared(JSON.parse(JSON.stringify(request)));
    expect(first.ok).toBe(true);
    expect(replay.world).toEqual(first.world);
    expect(first.world.turn).toBe(start.turn);
    expect(first.world.actors.vale.upgrades).toContain(FOOL);
    const loaded = dispatchShared({ op: "create", save: JSON.stringify(first.world) }).world;
    expect(loaded.actors.vale.arcana.level).toBe(1);
    expect(loaded.actors.vale.arcana.proved).toEqual([]);
    expect(loaded.actors.vale.upgrades || []).not.toContain(FOOL);
    expect(dispatchShared({ ...request, world: loaded, revision: loaded.revision }).ok).toBe(false);
  });
});
