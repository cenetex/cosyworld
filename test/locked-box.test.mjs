import { describe, expect, it } from "vitest";
import { legalActions, play } from "../v2/card-game/world.mjs";
import { availableCards } from "../v2/card-game/cards.mjs";
import { createLockedBoxes, isLockedBox } from "../v2/card-game/locked-box.mjs";
import { seatActors } from "../v2/card-game/human-cast.mjs";
import { greekTravelTargets } from "./helpers/greek-travel.mjs";
import { openingFixture } from "./helpers/greek-opening.mjs";
import { settleGate } from "./helpers/world-life.mjs";

function act(s, kind, fields = {}) {
  const action = legalActions(s).find(
    (a) =>
      a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  const result = play(s, action, s.revision);
  expect(result.ok, `${kind} ${result.error}`).toBe(true);
  return result.state;
}
const walk = (s, place) =>
  greekTravelTargets(s.actors.vale.place, `greek-${place}`).reduce(
    (w, target) => act(w, "move", { target }),
    s,
  );

describe("locked boxes", () => {
  it("lock the sealed card alone until its quest opens the way", () => {
    let s = openingFixture("burial").decree;
    expect(availableCards(s).filter((id) => isLockedBox(s, id))).toEqual([
      "greek-battlefield",
    ]);
    s = act(s, "gate", { target: "greek-battlefield" });
    expect(isLockedBox(s, "greek-battlefield")).toBe(true);
    s = act(walk(s, "palace"), "take", { item: "greek-decree" });
    s = act(walk(s, "gate"), "give", {
      item: "greek-decree",
      target: "greek-guard",
    });
    expect(isLockedBox(s, "greek-battlefield")).toBe(false);
  });

  it("lock the same card for a shared seat, from the same world state", () => {
    // Shared play builds its client world from the server's world JSON
    // (sharedWorld in app.mjs), so a seated traveller sees the same box.
    const base = openingFixture("burial").decree;
    const shared = seatActors(
      { ...structuredClone(base), playerActorId: "mara" },
      ["mara"],
      ["mara"],
    );
    shared.actors.mara.place = "greek-gate";
    expect(isLockedBox(shared, "greek-battlefield")).toBe(true);
    expect(availableCards(shared)).toContain("greek-battlefield");
    shared.items["greek-creon-writ"].holder = "greek-guard";
    expect(isLockedBox(settleGate(shared), "greek-battlefield")).toBe(false);
  });

  it("turn over once, when next seen open, and never cover again", () => {
    const boxes = createLockedBoxes();
    expect(boxes.draw(["field"], [])).toEqual([]);
    expect(boxes.draw(["gate", "field"], ["field"])).toEqual([]);
    expect(boxes.draw(["gate", "field"], ["field"])).toEqual([]);
    expect(boxes.draw(["gate", "field", "field"], [])).toEqual(["field"]);
    expect(boxes.boxed("field")).toBe(false);
    expect(boxes.draw(["gate", "field"], [])).toEqual([]);
    // Opened while tucked in a stack or away, it turns when next seen.
    expect(boxes.draw(["gate"], ["way"])).toEqual([]);
    expect(boxes.draw(["gate"], [])).toEqual([]);
    expect(boxes.draw([], [])).toEqual([]);
    expect(boxes.draw(["gate", "way"], [])).toEqual(["way"]);
    // Locked again, it is a box again.
    boxes.draw(["way"], ["way"]);
    expect(boxes.draw(["way"], [])).toEqual(["way"]);
  });
});
