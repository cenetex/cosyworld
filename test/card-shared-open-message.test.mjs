// A shared world belongs to everyone in it, so its messages never ask one
// player for a fresh start or a New game (2026-11-01).
import { describe, expect, it, vi } from "vitest";
import { sharedError } from "../v2/card-game/shared.mjs";
import { playerText } from "../v2/card-game/shared-auth.mjs";

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

  // The server names where the rules refused a save. The trace goes to the
  // console; the menu and the table show one sentence (2026-11-01).
  it("keeps the rules' trace out of the player's sentence", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const refusal =
      "This save needs a fresh start. Your previous save is kept until you choose New game. (validateWorld:7217 < decodeSave:7333 < load:7661 < dispatchShared:7748)";
    const text = playerText(refusal);
    expect(text).not.toMatch(/validateWorld|fresh start|New game|\(/);
    expect(text).toMatch(/kept/);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("validateWorld:7217"),
    );
    warn.mockRestore();
    expect(playerText("Use a fresh play request.")).toBe(
      "Use a fresh play request.",
    );
  });

  it("passes every other message through", () => {
    const error = new Error("Sign in with your passkey.");
    expect(sharedError(error)).toBe(error);
  });
});
