import { expect, it } from "vitest";
import {
  phase,
  refusalLabel,
  refusalSentence,
  THINKING_GRACE_MS,
} from "../v2/card-game/presentation.mjs";
import { WORLD_UPDATE } from "../v2/card-game/shared-auth.mjs";

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
    // Words past the grace for a committed play stop holding the hand: the
    // Thinking card stays, and a choice comes forward (a typing line still
    // keeps its card).
    [{ ...choosing, inFlight: true, lingering: true }, "choosing"],
    [{ inFlight: true, lingering: true }, "idle"],
    [
      { ...choosing, inFlight: true, lingering: true, revealing: true },
      "revealing",
    ],
    [{ reviewing: true }, "reviewing"],
    [{ ...choosing, reviewing: true }, "choosing"],
  ])
    expect(phase(state), JSON.stringify(state)).toBe(expected);
});

it("has no failed phase: words that fail are a silent line", () => {
  // An old caller's flag changes nothing; play is never held for words.
  expect(phase({ ...choosing, failed: true })).toBe("choosing");
  expect(phase({ failed: true })).toBe("idle");
});

it("gives slow words only a short grace", () => {
  expect(THINKING_GRACE_MS).toBeGreaterThanOrEqual(4000);
  expect(THINKING_GRACE_MS).toBeLessThanOrEqual(6000);
});

it("labels a refused play's button with the reason's first sentence", () => {
  expect(refusalLabel(WORLD_UPDATE)).toBe("Waiting for an update");
  expect(
    refusalLabel("That play has changed. Check the cards and choose again."),
  ).toBe("That play has changed");
  expect(refusalLabel("The room filled just now. Wait for a place.")).toBe(
    "The room filled just now",
  );
  expect(refusalLabel("")).toBe("Not played");
});

it("ends a refusal's status sentence with one mark", () => {
  expect(refusalSentence("Choose a current play.")).toBe(
    "Choose a current play.",
  );
  expect(refusalSentence("Is anyone there? Try again.")).toBe(
    "Is anyone there?",
  );
  expect(refusalSentence("Wait… then try again.")).toBe("Wait…");
  expect(refusalSentence("Not now!")).toBe("Not now.");
});
