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
import { authoredWant, questFromData } from "./want-talk.mjs";
export { questFromData };

// A quest is composed from the fixed verbs and the world's entities:
//   have(item)               hold it
//   visit(place)             be there
//   find(avatar)             share a place with them
//   talk(avatar)             commit a Talk with them
//   give(item, avatar)       a gift of it that they accept
//   travel_with(avatar, place) an Invite along to that place that is accepted
export const QUEST_VERBS = [
  "have",
  "visit",
  "find",
  "talk",
  "give",
  "travel_with",
];
// The second entity a verb names, when it names two.
const SECOND = { give: "avatar", travel_with: "place" };
const FIRST = {
  have: "item",
  visit: "place",
  find: "avatar",
  talk: "avatar",
  give: "item",
  travel_with: "avatar",
};
// The item, place and avatar a quest names, for cards and context.
export function questParts(want) {
  const parts = { items: [], place: null, avatars: [] };
  if (!want) return parts;
  for (const [kind, id] of [
    [FIRST[want.verb], want.target],
    [SECOND[want.verb], want.with],
  ])
    if (id === undefined) continue;
    else if (kind === "item") parts.items.push(id);
    else if (kind === "place") parts.place = id;
    else if (kind === "avatar") parts.avatars.push(id);
  return parts;
}
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
export const newWant = (verb, target, turn, second) => ({
  verb,
  target,
  ...(second === undefined ? {} : { with: second }),
  since: turn,
  refusals: 0,
});
const isKind = (s, kind, id) =>
  typeof id === "string" &&
  (kind === "item"
    ? Object.hasOwn(s.items, id)
    : kind === "avatar"
      ? Object.hasOwn(s.actors, id)
      : true);
const validParts = (s, verb, target, second) =>
  QUEST_VERBS.includes(verb) &&
  isKind(s, FIRST[verb], target) &&
  (SECOND[verb] ? isKind(s, SECOND[verb], second) : second === undefined);

