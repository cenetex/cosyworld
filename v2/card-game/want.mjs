// One want per avatar: an item, a place or a person. The world rules decide
// when it is met and what it earns: one experience, paid on the play that
// meets it. `actor.want` is that want.
// A resident's next want is drawn from the world, deterministically, so a
// replayed journal makes the same choices. A player's is never drawn or
import { BOARDY, connectedHumans } from "./boardyai.mjs";
import { controlledByHuman, humanAvatarIds, sharedEnabled } from "./human-cast.mjs";
import {
  entityActive,
  isFood,
  freed,
  isPackActor,
  neverBack,
  spentByChoice,
  packDefinition,
  packOf,
  packPeople,
} from "./pack-registry.mjs";
import forest from "./forest.json" with { type: "json" };
import { DAYLIGHT_TURNS, packDiscovered, runHash } from "./pack-rules.mjs";
import { validGlimpse } from "./glimpse.mjs";
import { authoredWant, stagedWants } from "./want-talk.mjs";
import { validOffered } from "./offer-chance.mjs";
import { MAX_DWELL } from "./world/dwell.mjs";
import { gainTrust } from "./world/company.mjs";
import { HEARD_FROM, heardWant, validRumours } from "./world/rumours.mjs";
import { LEVEL_CAP, rankOf, trackLevel } from "./level-tiers.mjs";
import {
  arcanaLevel,
  countResidentQuest,
  tarotsHeld,
} from "./world/arcana-record.mjs";

export const WANT_KINDS = ["item", "place", "person", "connect"];
// A want may name a verb beyond the kind's own (hold, be at, talk). State
// verbs are met when their condition holds after any play; act verbs when
// that play by the avatar resolves (Give only when accepted). A step names
// its other cards: `to` a person, `at` a place.
// No step is violent: a person step is Talk (the person want itself) or
// meet. Threaten and attack steps saved by rules 89 and earlier stay valid
// and are met as before, but none is drawn.
export const STEP_VERBS = {
  item: ["find", "give", "bring"],
  person: ["meet"],
  place: ["rest"],
};
const SAVED_STEP_VERBS = ["threaten", "attack"];

// A connect want introduces people: its one target is the connected humans.
export const CONNECT_TARGET = "humans";
// A rest lasts a few turns after a want is met, wherever it was met.
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
export const wantless = (id) => forest.people[id]?.wants === false;
export const travels = (id, s = null) =>
  (!isPackActor(id) && forest.people[id]?.travels !== false) ||
  freed(s, id) ||
  id === BOARDY ||
  humanAvatarIds.includes(id) ||
  packPeople[id]?.personalQuests === true ||
  packPeople[id]?.roamingQuest !== undefined;

// Experience reaches each level on a rising curve: 0, 1, 3, 6, 10 ... points.
export const levelFor = (xp) => Math.floor((1 + Math.sqrt(1 + 8 * xp)) / 2);
const rankAt = (s, id) =>
  s.actors[id]?.level ?? levelFor(s.actors[id]?.xp || 0);
export const PLACE_FROM = "quest:place:";
const placeRank = (s, id) =>
  s.placeMet && Object.hasOwn(s.placeMet, id) ? 1 + s.placeMet[id].length : null;
export const levelOf = (s, id) =>
  humanAvatarIds.includes(id)
    ? arcanaLevel(s, id)
    : trackLevel(placeRank(s, id) ?? rankAt(s, id));
// Opted-in residents bank experience while away. Their authored home stays
// fixed even when a journey or a visit changes their latest sanctuary.
export const levelReturnHome = (s, id) =>
  packPeople[id]?.levelAtHome && levelFor(s.actors[id].xp) > rankAt(s, id)
    ? packPeople[id].home
    : null;
export function settleHomeLevels(s) {
  for (const id of Object.keys(s.actors)) {
    const home = levelReturnHome(s, id);
    if (
      home &&
      s.actors[id].place === home &&
      entityActive(s, id) &&
      entityActive(s, home)
    )
      s.actors[id].level = levelFor(s.actors[id].xp);
  }
}
export const rankXp = (r) => (r * (r - 1)) / 2;
export const startXp = (id) =>
  rankXp(rankOf(isPackActor(id) ? packPeople[id].startLevel || 1 : 1));

export const wantOf = (s, id) => s.actors[id]?.want ?? null;
// The same quest keeps its identity wherever it is read.
export const questTerms = (w) => JSON.stringify([
  w.kind, w.target,
  w.step ? Object.keys(w.step).sort().map((key) => [key, w.step[key]]) : null,
  w.lit ?? null,
]);
export const sameQuest = (left, right) =>
  questTerms(left) === questTerms(right);
