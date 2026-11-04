import { describe, expect, it } from "vitest";
import {
  SWAP_BEAT_MS,
  SWAP_EXIT_STAGGER_MS,
  SWAP_FACE_MS,
  SWAP_MS,
  nearestFirst,
  swapTiming,
} from "../v2/card-game/card-swap.mjs";
import { EXIT_MS } from "../v2/card-game/card-exit.mjs";
import { ENTRY_MS, entryDelays } from "../v2/card-game/card-entry.mjs";

const frame = (id) => ({
  id,
  dataset: {},
  querySelector: () => ({ dataset: { card: id } }),
});

describe("card swap", () => {
  it("lets the old cards fall, holds a beat, then deals the new", () => {
    const { exits, entryAt } = swapTiming(3, 1);
    expect(exits).toEqual([0, 1, 2].map((i) => i * SWAP_EXIT_STAGGER_MS));
    expect(entryAt).toBe(2 * SWAP_EXIT_STAGGER_MS + EXIT_MS + SWAP_BEAT_MS);
  });

  it("ends every swap within SWAP_MS", () => {
    for (let leaving = 0; leaving <= 6; leaving++)
      for (let entering = 0; entering <= 8; entering++) {
        const { entryAt, end } = swapTiming(leaving, entering);
        const last = entering ? entryDelays(entering).at(-1) + ENTRY_MS : 0;
        expect(entryAt + last).toBeLessThanOrEqual(SWAP_MS);
        expect(end).toBeLessThanOrEqual(SWAP_MS);
      }
  });

  it("waits for exits that started late, and fades faces within the swap", () => {
    expect(swapTiming(0, 1, 700).entryAt).toBe(SWAP_MS - ENTRY_MS);
    expect(swapTiming(0, 0).faceAt).toBe(0);
    expect(swapTiming(6, 0).faceAt).toBe(SWAP_MS - SWAP_FACE_MS);
  });

  it("lets the cards nearest the player's own go first", () => {
    const row = ["moth", "vale", "lamp", "bell", "station"].map(frame);
    const leaving = row.filter((f) => f.id !== "vale");
    expect(nearestFirst(leaving, row, "vale").map((f) => f.id)).toEqual([
      "moth",
      "lamp",
      "bell",
      "station",
    ]);
  });
});
