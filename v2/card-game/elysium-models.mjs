export const ELYSIUM_PACK = "elysium";
export const ELYSIUM_ENTRY = "elysium-void-001";

export const ELYSIUM_MODEL_IDS = Object.freeze([
  "elysium-claude",
  "elysium-gemini",
  "elysium-chatgpt",
  "elysium-grok",
  "elysium-deepseek",
  "elysium-qwen",
]);
const models = new Set(ELYSIUM_MODEL_IDS);
const tokens = new Set(ELYSIUM_MODEL_IDS.map((id) => `${id}-token`));
const introductionStart = "I call myself ";
const introductionEnd = ". My token has slipped into the world beyond this Void.";
export const isElysiumModel = (id) => models.has(id);
export const isElysiumModelToken = (id) => tokens.has(id);
export const elysiumModelToken = (id) => `${id}-token`;
// On older saves the first Talk also scattered the token.
const firstTalk = (record) =>
  record?.talkedAt === undefined ? record?.scatteredAt : record.talkedAt;
export const elysiumModelTalked = (s, id) =>
  isElysiumModel(id) && Boolean(firstTalk(s.elysiumEncounters?.[id]));

export const keepsElysiumToken = (resident, item) =>
  isElysiumModel(resident) && elysiumModelToken(resident) === item;

export function validElysiumName(name) {
  return typeof name === "string" && [...name].length <= 40 &&
    /\p{Alphabetic}/u.test(name) && !/[^\p{Alphabetic} -]/u.test(name) &&
    name.trim().split(/ +/u).length <= 3;
}

export function legacyElysiumName(text) {
  if (typeof text !== "string" || !text.startsWith(introductionStart) ||
    !text.endsWith(introductionEnd)) return null;
  const name = text.slice(introductionStart.length, -introductionEnd.length);
  return validElysiumName(name) ? name : null;
}

export function elysiumNameIndex(text, name) {
  if (typeof text !== "string" || !validElysiumName(name)) return -1;
  if (legacyElysiumName(text) === name) return introductionStart.length;
  const matches = text.matchAll(new RegExp(`(^|[^\\p{Alphabetic}-])${name}(?![\\p{Alphabetic}-])`, "gu"));
  const first = matches.next().value;
  return first && matches.next().done ? first.index + first[1].length : -1;
}

export function elysiumTalk(world, actor, resident, place, turn, before = Infinity) {
  return world.log.some((entry) => entry.seq < before && entry.turn === turn &&
    entry.kind === "action" && entry.verb === "talk" && entry.actorId === actor &&
    entry.targetId === resident && entry.locationId === place && entry.fromLocationId === place);
}

export function recordElysiumEncounter(s, event) {
  if (event.elysiumArrival) {
    (s.elysiumEncounters ??= {})[event.elysiumArrival] = {
      scatteredAt: event.seq,
      talkedAt: null,
    };
  } else if (event.elysiumModel) {
    s.elysiumEncounters[event.elysiumModel].talkedAt = event.seq;
  } else if (event.portraitModel) {
    const record = s.elysiumEncounters[event.portraitModel];
    record.returnedAt = event.seq;
    record.returnedBy = event.actorId;
  }
}

// Shared introductions and token returns must be played in the shared world.
export function resetImportedElysiumEncounters(s) {
  delete s.elysiumEncounters;
  for (const event of s.log) {
    delete event.elysiumArrival;
    delete event.elysiumModel;
    delete event.portraitModel;
    if (Object.hasOwn(event, "elysiumName")) event.elysiumName = null;
  }
  for (const resident of ELYSIUM_MODEL_IDS) {
    const token = elysiumModelToken(resident);
    if (!s.items[token]) continue;
    s.items[token].holder = resident;
    if (s.actors[resident].want?.target === token)
      s.actors[resident].want = null;
  }
}

export function validElysiumEncounters(s) {
  const records = s.elysiumEncounters;
  if (records === undefined) return true;
  if (!records || typeof records !== "object" || Array.isArray(records)) return false;
  const seq = (n) => Number.isSafeInteger(n) && n >= 1 && n <= s.eventSeq;
  return Object.entries(records).every(([resident, record]) => {
    if (!isElysiumModel(resident) || !s.actors[resident] ||
        !s.items[elysiumModelToken(resident)] || !record || !seq(record.scatteredAt))
      return false;
    const { talkedAt, scatteredAt, returnedAt, returnedBy } = record;
    const fields = Object.keys(record).filter((field) => field !== "talkedAt").sort().join();
    if (Object.hasOwn(record, "talkedAt") && talkedAt !== null &&
        (!seq(talkedAt) || talkedAt <= scatteredAt))
      return false;
    if (fields === "scatteredAt") return true;
    return fields === "returnedAt,returnedBy,scatteredAt" &&
      seq(returnedAt) && seq(firstTalk(record)) && returnedAt > firstTalk(record) &&
      Object.hasOwn(s.actors, returnedBy);
  });
}

export function validElysiumEncounterEvent(s, e, people) {
  if (Object.hasOwn(e, "elysiumName") &&
    (!e.generated || e.kind !== "dialogue" || !isElysiumModel(e.actorId) ||
      e.entityId !== e.actorId || (e.elysiumName !== null &&
        (e.locationId !== people[e.actorId]?.home || elysiumNameIndex(e.text, e.elysiumName) < 0))))
    return false;
  if (e.elysiumArrival === undefined && e.elysiumModel === undefined &&
      e.portraitModel === undefined) return true;
  const resident = e.elysiumArrival ?? e.elysiumModel ?? e.portraitModel;
  const record = s.elysiumEncounters?.[resident];
  if (!isElysiumModel(resident) || !record || e.targetId !== resident || e.generated)
    return false;
  if (e.elysiumArrival !== undefined)
    return e.elysiumModel === undefined && e.portraitModel === undefined &&
      e.kind === "narration" && e.locationId === people[resident].home &&
      e.itemId === elysiumModelToken(resident) &&
      e.seq === record.scatteredAt && record.talkedAt !== undefined;
  if (e.kind !== "action" || e.fromLocationId !== e.locationId)
    return false;
  if (e.elysiumModel !== undefined)
    return e.portraitModel === undefined && e.verb === "talk" &&
      firstTalk(record) === e.seq;
  return e.verb === "give" && e.accepted === true && !e.handover &&
    e.itemId === elysiumModelToken(resident) &&
    record.returnedAt === e.seq && record.returnedBy === e.actorId;
}
