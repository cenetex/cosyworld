import { enableMotives } from "./motives.mjs";
import { createNarrator } from "./narrative.mjs";
import { packMedia } from "./pack-registry.mjs";
import { createRoomMusic } from "./music.mjs";
import {
  createTextReveal,
  createSpeechSounds,
  createExchange,
  waitForScene,
} from "./dialogue.mjs";
import {
  places,
  placeText,
  people,
  things,
  nameOf,
  createWorld,
  covered,
  play,
  encodeSave,
  decodeSave,
} from "./world.mjs";
import { packPlaces, packOf } from "./pack-registry.mjs";
import { variantOf } from "./pack-rules.mjs";
import {
  currentScene,
  sceneCast,
  sceneChanges,
  movementCaption,
  sceneStaging,
  portrait,
  backdrop,
  locationOverlay,
  locationVariant,
  travelCard,
} from "./scene.mjs";
import {
  availableCards,
  cardType,
  cardPlay,
  playLabel,
  avatarPlays,
  cardChoices,
  cardObservation,
} from "./cards.mjs";
import { knownActors } from "./quests.mjs";
const $ = (id) => document.getElementById(id);
const tableName = new URLSearchParams(window.location.search).get("table");
const SAVE_KEY =
  "cosyworld.reflected-shore.v1" +
  (tableName && /^[a-z0-9-]{1,40}$/i.test(tableName) ? `.${tableName}` : "");
let world = enableMotives(createWorld({ opening: true }), {
    questPrograms: true,
    personalQuests: true,
  }),
  selected = [],
  saveBlocked = false,
  lineSeq = null,
  selectionRevision = 0,
  dragging = [];
// Name the save slot: table saves are keyed off the URL param, so a player
// landing through a different link silently lands in a different slot.
{
  const slotLabel = $("table-slot");
  if (slotLabel && tableName) {
    slotLabel.hidden = false;
    slotLabel.textContent = `Saving as table "${tableName}". Without the ?table= parameter this menu shows a different saved game.`;
  }
}
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
  const media = packMedia(id);
  return media
    ? `<img src="${media}" alt="">`
    : `<svg viewBox="0 0 64 64" aria-hidden="true">${paths[id] || '<path d="M20 12h24v40H20zM25 22h14M25 30h14M25 38h10"/>'}</svg>`;
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
  if (saved)
    world = enableMotives(decodeSave(saved), {
      questPrograms: true,
      personalQuests: true,
    });
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
let storyStatus = "ready",
  storyError = "",
  renderedCast = "",
  renderedPrior = "",
  renderedHand = "",
  speechKey = null,
  speechGlyphs = [],
  shownLetters = 0,
  glyphBottoms = [],
  speechHeight = 0,
  speechScrollTarget = 0,
  speechComplete = null,
  nextSceneSeq = null,
  replay = 0,
  cardsCooling = false,
  reviewing = false,
  pendingCast = null,
  pendingSpeaker = null,
  departed = new Set();
