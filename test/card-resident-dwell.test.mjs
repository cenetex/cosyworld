// Rules 133: a resident that arrives at a place stays there a while before it
// makes another move of its own (v2/card-game/world/dwell.mjs). The worlds are
// the small forest ones the accompany tests use: Pip, Vale and the pond.
import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { cardPlay } from "../v2/card-game/cards.mjs";
import { lifeHome } from "../v2/card-game/resident-home.mjs";
import {
  DWELL_SPREAD,
  DWELL_TURNS,
  MAX_DWELL,
  startDwell,
  validDwell,
} from "../v2/card-game/world/dwell.mjs";

const want = (place, since = 0) => ({
  kind: "place",
  target: place,
  since,
  refusals: 0,
});
const wait = (s) => {
  const a = legalActions(s).find((x) => x.kind === "wait" && !x.sleep);
  const done = play(s, a, s.revision);
  expect(done.ok, done.error).toBe(true);
  return done.state;
};
// Pip with Vale at the station, Pip wanting the pond.
function together() {
  const s = createWorld();
  s.actors.moth.place = "station";
  s.items.lamp.holder = "vale";
  s.actors.moth.want = want("pond");
  return s;
}

describe("resident dwell", () => {
  it("sets a stay of DWELL_TURNS to MAX_DWELL when a resident arrives", () => {
    let s = together();
    expect(s.actors.moth.dwellUntil).toBeUndefined();
    s = wait(s);
    expect(s.actors.moth.place).toBe("pond");
    const stay = s.actors.moth.dwellUntil - s.turn;
    expect(stay).toBeGreaterThanOrEqual(DWELL_TURNS);
    expect(stay).toBeLessThanOrEqual(MAX_DWELL);
    expect(DWELL_SPREAD).toBeGreaterThan(1);
  });

  it("makes no move of its own until the stay is over", () => {
    let s = together();
    s.actors.moth.place = "pond";
    s.actors.vale.place = "pond";
    s.actors.moth.want = want("station");
    s.actors.moth.dwellUntil = s.turn + 10;
    const until = s.actors.moth.dwellUntil;
    const seen = [];
    for (let i = 0; i < 12; i++) {
      s = wait(s);
      seen.push([s.turn, s.actors.moth.place]);
    }
    for (const [turn, place] of seen)
      expect(place, `turn ${turn}`).toBe(turn < until ? "pond" : "station");
  });

  it("walks at once from a save without the field", () => {
    let s = together();
    s.actors.moth.place = "pond";
    s.actors.vale.place = "pond";
    s.actors.moth.want = want("station");
    s = decodeSave(encodeSave(s));
    expect(s.actors.moth.dwellUntil).toBeUndefined();
    expect(wait(s).actors.moth.place).toBe("station");
  });

  it("is deterministic and survives a save", () => {
    const run = () => {
      let s = together();
      for (let i = 0; i < 60; i++) s = wait(s);
      return s;
    };
    const a = run(),
      b = run();
    expect(encodeSave(a)).toBe(encodeSave(b));
    expect(encodeSave(decodeSave(encodeSave(a)))).toBe(encodeSave(a));
  });

  it("scatters the offset by resident and arrival turn", () => {
    const s = together();
    const stays = new Set();
    for (let turn = 1; turn < 40; turn++) {
      s.turn = turn;
      startDwell(s, "moth");
      stays.add(s.actors.moth.dwellUntil - turn);
    }
    expect(stays.size).toBeGreaterThan(1);
    for (const n of stays) {
      expect(n).toBeGreaterThanOrEqual(DWELL_TURNS);
      expect(n).toBeLessThan(DWELL_TURNS + DWELL_SPREAD);
    }
  });

  it("keeps a resident to about two moves a day over several days", () => {
    let s = together();
    const moves = [];
    let where = s.actors.moth.place;
    for (let i = 0; i < 144; i++) {
      s = wait(s);
      if (s.actors.moth.place !== where) {
        moves.push(s.turn);
        where = s.actors.moth.place;
      }
    }
    expect(moves.length).toBeGreaterThan(0);
    for (let i = 1; i < moves.length; i++)
      expect(moves[i] - moves[i - 1]).toBeGreaterThanOrEqual(DWELL_TURNS);
  });

  it("validates the saved field", () => {
    const s = together();
    s.actors.moth.dwellUntil = s.turn + 3;
    expect(validDwell(s)).toBe(true);
    expect(() => validateWorld(s)).not.toThrow();
    for (const bad of [-1, 0, 1.5, "7", s.turn + MAX_DWELL + 1]) {
      s.actors.moth.dwellUntil = bad;
      expect(validDwell(s), String(bad)).toBe(false);
      expect(() => validateWorld(s)).toThrow();
    }
  });
});

