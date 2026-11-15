import { wait } from "./beats.mjs";

const LIMITS = { topic: 40, goal: 120, summary: 300, owed: 32 };

function bump(stats, key) {
  stats.coordinator[key] = (stats.coordinator[key] ?? 0) + 1;
}

function valid(choice) {
  return (
    Boolean(choice) &&
    Object.entries(LIMITS).every(
      ([key, most]) => typeof choice[key] === "string" && choice[key].trim() && Array.from(choice[key]).length <= most,
    ) &&
    typeof choice.speak === "string"
  );
}

export function payload(room, config, talk) {
  const body = {
    pack: config.DISCORD_PACK,
    messages: room.messages
      .slice(-8)
      .map((entry) => (entry.resident ? { resident: entry.resident, text: entry.text } : { author: entry.author, text: entry.text })),
  };
  if (talk.notes) body.notes = talk.notes;
  return body;
}

export async function consult(room, residentId, { config, cast = [], coordinate, stats, log }, timeout) {
  const talk = room.talks?.[residentId];
  if (!talk || !coordinate) return null;
  const newest = room.messages.at(-1)?.at ?? 0;
  if (talk.notes && talk.notedAt >= newest) return talk.notes;
  const halt = new AbortController();
  let result = null;
  try {
    result = await Promise.race([coordinate(payload(room, config, talk), halt.signal), wait(timeout).then(() => null)]);
  } catch {}
  halt.abort();
  const choice = result?.choice;
  if (!valid(choice)) {
    bump(stats, "misses");
    log(`coordinator miss reason=${result?.reason ?? "timeout"} guild=${room.guildId} channel=${room.channelId}`);
    return null;
  }
  const { topic, goal, summary, owed } = choice;
  talk.notes = { topic, goal, summary, owed };
  talk.notedAt = newest;
  bump(stats, "updates");
  log(
    `coordinator update owed=${cast.find((r) => r.id === owed.trim().toLowerCase() || r.name.toLowerCase() === owed.trim().toLowerCase())?.id ?? (owed.trim().toLowerCase() === "none" ? "none" : "person")} speak=${choice.speak} topic=${topic.length} goal=${goal.length} summary=${summary.length} guild=${room.guildId} channel=${room.channelId}`,
  );
  return talk.notes;
}

export function steer(decision, notes, cast, stats) {
  if (!notes) {
    bump(stats, "fallbacks");
    return decision;
  }
  const owed = notes.owed.trim().toLowerCase();
  const resident = cast.find((candidate) => candidate.id === owed || candidate.name.toLowerCase() === owed);
  if (resident) return { ...decision, act: "reply", reason: "conversation-owed", addressed: resident.id };
  return { ...decision, act: "skip", reason: "conversation-owed-human" };
}

export function noteSoon(room, deps, timers = globalThis) {
  if (!deps.coordinate) return;
  timers.clearTimeout(room.noteTimer);
  room.noteTimer = timers.setTimeout(() => {
    const last = room.messages.at(-1);
    const id = last?.resident ?? Object.keys(room.talks ?? {}).find((key) => room.talks[key].last === last?.at);
    if (!id || room.noting) return;
    room.noting = true;
    consult(room, id, deps, deps.config.DISCORD_COORDINATE_INLINE_MS * 3)
      .catch(() => {})
      .finally(() => {
        room.noting = false;
      });
  }, deps.config.DISCORD_COORDINATE_DEBOUNCE_MS);
}
