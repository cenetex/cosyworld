// Cards named in game text are written in their card's colour: the tier
// colour of the card's level (level-tiers.mjs), the same token that colours
// its edge. Only the scene's cards match, by exact, whole-word name. A
// person's name matches as written, so an Ash, Oak, Rue or Sage never lights
// "ash" or "oak"; a thing or place matches in any case, so "the Lamp" and
// "lamp" both do. A leading article is not part of the match. Overlaps go to
// the earlier, then the longer, name.
import { splitLetters } from "./dialogue.mjs";

const ARTICLE = /^(?:the|an?) /iu;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

// cards: [{ id, name, person, color }]. Returns runs in the text's
// characters (start, end) and its reveal letters (from, to).
export function cardNameRuns(text, cards) {
  const found = [];
  for (const { id, name, person, color } of cards) {
    const core = name.replace(ARTICLE, "");
    if (core.length < 2) continue;
    const word = new RegExp(
      `(?<![\\p{L}\\p{N}])${escape(core)}(?![\\p{L}\\p{N}])`,
      person ? "gu" : "giu",
    );
    for (const match of text.matchAll(word))
      found.push({
        start: match.index,
        end: match.index + match[0].length,
        id,
        color,
      });
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const runs = [];
  for (const run of found)
    if (run.start >= (runs.at(-1)?.end ?? 0)) runs.push(run);
  if (!runs.length) return runs;
  // Letters are graphemes, so map character offsets onto letter indexes.
  const offsets = [];
  let at = 0;
  for (const letter of splitLetters(text)) {
    offsets.push(at);
    at += letter.length;
  }
  const letterAt = (offset) => {
    const index = offsets.findIndex((start) => start >= offset);
    return index < 0 ? offsets.length : index;
  };
  return runs.map((run) => ({
    ...run,
    from: letterAt(run.start),
    to: letterAt(run.end),
  }));
}

const nameRun = (color) => {
  const run = document.createElement("span");
  run.className = "card-name";
  run.style.setProperty("--tier-color", color);
  return run;
};
// Wraps the reveal's own letter spans, already in place, so its timing,
// caret and fold are unchanged.
export function nameLetters(glyphs, text, cards) {
  for (const { from, to, color } of cardNameRuns(text, cards)) {
    const run = nameRun(color);
    glyphs[from].before(run);
    run.append(...glyphs.slice(from, to));
  }
}
// The same for text shown whole: nodes to append.
export function namedText(text, cards) {
  const nodes = [];
  let at = 0;
  for (const { start, end, color } of cardNameRuns(text, cards)) {
    const run = nameRun(color);
    run.textContent = text.slice(start, end);
    nodes.push(text.slice(at, start), run);
    at = end;
  }
  nodes.push(text.slice(at));
  return nodes.filter((part) => part !== "");
}
