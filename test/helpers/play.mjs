import { expect } from "vitest";
import {
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../../v2/card-game/world.mjs";

export const reload = (s) => decodeSave(encodeSave(s));

// The same LCG the long-run tests used, so their seeds keep their walks.
export function seeded(seed) {
  let state = seed >>> 0;
  return (n) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return n === undefined ? state : state % n;
  };
}

const matches = (pick) =>
  typeof pick === "function"
    ? pick
    : typeof pick === "string"
      ? (a) => a.kind === pick
      : (a) => Object.entries(pick).every(([key, value]) => a[key] === value);

// A legal play for `actor`, by kind, by fields ({ kind, target }) or by test.
export function legal(s, pick, actor = "vale") {
  const action = legalActions(s, actor).find(matches(pick));
  expect(action, `${actor}: ${typeof pick === "function" ? "play" : JSON.stringify(pick)}`).toBeDefined();
  return action;
}

export function act(s, pick, actor = "vale") {
  const result = play(s, legal(s, pick, actor), s.revision, actor);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}
