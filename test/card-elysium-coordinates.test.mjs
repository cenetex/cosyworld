import { expect, it } from "vitest";
import models from "../v2/card-game/elysium-coordinate-models.json" with { type: "json" };
import { entityActive } from "../v2/card-game/pack-registry.mjs";
import { DAYLIGHT_TURNS } from "../v2/card-game/pack-rules.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { createWorld, encodeSave, legalActions } from "../v2/card-game/world.mjs";
import { act as playAct, reload } from "./helpers/play.mjs";
import {
  coordinateNarrative,
  OBSERVATORY,
  observatoryCoordinates,
} from "../v2/card-game/world/elysium-coordinates.mjs";

const voidRoom = (n) => `elysium-void-${String(n).padStart(3, "0")}`;
const coordinateRooms = [8, 13, 19, 21];
const ledge = "elysium-keystone-ledge";
const spiral = "elysium-gold-spiral";
const wayfinder = "elysium-wayfinder";
const keystone = "elysium-keystone";
const outer = "elysium-ring-outer";
const middle = "elysium-ring-middle";
const inner = "elysium-ring-inner";

const actionFor = (actions, kind, id) => {
  const action = actions.find(
    (choice) =>
      choice.kind === kind && (choice.target === id || choice.item === id),
  );
  expect(action, `${kind} ${id}`).toBeDefined();
  return action;
};
const act = (world, kind, id) =>
  playAct(world, (choice) => choice.kind === kind && (choice.target === id || choice.item === id));
const move = (world, ...places) =>
  places.reduce((next, place) => act(next, "move", place), world);
const take = (world, item) => act(world, "take", item);
const drop = (world, item) => act(world, "drop", item);
const coordinateMoves = (actions) =>
  coordinateRooms.filter((n) =>
    actions.some(
      (action) => action.kind === "move" && action.target === voidRoom(n),
    ),
  );
const atObservatory = (world) => move(world, spiral, OBSERVATORY);

function findStones() {
  let world = createWorld({ seed: 17 });
  world.turn = world.revision = DAYLIGHT_TURNS;
  world.actors.vale.place = "station";
  for (const item of Object.values(world.items))
    if (item.holder === "vale") item.holder = "station";
  world.items[wayfinder].holder = "station";
  expect([outer, middle, inner].map((id) => world.items[id].holder)).toEqual([
    OBSERVATORY,
    spiral,
    ledge,
  ]);

  world = move(take(world, wayfinder), voidRoom(1), ledge);
  world = take(take(world, keystone), inner);
  world = move(drop(move(world, voidRoom(1)), keystone), spiral);
  world = take(drop(world, wayfinder), middle);
  world = act(move(world, OBSERVATORY), "read", "elysium-address-register");
  expect(world.knowledge.known.vale).toHaveProperty([
    "claim:elysium:elysium-address-register:first-address",
  ]);
  world = take(world, outer);
  expect(observatoryCoordinates(world, "vale")).toEqual({
    outer: null,
    middle: null,
    inner: null,
    aligned: false,
  });
  expect(coordinateMoves(legalActions(world))).toEqual([]);
  return world;
}

function placeOuterAndMiddle(world) {
  world = move(
    world,
    spiral,
    voidRoom(1),
    voidRoom(2),
    voidRoom(3),
    voidRoom(5),
  );
  expect(observatoryCoordinates(world, "vale")).toBeNull();
  world = drop(world, outer);
  return drop(move(world, voidRoom(3)), middle);
}

function expectOpening(world, n, address, item) {
  const room = voidRoom(n);
  const receipt = world.elysiumCoordinates[room];
  const dropEvent = world.log.findLast(
    (entry) => entry.verb === "drop" && entry.itemId === item,
  );
  expect(receipt).toEqual({
    model: expect.any(String),
    scenery: expect.any(Number),
    temperament: expect.any(Number),
    openedAt: dropEvent.seq,
  });
  expect(models.models).toContain(receipt.model);
  expect(coordinateNarrative(world, room)).toEqual({
    address,
    room,
    resident: `elysium-coordinate-${String(n).padStart(3, "0")}`,
    model: receipt.model,
    scope: String(world.run.seed),
  });
  expect(entityActive(world, room)).toBe(true);
  return receipt;
}

