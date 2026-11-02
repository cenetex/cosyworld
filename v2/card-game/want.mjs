// One want per avatar: an item, a place or a person. The world rules decide
// when it is met; meeting it is a recorded world fact worth one experience
// point. The next want is drawn from the world, deterministically, so a
// replayed journal makes the same choices.
import { BOARDY, connectedHumans } from "./boardyai.mjs";
import { humanAvatarIds, sharedEnabled } from "./human-cast.mjs";
import {
  entityActive,
  isPackActor,
  packOf,
  packPeople,
} from "./pack-registry.mjs";
import { packDiscovered } from "./pack-rules.mjs";
import { authoredWant } from "./want-talk.mjs";

export const WANT_KINDS = ["item", "place", "person", "connect"];
// A connect want introduces people: its one target is the connected humans.
export const CONNECT_TARGET = "humans";
// A want is set aside after this many refusals, or after a long spell with
// no way forward. Resting at home lasts a few turns after a want is met.
export const REFUSAL_LIMIT = 3;
export const STALL_TURNS = 48;
export const REST_TURNS = 3;
export const CONTENT_TURNS = 24;
// A want the avatar has no play toward at all, such as a place beyond every
// open route, is set aside sooner.
export const BLOCKED_TURNS = 12;

// A pack's residents become known once the player has found a way in.
export const knownActors = (s) =>
  [
    ...new Set([
      ...Object.keys(sharedEnabled(s) ? s.actors : s.opening?.met || s.actors),
      ...(s.controlledActors || []),
    ]),
  ].filter(
    (id) =>
      entityActive(s, id) &&
      (!isPackActor(id) ||
        id === BOARDY ||
        packDiscovered(s, packOf(id).id) ||
        s.packs?.[packOf(id).id]?.met?.[id] !== undefined),
  );
// Pack residents keep to their own scene unless their data lets them travel.
export const travels = (id) =>
  !isPackActor(id) ||
  id === BOARDY ||
  humanAvatarIds.includes(id) ||
  packPeople[id]?.personalQuests === true ||
  packPeople[id]?.roamingQuest !== undefined;

// Level is a rising curve of experience: 0, 1, 3, 6, 10 ... points.
export const levelFor = (xp) => Math.floor((1 + Math.sqrt(1 + 8 * xp)) / 2);
export const levelOf = (s, id) => levelFor(s.actors[id]?.xp || 0);

export const wantOf = (s, id) => s.actors[id]?.want ?? null;
export const newWant = (kind, target, turn) => ({
  kind,
  target,
  since: turn,
  refusals: 0,
});
const validTarget = (s, kind, target) =>
  kind === "item"
    ? Object.hasOwn(s.items, target)
    : kind === "person"
      ? Object.hasOwn(s.actors, target)
      : kind === "connect"
        ? target === CONNECT_TARGET
        : true;

// Every actor carries a want record, experience and what it has seen.
export function installWants(s) {
  for (const [id, a] of Object.entries(s.actors)) {
    if (!("want" in a)) {
      const w = authoredWant(id);
      a.want =
        w && validTarget(s, w.kind, w.target)
          ? newWant(w.kind, w.target, s.turn)
          : null;
    }
    a.xp ??= 0;
    a.visited ??= [a.place];
    a.talked ??= [];
    // An avatar starts knowing its own place and who and what is there.
    a.known ??= [
      a.place,
      ...Object.keys(s.actors).filter(
        (other) => other !== id && s.actors[other].place === a.place,
      ),
      ...Object.keys(s.items).filter((item) => {
        const owner = rootOf(s, item);
        return (s.actors[owner]?.place ?? owner) === a.place;
      }),
    ].slice(-KNOWN_LIMIT);
  }
}

function hash(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}

