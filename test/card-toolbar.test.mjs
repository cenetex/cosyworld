import { describe, expect, it } from "vitest";
import { onlinePlayers } from "../v2/card-game/toolbar.mjs";

const proved = (n) => ({
  proved: Array.from({ length: n }, (_, i) => `arcanum-${i}`),
  did: [],
});
function snapshot() {
  return {
    actor: "mara",
    claimed: [1, 1, 1, 0, 0, 0, 0, 0],
    present: [1, 1, 0, 1, 0, 0, 0, 0],
    world: {
      actors: {
        vale: { place: "station", xp: 0 },
        mara: { place: "pond", xp: 6, arcana: proved(4) },
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
      level: 0,
      self: false,
    });
  });
  it("keeps locations private while levels and online status update", () => {
    const state = snapshot();
    const before = onlinePlayers(state);
    state.world.actors.vale.place = "pond";
    expect(onlinePlayers(state)).toEqual(before);
    state.world.actors.vale.arcana = proved(3);
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
