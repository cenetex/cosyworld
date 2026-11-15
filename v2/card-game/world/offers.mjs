//
//   box       a shut box lying here
//   resident  someone here who told you their want, and
//             offers it this visit (offer-chance.mjs)
//   home      your own home's door, shut
//
import { entityActive } from "../pack-registry.mjs";
import { controlledByHuman, currentActor, humanAvatar } from "../human-cast.mjs";
import {
  MAX_HELD,
  closedAny,
  closedBy,
  heldOf,
  lostOf,
  newWant,
  sameQuest,
  DREAM_FROM,
  questTerms,
} from "../want.mjs";
import { askerOf, questFor, talkQuestFrom, toldWant } from "../talk-quest.mjs";
import { dealtCard, levelAccepted, recordOf } from "./arcana.mjs";
import { homeOf } from "./home.mjs";
import { revealed } from "../want-talk.mjs";
import { offerUnlocked } from "../offer-chance.mjs";
import { boxWant, shutBoxesAt } from "./boxes.mjs";
import { nameOf, people } from "./catalog.mjs";
import { travelerOf } from "./company.mjs";

export const OFFER_KINDS = ["box", "resident", "home"];
export const offerId = (kind, source) =>
  `quest:${kind === "resident" ? "from" : kind}:${source}`;
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
  if (!a || !isPlayer(s, actor)) return [];
  const here = a.place,
    out = [];
  const add = (kind, source, want) => {
    const id = offerId(kind, source);
    if (
      !want ||
      lostOf(s, want) ||
      closedBy(a, id, want) ||
      closedAny(a, want) ||
      heldOf(a).some((held) => sameQuest(held, want)) ||
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
  return out;
}

const identity = (w) => JSON.stringify([w.from ?? null, w.since, w.refusals, questTerms(w)]);
export function questCandidates(s, actor = currentActor(s)) {
  const a = s.actors[actor];
  if (!a || !isPlayer(s, actor)) return [];
  const pending = [...(a.pendingQuests || []), ...(a.residentWant ? [a.residentWant] : [])];
  const held = heldOf(a), out = [];
  const add = (kind, source, want, id) => {
    if (want && held.some((w) => sameQuest(w, want))) return;
    const saved = want && pending.find((w) => sameQuest(w, want) && (w.from ?? null) === (want.from ?? null));
    want = saved || want;
    const reason = want && lostOf(s, want) ? "This goal is no longer possible."
      : want && talkQuestFrom(want) && !askerOf(s, want) ? "This person no longer asks for this."
        : want && withAnother(s, actor, "resident", askerOf(s, want), want) ? "This person is with another traveler."
          : kind !== "level" && held.length >= MAX_HELD ? "Finish or discard a quest first." : null;
    out.push({ id: `${id}:${want ? identity(want) : recordOf(s, actor).dealt}`, source, kind, quest: want, reason });
  };
  for (const offered of questOffers(s, actor))
    add(offered.kind, offered.source, { ...offered.want, from: offered.id }, offered.id);
  for (const want of pending) add("pending", actor, want, "quest:pending");
  const record = recordOf(s, actor);
  if (dealtCard(s, actor) && !levelAccepted(s, actor)) add("level", actor, null, "quest:level");
  if (record.dealt && record.proved.length > (a.arcana.dreamed ?? 0) &&
      ![...pending, ...held].some((w) => w.from === DREAM_FROM))
    add("sleep", actor, { ...newWant("place", homeOf(actor), s.turn),
      step: { verb: "rest" }, from: DREAM_FROM }, `quest:dream:${record.proved.length}`);
  return out;
}
