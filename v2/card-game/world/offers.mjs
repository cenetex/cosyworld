// Quest offers (rules 133, #2605): the one list of quests a player may take by
// a tap. "When a location, item, or avatar offers a quest it shows a quest
// card that can be tapped" (owner, 2026-11-11): every offer is a card on the
// table with one id, and selecting it gives one button.
//
//   box       a shut box lying here
//   resident  someone here who told you their want, and
//             offers it this visit (offer-chance.mjs)
//   home      your own home's door, shut
//   level     your experience reached the next level
//
// Every offer's button reads "Accept quest" (owner, 2026-11-11); the bar's
// caption tells the quests apart.
// A player's quest is never drawn or pushed. While one is held every offer
// still stands, carrying `blocked`, the reason for the card's disabled button;
// the `take` play itself is offered only when it can succeed (world.mjs).
import { entityActive } from "../pack-registry.mjs";
import { controlledByHuman, currentActor, humanAvatar } from "../human-cast.mjs";
import { levelUpQuest, newWant, sameQuest, wantOf } from "../want.mjs";
import { questFor, toldWant } from "../talk-quest.mjs";
import { revealed } from "../want-talk.mjs";
import { offerUnlocked } from "../offer-chance.mjs";
import { boxWant, shutBoxesAt } from "./boxes.mjs";
import { people } from "./catalog.mjs";
import { homeOf } from "./home.mjs";

export const OFFER_KINDS = ["box", "resident", "home", "level"];
export const BLOCKED = "Finish or discard your quest first";
export const OFFER_LABELS = {
  box: "Accept quest",
  resident: "Accept quest",
  home: "Accept quest",
  level: "Accept quest",
};
export const offerId = (kind, source) =>
  kind === "level" ? "quest:level" : `quest:${kind === "resident" ? "from" : kind}:${source}`;
export const isOfferId = (id) => typeof id === "string" && id.startsWith("quest:");

// The quest a shut box gives: the thing to hold or bring, the place to reach
// or the person to see (the sealed card's own quest, or read from its lock).
const boxQuest = (s, { kind, target, step }) => ({
  kind,
  target,
  since: s.turn,
  refusals: 0,
  story: true,
  ...(step ? { step: { ...step } } : {}),
});

const isPlayer = (s, actor) =>
  actor === currentActor(s) || controlledByHuman(s, actor);

/**
 * The quest offers lying at the actor's place, as
 * `{ id, kind, source, want, label, blocked }`. `want` is the quest taking
 * the offer sets (valid as it stands); `blocked` is the reason it cannot be
 * taken now, or null.
 */
export function questOffers(s, actor = currentActor(s)) {
  const a = s.actors[actor];
  if (!a || !isPlayer(s, actor)) return [];
  const held = wantOf(s, actor),
    here = a.place,
    out = [];
  const add = (kind, source, want) => {
    if (!want || (held && !held.quest && !want.quest && sameQuest(held, want)))
      return;
    out.push({
      id: offerId(kind, source),
      kind,
      source,
      want,
      label: OFFER_LABELS[kind],
      blocked: held ? BLOCKED : null,
    });
  };
  const home = humanAvatar(actor)?.home;
  for (const box of shutBoxesAt(s, here, actor)) {
    const goal = boxWant(s, box, actor);
    // Your own home's door asks for your belonging brought inside.
    if (box.kind === "crossing" && actor !== "vale" && box.id === home?.id)
      add(
        "home",
        box.id,
        {
          ...newWant("item", humanAvatar(actor).item.id, s.turn),
          story: true,
          step: { verb: "bring", at: home.id },
        },
      );
    else if (goal) add("box", box.id, boxQuest(s, goal));
  }
  for (const them of Object.keys(people)) {
    if (them === actor || s.actors[them]?.place !== here || !entityActive(s, them))
      continue;
    const want = s.actors[them].want;
    if (
      !toldWant(s, actor, them) ||
      !offerUnlocked(s, actor, them) ||
      !revealed(s, them, want, actor)
    )
      continue;
    add("resident", them, questFor(s, them, want));
  }
  if (!held?.quest) {
    const level = levelUpQuest(s, actor, { home: homeOf });
    if (level) add("level", actor, level);
  }
  return out;
}
