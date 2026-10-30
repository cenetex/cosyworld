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
  it("reads a changed lamp afresh on the next plan", () => {
    const world = createWorld();
    world.turn = world.revision = 100;
    world.actors.vale.place = "attic";
    world.actors.moth.place = "station";
    world.actors.vale.progress = { program: 1, step: 1, marks: [1, 9, 66, 67] };
    for (const item of ["lamp", "bell", "oil"]) world.items[item].holder = "vale";
    world.items.lamp.fuel = 3;
    world.items.lamp.lit = true;
    const before = structuredClone(world);
    expect(plan(world).action).toMatchObject({ kind: "move", target: "pond" });
    expect(world).toEqual(before);
    world.items.lamp.fuel = 0;
    world.items.lamp.lit = false;
    const after = structuredClone(world);
    expect(plan(world).action).toMatchObject({ kind: "refill", item: "oil" });
    expect(world).toEqual(after);
  });

  it("fetches the cottage key before recovering a lamp beyond its door", () => {
    let world = createWorld();
    world.turn = world.revision = 400;
    world.actors.vale.place = world.actors.moth.place = "attic";
    world.actors.keeper.place = "station";
    world.actors.vale.progress = { program: 1, step: 1, marks: [1, 9, 66, 67] };
    world.actors.keeper.progress = { program: 1, step: 1, marks: [9, 67, 70] };
    world.items.lamp.holder = "forest-oak";
    world.items.lamp.fuel = 0;
    world.items.lamp.lit = false;
    world.items.oil.holder = world.items.cloth.holder = "keeper";
    world.items.bell.holder = "vale";
    expect(plan(world).action).toMatchObject({ kind: "move", target: "pond" });
    let recovered = false;
    for (let turn = 0; turn < 80 && !recovered; turn++) {
      const result = play(world, plan(world).action);
      expect(result.ok).toBe(true);
      recovered = result.state.items.lamp.holder === "vale";
      world = result.state;
    }
    expect(recovered).toBe(true);
    expect(world.items.lamp.history.some((line) => line.includes("Vale takes the Lamp"))).toBe(true);
    expect(decodeSave(encodeSave(world))).toEqual(world);
  });

  it("shares a spare lamp with the traveler who carries the oil needed for their meeting", () => {
    let world = createWorld();
    world.turn = world.revision = 40;
    for (const id of ["vale", "moth", "keeper"]) world.actors[id].place = "pond";
    world.actors.vale.progress = { program: 0, step: 1, marks: [1] };
    world.actors.moth.progress = { program: 0, step: 1, marks: [9] };
    world.actors.keeper.progress = { program: 0, step: 0, marks: [] };
    world.items.lamp.holder = "vale";
    world.items.lamp.fuel = 0;
    world.items.lamp.lit = false;
    world.items.oil.holder = "moth";
    world.items.oil.doses = 3;
    world.actors.moth.trust.vale = 0;
    world.items.bell.holder = "keeper";
    world.items.cloth.holder = "pond";
    expect(plan(world).action).toMatchObject({ kind: "give", item: "lamp", target: "moth" });
    world = commit(world, "give", { item: "lamp", target: "moth" });
    expect(world.items.lamp.holder).toBe("moth");
    expect(world.items.lamp.fuel).toBeGreaterThan(0);
    expect(world.items.oil.doses).toBe(2);
  });

  it("delivers an active promise while keeping the giver's grievance", () => {
    const world = enableMotives(createWorld(), { questPrograms: true });
    world.turn = world.revision = 20;
    world.actors.vale.place = "pond";
    world.actors.moth.place = world.actors.keeper.place = "station";
    world.items.oil.holder = "keeper";
    world.actors.keeper.progress = {
      program: 2, step: 0, marks: [1, 2, 3, 4], completedHands: 4, recent: [],
    };
    const program = generateProgram(world, "keeper", places, things);
    program.steps = [{ items: [], location: "station", avatars: ["moth"],
      conditions: [{ kind: "heldBy", item: "oil", avatar: "moth" }] }];
    world.actors.keeper.progress.current = program;
    const grievance = {
      other: "moth", kind: "pestering", reason: "Pip kept asking for the same belongings.",
      turn: world.turn, weight: 2,
    };
    world.motives.grievances.keeper = [grievance];
    world.peaceUntil.moth = world.turn + 3;
    const action = plan(world, "keeper").action;
    expect(action).toMatchObject({ kind: "give", item: "oil", target: "moth" });
    const result = play(world, legalActions(world).find((entry) => entry.kind === "wait"));
    expect(result.ok).toBe(true);
    expect(result.state.items.oil.holder).toBe("moth");
    expect(result.state.motives.grievances.keeper).toContainEqual(grievance);
    expect(decodeSave(encodeSave(result.state))).toEqual(result.state);
  });

  it("makes room for a needed floor item through ordinary item plays", () => {
    const world = enableMotives(createWorld(), { questPrograms: true });
    world.turn = world.revision = 40;
    world.actors.moth.place = "hoppycat-meraki-atelier";
    world.actors.moth.progress = { program: 1, step: 0, marks: [9, 31] };
    for (const item of ["lamp", "oil", "bell"]) world.items[item].holder = "moth";
    world.items.cloth.holder = "hoppycat-meraki-atelier";
    const action = plan(world, "moth").action;
    expect(action.kind).toBe("drop");
    expect(["lamp", "oil", "bell"]).toContain(action.item);
  });

  it("reaches the pond threshold before tending a closed attic from another region", () => {
    const world = createWorld();
    world.turn = world.revision = 40;
    world.actors.vale.place = "hoppycat-context-greenhouse";
    world.actors.vale.progress = { program: 0, step: 1, marks: [2] };
    world.items.oil.holder = "vale";
    world.items.lamp.holder = "moth";
    world.items.lamp.fuel = 0;
    world.items.lamp.lit = false;
    expect(plan(world).action).toMatchObject({
      kind: "move", target: "hoppycat-open-record-cathedral",
    });
  });

  it("collects a reachable cloth before preparing its later attic meeting", () => {
    const world = createWorld();
    world.turn = world.revision = 40;
    world.actors.moth.place = "pond";
    world.actors.keeper.place = "station";
    world.actors.moth.progress = { program: 1, step: 0, marks: [9, 31] };
    world.items.lamp.holder = world.items.oil.holder = "moth";
    world.items.lamp.fuel = 0;
    world.items.lamp.lit = false;
    world.items.oil.doses = 1;
    world.items.cloth.holder = "hoppycat-meraki-atelier";
    // An earlier save that found the red thread keeps the walk to the garden.
    world.crossings["hoppycat-pond-garden"].discovered = true;
    expect(plan(world, "moth").action).toMatchObject({
      kind: "move", target: "hoppycat-halfway-tea-garden",
    });
  });

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

  it("carries an accessible flask out and accepts a request before the lamp is refilled", () => {
    let world = createWorld();
    world.turn = world.revision = 40;
    world.actors.vale.place = world.actors.moth.place = "pond";
    world.actors.keeper.place = "attic";
    world.actors.vale.progress = { program: 0, step: 2, marks: [1, 7] };
    world.actors.moth.progress = { program: 1, step: 0, marks: [9, 31] };
    world.actors.keeper.progress = { program: 0, step: 1, marks: [7] };
    world.items.lamp.holder = "moth";
    world.items.lamp.fuel = 0;
    world.items.lamp.lit = false;
    world.items.oil.holder = "attic";
    world.items.oil.doses = 3;
    world.items.cloth.holder = "keeper";
    world.items.bell.holder = "vale";
    expect(plan(world, "keeper").action).toMatchObject({ kind: "take", item: "oil" });
    world = commit(world, "wait");
    expect(world.items.oil.holder).toBe("keeper");
    expect(plan(world, "keeper").action).toMatchObject({ kind: "move", target: "pond" });
    world = commit(world, "wait");
    expect(world.actors.keeper.place).toBe("pond");
    expect(plan(world, "moth").action).toMatchObject({ kind: "ask", item: "oil", target: "keeper" });
    world = commit(world, "wait");
    expect(world.items.oil.holder).toBe("moth");
    expect(world.log.findLast((e) => e.verb === "ask")).toMatchObject({
      actorId: "moth", itemId: "oil", targetId: "keeper", accepted: true,
    });
    world = commit(world, "wait");
    expect(world.items.lamp.fuel).toBe(4);
    expect(world.items.oil.doses).toBe(2);
    expect(world.items.lamp.holder).toBe("moth");
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
    world = commit(world, "light");
    world = commit(world, "move", { target: "pond" });
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

function trappedLamp() {
  const world = createWorld();
  world.turn = world.revision = 400;
  world.actors.vale.place = world.actors.keeper.place = "pond";
  world.actors.moth.place = "attic";
  world.actors.vale.progress = { program: 0, step: 2, marks: [1, 9] };
  world.actors.moth.progress = { program: 0, step: 0, marks: [] };
  world.actors.keeper.progress = { program: 0, step: 1, marks: [9] };
  world.items.lamp.holder = "forest-oak";
  world.items.lamp.fuel = 0;
  world.items.lamp.lit = false;
  world.items.oil.holder = "vale";
  world.items.oil.doses = 2;
  world.items.bell.holder = "station";
  world.items.cloth.holder = "keeper";
  return world;
}

describe("a lamp trapped beyond the attic", () => {
  it("recovers the exact loose-play state through physical plays and cloth care", () => {
    let world = trappedLamp();
    const items = structuredClone(world.items);
    expect(exits(world, "pond", "vale")).toContain("attic");
    expect(exits(world, "attic", "vale")).not.toContain("forest-cottage");
    world = decodeSave(encodeSave(world));
    expect(world.items).toEqual(items);
    let movedLamp = false;
    for (let i = 0; i < 40; i++) {
      const action = plan(world).action, result = play(world, action);
      expect(result.ok).toBe(true);
      expect(play(decodeSave(encodeSave(world)), action)).toEqual(result);
      world = result.state;
      if (world.items.lamp.holder !== "forest-oak") movedLamp = true;
      if (world.actors.moth.progress.marks.length > 0 &&
        world.actors.vale.progress.marks.at(-1) > 9 && world.actors.keeper.progress.marks.at(-1) > 9) break;
    }
    expect(movedLamp).toBe(true);
    expect(world.actors.moth.progress.marks.length).toBeGreaterThan(0);
    for (const id of ["vale", "keeper"])
      expect(world.actors[id].progress.marks.at(-1)).toBeGreaterThan(9);
    expect(world.log.some((e) => e.verb === "take" && e.itemId === "lamp")).toBe(true);
  });

  it("lets the cloth carrier approach when an inside oil carrier still cannot reach the lamp", () => {
    let world = trappedLamp();
    world.actors.vale.place = "attic";
    world.actors.vale.progress = { program: 1, step: 1, marks: [1, 9, 66, 67] };
    world.actors.keeper.progress = { program: 1, step: 0, marks: [9, 67] };
    world.items.bell.holder = "vale";
    expect(exits(world, "pond", "keeper")).toContain("attic");
    expect(exits(world, "attic", "vale")).not.toContain("forest-cottage");
    expect(plan(world, "keeper").action).toMatchObject({ kind: "move", target: "attic" });
    world = commit(world, "wait");
    expect(world.actors.keeper.place).toBe("attic");
    expect(world.items.cloth.holder).toBe("keeper");
    expect(exits(world, "attic", "vale")).toContain("forest-cottage");
    expect(plan(world).action).toMatchObject({ kind: "move", target: "forest-cottage" });
    expect(world.items.lamp.holder).toBe("forest-oak");
  });

  it("keeps a lamp on another reachable pack on its own route", () => {
    const world = trappedLamp();
    world.items.lamp.holder = "clearing";
    world.items.bell.holder = "pond";
    world.items.bell.ringing = 3;
    world.crossings["pond-clearing"] = { discovered: true, phase: 2, until: 403 };
    expect(exits(world, "pond", "vale")).toContain("clearing");
    expect(exits(world, "pond", "vale")).not.toContain("attic");
  });

  it.each(["reachable lamp", "inside light", "inside refill"])("keeps %s as the ordinary remedy", (kind) => {
    const world = trappedLamp();
    if (kind === "reachable lamp") {
      world.items.lamp.holder = "station";
      world.items.lamp.fuel = 4;
    } else {
      world.sharedVersion = 1;
      world.controlledActors = world.presentActors = ["vale", "mara"];
      world.actors.mara.place = "forest-oak";
      world.items.lamp.holder = "mara";
      if (kind === "inside light") world.items.lamp.fuel = 4;
      if (kind === "inside refill") world.items.oil.holder = "mara";
    }
    expect(exits(world, "pond", "vale")).not.toContain("attic");
  });

  it("uses the same saved recovery move in local and shared play", () => {
    let world = trappedLamp();
    world.sharedVersion = 1;
    world = dispatchShared({ op: "validate", world, actor: "vale",
      claimed: ["vale", "mara"], present: ["vale", "mara"] }).world;
    world.controlledActors = world.presentActors = ["vale", "mara"];
    world.playerActorId = "vale";
    const action = legalActions(world).find((a) => a.kind === "move" && a.target === "attic");
    const local = play(world, action);
    const shared = dispatchShared({ op: "play", world: decodeSave(encodeSave(world)),
      actor: "vale", claimed: ["vale", "mara"], present: ["vale", "mara"],
      revision: world.revision, action });
    expect(local.ok).toBe(true);
    expect(shared.ok).toBe(true);
    const expected = structuredClone(local.state);
    for (const key of ["controlledActors", "presentActors", "playerActorId"]) delete expected[key];
    expect(shared.world).toEqual(expected);
    expect(shared.world.items.lamp.holder).toBe("forest-oak");
    expect(shared.world.items.oil.holder).toBe("vale");
    expect(decodeSave(encodeSave(shared.world))).toEqual(shared.world);
  });
});
