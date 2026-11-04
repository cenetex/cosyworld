import symbols from "./emoji-symbols.json" with { type: "json" };

export const EXPRESSION_TYPES = ["speech", "movement", "emoji"];
export const expressionOf = (profile) => profile?.expression || "speech";
// Rules 100: a symbol reads whole as a person sees it. Its presentation
// selector and skin tone are part of it, and symbols joined by zero-width
// joiners are one symbol. A cluster counts when it, or each joined part,
// is an authored symbol once tone and selector are set aside.
const SELECTOR = String.fromCodePoint(0xfe0f),
  JOINER = String.fromCodePoint(0x200d);
const bare = (text) => text.replace(/[\ufe0f\u{1f3fb}-\u{1f3ff}]/gu, "");
const named = new Map(
  Object.entries(symbols).map(([symbol, name]) => [bare(symbol), name]),
);
const orderedBare = [...named.keys()].sort((a, b) => b.length - a.length);
const TONE = /^[\u{1f3fb}-\u{1f3ff}]/u;
// One authored symbol at the start of `rest`, with its selector and tone.
function readSymbol(rest) {
  const base = orderedBare.find((value) => rest.startsWith(value));
  if (!base) return null;
  let length = base.length;
  if (rest.startsWith(SELECTOR, length)) length += 1;
  if (TONE.test(rest.slice(length))) length += 2;
  return { length, name: named.get(base) };
}
// The clusters of an emoji line, as written, with their English names.
function emojiClusters(text) {
  if (typeof text !== "string" || text.length > 160) return null;
  let rest = text.trim();
  const parts = [];
  while (rest) {
    if (parts.length === 5) return null;
    let symbol = readSymbol(rest);
    if (!symbol) return null;
    let length = symbol.length;
    const names = [symbol.name];
    while (rest.startsWith(JOINER, length)) {
      symbol = readSymbol(rest.slice(length + 1));
      if (!symbol) return null;
      length += 1 + symbol.length;
      names.push(symbol.name);
    }
    parts.push({ text: rest.slice(0, length), name: names.join(" with ") });
    rest = rest.slice(length).trimStart();
  }
  return parts.length >= 2 ? parts : null;
}

// The same authored symbols supply visible replies and their English names.
export function emojiParts(text) {
  return emojiClusters(text)?.map((part) => part.text) ?? null;
}

export function expressionLabel(profile, text) {
  if (expressionOf(profile) === "emoji") {
    const parts = emojiClusters(text);
    if (parts)
      return `${profile.name} shows ${parts.map((part) => part.name).join(", ")}.`;
  }
  return expressionOf(profile) === "movement"
    ? text
    : `${profile?.name || "A voice"}: ${text}`;
}

export const expressionKind = (profile) =>
  expressionOf(profile) === "movement" ? "narration" : "dialogue";

export function validExpression(profile, text) {
  if (expressionOf(profile) === "emoji") return Boolean(emojiParts(text));
  if (expressionOf(profile) !== "movement") return true;
  return (
    text.startsWith(`${profile.name} `) &&
    !/["“”\n]/u.test(text) &&
    !/\b(?:says?|speaks?|asks?|replies?|whispers?|shouts?|tells?|I|me|my)\b/iu.test(
      text,
    ) &&
    /^(?:lowers|raises|tilts|blinks|flicks|cocks|inclines|pricks|twitches|wags|dips|shifts|turns|rests|settles|leans|curls|stretches|tucks|sniffs|yawns|watches|looks)\b/u.test(
      text.slice(profile.name.length + 1),
    )
  );
}
