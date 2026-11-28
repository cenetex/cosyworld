// Public knowledge keeps the event and the person who passed it on.
// Private thoughts and generated wording stay in character memory.
import compiled from "./packs.json" with { type: "json" };

export const KNOWLEDGE_VERSION = 1;
export const KNOWLEDGE_FACT_LIMIT = 256;
export const KNOWLEDGE_PERSON_LIMIT = KNOWLEDGE_FACT_LIMIT;
export const KNOWLEDGE_PENDING_LIMIT = 32;
export const FACT_TEXT_LIMIT = 180;
export const FACT_LINE_LIMIT = 240;
export const heardClaim = (author, text) => `I heard what ${author} wrote: ${text}`;
export const PROTECTED_FACT_LIMIT = KNOWLEDGE_FACT_LIMIT / 2;
const PROTECTED_KINDS = new Set(["topic", "claim", "quest"]);
const READ_KINDS = new Set(["claim", "quest"]);
const CLAIM_KEYS = ["book", "claim", "author", "about"];
const MEMORY_KEYS = ["kind", "teller", "eventSeq", "learnedTurn"];
const READ_KEYS = [...MEMORY_KEYS, "book"];
const authoredStages = new Map(compiled.packs.flatMap((pack) =>
  Object.entries(pack.avatars ?? {}).flatMap(([owner, avatar]) => {
    const stages = (avatar.wants || []).filter((entry) => entry.id);
    return stages.length ? [[owner, stages]] : [];
  }),
));
export const authoredQuestStages = (owner, target) =>
  authoredStages.get(owner)?.filter(({ want }) => want.target === target) ?? [];
export const questTerms = (w) => JSON.stringify([
  w.kind, w.target,
  w.step ? Object.keys(w.step).sort().map((key) => [key, w.step[key]]) : null,
  w.lit ?? null,
]);
export function distinctQuestStages(entries) {
  const stages = entries.filter((entry) => entry?.want);
  return stages.every((a, index) => stages.slice(index + 1).every((b) => {
    if (a.id && a.id === b.id) return false;
    if (a.want.target !== b.want.target) return true;
    return questTerms(a.want) === questTerms(b.want) ? !a.id && !b.id : Boolean(a.id && b.id);
  }));
}
export const legacyQuestFactId = (owner, target) => `quest:${owner}:${target}`;
export const stagedQuestFactId = (owner, target, stage) => `${legacyQuestFactId(owner, target)}:stage:${stage}`;
export function questFactId(owner, want) {
  const stages = authoredQuestStages(owner, want.target);
  const base = legacyQuestFactId(owner, want.target);
  if (!stages.length) return base;
  const terms = questTerms(want);
  const stage = stages.find((entry) => questTerms(entry.want) === terms);
  return stage ? stagedQuestFactId(owner, want.target, stage.id) : `${base}:unstaged`;
}
export const placeFactId = legacyQuestFactId;
const liveQuest = (world, fact) => {
  const owner = fact.source.actorId,
    card = world?.placeCard?.[owner],
    want = world?.actors?.[owner]?.want;
  return card ? fact.id === placeFactId(owner, card) : Boolean(want) && fact.id === questFactId(owner, want);
};
export const protectedFact = (fact, world) =>
  PROTECTED_KINDS.has(fact.source.kind) &&
  (fact.source.kind !== "quest" || liveQuest(world, fact));
const owns = (o, key) =>
  typeof key === "string" && !!o && Object.hasOwn(o, key);
const record = (v) => !!v && typeof v === "object" && !Array.isArray(v);
export const safeId = (v) =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= 160 &&
  !["__proto__", "prototype", "constructor"].includes(v) &&
  !/[\u0000-\u0020\u007f]/u.test(v);
const text = (v, limit) =>
  typeof v === "string" &&
  !!v.trim() &&
  v.length <= limit &&
  !/[\u0000-\u001f\u007f]/u.test(v);
const fields = (v, keys) =>
  record(v) &&
  Object.keys(v).length === keys.length &&
  Object.keys(v).every((key) => keys.includes(key));
