import { currentSharedEngine } from "./fixtures/shared-engine.mjs";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  exits,
  holdChoice,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";

const context = { actor: "vale", claimed: ["vale"], present: ["vale"] };
function commit(world, kind, fields = {}) {
  const action = legalActions(world).find(
    (a) =>
      a.kind === kind &&
      Object.entries(fields).every(([key, value]) => a[key] === value),
  );
  expect(action, `${kind}: ${JSON.stringify(fields)}`).toBeDefined();
  const result = play(world, action);
  expect(result.ok, result.error).toBe(true);
  expect(play(decodeSave(encodeSave(world)), action)).toEqual(result);
  return result.state;
}
function hold(world, item) {
  holdChoice(world, "vale", { item, revision: world.revision });
  return world;
}
const lampInHand = () => commit(createWorld(), "take", { item: "lamp" });

describe("three-room lamp authority", () => {
  it("anchors the opening attic when stowing reveals its mirror", () => {
    const world = createWorld({ opening: true });
    expect(world.items.lamp).toMatchObject({ holder: "vale", lit: true });
    expect(exits(world, "attic", "vale")).not.toContain("pond");
    const shared = dispatchShared({
      ...context,
      op: "hold",
      world,
      choice: { item: null, revision: world.revision },
    });
    hold(world, null);
    expect(world.locations.attic.anchored).toBe(true);
    expect(world.items.lamp.lit).toBe(false);
    expect(exits(world, "attic", "vale")).toContain("pond");
    expect(shared.world.items.lamp).toEqual(world.items.lamp);
    expect(shared.world.locations.attic).toEqual(world.locations.attic);
  });
  it.each([
    { fuelRooms: -1 },
    { fuelRooms: 4 },
    { fuelVisit: 1 },
    { fuelPlace: "" },
  ])("rejects malformed persisted room fuel %j", (damage) => {
    const world = createWorld();
    Object.assign(world.items.lamp, damage);
    expect(() => decodeSave(JSON.stringify(world))).toThrow();
    expect(() =>
      dispatchShared({
        ...context,
        op: "upgrade",
        world,
        from: "full-card-world/129",
        to: "full-card-world/130",
      }),
    ).toThrow();
  });
  it("records the newly received lamp as held and lit in the transfer event", () => {
    let world = createWorld();
    world.actors.moth.place = "station";
    world = commit(world, "take", { item: "lamp" });
    hold(world, null);
    expect(world.actors.moth.heldItem).toBe("cloth");
    world = commit(world, "give", { item: "lamp", target: "moth" });
    expect(world.actors.moth.heldItem).toBe("lamp");
    expect(world.items.lamp.lit).toBe(true);
    const event = world.log.findLast(
      (e) => e.verb === "give" && e.itemId === "lamp",
    );
    expect(event.light).toBe(true);
    expect(event.items.find((item) => item.id === "lamp")).toMatchObject({
      holder: "moth",
      lit: true,
    });
    const receipt = world.log.findLast(
      (e) => e.verb === "want_met" && e.actorId === "moth",
    );
    expect(receipt.turn).toBe(event.turn);
    expect(receipt.light).toBe(true);
  });
  it("lights a placed new lamp and spends fuel on visits, including returns", () => {
    expect(createWorld().items.lamp).toMatchObject({
      holder: "station",
      fuelRooms: 3,
      lit: true,
    });
    let world = lampInHand();
    for (const [target, fuelRooms] of [
      ["pond", 2],
      ["station", 1],
      ["pond", 0],
    ]) {
      world = commit(world, "move", { target });
      expect(world.items.lamp).toMatchObject({
        fuelRooms,
        fuel: fuelRooms * 4,
        lit: fuelRooms > 0,
        fuelPlace: target,
      });
    }
    const arrival = world.log.findLast(
      (e) => e.verb === "move" && e.actorId === "vale",
    );
    expect(arrival.light).toBe(false);
    expect(arrival.items.find((item) => item.id === "lamp")).toMatchObject({
      fuelRooms: 0,
      lit: false,
    });
    expect(
      legalActions(world).some((a) => ["light", "snuff"].includes(a.kind)),
    ).toBe(false);
  });
  it("keeps fuel during same-room turns and stows without changing custody", () => {
    let world = lampInHand();
    for (let i = 0; i < 3; i++) world = commit(world, "wait");
    expect(world.items.lamp.fuelRooms).toBe(3);
    hold(world, null);
    expect(world.items.lamp).toMatchObject({
      holder: "vale",
      fuelRooms: 3,
      lit: false,
    });
    world = decodeSave(encodeSave(world));
    expect(world.actors.vale.heldItem).toBeNull();
    expect(world.items.lamp.lit).toBe(false);
    hold(world, "lamp");
    expect(world.items.lamp).toMatchObject({ fuelRooms: 3, lit: true });
  });
  it("defers dark travel until the quiet local/shared hold lights the destination", () => {
    let world = hold(lampInHand(), null);
    world = commit(world, "move", { target: "pond" });
    expect(world.items.lamp).toMatchObject({
      fuelRooms: 3,
      lit: false,
      fuelVisit: false,
    });
    const shared = dispatchShared({
      ...context,
      op: "hold",
      world,
      choice: { item: "lamp", revision: world.revision },
    });
    const local = hold(structuredClone(world), "lamp");
    expect(shared.world.items.lamp).toEqual(local.items.lamp);
    expect(shared.world.items.lamp).toMatchObject({ fuelRooms: 2, lit: true });
    expect(shared.world.turn).toBe(world.turn);
    expect(shared.world.log).toEqual(world.log);
    expect(decodeSave(encodeSave(local)).items.lamp).toEqual(local.items.lamp);
    expect(() =>
      dispatchShared({
        ...context,
        op: "hold",
        world: shared.world,
        choice: { item: null, revision: world.revision },
      }),
    ).toThrow();
  });
  it("keeps a dropped lamp lit without another room charge", () => {
    let world = lampInHand();
    // Keep collectors away so this test observes placement rather than an NPC take.
    world.actors.moth.place = world.actors.keeper.place = "attic";
    world = commit(world, "drop", { item: "lamp" });
    expect(world.items.lamp).toMatchObject({
      holder: "station",
      fuelRooms: 3,
      lit: true,
    });
    world = commit(world, "take", { item: "lamp" });
    expect(world.items.lamp).toMatchObject({
      holder: "vale",
      fuelRooms: 3,
      lit: true,
    });
  });
  it("refills an exhausted lamp and returns the oil to its authored station", () => {
    let world = lampInHand();
    for (const target of ["pond", "station", "pond", "station"])
      world = commit(world, "move", { target });
    expect(world.items.lamp).toMatchObject({ fuelRooms: 0, lit: false });
    // Put the authored flask within reach; the actual take must perform refill.
    world.items.oil.holder = "station";
    world = commit(world, "take", { item: "oil" });
    expect(world.items.lamp).toMatchObject({
      fuelRooms: 3,
      fuel: 12,
      fuelPlace: "station",
    });
    expect(world.items.oil.holder).toBe("station");
    expect(world.log.findLast((e) => e.verb === "refuel")).toMatchObject({
      actorId: "vale",
      itemId: "oil",
      targetId: "lamp",
      returnLocationId: "station",
    });
    hold(world, "lamp");
    expect(world.items.lamp).toMatchObject({ fuelRooms: 3, lit: true });
  });
});

