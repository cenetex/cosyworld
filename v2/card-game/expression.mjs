import symbols from "./emoji-symbols.json" with { type: "json" };

export const EXPRESSION_TYPES = ["speech", "movement", "emoji"];
export const expressionOf = (profile) => profile?.expression || "speech";
const orderedSymbols = Object.keys(symbols).sort((a, b) => b.length - a.length);

// The same authored symbols supply visible replies and their English names.
export function emojiParts(text) {
  if (typeof text !== "string" || text.length > 160) return null;
  let rest = text.trim();
  const parts = [];
  while (rest) {
    const symbol = orderedSymbols.find((value) => rest.startsWith(value));
    if (!symbol || parts.length === 5) return null;
    parts.push(symbol);
    rest = rest.slice(symbol.length).trimStart();
  }
  return parts.length >= 2 ? parts : null;
}

export function expressionLabel(profile, text) {
  if (expressionOf(profile) === "emoji") {
    const parts = emojiParts(text);
    if (parts)
      return `${profile.name} shows ${parts.map((part) => symbols[part]).join(", ")}.`;
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