// What an avatar knows of: every item, person and place it has seen or heard
// about, most recent last. It is recorded from committed plays only, so a
// replayed journal knows the same things.
export const KNOWN_LIMIT = 256;
function learn(a, ids) {
  const fresh = new Set(ids.filter((id) => typeof id === "string" && id));
  if (!fresh.size) return;
  a.known = [...(a.known || []).filter((id) => !fresh.has(id)), ...fresh].slice(
    -KNOWN_LIMIT,
  );
}
// Seeing: the place an avatar stands in, its open ways out, and the people
// and things there, held or loose. Hearing: in a Talk each side hears what
// the other wants. Witnessing: the people, things and places named by the
// events of this turn the avatar took part in or saw.
function noteKnowledge(s, ids, api, talk) {
  const placeOf = new Map();
  for (const item of Object.keys(s.items)) {
    if (!entityActive(s, item)) continue;
    const owner = api.rootHolder(item);
    const at = s.actors[owner]?.place ?? owner;
    if (!placeOf.has(at)) placeOf.set(at, []);
    placeOf.get(at).push(item);
  }
  const events = [];
  for (let i = s.log.length - 1; i >= 0 && s.log[i].turn === s.turn; i--)
    events.push(s.log[i]);
  const named = (id) =>
    Object.hasOwn(s.items, id) ||
    Object.hasOwn(s.actors, id) ||
    api.isPlace(id);
  for (const id of ids) {
    const a = s.actors[id];
    if (!a) continue;
    const here = a.place;
    const seen = [
      here,
      ...api.exits(id),
      ...Object.keys(s.actors).filter(
        (other) => s.actors[other].place === here && entityActive(s, other),
      ),
      ...(placeOf.get(here) || []),
    ];
    if (talk && [talk.actor, talk.target].includes(id)) {
      const other = talk.actor === id ? talk.target : talk.actor;
      if (s.actors[other]?.want) seen.push(s.actors[other].want.target);
    }
    for (const e of events)
      if (
        e.actorId === id ||
        e.targetId === id ||
        e.cast?.includes(id) ||
        e.witnesses?.includes(id)
      )
        seen.push(e.actorId, e.targetId, e.itemId, e.locationId);
    learn(
      a,
      seen.filter((x) => x !== id && named(x)),
    );
  }
}

// Candidates: everything the actor knows of, with its open routes and the
// roads it has learned. Only its own holdings, its own place and itself are
// left out; a resident that keeps to its scene does not want other places,
// nor the things lying loose in its own room.
// Each candidate has a weight: things worth more than what it carries,
// places not yet visited, people not yet talked with, and anything near.
// `api` supplies world reads owned by world.mjs.
export function weightedCandidates(s, actor, api, previous = null) {
  const a = s.actors[actor];
  const held = api.carried(actor);
  const floor = Math.max(
    1,
    ...(held.length
      ? [Math.min(...held.map((id) => api.valueOf(actor, id)))]
      : []),
  );
  const roams = travels(actor);
  const reach = roams ? api.reachable(actor) : [];
  const near = new Set([a.place, ...reach]);
  const known = new Set([
    ...(a.known || []),
    ...reach,
    ...(roams ? api.routePlaces(actor) : []),
  ]);
  const people = new Set(knownActors(s));
  const out = [];
  for (const id of [...known].sort()) {
    if (id === actor) continue;
    if (Object.hasOwn(s.items, id)) {
      const owner = api.rootHolder(id);
      const at = s.actors[owner]?.place ?? owner;
      // A resident that keeps to its scene already keeps what lies loose
      // in its room, so only a traveller wants a thing lying where it stands.
      if (
        !entityActive(s, id) ||
        owner === actor ||
        (!roams && owner === a.place)
      )
        continue;
      out.push([
        "item",
        id,
        1 +
          Math.min(4, Math.max(0, api.valueOf(actor, id) - floor)) +
          (near.has(at) ? 2 : 0),
      ]);
    } else if (Object.hasOwn(s.actors, id)) {
      if (!people.has(id)) continue;
      out.push([
        "person",
        id,
        1 +
          (a.talked.includes(id) ? 0 : 2) +
          (near.has(s.actors[id].place) ? 2 : 0),
      ]);
    } else if (
      roams &&
      id !== a.place &&
      api.isPlace(id) &&
      entityActive(s, id) &&
      !api.transportPlace(id)
    ) {
      out.push([
        "place",
        id,
        1 + (a.visited.includes(id) ? 0 : 2) + (near.has(id) ? 2 : 0),
      ]);
    }
  }
  return out.filter(
    ([kind, target]) =>
      (kind !== previous?.kind || target !== previous.target) &&
      !(a.gaveUp?.target === target && s.turn - a.gaveUp.turn < CONTENT_TURNS),
  );
}
export const wantCandidates = (s, actor, api, previous = null) =>
  weightedCandidates(s, actor, api, previous).map(
    ([kind, target]) => `${kind}:${target}`,
  );
