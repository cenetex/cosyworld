// Quest cards and earned tarot rewards read their presentation from the rules.
import { CONNECT_TARGET, layMet, questsOf, wantedItems, wantKey } from "./want.mjs";
import { conditionsMet, consumable, entityActive, spentByChoice } from "./pack-registry.mjs";
import { questFor } from "./talk-quest.mjs";
import { revealed } from "./want-talk.mjs";
import { ownerWant } from "./quest-call.mjs";
import { UNKNOWN, conditionWords, kindOf, wantWords } from "./world/want-words.mjs";
import { inSentence, theName } from "./combat-beats.mjs";
import { arcanaLevel, arcanumTerms, isArcanum, spreadOf } from "./world/arcana.mjs";
import { firstFoolSlot } from "./world/arcana-record.mjs";
import { homeOf } from "./world/home.mjs";
import { stepGoal } from "./world/lock-goals.mjs";
import { arcanumArt } from "./glimpse-card.mjs";
import { TAROT_BACK, TAROT_LOCKED_BACK } from "./locked-box.mjs";
import { cardLevel, levelTier, romanLevel } from "./rarity.mjs";
import {
  boxOffer,
  currentActor,
  itemPlace,
  movesTo,
  nameOf,
  placeOffer,
  places,
  residentOffer,
  rootHolder,
} from "./world.mjs";
import { placeWant } from "./world/offers.mjs";
import { legacyQuestFactId, questFactId } from "./knowledge.mjs";

export const QUEST_CARD = "quest";
const HOLLOW = "greek-polynices-hollow";
const stages = ["fallen", "anointed", "veiled", "grave"];
function burial(world, want) {
  if (want.target !== HOLLOW || want.step?.verb !== "lay") return {};
  const remaining = layMet(world, want)
    ? []
    : want.step.items.filter((id) => !spentByChoice(world, id));
  return {
    art: `assets/greek-drama/polynices-${stages[want.step.items.length - remaining.length]}.webp`,
    remaining,
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
  level: want.quest?.level ?? null,
  left: want.quest?.left ?? 0,
  step: want.step ?? null,
  ...(want.lit === undefined ? {} : { lit: want.lit }),
  ...(want.from ? { from: want.from } : {}),
  // A home quest (want.mjs) says "home"; no other bring does.
  ...(want.story ? { story: true } : {}),
  ...burial(world, want),
  ...(stepGoal(world, want, actor) === want
    ? {}
    : { goal: stepGoal(world, want, actor) }),
});
export const questCards = (world, actor = currentActor(world)) =>
  questsOf(world, actor).map((want, index) =>
    questShape(world, actor, want, wantKey(actor, want), index),
  );
export function ownerCard(world, viewer, owner) {
  const place = places[owner] && placeWant(world, owner),
    want = place || ownerWant(world, owner),
    card = want && (place || revealed(world, owner, want, viewer)) && questFor(world, owner, want);
  const factId = !place && want ? questFactId(owner, want) : null;
  const staged = factId && factId !== legacyQuestFactId(owner, want.target);
  return card
    ? {
        ...questShape(world, viewer, card, `offer:${viewer}:${owner}:${card.kind}:${card.target}`, -1),
        offer: owner,
        ...(staged ? { factId } : {}),
        ...(!place && !world.actors[owner].want ? { completed: world.actors[owner].completedQuest } : {}),
        ...(place ? { lies: rootHolder(world, card.step.items[0]) } : {}),
      }
    : null;
}
export function offerCard(world, actor = currentActor(world), box = null, resident = null) {
  const place = Boolean(box) && box === world.actors[actor]?.place;
  const asked = place
    ? placeOffer(world, actor)
    : box
      ? boxOffer(world, box, actor)
      : residentOffer(world, actor, resident);
  if (!asked) return null;
  const mark = place ? "place" : box ? "box" : `${asked.want.kind}:${asked.want.target}`;
  return {
    ...questShape(world, actor, asked.want, `offer:${actor}:${asked.source}:${mark}`, -1),
    offer: asked.source,
    full: asked.full,
    ...(box ? { box: true } : {}),
    ...(place ? { place: true } : {}),
  };
}
const SPOKEN = {
  name: inSentence,
  kind: kindOf,
  drink: (id) => consumable(id) === "drink",
};
const lies = ({ lies, actor }, known) =>
  lies === actor
    ? "which you carry"
    : places[lies]
      ? `which lies ${known(lies) ? `at ${theName(lies)}` : UNKNOWN.place}`
      : `which ${known(lies) ? nameOf(lies) : "someone"} carries`;
