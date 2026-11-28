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
const rear = "behind-station";
const roads = ["pond", rear];
const boardy = "boardyai-parlour";
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
  expect(expected).toEqual([...roads, "train"]);
  expect(decodeSave(encodeSave(s)).stationExitOrder).toEqual(order);
  const old = structuredClone(s);
  delete old.stationExitOrder;
  const first = decodeSave(JSON.stringify(old));
  expect(first.stationExitOrder).toEqual(decodeSave(JSON.stringify(old)).stationExitOrder);
  expect(ways(first)).toEqual(expected);
  for (const key of ["items", "actors", "packs"]) expect(first[key]).toEqual(s[key]);
  old.stationExitOrder = [boardy, "train", "ratiradio-staff-kitchen", "pavilion"];
  expect(decodeSave(JSON.stringify(old)).stationExitOrder).toEqual(order);
  const cook = "ratiradio-rati";
  old.routeKnowledge[cook] = [["ratiradio-staff-kitchen", "station"], ["station", boardy]];
  expect(decodeSave(JSON.stringify(old)).routeKnowledge[cook]).toEqual(
    expect.arrayContaining([
      ["ratiradio-staff-kitchen", rear], [rear, "station"],
      ["station", rear], [rear, boardy],
    ]),
  );
  for (const bad of [null, ["train", "train"], ["pond"], [rear], ["greek-palace"]]) {
    const invalid = structuredClone(s);
    invalid.stationExitOrder = bad;
    expect(() => decodeSave(JSON.stringify(invalid))).toThrow();
  }
});

it("settles a real closing play without displacing another admitted exit", () => {
  let s = fixture();
  for (const item of ["routes", "board"]) open(s, item);
  // Taking the route map keeps it near Station until Vale leaves.
  const take = legalActions(s).find((a) => a.kind === "take" && a.item === "routes");
  expect(take).toBeDefined();
  const taken = play(s, take);
  expect(taken.ok, taken.error).toBe(true);
  s = taken.state;
  expect(ways(s)).toEqual([...roads, "train"]);
  const move = legalActions(s).find((a) => a.kind === "move" && a.target === "pond");
  const moved = play(s, move);
  expect(moved.ok, moved.error).toBe(true);
  expect(ways(moved.state)).toEqual([...roads, "pavilion"]);
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

it("opens the rear Radio door for its key carrier and follows the key", () => {
  let s = fixture();
  const door = "ratiradio-staff-kitchen", key = "ratiradio-station-key";
  s.items[key].holder = "mara";
  open(s, "routes");
  expect(s.stationExitOrder).not.toContain(door);
  expect(ways(s, "mara")).not.toContain(door);
  expect(placeText(s, "station")).not.toMatch(/staff entrance opens|brass lock/);
  s.actors.vale.place = s.actors.mara.place = rear;
  const rearWays = (world, actor = "vale") => exits(world, rear, actor);
  expect(rearWays(s)).not.toContain(door);
  expect(rearWays(s, "mara")).toContain(door);
  expect(placeText(s, rear)).toMatch(/brass lock/);
  const move = legalActions(s, "mara").find((a) => a.kind === "move" && a.target === door);
  const crossed = play(s, move, s.revision, "mara");
  expect(crossed.ok, crossed.error).toBe(true);
  s = crossed.state;
  // The entrance keeps no flag: it follows the key. Mara took it inside, so
  // it lies in the station and Vale may follow; put away, it shuts again.
  expect(s.packs.ratiradio.flags["station-open"]).toBeUndefined();
  expect(rearWays(s)).toContain(door);
  expect(exits(s, door, "mara")).toContain(rear);
  expect(s.stationExitOrder).not.toContain(door);
  s.items[key].holder = "pond";
  expect(rearWays(s)).not.toContain(door);
  s.items[key].holder = "vale";
  expect(rearWays(s)).toContain(door);
  expect(decodeSave(encodeSave(s)).packs.ratiradio.flags["station-open"]).toBeUndefined();
});

it("matches compiled shared rules across presence, marker travel and reopening", async () => {
  const compiled = currentSharedEngine();
  let world = fixture();
  world.actors.vale.place = rear;
  world.actors.mara.place = "pond";
  world.items.routes.holder = "station";
  world.items["boardyai-calling-card"].holder = rear;
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
  const viewAt = (present, actor = "vale") =>
    dispatchShared({ op: "view", world, actor, claimed: ["vale", "mara"], present });
  expect(viewAt(["vale"]).exits).not.toContain(boardy);
  const before = JSON.stringify(world);
  expect(viewAt(["vale", "mara"]).exits).toContain(boardy);
  expect(JSON.stringify(world)).toBe(before);
  step("presence", ["vale", "mara"]);
  expect(world.stationExitOrder).toEqual(["train"]);
  const view = viewAt(["vale", "mara"], "mara");
  step("play", ["vale", "mara"], "mara", view.actions.find((a) => a.kind === "move" && a.target === "station"));
  expect(world.stationExitOrder).toEqual(["train", "pavilion"]);
  step("presence", ["vale"]);
  expect(world.stationExitOrder).toEqual(["train", "pavilion"]);
  step("presence", ["vale", "mara"]);
  expect(world.stationExitOrder).toEqual(["train", "pavilion"]);
});
