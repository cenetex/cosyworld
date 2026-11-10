import { upgradedItems } from "./fixtures/card-upgraded-items.mjs";
import "./helpers/still-cast.mjs";
import { expect, it } from "vitest";
import { createWorld, decodeSave, encodeSave, exits, legalActions, play, placeText, settleStationExits } from "../v2/card-game/world.mjs";
import { settleHeldItems } from "../v2/card-game/held-item.mjs";
import { seatActors } from "../v2/card-game/human-cast.mjs";
import { currentSharedEngine } from "./fixtures/shared-engine.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
function fixture() {
  const s = createWorld({ seed: 17 });
  s.sharedVersion = 1;
  seatActors(s, ["vale", "mara"], ["vale", "mara"]);
  s.actors.vale.place = s.actors.mara.place = "station";
  s.doors.train = s.doors.pavilion = "station";
  for (const item of ["routes", "board", "boardyai-calling-card"])
    s.items[item].holder = "attic";
  settleStationExits(s);
  settleHeldItems(s);
  return s;
}
const ways = (s, actor = "vale") => exits(s, "station", actor);
const open = (s, item) => {
  s.items[item].holder = "station";
  settleStationExits(s);
};

it("preserves admission through saves, uses a stable simultaneous tie, and migrates old saves", () => {
  const s = fixture();
  for (const item of ["routes", "board", "boardyai-calling-card"])
    s.items[item].holder = "station";
  settleStationExits(s);
  const expected = ways(s), order = [...s.stationExitOrder];
  expect(expected).toHaveLength(3);
  expect(decodeSave(encodeSave(s)).stationExitOrder).toEqual(order);
  const old = structuredClone(s);
  delete old.stationExitOrder;
  const first = decodeSave(JSON.stringify(old));
  expect(first.stationExitOrder).toEqual(decodeSave(JSON.stringify(old)).stationExitOrder);
  expect(ways(first)).toEqual(expected);
  for (const key of ["items", "actors", "packs"]) expect(first[key]).toEqual(s[key]);
  for (const bad of [null, ["train", "train"], ["pond"], ["greek-palace"]]) {
    const invalid = structuredClone(s);
    invalid.stationExitOrder = bad;
    expect(() => decodeSave(JSON.stringify(invalid))).toThrow();
  }
});

it("settles a real closing play without displacing another admitted exit", () => {
  let s = fixture();
  for (const item of ["routes", "boardyai-calling-card", "board"]) open(s, item);
  // Taking the board into Vale's hand keeps it near Station; leaving closes it.
  const take = legalActions(s).find((a) => a.kind === "take" && a.item === "routes");
  expect(take).toBeDefined();
  const taken = play(s, take);
  expect(taken.ok, taken.error).toBe(true);
  s = taken.state;
  expect(ways(s)).toEqual(["pond", "train", "boardyai-parlour"]);
  const move = legalActions(s).find((a) => a.kind === "move" && a.target === "pond");
  const moved = play(s, move);
  expect(moved.ok, moved.error).toBe(true);
  expect(ways(moved.state)).toEqual(["pond", "boardyai-parlour", "pavilion"]);
});

it("shared views do not consume slots or reorder first-open history", () => {
  const s = fixture();
  for (const item of ["boardyai-calling-card", "routes", "board"]) open(s, item);
  const before = JSON.stringify(s);
  for (const actor of ["vale", "mara"])
    expect(dispatchShared({ op: "view", world: s, actor, claimed: ["vale", "mara"], present: ["vale", "mara"] }).world.stationExitOrder)
      .toEqual(s.stationExitOrder);
  ways(s);
  legalActions(s);
  expect(JSON.stringify(s)).toBe(before);
});

it("queues Radio only for its present key carrier and preserves the earned entrance", () => {
  let s = fixture();
  const door = "ratiradio-staff-kitchen", key = "ratiradio-station-key";
  s.items[key].holder = "mara";
  s.actors.mara.place = "pond";
  open(s, "routes");
  open(s, "boardyai-calling-card");
  expect(s.stationExitOrder).not.toContain(door);
  expect(ways(s, "vale")).not.toContain(door);
  s.actors.mara.place = "station";
  const resident = structuredClone(s);
  seatActors(resident, ["vale", "mara"], ["vale"]);
  settleStationExits(resident);
  expect(resident.stationExitOrder).toContain(door);
  settleStationExits(s);
  s.playerActorId = "mara";
  expect(placeText(s, "station")).not.toMatch(/staff entrance opens|brass lock/);
  expect(placeText({ ...s, playerActorId: "vale" }, "station")).not.toMatch(/staff entrance opens|brass lock/);
  expect(s.stationExitOrder).toEqual(["train", "boardyai-parlour", door]);
  expect(ways(s, "mara")).not.toContain(door);
  s.items["boardyai-calling-card"].holder = "attic";
  settleStationExits(s);
  expect(ways(s, "vale")).not.toContain(door);
  expect(ways(s, "mara")).toContain(door);
  const move = legalActions(s, "mara").find((a) => a.kind === "move" && a.target === door);
  const crossed = play(s, move, s.revision, "mara");
  expect(crossed.ok, crossed.error).toBe(true);
  s = crossed.state;
  expect(s.packs.ratiradio.flags["station-open"]).toBe(true);
  s.items[key].holder = "pond";
  settleStationExits(s);
  expect(ways(s, "vale")).toContain(door);
  expect(decodeSave(encodeSave(s)).packs.ratiradio.flags["station-open"]).toBe(true);
});

