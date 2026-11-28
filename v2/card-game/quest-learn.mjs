import { authoredQuestStages, KNOWLEDGE_FACT_LIMIT, learnQuest, legacyQuestFactId, questFactId } from "./knowledge.mjs";
import { consumable } from "./pack-registry.mjs";
import { nameOf, people, places, theName, things } from "./world/catalog.mjs";
import { stepGoal } from "./world/lock-goals.mjs";
import { wantWords } from "./world/want-words.mjs";

export function questText(s, owner, want) {
  const who = nameOf(owner);
  const said = stepGoal(s, want, owner);
  const step = said.step;
  const what = theName(said.target);
  if (step?.verb === "call") return `${who} wants you to ${wantWords(said)}.`;
  if (step?.verb === "lay")
    return `${who} wants ${step.items.map(nameOf).join(", ")} ${said.target === owner ? "back" : `laid in ${nameOf(said.target)}`}.`;
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

export function learnTold(s, owner, learner, want = s.actors[owner].want) {
  noteTold(s, learner, [owner]);
  return learnQuest(
    s,
    owner,
    learner,
    { id: questFactId(owner, want), text: questText(s, owner, want) },
    { seq: s.eventSeq, turn: s.turn },
  );
}

export const questOwners = (s, who) => s.actors[who]?.told || [];
function noteTold(s, who, owners) {
  const told = [...new Set([...questOwners(s, who), ...owners])]
    .filter((o) => o !== who && Object.hasOwn(s.actors, o))
    .sort();
  if (told.length) s.actors[who].told = told;
  else delete s.actors[who].told;
}
const named = (id) =>
  [places, people, things].some((c) => Object.hasOwn(c, id));

function migrateStagedFacts(s) {
  const k = s.knowledge;
  if (!k?.facts || !k.known || !Array.isArray(k.pending)) return;
  for (const [id, fact] of Object.entries(k.facts)) {
    const source = fact?.source;
    if (source?.kind !== "quest" || !Array.isArray(source.witnesses)) continue;
    const owner = source.actorId, target = id.slice(`quest:${owner}:`.length);
    if (id !== legacyQuestFactId(owner, target)) continue;
    const matches = authoredQuestStages(owner, target)
      .filter(({ want }) => questText(s, owner, want) === fact.text);
    if (matches.length !== 1) continue;
    const next = questFactId(owner, matches[0].want);
    if (Object.hasOwn(k.facts, next)) continue;
    const readers = Object.keys(k.known).filter((actor) => k.known[actor]?.[id]);
    // Other direct Talks under the same key may have been about a later stage.
    const confirmed = new Set(readers.filter((actor) => {
      const memory = k.known[actor][id];
      return memory.eventSeq === source.eventSeq && memory.learnedTurn === source.turn &&
        (memory.teller === owner || memory.kind === "read");
    }));
    if (!confirmed.size) continue;
    if (confirmed.size === readers.length) delete k.facts[id];
    else if (Object.keys(k.facts).length >= KNOWLEDGE_FACT_LIMIT) continue;
    k.facts[next] = { ...fact, id: next,
      source: { ...source, witnesses: source.witnesses.filter((actor) => confirmed.has(actor)) } };
    for (const actor of confirmed) {
      k.known[actor][next] = k.known[actor][id];
      delete k.known[actor][id];
    }
    k.pending = k.pending.flatMap((p) => {
      if (p.factId !== id || !confirmed.has(p.speaker)) return [p];
      return confirmed.has(p.listener) ? [{ ...p, factId: next }] : [];
    });
  }
}

// Saves from before rules 195 count II from their heard map or quest facts.
export function installQuestFacts(s) {
  migrateStagedFacts(s);
  for (const [id, a] of Object.entries(s.actors))
    noteTold(s, id, [
      ...Object.keys(a.heard || {}),
      ...Object.entries(s.knowledge?.known?.[id] || {})
        .map(([fact, m]) => [s.knowledge.facts[fact]?.source, m.teller])
        .filter(([at, by]) => at?.kind === "quest" && by === at.actorId)
        .map(([at]) => at.actorId),
    ]);
  for (const [id, a] of Object.entries(s.actors)) {
    for (const [them, told] of Object.entries(a.heard || {})) {
      const live = s.actors[them]?.want;
      const [kind, target] = told.split(/:(.*)/su);
      if (authoredQuestStages(them, target).length) continue;
      if (live && told === `${live.kind}:${live.target}`)
        learnTold(s, them, id, live);
      else if (named(target)) learnTold(s, them, id, { kind, target });
    }
    delete a.heard;
  }
}
