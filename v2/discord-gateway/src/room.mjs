import { addressee, attend, decide, focusOn, join, mentioned, namedIn, speaker, spoke, strength } from "./attention.mjs";
import { today, guildState } from "./channel.mjs";
import { residentIdentity } from "./identity.mjs";
import { beats, pause, repeatsOpening, unfinished } from "./beats.mjs";
import { consult, responders, steer } from "./coordinator.mjs";

export const RING = 150;
const IGNORED_MS = 300000;

export function createRoom(guildId, channelId) {
  return {
    guildId,
    channelId,
    webhookId: null,
    messages: [],
    handledGap: null,
    lastReplyAt: 0,
    lastAmbientAt: 0,
    busy: false,
    attempt: null,
    sending: false,
    nudge: null,
    heard: 0,
    halt: null,
    focus: {},
    awaiting: null,
  };
}

export function typist(room, typing, every) {
  if (!typing) return () => {};
  const pulse = () => {
    try {
      Promise.resolve(typing(room)).catch(() => {});
    } catch {}
  };
  pulse();
  const timer = setInterval(pulse, Math.max(1, every));
  return () => clearInterval(timer);
}

function clean(text, limit) {
  const collapsed = String(text ?? "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(collapsed).slice(0, limit).join("").trim();
}

export function record(room, message, webhookId, cast, stats = null) {
  const text = clean(message.content, 400);
  if (!text) return null;
  const entry = {
    id: message.id,
    at: message.createdTimestamp ?? 0,
    text,
    replyTo: message.reference?.messageId ?? null,
  };
  if (room.messages.some((known) => known.id === entry.id)) return null;
  if (message.webhookId) {
    if (!webhookId || message.webhookId !== webhookId) return null;
    const resident = cast.find(
      (candidate) => residentIdentity(candidate, "").username === message.author?.username,
    );
    if (!resident) return null;
    entry.resident = resident.id;
  } else {
    if (message.author?.bot) return null;
    entry.authorId = message.author?.id ?? null;
    entry.author =
      clean(message.member?.displayName ?? message.author?.globalName ?? message.author?.username, 32) ||
      "Someone";
    room.heard += 1;
    if (room.awaiting !== null && room.awaiting !== undefined && stats) {
      if (entry.at - room.awaiting <= IGNORED_MS) stats.answered += 1;
      else stats.ignored += 1;
    }
    room.awaiting = null;
    room.halt?.abort();
    join(room, entry, cast);
  }
  room.messages.push(entry);
  if (room.messages.length > RING) room.messages.splice(0, room.messages.length - RING);
  return entry;
}

export function seed(room, messages, cast) {
  const ordered = [...messages].sort((a, b) => (a.createdTimestamp ?? 0) - (b.createdTimestamp ?? 0));
  for (const message of ordered) record(room, message, room.webhookId, cast);
  room.handledGap = room.messages.at(-1)?.id ?? null;
}

const ACTIVE_MS = 600000;

export function awareness(room, now) {
  const messages = room.messages;
  const latest = messages.at(-1);
  const before = messages.at(-2);
  const seen = new Map();
  for (const entry of messages) {
    const key = entry.resident ?? entry.author;
    if (key && now - entry.at <= ACTIVE_MS) seen.set(key, entry.at);
  }
  const active = [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([key]) => key);
  const residents = [];
  for (const id of new Set(messages.filter((entry) => entry.resident).map((entry) => entry.resident))) {
    const own = messages.filter((entry) => entry.resident === id);
    let streak = 0;
    for (const entry of [...messages].reverse()) {
      if (!entry.resident) continue;
      if (entry.resident !== id) break;
      streak += 1;
    }
    residents.push({
      id,
      lines: own.slice(-3).map((entry) => entry.text),
      streak,
      since: Math.max(0, Math.round((now - own.at(-1).at) / 1000)),
    });
  }
  const channel = { active, residents };
  if (latest && before) channel.quiet = Math.max(0, Math.round((latest.at - before.at) / 1000));
  return channel;
}

export function requestBody(room, config, addressed, now = Date.now()) {
  return {
    pack: config.DISCORD_PACK,
    addressed: addressed ?? null,
    channel: awareness(room, now),
    messages: room.messages
      .slice(-Math.max(1, config.DISCORD_CONTEXT_MESSAGES))
      .map((entry) =>
        entry.resident ? { resident: entry.resident, text: entry.text } : { author: entry.author, text: entry.text },
      ),
  };
}

export function createStats() {
  return { replies: 0, exchanges: 0, answered: 0, ignored: 0, actions: {}, skips: {}, failures: {}, flags: {}, conversation: {}, coordinator: {} };
}

function count(table, key) {
  table[key] = (table[key] ?? 0) + 1;
}

function counts(table) {
  const entries = Object.entries(table).sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? entries.map(([key, n]) => `${key}:${n}`).join(",") : "none";
}

function rate(part, whole) {
  return whole ? (part / whole).toFixed(2) : "0.00";
}

export function summary(stats) {
  const actions = stats.actions;
  const { misses = 0, updates = 0 } = stats.coordinator;
  const missed = misses - (stats.seen?.misses ?? 0);
  const warning = missed > 0 && updates === (stats.seen?.updates ?? 0) ? `coordinator all-missing misses=${missed}\n` : "";
  stats.seen = { misses, updates };
  return warning + [
    `summary replies=${stats.replies} actions=${counts(actions)}`,
    `continuation=${rate(actions.continue ?? 0, actions.speak ?? 0)}`,
    `exchanges=${stats.exchanges} ignored=${rate(stats.ignored, stats.ignored + stats.answered)}`,
    `flags=${counts(stats.flags)} conversation=${counts(stats.conversation)} coordinator=${counts(stats.coordinator)}`,
    `skips=${counts(stats.skips)} failures=${counts(stats.failures)}`,
  ].join(" ");
}

function turn(room, resident, text, toward, at, cast) {
  const other = mentioned(text, cast, resident.id);
  if (other) {
    focusOn(room, resident.id, `r:${other}`, at);
    focusOn(room, other, `r:${resident.id}`, at);
  } else if (toward) {
    focusOn(room, resident.id, toward, at);
  }
  spoke(room, resident.id, toward, at);
}

export async function post(room, resident, text, { config, cast, send, sleep, stats, log }, toward = room.focus[resident.id]?.target) {
  if (repeatsOpening(room.messages, resident.id, text)) {
    count(stats.flags, "repeated-opening");
    log(`flag repeated-opening resident=${resident.id} guild=${room.guildId} channel=${room.channelId}`);
  }
  const identity = residentIdentity(resident, config.ORCHESTRATOR_URL);
  const parts = beats(text, { min: config.DISCORD_BEAT_MIN_CHARS });
  let at = Date.now();
  for (const [index, part] of parts.entries()) {
    if (index) await sleep(pause(part));
    const sent = await send(room, {
      content: part,
      username: identity.username,
      avatarURL: identity.avatarUrl ?? undefined,
      allowedMentions: { parse: [] },
    });
    at = sent?.createdTimestamp ?? at;
    if (typeof sent?.id === "string" && !room.messages.some((entry) => entry.id === sent.id)) {
      room.messages.push({ id: sent.id, at: sent.createdTimestamp ?? 0, text: part, replyTo: null, resident: resident.id });
      if (room.messages.length > RING) room.messages.splice(0, room.messages.length - RING);
    }
  }
  turn(room, resident, text, toward, at, cast);
  room.lastLine = { resident, text };
  room.awaiting ??= at;
}
