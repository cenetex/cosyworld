import { describe, it, expect } from "vitest";
import "./helpers/no-dwell.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { humanAvatarIds } from "../v2/card-game/human-cast.mjs";

const fresh = () => {
  const world = dispatchShared({ op: "create", seed: 7 }).world;
  for (const id of humanAvatarIds) {
    world.actors[id].want = null;
    delete world.actors[id].under;
  }
  return world;
};
const seat = (world, op = "view", extra = {}) =>
  dispatchShared({ world, op, actor: "vale", claimed: humanAvatarIds, present: ["vale"], ...extra });
const waitFor = (world) => {
  const wait = seat(world).actions.find((a) => a.kind === "wait" && !a.sleep);
  return seat(world, "play", { action: wait }).world;
};
const plays = (world, id, verb) =>
  world.log.filter((e) => e.actorId === id && e.kind === "action" && e.verb === verb);
const wantsCloth = (world, refusals = 1) => {
  world.actors.keeper.want = { kind: "item", target: "cloth", since: 0, refusals };
};

describe("a player's avatar can be fought anywhere but its home", () => {
  it("offers a standoff with an away avatar standing away from home", () => {
    const world = fresh();
    world.actors.vale.place = "station";
    world.actors.mara.place = "station";
    world.items.cloth.holder = "mara";
    const threat = seat(world).actions.find((a) => a.kind === "threaten" && a.target === "mara");
    expect(threat).toBeTruthy();
    const after = seat(world, "play", { action: threat }).world;
    expect(after.standoffs.map((c) => [c.challenger, c.defender])).toEqual([["vale", "mara"]]);
  });
  it("offers no standoff with an avatar at its own home", () => {
    const world = fresh();
    world.actors.mara.place = "attic";
    const view = dispatchShared({ world, op: "view", actor: "mara", claimed: humanAvatarIds, present: ["mara"] });
    const at = view.actions.filter((a) => a.target === "vale");
    expect(at.map((a) => a.kind)).toContain("talk");
    expect(at.some((a) => ["threaten", "attack"].includes(a.kind))).toBe(false);
  });
  it("lets a resident threaten an away avatar over an item it needs", () => {
    let world = fresh();
    world.actors.mara.place = "station";
    world.items.cloth.holder = "mara";
    wantsCloth(world);
    for (let i = 0; i < 4 && !plays(world, "keeper", "threaten").length; i++)
      world = waitFor(world);
    expect(plays(world, "keeper", "threaten").at(-1)?.targetId).toBe("mara");
  });
  it("has the away avatar fight back by the resident rules until one yields", () => {
    let world = fresh();
    world.actors.mara.place = "station";
    world.items.cloth.holder = "mara";
    wantsCloth(world);
    for (let i = 0; i < 20 && !(plays(world, "keeper", "threaten").length && !world.standoffs.length); i++)
      world = waitFor(world);
    expect(plays(world, "keeper", "attack").length).toBeGreaterThan(0);
    expect(plays(world, "mara", "attack").length).toBeGreaterThan(0);
    expect(world.standoffs).toEqual([]);
    expect(world.items.cloth.holder).not.toBe("mara");
    expect(world.actors.mara.place).not.toBe("station");
  });
  it("leaves an avatar at its home alone", () => {
    let world = fresh();
    world.actors.keeper.place = "attic";
    world.items.cloth.holder = "vale";
    wantsCloth(world);
    for (let i = 0; i < 6; i++) world = waitFor(world);
    expect(plays(world, "keeper", "ask").length).toBeGreaterThan(0);
    expect(plays(world, "keeper", "threaten")).toEqual([]);
    expect(world.items.cloth.holder).toBe("vale");
  });
});
