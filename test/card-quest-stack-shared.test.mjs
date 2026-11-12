import { describe, expect, it } from "vitest";
import "./helpers/still-cast.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { legalActions, play } from "../v2/card-game/world.mjs";
import { heldOf, newWant } from "../v2/card-game/want.mjs";

// Rules 134: in a shared world another traveler's quest is held in this play,
// but a companion is bound only for the traveler who acts. The residents here
// stand still (still-cast) so the asker is where the quest was told.
const wait = (s, actor) => {
  const action = legalActions(s, actor).find((a) => a.kind === "wait" && !a.sleep && !a.guards);
  expect(action).toBeTruthy();
  const result = play(s, action, s.revision, actor);
  expect(result.ok, result.error).toBe(true);
  return result.state;
};
const sources = (s, who) => heldOf(s.actors[who]).map((w) => w.from);

describe("companions in a shared world", () => {
  it("holds another traveler's quest in this play but binds only the acting one", () => {
    let w = dispatchShared({ op: "create", seed: 9 }).world;
    const seats = ["mara", "ash"];
    Object.assign(w, { controlledActors: seats, presentActors: seats });
    for (const id of [...seats, "moth"]) w.actors[id].place = "pond";
    w.actors.moth.trust.mara = 2;
    w.actors.moth.trust.ash = 2;
    w.actors.moth.want = newWant("place", "greek-courtyard", w.turn);
    w.actors.ash.heard = { moth: "place:greek-courtyard" };
    for (const id of seats) w.actors[id].want = null;
    w = wait(w, "mara");
    // Ash's escort quest stands and is held in Mara's play; Pip does not go
    // with Ash yet, and goes with nobody else.
    expect(sources(w, "ash")).toEqual(["quest:from:moth"]);
    expect(w.actors.ash.companion).toBeUndefined();
    expect(w.actors.mara.companion).toBeUndefined();
    // When Ash next acts, the bond forms.
    w.actors.moth.place = "pond";
    w = wait(w, "ash");
    expect(w.actors.ash.companion).toBe("moth");
    expect(w.actors.mara.companion).toBeUndefined();
  });
});
