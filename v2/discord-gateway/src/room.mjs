import { residentIdentity } from "./identity.mjs";
import { beats, pause, repeatsOpening } from "./beats.mjs";

export const RING = 150;
const IGNORED_MS = 300000;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const IMAGE_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
const IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGES_PER_MESSAGE = 2;
const IMAGES_PER_REQUEST = 4;
const SHARES = "[shares an image]";
export const CAST_FRESH_MS = 60000;

export function createRoom(guildId, channelId) {
  return {
    guildId,
    channelId,
    webhookId: null,
    messages: [],
    handledGap: null,
    heard: 0,
    awaiting: null,
    said: {},
    world: null,
    cast: null,
    castAt: 0,
  };
}

export function castDue(room, now) {
  return Boolean(room?.world) && now - room.castAt >= CAST_FRESH_MS;
}

export function castOf(room, cast) {
  return room?.cast ?? cast;
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

function kind(attachment) {
  const declared = String(attachment?.contentType ?? "").split(";")[0].trim().toLowerCase();
  if (declared) return declared;
  const ending = /\.(png|jpe?g|webp|gif)$/i.exec(String(attachment?.name ?? ""))?.[1]?.toLowerCase();
  return ending ? `image/${ending === "jpg" ? "jpeg" : ending}` : "";
}

function discordCdn(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && IMAGE_HOSTS.has(parsed.hostname) && !parsed.port && !parsed.username && url.length <= 2048;
  } catch {
    return false;
  }
}

export function images(message) {
  const found = [];
  for (const attachment of message.attachments?.values?.() ?? []) {
    if (found.length >= IMAGES_PER_MESSAGE) break;
    const size = Number(attachment?.size);
    if (IMAGE_TYPES.has(kind(attachment)) && size > 0 && size <= IMAGE_BYTES && discordCdn(attachment.url)) found.push(attachment.url);
  }
  return found;
}

export function pictured(entries) {
  let left = IMAGES_PER_REQUEST;
  const parts = [];
  for (const entry of [...entries].reverse()) {
    const kept = (entry.images ?? []).slice(0, left);
    left -= kept.length;
    parts.unshift(kept.length ? { text: entry.text, images: kept } : { text: entry.text || (entry.images?.length ? SHARES : "") });
  }
  return parts;
}

export function record(room, message, webhookId, cast, stats = null) {
  const text = clean(message.content, 400);
  const seen = message.webhookId ? [] : images(message);
  if (!text && !seen.length) return null;
  const entry = {
    id: message.id,
    at: message.createdTimestamp ?? 0,
    text,
    replyTo: message.reference?.messageId ?? null,
  };
  if (seen.length) entry.images = seen;
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
  const speaker = addressed && room.messages.at(-1)?.resident === addressed ? { continuing: addressed } : { addressed: addressed ?? null };
  const replies = [];
  for (const entry of room.messages) {
    const last = replies.at(-1);
    if (entry.beat && last?.resident === entry.resident) replies[replies.length - 1] = { ...last, text: `${last.text} ${entry.text}` };
    else replies.push(entry);
  }
  const recent = replies.slice(-Math.max(1, config.DISCORD_CONTEXT_MESSAGES));
  const parts = pictured(recent);
  return {
    pack: config.DISCORD_PACK,
    ...(room.world ? { guild: room.guildId } : {}),
    ...speaker,
    channel: awareness(room, now),
    ...(config.DISCORD_LINE_NOTES && room.notes ? { notes: room.notes } : {}),
    messages: recent.map((entry, index) =>
      entry.resident ? { resident: entry.resident, ...parts[index] } : { author: entry.author, ...parts[index] },
    ),
  };
}

export function createStats() {
  return { replies: 0, answered: 0, ignored: 0, actions: {}, skips: {}, failures: {}, flags: {}, coordinator: {} };
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
    `ignored=${rate(stats.ignored, stats.ignored + stats.answered)}`,
    `flags=${counts(stats.flags)} coordinator=${counts(stats.coordinator)}`,
    `skips=${counts(stats.skips)} failures=${counts(stats.failures)}`,
  ].join(" ");
}

export function ownLines(room, id) {
  const posted = room.messages.filter((entry) => entry.resident === id).slice(-3).map((entry) => entry.text);
  return [...posted, ...(room.said?.[id] ?? [])];
}

export async function post(room, resident, text, { config, send, sleep, stats, log }) {
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
    const beat = index && room.messages.find((entry) => entry.id === sent?.id);
    if (beat) beat.beat = true;
  }
  room.said ??= {};
  room.said[resident.id] = [...(room.said[resident.id] ?? []), text].slice(-3);
  room.awaiting ??= at;
}
