// A stack of quests per avatar: each an item, a place or a person. The world
// rules decide when one is met and how much experience it earns.
// New quests go on top and nothing replaces one already
// held (#1831): `actor.want` is the top, the one pursued and shown, and
// `actor.under` the quests beneath it, next first. The next want is drawn
// from the world, deterministically, so a replayed journal makes the same
// choices.
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
import { packDiscovered, runHash } from "./pack-rules.mjs";
import { drawGlimpse, glimpseAspect, validGlimpse } from "./glimpse.mjs";
import { levelTier } from "./level-tiers.mjs";
import { authoredWant } from "./want-talk.mjs";

export const WANT_KINDS = ["item", "place", "person", "connect"];
// A level quest step may name a verb beyond the kind's own (hold, be at,
// talk). State verbs are met when their condition holds after any play; act
// verbs when that play by the avatar resolves (Give only when accepted). A
// step names its other cards: `to` a person, `at` a place. The last step,
// rest, is a long rest at the sanctuary the avatar last slept in.
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
// An avatar holds at most this many quests.
export const QUEST_LIMIT = 3;

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
// The whole stack, top first.
export const questsOf = (s, id) => {
  const a = s.actors[id];
  return a?.want ? [a.want, ...(a.under || [])] : [];
};
// A met want with nothing beneath leaves its avatar content: no want until
// it next rests (a player's Sleep, a resident's day). Any quest it takes on
// ends that.
export const contentOf = (s, id) =>
  Boolean(s.actors[id]?.content && !s.actors[id].want);
