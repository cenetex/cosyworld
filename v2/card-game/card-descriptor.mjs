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
const artwork = new WeakMap();
const nativeActions = new WeakMap();
const actionButton = (label, index) =>
  node("button", label, index ? "card-action" : "card-primary");
export const playButtonLabel = (button) =>
  nativeActions.get(button)?.label ?? button.textContent;

export function renderPlayButtons(row, actions, sentence, commit) {
  const buttons = actions.map(({ action, label, title, disabled, refused }, index) => {
    const key = JSON.stringify([action, label, title, disabled, refused, sentence]);
    const previous = row.children[index];
    const retained = nativeActions.get(previous)?.key === key;
    const button = retained
      ? previous
      : actionButton(label, index);
    if (!retained) {
      nativeActions.set(button, { key, label, shownAt: performance.now() });
      button.type = "button";
      button.dataset.action = action.kind;
      if (action.kind === "drop" && !action.item) button.dataset.destructive = "";
      button.title = title;
      button.disabled = disabled;
      if (refused) {
        button.dataset.blocked = "refused";
        button.setAttribute("aria-disabled", "true");
      }
      if (action.choiceId) {
        button.dataset.choice = action.choiceId;
        button.dataset.pack = action.packId;
      }
    }
    const { shownAt } = nativeActions.get(button);
    button.onclick = () => {
      if (button.parentElement === row) commit(action, shownAt);
    };
    return button;
  });
  updateButtons(row, buttons);
}

function updateButtons(row, buttons) {
  if (
    buttons.length !== row.children.length ||
    buttons.some((button, i) => row.children[i] !== button)
  )
    row.replaceChildren(...buttons);
}

function drawArt(cards, beat, placeArt) {
  const faces = beat.cards.map(({ src, level, color, lit, ground }) => ({
    src, level: level || null, color: color || null, lit: lit !== false,
    ground: beat.avatar && ground ? imageUrl(placeArt(ground), "card") : null,
  }));
  const key = JSON.stringify([Boolean(beat.avatar), faces]);
  if (cards.dataset.cards === "borrowed" && artwork.get(cards) === key) return;
  artwork.set(cards, key);
  // A play's beat draws its own cards again after this one.
  cards.dataset.cards = "borrowed";
  for (const image of cards.querySelectorAll("img"))
    image.removeAttribute("src");
  // A small card, grey while nobody is online in it. An avatar stands as on
  // the quest card: no tile, a drop shadow, in its place's painting feathered
  // in, under its tier's glow and level numeral.
  cards.replaceChildren(
    ...faces.map(({ src, level, color, lit, ground }) => {
      const face = node("span", "", "beat-face");
      face.dataset.lit = String(lit);
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
      if (ground) face.append(Object.assign(art("quest-ground"), { src: ground }));
      face.append(Object.assign(art("quest-figure"), { src }));
      if (level) face.append(node("span", level, "quest-level"));
      return face;
    }),
  );
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
  panel.style.removeProperty("--tier-color");
  $("selection-name").textContent = beat.name || "Card actions";
  drawArt(cards, beat, placeArt);
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
        : actionButton(label, index);
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
  updateButtons(row, buttons);
}
