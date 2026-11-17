import { describe, it, expect } from "vitest";
import {
  createWorld,
  play,
  legalActions,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { unplayedAvatar } from "../v2/card-game/human-cast.mjs";

const fresh = () => dispatchShared({ op: "create", seed: 7 }).world;
const seat = (world, claimed, present, op = "view", extra = {}) =>
  dispatchShared({ world, op, actor: "vale", claimed, present, ...extra });
const waitFor = (world, claimed, present) => {
  const wait = seat(world, claimed, present).actions.find(
    (a) => a.kind === "wait" && !a.sleep,
  );
  return seat(world, claimed, present, "play", { action: wait }).world;
};
const outside = (world) => {
  world.actors.vale.place = "attic";
  world.actors.mara.place = "pond";
  world.actors.mara.want = {
    kind: "place",
    target: "station",
    since: world.turn,
    refusals: 0,
  };
  return world;
};

describe("avatars nobody plays live as residents", () => {
  it("draws an unclaimed avatar a want and walks it there away from players", () => {
    const world = fresh();
    expect(world.actors.mara.want).not.toBeNull();
    const next = waitFor(outside(world), ["vale"], ["vale"]);
    expect(next.actors.mara.place).toBe("station");
    expect(
      next.log.some((e) => e.actorId === "mara" && e.verb === "move"),
    ).toBe(true);
  });
  it("takes its belonging to leave its home for a want outside", () => {
    let world = fresh();
    expect(world.actors.mara.place).toBe("theatre");
    world.actors.mara.want = {
      kind: "place",
      target: world.doors.theatre,
      since: world.turn,
      refusals: 0,
    };
    world = waitFor(world, ["vale"], ["vale"]);
    expect(world.items.mask.holder).toBe("mara");
    world = waitFor(world, ["vale"], ["vale"]);
    expect(world.actors.mara.place).toBe(world.doors.theatre);
  });
  it("lets players and residents trade with an unclaimed avatar", () => {
    const world = outside(fresh());
    world.actors.vale.place = "pond";
    world.items.mask.holder = "mara";
    world.items.cloth.holder = "vale";
    const view = seat(world, ["vale"], ["vale"]);
    expect(
      view.actions.some((a) => a.kind === "trade" && a.receive === "mask"),
    ).toBe(true);
    expect(
      view.actions.some((a) => a.kind === "ask" && a.target === "mara"),
    ).toBe(true);
    const seated = seat(world, ["vale", "mara"], ["vale"]);
    expect(
      seated.actions.some((a) => a.kind === "trade" && a.receive === "mask"),
    ).toBe(false);
    world.actors.moth.place = "pond";
    world.items.cloth.holder = "moth";
    const loaded = seat(world, ["vale"], ["vale"], "validate").world;
    loaded.heldActors = ["vale"];
    loaded.controlledActors = ["vale"];
    loaded.presentActors = ["vale"];
    expect(unplayedAvatar(loaded, "mara")).toBe(true);
    expect(
      legalActions(loaded, "moth").some(
        (a) => a.kind === "trade" && a.receive === "mask",
      ),
    ).toBe(true);
  });
  it("stops its own plays the round a human claims it", () => {
    const claimed = waitFor(outside(fresh()), ["vale", "mara"], ["vale", "mara"]);
    expect(claimed.actors.mara.place).toBe("pond");
    expect(claimed.log.some((e) => e.actorId === "mara")).toBe(false);
    const away = waitFor(outside(fresh()), ["vale", "mara"], ["vale"]);
    expect(away.actors.mara.place).toBe("station");
  });
  it("never plays the local traveller on its own", () => {
    let world = enableMotives(createWorld({ opening: true, seed: 7 }));
    const start = world.actors.vale.place;
    for (let i = 0; i < 30; i++) {
      const wait = legalActions(world, "vale").find(
        (a) => a.kind === "wait" && !a.sleep,
      );
      world = play(world, wait, world.revision, "vale").state;
    }
    expect(world.actors.vale.place).toBe(start);
    expect(
      world.log.filter((e) => e.actorId === "vale" && e.verb && e.verb !== "wait"),
    ).toEqual([]);
    expect(unplayedAvatar(world, "vale")).toBe(false);
  });
});
