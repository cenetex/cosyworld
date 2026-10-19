import {
  createAwakening,
  decodeAwakening,
  saveKey,
  badgerImage,
  awakeningCards,
  playAwakening,
} from "./awakening-world.mjs";

const $ = (id) => document.getElementById(id);
const names = {
  player: "You",
  badger: "Grumpy Badger",
  clearing: "Forest Clearing",
};
const key = saveKey(location.search);
let world = createAwakening();
let selected = null;
let line = 0;
let saveBlocked = false;
function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function notice(text) {
  $("notice").textContent = text;
  $("notice").hidden = !text;
}
let saved;
try {
  saved = localStorage.getItem(key);
} catch {
  notice("Browser saving is unavailable. Keep this tab open to keep playing.");
}
if (saved) {
  try {
    world = decodeAwakening(saved);
  } catch {
    saveBlocked = true;
    notice("This clearing save needs a fresh start. Use New game in Menu.");
  }
}
line = world.events.length - 1;

document.body.dataset.world = "forest";
document.title = "CosyWorld · The Steam Clock";
document.querySelector(".brand span").textContent = "The Steam Clock";
$("place-title").textContent = "Forest Clearing";
$("path-state").textContent = "Beside the old Steam Clock";
const picture = node("div", undefined, "clearing-picture");
const canvas = node("div", undefined, "clearing-canvas");
const backdrop = $("backdrop");
backdrop.src = "./assets/steam-clock-background.png";
backdrop.alt =
  "An old steam clock stands on mossy stones in a sunlit forest clearing.";
const badger = node("img", undefined, "clearing-badger");
badger.id = "badger-sprite";
canvas.append(backdrop, badger);
picture.append(canvas);
$("stage").prepend(picture);
// Decode both states before the first play to keep the wake transition steady.
for (const state of ["sleeping", "grumpy"]) {
  const image = new Image();
  image.src = `./assets/badger-${state}.png`;
  image.decode().catch(() => {});
}

