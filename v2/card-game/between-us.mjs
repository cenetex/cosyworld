// "Between us" (#2078): what a speaker shares with each other voice in the
// scene, built only from committed facts. It decides nothing; the story
// service shows the entry for the person the speaker faces and uses it only
// to shape what is said (docs/design/talk-conversation.md).
import { knowledgeFacts } from "./knowledge.mjs";
import { lifeFacts, nameIn } from "./life.mjs";

// The latest incident between the pair that the speaker knows of: its own
// grievance first, then the other's against it.
function incident(world, id, other, nameOf) {
  const known = world.knowledge?.known?.[id] || {};
  const against = (holder, them) =>
    (world.motives?.grievances?.[holder] || [])
      .filter((g) => g.other === them && g.incident)
      .reverse();
  const g = [...against(id, other), ...against(other, id)].find(
    (g) => known[g.incident] && world.knowledge.facts[g.incident],
  );
  return g ? knowledgeFacts(world, id, nameOf, [g.incident])[0] : null;
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

export function betweenUs(world, id, speakers, nameOf) {
  if (!speakers.includes(id)) return [];
  return speakers
    .filter((other) => other !== id)
    .map((other) => ({
      with: other,
      facts: [incident(world, id, other, nameOf), keepsake(world, id, other)]
        .filter(Boolean)
        .map((text) => text.slice(0, 240)),
      said: [lastSaid(world, other, id), lastSaid(world, id, other)].filter(
        Boolean,
      ),
    }))
    .filter((entry) => entry.facts.length || entry.said.length);
}
