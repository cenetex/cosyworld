import { describe, expect, it } from "vitest";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { legalActions, validateWorld } from "../v2/card-game/world.mjs";
import { humanAvatarIds } from "../v2/card-game/human-cast.mjs";
import { beginHistory } from "../v2/card-game/world/history.mjs";
import { DAY_TURNS } from "../v2/card-game/resident-home.mjs";
import { changes, refusal, startWorld } from "../v2/scripts/world-history.mjs";

const RESIDENT = "whiskerwind";
const CREON = "greek-creon";
const lived = (start, edit) => {
  const end = structuredClone(start);
  end.turn = end.revision = 2 * DAY_TURNS;
  end.eventSeq = start.eventSeq + 3;
  edit(end);
  return end;
};
const event = (seq, text) => ({ seq, turn: 1, kind: "event", text });

describe("a new world begins with history", () => {
  it("applies the kept changes, starts its clock there and keeps only the opening's lines", () => {
    const start = startWorld(5);
    start.actors[RESIDENT].dwellUntil = 1;
    const end = lived(start, (s) => {
      s.actors[RESIDENT].xp = 6;
      s.actors[RESIDENT].want = null;
      delete s.actors[RESIDENT].dwellUntil;
      s.memories["forest-garden"].events.push(event(start.eventSeq, "World: Whiskerwind sings."));
    });
    const world = beginHistory(structuredClone(start), changes(start, end, new Set()));
    expect(world.turn).toBe(2 * DAY_TURNS);
    expect(world.began).toBe(world.turn);
    expect(world.actors[RESIDENT].xp).toBe(6);
    expect(world.actors[RESIDENT].want).toBe(null);
    expect(world.actors[RESIDENT]).not.toHaveProperty("dwellUntil");
    expect(world.memories["forest-garden"].events.at(-1).text).toBe("World: Whiskerwind sings.");
    expect(world.log.map((e) => e.text)).toEqual(start.log.map((e) => e.text));
    expect(world.log.every((e) => e.turn === world.turn)).toBe(true);
    expect(() => validateWorld(world)).not.toThrow();
  });

  it("forgets what happened in the player's own scene", () => {
    const start = startWorld(5);
    const seq = start.eventSeq;
    const end = lived(start, (s) => {
      s.memories["forest-garden"].events.push(event(seq, "World: Vale waits one turn."));
    });
    expect(changes(start, end, new Set([seq])).some(([path]) => path[0] === "memories")).toBe(false);
  });

  it("leaves Thebes as it was authored", () => {
    const start = startWorld(5);
    const end = lived(start, (s) => {
      s.actors[CREON].xp += 6;
      s.actors[CREON].place = "greek-well";
      s.actors[CREON].want = null;
      s.actors["greek-guard"].trust["greek-antigone"] = 3;
    });
    const world = beginHistory(structuredClone(start), changes(start, end, new Set()));
    expect({ ...world.actors[CREON], want: null }).toEqual({ ...start.actors[CREON], want: null });
    expect(world.actors[CREON].want).toEqual({ ...start.actors[CREON].want, since: world.turn });
    expect(world.actors["greek-guard"].trust).toEqual(start.actors["greek-guard"].trust);
    expect(
      refusal(start, lived(start, (s) => (s.actors[RESIDENT].trust[CREON] = 2)), new Set()),
    ).toBe(`history changed trust in ${CREON}`);
  });

  it("refuses a history that touches the player's start", () => {
    const start = startWorld(5);
    const cases = [
      [(s) => (s.items.lamp.holder = RESIDENT), "history moved lamp"],
      [(s) => (s.actors.vale.xp = 3), "history changed vale"],
      [(s) => (s.actors[RESIDENT].trust.moth = 2), "history changed trust in moth"],
      [(s) => (s.opening.crossed = true), "history changed opening"],
    ];
    for (const [edit, reason] of cases)
      expect(refusal(start, lived(start, edit), new Set())).toBe(reason);
    expect(refusal(start, lived(start, (s) => (s.actors[RESIDENT].xp = 6)), new Set())).toBe(null);
  });

  it("gives an asked-for world its history and leaves the player's start as it was", () => {
    const fresh = dispatchShared({ op: "create", seed: 4242 }).world;
    const world = dispatchShared({ op: "create", seed: 4242, history: true }).world;
    expect(fresh.turn).toBe(0);
    expect(fresh).not.toHaveProperty("began");
    expect(world.began).toBe(world.turn);
    expect(world.turn % DAY_TURNS).toBe(0);
    for (const id of humanAvatarIds) expect(world.actors[id].place).toBe(fresh.actors[id].place);
    expect(world.actors.vale.xp ?? 0).toBe(fresh.actors.vale.xp ?? 0);
    expect(world.opening).toEqual(fresh.opening);
    expect(world.items.lamp).toEqual(fresh.items.lamp);
    expect(world.log.map((e) => e.text)).toEqual(fresh.log.map((e) => e.text));
    const keys = (s) => legalActions(s, "vale").map((a) => a.key).sort();
    expect(keys(world)).toEqual(keys(fresh));
  });
});