export function offerWords(quest, known = () => true) {
  const who = nameOf(quest.offer),
    from = quest.readFrom ?? quest.heardFrom,
    source = from ? `${who} via ${nameOf(from)}` : who,
    said = quest.goal ?? quest;
  if (quest.completed) return `${nameOf(quest.completed.by)} called the ship for ${who}`;
  if (quest.lies) {
    const [item] = quest.step.items,
      place = theName(quest.offer);
    return `${place[0].toUpperCase()}${place.slice(1)} asks for ${known(item) ? theName(item) : UNKNOWN.item} back, ${lies(quest, known)}`;
  }
  if (
    said.kind === "item" &&
    said.step?.verb === "give" &&
    (said === quest || said.step.to === quest.offer)
  )
    return `${source} asks for ${known(said.target) ? theName(said.target) : UNKNOWN.item}`;
  return `${source}: ${questCaption(quest, false, null, known)}`;
}
export const isTarotKey = (id) => typeof id === "string" && id.startsWith("tarot:");
export const discardable = (quest) => quest?.kind === "arcanum" && ["up", "locked"].includes(quest.face);
export const tarotBack = (face) =>
  ["down", "locked", "offered"].includes(face) ? TAROT_LOCKED_BACK : TAROT_BACK;
export function levelCards(world, actor = currentActor(world)) {
  const first = firstFoolSlot(world, actor);
  return spreadOf(world, actor).map(({ index, card, face, bonus, turnable }, _, all) => ({
    key:
      face === "down"
        ? `tarot:${actor}:down:${all.slice(0, index).filter((slot) => slot.face === "down").length}`
        : `tarot:${actor}:${card}`,
    index,
    actor,
    kind: "arcanum",
    face,
    ...(first?.card === card ? { reading: true } : {}),
    ...(turnable ? { turnable: true } : {}),
    ...(bonus ? { bonus: true } : {}),
    target: face === "down" ? null : card,
    level: Math.min(21, arcanaLevel(world, actor) + 1),
    left: 1,
    step: null,
    art: ["up", "reward"].includes(face) ? arcanumArt(card) : tarotBack(face),
    conditions: face === "reward" ? [] : arcanumTerms(world, actor, index),
    home: homeOf(actor, world) ?? null,
  }));
}
export const tarotArtKey = (id) => `tarot-art:${id}`;
export const isTarotArtKey = (key) =>
  typeof key === "string" && key.startsWith("tarot-art:") && isArcanum(key.slice(10));
export function tarotArtSeen(world, key, seen) {
  const card = levelCards(world).find((quest) => quest.key === key);
  if (!card || !["up", "reward"].includes(card.face)) return null;
  return seen.has(tarotArtKey(card.target)) ||
    Boolean(world.actors[card.actor]?.upgrades?.includes(card.target));
}
export function spreadLocks(world, actor = currentActor(world)) {
  const reading = firstFoolSlot(world, actor)?.card;
  const ids = (down) =>
    spreadOf(world, actor)
      .filter(({ card, face }) => card !== reading && (!down || ["down", "locked"].includes(face)))
      .map(({ card }) => `tarot:${actor}:${card}`);
  return [ids(false), ids(true)];
}
export const questCard = (world, actor = currentActor(world)) =>
  questCards(world, actor)[0] ?? null;

