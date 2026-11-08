// World life (rules 100): residents keep a home and a range, walk home when
// displaced, and take a step at dawn and dusk where no player is
// (residentRound in world.mjs). Sleep is resident-sleep.mjs and the standing
// Guard resident-guard.mjs. There is no clock and no random: every walk is in
// id order.
//
// The data is `world-life.json`: defaults, per-pack defaults and per-resident
// `range` (hops from home), `sails`, `sleep` ({from, to} in clock turns, or
// null for one who never sleeps) and `guards`, plus the guardable ways. It
// sits beside the packs, not in them, so the released rules (v93 to v99)
// still read this content. See docs/design/rules-100-world-life.md.
import forest from "./forest.json" with { type: "json" };
import life from "./world-life.json" with { type: "json" };
import {
  packPeople,
  conditionsMet,
  packDefinitions,
  freed,
  roamingQuestActor,
  entityActive,
  staysPut,
} from "./pack-registry.mjs";
import { controlledByHuman, humanPresent, humanAvatar } from "./human-cast.mjs";
import { authoredRouteEdges } from "./roaming-routes.mjs";
import { DAYLIGHT_TURNS } from "./pack-rules.mjs";
import { BOARDY } from "./boardyai.mjs";

export { life };
// The rules day: day then night, turn 0 is 06:00 and each turn half an hour.
export const DAY_TURNS = DAYLIGHT_TURNS * 2;
// The most off-stage steps one play takes, so a busy world stays cheap.
export const OFFSTAGE_STEPS = 24;
// Story suites written for a cast that stands still turn this off to test a
// story alone (test/helpers/still-cast.mjs). The rules never change it.
export const worldLife = { on: true };

// --- Data ----------------------------------------------------------------

const own = (o, k) => Boolean(o) && Object.hasOwn(o, k);
const sleepOk = (z) =>
  z === null ||
  (Boolean(z) &&
    Object.keys(z).sort().join() === "from,to" &&
    [z.from, z.to].every((n) => Number.isInteger(n) && n >= 0 && n < 48) &&
    z.from !== z.to);
const recordOk = (r, keys) =>
  Boolean(r) &&
  typeof r === "object" &&
  Object.keys(r).every((k) => keys.includes(k)) &&
  (r.range === undefined ||
    (Number.isInteger(r.range) && r.range >= 0 && r.range <= 8)) &&
  (r.sails === undefined || typeof r.sails === "boolean") &&
  (r.sleep === undefined || sleepOk(r.sleep));
// What is wrong with the world life data against the mounted cast and map.
export function lifeDataProblems(places, people) {
  const problems = [];
  if (!recordOk(life.defaults, ["range", "sails", "sleep"]))
    problems.push("defaults need a range, sails and a sleep schedule");
  for (const [id, p] of Object.entries(life.packs || {}))
    if (!packDefinitions.some((d) => d.id === id) || !recordOk(p, ["sleep"]))
      problems.push(`pack ${id} needs a known pack and a sleep schedule`);
  for (const r of life.guardable || [])
    if (
      Object.keys(r).sort().join() !== "from,to" ||
      !own(places, r.from) ||
      !own(places, r.to) ||
      !authoredRouteEdges().some(([a, b]) => a === r.from && b === r.to)
    )
      problems.push(`guardable way ${r.from}>${r.to} needs an authored route`);
  for (const [id, r] of Object.entries(life.residents || {}))
    if (
      !own(people, id) ||
      !recordOk(r, ["range", "sails", "sleep", "guards"]) ||
      (r.guards !== undefined &&
        !(life.guardable || []).some(
          (w) => w.from === lifeHome(id) && w.to === r.guards,
        ))
    )
      problems.push(`resident ${id} has an unknown or invalid field`);
  return problems;
}
export const lifeField = (id, key) =>
  own(life.residents?.[id], key) ? life.residents[id][key] : undefined;

// --- Home and range ------------------------------------------------------

export function lifeHome(id, world) {
  const resident = packPeople[id];
  const next = resident?.homeWhen;
  if (world && next && conditionsMet(world, resident.packId, next.requires, id))
    return next.place;
  return (
    resident?.home ??
    forest.people[id]?.home ??
    humanAvatar(id)?.home?.id ??
    resident?.place ??
    null
  );
}
// The hops a resident may stray from home for its wants: 0 keeps it home,
// Infinity is no limit (the hub's residents). null is no home life at all:
// players and their away avatars, roamers, journeys and freed residents.
export function rangeOf(s, id) {
  if (own(forest.people, id)) return id === "vale" ? null : Infinity;
  const a = packPeople[id];
  if (
    !a ||
    humanAvatar(id) ||
    id === BOARDY ||
    roamingQuestActor(id) ||
    a.journey ||
    a.personalQuests ||
    freed(s, id)
  )
    return null;
  // `travels: false` in a pack keeps a resident home, as range 0 does.
  return staysPut(id, s) ? 0 : (lifeField(id, "range") ?? life.defaults.range);
}
// A pack resident with a range of 1 or more pursues its wants by walking.
export const wanders = (s, id) =>
  Boolean(packPeople[id]) && !humanAvatar(id) && (rangeOf(s, id) ?? 0) > 0;