// package 6 fixtures: starts from a recorded old save, re-recorded after the bump.
it.skip("migrates authentic rules128 light/snuff history without reinterpreting its events", () => {
  const runtime = vm.createContext({
    structuredClone,
    cardContent: JSON.parse(
      readFileSync(
        new URL("./fixtures/released-rules/content-v128.json", import.meta.url),
      ),
    ),
  });
  vm.runInContext(
    readFileSync(
      new URL(
        "../v2/orchestrator-rust/src/card_shared/engine-v128.js",
        import.meta.url,
      ),
      "utf8",
    ),
    runtime,
  );
  const released = (request) => {
    const result = JSON.parse(
      runtime.cardShared(JSON.stringify({ ...context, ...request })),
    );
    expect(result.ok, result.error).toBe(true);
    return result;
  };
  let old = released({ op: "create", seed: 7 }).world;
  for (const kind of ["snuff", "light"]) {
    const action = released({ op: "view", world: old }).actions.find(
      (a) => a.kind === kind && a.item === "lamp",
    );
    expect(action).toBeDefined();
    old = released({ op: "play", world: old, action }).world;
    expect(old.log.some((entry) => entry.verb === kind)).toBe(true);
    const before = structuredClone(old),
      loaded = decodeSave(JSON.stringify(old));
    expect(loaded.items.lamp.fuelRooms).toBe(
      Math.ceil(old.items.lamp.fuel / 4),
    );
    expect(loaded.log).toEqual(old.log);
    expect(loaded.turn).toBe(old.turn);
    expect(loaded.eventSeq).toBe(old.eventSeq);
    for (const [id, item] of Object.entries(old.items)) {
      expect(loaded.items[id].history).toEqual(item.history);
      expect(loaded.items[id].holder).toBe(item.holder);
    }
    expect(decodeSave(encodeSave(loaded))).toEqual(loaded);
    expect(
      legalActions(loaded).some((a) => ["light", "snuff"].includes(a.kind)),
    ).toBe(false);
    const upgraded = dispatchShared({
      ...context,
      op: "upgrade",
      world: old,
      from: "full-card-world/128",
      to: "full-card-world/130",
    });
    expect(upgraded.world.items.lamp).toEqual(loaded.items.lamp);
    expect(upgraded.world.log).toEqual(old.log);
    expect(old).toEqual(before);
  }
}, 30000);

