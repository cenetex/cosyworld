import { expect } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../../v2/card-game/world.mjs";
import { DAY_TURNS } from "../../v2/card-game/resident-home.mjs";
import { settleGuards } from "../../v2/card-game/resident-guard.mjs";
import {
  entityActive,
  latchRoutes,
  packPeople,
} from "../../v2/card-game/pack-registry.mjs";

export const reload = (s) => decodeSave(encodeSave(s));
// A full Greek world on its second day, Vale at `place`, the cast met.
export function lifeWorld({ seed = 7, turn = DAY_TURNS, place } = {}) {
  const s = createWorld({ seed, packScopes: { "greek-drama": "full" } });
  s.turn = s.revision = turn;
  if (place) s.actors.vale.place = place;
  for (const id of Object.keys(packPeople))
    if (id.startsWith("greek-") && entityActive(s, id))
      s.packs["greek-drama"].met[id] = 0;
  return reload(s);
}
// One legal play of `kind` (never a Guard, never a Sleep for "wait").
export function act(s, kind, fields = {}) {
  const action = legalActions(s).find(
    (a) =>
      a.kind === kind &&
      !a.guards &&
      (kind !== "wait" || !a.sleep) &&
      Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  expect(action, `${kind} ${JSON.stringify(fields)}`).toBeTruthy();
  const done = play(s, action, s.revision);
  expect(done.ok, done.error).toBe(true);
  return done.state;
}
export const wait = (s, n = 1) => {
  for (let i = 0; i < n; i++) s = act(s, "wait");
  return s;
};
export const waitUntil = (s, turn) => wait(s, Math.max(0, turn - s.turn));
// A gate whose condition was set by hand latches, and its guard stands
// aside, as the end of a play would do it (rules 100).
export const settleGate = (world) => {
  latchRoutes(world);
  settleGuards(world);
  return world;
};
