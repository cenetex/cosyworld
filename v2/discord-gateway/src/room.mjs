import { addressee, attend, decide, focusOn, join, mentioned, namedIn, speaker, spoke, strength } from "./attention.mjs";
import { today, guildState } from "./channel.mjs";
import { residentIdentity } from "./identity.mjs";
import { beats, pause, repeatsOpening, unfinished } from "./beats.mjs";
import { consult, responders, steer } from "./coordinator.mjs";

export const RING = 150;
const IGNORED_MS = 300000;
const EXCHANGE_ODDS = [0.85, 0.6, 0.4, 0.25];

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

export function nudge(room, entry, cast, { delay, run, timers = globalThis }) {
  if (!entry || entry.resident) return false;
  calm(room, timers);
  if (room.messages.at(-1) !== entry || !attend(room.messages, cast, undefined, room).reason) return false;
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
    const other = addressee(room.messages, cast, at, room);
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

async function post(room, resident, text, { config, cast, send, sleep, stats, log }, toward = room.focus[resident.id]?.target) {
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

function plain(text) {
  return String(text ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function echoes(text, said) {
  const next = plain(text);
  return said.some((line) => {
    const old = plain(line);
    return old === next || (Math.min(old.length, next.length) >= 12 && (old.includes(next) || next.includes(old)));
  });
}

function partner(room, line, cast, first, invited = []) {
  const named = mentioned(line.text, cast, line.resident.id);
  if (named) return named;
  if (first) return invited.find((id) => id !== line.resident.id) ?? null;
  const held = room.focus[line.resident.id];
  return held?.target.startsWith("r:") && strength(held, Date.now()) > 0 ? held.target.slice(2) : null;
}

function opened(room, pair, config) {
  const now = Date.now();
  room.pairs ??= {};
  room.exchanges = (room.exchanges ?? []).filter((at) => now - at < 3600000);
  if (now - (room.pairs[pair] ?? -Infinity) < config.DISCORD_PAIR_COOLDOWN_MS) return false;
  if (room.exchanges.length >= config.DISCORD_EXCHANGES_PER_HOUR) return false;
  room.exchanges.push(now);
  room.pairs[pair] = now;
  return true;
}

async function exchange(room, guild, deps) {
  const { config, cast, lines, typing, sleep, random, stats, save, heard, invited } = deps;
  let line = room.lastLine;
  const said = line ? [line.text] : [];
  let pair = null;
  for (let step = 0; line && step < config.DISCORD_EXCHANGE_LINES; step += 1) {
    const target = partner(room, line, cast, step === 0, invited);
    const other = cast.find((resident) => resident.id === target);
    if (!other || random() >= (EXCHANGE_ODDS[step] ?? 0)) return;
    if (room.heard !== heard || guild.replies >= config.DISCORD_DAILY_REPLIES) return;
    if (!pair) {
      pair = [line.resident.id, other.id].sort().join("|");
      if (!opened(room, pair, config)) return;
      stats.exchanges += 1;
    }
    const halt = new AbortController();
    room.halt = halt;
    room.busy = true;
    const stop = typist(room, typing, config.DISCORD_TYPING_MS);
    try {
      const span = Math.max(0, config.DISCORD_EXCHANGE_MAX_MS - config.DISCORD_EXCHANGE_MIN_MS);
      await sleep(config.DISCORD_EXCHANGE_MIN_MS + random() * span, halt.signal);
      if (halt.signal.aborted) return;
      const body = requestBody(room, config, other.id);
      if (body.messages.at(-1)?.resident !== line.resident.id) return;
      const returned = await lines(body, halt.signal);
      const next = (returned?.lines ?? []).find((found) => found?.id === other.id && typeof found.text === "string" && found.text.trim());
      if (!next || halt.signal.aborted) return;
      if (echoes(next.text, said)) {
        count(stats.flags, "exchange-echo");
        return;
      }
      await post(room, other, next.text.trim(), deps, `r:${line.resident.id}`);
      guild.replies += 1;
      count(stats.actions, "turn-to");
      room.pairs[pair] = Date.now();
      said.push(next.text);
      line = room.lastLine;
      try {
        save();
      } catch {}
    } catch {
      return;
    } finally {
      stop();
      if (room.halt === halt) room.halt = null;
      room.busy = false;
    }
  }
}

async function follow(room, guild, extras, asked, deps) {
  const { config, cast, lines, typing, sleep, stats, save, heard } = deps;
  const said = room.lastLine ? [room.lastLine.text] : [];
  for (const id of extras) {
    const other = cast.find((resident) => resident.id === id);
    if (!other || room.heard !== heard || guild.replies >= config.DISCORD_DAILY_REPLIES) return;
    const halt = new AbortController();
    room.halt = halt;
    room.busy = true;
    const stop = typist(room, typing, config.DISCORD_TYPING_MS);
    try {
      await sleep(pause(said.at(-1) ?? ""), halt.signal);
      if (halt.signal.aborted || room.heard !== heard) return;
      const body = requestBody(room, config, id);
      if (body.messages.at(-1)?.resident === id) continue;
      const returned = await lines(body, halt.signal);
      const next = (returned?.lines ?? []).find((found) => found?.id === id && typeof found.text === "string" && found.text.trim());
      if (!next || halt.signal.aborted || room.heard !== heard) return;
      if (echoes(next.text, said)) continue;
      await post(room, other, next.text.trim(), deps, asked);
      guild.replies += 1;
      count(stats.actions, "join");
      said.push(next.text);
      try {
        save();
      } catch {}
    } catch {
      return;
    } finally {
      stop();
      if (room.halt === halt) room.halt = null;
      room.busy = false;
    }
  }
}

async function goOn(room, guild, first, deps) {
  const { config, lines, typing, sleep, random, stats, save } = deps;
  const { heard } = deps;
  let line = first;
  for (let extra = 0; extra < config.DISCORD_CONTINUE_MAX; extra += 1) {
    const open = unfinished(line.text);
    if (!open && random() >= config.DISCORD_CONTINUE_RATE) return;
    if (room.heard !== heard) return;
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
      count(stats.actions, "continue");
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
      const asked = room.messages.find((entry) => entry.id === messageId);
      await post(room, resident, line.text.trim(), deps, asked ? speaker(asked) : undefined);
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
  coordinate = null,
}) {
  const running = [];
  if (!cast?.length) return Promise.all(running);
  for (const room of rooms.values()) {
    if (room.awaiting !== null && room.awaiting !== undefined && now - room.awaiting > IGNORED_MS) {
      stats.ignored += 1;
      room.awaiting = null;
    }
    if (room.busy) continue;
    const guild = guildState(state, room.guildId);
    const day = today(now);
    if (guild.day !== day) {
      guild.day = day;
      guild.replies = 0;
    }
    const decision = decide(room, guild, now, config, cast);
    if (decision.act === "wait") continue;
    const messageId = room.messages.at(-1).id;
    const asks = ["conversation-member", "conversation-unclear"].includes(decision.reason);
    const ask = { config, cast, coordinate, stats, log };
    if (coordinate && decision.act === "reply" && asks && decision.talk) {
      room.busy = true;
      running.push(
        consult(room, ask, config.DISCORD_COORDINATE_INLINE_MS, now).then((answers) => {
          room.busy = false;
          return start(steer(decision, answers, cast, config, stats));
        }),
      );
      continue;
    }
    const later = coordinate && decision.act === "reply" && decision.addressed
      ? consult(room, ask, config.DISCORD_COORDINATE_INLINE_MS * 3, now).catch(() => null)
      : null;
    running.push(start(later ? { ...decision, later } : decision));
    function start(decision) {
    const capped = decision.reason === "daily-cap";
    if (capped && guild.capped !== day) log(`daily-cap reached guild=${room.guildId}`);
    if (capped) guild.capped = day;
    else log(`decision act=${decision.act} reason=${decision.reason} guild=${room.guildId} channel=${room.channelId}`);
    if (decision.reason?.startsWith("conversation")) count(stats.conversation, decision.reason);
    const before = { gap: room.handledGap, reply: room.lastReplyAt, ambient: room.lastAmbientAt };
    room.handledGap = messageId;
    if (decision.act === "skip") {
      count(stats.skips, decision.reason);
      count(stats.actions, "silent");
      return undefined;
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
    const invited = namedIn(room.messages.find((entry) => entry.id === messageId)?.text, cast);
    const deps = { heard: room.heard, invited, config, cast, lines, send: send_, typing, sleep, random, stats, log, save: () => save(state) };
    return (
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
          count(stats.actions, "speak");
          if (!spoken) return undefined;
          const asked = room.messages.find((entry) => entry.id === messageId);
          const joining = decision.extra
            ? Promise.resolve(decision.extra)
            : (decision.later ?? Promise.resolve(null)).then((answers) => responders(answers, config, spoken.resident.id).slice(1));
          return joining.then((extras) => {
            if (extras.length) return follow(room, guild, extras, asked ? speaker(asked) : undefined, deps);
            return goOn(room, guild, spoken, deps).then(() =>
              decision.ambient && !config.DISCORD_SELF_EXCHANGES ? undefined : exchange(room, guild, deps),
            );
          });
        }
        count(stats.failures, reason);
        log(`lines failed reason=${reason} attempt=${attempt} guild=${room.guildId} channel=${room.channelId}`);
        refund();
        if (attempt < 2) room.handledGap = before.gap;
        try {
          save(state);
        } catch {}
      })
    );
    }
  }
  return Promise.all(running);
}
