import {
  places,
  people,
  things,
  aims,
  nameOf,
  createWorld,
  carried,
  rootHolder,
  itemPlace,
  covered,
  shining,
  reflectionOpen,
  exits,
  matchingActions,
  legalActions,
  plan,
  play,
  setAim,
  chat,
  encodeSave,
  decodeSave,
} from "./world.mjs";

import { currentScene, sceneScript, portrait } from "./scene.mjs";

let lineIndex = null;
const $ = (id) => document.getElementById(id);
// A named table gives browser tests and local players separate save slots.
const tableName = new URLSearchParams(window.location.search).get("table");
const SAVE_KEY =
  "cosyworld.reflected-shore.v1" +
  (tableName && /^[a-z0-9-]{1,40}$/i.test(tableName) ? `.${tableName}` : "");
let world = createWorld(),
  selected = [],
  prepared = null,
  saveBlocked = false;
const paths = {
  lamp: '<path d="M18 25h28l4 29H14zM23 25v-9a9 9 0 0 1 18 0v9M12 55h40M24 47c-5-7 7-9 6-17 9 8 13 16 3 18"/>',
  oil: '<path d="M24 8h16v12l8 10v24H16V30l8-10zM24 14h16M17 35h30M32 38c-12 12-2 17 2 12 3-4-2-9-2-12z"/>',
  bell: '<path d="M12 47h40l-7-10V25a13 13 0 0 0-26 0v12zM26 49a6 6 0 0 0 12 0M29 11V6h6v5M8 23l-4-4M56 23l4-4"/>',
  cloth:
    '<path d="M10 16q19 7 41-6l4 37q-20 13-41 5zM20 19l3 31M34 18l3 31M47 15l2 29"/>',
  station:
    '<path d="M9 54V25l23-16 23 16v29M5 54h54M26 54V34h12v20M13 27h38M18 31v9M46 31v9"/>',
  attic:
    '<path d="M17 56V23a15 15 0 0 1 30 0v33zM22 51V24a10 10 0 0 1 20 0v27zM25 38l14-14M28 43l8-8"/>',
  pond: '<ellipse cx="32" cy="40" rx="26" ry="13"/><path d="M15 40q17-18 34 0-17 18-34 0zM32 32v16M21 17l2 5M43 13l-2 6M32 7v11"/>',
  vale: '<path d="M14 55l5-19 13-4 13 4 5 19zM22 20a10 10 0 1 0 20 0M16 20h32l-6-7H25l-3-5M27 38l5 8 5-8"/>',
  moth: '<path d="M30 30C1 0 2 50 27 44M34 30C63 0 62 50 37 44M27 44c-14 20 7 12 5-4 0 17 21 23 5 4M32 27v22M28 27l-6-13M36 27l6-13"/>',
  keeper:
    '<circle cx="32" cy="21" r="14"/><path d="M32 10v12l8 4M22 35l-9 22h38l-9-22M27 40v14M37 40v14"/>',
};
function art(id) {
  return `<svg viewBox="0 0 64 64" aria-hidden="true">${paths[id]}</svg>`;
}
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
try {
  const saved = localStorage.getItem(SAVE_KEY);
  if (saved) world = decodeSave(saved);
} catch (error) {
  saveBlocked = true;
  notice(error.message + " Use New game to start again.");
}
function save() {
  if (saveBlocked) return;
  try {
    localStorage.setItem(SAVE_KEY, encodeSave(world));
  } catch {
    notice(
      "This browser could not save the world. Keep this tab open to keep playing.",
    );
  }
}
function status(id) {
  if (id === "lamp")
    return `${covered(world, id) ? "Covered · " : ""}${world.items.lamp.lit ? "Burning" : "Unlit"} · ${world.items.lamp.fuel}/12 fuel`;
  if (id === "oil") return `${world.items.oil.doses} doses · +4 fuel each`;
  if (id === "bell")
    return covered(world, id)
      ? "Muffled by the cloth"
      : world.items.bell.ringing
        ? `Ringing · ${world.items.bell.ringing} turns left`
        : "Quiet · rings for 3 turns";
  return things[world.items.cloth.holder]
    ? `Covering the ${nameOf(world.items.cloth.holder)}`
    : "Blocks light and sound";
}
function locationNote(id) {
  if (id === world.actors.vale.place) return "Vale is here";
  if (exits(world, world.actors.vale.place).includes(id))
    return places[world.actors.vale.place].exits.includes(id)
      ? "Walk here · 1 turn"
      : "Cross the reflection · 1 turn";
  return "Reach it through the station";
}
function toggle(id) {
  prepared = null;
  selected = selected.includes(id)
    ? selected.filter((i) => i !== id)
    : [...selected.slice(-1), id];
  render();
}
function card(id, type) {
  const def = places[id] || people[id] || things[id];
  const el = node(
    "button",
    undefined,
    `card ${id === world.actors.vale.place ? "current" : ""} ${id === "lamp" && shining(world) ? "lit" : ""}`,
  );
  el.type = "button";
  el.dataset.card = id;
  el.setAttribute("aria-pressed", String(selected.includes(id)));
  el.setAttribute("aria-label", `${def.name}, ${type}`);
  el.append(node("span", type, "kind"));
  const graphic = node("span", undefined, "art");
  graphic.innerHTML = art(id);
  el.append(graphic);
  el.append(node("span", def.name, "name"));
  if (type === "location") {
    el.append(
      node(
        "span",
        id === "station" ? "Stairs & pond path" : "A marked reflection",
        "caption",
      ),
    );
    el.append(node("span", locationNote(id), "state"));
  } else if (type === "avatar") {
    el.append(node("span", nameOf(world.actors[id].place), "caption"));
    el.append(
      node(
        "span",
        id === "vale"
          ? aims[world.actors.vale.aim]
          : id === "moth"
            ? "Wants light at the pond"
            : "Wants quiet",
        "state",
      ),
    );
    if (id !== "vale" && world.actors[id].place !== world.actors.vale.place)
      el.classList.add("away");
  } else {
    const holder = world.items[id].holder;
    el.append(
      node(
        "span",
        holder === "vale"
          ? "In Vale’s hand"
          : people[rootHolder(world, id)]
            ? `With ${nameOf(rootHolder(world, id))}`
            : things[holder]
              ? `On the ${nameOf(holder)}`
              : "On the ground",
        "caption",
      ),
    );
    el.append(node("span", status(id), "state"));
  }
  el.addEventListener("click", () => toggle(id));
  el.draggable = true;
  el.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "link";
  });
  el.addEventListener("dragover", (e) => {
    e.preventDefault();
    el.classList.add("drag-over");
  });
  el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    const source = e.dataTransfer.getData("text/plain");
    if (
      source !== id &&
      Object.hasOwn({ ...places, ...people, ...things }, source)
    ) {
      selected = [source, id];
      prepared = null;
      render();
      $("preview").scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });
  return el;
}
function fill(id, entries, empty) {
  $(id).replaceChildren(...entries);
  if (!entries.length) $(id).append(node("p", empty, "empty"));
}
function inspect() {
  const box = $("inspection");
  box.replaceChildren();
  if (!selected.length) {
    box.append(
      node("p", "Choose a card. Pair two cards to use an item or give it."),
    );
    return;
  }
  for (const id of selected) {
    const def = places[id] || people[id] || things[id];
    const p = node("p");
    p.append(
      node("strong", `${def.name}. `),
      document.createTextNode(def.text),
    );
    box.append(p);
    if (people[id]) {
      box.append(
        node(
          "p",
          `Carries: ${carried(world, id).map(nameOf).join(", ") || "empty hands"}. Next: ${plan(world, id).reason}`,
        ),
      );
    }
    if (things[id] && world.items[id].history.length) {
      const detail = node("details");
      detail.append(node("summary", "Object memory"));
      world.items[id].history.forEach((text) => detail.append(node("p", text)));
      box.append(detail);
    }
  }
}
function renderPlay() {
  const options = matchingActions(world, selected);
  if (
    prepared &&
    !legalActions(world).some((a) => a.key === prepared.action.key)
  )
    prepared = null;
  if (!prepared && options.length === 1)
    prepared = { action: options[0], revision: world.revision };
  const labels = {
    take: "Take / uncover",
    drop: "Put down",
    give: "Give",
    ask: "Ask for it",
    light: "Light",
    snuff: "Put out",
    ring: "Ring",
    refill: "Pour oil",
    cover: "Cover",
    move: "Travel",
    talk: "Talk",
    wait: "Wait",
  };
  $("choices").replaceChildren();
  for (const action of options) {
    const button = node("button", labels[action.kind]);
    button.setAttribute(
      "aria-pressed",
      String(prepared?.action.key === action.key),
    );
    button.onclick = () => {
      prepared = { action, revision: world.revision };
      renderPlay();
    };
    $("choices").append(button);
  }
  $("preview").textContent = prepared
    ? prepared.action.text
    : options.length > 1
      ? "Choose what Vale should do with these cards."
      : selected.length
        ? "Read these cards, or choose a reachable item, avatar, or path."
        : "Choose an item, a person, or a path.";
  $("cost").textContent = prepared
    ? "1 turn · the cast acts · lit lamps burn fuel"
    : "Reading is free.";
  $("play").disabled = !prepared || saveBlocked;
}
function target(id, label, className = "") {
  const button = node("button", label, className);
  button.type = "button";
  button.dataset.card = id;
  button.setAttribute("aria-pressed", String(selected.includes(id)));
  button.onclick = () => toggle(id);
  button.addEventListener("dragover", (e) => e.preventDefault());
  button.addEventListener("drop", (e) => {
    e.preventDefault();
    const source = e.dataTransfer.getData("text/plain");
    if (Object.hasOwn(things, source)) {
      selected = [source, id];
      prepared = null;
      render();
    }
  });
  return button;
}
function renderScene() {
  const scene = currentScene(world, lineIndex);
  const img = $("backdrop");
  if (img.getAttribute("src") !== scene.background) img.src = scene.background;
  img.alt = places[scene.locationId].text;
  $("cast").replaceChildren(
    ...scene.slots.map((id) => {
      if (!id) return node("div", "", "portrait empty");
      const button = target(
        id,
        undefined,
        `portrait ${scene.activeSpeaker === id ? "active" : ""}`,
      );
      button.setAttribute("aria-label", `${nameOf(id)}, avatar`);
      const image = node("img");
      image.src = portrait(id);
      image.alt = "";
      button.append(image, node("span", nameOf(id), "portrait-name"));
      return button;
    }),
  );
  $("speaker").textContent = scene.line.speaker;
  $("line-turn").textContent = `Turn ${scene.line.turn ?? world.turn}`;
  $("dialogue-text").textContent = scene.line.text;
  const at = scene.lines.findIndex((e) => e.index === scene.line.index);
  $("previous-line").disabled = at <= 0;
  $("next-line").disabled = at >= scene.lines.length - 1;
  $("previous-line").onclick = () => {
    lineIndex = scene.lines[at - 1].index;
    renderScene();
  };
  $("next-line").onclick = () => {
    lineIndex = scene.lines[at + 1].index;
    renderScene();
  };
}
let renderedLog = [];
function renderLog() {
  const box = $("messages");
  const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  let common = 0;
  while (
    common < renderedLog.length &&
    common < world.log.length &&
    renderedLog[common] === JSON.stringify(world.log[common])
  )
    common++;
  // Preserve existing nodes so screen readers announce only new messages.
  while (box.children.length > common) box.lastChild.remove();
  for (const entry of world.log.slice(common)) {
    const item = node(
      "div",
      undefined,
      `message ${entry.speaker === "World" ? "world" : entry.speaker === "You" ? "you" : ""}`,
    );
    const by = node("div", entry.speaker, "speaker");
    by.append(node("span", `Turn ${entry.turn}`));
    item.append(by, node("p", entry.text));
    box.append(item);
  }
  renderedLog = world.log.map((e) => JSON.stringify(e));
  if (atEnd || common === 0) box.scrollTop = box.scrollHeight;
}
function render() {
  const focused = document.activeElement?.dataset.card;
  $("turn").textContent = `Turn ${world.turn}`;
  const here = world.actors.vale.place;
  $("place-title").textContent = nameOf(here);
  $("path-state").textContent = reflectionOpen(world)
    ? "The reflected path is open"
    : "Reflections open in lamplight";
  fill(
    "paths",
    exits(world, here).map((id) => {
      const button = target(id, `→ ${nameOf(id)}`);
      button.setAttribute("aria-label", `${nameOf(id)}, location`);
      return button;
    }),
  );
  fill(
    "people",
    Object.keys(people)
      .filter((id) => world.actors[id].place === here)
      .map((id) => target(id, nameOf(id))),
  );
  const visible = Object.keys(things)
    .filter((id) => itemPlace(world, id) === here)
    .sort(
      (a, b) =>
        Number(rootHolder(world, b) === "vale") -
        Number(rootHolder(world, a) === "vale"),
    );
  fill(
    "hand",
    visible.map((id) => card(id, "item")),
    "Empty hands. Explore a path to find objects.",
  );
  $("hand-count").textContent = `${carried(world, "vale").length} / 3 carried`;
  $("aim").value = world.actors.vale.aim;
  renderScene();
  $("next").disabled = saveBlocked;
  $("wait").disabled = saveBlocked;
  $("aim").disabled = saveBlocked;
  $("chat-input").disabled = saveBlocked;
  inspect();
  renderPlay();
  renderLog();
  if (focused)
    document
      .querySelector(`[data-card="${focused}"]`)
      ?.focus({ preventScroll: true });
}
Object.entries(aims).forEach(([id, text]) => {
  const opt = node("option", text);
  opt.value = id;
  $("aim").append(opt);
});
$("aim").onchange = () => {
  world = setAim(world, $("aim").value);
  lineIndex = null;
  prepared = null;
  save();
  render();
};
$("next").onclick = () => {
  const next = plan(world);
  selected = next.action.cards;
  prepared = { action: next.action, revision: world.revision };
  render();
  $("preview").scrollIntoView({ block: "nearest", behavior: "smooth" });
};
$("wait").onclick = () => {
  selected = [];
  prepared = {
    action: legalActions(world).find((a) => a.kind === "wait"),
    revision: world.revision,
  };
  render();
};
$("clear").onclick = () => {
  selected = [];
  prepared = null;
  render();
};
$("play").onclick = () => {
  if (!prepared || saveBlocked) return;
  const result = play(world, prepared.action, prepared.revision);
  if (!result.ok) {
    notice(result.error);
    prepared = null;
    render();
    return;
  }
  world = result.state;
  lineIndex = null;
  selected = [];
  prepared = null;
  save();
  render();
  $("clear").focus({ preventScroll: true });
  $("messages").scrollTop = $("messages").scrollHeight;
};
$("chat-form").onsubmit = (event) => {
  event.preventDefault();
  if (saveBlocked) return;
  const result = chat(world, $("chat-input").value);
  world = result.state;
  lineIndex = null;
  $("chat-input").blur();
  $("chat-input").value = "";
  if (result.action) {
    selected = result.action.cards;
    prepared = { action: result.action, revision: world.revision };
  } else {
    prepared = null;
    const hint = world.log.at(-1);
    if (hint?.kind === "hint") notice(hint.text);
  }
  save();
  render();
  $("messages").scrollTop = $("messages").scrollHeight;
};
$("inspect").onclick = () => {
  inspect();
  $("read-dialog").showModal();
};
$("history-button").onclick = () => {
  $("history-dialog").showModal();
  $("messages").scrollTop = $("messages").scrollHeight;
};
$("menu-button").onclick = () => $("menu-dialog").showModal();
document
  .querySelectorAll("[data-close]")
  .forEach(
    (button) => (button.onclick = () => $(button.dataset.close).close()),
  );
$("export-script").onclick = () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(sceneScript(world), null, 2)], {
      type: "application/json",
    }),
  );
  const link = node("a");
  link.href = url;
  link.download = `cosyworld-scene-turn-${world.turn}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("new-game").onclick = () => {
  $("menu-dialog").close();
  $("reset-dialog").showModal();
};
$("cancel-reset").onclick = () => $("reset-dialog").close();
$("confirm-reset").onclick = () => {
  world = createWorld();
  lineIndex = null;
  selected = [];
  prepared = null;
  saveBlocked = false;
  notice("");
  save();
  $("reset-dialog").close();
  render();
};
window.addEventListener("storage", (event) => {
  if (event.key !== SAVE_KEY || !event.newValue) return;
  try {
    world = decodeSave(event.newValue);
    lineIndex = null;
    selected = [];
    prepared = null;
    saveBlocked = false;
    notice("The world was updated in another tab.");
    render();
  } catch {
    saveBlocked = true;
    notice(
      "The save changed in another tab. Use New game to start a fresh world.",
    );
    render();
  }
});
render();
