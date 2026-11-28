import { describe, expect, it } from "vitest";
import "./helpers/still-cast.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { legalActions } from "../v2/card-game/world.mjs";
import { heldOf, newWant } from "../v2/card-game/want.mjs";
import { act } from "./helpers/play.mjs";

const wait = (s, actor) => act(s, (a) => a.kind === "wait" && !a.sleep && !a.guards, actor);
const sources = (s, who) => heldOf(s.actors[who]).map((w) => w.from);

describe("companions in a shared world", () => {
  it("holds a traveler's quest on their own Accept without moving or reserving its owner", () => {
    let w = dispatchShared({ op: "create", seed: 9 }).world;
    const seats = ["mara", "ash"];
    Object.assign(w, { controlledActors: seats, presentActors: seats });
    for (const id of [...seats, "moth"]) w.actors[id].place = "pond";
    w.actors.moth.trust.mara = 2;
    w.actors.moth.trust.ash = 2;
    w.actors.moth.want = newWant("place", "greek-courtyard", w.turn);
    for (const id of seats) w.actors[id].want = null;
    w = act(w, { kind: "talk", target: "moth" }, "ash");
    w = wait(w, "mara");
    expect(sources(w, "ash")).toEqual([]);
    expect(legalActions(w, "mara").some((a) => a.kind === "accept" && !a.box)).toBe(false);
    w.actors.moth.place = "pond";
    w = act(w, { kind: "accept", target: "moth" }, "ash");
    expect(sources(w, "ash")).toEqual(["quest:from:moth"]);
    expect(w.actors.ash.companion).toBeUndefined();
    expect(w.actors.mara.companion).toBeUndefined();
    expect(w.actors.moth.place).toBe("pond");
  });
});