describe("saved room fuel is validated before settlement", () => {
  it.each([
    { fuelPlace: "nonexistent" },
    { fuel: 99 },
    { fuel: -1 },
    { fuelRooms: 1, fuel: 12 },
    { fuelPlace: undefined },
  ])("rejects forged metadata on local/shared import: %j", (fields) => {
    const world = createWorld();
    Object.assign(world.items.lamp, fields);
    const save = JSON.stringify(world);
    expect(() => decodeSave(save)).toThrow(/lamp room fuel/);
    expect(() => dispatchShared({ op: "create", save })).toThrow(
      /lamp room fuel/,
    );
  });
});

describe.each(["source", "compiled"])("saved lamp lit type (%s)", (mode) => {
  const dispatch = (request) => {
    if (mode === "source") return dispatchShared(request);
    const result = JSON.parse(
      currentSharedEngine().cardShared(JSON.stringify(request)),
    );
    if (result.ok === false) throw new Error(result.error);
    return result;
  };
  it.each(["invalid", 0, null, [], {}, undefined])(
    "rejects malformed current lit %j",
    (lit) => {
      const world = createWorld();
      world.items.lamp.lit = lit;
      const save = JSON.stringify(world);
      if (mode === "source")
        expect(() => decodeSave(save)).toThrow(/lamp room fuel/);
      expect(() => dispatch({ op: "create", save })).toThrow(/lamp room fuel/);
      expect(() =>
        dispatch({
          op: "upgrade",
          world: JSON.parse(save),
          from: "full-card-world/128",
        }),
      ).toThrow(/lamp room fuel/);
    },
  );
  it.each([true, false, undefined])(
    "preserves supported legacy lit %j",
    (lit) => {
      const old = createWorld();
      for (const key of ["fuelRooms", "fuelPlace", "fuelVisit"])
        delete old.items.lamp[key];
      old.items.lamp.lit = lit;
      const save = JSON.stringify(old);
      const loaded = dispatch({ op: "create", save }).world;
      expect(loaded.items.lamp).toMatchObject({
        holder: "station",
        fuelRooms: 3,
        fuel: 12,
        lit: true,
      });
      expect(loaded.log).toEqual(old.log);
      if (mode === "source")
        expect(decodeSave(save).items.lamp).toEqual(loaded.items.lamp);
      expect(
        dispatch({
          op: "upgrade",
          world: JSON.parse(save),
          from: "full-card-world/128",
        }).world.items.lamp,
      ).toEqual(loaded.items.lamp);
      old.items.lamp.lit = "invalid";
      const invalid = JSON.stringify(old);
      if (mode === "source")
        expect(() => decodeSave(invalid)).toThrow(/lamp room fuel/);
      expect(() => dispatch({ op: "create", save: invalid })).toThrow(
        /lamp room fuel/,
      );
      expect(() =>
        dispatch({
          op: "upgrade",
          world: JSON.parse(invalid),
          from: "full-card-world/128",
        }),
      ).toThrow(/lamp room fuel/);
    },
  );
});
