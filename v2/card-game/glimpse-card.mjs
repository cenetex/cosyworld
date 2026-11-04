// The halfway glimpse's card (rules 99, sleep spec §5): the one aspect it
// locked, beside the DREAM card, partly shown. A place or person comes half
// out of the dark and an item lies half under the cloth; a verb shows only
// its glyph. Its only text is its name label. Presentation only: it reads
// the saved `actor.glimpse` and never touches the rules.

// The glyph each verb's beat caption uses.
export const VERB_GLYPHS = { find: "✦", give: "✋", bring: "↳", meet: "⇄" };
export const VERB_NAMES = {
  find: "Find",
  give: "Give",
  bring: "Bring",
  meet: "Meet",
};
// How much of the card shows, from 0 (dark) to 1.
export const GLIMPSE_REVEALED = 0.5;

// The DREAM card's companion for a glimpse, or null.
export const glimpseCompanion = (glimpse) =>
  glimpse
    ? { kind: glimpse.kind, id: glimpse.id, revealed: GLIMPSE_REVEALED }
    : null;

// Draws the companion into the DREAM card's row, or removes it. `artOf`
// gives an entity's card art, `nameOf` its name and `icon` a glyph's node.
export function paintGlimpse(row, companion, { artOf, nameOf, icon }) {
  let card = row.querySelector(":scope > .glimpse-card");
  if (!companion) return card?.remove();
  const key = `${companion.kind}:${companion.id}`;
  if (card?.dataset.key === key) return;
  card ??= row.appendChild(document.createElement("figure"));
  card.className = "glimpse-card";
  card.dataset.key = key;
  card.dataset.kind = companion.kind;
  card.style.setProperty("--revealed", String(companion.revealed));
  const verb = companion.kind === "verb";
  const face = document.createElement("div");
  face.className = "glimpse-face";
  if (verb) face.append(icon(VERB_GLYPHS[companion.id] ?? ""));
  else {
    const image = document.createElement("img");
    image.alt = "";
    image.decoding = "async";
    image.src = artOf(companion.id);
    face.append(image);
  }
  const name = document.createElement("figcaption");
  name.className = "glimpse-name";
  name.textContent = verb
    ? (VERB_NAMES[companion.id] ?? companion.id)
    : nameOf(companion.id);
  card.replaceChildren(face, name);
}
