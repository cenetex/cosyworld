// Completion receipts keep the site and people from the committed deed.
// The recent index is bounded; each quest also retains its own final receipt.
export const COMPLETION_HISTORY_LIMIT = 256;
const indirect = new Set(["journey", "help"]);
export const STORY_COMPLETION_OUTCOMES = [
  "fulfilled",
  "declined",
  "reported",
  "shared",
];
const outcomes = new Set([
  ...STORY_COMPLETION_OUTCOMES,
  "retired",
  "superseded",
]);
const meaningful = (receipt) =>
  STORY_COMPLETION_OUTCOMES.includes(receipt.outcome) &&
  !indirect.has(receipt.cause?.kind);
const copy = (value) => structuredClone(value);

export function recordQuestCompletion(world, quest, details) {
  if (quest.completion) return quest.completion;
  if (!outcomes.has(details.outcome || "fulfilled"))
    throw new Error("Choose an authored quest outcome.");
  const ledger = (world.questCompletions ??= {
    next: 1,
    recent: [],
    latest: null,
  });
  const revision = quest.terminalRevision || 1;
  const receipt = {
    id: `${quest.key}:terminal:${revision}`,
    seq: ledger.next++,
    eventSeq: details.eventSeq ?? world.eventSeq ?? 0,
    turn: details.turn ?? world.turn,
    questKey: quest.key,
    terminalRevision: revision,
    actorId: details.actorId ?? null,
    locationId: details.locationId ?? null,
    participants: [
      ...new Set([
        ...(details.participants || []),
        ...(details.actorId ? [details.actorId] : []),
      ]),
    ].sort(),
    outcome: details.outcome || "fulfilled",
    cause: details.cause
      ? copy(details.cause)
      : quest.cause
        ? copy(quest.cause)
        : null,
  };
  quest.terminalRevision = revision;
  quest.completion = receipt;
  ledger.recent.push(copy(receipt));
  ledger.recent = ledger.recent.slice(-COMPLETION_HISTORY_LIMIT);
  if (meaningful(receipt) && receipt.locationId !== null)
    ledger.latest = copy(receipt);
  return receipt;
}

export function questCompletions(world) {
  return (world.questCompletions?.recent || []).map(copy);
}

export function latestQuestCompletion(
  world,
  {
    afterSeq = 0,
    excludeCauseKinds = ["journey", "help"],
    requireLocation = true,
  } = {},
) {
  const ledger = world.questCompletions;
  if (!ledger) return null;
  const records = [...ledger.recent, ...(ledger.latest ? [ledger.latest] : [])];
  const latest =
    records
      .filter(
        (r) =>
          r.seq > afterSeq &&
          STORY_COMPLETION_OUTCOMES.includes(r.outcome) &&
          (!requireLocation || r.locationId !== null) &&
          !excludeCauseKinds.includes(r.cause?.kind),
      )
      .sort((a, b) => b.seq - a.seq)[0] || null;
  return latest ? copy(latest) : null;
}

export function validQuestCompletions(world, actors, places) {
  const ledger = world.questCompletions;
  if (!ledger) return true;
  if (
    !Number.isSafeInteger(ledger.next) ||
    ledger.next < 1 ||
    !Array.isArray(ledger.recent) ||
    ledger.recent.length > COMPLETION_HISTORY_LIMIT
  )
    return false;
  const valid = (r) =>
    r &&
    typeof r.questKey === "string" &&
    r.questKey.length <= 160 &&
    Number.isSafeInteger(r.terminalRevision) &&
    r.terminalRevision > 0 &&
    r.id === `${r.questKey}:terminal:${r.terminalRevision}` &&
    Number.isSafeInteger(r.seq) &&
    r.seq > 0 &&
    r.seq < ledger.next &&
    Number.isSafeInteger(r.eventSeq) &&
    r.eventSeq >= 0 &&
    r.eventSeq <= (world.eventSeq || 0) &&
    Number.isSafeInteger(r.turn) &&
    r.turn >= 0 &&
    r.turn <= world.turn &&
    (r.actorId === null || actors.includes(r.actorId)) &&
    (r.locationId === null || places.includes(r.locationId)) &&
    Array.isArray(r.participants) &&
    r.participants.length <= actors.length &&
    r.participants.every(
      (id, i) => actors.includes(id) && (i === 0 || r.participants[i - 1] < id),
    ) &&
    (r.actorId === null || r.participants.includes(r.actorId)) &&
    outcomes.has(r.outcome) &&
    (r.cause === null ||
      (r.cause &&
        ["quest", "journey", "help"].includes(r.cause.kind) &&
        typeof r.cause.rootId === "string" &&
        r.cause.rootId.length > 0 &&
        r.cause.rootId.length <= 200));
  if (
    !ledger.recent.every(
      (r, i) => valid(r) && (i === 0 || ledger.recent[i - 1].seq < r.seq),
    ) ||
    new Set(ledger.recent.map((r) => r.id)).size !== ledger.recent.length
  )
    return false;
  const eligible = ledger.recent.filter(
    (r) => meaningful(r) && r.locationId !== null,
  );
  if (eligible.length && ledger.latest === null) return false;
  if (
    ledger.latest !== null &&
    (!valid(ledger.latest) ||
      !meaningful(ledger.latest) ||
      ledger.latest.locationId === null ||
      eligible.some((r) => r.seq > ledger.latest.seq))
  )
    return false;
  if (
    ledger.latest &&
    ledger.recent.some(
      (r) =>
        (r.id === ledger.latest.id || r.seq === ledger.latest.seq) &&
        JSON.stringify(r) !== JSON.stringify(ledger.latest),
    )
  )
    return false;
  for (const quest of Object.values(world.quests?.records || {})) {
    if (!quest.completion) continue;
    const receipt = quest.completion;
    if (
      !valid(receipt) ||
      receipt.questKey !== quest.key ||
      receipt.terminalRevision !== quest.terminalRevision
    )
      return false;
    if (
      [...ledger.recent, ...(ledger.latest ? [ledger.latest] : [])].some(
        (r) =>
          (r.id === receipt.id || r.seq === receipt.seq) &&
          JSON.stringify(r) !== JSON.stringify(receipt),
      )
    )
      return false;
  }
  return true;
}
