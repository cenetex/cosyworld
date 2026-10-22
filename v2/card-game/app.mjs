import {
  enableMotives,
  hasQuestPrograms,
  interest,
  motiveFacts,
  tastes,
} from "./motives.mjs";
import { createNarrator } from "./narrative.mjs";
import { createRoomMusic } from "./music.mjs";
import { conditionText } from "./situations.mjs";
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
  standoffFor,
  opponentOf,
  strikePower,
} from "./world.mjs";
import {
  currentScene,
  sceneScript,
  sceneCast,
  sceneChanges,
  sceneStaging,
  portrait,
  backdrop,
  witnessed,
} from "./scene.mjs";
import {
  availableCards,
  cardType,
  cardPlay,
  playLabel,
  avatarPlays,
} from "./cards.mjs";
import { LESSONS, nextLesson } from "./lessons.mjs";
import {
  programsFor,
  knownActors,
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
let world = enableMotives(createWorld({ opening: true }), {
    questPrograms: true,
  }),
  selected = [],
  saveBlocked = false,
  lineSeq = null,
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
  if (saved) world = enableMotives(decodeSave(saved), { questPrograms: true });
} catch (error) {
  saveBlocked = true;
  notice(error.message + " Use New game to start again.");
}
// Cards the player has met. A card seen for the first time is unveiled large,
// then flies into the hand and glows until it is used. The cards on the table
// when a game starts count as met.
const SEEN_KEY = `${SAVE_KEY}.seen`;
let encountered = null;
try {
  const seen = JSON.parse(localStorage.getItem(SEEN_KEY) || "null");
  if (Array.isArray(seen)) encountered = new Set(seen);
} catch {
  encountered = null;
}
encountered ??= new Set(availableCards(world));
const fresh = new Set(),
  unveiling = [];
