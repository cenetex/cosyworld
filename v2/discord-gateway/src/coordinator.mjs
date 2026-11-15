import { wait } from "./beats.mjs";
import { namedIn, speaker, strength } from "./attention.mjs";
import { awareness } from "./room.mjs";

const PEOPLE_MS = 600000;
const MOST = 8;

function bump(stats, key) {
  stats.coordinator[key] = (stats.coordinator[key] ?? 0) + 1;
}

function seconds(now, at) {
  return Math.max(0, Math.round((now - at) / 1000));
}

function nameOf(entry, cast) {
  return entry.resident ? (cast.find((r) => r.id === entry.resident)?.name ?? entry.resident) : entry.author;
}

function window(room, config, now) {
  return room.messages.filter((entry) => now - entry.at <= config.DISCORD_DECISION_MS).slice(-config.DISCORD_DECISION_MESSAGES);
}

function candidates(room, recent, cast, now) {
  const ids = [];
  const add = (id) => id && !ids.includes(id) && cast.some((r) => r.id === id) && ids.push(id);
  for (const entry of [...recent].reverse()) {
    add(entry.resident);
    namedIn(entry.text, cast).forEach(add);
  }
  for (const [id, talk] of Object.entries(room.talks ?? {})) if (now - talk.last <= PEOPLE_MS) add(id);
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
  const residents = candidates(room, recent, cast, now);
  const humans = people(recent, now);
  const history = recent.map((entry) => {
    const line = entry.resident ? { resident: entry.resident } : { person: entry.author };
    const target = entry.replyTo ? room.messages.find((other) => other.id === entry.replyTo) : null;
    line.text = entry.text;
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
    const talk = room.talks?.[id];
    const focus = room.focus?.[id];
    view[id] = { recent: lines, streak, since, member: Boolean(talk) && now - talk.last <= config.DISCORD_TALK_MS };
    if (focus && strength(focus, now) > 0) view[id].focus = focus.target;
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
  const notes = Object.values(room.talks ?? {}).find((talk) => talk.notes)?.notes;
  if (notes) state.notes = notes;
  if (room.jev) state.previous = room.jev.answers;
  return { pack: config.DISCORD_PACK, residents, people: humans.map((h) => h.name), state };
}

function rounded(table) {
  return Object.entries(table ?? {}).map(([id, p]) => `${id}:${Number(p).toFixed(2)}`).join(",") || "none";
}

export function members(room, answers, cast, config, at) {
  const bar = config.DISCORD_JEV_THRESHOLD;
  room.talks ??= {};
  const keys = new Map(room.messages.filter((e) => !e.resident).map((e) => [e.author, speaker(e)]));
  const inside = [];
  const outside = [];
  for (const [who, p] of Object.entries(answers.members ?? {})) {
    const key = cast.some((r) => r.id === who) ? `r:${who}` : keys.get(who);
    if (!key) continue;
    if (p >= bar) inside.push(key);
    else if (p <= 1 - bar) outside.push(key);
  }
  for (const key of outside.filter((k) => k.startsWith("r:"))) delete room.talks[key.slice(2)];
  const humans = inside.filter((k) => k.startsWith("h:"));
  for (const key of inside.filter((k) => k.startsWith("r:"))) {
    const id = key.slice(2);
    const talk = room.talks[id] ?? { startedAt: at, members: [], spoke: 0 };
    const kept = talk.members.filter((m) => !outside.includes(m));
    room.talks[id] = { ...talk, members: [...new Set([...kept, ...humans])], last: Math.max(talk.last ?? 0, at) };
  }
  for (const talk of Object.values(room.talks)) talk.members = talk.members.filter((m) => !outside.includes(m));
}

export async function consult(room, { config, cast = [], coordinate, stats, log }, timeout, now = Date.now()) {
  if (!coordinate || !room.messages.length) return null;
  const newest = room.messages.at(-1).at;
  if (room.jev && room.jev.at >= newest) return room.jev.answers;
  const halt = new AbortController();
  let result = null;
  try {
    result = await Promise.race([coordinate(payload(room, config, cast, now), halt.signal), wait(timeout).then(() => null)]);
  } catch {}
  halt.abort();
  const answers = result?.answers;
  if (!answers || typeof answers !== "object") {
    bump(stats, "misses");
    log(`coordinator miss reason=${result?.reason ?? "timeout"} guild=${room.guildId} channel=${room.channelId}`);
    return null;
  }
  room.jev = { answers, at: newest };
  members(room, answers, cast, config, newest);
  bump(stats, "updates");
  const residentsOnly = Object.fromEntries(Object.entries(answers.members ?? {}).filter(([id]) => cast.some((r) => r.id === id)));
  log(
    `coordinator update owed=${answers.owed?.choice === "a person" ? "person" : (answers.owed?.choice ?? "none")} respond=${rounded(answers.respond)} members=${rounded(residentsOnly)} guild=${room.guildId} channel=${room.channelId}`,
  );
  return answers;
}

export function responders(answers, config, first = null) {
  const bar = config.DISCORD_JEV_THRESHOLD;
  const most = Math.min(3, Math.max(1, config.DISCORD_MAX_RESPONDERS));
  const ranked = Object.entries(answers?.respond ?? {})
    .filter(([id, p]) => p >= bar && id !== first)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
  return (first ? [first, ...ranked] : ranked).slice(0, most);
}

export function steer(decision, answers, cast, config, stats) {
  if (!answers) {
    bump(stats, "fallbacks");
    return decision;
  }
  const [first, ...extra] = responders(answers, config);
  if (first) return { ...decision, act: "reply", reason: "conversation-owed", addressed: first, extra };
  const owed = answers.owed;
  if (owed && owed.confidence >= config.DISCORD_JEV_THRESHOLD) {
    const resident = cast.find((candidate) => candidate.id === owed.choice);
    if (resident) return { ...decision, act: "reply", reason: "conversation-owed", addressed: resident.id, extra: [] };
    return { ...decision, act: "skip", reason: "conversation-owed-human" };
  }
  bump(stats, "fallbacks");
  return decision;
}

export function noteSoon(room, deps, timers = globalThis) {
  if (!deps.coordinate) return;
  timers.clearTimeout(room.noteTimer);
  room.noteTimer = timers.setTimeout(() => {
    if (room.noting) return;
    room.noting = true;
    consult(room, deps, deps.config.DISCORD_COORDINATE_INLINE_MS * 3)
      .catch(() => {})
      .finally(() => {
        room.noting = false;
      });
  }, deps.config.DISCORD_COORDINATE_DEBOUNCE_MS);
}