// A quest in words: the one wording of a want (world/want-words.mjs), with
// the first letter raised. A card the traveler has not discovered is worded
// as unknown; `covered` marks the target as one even when `known` is not given.
export function questCaption(
  quest,
  covered = false,
  verb = null,
  known = () => true,
) {
  if (quest.face === "offered") return quest.caption;
  if (quest.turnable) return "The Listener dealt you a card";
  if (quest.face === "reward") return `Collect ${nameOf(quest.target)}`;
  const shown = (id) => !(covered && id === quest.target) && known(id);
  const want = quest.goal ??
    (quest.remaining && !quest.remaining.length
    ? { kind: "place", target: quest.target }
    : {
        kind: quest.kind,
        target: quest.target,
        ...(quest.step ? { step: quest.step } : {}),
        ...(quest.lit === undefined ? {} : { lit: quest.lit }),
        ...(quest.story ? { story: true } : {}),
      });
  const words =
    quest.kind === "arcanum"
      ? (conditionWords(quest.conditions, known, { home: quest.home, cards: SPOKEN }) ?? "…")
      : want.step?.verb === "call"
        ? `Hold ${shown("cloth") ? inSentence("cloth") : "something"} at ${shown(want.target) ? inSentence(want.target) : "an unknown place"}; keep ${shown("lamp") ? theName("lamp") : "a light"} burning on the ground`
        : wantWords(want, shown, {
          cards: SPOKEN,
          // The accessible goal names the same verb as the place card, including
          // places whose name is known but which this avatar has not visited yet.
          approach:
            verb === "Discover" ? "discover" : verb === "Go to" ? "go to" : null,
        });
  const caption = words[0].toUpperCase() + words.slice(1);
  return quest.level && !quest.bonus ? `Level ${romanLevel(quest.level)}: ${caption}` : caption;
}

export const questHeading = (quest) =>
  quest.face === "offered" ? quest.heading : quest.face === "reward" ? "Collect" : quest.bonus ? "Bonus quest" : quest.level ? "Level Up" : null;

export function questLabel(quest, near, caption, known = () => true) {
  if (quest.face === "offered") return quest.ready ? `${quest.heading} from the Listener` : "View the Listener's card offer";
  if (quest.turnable) return "Turn over the face-down card";
  if (quest.face === "down") return "A face-down card";
  if (quest.face === "reward") return questCaption(quest);
  if (quest.offer) return offerWords(quest, known);
  if (quest.bonus) return `Bonus quest: ${caption}`;
  const title = quest.level ? `Level Up ${romanLevel(quest.level)}: ${caption}` : caption;
  return `Quest: ${title}${near ? ", near" : ""}`;
}

// Places between here and there along the routes this avatar can use now.
export const questDistance = (world, actor, to) =>
  movesTo(world, actor, to);

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
  if (!quest.target || quest.kind === "arcanum") return false;
  const { actor, kind, target } = quest;
  const near = (at) => {
    const moves = at ? questDistance(world, actor, at) : null;
    return moves !== null && moves <= NEAR_MOVES;
  };
  if (kind === "item") return wantedItems(quest).some((id) =>
    (id === target || entityActive(world, id)) && near(itemPlace(world, id)),
  );
  return near(kind === "place" ? target : world.actors[target]?.place);
}

// The quest's one short verb, the step's own when it has one. A rest step
// shows the way there, and the rest once the player stands there (#2255); an
// unvisited or covered place is discovered.
const STEP_LABELS = {
  call: "Call ship",
  find: "Find",
  give: "Give",
  bring: "Bring",
  meet: "Meet",
  threaten: "Threaten",
  attack: "Strike",
};
export function questVerb(world, quest, covered = false) {
  if (quest.completed) return "Called";
  if (quest.step?.verb === "lay")
    return quest.goal ? questVerb(world, { ...quest.goal, actor: quest.actor }, covered) : "Lay";
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
  if (quest.kind === "arcanum") return levelTier(quest.level);
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
