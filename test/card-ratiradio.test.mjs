import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it as check } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  plan,
  play,
} from "../v2/card-game/world.mjs";
import { availableCards } from "../v2/card-game/cards.mjs";
import {
  entityActive,
  packPeople,
  packDefinition,
  validatePackDefinition,
} from "../v2/card-game/pack-registry.mjs";
import { DAYLIGHT_TURNS } from "../v2/card-game/pack-rules.mjs";
import * as itemRules from "../v2/card-game/pack-items.mjs";
import { roamingActors } from "../v2/card-game/roaming-routes.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { newWant } from "../v2/card-game/want.mjs";

// This acceptance contract runs only when its pack is mounted.
const it = check.skipIf(!packPeople["ratiradio-rati"]);
const { reservedItem, settleItemCycle } = itemRules;
const id = (name) => `ratiradio-${name}`;
const home = id("listening-room"),
  rati = id("rati"),
  raven = id("raven");
const returns = ["red-beanie", "raven-figurine", "glass"].map(id);
const flags = (s) => s.packs.ratiradio.flags;
const fixture = (opening = false) => {
  const s = createWorld({ opening, seed: 17 });
  s.actors.vale.place = "pond";
  s.actors.vale.visited.push("pond");
  for (const item of Object.values(s.items))
    if (item.holder === "vale") item.holder = "pond";
  return s;
};
const act = (s, kind = "wait", target) => {
  const action = legalActions(s).find(
    (a) =>
      a.kind === kind && (!target || a.item === target || a.target === target),
  );
  expect(action, `${kind} ${target ?? ""}`).toBeDefined();
  const result = play(s, action);
  expect(result.ok, result.error).toBe(true);
  return result.state;
};
const route = [
  ["take", id("station-key")],
  ["move", "station"],
  ["move", id("staff-kitchen")],
  ["drop", id("station-key")],
  ["take", id("red-beanie")],
  ["move", id("dispatch-window")],
  ["take", id("thermos")],
  ["move", home],
  ["drop", id("red-beanie")],
  ["drop", id("thermos")],
  ["take", id("raven-figurine")],
  ["move", id("broadcast-booth")],
  ["take", id("glass")],
  ["move", home],
  ["drop", id("glass")],
  ["drop", id("raven-figurine")],
];

it("walks the full return, introduces both residents at home, then keeps the unlock", () => {
  let s = fixture();
  expect(roamingActors).toEqual(expect.arrayContaining([rati, raven]));
  expect(packPeople[rati]).toMatchObject({ home, levelAtHome: true });
  for (const [step, [kind, target]] of route.entries()) {
    s = act(s, kind, target);
    if (step < 7) {
      expect(entityActive(s, rati)).toBe(false);
      expect(s.actors[rati].place).toBe(home);
    }
    if (step === 7) {
      expect(entityActive(s, rati)).toBe(true);
      expect(s.actors[rati].place).toBe(home);
      expect(availableCards(s)).toContain(raven);
    }
    expect(entityActive(s, raven)).toBe(step === route.length - 1);
    expect(s.actors[raven].place).toBe(home);
    s = decodeSave(encodeSave(s));
  }
  expect(flags(s)).toMatchObject({
    "station-open": true,
    "dispatch-open": true,
    "listening-open": true,
    "booth-open": true,
    "raven-awake": true,
  });
  s = act(s, "take", id("glass"));
  expect(entityActive(s, raven)).toBe(true);
  expect(reservedItem(s, id("glass"))).toBe(false);
  // Waking beside a newly arrived player does not mean departing at once.
  for (let i = 0; i < 3 && s.actors[raven].place === home; i++) s = act(s);
  expect(s.actors[raven].place).not.toBe(home);
});

it("keeps opening and pack meetings aligned when arrival wakes RATi", () => {
  let s = fixture(true);
  s.opening.crossed = true;
  s.opening.met.moth = 0;
  s.locations.attic.anchored = true;
  for (const [kind, target] of route.slice(0, 7)) s = act(s, kind, target);
  expect(s.opening.crossed).toBe(true);
  expect(s.packs.ratiradio.met[rati]).toBeUndefined();
  expect(s.opening.met[rati]).toBeUndefined();
  const before = encodeSave(s);
  s = act(s, "move", home);
  expect(s.actors.vale.place).toBe(home);
  expect(s.packs.ratiradio.met[rati]).toBe(s.turn);
  expect(s.opening.met[rati]).toBe(s.turn);
  expect(decodeSave(encodeSave(s))).toEqual(s);
  expect(decodeSave(before).actors.vale.place).toBe(id("dispatch-window"));
});

it("requires all three direct deposits together, with no RATi presence requirement", () => {
  let s = fixture();
  s.actors.vale.place = home;
  for (const item of returns) s.items[item].holder = "vale";
  s = act(s);
  expect(entityActive(s, raven)).toBe(false);
  for (const item of returns.slice(0, 2)) s.items[item].holder = home;
  s.items[returns[2]].holder = rati;
  s = act(s);
  expect(entityActive(s, raven)).toBe(false);
  s.actors[rati].place = "pond";
  s.items[returns[2]].holder = "vale";
  s = act(s, "drop", returns[2]);
  expect(entityActive(s, raven)).toBe(true);
  expect(flags(s)["booth-open"]).not.toBe(true);
});

