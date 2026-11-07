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
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { currentSharedEngine } from "./fixtures/shared-engine.mjs";

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

it("keeps the last actual receipt when Give and Ask arrive in one turn", () => {
  const world = table();
  world.actors.moth.place = world.actors.vale.place;
  world.items.lamp.holder = "vale";
  world.items.cloth.holder = "keeper";
  world.items.oil.holder = "attic";
  world.actors.keeper.want = null;
  world.actors.keeper.trust.moth = 3;
  world.actors.moth.want = {
    kind: "item",
    target: "cloth",
    since: 0,
    refusals: 0,
  };
  settleHeldItems(world);
  const result = act(world, "give", { item: "lamp", target: "moth" });
  const transfers = result.log.filter((e) => ["give", "ask"].includes(e.verb));
  expect(transfers.map((e) => [e.verb, e.itemId, e.accepted])).toEqual([
    ["give", "lamp", true],
    ["ask", "cloth", true],
  ]);
  expect(new Set(transfers.map((e) => e.turn)).size).toBe(1);
  expect(result.items.lamp.holder).toBe("moth");
  expect(result.items.cloth.holder).toBe("moth");
  expect(result.actors.moth.heldItem).toBe("cloth");
});

it("chooses a real Take and repairs the hand after Drop", () => {
  const world = table();
  world.actors.keeper.place = "attic";
  world.items.lamp.holder = world.actors.vale.place;
  let result = act(world, "take", { item: "lamp" });
  expect(result.actors.vale.heldItem).toBe("lamp");
  result = act(result, "drop", { item: "lamp" });
  expect(result.actors.vale.heldItem).toBe("bell");
});

it("preserves the hand after a refused gift and a full recipient", () => {
  let world = table();
  world.actors.moth.place = world.actors.vale.place;
  world.items.cloth.holder = "moth";
  world.actors.moth.want = {
    kind: "item",
    target: "cloth",
    since: 0,
    refusals: 0,
  };
  settleHeldItems(world);
  world = act(world, "give", { item: "bell", target: "moth" });
  expect(world.log.findLast((e) => e.verb === "give").accepted).toBe(false);
  expect(heldItem(world, "moth")).toBe("cloth");
  world = table();
  for (const item of ["oil", "cloth", "mask"])
    world.items[item].holder = "keeper";
  settleHeldItems(world);
  const before = structuredClone(world);
  const result = play(world, { key: "give:vale:bell:keeper" });
  expect(result.ok).toBe(false);
  expect(result.state).toEqual(before);
});

it("repairs a disabled choice through the real zero-turn pack action", () => {
  const world = table();
  world.items["greek-water-jar"].holder = "keeper";
  world.actors.keeper.heldItem = "greek-water-jar";
  const result = play(world, { kind: "pack", pack: "sea", enable: false });
  expect(result.ok, result.error).toBe(true);
  expect(result.state.turn).toBe(world.turn);
  expect(result.state.actors.keeper.heldItem).toBe("oil");
  const back = play(result.state, { kind: "pack", pack: "sea", enable: true });
  expect(back.ok, back.error).toBe(true);
  expect(back.state.actors.keeper.heldItem).toBe("oil");
});

it("keeps a covering on the chosen object", () => {
  const world = table();
  world.items.bell.holder = "keeper";
  world.items.cloth.holder = "bell";
  world.actors.keeper.heldItem = "bell";
  settleHeldItems(world);
  expect(heldItem(world, "keeper")).toBe("bell");
  expect(world.items.cloth.holder).toBe("bell");
  expect(Object.keys(handSnapshot(world))).not.toContain("cloth");
});

it("preserves the hand through shared retry and clears it on seat reset", () => {
  const engine = currentSharedEngine();
  const both = (request) => {
    const result = dispatchShared(request);
    expect(JSON.parse(engine.cardShared(JSON.stringify(request)))).toEqual(
      result,
    );
    return result;
  };
  const world = table();
  const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
  const view = both({ op: "view", world, ...seats });
  const action = view.actions.find(
    (a) => a.kind === "give" && a.item === "bell" && a.target === "keeper",
  );
  const request = { op: "play", world, action, ...seats };
  const result = both(request);
  expect(result.ok, result.error).toBe(true);
  expect(result.world.actors.keeper.heldItem).toBe("bell");
  expect(both(structuredClone(request))).toEqual(result);
  expect(both({ ...request, world: result.world }).ok).toBe(false);
  const reset = both({ ...seats, world: result.world, op: "reset" });
  expect(reset.ok, reset.error).toBe(true);
  expect(reset.world.actors.vale.heldItem).toBeNull();
  expect(reset.world.actors.keeper.heldItem).toBe("bell");
  const old = both({ op: "create", save: encodeSave(createWorld()) }).world;
  old.items.mask.holder = "mara";
  old.actors.mara.heldItem = "mask";
  const upgraded = both({ ...seats, world: old, op: "upgrade", from: "full-card-world/2" });
  expect(upgraded.world.items.mask.holder).toBe(old.actors.mara.place);
  expect(upgraded.world.actors.mara.heldItem).toBeNull();
  expect(decodeSave(encodeSave(upgraded.world)).actors).toEqual(upgraded.world.actors);
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
