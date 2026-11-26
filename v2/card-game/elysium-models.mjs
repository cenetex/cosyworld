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
export const isElysiumModel = (id) => models.has(id);
export const isElysiumModelToken = (id) => tokens.has(id);
export const elysiumModelToken = (id) => `${id}-token`;
export const elysiumModelMet = (s, id) =>
  isElysiumModel(id) && Boolean(s.elysiumEncounters?.[id]?.scatteredAt);

// The token belongs with its resident before it scatters and after it is given back.
export const keepsElysiumToken = (resident, item) =>
  isElysiumModel(resident) && elysiumModelToken(resident) === item;

export function recordElysiumEncounter(s, event) {
  if (event.elysiumModel) {
    (s.elysiumEncounters ??= {})[event.elysiumModel] = { scatteredAt: event.seq };
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
    delete event.elysiumModel;
    delete event.portraitModel;
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
    const fields = Object.keys(record).sort().join();
    if (fields === "scatteredAt") return true;
    return fields === "returnedAt,returnedBy,scatteredAt" &&
      seq(record.returnedAt) && record.returnedAt > record.scatteredAt &&
      Object.hasOwn(s.actors, record.returnedBy);
  });
}

export function validElysiumEncounterEvent(s, e) {
  if (e.elysiumModel === undefined && e.portraitModel === undefined) return true;
  const resident = e.elysiumModel ?? e.portraitModel;
  const record = s.elysiumEncounters?.[resident];
  if (!isElysiumModel(resident) || !record || e.targetId !== resident ||
      e.generated || e.kind !== "action" || e.fromLocationId !== e.locationId)
    return false;
  if (e.elysiumModel !== undefined)
    return e.portraitModel === undefined && e.verb === "talk" &&
      record.scatteredAt === e.seq;
  return e.verb === "give" && e.accepted === true && !e.handover &&
    e.itemId === elysiumModelToken(resident) &&
    record.returnedAt === e.seq && record.returnedBy === e.actorId;
}
