// One want per avatar: an item, a place or a person. The world rules decide
// when it is met and what it earns: one experience, paid on the play that
// meets it. `actor.want` is that want.
// A resident's next want is drawn from the world, deterministically, so a
// replayed journal makes the same choices. A player's is never drawn or
import { BOARDY, connectedHumans } from "./boardyai.mjs";
import { humanAvatarIds, sharedEnabled } from "./human-cast.mjs";
import {
  entityActive,
  isFood,
  freed,
  isPackActor,
  packOf,
  packPeople,
} from "./pack-registry.mjs";
import { DAYLIGHT_TURNS, packDiscovered, runHash } from "./pack-rules.mjs";
import { drawGlimpse, validGlimpse } from "./glimpse.mjs";
import { authoredWant, stagedWants } from "./want-talk.mjs";
import { validOffered } from "./offer-chance.mjs";
import { MAX_DWELL } from "./world/dwell.mjs";

export const WANT_KINDS = ["item", "place", "person", "connect"];
// A want may name a verb beyond the kind's own (hold, be at, talk). State
// verbs are met when their condition holds after any play; act verbs when
// that play by the avatar resolves (Give only when accepted). A step names
// its other cards: `to` a person, `at` a place. A level quest is one step,
// rest: a long rest at the sanctuary the avatar last slept in.
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
// A want is set aside after this many refusals, or after a long spell with
// no way forward, and its target stays out of mind a while. A rest lasts a
// few turns after a want is met, wherever it was met.
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
export const travels = (id, s = null) =>
  !isPackActor(id) ||
  freed(s, id) ||
  id === BOARDY ||
  humanAvatarIds.includes(id) ||
  packPeople[id]?.personalQuests === true ||
  packPeople[id]?.roamingQuest !== undefined;

// Experience reaches each level on a rising curve: 0, 1, 3, 6, 10 ... points.
// The quest is the threshold (#1583): a player's level rises only through its
// level quest, which a long rest brings once experience reaches the next
// level. Residents, whose time is not their own, level on experience alone.
export const levelFor = (xp) => Math.floor((1 + Math.sqrt(1 + 8 * xp)) / 2);
export const levelOf = (s, id) =>
  s.actors[id]?.level ?? levelFor(s.actors[id]?.xp || 0);
// Opted-in residents bank experience while away. Their authored home stays
// fixed even when a journey or a visit changes their latest sanctuary.
export const levelReturnHome = (s, id) =>
  packPeople[id]?.levelAtHome && levelFor(s.actors[id].xp) > levelOf(s, id)
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
// The quest for level n has one step per five levels, ceil(n / 5): one
// through level 5, ten at Legendary (50), twenty at Mythic (100), and then
// the rest that raises the level. The table is in docs/design/level-curve.md.
export const QUEST_STEP_LEVELS = 5;
export const questSteps = (level) => Math.ceil(level / QUEST_STEP_LEVELS);
// Between level quests a player meets ordinary wants, as many as the next
// quest has steps and rest (option A, rules 99): `levelGap(L)` at level L.
export const levelGap = (level) => questSteps(level + 1) + 1;
// A player's next level quest comes with the experience its earlier level
// quests give (each step and rest is one), the one quest met before the
// first, and each level's gap of ordinary wants. Residents level on
// experience alone, on `levelFor`.
export const questXp = (level) => {
  if (level < 2) return 0;
  let xp = 1;
  for (let k = 2; k < level; k++) xp += questSteps(k) + 1;
  for (let k = 1; k < level; k++) xp += levelGap(k);
  return xp;
};
// The experience a level is reached with, before its gap, and its halfway.
export const levelXp = (level) => questXp(level + 1) - levelGap(level);
export const halfwayXp = (level) =>
  levelXp(level) + Math.ceil(levelGap(level) / 2);
