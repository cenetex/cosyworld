import { describe, it, expect } from "vitest";
import { cardObservation } from "../v2/card-game/cards.mjs";
import { createWorld, encodeSave } from "../v2/card-game/world.mjs";
import { handFocusId, revealedBeat } from "../v2/card-game/presentation.mjs";
import { withPending } from "../v2/card-game/beats.mjs";

describe("where focus rests in the hand after a play", () => {
  const frames = [
    { id: "station" },
    { id: "vale" },
    { id: "lamp", holder: "vale", hidden: true },
    { id: "moth" },
    { id: "cloth", holder: "moth", hidden: true },
    { id: "bell", hidden: true },
    { id: "pond" },
  ];
  it("stays on the played card when it shows", () => {
    expect(handFocusId(frames, ["station", "moth"])).toBe("moth");
  });
  it("goes to the visible holder of a hidden held item", () => {
    expect(handFocusId(frames, ["moth", "lamp"])).toBe("vale");
    expect(handFocusId(frames, ["cloth"])).toBe("moth");
  });
  it("goes to the nearest visible card when the card has no visible holder", () => {
    expect(handFocusId(frames, ["bell"])).toBe("pond");
    const stacked = [{ id: "a" }, { id: "b", holder: "c", hidden: true }, { id: "c", hidden: true }];
    expect(handFocusId(stacked, ["b"])).toBe("a");
  });
  it("falls back through earlier choices, then the first visible card", () => {
    expect(handFocusId(frames, ["pond", "gone"])).toBe("pond");
    expect(handFocusId(frames, ["gone"])).toBe("station");
    expect(handFocusId(frames, [undefined])).toBe("station");
  });
  it("tries the chosen card, then the last focused card, then the avatar", () => {
    expect(handFocusId(frames, ["vale", "pond", "moth"])).toBe("moth");
    expect(handFocusId(frames, ["vale", "pond"])).toBe("pond");
    expect(handFocusId(frames, ["vale", "gone"])).toBe("vale");
    expect(handFocusId(frames, ["vale", undefined])).toBe("vale");
    expect(handFocusId([{ id: "lamp", hidden: true }], ["lamp"])).toBeUndefined();
  });
});
describe("reading saved words with revealed cards", () => {
  const beat = {
    key: "line:12",
    speakerId: "vale",
    line: { seq: 12, text: "I saw the Lamp.", speaker: "Vale", sig: "signed" },
    actions: [{ seq: 11, text: "Vale took the Lamp." }],
  };
  it("keeps signed history intact and silences a masked line", () => {
    const saved = JSON.stringify(beat);
    const shown = revealedBeat(beat, (text) => text?.replace("Lamp", "something"));
    expect(shown.line.text).toBe("I saw the something.");
    expect(shown.line.silent).toBe(true);
    expect(shown.actions[0].text).toBe("Vale took the something.");
    expect(shown.key).toBe(beat.key);
    expect(JSON.stringify(beat)).toBe(saved);
  });
  it("restores the original words and voice when the card is revealed", () => {
    const shown = revealedBeat(beat, (text) => text);
    expect(shown.line.text).toBe(beat.line.text);
    expect(shown.line.silent).toBeFalsy();
    expect(shown.line.sig).toBe("signed");
    expect(shown.actions).toEqual(beat.actions);
    expect(revealedBeat({ ...beat, line: null }, (text) => text).line).toBeNull();
  });
  it("masks an effect folded into the Thinking card", () => {
    const { pending } = withPending([{ ...beat, line: null, turn: 2 }], {
      speakerId: "vale", turn: 2,
    });
    const shown = revealedBeat(pending, (text) => text?.replace("Lamp", "something"));
    expect(shown.pending).toBe(true);
    expect(shown.actions[0].text).toBe("Vale took the something.");
    expect(pending.actions[0].text).toBe("Vale took the Lamp.");
  });
});

describe("observable card descriptions", () => {
  it("describes the flame without revealing fuel arithmetic", () => {
    const world = createWorld();
    world.items.lamp.lit = true;
    for (const [fuelRooms, flame] of [
      [1, "A low flame"], [2, "A smaller flame"], [3, "A steady flame"],
    ]) {
      world.items.lamp.fuelRooms = fuelRooms;
      world.items.lamp.fuel = fuelRooms * 4;
      expect(cardObservation(world, "lamp").startsWith(`${flame}.`)).toBe(true);
      expect(cardObservation(world, "lamp")).not.toMatch(
        /\d|fuel|turn|signal/i,
      );
    }
    world.items.lamp.lit = false;
    expect(cardObservation(world, "lamp")).toMatch(/^Unlit\./);
  });
  it("describes sound and the cloth without counting down", () => {
    const world = createWorld();
    world.items.bell.ringing = 3;
    expect(cardObservation(world, "bell")).toMatch(/^Ringing\./);
    world.items.bell.ringing = 1;
    expect(cardObservation(world, "bell")).not.toMatch(/\d|left|again/);
    world.items.cloth.holder = "bell";
    expect(cardObservation(world, "bell")).toMatch(
      /^Silent\. Covered by Black cloth/,
    );
    expect(cardObservation(world, "cloth")).toBe("On Bell.");
  });
  it("does not disclose hidden ritual phases", () => {
    const world = createWorld();
    const before = cardObservation(world, "pond");
    for (const phase of [0, 1, 2, 3, 4]) {
      world.locations.pond.shipSignal = phase;
      expect(cardObservation(world, "pond")).toBe(before);
    }
  });
  it("never treats a person's internal progress as visible description", () => {
    const world = createWorld();
    const before = cardObservation(world, "vale");
    world.actors.vale.xp = 99;
    world.actors.vale.want = { kind: "place", target: "pond", since: 0, refusals: 0 };
    expect(cardObservation(world, "vale")).toBe(before);
    expect(before).not.toMatch(/quest|level|want|inspiration|hope|\d/i);
  });
  it("does not change the world or spend a turn", () => {
    const world = createWorld();
    const before = encodeSave(world);
    for (const id of ["lamp", "cloth", "bell", "oil", "vale", "pond"])
      cardObservation(world, id);
    expect(encodeSave(world)).toBe(before);
  });
});
