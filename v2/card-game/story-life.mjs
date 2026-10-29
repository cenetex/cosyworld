// Authored story endings reach the generated lives around them. A resolved
// story leaves a lasting experience with its participants and the people who
// saw it end, and it becomes news they can retell through Talk. An open story
// can also give a resident's next generated purpose a modest lean toward it.
// Every rule here reads saved state only, so replay gives the same result.
import { recordStoryLife, lifeOf } from "./life.mjs";
import { witnessStoryEnding } from "./knowledge.mjs";
import { STORY_COMPLETION_OUTCOMES } from "./quest-completions.mjs";
import { authoredStoryDefinitions } from "./pack-story-quests.mjs";
import { packDefinitions, packPeople } from "./pack-registry.mjs";

const inline = (name) => name.replace(/^The /u, "the ");
const lineOf = (title) =>
  (title || "")
    .trim()
    .replace(/[.!?。！？]+$/u, "")
    .replace(/["“”]/gu, "");
const endingText = {
  fulfilled: (who, where, line) =>
    line
      ? `At ${where}, ${who} saw "${line}" come true.`
      : `At ${where}, ${who} saw a story come true.`,
  declined: (who, where, line) =>
    line
      ? `At ${where}, ${who} turned down "${line}".`
      : `At ${where}, ${who} turned a story down.`,
  reported: (who, where, line) =>
    line
      ? `At ${where}, ${who} reported on "${line}".`
      : `At ${where}, ${who} reported how a story went.`,
  shared: (who, where, line) =>
    line
      ? `At ${where}, ${who} answered "${line}".`
      : `At ${where}, ${who} shared how a story ended.`,
};

// `receipts` are the completion receipts written this turn. `present(place)`
// lists the people who can witness at a place; `nameOf(id)` names an entity.
export function shareStoryEndings(s, receipts, { present, nameOf }) {
  for (const receipt of receipts) {
    const quest = s.quests?.records?.[receipt.questKey];
    if (
      quest?.mode !== "story" ||
      !STORY_COMPLETION_OUTCOMES.includes(receipt.outcome)
    )
      continue;
    const event = (s.log || []).find(
      (entry) => entry.seq === receipt.eventSeq && !entry.generated,
    );
    const here =
      receipt.locationId === null
        ? []
        : event?.locationId === receipt.locationId && Array.isArray(event.cast)
          ? event.cast
          : present(receipt.locationId);
    const witnesses = [
      ...new Set([...(receipt.actorId ? [receipt.actorId] : []), ...here]),
    ]
      .filter((id) => s.actors[id])
      .sort();
    const holder = quest.holder?.kind === "avatar" ? quest.holder.id : null;
    recordStoryLife(
      s,
      [...receipt.participants, ...witnesses],
      receipt,
      holder,
    );
    const teller = receipt.actorId || witnesses[0];
    if (!teller || receipt.locationId === null) continue;
    const words = (line) =>
      endingText[receipt.outcome](
        nameOf(teller),
        inline(nameOf(receipt.locationId)),
        line,
      );
    const full = words(lineOf(quest.program?.name));
    const ending = {
      questKey: receipt.questKey,
      eventSeq: receipt.eventSeq || s.eventSeq || 0,
      turn: receipt.turn,
      actorId: teller,
      locationId: receipt.locationId,
      witnesses,
    };
    if (!witnessStoryEnding(s, { ...ending, text: full }))
      witnessStoryEnding(s, { ...ending, text: words("") });
  }
}

// Open stories in the resident's own pack that name it: as the card's holder
// or as the subject of one of its endings. Each yields the ending places and
// the items those endings need someone to hold.
export function openStoryNeeds(s, actor) {
  const resident = packPeople[actor];
  if (!resident?.personalQuests || !lifeOf(s, actor)) return [];
  const pack = packDefinitions.find((entry) => entry.id === resident.packId);
  if (!pack?.storyQuests?.length || !s.packs?.[pack.id]) return [];
  const choices = Object.fromEntries(
    (pack.choices || []).map((choice) => [choice.id, choice]),
  );
  return authoredStoryDefinitions(s, [pack])
    .filter((definition) => !definition.resolved)
    .flatMap((definition) => {
      const story = pack.storyQuests.find(
        (entry) => `${pack.id}:${entry.key || entry.id}` === definition.key,
      );
      const endings = (story?.endings || [])
        .map((ending) => choices[ending.choice])
        .filter(Boolean);
      const named =
        (definition.holder.kind === "avatar" &&
          definition.holder.id === actor) ||
        endings.some((choice) => choice.subject === actor);
      if (!named) return [];
      const places = [
        ...new Set([
          ...endings.map((choice) => choice.at).filter(Boolean),
          ...(definition.holder.kind === "place" ? [definition.holder.id] : []),
        ]),
      ].sort();
      const items = [
        ...new Set(
          endings.flatMap((choice) =>
            (choice.requires || [])
              .filter((rule) => rule.kind === "holding" && rule.item)
              .map((rule) => rule.item),
          ),
        ),
      ].sort();
      return places.length
        ? [{ key: definition.key, holder: definition.holder, places, items }]
        : [];
    });
}

// A modest rank bonus for a generated program whose hand brings a needed item
// or a person to an open story's place. The program keeps its own legal
// steps; only the people's own choices can finish the story.
export const STORY_LEAN = -6;
export function storyLean(s, actor, program, needs = openStoryNeeds(s, actor)) {
  if (!needs.length) return 0;
  const hands = (program.steps || []).flatMap((step) => step.any || [step]);
  return hands.some((h) =>
    needs.some(
      (need) =>
        need.places.includes(h.location) &&
        (h.items.some((item) => need.items.includes(item)) ||
          h.avatars.length > 0),
    ),
  )
    ? STORY_LEAN
    : 0;
}
