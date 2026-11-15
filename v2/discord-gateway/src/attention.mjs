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

const WORDS = new Set(["keeper"]);

function place(text, name) {
  if (!name) return null;
  const flags = WORDS.has(name.toLowerCase()) ? "u" : "iu";
  const found = new RegExp(`(^|[^\\p{L}\\p{N}])${escape(name)}($|[^\\p{L}\\p{N}])`, flags).exec(text);
  return found ? found.index + found[1].length : null;
}

const GREETINGS = new Set(["hey", "hi", "hello", "hiya", "yo", "oh", "dear", "ok", "okay", "morning", "evening", "gm", "gn"]);

function rank(text, at, name) {
  const before = text.slice(0, at).replace(/[^\p{L}\p{N}\s]/gu, "").trim().toLowerCase();
  const after = text.slice(at + name.length);
  if (!before || GREETINGS.has(before)) return 0;
  if (/,\s*$/.test(text.slice(0, at)) && /^[\s\p{P}]*$/u.test(after)) return 1;
  if (/^\s*[,:]/.test(after)) return 2;
  return 3;
}

export function namedIn(text, cast) {
  const clean = String(text ?? "");
  return cast
    .map((resident) => ({ id: resident.id, name: resident.name, at: place(clean, resident.name) }))
    .filter((found) => found.at !== null)
    .map((found) => ({ ...found, rank: rank(clean, found.at, found.name) }))
    .sort((a, b) => a.rank - b.rank || a.at - b.at)
    .map((found) => found.id);
}

export function addressedResident(message, cast, ring = []) {
  if (!message) return null;
  if (message.replyTo) {
    const target = ring.find((entry) => entry.id === message.replyTo);
    if (target?.resident && cast.some((resident) => resident.id === target.resident)) {
      return target.resident;
    }
  }
  return namedIn(message.text, cast)[0] ?? null;
}