// Release the hand if words are still on the way after this. A new play
// replaces the request, and words that arrive still play.
const HAND_WAIT = 2500;
let handTimer = null;
async function releaseHand() {
  // A slow request can be replaced by a new play. Ready dialogue owns the
  // hand through scene preparation and the last speaker's reading pause.
  const version = trip;
  await prepareScene();
  if (
    version !== trip ||
    !cardsCooling ||
    storyStatus !== "pending" ||
    !exchange.preparing
  )
    return;
  cardsCooling = false;
  updateCardCooldown();
  renderScene();
}
const completedSpeech = new Set();
const entrances = new Map();
let shownSceneLine = null;
async function prepareScene() {
  await travelShown;
  await waitForScene(
    [
      ...[$("backdrop"), ...$("cast").querySelectorAll("img")].map((image) =>
        image.decode(),
      ),
      ...entrances.values(),
    ],
    10000,
  );
}
function updateCardCooldown() {
  $("hand").dataset.cooling = String(cardsCooling);
  $("hand").setAttribute("aria-busy", String(cardsCooling));
  for (const button of $("hand").querySelectorAll("button")) {
    button.disabled = saveBlocked || cardsCooling;
    if (button.dataset.card) button.draggable = !button.disabled;
  }
}
const exchange = createExchange({
  prepare: prepareScene,
  show: (line) => {
    pendingCast = null;
    pendingSpeaker = null;
    reviewing = false;
    lineSeq = line.seq;
    renderScene();
  },
  settled: (line) => {
    if (line.departureTo) departed.add(line.actorId);
    renderScene();
  },
  busy: (value) => {
    clearTimeout(handTimer);
    cardsCooling = value;
    updateCardCooldown();
    if (value && storyStatus === "pending")
      handTimer = setTimeout(releaseHand, HAND_WAIT);
    // A failed request releases the hand as well.
    if (!value) {
      pendingCast = null;
      pendingSpeaker = null;
      renderScene();
    }
  },
});
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const speechSounds = createSpeechSounds();
let soundEnabled = true;
try {
  soundEnabled = localStorage.getItem("cosyworld.dialogue.sound") !== "off";
} catch {}
speechSounds.setEnabled(soundEnabled);
function measureSpeech() {
  const text = $("dialogue-text");
  glyphBottoms = speechGlyphs.map(
    (glyph) => glyph.offsetTop + glyph.offsetHeight,
  );
  speechHeight = text.clientHeight;
  speechScrollTarget = text.scrollTop;
}
new ResizeObserver(measureSpeech).observe($("dialogue-text"));
function updateSpeechControls(complete) {
  $("dialogue-advance").dataset.revealing = String(!complete);
  $("dialogue-advance").setAttribute(
    "aria-label",
    complete
      ? nextSceneSeq !== null
        ? "Continue to the next line"
        : exchange.current
          ? "Finish this exchange"
          : "Read this line again"
      : "Reveal the full line",
  );
  $("speech-hint").textContent = complete
    ? nextSceneSeq !== null
      ? "Continue"
      : exchange.current
        ? "Continue"
        : "Read again"
    : "Tap to reveal";
  $("next-line").disabled = complete && nextSceneSeq === null;
}
const reveal = createTextReveal({
  reduced: () => reducedMotion.matches,
  sound: (...args) => {
    if (!document.hidden) speechSounds.syllable(...args);
  },
  frame: (value) => {
    const text = $("dialogue-text");
    if (speechKey !== value.key) {
      speechKey = value.key;
      shownLetters = 0;
      speechComplete = null;
      text.scrollTop = 0;
      speechSounds.stop();
      speechGlyphs = value.letters.map((letter) =>
        node("span", letter, "speech-letter"),
      );
      text.replaceChildren(...speechGlyphs);
      measureSpeech();
      $("speech-announcement").textContent = "";
    }
    speechGlyphs[Math.max(0, shownLetters - 1)]?.classList.remove("cursor");
    for (let i = shownLetters; i < value.shown; i++)
      speechGlyphs[i].classList.add("revealed");
    shownLetters = value.shown;
    const cursor = speechGlyphs[Math.max(0, shownLetters - 1)];
    cursor?.classList.add("cursor");
    if (speechComplete !== value.complete) {
      speechComplete = value.complete;
      updateSpeechControls(value.complete);
    }
    // Layout is measured once per line or resize, then reused for each letter.
    const bottom = glyphBottoms[Math.max(0, shownLetters - 1)] || 0;
    if (!value.complete && bottom > speechScrollTarget + speechHeight) {
      speechScrollTarget = bottom - speechHeight;
      text.scrollTo({
        top: speechScrollTarget,
        behavior: reducedMotion.matches ? "instant" : "smooth",
      });
    }
    if (value.complete) {
      $("speech-announcement").textContent =
        `${nameOf(value.speaker)}: ${value.text}`;
      $("next-line").disabled = nextSceneSeq === null;
      completedSpeech.add(value.key);
      if (completedSpeech.size > 100)
        completedSpeech.delete(completedSpeech.values().next().value);
      if (shownSceneLine)
        exchange.revealed(shownSceneLine.seq, value.text, value.instant);
    }
  },
});
reducedMotion.addEventListener("change", () => {
  if (reducedMotion.matches) {
    reveal.finish();
    speechSounds.stop();
  }
});
function pauseSpeech() {
  const paused =
    document.hidden || Boolean(document.querySelector("dialog[open]"));
  reveal.pause(paused);
  exchange.pause(paused);
  if (paused) speechSounds.stop();
}
document.addEventListener("visibilitychange", pauseSpeech);
document.addEventListener("pointerdown", () => speechSounds.unlock(), {
  capture: true,
});
document.addEventListener("keydown", () => speechSounds.unlock(), {
  capture: true,
});
function updateSoundButton() {
  $("speech-sound").textContent =
    `Voice sounds: ${soundEnabled ? "on" : "off"}`;
  $("speech-sound").setAttribute("aria-pressed", String(soundEnabled));
}
$("speech-sound").onclick = () => {
  soundEnabled = !soundEnabled;
  speechSounds.setEnabled(soundEnabled);
  if (soundEnabled) speechSounds.unlock();
  try {
    localStorage.setItem(
      "cosyworld.dialogue.sound",
      soundEnabled ? "on" : "off",
    );
  } catch {}
  updateSoundButton();
};
updateSoundButton();
let musicEnabled = true,
  musicVolume = 0.3;
