import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";

// The saved log is validated on load. Rules 133 retired every earlier save
// (docs/current-game.md), so there is no rules-128 record to lift: the log is
// built here by play on the current rules, then edited the way a forged or
// corrupt save would be.
function played() {
  let world = createWorld({ seed: 7 });
  for (let i = 0; i < 2; i++) {
    const action = legalActions(world).find((a) => a.kind === "wait");
    expect(action, "the opening offers Wait").toBeDefined();
    const result = play(world, action, world.revision);
    expect(result.ok, result.error).toBe(true);
    world = result.state;
  }
  return world;
}

describe("saved history is validated on load", () => {
  it("round-trips a played log without rewriting it", () => {
    const original = played();
    const loaded = decodeSave(encodeSave(original));
    expect(loaded.log).toEqual(original.log);
    expect(loaded.eventSeq).toBe(original.eventSeq);
    expect(decodeSave(encodeSave(loaded))).toEqual(loaded);
  });

  it("rejects an unknown historical verb or invalid event sequence", () => {
    const world = played();
    const target = world.log.findLast((entry) => entry.verb);
    expect(target, "the played log names a verb").toBeDefined();
    const badVerb = structuredClone(world);
    badVerb.log.findLast((entry) => entry.verb).verb = "invented-action";
    expect(() => decodeSave(JSON.stringify(badVerb))).toThrow(/fresh start/);
    const badSequence = structuredClone(world);
    const entry = badSequence.log.findLast((e) => e.seq !== undefined);
    expect(entry, "the played log carries a sequence").toBeDefined();
    entry.seq = 0;
    expect(() => decodeSave(JSON.stringify(badSequence))).toThrow(
      /fresh start/,
    );
  });
});