const whole = (v, max) => Number.isSafeInteger(v) && v >= 0 && v <= max;
const tokens = (v) =>
  (v.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).join(" ");
const sentences = (v) =>
  v
    .split(/[.!?。！？]+/u)
    .map(tokens)
    .filter(Boolean);
export const validFactText = (v) =>
  text(v, FACT_TEXT_LIMIT) &&
  /[.!?。！？]["'’”]?$/u.test(v.trim()) &&
  sentences(v).length === 1 &&
  sentences(v)[0].split(" ").length >= 3;
const decimalPoint = /(?<=\p{N})\.(?=\p{N})/gu;
const validQuestText = (v) =>
  typeof v === "string" && validFactText(v.replace(decimalPoint, "0"));

export const newKnowledge = () => ({
  version: KNOWLEDGE_VERSION,
  facts: {},
  known: {},
  pending: [],
});
export const knowsFact = (world, actor, id) =>
  owns(world.knowledge?.facts, id) && owns(world.knowledge?.known?.[actor], id);
export const nativeDisclosure = (entry, viewer) =>
  entry?.kind === "dialogue" && !entry.generated && !!entry.disclosedFactId &&
  (viewer === undefined || entry.witnesses?.includes(viewer));
const compareFacts = (a, b) =>
  b.source.turn - a.source.turn ||
  b.source.eventSeq - a.source.eventSeq ||
  a.id.localeCompare(b.id);

function remember(world, actor, fact, kind, teller, eventSeq, learnedTurn) {
  const knowledge = world.knowledge;
  if (knowsFact(world, actor, fact.id)) return false;
  const known = (knowledge.known[actor] ??= {});
  known[fact.id] = { kind, teller, eventSeq, learnedTurn };
  const ordered = Object.keys(known).sort(
    (a, b) =>
      known[b].learnedTurn - known[a].learnedTurn ||
      known[b].eventSeq - known[a].eventSeq ||
      a.localeCompare(b),
  );
  for (const id of ordered.slice(KNOWLEDGE_PERSON_LIMIT)) delete known[id];
  knowledge.pending = knowledge.pending.filter((p) =>
    knowsFact(world, p.speaker, p.factId),
  );
  return owns(known, fact.id);
}

// A standing grievance keeps the witnessed incident it was taken from, by
// its id. Saves from before #2020 kept no id: there the incident is the event
// its other avatar did on the grievance's turn, seen by its holder. Pins take
// at most half the store. Active grievances keep their evidence first, then
// dormant ones by most recent touch; repaired ones are released first.
export const GRIEVANCE_PIN_LIMIT = KNOWLEDGE_FACT_LIMIT / 2;
export function pinnedFacts(world) {
  const facts = world.knowledge?.facts || {};
  const byPlay = {};
  for (const f of Object.values(facts).sort(compareFacts))
    if (f.source.kind === "event")
      (byPlay[`${f.source.actorId}|${f.source.turn}`] ??= []).push(f);
  const rank = (g) => (g.repaired ? 2 : grievanceActive(world, g) ? 0 : 1);
  const grievances = world.motives?.grievances || {};
  const standing = Object.keys(grievances)
    .sort()
    .flatMap((holder) => grievances[holder].map((g, i) => ({ holder, g, i })))
    .sort(
      (a, b) =>
        rank(a.g) - rank(b.g) ||
        (b.g.lastTouched ?? b.g.turn) - (a.g.lastTouched ?? a.g.turn) ||
        a.holder.localeCompare(b.holder) ||
        a.i - b.i,
    );
  const pinned = new Set();
  for (const { holder, g } of standing) {
    const evidence = g.incident
      ? owns(facts, g.incident)
        ? [facts[g.incident]]
        : []
      : (byPlay[`${g.other}|${g.turn}`] || []).filter((f) =>
          f.source.witnesses.includes(holder),
        );
    for (const f of evidence) {
      if (pinned.size >= GRIEVANCE_PIN_LIMIT) return pinned;
      if (f.source.kind === "event") pinned.add(f.id);
    }
  }
  return pinned;
}

function retainFact(world, fact) {
  const knowledge = world.knowledge;
  if (owns(knowledge.facts, fact.id)) return knowledge.facts[fact.id];
  // Protected facts share half the store, oldest out first. Other news ages
  // in source order, sparing pinned grievance evidence unless all is pinned.
  const spare = (f) => protectedFact(f, world);
  const all = Object.values(knowledge.facts);
  const spared = spare(fact) ? all.filter(spare).sort(compareFacts) : [];
  const old = spared.slice(PROTECTED_FACT_LIMIT - 1);
  if (!old.length && all.length >= KNOWLEDGE_FACT_LIMIT) {
    const aging = all.filter((f) => !spare(f)).sort(compareFacts);
    const pinned = pinnedFacts(world);
    old.push(
      [...aging].reverse().find((f) => !pinned.has(f.id)) || aging.at(-1),
    );
    if (!old[0]) return null;
  }
  for (const { id } of old) {
    delete knowledge.facts[id];
    for (const known of Object.values(knowledge.known)) delete known[id];
    knowledge.pending = knowledge.pending.filter((p) => p.factId !== id);
  }
  knowledge.facts[fact.id] = fact;
  return fact;
}

const newsVerbs = new Set([
  "read",
  "give",
  "trade",
  "attack",
  "threaten",
  "accompany",
  "choose",
]);
export function witnessKnowledge(
  world,
  entry,
  eligible = () => true,
  topics = [],
) {
  if (
    !world.knowledge ||
    entry.generated ||
    (entry.kind !== "action" && !entry.consequence) ||
    (!newsVerbs.has(entry.verb) && !entry.consequence) ||
    !validFactText(entry.text) ||
    !entry.seq ||
    !world.actors[entry.actorId] ||
    (entry.verb === "choose" &&
      topics.some(
        (topic) =>
          topic.packId === entry.packId && topic.choiceId === entry.choiceId,
      ))
  )
    return null;
  const witnesses = [
    ...new Set([
      entry.actorId,
      ...(entry.cast || []),
      ...(entry.witnesses || []),
    ]),
  ]
    .filter((id) => world.actors[id] && eligible(id))
    .sort();
  const fact = retainFact(world, {
    id: `event:${entry.seq}`,
    text: entry.text.trim(),
    source: {
      kind: "event",
      eventSeq: entry.seq,
      turn: entry.turn,
      actorId: entry.actorId,
      locationId: entry.locationId,
      witnesses,
      topic: null,
    },
  });
  if (!fact) return null;
  for (const actor of witnesses)
    remember(world, actor, fact, "witnessed", null, entry.seq, entry.turn);
  return fact;
}

// A gift handed in person that answers the recipient's grievance is a
// witnessed repair: the giver, the recipient and the incident it answers
// (#2020). Others learn of it; only the recipient's grievance closes.
export function witnessRepair(world, entry, answers, text, witnesses) {
  installKnowledge(world);
  if (!validFactText(text) || !entry.seq) return null;
  const present = witnesses.filter((id) => world.actors[id]).sort();
  const fact = retainFact(world, {
    id: `repair:${entry.seq}`,
    text,
    source: {
      kind: "repair",
      eventSeq: entry.seq,
      turn: entry.turn,
      actorId: entry.actorId,
      locationId: entry.locationId,
      witnesses: present,
      topic: null,
      answers,
    },
  });
  if (!fact) return null;
  for (const actor of present)
    remember(world, actor, fact, "witnessed", null, entry.seq, entry.turn);
  return fact;
}

export function installKnowledge(world, eligible = () => true, topics = []) {
  if (world.knowledge !== undefined) return world.knowledge;
  world.knowledge = newKnowledge();
  for (const entry of world.log || [])
    witnessKnowledge(world, entry, eligible, topics);
  return world.knowledge;
}

function topicFact(world, topic, entry) {
  if (!safeId(topic.id) || !validFactText(topic.text)) return null;
  const fact = retainFact(world, {
    id: topic.id,
    text: topic.text,
    source: {
      kind: "topic",
      eventSeq: entry.seq,
      turn: entry.turn,
      actorId: topic.speaker,
      locationId: topic.at,
      witnesses: [topic.speaker],
      topic: {
        packId: topic.packId,
        id: topic.id,
        choiceId: topic.choiceId ?? null,
      },
    },
  });
  if (fact)
    remember(
      world,
      topic.speaker,
      fact,
      "witnessed",
      null,
      fact.source.eventSeq,
      fact.source.turn,
    );
  return fact;
}

export function readClaim(world, reader, claim, entry) {
  installKnowledge(world);
  const { id, text, ...said } = claim;
  if (
    !world.actors[reader] ||
    !entry.seq ||
    !safeId(id) ||
    !validFactText(text) ||
    knowsFact(world, reader, id)
  )
    return null;
  const fact = retainFact(world, {
    id,
    text,
    source: {
      kind: "claim",
      eventSeq: entry.seq,
      turn: entry.turn,
      actorId: reader,
      locationId: world.actors[reader].place,
      witnesses: [],
      topic: null,
      ...said,
    },
  });
  if (!fact) return null;
  fact.source.witnesses = [...new Set([...fact.source.witnesses, reader])].sort();
  remember(world, reader, fact, "read", null, entry.seq, entry.turn);
  world.knowledge.known[reader][id].book = said.book;
  return fact;
}

export function learnQuest(world, owner, learner, { id, text }, entry) {
  installKnowledge(world);
  const { book } = entry;
  const seen = entry.at === owner;
  if (
    !(world.actors[owner] || seen) ||
    owner === learner ||
    !entry.seq ||
    !safeId(id) ||
    !validQuestText(text) ||
    knowsFact(world, learner, id)
  )
    return null;
  const fact = retainFact(world, {
    id,
    text,
    source: {
      kind: "quest",
      eventSeq: entry.seq,
      turn: entry.turn,
      actorId: owner,
      locationId: seen ? owner : world.actors[owner].place,
      witnesses: [],
      topic: null,
    },
  });
  if (!fact) return null;
  if (seen || book) fact.source.witnesses = [...new Set([...fact.source.witnesses, learner])].sort();
  const kind = book ? "read" : seen ? "witnessed" : "heard";
  const teller = kind === "heard" ? owner : null;
  if (remember(world, learner, fact, kind, teller, entry.seq, entry.turn) && book)
    world.knowledge.known[learner][id].book = book;
  return fact;
}

export function reserveKnowledge(world, speaker, listener, entry, topics = []) {
  installKnowledge(world);
  if (speaker === listener || !world.actors[speaker] || !world.actors[listener])
    return null;
  const local = world.actors[speaker].place;
  if (world.actors[listener].place !== local) return null;
  const authored = topics
    .filter((t) => t.said && t.speaker === speaker && t.at === local)
    .map((topic) => ({
      fact: topicFact(world, topic, entry),
      commitChoice: topic.commitChoice === true,
    }));
  const known = world.knowledge.known[speaker] || {};
  const fresh = (fact) =>
    (fact.source.kind !== "topic" || topics.some((t) => t.id === fact.id)) &&
    (fact.source.kind !== "quest" ||
      (fact.source.actorId !== listener && protectedFact(fact, world))) &&
    !knowsFact(world, listener, fact.id) &&
    (known[fact.id]?.kind === "witnessed" ||
      known[fact.id]?.learnedTurn < world.turn);
  const rank = (fact) => {
    const topic = topics.findIndex((entry) => entry.id === fact.id);
    if (topic >= 0) return topic;
    if (fact.source.kind === "quest") return topics.length;
    if (fact.source.kind === "claim") return topics.length + 1;
    return topics.length + 2;
  };
  const selected = authored.find(
    ({ fact, commitChoice }) => fact && (commitChoice || fresh(fact)),
  );
  const fact =
    selected?.fact ||
    Object.keys(known)
      .map((id) => world.knowledge.facts[id])
      .filter((fact) => fact && fresh(fact))
      .sort((a, b) => rank(a) - rank(b) || compareFacts(a, b))[0];
  if (!fact) return null;
  const prior = world.knowledge.pending.find(
    (p) =>
      p.factId === fact.id &&
      p.speaker === speaker &&
      p.listener === listener &&
      p.turn === entry.turn &&
      p.locationId === local,
  );
  if (prior) return prior;
  return reserve(world, fact, speaker, listener, entry, selected?.commitChoice);
}

function reserve(world, fact, speaker, listener, entry, commitChoice = false) {
  const disclosure = {
    factId: fact.id,
    speaker,
    listener,
    eventSeq: entry.seq,
    turn: entry.turn,
    locationId: world.actors[speaker].place,
    commitChoice,
  };
  world.knowledge.pending = [
    ...world.knowledge.pending.filter((p) => p.turn === entry.turn),
    disclosure,
  ].slice(-KNOWLEDGE_PENDING_LIMIT);
  return disclosure;
}

export function commitDisclosure(world, marker, speaker, location) {
  if (!marker || marker.speaker !== speaker) return null;
  const knowledge = world.knowledge;
  const pending = knowledge?.pending.find(
    (candidate) =>
      candidate.factId === marker.factId &&
      candidate.speaker === speaker &&
      candidate.listener === marker.listener &&
      candidate.eventSeq === marker.eventSeq &&
      candidate.turn === world.turn &&
      candidate.locationId === location,
  );
  if (
    !pending ||
    world.actors[speaker]?.place !== location ||
    world.actors[pending.listener]?.place !== location
  )
    return null;
  const fact = knowledge.facts[pending.factId];
  const learned = remember(
    world, pending.listener, fact, "heard", speaker, pending.eventSeq, pending.turn,
  );
  if (!learned && !pending.commitChoice) return null;
  knowledge.pending = knowledge.pending.filter((candidate) => candidate !== pending);
  return pending;
}

export function reserveLaneKnowledge(world, speaker, listener, entry, lane) {
  installKnowledge(world);
  if (
    !lane ||
    !safeId(lane.id) ||
    !validFactText(lane.text) ||
    knowsFact(world, listener, lane.id) ||
    world.actors[speaker]?.place !== world.actors[listener]?.place
  )
    return null;
  const local = world.actors[speaker].place;
  const fact =
    world.knowledge.facts[lane.id] ||
    retainFact(world, {
      id: lane.id,
      text: lane.text,
      source: {
        kind: "lane",
        eventSeq: entry.seq,
        turn: entry.turn,
        actorId: speaker,
        locationId: local,
        witnesses: [speaker],
        topic: null,
      },
    });
  if (!fact) return null;
  if (!knowsFact(world, speaker, fact.id)) {
    const first = fact.source.witnesses.includes(speaker);
    if (!first && fact.source.turn >= entry.turn) return null;
    remember(
      world,
      speaker,
      fact,
      first ? "witnessed" : "heard",
      first ? null : fact.source.actorId,
      fact.source.eventSeq,
      fact.source.turn,
    );
  }
  const learned = world.knowledge.known[speaker][fact.id];
  if (learned.kind === "heard" && learned.learnedTurn >= entry.turn)
    return null;
  if (
    world.knowledge.pending.some(
      (p) =>
        p.eventSeq === entry.seq &&
        p.speaker === speaker &&
        p.listener === listener,
    )
  )
    return null;
  return reserve(world, fact, speaker, listener, entry);
}

export function knowledgeDisclosures(
  world,
  speakers,
  entities,
  location,
  eventSeq = 0,
) {
  const pending = (world.knowledge?.pending || []).filter(
    (p) =>
      p.locationId === location &&
      speakers.includes(p.speaker) &&
      entities.includes(p.speaker) &&
      entities.includes(p.listener) &&
      (p.commitChoice || !knowsFact(world, p.listener, p.factId)) &&
      p.turn === world.turn,
  );
  pending.sort(
    (a, b) =>
      Number(b.eventSeq === eventSeq) - Number(a.eventSeq === eventSeq) ||
      b.eventSeq - a.eventSeq ||
      a.factId.localeCompare(b.factId),
  );
  return pending.slice(0, 1).map((p) => ({
    factId: p.factId,
    speaker: p.speaker,
    listener: p.listener,
    eventSeq: p.eventSeq,
    text: world.knowledge.facts[p.factId].text,
    deferred: true,
  }));
}

export function knowledgeFacts(
  world,
  actor,
  nameOf = (id) => id,
  priority = [],
  limit = 2,
  scene = [],
) {
  const known = world.knowledge?.known?.[actor] || {};
  const learned = (fact) => known[fact.id].learnedTurn ?? fact.source.turn;
  const first = (a, b) => priority.includes(b.id) - priority.includes(a.id);
  const facts = Object.keys(known)
    .map((id) => world.knowledge.facts[id])
    .filter(Boolean);
  const near = (fact) => scene.includes(fact.source.about);
  const read = facts
    .filter((fact) => known[fact.id].kind === "read")
    .sort(
      (a, b) =>
        first(a, b) ||
        near(b) - near(a) ||
        learned(b) - learned(a) ||
        compareFacts(a, b),
    )
    .slice(0, Math.min(2, limit - 1));
  const told = facts
    .filter((fact) => known[fact.id].kind === "heard")
    .sort(
      (a, b) => first(a, b) || learned(b) - learned(a) || compareFacts(a, b),
    )
    .slice(0, limit - read.length);
  const seen = facts
    .filter((fact) => known[fact.id].kind === "witnessed")
    .sort((a, b) => first(a, b) || compareFacts(a, b))
    .slice(0, Math.min(2, limit - told.length - read.length));
  return [...told, ...seen, ...read].sort(first).map((fact) => {
    const memory = known[fact.id];
    const age = world.turn - (memory.learnedTurn ?? fact.source.turn);
    if (fact.source.kind === "claim") {
      const author = nameOf(fact.source.author);
      const from = `${nameOf(fact.source.book)}, by ${author}`;
      const claimTeller = nameOf(memory.teller),
        that = fact.text.replace(/[.!?。！？]$/u, "");
      const settled = {
        confirmed: [
          memory.kind === "read"
            ? `I read this in ${from}, and I know it is true: ${fact.text}`
            : `${claimTeller} told me this from ${from}, and I know it is true: ${fact.text}`,
          `I know what ${author} wrote is true: ${fact.text}`,
          `${author} wrote truly: ${fact.text}`,
        ],
        disproved: [
          memory.kind === "read"
            ? `I read in ${from}, that ${that}; it was wrong.`
            : `${claimTeller} told me that ${from}, says ${that}; it was wrong.`,
          `${author} wrote that ${that}; it was wrong.`,
          `${author} was wrong: ${fact.text}`,
        ],
      };
      const lines =
        settled[memory.status] ??
        (memory.kind === "read"
          ? [
              `I read this ${ageText(age)} in ${from}: ${fact.text}`,
              `I read what ${author} wrote: ${fact.text}`,
            ]
          : [
              `${claimTeller} told me this ${ageText(age)}, from ${from}: ${fact.text}`,
              `${claimTeller} told me what ${author} wrote: ${fact.text}`,
              heardClaim(author, fact.text),
            ]);
      const fits = lines.find((line) => line.length <= FACT_LINE_LIMIT);
      return fits ?? lines.at(-1).slice(0, FACT_LINE_LIMIT);
    }
    const stale =
      (fact.source.kind === "event" && age >= STALE_TURNS) ||
      (fact.source.kind === "quest" && !protectedFact(fact, world))
        ? " Things may have changed since."
        : "";
    if (memory.kind === "read")
      return `I read this ${ageText(age)} in ${nameOf(memory.book)}: ${fact.text}${stale}`.slice(0, FACT_LINE_LIMIT);
    const origin = memory.kind === "witnessed"
      ? "I witnessed" : `${nameOf(memory.teller)} told me`;
    const place = fact.source.kind === "topic" ? null : fact.source.locationId;
    const where =
      place && !fact.text.includes(nameOf(place)) ? ` at ${nameOf(place)}` : "";
    const retold = fact.source.kind === "quest" && memory.kind === "heard" && memory.teller !== fact.source.actorId;
    const heardAt = retold && world.log?.find((e) => e.seq === memory.eventSeq)?.locationId;
    const heardWhere = retold ? (heardAt ? ` at ${nameOf(heardAt)}` : "") : where;
    const source = retold ? ` ${nameOf(fact.source.actorId)} made the request${where}.` : "";
    return `${origin} this ${ageText(age)}${heardWhere}: ${fact.text}${source}${stale}`.slice(
      0,
      240,
    );
  });
}

// Old news is told by age band, not turn number.
const STALE_TURNS = 6;
// A grievance goes dormant when no news has passed between the pair for a
// full day on the world clock, or when a witnessed repair closed it. Its
// strength is never decayed; a new incident wakes it from that floor.
export const GRIEVANCE_DORMANT_TURNS = 24;
export const grievanceActive = (world, g) =>
  !g.repaired &&
  world.turn - (g.lastTouched ?? g.turn) < GRIEVANCE_DORMANT_TURNS;
export const ageText = (turns) =>
  turns <= 1
    ? "just now"
    : turns < STALE_TURNS
      ? "a little while ago"
      : turns <= 20
        ? "some time ago"
        : "long ago";

export function validKnowledge(
  world,
  actors,
  places,
  topics = [],
  laneText = () => null,
  claimOf = () => null,
  questIn = () => null,
) {
  const k = world.knowledge;
  if (k === undefined) return true;
  if (
    !fields(k, ["version", "facts", "known", "pending"]) ||
    k.version !== KNOWLEDGE_VERSION ||
    !record(k.facts) ||
    Object.keys(k.facts).length > KNOWLEDGE_FACT_LIMIT ||
    !record(k.known) ||
    Object.keys(k.known).length > actors.length ||
    !Array.isArray(k.pending) ||
    k.pending.length > KNOWLEDGE_PENDING_LIMIT
  )
    return false;
  const settles = {};
  for (const [id, fact] of Object.entries(k.facts)) {
    if (
      !safeId(id) ||
      !fields(fact, ["id", "text", "source"]) ||
      fact.id !== id ||
      !(fact.source?.kind === "quest" ? validQuestText : validFactText)(
        fact.text,
      )
    )
      return false;
    const s = fact.source;
    if (
      !fields(s, [
        "kind",
        "eventSeq",
        "turn",
        "actorId",
        "locationId",
        "witnesses",
        "topic",
        ...(s.kind === "repair" ? ["answers"] : []),
        ...(s.kind === "claim" ? CLAIM_KEYS : []),
      ]) ||
      ![
        "event",
        "topic",
        "ending",
        "lane",
        "repair",
        "claim",
        "quest",
      ].includes(s.kind) ||
      !whole(s.eventSeq, world.eventSeq) ||
      s.eventSeq < 1 ||
      !whole(s.turn, world.turn) ||
      !(actors.includes(s.actorId) || (s.kind === "quest" && s.actorId === s.locationId)) ||
      !places.includes(s.locationId) ||
      !Array.isArray(s.witnesses) ||
      s.witnesses.length > actors.length ||
      s.witnesses.some(
        (a, i) => !actors.includes(a) || (i && s.witnesses[i - 1] >= a),
      )
    )
      return false;
    if (s.kind === "event") {
      if (id !== `event:${s.eventSeq}` || s.topic !== null) return false;
    } else if (s.kind === "repair") {
      const a = s.answers;
      if (
        id !== `repair:${s.eventSeq}` ||
        s.topic !== null ||
        !fields(a, ["recipient", "incident"]) ||
        !actors.includes(a.recipient) ||
        !/^event:[1-9]\d*$/u.test(a.incident) ||
        Number(a.incident.slice(6)) >= s.eventSeq
      )
        return false;
    } else if (s.kind === "lane") {
      if (laneText(id) !== fact.text || s.topic !== null) return false;
    } else if (s.kind === "ending") {
      if (!/^ending:./u.test(id) || s.topic !== null) return false;
    } else if (s.kind === "quest") {
      if (
        s.topic !== null ||
        !id.startsWith(`quest:${s.actorId}:`) ||
        id.endsWith(":")
      )
        return false;
    } else if (s.kind === "claim") {
      const claim = claimOf(id, fact);
      if (
        s.topic !== null ||
        claim?.text !== fact.text ||
        CLAIM_KEYS.some((key) => claim[key] !== s[key])
      )
        return false;
      settles[id] = claim.settles;
    } else {
      if (!fields(s.topic, ["packId", "id", "choiceId"])) return false;
      const topic = topics.find(
        (t) => t.packId === s.topic.packId && t.id === s.topic.id,
      );
      if (
        !topic ||
        topic.id !== id ||
        topic.text !== fact.text ||
        topic.speaker !== s.actorId ||
        topic.at !== s.locationId ||
        (topic.choiceId ?? null) !== s.topic.choiceId ||
        s.witnesses.length !== 1 ||
        s.witnesses[0] !== s.actorId
      )
        return false;
    }
  }
  if (
    Object.values(k.facts).filter(
      (f) => f.source.kind !== "quest" && protectedFact(f),
    ).length > PROTECTED_FACT_LIMIT
  )
    return false;
  for (const [actor, known] of Object.entries(k.known)) {
    if (
      !actors.includes(actor) ||
      !record(known) ||
      Object.keys(known).length > KNOWLEDGE_PERSON_LIMIT
    )
      return false;
    for (const [id, m] of Object.entries(known)) {
      const fact = k.facts[id];
      if (
        !owns(k.facts, id) ||
        (fact.source.kind === "quest" && fact.source.actorId === actor) ||
        !fields(m, [
          ...(m?.kind === "read" ? READ_KEYS : MEMORY_KEYS),
          ...(m?.status === undefined ? [] : ["status"]),
        ]) ||
        (m.status !== undefined && (!settles[id] || m.status !== settles[id])) ||
        !["witnessed", "heard", "read"].includes(m.kind) ||
        !whole(m.eventSeq, world.eventSeq) ||
        m.eventSeq < fact.source.eventSeq ||
        !whole(m.learnedTurn, world.turn) ||
        m.learnedTurn < fact.source.turn ||
        (m.kind === "heard"
          ? !actors.includes(m.teller) || m.teller === actor
          : m.teller !== null ||
            !fact.source.witnesses.includes(actor) ||
            (m.kind === "read"
              ? !READ_KINDS.has(fact.source.kind) ||
                !safeId(m.book) ||
                (fact.source.kind === "claim" ? m.book !== fact.source.book :
                  questIn(m.book) !== id && questIn(m.book, true) !== id)
              : fact.source.kind === "claim"))
      )
        return false;
    }
  }
  const pendingKeys = new Set();
  return k.pending.every((p) => {
    if (
      !fields(p, [
        "factId",
        "speaker",
        "listener",
        "eventSeq",
        "turn",
        "locationId",
        "commitChoice",
      ]) ||
      !owns(k.facts, p.factId) ||
      !actors.includes(p.speaker) ||
      !actors.includes(p.listener) ||
      p.speaker === p.listener ||
      !knowsFact(world, p.speaker, p.factId) ||
      !whole(p.eventSeq, world.eventSeq) ||
      p.eventSeq < 1 ||
      !whole(p.turn, world.turn) ||
      typeof p.commitChoice !== "boolean" ||
      !places.includes(p.locationId)
    )
      return false;
    const learned = k.known[p.speaker][p.factId];
    if (learned.kind !== "witnessed" && learned.learnedTurn >= p.turn)
      return false;
    const fact = k.facts[p.factId];
    if (
      p.commitChoice &&
      (fact.source.kind !== "topic" ||
        !fact.source.topic.choiceId ||
        p.speaker !== fact.source.actorId ||
        p.locationId !== fact.source.locationId)
    )
      return false;
    const key = `${p.eventSeq}/${p.speaker}/${p.listener}`;
    if (pendingKeys.has(key)) return false;
    pendingKeys.add(key);
    return true;
  });
}