// Every actor carries a want record, experience and what it has seen.
export function installWants(s) {
  for (const [id, a] of Object.entries(s.actors)) {
    if (!("want" in a)) {
      const w = authoredWant(id);
      a.want =
        w && validParts(s, w.verb, w.target, w.with) && w.target !== id
          ? newWant(w.verb, w.target, s.turn, w.with)
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

// Candidates are compositions of a verb with what the actor knows: items
// others hold that it values above the least valued thing it carries, known
// places it has not visited, known people to find, talk with, give to or
// travel with. `api` supplies world reads owned by world.mjs.
export function wantCandidates(s, actor, api, previous = null) {
  const a = s.actors[actor];
  const held = api.carried(actor);
  const value = (who, id) => api.valueOf(who, id);
  // Something valued at the minimum is never wanted.
  const floor = Math.max(
    1,
    ...(held.length ? [Math.min(...held.map((id) => value(actor, id)))] : []),
  );
  // Only what can be reached from here: the open routes, or this place for
  // a resident who keeps to its scene.
  const reach = travels(actor) ? api.reachable(actor) : [];
  const near = new Set([a.place, ...reach]);
  const known = knownActors(s).filter(
    (id) => id !== actor && entityActive(s, id) && s.actors[id],
  );
  const wantsItem = (who, id) =>
    s.actors[who].want?.verb === "have" && s.actors[who].want.target === id;
  const have = Object.keys(s.items).filter((id) => {
    const owner = api.rootHolder(id);
    return (
      entityActive(s, id) &&
      owner !== actor &&
      Object.hasOwn(s.actors, owner) &&
      near.has(s.actors[owner].place) &&
      !wantsItem(owner, id) &&
      value(actor, id) > floor
    );
  });
  const visit = reach.filter((id) => !a.visited.includes(id));
  // Someone elsewhere is found where the actor can go or has been.
  const find = known.filter(
    (id) =>
      s.actors[id].place !== a.place &&
      (near.has(s.actors[id].place) || a.visited.includes(s.actors[id].place)),
  );
  const nearby = known.filter((id) => near.has(s.actors[id].place));
  const talk = nearby.filter((id) => !a.talked.includes(id));
  // A gift goes to someone who values it more than the giver does.
  const give = held
    .filter((item) => !wantsItem(actor, item) && entityActive(s, item))
    .flatMap((item) =>
      nearby
        .filter(
          (id) =>
            wantsItem(id, item) ||
            (value(id, item) >= 2 && value(id, item) > value(actor, item)),
        )
        .map((id) => [item, id]),
    );
  // A trip together, to somewhere the actor can go.
  const travelWith = travels(actor)
    ? nearby
        .filter((id) => travels(id) && !api.human?.(id))
        .flatMap((id) =>
          reach
            .filter(
              (place) => place !== s.actors[id].place && place !== a.place,
            )
            .map((place) => [id, place]),
        )
    : [];
  const pool = [
    ...have.map((t) => ["have", t]),
    ...visit.map((t) => ["visit", t]),
    ...find.map((t) => ["find", t]),
    ...talk.map((t) => ["talk", t]),
    ...give.map(([t, w]) => ["give", t, w]),
    ...travelWith.map(([t, w]) => ["travel_with", t, w]),
  ].filter(
    ([verb, target, second]) =>
      !(
        verb === previous?.verb &&
        target === previous.target &&
        second === previous.with
      ) &&
      !(a.gaveUp?.target === target && s.turn - a.gaveUp.turn < CONTENT_TURNS),
  );
  return pool.map((parts) => parts.join(":")).sort();
}
// Each verb gets a fair share of the draw, so a gift, a trip or a search is
// as likely as a fetch, however many items lie about.
export function nextWant(s, actor, api, previous = null) {
  const pool = wantCandidates(s, actor, api, previous);
  if (!pool.length) return null;
  const verbs = QUEST_VERBS.filter((v) =>
    pool.some((c) => c.startsWith(`${v}:`)),
  );
  const h = hash(`${actor}:${s.turn}`);
  const choices = pool.filter((c) =>
    c.startsWith(`${verbs[h % verbs.length]}:`),
  );
  const [verb, target, second] =
    choices[Math.floor(h / verbs.length) % choices.length].split(":");
  return newWant(verb, target, s.turn, second);
}

// Each verb is met by a world fact or by the play just committed.
// `played` is {kind, actor, target, item, destination, accepted}.
export function wantMet(s, actor, played = null) {
  const want = wantOf(s, actor);
  if (!want) return false;
  const here = s.actors[actor].place;
  const between = (other) =>
    played &&
    ((played.actor === actor && played.target === other) ||
      (played.actor === other && played.target === actor));
  switch (want.verb) {
    case "have":
      return rootOf(s, want.target) === actor;
    case "visit":
      return here === want.target;
    case "find":
      return s.actors[want.target]?.place === here;
    case "talk":
      return Boolean(
        played?.kind === "talk" &&
          s.actors[want.target]?.place === here &&
          between(want.target),
      );
    case "give":
      return Boolean(
        played &&
          ["give", "trade"].includes(played.kind) &&
          played.accepted &&
          played.actor === actor &&
          played.target === want.with &&
          played.item === want.target,
      );
    case "travel_with":
      return Boolean(
        played?.kind === "accompany" &&
          played.accepted &&
          between(want.target) &&
          played.destination === want.with &&
          here === want.with,
      );
    default:
      return false;
  }
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
export function settleWants(s, actors, api, played = null) {
  const talk = played?.kind === "talk" ? played : null;
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
    if (!wantMet(s, id, played)) continue;
    const want = a.want;
    a.xp += 1;
    a.metTurn = s.turn;
    met.push({ actorId: id, want });
    api.log(id, want);
    const home = api.home(id);
    const atRest =
      !home || a.place === home || api.sanctuaries.includes(a.place);
    a.want =
      !atRest && travels(id) && !(want.verb === "visit" && want.target === home)
        ? newWant("visit", home, s.turn)
        : nextWant(s, id, api, want);
  }
  return met;
}

// A refusal of the actor's own quest counts; enough of them set it aside.
// `about` is the item asked for or offered, or the avatar invited along.
export function refuseWant(s, actor, about, api) {
  const want = wantOf(s, actor);
  if (
    !want ||
    !(
      (["have", "give"].includes(want.verb) && want.target === about) ||
      (want.verb === "travel_with" && want.target === about)
    )
  )
    return;
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
    (w === null || (w && validQuest(s, id, w)))
  );
}
function validQuest(s, id, w) {
  const keys = Object.keys(w).sort().join();
  return (
    keys ===
      (SECOND[w.verb]
        ? "refusals,since,target,verb,with"
        : "refusals,since,target,verb") &&
    validParts(s, w.verb, w.target, w.with) &&
    w.target !== id &&
    w.with !== id &&
    Number.isSafeInteger(w.since) &&
    w.since >= 0 &&
    w.since <= s.turn &&
    Number.isInteger(w.refusals) &&
    w.refusals >= 0 &&
    w.refusals < REFUSAL_LIMIT
  );
}
// The verb, target and second entity a want_met event records.
export function validMet(m, ids) {
  if (!m || typeof m !== "object") return false;
  const keys = Object.keys(m).sort().join();
  return (
    QUEST_VERBS.includes(m.verb) &&
    keys === (SECOND[m.verb] ? "target,verb,with" : "target,verb") &&
    ids.includes(m.target) &&
    (!SECOND[m.verb] || ids.includes(m.with))
  );
}
