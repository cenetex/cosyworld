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

async function answer(room, body, { config, cast, lines, send }) {
  room.busy = true;
  try {
    const returned = await lines(body);
    for (const line of Array.isArray(returned) ? returned : []) {
      const resident = cast.find((candidate) => candidate.id === line?.id);
      if (!resident || typeof line.text !== "string" || !line.text.trim()) continue;
      const identity = residentIdentity(resident, config.ORCHESTRATOR_URL);
      await send(room, {
        content: line.text,
        username: identity.username,
        avatarURL: identity.avatarUrl ?? undefined,
        allowedMentions: { parse: [] },
      });
    }
  } catch {
    return;
  } finally {
    room.busy = false;
  }
}

export function tick({ rooms, state, now, config, cast, lines, send, save }) {
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
    room.handledGap = room.messages.at(-1).id;
    if (decision.act === "skip") continue;
    room.lastReplyAt = now;
    if (decision.ambient) room.lastAmbientAt = now;
    guild.replies += 1;
    try {
      save(state);
    } catch {}
    running.push(answer(room, requestBody(room, config, decision.addressed), { config, cast, lines, send }));
  }
  return Promise.all(running);
}
