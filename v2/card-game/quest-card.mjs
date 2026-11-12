// The player's one quest, drawn as a quest card in the hand: its target's
// art with the rules' own words for the want as the caption. Nothing here is
// authored or decides anything; the rules own the want (want.mjs).
import { CONNECT_TARGET, questsOf, wantKey } from "./want.mjs";
import { conditionsMet, consumable } from "./pack-registry.mjs";
import { wantWords } from "./world/want-words.mjs";
import { cardLevel, levelTier, romanLevel } from "./rarity.mjs";
import {
  currentActor,
  exits,
  itemPlace,
  nameOf,
  places,
  rootHolder,
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

const questShape = (world, actor, want, key, index) => ({
  key,
  index,
  actor,
  kind: want.kind,
  target: want.target === CONNECT_TARGET ? null : want.target,
  xp: world.actors[actor].xp,
  // A level quest: the level it leads to and the steps still to go.
  level: want.quest?.level ?? null,
  left: want.quest?.left ?? 0,
  step: want.step ?? null,
  ...(want.lit === undefined ? {} : { lit: want.lit }),
  // A home quest (want.mjs) says "home"; no other bring does.
  ...(want.story ? { story: true } : {}),
  ...burial(world, want),
});
export const questCards = (world, actor = currentActor(world)) =>
  questsOf(world, actor).map((want, index) =>
    questShape(world, actor, want, wantKey(actor, want), index),
  );
// The held quest, the one the folded card shows, or null.
export const questCard = (world, actor = currentActor(world)) =>
  questCards(world, actor)[0] ?? null;

// A quest in words: the one wording of a want (world/want-words.mjs), with
// the first letter raised. A card the traveler has not discovered is worded
// as unknown; `covered` marks the target as one even when `known` is not given.
// The burial rite words what is still to lay in the Hollow.
export function questCaption(
  quest,
  covered = false,
  verb = null,
  known = () => true,
) {
  const shown = (id) => !(covered && id === quest.target) && known(id);
  const want = quest.riteVerb
    ? {
        kind: "place",
        target: quest.target,
        ...(quest.remaining?.length
          ? { step: { verb: "lay", items: quest.remaining } }
          : {}),
      }
    : {
        kind: quest.kind,
        target: quest.target,
        ...(quest.step ? { step: quest.step } : {}),
        ...(quest.lit === undefined ? {} : { lit: quest.lit }),
        ...(quest.story ? { story: true } : {}),
      };
  const words = wantWords(want, shown, {
    // The accessible goal names the same verb as the place card, including
    // places whose name is known but which this avatar has not visited yet.
    approach:
      verb === "Discover" ? "discover" : verb === "Go to" ? "go to" : null,
  });
  const caption = words[0].toUpperCase() + words.slice(1);
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

// The hand id of the quest card: there is only ever the one.
export const questId = () => `${QUEST_CARD}:0`;
export const isQuestId = (id) => id === questId();

// The hand with the quest card after the player's avatar and what it
// carries (a quest card never lies ahead of a carried thing, #2295).
export function handWithQuest(cards, world, ids = []) {
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
