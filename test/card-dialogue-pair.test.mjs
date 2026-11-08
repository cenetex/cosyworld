import { describe, expect, it } from "vitest";
import {
  dialogueLineForPair,
  dialoguePairForLine,
  dialoguePairForTalk,
  validDialoguePairLine,
} from "../v2/card-game/dialogue-pair.mjs";

const state = () => ({
  actors: { vale: {}, guard: {}, antigone: {} },
  log: [
    {
      seq: 4,
      turn: 2,
      kind: "action",
      verb: "talk",
      actorId: "vale",
      targetId: "antigone",
      locationId: "gate",
    },
    {
      seq: 5,
      turn: 2,
      kind: "action",
      verb: "talk",
      actorId: "vale",
      targetId: "guard",
      locationId: "gate",
    },
  ],
});

describe("committed dialogue-pair attribution", () => {
  it("binds a line to its exact committed Talk, not a shared speaker", () => {
    const world = state();
    const talk = dialoguePairForTalk(world, world.log[0], ["vale", "antigone"]);
    expect(talk).toEqual({
      actors: ["antigone", "vale"],
      sourceActionSeq: 4,
      sourceTurn: 2,
    });
    expect(dialogueLineForPair(world, talk, "vale")).toMatchObject({
      actors: talk.actors,
      speakerId: "vale",
      addresseeId: "antigone",
    });
    expect(dialogueLineForPair(world, talk, "guard")).toBeNull();
    expect(
      dialoguePairForTalk(world, { ...world.log[0], targetId: "guard" }, [
        "vale",
        "guard",
      ]),
    ).toBeNull();
  });

  it("rejects forged or missing sources and ambiguous legacy lines", () => {
    const world = state();
    const line = {
      generated: true,
      kind: "dialogue",
      actorId: "vale",
      turn: 2,
      seq: 6,
      locationId: "gate",
    };
    expect(dialoguePairForLine(world, line)).toBeNull();
    const stamp = dialogueLineForPair(
      world,
      dialoguePairForTalk(world, world.log[0], ["vale", "antigone"]),
      "vale",
    );
    line.dialoguePair = stamp;
    expect(validDialoguePairLine(world, line)).toBe(true);
    expect(
      validDialoguePairLine(world, {
        ...line,
        dialoguePair: { ...stamp, actors: {} },
      }),
    ).toBe(false);
    line.dialoguePair.sourceActionSeq = 90;
    expect(validDialoguePairLine(world, line)).toBe(false);
    delete line.dialoguePair;
    world.log.pop();
    expect(dialoguePairForLine(world, line)).toMatchObject({
      actors: ["antigone", "vale"],
      addresseeId: "antigone",
    });
    world.log.push({
      seq: 5,
      turn: 2,
      kind: "action",
      verb: "talk",
      actorId: "vale",
      targetId: "guard",
      locationId: "gate",
    });
    expect(dialoguePairForLine(world, line)).toBeNull();
    world.log = [];
    expect(dialoguePairForLine(world, line)).toBeNull();
    line.dialoguePair = stamp;
    expect(validDialoguePairLine(world, line)).toBe(false);
  });
});
