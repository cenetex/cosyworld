import { describe, expect, it } from "vitest";
import { createWorld, decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { moveTransport } from "../v2/card-game/pack-transport.mjs";

const humans = ["vale", "mara"];
const room = "greek-ship";
const board = "greek-rhapsode";
function shared() {
  const save = createWorld({ packScopes: { "greek-drama": "full" } });
  const result = dispatchShared({ op: "create", save: JSON.stringify(save) });
  expect(result.ok, result.error).toBe(true);
  const world = result.world;
  world.controlledActors = humans;
  world.crossings["pond-greek-harbor"].discovered = true;
  world.actors.vale.place = room;
  world.actors.mara.place = room;
  world.actors[board].place = "greek-harbor";
  world.transports[room] = {
    version: 2,
    dock: "pond",
    destination: "greek-harbor",
    recall: null,
  };
  return world;
}
const request = (world, actor, op = "view", action) =>
  dispatchShared({
    op,
    world,
    actor,
    claimed: humans,
    present: humans,
    ...(action ? { action } : {}),
  });
function simulateArrival(world) {
  world.actors.vale.place = "greek-harbor";
  moveTransport(world, room, "greek-harbor", ["vale"]);
  expect(world.transports[room].destination).toBe("greek-harbor");
}
function residentBoards(world) {
  world.actors[board].place = room;
  moveTransport(world, "greek-harbor", room, [board]);
}

describe("a shared ship at arrival", () => {
  it("keeps the chosen landing for the remaining human after a resident boards", () => {
    let world = shared();
    const stale = request(world, "mara").actions.find(
      (a) => a.kind === "move" && a.target === "greek-athens-harbor" && !a.item,
    );
    expect(stale).toBeTruthy();
    simulateArrival(world);
    residentBoards(world);
    expect(world.transports[room]).toMatchObject({
      dock: "greek-harbor",
      destination: "greek-harbor",
    });
    delete world.controlledActors;
    world = decodeSave(encodeSave(world));
    const view = request(world, "mara");
    expect(view.ok, view.error).toBe(true);
    expect(
      view.actions.some((a) => a.kind === "move" && a.target === "pond"),
    ).toBe(false);
    const stalePlay = request(world, "mara", "play", stale);
    expect(stalePlay.ok).toBe(false);
    expect(stalePlay.world).toEqual(world);
    const landing = view.actions.find(
      (a) => a.kind === "move" && a.target === "greek-harbor" && !a.item,
    );
    expect(landing).toBeTruthy();
    const arrived = request(world, "mara", "play", landing);
    expect(arrived.ok, arrived.error).toBe(true);
    expect(arrived.world.actors.vale.place).toBe("greek-harbor");
    expect(arrived.world.actors.mara.place).toBe("greek-harbor");
    expect(decodeSave(encodeSave(arrived.world))).toEqual(arrived.world);
  });
  it("lets a human boarding choose a new leg while another person stays aboard", () => {
    const world = shared();
    simulateArrival(world);
    const boarding = request(world, "vale").actions.find(
      (a) => a.kind === "move" && a.target === room && !a.item,
    );
    expect(boarding).toBeTruthy();
    const result = request(world, "vale", "play", boarding);
    expect(result.ok, result.error).toBe(true);
    expect(result.world.transports[room].dock).toBe("greek-harbor");
    expect(result.world.transports[room].destination).toBe("pond");
    expect(
      request(result.world, "mara").actions.some(
        (a) => a.kind === "move" && a.target === "pond",
      ),
    ).toBe(true);
  });
  it("keeps a human-led party's new leg while another human is aboard", () => {
    const world = shared();
    simulateArrival(world);
    world.actors.vale.place = room;
    world.actors[board].place = room;
    moveTransport(world, "greek-harbor", room, ["vale", board]);
    expect(world.transports[room].destination).toBe("pond");
  });
  it("starts a normal solo resident voyage", () => {
    const world = shared();
    world.actors.vale.place = "greek-harbor";
    world.actors.mara.place = "pond";
    world.transports[room] = {
      version: 2,
      dock: "greek-harbor",
      destination: null,
      recall: null,
    };
    residentBoards(world);
    expect(world.transports[room].dock).toBe("greek-harbor");
    expect(world.transports[room].destination).toBe("pond");
  });
});
