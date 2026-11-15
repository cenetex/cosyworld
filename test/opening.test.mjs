import { describe, expect, it } from "vitest";
import { createWorld, exits, play, placeText } from "../v2/card-game/world.mjs";
import { cardPlay, lockWords } from "../v2/card-game/cards.mjs";
import { isLockedBox } from "../v2/card-game/locked-box.mjs";
import { backdrop } from "../v2/card-game/scene.mjs";

describe("a new world's opening", () => {
  const world = createWorld({ opening: true });

  it("shows the Black pond as a locked box whose words name the pair", () => {
    expect(isLockedBox(world, "pond")).toBe(true);
    expect(lockWords(world, "pond", () => true)).toBe("Bring Lamp to Mirror attic");
    expect(exits(world, "attic")).toEqual([]);
    expect(cardPlay(world, ["lamp"]).action).toBeFalsy();
    expect(cardPlay(world, ["lamp"]).hint).toBe(
      "Pair with a person to give it, or this place to put it down.",
    );
  });

  it("opens the mirror with the ordinary Put down play, which pays like any box", () => {
    const { action } = cardPlay(world, ["lamp", "attic"]);
    expect(action).toMatchObject({ kind: "drop", item: "lamp", target: "attic" });
    const result = play(world, action, world.revision);
    expect(result.ok).toBe(true);
    const next = result.state;
    expect(next.turn).toBe(1);
    expect(next.items.lamp.holder).toBe("attic");
    expect(next.opened).toEqual({ pond: ["vale"] });
    expect(isLockedBox(next, "pond")).toBe(false);
    expect(exits(next, "attic")).toEqual(["pond"]);
    expect(placeText(next, "attic")).toContain("opens onto a black shore");
    expect(backdrop("attic", world)).toContain("attic-lit");
    expect(backdrop("attic", next)).toContain("attic-doused");
    expect(next.log.map((e) => e.text)).toContain(
      "The attic mirror opens a path to the pond. A dark shore waits through the glass.",
    );
    expect(cardPlay(next, ["pond"]).action).toMatchObject({ kind: "move", target: "pond" });
  });

  it("closes the mirror again when the lamp is taken up lit", () => {
    const down = play(world, cardPlay(world, ["lamp", "attic"]).action, world.revision).state;
    const taken = play(down, cardPlay(down, ["lamp"]).action, down.revision).state;
    expect(taken.items.lamp).toMatchObject({ holder: "vale", lit: true });
    expect(exits(taken, "attic")).toEqual([]);
  });
});
