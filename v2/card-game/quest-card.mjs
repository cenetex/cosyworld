// The player's quest stack, drawn as quest cards in the hand: each its
// target's art with the rules' own words for the want as the caption.
// Nothing here is authored or decides anything; the rules own the stack
// (want.mjs).
import { CONNECT_TARGET, questSteps, questsOf } from "./want.mjs";
import { romanLevel, stepTier } from "./rarity.mjs";
import {
  currentActor,
  exits,
  itemPlace,
  nameOf,
  rootHolder,
  wantText,
} from "./world.mjs";

export const QUEST_CARD = "quest";

// Each quest in the player's stack, top first. A card's key changes when its
// quest is met, set aside or moves on a step.
export const questCards = (world, actor = currentActor(world)) =>
  questsOf(world, actor).map((want, index) => ({
    key: `${actor}:${want.kind}:${want.target}:${want.since}:${want.quest?.left ?? ""}`,
    index,
    actor,
    kind: want.kind,
    target: want.target === CONNECT_TARGET ? null : want.target,
    xp: world.actors[actor].xp,
    // A level quest: the level it leads to and the steps still to go.
    level: want.quest?.level ?? null,
    left: want.quest?.left ?? 0,
    step: want.step ?? null,
  }));
// The top quest, the one the folded card shows, or null.
export const questCard = (world, actor = currentActor(world)) =>
  questCards(world, actor)[0] ?? null;

// The rules' words for the want; a target not yet uncovered is unnamed.
export function questCaption(quest, covered = false) {
  const words = wantText({
    kind: quest.kind,
    target: quest.target,
    ...(quest.step ? { step: quest.step } : {}),
  });
  const shown =
    covered && quest.target ? words.replace(nameOf(quest.target), "…") : words;
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

// The quest's one short verb. An unvisited or covered place is discovered.
export function questVerb(world, quest, covered = false) {
  if (quest.kind === "item") return "Hold";
  if (quest.kind === "person") return "Talk";
  if (quest.kind === "connect") return "Introduce";
  const seen = world.actors[quest.actor]?.visited || [];
  return covered || !seen.includes(quest.target) ? "Discover" : "Go to";
}

// A quest's colour follows its size: the F(n) steps of its level.
export const questTier = (quest) =>
  stepTier(quest.level ? questSteps(quest.level) : 1);

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
          q.actor === e.actorId &&
          q.kind === e.wantMet?.kind &&
          (q.target ?? CONNECT_TARGET) === e.wantMet.target,
      );
      if (i >= 0) met.push(gone.splice(i, 1)[0]);
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