export function setQuests(a, list) {
  a.want = list[0] ?? null;
  if (a.want) delete a.content;
  if (list.length > 1) a.under = list.slice(1);
  else delete a.under;
}
const lastIndex = (list, test) => {
  for (let i = list.length - 1; i > 0; i--) if (test(list[i])) return i;
  return -1;
};
// A new quest goes on top. One the avatar already holds comes to the top
// instead of being held twice; a sanctuary quest takes the place of another
// quest for the same place. Past the limit the oldest ordinary quest
// leaves; a level quest never does, and a story quest (`story`, set by pack
// content) only when everything beneath the top is a level or story quest.
export function pushQuest(s, actor, want) {
  const a = s.actors[actor];
  const same = (w) =>
    !w.quest && !want.quest && w.kind === want.kind && w.target === want.target;
  const held = questsOf(s, actor);
  const old = held.find(same);
  const shape = (w) => JSON.stringify([w.step ?? null]);
  const replaces =
    old && shape(old) !== shape(want) && want.step?.verb === "rest";
  const top =
    old && !replaces
      ? { ...old, ...(want.story ? { story: true } : {}) }
      : want;
  const list = [top, ...held.filter((w) => !same(w))];
  while (list.length > QUEST_LIMIT) {
    const at = lastIndex(list, (w) => !w.quest && !w.story);
    list.splice(at > 0 ? at : lastIndex(list, (w) => !w.quest), 1);
  }
  setQuests(a, list);
  return top;
}
// The player chooses which quest to pursue: it comes to the top.
export function focusQuest(s, actor, index) {
  const list = questsOf(s, actor);
  if (!(index > 0 && index < list.length)) return;
  const [want] = list.splice(index, 1);
  setQuests(s.actors[actor], [want, ...list]);
}
// One step of a level quest: a want from the whole known world, among the
// half furthest from home, so higher levels reach further.
function questStep(s, actor, api, quest, previous = null) {
  const home = api.home(actor) || s.actors[actor].place;
  const away = (entry) => {
    const [kind, target] = entry.split(":");
    const at =
      kind === "item"
        ? api.placeOf(target)
        : kind === "person"
          ? s.actors[target].place
          : target;
    // Somewhere with no known way there is the furthest of all.
    const steps = api.distance(home, at, actor);
    return steps < 0 ? 64 : steps;
  };
  const pool = wantCandidates(s, actor, api, previous, true)
    .map((entry) => [away(entry), entry])
    .sort((x, y) => y[0] - x[0] || (x[1] < y[1] ? -1 : 1))
    .map(([, entry]) => entry);
  if (!pool.length) return nextWant(s, actor, api, previous);
  const far = pool.slice(0, Math.ceil(pool.length / 2));
  const roll = hash(`${actor}:${s.turn}`);
  const [kind, target] = far[roll % far.length].split(":");
  const step = drawStep(s, actor, api, kind, target, quest.level, roll);
  return { ...newWant(kind, target, s.turn), quest, ...(step ? { step } : {}) };
}
// A step's verb, drawn from the living world so quests interlock: an item
// another known avatar wants to hold may be given or brought to them, and a
// person on the way to a place may be met there. Finding needs no partner.
export function drawStep(s, actor, api, kind, target, level, roll) {
  const wanting =
    kind === "item" &&
    knownActors(s).find((id) => {
      return (
        id !== actor &&
        questsOf(s, id).some(
          (w) => w.kind === "item" && !w.step && w.target === target,
        )
      );
    });
  const going = kind === "person" && s.actors[target]?.want;
  const verbs =
    kind === "item"
      ? wanting
        ? ["give", "bring", "find"]
        : isFood(target)
          ? ["", "find", "eat"]
          : ["", "find"]
      : kind === "person"
        ? ["", "meet"]
        : [""];
  const verb = verbs[Math.floor(roll / 7) % verbs.length];
  // A step already true where the avatar stands is no step at all.
  const here = s.actors[actor].place;
  if (
    !verb ||
    (verb === "find" && placeOfItem(s, target) === here) ||
    (verb === "meet" && s.actors[target]?.place === here)
  )
    return null;
  if (verb === "give") return { verb, to: wanting };
  if (verb === "bring")
    return {
      verb,
      to: wanting,
      at: api.home(wanting) || s.actors[wanting].place,
    };
  if (verb === "meet" && going?.kind === "place" && !going.step)
    return { verb, at: going.target };
  return { verb };
}
// On waking from a long rest with experience enough for the next level, the
// player's level quest goes on top of its stack. It holds one at a time.
export function offerLevelQuest(s, actor, api) {
  const a = s.actors[actor];
  a.level ??= levelFor(a.xp);
  if (questsOf(s, actor).some((w) => w.quest) || a.xp < questXp(a.level + 1))
    return null;
  const level = a.level + 1,
    quest = { level, left: questSteps(level) + 1 };
  return pushQuest(
    s,
    actor,
    glimpseStep(s, actor, api, quest) ?? questStep(s, actor, api, quest),
  );
}
// The first step of a level quest glimpsed at halfway uses the glimpse's
// aspect (glimpse.mjs): an item is found, given, brought or held; a person
// met or talked with; a place visited. A verb is the step's own verb, on a
// target drawn from the whole world: an item to find, give or bring, or a
// person to meet. Giving and bringing go to one who wants the item, else to
// someone known. Null when the aspect cannot make a step.
function glimpseStep(s, actor, api, quest) {
  const g = s.actors[actor].glimpse,
    aspect = g?.level === quest.level && glimpseAspect(s, actor, api, g);
  if (!aspect) return null;
  const roll = runHash(s, `glimpse-step:${actor}:${quest.level}`),
    here = s.actors[actor].place;
  const want = (kind, target, step) => ({
    ...newWant(kind, target, s.turn),
    quest,
    ...(step ? { step } : {}),
  });
  if (aspect.kind === "place") return want("place", aspect.id);
  if (aspect.kind !== "verb")
    return want(
      aspect.kind,
      aspect.id,
      drawStep(s, actor, api, aspect.kind, aspect.id, quest.level, roll),
    );
  const verb = aspect.id,
    kind = verb === "meet" ? "person" : "item";
  const pool = wantCandidates(s, actor, api, null, true)
    .filter((entry) => entry.startsWith(`${kind}:`))
    .map((entry) => entry.slice(kind.length + 1))
    .filter((id) =>
      kind === "person"
        ? s.actors[id].place !== here
        : verb !== "find" || placeOfItem(s, id) !== here,
    );
  if (!pool.length) return null;
  const target = pool[roll % pool.length];
  if (verb === "find" || verb === "meet") return want(kind, target, { verb });
  const others = knownActors(s)
    .filter((id) => id !== actor && id !== rootOf(s, target))
    .sort();
  const to =
    others.find((id) =>
      questsOf(s, id).some(
        (w) => w.kind === "item" && !w.step && w.target === target,
      ),
    ) ?? others[Math.floor(roll / 7) % others.length];
  if (!to) return null;
  return want(
    "item",
    target,
    verb === "give"
      ? { verb, to }
      : { verb, to, at: api.home(to) || s.actors[to].place },
  );
}
// The way back to the sanctuary the avatar last slept in, or, for one that
// never reached a sanctuary or whose sanctuary sleeps, its home. Without a
// level quest it is the ordinary quest to sleep at a sanctuary, met by a
// long rest in any of them (rules 99).
export const restStep = (s, actor, api, quest) => ({
  ...newWant(
    "place",
    [s.actors[actor].sanctuary, api.home(actor)].find(
      (p) => p && (api.active?.(p) ?? true),
    ) ?? s.actors[actor].place,
    s.turn,
  ),
  ...(quest ? { quest } : {}),
  step: { verb: "rest" },
});
const sanctuaryQuest = (w) => w.step?.verb === "rest" && !w.quest;
// A sanctuary quest rebuilt for another place (its sanctuary gone quiet, or
// set aside) takes the place of an ordinary quest for that place, as
// `pushQuest` does, and of a later sanctuary quest; level quests stay as they
// are. Nothing else is held twice (rules 99).
export function mergeSanctuaryQuests(list) {
  const key = (w) => `${w.kind}:${w.target}`;
  const keeps = (k) => {
    const same = (w) => !w.quest && key(w) === k;
    const rest = list.findIndex((w) => same(w) && sanctuaryQuest(w));
    return rest >= 0 ? rest : list.findIndex(same);
  };
  return list.filter((w, i) => w.quest || keeps(key(w)) === i);
}
// Waking from a long rest meets a quest to sleep at a sanctuary, completes a
// level quest's rest step there, or, with the experience for the next level
// before it woke, brings that level quest. One long rest brings one of them
// at most: a sanctuary quest met short of full experience brings no level
// quest until the next long rest. It returns the rest's dream, if any: the
// halfway glimpse or the level quest, the only two a level has (rules 99).
export function wake(s, actor, api) {
  const a = s.actors[actor],
    before = a.xp;
  if (api.sanctuaries.includes(a.place)) a.sanctuary = a.place;
  a.level ??= levelFor(a.xp);
  const full = a.xp >= questXp(a.level + 1);
  let dream = null;
  // Met short of full experience, the sanctuary quest brings the glimpse.
  const slept = questsOf(s, actor).findIndex(sanctuaryQuest);
  if (slept >= 0) {
    commitMet(s, actor, api, [], slept);
    if (
      !full &&
      api.player(actor) &&
      !questsOf(s, actor).some((w) => w.quest) &&
      a.glimpse?.level !== a.level + 1
    ) {
      a.glimpse = drawGlimpse(s, actor, api, a.level + 1);
      dream = "glimpse";
    }
  }
  const rest = questsOf(s, actor).findIndex(
    (w) => w.quest && w.step?.verb === "rest" && w.target === a.place,
  );
  if (rest >= 0) commitMet(s, actor, api, [], rest);
  else if (full && offerLevelQuest(s, actor, api)) dream = "quest";
  milestones(s, actor, api, before);
  return dream;
}
// At halfway to the next level quest, and again at full experience as a
// pointer, a player is given the ordinary quest to sleep at a sanctuary
// (rules 99). It comes once per level at halfway, recorded as
// `halfwayIssued`, so a dropped one never returns; the pointer comes only as
// experience reaches full. A held level quest needs neither.
function milestones(s, id, api, before) {
  const a = s.actors[id];
  if (!api.player(id) || questsOf(s, id).some((w) => w.quest)) return;
  const level = a.level ?? levelFor(a.xp),
    full = questXp(level + 1);
  const halfway =
    a.xp >= halfwayXp(level) && a.xp < full && a.halfwayIssued !== level + 1;
  if (!halfway && !(before < full && a.xp >= full)) return;
  a.halfwayIssued = level + 1;
  pushQuest(s, id, restStep(s, id, api));
}
// Dropping a level quest costs one experience for the first (the quest to
// level 2), two for the next, and so on, never below the experience of the
// level held, so a level never falls. Any other quest is free (owner,
// 2026-11-04; rules 98).
export function dropCost(s, actor, index = 0) {
  const a = s.actors[actor],
    want = questsOf(s, actor)[index];
  if (!want?.quest) return 0;
  const floor = questXp(a.level ?? levelFor(a.xp));
  return Math.max(0, Math.min(want.quest.level - 1, a.xp - floor));
}
// A player may drop any quest in its stack, at its `dropCost`. Its target
// stays out of mind a while, and the quest beneath comes to the top;
// dropping the last one draws another at once.
export function dropQuest(s, actor, api, index = 0) {
  const a = s.actors[actor],
    list = questsOf(s, actor),
    want = list[index];
  if (!want) return;
  a.xp -= dropCost(s, actor, index);
  a.gaveUp = { target: want.target, turn: s.turn };
  list.splice(index, 1);
  setQuests(a, list);
  if (!a.want) setQuests(a, [nextWant(s, actor, api, want)].filter(Boolean));
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

// Every actor carries a want record, experience and what it has seen.
export function installWants(s) {
  for (const [id, a] of Object.entries(s.actors)) {
    if (!("want" in a)) {
      const w = authoredWant(id);
      a.want =
        w && validTarget(s, w.kind, w.target)
          ? {
              ...newWant(w.kind, w.target, s.turn),
              ...(w.kind === "item" && typeof w.lit === "boolean"
                ? { lit: w.lit }
                : {}),
              ...(w.step ? { step: { ...w.step } } : {}),
            }
          : null;
    }
    a.xp ??= startXp(id);
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
// valued thing it carries and could get by gift or trade, known places it has
// not visited, and known people it has not talked with. An item nobody would
// part with stays out of the near pool, so an empty-handed avatar's curiosity
// can run dry and start over instead of circling a hoard (#1781). `api` supplies world reads owned by world.mjs.
// With `wide`, nothing near is left, so anyone known and anything they hold
// counts, seen or not and wherever they are: a want may be a mystery a while.
// A player's wide pool is the whole world (#1831): any active person and
// place, met or found or not, and any item someone else holds or that lies
// somewhere. Residents, whose pursuit needs a way there, keep to the known.
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
  const whole = wide && Boolean(api.player?.(actor));
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
      (person || whole) &&
      within(person ? s.actors[owner].place : owner) &&
      !(
        person &&
        questsOf(s, owner).some((w) => w.kind === "item" && w.target === id)
      ) &&
      api.valueOf(actor, id) > floor &&
      (wide || !api.obtainable || api.obtainable(actor, id))
    );
  });
  // A place is wanted only while a route to it is open, unless the whole
  // world counts.
  const places = whole
    ? api.places().filter((id) => id !== a.place && entityActive(s, id))
    : reach.filter((id) => wide || !a.visited.includes(id));
  const people = (
    whole
      ? Object.keys(s.actors).filter((id) => entityActive(s, id))
      : knownActors(s)
  ).filter(
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
// An avatar with no quest left draws one: something near and new first; with
// all of it seen, curiosity starts over from here; then anything in the
// world, and at last even the want just met, again. A player's every other
// draw comes from the whole world at once, so its quests reach things it has
// not met or found yet.
export function nextWant(s, actor, api, previous = null) {
  const roll = hash(`${actor}:${s.turn}`);
  let pool =
    api.player?.(actor) && roll % 2
      ? wantCandidates(s, actor, api, previous, true)
      : [];
  if (!pool.length) pool = wantCandidates(s, actor, api, previous);
  if (!pool.length) {
    const a = s.actors[actor];
    a.visited = [a.place];
    a.talked = [];
    pool = wantCandidates(s, actor, api, previous);
  }
  if (!pool.length) pool = wantCandidates(s, actor, api, previous, true);
  // At last even the want just met, and out of range (rules 100).
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
// Whether holding this item now meets an item quest in the actor's stack,
// as settleWants would judge it: a gift answers a want only if it meets one.
export const meetsItemWant = (s, actor, item, action = null) =>
  questsOf(s, actor).some(
    (w) =>
      w.kind === "item" &&
      w.target === item &&
      questMet(s, actor, w, null, action),
  );
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

// Record what each participant saw and said, then commit met wants. The next
// want is drawn where one is met; only a level quest ends with the way back
// to a sanctuary, where a long rest raises the level.
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
    // Any quest in the stack can be met, each once per play. A level
    // quest's next step, or a fresh draw, takes the met one's place.
    for (let i = 0; i < questsOf(s, id).length; ) {
      if (!questMet(s, id, questsOf(s, id)[i], talk, action)) {
        i++;
        continue;
      }
      const held = questsOf(s, id).length;
      commitMet(s, id, api, met, i);
      if (questsOf(s, id).length >= held) i++;
    }
    if (a.xp > before) milestones(s, id, api, before);
  }
  return met;
}
function commitMet(s, id, api, met, index = 0) {
  const a = s.actors[id],
    list = questsOf(s, id),
    want = list[index],
    quest = want.quest && { ...want.quest, left: want.quest.left - 1 };
  a.level ??= levelFor(a.xp);
  const xp = quest?.left === 0 ? levelTier(quest.level).rank + 1 : 1;
  a.xp += xp;
  a.metTurn = s.turn;
  met.push({ actorId: id, want });
  api.log(id, want, xp);
  if (quest?.left > 1) list[index] = questStep(s, id, api, quest, want);
  else if (quest?.left === 1) list[index] = restStep(s, id, api, quest);
  else {
    if (quest) {
      a.level = quest.level;
      delete a.glimpse;
    } else if (!api.player(id)) a.level = Math.max(a.level, levelFor(a.xp));
    list.splice(index, 1);
  }
  setQuests(a, list);
  // An ordinary want met with nothing beneath is enough for now. A finished
  // level quest still draws the next at once.
  if (!a.want && !quest) a.content = true;
  else if (!a.want) setQuests(a, [nextWant(s, id, api, want)].filter(Boolean));
  return met;
}

