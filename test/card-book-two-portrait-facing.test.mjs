import { describe, it, expect } from "vitest";
import { portrait } from "../v2/card-game/scene.mjs";
import {
  nativePortraitFacing,
  flipStagePortrait,
  portraitFraming,
} from "../v2/card-game/portrait-facing.mjs";

// Native gaze was checked in each approved Book II image.
const cast = [
  ["greek-danaid-melia", "book-two-melia.png"],
  ["greek-danaid-nera", "book-two-nera.png"],
  ["greek-alcestis-alcestis", "book-two-alcestis.png"],
  ["greek-alcestis-heracles", "hero-heracles.png"],
  ["greek-alcestis-chloris", "book-two-chloris.png"],
  ["greek-heracles-megara", "book-two-megara.png"],
  ["greek-heracles-amphitryon", "book-two-amphitryon.png"],
  ["greek-heracles-heracles", "hero-heracles.png"],
  ["greek-heracles-theseus", "open-door-theseus.webp"],
  ["greek-trachis-deianira", "book-two-deianira.png"],
  ["greek-trachis-iole", "book-two-iole.png"],
  ["greek-trachis-hyllus", "book-two-hyllus.png"],
  ["greek-trachis-lichas", "book-two-lichas.png"],
  ["greek-trachis-heracles", "hero-heracles.png"],
];

describe("Book II portrait directions", () => {
  it.each(cast)("faces both stage positions for %s", (actor, file) => {
    const path = `assets/greek-drama/${file}`;
    expect(portrait(actor)).toBe(`./${path}`);
    for (const cutout of [path, `./${path}`]) {
      expect(nativePortraitFacing(cutout)).toBe("left");
      expect(flipStagePortrait(cutout, "left")).toBe(false);
      expect(flipStagePortrait(cutout, "right")).toBe(true);
      expect(portraitFraming(cutout)).toBe("standard");
    }
  });

  it("uses one Heracles portrait for the three separate accounts", () => {
    const paths = [
      "greek-alcestis-heracles",
      "greek-heracles-heracles",
      "greek-trachis-heracles",
    ].map((actor) => portrait(actor));
    expect(new Set(paths)).toEqual(
      new Set(["./assets/greek-drama/hero-heracles.png"]),
    );
  });
});
