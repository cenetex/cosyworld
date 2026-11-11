import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  holdChoice,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { currentSharedEngine } from "./fixtures/shared-engine.mjs";
const gate = "pond-greek-harbor";
const context = { actor: "vale", claimed: ["vale"], present: ["vale"] };
function arranged(actor = "vale") {
  const s = createWorld();
  s.actors[actor].place = "pond";
  s.items.lamp.holder = "pond";
  s.items.cloth.holder = actor;
  s.actors[actor].heldItem = null;
  return decodeSave(encodeSave(s));
}
it("a quiet cloth hold reveals the placed lit lamp's ship identically locally and in shared rules", () => {
  const world = arranged();
  expect(world.crossings[gate].discovered).toBe(false);
  const choice = { item: "cloth", revision: world.revision };
  const local = structuredClone(world);
  holdChoice(local, "vale", choice);
  const request = { ...context, op: "hold", world, choice };
  const shared = dispatchShared(request);
  const runtime = currentSharedEngine();
  expect(JSON.parse(runtime.cardShared(JSON.stringify(request)))).toEqual(
    shared,
  );
  expect(shared.world.crossings[gate]).toEqual({ discovered: true });
  expect(shared.world.transports["greek-ship"].dock).toBe("pond");
  expect(shared.world.crossings).toEqual(local.crossings);
  expect(shared.world.turn).toBe(world.turn);
  expect(shared.world.log).toEqual(world.log);
  holdChoice(local, "vale", { item: null, revision: local.revision });
  expect(decodeSave(encodeSave(local)).crossings[gate].discovered).toBe(true);
});
it("mere cloth possession, a carried lamp, or an actor elsewhere cannot reveal the ship", () => {
  for (const damage of [
    (s) => {
      s.items.lamp.holder = "vale";
    },
    (s) => {
      s.actors.vale.place = "station";
    },
    (s) => {
      s.items.lamp.fuelRooms = 0;
      s.items.lamp.fuel = 0;
    },
  ]) {
    const s = arranged();
    damage(s);
    holdChoice(s, "vale", { item: "cloth", revision: s.revision });
    expect(s.crossings[gate].discovered).toBe(false);
  }
});
it("a resident's selected cloth also reveals the ship during an authoritative play", () => {
  const s = arranged("moth");
  s.actors.moth.heldItem = "cloth";
  const result = play(
    s,
    legalActions(s).find((a) => a.kind === "wait" && !a.sleep),
  );
  expect(result.ok).toBe(true);
  expect(result.state.crossings[gate].discovered).toBe(true);
});
// package 6 fixtures: starts from a recorded old save, re-recorded after the bump.
it.skip("migrates a genuine completed rules128 ship signal without erasing discovery or records", () => {
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
  const old = (request) => {
    const result = JSON.parse(
      runtime.cardShared(JSON.stringify({ ...context, ...request })),
    );
    expect(result.ok, result.error).toBe(true);
    return result;
  };
  let world = old({ op: "create", seed: 7 }).world;
  world.actors.vale.place = "pond";
  world.opening.crossed = true;
  world.opening.met.moth = 0;
  world.locations.attic.anchored = true;
  world.items.cloth.holder = "vale";
  for (const kind of ["cover", "take"]) {
    const action = old({ op: "view", world }).actions.find(
      (a) =>
        a.kind === kind &&
        a.item === "cloth" &&
        (kind !== "cover" || a.target === "lamp"),
    );
    expect(action).toBeDefined();
    world = old({ op: "play", world, action }).world;
  }
  expect(world.crossings[gate].discovered).toBe(true);
  const migrated = decodeSave(JSON.stringify(world));
  expect(migrated.crossings[gate]).toEqual({ discovered: true });
  expect(migrated.log).toEqual(world.log);
  expect(migrated.transports).toEqual(world.transports);
  expect(decodeSave(encodeSave(migrated))).toEqual(migrated);
});
it("keeps an already occupied voyage accessible during save migration", () => {
  const s = arranged();
  s.actors.vale.place = "greek-ship";
  const restored = decodeSave(encodeSave(s));
  expect(restored.crossings[gate].discovered).toBe(true);
  expect(restored.actors.vale.place).toBe("greek-ship");
  expect(restored.transports).toEqual(s.transports);
  expect(restored.log).toEqual(s.log);
});