// A pack resident may start at an authored level, with the experience that
// level takes, so its later level-ups stay on the same curve. Player and
// human avatars always start at the bottom.
export const startXp = (id) => {
  const level = isPackActor(id) ? packPeople[id].startLevel || 1 : 1;
  return (level * (level - 1)) / 2;
};

export const wantOf = (s, id) => s.actors[id]?.want ?? null;
// The same quest keeps its identity wherever it is read.
export const questTerms = (w) => JSON.stringify([
  w.kind, w.target,
  w.step ? Object.keys(w.step).sort().map((key) => [key, w.step[key]]) : null,
  w.lit ?? null,
]);
export const sameQuest = (left, right) =>
  !left.quest && !right.quest && questTerms(left) === questTerms(right);
export const wantKey = (id, want) =>
  `${id}:${want.kind}:${want.target}:${want.since}:${want.quest?.left ?? ""}:${questTerms(want)}`;
export const MAX_HELD = 9;
export const heldOf = (a) => (a?.want ? [a.want, ...(a.under || [])] : []);
export const questsOf = (s, id) => heldOf(s.actors[id]);
export const holdsLevelQuest = (a) => heldOf(a).some((w) => w.quest);
export const questRewardsOf = () => [];
export const closedKey = (w) =>
  questTerms(w) + (w.quest ? `:${w.quest.level}` : "");
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
  if (!a || heldOf(a).length >= MAX_HELD) return null;
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
  if (!want.from || want.quest) return;
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
  !want.quest &&
  Object.values(a.closed || {}).some(([, terms]) => terms === closedKey(want));
