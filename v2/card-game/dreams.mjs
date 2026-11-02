// Dreams are rule-made words, not model text: a few scraps of the dreamer's
// memories, a face from the scene and words from an earlier dream. The
// dreamer, the turn and a salt seed every choice, so solo play, the shared
// engine and journal replay all dream the same words from the same scene.
import { profiles } from "./memory.mjs";
import { nameOf } from "./world.mjs";

// A small, stable 32-bit mix of a key, the turn and a salt (FNV-1a).
export function roll(key, turn, salt) {
  let h = (0x811c9dc5 ^ Math.imul(turn + 1, 0x9e3779b1) ^ salt) >>> 0;
  for (const c of String(key))
    h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

const EDGE = /^[\s"'()[\],.:;!?…—-]+|[\s"'()[\],.:;!?…—-]+$/gu;
// A scrap does not trail off on a small joining word.
const TRAIL =
  /(?:\s+(?:a|an|and|at|by|for|from|in|of|on|or|over|the|to|with))+$/iu;

// Two to four consecutive words, as a dream half-remembers them.
export function fragment(text, seed) {
  const words = String(text)
    .replace(/^World: /u, "")
    .split(/\s+/u)
    .filter(Boolean);
  if (words.length < 2) return null;
  const length = Math.min(2 + (seed % 3), words.length);
  const start = (seed >>> 8) % (words.length - length + 1);
  const scrap = words
    .slice(start, start + length)
    .join(" ")
    .replace(EDGE, "")
    .replace(TRAIL, "");
  return scrap ? scrap[0].toUpperCase() + scrap.slice(1) : null;
}

// The dream for `id` at this Wait, or null when nothing has been lived yet.
export function ruleDream(context, id, life) {
  const turn = context.turn;
  const pieces = [];
  const add = (piece) => {
    const lower = piece?.toLowerCase();
    if (
      lower &&
      !pieces.some((p) => {
        const other = p.toLowerCase();
        return other.includes(lower) || lower.includes(other);
      })
    )
      pieces.push(piece);
  };
  // An earlier dream leads into the next one.
  const earlier = life?.dreams || [];
  if (earlier.length)
    add(
      fragment(
        earlier[roll(id, turn, 1) % earlier.length].text,
        roll(id, turn, 2),
      ),
    );
  const memories =
    context.entities.find((e) => e.id === id)?.memories.map((m) => m.text) ||
    [];
  for (
    let salt = 0;
    memories.length && salt < 1 + (roll(id, turn, 3) % 2);
    salt++
  ) {
    const seed = roll(id, turn, 10 + salt);
    add(fragment(memories[seed % memories.length], seed >>> 4));
  }
  // A face from the scene drifts in.
  const faces = context.entities
    .filter((e) => e.id !== id && profiles[e.id]?.kind === "avatar")
    .map((e) => e.id);
  if (faces.length && roll(id, turn, 5) % 2)
    add(nameOf(faces[roll(id, turn, 6) % faces.length]));
  if (!pieces.length) return null;
  // Drifting material arrives in no particular order.
  pieces.sort((a, b) => roll(a, turn, 4) - roll(b, turn, 4));
  return `${pieces.join(". ")}.`.slice(0, 400);
}
