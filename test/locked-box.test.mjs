import { describe, expect, it } from "vitest";
import { createWorld, legalActions, play } from "../v2/card-game/world.mjs";
import { availableCards } from "../v2/card-game/cards.mjs";
import {
  createLockedBoxes,
  isLockedBox,
  lockedQuest,
} from "../v2/card-game/locked-box.mjs";
import { seatActors } from "../v2/card-game/human-cast.mjs";
import { greekTravelTargets } from "./helpers/greek-travel.mjs";
import { openingFixture } from "./helpers/greek-opening.mjs";
import { settleGate } from "./helpers/world-life.mjs";
import { questsOf } from "../v2/card-game/want.mjs";

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
  it("keeps recipe contents concealed until the box opens", () => {
    const s = createWorld();
    s.actors.vale.place = "greek-harbor";
    const before = JSON.stringify(s);
    for (const id of ["greek-provisions", "greek-bread"])
      expect(lockedQuest(s, id)).toEqual({ text: "A closed box.", cards: [] });
    expect(JSON.stringify(s)).toBe(before);
    s.usedUp = s.usedUp.filter((id) => id !== "greek-provisions");
    expect(lockedQuest(s, "greek-provisions")).toBeNull();
  });
  it("keeps a sealed way concealed", () => {
    const s = createWorld();
    s.packs["greek-drama"].scope = "full";
    s.actors.vale.place = "greek-battlefield";
    expect(lockedQuest(s, "greek-cithaeron")).toEqual({
      text: "A closed box.",
      cards: [],
    });
  });
  it("lock the sealed card alone until its quest opens the way", () => {
    let s = openingFixture("burial").decree;
    expect(availableCards(s).filter((id) => isLockedBox(s, id))).toEqual([
      "greek-battlefield",
    ]);
    expect(lockedQuest(s, "greek-battlefield")).toEqual({
      text: "A closed box.",
      cards: [],
    });
    // A guarded card gives no quest of its own; Talk with the guard gives
    // his (rules 102).
    expect(legalActions(s).some((a) => a.kind === "gate")).toBe(false);
    s = act(s, "talk", { target: "greek-guard" });
    expect(questsOf(s, "vale")).toContainEqual(
      expect.objectContaining({ kind: "item", target: "greek-bread" }),
    );
    expect(isLockedBox(s, "greek-battlefield")).toBe(true);
    // The bread buys the decree, the decree Creon's writ, and the writ in
    // the guard's hands opens the way.
    s = act(walk(s, "courtyard"), "take", { item: "greek-bread" });
    s = act(walk(s, "gate"), "trade", {
      item: "greek-bread",
      receive: "greek-decree",
    });
    expect(isLockedBox(s, "greek-battlefield")).toBe(true);
    s = act(walk(s, "palace"), "trade", {
      item: "greek-decree",
      receive: "greek-creon-writ",
    });
    s = act(walk(s, "gate"), "give", {
      item: "greek-creon-writ",
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