export const wantKey = (id, want) =>
  `${id}:${want.kind}:${want.target}:${want.since}:${want.quest?.left ?? ""}:${questTerms(want)}`;
export const MAX_HELD = 3;
export const heldOf = (a) => (a?.want ? [a.want, ...(a.under || [])] : []);
export const LISTENER_FROM = "quest:listener:";
const fetching = (w) => w.from?.startsWith(LISTENER_FROM) === true;
export const slotsUsed = (a) => {
  const held = heldOf(a);
  const fetches = held.filter(fetching).length;
  return held.length - fetches + (fetches ? 1 : 0) + tarotsHeld(a);
};
export const questsOf = (s, id) => heldOf(s.actors[id]);
export const questRewardsOf = () => [];
export const closedKey = questTerms;
// A met want with nothing to follow leaves its resident content: no want
// until it next rests (a resident's day, a Sleep). Any want it takes ends
// that.
export const contentOf = (s, id) =>
  Boolean(s.actors[id]?.content && !s.actors[id].want);
export function setWant(a, want) {
  a.want = want ?? null;
  if (a.want) delete a.content;
  return a.want;
}
export function holdQuest(s, actor, want, from) {
  const a = s.actors[actor];
  if (!a) return null;
  const choice = from?.startsWith(LISTENER_FROM) === true;
  const fetches = heldOf(a).filter(fetching).length;
  if (choice && fetches >= 3) return null;
  if (choice && !fetches)
    while (slotsUsed(a) >= MAX_HELD && heldOf(a).some((w) => !fetching(w)))
      releaseQuest(
        a,
        heldOf(a).findLast((w) => !fetching(w) && w.from !== DREAM_FROM) ??
          heldOf(a).findLast((w) => !fetching(w)),
      );
  if (slotsUsed(a) >= MAX_HELD && !(choice && fetches)) return null;
  if (a.want) a.under = [a.want, ...(a.under || [])];
  a.want = { ...want, ...(from ? { from } : {}) };
  delete a.content;
  return a.want;
}
export function releaseQuest(a, want) {
  const held = heldOf(a).filter((w) => w !== want);
  a.want = held[0] ?? null;
  if (held.length > 1) a.under = held.slice(1);
  else delete a.under;
}
export const MAX_CLOSED = 64;
function closeQuest(a, want, turn) {
  if (!want.from) return;
  const closed = { ...a.closed };
  if (!(want.from in closed) && Object.keys(closed).length >= MAX_CLOSED) {
    const [oldest] = Object.entries(closed).sort(
      ([ka, [ta]], [kb, [tb]]) => ta - tb || (ka < kb ? -1 : 1),
    );
    delete closed[oldest[0]];
  }
  closed[want.from] = [turn, closedKey(want)];
  a.closed = closed;
}
export const closedBy = (a, from, want) =>
  a.closed?.[from]?.[1] === closedKey(want);
export const closedAny = (a, want) =>
  Object.values(a.closed || {}).some(([, terms]) => terms === closedKey(want));
// A player sets the held quest down. Its target stays out
// of mind a while and nothing is drawn in its place.
export function dropQuest(s, actor, index = 0) {
  const a = s.actors[actor],
    want = heldOf(a)[index];
  if (!want) return;
  a.gaveUp = { target: want.target, turn: s.turn };
  closeQuest(a, want, s.turn);
  releaseQuest(a, want);
}
// The way back to an active place that rests the avatar, for a rest step
// whose pack was switched off.
export const restStep = (s, actor, api) => ({
  ...newWant(
    "place",
    [s.actors[actor].sanctuary, api.home(actor), ...api.sanctuaries].find(
      (p) =>
        p &&
        (api.restsAt?.(actor, p) ?? api.sanctuaries.includes(p)) &&
        (api.active?.(p) ?? true),
    ),
    s.turn,
  ),
  step: { verb: "rest" },
});
export const DREAM_FROM = "quest:dream";
export function sleepQuest(s, actor, api) {
  const a = s.actors[actor],
    home = api.home(actor);
  if (!a || !home || heldOf(a).some((w) => w.from === DREAM_FROM)) return null;
  return holdQuest(
    s,
    actor,
    { ...newWant("place", home, s.turn), step: { verb: "rest" } },
    DREAM_FROM,
  );
}
export function wake(s, actor, api) {
  const a = s.actors[actor];
  if (api.sanctuaries.includes(a.place)) a.sanctuary = a.place;
  if (!humanAvatarIds.includes(actor)) {
    a.level ??= levelFor(a.xp);
    return null;
  }
  const w = heldOf(a).find(
    (q) =>
      q.from === DREAM_FROM && q.step?.verb === "rest" && q.target === a.place,
  );
  if (!w || api.home(actor) !== a.place) return null;
  commitMet(s, actor, api, [], w);
  const id = api.dreamCard?.(actor);
  if (!id) return null;
  a.glimpse = {
    level: Math.min(LEVEL_CAP, arcanaLevel(s, actor) + 2),
    kind: "arcanum",
    id,
    at: a.place,
  };
  return "glimpse";
}
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
export const lostOf = (s, w) =>
  w
    ? [
        w.target,
        w.step?.to,
        w.step?.with,
        w.step?.at,
        ...(w.step?.items || []).filter(
          (id) => !(w.step.finish && spentByChoice(s, id)),
        ),
      ].find((id) => typeof id === "string" && neverBack(s, id))
    : undefined;