// A refusal of the actor's own want counts; enough of them set it aside.
export function refuseWant(s, actor, item, api) {
  const want = wantOf(s, actor);
  // A player's quest is never set aside by refusals, so refused Trades or
  // Asks cannot redraw a level quest's step for free; Drop has its cost.
  if (want?.kind !== "item" || want.target !== item || api.player(actor))
    return;
  // A resident that keeps to its scene only tries while someone is there, so
  // its stall clock starts at the first real attempt, not when it was given.
  if (want.refusals === 0 && !travels(actor, s)) want.since = s.turn;
  want.refusals += 1;
  if (want.refusals >= REFUSAL_LIMIT) giveUp(s, actor, api);
}
// A set-aside want stays out of mind for a while. It moves to the bottom of
// the stack, fresh, and the quest beneath comes to the top; a lone quest
// gets a newly drawn one above it. Nothing set aside is lost.
function giveUp(s, actor, api) {
  const a = s.actors[actor],
    want = a.want;
  a.gaveUp = { target: want.target, turn: s.turn };
  // A level quest with no way forward becomes another of the same level;
  // its rest still waits at the sanctuary.
  // A glimpsed first step keeps its aspect: the quest may wait.
  if (want.step?.verb === "rest")
    setQuests(
      a,
      mergeSanctuaryQuests([
        restStep(s, actor, api, want.quest),
        ...questsOf(s, actor).slice(1),
      ]),
    );
  else if (want.quest)
    a.want =
      (want.quest.left === questSteps(want.quest.level) + 1 &&
        glimpseStep(s, actor, api, want.quest)) ||
      questStep(s, actor, api, want.quest, want);
  else {
    const aside = { ...want, since: s.turn, refusals: 0 },
      rest = questsOf(s, actor).slice(1);
    const next = rest.length ? null : nextWant(s, actor, api, want);
    setQuests(a, [...rest, ...(next ? [next] : []), aside]);
  }
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
export function reviseStalledWants(s, actors, api) {
  for (const id of actors) {
    const want = wantOf(s, id);
    if (
      want &&
      (travels(id, s) || api.wanders?.(id) || want.refusals > 0) &&
      s.turn - want.since >= STALL_TURNS
    )
      giveUp(s, id, api);
  }
}
// A want left empty by an older rule set or a pack mounted later, on a
// player or an unseen resident too, is drawn after a short rest.
// A player holds no quest until the world's data says quests begin, such as
// first arriving at a place; that first quest comes at once.
export function awaitsFirstQuest(s, id, api) {
  const begin = api.questsBeginAt,
    a = s.actors[id];
  if (!begin || !api.player(id) || a.metTurn !== undefined) return null;
  return begin.kind === "arrived" && !a.visited.includes(begin.place)
    ? "waiting"
    : "ready";
}
export function fillWants(s, api, now = false) {
  for (const [id, a] of Object.entries(s.actors)) {
    if (a.want) delete a.content;
    const first = awaitsFirstQuest(s, id, api);
    if (first === "waiting") {
      // An authored starter waits; a level or story quest stays.
      const kept = questsOf(s, id).filter((w) => w.quest || w.story);
      if (!a.xp && kept.length < questsOf(s, id).length) setQuests(a, kept);
      continue;
    }
    // A content player waits for its Sleep; a resident, which never sleeps,
    // rests a day.
    if (
      !a.want &&
      entityActive(s, id) &&
      !(a.content && api.player(id)) &&
      (now || first === "ready" || s.turn - (a.metTurn ?? 0) >= CONTENT_TURNS)
    )
      setQuests(a, [nextWant(s, id, api)].filter(Boolean));
  }
}
// Waking from any Sleep ends contentment: the next want is drawn as ever.
export function renewWant(s, id, api) {
  const a = s.actors[id];
  if (!a?.content) return;
  delete a.content;
  if (!a.want) setQuests(a, [nextWant(s, id, api)].filter(Boolean));
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
  const quests = questsOf(s, id);
  // Experience an avatar brought from its last world (#1846) raises the cap.
  const most = startXp(id) + (a.carried ?? 0) + s.turn * 8;
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
    !a.talked.includes(id) &&
    Array.isArray(a.visited) &&
    (a.want === null || validQuest(s, id, a.want)) &&
    (a.under === undefined ||
      (Array.isArray(a.under) &&
        a.want !== null &&
        a.under.length >= 1 &&
        a.under.length < QUEST_LIMIT &&
        a.under.every((w) => validQuest(s, id, w)))) &&
    quests.filter((w) => w.quest).length <= 1 &&
    new Set(quests.filter((w) => !w.quest).map((w) => `${w.kind}:${w.target}`))
      .size === quests.filter((w) => !w.quest).length
  );
}
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
          (w.story === undefined ? 0 : 1) &&
      (w.step === undefined || validStep(s, w, id)) &&
      (w.lit === undefined ||
        (w.kind === "item" && typeof w.lit === "boolean")) &&
      (w.story === undefined || (w.story === true && !w.quest)) &&
      (w.quest === undefined ||
        (Object.keys(w.quest).length === 2 &&
          Number.isSafeInteger(w.quest.level) &&
          w.quest.level >= 2 &&
          Number.isSafeInteger(w.quest.left) &&
          w.quest.left >= 1 &&
          w.quest.left <= questSteps(w.quest.level) + 1)) &&
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
