// The player's quest stack, drawn as quest cards in the hand: each its
// target's art with the rules' own words for the want as the caption.
// Nothing here is authored or decides anything; the rules own the stack
// (want.mjs).
import { CONNECT_TARGET, questsOf, wantKey } from "./want.mjs";
import { conditionsMet, consumable } from "./pack-registry.mjs";
import { cardLevel, levelTier, romanLevel } from "./rarity.mjs";
import {
  currentActor,
  exits,
  itemPlace,
  nameOf,
  places,
  rootHolder,
  wantText,
} from "./world.mjs";

export const QUEST_CARD = "quest";
const HOLLOW = "greek-polynices-hollow";
const stages = ["fallen", "anointed", "veiled", "grave"];
function burial(world, want) {
  if (want.target !== HOLLOW || want.step?.verb !== "lay") return {};
  const flags = world.packs["greek-drama"].flags;
  const stage = flags["greek-burial-performed"]
    ? 3
    : flags["greek-polynices-veiled"]
      ? 2
      : flags["greek-polynices-anointed"]
        ? 1
        : 0;
  return {
    art: `assets/greek-drama/polynices-${stages[stage]}.webp`,
    rite: [
      "Give Antigone the oil in Polynices’ Hollow",
      "Hand Antigone the cloth",
      "Hand Antigone the shovel",
      "Polynices is buried",
    ][stage],
    riteVerb: ["Anoint", "Veil", "Bury", "Buried"][stage],
    remaining: want.step.items.slice(stage),
  };
}

// The rite appears where the people and remaining supplies can perform it.
// Keep the saved quest and its index while its card waits off the table.
export function questVisible(world, quest) {
  if (!quest) return false;
  if (quest.target !== HOLLOW || quest.step?.verb !== "lay") return true;
  return world.actors[quest.actor]?.place === HOLLOW &&
    world.actors["greek-antigone"]?.place === HOLLOW &&
    conditionsMet(world, "greek-drama", burial(world, quest).remaining.map(
      (item) => ({ kind: "item_near", item, place: HOLLOW }),
    ), quest.actor);
}

// Each quest in the player's stack, top first. A card's key changes when its
// quest is met, set aside or moves on a step.
export const questCards = (world, actor = currentActor(world)) =>
  questsOf(world, actor).map((want, index) => ({
    key: wantKey(actor, want),
    index,
    actor,
    kind: want.kind,
    target: want.target === CONNECT_TARGET ? null : want.target,
    xp: world.actors[actor].xp,
    // A level quest: the level it leads to and the steps still to go.
    level: want.quest?.level ?? null,
    left: want.quest?.left ?? 0,
    step: want.step ?? null,
    ...burial(world, want),
  }));
// The top quest, the one the folded card shows, or null.
export const questCard = (world, actor = currentActor(world)) =>
  questCards(world, actor)[0] ?? null;

function hideQuestStep(quest, words, covered, known) {
  const { step } = quest;
  if (!step) return words;
  const hiddenPlace = step.at && !known(step.at);
  const hiddenRecipient = step.to && !known(step.to);
  if (step.verb === "bring" && quest.kind === "item" && hiddenPlace) {
    if (covered && (!step.to || hiddenRecipient))
      return "find something and bring it somewhere";
    words = step.to
      ? words.replace(` at ${nameOf(step.at)}`, "")
      : words.replace(` home to ${nameOf(step.at)}`, " somewhere");
  } else if (hiddenPlace) {
    words = step.verb === "bring"
      ? words.replace(` to ${nameOf(step.at)}`, " somewhere")
      : words.replace(` at ${nameOf(step.at)}`, " somewhere");
  }
  if (hiddenRecipient && !(step.verb === "bring" && quest.kind === "person" && step.at)) {
    words = words.replace(
      ` to ${nameOf(step.to)}`,
      places[step.to] ? " somewhere" : " to someone",
    );
  }
  if (step.with && !known(step.with))
    words = words.replace(` with ${nameOf(step.with)}`, " with someone");
  if (step.items?.some((id) => !known(id)))
    words = words.replace(
      step.items.map(nameOf).join(", "),
      [...new Set(step.items.map((id) => known(id) ? nameOf(id) : "something"))].join(", "),
    );
  return words;
}

