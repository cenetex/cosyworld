import { learnQuest, questFactId } from "./knowledge.mjs";
import { consumable } from "./pack-registry.mjs";
import { nameOf, people, places, theName, things } from "./world/catalog.mjs";
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

export const learnTold = (s, owner, learner, want = s.actors[owner].want) =>
  learnQuest(
    s,
    owner,
    learner,
    { id: questFactId(owner, want), text: questText(s, owner, want) },
    { seq: s.eventSeq, turn: s.turn },
  );

export const questOwners = (s, who) => [
  ...new Set(
    Object.entries(s.knowledge?.known?.[who] || {})
      .map(([id, m]) => [s.knowledge.facts[id]?.source, m.teller])
      .filter(
        ([source, by]) => source?.kind === "quest" && by === source.actorId,
      )
      .map(([source]) => source.actorId),
  ),
];
const named = (id) =>
  [places, people, things].some((c) => Object.hasOwn(c, id));

// Saves from before rules 191 kept a `heard` map. Each entry becomes the
// teller's quest fact, live while it is still their want, so II keeps its count.
export function installQuestFacts(s) {
  for (const [id, a] of Object.entries(s.actors)) {
    if (!a.heard) continue;
    for (const [them, told] of Object.entries(a.heard)) {
      const live = s.actors[them]?.want;
      const [kind, target] = told.split(/:(.*)/su);
      if (live && told === `${live.kind}:${live.target}`)
        learnTold(s, them, id, live);
      else if (named(target)) learnTold(s, them, id, { kind, target });
    }
    const lost = Object.keys(a.heard).length - questOwners(s, id).length;
    for (const slot of a.arcana?.spread || [])
      if (lost > 0 && slot.base?.heard !== undefined)
        slot.base.heard = Math.max(0, slot.base.heard - lost);
    delete a.heard;
  }
}