// A seeded weighted draw: the same world and turn draw the same want.
export function nextWant(s, actor, api, previous = null) {
  const pool = weightedCandidates(s, actor, api, previous);
  if (!pool.length) return null;
  const total = pool.reduce((n, [, , w]) => n + w, 0);
  let pick = hash(`${actor}:${s.turn}`) % total;
  for (const [kind, target, weight] of pool) {
    if (pick < weight) return newWant(kind, target, s.turn);
    pick -= weight;
  }
  return null;
}

// Two connected humans in the room where a Talk happens, with the connector.
export const introduced = (s, actor, talk) => {
  const here = s.actors[actor]?.place;
  return Boolean(
    talk &&
      here &&
      s.actors[talk.actor]?.place === here &&
      connectedHumans(s).filter((id) => s.actors[id].place === here).length >=
        2,
  );
};

// A person want needs a Talk between the two; a connect want needs any Talk
// in the connector's room while two connected humans are there with them.
// The other kinds read custody and place.
export function wantMet(s, actor, talk = null) {
  const want = wantOf(s, actor);
  if (!want) return false;
  if (want.kind === "connect") return introduced(s, actor, talk);
  if (want.kind === "item") return rootOf(s, want.target) === actor;
  if (want.kind === "place") return s.actors[actor].place === want.target;
  return Boolean(
    talk &&
      s.actors[want.target]?.place === s.actors[actor].place &&
      ((talk.actor === actor && talk.target === want.target) ||
        (talk.actor === want.target && talk.target === actor)),
  );
}
function rootOf(s, id) {
  let holder = s.items[id].holder;
  const seen = new Set([id]);
  while (s.items[holder] && !seen.has(holder)) {
    seen.add(holder);
    holder = s.items[holder].holder;
  }
  return holder;
}

export const resting = (s, actor, home) => {
  const want = wantOf(s, actor);
  return Boolean(
    home &&
      s.actors[actor].place === home &&
      s.actors[actor].metTurn !== undefined &&
      s.turn - s.actors[actor].metTurn < REST_TURNS &&
      (!want || want.since >= s.actors[actor].metTurn),
  );
};

// Record what each participant saw and said, then commit met wants. A want
// met away from home is followed by the way home; at home the next real want
// is drawn while the avatar rests.
export function settleWants(s, actors, api, action = null) {
  const talk =
    action?.kind === "talk"
      ? { actor: action.actor, target: action.target }
      : null;
  noteKnowledge(s, actors, api, talk);
  const met = [];
  for (const id of actors) {
    const a = s.actors[id];
    if (!a) continue;
    if (!a.visited.includes(a.place))
      a.visited = [...a.visited, a.place].slice(-64);
    if (talk && [talk.actor, talk.target].includes(id)) {
      const other = talk.actor === id ? talk.target : talk.actor;
      if (s.actors[other] && !a.talked.includes(other))
        a.talked = [...a.talked, other].slice(-64);
    }
    if (!wantMet(s, id, talk)) continue;
    const want = a.want;
    a.xp += 1;
    a.metTurn = s.turn;
    met.push({ actorId: id, want });
    api.log(id, want);
    const home = api.home(id);
    const atRest =
      !home || a.place === home || api.sanctuaries.includes(a.place);
    a.want =
      !atRest && travels(id) && !(want.kind === "place" && want.target === home)
        ? newWant("place", home, s.turn)
        : nextWant(s, id, api, want);
  }
  return met;
}