try {
  const saved = JSON.parse(localStorage.getItem("cosyworld.room-music"));
  if (typeof saved?.enabled === "boolean") musicEnabled = saved.enabled;
  if (Number.isFinite(saved?.volume))
    musicVolume = Math.max(0, Math.min(1, saved.volume));
} catch {}
const music = createRoomMusic({
  audio: $("room-music"),
  changed: ({ enabled, started, title, playing, failed }) => {
    $("music-toggle").textContent = `Music: ${enabled ? "on" : "off"}`;
    $("music-toggle").setAttribute("aria-pressed", String(enabled));
    $("music-status").textContent = !enabled
      ? "Music paused"
      : !started
        ? "Play your first card to start music."
        : failed
          ? "Music is taking a moment. Switch it off and on to retry."
          : playing
            ? title
            : "Tap or press a key to start music.";
  },
});
music.setEnabled(musicEnabled);
music.setVolume(musicVolume);
music.setHidden(document.hidden);
music.setStarted(world.turn > 0);
$("music-volume").value = String(Math.round(musicVolume * 100));
function saveMusicSettings() {
  try {
    localStorage.setItem(
      "cosyworld.room-music",
      JSON.stringify({ enabled: musicEnabled, volume: musicVolume }),
    );
  } catch {}
}
$("music-toggle").onclick = () => {
  musicEnabled = !musicEnabled;
  music.setEnabled(musicEnabled);
  if (musicEnabled) music.unlock();
  saveMusicSettings();
};
$("music-volume").oninput = (event) => {
  musicVolume = Number(event.target.value) / 100;
  music.setVolume(musicVolume);
  saveMusicSettings();
};
document.addEventListener("pointerdown", () => music.unlock(), {
  capture: true,
});
document.addEventListener("keydown", () => music.unlock(), { capture: true });
document.addEventListener("visibilitychange", () =>
  music.setHidden(document.hidden),
);
window.addEventListener("pagehide", () => music.setHidden(true));
window.addEventListener("pageshow", () => music.setHidden(document.hidden));
const narrator = createNarrator({
  getWorld: () => world,
  started: (context) => {
    pendingSpeaker = context.speakers[0] || null;
    renderScene();
  },
  apply: (next) => {
    world = next;
    storyStatus = "ready";
    save();
    const lines = world.log.filter(
      (entry) =>
        entry.generated &&
        entry.kind === "dialogue" &&
        entry.turn === world.turn &&
        entry.locationId === world.actors.vale.place,
    );
    exchange.load(lines);
    render();
  },
  status: (value, error) => {
    storyStatus = value;
    storyError = error?.message || "Dialogue is unavailable.";
    if (value === "pending" && !exchange.active) exchange.begin();
    if (value === "retry") exchange.cancel();
    renderScene();
  },
});
$("story-retry").onclick = () => narrator.retry();
function choose(id) {
  if (saveBlocked || cardsCooling) return;
  selected = selected.includes(id)
    ? selected.filter((cardId) => cardId !== id)
    : selected.length >= 2
      ? [id]
      : [...selected, id];
  selectionRevision = world.revision;
  render();
  $("hand")
    .querySelector(`[data-card="${id}"]`)
    ?.closest(".card-frame")
    ?.scrollIntoView({ block: "nearest", inline: "nearest" });
}
function commit(cards, revision) {
  if (saveBlocked || cardsCooling) return;
  const resolved = cardPlay(world, cards);
  if (!resolved.action) {
    $("play-readout").textContent = "That cannot be used here.";
    return;
  }
  commitAction(resolved.action, revision);
}
function commitAction(action, revision) {
  if (saveBlocked || cardsCooling) return;
  const result = play(world, action, revision);
  if (!result.ok) {
    notice(result.error);
    selected = [];
    render();
    return;
  }
  reveal.finish();
  speechSounds.stop();
  cancelTravel();
  // Manipulating an object needs no automatic speech or tutorial recap.
  const speak = [
    "talk",
    "ask",
    "give",
    "trade",
    "accompany",
    "threaten",
    "attack",
    "choose",
    "move",
    "ring",
  ].includes(action.kind);
  narrator.invalidate();
  exchange.cancel();
  storyStatus = speak ? "pending" : "ready";
  const from = world.actors.vale.place;
  world = result.state;
  music.setRoom(world.actors.vale.place);
  music.setStarted(world.turn > 0);
  music.unlock();
  // A new play ends any review of earlier lines.
  reviewing = false;
  dragging = [];
  $("stage").classList.remove("ready", "drag-over");
  departed.clear();
  const visible = [
    ...new Set([
      ...Object.keys(people).filter(
        (id) =>
          knownActors(world).includes(id) &&
          world.actors[id].place === world.actors.vale.place,
      ),
      ...sceneChanges(world)
        .filter((change) => change.leaving)
        .map((change) => change.actorId),
    ]),
  ];
  pendingCast = speak ? sceneCast(world, world.log.length - 1, visible) : null;
  if (speak) exchange.begin();
  selected = [];
  lineSeq = null;
  notice("");
  save();
  if (world.actors.vale.place !== from)
    travel(world.actors.vale.place, render, render);
  else {
    render();
  }
  if (speak) narrator.changed(action);
}

// Moving between places dips the scene to dark with the destination's name,
// so a change of place is always seen, whatever caused it. The new place is
// drawn only once the veil is fully down, and the veil lifts only once the new
// backdrop and portraits have loaded, so the swap is never seen.
const TRAVEL_COVER = 400,
  TRAVEL_HOLD = 700,
  TRAVEL_WAIT = 4000;
let covering = false,
  trip = 0,
  travelShown = Promise.resolve(),
  revealTravel = () => {};
