// Quests reach the player through Talk. This module turns saved quest state
// into a few first-person lines for a speaker's dialogue context. It reads the
// world and never changes it. The rules still own legality, progress, focus
// and rewards; these lines only say what a character wants and what is open.
import { questRecord, questRecords } from "./shared-quests.mjs";
import { questCards, questHistoryCards } from "./quest-cards.mjs";
import { entityActive } from "./pack-registry.mjs";
import { itemPlace, nameOf, rootHolder } from "./world.mjs";
import {
  alternatives,
  knownActors,
  personalQuestActor,
  programFor,
  targetsFor,
} from "./quests.mjs";

// The dialogue request allows 16 facts of 240 characters per entity.
export const QUEST_TALK_LIMIT = 3;
const LINE = 240;

const open = (q) => q.completedTurn === null && !q.retired;
const sentence = (text) => {
  const t = typeof text === "string" ? text.trim() : "";
  return !t || /[.!?…]["'’”)]?$/u.test(t) ? t : `${t}.`;
};
const clip = (text) =>
  text.length <= LINE ? text : `${text.slice(0, LINE - 1).trimEnd()}…`;
const describe = (card) => {
  const name = sentence(card.title) || "A wish.";
  const purpose = sentence(card.purpose);
  return purpose && purpose !== name ? `${name} ${purpose}` : name;
};

// A knows rule names one topic or several alternatives.
const topicsOf = (condition) => condition.topics || [condition.topic];
const knowsTopics = (q) =>
  (q.program?.steps || []).flatMap((step) =>
    (step?.any || [step]).flatMap((hand) =>
      (hand?.conditions || [])
        .filter((condition) => condition.kind === "knows")
        .flatMap(topicsOf),
    ),
  );

// The latest turn this speaker learned a topic that the quest asks about.
function heardTurn(world, actor, q) {
  const known = world.knowledge?.known?.[actor] || {};
  let turn = -1;
  for (const step of q.program?.steps || [])
    for (const hand of step?.any || [step])
      for (const condition of hand?.conditions || [])
        if (condition.kind === "knows")
          for (const topic of topicsOf(condition))
            if (known[topic])
              turn = Math.max(turn, known[topic].learnedTurn ?? -1);
  return turn;
}

function holderHere(world, q, place) {
  const holder = q.holder;
  if (!holder || !entityActive(world, holder.id)) return false;
  if (holder.kind === "place") return holder.id === place;
  if (holder.kind === "avatar") return world.actors[holder.id]?.place === place;
  if (holder.kind === "item")
    return (
      Boolean(world.items[holder.id]) && itemPlace(world, holder.id) === place
    );
  return false;
}

// The speaker's own quests, as the cards used to show them. Card copy is the
// public wording; step lists and authored purposes stay in the rules. The
// quest they most recently advanced or heard news about comes first;
// otherwise the rules' saved focus leads, then the newest card.
export function talkQuests(world, actor) {
  if (!world.actors?.[actor]) return { own: [], finished: [], nearby: [] };
  const cards = questCards(world, actor);
  const record = (card) => questRecord(world, card.key) || card;
  const own = cards
    .filter((card) => ["active", "pending"].includes(card.status))
    .map((card, index) => ({
      card,
      index,
      recent: Math.max(
        record(card).lastProgressTurn ?? -1,
        heardTurn(world, actor, record(card)),
      ),
    }))
    .sort(
      (a, b) =>
        b.recent - a.recent ||
        Number(b.card.focused) - Number(a.card.focused) ||
        (record(b.card).createdTurn ?? 0) - (record(a.card).createdTurn ?? 0) ||
        a.index - b.index,
    )
    .map(({ card }) => card);
  const finished = cards.filter((card) => card.status === "fulfilled");
  const mine = new Set(questHistoryCards(world, actor).map((card) => card.key));
  const place = world.actors[actor].place;
  const nearby = questRecords(world)
    .filter(
      (q) =>
        open(q) &&
        q.mode !== "personal" &&
        !mine.has(q.key) &&
        q.droppedBy?.[actor] === undefined &&
        holderHere(world, q, place),
    )
    .map((q) => ({
      key: q.key,
      title: q.program.name,
      purpose: q.program.purpose,
      help: q.cause?.kind === "help",
      holder: q.holder,
    }));
  return {
    own,
    finished,
    nearby: [...nearby.filter((q) => q.help), ...nearby.filter((q) => !q.help)],
  };
}

// Compact narration lines: what I want, where I fit someone else's quest,
// what else I carry or just finished, and what help or story waits here.
export function questTalkFacts(world, actor) {
  const { own, finished, nearby } = talkQuests(world, actor);
  const facts = [];
  if (own[0]) facts.push(`What I want most now: ${describe(own[0])}`);
  // Another person's step that needs this speaker comes next, so a resident
  // can point the way even when their own wishes fill the rest.
  const leads = questLeads(world, actor);
  if (leads.length) facts.push(leads.join(" "));
  const more = [
    ...(own.length > 1
      ? [
          `I also want to pursue ${own
            .slice(1)
            .map((card) => card.title)
            .join("; ")}.`,
        ]
      : []),
    ...finished
      .slice(-2)
      .map(
        (card) =>
          `I just finished ${card.title} (${(card.completion || "Fulfilled").toLowerCase()}).`,
      ),
  ];
  if (more.length) facts.push(more.join(" "));
  const help = nearby.filter((q) => q.help);
  const stories = nearby.filter((q) => !q.help);
  const here = [
    ...help.slice(0, 2).map((q) => `Help needed here: ${describe(q)}`),
    ...stories
      .slice(0, 2)
      .map((q) =>
        q.holder.kind === "avatar" && q.holder.id !== actor
          ? `${nameOf(q.holder.id)} holds an open story: ${describe(q)}`
          : `Open story here: ${describe(q)}`,
      ),
  ];
  if (here.length) facts.push(here.join(" "));
  return facts.slice(0, QUEST_TALK_LIMIT).map(clip);
}

// Learned topics that the speaker's open quests ask about. Talk context lists
// these known facts first, so quest news is not crowded out.
export function questTopics(world, actor) {
  return [
    ...new Set(
      talkQuests(world, actor).own.flatMap((card) =>
        knowsTopics(questRecord(world, card.key) || card),
      ),
    ),
  ];
}

// Leads: where this speaker fits another person's current quest step. Each
// line comes from saved custody, company and knowledge, so a resident can
// point the way without inventing a fact. At most two people are named.
export function questLeads(world, actor) {
  const lines = [];
  const known = world.knowledge?.known?.[actor] || {};
  for (const other of knownActors(world)) {
    if (lines.length >= 2) break;
    if (other === actor || !personalQuestActor(other)) continue;
    const program = programFor(world, other);
    if (!program) continue;
    const hands = targetsFor(world, other).flatMap(alternatives);
    const who = nameOf(other);
    const title = sentence(program.name).replace(/\.$/u, "");
    const needsMe = hands.some((h) => h?.avatars?.includes(actor));
    const mine = [
      ...new Set(
        hands.flatMap((h) =>
          (h?.items || []).filter(
            (item) => world.items[item] && rootHolder(world, item) === actor,
          ),
        ),
      ),
    ];
    const heard = hands.some((h) =>
      (h?.conditions || []).some(
        (c) => c.kind === "knows" && topicsOf(c).some((topic) => known[topic]),
      ),
    );
    if (!needsMe && !mine.length && !heard) continue;
    lines.push(
      [
        `${who} is pursuing ${title}.`,
        ...(needsMe ? [`It needs me there.`] : []),
        ...(mine.length
          ? [
              `I hold ${mine.map((item) => `the ${nameOf(item)}`).join(" and ")} it needs.`,
            ]
          : []),
        ...(heard ? [`I know something ${who} needs to hear for it.`] : []),
      ].join(" "),
    );
  }
  return lines;
}
