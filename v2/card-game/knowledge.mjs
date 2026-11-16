// Public knowledge keeps the event and the person who passed it on.
// Private thoughts and generated wording stay in character memory.
export const KNOWLEDGE_VERSION = 1;
export const KNOWLEDGE_FACT_LIMIT = 256;
export const KNOWLEDGE_PERSON_LIMIT = KNOWLEDGE_FACT_LIMIT;
export const KNOWLEDGE_PENDING_LIMIT = 32;
export const FACT_TEXT_LIMIT = 180;
const owns = (o, key) =>
  typeof key === "string" && !!o && Object.hasOwn(o, key);
const record = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const safeId = (v) =>
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

export const newKnowledge = () => ({
  version: KNOWLEDGE_VERSION,
  facts: {},
  known: {},
  pending: [],
});
export const knowsFact = (world, actor, id) =>
  owns(world.knowledge?.facts, id) && owns(world.knowledge?.known?.[actor], id);
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
  // Authored facts keep their stable identity. Event and ending news ages in
  // source order, skipping pinned grievance evidence. If every aging fact is
  // pinned, the oldest goes anyway so the store stays bounded.
  if (Object.keys(knowledge.facts).length >= KNOWLEDGE_FACT_LIMIT) {
    const eventFacts = Object.values(knowledge.facts)
      .filter((f) => f.source.kind !== "topic")
      .sort(compareFacts);
    const pinned = pinnedFacts(world);
    const old =
      [...eventFacts].reverse().find((f) => !pinned.has(f.id)) ||
      eventFacts.at(-1);
    if (!old) return null;
    delete knowledge.facts[old.id];
    for (const known of Object.values(knowledge.known)) delete known[old.id];
    knowledge.pending = knowledge.pending.filter((p) => p.factId !== old.id);
  }
  knowledge.facts[fact.id] = fact;
  return fact;
}

const newsVerbs = new Set([
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

export function reserveKnowledge(world, speaker, listener, entry, topics = []) {
  installKnowledge(world);
  if (speaker === listener || !world.actors[speaker] || !world.actors[listener])
    return null;
  const local = world.actors[speaker].place;
  if (world.actors[listener].place !== local) return null;
  const authored = topics
    .filter((t) => t.speaker === speaker && t.at === local)
    .map((topic) => topicFact(world, topic, entry))
    .filter(Boolean);
  const known = world.knowledge.known[speaker] || {};
  const fresh = (fact) =>
    (fact.source.kind !== "topic" || topics.some((t) => t.id === fact.id)) &&
    !knowsFact(world, listener, fact.id) &&
    (known[fact.id]?.kind === "witnessed" ||
      known[fact.id]?.learnedTurn < world.turn);
  const choiceReady = (fact) =>
    topics.some(
      (t) =>
        t.id === fact.id &&
        t.speaker === speaker &&
        t.at === local &&
        t.choiceReady,
    );
  const fact =
    authored.find((f) => fresh(f) || choiceReady(f)) ||
    Object.keys(known)
      .map((id) => world.knowledge.facts[id])
      .filter(Boolean)
      .sort(compareFacts)
      .find(fresh);
  if (!fact) return null;
  const prior = world.knowledge.pending.find(
    (p) =>
      p.factId === fact.id &&
      p.speaker === speaker &&
      p.listener === listener &&
      p.locationId === local &&
      p.commitChoice === choiceReady(fact),
  );
  if (prior) return prior;
  return tell(world, fact, speaker, listener, entry, choiceReady(fact));
}
function tell(world, fact, speaker, listener, entry, commitChoice) {
  remember(world, listener, fact, "heard", speaker, entry.seq, entry.turn);
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
  // The speaker already knew the lane; the saved fact keeps its first teller.
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
  if (
    world.knowledge.pending.some(
      (p) =>
        p.eventSeq === entry.seq &&
        p.speaker === speaker &&
        p.listener === listener,
    )
  )
    return null;
  return tell(world, fact, speaker, listener, entry, false);
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
  }));
}

export function knowledgeFacts(
  world,
  actor,
  nameOf = (id) => id,
  priority = [],
  limit = 2,
) {
  const known = world.knowledge?.known?.[actor] || {};
  const learned = (fact) => known[fact.id].learnedTurn ?? fact.source.turn;
  return Object.keys(known)
    .map((id) => world.knowledge.facts[id])
    .filter(Boolean)
    .sort(
      (a, b) =>
        priority.includes(b.id) - priority.includes(a.id) ||
        learned(b) - learned(a) ||
        compareFacts(a, b),
    )
    .slice(0, limit)
    .map((fact) => {
      const memory = known[fact.id];
      const origin =
        memory.kind === "witnessed"
          ? "I witnessed"
          : `${nameOf(memory.teller)} told me`;
      const age = world.turn - (memory.learnedTurn ?? fact.source.turn);
      const place =
        fact.source.kind === "topic" ? null : fact.source.locationId;
      const where =
        place && !fact.text.includes(nameOf(place))
          ? ` at ${nameOf(place)}`
          : "";
      // Authored topics and finished stories hold. Witnessed events, such as
      // who carried what where, can go stale, and saying so keeps an old
      // account honest instead of a quiet lie.
      const stale =
        fact.source.kind === "event" && age >= STALE_TURNS
          ? " Things may have changed since."
          : "";
      return `${origin} this ${ageText(age)}${where}: ${fact.text}${stale}`.slice(
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
  for (const [id, fact] of Object.entries(k.facts)) {
    if (
      !safeId(id) ||
      !fields(fact, ["id", "text", "source"]) ||
      fact.id !== id ||
      !validFactText(fact.text)
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
      ]) ||
      !["event", "topic", "ending", "lane", "repair"].includes(s.kind) ||
      !whole(s.eventSeq, world.eventSeq) ||
      s.eventSeq < 1 ||
      !whole(s.turn, world.turn) ||
      !actors.includes(s.actorId) ||
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
        !fields(m, ["kind", "teller", "eventSeq", "learnedTurn"]) ||
        !["witnessed", "heard"].includes(m.kind) ||
        !whole(m.eventSeq, world.eventSeq) ||
        m.eventSeq < fact.source.eventSeq ||
        !whole(m.learnedTurn, world.turn) ||
        m.learnedTurn < fact.source.turn ||
        (m.kind === "witnessed"
          ? m.teller !== null || !fact.source.witnesses.includes(actor)
          : !actors.includes(m.teller) || m.teller === actor)
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
    if (learned.kind === "heard" && learned.learnedTurn >= p.turn) return false;
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
