import { expect, it } from "vitest";
import {
  canTrade,
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
import {
  handSnapshot,
  heldItem,
  settleHeldItems,
} from "../v2/card-game/held-item.mjs";
import { useUp } from "../v2/card-game/item-use.mjs";

function table() {
  const world = createWorld();
  world.actors.keeper.place = world.actors.vale.place;
  world.items.bell.holder = "vale";
  world.items.oil.holder = "keeper";
  world.actors.keeper.want = {
    kind: "item",
    target: "bell",
    since: world.turn,
    refusals: 0,
  };
  settleHeldItems(world);
  return world;
}
function act(world, kind, fields = {}) {
  const action = legalActions(world).find(
    (a) =>
      a.kind === kind &&
      Object.entries(fields).every(([key, value]) => a[key] === value),
  );
  expect(action).toBeTruthy();
  const result = play(world, action);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}

it("puts an accepted gift in hand and keeps that choice through wait and reload", () => {
  const before = table();
  expect(heldItem(before, "keeper")).toBe("oil");
  let world = act(before, "give", { item: "bell", target: "keeper" });
  expect(world.actors.keeper.heldItem).toBe("bell");
  expect(world.items.oil.holder).toBe("keeper");
  expect(world.items.bell.holder).toBe("keeper");
  world = act(world, "wait");
  expect(heldItem(world, "keeper")).toBe("bell");
  expect(decodeSave(encodeSave(world)).actors.keeper.heldItem).toBe("bell");
});

it("chooses the received item for both sides of a real Trade", () => {
  const before = table();
  before.actors.keeper.want = null;
  const action = legalActions(before).find(
    (a) => a.kind === "trade" && canTrade(before, "vale", a.item, a.receive),
  );
  expect(action).toBeTruthy();
  const result = play(before, action);
  expect(result.ok, result.error).toBe(true);
  expect(result.state.actors.keeper.heldItem).toBe(action.item);
  expect(result.state.actors.vale.heldItem).toBe(action.receive);
});

it("repairs a lost or consumed choice and leaves an empty hand when needed", () => {
  const world = table();
  const before = handSnapshot(world);
  world.items.bell.holder = "keeper";
  settleHeldItems(world, before);
  expect(heldItem(world, "keeper")).toBe("bell");
  world.items.bell.holder = "station";
  settleHeldItems(world);
  expect(heldItem(world, "keeper")).toBe("oil");
  useUp(world, "oil", "keeper");
  settleHeldItems(world);
  expect(world.actors.keeper.heldItem).toBeNull();
});

it("seeds older saves in stable order and repairs a stale saved choice", () => {
  const world = table();
  world.items.bell.holder = "keeper";
  for (const actor of Object.values(world.actors)) delete actor.heldItem;
  let loaded = decodeSave(JSON.stringify(world));
  expect(loaded.actors.keeper.heldItem).toBe("bell");
  loaded.items.bell.holder = "station";
  loaded = decodeSave(JSON.stringify(loaded));
  expect(loaded.actors.keeper.heldItem).toBe("oil");
});

it.each(["missing", "toString", 1, {}, []])(
  "rejects an invalid saved hand ID: %j",
  (id) => {
    const world = table();
    world.actors.keeper.heldItem = id;
    expect(() => validateWorld(world)).toThrow();
    expect(() => decodeSave(JSON.stringify(world))).toThrow();
  },
);
