// The Guard (rules 100): a standing Wait that bars a guardable way. The Gate
// Guard guards by default from world-life.json; a player guards with a Wait
// aimed at the way. The far card shows as the locked box, and the button
// names the guard (sealedWays in world.mjs).
import { packPeople, entityActive, packRouteOpen } from "./pack-registry.mjs";
import {
  humanAvatar,
  humanAvatarIds,
  humanPresent,
  controlledByHuman,
} from "./human-cast.mjs";
import { life, lifeField, lifeHome } from "./resident-home.mjs";

// --- Guard ---------------------------------------------------------------

// Built on first use: pack-registry is still loading when this module is.
let guardable = null,
  returns = null,
  residentGuards = null,
  guardians = null;
function guardData() {
  if (guardable) return;
  guardable = new Map();
  returns = new Map();
  for (const { from, to } of life.guardable || []) {
    if (!guardable.has(from)) guardable.set(from, new Set());
    guardable.get(from).add(to);
    if (!returns.has(to)) returns.set(to, new Set());
    returns.get(to).add(from);
  }
  // Residents who guard by default, from data, at their home.
  residentGuards = Object.keys(life.residents || {})
    .filter(
      (id) => lifeField(id, "guards") && packPeople[id] && !humanAvatar(id),
    )
    .sort();
  guardians = [...residentGuards, ...humanAvatarIds];
}
export const guardableWays = (place) => {
  guardData();
  return [...(guardable.get(place) || [])];
};
export const isGuardable = (from, to) => {
  guardData();
  return Boolean(guardable.get(from)?.has(to));
};
export const guardPost = (id) =>
  lifeField(id, "guards") && !humanAvatar(id)
    ? { from: lifeHome(id), to: lifeField(id, "guards") }
    : null;
// The way's gate is open: latched for good, or a live gate whose condition
// holds now (rules 102), such as a guard who no longer holds his order.
export const wayLifted = (s, from, to) => packRouteOpen(s, from, to);
// The ways a guard adds to a place: a guardable way is one way, both
// directions, open but for its guard. The rest is the pack's own routes.
export function guardedExits(_s, place) {
  guardData();
  return [...(guardable.get(place) || []), ...(returns.get(place) || [])];
}
// The guarded way between `from` and `to`, either way round, as the guard's
// own [post, beyond], or null.
const guardedWay = (from, to) =>
  isGuardable(from, to)
    ? [from, to]
    : isGuardable(to, from)
      ? [to, from]
      : null;
// Who bars the way from `from` to `to`, in either direction, for
// `traveller`, or null. The guard stands at his post and bars both entry and
// return. A resident guard bars everyone; a player's guard bars residents
// only, and only while its player is here. Nobody is barred by their own
// guard, so a guard knocked through always walks home.
export function guardOf(s, from, to, traveller = null) {
  const way = guardedWay(from, to);
  if (!way) return null;
  const [post, beyond] = way;
  for (const id of guardians) {
    const a = s.actors[id];
    if (
      id === traveller ||
      a?.guarding !== beyond ||
      a.place !== post ||
      !entityActive(s, id)
    )
      continue;
    if (!humanAvatar(id)) return id;
    if (humanPresent(s, id) && !(traveller && controlledByHuman(s, traveller)))
      return id;
  }
  return null;
}
// The ways shut by a guard from where a traveller stands, for the locked
// box: both directions of each guardable way at that place.
export const guardedFrom = (place) => guardedExits(null, place);
const inStandoff = (s, id) =>
  (s.standoffs || []).some((c) => Object.hasOwn(c.resolve || {}, id));
// After every round: a resident guard stands at its post unless lifted or
// fighting, and re-guards when it walks home; a player's guard lapses when
// its player leaves or stands elsewhere.
export function settleGuards(s) {
  guardData();
  for (const id of residentGuards) {
    const a = s.actors[id],
      post = guardPost(id);
    if (!a) continue;
    if (
      a.place === post.from &&
      entityActive(s, id) &&
      !wayLifted(s, post.from, post.to) &&
      !inStandoff(s, id)
    )
      a.guarding = post.to;
    else delete a.guarding;
  }
  for (const id of humanAvatarIds) {
    const a = s.actors[id];
    if (
      a?.guarding !== undefined &&
      (!humanPresent(s, id) ||
        !isGuardable(a.place, a.guarding) ||
        inStandoff(s, id))
    )
      delete a.guarding;
  }
  return s;
}

// A guard names the place beyond the way: its own post for a resident, any
// guardable way for a player.
export function validGuard(s, places) {
  for (const [id, a] of Object.entries(s.actors)) {
    if (a.guarding === undefined) continue;
    const post = guardPost(id);
    if (
      !Object.hasOwn(places, a.guarding) ||
      (post ? post.to !== a.guarding : !humanAvatar(id))
    )
      return false;
  }
  return true;
}
