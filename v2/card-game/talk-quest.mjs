// Talk tells a quest (#2196, rules 99; #2605). The quest that meets a want is
// read from its shape (`questFor`):
//   their item X   -> give(X, them):     the item, step give to them;
//   their place P  -> bring(them, P):    the person, step bring at P;
//   their person Q -> introduce(them, Q): the person, step bring to Q.
// A tap offered after a Talk lasts only while the quest fact told is still
// their want.
import { heldOf, releaseQuest } from "./want.mjs";
import { revealed } from "./want-talk.mjs";
import { askOffer, pruneOffers } from "./offer-chance.mjs";
import { staysByRole } from "./resident-guard.mjs";
import { learnTold } from "./quest-learn.mjs";
import { knowsFact, questFactId } from "./knowledge.mjs";

// A resident who cannot leave its place (the Oak, Badger, a guard at his
// post) is never asked to be escorted: its quest is to bring the other
// person to it (sticky companions, rules 133).
const fixedResident = (s, id) => staysByRole(s, id);

// The avatar a quest serves, when Talk gave it: null for any other quest.
export function talkQuestFrom(w) {
  if (!w?.step || w.quest || w.story) return null;
  if (w.kind === "item" && w.step.verb === "give") return w.step.to;
  if (w.kind === "person" && w.step.verb === "bring") return w.target;
  return null;
}
// The want of theirs a Talk quest serves.
function served(w) {
  if (w.kind === "item") return { kind: "item", target: w.target };
  return w.step.at
    ? { kind: "place", target: w.step.at }
    : { kind: "person", target: w.step.to };
}
// The quest that meets this want of theirs, or null for a want Talk gives
// no quest for.
export function questFor(s, them, want) {
  const base = { since: s.turn, refusals: 0 };
  // Their wish to eat or drink something somewhere is the player's to meet
  // there too (rules 102): "eat the Travel Provisions at Piraeus Quays".
  // A wish to eat with no place asks for the thing, as any item want.
  if (want.kind === "item" && want.step?.verb === "eat" && want.step.at)
    return {
      kind: "item",
      target: want.target,
      ...base,
      step: { verb: "eat", at: want.step.at },
    };
  if (want.kind === "item")
    return {
      kind: "item",
      target: want.target,
      ...base,
      step: { verb: "give", to: them },
    };
  if (want.step?.verb === "lay")
    return { ...base, kind: "place", target: want.target, step: want.step };
  // One who cannot travel is not escorted: a place it wants is no quest, and
  // the person it wants is brought to it ("bring Pip to the Oak").
  const fixed = fixedResident(s, them);
  if (want.kind === "place")
    return fixed
      ? null
      : {
          kind: "person",
          target: them,
          ...base,
          step: { verb: "bring", at: want.target },
        };
  if (want.kind === "person")
    return fixed
      ? {
          kind: "person",
          target: want.target,
          ...base,
          step: { verb: "bring", to: them },
        }
      : {
          kind: "person",
          target: them,
          ...base,
          step: { verb: "bring", to: want.target },
        };
  return null;
}

// The avatar whose want a held Talk quest serves, or null: the escort or
// meeting a traveler took on from them. A quest reads two ways round: "bring
// them to Q" (they want Q) or, for one who cannot travel, "bring Q to them".
export function askerOf(s, w) {
  if (!w?.step || w.quest || w.story) return null;
  const them = talkQuestFrom(w);
  if (them && s.actors[them] && askerWants(s.actors[them].want, served(w)))
    return them;
  if (w.kind === "person" && w.step.verb === "bring" && w.step.to) {
    const asker = s.actors[w.step.to];
    if (asker && askerWants(asker.want, { kind: "person", target: w.target }))
      return w.step.to;
  }
  return null;
}
const askerWants = (want, wanted) =>
  want?.kind === wanted.kind && want.target === wanted.target;
// A companion stays while the traveler knows its card asks to be brought
// somewhere: an escort or meeting, never an errand for an item.
export function pinnedCompanion(s, traveler, id) {
  const card = toldWant(s, traveler, id) && questFor(s, id, s.actors[id].want);
  return card?.kind === "person" && card.step?.verb === "bring" && card.target === id;
}

// A player's Talk with `them`: the want of theirs that Talk reveals is
// learned as their quest fact. The quest it would be is `questFor`.
export function talkQuest(s, actor, them, api) {
  const want = s.actors[them]?.want;
  if (!api.player(actor) || them === actor || !want) return null;
  const quest = revealed(s, them, want, actor) && questFor(s, them, want);
  if (!quest) return null;
  learnTold(s, them, actor);
  askOffer(s, actor, them);
  return quest;
}
// Whether the player knows this avatar's quest, from them or second-hand.
export function toldWant(s, actor, them) {
  const want = s.actors[them]?.want;
  return Boolean(want && knowsFact(s, actor, questFactId(them, want)));
}

// A Talk quest whose want they no longer hold, met by someone else or set
// aside, leaves the player. Nothing is refused and nothing is drawn.
export function pruneTalkQuests(s, api) {
  pruneOffers(s);
  for (const id of Object.keys(s.actors)) {
    if (!api.player(id)) continue;
    for (const w of heldOf(s.actors[id])) {
      if (!talkQuestFrom(w) && !(w.step && !w.quest && !w.story && w.kind === "person" && w.step.to))
        continue;
      if (!askerOf(s, w)) releaseQuest(s.actors[id], w);
    }
  }
}
