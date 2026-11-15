import { describe, expect, it } from "vitest";
import "./helpers/still-cast.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { legalActions, play } from "../v2/card-game/world.mjs";
import { heldOf, newWant } from "../v2/card-game/want.mjs";

const wait = (s, actor) => {
  const action = legalActions(s, actor).find((a) => a.kind === "wait" && !a.sleep && !a.guards);
  expect(action).toBeTruthy();
  const result = play(s, action, s.revision, actor);
  expect(result.ok, result.error).toBe(true);
  return result.state;
};
const sources = (s, who) => heldOf(s.actors[who]).map((w) => w.from);

const act = (s, actor, pick) => {
  const action = legalActions(s, actor).find(pick);
  expect(action).toBeTruthy();
  const result = play(s, action, s.revision, actor);
  expect(result.ok, result.error).toBe(true);
  return result.state;
};

describe("companions in a shared world", () => {
  it("holds a traveler's quest only on their own Accept, and binds only them", () => {
    let w = dispatchShared({ op: "create", seed: 9 }).world;
    const seats = ["mara", "ash"];
    Object.assign(w, { controlledActors: seats, presentActors: seats });
    for (const id of [...seats, "moth"]) w.actors[id].place = "pond";
    w.actors.moth.trust.mara = 2;
    w.actors.moth.trust.ash = 2;
    w.actors.moth.want = newWant("place", "greek-courtyard", w.turn);
    for (const id of seats) w.actors[id].want = null;
    w = act(w, "ash", (a) => a.kind === "talk" && a.target === "moth");
    w = wait(w, "mara");
    expect(sources(w, "ash")).toEqual([]);
    expect(legalActions(w, "mara").some((a) => a.kind === "accept")).toBe(false);
    w.actors.moth.place = "pond";
    w = act(w, "ash", (a) => a.kind === "accept" && a.target === "moth");
    expect(sources(w, "ash")).toEqual(["quest:from:moth"]);
    expect(w.actors.ash.companion).toBe("moth");
    expect(w.actors.mara.companion).toBeUndefined();
  });
});
