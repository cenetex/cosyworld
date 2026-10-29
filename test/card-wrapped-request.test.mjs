import { describe, expect, it } from "vitest";
import { createWorld, decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { availableCards, cardActions } from "../v2/card-game/cards.mjs";

const humans = ["vale", "mara"];
function seed({ trust = 1, full = false } = {}) {
  const save = enableMotives(createWorld(), {
    questPrograms: true,
    personalQuests: true,
  });
  save.sharedVersion = 1;
  save.actors.vale.place = "pond";
  save.actors.mara.place = "pond";
  save.actors.keeper.place = "pond";
  save.actors.moth.place = "station";
  save.actors.keeper.trust.mara = trust;
  save.items.bell.holder = "keeper";
  save.items.bell.ringing = 0;
  save.items.cloth.holder = "bell";
  save.items.lamp.holder = "mara";
  save.items.lamp.fuel = 12;
  save.items.lamp.lit = false;
  if (full) {
    save.items.oil.holder = "mara";
    save.items.mask.holder = "mara";
  }
  const result = dispatchShared({ op: "create", save: JSON.stringify(save) });
  expect(result.ok, result.error).toBe(true);
  return result.world;
}
function context(world, actor = "mara") {
  return {
    ...world,
    playerActorId: actor,
    controlledActors: humans,
    presentActors: humans,
  };
}
function view(world, actor = "mara") {
  const result = dispatchShared({
    op: "view",
    world,
    actor,
    claimed: humans,
    present: humans,
  });
  expect(result.ok, result.error).toBe(true);
  return result;
}
function choose(world, selected, predicate, actor = "mara") {
  const shown = cardActions(context(world, actor), selected).actions.find(
    predicate,
  );
  expect(
    shown,
    `${actor} needs a card action for ${selected.join(" + ")}`,
  ).toBeTruthy();
  const result = dispatchShared({
    op: "play",
    world,
    actor,
    claimed: humans,
    present: humans,
    action: shown,
  });
  expect(result.ok, result.error).toBe(true);
  return result.world;
}

describe("a covered cloth request", () => {
  it("shows the request and respects refusal", () => {
    const before = seed({ trust: 0 });
    const shown = cardActions(context(before), ["cloth", "keeper"]).actions;
    expect(
      shown.some(
        (a) => a.kind === "ask" && a.item === "cloth" && a.target === "keeper",
      ),
    ).toBe(true);
    const after = choose(before, ["cloth", "keeper"], (a) => a.kind === "ask");
    expect(after.items.cloth.holder).toBe("bell");
    expect(after.items.bell.holder).toBe("keeper");
    expect(
      after.log.some(
        (e) => e.verb === "ask" && e.itemId === "cloth" && e.accepted === false,
      ),
    ).toBe(true);
  });
  it("keeps a human owner's cloth until they choose to give it", () => {
    const before = seed();
    before.items.bell.holder = "vale";
    const after = choose(
      before,
      ["cloth", "vale"],
      (a) => a.kind === "ask" && a.item === "cloth",
    );
    expect(after.items.cloth.holder).toBe("bell");
    expect(after.items.bell.holder).toBe("vale");
    expect(
      after.log.some(
        (e) => e.verb === "ask" && e.itemId === "cloth" && e.accepted === false,
      ),
    ).toBe(true);
  });
  it("requires room for the cloth", () => {
    const before = seed({ full: true });
    expect(
      view(before).actions.some((a) => a.kind === "ask" && a.item === "cloth"),
    ).toBe(false);
  });
  it("honours consent, keeps the bell, and uses the recovered cloth to signal", () => {
    let world = seed();
    expect(availableCards(context(world))).toContain("cloth");
    const request = cardActions(context(world), [
      "cloth",
      "keeper",
    ]).actions.find((a) => a.kind === "ask" && a.item === "cloth");
    world = choose(
      world,
      ["cloth", "keeper"],
      (a) => a.kind === "ask" && a.item === "cloth",
    );
    const stale = dispatchShared({
      op: "play",
      world,
      actor: "mara",
      claimed: humans,
      present: humans,
      action: request,
    });
    expect(stale.ok).toBe(false);
    expect(stale.world).toEqual(world);
    expect(decodeSave(encodeSave(world))).toEqual(world);
    expect(world.items.cloth.holder).toBe("mara");
    expect(world.items.bell.holder).toBe("keeper");
    expect(
      world.log.some(
        (e) => e.verb === "ask" && e.itemId === "cloth" && e.accepted === true,
      ),
    ).toBe(true);
    world = choose(world, ["lamp"], (a) => a.kind === "light");
    for (let i = 0; i < 2; i++) {
      world = choose(world, ["cloth", "lamp"], (a) => a.kind === "cover");
      world = choose(world, ["cloth"], (a) => a.kind === "take");
    }
    expect(world.crossings["pond-greek-harbor"].discovered).toBe(true);
    expect(world.items.cloth.holder).toBe("mara");
    expect(world.items.lamp.holder).toBe("mara");
    expect(decodeSave(encodeSave(world))).toEqual(world);
  });
});
