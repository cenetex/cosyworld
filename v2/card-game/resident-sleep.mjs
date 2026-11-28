// Authored bedtimes scatter by run seed, with Pip and Nix active at night.
import { packPeople } from "./pack-registry.mjs";
import { humanAvatar } from "./human-cast.mjs";
import { runHash } from "./pack-rules.mjs";
import { DAY_TURNS, life, lifeField, worldLife } from "./resident-home.mjs";

// Bedtimes and rise times scatter by up to this many turns either way.
export const SLEEP_SCATTER = 3;

// Clock times can span midnight. Null disables sleep, and away avatars use the default.
export function sleepSchedule(id) {
  const mine = lifeField(id, "sleep");
  if (mine !== undefined) return mine;
  const pack = !humanAvatar(id) && packPeople[id]?.packId;
  return life.packs?.[pack]?.sleep ?? life.defaults.sleep;
}
const scatter = (s, key) =>
  (runHash(s, key) % (2 * SLEEP_SCATTER + 1)) - SLEEP_SCATTER;
// The sleep that begins on day `day`, in world turns, scattered by the seed.
export function sleepWindow(s, id, day) {
  const z = sleepSchedule(id);
  if (!z) return null;
  const start = day * DAY_TURNS + z.from + scatter(s, `sleep:${id}:${day}`),
    end =
      (z.to > z.from ? day : day + 1) * DAY_TURNS +
      z.to +
      scatter(s, `wake:${id}:${day}`);
  return end > start ? { start, end } : null;
}
// Residents stay awake through a new world's first day.
export function bedtime(s, id) {
  if (s.turn < DAY_TURNS || !worldLife.on) return null;
  const day = Math.floor(s.turn / DAY_TURNS);
  for (const d of [day - 1, day]) {
    const w = sleepWindow(s, id, d);
    if (w && w.start <= s.turn && s.turn < w.end) return w;
  }
  return null;
}
export const residentAsleep = (s, id) =>
  s.actors[id]?.sleeping?.until !== undefined;

// `slept` preserves the last bedtime of a `{since, place, until}` sleep so early risers stay awake.
const whole = (n) => Number.isSafeInteger(n);
export function validSleep(s, places) {
  for (const a of Object.values(s.actors)) {
    if (a.slept !== undefined && (!whole(a.slept) || a.slept > s.turn))
      return false;
    const z = a.sleeping;
    if (z?.until !== undefined)
      if (
        Object.keys(z).sort().join() !== "place,since,until" ||
        !whole(z.since) ||
        z.since > s.turn ||
        !whole(z.until) ||
        z.until <= z.since ||
        z.until - z.since > DAY_TURNS ||
        !Object.hasOwn(places, z.place)
      )
        return false;
  }
  return true;
}
