import { describe, expect, it } from "vitest";
import { onlinePlayers } from "../v2/card-game/toolbar.mjs";

function snapshot() {
  return {
    actor: "mara",
    claimed: [1, 1, 1, 0, 0, 0, 0, 0],
    present: [1, 1, 0, 1, 0, 0, 0, 0],
    world: {
      actors: {
        vale: { place: "station" },
        mara: { place: "pond" },
        ash: { place: "belfry" },
        nell: { place: "glasshouse" },
        keeper: { place: "station" },
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
      self: true,
      location: "Black pond",
    });
    expect(rows[1]).toMatchObject({
      name: "Vale",
      self: false,
      location: "Empty station",
    });
  });
  it("follows movement and expired presence in fresh snapshots", () => {
    const state = snapshot();
    state.world.actors.vale.place = "pond";
    expect(onlinePlayers(state)[1].location).toBe("Black pond");
    state.present[0] = 0;
    expect(onlinePlayers(state).map(({ id }) => id)).toEqual(["mara"]);
    state.present[1] = 0;
    expect(onlinePlayers(state)).toEqual([]);
  });
  it("handles an empty snapshot and a place awaiting a label", () => {
    expect(onlinePlayers({})).toEqual([]);
    const state = snapshot();
    state.world.actors.vale.place = "new-place";
    expect(onlinePlayers(state)[1].location).toBe("Exploring the world");
  });
});
