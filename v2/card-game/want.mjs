// A stack of quests per avatar: each an item, a place or a person. The world
// rules decide when one is met; meeting it is a recorded world fact worth one
// experience point. New quests go on top and nothing replaces one already
// held (#1831): `actor.want` is the top, the one pursued and shown, and
// `actor.under` the quests beneath it, next first. The next want is drawn
// from the world, deterministically, so a replayed journal makes the same
// choices.
import { BOARDY, connectedHumans } from "./boardyai.mjs";
import { humanAvatarIds, sharedEnabled } from "./human-cast.mjs";
import {
  entityActive,
  freed,
  isPackActor,
  packOf,
  packPeople,
} from "./pack-registry.mjs";
import { packDiscovered } from "./pack-rules.mjs";
import { authoredWant } from "./want-talk.mjs";

export const WANT_KINDS = ["item", "place", "person", "connect"];
// A level quest step may name a verb beyond the kind's own (hold, be at,
// talk). State verbs are met when their condition holds after any play; act
// verbs when that play by the avatar resolves (Give only when accepted). A
// step names its other cards: `to` a person, `at` a place. The last step,
// rest, is a long rest at the sanctuary the avatar last slept in.
export const STEP_VERBS = {
  item: ["find", "give", "bring"],
  person: ["meet", "threaten", "attack"],
  place: ["rest"],
};
const HOSTILE_LEVEL = 20; // Threaten and Attack join steps from Rare

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
// The quest for level n has F(n) steps: 1, 1, 2, 3, 5, 8 ... and then the
// rest that raises the level.
export const questSteps = (level) => {
  let [a, b] = [1, 1];
  for (let i = 1; i < level; i++) [a, b] = [b, a + b];
  return a;
};
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
function setQuests(a, list) {
  a.want = list[0] ?? null;
  if (list.length > 1) a.under = list.slice(1);
  else delete a.under;
}
const lastIndex = (list, test) => {
  for (let i = list.length - 1; i > 0; i--) if (test(list[i])) return i;
  return -1;
};
// A new quest goes on top. One the avatar already holds comes to the top
// instead of being held twice. Past the limit the oldest ordinary quest
// leaves; a level quest never does, and a story quest (`story`, set by pack
// content) only when everything beneath the top is a level or story quest.
export function pushQuest(s, actor, want) {
  const a = s.actors[actor];
  const same = (w) =>
    !w.quest && !want.quest && w.kind === want.kind && w.target === want.target;
  const held = questsOf(s, actor);
  const old = held.find(same);
  const top = old ? { ...old, ...(want.story ? { story: true } : {}) } : want;
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
        : ["", "find"]
      : kind === "person"
        ? [
            "",
            "meet",
            ...(level >= HOSTILE_LEVEL ? ["threaten", "attack"] : []),
          ]
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
  if (questsOf(s, actor).some((w) => w.quest) || levelFor(a.xp) <= a.level)
    return null;
  const level = a.level + 1;
  return pushQuest(
    s,
    actor,
    questStep(s, actor, api, { level, left: questSteps(level) + 1 }),
  );
}
// The way back to the sanctuary the avatar last slept in, or, for one that
// never reached a sanctuary, its home.
const restStep = (s, actor, api, quest) => ({
  ...newWant(
    "place",
    s.actors[actor].sanctuary ?? api.home(actor) ?? s.actors[actor].place,
    s.turn,
  ),
  quest,
  step: { verb: "rest" },
});
// Waking from a long rest completes a level quest's rest step there, or
// brings the level quest when experience is enough for the next level.
export function wake(s, actor, api) {
  const a = s.actors[actor];
  if (api.sanctuaries.includes(a.place)) a.sanctuary = a.place;
  const rest = questsOf(s, actor).findIndex(
    (w) => w.step?.verb === "rest" && w.target === a.place,
  );
  if (rest >= 0) return commitMet(s, actor, api, [], rest);
  return offerLevelQuest(s, actor, api);
}
// A player may drop any quest in its stack. Dropping a level quest costs
// half the avatar's experience and keeps its level; an ordinary quest costs
// nothing. Its target stays out of mind a while, and the quest beneath comes
// to the top; dropping the last one draws another at once.
export function dropQuest(s, actor, api, index = 0) {
  const a = s.actors[actor],
    list = questsOf(s, actor),
    want = list[index];
  if (!want) return;
  if (want.quest) a.xp = Math.floor(a.xp / 2);
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
export function wantCandidates(s, actor, api, previous = null, wide = false) {
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
  const reach = travels(actor, s) ? api.reachable(actor) : [];
  const near = new Set([a.place, ...reach]);
  const whole = wide && Boolean(api.player?.(actor));
  const within = (place) => wide || near.has(place);
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
  if (!pool.length) pool = wantCandidates(s, actor, api, null, true);
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
function stepMet(s, actor, want, action) {
  const { verb, to, at } = want.step,
    me = s.actors[actor],
    by = (kind) =>
      action?.kind === kind &&
      action.actor === actor &&
      (kind === "give"
        ? action.item === want.target && action.target === to && action.accepted
        : action.target === want.target);
  if (verb === "find") return placeOfItem(s, want.target) === me.place;
  if (verb === "give") return by("give");
  if (verb === "bring")
    return (
      rootOf(s, want.target) === actor &&
      me.place === at &&
      together(s, actor, to)
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
      const before = questsOf(s, id).length;
      commitMet(s, id, api, met, i);
      if (questsOf(s, id).length >= before) i++;
    }
  }
  return met;
}
function commitMet(s, id, api, met, index = 0) {
  const a = s.actors[id],
    list = questsOf(s, id),
    want = list[index],
    quest = want.quest && { ...want.quest, left: want.quest.left - 1 };
  a.level ??= levelFor(a.xp);
  a.xp += 1;
  a.metTurn = s.turn;
  met.push({ actorId: id, want });
  api.log(id, want);
  if (quest?.left > 1) list[index] = questStep(s, id, api, quest, want);
  else if (quest?.left === 1) list[index] = restStep(s, id, api, quest);
  else {
    if (quest) a.level = quest.level;
    else if (!api.player(id)) a.level = Math.max(a.level, levelFor(a.xp));
    list.splice(index, 1);
  }
  setQuests(a, list);
  // The next quest is drawn only when the stack is empty.
  if (!a.want) setQuests(a, [nextWant(s, id, api, want)].filter(Boolean));
  return met;
}

// A refusal of the actor's own want counts; enough of them set it aside.
export function refuseWant(s, actor, item, api) {
  const want = wantOf(s, actor);
  if (want?.kind !== "item" || want.target !== item) return;
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
  if (want.step?.verb === "rest") a.want = restStep(s, actor, api, want.quest);
  else if (want.quest) a.want = questStep(s, actor, api, want.quest, want);
  else {
    const aside = { ...want, since: s.turn, refusals: 0 },
      rest = questsOf(s, actor).slice(1);
    const next = rest.length ? null : nextWant(s, actor, api, want);
    setQuests(a, [...rest, ...(next ? [next] : []), aside]);
  }
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
      (travels(id, s) || want.refusals > 0) &&
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
    const first = awaitsFirstQuest(s, id, api);
    if (first === "waiting") {
      // An authored starter waits; a level or story quest stays.
      const kept = questsOf(s, id).filter((w) => w.quest || w.story);
      if (!a.xp && kept.length < questsOf(s, id).length) setQuests(a, kept);
      continue;
    }
    if (
      !a.want &&
      entityActive(s, id) &&
      (now || first === "ready" || s.turn - (a.metTurn ?? 0) >= CONTENT_TURNS)
    )
      a.want = nextWant(s, id, api);
  }
}

const STEP_CARDS = { give: ["to"], bring: ["to", "at"] };
function validStep(s, w) {
  const { verb, ...cards } = w.step;
  const named = STEP_CARDS[verb] || (verb === "meet" && cards.at ? ["at"] : []);
  return (
    Boolean(w.quest) &&
    (STEP_VERBS[w.kind] || []).includes(verb) &&
    Object.keys(cards).length === named.length &&
    named.every((key) => typeof cards[key] === "string") &&
    (!cards.to || (Object.hasOwn(s.actors, cards.to) && cards.to !== w.target))
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
    (a.gaveUp === undefined ||
      (a.gaveUp &&
        Object.keys(a.gaveUp).length === 2 &&
        typeof a.gaveUp.target === "string" &&
        whole(a.gaveUp.turn))) &&
    list(a.talked, s.actors) &&
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
      (w.step === undefined || validStep(s, w)) &&
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
