// The shared card descriptor renders the same cards, words and context actions.
// Its caller owns visibility and the current play or authoring selection.
import { imageUrl } from "./images.mjs";
import { showActionBeatNote } from "./action-beat-note.mjs";
const $ = (id) => document.getElementById(id);
function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
export function renderCardDescriptor(
  beat,
  {
    placeArt = (path) => path,
    showNote = showActionBeatNote,
    showMessage,
  } = {},
) {
  const row = $("card-actions"),
    heading = document.querySelector(".action-beat-heading"),
    panel = $("action-beat"),
    cards = document.querySelector(".action-beat-cards");
  if (beat.avatar) panel.dataset.avatar = beat.avatar;
  else delete panel.dataset.avatar;
  panel.dataset.tier = "common";
  $("selection-name").textContent = beat.name || "Card actions";
  // A play's beat draws its own cards again after this one.
  cards.dataset.cards = "borrowed";
  for (const image of cards.querySelectorAll("img"))
    image.removeAttribute("src");
  // A small card, grey while nobody is online in it. An avatar stands as on
  // the quest card: no tile, a drop shadow, in its place's painting feathered
  // in, under its tier's glow and level numeral.
  cards.replaceChildren(
    ...beat.cards.map(({ src, level, color, lit, ground }) => {
      const face = node("span", "", "beat-face");
      face.dataset.lit = String(lit !== false);
      if (color) face.style.setProperty("--tier-color", color);
      const art = (className) =>
        Object.assign(node("img", undefined, className), {
          alt: "",
          draggable: false,
        });
      if (!beat.avatar) {
        face.append(Object.assign(art(), { src }));
        if (level) face.append(node("span", level, "card-level"));
        return face;
      }
      face.classList.add("quest-screen");
      if (ground)
        face.append(
          Object.assign(art("quest-ground"), {
            src: imageUrl(placeArt(ground), "card"),
          }),
        );
      face.append(Object.assign(art("quest-figure"), { src }));
      if (level) face.append(node("span", level, "quest-level"));
      return face;
    }),
  );
  heading.hidden = !beat.name;
  // An avatar's beat reads as two lines: its name, then where it is.
  if (showMessage) showMessage(heading.lastElementChild);
  else
    heading.lastElementChild.replaceChildren(
      node("strong", beat.name || ""),
      beat.info
        ? beat.avatar
          ? node("span", beat.info, "action-beat-info")
          : ` · ${beat.info}`
        : "",
    );
  const note = document.querySelector(".action-beat-note");
  showNote(note, beat);
  const buttons = beat.buttons.map((spec, index) => {
    const { label, id, run, disabled, destructive } = spec;
    const previous = row.children[index];
    const button =
      previous?.dataset.keepMenu === "true" && previous.id === (id ?? "")
        ? previous
        : node("button", label, index ? "card-action" : "card-primary");
    button.textContent = label;
    button.type = "button";
    button.id = id ?? "";
    button.dataset.keepMenu = "true";
    button.disabled = Boolean(disabled);
    if (destructive) button.dataset.destructive = "";
    else delete button.dataset.destructive;
    button.onclick = run;
    return button;
  });
  // A blur may save source text during a button press. Keep that button in
  // place through the redraw so the same press reaches its click handler.
  if (
    buttons.length !== row.children.length ||
    buttons.some((button, i) => row.children[i] !== button)
  )
    row.replaceChildren(...buttons);
}