function cancelTravel() {
  trip++;
  covering = false;
  revealTravel();
  travelShown = Promise.resolve();
  $("travel").classList.remove("travelling");
  for (const figure of $("cast").children) {
    figure.classList.remove("entering");
    for (const animation of figure
      .querySelector(".portrait-body")
      .getAnimations())
      animation.cancel();
  }
  entrances.clear();
}
// Cards met at the new place are unveiled once the veil has fully lifted.
function travel(place, arrive, landed) {
  const veil = $("travel");
  $("travel-name").textContent = nameOf(place);
  if (reducedMotion.matches) {
    arrive();
    landed();
    return;
  }
  const mine = ++trip;
  travelShown = new Promise((resolve) => {
    revealTravel = resolve;
  });
  covering = true;
  veil.classList.add("travelling");
  setTimeout(async () => {
    if (mine !== trip) return;
    covering = false;
    arrive();
    const images = [$("backdrop"), ...$("cast").querySelectorAll("img")];
    await Promise.race([
      Promise.all([
        new Promise((done) => setTimeout(done, TRAVEL_HOLD)),
        ...images.map((img) => img.decode().catch(() => {})),
      ]),
      new Promise((done) => setTimeout(done, TRAVEL_WAIT)),
    ]);
    if (mine !== trip) return;
    veil.classList.remove("travelling");
    setTimeout(() => {
      if (mine !== trip) return;
      revealTravel();
      landed();
    }, TRAVEL_COVER);
  }, TRAVEL_COVER);
}

