// The dream's glimpse card: the arcanum the dream points to, beside the
// DREAM card, half out of the dark. Its only text is its name label.
// Presentation only: it reads the saved `actor.glimpse`.
import { arcanaCards } from "./world/catalog.mjs";
import { imageUrl } from "./images.mjs";

const CARD_BACK = "./assets/card-back.webp";
export const GLIMPSE_REVEALED = 0.5;
export const arcanumArt = (id) =>
  arcanaCards[id]?.art ? `./${arcanaCards[id].art}` : null;

export const glimpseCompanion = (glimpse) =>
  glimpse
    ? {
        kind: glimpse.kind,
        id: glimpse.id,
        art: arcanumArt(glimpse.id) ?? CARD_BACK,
        revealed: GLIMPSE_REVEALED,
      }
    : null;

export function paintGlimpse(row, companion, { artOf, nameOf }) {
  let card = row.querySelector(":scope > .glimpse-card");
  if (!companion) return card?.remove();
  const key = `${companion.kind}:${companion.id}`;
  if (card?.dataset.key === key) return;
  card ??= row.appendChild(document.createElement("figure"));
  card.className = "glimpse-card";
  card.dataset.key = key;
  card.dataset.kind = companion.kind;
  card.style.setProperty("--revealed", String(companion.revealed));
  const face = document.createElement("div");
  face.className = "glimpse-face";
  const image = document.createElement("img");
  image.alt = "";
  image.decoding = "async";
  image.src = companion.art
    ? imageUrl(companion.art, "card")
    : artOf(companion.id);
  face.append(image);
  const name = document.createElement("figcaption");
  name.className = "glimpse-name";
  name.textContent = nameOf(companion.id);
  card.replaceChildren(face, name);
}
