import { addressedResident, assess } from "./attention.mjs";
import { guildState, today } from "./channel.mjs";
import { narrates, repeatsLine, wait } from "./beats.mjs";
import { payload, refresh } from "./coordinator.mjs";
import { ownLines, post, requestBody, typist } from "./room.mjs";

function bump(table, key) {
  table[key] = (table[key] ?? 0) + 1;
}

function run(messages) {
  let count = 0;
  for (let index = messages.length - 1; index >= 0 && messages[index].resident; index -= 1) count += 1;
  return count;
}

function where(room) {
  return `guild=${room.guildId} channel=${room.channelId}`;
}

export async function next(room, { config, cast, coordinate, stats, log }, signal, turn = {}) {
  const last = room.messages.at(-1);
  const fallback = last && !last.resident ? addressedResident(last, cast, room.messages) : null;
  const halt = new AbortController();
  const stop = () => halt.abort();
  signal?.addEventListener("abort", stop);
  let result = null;
  try {
    result = await Promise.race([
      coordinate(payload(room, config, cast), halt.signal),
      wait(config.DISCORD_COORDINATE_INLINE_MS * 2).then(() => null),
    ]);
  } catch {}
  signal?.removeEventListener("abort", stop);
  halt.abort();
  const answer = result?.answers?.next;
  if (!answer || typeof answer.choice !== "string") {
    bump(stats.coordinator, "misses");
    log(`next miss reason=${result?.reason ?? "timeout"} action=${fallback ? "fallback" : "silent"} ${where(room)}`);
    return fallback;
  }
  bump(stats.coordinator, "updates");
  const odds = answer.probabilities ?? {};
  const chance = (id) => Number(odds[id] ?? (id === answer.choice ? answer.confidence : 0) ?? 0);
  const ranked = cast.map((r) => r.id).filter((id) => chance(id) > 0).sort((a, b) => chance(b) - chance(a));
  const top = ranked[0] ?? null;
  const p = top ? chance(top) : 0;
  const none = "none" in odds || answer.choice === "none" ? chance("none") : Math.max(0, 1 - ranked.reduce((sum, id) => sum + chance(id), 0));
  const floor = turn.group && turn.replies ? config.DISCORD_FOLLOW_THRESHOLD : 0;
  const who = top && none < config.DISCORD_NONE_THRESHOLD && none < p && p >= floor ? top : null;
  if (!turn.replies && ranked.filter((id) => chance(id) >= config.DISCORD_FOLLOW_THRESHOLD).length > 1) turn.group = true;
  const shown = Object.entries(odds).map(([id, q]) => `${id}:${Number(q).toFixed(2)}`).join(",") || "none";
  log(`next choice=${top ?? answer.choice} p=${p.toFixed(2)} none=${none.toFixed(2)} probs=${shown} action=${who ? "speak" : "silent"} ${where(room)}`);
  return who;
}

const GROUP = /\b(each|everyone|everybody|all of you|you all|introduce yourselves)\b/i;

async function cycle(room, deps, halt) {
  const { config, cast, lines, typing, sleep = wait, stats, log, state, save } = deps;
  const heard = room.heard;
  const asked = room.messages.findLast((entry) => !entry.resident);
  const turn = { group: GROUP.test(asked?.text ?? ""), replies: 0 };
  refresh(room, deps).catch(() => {});
  for (;;) {
    if (halt.signal.aborted || room.heard !== heard) return;
    const guild = guildState(state, room.guildId);
    const day = today(Date.now());
    if (guild.day !== day) Object.assign(guild, { day, replies: 0 });
    if (guild.replies >= config.DISCORD_DAILY_REPLIES) return bump(stats.skips, "daily-cap");
    if (run(room.messages) >= config.DISCORD_MAX_RESIDENT_RUN) return bump(stats.skips, "resident-run");
    if (turn.group && turn.replies >= config.DISCORD_GROUP_REPLIES) return bump(stats.skips, "group-cap");
    const id = await next(room, deps, halt.signal, turn);
    const resident = cast.find((candidate) => candidate.id === id);
    if (!resident || halt.signal.aborted || room.heard !== heard) {
      if (!resident) bump(stats.actions, "silent");
      return;
    }
    const stop = typist(room, typing, config.DISCORD_TYPING_MS);
    try {
      await sleep(Math.max(0, (room.lastResidentAt ?? 0) + config.DISCORD_LINE_GAP_MS - Date.now()), halt.signal);
      if (halt.signal.aborted) return;
      const returned = await lines(requestBody(room, config, id), halt.signal);
      const line = (returned?.lines ?? []).find((found) => found?.id === id && typeof found.text === "string" && found.text.trim());
      if (halt.signal.aborted || room.heard !== heard) return;
      if (!line) {
        bump(stats.failures, returned?.reason ?? "empty");
        log(`lines failed reason=${returned?.reason ?? "empty"} ${where(room)}`);
        return;
      }
      const text = line.text.trim();
      if (repeatsLine(ownLines(room, id), text)) {
        bump(stats.skips, "repeat");
        log(`skip repeat resident=${id} ${where(room)}`);
        return;
      }
      if (narrates(text, resident.name)) {
        bump(stats.skips, "narration");
        log(`skip narration resident=${id} ${where(room)}`);
        return;
      }
      await post(room, resident, text, deps);
      room.lastResidentAt = Date.now();
      guild.replies += 1;
      turn.replies += 1;
      stats.replies += 1;
      bump(stats.actions, "speak");
      save?.(state);
    } catch {
      return;
    } finally {
      stop();
    }
  }
}

export function hush(room, timers = globalThis) {
  timers.clearTimeout(room.askTimer);
  room.turn?.abort();
  room.turn = null;
}

export function heard(room, entry, deps, timers = globalThis) {
  if (!entry || entry.resident) return null;
  hush(room, timers);
  const { risks } = assess(entry.text);
  if (risks.length) {
    bump(deps.stats.skips, risks[0]);
    return null;
  }
  const halt = new AbortController();
  room.turn = halt;
  room.askTimer = timers.setTimeout(() => {
    room.turning = cycle(room, deps, halt).finally(() => {
      if (room.turn === halt) room.turn = null;
    });
  }, deps.config.DISCORD_ADDRESSED_DEBOUNCE_MS);
  return halt;
}
