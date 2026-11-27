import legacyLines from "./legacy-elysium-lines.json" with { type: "json" };
import {
  coordinateEntityActive,
  discoverCoordinate,
  isCoordinateResident,
  validElysiumCoordinates,
} from "./world/elysium-coordinates.mjs";

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
const { introStart: introductionStart, introEnd: introductionEnd, waiting: oldWaitingLines } = legacyLines;
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

export const elysiumPortraitReady = (world, id) =>
  world?.elysiumEncounters?.[id]?.portraitReady === true;
export const elysiumResidentAnchored = (world, id) =>
  isElysiumModel(id) && !elysiumPortraitReady(world, id);

export function withElysiumPortraits(world, receipts, installLife) {
  if (!Array.isArray(receipts)) return world;
  for (const receipt of receipts) {
    const resident = receipt?.resident;
    if (!elysiumResidentAnchored(world, resident)) continue;
    const encounter = world.elysiumEncounters?.[resident];
    if (
      encounter?.returnedAt &&
      encounter.returnedAt === receipt.returnedAt &&
      world.items[elysiumModelToken(resident)]?.holder === resident
    ) {
      encounter.portraitReady = true;
      installLife(world, (id) => id === resident);
    }
  }
  return world;
}

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

// These exact replies were written into saves before Void dialogue used inference.
export const isLegacyElysiumSpeech = (id, text) =>
  typeof text === "string" && isElysiumModel(id) && (
    legacyElysiumName(text) !== null || oldWaitingLines.all.includes(text) || oldWaitingLines[id]?.includes(text)
  );

export const isLegacyElysiumLine = (line) =>
  line?.kind === "dialogue" && isLegacyElysiumSpeech(line.actorId, line.text);

export function elysiumNameIndex(text, name) {
  if (typeof text !== "string" || !validElysiumName(name)) return -1;
  if (legacyElysiumName(text) === name) return introductionStart.length;
  const first = new RegExp(`(^|[^\\p{Alphabetic}-])${name}(?![\\p{Alphabetic}-])`, "u").exec(text);
  return first ? first.index + first[1].length : -1;
}

export function elysiumTalk(world, actor, resident, place, turn, before = Infinity) {
  return world.log.some((entry) => entry.seq < before && entry.turn === turn &&
    entry.kind === "action" && entry.verb === "talk" && entry.actorId === actor &&
    entry.targetId === resident && entry.locationId === place && entry.fromLocationId === place);
}

export function recordElysiumEncounter(s, event) {
  discoverCoordinate(s, event);
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
export function resetImportedElysiumEncounters(s, people) {
  for (const resident of ELYSIUM_MODEL_IDS) {
    if (!elysiumPortraitReady(s, resident)) continue;
    const actor = s.actors[resident];
    actor.place = people[resident].home;
    actor.want = null;
    for (const key of ["sleeping", "homeward", "dwellUntil", "attend"])
      delete actor[key];
    if (s.invitedPlaces) delete s.invitedPlaces[resident];
  }
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
  if (!validElysiumCoordinates(s)) return false;
  const records = s.elysiumEncounters;
  if (records === undefined) return true;
  if (!records || typeof records !== "object" || Array.isArray(records)) return false;
  const seq = (n) => Number.isSafeInteger(n) && n >= 1 && n <= s.eventSeq;
  return Object.entries(records).every(([resident, record]) => {
    if (!isElysiumModel(resident) || !s.actors[resident] ||
        !s.items[elysiumModelToken(resident)] || !record || !seq(record.scatteredAt))
      return false;
    const { talkedAt, scatteredAt, returnedAt, returnedBy, portraitReady } = record;
    if (Object.hasOwn(record, "portraitReady") && (portraitReady !== true || !returnedAt))
      return false;
    const fields = Object.keys(record)
      .filter((field) => !["talkedAt", "portraitReady"].includes(field))
      .sort().join();
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
    (!e.generated || e.kind !== "dialogue" ||
      !(isElysiumModel(e.actorId) ||
        (isCoordinateResident(e.actorId) && coordinateEntityActive(s, e.actorId))) ||
      e.entityId !== e.actorId || (e.elysiumName !== null &&
        (e.locationId !== people[e.actorId]?.home || !validElysiumName(e.elysiumName)))))
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