// Each card in the rules' description gets its name when revealed.
export function questCaption(quest, covered = false, verb = null, known = () => true) {
  covered ||= Boolean(quest.target && !known(quest.target));
  if (quest.rite && quest.riteVerb !== "Lay") {
    if (covered || !known("greek-antigone") || (quest.remaining?.[0] && !known(quest.remaining[0])))
      return "Prepare the burial";
    return quest.rite;
  }
  const words = wantText({
    kind: quest.kind,
    target: quest.target,
    ...(quest.step ? { step: quest.step } : {}),
  });
  const unknown = {
    item: "something you have not found yet",
    person: "someone you have not met yet",
    place: "a place you have not found yet",
  };
  let shown =
    covered && quest.target
      ? quest.kind === "place" && !quest.step
        ? "go somewhere you have not found yet"
        : words.replace(nameOf(quest.target), unknown[quest.kind])
      : words;
  shown = hideQuestStep(quest, shown, covered, known);
  // The accessible goal names the same verb as the place card, including
  // places whose name is known but which this avatar has not visited yet.
  if (quest.kind === "place" && (verb === "Discover" || verb === "Go to")) {
    const target = covered
      ? "somewhere you have not found yet"
      : nameOf(quest.target);
    shown = `${verb === "Discover" ? "discover" : covered ? "go" : "go to"} ${target}`;
    if (quest.step?.verb === "rest") shown += " and rest there";
  }
  const caption = shown[0].toUpperCase() + shown.slice(1);
  return quest.level ? `Level ${romanLevel(quest.level)}: ${caption}` : caption;
}

// Places between here and there along the routes this avatar can use now.
export function questDistance(world, actor, to) {
  const from = world.actors[actor].place;
  const steps = new Map([[from, 0]]),
    came = new Map(),
    queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const here = queue[i];
    if (here === to) return steps.get(here);
    const projected = {
      ...world,
      actors: {
        ...world.actors,
        [actor]: { ...world.actors[actor], place: here },
      },
    };
    for (const next of exits(projected, here, actor, came.get(here) ?? null))
      if (!steps.has(next)) {
        steps.set(next, steps.get(here) + 1);
        came.set(next, here);
        queue.push(next);
      }
  }
  return null;
}

// The place a quest card's screen shows behind its figures, or null: a
// step's own place (`at`) once it is known, or else where the player stands
// when the target is there too. A step bound to a place the player has not
// found shows no place at all: never the one the player stands in, which
// would say the step happens here (questBox shows the carved box instead).
// A give step shows a place only when the want binds the gift to one; the
// rules draw none today, so a Give shows the player, the thing and the
// recipient on the card's dark ground.
export function questGround(world, quest, covered, known = () => true) {
  const { step, target } = quest;
  if (step?.at) return known(step.at) ? step.at : null;
  if (step?.verb === "give" || covered || !target) return null;
  const here = world.actors[quest.actor]?.place,
    at =
      quest.kind === "item"
        ? itemPlace(world, target)
        : world.actors[target]?.place;
  return at === here ? here : null;
}

// Whether the card shows the carved box for a step's place: one rule for
// every unknown part, as a Give shows it for an unknown recipient. A step
// bound to a place not yet found (Bring the board home to a pavilion not
// yet discovered) shows the box in the place's slot; a step with a
// recipient (`to`) shows that recipient there instead.
export const questBox = (quest, known = () => true) =>
  Boolean(quest.step?.at && !quest.step.to && !known(quest.step.at));

// Near is within two moves along the routes this avatar can use now. The
// card shows only near or far: never who holds the target or how many moves.
export const NEAR_MOVES = 2;
export function questNear(world, quest) {
  if (!quest.target) return false;
  const { actor, kind, target } = quest;
  const at =
    kind === "place"
      ? target
      : kind === "item"
        ? itemPlace(world, target)
        : world.actors[target]?.place;
  const moves = at ? questDistance(world, actor, at) : null;
  return moves !== null && moves <= NEAR_MOVES;
}

