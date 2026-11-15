import { namedIn } from "./attention.mjs";
import { awareness, pictured } from "./room.mjs";

const PEOPLE_MS = 600000;
const MOST = 8;

function seconds(now, at) {
  return Math.max(0, Math.round((now - at) / 1000));
}

function nameOf(entry, cast) {
  return entry.resident ? (cast.find((r) => r.id === entry.resident)?.name ?? entry.resident) : entry.author;
}

function window(room, config, now) {
  return room.messages.filter((entry) => now - entry.at <= config.DISCORD_DECISION_MS).slice(-config.DISCORD_DECISION_MESSAGES);
}

function candidates(recent, cast) {
  const ids = [];
  const add = (id) => id && !ids.includes(id) && cast.some((r) => r.id === id) && ids.push(id);
  for (const entry of [...recent].reverse()) {
    add(entry.resident);
    namedIn(entry.text, cast).forEach(add);
  }
  for (const resident of cast) add(resident.id);
  return ids.slice(0, MOST);
}

function people(recent, now) {
  const seen = new Map();
  for (const entry of recent) {
    if (entry.resident || now - entry.at > PEOPLE_MS) continue;
    const known = seen.get(entry.author) ?? { name: entry.author, messages: 0, talkedTo: new Set() };
    known.messages += 1;
    known.lastSeen = seconds(now, entry.at);
    seen.set(entry.author, known);
  }
  return [...seen.values()].slice(-MOST);
}

export function payload(room, config, cast, now = Date.now()) {
  const recent = window(room, config, now);
  const residents = candidates(recent, cast);
  const humans = people(recent, now);
  const parts = pictured(recent);
  const history = recent.map((entry, index) => {
    const line = entry.resident ? { resident: entry.resident } : { person: entry.author };
    const target = entry.replyTo ? room.messages.find((other) => other.id === entry.replyTo) : null;
    Object.assign(line, parts[index]);
    line.ago = seconds(now, entry.at);
    if (target) line.replyTo = nameOf(target, cast);
    const named = namedIn(entry.text, cast).map((id) => cast.find((r) => r.id === id).name);
    if (named.length) line.named = named;
    if (target && !entry.resident) humans.find((h) => h.name === entry.author)?.talkedTo.add(nameOf(target, cast));
    return line;
  });
  const seen = awareness(room, now).residents;
  const view = {};
  for (const id of residents) {
    const { lines = [], streak = 0, since } = seen.find((r) => r.id === id) ?? {};
    view[id] = { recent: lines, streak, since };
  }
  const state = {
    channel: {
      utc: new Date(now).toISOString().slice(11, 16),
      quiet: recent.length ? seconds(now, recent.at(-1).at) : null,
    },
    participants: humans.map(({ talkedTo, ...rest }) => ({ ...rest, talkedTo: [...talkedTo] })),
    residents: view,
    history,
  };
  if (room.notes) state.notes = room.notes;
  return { pack: config.DISCORD_PACK, residents, state };
}

const LIMITS = { topic: 40, goal: 120, summary: 300 };

export async function refresh(room, { config, notes, log }) {
  if (!notes || room.heard - (room.notedHeard ?? 0) < config.DISCORD_NOTES_EVERY) return;
  room.notedHeard = room.heard;
  const recent = room.messages.slice(-12);
  const parts = pictured(recent);
  const messages = recent.map((entry, index) =>
    entry.resident ? { resident: entry.resident, ...parts[index] } : { author: entry.author, ...parts[index] },
  );
  const body = { pack: config.DISCORD_PACK, messages, ...(room.notes ? { notes: room.notes } : {}) };
  const found = (await notes(body).catch(() => null))?.notes;
  const fits = (key) => typeof found?.[key] === "string" && found[key].trim() && Array.from(found[key]).length <= LIMITS[key];
  if (!Object.keys(LIMITS).every(fits)) {
    log(`notes miss guild=${room.guildId} channel=${room.channelId}`);
    return;
  }
  room.notes = { topic: found.topic, goal: found.goal, summary: found.summary };
  log(`notes update topic=${found.topic.length} goal=${found.goal.length} summary=${found.summary.length} guild=${room.guildId} channel=${room.channelId}`);
}
