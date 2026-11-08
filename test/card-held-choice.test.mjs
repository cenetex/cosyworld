import { expect, it } from "vitest";
import { createWorld, decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import {
  applyHeldChoice,
  chooseHeldItem,
  handSnapshot,
  heldItem,
  settleHeldItems,
} from "../v2/card-game/held-item.mjs";

it("keeps an explicitly stowed item through settlement and save reload", () => {
  const world = createWorld();
  world.items.lamp.holder = "vale";
  chooseHeldItem(world, "vale", "lamp");
  expect(heldItem(world, "vale")).toBe("lamp");
  chooseHeldItem(world, "vale", null);
  settleHeldItems(world);
  expect(heldItem(world, "vale")).toBeNull();
  expect(decodeSave(encodeSave(world)).actors.vale.heldItem).toBeNull();
  expect(world.items.lamp.holder).toBe("vale");
});

it("keeps legacy missing-choice repair distinct from an explicit empty hand", () => {
  const world = createWorld();
  world.items.lamp.holder = "vale";
  delete world.actors.vale.heldItem;
  settleHeldItems(world);
  expect(heldItem(world, "vale")).toBe("lamp");
  chooseHeldItem(world, "vale", null);
  const before = handSnapshot(world);
  world.items.bell.holder = "vale";
  settleHeldItems(world, before);
  expect(heldItem(world, "vale")).toBe("bell");
});

it.each(["missing", "toString", "__proto__", {}, undefined, 7])(
  "refuses invalid choices without mutation: %j",
  (item) => {
    const world = createWorld(),
      before = structuredClone(world);
    expect(() => chooseHeldItem(world, "vale", item)).toThrow();
    expect(world).toEqual(before);
  },
);

it("cannot hold someone else's item or a nested covering", () => {
  const world = createWorld();
  world.items.lamp.holder = "keeper";
  expect(() => chooseHeldItem(world, "vale", "lamp")).toThrow();
  world.items.lamp.holder = "vale";
  world.items.cloth.holder = "lamp";
  expect(() => chooseHeldItem(world, "vale", "cloth")).toThrow();
  expect(() => chooseHeldItem(world, "missing", null)).toThrow();
});

it("changes only held choice and revision without spending a turn", () => {
  const world = createWorld();
  world.items.lamp.holder = "vale";
  const before = structuredClone(world);
  applyHeldChoice(world, "vale", { item: "lamp", revision: world.revision });
  before.actors.vale.heldItem = "lamp";
  before.revision += 1;
  expect(world).toEqual(before);
  expect(() =>
    applyHeldChoice(world, "vale", {
      item: null,
      revision: world.revision - 1,
    }),
  ).toThrow();
  expect(world).toEqual(before);
});
