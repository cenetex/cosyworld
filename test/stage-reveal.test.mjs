import { describe, expect, it, vi } from "vitest";
import {
  STAGE_REVEAL_MS,
  fadeInRevealed,
  revealedStage,
} from "../v2/card-game/stage-reveal.mjs";

describe("the revealed stage", () => {
  it("shows only revealed figures and things", () => {
    const covered = (id) => ["pip", "lamp"].includes(id);
    expect(
      revealedStage(
        {
          cast: ["vale", "pip", "moth"],
          floorItems: [{ id: "lamp" }, { id: "cloth", lit: false }],
        },
        covered,
      ),
    ).toEqual({
      cast: ["vale", "moth"],
      floorItems: [{ id: "cloth", lit: false }],
    });
  });

  it("opens a new world on its player alone", () => {
    const shown = new Set(["vale"]);
    expect(
      revealedStage({ cast: ["vale", "moth"] }, (id) => !shown.has(id)),
    ).toEqual({ cast: ["vale"], floorItems: [] });
  });

  it("fades a revealed figure in, or shows it at once under reduced motion", () => {
    const element = { animate: vi.fn(() => "fade") };
    expect(fadeInRevealed(element)).toBe("fade");
    expect(element.animate.mock.calls[0][1].duration).toBe(STAGE_REVEAL_MS);
    expect(fadeInRevealed(element, { reduced: true })).toBe(null);
    expect(element.animate).toHaveBeenCalledTimes(1);
  });
});
