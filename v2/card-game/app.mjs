import { createNarrator } from "./narrative.mjs";
import {
  places,
  people,
  things,
  nameOf,
  createWorld,
  rootHolder,
  covered,
  shining,
  reflectionOpen,
  play,
  encodeSave,
  decodeSave,
  handStatus,
  handText,
  tradeOffers,
} from "./world.mjs";
import { currentScene, sceneScript, portrait } from "./scene.mjs";
import { availableCards, cardType, cardPlay, playLabel } from "./cards.mjs";
import {
  questPrograms,
  desireFor,
  programFor,
  levelOf,
  targetsFor,
  alternatives,
} from "./quests.mjs";
const $ = (id) => document.getElementById(id);
const tableName = new URLSearchParams(window.location.search).get("table");
const SAVE_KEY =
  "cosyworld.reflected-shore.v1" +
  (tableName && /^[a-z0-9-]{1,40}$/i.test(tableName) ? `.${tableName}` : "");
let world = createWorld(),
  selected = [],
  saveBlocked = false,
  lineIndex = null,
  selectionRevision = 0,
  dragging = [];
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
let storyStatus = "ready";
const narrator = createNarrator({
  getWorld: () => world,
  apply: (next) => {
    world = next;
    lineIndex = null;
    save();
    render();
  },
  status: (value) => {
    storyStatus = value;
    renderScene();
  },
});
function status(id) {
  if (id === "lamp")
    return `${covered(world, id) ? "Covered · " : ""}${world.items.lamp.lit ? "Burning" : "Unlit"} · ${world.items.lamp.fuel}/12 fuel`;
  if (id === "oil")
    return `${world.items.oil.doses} ${world.items.oil.doses === 1 ? "dose" : "doses"} · +4 fuel each`;
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

function choose(id) {
  if (saveBlocked) return;
  if (selected.includes(id)) {
    commit(selected, selectionRevision);
    return;
  }
  selected = selected.length >= 2 ? [id] : [...selected, id];
  selectionRevision = world.revision;
  render();
}
function commit(cards, revision) {
  if (saveBlocked) return;
  const resolved = cardPlay(world, cards);
  if (!resolved.action) {
    $("play-readout").textContent = resolved.hint;
    return;
  }
  const result = play(world, resolved.action, revision);
  if (!result.ok) {
    notice(result.error);
    selected = [];
    render();
    return;
  }
  world = result.state;
  selected = [];
  lineIndex = null;
  notice("");
  save();
  render();
  narrator.changed(resolved.action);
}
function card(id) {
  const type = cardType(id),
    def = places[id] || people[id] || things[id];
  const raised = selected.includes(id);
  const ownPlay = cardPlay(world, [id]);
  const chosen = raised ? cardPlay(world, selected) : ownPlay;
  const el = node(
    "button",
    undefined,
    `card ${type} ${id === "lamp" && shining(world) ? "lit" : ""}`,
  );
  el.type = "button";
  el.dataset.card = id;
  el.disabled = saveBlocked;
  el.setAttribute("aria-pressed", String(raised));
  el.setAttribute("aria-label", `${def.name}, ${type}`);
  el.setAttribute("aria-describedby", `card-detail-${id}`);
  el.title =
    world.memories[id].text ||
    (type === "avatar"
      ? `${def.text} ${programFor(world, id)?.name || "Next journey"}. ${handText(desireFor(world, id))}.`
      : def.text);
  el.append(
    node(
      "span",
      type === "avatar" ? `${type} · Level ${levelOf(world, id)}` : type,
      "kind",
    ),
  );
  const graphic = node("span", undefined, "art");
  if (type === "item") graphic.innerHTML = art(id);
  else {
    const img = node("img");
    img.src = `./assets/${id}.png`;
    img.alt = "";
    graphic.append(img);
  }
  el.append(graphic, node("span", def.name, "name"));
  let caption, detail;
  if (type === "item") {
    const holder = world.items[id].holder,
      owner = rootHolder(world, id);
    caption =
      holder === "vale"
        ? "Carried"
        : things[holder]
          ? `On ${nameOf(holder)}`
          : people[owner]
            ? `With ${nameOf(owner)}`
            : "On the ground";
    detail = status(id);
  } else if (type === "avatar") {
    const program = programFor(world, id),
      progress = world.actors[id].progress;
    caption = program
      ? `${program.name} · ${progress.step + 1}/${program.steps.length}`
      : "Next journey";
    detail = handText(desireFor(world, id));
  } else {
    caption = id === world.actors.vale.place ? "Here" : "A path from here";
    detail =
      id === world.actors.vale.place
        ? "Pass a turn · pair to put down"
        : "Travel · carry your items";
  }
  el.append(node("span", caption, "caption"));
  const info = node("span", detail, "state");
  info.id = `card-detail-${id}`;
  if (type === "avatar") {
    info.textContent = "";
    const target = handStatus(world, id);
    const row = (label, entries) => {
      const line = node("span", undefined, "hand-condition");
      line.append(node("span", label, "condition-label"));
      for (const entry of entries) {
        const token = node(
          "span",
          `${entry.met ? "✓" : "·"} ${entry.text}`,
          "hand-token",
        );
        token.dataset.met = String(entry.met);
        line.append(token);
      }
      info.append(line);
    };
    row(
      "Hold",
      target.items.length
        ? target.items.map((e) => ({ ...e, text: nameOf(e.id) }))
        : [{ met: true, text: "Any items" }],
    );
    row("At", [
      {
        ...target.location,
        text: target.location.id ? nameOf(target.location.id) : "Any place",
      },
    ]);
    row(
      "With",
      target.avatars.length
        ? target.avatars.map((e) => ({ ...e, text: nameOf(e.id) }))
        : [{ met: true, text: "Any company" }],
    );
    const choices = targetsFor(world, id);
    if (choices.length > 1)
      info.append(
        node(
          "span",
          `${choices.length} possible hands · Menu shows choices`,
          "trade-offers",
        ),
      );
    const offers = tradeOffers(world, id);
    if (id !== "vale")
      info.append(
        node(
          "span",
          offers.length
            ? `Offers: ${offers.map(nameOf).join(", ")}`
            : target.met
              ? "Hand complete"
              : "Seeking this hand",
          "trade-offers",
        ),
      );
  }
  el.append(info);
  const label = playLabel(chosen.action);
  el.append(
    node(
      "span",
      raised
        ? label
          ? `${label} · tap to play`
          : chosen.hint
        : playLabel(ownPlay.action) || "Combine",
      "card-play",
    ),
  );
  el.addEventListener("click", () => choose(id));
  el.draggable = true;
  el.addEventListener("dragstart", (e) => {
    dragging = selected.includes(id) ? [...selected] : [id];
    selectionRevision = world.revision;
    e.dataTransfer.setData("text/plain", JSON.stringify(dragging));
    e.dataTransfer.effectAllowed = "move";
    $("stage").dataset.play = cardPlay(world, dragging).hint;
    $("stage").classList.add("ready");
  });
  el.addEventListener("dragend", () => {
    dragging = [];
    $("stage").classList.remove("ready", "drag-over");
  });
  el.addEventListener("dragover", (e) => {
    if (dragging.length) {
      e.preventDefault();
      el.classList.add("drag-over");
    }
  });
  el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragging.length && !dragging.includes(id)) {
      selected = [dragging[0], id];
      selectionRevision = world.revision;
      render();
    }
    dragging = [];
    $("stage").classList.remove("ready", "drag-over");
  });
  return el;
}
function renderScene() {
  const scene = currentScene(world, lineIndex);
  const inspected =
    selected.length === 1 && world.memories[selected[0]]?.text
      ? selected[0]
      : null;
  const img = $("backdrop");
  if (img.getAttribute("src") !== scene.background) img.src = scene.background;
  img.alt = places[scene.locationId].text;
  $("cast").replaceChildren(
    ...scene.slots.map((id) => {
      if (!id) return node("div", "", "portrait empty");
      const button = node(
        "div",
        undefined,
        `portrait ${scene.activeSpeaker === id ? "active" : ""}`,
      );
      button.setAttribute("aria-label", nameOf(id));
      const image = node("img");
      image.src = portrait(id);
      image.alt = "";
      button.append(
        image,
        node(
          "span",
          `${nameOf(id)} · Lv ${levelOf(world, id)}`,
          "portrait-name",
        ),
      );
      return button;
    }),
  );
  $("speaker").textContent = inspected ? nameOf(inspected) : scene.line.speaker;
  $("line-turn").textContent = inspected
    ? `Turn ${world.memories[inspected].turn}`
    : storyStatus === "pending"
      ? "Finding words…"
      : storyStatus === "retry"
        ? "Story text will try again with your next play"
        : `Turn ${scene.line.turn ?? world.turn}`;
  $("dialogue-text").textContent = inspected
    ? world.memories[inspected].text
    : scene.line.text;
  const at = scene.lines.findIndex((e) => e.index === scene.line.index);
  $("previous-line").disabled = Boolean(inspected) || at <= 0;
  $("next-line").disabled = Boolean(inspected) || at >= scene.lines.length - 1;
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
  const focused = document.activeElement?.dataset.card,
    scroll = $("hand").scrollLeft;
  $("turn").textContent = `Turn ${world.turn}`;
  $("place-title").textContent = nameOf(world.actors.vale.place);
  $("path-state").textContent = reflectionOpen(world)
    ? "The reflected path is open"
    : "Reflections open in lamplight";
  $("hand").replaceChildren(...availableCards(world).map(card));
  $("hand").scrollLeft = scroll;
  $("play-readout").textContent = selected.length
    ? cardPlay(world, selected).hint
    : "";
  renderScene();
  renderLog();
  if (focused)
    document
      .querySelector(`[data-card="${focused}"]`)
      ?.focus({ preventScroll: true });
}
$("stage").addEventListener("dragover", (e) => {
  if (dragging.length) {
    e.preventDefault();
    $("stage").classList.add("drag-over");
  }
});
$("stage").addEventListener("dragleave", (e) => {
  if (!$("stage").contains(e.relatedTarget))
    $("stage").classList.remove("drag-over");
});
$("stage").addEventListener("drop", (e) => {
  e.preventDefault();
  const cards = [...dragging];
  dragging = [];
  $("stage").classList.remove("ready", "drag-over");
  if (cards.length) commit(cards, selectionRevision);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && selected.length) {
    selected = [];
    render();
  }
});
document.addEventListener("click", (e) => {
  if (
    selected.length &&
    !e.target.closest(".card") &&
    !e.target.closest("dialog")
  ) {
    selected = [];
    render();
  }
});
$("history-button").onclick = () => {
  $("history-dialog").showModal();
  $("messages").scrollTop = $("messages").scrollHeight;
};
$("menu-button").onclick = () => {
  $("quest-guide").replaceChildren(
    ...[
      ...questPrograms.vale.map((program, index) => ({
        program,
        index,
        actor: "vale",
      })),
      ...(world.actors.vale.progress.current
        ? [
            {
              actor: "vale",
              program: programFor(world, "vale"),
              index: world.actors.vale.progress.program,
            },
          ]
        : []),
      ...Object.keys(people)
        .filter((id) => id !== "vale")
        .map((actor) => ({
          actor,
          program: programFor(world, actor),
          index: world.actors[actor].progress.program,
        })),
    ].map(({ program, index, actor }) => {
      const block = node("section", undefined, "quest-guide-program");
      block.append(
        node("h3", `${nameOf(actor)} · ${program.name} · Level ${index + 2}`),
      );
      const steps = node("ol");
      for (const [i, hand] of program.steps.entries()) {
        const progress = world.actors[actor].progress;
        const done =
          progress.program > index ||
          (progress.program === index && progress.step > i);
        const current = progress.program === index && progress.step === i;
        steps.append(
          node(
            "li",
            `${done ? "✓ " : current ? "Now: " : ""}${alternatives(hand).map(handText).join(" OR ")}`,
          ),
        );
      }
      block.append(steps);
      return block;
    }),
  );
  $("menu-dialog").showModal();
};
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
  narrator.invalidate();
  world = createWorld();
  lineIndex = null;
  selected = [];
  saveBlocked = false;
  notice("");
  save();
  $("reset-dialog").close();
  render();
};
window.addEventListener("storage", (event) => {
  if (event.key !== SAVE_KEY || !event.newValue) return;
  narrator.invalidate();
  try {
    world = decodeSave(event.newValue);
    lineIndex = null;
    selected = [];
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