// An authored want as the actor holds it: its kind, target, light and step.
const heldWant = (s, w) => ({
  ...newWant(w.kind, w.target, s.turn),
  ...(w.kind === "item" && typeof w.lit === "boolean" ? { lit: w.lit } : {}),
  ...(w.step ? { step: { ...w.step } } : {}),
});

// A resident's staged wants (rules 133): of the entries of its `wants` list
// that can be taken now, the one with the lowest seeded hash of (resident,
// entry, day); the authored order only breaks a tie. Eligible means `when`
// holds in the world, the target is in this world, the want is not already
// met where the resident stands, and it is not the want just met or given up
// (`previous`). Nothing is saved: the pick is a function of the world and the
// run seed, and stays the same through the day. Null when none is eligible,
// and for a resident with no `wants` list.
// FNV keeps the order of two near strings from one day to the next, so the
// hash is mixed once more (murmur3's finalizer) before entries are compared.
const mixed = (h) => {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
};
export const stagedOrder = (a, b) => a.rank - b.rank || a.index - b.index;
export function stagedNext(s, id, previous = null) {
  if (!packPeople[id]?.wants) return null;
  const day = Math.floor(s.turn / (2 * DAYLIGHT_TURNS));
  const entries = stagedWants(s, id)
    .filter(
      ({ open, want }) =>
        open &&
        (!want.minTrust ||
          Object.entries(s.actors[id].trust || {}).some(
            ([who, trust]) => trust >= want.minTrust && controlledByHuman(s, who),
          )) &&
        validTarget(s, want.kind, want.target) &&
        !lostOf(s, want) &&
        !(previous && questTerms(heldWant(s, want)) === questTerms(previous)) &&
        !questMet(s, id, heldWant(s, want), null, null),
    )
    .map((entry) => ({
      ...entry,
      rank: mixed(runHash(s, `staged:${id}:${entry.index}:${day}`)),
    }))
    .sort(stagedOrder);
  return entries.length ? heldWant(s, entries[0].want) : null;
}

// Every actor carries a want record, experience and what it has seen.
export function installWants(s) {
  for (const [id, a] of Object.entries(s.actors)) {
    if (wantless(id)) a.want = null;
    else if (!("want" in a)) {
      // A player has no authored want: it takes its quests by a tap. A
      // resident with staged wants takes one of them, else its authored want.
      const w = humanAvatarIds.includes(id) ? null : authoredWant(id);
      a.want = humanAvatarIds.includes(id)
        ? null
        : (stagedNext(s, id) ??
          (w && validTarget(s, w.kind, w.target) && !lostOf(s, w)
            ? heldWant(s, w)
            : null));
    }
    a.xp ??= startXp(id);
    delete a.halfwayIssued;
    if (a.glimpse !== undefined && !validGlimpse(a.glimpse)) delete a.glimpse;
    if (humanAvatarIds.includes(id) && heldOf(a).some((w) => w.quest)) {
      const kept = heldOf(a).filter((w) => !w.quest);
      a.want = kept[0] ?? null;
      if (kept.length > 1) a.under = kept.slice(1);
      else delete a.under;
    }
    while (heldOf(a).length && slotsUsed(a) > MAX_HELD)
      releaseQuest(a, heldOf(a).at(-1));
    // Old saves without an explicit level retain their already earned level.
    if (packPeople[id]?.levelAtHome) a.level ??= levelFor(a.xp);
    a.visited ??= [a.place];
    a.talked ??= [];
  }
}

