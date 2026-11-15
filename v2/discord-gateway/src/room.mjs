import { addressee, decide } from "./attention.mjs";
import { today, guildState } from "./channel.mjs";
import { residentIdentity } from "./identity.mjs";
import { beats, pause, repeatsOpening, unfinished } from "./beats.mjs";

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
    nudge: null,
    heard: 0,
    halt: null,
  };
}

export function nudge(room, entry, cast, { delay, run, timers = globalThis }) {
  if (!entry || entry.resident) return false;
  calm(room, timers);
  if (room.messages.at(-1) !== entry || !addressee(room.messages, cast)) return false;
  const fire = () => {
    if (room.nudge !== armed) return;
    if (room.busy) {
      armed.timer = timers.setTimeout(fire, delay);
      return;
    }
    room.nudge = null;
    run(room);
  };
  const armed = { timer: null };
  armed.timer = timers.setTimeout(fire, delay);
  room.nudge = armed;
  return true;
}

export function calm(room, timers = globalThis) {
  if (room.nudge) timers.clearTimeout(room.nudge.timer);
  room.nudge = null;
}

function overtaken(room, messageId, residentId, cast) {
  const index = room.messages.findIndex((entry) => entry.id === messageId);
  if (index < 0) return false;
  for (let at = index + 1; at < room.messages.length; at += 1) {
    const other = addressee(room.messages, cast, at);
    if (other && other !== residentId) return true;
  }
  return false;
}

function typist(room, typing, every) {
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

export function record(room, message, webhookId, cast) {
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
    entry.author =
      clean(message.member?.displayName ?? message.author?.globalName ?? message.author?.username, 32) ||
      "Someone";
    room.heard += 1;
    room.halt?.abort();
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
  return { replies: 0, continued: 0, skips: {}, failures: {}, flags: {} };
}

function count(table, key) {
  table[key] = (table[key] ?? 0) + 1;
}

function counts(table) {
  const entries = Object.entries(table).sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? entries.map(([key, n]) => `${key}:${n}`).join(",") : "none";
}

export function summary(stats) {
  return `summary replies=${stats.replies} skips=${counts(stats.skips)} failures=${counts(stats.failures)} continued=${stats.continued} flags=${counts(stats.flags)}`;
}

async function post(room, resident, text, { config, send, sleep, stats, log }) {
  if (repeatsOpening(room.messages, resident.id, text)) {
    count(stats.flags, "repeated-opening");
    log(`flag repeated-opening resident=${resident.id} guild=${room.guildId} channel=${room.channelId}`);
  }
  const identity = residentIdentity(resident, config.ORCHESTRATOR_URL);
  const parts = beats(text, { min: config.DISCORD_BEAT_MIN_CHARS });
  for (const [index, part] of parts.entries()) {
    if (index) await sleep(pause(part));
    const sent = await send(room, {
      content: part,
      username: identity.username,
      avatarURL: identity.avatarUrl ?? undefined,
      allowedMentions: { parse: [] },
    });
    if (typeof sent?.id === "string" && !room.messages.some((entry) => entry.id === sent.id)) {
      room.messages.push({ id: sent.id, at: sent.createdTimestamp ?? 0, text: part, replyTo: null, resident: resident.id });
      if (room.messages.length > RING) room.messages.splice(0, room.messages.length - RING);
    }
  }
}

async function goOn(room, guild, first, deps) {
  const { config, lines, typing, sleep, random, stats, save } = deps;
  const heard = room.heard;
  let line = first;
  for (let extra = 0; extra < config.DISCORD_CONTINUE_MAX; extra += 1) {
    const open = unfinished(line.text);
    if (!open && random() >= config.DISCORD_CONTINUE_RATE) return;
    if (room.heard !== heard || guild.replies >= config.DISCORD_DAILY_REPLIES) return;
    const halt = new AbortController();
    room.halt = halt;
    room.busy = true;
    let stop = open ? typist(room, typing, config.DISCORD_TYPING_MS) : () => {};
    try {
      const body = requestBody(room, config, null);
      if (body.messages.at(-1)?.resident !== line.resident.id) {
        body.messages.push({ resident: line.resident.id, text: line.text });
        body.messages.splice(0, body.messages.length - Math.max(1, config.DISCORD_CONTEXT_MESSAGES));
      }
      const returned = await lines({ ...body, continuing: line.resident.id }, halt.signal);
      const next = (returned?.lines ?? []).find((found) => found?.id === line.resident.id && typeof found.text === "string" && found.text.trim());
      if (!next || halt.signal.aborted) return;
      stop();
      stop = typist(room, typing, config.DISCORD_TYPING_MS);
      await sleep(pause(next.text), halt.signal);
      if (halt.signal.aborted) return;
      await post(room, line.resident, next.text.trim(), deps);
      guild.replies += 1;
      stats.continued += 1;
      try {
        save();
      } catch {}
      line = { resident: line.resident, text: next.text.trim() };
    } catch {
      return;
    } finally {
      stop();
      if (room.halt === halt) room.halt = null;
      room.busy = false;
    }
  }
}

async function answer(room, body, messageId, deps) {
  const { cast, lines, config, typing } = deps;
  room.busy = true;
  let posted = 0;
  let spoken = null;
  let reason = null;
  let stale = false;
  const stop = typist(room, typing, config.DISCORD_TYPING_MS);
  try {
    const returned = await lines(body);
    const found = Array.isArray(returned?.lines) ? returned.lines : [];
    reason = found.length ? null : (returned?.reason ?? "empty");
    for (const line of found) {
      const resident = cast.find((candidate) => candidate.id === line?.id);
      if (!resident || typeof line.text !== "string" || !line.text.trim()) continue;
      if (!posted && overtaken(room, messageId, resident.id, cast)) {
        stale = true;
        break;
      }
      await post(room, resident, line.text.trim(), deps);
      posted += 1;
      spoken = { resident, text: line.text.trim() };
    }
    if (stale) reason = null;
    else if (!posted && !reason) reason = "no-resident";
  } catch (error) {
    reason = posted ? null : room.sending ? "send" : "error";
  } finally {
    stop();
    room.busy = false;
  }
  return { posted, reason, stale, spoken };
}

export function tick({
  rooms,
  state,
  now,
  config,
  cast,
  lines,
  send,
  typing,
  save,
  log = () => {},
  stats = createStats(),
  sleep = async () => {},
  random = () => 1,
}) {
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
    const deps = { config, cast, lines, send: send_, typing, sleep, random, stats, log, save: () => save(state) };
    running.push(
      answer(room, requestBody(room, config, decision.addressed, now), messageId, deps).then(({ posted, reason, stale, spoken }) => {
        const refund = () => {
          if (guild.day === day && guild.replies > 0) guild.replies -= 1;
          room.lastReplyAt = before.reply;
          room.lastAmbientAt = before.ambient;
        };
        if (stale) {
          count(stats.skips, "stale");
          log(`lines dropped reason=stale guild=${room.guildId} channel=${room.channelId}`);
          refund();
          try {
            save(state);
          } catch {}
          return;
        }
        if (posted || !reason) {
          stats.replies += 1;
          return spoken ? goOn(room, guild, spoken, deps) : undefined;
        }
        count(stats.failures, reason);
        log(`lines failed reason=${reason} attempt=${attempt} guild=${room.guildId} channel=${room.channelId}`);
        refund();
        if (attempt < 2) room.handledGap = before.gap;
        try {
          save(state);
        } catch {}
      }),
    );
  }
  return Promise.all(running);
}
