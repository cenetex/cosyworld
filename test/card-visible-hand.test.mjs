import { expect, it } from "vitest";
import { availableCards, cardObservation, cardPlay } from "../v2/card-game/cards.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  play,
} from "../v2/card-game/world.mjs";
import { settleHeldItems } from "../v2/card-game/held-item.mjs";

function meeting() {
  const world = createWorld();
  world.actors.keeper.place = world.actors.vale.place;
  world.items.bell.holder = "vale";
  world.items.cloth.holder = "vale";
  world.items.oil.holder = "keeper";
  world.actors.keeper.want = {
    kind: "item",
    target: "bell",
    since: 0,
    refusals: 0,
  };
  settleHeldItems(world);
  return world;
}

it("shows the NPC's received hand, keeps the player's inventory, and reloads custody", () => {
  const before = meeting();
  expect(availableCards(before)).toEqual(
    expect.arrayContaining(["lamp", "bell", "cloth", "oil"]),
  );
  const result = play(before, cardPlay(before, ["bell", "keeper"]).action);
  expect(result.ok, result.error).toBe(true);
  const world = decodeSave(encodeSave(result.state));
  expect(world.items.bell.holder).toBe("keeper");
  expect(world.items.oil.holder).toBe("keeper");
  expect(availableCards(world)).toEqual(
    expect.arrayContaining(["lamp", "cloth", "bell"]),
  );
  expect(availableCards(world)).not.toContain("oil");
  expect(cardPlay(world, ["bell"]).action?.kind).toBe("ask");
  expect(cardPlay(world, ["cloth", "bell"]).action?.kind).toBe("trade");
});

it("preserves other human players' inventories while residents show one hand", () => {
  const world = meeting();
  world.sharedVersion = 1;
  world.actors.mara.place = world.actors.vale.place;
  world.items.oil.holder = world.items.cloth.holder = "mara";
  world.controlledActors = world.presentActors = ["vale", "mara"];
  settleHeldItems(world);
  expect(availableCards(world)).toEqual(
    expect.arrayContaining(["oil", "cloth"]),
  );
  world.controlledActors = world.presentActors = ["vale"];
  expect(availableCards(world)).toContain(world.actors.mara.heldItem);
  expect(
    availableCards(world).filter((id) => ["oil", "cloth"].includes(id)),
  ).toHaveLength(1);
});

it("keeps an NPC's covering on its held item and shows empty hands after loss", () => {
  const world = meeting();
  world.items.lamp.holder = "keeper";
  world.items.cloth.holder = "lamp";
  world.actors.keeper.heldItem = "lamp";
  expect(availableCards(world)).toContain("lamp");
  expect(availableCards(world)).not.toContain("cloth");
  world.items.lamp.holder = world.items.oil.holder = "attic";
  settleHeldItems(world);
  expect(world.actors.keeper.heldItem).toBeNull();
  expect(availableCards(world)).not.toContain("oil");
});

it("keeps a concealed covering unnamed in the held item details", () => {
  const world = meeting();
  world.items.cloth.holder = "lamp";
  expect(cardObservation(world, "lamp", id => id !== "cloth")).toContain("Covered by a closed card");
  expect(cardObservation(world, "lamp")).toContain("Covered by Black cloth");
});