const figures = new Map();
function frameFigure(img) {
  const apply = (f) => {
    img.style.setProperty("--figure-top", f.top);
    img.style.setProperty("--figure-height", f.height);
    img.style.setProperty("--head-x", f.headX);
  };
  const measure = () => {
    if (!figures.has(img.src)) {
      const w = 48,
        h = Math.round((w * img.naturalHeight) / img.naturalWidth) || w;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(img, 0, 0, w, h);
      let alpha;
      try {
        alpha = context.getImageData(0, 0, w, h).data;
      } catch {
        return;
      }
      const solid = (x, y) => alpha[(y * w + x) * 4 + 3] > 40;
      const rows = [];
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          if (solid(x, y)) {
            rows.push(y);
            break;
          }
      if (!rows.length) return;
      const top = rows[0],
        bottom = rows.at(-1) + 1,
        head = top + Math.max(1, Math.round((bottom - top) * 0.15));
      let left = w,
        right = 0;
      for (let y = top; y < head; y++)
        for (let x = 0; x < w; x++)
          if (solid(x, y)) {
            left = Math.min(left, x);
            right = Math.max(right, x + 1);
          }
      figures.set(img.src, {
        top: top / h,
        height: (bottom - top) / h,
        headX: (left + right) / 2 / w,
      });
    }
    apply(figures.get(img.src));
  };
  if (img.complete && img.naturalWidth) measure();
  else img.addEventListener("load", measure, { once: true });
}
function showCardChoices(id, choices, revision) {
  const dialog = node("dialog", undefined, "card-choices");
  const heading = node("h2", nameOf(id));
  heading.id = "card-choice-heading";
  dialog.setAttribute("aria-labelledby", heading.id);
  const options = node("div", undefined, "card-choice-list");
  for (const action of choices) {
    const button = node("button", playLabel(action));
    button.type = "button";
    if (action.choiceId) {
      button.dataset.choice = action.choiceId;
      button.dataset.pack = action.packId;
    }
    button.onclick = () => {
      dialog.close();
      commitAction(action, revision);
    };
    options.append(button);
  }
  const close = node("button", "Keep looking");
  close.type = "button";
  close.onclick = () => dialog.close();
  dialog.append(heading, options, close);
  dialog.addEventListener(
    "close",
    () => {
      dialog.remove();
      pauseSpeech();
    },
    { once: true },
  );
  document.body.append(dialog);
  dialog.showModal();
  pauseSpeech();
}
function card(id) {
  const type = cardType(id),
    base = places[id] || people[id] || things[id],
    crossingFace = type === "location" ? travelCard(world, id) : null,
    def = crossingFace ? { ...base, name: crossingFace.name } : base;
  const raised = selected.includes(id);
  const chosen = raised ? cardPlay(world, selected) : null;
  const el = node("button", undefined, `card ${type}`);
  el.type = "button";
  el.dataset.card = id;
  el.disabled = saveBlocked || cardsCooling;
  el.setAttribute("aria-pressed", String(raised));
  el.setAttribute("aria-label", `${def.name}, ${type}`);
  el.setAttribute("aria-describedby", `card-detail-${id}`);
  const graphic = node("span", undefined, "art");
  const img = node("img");
  img.src =
    type === "item"
      ? packMedia(id, "art") || `./assets/${id}-card.png`
      : type === "avatar"
        ? portrait(id, null, world)
        : crossingFace?.art || backdrop(id);
  img.alt = "";
  img.draggable = false;
  if (type === "avatar") frameFigure(img);
  graphic.append(img);
  if (type === "location") {
    el.dataset.locationVariant = locationVariant(world, id);
    const src = locationOverlay(world, id);
    if (src) {
      const overlay = node("img", undefined, "location-overlay");
      overlay.src = src;
      overlay.alt = "";
      graphic.append(overlay);
    }
  }
  if (type === "item") {
    const item = world.items[id];
    // Observable physical states, never fuel arithmetic or puzzle progress.
    if (typeof item.lit === "boolean") el.dataset.lit = String(item.lit);
    if (typeof item.ringing === "number")
      el.dataset.ringing = String(item.ringing > 0 && !covered(world, id));
    const covering = Object.keys(world.items).find(
      (other) => world.items[other].holder === id,
    );
    if (covering) {
      el.dataset.covered = "true";
      const cloth = node("img", undefined, "object-cover");
      cloth.src = packMedia(covering, "art") || `./assets/${covering}-card.png`;
      cloth.alt = "";
      graphic.append(cloth);
    }
  }
  const label = playLabel(chosen?.action);
  const observation = node("span", cardObservation(world, id), "sr-only");
  observation.id = `card-detail-${id}`;
  if (raised && label) observation.textContent += ` ${label}.`;
  el.append(graphic, node("span", def.name, "name"), observation);
  el.addEventListener("click", () => choose(id));
  el.draggable = !el.disabled;
  el.addEventListener("dragstart", (e) => {
    if (cardsCooling || saveBlocked) {
      e.preventDefault();
      return;
    }
    dragging = selected.includes(id) ? [...selected] : [id];
    selectionRevision = world.revision;
    e.dataTransfer.setData("text/plain", JSON.stringify(dragging));
    e.dataTransfer.effectAllowed = "move";
    $("stage").dataset.play = playLabel(cardPlay(world, dragging).action) || "";
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
    if (
      !cardsCooling &&
      !saveBlocked &&
      dragging.length &&
      !dragging.includes(id)
    ) {
      selected = [dragging[0], id];
      selectionRevision = world.revision;
      render();
    }
    dragging = [];
    $("stage").classList.remove("ready", "drag-over");
  });
  const frame = node("div", undefined, "card-frame");
  frame.dataset.raised = String(raised);
  frame.append(el);
  if (raised) {
    const options = node("div", undefined, "card-options");
    const revision = world.revision;
    const primary = chosen?.action;
    if (primary) {
      const button = node("button", playLabel(primary), "card-primary");
      button.type = "button";
      button.disabled = saveBlocked || cardsCooling;
      button.setAttribute("aria-label", `${playLabel(primary)} · ${def.name}`);
      button.onclick = (event) => {
        event.stopPropagation();
        commitAction(primary, revision);
      };
      options.append(button);
    }
    if (selected.length === 1) {
      const choices = cardChoices(world, id);
      const plays =
        type === "avatar"
          ? avatarPlays(world, id).filter((a) => a.kind !== primary?.kind)
          : [];
      if (choices.length || plays.length) {
        const button = node("button", "···", "card-more");
        button.type = "button";
        button.dataset.choicesFor = id;
        button.setAttribute("aria-label", `More actions · ${def.name}`);
        button.disabled = saveBlocked || cardsCooling;
        button.onclick = (event) => {
          event.stopPropagation();
          showCardChoices(id, [...choices, ...plays], revision);
        };
        options.append(button);
      }
    }
    frame.append(options);
  }
  return frame;
}
function renderStage(locationId) {
  const pack = packOf(locationId);
  const stage = packPlaces[locationId]?.stage;
  document.body.dataset.world = pack?.id || "shore";
  document.body.dataset.stage = stage ? "resident" : "cast";
  document.querySelector(".brand span").textContent =
    pack?.name || "The reflected shore";
  let picture = $("stage-picture");
  if (stage && picture?.dataset.place !== locationId) {
    picture?.remove();
    picture = node("div", undefined, "stage-picture");
    picture.id = "stage-picture";
    picture.dataset.place = locationId;
    const canvas = node("div", undefined, "stage-canvas");
    const background = node("img", undefined, "backdrop");
    background.src = backdrop(locationId);
    background.alt = stage.alt;
    const sprite = node("img", undefined, "stage-resident");
    sprite.id = "resident-sprite";
    sprite.dataset.resident = stage.resident;
    sprite.style.setProperty("--sprite-left", `${stage.sprite.left}%`);
    sprite.style.setProperty("--sprite-top", `${stage.sprite.top}%`);
    sprite.style.setProperty("--sprite-width", `${stage.sprite.width}%`);
    canvas.append(background, sprite);
    picture.append(canvas);
    $("stage").prepend(picture);
  }
  if (picture) picture.hidden = !stage;
  $("backdrop").hidden = Boolean(stage);
  if (stage) {
    const sprite = $("resident-sprite");
    const mood = variantOf(world, stage.resident);
    sprite.src = portrait(stage.resident, null, world);
    sprite.dataset.state = mood?.name || "present";
    sprite.alt = mood?.alt || nameOf(stage.resident);
  }
}
function renderScene() {
  // Every path to this renderer keeps the source visible until the veil covers it.
  if (covering) return;
  const scene = currentScene(world, null, {
    seq: lineSeq,
    hold: exchange.preparing,
    review: reviewing,
  });
  renderStage(scene.locationId);
  const resolvedBeat =
    Boolean(pendingCast) || (!reviewing && scene.line?.turn !== world.turn);
  if (pendingCast) scene.slots = pendingCast;
  else if (resolvedBeat) scene.slots = sceneCast(world);
  shownSceneLine = scene.line;
  const img = $("backdrop");
  if (img.getAttribute("src") !== scene.background) img.src = scene.background;
  img.alt = placeText(world, scene.locationId);
  img.dataset.locationVariant = scene.variant;
  let overlay = $("location-overlay");
  if (scene.overlay && !overlay) {
    overlay = node("img", undefined, "backdrop location-overlay");
    overlay.id = "location-overlay";
    overlay.style.pointerEvents = "none";
    img.after(overlay);
  }
  if (overlay) {
    overlay.hidden = !scene.overlay;
    if (scene.overlay && overlay.getAttribute("src") !== scene.overlay)
      overlay.src = scene.overlay;
    overlay.alt = scene.overlay ? placeText(world, scene.locationId) : "";
  }
  const staging = sceneStaging(world, {
    through: resolvedBeat ? world.log.length - 1 : scene.line?.index,
    cast: scene.slots,
    line: resolvedBeat ? null : scene.line,
    activeSpeaker: resolvedBeat ? null : scene.activeSpeaker,
    review: reviewing && !resolvedBeat,
  });
  $("cast").dataset.layout = staging.layout;
  $("cast").dataset.count = String(staging.actors.length);
  const castKey = JSON.stringify(staging.actors.map(({ id }) => id));
  if (castKey !== renderedCast) {
    renderedCast = castKey;
    const existing = new Map(
      [...$("cast").children].map((el) => [el.dataset.avatar, el]),
    );
    $("cast").replaceChildren(
      ...staging.actors.map(({ id }) => {
        if (existing.has(id)) return existing.get(id);
        const figure = node("div", undefined, "portrait");
        figure.dataset.avatar = id;
        figure.setAttribute("aria-label", nameOf(id));
        const body = node("div", undefined, "portrait-body");
        const image = node("img");
        image.alt = "";
        image.draggable = false;
        body.append(image);
        figure.append(body);
        return figure;
      }),
    );
  }
  staging.actors.forEach((actor, index) => {
    const { id } = actor;
    const figure = $("cast").children[index];
    figure.dataset.depth = actor.depth;
    figure.dataset.facing = actor.facing;
    figure.dataset.gaze = actor.gazeTargetId || "";
    figure.dataset.pose = actor.pose;
    figure.style.setProperty("--stage-x", `${actor.x}%`);
    figure.style.setProperty("--stage-size", `${actor.scale * 100}%`);
    figure.style.setProperty("--stage-floor", `${actor.floor}%`);
    figure.style.setProperty("--exit-x", actor.x < 50 ? "-28px" : "28px");
    figure.style.setProperty(
      "--lean",
      actor.facing === "right" ? ".35deg" : "-.35deg",
    );
    const image = figure.querySelector("img");
    if (image.getAttribute("src") !== actor.cutout) image.src = actor.cutout;
    image.dataset.flip = String(actor.flip);
    figure.classList.toggle(
      "active",
      scene.activeSpeaker === id && !resolvedBeat,
    );
    const left =
      actor.presence === "departed" ||
      (!reviewing && departed.has(id) && scene.line?.turn === world.turn);
    figure.classList.toggle("departed", left);
    figure.setAttribute("aria-hidden", String(left));
    const arrivalKey =
      actor.movement?.kind === "arrive"
        ? `${trip}:${world.turn}:${scene.locationId}`
        : "";
    const entering =
      arrivalKey && figure.dataset.arrival !== arrivalKey && !reviewing;
    figure.dataset.arrival = arrivalKey;
    if (!arrivalKey) figure.classList.remove("entering");
    if (entering) {
      figure.classList.add("entering");
      const version = trip;
      const task = waitForScene([travelShown, image.decode()]).then(
        async () => {
          if (
            version !== trip ||
            !figure.isConnected ||
            figure.dataset.arrival !== arrivalKey
          )
            return;
          figure.classList.remove("entering");
          if (!reducedMotion.matches) {
            await figure
              .querySelector(".portrait-body")
              .animate(
                [
                  {
                    opacity: 0,
                    translate: actor.x < 50 ? "-24px 0" : "24px 0",
                  },
                  { opacity: 1, translate: "0 0" },
                ],
                {
                  duration: 600,
                  delay:
                    id !== "vale" && !actor.movement.companions.includes("vale")
                      ? index * 300
                      : 0,
                  fill: "backwards",
                  easing: "ease-out",
                },
              )
              .finished.catch(() => {});
          }
        },
      );
      entrances.set(figure, task);
      void task.finally(() => {
        if (entrances.get(figure) === task) entrances.delete(figure);
      });
    }
  });
  const previous =
    scene.line?.kind === "dialogue"
      ? scene.lines.findLast(
          (entry) =>
            entry.index < scene.line.index &&
            entry.index >= scene.visitStart &&
            entry.kind === "dialogue",
        ) || null
      : scene.previous;
  const priorKey = JSON.stringify(previous);
  if (priorKey !== renderedPrior) {
    renderedPrior = priorKey;
    $("prior-response").hidden = true;
    $("prior-speaker").textContent = previous?.speaker || "";
    $("prior-text").textContent = previous?.text || "";
    const priorId =
      previous?.entityId || previous?.actorId || previous?.locationId;
    const priorPortrait = $("prior-portrait");
    priorPortrait.replaceChildren();
    if (priorId && things[priorId]) priorPortrait.innerHTML = art(priorId);
    else if (priorId) {
      const image = node("img");
      image.src = portrait(priorId);
      image.alt = "";
      priorPortrait.dataset.kind = people[priorId] ? "avatar" : "location";
      priorPortrait.append(image);
    }
  }
  const spoken =
    scene.line?.kind === "dialogue" &&
    (reviewing || scene.line.turn === world.turn);
  $("speaker").textContent = spoken
    ? scene.line.speaker
    : pendingSpeaker
      ? nameOf(pendingSpeaker)
      : "";
  const movement = reviewing ? "" : movementCaption(world);
  $("movement-caption").textContent = movement;
  $("movement-caption").hidden = !movement;
  $("line-turn").textContent = "";
  $("story-status").hidden = storyStatus === "ready" && !exchange.preparing;
  $("story-status").textContent =
    storyStatus === "retry"
      ? `${storyError} Retry this scene or keep playing.`
      : "···";
  $("story-retry").hidden = storyStatus !== "retry";
  $("story-status").setAttribute(
    "aria-label",
    storyStatus === "retry"
      ? $("story-status").textContent
      : "New words are on the way",
  );
  const text = spoken ? scene.line.text : "";
  const speaker =
    scene.line?.entityId || scene.line?.actorId || scene.locationId;
  const spokenLines = scene.lines.filter((entry) => entry.kind === "dialogue");
  const at = spokenLines.findIndex(
    (entry) => entry.index === scene.line?.index,
  );
  nextSceneSeq =
    at >= 0 && at < spokenLines.length - 1 ? spokenLines[at + 1].seq : null;
  if (exchange.active) nextSceneSeq = exchange.hasNext ? nextSceneSeq : null;
  // Keep failures visible even when this scene has no earlier words.
  document.querySelector(".dialogue").hidden =
    !text && storyStatus === "ready" && !exchange.preparing;
  document.querySelector(".line-controls").hidden = !text;
  $("dialogue-advance").hidden = !text;
  $("speech-hint").hidden = true;
  if (text) {
    const key = JSON.stringify([scene.line.seq, speaker, text, replay]);
    reveal.show(key, text, speaker, {
      instant: completedSpeech.has(key),
    });
  } else {
    reveal.cancel();
    speechSounds.stop();
    speechKey = null;
    $("dialogue-text").replaceChildren();
    $("speech-announcement").textContent = "";
  }
  $("previous-line").disabled = cardsCooling || at <= 0;
  updateSpeechControls(reveal.complete);
  $("previous-line").onclick = () => {
    reviewing = true;
    lineSeq = spokenLines[at - 1].seq;
    renderScene();
  };
  const advance = () => {
    if (!reveal.complete) {
      reveal.finish();
      speechSounds.stop();
      return;
    }
    if (exchange.current) {
      exchange.advance();
      return;
    }
    reviewing = true;
    if (nextSceneSeq !== null) lineSeq = nextSceneSeq;
    else replay++;
    renderScene();
  };
  $("dialogue-advance").onclick = advance;
  $("next-line").onclick = advance;
}
let renderedLog = [];
function renderLog() {
  const box = $("messages");
  const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  // Only spoken lines belong in this optional conversation record.
  // Rule receipts and hidden counters stay in the save, not on the screen.
  const conversation = world.log.filter(
    (entry) => entry.kind === "dialogue" && entry.generated === true,
  );
  let common = 0;
  while (
    common < renderedLog.length &&
    common < conversation.length &&
    renderedLog[common] === JSON.stringify(conversation[common])
  )
    common++;
  // Preserve existing nodes so screen readers announce only new messages.
  while (box.children.length > common) box.lastChild.remove();
  for (const entry of conversation.slice(common)) {
    const item = node(
      "div",
      undefined,
      `message ${entry.speaker === "World" || !entry.generated ? "world" : entry.speaker === "You" ? "you" : ""}`,
    );
    const by = node("div", entry.speaker, "speaker");

    item.append(by, node("p", entry.text));
    box.append(item);
  }
  renderedLog = conversation.map((e) => JSON.stringify(e));
  if (atEnd || common === 0) box.scrollTop = box.scrollHeight;
}