const menu = $("menu-dialog");
const heading = node("div", undefined, "modal-heading");
const closeMenu = node("button", "Close");
closeMenu.onclick = () => menu.close();
heading.append(node("h2", "The Steam Clock"), closeMenu);
const newGame = node("button", "New game");
newGame.id = "new-game";
newGame.onclick = () => $("reset-dialog").showModal();
const shore = node("a", "Visit the reflected shore");
const shoreUrl = new URL(location.href);
shoreUrl.searchParams.set("world", "shore");
shore.href = shoreUrl.href;
menu.replaceChildren(
  heading,
  node(
    "p",
    "Tap a card to raise it. Tap it again to play the action shown on it.",
  ),
  node(
    "p",
    "You can also drag a card into the scene. Press Escape or tap the scene to lower it.",
  ),
  node(
    "p",
    "Badger has his own feelings about your visit. Each exchange stays in History.",
  ),
  node("p", "Your clearing saves in this browser."),
  newGame,
  node("p"),
  shore,
);
$("menu-button").onclick = () => menu.showModal();
$("history-button").onclick = () => {
  $("messages").replaceChildren(
    ...world.events.map((event) => {
      const row = node("div", undefined, "message");
      row.append(
        node("strong", `${names[event.actor]} · Turn ${event.turn}`),
        node("p", event.text),
      );
      return row;
    }),
  );
  $("history-dialog").showModal();
};
for (const button of document.querySelectorAll("[data-close]")) {
  button.onclick = () => $(button.dataset.close).close();
}
$("cancel-reset").onclick = () => $("reset-dialog").close();
$("confirm-reset").onclick = () => {
  world = createAwakening();
  selected = null;
  line = 0;
  saveBlocked = false;
  notice("");
  save();
  $("reset-dialog").close();
  menu.close();
  render();
};
$("export-script").onclick = () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(world, null, 2)], { type: "application/json" }),
  );
  const link = node("a");
  link.href = url;
  link.download = `cosyworld-clearing-turn-${world.turn}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
function save() {
  if (saveBlocked) return;
  try {
    localStorage.setItem(key, JSON.stringify(world));
  } catch {
    notice(
      "Browser saving is unavailable. Keep this tab open to keep playing.",
    );
  }
}
function commit(id) {
  if (saveBlocked) return;
  const card = awakeningCards(world).find((item) => item.id === id);
  if (!card) return;
  world = playAwakening(world, card.action);
  selected = null;
  line = world.events.length - 1;
  save();
  render();
  $("hand")
    .querySelector(`[data-card="${id}"]`)
    ?.focus({ preventScroll: true });
}
function renderHand() {
  const focusId = document.activeElement?.dataset.card;
  $("hand").replaceChildren(
    ...awakeningCards(world).map((card) => {
      const frame = node("div", undefined, "card-frame");
      const raised = selected === card.id;
      frame.dataset.raised = String(raised);
      const button = node("button", undefined, `card ${card.kind}`);
      button.type = "button";
      button.dataset.card = card.id;
      button.disabled = saveBlocked;
      button.draggable = !saveBlocked;
      button.setAttribute("aria-pressed", String(raised));
      button.setAttribute("aria-label", `${card.name}, ${card.label}`);
      const art = node("span", undefined, "art");
      if (card.image) {
        const image = node("img");
        image.src = card.image;
        image.alt = "";
        art.append(image);
      } else {
        art.innerHTML =
          '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="23" r="17"/><path d="M32 11v12l8 5M21 42h22v17H21zM17 59h30"/></svg>';
      }
      button.append(
        node("span", card.kind, "kind"),
        art,
        node("span", card.name, "name"),
        node("span", card.caption, "caption"),
        node("span", card.detail, "state"),
        node(
          "span",
          `${raised ? "Play" : "Raise"} · ${card.label}`,
          "card-play",
        ),
      );
      button.onclick = () => {
        if (raised) commit(card.id);
        else {
          selected = card.id;
          $("play-readout").textContent =
            `${card.label}. Tap the raised card to play.`;
          renderHand();
        }
      };
      button.ondragstart = (event) => {
        event.dataTransfer.setData("text/plain", card.id);
        event.dataTransfer.effectAllowed = "copy";
      };
      frame.append(button);
      return frame;
    }),
  );
  if (focusId)
    $("hand")
      .querySelector(`[data-card="${focusId}"]`)
      ?.focus({ preventScroll: true });
}
function renderLine() {
  const event = world.events[line];
  $("speaker").textContent = names[event.actor];
  $("line-turn").textContent = `Turn ${event.turn}`;
  $("dialogue-text").textContent = event.text;
  $("dialogue-advance").hidden = false;
  $("dialogue-advance").setAttribute("aria-label", event.text);
  $("speech-announcement").textContent = `${names[event.actor]}: ${event.text}`;
  const prior = world.events[line - 1];
  $("prior-response").hidden = !prior || prior.turn !== event.turn;
  $("prior-speaker").textContent = prior ? names[prior.actor] : "";
  $("prior-text").textContent = prior?.text || "";
  $("previous-line").disabled = line === 0;
  $("next-line").disabled = line === world.events.length - 1;
}
function render() {
  $("turn").textContent = `Turn ${world.turn}`;
  badger.src = badgerImage(world);
  badger.alt = world.badger.awake
    ? "Grumpy Badger, awake and looking put out."
    : "Grumpy Badger, fast asleep beside the clock.";
  badger.dataset.state = world.badger.awake ? "grumpy" : "sleeping";
  renderHand();
  renderLine();
}
$("previous-line").onclick = () => {
  line = Math.max(0, line - 1);
  renderLine();
};
$("next-line").onclick = $("dialogue-advance").onclick = () => {
  line = Math.min(world.events.length - 1, line + 1);
  renderLine();
};
$("stage").onclick = (event) => {
  if (event.target.closest("button")) return;
  selected = null;
  renderHand();
};
$("stage").ondragover = (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
};
$("stage").ondrop = (event) => {
  event.preventDefault();
  commit(event.dataTransfer.getData("text/plain"));
};
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    selected = null;
    renderHand();
  }
});
window.addEventListener("storage", (event) => {
  if (event.key !== key && event.key !== null) return;
  try {
    world = event.newValue
      ? decodeAwakening(event.newValue)
      : createAwakening();
    selected = null;
    line = world.events.length - 1;
    saveBlocked = false;
    notice("");
  } catch {
    saveBlocked = true;
    notice("This clearing save needs a fresh start. Use New game in Menu.");
  }
  render();
});
render();