// Kept home: a range of 0, from its pack or this data.
export const keepsHome = (s, id) => rangeOf(s, id) === 0;
// Boarding a ship needs `sails` for a resident kept to a range.
export const mayBoard = (s, id) => {
  const range = rangeOf(s, id);
  return (
    range === null ||
    range === Infinity ||
    (lifeField(id, "sails") ?? life.defaults.sails)
  );
};

// Hops over the authored map, open or not: range is geography, not access.
let adjacency = null;
const hopTables = new Map();
function hopsFrom(from) {
  if (!adjacency) {
    adjacency = new Map();
    for (const [a, b] of authoredRouteEdges()) {
      if (!adjacency.has(a)) adjacency.set(a, new Set());
      adjacency.get(a).add(b);
    }
  }
  let found = hopTables.get(from);
  if (found) return found;
  found = new Map([[from, 0]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++)
    for (const next of adjacency.get(queue[i]) || [])
      if (!found.has(next)) {
        found.set(next, found.get(queue[i]) + 1);
        queue.push(next);
      }
  hopTables.set(from, found);
  return found;
}
export const hops = (from, to) => hopsFrom(from).get(to) ?? Infinity;
// A test of places against a resident's range, or null for no limit.
export function rangeTest(s, id) {
  const range = rangeOf(s, id),
    home = lifeHome(id, s);
  if (range === null || range === Infinity || !home) return null;
  const table = hopsFrom(home);
  return (place) => (table.get(place) ?? Infinity) <= range;
}
// Whether a place lies within a resident's range of its home.
export function inRange(s, id, place) {
  const range = rangeOf(s, id);
  if (range === null || range === Infinity) return true;
  const home = lifeHome(id, s);
  return !home || hops(home, place) <= range;
}
// Away from home and beyond its range: pushed, sent, scattered or knocked.
export function displaced(s, id) {
  const range = rangeOf(s, id),
    home = lifeHome(id, s),
    here = s.actors[id]?.place;
  return (
    range !== null &&
    Boolean(home) &&
    here !== home &&
    entityActive(s, home) &&
    !inRange(s, id, here)
  );
}
// Walking home: displaced, or marked so by a retreat or bedtime.
export const walksHome = (s, id) =>
  worldLife.on &&
  rangeOf(s, id) !== null &&
  s.actors[id].place !== lifeHome(id, s) &&
  (Boolean(s.actors[id].homeward) || displaced(s, id));

// A resident marked walking home holds `homeward: true`.
export const validHome = (s) =>
  Object.values(s.actors).every(
    (a) => a.homeward === undefined || a.homeward === true,
  );

// Short, journaled courtesy, not a lock from a browser selection.
// Only actual travel and interactions stamp it; loading never invents arrival.
export function noteRoomArrival(s, id) {
  s.actors[id].roomArrival = { place: s.actors[id].place, turn: s.turn };
}
export function noteResidentInteraction(s, action) {
  if (
    !controlledByHuman(s, action.actor) ||
    !["talk", "ask", "give", "trade"].includes(action.kind)
  )
    return;
  const target = s.actors[action.target];
  if (target && !controlledByHuman(s, action.target)) {
    target.roomAttention = Object.fromEntries(
      Object.entries(target.roomAttention || {}).filter(
        ([, stamp]) => stamp.place === target.place && s.turn - stamp.turn <= 2,
      ),
    );
    target.roomAttention[action.actor] = { place: target.place, turn: s.turn };
  }
}
export function residentCourtesy(s, id) {
  if (!worldLife.on || controlledByHuman(s, id)) return false;
  const resident = s.actors[id];
  const recent = (stamp, turns) =>
    stamp?.place === resident.place &&
    s.turn >= stamp.turn &&
    s.turn - stamp.turn <= turns;
  return Object.entries(s.actors).some(
    ([human, a]) =>
      controlledByHuman(s, human) &&
      humanPresent(s, human) &&
      a.place === resident.place &&
      !a.sleeping &&
      (recent(a.roomArrival, 3) ||
        recent(resident.roomArrival, 3) ||
        recent(resident.roomAttention?.[human], 2)),
  );
}
export function validResidentCourtesy(s, places) {
  const stampOk = (stamp) =>
    stamp &&
    Object.keys(stamp).sort().join() === "place,turn" &&
    Object.hasOwn(places, stamp.place) &&
    Number.isSafeInteger(stamp.turn) &&
    stamp.turn >= 0 &&
    stamp.turn <= s.turn;
  return Object.values(s.actors).every(
    (a) =>
      (a.roomArrival === undefined || stampOk(a.roomArrival)) &&
      (a.roomAttention === undefined ||
        (a.roomAttention &&
          !Array.isArray(a.roomAttention) &&
          typeof a.roomAttention === "object" &&
          Object.entries(a.roomAttention).every(
            ([by, stamp]) => Object.hasOwn(s.actors, by) && stampOk(stamp),
          ))),
  );
}