function render() {
  music.setStarted(world.turn > 0);
  // While the travel veil comes down, the old place stays drawn.
  if (covering) return;
  music.setRoom(world.actors.vale.place);
  const focused = document.activeElement?.dataset.card,
    scroll = $("hand").scrollLeft;
  $("place-title").textContent = nameOf(world.actors.vale.place);
  const handKey = JSON.stringify([world.revision, selected, saveBlocked]);
  if (handKey !== renderedHand) {
    renderedHand = handKey;
    $("hand").replaceChildren(...availableCards(world).map(card));
    $("hand").scrollLeft = scroll;
  }
  $("play-readout").textContent = selected.length
    ? playLabel(cardPlay(world, selected).action) || ""
    : "";
  updateHandScroll();
  renderScene();
  renderLog();
  updateCardCooldown();
  if (focused)
    document
      .querySelector(`[data-card="${focused}"]`)
      ?.focus({ preventScroll: true });
}
// A hand wider than the dock scrolls; the arrows and edge fades show there
// is more, and the wheel and arrow keys move along it.
function updateHandScroll() {
  const hand = $("hand"),
    wrap = hand.parentElement,
    over = hand.scrollWidth > hand.clientWidth + 1,
    atStart = hand.scrollLeft <= 1,
    atEnd = hand.scrollLeft + hand.clientWidth >= hand.scrollWidth - 1;
  wrap.dataset.overflow = String(over);
  wrap.dataset.start = String(atStart);
  wrap.dataset.end = String(atEnd);
  $("hand-prev").hidden = $("hand-next").hidden = !over;
  $("hand-prev").disabled = atStart;
  $("hand-next").disabled = atEnd;
}
function scrollHand(direction) {
  const hand = $("hand");
  hand.scrollBy({
    left: direction * Math.max(160, hand.clientWidth - 120),
    behavior: reducedMotion.matches ? "auto" : "smooth",
  });
}
$("hand-prev").onclick = () => scrollHand(-1);
$("hand-next").onclick = () => scrollHand(1);
$("hand").addEventListener("scroll", updateHandScroll, { passive: true });
new ResizeObserver(updateHandScroll).observe($("hand"));
$("hand").addEventListener(
  "wheel",
  (e) => {
    const hand = $("hand");
    if (
      hand.scrollWidth <= hand.clientWidth + 1 ||
      Math.abs(e.deltaY) <= Math.abs(e.deltaX)
    )
      return;
    e.preventDefault();
    hand.scrollLeft += e.deltaY;
  },
  { passive: false },
);
$("hand").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const cards = [...$("hand").querySelectorAll(".card")],
    at = cards.indexOf(document.activeElement),
    next = cards[at + (e.key === "ArrowRight" ? 1 : -1)];
  if (at < 0 || !next) return;
  e.preventDefault();
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: "nearest", inline: "nearest" });
});
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
    !e.target.closest(".card-frame") &&
    !e.target.closest("dialog") &&
    !e.target.closest(".dialogue")
  ) {
    selected = [];
    render();
  }
});
$("history-button").onclick = () => {
  $("history-dialog").showModal();
  pauseSpeech();
  $("messages").scrollTop = $("messages").scrollHeight;
};
$("menu-button").onclick = () => {
  $("menu-dialog").showModal();
  pauseSpeech();
};
document
  .querySelectorAll("[data-close]")
  .forEach(
    (button) => (button.onclick = () => $(button.dataset.close).close()),
  );