// Candidates: items held by others that the actor values above the least
// valued thing it carries and could get by gift or trade, known places it has
// not visited, and known people it has not talked with. An item nobody would
// part with stays out of the near pool, so an empty-handed avatar's curiosity
// can run dry and start over instead of circling a hoard (#1781). `api` supplies world reads owned by world.mjs.
// With `wide`, nothing near is left, so anyone known and anything they hold
// counts, seen or not and wherever they are: a want may be a mystery a while.
// A resident's pursuit needs a way there, so it keeps to the known.
export function wantCandidates(
  s,
  actor,
  api,
  previous = null,
  wide = false,
  anywhere = false,
) {
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
  // A resident kept to a range (rules 100) reaches what lies within it.
  const reach =
    travels(actor, s) || api.wanders?.(actor) ? api.reachable(actor) : [];
  const near = new Set([a.place, ...reach]);
  // A resident kept to a range wants within it (rules 100).
  const inRange = anywhere ? null : api.rangeTest?.(actor);
  const within = (place) =>
    (wide || near.has(place)) && (!inRange || inRange(place));
  const items = Object.keys(s.items).filter((id) => {
    const owner = api.rootHolder(id);
    const person = Object.hasOwn(s.actors, owner);
    return (
      entityActive(s, id) &&
      owner !== actor &&
      person &&
      within(s.actors[owner].place) &&
      !(
        s.actors[owner].want?.kind === "item" &&
        s.actors[owner].want.target === id
      ) &&
      api.valueOf(actor, id) > floor &&
      (wide || !api.obtainable || api.obtainable(actor, id))
    );
  });
  // A place is wanted only while a route to it is open.
  const places = reach.filter((id) => wide || !a.visited.includes(id));
  const people = [
    ...new Set([
      ...knownActors(s),
      ...Object.keys(s.actors).filter(
        (id) => !humanAvatarIds.includes(id) && entityActive(s, id),
      ),
    ]),
  ].filter(
    (id) =>
      id !== actor &&
      (wide || !a.talked.includes(id)) &&
      within(s.actors[id].place),
  );
  return [
    ...items.map((target) => ["item", target]),
    ...places.map((target) => ["place", target]),
    ...people.map((target) => ["person", target]),
  ]
    .filter(
      ([kind, target]) =>
        !neverBack(s, target) &&
        (kind !== previous?.kind || target !== previous.target) &&
        !(
          a.gaveUp?.target === target && s.turn - a.gaveUp.turn < CONTENT_TURNS
        ),
    )
    .map(([kind, target]) => `${kind}:${target}`)
    .sort();
}
export function nextWant(s, actor, api, previous = null) {
  if (wantless(actor)) return null;
  const staged = stagedNext(s, actor, previous);
  if (staged) return staged;
  const thick = previous?.from === HEARD_FROM && authoredWant(actor);
  if (thick && validTarget(s, thick.kind, thick.target) && !lostOf(s, thick))
    return heldWant(s, thick);
  const a = s.actors[actor];
  const heard = heardWant(
    s,
    actor,
    api,
    [previous?.target, s.turn - (a.gaveUp?.turn ?? -CONTENT_TURNS) < CONTENT_TURNS && a.gaveUp.target],
    travels(actor, s) || Boolean(api.wanders?.(actor)),
  );
  if (heard) return heard;
  const roll = runHash(s, `want:${actor}:${s.turn}`);
  let pool = wantCandidates(s, actor, api, previous);
  if (!pool.length) {
    a.visited = [a.place];
    a.talked = [];
    pool = wantCandidates(s, actor, api, previous);
  }
  if (!pool.length) pool = wantCandidates(s, actor, api, previous, true);
  if (!pool.length) pool = wantCandidates(s, actor, api, null, true, true);
  if (!pool.length) return null;
  const [kind, target] = pool[roll % pool.length].split(":");
  return newWant(kind, target, s.turn);
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
const placeOfItem = (s, item) => {
  const root = rootOf(s, item);
  return s.actors[root]?.place ?? root;
};
const together = (s, a, b) =>
  Boolean(s.actors[b]) && s.actors[b].place === s.actors[a].place;
export function layMet(world, { target, step, lit }) {
  if (step.finish)
    return world.packs?.[packOf(target)?.id]?.flags?.[step.finish] === true;
  return step.items.every(
    (item) =>
      world.items[item]?.holder === target &&
      (!lit || Boolean(world.items[item].lit)),
  );
}

function stepMet(s, actor, want, action) {
  const { verb, to, at } = want.step,
    me = s.actors[actor],
    by = (kind) =>
      action?.kind === kind &&
      action.actor === actor &&
      (verb === "give"
        ? action.item === want.target && action.target === to && action.accepted
        : action.target === want.target);
  if (verb === "lay") return layMet(s, want);
  if (verb === "find") return placeOfItem(s, want.target) === me.place;
  // Eat (rules 102): this avatar eats the food, there and with that
  // companion if named, once the companion agrees; or the companion it
  // named eats it with this avatar.
  if (verb === "eat")
    return Boolean(
      action?.kind === "eat" &&
        action.item === want.target &&
        action.accepted !== false &&
        (!at || me.place === at) &&
        ((action.actor === actor &&
          (!want.step.with || action.target === want.step.with)) ||
          (want.step.with &&
            action.actor === want.step.with &&
            action.target === actor)),
    );
  if (verb === "give") return by("give") || by("trade");
  // A person brought, as Talk asks (rules 99): to a place in your company,
  // or to the one they want to see.
  if (verb === "bring" && want.kind === "person")
    return at
      ? together(s, actor, want.target) && me.place === at
      : together(s, want.target, to);
  // Bring with no one to bring it to: home, as a homecoming wants.
  if (verb === "bring")
    return (
      rootOf(s, want.target) === actor &&
      me.place === at &&
      (!to || together(s, actor, to))
    );
  if (verb === "meet")
    return together(s, actor, want.target) && (!at || me.place === at);
  if (verb === "rest") return false; // met only on waking there
  return by(verb); // threaten, attack: any outcome
}
export const wantMet = (s, actor, talk = null, action = null) =>
  questMet(s, actor, wantOf(s, actor), talk, action);
function questMet(s, actor, want, talk, action) {
  if (!want) return false;
  if (want.step) return stepMet(s, actor, want, action);
  if (want.kind === "connect") return introduced(s, actor, talk);
  if (want.kind === "item")
    return (
      holdsAsWanted(s, actor, want) ||
      (want.lit === undefined &&
        action?.kind === "give" &&
        action.accepted === true &&
        action.target === actor &&
        action.item === want.target)
    );
  if (want.kind === "place") return s.actors[actor].place === want.target;
  return Boolean(
    s.actors[want.target]?.place === s.actors[actor].place &&
      (talk
        ? (talk.actor === actor && talk.target === want.target) ||
          (talk.actor === want.target && talk.target === actor)
        : action?.led?.includes(actor) && entityActive(s, want.target)),
  );
}
// Whether holding this item now meets the actor's item want, as settleWants
// would judge it: a gift answers a want only if it meets one.
export const meetsItemWant = (s, actor, item, action = null) => {
  const w = wantOf(s, actor);
  return Boolean(
    w && w.kind === "item" && w.target === item &&
      questMet(s, actor, w, null, action),
  );
};
// An item want may name the item's light: then it is met only in the
// actor's own hands, lit (or dark) and uncovered, as a moth wants a flame.
export function holdsAsWanted(s, actor, want) {
  if (want.lit === undefined) return rootOf(s, want.target) === actor;
  const item = s.items[want.target];
  return (
    item.holder === actor &&
    Boolean(item.lit) === want.lit &&
    !Object.values(s.items).some((i) => i.holder === want.target)
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

// A resident rests right where it met a want, holding the next one.
export const resting = (s, actor) => {
  const want = wantOf(s, actor);
  return Boolean(
    s.actors[actor].metTurn !== undefined &&
      s.turn - s.actors[actor].metTurn < REST_TURNS &&
      (!want || want.since >= s.actors[actor].metTurn),
  );
};

// Record what each participant saw and said, then commit met wants. The want
// is paid on the play that meets it. A resident's next is drawn where one is
// met. A player whose play meets ANOTHER avatar's want helps them.
export function settleWants(s, actors, api, action = null, stale = []) {
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
    if (api.sanctuaries.includes(a.place)) a.sanctuary = a.place;
    if (talk && [talk.actor, talk.target].includes(id)) {
      const other = talk.actor === id ? talk.target : talk.actor;
      if (s.actors[other] && !a.talked.includes(other))
        a.talked = [...a.talked, other].slice(-64);
    }
    for (const held of api.player(id) ? heldOf(a) : a.want ? [a.want] : [])
      if (questMet(s, id, held, talk, action)) {
        commitMet(s, id, api, met, held);
        if (stale.includes(id)) continue;
        helped(s, id, api, action);
        if (a.content) setWant(a, stagedNext(s, id, held));
      }
  }
  return met;
}
// A refused gift or trade meets nothing, and a handover under pressure is no
// help. A plain Give earns trust in `trustGiver`.
function helped(s, owner, api, action) {
  const own = action?.actor === owner,
    helper = own ? action.target : action?.actor,
    h = s.actors[helper];
  if (
    !h || helper === owner || action.accepted === false || action.pressured ||
    api.player(owner)
  )
    return;
  if (!own && api.player(helper) && !humanAvatarIds.includes(helper)) {
    h.level ??= levelFor(h.xp);
    h.xp += 1;
  }
  const o = s.actors[owner];
  if (!own && api.player(helper) && humanAvatarIds.includes(helper) && !humanAvatarIds.includes(owner)) {
    const rank = levelFor(Math.max(0, o.xp - 1));
    if (rank < rankOf(LEVEL_CAP)) o.xp = Math.max(o.xp, rankXp(rank + 1));
    if (!packPeople[owner]?.levelAtHome)
      o.level = Math.max(o.level ?? 1, levelFor(o.xp));
  }
  if (action.kind !== "give" || action.chosen) gainTrust(s, owner, helper);
}
function commitMet(s, id, api, met, held = null) {
  const a = s.actors[id],
    want = held ?? a.want,
    traveler = humanAvatarIds.includes(id);
  const xp = traveler || want.from?.startsWith("quest:box:") ? 0 : 1;
  if (!traveler) a.level ??= levelFor(a.xp);
  a.xp += xp;
  a.metTurn = s.turn;
  met.push({ actorId: id, want });
  api.log(id, want);
  if (traveler && want.from?.startsWith("quest:from:"))
    countResidentQuest(a, want.from.slice("quest:from:".length));
  if (want.from?.startsWith(PLACE_FROM)) {
    const place = want.from.slice(PLACE_FROM.length),
      met = s.placeMet?.[place] ?? [],
      laid = want.step.items.filter((item) => !met.includes(item));
    if (laid.length) s.placeMet = { ...s.placeMet, [place]: [...met, ...laid] };
  }
  if (!traveler && !api.player(id) && !packPeople[id]?.levelAtHome)
    a.level = Math.max(a.level, levelFor(a.xp));
  if (api.player(id)) closeQuest(a, want, s.turn);
  if (api.player(id) || a.under) releaseQuest(a, want);
  else a.want = null;
  if (!api.player(id) && !a.want) {
    const staged = stagedNext(s, id, want);
    if (staged) setWant(a, staged);
    else a.content = true;
  }
  return met;
}

export function refuseWant(s, actor, item, api) {
  const want = wantOf(s, actor);
  if (want?.kind !== "item" || want.target !== item || api.player(actor))
    return;
  if (want.refusals === 0 && !travels(actor, s)) want.since = s.turn;
  want.refusals = Math.min(REFUSAL_LIMIT, want.refusals + 1);
}
export const quietWant = (s, actor, item) => {
  const want = s.actors[actor]?.want;
  return Boolean(
    want?.kind === "item" &&
      want.target === item &&
      want.refusals >= REFUSAL_LIMIT,
  );
};
function giveUp(s, actor, api) {
  const a = s.actors[actor],
    want = a.want;
  a.gaveUp = { target: want.target, turn: s.turn };
  setWant(a, nextWant(s, actor, api, want));
}
const stallStart = (s, id, want, api) =>
  Math.max(
    want.since,
    api.metTurn?.(id) ?? 0,
    (s.actors[id].dwellUntil ?? 0) - MAX_DWELL,
  );
export function reviseStalledWants(s, actors, api, before = s) {
  for (const [id, a] of Object.entries(s.actors)) {
    if (a.want && !api.player(id) && !entityActive(s, id))
      a.want.since = s.turn;
    const was = before.actors[id]?.want;
    if (
      a.want?.kind === "item" &&
      a.want.refusals &&
      before.items[a.want.target] &&
      rootOf(before, a.want.target) !== rootOf(s, a.want.target)
    )
      a.want.refusals -= Math.min(
        a.want.refusals,
        was?.kind === "item" && was.target === a.want.target ? was.refusals : 0,
      );
  }
  for (const id of actors) {
    const want = wantOf(s, id);
    if (
      !api.player(id) &&
      !accepted(s, id) &&
      (travels(id, s) || api.wanders?.(id)) &&
      (want?.kind === "place"
        ? want.target !== s.actors[id].place &&
          !api.reachable(id).includes(want.target)
        : want?.kind === "person" &&
          (!entityActive(s, want.target) ||
            (humanAvatarIds.includes(id) &&
              s.actors[want.target].place !== s.actors[id].place &&
              !api.reachable(id).includes(s.actors[want.target].place)))) &&
      s.turn - stallStart(s, id, want, api) >= STALL_TURNS
    )
      giveUp(s, id, api);
  }
  for (const id of Object.keys(s.actors).sort()) {
    const want = s.actors[id].want;
    if (
      want &&
      !api.player(id) &&
      !humanAvatarIds.includes(id) &&
      entityActive(s, id) &&
      !accepted(s, id) &&
      s.turn - stallStart(s, id, want, api) >= STALL_TURNS
    )
      giveUp(s, id, api);
  }
}
const accepted = (s, id) =>
  Object.values(s.actors).some((a) =>
    heldOf(a).some((w) => w.from === `quest:from:${id}`),
  );
export function settleLost(s, api, action = null) {
  for (const id of Object.keys(s.actors).sort()) {
    const a = s.actors[id];
    if (humanAvatarIds.includes(id) || api.player(id)) {
      for (const w of heldOf(a)) if (lostOf(s, w)) releaseQuest(a, w);
      continue;
    }
    const lost = lostOf(s, a.want);
    if (!lost || !entityActive(s, id)) continue;
    const by = sawLost(s, id, lost, action, api);
    if (by && a.trust) a.trust[by] = Math.max(0, (a.trust[by] || 0) - 1);
    api.lost(id, lost, by);
    setWant(a, nextWant(s, id, api, a.want));
  }
}
function sawLost(s, id, lost, action, api) {
  const by = action?.actor;
  const named =
    [action?.item, action?.receive].includes(lost) ||
    Boolean(
      packDefinition(action?.packId)
        ?.choices?.find((c) => c.id === action.choiceId)
        ?.effects.some((e) => e.item === lost),
    );
  return by &&
    by !== id &&
    api.player(by) &&
    s.actors[by]?.place === s.actors[id].place &&
    named
    ? by
    : null;
}
// A resident's want left empty is drawn after a short rest. A player is never
// drawn one: it takes its quests by a tap.
export function fillWants(s, api, now = false) {
  for (const [id, a] of Object.entries(s.actors)) {
    if (a.want) delete a.content;
    if (api.player(id) || wantless(id)) continue;
    if (
      !a.want &&
      entityActive(s, id) &&
      (now || s.turn - (a.metTurn ?? 0) >= CONTENT_TURNS)
    )
      setWant(a, nextWant(s, id, api));
  }
}
// Waking from any Sleep ends a resident's contentment: the next want is
// drawn as ever.
export function renewWant(s, id, api) {
  const a = s.actors[id];
  if (!a?.content || api.player(id)) return;
  delete a.content;
  if (!a.want) setWant(a, nextWant(s, id, api));
}

const STEP_CARDS = { give: ["to"], bring: ["to", "at"] };
function validStep(s, w, id) {
  const { verb, ...cards } = w.step;
  if (verb === "lay")
    return (
      w.kind === "place" &&
      Object.keys(cards).every((key) => ["items", "finish"].includes(key)) &&
      Array.isArray(cards.items) &&
      cards.items.length >= 1 &&
      cards.items.length <= 3 &&
      new Set(cards.items).size === cards.items.length &&
      cards.items.every((item) => Object.hasOwn(s.items, item)) &&
      (cards.finish === undefined ||
        (packOf(w.target)?.avatars &&
          Object.values(packOf(w.target).avatars).some(
            (resident) =>
              resident.want?.target === w.target &&
              resident.want?.step?.verb === "lay" &&
              resident.want.step.finish === cards.finish &&
              JSON.stringify(resident.want.step.items) ===
                JSON.stringify(cards.items),
          )))
    );
  const home = verb === "bring" && w.story && !cards.to;
  // A sealed gate's quest may ask for a gift (rules 95).
  const gift = verb === "give" && w.story;
  // The quest to sleep at a sanctuary stands alone (rules 99).
  const slept = verb === "rest" && !w.story;
  // An eat quest, authored or drawn, names a food (rules 102).
  const eaten = verb === "eat" && w.kind === "item" && isFood(w.target);
  // Talk's quests (rules 99): give an item, or bring a person to a place or
  // to someone, never both.
  const asked =
    !w.story &&
    ((verb === "give" && w.kind === "item") ||
      (verb === "bring" && w.kind === "person"));
  const named = eaten
    ? ["at", "with"].filter((key) => cards[key] !== undefined)
    : home
      ? ["at"]
      : asked && w.kind === "person"
        ? [cards.at === undefined ? "to" : "at"]
        : STEP_CARDS[verb] || (verb === "meet" && cards.at ? ["at"] : []);
  return (
    (home || gift || slept || asked || eaten) &&
    [
      ...(STEP_VERBS[w.kind] || []),
      ...(eaten ? ["eat"] : []),
      ...(w.kind === "person" ? SAVED_STEP_VERBS : []),
      ...(asked ? [verb] : []),
    ].includes(verb) &&
    Object.keys(cards).length === named.length &&
    named.every((key) => typeof cards[key] === "string") &&
    (!cards.to ||
      (Object.hasOwn(s.actors, cards.to) && cards.to !== w.target)) &&
    (!cards.with || (Object.hasOwn(s.actors, cards.with) && cards.with !== id))
  );
}
// The saved record of wants a player was told by Talk, by avatar
// (talk-quest.mjs, rules 99).
function validHeard(s, id) {
  const heard = s.actors[id].heard;
  if (heard === undefined) return true;
  return Boolean(
    heard &&
      typeof heard === "object" &&
      !Array.isArray(heard) &&
      Object.entries(heard).every(
        ([them, told]) =>
          them !== id &&
          Object.hasOwn(s.actors, them) &&
          typeof told === "string" &&
          told.length <= 160 &&
          /^(item|place|person):./u.test(told),
      ),
  );
}
export function validWant(s, id) {
  const a = s.actors[id];
  const whole = (n) => Number.isSafeInteger(n) && n >= 0 && n <= s.turn;
  const list = (v, of) =>
    Array.isArray(v) &&
    v.length <= 64 &&
    new Set(v).size === v.length &&
    v.every((x) => Object.hasOwn(of, x));
  // Experience an avatar brought from its last world (#1846) raises the cap.
  // Each box it opened paid one (rules 133, world/boxes.mjs).
  const most =
    startXp(id) +
    (a.carried ?? 0) +
    s.turn * 8 +
    (humanAvatarIds.includes(id) ? 0 : rankXp(rankOf(LEVEL_CAP))) +
    Object.values(s.opened || {}).filter((who) => who.includes?.(id)).length;
  return (
    Number.isSafeInteger(a.xp) &&
    a.xp >= 0 &&
    (a.carried === undefined ||
      (Number.isSafeInteger(a.carried) && a.carried >= 0)) &&
    (a.level === undefined ||
      (Number.isSafeInteger(a.level) &&
        a.level >= 1 &&
        a.level <= levelFor(most))) &&
    a.xp <= most &&
    (a.metTurn === undefined || whole(a.metTurn)) &&
    validUnder(s, id) &&
    validClosed(s, a) &&
    a.questRewards === undefined &&
    (a.content === undefined || a.content === true) &&
    (a.glimpse === undefined || validGlimpse(a.glimpse)) &&
    a.halfwayIssued === undefined &&
    (a.gaveUp === undefined ||
      (a.gaveUp &&
        Object.keys(a.gaveUp).length === 2 &&
        typeof a.gaveUp.target === "string" &&
        whole(a.gaveUp.turn))) &&
    list(a.talked, s.actors) &&
    validHeard(s, id) &&
    validRumours(s, id) &&
    validOffered(s, id) &&
    !a.talked.includes(id) &&
    Array.isArray(a.visited) &&
    (a.want === null || validQuest(s, id, a.want))
  );
}
function validUnder(s, id) {
  const a = s.actors[id];
  if (a.under === undefined) return true;
  const held = heldOf(a);
  return Boolean(
    humanAvatarIds.includes(id) &&
      Array.isArray(a.under) &&
      a.want &&
      a.under.length >= 1 &&
      slotsUsed(a) <= MAX_HELD &&
      a.under.every((w) => validQuest(s, id, w)) &&
      new Set(held.map(closedKey)).size === held.length,
  );
}
function validClosed(s, a) {
  if (a.closed === undefined) return true;
  const entries =
    a.closed && typeof a.closed === "object" && !Array.isArray(a.closed)
      ? Object.entries(a.closed)
      : null;
  return Boolean(
    entries &&
      entries.length >= 1 &&
      entries.length <= MAX_CLOSED &&
      entries.every(
        ([from, rec]) =>
          OFFER_FROM.test(from) &&
          Array.isArray(rec) &&
          rec.length === 2 &&
          Number.isSafeInteger(rec[0]) &&
          rec[0] >= 0 &&
          rec[0] <= s.turn &&
          typeof rec[1] === "string" &&
          rec[1].length <= 400,
      ),
  );
}
const OFFER_FROM = /^quest:[\w:.-]{1,80}$/u;
function validQuest(s, id, w) {
  const whole = (n) => Number.isSafeInteger(n) && n >= 0 && n <= s.turn;
  return Boolean(
    w &&
      typeof w === "object" &&
      Object.keys(w).length ===
        4 +
          (w.step === undefined ? 0 : 1) +
          (w.lit === undefined ? 0 : 1) +
          (w.story === undefined ? 0 : 1) +
          (w.from === undefined ? 0 : 1) &&
      (w.from === undefined ||
        (typeof w.from === "string" && OFFER_FROM.test(w.from))) &&
      (w.step === undefined || validStep(s, w, id)) &&
      (w.lit === undefined ||
        (w.kind === "item" && typeof w.lit === "boolean") ||
        (w.step?.verb === "lay" && w.lit === true)) &&
      w.quest === undefined &&
      (w.story === undefined || w.story === true) &&
      WANT_KINDS.includes(w.kind) &&
      typeof w.target === "string" &&
      validTarget(s, w.kind, w.target) &&
      !(w.kind === "person" && w.target === id) &&
      whole(w.since) &&
      Number.isInteger(w.refusals) &&
      w.refusals >= 0 &&
      w.refusals <= REFUSAL_LIMIT,
  );
}
