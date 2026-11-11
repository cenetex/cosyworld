// Moods: when an avatar's face is happy or sad.
//
// A mood is a fact about the world, shown on the face. Code reads it from
// saved state; no model picks it, no viewer sees a different one, and nothing
// stores it. The plain face is the usual one. A mood is brief, like weather,
// and it passes when the fact that caused it does.
//
//   Happy is being met. Sad is absence or breach. Winning and losing are not
//   moods: a pressured hand-over never makes anyone happy.
//
// WHAT TO EDIT. `MOODS` below is the whole rulebook, in the order it is
// weighed. Each rule is one plain sentence and one test of saved state. The
// first rule that holds names the mood, so sad rules come before happy ones
// (a grievance in the room outweighs a met want). Windows reuse the timers
// the facts already have: CONTENT_TURNS, the grievance window, STALL_TURNS and
// the three-turn peace after a fight. This file adds no timer and no field.
//
// ORDER OF OVERRIDES (moodOf returns null for the first two):
//   in a standoff (the fight poses apply)  >  asleep  >  sad  >  happy  >  plain
//
// NOT YET READABLE from saved state (see the Moods section of the card guide):
//   happy: a thing returned to its home, or a trusted person arriving there;
//   happy: waking at home after a level-up;
//   sad:   being sent home after a third defeat.
import { humanAvatarIds } from "./human-cast.mjs";
import { entityActive } from "./pack-registry.mjs";
import { standoffFor } from "./world.mjs";
import { CONTENT_TURNS, STALL_TURNS, contentOf, wantOf } from "./want.mjs";
import { grievanceActive } from "./knowledge.mjs";
import { owner } from "./motives.mjs";

const player = (world, id) =>
  humanAvatarIds.includes(id) || Boolean(world.controlledActors?.includes(id));
const here = (world, id, other) =>
  Boolean(world.actors[other]) &&
  other !== id &&
  entityActive(world, other) &&
  world.actors[other].place === world.actors[id].place;

// A hand-over made under threat is not a gift: the one who got the wanted
// thing that way is not met by it.
const pressured = (world, id, turn) =>
  (world.log || []).some(
    (e) => e.handover && e.targetId === id && e.turn === turn,
  );

export const MOODS = [
  {
    id: "wronged",
    mood: "sad",
    says: "Someone who wronged me is here (while the grievance is active).",
    holds: (world, id) =>
      (world.motives?.grievances?.[id] || []).some(
        (g) => here(world, id, g.other) && grievanceActive(world, g),
      ),
  },
  {
    id: "gave-up",
    mood: "sad",
    says: "I gave up on what I wanted, and nothing has been met since.",
    holds: (world, id) => {
      const gave = world.actors[id].gaveUp,
        met = world.actors[id].metTurn;
      // A player's Drop is a choice with a cost, not a refusal.
      return (
        Boolean(gave) &&
        !player(world, id) &&
        world.turn - gave.turn < CONTENT_TURNS &&
        !(met > gave.turn)
      );
    },
  },
  {
    id: "refused",
    mood: "sad",
    says: "Someone here holds the thing I want, and I was refused it.",
    holds: (world, id) => {
      const want = wantOf(world, id);
      if (want?.kind !== "item" || !want.refusals) return false;
      if (world.turn - want.since >= STALL_TURNS) return false;
      const holder = world.items[want.target] && owner(world, want.target);
      return holder !== id && here(world, id, holder);
    },
  },
  {
    id: "beaten",
    mood: "sad",
    says: "I was just beaten in a fight (the three quiet turns after it).",
    holds: (world, id) =>
      (world.defeats?.[id] || 0) > 0 && world.peaceUntil?.[id] > world.turn,
  },
  {
    id: "met",
    mood: "happy",
    says: "I got what I wanted (the content day after a want is met).",
    holds: (world, id) => {
      const met = world.actors[id].metTurn;
      return (
        contentOf(world, id) &&
        met !== undefined &&
        world.turn - met < CONTENT_TURNS &&
        !pressured(world, id, met)
      );
    },
  },
];

export function moodOf(world, id) {
  const a = world?.actors?.[id];
  if (!a || a.sleeping || !entityActive(world, id)) return null;
  if (standoffFor(world, id)) return null;
  return MOODS.find((rule) => rule.holds(world, id))?.mood ?? null;
}

// The one first-person fact the character's own context carries.
export const moodFact = (world, id) => {
  const mood = moodOf(world, id);
  return mood ? `I feel ${mood}.` : null;
};