// A refusal of the actor's own want counts; enough of them set it aside.
export function refuseWant(s, actor, item, api) {
  const want = wantOf(s, actor);
  if (want?.kind !== "item" || want.target !== item) return;
  // A resident that keeps to its scene only tries while someone is there, so
  // its stall clock starts at the first real attempt, not when it was given.
  if (want.refusals === 0 && !travels(actor)) want.since = s.turn;
  want.refusals += 1;
  if (want.refusals >= REFUSAL_LIMIT) giveUp(s, actor, api);
}
// A set-aside want stays out of mind for a while.
function giveUp(s, actor, api) {
  const a = s.actors[actor];
  a.gaveUp = { target: a.want.target, turn: s.turn };
  a.want = nextWant(s, actor, api, a.want);
}
// A cast want with no way forward for a long spell is set aside, and sooner
// when a met avatar has no play toward it at all. A resident
// that keeps to its scene acts only when someone is there, so time spent
// unseen is not a stall: its want can stall only after it has tried and been
// refused at least once.
export function reviseStalledWants(s, actors, api) {
  // A cast member not yet met waits with its want held.
  const known = new Set(knownActors(s));
  for (const id of actors) {
    const want = wantOf(s, id);
    if (
      want &&
      (travels(id) || want.refusals > 0) &&
      s.turn - want.since >=
        (travels(id) &&
        want.kind !== "connect" &&
        known.has(id) &&
        !api.wayForward(id)
          ? BLOCKED_TURNS
          : STALL_TURNS)
    )
      giveUp(s, id, api);
    else if (!want && s.turn - (s.actors[id].metTurn ?? 0) >= CONTENT_TURNS) {
      // With every known place visited and every known person met, the
      // avatar stays content a while; then curiosity starts over from here.
      const a = s.actors[id];
      a.want = nextWant(s, id, api);
      if (!a.want) {
        a.visited = [a.place];
        a.talked = [];
        a.want = nextWant(s, id, api);
      }
      if (!a.want) a.metTurn = s.turn;
    }
  }
}

export function validWant(s, id) {
  const a = s.actors[id];
  const whole = (n) => Number.isSafeInteger(n) && n >= 0 && n <= s.turn;
  const list = (v, of) =>
    Array.isArray(v) &&
    v.length <= 64 &&
    new Set(v).size === v.length &&
    v.every((x) => Object.hasOwn(of, x));
  const w = a.want;
  return (
    Number.isSafeInteger(a.xp) &&
    a.xp >= 0 &&
    a.xp <= s.turn * 8 &&
    (a.metTurn === undefined || whole(a.metTurn)) &&
    (a.gaveUp === undefined ||
      (a.gaveUp &&
        Object.keys(a.gaveUp).length === 2 &&
        typeof a.gaveUp.target === "string" &&
        whole(a.gaveUp.turn))) &&
    list(a.talked, s.actors) &&
    Array.isArray(a.known) &&
    a.known.length <= KNOWN_LIMIT &&
    new Set(a.known).size === a.known.length &&
    // A name heard may outlive its thing: a save upgrade can retire an item
    // or a place. The draw reads only what still exists.
    a.known.every(
      (x) => typeof x === "string" && x.length > 0 && x.length <= 160,
    ) &&
    !a.known.includes(id) &&
    !a.talked.includes(id) &&
    Array.isArray(a.visited) &&
    (w === null ||
      (w &&
        Object.keys(w).length === 4 &&
        WANT_KINDS.includes(w.kind) &&
        typeof w.target === "string" &&
        validTarget(s, w.kind, w.target) &&
        !(w.kind === "person" && w.target === id) &&
        whole(w.since) &&
        Number.isInteger(w.refusals) &&
        w.refusals >= 0 &&
        w.refusals < REFUSAL_LIMIT))
  );
}
