// A shared world belongs to everyone in it, so its messages never ask one
// player for a fresh start or a New game (2026-11-01).
import { describe, expect, it } from "vitest";
import { sharedError } from "../v2/card-game/shared.mjs";

describe("a shared world that cannot load", () => {
  it("waits for an update instead of asking for a New game", () => {
    const error = sharedError(
      new Error(
        "This save needs a fresh start. Your previous save is kept until you choose New game.",
      ),
    );
    expect(error.message).not.toMatch(/fresh start|New game|saved game/);
    expect(error.message).toMatch(/kept/);
  });

  it("passes every other message through", () => {
    const error = new Error("Sign in with your passkey.");
    expect(sharedError(error)).toBe(error);
  });
});
