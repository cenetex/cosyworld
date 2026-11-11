// Dwell (rules 133): a resident that arrives at a place stays there a while
// before it makes another move of its own. `dwellUntil` is the first turn it
// may walk on, saved on the actor so a replay agrees. There is no clock and
// no random: the stay is DWELL_TURNS plus a stable offset from the resident's
// id and arrival turn, so a cast arriving together does not leave together.
//
// Dwell holds back the moves a resident chooses: walking for a want, roaming,
// drifting home with nothing to pursue, and the dawn and dusk steps. It never
// holds back a walk home that something forced (a lost fight, being scattered,
// bedtime), stepping off a docked ship, a companion following its traveller,
// an authored journey, or anything a player does to or with the resident:
// those moves never ask the planner's dwell test.
// A leaf module: want.mjs reads MAX_DWELL, so it imports nothing. The caller
// says whether world life is on and whether the resident is on a journey.

// Story and liveness suites written for a cast that walks at once turn dwell
// off (test/helpers/no-dwell.mjs). The rules never change it.
export const dwellRule = { on: true };

// The least a resident stays after arriving: half the 48-turn day, so it
// makes at most two moves of its own a day (owner, 2026-11-11).
export const DWELL_TURNS = 24;
// The offset is 0 to DWELL_SPREAD - 1 more, so a stay is 24 to 29 turns.
export const DWELL_SPREAD = 6;
export const MAX_DWELL = DWELL_TURNS + DWELL_SPREAD - 1;

// FNV-1a over the resident and the arrival turn.
function scatter(id, turn) {
  let h = 2166136261;
  for (const ch of `${id}@${turn}`) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % DWELL_SPREAD;
}
// A resident just arrived: it may move again after its stay.
export function startDwell(s, id) {
  s.actors[id].dwellUntil = s.turn + DWELL_TURNS + scatter(id, s.turn);
}
// Still staying: no move of its own yet. A save without the field never
// dwells.
export const dwelling = (s, id) => (s.actors[id]?.dwellUntil ?? 0) > s.turn;

// Courtesy (rules 133): after a human Talks, Asks, Gives, Trades with a
// resident, or is refused an Accompany, it makes no move of its own for
// ATTEND_TURNS more turns while a human is still in the room. Many in a row
// cannot strand it: `attend = {since, until}` holds at most ATTEND_CAP turns
// from the first, and the next hold can begin once twice that has passed.
export const ATTEND_TURNS = 2;
export const ATTEND_CAP = DWELL_TURNS;
export function startAttend(s, id) {
  const a = s.actors[id],
    t = s.turn;
  if (!a.attend || t >= a.attend.since + 2 * ATTEND_CAP)
    a.attend = { since: t, until: t + ATTEND_TURNS };
  else a.attend.until = Math.min(t + ATTEND_TURNS, a.attend.since + ATTEND_CAP);
}
export const attending = (s, id) => (s.actors[id]?.attend?.until ?? 0) > s.turn;

// A saved `dwellUntil` is a whole turn no later than one stay from now.
export const validDwell = (s) =>
  Object.values(s.actors).every(
    (a) =>
      (a.dwellUntil === undefined ||
        (Number.isSafeInteger(a.dwellUntil) &&
          a.dwellUntil > 0 &&
          a.dwellUntil <= s.turn + MAX_DWELL)) &&
      (a.attend === undefined ||
        (Object.keys(a.attend).sort().join() === "since,until" &&
          Number.isSafeInteger(a.attend.since) &&
          Number.isSafeInteger(a.attend.until) &&
          a.attend.since >= 0 &&
          a.attend.since <= s.turn &&
          a.attend.until > a.attend.since &&
          a.attend.until <= a.attend.since + ATTEND_CAP)),
  );