// Dropping Sleep at home (the level-up quest) costs the experience that
// leaves the player just under the threshold of the level it was for, so the
// level-up card does not come straight back (owner, 2026-11-11). That is
// never below the experience of the level held. Any other quest is free
// (owner, 2026-11-04; rules 98).
export function dropCost(s, actor) {
  const a = s.actors[actor],
    want = a?.want;
  if (!want?.quest) return 0;
  return Math.max(0, a.xp - (questXp(want.quest.level) - 1));
}
// A player sets the held quest down, at its `dropCost`. Its target stays out
// of mind a while and nothing is drawn in its place.
export function dropQuest(s, actor) {
  const a = s.actors[actor],
    want = a?.want;
  if (!want) return;
  a.xp -= dropCost(s, actor);
  a.gaveUp = { target: want.target, turn: s.turn };
  closeQuest(a, want, s.turn);
  releaseQuest(a, want);
}
// Sleep at home: the place want with a rest step. With a `quest` it is the
// level-up quest, aimed at the avatar's own home and met by a long rest there
// (rules 133, `restsAt`). Without one (a pack switched off under an old rest
// step) it is the way back to an active place that rests the avatar.
export const restStep = (s, actor, api, quest) => ({
  ...newWant(
    "place",
    quest
      ? api.home(actor)
      : [s.actors[actor].sanctuary, api.home(actor), ...api.sanctuaries].find(
          (p) =>
            p &&
            (api.restsAt?.(actor, p) ?? api.sanctuaries.includes(p)) &&
            (api.active?.(p) ?? true),
        ),
    s.turn,
  ),
  ...(quest ? { quest } : {}),
  step: { verb: "rest" },
});
// The level-up quest: at the experience of the next level, Sleep at home.
// Null while the home is unknown or the threshold is not reached.
export function levelUpQuest(s, actor, api) {
  const a = s.actors[actor];
  if (!a || !api.home(actor)) return null;
  const level = a.level ?? levelFor(a.xp);
  if (a.xp < questXp(level + 1)) return null;
  return restStep(s, actor, api, { level: level + 1, left: 1 });
}
// Long sleep completes a level quest's rest, or brings the halfway dream due
// from experience. Each level has a halfway glimpse.
export function wake(s, actor, api) {
  const a = s.actors[actor],
    before = a.xp;
  if (api.sanctuaries.includes(a.place)) a.sanctuary = a.place;
  a.level ??= levelFor(a.xp);
  const full = a.xp >= questXp(a.level + 1);
  let dream = null;
  // Experience makes a dream due. Sleep reveals it through the avatar.
  if (
    !full && a.xp >= halfwayXp(a.level) &&
    api.player(actor) &&
    !holdsLevelQuest(a) &&
    a.glimpse?.level !== a.level + 1
  ) {
    a.glimpse = drawGlimpse(s, actor, api, a.level + 1);
    dream = "glimpse";
  }
  const w = heldOf(a).find(
    (q) => q.quest && q.step?.verb === "rest" && q.target === a.place,
  );
  if (w && api.home(actor) === a.place) commitMet(s, actor, api, [], w);
  milestones(s, actor, before, api);
  return dream;
}
// Retain the saved halfway marker as experience passes its threshold.
// Sleep reads the threshold directly when the avatar wakes.
function milestones(s, id, before, api) {
  const a = s.actors[id];
  if (!api.player(id) || holdsLevelQuest(a)) return;
  const level = a.level ?? levelFor(a.xp),
    full = questXp(level + 1);
  const halfway =
    a.xp >= halfwayXp(level) && a.xp < full && a.halfwayIssued !== level + 1;
  if (!halfway && !(before < full && a.xp >= full)) return;
  a.halfwayIssued = level + 1;
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

// An authored want as the actor holds it: its kind, target, light and step.
// `minTrust` stays in pack data and is read there (want-talk.mjs).
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
        validTarget(s, want.kind, want.target) &&
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
    if (!("want" in a)) {
      // A player has no authored want: it takes its quests by a tap. A
      // resident with staged wants takes one of them, else its authored want.
      const w = humanAvatarIds.includes(id) ? null : authoredWant(id);
      a.want = humanAvatarIds.includes(id)
        ? null
        : (stagedNext(s, id) ??
          (w && validTarget(s, w.kind, w.target) ? heldWant(s, w) : null));
    }
    a.xp ??= startXp(id);
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
  const people = knownActors(s).filter(
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
        (kind !== previous?.kind || target !== previous.target) &&
        !(
          a.gaveUp?.target === target && s.turn - a.gaveUp.turn < CONTENT_TURNS
        ),
    )
    .map(([kind, target]) => `${kind}:${target}`)
    .sort();
}
// A resident with no want left draws one: something near and new first; with
// all of it seen, curiosity starts over from here; then anything known, and
// at last even the want just met, again. A player is never drawn a want.
export function nextWant(s, actor, api, previous = null) {
  const staged = stagedNext(s, actor, previous);
  if (staged) return staged;
  const roll = runHash(s, `want:${actor}:${s.turn}`);
  let pool = wantCandidates(s, actor, api, previous);
  if (!pool.length) {
    const a = s.actors[actor];
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
export function layMet(world, { target, step }) {
  if (step.finish)
    return world.packs?.[packOf(target)?.id]?.flags?.[step.finish] === true;
  return step.items.every((item) => world.items[item]?.holder === target);
}

function stepMet(s, actor, want, action) {
  const { verb, to, at } = want.step,
    me = s.actors[actor],
    by = (kind) =>
      action?.kind === kind &&
      action.actor === actor &&
      (kind === "give"
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
  if (verb === "give") return by("give");
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
  if (want.kind === "item") return holdsAsWanted(s, actor, want);
  if (want.kind === "place") return s.actors[actor].place === want.target;
  return Boolean(
    talk &&
      s.actors[want.target]?.place === s.actors[actor].place &&
      ((talk.actor === actor && talk.target === want.target) ||
        (talk.actor === want.target && talk.target === actor)),
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
// met; only a level quest ends with the way back to a sanctuary, where a long
// rest raises the level. A player whose play meets ANOTHER avatar's want helps
// them: one experience for the helper, and the owner trusts them one more.
export function settleWants(s, actors, api, action = null) {
  const talk =
    action?.kind === "talk"
      ? { actor: action.actor, target: action.target }
      : null;
  const met = [];
  for (const id of actors) {
    const a = s.actors[id];
    if (!a) continue;
    const before = a.xp;
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
        helped(s, id, api, action);
      }
    if (a.xp > before) milestones(s, id, before, api);
  }
  return met;
}
// The helper is the player whose play it was; credit goes only where the
// causing play names one. A refused gift or trade meets nothing, and a
// handover under pressure is no help. A plain Give
// already earns its trust (`trustGiver`), so it adds only the experience.
function helped(s, owner, api, action) {
  const helper = action?.actor,
    h = s.actors[helper];
  if (
    !h || helper === owner || action.accepted === false || action.pressured ||
    !api.player(helper) || api.player(owner)
  )
    return;
  // A level rises through its own quest, so the level held is fixed first.
  h.level ??= levelFor(h.xp);
  h.xp += 1;
  milestones(s, helper, h.xp - 1, api);
  const trust = s.actors[owner].trust;
  if (action.kind !== "give" && trust)
    trust[helper] = Math.min(3, (trust[helper] || 0) + 1);
}
// The met want pays one experience at once. A level quest's final rest pays
// none: the level itself rises by one, on waking.
function commitMet(s, id, api, met, held = null) {
  const a = s.actors[id],
    want = held ?? a.want,
    level = want.quest && want.step?.verb === "rest" ? want.quest.level : null;
  a.level ??= levelFor(a.xp);
  const xp = level || want.from?.startsWith("quest:box:") ? 0 : 1;
  a.xp += xp;
  a.metTurn = s.turn;
  met.push({ actorId: id, want });
  api.log(id, want, xp);
  if (level) {
    a.level = Math.max(a.level, level);
    delete a.glimpse;
  } else if (!api.player(id) && !packPeople[id]?.levelAtHome)
    a.level = Math.max(a.level, levelFor(a.xp));
  if (api.player(id)) closeQuest(a, want, s.turn);
  if (api.player(id) || a.under) releaseQuest(a, want);
  else a.want = null;
  // A resident met takes its next staged want at once, if one can be taken
  // (rules 133). Otherwise it is content for a while; a player simply holds
  if (!api.player(id) && !a.want) {
    const staged = stagedNext(s, id, want);
    if (staged) setWant(a, staged);
    else a.content = true;
  }
  return met;
}

// A refusal of the actor's own want counts; enough of them set it aside.
export function refuseWant(s, actor, item, api) {
  const want = wantOf(s, actor);
  // A player's quest is never set aside by refusals; Drop sets it down.
  if (want?.kind !== "item" || want.target !== item || api.player(actor))
    return;
  // A resident that keeps to its scene only tries while someone is there, so
  // its stall clock starts at the first real attempt, not when it was given.
  if (want.refusals === 0 && !travels(actor, s)) want.since = s.turn;
  want.refusals += 1;
  if (want.refusals >= REFUSAL_LIMIT) giveUp(s, actor, api);
}
// A set-aside want stays out of mind for a while. A resident holds one want,
// so the want it sets aside is replaced by a newly drawn one and its target is
// remembered in `gaveUp`; nothing is kept beneath it.
function giveUp(s, actor, api) {
  const a = s.actors[actor],
    want = a.want;
  a.gaveUp = { target: want.target, turn: s.turn };
  setWant(a, nextWant(s, actor, api, want));
}
// A resident put ashore by a stuck ship sets its pursuit aside at once, as a
// stalled want is, so it does not board again for the same shut lane.
export function setAsideWant(s, actor, api) {
  if (s.actors[actor]?.want) giveUp(s, actor, api);
}
// A cast want with no way forward for a long spell is set aside. A resident
// that keeps to its scene acts only when someone is there, so time spent
// unseen is not a stall: its want can stall only after it has tried and been
// refused at least once.
// Where a want's stall clock starts: its draw, or the latest arrival if later
// (rules 133). A resident dwelling between steps is making progress at the
// pace of its stays, so each arrival restarts the clock. `dwellUntil` less
// the longest stay is never after the arrival.
const stallStart = (s, id, want) =>
  Math.max(want.since, (s.actors[id].dwellUntil ?? 0) - MAX_DWELL);
export function reviseStalledWants(s, actors, api) {
  // A resident's want clock starts when he first becomes active: while his card
  // is shut or he is absent, the want is kept fresh, so he does not arrive
  // with a stalled want that is set aside at once (rules 133).
  for (const [id, a] of Object.entries(s.actors))
    if (a.want && !api.player(id) && !entityActive(s, id))
      a.want.since = s.turn;
  for (const id of actors) {
    const want = wantOf(s, id);
    if (
      want &&
      !api.player(id) &&
      (travels(id, s) || api.wanders?.(id) || want.refusals > 0) &&
      s.turn - stallStart(s, id, want) >= STALL_TURNS
    )
      giveUp(s, id, api);
  }
}
// A resident's want left empty is drawn after a short rest. A player is never
// drawn one: it takes its quests by a tap.
export function fillWants(s, api, now = false) {
  for (const [id, a] of Object.entries(s.actors)) {
    if (a.want) delete a.content;
    if (api.player(id)) continue;
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
      !w.quest &&
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
  const gift = verb === "give" && w.story && !w.quest;
  // The quest to sleep at a sanctuary stands alone (rules 99).
  const slept = verb === "rest" && !w.story;
  // An eat quest, authored or drawn, names a food (rules 102).
  const eaten = verb === "eat" && w.kind === "item" && isFood(w.target);
  // Talk's quests (rules 99): give an item, or bring a person to a place or
  // to someone, never both.
  const asked =
    !w.quest &&
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
    (Boolean(w.quest) || home || gift || slept || asked || eaten) &&
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
    (a.glimpse === undefined || validGlimpse(a.glimpse, levelFor(most) + 1)) &&
    (a.halfwayIssued === undefined ||
      (Number.isSafeInteger(a.halfwayIssued) &&
        a.halfwayIssued >= 2 &&
        a.halfwayIssued <= levelFor(most) + 1)) &&
    (a.gaveUp === undefined ||
      (a.gaveUp &&
        Object.keys(a.gaveUp).length === 2 &&
        typeof a.gaveUp.target === "string" &&
        whole(a.gaveUp.turn))) &&
    list(a.talked, s.actors) &&
    validHeard(s, id) &&
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
      held.length <= MAX_HELD &&
      a.under.every((w) => validQuest(s, id, w)) &&
      new Set(held.map(closedKey)).size === held.length &&
      held.filter((w) => w.quest).length <= 1,
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
          (w.quest === undefined ? 0 : 1) +
          (w.step === undefined ? 0 : 1) +
          (w.lit === undefined ? 0 : 1) +
          (w.story === undefined ? 0 : 1) +
          (w.from === undefined ? 0 : 1) &&
      (w.from === undefined ||
        (typeof w.from === "string" && OFFER_FROM.test(w.from))) &&
      (w.step === undefined || validStep(s, w, id)) &&
      (w.lit === undefined ||
        (w.kind === "item" && typeof w.lit === "boolean")) &&
      (w.story === undefined || (w.story === true && !w.quest)) &&
      (w.quest === undefined ||
        (Object.keys(w.quest).length === 2 &&
          Number.isSafeInteger(w.quest.level) &&
          w.quest.level >= 2 &&
          Number.isSafeInteger(w.quest.left) &&
          w.quest.left === 1)) &&
      WANT_KINDS.includes(w.kind) &&
      typeof w.target === "string" &&
      validTarget(s, w.kind, w.target) &&
      !(w.kind === "person" && w.target === id) &&
      whole(w.since) &&
      Number.isInteger(w.refusals) &&
      w.refusals >= 0 &&
      w.refusals < REFUSAL_LIMIT,
  );
}