it("aligns the three stones to open permanent Fibonacci doors through ordinary travel", () => {
  let world = placeOuterAndMiddle(findStones());
  world = drop(move(world, voidRoom(2)), inner);
  expect(world.elysiumCoordinates).toBeUndefined();
  world = atObservatory(move(world, voidRoom(1)));
  expect(observatoryCoordinates(world, "vale")).toEqual({
    outer: 5,
    middle: 3,
    inner: 2,
    aligned: false,
  });
  expect(coordinateMoves(legalActions(world))).toEqual([]);
  expect(entityActive(world, voidRoom(8))).toBe(false);

  world = take(move(world, spiral, voidRoom(1), voidRoom(2)), inner);
  world = drop(move(world, voidRoom(1)), inner);
  const sumGallery = expectOpening(world, 8, [5, 3, 1], inner);
  const first = atObservatory(reload(world));
  expect(observatoryCoordinates(first, "vale")).toEqual({
    outer: 5,
    middle: 3,
    inner: 1,
    aligned: true,
  });
  expect(coordinateMoves(legalActions(first))).toEqual([8]);

  world = atObservatory(take(move(first, spiral, voidRoom(1)), inner));
  expect(observatoryCoordinates(world, "vale")).toEqual({
    outer: 5,
    middle: 3,
    inner: null,
    aligned: false,
  });
  world = drop(move(world, voidRoom(8)), inner);
  expectOpening(world, 13, [5, 3, 8], inner);
  expect(observatoryCoordinates(world, "vale")).toEqual({
    outer: 5,
    middle: 3,
    inner: 8,
    aligned: true,
  });
  expect(coordinateMoves(legalActions(world))).toEqual([13]);
  world = move(world, OBSERVATORY);
  expect(observatoryCoordinates(world, "vale").aligned).toBe(false);
  expect(coordinateMoves(legalActions(world))).toEqual([8]);

  world = take(
    move(world, spiral, voidRoom(1), voidRoom(2), voidRoom(3)),
    middle,
  );
  world = atObservatory(move(world, voidRoom(2), voidRoom(1)));
  world = drop(move(world, voidRoom(8), voidRoom(13)), middle);
  expectOpening(world, 21, [5, 13, 8], middle);
  world = reload(world);
  expect(coordinateMoves(legalActions(world))).toEqual([8, 21]);
  const deep = move(world, voidRoom(21));
  expect(coordinateMoves(legalActions(deep))).toEqual([13]);
  expect(
    move(deep, voidRoom(13), voidRoom(8), OBSERVATORY).actors.vale.place,
  ).toBe(OBSERVATORY);
  expect(world.elysiumCoordinates[voidRoom(8)]).toEqual(sumGallery);
  expect(world.elysiumCoordinates[voidRoom(19)]).toBeUndefined();

  let side = take(
    move(first, spiral, voidRoom(1), voidRoom(2), voidRoom(3)),
    middle,
  );
  side = atObservatory(move(side, voidRoom(2), voidRoom(1)));
  side = drop(move(side, voidRoom(8)), middle);
  expectOpening(side, 19, [5, 8, 1], middle);
  side = reload(side);
  expect(observatoryCoordinates(side, "vale")).toEqual({
    outer: 5,
    middle: 8,
    inner: 1,
    aligned: true,
  });
  expect(coordinateMoves(legalActions(side))).toEqual([19]);
  expect(
    move(side, voidRoom(19), voidRoom(8), OBSERVATORY).actors.vale.place,
  ).toBe(OBSERVATORY);
  expect(Object.keys(side.elysiumCoordinates)).toEqual([
    voidRoom(8),
    voidRoom(19),
  ]);
  expect(Object.keys(first.elysiumCoordinates)).toEqual([voidRoom(8)]);

  world = drop(move(take(world, middle), voidRoom(8)), middle);
  world = move(take(world, inner), OBSERVATORY, spiral, voidRoom(1));
  world = drop(world, inner);
  expectOpening(world, 19, [5, 8, 1], inner);
  world = move(atObservatory(world), voidRoom(8));
  expect(
    legalActions(world)
      .filter(({ kind }) => kind === "move")
      .map(({ target }) => target)
      .sort(),
  ).toEqual([OBSERVATORY, voidRoom(13), voidRoom(19)].sort());
});

it("opens a seeded coordinate for both shared travelers after a committed stone placement", () => {
  const ready = move(
    placeOuterAndMiddle(findStones()),
    voidRoom(2),
    voidRoom(1),
  );
  const solo = drop(ready, inner);
  const seats = ["vale", "mara"];
  const initial = dispatchShared({
    op: "create",
    save: encodeSave(ready),
    seed: 99,
  }).world;
  initial.actors.mara.place = OBSERVATORY;
  const request = (world, actor, op = "view", extra = {}) =>
    dispatchShared({ world, actor, op, claimed: seats, present: seats, ...extra });
  expect(initial.run.seed).toBe(ready.run.seed);
  expect(coordinateMoves(request(initial, "mara").actions)).toEqual([]);
  const action = actionFor(request(initial, "vale").actions, "drop", inner);
  const played = request(initial, "vale", "play", { action });
  expect(played.ok, played.error).toBe(true);
  const { openedAt: soloSeq, ...soloDraw } = expectOpening(
    solo,
    8,
    [5, 3, 1],
    inner,
  );
  const { openedAt: sharedSeq, ...sharedDraw } = expectOpening(
    played.world,
    8,
    [5, 3, 1],
    inner,
  );
  expect(sharedDraw).toEqual(soloDraw);
  expect(soloSeq).toBeGreaterThan(1);
  expect(sharedSeq).toBeGreaterThan(1);

  const saved = request(
    JSON.parse(JSON.stringify(played.world)),
    "mara",
    "validate",
  ).world;
  expect(coordinateMoves(request(saved, "mara").actions)).toEqual([8]);
  const enter = actionFor(request(saved, "mara").actions, "move", voidRoom(8));
  const entered = request(saved, "mara", "play", { action: enter });
  expect(entered.ok, entered.error).toBe(true);
  expect(entered.world.actors.mara.place).toBe(voidRoom(8));
  expect(entered.world.actors.vale.place).toBe(voidRoom(1));
  expect(entered.world.elysiumCoordinates).toEqual(saved.elysiumCoordinates);
});
