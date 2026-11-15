const LOW_SIGNAL = new Set([
  "ok", "okay", "yes", "no", "lol", "haha", "hi", "hey", "gm", "gn", "same", "k", "ty",
]);
const PROMO = [/discord\.gg\//i, /\bairdrop\b/i, /\bpresale\b/i, /\bbuy now\b/i, /\b100x\b/i, /\bfree nitro\b/i];
const URL = /https?:\/\/\S+|www\.\S+/gi;
const QUESTION_START = /^(who|what|why|how|where|when|can|do|is|are)\b/i;

export function assess(text) {
  const clean = String(text ?? "").trim();
  const risks = [];
  const words = clean
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= 2 && words.every((word) => LOW_SIGNAL.has(word))) risks.push("low-signal");
  if (URL.test(clean) && clean.replace(URL, "").trim() === "") risks.push("url-only");
  URL.lastIndex = 0;
  if (/^[/!]/.test(clean)) risks.push("command");
  if (PROMO.some((pattern) => pattern.test(clean))) risks.push("promo");
  const question = /\?\s*$/.test(clean) || QUESTION_START.test(clean);
  return { risks, question };
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function names(text, name) {
  if (!name) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escape(name)}($|[^\\p{L}\\p{N}])`, "iu").test(text);
}

export function addressedResident(message, cast, ring = []) {
  if (!message) return null;
  if (message.replyTo) {
    const target = ring.find((entry) => entry.id === message.replyTo);
    if (target?.resident && cast.some((resident) => resident.id === target.resident)) {
      return target.resident;
    }
  }
  const found = cast.find((resident) => names(message.text ?? "", resident.name));
  return found?.id ?? null;
}

export const FOCUS_MS = 180000;

export function speaker(entry) {
  return entry.resident ? `r:${entry.resident}` : `h:${entry.authorId ?? entry.author}`;
}

export function strength(focus, at) {
  return focus ? Math.max(0, 1 - (at - focus.at) / FOCUS_MS) : 0;
}

export function focusOn(room, residentId, target, at) {
  room.focus ??= {};
  room.focus[residentId] = { target, at };
}

export function mentioned(text, cast, self) {
  return cast.find((resident) => resident.id !== self && names(text ?? "", resident.name))?.id ?? null;
}

export function addressee(messages, cast, index = messages.length - 1, focus = {}) {
  const last = messages[index];
  if (!last || last.resident) return null;
  const named = addressedResident(last, cast, messages);
  if (named) return named;
  const who = speaker(last);
  let best = null;
  let top = 0;
  for (const resident of cast) {
    const held = focus?.[resident.id];
    const power = held?.target === who ? strength(held, last.at) : 0;
    if (power > top) {
      top = power;
      best = resident.id;
    }
  }
  return best;
}

function humansSinceResident(messages) {
  let count = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].resident) break;
    count += 1;
  }
  return count;
}

export function decide(room, guildDay, now, config, cast) {
  const messages = room.messages ?? [];
  const last = messages[messages.length - 1];
  const result = (act, reason, extra = {}) => ({ act, reason, addressed: null, ambient: false, ...extra });
  if (!last) return result("wait", "empty");
  if (last.resident) return result("wait", "resident-last");
  if (last.id === room.handledGap) return result("wait", "handled");
  const { risks, question } = assess(last.text);
  if (risks.length) return result("skip", risks[0]);
  const addressed = addressee(messages, cast, messages.length - 1, room.focus);
  const quiet = now - last.at;
  const threshold = addressed ? config.DISCORD_ADDRESSED_QUIET_MS : config.DISCORD_QUIET_MS;
  if (quiet < threshold) return result("wait", "not-quiet", { addressed });
  const gap = addressed ? config.DISCORD_ADDRESSED_REPLY_GAP_MS : config.DISCORD_MIN_REPLY_GAP_MS;
  if (room.lastReplyAt && now - room.lastReplyAt < gap) {
    return result("wait", "reply-gap", { addressed });
  }
  if ((guildDay?.replies ?? 0) >= config.DISCORD_DAILY_REPLIES) {
    return result("skip", "daily-cap", { addressed });
  }
  if (addressed) return result("reply", "addressed", { addressed });
  const window = messages.slice(-config.DISCORD_DENSITY_WINDOW);
  if (window.filter((entry) => entry.resident).length >= config.DISCORD_DENSITY_MAX) {
    return result("skip", "density");
  }
  if (question) return result("reply", "question");
  if (humansSinceResident(messages) < config.DISCORD_AMBIENT_MESSAGES) {
    return result("skip", "ambient-motion");
  }
  if (room.lastAmbientAt && now - room.lastAmbientAt < config.DISCORD_AMBIENT_COOLDOWN_MS) {
    return result("skip", "ambient-cooldown");
  }
  if (quiet < config.DISCORD_AMBIENT_QUIET_MS) return result("wait", "ambient-quiet");
  return result("reply", "ambient", { ambient: true });
}
