// "Between us" (#2078): what a speaker shares with each other voice in the
// scene, built only from committed facts. It decides nothing; the story
// service shows the entry for the person the speaker faces and uses it only
// to shape what is said (docs/design/talk-conversation.md).
import { ageText } from "./knowledge.mjs";
import { lifeFacts, nameIn } from "./life.mjs";

const seqOf = (g) => Number(g.incident.slice("event:".length));

// The threats between the pair that the speaker knows of, newest first, in
// its own words: its grievances against the other, and the other's against
// it. Only threats: the other's taste or noise grievances would tell what
// it dislikes. A repaired one says who made it right when the speaker knows
// the repair, and is left out when it does not; a dormant one is told by
// its age.
function incidents(world, id, other, nameOf) {
  const known = world.knowledge?.known?.[id] || {};
  const facts = world.knowledge?.facts || {};
  const Other = nameOf(other);
  const against = (holder, them) =>
    (world.motives?.grievances?.[holder] || [])
      .filter(
        (g) =>
          g.other === them &&
          g.kind === "threat" &&
          g.incident &&
          known[g.incident] &&
          facts[g.incident],
      )
      .map((g) => ({ g, mine: holder === id }));
  return [...against(id, other), ...against(other, id)]
    .sort((a, b) => seqOf(b.g) - seqOf(a.g))
    .flatMap(({ g, mine }) => {
      const repair = Object.values(facts).find(
        (f) => f.source?.answers?.incident === g.incident && known[f.id],
      );
      if (g.repaired && !repair) return [];
      const when = facts[g.incident].source?.turn ?? g.turn;
      const age = ageText(world.turn - when);
      const item = g.item ? nameOf(g.item) : null;
      const line = mine
        ? item
          ? `${Other} threatened me over the ${item}, ${age}.`
          : `${Other} picked a fight with me, ${age}.`
        : item
          ? `I threatened ${Other} over the ${item}, ${age}.`
          : `I picked a fight with ${Other}, ${age}.`;
      const made = !g.repaired
        ? ""
        : mine
          ? ` ${Other} made it right.`
          : " I made it right.";
      const covers = repair ? [g.incident, repair.id] : [g.incident];
      return [{ text: line + made, covers }];
    })
    .slice(0, 2);
}

// A keepsake the other gave the speaker, in the speaker's own words.
const keepsake = (world, id, other) => {
  const from = `${nameIn(world, other)} gave me this `.toLowerCase();
  return lifeFacts(world, id).find((line) =>
    line.toLowerCase().startsWith(from),
  );
};

// The last line one said where the other heard it, before this turn.
const lastSaid = (world, from, to) =>
  world.log
    .filter(
      (e) =>
        e.generated &&
        e.kind === "dialogue" &&
        !e.silent &&
        e.actorId === from &&
        e.turn < world.turn &&
        e.text.length <= 400 &&
        [...(e.witnesses || []), ...(e.cast || [])].includes(to),
    )
    .map(({ actorId, text, turn }) => ({ actorId, text, turn }))
    .at(-1);

/**
 * One entry per other voice, and the ids of the knowledge facts its
 * incidents retell (the threat and its repair), which "What I know" then
 * leaves out.
 */
export function betweenUs(world, id, speakers, nameOf) {
  if (!speakers.includes(id)) return { entries: [], retold: [] };
  const covers = [];
  const entries = speakers
    .filter((other) => other !== id)
    .map((other) => {
      const told = incidents(world, id, other, nameOf);
      covers.push(...told.flatMap((t) => t.covers));
      return {
        with: other,
        facts: [...told.map((t) => t.text), keepsake(world, id, other)]
          .filter(Boolean)
          .map((text) => text.slice(0, 240)),
        said: [lastSaid(world, other, id), lastSaid(world, id, other)].filter(
          Boolean,
        ),
      };
    })
    .filter((entry) => entry.facts.length || entry.said.length);
  return { entries, retold: covers };
}
