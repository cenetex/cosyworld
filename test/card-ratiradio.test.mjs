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
import { availableCards, sealedReason } from "../v2/card-game/cards.mjs";
import { isLockedBox, lockedQuest } from "../v2/card-game/locked-box.mjs";
import { lockText } from "./helpers/lock-text.mjs";
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
import { newWant, questsOf } from "../v2/card-game/want.mjs";

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
  // This gate/return fixture represents objects already fetched and deposited.
  // Fresh cross-world placement is covered by card-radio-scatter.test.mjs.
  for (const [id, item] of Object.entries(packDefinition("ratiradio").items))
    if (item.scatterOutside) s.items[id].holder = item.holder;
  // The Thermos opens the Listening Room only when set down at the Dispatch
  // Window, so a fetched one waits in the Staff Kitchen instead.
  s.items[id("thermos")].holder = id("staff-kitchen");
  s.actors.vale.place = "pond";
  s.actors.vale.visited.push("pond");
  for (const item of Object.values(s.items))
    if (item.holder === "vale") item.holder = "pond";
  return s;
};
// RATi roams on his own. "gather" stands him beside the traveler, as he is
// when the Listening Room is home, so a journey can Talk with him there.
const gather = (s, who) => {
  s.actors[who].place = s.actors.vale.place;
  return s;
};
const act = (s, kind = "wait", target) => {
  if (kind === "gather") return gather(s, target);
  const action = legalActions(s).find(
    (a) =>
      a.kind === kind &&
      (!target ||
        a.item === target ||
        a.target === target ||
        a.offer === target),
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
  ["take", id("thermos")],
  ["move", id("dispatch-window")],
  ["drop", id("thermos")],
  ["take", id("thermos")],
  ["move", home],
  ["drop", id("red-beanie")],
  ["take", id("raven-figurine")],
  ["gather", rati],
  ["talk", rati],
  ["move", id("broadcast-booth")],
  ["take", id("glass")],
  ["move", home],
  ["drop", id("glass")],
  ["drop", id("raven-figurine")],
];
const arrive = route.findIndex(([kind, to]) => kind === "move" && to === home);

it("walks the full return, introduces both residents at home, then keeps the unlock", () => {
  let s = fixture();
  expect(roamingActors).toEqual(expect.arrayContaining([rati, raven]));
  expect(packPeople[rati]).toMatchObject({ home, levelAtHome: true });
  for (const [step, [kind, target]] of route.entries()) {
    s = act(s, kind, target);
    if (step < arrive) {
      expect(entityActive(s, rati)).toBe(false);
      expect(s.actors[rati].place).toBe(home);
    }
    if (step === arrive) {
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
  expect(s.actors[raven].place).not.toBe(home);
});

it("keeps opening and pack meetings aligned when arrival wakes RATi", () => {
  let s = fixture(true);
  s.opening.crossed = true;
  s.opening.met.moth = 0;
  s.locations.attic.anchored = true;
  for (const [kind, target] of route.slice(0, arrive)) s = act(s, kind, target);
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
  expect(s.items[id("raven-figurine")].holder).toBe("pond");
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
  for (const [kind, target] of route.slice(0, arrive + 1)) s = act(s, kind, target);
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
    if (kind === "gather") {
      gather(world, target);
      continue;
    }
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

// The three doors use three different locks (#2605): a thing held, a thing
// set down, and something heard. Each stays shut under the old condition.
const upTo = (kind, target) =>
  route.slice(0, route.findIndex(([k, t]) => k === kind && t === target) + 1);
const steps = (s, list) => list.reduce((w, [k, t]) => act(w, k, t), s);
const reload = (s) => decodeSave(encodeSave(s));
const canMove = (s, to) =>
  legalActions(s).some((a) => a.kind === "move" && a.target === to && !a.item);
const box = (s, card) => ({
  shown: availableCards(s).includes(card),
  locked: isLockedBox(s, card),
  reason: lockText(s, card),
});

it("draws every locked way and the sealed Raven as a box that says what opens it", () => {
  const s = fixture();
  const expected = [
    ["staff-kitchen", "dispatch-window", /Red Beanie/u],
    ["dispatch-window", "listening-room", /Thermos.*Dispatch Window/u],
    ["listening-room", "broadcast-booth", /Raven Figurine/u],
    ["listening-room", "raven", /Glass.*Listening Room/u],
  ];
  for (const [from, card, reason] of expected) {
    s.actors.vale.place = id(from);
    expect(box(s, id(card)), card).toMatchObject({ shown: true, locked: true });
    expect(box(s, id(card)).reason, card).toMatch(reason);
    expect(lockedQuest(s, id(card), () => true).text, card).toBeTruthy();
  }
  // A self-destination goal names no opening step; what the lock waits on is
  // read from its gate, and unknown cards stay unnamed.
  for (const card of ["listening-room", "broadcast-booth"]) {
    s.actors.vale.place = id(card === "listening-room" ? "dispatch-window" : "listening-room");
    expect(lockedQuest(s, id(card), () => false).text, card).not.toMatch(/Thermos|Raven|Beanie|RATi/u);
  }
});

it("uses three different lock kinds, one per door, in the pack data", () => {
  const pack = packDefinition("ratiradio");
  const door = (flag) =>
    pack.choices.filter((c) => c.effects.some((e) => e.key === flag));
  const kind = (c) =>
    c.on === "talk"
      ? "heard"
      : c.requires.some((r) => r.kind === "item_at")
        ? "placed"
        : "held";
  const kinds = ["dispatch-open", "listening-open", "booth-open"].map((flag) => [
    ...new Set(door(flag).map(kind)),
  ]);
  expect(kinds).toEqual([["held"], ["placed"], ["heard"]]);
  for (const choice of door("booth-open"))
    expect(choice.requires).toContainEqual({
      kind: "holding",
      item: id("raven-figurine"),
      role: "actor",
    });
});

it("opens the Listening Room by setting the Thermos down, not by carrying it", () => {
  let s = steps(fixture(), upTo("move", id("dispatch-window")));
  expect(s.items[id("thermos")].holder).toBe("vale");
  expect(flags(s)["listening-open"]).toBeUndefined();
  expect(canMove(s, home)).toBe(false);
  expect(box(s, home).locked).toBe(true);
  // Waiting beside it, or setting down something else, opens nothing.
  s = act(s);
  s = act(s, "drop", id("red-beanie"));
  s = act(s, "take", id("red-beanie"));
  expect(canMove(s, home)).toBe(false);
  s = act(s, "drop", id("thermos"));
  expect(s.items[id("thermos")].holder).toBe(id("dispatch-window"));
  expect(flags(s)["listening-open"]).toBe(true);
  expect(box(s, home).locked).toBe(false);
  // The way stays open after the Thermos is carried off, and after reload.
  s = reload(act(s, "take", id("thermos")));
  expect(s.items[id("thermos")].holder).toBe("vale");
  expect(canMove(s, home)).toBe(true);
  s = act(s, "move", id("staff-kitchen"));
  s = act(s, "move", id("dispatch-window"));
  expect(canMove(s, home)).toBe(true);
});

it("opens the Broadcast Booth by talking with RATi while holding the figurine", () => {
  let s = steps(fixture(), upTo("move", home));
  s = gather(s, rati);
  s = act(s, "take", id("raven-figurine"));
  // Holding the figurine in RATi's room, or merely waiting, opens nothing.
  s = act(s);
  expect(flags(s)["booth-open"]).toBeUndefined();
  expect(canMove(s, id("broadcast-booth"))).toBe(false);
  // Talking with RATi without the figurine opens nothing either.
  s = act(s, "drop", id("raven-figurine"));
  s = gather(s, rati);
  s = act(s, "talk", rati);
  expect(flags(s)["booth-open"]).toBeUndefined();
  s = act(s, "take", id("raven-figurine"));
  s = gather(s, rati);
  expect(box(s, id("broadcast-booth")).locked).toBe(true);
  s = reload(act(s, "talk", rati));
  expect(flags(s)["booth-open"]).toBe(true);
  expect(box(s, id("broadcast-booth")).locked).toBe(false);
  // The way stays open once the figurine is set down; Raven still waits on
  // her three things.
  s = act(s, "drop", id("raven-figurine"));
  expect(canMove(s, id("broadcast-booth"))).toBe(true);
  expect(entityActive(s, raven)).toBe(false);
});

it("hears the figurine from RATi in any room of the station", () => {
  const start = act(
    steps(fixture(), upTo("move", home)),
    "take",
    id("raven-figurine"),
  );
  for (const path of [[], ["dispatch-window"], ["dispatch-window", "staff-kitchen"]]) {
    let s = structuredClone(start);
    for (const room of path) s = act(s, "move", id(room));
    s = act(gather(s, rati), "talk", rati);
    expect(flags(s)["booth-open"], path.join()).toBe(true);
  }
});

it("does not complete the Thermos door's quest by carrying the Thermos", () => {
  let s = steps(fixture(), upTo("move", id("dispatch-window")));
  s = act(s, "take", `quest:box:${id("listening-room")}`);
  const open = () =>
    questsOf(s, "vale").some((q) => q.target === home);
  expect(open()).toBe(true);
  s = act(s);
  expect(open()).toBe(true);
  expect(flags(s)["listening-open"]).toBeUndefined();
});
