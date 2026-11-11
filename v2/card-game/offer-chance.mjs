// Whether a resident offers the traveler a quest (rules 133, #2605). After the
// first Talk, "talking has a chance to unlock a quest from a resident" (owner,
// 2026-11-11). The chance is rolled once per resident per visit, at Talk, and
// kept in the traveler's saved `offered` record:
//
//   offered: { [resident]: { at: place, day: n, open: boolean } }
//
// The record holds until either of them leaves `at` or a day passes, so
// pressing Talk again is no slot machine, and a new visit rolls again. It is
// seeded from the run, the pair and the turn of the Talk.
//
// Three rules, assumed and open to the owner:
//   - a resident who trusts the traveler at all (trust 1 or more) always offers;
//   - a hub starter want (Pip's lamp, the keeper's bell) is always offered;
//   - a stranger offers by chance (`OFFER_ODDS` in a hundred).
import forest from "./forest.json" with { type: "json" };
import { DAYLIGHT_TURNS } from "./pack-rules.mjs";
import { seedHash } from "./pack-specials.mjs";

export const OFFER_ODDS = 50;
const DAY_TURNS = DAYLIGHT_TURNS * 2;
export const offerDay = (turn) => Math.floor(turn / DAY_TURNS);

// The authored hub want still held: Pip's lamp, the keeper's bell.
export function starterWant(s, them) {
  const authored = forest.people[them]?.want,
    want = s.actors[them]?.want;
  return Boolean(
    authored &&
      want &&
      authored.kind === want.kind &&
      authored.target === want.target,
  );
}
const trusts = (s, actor, them) => (s.actors[them]?.trust?.[actor] || 0) >= 1;

// The record is live while both still stand where it was rolled, on the day.
function live(s, actor, them) {
  const rec = s.actors[actor]?.offered?.[them];
  return rec &&
    s.actors[actor].place === rec.at &&
    s.actors[them]?.place === rec.at &&
    offerDay(s.turn) === rec.day
    ? rec
    : null;
}
// Talk rolls this resident's offer for the visit, once. Returns the record.
export function rollOffer(s, actor, them) {
  const kept = live(s, actor, them);
  if (kept) return kept;
  const a = s.actors[actor],
    rec = {
      at: a.place,
      day: offerDay(s.turn),
      open:
        seedHash(`${s.run?.seed ?? 0}:offer:${actor}:${them}:${s.turn}`) % 100 <
        OFFER_ODDS,
    };
  a.offered = { ...a.offered, [them]: rec };
  return rec;
}
// Whether `them` offers `actor` a quest now: trust or a starter always, else
// the visit's roll.
export const offerUnlocked = (s, actor, them) =>
  trusts(s, actor, them) ||
  starterWant(s, them) ||
  Boolean(live(s, actor, them)?.open);

// A record that has lapsed (someone left, or a day passed) is dropped.
export function pruneOffers(s) {
  for (const [id, a] of Object.entries(s.actors)) {
    if (!a.offered) continue;
    for (const them of Object.keys(a.offered))
      if (!live(s, id, them)) delete a.offered[them];
    if (!Object.keys(a.offered).length) delete a.offered;
  }
}

export function validOffered(s, id) {
  const offered = s.actors[id].offered;
  if (offered === undefined) return true;
  return Boolean(
    offered &&
      typeof offered === "object" &&
      !Array.isArray(offered) &&
      Object.keys(offered).length > 0 &&
      Object.entries(offered).every(
        ([them, rec]) =>
          them !== id &&
          Object.hasOwn(s.actors, them) &&
          rec &&
          Object.keys(rec).sort().join() === "at,day,open" &&
          typeof rec.at === "string" &&
          typeof rec.open === "boolean" &&
          Number.isSafeInteger(rec.day) &&
          rec.day >= 0 &&
          rec.day <= offerDay(s.turn),
      ),
  );
}