// The quest's one short verb, the step's own when it has one. A rest step
// shows the way there, and the rest once the player stands there (#2255); an
// unvisited or covered place is discovered.
const STEP_LABELS = {
  find: "Find",
  give: "Give",
  bring: "Bring",
  meet: "Meet",
  threaten: "Threaten",
  attack: "Strike",
};
export function questVerb(world, quest, covered = false) {
  if (quest.step?.verb === "lay") return quest.riteVerb ?? "Lay";
  if (quest.step?.verb === "eat")
    return consumable(quest.target) === "drink" ? "Drink" : "Eat";
  if (STEP_LABELS[quest.step?.verb]) return STEP_LABELS[quest.step.verb];
  if (quest.kind === "item") return "Hold";
  if (quest.kind === "person") return "Talk";
  if (quest.kind === "connect") return "Introduce";
  if (
    quest.step?.verb === "rest" &&
    world.actors[quest.actor]?.place === quest.target
  )
    return "Rest";
  const seen = world.actors[quest.actor]?.visited || [];
  return covered || !seen.includes(quest.target) ? "Discover" : "Go to";
}

// A quest's colour is the tier of the highest-level thing it names (its
// target, a step's recipient and place), as other cards take theirs, and a
// level quest's at least the level it leads to. What the player has not
// found (`known` is false) stays unknown. Presentation only, from levels in
// the world.
export function questTier(quest, world = null, known = () => true) {
  const named = [quest.target, quest.step?.to, quest.step?.at];
  const levels = world
    ? named.filter((id) => id && known(id)).map((id) => cardLevel(world, id))
    : [];
  return levelTier(Math.max(quest.level ?? 0, ...levels));
}

// The quests shown before that the rules have since met: each left the
// stack, or moved on a step, with a `want_met` event after `seq`.
export function metQuests(before, world, seq) {
  const live = new Set(questCards(world, before[0]?.actor).map((q) => q.key));
  const gone = before.filter((q) => !live.has(q.key));
  const met = [];
  for (const e of world.log)
    if (e.seq > seq && e.verb === "want_met") {
      const i = gone.findIndex(
        (q) =>
          (e.wantKey === undefined || q.key === e.wantKey) &&
          q.actor === e.actorId &&
          q.kind === e.wantMet?.kind &&
          (q.target ?? CONNECT_TARGET) === e.wantMet.target,
      );
      if (i >= 0) {
        const [quest] = gone.splice(i, 1);
        met.push({
          ...quest,
          ...burial(world, quest),
          earnedXp: e.questXp ?? 1,
        });
      }
    }
  return met;
}

// Hand ids for quest cards: met ones still sealed, then the stack top first.
export const questId = (index, met = false) =>
  `${QUEST_CARD}${met ? "-met" : ""}:${index}`;
export const isQuestId = (id) =>
  typeof id === "string" &&
  (id.startsWith(`${QUEST_CARD}:`) || id.startsWith(`${QUEST_CARD}-met:`));

// The hand with the quest cards after the player's avatar and what it
// carries.
export function questHand(cards, world, ids = []) {
  const hand = cards.filter((id) => !isQuestId(id));
  if (!ids.length) return hand;
  const actor = currentActor(world);
  let at = hand.indexOf(actor) + 1;
  while (
    at > 0 &&
    at < hand.length &&
    world.items[hand[at]] &&
    rootHolder(world, hand[at]) === actor
  )
    at++;
  hand.splice(at, 0, ...ids);
  return hand;
}

// Within the player's avatar's group the order is always the avatar, what
// it carries, then its quests: no quest card lies ahead of a carried thing,
// whichever is chosen (#2295).
export function avatarGroupOrdered(hand, world) {
  const actor = currentActor(world),
    first = hand.findIndex(isQuestId);
  if (first < 0) return true;
  if (hand.indexOf(actor) > first) return false;
  return !hand
    .slice(first)
    .some((id) => world.items[id] && rootHolder(world, id) === actor);
}
