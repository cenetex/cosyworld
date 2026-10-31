// One want per avatar: an item, a place or a person. The world rules decide
// when it is met; meeting it is a recorded world fact worth one experience
// point. The next want is drawn from the world, deterministically, so a
// replayed journal makes the same choices.
import { BOARDY } from "./boardyai.mjs";
import { humanAvatarIds, sharedEnabled } from "./human-cast.mjs";
import {
  entityActive,
  isPackActor,
  packOf,
  packPeople,
} from "./pack-registry.mjs";
import { packDiscovered } from "./pack-rules.mjs";
import { authoredWant } from "./want-talk.mjs";

export const WANT_KINDS = ["item", "place", "person"];
// A want is set aside after this many refusals, or after a long spell with
// no way forward. Resting at home lasts a few turns after a want is met.
export const REFUSAL_LIMIT = 3;
export const STALL_TURNS = 48;
export const REST_TURNS = 3;
export const CONTENT_TURNS = 24;

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
  }
}

function hash(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}

// Candidates: items held by others that the actor values above the least
// valued thing it carries, known places it has not visited, and known people
// it has not talked with. `api` supplies world reads owned by world.mjs.
export function wantCandidates(s, actor, api, previous = null) {
  const a = s.actors[actor];
  const held = api.carried(actor);
  // Something valued at the minimum is never wanted.
  const floor = Math.max(
    1,
    ...(held.length
      ? [Math.min(...held.map((id) => api.valueOf(actor, id)))]
      : []),
  );
  // Only what can be reached from here: the open routes, or this place for
  // a resident who keeps to its scene.
  const reach = travels(actor) ? api.reachable(actor) : [];
  const near = new Set([a.place, ...reach]);
  const items = Object.keys(s.items).filter((id) => {
    const owner = api.rootHolder(id);
    return (
      entityActive(s, id) &&
      owner !== actor &&
      Object.hasOwn(s.actors, owner) &&
      near.has(s.actors[owner].place) &&
      !(
        s.actors[owner].want?.kind === "item" &&
        s.actors[owner].want.target === id
      ) &&
      api.valueOf(actor, id) > floor
    );
  });
  const places = reach.filter((id) => !a.visited.includes(id));
  const people = knownActors(s).filter(
    (id) =>
      id !== actor && !a.talked.includes(id) && near.has(s.actors[id].place),
  );
  return [
    ...items.map((target) => ["item", target]),
    ...places.map((target) => ["place", target]),
    ...people.map((target) => ["person", target]),
  ]
    .filter(
      ([kind, target]) =>
        (kind !== previous?.kind || target !== previous.target) &&
        !(
          a.gaveUp?.target === target && s.turn - a.gaveUp.turn < CONTENT_TURNS
        ),
    )
    .map(([kind, target]) => `${kind}:${target}`)
    .sort();
}
export function nextWant(s, actor, api, previous = null) {
  const pool = wantCandidates(s, actor, api, previous);
  if (!pool.length) return null;
  const [kind, target] =
    pool[hash(`${actor}:${s.turn}`) % pool.length].split(":");
  return newWant(kind, target, s.turn);
}

// A person want needs a Talk between the two; the other kinds read custody
// and place.
export function wantMet(s, actor, talk = null) {
  const want = wantOf(s, actor);
  if (!want) return false;
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
// A cast want with no way forward for a long spell is set aside. A resident
// that keeps to its scene acts only when someone is there, so time spent
// unseen is not a stall: its want can stall only after it has tried and been
// refused at least once.
export function reviseStalledWants(s, actors, api) {
  for (const id of actors) {
    const want = wantOf(s, id);
    if (
      want &&
      (travels(id) || want.refusals > 0) &&
      s.turn - want.since >= STALL_TURNS
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
