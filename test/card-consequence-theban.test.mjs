import { expect, it, vi } from "vitest";
import {
  encodeSave,
  decodeSave,
  legalActions,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { transportPlace } from "../v2/card-game/pack-transport.mjs";
import { currentSharedEngine } from "./fixtures/shared-engine.mjs";
import { g, greekStart } from "./helpers/open-door.mjs";
import { greekTravelTargets } from "./helpers/greek-travel.mjs";
import { nextVoyagePlay } from "./helpers/voyage.mjs";
import { reload } from "./helpers/world-life.mjs";

vi.setConfig({ testTimeout: 120000 });
const pack = "greek-drama",
  hub = "pond",
  inland = "station",
  harbor = g("harbor"),
  ship = g("ship"),
  gate = g("gate"),
  field = g("battlefield"),
  grave = g("polynices-hollow"),
  mourner = g("antigone"),
  shade = g("polynices-shade"),
  writ = g("creon-writ"),
  guard = g("guard");
const errands = [
  ["walk", g("well")],
  ["take", { item: g("water-jar") }],
  ["walk", g("courtyard")],
  ["give", { item: g("water-jar"), target: g("baker") }],
  ["take", { item: g("bread") }],
  ["walk", gate],
  ["trade", { item: g("bread"), receive: g("decree") }],
  ["walk", g("palace")],
  ["trade", { item: g("decree"), receive: writ }],
  ["walk", gate],
  ["give", { item: writ, target: guard }],
  ["take", { item: g("shovel") }],
  ["walk", g("courtyard")],
  ["take", { item: g("oil-flask") }],
  ["walk", g("sanctuary")],
  ["take", { item: g("funeral-cloth") }],
  ["walk", field],
  ["talk", { target: shade }],
];
const rites = [
  [g("oil-flask"), "greek-anoint-polynices", "greek-polynices-anointed"],
  [g("funeral-cloth"), "greek-shroud-polynices", "greek-polynices-veiled"],
  [g("shovel"), "greek-bury-polynices", "greek-burial-performed"],
];
const secondRoad = [
  ["take", { item: "mask" }],
  ["move", { target: "clearing" }],
  ["ring", {}],
  ["move", { target: hub }],
  ["move", { target: ship }],
  ["sail", harbor],
  ["walk", grave],
];
const upgrade = "scarf";
const travelers = ["vale", "mara"];
const local = () => ({
  start: (world) => world,
  actions: (world, actor) => legalActions(world, actor),
  play(world, action, actor, revision = world.revision) {
    const result = play(world, action, revision, actor);
    return { ok: result.ok, world: result.state, error: result.error };
  },
});
function shared() {
  const compiled = currentSharedEngine();
  const seat = { claimed: ["vale"], present: ["vale"] };
  const ask = (world, op, actor, extra = {}) => {
    const request = { ...seat, ...extra, op, actor, world };
    const result = dispatchShared(request);
    expect(JSON.parse(compiled.cardShared(JSON.stringify(request)))).toEqual(
      result,
    );
    return result;
  };
  return {
    seat,
    ask,
    start: (world) =>
      dispatchShared({ op: "create", seed: 17, save: encodeSave(world) }).world,
    actions: (world, actor) =>
      dispatchShared({ ...seat, op: "view", actor, world }).actions,
    play: (world, action, actor, revision = world.revision) =>
      ask(world, "play", actor, { action, revision }),
  };
}
const pick = (source, keys) =>
  Object.fromEntries(keys.map((key) => [key, source?.[key]]));
const carried = (world, actor = "vale") =>
  Object.keys(world.items).filter((id) => world.items[id].holder === actor);
const deed = (world) =>
  structuredClone({
    receipts: world.packs[pack].receipts,
    flags: pick(
      world.packs[pack].flags,
      rites.map((rite) => rite[2]),
    ),
    credits: world.opened,
    latched: world.openedRoutes,
  });
const own = (world, actor) =>
  structuredClone({
    ...pick(world.actors[actor], ["closed", "xp", "level", "upgrades"]),
    credits: Object.keys(world.opened ?? {}).filter((box) =>
      world.opened[box].includes(actor),
    ),
  });
const consequences = (world) => ({
  ...pick(world, ["turn", "crossings"]),
  ...deed(world),
  greek: world.packs[pack],
  vale: own(world, "vale"),
  visited: world.actors.vale.visited,
  ship: world.transports[ship],
  custody: Object.keys(world.items)
    .filter((id) => id.startsWith("greek-"))
    .map((id) => [id, world.items[id].holder]),
});
function keeps(before, next) {
  for (const key of ["receipts", "met"])
    expect(next.packs[pack][key]).toMatchObject(before.packs[pack][key]);
  for (const [, , flag] of rites)
    if (before.packs[pack].flags[flag])
      expect(next.packs[pack].flags[flag]).toBe(true);
  for (const [box, avatars] of Object.entries(before.opened ?? {}))
    expect(next.opened[box]).toEqual(expect.arrayContaining(avatars));
  for (const avatars of Object.values(next.opened ?? {}))
    expect(new Set(avatars).size).toBe(avatars.length);
  for (const route of before.openedRoutes ?? [])
    expect(next.openedRoutes).toContain(route);
  for (const id of travelers) {
    const was = before.actors[id],
      now = next.actors[id];
    expect(now.closed ?? {}).toMatchObject(was.closed ?? {});
    expect(now.visited).toEqual(expect.arrayContaining(was.visited));
    expect(now.xp).toBeGreaterThanOrEqual(was.xp);
    expect(now.upgrades).toEqual(was.upgrades);
  }
}
function witnessedOnlyByWitnesses(world) {
  let checked = 0;
  for (const id of travelers)
    for (const [fact, how] of Object.entries(world.knowledge.known[id] ?? {})) {
      const source = world.knowledge.facts[fact]?.source;
      if (how.kind !== "witnessed" || !source?.witnesses) continue;
      expect(source.witnesses, `${id} ${fact}`).toContain(id);
      checked++;
    }
  return checked;
}
function traveler(engine, world, actor = "vale") {
  const here = () => t.world.actors[actor].place;
  const t = {
    world,
    plays: [],
    find: (kind, fields = {}) =>
      engine
        .actions(t.world, actor)
        .find(
          (a) =>
            a.kind === kind &&
            !a.sleep &&
            !a.guards &&
            Object.entries(fields).every(([key, value]) => a[key] === value),
        ),
    commit(action) {
      const before = t.world,
        frozen = JSON.stringify(before);
      const result = engine.play(before, action, actor);
      expect(result.ok, result.error).toBe(true);
      expect(JSON.stringify(before)).toBe(frozen);
      const next = result.world;
      expect(next.revision).toBe(before.revision + 1);
      validateWorld(structuredClone(next));
      keeps(before, next);
      t.world = reload(next);
      expect(t.world).toEqual(next);
      expect(engine.actions(t.world, actor)).toEqual(
        engine.actions(next, actor),
      );
      t.plays.push(action);
      return t;
    },
    act(kind, fields = {}, limit = 96) {
      if (kind === "walk" || kind === "sail") return t[kind](fields);
      for (let i = 0; i < limit && !t.find(kind, fields); i++)
        t.commit(t.find("wait"));
      const action = t.find(kind, fields);
      const wanted = `${actor} ${kind} ${JSON.stringify(fields)} at ${here()}`;
      expect(action, `${wanted}, turn ${t.world.turn}`).toBeTruthy();
      return t.commit(action);
    },
    sail(dock) {
      for (let i = 0; i < 60 && here() !== dock; i++) {
        const next = nextVoyagePlay(t.world, actor, dock, engine.actions);
        t.act(next.kind, next.target ? { target: next.target } : {}, 0);
      }
      expect(here()).toBe(dock);
      return t;
    },
    walk(place) {
      for (const target of greekTravelTargets(here(), place))
        if (transportPlace(here()) && !t.find("move", { target }))
          t.sail(target);
        else t.act("move", { target });
      return t;
    },
    follow: (steps) => steps.reduce((_, step) => t.act(...step), t),
    retried(action, revision) {
      const before = JSON.stringify(t.world);
      const result = engine.play(t.world, action, actor, revision);
      expect(JSON.stringify(t.world)).toBe(before);
      if (result.ok) {
        expect(deed(result.world)).toEqual(deed(t.world));
        expect(carried(result.world, actor)).toEqual(carried(t.world, actor));
      } else if (result.world)
        expect(JSON.stringify(result.world)).toBe(before);
      return result.ok;
    },
  };
  return t;
}
const journeys = {};
function journey(name) {
  if (journeys[name]) return journeys[name];
  const engine = name === "shared" ? shared() : local();
  const t = traveler(engine, engine.start(greekStart()));
  const at = {},
    riteAction = {};
  const mark = (checkpoint) => (at[checkpoint] = structuredClone(t.world));
  const rite = ([item, receipt, flag], index) => {
    expect(t.world.packs[pack].receipts[receipt]).toBeUndefined();
    t.act("give", { item, target: mourner });
    riteAction[receipt] = t.plays.at(-1);
    expect(t.world.packs[pack].receipts[receipt]).toBe(t.world.turn);
    expect(t.world.packs[pack].flags[flag]).toBe(true);
    expect(t.world.items[item].holder).not.toBe("vale");
    for (const [, later] of rites.slice(index + 1))
      expect(t.world.packs[pack].receipts[later]).toBeUndefined();
  };
  t.follow(errands);
  if (t.find("accept")) t.act("accept");
  t.walk(grave);
  rite(rites[0], 0);
  mark("anointed");
  t.walk(field).walk(grave);
  expect(deed(t.world).receipts).toEqual(deed(at.anointed).receipts);
  expect(t.retried(riteAction[rites[0][1]])).toBe(false);
  rite(rites[1], 1);
  rite(rites[2], 2);
  mark("buried");
  t.walk(harbor);
  mark("leaving");
  t.act("move", { target: ship }).sail(hub);
  mark("hub");
  t.act("move", { target: inland }).act("move", { target: hub });
  t.act("move", { target: ship }).sail(harbor);
  t.walk(grave);
  mark("returned");
  return (journeys[name] = { engine, at, riteAction, plays: t.plays });
}

for (const name of ["local", "shared"])
  it(`buries Polynices once, through reload, retries and the hub (${name})`, () => {
    const { engine, at, riteAction } = journey(name);
    const t = traveler(engine, structuredClone(at.buried));
    const done = deed(at.buried),
      mine = own(at.buried, "vale");
    expect(Object.keys(riteAction)).toEqual(rites.map((rite) => rite[1]));
    expect(Object.values(done.flags)).toEqual(rites.map(() => true));
    const saved = encodeSave(t.world);
    expect(decodeSave(saved)).toEqual(t.world);
    for (const action of Object.values(riteAction)) {
      expect(t.retried(action)).toBe(false);
      expect(t.retried(action, t.world.revision - 1)).toBe(false);
    }
    const offered = engine.actions(t.world, "vale")[0];
    expect(t.retried(offered, t.world.revision - 1)).toBe(false);
    expect(encodeSave(t.world)).toBe(saved);
    t.act("talk", { target: mourner });
    expect(deed(t.world)).toEqual(done);
    const [spade] = rites[2];
    t.act("take", { item: spade });
    expect(t.world.items[spade].holder).toBe("vale");
    expect(deed(t.world)).toEqual(done);
    t.act("give", { item: spade, target: mourner });
    expect(deed(t.world)).toEqual(done);
    for (const [item] of rites)
      if (t.world.items[item].holder !== "vale")
        expect(t.find("give", { item })).toBeUndefined();
    expect(witnessedOnlyByWitnesses(t.world)).toBeGreaterThan(0);
    expect(at.hub.actors.vale.place).toBe(hub);
    expect(at.returned.actors.vale.place).toBe(grave);
    for (const world of [at.leaving, at.hub, at.returned]) {
      expect(deed(world)).toEqual(done);
      expect(own(world, "vale")).toEqual(mine);
      expect(carried(world)).toEqual(carried(at.leaving));
      expect(decodeSave(encodeSave(world))).toEqual(world);
      for (const action of Object.values(riteAction))
        expect(traveler(engine, world).retried(action)).toBe(false);
    }
    const latched = at.returned.openedRoutes;
    expect(latched).toContain(`${field}>${grave}`);
    expect(latched.some((route) => route.endsWith(`>${field}`))).toBe(false);
    const away = traveler(engine, structuredClone(at.leaving)).walk(gate);
    expect(away.world.items[writ].holder).toBe(guard);
    expect(away.find("move", { target: field })).toBeTruthy();
    away.world.items[writ].holder = harbor;
    away.world = reload(away.world);
    expect(away.find("move", { target: field })).toBeUndefined();
  });

it("reaches the same consequences through shared play as through local play", () => {
  const solo = journey("local"),
    table = journey("shared");
  expect(table.plays).toEqual(solo.plays);
  for (const checkpoint of Object.keys(solo.at))
    expect(consequences(table.at[checkpoint]), checkpoint).toEqual(
      consequences(solo.at[checkpoint]),
    );
});

it("shows a second traveler the public deed and none of the first one's own record", () => {
  const { at, riteAction } = journey("shared");
  const engine = shared(),
    both = { claimed: travelers, present: travelers };
  const start = structuredClone(at.returned);
  const done = deed(start),
    first = own(start, "vale");
  const offered = engine.actions(start, "vale")[0];
  expect(traveler(engine, start, "mara").retried(offered)).toBe(false);
  const progress = { upgrades: [upgrade] };
  const joined = engine.ask(start, "join", "mara", { ...both, progress });
  expect(joined.ok, joined.error).toBe(true);
  Object.assign(engine.seat, both);
  expect(deed(joined.world)).toEqual(done);
  expect(own(joined.world, "vale")).toEqual(first);
  const arrived = own(joined.world, "mara");
  expect(arrived).toMatchObject({ upgrades: [upgrade], credits: [] });
  expect(arrived.closed ?? {}).toEqual({});
  const m = traveler(engine, joined.world, "mara").follow(secondRoad);
  expect(m.plays.length).toBeGreaterThanOrEqual(secondRoad.length);
  for (const id of travelers) expect(m.world.actors[id].place).toBe(grave);
  const [spade] = rites[2];
  m.act("take", { item: spade }).act("give", { item: spade, target: mourner });
  for (const action of Object.values(riteAction)) {
    expect(m.retried(action)).toBe(false);
    expect(traveler(engine, m.world, "vale").retried(action)).toBe(false);
  }
  const world = m.world,
    second = own(world, "mara"),
    publicDeed = ["receipts", "flags", "latched"];
  expect(pick(deed(world), publicDeed)).toEqual(pick(done, publicDeed));
  for (const [box, avatars] of Object.entries(done.credits))
    expect(world.opened[box]).toEqual(avatars);
  expect(own(world, "vale")).toEqual(first);
  expect(first.upgrades).toBeUndefined();
  expect([second.upgrades, second.xp]).toEqual([[upgrade], arrived.xp]);
  for (const quest of Object.keys(first.closed))
    expect(second.closed?.[quest]).toBeUndefined();
  expect(world.actors.mara.talked).not.toContain(shade);
  for (const box of second.credits) expect(first.credits).not.toContain(box);
  expect(witnessedOnlyByWitnesses(world)).toBeGreaterThan(0);
  const seen = engine.ask(world, "view", "mara"),
    mine = engine.ask(world, "view", "vale");
  expect(seen.room).toBe(grave);
  expect(deed(seen.world)).toEqual(deed(world));
  const inner = ["innerLife", "reflections", "learning"],
    kept = pick(world.memories.vale, inner);
  expect(Object.values(kept).some((value) => value !== undefined)).toBe(true);
  expect(pick(mine.world.memories.vale, inner)).toEqual(kept);
  expect(pick(seen.world.memories.vale, inner)).toEqual(pick({}, inner));
  engine.seat.present = ["vale"];
  const left = engine.ask(world, "presence", "vale").world;
  const absent = traveler(engine, left, "mara");
  expect(absent.retried(engine.actions(left, "mara")[0])).toBe(false);
  engine.seat.present = travelers;
  const back = engine.ask(left, "presence", "vale").world;
  for (const state of [left, back, reload(back)]) {
    expect(deed(state)).toEqual(deed(world));
    expect(own(state, "mara")).toEqual(second);
    expect(own(state, "vale")).toEqual(first);
    expect(carried(state, "mara")).toEqual(carried(world, "mara"));
  }
  expect(reload(back)).toEqual(back);
  expect(engine.actions(back, "mara")).toEqual(engine.actions(world, "mara"));
});