describe("what dwell does not hold back", () => {
  it("lets an invited resident come along at once", () => {
    const s = together();
    s.actors.moth.dwellUntil = s.turn + 20;
    const { action } = cardPlay(s, ["moth", "pond"]);
    expect(action).toMatchObject({ kind: "accompany", target: "moth" });
    const done = play(s, action, s.revision);
    expect(done.ok).toBe(true);
    expect(done.state.actors.moth.place).toBe("pond");
  });

  it("lets the player move on while a resident dwells", () => {
    const s = together();
    s.actors.moth.dwellUntil = s.turn + 20;
    const move = legalActions(s).find((a) => a.kind === "move");
    const done = play(s, move, s.revision);
    expect(done.ok).toBe(true);
    expect(done.state.actors.vale.place).toBe(move.target);
    expect(done.state.actors.vale.dwellUntil).toBeUndefined();
  });

  it("does not delay being put somewhere: a retreat lands at once", () => {
    // Placement by a fight or a story effect never asks the planner, so the
    // loser is where the rules put it and dwell only starts if it walks.
    const s = together();
    expect(s.actors.moth.dwellUntil).toBeUndefined();
    s.actors.moth.place = "pond";
    expect(validDwell(s)).toBe(true);
  });
});

describe("walking home is held like any other move", () => {
  it("waits out the stay, then walks home and clears the walk", () => {
    let s = together();
    s.actors.vale.place = "attic";
    s.actors.moth.place = "station";
    s.actors.moth.want = null;
    s.actors.moth.homeward = true;
    s.actors.moth.dwellUntil = s.turn + 6;
    s.peaceUntil.moth = 0;
    const until = s.actors.moth.dwellUntil;
    while (s.turn < until - 1) {
      s = wait(s);
      expect(s.actors.moth.place).toBe("station");
    }
    for (let i = 0; i < 4; i++) s = wait(s);
    expect(lifeHome("moth", s)).toBe("pond");
    expect(s.actors.moth.place).toBe("pond");
    expect(s.actors.moth.homeward).toBeUndefined();
  });
});

describe("sleep and dwell", () => {
  // Pip is asleep from turn 0 to 20 of each day after the first (nocturnal).
  const dayTwo = () => {
    const s = together();
    s.turn = s.revision = 48;
    s.actors.vale.place = "attic";
    s.actors.moth.want = null;
    return s;
  };
  it("keeps a resident away from home awake in its window", () => {
    let s = dayTwo();
    s.actors.moth.place = "station";
    s.actors.moth.dwellUntil = s.turn + 10;
    for (let i = 0; i < 8; i++) {
      s = wait(s);
      expect(s.actors.moth.sleeping).toBeUndefined();
      expect(s.actors.moth.place).toBe("station");
    }
  });
  it("walks home at the dwell pace and sleeps there, window still open", () => {
    let s = dayTwo();
    s.actors.moth.place = "station";
    s.actors.moth.dwellUntil = s.turn + 3;
    let slept = null;
    const left = [];
    for (let i = 0; i < 20 && !slept; i++) {
      s = wait(s);
      if (s.actors.moth.place !== "station") left.push(s.turn);
      if (s.actors.moth.sleeping) slept = s.actors.moth.sleeping.place;
    }
    expect(slept).toBe("pond");
    expect(left[0]).toBeGreaterThanOrEqual(48 + 3);
  });
});
