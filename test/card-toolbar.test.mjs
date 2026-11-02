import { describe, expect, it } from "vitest";
import { localPlayer, onlinePlayers } from "../v2/card-game/toolbar.mjs";
import { createLandingWorld } from "../v2/card-game/pack-landing.mjs";

function snapshot() {
  return {
    actor: "mara",
    claimed: [1, 1, 1, 0, 0, 0, 0, 0],
    present: [1, 1, 0, 1, 0, 0, 0, 0],
    world: {
      actors: {
        vale: { place: "station", xp: 0 },
        mara: { place: "pond", xp: 6 },
        ash: { place: "belfry", xp: 0 },
        nell: { place: "glasshouse", xp: 0 },
        keeper: { place: "station", xp: 0 },
      },
    },
  };
}

describe("players in the shared world", () => {
  it("shows present human claims with the current player first", () => {
    const rows = onlinePlayers(snapshot());
    expect(rows.map(({ id }) => id)).toEqual(["mara", "vale"]);
    expect(rows[0]).toMatchObject({
      name: "Mara",
      level: 4,
      self: true,
    });
    expect(rows[1]).toMatchObject({
      name: "Vale",
      level: 1,
      self: false,
    });
  });
  it("keeps locations private while levels and online status update", () => {
    const state = snapshot();
    const before = onlinePlayers(state);
    state.world.actors.vale.place = "pond";
    expect(onlinePlayers(state)).toEqual(before);
    state.world.actors.vale.xp = 3;
    expect(onlinePlayers(state)[1].level).toBe(3);
    expect(onlinePlayers(state).every((row) => !("location" in row))).toBe(
      true,
    );
    state.present[0] = 0;
    expect(onlinePlayers(state).map(({ id }) => id)).toEqual(["mara"]);
    state.present[1] = 0;
    expect(onlinePlayers(state)).toEqual([]);
  });
  it("handles an empty snapshot and keeps unknown places private", () => {
    expect(onlinePlayers({})).toEqual([]);
    const state = snapshot();
    state.world.actors.vale.place = "new-place";
    expect(onlinePlayers(state)[1]).not.toHaveProperty("location");
    expect(onlinePlayers(state)[1]).not.toHaveProperty("home");
  });
});

describe("the player in a local world", () => {
  it("is the avatar the world belongs to, with that avatar's level", () => {
    const world = { ...createLandingWorld(null, 7), playerActorId: "mara" };
    world.actors.mara.level = 3;
    world.actors.vale.level = 1;
    expect(localPlayer(world)).toMatchObject({
      id: "mara",
      name: "Mara",
      level: 3,
      self: true,
    });
  });
  it("is Vale in Vale's original save", () => {
    const world = createLandingWorld(null, 7);
    expect(localPlayer(world)).toMatchObject({ id: "vale", name: "Vale" });
  });
});