it("checks the actual shared traveler, then latches the entrance for everyone", () => {
  let s = dispatchShared({ op: "create", save: encodeSave(fixture()) }).world;
  s.actors.vale.place = s.actors.mara.place = "station";
  s.actors.vale.visited.push("station");
  s.actors.mara.visited.push("station");
  s.items[id("station-key")].holder = "vale";
  const ask = (actor, op = "view", extra = {}) =>
    dispatchShared({
      world: s,
      op,
      actor,
      claimed: ["vale", "mara"],
      present: ["vale", "mara"],
      ...extra,
    });
  const entrance = (actor) =>
    ask(actor).actions.find(
      (a) => a.kind === "move" && a.target === id("staff-kitchen"),
    );
  expect(entrance("mara")).toBeUndefined();
  expect(entrance("vale")).toBeDefined();
  s.items[id("station-key")].holder = "mara";
  expect(entrance("vale")).toBeUndefined();
  const result = ask("mara", "play", { action: entrance("mara") });
  expect(result.ok).toBe(true);
  s = result.world;
  expect(entrance("vale")).toBeDefined();
});

it("preserves loose deposits at dawn, recovers absent custody away from home", () => {
  const s = fixture();
  const dawn = () => settleItemCycle(s, String, () => {});
  s.sharedVersion = 1;
  s.controlledActors = ["vale", "mara"];
  s.presentActors = ["vale"];
  s.turn = DAYLIGHT_TURNS * 2;
  s.items[id("red-beanie")].holder = home;
  dawn();
  expect(s.items[id("red-beanie")].holder).toBe(home);
  expect(s.items[id("glass")].holder).toBe(id("broadcast-booth"));
  for (const item of [id("station-key"), id("raven-figurine")])
    s.items[item].holder = "mara";
  dawn();
  expect(s.items[id("station-key")].holder).toBe("pond");
  expect(s.items[id("raven-figurine")].holder).toBe(id("staff-kitchen"));
  expect(entityActive(s, raven)).toBe(false);
});

it("keeps residents from taking required loose items while humans can retrieve them", () => {
  const s = fixture(),
    item = id("red-beanie");
  flags(s)["rati-awake"] = true;
  s.actors.vale.place = s.actors[rati].place = id("staff-kitchen");
  s.actors[rati].want = newWant("item", item, 0);
  expect(
    legalActions(s).some((a) => a.kind === "take" && a.item === item),
  ).toBe(true);
  expect(plan(s, rati).action).not.toMatchObject({ kind: "take", item });
  expect(s.items[item].holder).toBe(id("staff-kitchen"));
});

it("reports malformed reservation conditions as schema problems", () => {
  const pack = structuredClone(packDefinition("ratiradio"));
  pack.items[id("glass")].reservedUntil = [{ kind: "any", conditions: {} }];
  expect(() => validatePackDefinition(pack)).toThrow(/reservedUntil/u);
});

it("lets a newly active roamer stand down from a standoff", () => {
  let s = fixture();
  for (const [kind, target] of route.slice(0, 8)) s = act(s, kind, target);
  s = act(s, "threaten", rati);
  expect(s.standoffs.some((fight) => Object.hasOwn(fight.resolve, rati))).toBe(true);
  s = act(s);
  expect(s.standoffs.some((fight) => Object.hasOwn(fight.resolve, rati))).toBe(false);
});

it("replays the full shared journal through the compiled rules identically", () => {
  const read = (file) =>
    readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const version = read("v2/scripts/build-card-shared-engine.mjs").match(
    /engine-v\d+\.js/u,
  )[0];
  const sandbox = {
    cardContent: JSON.parse(
      read("v2/orchestrator-rust/src/card_shared/content.json"),
    ),
  };
  runInNewContext(
    read(`v2/orchestrator-rust/src/card_shared/${version}`),
    sandbox,
  );
  const compiled = (request) =>
    JSON.parse(sandbox.cardShared(JSON.stringify(request)));
  const context = { actor: "vale", claimed: ["vale"], present: ["vale"] };
  let world = dispatchShared({
    op: "create",
    save: encodeSave(fixture()),
  }).world;
  for (const [kind, target] of route) {
    const request = { op: "view", world, ...context };
    const action = dispatchShared(request).actions.find(
      (a) => a.kind === kind && (a.item === target || a.target === target),
    );
    expect(action).toBeDefined();
    const command = { ...request, op: "play", action };
    const source = dispatchShared(command),
      replay = compiled(command);
    expect(source.ok, source.error).toBe(true);
    expect(replay).toEqual(source);
    world = JSON.parse(encodeSave(source.world));
  }
  expect(flags(world)["raven-awake"]).toBe(true);
}, 15000);
