import { describe, expect, it } from "vitest";
import {
  carried,
  createWorld,
  itemPlace,
  legalActions,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { availableCards, cardActions } from "../v2/card-game/cards.mjs";

const players = ["vale", "mara"];
function shared(world, actor, op = "view", extra = {}) {
  return dispatchShared({
    op,
    world,
    actor,
    claimed: players,
    present: players,
    ...extra,
  });
}
function viewWorld(world, actor = "vale", present = players) {
  return {
    ...world,
    playerActorId: actor,
    controlledActors: players,
    presentActors: present,
  };
}
function sharedPlay(world, actor, kind, fields = {}) {
  const action = shared(world, actor).actions.find(
    (entry) =>
      entry.kind === kind &&
      Object.entries(fields).every(([key, value]) => entry[key] === value),
  );
  expect(
    action,
    `${actor} needs ${kind} ${JSON.stringify(fields)}`,
  ).toBeTruthy();
  const result = shared(world, actor, "play", { action });
  expect(result.ok, result.error).toBe(true);
  return result.world;
}
function seed() {
  const world = enableMotives(createWorld(), { personalQuests: true });
  world.sharedVersion = 1;
  world.actors.vale.place = world.actors.mara.place = "pond";
  world.actors.moth.place = world.actors.keeper.place = "station";
  world.items.bell.holder = "mara";
  world.items.cloth.holder = "bell";
  world.items.lamp.holder = "vale";
  const result = dispatchShared({ op: "create", save: JSON.stringify(world) });
  expect(result.ok, result.error).toBe(true);
  return result.world;
}
function localPlay(world, kind, fields = {}) {
  const action = legalActions(world).find(
    (entry) =>
      entry.kind === kind &&
      Object.entries(fields).every(([key, value]) => entry[key] === value),
  );
  expect(action).toBeTruthy();
  const result = play(world, action);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}

describe("capacity follows physical custody", () => {
  it("counts the wrapped cloth in a full recipient's hand while allowing them to uncover it", () => {
    const world = seed();
    world.items.mask.holder = "mara";
    validateWorld(world);
    expect(carried(world, "mara")).toEqual(
      expect.arrayContaining(["bell", "cloth", "mask"]),
    );
    expect(carried(world, "mara")).toHaveLength(3);
    expect(
      shared(world, "vale").actions.some(
        (a) => a.kind === "give" && a.item === "lamp" && a.target === "mara",
      ),
    ).toBe(false);
    expect(
      shared(world, "mara").actions.some(
        (a) => a.kind === "take" && a.item === "cloth",
      ),
    ).toBe(true);
  });

  it("opens one slot after a real drop and keeps a human owner's consent", () => {
    let world = seed();
    world.items.oil.holder = "vale";
    world.items["hoppycat-red-thread-spool"].holder = "vale";
    validateWorld(world);
    expect(carried(world, "vale")).toHaveLength(3);
    expect(
      shared(world, "vale").actions.some(
        (a) => a.kind === "ask" && a.item === "cloth" && a.target === "mara",
      ),
    ).toBe(false);
    world = sharedPlay(world, "vale", "drop", {
      item: "hoppycat-red-thread-spool",
    });
    expect(carried(world, "vale")).toHaveLength(2);
    expect(
      shared(world, "vale").actions.some(
        (a) => a.kind === "ask" && a.item === "cloth" && a.target === "mara",
      ),
    ).toBe(true);
    world = sharedPlay(world, "vale", "ask", { item: "cloth", target: "mara" });
    expect(world.items.cloth.holder).toBe("bell");
    expect(world.items.bell.holder).toBe("mara");
    expect(
      world.log.findLast(
        (e) => e.actorId === "vale" && e.verb === "ask" && e.itemId === "cloth",
      ).accepted,
    ).toBe(false);
    world = sharedPlay(world, "mara", "take", { item: "cloth" });
    world = sharedPlay(world, "mara", "give", {
      item: "cloth",
      target: "vale",
    });
    expect(world.items.cloth.holder).toBe("vale");
    expect(world.items.bell.holder).toBe("mara");
    expect(carried(world, "vale")).toHaveLength(3);
  });

  it("does not expose an absent human's held cards", () => {
    const world = seed();
    const absent = viewWorld(world, "vale", ["vale"]);
    expect(availableCards(absent)).not.toContain("mara");
    expect(availableCards(absent)).not.toContain("cloth");
    expect(cardActions(absent, ["cloth", "mara"]).actions).toEqual([]);
    const present = viewWorld(world);
    expect(availableCards(present)).toContain("mara");
    expect(
      cardActions(present, ["cloth", "mara"]).actions.some(
        (a) => a.kind === "ask" && a.item === "cloth",
      ),
    ).toBe(true);
  });

  it("counts a scarf as one item after its button is sewn inside", () => {
    let world = createWorld();
    world.actors.vale.place = "attic";
    world.items.cloth.holder = "attic";
    world = localPlay(world, "move", { target: "forest-cottage" });
    const record =
      world.packs["lonely-forest"].personalQuests["forest-rati-scarf"].records
        .vale;
    const button = record.button.id,
      scarf = record.reward.id;
    world.actors.vale.place = itemPlace(world, button);
    world = localPlay(world, "take", { item: button });
    world.actors.vale.place = "forest-cottage";
    world = localPlay(world, "give", { item: button, target: "rati" });
    expect(world.items[button].holder).toBe(scarf);
    world.actors.vale.place = "pond";
    world.items.lamp.holder = "vale";
    world.items.oil.holder = "pond";
    world.items["hoppycat-red-thread-spool"].holder = "pond";
    validateWorld(world);
    expect(carried(world, "vale")).toEqual(
      expect.arrayContaining([scarf, "lamp"]),
    );
    expect(carried(world, "vale")).not.toContain(button);
    expect(carried(world, "vale")).toHaveLength(2);
    expect(
      legalActions(world).some((a) => a.kind === "take" && a.item === "oil"),
    ).toBe(true);
    world.items["hoppycat-red-thread-spool"].holder = "vale";
    validateWorld(world);
    expect(carried(world, "vale")).toHaveLength(3);
    expect(
      legalActions(world).some((a) => a.kind === "take" && a.item === "oil"),
    ).toBe(false);
    expect(legalActions(world).some((a) => a.item === button)).toBe(false);
  });
});