let unveilTimer = null;
function saveSeen() {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...encountered]));
  } catch {
    // Unveiling is a courtesy; the world itself still saves.
  }
}
// Pairing tips the player has already used or dismissed, kept per browser.
const LESSONS_KEY = "cosyworld.reflected-shore.lessons";
let learned;
try {
  learned = new Set(JSON.parse(localStorage.getItem(LESSONS_KEY) || "[]"));
} catch {
  learned = new Set();
}
function learn(kind) {
  if (learned.has(kind)) return;
  learned.add(kind);
  try {
    localStorage.setItem(LESSONS_KEY, JSON.stringify([...learned]));
  } catch {
    // A tip that shows again is harmless.
  }
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
  pendingReplay = 0,
  cardsCooling = false,
  reviewing = false,
  pendingCast = null,
  departed = new Set();
// Release the hand if words are still on the way after this. A new play
// replaces the request, and words that arrive still play.
const HAND_WAIT = 2500;
let handTimer = null;
function releaseHand() {
  if (!cardsCooling || storyStatus !== "pending") return;
  cardsCooling = false;
  // The scene shows who is really here once the hand is free.
  pendingCast = null;
  updateCardCooldown();
  renderScene();
}
const completedSpeech = new Set();
const entrances = new Map();
let shownSceneLine = null;
function updateCardCooldown() {
  $("hand").dataset.cooling = String(cardsCooling);
  $("hand").setAttribute("aria-busy", String(cardsCooling));
  for (const button of $("hand").querySelectorAll("button")) {
    button.disabled = saveBlocked || cardsCooling;
    if (button.dataset.card) button.draggable = !button.disabled;
  }
}
const exchange = createExchange({
  prepare: () =>
    waitForScene(
      [
        ...[$("backdrop"), ...$("cast").querySelectorAll("img")].map((image) =>
          image.decode(),
        ),
        ...entrances.values(),
      ],
      10000,
    ),
  show: (line) => {
    pendingCast = null;
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
    if (value) handTimer = setTimeout(releaseHand, HAND_WAIT);
    // A failed request releases the hand as well.
    if (!value) {
      pendingCast = null;
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
  changed: ({ enabled, title, playing, failed }) => {
    $("music-toggle").textContent = `Music: ${enabled ? "on" : "off"}`;
    $("music-toggle").setAttribute("aria-pressed", String(enabled));
    $("music-status").textContent = !enabled
      ? "Music paused"
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
function status(id) {
  if (id === "lamp")
    return `${covered(world, id) ? "Covered · " : ""}${world.items.lamp.lit ? "Burning" : "Unlit"} · ${world.items.lamp.fuel}/12 fuel`;
  if (id === "oil")
    return `${world.items.oil.doses} ${world.items.oil.doses === 1 ? "dose" : "doses"} · +4 fuel each`;
  if (
    id === "bell" &&
    world.actors.vale.place === "pond" &&
    world.steamClock.rings === 1
  )
    return "The Steam Clock answers. Ring again to find it.";
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
  if (saveBlocked || cardsCooling) return;
  fresh.delete(id);
  if (selected.includes(id)) {
    commit(selected, selectionRevision);
    return;
  }
  selected = selected.length >= 2 ? [id] : [...selected, id];
  selectionRevision = world.revision;
  render();
}
function commit(cards, revision) {
  if (saveBlocked || cardsCooling) return;
  const resolved = cardPlay(world, cards);
  if (!resolved.action) {
    $("play-readout").textContent = resolved.hint;
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
  if (action.actor === "vale" && LESSONS.includes(action.kind))
    learn(action.kind);
  reveal.finish();
  speechSounds.stop();
  storyStatus = "pending";
  pendingReplay = replay;
  const previousLine = currentScene(world, null, { seq: lineSeq }).line;
  const from = world.actors.vale.place;
  world = result.state;
  // A new play ends any review of earlier lines.
  reviewing = false;
  dragging = [];
  $("stage").classList.remove("ready", "drag-over");
  departed.clear();
  const visible = [
    ...new Set([
      ...Object.keys(people).filter(
        (id) => world.actors[id].place === world.actors.vale.place,
      ),
      ...sceneChanges(world)
        .filter((change) => change.leaving)
        .map((change) => change.actorId),
    ]),
  ];
  pendingCast = sceneCast(world, world.log.length - 1, visible);
  exchange.begin();
  selected = [];
  lineSeq =
    previousLine?.locationId === world.actors.vale.place
      ? previousLine.seq
      : null;
  notice("");
  save();
  if (world.actors.vale.place !== from)
    travel(world.actors.vale.place, render, unveilNew);
  else {
    render();
    unveilNew();
  }
  narrator.changed(action);
}

// Moving between places dips the scene to dark with the destination's name,
// so a change of place is always seen, whatever caused it. The new place is
// drawn only once the veil is fully down, and the veil lifts only once the new
// backdrop and portraits have loaded, so the swap is never seen.
const TRAVEL_COVER = 400,
  TRAVEL_HOLD = 700,
  TRAVEL_WAIT = 4000;
let covering = false,
  trip = 0;
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
    setTimeout(() => mine === trip && landed(), TRAVEL_COVER);
  }, TRAVEL_COVER);
}

function unveilNew() {
  if (saveBlocked) return;
  // People first, then what they carry, then the ways onward.
  const rank = { avatar: 0, item: 1, location: 2 };
  const found = availableCards(world)
    .filter((id) => !encountered.has(id))
    .sort((a, b) => rank[cardType(a)] - rank[cardType(b)]);
  if (!found.length) return;
  for (const id of found) {
    encountered.add(id);
    fresh.add(id);
    unveiling.push(id);
  }
  saveSeen();
  showUnveil();
}
function showUnveil() {
  const dialog = $("unveil-dialog");
  if (dialog.open || !unveiling.length) return;
  const id = unveiling[0],
    type = cardType(id);
  $("unveil-eyebrow").textContent =
    type === "location"
      ? "A new place"
      : type === "avatar"
        ? "Someone new"
        : "Something new";
  // A showpiece, not a control: it cannot be clicked, so it need not look idle.
  const shown = card(id);
  shown.inert = true;
  for (const button of shown.querySelectorAll("button"))
    button.disabled = false;
  $("unveil-card").replaceChildren(shown);
  // Places and things carry their text on the card; people's goes beneath.
  $("unveil-text").textContent = type === "avatar" ? people[id].text : "";
  dialog.showModal();
  pauseSpeech();
  clearTimeout(unveilTimer);
  unveilTimer = setTimeout(takeUnveiled, 5000);
}
// The unveiled card flies from the middle of the screen into its slot.
function takeUnveiled() {
  clearTimeout(unveilTimer);
  const dialog = $("unveil-dialog");
  if (!dialog.open) return;
  const id = unveiling.shift(),
    shown = $("unveil-card").firstElementChild,
    start = shown?.getBoundingClientRect();
  dialog.close();
  // The showpiece leaves the page, so only the hand holds this card.
  $("unveil-card").replaceChildren();
  renderedHand = "";
  render();
  const slot = $("hand")
    .querySelector(`[data-card="${id}"]`)
    ?.closest(".card-frame");
  if (!slot || !start || reducedMotion.matches) {
    showUnveil();
    return;
  }
  slot.scrollIntoView({ block: "nearest", inline: "nearest" });
  const end = slot.getBoundingClientRect(),
    ghost = shown.cloneNode(true),
    size = slot.offsetWidth;
  ghost.classList.add("unveil-ghost");
  document.body.append(ghost);
  slot.style.visibility = "hidden";
  const at = (r) =>
    `translate(${r.left}px, ${r.top}px) scale(${r.width / size})`;
  ghost
    .animate([{ transform: at(start) }, { transform: at(end) }], {
      duration: 560,
      easing: "cubic-bezier(.2,.7,.2,1)",
    })
    .finished.finally(() => {
      ghost.remove();
      slot.style.visibility = "";
      showUnveil();
    });
}
$("unveil-take").onclick = takeUnveiled;
$("unveil-dialog").addEventListener("click", (e) => {
  if (e.target === $("unveil-dialog")) takeUnveiled();
});
$("unveil-dialog").addEventListener("cancel", (e) => {
  e.preventDefault();
  takeUnveiled();
});
// Where a cutout's figure stands: the top and height of its outline and the
// middle of its head, as fractions of the image. The card banner uses them to
// frame the head and shoulders of any portrait the same way.
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
function card(id) {
  const type = cardType(id),
    def = places[id] || people[id] || things[id];
  const raised = selected.includes(id);
  const ownPlay = cardPlay(world, [id]);
  const chosen = raised ? cardPlay(world, selected) : ownPlay;
  const el = node(
    "button",
    undefined,
    `card ${type} ${id === "lamp" && shining(world) ? "lit" : ""} ${fresh.has(id) ? "new" : ""}`,
  );
  el.type = "button";
  el.dataset.card = id;
  el.disabled = saveBlocked || cardsCooling;
  el.setAttribute("aria-pressed", String(raised));
  el.setAttribute("aria-label", `${def.name}, ${type}`);
  el.setAttribute("aria-describedby", `card-detail-${id}`);
  el.title =
    world.memories[id].text ||
    (type === "avatar"
      ? !hasQuestPrograms(world)
        ? motiveFacts(world, id).join(". ")
        : `${def.text} ${programFor(world, id)?.name || "Next journey"}. ${handText(desireFor(world, id))}.`
      : type === "location"
        ? placeText(world, id)
        : def.text);
  el.append(
    node(
      "span",
      type === "avatar" && id !== "badger" && hasQuestPrograms(world)
        ? `${type} · Level ${levelOf(world, id)}`
        : type,
      "kind",
    ),
  );
  const graphic = node("span", undefined, "art");
  {
    const img = node("img");
    img.src =
      type === "item"
        ? `./assets/${id}-card.png`
        : type === "avatar"
          ? portrait(id, null, world)
          : backdrop(id);
    img.alt = "";
    if (type === "avatar") frameFigure(img);
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
    if (!hasQuestPrograms(world) || id === "badger") {
      caption = interest(world, id).text;
      detail = tastes[id].likes;
    }
  } else {
    caption = id === world.actors.vale.place ? "Here" : "A path from here";
    detail =
      id === world.actors.vale.place
        ? "Wait a turn · leave items here"
        : "Travel · carry your items";
  }
  const conflict = type === "avatar" ? standoffFor(world, id) : null;
  if (conflict)
    caption = `Facing ${nameOf(opponentOf(conflict, id))} · Resolve ${conflict.resolve[id]}/4${conflict.guarding[id] ? " · Guarding" : ""}`;
  el.append(node("span", caption, `caption${conflict ? " conflict" : ""}`));
  const info = node("span", detail, "state");
  info.id = `card-detail-${id}`;
  if (type !== "avatar")
    info.append(
      node(
        "span",
        type === "location" ? placeText(world, id) : def.text,
        "flavor",
      ),
    );
  if (type === "avatar" && (!hasQuestPrograms(world) || id === "badger")) {
    info.textContent = "";
    info.append(node("span", tastes[id].likes, "hand-condition"));
    const grudge = world.motives?.grievances[id]?.at(-1);
    info.append(
      node(
        "span",
        grudge
          ? `Sore at ${nameOf(grudge.other)}: ${grudge.kind}`
          : `Touchy about: ${tastes[id].sore}`,
        "hand-condition",
      ),
    );
    info.title = motiveFacts(world, id).join("\n");
    if (id !== "vale")
      info.append(
        node(
          "span",
          `Offers: ${tradeOffers(world, id).map(nameOf).join(", ") || "Make an offer"}`,
          "trade-offers",
        ),
      );
  } else if (type === "avatar") {
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
    if (target.conditions.length)
      row(
        "Need",
        target.conditions.map((c) => ({
          ...c,
          text: conditionText(c, nameOf),
        })),
      );
    const choices = targetsFor(world, id);
    if (choices.length > 1)
      info.append(
        node("span", `${choices.length} choices · Menu`, "trade-offers"),
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
        : playLabel(ownPlay.action) ||
            (id === "vale" ? "Pair with a place" : "Combine"),
      "card-play",
    ),
  );
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
  const plays = type === "avatar" ? avatarPlays(world, id) : [];
  if (plays.length && !(raised && selected.length === 2)) {
    el.classList.add("has-options");
    const options = node("div", undefined, "card-options");
    const revision = world.revision;
    for (const action of plays) {
      const button = node("button", playLabel(action));
      button.type = "button";
      button.disabled = saveBlocked || cardsCooling;
      button.setAttribute("aria-label", `${playLabel(action)} · ${def.name}`);
      button.title =
        action.kind === "threaten"
          ? `Open a standoff${action.item ? ` over ${nameOf(action.item)}` : ""}.`
          : action.kind === "guard"
            ? "Reduce the next hit by 1. Guard lasts until your next play."
            : action.kind === "attack"
              ? `${strikePower(world, "vale", action.target)} resolve damage. At zero, the loser drops the disputed item and retreats.`
              : action.text;
      button.addEventListener("click", () => commitAction(action, revision));
      options.append(button);
    }
    frame.append(options);
  }
  return frame;
}
function renderClearing(locationId) {
  const forest = locationId === "clearing";
  document.body.dataset.world = forest ? "forest" : "shore";
  document.querySelector(".brand span").textContent = forest
    ? "The Steam Clock"
    : "The reflected shore";
  let picture = $("clearing-picture");
  if (forest && !picture) {
    picture = node("div", undefined, "clearing-picture");
    picture.id = "clearing-picture";
    const canvas = node("div", undefined, "clearing-canvas");
    const background = node("img", undefined, "backdrop");
    background.src = backdrop("clearing");
    background.alt =
      "The old Steam Clock stands on mossy stones in a sunlit clearing.";
    const badger = node("img", undefined, "clearing-badger");
    badger.id = "badger-sprite";
    canvas.append(background, badger);
    picture.append(canvas);
    $("stage").prepend(picture);
  }
  if (picture) picture.hidden = !forest;
  $("backdrop").hidden = forest;
  if (forest) {
    $("badger-sprite").src = portrait("badger", null, world);
    $("badger-sprite").dataset.state = world.actors.badger.awake
      ? "grumpy"
      : "sleeping";
    $("badger-sprite").alt = world.actors.badger.awake
      ? "Grumpy Badger, awake and looking put out."
      : "Grumpy Badger asleep beside the clock.";
  }
}
function renderScene() {
  const scene = currentScene(world, null, {
    seq: lineSeq,
    hold: exchange.preparing,
    review: reviewing,
  });
  renderClearing(scene.locationId);
  const resolvedBeat =
    Boolean(pendingCast) || (!reviewing && scene.line?.turn !== world.turn);
  if (pendingCast) scene.slots = pendingCast;
  else if (resolvedBeat) scene.slots = sceneCast(world);
  shownSceneLine = scene.line;
  const img = $("backdrop");
  if (img.getAttribute("src") !== scene.background) img.src = scene.background;
  img.alt = placeText(world, scene.locationId);
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
        ? `${world.turn}:${scene.locationId}`
        : "";
    const entering =
      arrivalKey && figure.dataset.arrival !== arrivalKey && !reviewing;
    figure.dataset.arrival = arrivalKey;
    if (!arrivalKey) figure.classList.remove("entering");
    if (entering) {
      figure.classList.add("entering");
      const task = waitForScene([image.decode()]).then(async () => {
        if (!figure.isConnected || figure.dataset.arrival !== arrivalKey)
          return;
        figure.classList.remove("entering");
        if (!reducedMotion.matches) {
          await figure
            .querySelector(".portrait-body")
            .animate(
              [
                { opacity: 0, translate: actor.x < 50 ? "-24px 0" : "24px 0" },
                { opacity: 1, translate: "0 0" },
              ],
              { duration: 420, easing: "ease-out" },
            )
            .finished.catch(() => {});
        }
      });
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
    $("prior-response").hidden = !previous;
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
  $("speaker").textContent = scene.line?.speaker || "";
  $("line-turn").textContent = scene.line
    ? scene.line.departureTo
      ? `${exchange.current?.seq === scene.line.seq && !departed.has(scene.line.actorId) ? "Leaving for" : "Left for"} ${nameOf(scene.line.departureTo)}`
      : scene.line.arrivalFrom
        ? `Arrived from ${nameOf(scene.line.arrivalFrom)}`
        : `Turn ${scene.line.turn}`
    : "";
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
  const text = scene.line?.text || "";
  const speaker =
    scene.line?.entityId || scene.line?.actorId || scene.locationId;
  const at = scene.lines.findIndex(
    (entry) => entry.index === scene.line?.index,
  );
  nextSceneSeq =
    at >= 0 && at < scene.lines.length - 1 ? scene.lines[at + 1].seq : null;
  if (exchange.active) nextSceneSeq = exchange.hasNext ? nextSceneSeq : null;
  // Keep failures visible even when this scene has no earlier words.
  document.querySelector(".dialogue").hidden =
    !text && storyStatus === "ready" && !exchange.preparing;
  document.querySelector(".line-controls").hidden = !text;
  $("dialogue-advance").hidden = !text;
  $("speech-hint").hidden = !text;
  if (text) {
    const key = JSON.stringify([scene.line.seq, speaker, text, replay]);
    reveal.show(key, text, speaker, {
      instant:
        completedSpeech.has(key) ||
        (replay === pendingReplay && storyStatus === "pending"),
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
    lineSeq = scene.lines[at - 1].seq;
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
  // Words and the world's own account, so every turn is recorded even when
  // its words fail or are still on the way.
  const conversation = world.log.filter(
    (entry) => entry.generated === true || witnessed(entry),
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
    by.append(node("span", `Turn ${entry.turn}`));
    item.append(by, node("p", entry.text));
    box.append(item);
  }
  renderedLog = conversation.map((e) => JSON.stringify(e));
  if (atEnd || common === 0) box.scrollTop = box.scrollHeight;
}

function render() {
  // While the travel veil comes down, the old place stays drawn.
  if (covering) return;
  music.setRoom(world.actors.vale.place);
  const focused = document.activeElement?.dataset.card,
    scroll = $("hand").scrollLeft;
  $("turn").textContent = `Turn ${world.turn}`;
  $("place-title").textContent = nameOf(world.actors.vale.place);
  $("path-state").textContent = reflectionOpen(world, world.actors.vale.place)
    ? "The reflected path is open"
    : "The mirror holds a dark reflection";
  const handKey = JSON.stringify([
    world.revision,
    selected,
    saveBlocked,
    [...fresh],
  ]);
  if (handKey !== renderedHand) {
    renderedHand = handKey;
    $("hand").replaceChildren(...availableCards(world).map(card));
    $("hand").scrollLeft = scroll;
  }
  for (const card of $("hand").querySelectorAll("[data-card]")) {
    const words = world.memories[card.dataset.card]?.text;
    if (words) card.title = words;
  }
  $("play-readout").textContent = selected.length
    ? cardPlay(world, selected).hint
    : "";
  renderTip();
  updateHandScroll();
  renderScene();
  renderLog();
  updateCardCooldown();
  if (focused)
    document
      .querySelector(`[data-card="${focused}"]`)
      ?.focus({ preventScroll: true });
}
// The first gift, trade, and shared journey are named once, over the hand.
let tip = null;
function renderTip() {
  tip = saveBlocked ? null : nextLesson(world, learned);
  $("hand-tip").hidden = !tip;
  $("hand-tip-text").textContent = tip?.text ?? "";
  for (const frame of $("hand").querySelectorAll(".card-frame")) {
    const id = frame.querySelector("[data-card]")?.dataset.card;
    if (tip?.cards.includes(id)) frame.dataset.tip = "true";
    else delete frame.dataset.tip;
  }
}
$("hand-tip-close").onclick = () => {
  if (tip) learn(tip.kind);
  renderTip();
};
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
    !e.target.closest(".card") &&
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
  if (!hasQuestPrograms(world)) {
    $("quest-guide").replaceChildren(
      ...knownActors(world).map((id) => {
        const block = node("section", undefined, "quest-guide-program");
        block.append(
          node("h3", nameOf(id)),
          ...motiveFacts(world, id).map((fact) => node("p", fact)),
        );
        return block;
      }),
    );
    $("menu-dialog").showModal();
    pauseSpeech();
    return;
  }
  $("quest-guide").replaceChildren(
    ...[
      ...programsFor(world, "vale")
        .filter(
          (_, index) =>
            !world.opening || index <= world.actors.vale.progress.program,
        )
        .map((program, index) => ({
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
      ...knownActors(world)
        .filter((id) => id !== "vale" && id !== "badger")
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
      if (program.purpose) block.append(node("p", program.purpose));
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
  pauseSpeech();
};
$("cancel-reset").onclick = () => $("reset-dialog").close();
$("confirm-reset").onclick = () => {
  narrator.invalidate();
  exchange.cancel();
  departed.clear();
  reveal.cancel();
  speechSounds.stop();
  world = enableMotives(createWorld({ opening: true }), {
    questPrograms: true,
  });
  completedSpeech.clear();
  encountered = new Set(availableCards(world));
  fresh.clear();
  unveiling.length = 0;
  saveSeen();
  reviewing = false;
  renderedHand = "";
  replay = pendingReplay = 0;
  lineSeq = null;
  selected = [];
  saveBlocked = false;
  notice("");
  save();
  $("reset-dialog").close();
  render();
  narrator.changed();
};
window.addEventListener("storage", (event) => {
  if (event.key !== SAVE_KEY || !event.newValue) return;
  narrator.invalidate();
  exchange.cancel();
  departed.clear();
  reveal.cancel();
  speechKey = null;
  speechSounds.stop();
  try {
    world = enableMotives(decodeSave(event.newValue), { questPrograms: true });
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
    if (!saveBlocked) narrator.changed();
  }
}
resumeScene();
