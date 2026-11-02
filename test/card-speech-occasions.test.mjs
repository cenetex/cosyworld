import { describe, expect, it, vi } from "vitest";
import { createWorld, legalActions, play } from "../v2/card-game/world.mjs";
import {
  SPEECH_OCCASIONS,
  createNarrator,
  speechOccasions,
  voicesNobody,
} from "../v2/card-game/narrative.mjs";
import { dialogueCast } from "../v2/card-game/scene-cast.mjs";
import speech from "../v2/card-game/speech.json" with { type: "json" };

const act = (s, kind, target) => {
  const action = legalActions(s).find(
    (a) => a.kind === kind && (!target || a.target === target),
  );
  expect(action, `${kind} ${target || ""}`).toBeTruthy();
  return play(s, action).state;
};
const occasions = (s) => speechOccasions(s, dialogueCast(s));
// Vale and Pip at the station, with Pip holding the lamp.
const meeting = () => {
  const s = createWorld();
  s.actors.moth.place = "station";
  s.actors.keeper.place = "pond";
  s.items.lamp.holder = "moth";
  s.actors.moth.want = s.actors.keeper.want = null;
  s.actors.moth.metTurn = s.actors.keeper.metTurn = 0;
  s.turn = s.revision = 3;
  return s;
};

describe("speech occasions", () => {
  it("names who speaks for every occasion in the speech table", () => {
    expect(Object.keys(speech).sort()).toEqual([...SPEECH_OCCASIONS].sort());
  });

  it("voices Talk, a threat's target and a Wait in battle, and nothing else", () => {
    const s = meeting();
    expect(occasions(act(s, "talk", "moth"))).toMatchObject({
      occasion: "talk",
      speakers: ["vale", "moth"],
      scenery: false,
    });
    const threatened = act(s, "threaten", "moth");
    expect(occasions(threatened)).toMatchObject({
      occasion: "threatened",
      speakers: ["moth"],
    });
    // A round with no strike ends the battle; the Wait still speaks.
    const waited = act(threatened, "wait");
    expect(waited.standoffs).toEqual([]);
    expect(occasions(waited)).toMatchObject({
      occasion: "battle_wait",
      speakers: ["vale", "moth"],
    });
    expect(occasions(act(threatened, "attack", "moth")).speakers).toEqual([]);
  });

  it("captions only the opening and a first arrival", () => {
    let s = createWorld();
    expect(occasions(s)).toMatchObject({ occasion: "opening", scenery: true });
    s = act(s, "move", "pond");
    expect(occasions(s)).toMatchObject({
      occasion: "new_place",
      speakers: [],
      scenery: true,
    });
    expect(occasions(act(s, "move", "station"))).toMatchObject({
      occasion: null,
      speakers: [],
      scenery: false,
    });
  });

  it("sends no request for a silent scene and leaves the hand ready", async () => {
    const world = createWorld();
    world.turn = world.revision = 1;
    const request = vi.fn();
    const status = vi.fn();
    const started = vi.fn();
    const apply = vi.fn();
    const quiet = vi.fn();
    const silent = (context) => ({
      ...context,
      speakers: [],
      scenery: false,
      focus: null,
    });
    createNarrator({
      getWorld: () => world,
      apply,
      status,
      started,
      silent: quiet,
      request,
      limit: silent,
    }).changed();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(voicesNobody(started.mock.lastCall[0])).toBe(true);
    expect(request).not.toHaveBeenCalled();
    expect(status.mock.calls).toEqual([["ready"]]);
    expect(apply).not.toHaveBeenCalled();
    expect(quiet).toHaveBeenCalledTimes(1);
  });
});
