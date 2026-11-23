import { learnQuest, questFactId } from "./knowledge.mjs";
import { consumable } from "./pack-registry.mjs";
import { nameOf, theName } from "./world/catalog.mjs";
import { stepGoal } from "./world/lock-goals.mjs";

export function questText(s, owner, want) {
  const who = nameOf(owner);
  const said = stepGoal(s, want, owner);
  const step = said.step;
  const what = theName(said.target);
  if (step?.verb === "lay")
    return `${who} wants ${step.items.map(nameOf).join(", ")} laid in ${nameOf(said.target)}.`;
  if (said.kind === "place")
    return `${who} wants to be at ${nameOf(said.target)}.`;
  if (said.kind === "person")
    return `${who} wants to see ${nameOf(said.target)}.`;
  if (step?.verb === "eat")
    return `${who} wants to ${consumable(said.target) === "drink" ? "drink" : "eat"} ${what}${step.at ? ` at ${nameOf(step.at)}` : ""}.`;
  if (step?.verb === "bring" && step.at)
    return `${who} wants ${what} brought to ${nameOf(step.at)}.`;
  if (step?.verb === "give" && step.to !== owner)
    return `${who} wants ${what} given to ${nameOf(step.to)}.`;
  return `${who} wants ${what}.`;
}

export const learnTold = (s, owner, learner) =>
  learnQuest(
    s,
    owner,
    learner,
    {
      id: questFactId(owner, s.actors[owner].want),
      text: questText(s, owner, s.actors[owner].want),
    },
    { seq: s.eventSeq, turn: s.turn },
  );
