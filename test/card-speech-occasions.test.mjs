import { selectLamp } from "./fixtures/card-attic-opening.mjs";
import { describe, expect, it, vi } from "vitest";
import {
  createWorld,
  legalActions,
  play,
  encodeSave,
  decodeSave,
} from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import {
  SPEECH_OCCASIONS,
  createNarrator,
  speechOccasions,
  narrativeContext,
  voicesNobody,
} from "../v2/card-game/narrative.mjs";
import { dialogueCast } from "../v2/card-game/scene-cast.mjs";
import speech from "../v2/card-game/speech.json" with { type: "json" };

const act = (s, kind, target) => {
  const action = legalActions(s).find(
    (a) =>
      a.kind === kind &&
      !a.sleep &&
      !a.guards &&
      (!target || a.target === target),
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
      speakers: ["vale"],
      scenery: true,
    });
    expect(occasions(act(s, "move", "station"))).toMatchObject({
      occasion: "action",
      speakers: ["vale"],
      scenery: false,
    });
  });

  it("speaks once per visit through other actions, reload and a short log", () => {
    let s = act(createWorld({ opening: true }), "wait");
    expect(occasions(s).speakers).toEqual(["vale"]);
    delete s.actors.vale.waitSpeech;
    s = decodeSave(encodeSave(s));
    expect(occasions(act(s, "wait")).speakers).toEqual([]);
    s = selectLamp(selectLamp(s), "lamp");
    for (let i = 0; i < 110; i++) s = act(s, "wait");
    s.log = s.log.slice(-10);
    s = act(decodeSave(encodeSave(s)), "wait");
    expect(occasions(s).speakers).toEqual([]);
    s = act(createWorld(), "wait");
    s = act(act(s, "move", "pond"), "move", "station");
    expect(occasions(act(s, "wait")).speakers).toEqual(["vale"]);
  });

  it("shares the same Wait and lamp voices with the authority", () => {
    let world = dispatchShared({ op: "create" }).world;
    for (const [kind, speakers] of [
      ["wait", ["vale"]],
      ["drop", ["vale"]],
      ["wait", []],
      ["take", ["vale"]],
    ]) {
      const action = legalActions(world).find(
        (a) => a.kind === kind && !a.sleep && (kind === "wait" || a.item === "lamp"),
      );
      const result = dispatchShared({
        op: "play",
        world,
        actor: "vale",
        claimed: ["vale"],
        present: ["vale"],
        action,
      });
      expect(result.ok).toBe(true);
      world = result.world;
      expect(world.speechVoices.vale).toEqual(speakers);
      expect(occasions(world).speakers).toEqual(speakers);
    }
  });

  it("asks for a private reflection after a quiet Wait", async () => {
    const world = act(act(createWorld({ opening: true }), "wait"), "wait");
    const request = vi.fn();
    const reflect = vi.fn(async () => ({ reflections: [] }));
    createNarrator({
      getWorld: () => world,
      request,
      reflect,
      apply: vi.fn(),
      status: () => {},
    }).changed();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(request).not.toHaveBeenCalled();
    expect(reflect).toHaveBeenCalledTimes(1);
    expect(reflect.mock.calls[0][0].resting).toBe("vale");
    world.opening.crossed = true;
    world.opening.met.moth = world.turn;
    world.actors.moth.place = "attic";
    expect(narrativeContext(world).resting).toBeNull();
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