document
  .querySelectorAll("dialog")
  .forEach((dialog) => dialog.addEventListener("close", pauseSpeech));
$("export-script").onclick = () => {
  const url = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(
          world.log
            .filter((e) => e.kind === "dialogue" && e.generated === true)
            .map(({ speaker, text }) => ({ speaker, text })),
          null,
          2,
        ),
      ],
      {
        type: "application/json",
      },
    ),
  );
  const link = node("a");
  link.href = url;
  link.download = "cosyworld-conversation.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("new-game").onclick = () => {
  $("menu-dialog").close();
  $("reset-dialog").showModal();
  pauseSpeech();
};
$("cancel-reset").onclick = () => $("reset-dialog").close();
$("confirm-reset").onclick = () => {
  // Archive the outgoing save: starting fresh must be reversible, because
  // a confirm click is not enough consent to destroy a whole run.
  try {
    const previous = localStorage.getItem(SAVE_KEY);
    if (previous) localStorage.setItem(`${SAVE_KEY}.bak`, previous);
  } catch {}
  cancelTravel();
  narrator.invalidate();
  exchange.cancel();
  departed.clear();
  reveal.cancel();
  speechSounds.stop();
  world = enableMotives(createWorld({ opening: true }), {
    questPrograms: true,
    personalQuests: true,
  });
  completedSpeech.clear();
  reviewing = false;
  renderedHand = "";
  replay = 0;
  lineSeq = null;
  selected = [];
  saveBlocked = false;
  notice("");
  save();
  $("reset-dialog").close();
  render();
};
window.addEventListener("storage", (event) => {
  if (event.key !== SAVE_KEY || !event.newValue) return;
  cancelTravel();
  narrator.invalidate();
  exchange.cancel();
  departed.clear();
  reveal.cancel();
  speechKey = null;
  speechSounds.stop();
  try {
    world = enableMotives(decodeSave(event.newValue), {
      questPrograms: true,
      personalQuests: true,
    });
    renderedHand = "";
    lineSeq = null;
    selected = [];
    saveBlocked = false;
    notice("The world was updated in another tab.");
    resumeScene();
  } catch {
    saveBlocked = true;
    notice(
      "The save changed in another tab. Use New game to start a fresh world.",
    );
    render();
  }
});
pauseSpeech();
function hasCurrentWords() {
  return world.log.some(
    (entry) =>
      entry.generated &&
      entry.kind === "dialogue" &&
      entry.turn === world.turn &&
      entry.locationId === world.actors.vale.place,
  );
}
function resumeScene() {
  if (!saveBlocked && hasCurrentWords()) {
    const line = currentScene(world).line;
    lineSeq = null;
    exchange.begin();
    render();
    exchange.load(line ? [line] : []);
  } else {
    render();
  }
}
resumeScene();
