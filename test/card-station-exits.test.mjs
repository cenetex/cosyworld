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

it("queues Radio only for its present key carrier and follows the key", () => {
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
  // The entrance keeps no flag: it follows the key, so Vale, who carries none,
  // still has no way in once Mara has crossed and the key is put away.
  expect(s.packs.ratiradio.flags["station-open"]).toBeUndefined();
  s.items[key].holder = "pond";
  settleStationExits(s);
  expect(ways(s, "vale")).not.toContain(door);
  s.items[key].holder = "vale";
  settleStationExits(s);
  expect(ways(s, "vale")).toContain(door);
  expect(decodeSave(encodeSave(s)).packs.ratiradio.flags["station-open"]).toBeUndefined();
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
