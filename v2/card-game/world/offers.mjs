// Quest offers (rules 133, #2605; held at once since rules 134): the one list
// of quests that stand for a player. "Quests should be accepted automatically"
// (owner, 2026-11-11): an offer that stands is held in the same committed
// play that made it stand (`settleQuests`, world.mjs), so no card or button
// takes it. The only quest play is Discard.
//
//   box       a shut box lying here
//   resident  someone here who told you their want, and
//             offers it this visit (offer-chance.mjs)
//   home      your own home's door, shut
//   level     your experience reached the next level
//
// An offer stands only while the player does not already hold it and has not
// closed it: a quest met or discarded is not offered again by its source until
// the source offers different terms (`closed`, want.mjs).
import { entityActive } from "../pack-registry.mjs";
import { controlledByHuman, currentActor, humanAvatar } from "../human-cast.mjs";
import {
  MAX_HELD,
  closedBy,
  heldOf,
  holdsLevelQuest,
  levelUpQuest,
  newWant,
  sameQuest,
} from "../want.mjs";
import { questFor, toldWant } from "../talk-quest.mjs";
import { revealed } from "../want-talk.mjs";
import { offerUnlocked } from "../offer-chance.mjs";
import { boxWant, shutBoxesAt } from "./boxes.mjs";
import { nameOf, people } from "./catalog.mjs";
import { travelerOf } from "./company.mjs";
import { homeOf } from "./home.mjs";

export const OFFER_KINDS = ["box", "resident", "home", "level"];
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

// An escort or meeting offered by a resident who is already another
// traveler's companion is not held: it stands again when they part.
function withAnother(s, actor, kind, source, want) {
  const traveler = travelerOf(s, source);
  return Boolean(
    kind === "resident" &&
      traveler &&
      traveler !== actor &&
      want.kind === "person" &&
      want.target === source,
  );
}

const isPlayer = (s, actor) =>
  actor === currentActor(s) || controlledByHuman(s, actor);

/**
 * The quest offers standing for the actor at its place, as
 * `{ id, kind, source, want }`, in the order they are held (the last is held
 * on top). `want` is the quest holding the offer sets (valid as it stands).
 * An offer already held, or closed at these terms, does not stand.
 */
export function questOffers(s, actor = currentActor(s)) {
  const a = s.actors[actor];
  if (!a || !isPlayer(s, actor) || heldOf(a).length >= MAX_HELD) return [];
  const here = a.place,
    out = [];
  const add = (kind, source, want) => {
    const id = offerId(kind, source);
    if (
      !want ||
      closedBy(a, id, want) ||
      (!want.quest && heldOf(a).some((held) => sameQuest(held, want))) ||
      withAnother(s, actor, kind, source, want)
    )
      return;
    out.push({ id, kind, source, want });
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
  if (!holdsLevelQuest(a)) {
    const level = levelUpQuest(s, actor, { home: homeOf });
    if (level) add("level", actor, level);
  }
  return out;
}
