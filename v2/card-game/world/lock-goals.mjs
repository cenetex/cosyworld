// What a lock waits on, as want structures (rules 133). A lock is a want: no
// pack writes a sentence for it. This reads the conditions that keep a box
// shut and says each unmet one as a goal `{kind, target, step?, lit?}`, the
// shape every quest has (world/want-words.mjs words it). A condition on a
// story flag or choice is followed to the pack's own choice that sets it: the
// avatar it is made with, and the item given. A condition with no such trace
// yields no goal; the box then shows only that it is shut, and an avatar's
// talk, or an item's or place's description, says the rest.
import { conditionsMet, packDefinition } from "../pack-registry.mjs";
import { conditionMet } from "../pack-rules.mjs";

const DEPTH = 4;
// A lock shows at most this many wants; the rest appear as these are met.
export const MOST_GOALS = 3;

// The choices of a pack that make a flag or a choice true.
const settersIn = (choices, condition) =>
  (choices || []).filter((choice) =>
    (choice.effects || []).some((e) =>
      condition.kind === "choice"
        ? e.kind === "choose" &&
          e.key === condition.key &&
          e.value === condition.value
        : e.kind === "set_flag" &&
          e.key === condition.key &&
          e.value === condition.value,
    ),
  );

// The goal of the one play a choice is: give the item it needs to its
// subject, or meet its subject.
function playGoal(choice) {
  const item = (choice.requires || []).find(
    (r) => r.kind === "holding" && r.role === "actor",
  )?.item;
  if (choice.on === "give" && item)
    return {
      kind: "item",
      target: item,
      step: { verb: "give", to: choice.subject },
    };
  return choice.subject ? { kind: "person", target: choice.subject } : null;
}

/**
 * The goals still unmet in a list of conditions, in order, each once.
 * `world` says what is true: `met(condition)` and the pack's `choices`.
 * `seen` and the depth keep a trace of choices from circling.
 */
export function goalsFrom(world, conditions, depth = 0, seen = []) {
  const out = [];
  const push = (goal) => {
    if (goal && !out.some((g) => JSON.stringify(g) === JSON.stringify(goal)))
      out.push(goal);
  };
  for (const condition of conditions || []) {
    if (world.met(condition)) continue;
    switch (condition.kind) {
      case "any": {
        // The first alternative that can be said.
        for (const branch of condition.conditions) {
          const goals = goalsFrom(world, [branch], depth, seen);
          if (goals.length) {
            goals.forEach(push);
            break;
          }
        }
        break;
      }
      case "talked":
        push({ kind: "person", target: condition.person });
        break;
      case "holding":
        if (condition.actor)
          push({
            kind: "item",
            target: condition.item,
            step: { verb: "give", to: condition.actor },
          });
        else if (condition.role === "actor")
          push({ kind: "item", target: condition.item });
        break;
      case "item_near":
      case "item_at":
      case "item_present":
        push({
          kind: "item",
          target: condition.item,
          ...(condition.place
            ? { step: { verb: "bring", at: condition.place } }
            : {}),
        });
        break;
      case "light":
        push({ kind: "item", target: condition.item, lit: true });
        break;
      case "not":
        if (condition.condition.kind === "light")
          push({ kind: "item", target: condition.condition.item, lit: false });
        break;
      case "flag":
      case "choice": {
        if (depth >= DEPTH) break;
        // One goal for each unmet condition: the next play toward it. What
        // the play itself needs (a flag another choice sets) comes first; the
        // item it gives is part of the play.
        for (const choice of settersIn(world.choices, condition)) {
          if (seen.includes(choice.id)) continue;
          const play = playGoal(choice);
          // Earlier plays (flags and choices) come before the things to bring.
          const needs = (choice.requires || [])
            .filter(
              (r) =>
                !(
                  play?.step &&
                  r.kind === "holding" &&
                  r.role === "actor" &&
                  r.item === play.target
                ),
            )
            .sort(
              (a, b) =>
                Number(!["flag", "choice"].includes(a.kind)) -
                Number(!["flag", "choice"].includes(b.kind)),
            );
          const [first] = goalsFrom(world, needs, depth + 1, [
            ...seen,
            choice.id,
          ]);
          push(first ?? play);
          if (first || play) break;
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** The goals still unmet in a pack's (or the hub's) conditions, for an actor. */
export const goalsOf = (s, packId, conditions, actor) =>
  goalsFrom(
    {
      met: (condition) =>
        packId
          ? conditionsMet(s, packId, [condition], actor)
          : conditionMet(s, condition, null),
      choices: packId ? packDefinition(packId)?.choices : [],
    },
    conditions,
  );
