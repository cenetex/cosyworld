import { describe, expect, it } from "vitest";
import {
  createWorld, decodeSave, encodeSave, exits, legalActions,
  places, plan, play, things,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { generateProgram } from "../v2/card-game/quests.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";

function commit(world, kind, fields = {}) {
  const action = legalActions(world).find((a) => a.kind === kind &&
    Object.entries(fields).every(([key, value]) => a[key] === value));
  expect(action).toBeDefined();
  const result = play(world, action);
  expect(result.ok).toBe(true);
  expect(play(decodeSave(encodeSave(world)), action)).toEqual(result);
  return result.state;
}

describe("return journeys and fixed meetings", () => {
  it("refills a carried lamp before a local bargain holds the attic closed", () => {
    let world = createWorld();
    world.turn = world.revision = 40;
    world.actors.vale.place = "pond";
    world.actors.moth.place = world.actors.keeper.place = "attic";
    world.actors.vale.progress = { program: 0, step: 2, marks: [1, 7] };
    world.actors.moth.progress = { program: 1, step: 0, marks: [9, 31] };
    world.actors.keeper.progress = { program: 1, step: 0, marks: [7, 31] };
    world.items.lamp.holder = world.items.oil.holder = "moth";
    world.items.lamp.fuel = 0;
    world.items.lamp.lit = false;
    world.items.oil.doses = 1;
    world.items.cloth.holder = "keeper";
    world.items.bell.holder = "pond";
    expect(exits(world, "attic", "moth")).toEqual([]);
    expect(plan(world, "moth").action).toMatchObject({ kind: "refill", item: "oil" });
    world = commit(world, "wait");
    expect(world.items.lamp.fuel).toBe(4);
    expect(world.items.oil.doses).toBe(0);
    expect(plan(world, "moth").action).toMatchObject({ kind: "light", item: "lamp" });
    world = commit(world, "wait");
    expect(world.items.lamp.lit).toBe(true);
    expect(exits(world, "attic", "moth")).toContain("pond");
    expect(world.items.lamp.holder).toBe("moth");
  });

  it("calls for oil and tends the lamp for a nearby traveler's ready hand", () => {
    let world = createWorld();
    world.turn = world.revision = 40;
    for (const id of ["vale", "moth", "keeper"]) world.actors[id].place = "pond";
    world.actors.vale.progress = { program: 0, step: 2, marks: [1, 7] };
    world.actors.moth.progress = { program: 1, step: 0, marks: [9, 31] };
    world.actors.keeper.progress = { program: 0, step: 1, marks: [7] };
    world.items.lamp.holder = world.items.oil.holder = "moth";
    world.items.lamp.fuel = 0;
    world.items.lamp.lit = false;
    world.items.oil.doses = 0;
    world.items.cloth.holder = "keeper";
    world.items.bell.holder = "vale";
    expect(plan(world).action).toMatchObject({ kind: "ring", item: "bell" });
    world = commit(world, "ring", { item: "bell" });
    expect(world.items.lamp.fuel).toBe(4);
    expect(world.items.oil.doses).toBe(0);
    expect(plan(world, "moth").action).toMatchObject({ kind: "light", item: "lamp" });
    world = commit(world, "wait");
    expect(world.items.lamp.lit).toBe(true);
    expect(world.actors.keeper.place).toBe("attic");
    expect(world.items.lamp.holder).toBe("moth");
    expect(world.items.bell.holder).toBe("vale");
  });

  it("lets an invited resident return from the cottage after the leader leaves", () => {
    let world = createWorld();
    world.actors.vale.place = world.actors.moth.place = "attic";
    world.actors.keeper.place = "station";
    world.items.lamp.holder = "vale";
    world.items.lamp.lit = true;
    world.items.cloth.holder = "attic";
    world.actors.moth.trust.vale = 3;
    expect(exits(world, "attic", "moth")).not.toContain("forest-cottage");
    world = commit(world, "accompany", { target: "moth", destination: "forest-cottage" });
    expect(world.log.findLast((e) => e.verb === "accompany").accepted).toBe(true);
    expect(world.actors.moth.place).toBe("forest-cottage");
    expect(exits(world, "forest-cottage", "moth")).toContain("attic");
    world.peaceUntil.moth = world.turn + 3;
    world = commit(world, "move", { target: "attic" });
    world = commit(world, "take", { item: "cloth" });
    expect(world.actors.moth.place).toBe("forest-cottage");
    world.peaceUntil.moth = world.turn + 3;
    world = commit(world, "move", { target: "pond" });
    expect(exits(world, "attic", "vale")).not.toContain("forest-cottage");
    expect(plan(world, "moth").action.kind).toBe("wait");
    world = commit(world, "wait");
    world = commit(world, "wait");
    expect(world.actors.moth.place).toBe("attic");
    expect(world.items.lamp.holder).toBe("vale");
    expect(world.items.cloth.holder).toBe("vale");
    expect(exits(world, "attic", "moth")).not.toContain("forest-cottage");
    expect(decodeSave(encodeSave(world))).toEqual(world);
  });

  it("rings a carried bell to open the return from the clearing", () => {
    let world = createWorld();
    world.actors.vale.place = "clearing";
    world.items.bell.holder = "vale";
    world.actors.vale.progress = { program: 0, step: 2, marks: [1, 2] };
    world.turn = world.revision = 20;
    expect(exits(world, "clearing", "vale")).toEqual([]);
    expect(plan(world).action).toMatchObject({ kind: "ring", item: "bell" });
    world = commit(world, "ring", { item: "bell" });
    expect(plan(world).action).toMatchObject({ kind: "move", target: "pond" });
    world = commit(world, "move", { target: "pond" });
    expect(world.actors.vale.place).toBe("pond");
    expect(world.items.bell.holder).toBe("vale");
  });

  it("keeps a promised gift at its meeting place while the recipient approaches", () => {
    let world = enableMotives(createWorld({ opening: true }), { questPrograms: true });
    world.turn = world.revision = 20;
    world.opening.met.keeper = 0;
    world.actors.moth.place = "pond";
    world.actors.moth.progress = { program: 0, step: 1, marks: [1] };
    world.actors.keeper.place = "station";
    world.items.oil.holder = "keeper";
    world.actors.keeper.progress = { program: 2, step: 0, marks: [1, 2, 3, 4], completedHands: 4, recent: [] };
    const program = generateProgram(world, "keeper", places, things);
    program.steps = [{ items: [], location: "station", avatars: ["moth"],
      conditions: [{ kind: "heldBy", item: "oil", avatar: "moth" }] }];
    world.actors.keeper.progress.current = program;
    expect(plan(world, "keeper").action.kind).toBe("wait");
    expect(plan(world, "moth").action).toMatchObject({ kind: "move", target: "station" });
    world = commit(world, "wait");
    expect(world.items.oil.holder).toBe("moth");
    expect(world.log.findLast((e) => e.verb === "give")).toMatchObject({
      actorId: "keeper", itemId: "oil", targetId: "moth",
    });
  });
});

function trappedOil() {
  const world = createWorld();
  for (const id of ["vale", "moth", "keeper"]) world.actors[id].place = "pond";
  world.items.lamp.holder = "moth";
  world.items.lamp.fuel = 0;
  world.items.lamp.lit = false;
  world.items.oil.holder = "attic";
  world.items.oil.doses = 2;
  world.items.cloth.holder = "pond";
  return world;
}

describe("oil trapped behind the attic gate", () => {
  it("opens a physical recovery path while each item keeps its place", () => {
    const world = trappedOil(), items = structuredClone(world.items);
    expect(exits(world, "pond", "vale")).toContain("attic");
    expect(exits(world, "pond", "moth")).toContain("attic");
    expect(exits(world, "station", "vale")).toEqual(["pond"]);
    expect(exits(world, "attic", "vale")).not.toContain("forest-cottage");
    const restored = decodeSave(encodeSave(world));
    expect(exits(restored, "pond", "vale")).toContain("attic");
    expect(restored.items).toEqual(items);
    const action = legalActions(restored).find((a) => a.kind === "move" && a.target === "attic");
    expect(action.text).toContain("along a narrow path");
    const next = commit(restored, "move", { target: "attic" });
    expect(next.actors.vale.place).toBe("attic");
  });

  it.each(["fuel", "reachable oil", "helper inside", "oil carrier inside"])("keeps ordinary %s recovery in use", (kind) => {
    const world = trappedOil();
    if (kind === "fuel") world.items.lamp.fuel = 4;
    if (kind === "reachable oil") world.items.oil.holder = "station";
    if (kind === "helper inside") world.actors.moth.place = "attic";
    if (kind === "oil carrier inside") {
      world.actors.keeper.place = "attic";
      world.items.oil.holder = "keeper";
    }
    expect(exits(world, "pond", "vale")).not.toContain("attic");
  });

  it("agrees with the shared adapter through a saved physical recovery play", () => {
    let world = trappedOil();
    world.sharedVersion = 1;
    world = dispatchShared({ op: "validate", world, actor: "vale",
      claimed: ["vale", "mara"], present: ["vale", "mara"] }).world;
    world.controlledActors = world.presentActors = ["vale", "mara"];
    world.playerActorId = "vale";
    const action = legalActions(world).find((a) => a.kind === "move" && a.target === "attic");
    const local = play(world, action);
    expect(local.ok).toBe(true);
    const shared = dispatchShared({ op: "play", world: decodeSave(encodeSave(world)),
      actor: "vale", claimed: ["vale", "mara"], present: ["vale", "mara"],
      revision: world.revision, action });
    expect(shared.ok).toBe(true);
    const expected = structuredClone(local.state);
    for (const key of ["controlledActors", "presentActors", "playerActorId"]) delete expected[key];
    expect(shared.world).toEqual(expected);
    expect(decodeSave(encodeSave(shared.world))).toEqual(shared.world);
  });
});
