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

const BURST = 3;

export function addressee(messages, cast, index = messages.length - 1) {
  const last = messages[index];
  if (!last || last.resident) return null;
  for (let at = index; at >= 0 && at > index - BURST; at -= 1) {
    const entry = messages[at];
    if (entry.resident || entry.author !== last.author) break;
    const found = addressedResident(entry, cast, messages);
    if (found) return found;
  }
  return null;
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
  const addressed = addressee(messages, cast);
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
