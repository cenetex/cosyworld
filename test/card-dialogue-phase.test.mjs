import { expect, it } from "vitest";
import { phase, THINKING_GRACE_MS } from "../v2/card-game/presentation.mjs";

const choosing = { raised: true, chosen: true };

it("decides what the dialogue box shows", () => {
  for (const [state, expected] of [
    [{}, "idle"],
    [{ raised: true }, "idle"],
    [choosing, "choosing"],
    // Clicking off folds the hand and deselects; a folded choice never shows.
    [{ chosen: true }, "idle"],
    // A play rests its choice until the player touches the hand again.
    [{ ...choosing, rested: true }, "idle"],
    // A typing line keeps its full card; the choice waits for it.
    [{ ...choosing, revealing: true }, "revealing"],
    [{ ...choosing, inFlight: true }, "thinking"],
    [{ revealing: true, inFlight: true }, "revealing"],
    // A later play also asks again for words that failed.
    [{ failed: true }, "failed"],
    [{ ...choosing, failed: true }, "choosing"],
    [{ failed: true, inFlight: true }, "thinking"],
    // Words past the grace for a committed play stop holding the hand: the
    // Thinking card stays, and a choice comes forward (a typing line still
    // keeps its card).
    [{ ...choosing, inFlight: true, lingering: true }, "choosing"],
    [{ inFlight: true, lingering: true }, "idle"],
    [
      { ...choosing, inFlight: true, lingering: true, revealing: true },
      "revealing",
    ],
    [{ inFlight: true, lingering: true, failed: true }, "failed"],
    [{ reviewing: true }, "reviewing"],
    [{ reviewing: true, failed: true }, "failed"],
    [{ ...choosing, reviewing: true }, "choosing"],
  ])
    expect(phase(state), JSON.stringify(state)).toBe(expected);
});

it("gives slow words only a short grace", () => {
  expect(THINKING_GRACE_MS).toBeGreaterThanOrEqual(4000);
  expect(THINKING_GRACE_MS).toBeLessThanOrEqual(6000);
});