it("matches compiled shared rules across presence, marker travel and reopening", async () => {
  const compiled = currentSharedEngine();
  let world = fixture();
  world.actors.mara.place = "pond";
  world.items.routes.holder = world.items["boardyai-calling-card"].holder = "station";
  world.items.board.holder = "mara";
  world.stationExitOrder = [];
  const step = (op, present, actor = "vale", action) => {
    const request = { op, world, actor, claimed: ["vale", "mara"], present, ...(action && { action }) };
    const source = dispatchShared(request);
    expect(JSON.parse(compiled.cardShared(JSON.stringify(request)))).toEqual(source);
    world = source.world;
  };
  step("presence", ["vale"]);
  expect(world.stationExitOrder).toEqual(["train"]);
  const before = JSON.stringify(world);
  dispatchShared({ op: "view", world, actor: "vale", claimed: ["vale", "mara"], present: ["vale", "mara"] });
  expect(JSON.stringify(world)).toBe(before);
  step("presence", ["vale", "mara"]);
  expect(world.stationExitOrder).toEqual(["train", "boardyai-parlour"]);
  const view = dispatchShared({ op: "view", world, actor: "mara", claimed: ["vale", "mara"], present: ["vale", "mara"] });
  step("play", ["vale", "mara"], "mara", view.actions.find((a) => a.kind === "move" && a.target === "station"));
  expect(world.stationExitOrder).toEqual(["train", "boardyai-parlour", "pavilion"]);
  step("presence", ["vale"]);
  expect(world.stationExitOrder).toEqual(["train", "pavilion"]);
  step("presence", ["vale", "mara"]);
  expect(world.stationExitOrder).toEqual(["train", "pavilion", "boardyai-parlour"]);
});

for (const revision of [2, 3]) it(`restores Boardy revision ${revision} without moving saved people or possessions`, () => {
  const historical = currentSharedEngine(125);
  const dispatch = (request) => JSON.parse(historical.cardShared(JSON.stringify(request)));
  let s = dispatch({ op: "create" }).world;
  s.actors.mara.place = "station";
  s.items["ratiradio-station-key"].holder = "mara";
  s.items["boardyai-calling-card"].holder = "vale";
  for (const [actor, target] of [["mara", "ratiradio-staff-kitchen"], ["vale", "boardyai-parlour"]]) {
    const membership = { actor, claimed: ["vale", "mara"], present: ["vale", "mara"] };
    const action = dispatch({ op: "view", world: s, ...membership }).actions.find(
      (a) => a.kind === "move" && a.target === target);
    expect(action).toBeDefined();
    const entered = dispatch({ op: "play", world: s, ...membership, action });
    expect(entered.ok, entered.error).toBe(true);
    s = entered.world;
  }
  const old = dispatch({ op: "validate", world: s }).world;
  const door = revision === 3 ? "attic" : "station";
  expect(old.packs.ratiradio.flags["station-open"]).toBe(true);
  old.packs.boardyai.revision = revision;
  if (revision === 2) old.opening.met.moth = 0; // Station-era guests already crossed the pond.
  old.routeKnowledge.vale = [[door, "boardyai-parlour"], ["boardyai-parlour", door], ["pond", "attic"]];
  const expected = structuredClone(old);
  expected.packs.boardyai.revision = 4;
  expected.packs["greek-drama"].revision = 24;
  expected.items = upgradedItems(expected.items, expected);
  expected.crossings["pond-greek-harbor"] = { discovered: expected.crossings["pond-greek-harbor"].discovered };
  expected.packs.ratiradio.revision = 3; // Add the receiver, retaining earned receipts.
  expected.items["ratiradio-portable-radio"] = { holder: "ratiradio-broadcast-booth", history: [] };
  expected.memories["ratiradio-portable-radio"] = { events: [], landmarks: [], text: null, turn: null };
  if (revision === 3) expected.opening.leftHome = true;
  settleStationExits(expected);
  expected.routeKnowledge.vale = [["station", "boardyai-parlour"], ["boardyai-parlour", "station"], ["pond", "attic"]];
  const loaded = decodeSave(JSON.stringify(old));
  for (const [id, actor] of Object.entries(old.actors))
    expect(loaded.actors[id].place, id).toBe(actor.place);
  for (const [id, item] of Object.entries(old.items))
    expect(loaded.items[id].holder, id).toBe(item.holder);
  expect(loaded.items["ratiradio-portable-radio"].radioOn).toBeUndefined();
  expect(loaded).toEqual(expected);
  const compiled = currentSharedEngine();
  expect(JSON.parse(compiled.cardShared(JSON.stringify({ op: "validate", world: old }))).world).toEqual(expected);
  expect(decodeSave(encodeSave(loaded))).toEqual(expected);
  if (revision === 3) {
    const undiscovered = structuredClone(old);
    undiscovered.crossings["station-boardyai-parlour"].discovered = false;
    expect(() => decodeSave(JSON.stringify(undiscovered))).toThrow();
    const invalid = structuredClone(loaded);
    invalid.opening.leftHome = "true";
    expect(() => decodeSave(JSON.stringify(invalid))).toThrow();
  }
  seatActors(loaded, ["vale", "mara"], ["vale"]);
  expect(exits(loaded, "boardyai-parlour", "vale")).toEqual(["station"]);
});
