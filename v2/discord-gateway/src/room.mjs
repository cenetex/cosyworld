import { decide } from "./attention.mjs";
import { today, guildState } from "./channel.mjs";
import { residentIdentity } from "./identity.mjs";

export const RING = 20;

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
  };
}

function clean(text, limit) {
  const collapsed = String(text ?? "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(collapsed).slice(0, limit).join("").trim();
}

export function record(room, message, webhookId, cast) {
  const text = clean(message.content, 400);
  if (!text) return null;
  const entry = {
    id: message.id,
    at: message.createdTimestamp ?? 0,
    text,
    replyTo: message.reference?.messageId ?? null,
  };
  if (message.webhookId) {
    if (!webhookId || message.webhookId !== webhookId) return null;
    const resident = cast.find(
      (candidate) => residentIdentity(candidate, "").username === message.author?.username,
    );
    if (!resident) return null;
    entry.resident = resident.id;
  } else {
    if (message.author?.bot) return null;
    entry.author =
      clean(message.member?.displayName ?? message.author?.globalName ?? message.author?.username, 32) ||
      "Someone";
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

export function requestBody(room, config, addressed) {
  return {
    pack: config.DISCORD_PACK,
    addressed: addressed ?? null,
    messages: room.messages
      .slice(-Math.max(1, config.DISCORD_CONTEXT_MESSAGES))
      .map((entry) =>
        entry.resident ? { resident: entry.resident, text: entry.text } : { author: entry.author, text: entry.text },
      ),
  };
}

export function createStats() {
  return { replies: 0, skips: {}, failures: {} };
}

function count(table, key) {
  table[key] = (table[key] ?? 0) + 1;
}

function counts(table) {
  const entries = Object.entries(table).sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? entries.map(([key, n]) => `${key}:${n}`).join(",") : "none";
}

export function summary(stats) {
  return `summary replies=${stats.replies} skips=${counts(stats.skips)} failures=${counts(stats.failures)}`;
}

async function answer(room, body, { config, cast, lines, send }) {
  room.busy = true;
  let posted = 0;
  let reason = null;
  try {
    const returned = await lines(body);
    const found = Array.isArray(returned?.lines) ? returned.lines : [];
    reason = found.length ? null : (returned?.reason ?? "empty");
    for (const line of found) {
      const resident = cast.find((candidate) => candidate.id === line?.id);
      if (!resident || typeof line.text !== "string" || !line.text.trim()) continue;
      const identity = residentIdentity(resident, config.ORCHESTRATOR_URL);
      await send(room, {
        content: line.text,
        username: identity.username,
        avatarURL: identity.avatarUrl ?? undefined,
        allowedMentions: { parse: [] },
      });
      posted += 1;
    }
    if (!posted && !reason) reason = "no-resident";
  } catch (error) {
    reason = posted ? null : room.sending ? "send" : "error";
  } finally {
    room.busy = false;
  }
  return { posted, reason };
}

export function tick({ rooms, state, now, config, cast, lines, send, save, log = () => {}, stats = createStats() }) {
  const running = [];
  if (!cast?.length) return Promise.all(running);
  for (const room of rooms.values()) {
    if (room.busy) continue;
    const guild = guildState(state, room.guildId);
    const day = today(now);
    if (guild.day !== day) {
      guild.day = day;
      guild.replies = 0;
    }
    const decision = decide(room, guild, now, config, cast);
    if (decision.act === "wait") continue;
    log(`decision act=${decision.act} reason=${decision.reason} guild=${room.guildId} channel=${room.channelId}`);
    const messageId = room.messages.at(-1).id;
    const before = { gap: room.handledGap, reply: room.lastReplyAt, ambient: room.lastAmbientAt };
    room.handledGap = messageId;
    if (decision.act === "skip") {
      count(stats.skips, decision.reason);
      continue;
    }
    const attempt = room.attempt?.id === messageId ? room.attempt.count + 1 : 1;
    room.attempt = { id: messageId, count: attempt };
    room.lastReplyAt = now;
    if (decision.ambient) room.lastAmbientAt = now;
    guild.replies += 1;
    try {
      save(state);
    } catch {}
    const send_ = (target, payload) => {
      room.sending = true;
      return send(target, payload);
    };
    room.sending = false;
    running.push(
      answer(room, requestBody(room, config, decision.addressed), { config, cast, lines, send: send_ }).then(
        ({ posted, reason }) => {
          if (posted || !reason) {
            stats.replies += 1;
            return;
          }
          count(stats.failures, reason);
          log(`lines failed reason=${reason} attempt=${attempt} guild=${room.guildId} channel=${room.channelId}`);
          if (guild.day === day && guild.replies > 0) guild.replies -= 1;
          room.lastReplyAt = before.reply;
          room.lastAmbientAt = before.ambient;
          if (attempt < 2) room.handledGap = before.gap;
          try {
            save(state);
          } catch {}
        },
      ),
    );
  }
  return Promise.all(running);
}
