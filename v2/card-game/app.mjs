import { imageUrl } from "./images.mjs";
import { landingPack, createLandingWorld } from "./pack-landing.mjs";
import { flipStagePortrait, portraitFraming } from "./portrait-facing.mjs";
import { installSceneVideo } from "./scene-video.mjs";
import { locationWeather } from "./weather.mjs";
import { locationDaylight } from "./daylight.mjs";
import { renderWeather } from "./weather-view.mjs";
import { installToolbar, renderPlayers } from "./toolbar.mjs";
import { expressionLabel, expressionOf } from "./expression.mjs";
import {
  connectSharedWorld,
  createSharedPlaybackClock,
  installSharedControls,
  renderSharedQueue,
  sharedLiveLine,
  sharedNextActor,
  sharedSpeechState,
  hasSharedPlace,
  humanAvatars,
} from "./shared.mjs";
import { enableMotives } from "./motives.mjs";
import { createNarrator, requestNarrative } from "./narrative.mjs";
import { packMedia } from "./pack-registry.mjs";
import { createRoomMusic } from "./music.mjs";
import { createCharacterSpeech } from "./character-speech.mjs";
import { localRuntime } from "./local-service.mjs";
import { createLocalBackups, installBackupControls } from "./local-saves.mjs";
import {
  createTextReveal,
  createSpeechSounds,
  createExchange,
  createPlayQueue,
  waitForScene,
} from "./dialogue.mjs";
import {
  currentActor,
  places,
  placeText,
  people,
  things,
  nameOf,
  addLog,
  covered,
  shining,
  itemPlace,
  rootHolder,
  play,
  encodeSave,
  decodeSave,
  legalActions,
} from "./world.mjs";
import { packPlaces, packOf } from "./pack-registry.mjs";
import { variantOf } from "./pack-rules.mjs";
import {
  currentScene,
  isSceneText,
  sceneCast,
  nextSpeaker,
  movementCaption,
  sceneStaging,
  selectedHandItem,
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
  cardActions,
  cardObservation,
} from "./cards.mjs";
import { knownActors } from "./quests.mjs";
// Quests stay in the saved world and reach the cast through Talk context
// (quest-talk.mjs). The hand holds only people, items and places.
const $ = (id) => document.getElementById(id);
const tableName = new URLSearchParams(window.location.search).get("table");
const startingPack = landingPack(window.location.href);
const sharedWorldId = new URLSearchParams(location.search).get("world");
const sharedSession = sharedWorldId
  ? await connectSharedWorld(sharedWorldId)
  : null;
const sharedPlayback = createSharedPlaybackClock();
const SAVE_KEY =
  "cosyworld.reflected-shore.v1" +
  (sharedSession
    ? `.shared.${sharedWorldId}.${sharedSession.state.actor}`
    : tableName && /^[a-z0-9-]{1,40}$/i.test(tableName)
      ? `.${tableName}`
      : startingPack
        ? `.pack.${startingPack.id}`
        : "");
let world = sharedSession
    ? { ...sharedSession.state.world, playerActorId: sharedSession.state.actor }
    : enableMotives(createLandingWorld(startingPack), {
        questPrograms: true,
        personalQuests: true,
      }),
  selected = [],
  expandedHolders = new Set(),
  saveBlocked = false,
  lineSeq = null,
  selectionRevision = 0,
  dragging = [],
  // A scene click folds the row away while the held item stays raised.
  rowCollapsed = false;
// Name the save slot: table saves are keyed off the URL param, so a player
// landing through a different link silently lands in a different slot.
{
  const slotLabel = $("table-slot");
  if (slotLabel && tableName) {
    slotLabel.hidden = false;
    slotLabel.textContent = `Saving as table "${tableName}". Without the ?table= parameter this menu shows a different saved game.`;
  }
}
let videoScene = null;
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
    ? `<img src="${imageUrl(media, "card")}" alt="" decoding="async">`
    : `<svg viewBox="0 0 64 64" aria-hidden="true">${paths[id] || '<path d="M20 12h24v40H20zM25 22h14M25 30h14M25 38h10"/>'}</svg>`;
}
function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function notice(text) {
  // Saved speech failures use the small dialogue retry control.
  if (/^(The|Your) play is saved\./.test(text)) return;
  $("notice").textContent = text;
  $("notice").hidden = !text;
}
const localBackups =
  localRuntime()?.backups && !sharedSession
    ? createLocalBackups({
        slot: SAVE_KEY,
        validate: decodeSave,
        onError: notice,
      })
    : null;
try {
  await localBackups?.restore();
  const saved = sharedSession ? null : localStorage.getItem(SAVE_KEY);
  if (saved)
    world = enableMotives(decodeSave(saved), {
      questPrograms: true,
      personalQuests: true,
    });
} catch (error) {
  saveBlocked = true;
  notice(error.message + " Use New game to start again.");
}
const SEEN_KEY = `${SAVE_KEY}.seen`;
let encountered = new Set(),
  discoveryDone = Promise.resolve(),
  discoveryPending = false;
const fresh = new Set();
function rememberCards() {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...encountered]));
  } catch {}
}
function loadSeen(reset = false) {
  let saved = [];
  try {
    saved = reset ? [] : JSON.parse(localStorage.getItem(SEEN_KEY) || "[]");
  } catch {}
  encountered = new Set([
    ...(Array.isArray(saved)
      ? saved.filter((id) => people[id] || things[id] || places[id])
      : []),
    ...availableCards(world),
  ]);
  fresh.clear();
  rememberCards();
}
loadSeen();
function save() {
  if (saveBlocked || sharedSession) return;
  try {
    const encoded = encodeSave(world);
    localStorage.setItem(SAVE_KEY, encoded);
    void localBackups?.queue(encoded);
  } catch {
    notice(
      "This browser could not save the world. Keep this tab open to keep playing.",
    );
  }
}
if (localBackups) {
  installBackupControls({
    slot: SAVE_KEY,
    backups: localBackups,
    getSave: () => encodeSave(world),
    validate: decodeSave,
  });
  window.addEventListener("pagehide", () => {
    void localBackups.flush();
  });
}
let storyStatus = "ready",
  storyRetrying = false,
  renderedCast = "",
  renderedHand = "",
  renderedHandRevision = null,
  renderedHandPlace = null,
  renderedHandState = null,
  actionPanelMotion = null,
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
  pendingSpeaker = null,
  // This play's speakers in order, and those whose lines have been shown.
  sceneSpeakers = [],
  shownSpeakers = [],
  awaitingNext = false;
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
const exits = new Map();
let shownSceneLine = null;
async function prepareStage() {
  await travelShown;
  await waitForScene(
    [
      ...[$("backdrop"), ...$("cast").querySelectorAll("img")].map((image) =>
        image.decode(),
      ),
      ...entrances.values(),
      ...exits.values(),
    ],
    10000,
  );
}
async function prepareScene() {
  await prepareStage();
  await discoveryDone;
}
function selectionBlocked() {
  return (
    saveBlocked ||
    covering ||
    (sharedSession && !hasSharedPlace(sharedSession.state)) ||
    (!sharedSession && discoveryPending)
  );
}
const playQueue = createPlayQueue({
  ready: () =>
    !cardsCooling &&
    reveal.complete &&
    (!sharedSession ||
      (!sharedSending &&
        !sharedSession.state.queue?.some(
          (entry) => entry.actor === currentActor(world),
        ))) &&
    !selectionBlocked() &&
    !document.hidden &&
    !document.querySelector("dialog[open], .world-menu:popover-open"),
  play: (action, revision) => {
    if (sharedSession) void submitSharedPlay(action);
    else performAction(action, revision);
  },
  changed: (pending) => {
    notice(
      pending
        ? `Queued: ${playLabel(pending.action)}. Select a card to change it.`
        : "",
    );
    renderActions();
  },
});
function updateCardCooldown() {
  $("hand").dataset.cooling = String(cardsCooling);
  $("hand").setAttribute("aria-busy", String(selectionBlocked()));
  $("card-actions").setAttribute("aria-busy", String(selectionBlocked()));
  for (const button of document.querySelectorAll(
    "#hand button, #card-actions button",
  )) {
    button.disabled = selectionBlocked();
    if (button.dataset.card) button.draggable = !button.disabled;
  }
  if (playQueue.pending) queueMicrotask(() => playQueue.flush());
}
const exchange = createExchange({
  prepare: prepareScene,
  show: (line) => {
    pendingSpeaker = null;
    awaitingNext = false;
    const speakerId = line.entityId || line.actorId;
    if (speakerId && !shownSpeakers.includes(speakerId))
      shownSpeakers.push(speakerId);
    reviewing = false;
    lineSeq = line.seq;
    renderScene();
    if (!reducedMotion.matches)
      $("speech-row").animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 240,
        easing: "ease-out",
      });
  },
  settled: () => {
    renderScene();
  },
  waiting: () => {
    const next = nextSpeaker(world, {
      speakers: sceneSpeakers,
      shown: shownSpeakers,
    });
    if (!next) return;
    pendingSpeaker = next;
    awaitingNext = true;
    renderScene();
  },
  transition: (previous, next) => {
    if (reducedMotion.matches) return;
    const version = trip;
    return waitForScene([...exits.values()]).then(async () => {
      if (version !== trip || !exchange.active) return;
      if (next) {
        await $("speech-row")
          .animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: 220,
            easing: "ease-in",
          })
          .finished.catch(() => {});
      }
    });
  },
  busy: (value) => {
    clearTimeout(handTimer);
    cardsCooling = value || discoveryPending;
    updateCardCooldown();
    if (value && storyStatus === "pending")
      handTimer = setTimeout(releaseHand, HAND_WAIT);
    // A failed request releases the hand as well.
    if (!value) {
      pendingSpeaker = null;
      awaitingNext = false;
      renderScene();
      queueMicrotask(() => {
        if (availableCards(world).some((id) => !encountered.has(id)))
          queueDiscoveries();
      });
    }
  },
});
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const speechSounds = createSpeechSounds();
let completedSpokenLine = null;
function finishSpokenLine() {
  const line = completedSpokenLine;
  if (
    line &&
    line.key === speechKey &&
    line.seq === shownSceneLine?.seq &&
    !characterSpeech.busy
  )
    exchange.revealed(line.seq, line.text, line.instant);
}
const characterSpeech = createCharacterSpeech({
  changed: ({ state, message }) => {
    $("speech-row").dataset.voice = state;
    $("voice-retry").hidden = state !== "error";
    $("voice-status").textContent =
      state === "connect"
        ? "Connect OpenRouter below to hear character voices."
        : state === "error"
          ? message
          : state === "loading"
            ? "Preparing this character's voice…"
            : "";
    queueMicrotask(() => {
      syncSpeechPlayback();
      finishSpokenLine();
    });
  },
});
let soundEnabled = true;
try {
  soundEnabled = localStorage.getItem("cosyworld.dialogue.sound") !== "off";
} catch {}
speechSounds.setEnabled(soundEnabled);
characterSpeech.setEnabled(soundEnabled);
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
  $("next-line").disabled =
    complete && nextSceneSeq === null && !exchange.current;
}
const reveal = createTextReveal({
  reduced: () => reducedMotion.matches,
  sound: (...args) => {
    if (
      !document.hidden &&
      expressionOf(people[args[0]]) === "speech" &&
      !characterSpeech.speaks(args[0])
    )
      speechSounds.syllable(...args);
  },
  frame: (value) => {
    const text = $("dialogue-text");
    if (speechKey !== value.key) {
      speechKey = value.key;
      completedSpokenLine = null;
      shownLetters = 0;
      speechComplete = null;
      text.scrollTop = 0;
      speechSounds.stop();
      characterSpeech.show(value.key, value.speaker, value.text);
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
      $("speech-announcement").textContent = expressionLabel(
        { ...people[value.speaker], name: nameOf(value.speaker) },
        value.text,
      );
      updateSpeechControls(true);
      completedSpeech.add(value.key);
      if (completedSpeech.size > 100)
        completedSpeech.delete(completedSpeech.values().next().value);
      completedSpokenLine = { ...value, seq: shownSceneLine?.seq };
      finishSpokenLine();
      queueMicrotask(() => playQueue.flush());
    }
  },
});
reducedMotion.addEventListener("change", () => {
  if (reducedMotion.matches) {
    reveal.finish();
    speechSounds.stop();
    actionPanelMotion?.finish();
    for (const motion of handMotions.values()) motion.finish();
    for (const motion of $("unveil-take").getAnimations()) motion.finish();
  }
});
function syncSpeechPlayback() {
  const paused =
    document.hidden ||
    Boolean(document.querySelector("dialog[open], .world-menu:popover-open"));
  if (sharedSession)
    sharedPlayback.now(
      sharedSession.state,
      sharedSession.now(),
      world.actors[currentActor(world)].place,
      paused || (reveal.complete && characterSpeech.busy),
    );
  reveal.pause(paused);
  characterSpeech.pause(paused);
  exchange.pause(paused || characterSpeech.busy);
  return paused;
}
function pauseSpeech() {
  pauseDiscovery();
  const paused = syncSpeechPlayback();
  for (const animation of [
    ...$("cast").getAnimations({ subtree: true }),
    ...$("speech-row").getAnimations(),
  ]) {
    if (paused) animation.pause();
    else if (animation.playState === "paused") animation.play();
  }
  if (paused) speechSounds.stop();
  else {
    wakeDiscovery?.();
    queueMicrotask(() => playQueue.flush());
  }
}
document.addEventListener("visibilitychange", pauseSpeech);
document.addEventListener("shared-dialog-change", pauseSpeech);
function unlockSpeech() {
  speechSounds.unlock();
  characterSpeech.unlock();
}
document.addEventListener("pointerdown", unlockSpeech, {
  capture: true,
});
document.addEventListener("keydown", unlockSpeech, {
  capture: true,
});
function updateSoundButton() {
  $("speech-sound").textContent = `Voices: ${soundEnabled ? "on" : "off"}`;
  $("speech-sound").setAttribute("aria-pressed", String(soundEnabled));
}
$("speech-sound").onclick = () => {
  soundEnabled = !soundEnabled;
  speechSounds.setEnabled(soundEnabled);
  characterSpeech.setEnabled(soundEnabled);
  if (soundEnabled) unlockSpeech();
  try {
    localStorage.setItem(
      "cosyworld.dialogue.sound",
      soundEnabled ? "on" : "off",
    );
  } catch {}
  updateSoundButton();
};
updateSoundButton();
$("voice-retry").onclick = () => characterSpeech.retry();
document.addEventListener("openrouter-change", () =>
  characterSpeech.connectionChanged(),
);
let musicEnabled = true,
  musicVolume = 0.3;
function musicHasStarted() {
  return sharedSession
    ? sharedSession.state.music_started === true
    : world.turn > 0;
}
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
music.setStarted(musicHasStarted());
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
  early: Boolean(localRuntime()),
  request: localRuntime()
    ? (context, signal, progress) =>
        requestNarrative(context, signal, progress, "/card-game/text", true)
    : undefined,
  reflect: localRuntime()
    ? (context, signal) =>
        requestNarrative(context, signal, () => {}, "/card-game/reflections")
    : null,
  started: (context) => {
    if (context.turn === 0) dropOpeningFallback();
    if (localRuntime()) characterSpeech.clear();
    // A speaker who left this turn speaks at the destination, not here.
    sceneSpeakers = context.speakers.filter(
      (id) => world.actors[id]?.place === context.location,
    );
    shownSpeakers = [];
    awaitingNext = false;
    pendingSpeaker = nextSpeaker(world, { speakers: sceneSpeakers });
    renderScene();
  },
  apply: (next, { pending = false, reflection = false } = {}) => {
    world = next;
    save();
    if (reflection) {
      render();
      return;
    }
    storyStatus = pending ? "pending" : "ready";
    const lines = world.log.filter(
      (entry) =>
        entry.generated &&
        entry.kind === "dialogue" &&
        entry.turn === world.turn &&
        entry.locationId === world.actors[currentActor(world)].place,
    );
    if (localRuntime() && lines.length) {
      const line =
        lines.find((entry) => entry.seq !== exchange.current?.seq) || lines[0];
      characterSpeech.prefetch(line.actorId, line.text);
    }
    exchange.load(lines, { pending });
    render();
  },
  status: (value) => {
    storyStatus = value;
    if (value === "pending" && !exchange.active) exchange.begin();
    if (value === "retry") {
      exchange.cancel();
      showOpeningFallback();
    }
    renderScene();
  },
});
$("story-retry").onclick = async () => {
  if (storyRetrying) return;
  const room = world.actors[currentActor(world)].place;
  const retryKey = sharedSession
    ? sharedSpeechState(sharedSession.state, room).retryKey
    : null;
  if (sharedSession && !retryKey) return;
  const retryRevision = world.revision;
  const retryTrip = trip;
  storyRetrying = true;
  notice("");
  renderScene();
  try {
    if (sharedSession)
      await sharedSession.command({ op: "retry", key: retryKey });
    else await narrator.retry();
  } catch {
    if (world.revision === retryRevision && trip === retryTrip)
      storyStatus = "retry";
  } finally {
    storyRetrying = false;
    renderScene();
  }
};
// The row keeps a held item after a play, so its slots can change under a
// finger. A second tap on a slot redrawn by that play must not become a new
// play. Choosing a card ends the pause.
let lastPlayAt = -Infinity;
const SETTLE_MS = 500;
// A held item stays raised until it leaves the player's hands. An item that
// arrives in the player's hands through the play, such as the other side of a
// trade or a take, becomes the held item instead.
function heldSelection() {
  return {
    held: selected.filter((id) => selectedHandItem(world, [id])),
    hands: handItems(),
  };
}
function handItems() {
  const actor = currentActor(world);
  return Object.keys(world.items).filter(
    (id) => world.items[id].holder === actor && selectedHandItem(world, [id]),
  );
}
function keepHeldSelection(before, action = null) {
  const actor = currentActor(world);
  const arrived = handItems().filter((id) => !before.hands.includes(id));
  const received =
    [action?.receive, action?.item].find((id) => arrived.includes(id)) ||
    arrived.at(-1);
  const held = received
    ? [received]
    : before.held.filter((id) => selectedHandItem(world, [id]));
  const keepActor = held.length > 0 && selected.includes(actor);
  const expanded = keepActor && expandedHolders.has(actor);
  selected = keepActor ? [actor, ...held] : held;
  expandedHolders.clear();
  if (expanded) expandedHolders.add(actor);
}
function selectCards(cards) {
  for (const id of selected)
    if (people[id] && !cards.includes(id)) expandedHolders.delete(id);
  // A place stays open, and raised, only while it is chosen or holds a
  // chosen thing.
  for (const id of expandedHolders)
    if (
      places[id] &&
      !cards.includes(id) &&
      !cards.some((card) => things[card] && rootHolder(world, card) === id)
    )
      expandedHolders.delete(id);
  selected = cards;
}
function choose(id) {
  if (selectionBlocked()) return;
  playQueue.clear();
  lastPlayAt = -Infinity;
  fresh.delete(id);
  // Any tap opens a folded row again; the held item is still raised.
  rowCollapsed = false;
  if (places[id] && expandedHolders.has(id)) {
    expandedHolders.delete(id);
    selectCards(
      selected.filter(
        (cardId) =>
          cardId !== id &&
          (!things[cardId] || rootHolder(world, cardId) !== id),
      ),
    );
  } else {
    const holder = things[id] ? rootHolder(world, id) : null;
    if (places[holder])
      selected = selected.filter((cardId) => cardId !== holder);
    selectCards(
      selected.includes(id)
        ? selected.filter((cardId) => cardId !== id)
        : selected.length >= 2
          ? selected.includes(holder)
            ? selected.map((cardId) => (cardId === holder ? id : cardId))
            : selectedHandItem(world, selected)
              ? [selectedHandItem(world, selected), id]
              : [id]
          : [...selected, id],
    );
  }
  selectionRevision = world.revision;
  render();
  $("hand")
    .querySelector(`[data-card="${id}"]`)
    ?.focus({ preventScroll: true });
  revealHandCard(id, Boolean(people[id]));
}
function commit(cards, revision) {
  if (selectionBlocked()) return;
  const resolved = cardPlay(world, cards);
  if (!resolved.action) {
    $("play-readout").textContent = "That cannot be used here.";
    return;
  }
  commitAction(resolved.action, revision);
}
function commitAction(action, revision, renderedAt = -Infinity) {
  if (selectionBlocked()) return;
  if (renderedAt >= lastPlayAt && performance.now() - lastPlayAt < SETTLE_MS)
    return;
  if (playQueue.pending?.action.key === action.key) playQueue.clear();
  else playQueue.submit(action, revision);
}
function performAction(action, revision) {
  if (saveBlocked || sharedSession) return;
  const result = play(world, action, revision);
  if (!result.ok) {
    notice(result.error);
    render();
    return;
  }
  reveal.finish();
  speechSounds.stop();
  cancelTravel();
  narrator.invalidate();
  exchange.cancel();
  storyStatus = "pending";
  const from = world.actors[currentActor(world)].place;
  const heldBefore = heldSelection();
  world = result.state;
  music.setRoom(world.actors[currentActor(world)].place);
  music.setStarted(musicHasStarted());
  music.unlock();
  // A new play ends any review of earlier lines.
  reviewing = false;
  dragging = [];
  $("stage").classList.remove("ready", "drag-over");
  exchange.begin();
  lastPlayAt = performance.now();
  keepHeldSelection(heldBefore, action);
  lineSeq = null;
  notice("");
  save();
  if (world.actors[currentActor(world)].place !== from)
    travel(world.actors[currentActor(world)].place, render, render);
  else {
    render();
  }
  discoveryDone = unveilNew();
  narrator.changed(action);
}

// Moving between places dips the scene to dark with the destination's name,
// so a change of place is always seen, whatever caused it. The new place is
// drawn only once the veil is fully down, and the veil lifts only once the new
// backdrop and portraits have loaded, so the swap is never seen.
const TRAVEL_HOLD = 700,
  TRAVEL_WAIT = 4000;
let covering = false,
  trip = 0,
  travelShown = Promise.resolve(),
  revealTravel = () => {};
function cancelTravel() {
  trip++;
  cancelDiscovery();
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
  for (const figure of exits.keys()) {
    for (const animation of figure.getAnimations()) animation.cancel();
    if (figure.dataset.removing) figure.remove();
  }
  exits.clear();
  renderedCast = "";
  for (const animation of $("speech-row").getAnimations()) animation.cancel();
}
// Cards met at the new place are unveiled once the veil has fully lifted.
async function travel(place, arrive, landed) {
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
  // The browser may start a CSS transition on a later frame. Wait for its
  // completion so each scene change stays covered at every rendering speed.
  await Promise.allSettled(veil.getAnimations().map((a) => a.finished));
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
  await Promise.allSettled(veil.getAnimations().map((a) => a.finished));
  if (mine !== trip) return;
  revealTravel();
  landed();
}

let discoveryTimer = null,
  discoveryDue = 0,
  discoveryRemaining = 0;
let endDiscovery = null,
  wakeDiscovery = null,
  discoveryFlying = false;
function cancelDiscovery() {
  discoveryPending = false;
  wakeDiscovery?.();
  wakeDiscovery = null;
  clearTimeout(discoveryTimer);
  discoveryTimer = null;
  discoveryRemaining = 0;
  for (const animation of $("unveil-take").getAnimations()) animation.cancel();
  $("unveil-dialog").close();
  $("unveil-take").replaceChildren();
  delete $("unveil-take").dataset.card;
  endDiscovery?.();
  endDiscovery = null;
  discoveryFlying = false;
}
function discoveryPaused() {
  return (
    document.hidden ||
    [
      ...document.querySelectorAll("dialog[open], .world-menu:popover-open"),
    ].some((dialog) => dialog.id !== "unveil-dialog")
  );
}
function armDiscovery(delay) {
  clearTimeout(discoveryTimer);
  discoveryRemaining = delay;
  discoveryDue = performance.now() + delay;
  discoveryTimer = discoveryPaused() ? null : setTimeout(takeDiscovered, delay);
}
function pauseDiscovery() {
  if (!$("unveil-dialog").open) return;
  const paused = discoveryPaused();
  if (paused && discoveryTimer !== null) {
    discoveryRemaining = Math.max(0, discoveryDue - performance.now());
    clearTimeout(discoveryTimer);
    discoveryTimer = null;
  } else if (!paused && !discoveryFlying) armDiscovery(discoveryRemaining);
  for (const animation of $("unveil-take").getAnimations()) {
    if (paused) animation.pause();
    else if (animation.playState === "paused") animation.play();
  }
}
document.addEventListener("visibilitychange", pauseDiscovery);
function discoveryAnchor(id) {
  const find = (key) => $("hand").querySelector(`[data-card="${key}"]`);
  let target = find(id);
  const visited = new Set();
  while (target) {
    const frame = target.closest(".card-frame");
    if (!frame.hidden) return target;
    const owner = frame.dataset.holder || rootHolder(world, id);
    if (!owner || visited.has(owner)) break;
    visited.add(owner);
    target = find(owner);
  }
  return null;
}
async function flyCard(shown, target) {
  if (!target || reducedMotion.matches) return;
  const hand = $("hand"),
    visible = hand.getBoundingClientRect();
  const cardBounds = target.getBoundingClientRect();
  hand.scrollLeft +=
    cardBounds.left < visible.left
      ? cardBounds.left - visible.left
      : cardBounds.right > visible.right
        ? cardBounds.right - visible.right
        : 0;
  const start = shown.getBoundingClientRect(),
    end = target.getBoundingClientRect();
  const centered = { transform: "translate(0, 0) scale(1)", opacity: 1 };
  const held = {
    transform: `translate(${end.x - start.x}px, ${end.y - start.y}px) scale(${end.width / start.width}, ${end.height / start.height})`,
    opacity: 0.65,
  };
  $("unveil-dialog").dataset.phase = "flight";
  const animation = shown.animate([centered, held], {
    duration: 480,
    easing: "cubic-bezier(.3,.05,.4,1)",
    fill: "forwards",
  });
  pauseDiscovery();
  await animation.finished.catch(() => {});
  animation.cancel();
}
async function takeDiscovered() {
  if (!endDiscovery || discoveryFlying) return;
  clearTimeout(discoveryTimer);
  discoveryTimer = null;
  discoveryFlying = true;
  const version = trip,
    done = endDiscovery;
  const dialog = $("unveil-dialog"),
    shown = $("unveil-take");
  await flyCard(shown, discoveryAnchor(shown.dataset.card));
  if (version !== trip || done !== endDiscovery) return;
  dialog.close();
  shown.replaceChildren();
  delete shown.dataset.card;
  endDiscovery = null;
  discoveryFlying = false;
  done();
}
$("unveil-take").onclick = takeDiscovered;
$("unveil-dialog").addEventListener("click", (event) => {
  if (event.target === $("unveil-dialog")) void takeDiscovered();
});
$("unveil-dialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  void takeDiscovered();
});
async function showDiscovered(id, version, announcement) {
  const shown = card(id);
  shown.hidden = false;
  shown.removeAttribute("data-holder");
  shown.dataset.raised = "false";
  shown
    .querySelectorAll(".held-preview, .sr-only")
    .forEach((el) => el.remove());
  const face = shown.querySelector(".card"),
    display = node("span", undefined, face.className);
  for (const attr of face.attributes)
    if (attr.name.startsWith("data-"))
      display.setAttribute(attr.name, attr.value);
  display.append(...face.childNodes);
  face.replaceWith(display);
  shown
    .querySelectorAll("[id]")
    .forEach((element) => element.removeAttribute("id"));
  await waitForScene(
    [...shown.querySelectorAll("img")].map((img) => img.decode()),
    1500,
  );
  while (
    version === trip &&
    (document.hidden ||
      document.querySelector("dialog[open], .world-menu:popover-open"))
  ) {
    await new Promise((resolve) => {
      wakeDiscovery = resolve;
    });
    wakeDiscovery = null;
  }
  if (version !== trip) return;
  const dialog = $("unveil-dialog"),
    button = $("unveil-take");
  button.dataset.card = id;
  button.setAttribute("aria-label", `${announcement} Add to hand.`);
  button.replaceChildren(shown);
  dialog.dataset.phase = "reveal";
  dialog.dataset.direction = "discover";
  dialog.setAttribute("aria-label", "New card discovered");
  const finished = new Promise((resolve) => {
    endDiscovery = resolve;
  });
  dialog.showModal();
  $("discovery-announcement").textContent = announcement;
  pauseSpeech();
  armDiscovery(reducedMotion.matches ? 700 : 1400);
  await finished;
}
function queueDiscoveries() {
  const version = trip;
  discoveryDone = discoveryDone
    .catch(() => {})
    .then(() => (version === trip ? unveilNew() : undefined));
}

async function unveilNew() {
  if (saveBlocked) return;
  const rank = { avatar: 0, item: 1, location: 2 };
  const found = availableCards(world)
    .filter((id) => !encountered.has(id))
    .sort((a, b) => rank[cardType(a)] - rank[cardType(b)]);
  if (!found.length) return;
  for (const id of found) {
    encountered.add(id);
    fresh.add(id);
  }
  rememberCards();
  discoveryPending = true;
  cardsCooling = true;
  render();
  const version = trip;
  try {
    await prepareStage();
    for (const id of found) {
      if (
        document.hidden ||
        document.querySelector("dialog[open], .world-menu:popover-open")
      ) {
        await new Promise((resolve) => {
          wakeDiscovery = resolve;
        });
        wakeDiscovery = null;
      }
      if (version !== trip) return;
      await showDiscovered(id, version, `${nameOf(id)} discovered.`);
    }
  } finally {
    if (version === trip) {
      discoveryPending = false;
      if (!exchange.active) {
        cardsCooling = false;
        updateCardCooldown();
        renderScene();
      }
    }
  }
}

const figures = new Map();
function frameFigure(img) {
  const apply = (f) => {
    img.style.setProperty("--figure-top", f.top);
    img.style.setProperty("--figure-height", f.height);
    img.style.setProperty("--head-x", f.headX);
    img.style.setProperty("--portrait-crop", f.portraitCrop);
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
        portraitCrop: img.naturalHeight / img.naturalWidth < 1.25 ? 0.85 : 0.3,
      });
    }
    apply(figures.get(img.src));
  };
  if (img.complete && img.naturalWidth) measure();
  else img.addEventListener("load", measure, { once: true });
}
function sharedQueuePortrait(actor) {
  const image = node("img");
  image.decoding = "async";
  image.src = imageUrl(portrait(actor, null, world), "card");
  image.alt = "";
  frameFigure(image);
  return image;
}
function renderActions(animate = false) {
  const row = $("card-actions"),
    panel = document.querySelector(".action-panel"),
    fromHeight = panel.getBoundingClientRect().height;
  actionPanelMotion?.cancel();
  actionPanelMotion = null;
  const { actions, hint } = cardActions(world, selected);
  const selectionName = selected.map(nameOf).join(" + ");
  $("selection-name").textContent = selected.length
    ? selectionName
    : "Card actions";
  panel.hidden = !actions.length;
  document.querySelector(".play-dock").dataset.selected = String(
    selected.length > 0,
  );
  document.body.dataset.handExpanded = String(
    dragging.length > 0 ||
      (!rowCollapsed && (selected.length > 0 || expandedHolders.size > 0)),
  );
  const revision = world.revision;
  const nudgeTarget =
    sharedSession &&
    selected.find(
      (id) => id !== currentActor(world) && world.presentActors?.includes(id),
    );
  row.replaceChildren(
    ...actions.map((action, index) => {
      const queued = playQueue.pending?.action.key === action.key;
      const button = node(
        "button",
        queued ? `Queued: ${playLabel(action)}` : playLabel(action),
        index === 0 ? "card-primary" : "card-action",
      );
      button.type = "button";
      button.dataset.action = action.kind;
      button.dataset.queued = String(queued);
      button.title = queued ? "Cancel this queued play" : action.text;
      button.disabled = selectionBlocked();
      button.setAttribute("aria-pressed", String(queued));
      if (action.choiceId) {
        button.dataset.choice = action.choiceId;
        button.dataset.pack = action.packId;
      }
      const renderedAt = performance.now();
      button.onclick = () => commitAction(action, revision, renderedAt);
      return button;
    }),
  );
  if (nudgeTarget) {
    const nudge = node("button", "Nudge", "card-action");
    nudge.type = "button";
    nudge.onclick = () =>
      sharedSession
        .command({ op: "nudge", target: nudgeTarget })
        .catch((error) => notice(error.message));
    row.append(nudge);
    panel.hidden = false;
  }
  if (animate) {
    const toHeight = panel.getBoundingClientRect().height;
    if (Math.abs(fromHeight - toHeight) > 1) {
      panel.hidden = false;
      const motion = panel.animate(
        { height: [`${fromHeight}px`, `${toHeight}px`] },
        { duration: 220, easing: "ease-out" },
      );
      actionPanelMotion = motion;
      motion.finished
        .then(() => {
          if (actionPanelMotion !== motion) return;
          actionPanelMotion = null;
          panel.hidden = !row.children.length;
        })
        .catch(() => {});
    }
  }
  $("play-readout").textContent = selected.length
    ? `${selectionName}. ${actions.map(playLabel).join(". ") || hint}`
    : "";
}
function updateCardSelection(frame) {
  const button = frame.querySelector(".card"),
    id = button.dataset.card,
    raised =
      selected.includes(id) || Boolean(places[id] && expandedHolders.has(id)),
    label = raised ? playLabel(cardPlay(world, selected).action) : "",
    held =
      people[id] || places[id]
        ? availableCards(world).filter(
            (item) => things[item] && rootHolder(world, item) === id,
          )
        : [];
  frame.dataset.raised = String(raised);
  button.setAttribute("aria-pressed", String(raised));
  button.classList.toggle("new", fresh.has(id));
  if (frame.dataset.holder)
    frame.hidden = places[frame.dataset.holder]
      ? !expandedHolders.has(frame.dataset.holder)
      : !raised && !expandedHolders.has(frame.dataset.holder);
  if (held.length) {
    frame.dataset.expanded = String(expandedHolders.has(id));
    button.setAttribute("aria-expanded", String(expandedHolders.has(id)));
  }
  button.querySelector(".sr-only").textContent =
    cardObservation(world, id) +
    (label ? ` ${label}.` : "") +
    (held.length
      ? ` ${places[id] ? "Contains" : "Carries"} ${held.map(nameOf).join(", ")}. Select to show these cards.`
      : "");
}
const handMotions = new Map();
function moveHandPart(key, element, frames) {
  const motion = element.animate(frames, { duration: 220, easing: "ease-out" });
  handMotions.set(key, motion);
  motion.finished
    .then(() => {
      if (handMotions.get(key) === motion) handMotions.delete(key);
    })
    .catch(() => {});
}
function card(id) {
  const type = cardType(id),
    base = places[id] || people[id] || things[id],
    crossingFace = type === "location" ? travelCard(world, id) : null,
    def = crossingFace ? { ...base, name: crossingFace.name } : base;
  const raised =
    selected.includes(id) || Boolean(places[id] && expandedHolders.has(id));
  const chosen = raised ? cardPlay(world, selected) : null;
  const el = node("button", undefined, `card ${type}`);
  el.type = "button";
  el.classList.toggle("new", fresh.has(id));
  el.dataset.card = id;
  el.disabled = selectionBlocked();
  el.setAttribute("aria-pressed", String(raised));
  el.setAttribute("aria-label", `${def.name}, ${type}`);
  el.setAttribute("aria-describedby", `card-detail-${id}`);
  const graphic = node("span", undefined, "art");
  const img = node("img");
  img.decoding = "async";
  img.fetchPriority = "low";
  img.src = imageUrl(
    type === "item"
      ? packMedia(id, "art") || `./assets/${id}-card.png`
      : type === "avatar"
        ? portrait(id, null, world)
        : crossingFace?.art ||
          (packPlaces[id]?.art ? packMedia(id, "art") : backdrop(id, world)),
    "card",
  );
  img.alt = "";
  img.draggable = false;
  if (type === "avatar") frameFigure(img);
  graphic.append(img);
  if (type === "location") {
    graphic.dataset.timeOfDay = locationDaylight(world, id)?.phase || "day";
    renderWeather(graphic, locationWeather(world, id));
    el.dataset.locationVariant = locationVariant(world, id);
    const src = locationOverlay(world, id);
    if (src) {
      const overlay = node("img", undefined, "location-overlay");
      overlay.src = imageUrl(src, "card");
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
      cloth.decoding = "async";
      cloth.src = imageUrl(
        packMedia(covering, "art") || `./assets/${covering}-card.png`,
        "card",
      );
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
    if (selectionBlocked()) {
      e.preventDefault();
      return;
    }
    dragging = selected.includes(id) ? [...selected] : [id];
    renderActions();
    selectionRevision = world.revision;
    e.dataTransfer.setData("text/plain", JSON.stringify(dragging));
    e.dataTransfer.effectAllowed = "move";
    $("stage").dataset.play = playLabel(cardPlay(world, dragging).action) || "";
    $("stage").classList.add("ready");
  });
  el.addEventListener("dragend", () => {
    dragging = [];
    renderActions();
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
    if (!selectionBlocked() && dragging.length && !dragging.includes(id)) {
      playQueue.clear();
      selectCards([dragging[0], id]);
      selectionRevision = world.revision;
      render();
    }
    dragging = [];
    $("stage").classList.remove("ready", "drag-over");
  });
  const frame = node("div", undefined, "card-frame");
  frame.dataset.raised = String(raised);
  frame.append(el);
  const holder = things[id] ? rootHolder(world, id) : null;
  if (people[holder] || places[holder]) {
    frame.dataset.holder = holder;
    frame.hidden = places[holder]
      ? !expandedHolders.has(holder)
      : !raised && !expandedHolders.has(holder);
    el.setAttribute(
      "aria-label",
      `${def.name}, ${places[holder] ? "at" : "carried by"} ${nameOf(holder)}`,
    );
  }
  if (people[id] || places[id]) {
    const held = availableCards(world).filter(
      (item) => things[item] && rootHolder(world, item) === id,
    );
    if (held.length) {
      frame.dataset.inventory = String(held.length);
      frame.dataset.expanded = String(expandedHolders.has(id));
      el.setAttribute("aria-expanded", String(expandedHolders.has(id)));
      if (held.length)
        observation.textContent += ` ${places[id] ? "Contains" : "Carries"} ${held.map(nameOf).join(", ")}. Select to show these cards.`;
      for (const item of held.slice(0, 2)) {
        const preview = node("img", undefined, "held-preview");
        preview.decoding = "async";
        preview.src = imageUrl(
          packMedia(item, "art") || `./assets/${item}-card.png`,
          "card",
        );
        preview.alt = "";
        preview.draggable = false;
        frame.prepend(preview);
      }
    }
  }
  return frame;
}
function renderStage(locationId) {
  const pack = packOf(locationId);
  const stage = packPlaces[locationId]?.stage;
  document.body.dataset.world = pack?.id || "shore";
  document.body.dataset.place = locationId;
  document.body.dataset.lamplit = String(
    shining(world) && itemPlace(world, "lamp") === locationId,
  );
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
    background.decoding = "async";
    background.fetchPriority = "high";
    background.src = imageUrl(backdrop(locationId, world));
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
    const source = imageUrl(portrait(stage.resident, null, world));
    sprite.decoding = "async";
    sprite.fetchPriority = "high";
    if (sprite.getAttribute("src") !== source) sprite.src = source;
    sprite.dataset.state = mood?.name || "present";
    sprite.alt = mood?.alt || nameOf(stage.resident);
  }
}
function leaveFigure(figure, remove = false) {
  if (exits.has(figure)) return;
  if (remove) figure.dataset.removing = "true";
  figure.setAttribute("aria-hidden", "true");
  if (reducedMotion.matches || $("travel").classList.contains("travelling")) {
    if (remove) figure.remove();
    return;
  }
  const animation = figure.animate(
    [
      { opacity: 1, translate: "0 0" },
      {
        opacity: 0,
        translate: `${figure.style.getPropertyValue("--exit-x")} 0`,
      },
    ],
    { duration: 850, easing: "ease-in-out", fill: "forwards" },
  );
  const task = animation.finished
    .catch(() => {})
    .then(() => {
      if (exits.get(figure) !== task) return;
      if (remove) figure.remove();
      animation.cancel();
      exits.delete(figure);
    });
  exits.set(figure, task);
}
function returnToLive() {
  sharedPlayback.reset();
  reviewing = false;
  lineSeq = null;
  sharedLineKey = "";
  syncSharedLine();
  renderScene();
  if (!$("dialogue-advance").hidden) $("dialogue-advance").focus();
}
function renderHeldItem(figure, actor, itemId) {
  let preview = figure.querySelector(".portrait-held-item");
  figure.setAttribute(
    "aria-label",
    itemId ? `${nameOf(actor.id)} holds ${nameOf(itemId)}` : nameOf(actor.id),
  );
  if (!itemId) {
    preview?.remove();
    return;
  }
  if (!preview) {
    preview = node("span", undefined, "portrait-held-item");
    preview.setAttribute("aria-hidden", "true");
    figure.querySelector(".portrait-body").append(preview);
  }
  const item = world.items[itemId];
  const covering = Object.keys(world.items).find(
    (id) => world.items[id].holder === itemId,
  );
  const key = JSON.stringify([itemId, covering]);
  if (preview.dataset.key !== key) {
    const images = [itemId, covering].filter(Boolean).map((id, index) => {
      const image = node("img", undefined, index ? "object-cover" : "");
      image.decoding = "async";
      image.src = imageUrl(
        packMedia(id, "art") || `./assets/${id}-card.png`,
        "card",
      );
      image.alt = "";
      image.draggable = false;
      return image;
    });
    preview.replaceChildren(...images);
    preview.dataset.key = key;
  }
  preview.dataset.item = itemId;
  preview.dataset.lit = String(item.lit ?? "");
  preview.dataset.covered = String(Boolean(covering));
  preview.dataset.ringing = String(item.ringing > 0 && !covering);
}

// Things lying here rest on the floor in the hand's card style. They are
// pictures only; the hand cards remain the way to play them.
function renderFloorItems(items) {
  const floor = $("floor-items");
  const existing = new Map(
    [...floor.children].map((el) => [el.dataset.item, el]),
  );
  floor.dataset.count = String(items.length);
  floor.replaceChildren(
    ...items.map(({ id, cover, lit, ringing }) => {
      let tile = existing.get(id);
      if (!tile) {
        tile = node("span", undefined, "floor-item");
        tile.dataset.item = id;
        tile.append(node("span", undefined, "art"));
      }
      const key = JSON.stringify([id, cover]);
      if (tile.dataset.key !== key) {
        tile.dataset.key = key;
        tile.firstChild.replaceChildren(
          ...[id, cover].filter(Boolean).map((art, index) => {
            const image = node("img", undefined, index ? "object-cover" : "");
            image.decoding = "async";
            image.src = imageUrl(
              packMedia(art, "art") || `./assets/${art}-card.png`,
              "card",
            );
            image.alt = "";
            image.draggable = false;
            return image;
          }),
        );
      }
      tile.dataset.lit = lit === undefined ? "" : String(lit);
      tile.dataset.covered = String(Boolean(cover));
      tile.dataset.ringing = String(Boolean(ringing));
      return tile;
    }),
  );
}

function renderScene() {
  // Every path to this renderer keeps the source visible until the veil covers it.
  if (covering) return;
  const scene = currentScene(world, null, {
    seq: lineSeq,
    hold: exchange.preparing,
    review: reviewing || Boolean(sharedSession),
  });
  renderStage(scene.locationId);
  // The hand and physical stage always show this same committed world.
  // Reviewing a line changes the words while present people keep their places.
  const resolvedBeat = exchange.preparing || scene.line?.turn !== world.turn;
  scene.slots = sceneCast(world);
  videoScene = scene;
  $("stage").dataset.presentedRevision = String(world.revision);
  shownSceneLine = scene.line;
  const img = $("backdrop");
  const background = imageUrl(scene.background);
  if (img.getAttribute("src") !== background) img.src = background;
  img.alt = placeText(world, scene.locationId);
  if (scene.weather) img.alt += ` ${scene.weather.description}`;
  if (scene.daylight) img.alt += ` ${scene.daylight.description}`;
  img.dataset.locationVariant = scene.variant;
  $("stage").dataset.timeOfDay = scene.daylight?.phase || "day";
  renderWeather($("stage"), scene.weather);
  let overlay = $("location-overlay");
  if (scene.overlay && !overlay) {
    overlay = node("img", undefined, "backdrop location-overlay");
    overlay.id = "location-overlay";
    overlay.style.pointerEvents = "none";
    img.after(overlay);
  }
  if (overlay) {
    overlay.hidden = !scene.overlay;
    const overlaySource = imageUrl(scene.overlay);
    if (scene.overlay && overlay.getAttribute("src") !== overlaySource)
      overlay.src = overlaySource;
    overlay.alt = scene.overlay ? placeText(world, scene.locationId) : "";
  }
  const staging = sceneStaging(world, {
    through: world.log.length - 1,
    cast: scene.slots,
    line: resolvedBeat ? null : scene.line,
    activeSpeaker: resolvedBeat ? null : scene.activeSpeaker,
    review: true,
    currentState: true,
    sharedPlays: sharedSession?.state.history,
  });
  renderFloorItems(staging.floorItems);
  $("cast").dataset.layout = staging.layout;
  $("cast").dataset.count = String(staging.actors.length);
  $("cast").dataset.shared = String(Boolean(sharedSession));
  $("cast").style.setProperty("--cast-count", String(staging.actors.length));
  const castKey = JSON.stringify(staging.actors.map(({ id }) => id));
  const handItem = selectedHandItem(world, selected);
  if (castKey !== renderedCast) {
    renderedCast = castKey;
    const existing = new Map(
      [...$("cast").children].map((el) => [el.dataset.avatar, el]),
    );
    const removed = [...existing.values()].filter(
      (figure) =>
        !staging.actors.some(({ id }) => id === figure.dataset.avatar),
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
      ...removed,
    );
    for (const figure of removed) leaveFigure(figure, true);
  }
  staging.actors.forEach((actor, index) => {
    const { id } = actor;
    const figure = $("cast").children[index];
    if (
      figure.dataset.removing ||
      (exits.has(figure) && actor.presence !== "departed")
    ) {
      // A returning actor keeps this figure after its earlier farewell.
      exits.delete(figure);
      delete figure.dataset.removing;
      for (const animation of figure.getAnimations()) animation.cancel();
    }
    figure.dataset.depth = actor.depth;
    figure.dataset.framing = portraitFraming(actor.cutout);
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
    const source = imageUrl(actor.cutout);
    image.decoding = "async";
    image.fetchPriority = "high";
    if (image.getAttribute("src") !== source) image.src = source;
    image.dataset.flip = String(flipStagePortrait(actor.cutout, actor.facing));
    figure.dataset.flip = image.dataset.flip;
    renderHeldItem(figure, actor, id === currentActor(world) ? handItem : null);
    figure.classList.toggle(
      "active",
      scene.activeSpeaker === id && !resolvedBeat,
    );
    const left = actor.presence === "departed";
    const wasLeft = figure.classList.contains("departed");
    figure.classList.toggle("departed", left);
    if (left && !wasLeft && !reviewing) leaveFigure(figure);
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
                  duration: 850,
                  delay:
                    id !== currentActor(world) &&
                    !actor.movement.companions.includes(currentActor(world))
                      ? index * 420
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
  const sharedSpeech = sharedSession
    ? sharedSpeechState(sharedSession.state, scene.locationId)
    : null;
  if (sharedSpeech) storyStatus = sharedSpeech.status;
  const waitingSpeaker =
    sharedSpeech?.status === "pending"
      ? nextSpeaker(world, {
          actor: sharedSession.state.queue.find(
            (entry) => entry.status === "working",
          )?.actor,
        })
      : pendingSpeaker;
  const spoken =
    isSceneText(scene.line, Boolean(sharedSession)) &&
    !(awaitingNext && !reviewing) &&
    (reviewing ||
      scene.line.turn === world.turn ||
      (sharedSession && storyStatus !== "pending"));
  $("speaker").textContent = spoken
    ? scene.line.speaker
    : waitingSpeaker
      ? nameOf(waitingSpeaker)
      : "";
  const movement = reviewing || !cardsCooling ? "" : movementCaption(world);
  $("movement-caption").textContent = movement;
  $("movement-caption").hidden = !movement;
  const wordsFailed = storyStatus === "retry";
  const canRetryWords = !sharedSession || Boolean(sharedSpeech.retryKey);
  $("story-status").hidden =
    wordsFailed || (storyStatus === "ready" && !exchange.preparing);
  $("story-status").setAttribute("aria-label", "Thinking about this scene");
  $("speech-row").setAttribute("aria-busy", String(!$("story-status").hidden));
  const retryWords = $("story-retry");
  retryWords.hidden = !wordsFailed;
  retryWords.disabled = storyRetrying || !canRetryWords;
  retryWords.title = canRetryWords ? "Retry dialogue" : "Waiting for dialogue";
  retryWords.setAttribute("aria-label", retryWords.title);
  const portraitId = spoken
    ? scene.line.entityId || scene.line.actorId || scene.locationId
    : waitingSpeaker;
  const portraitBox = $("speaker-portrait");
  if (portraitBox.dataset.entity !== (portraitId || "")) {
    portraitBox.dataset.entity = portraitId || "";
    portraitBox.replaceChildren();
    if (portraitId) {
      const image = node("img");
      image.alt = "";
      image.decoding = "async";
      image.src = imageUrl(
        people[portraitId]
          ? portrait(portraitId, null, world)
          : places[portraitId]
            ? backdrop(portraitId, world)
            : packMedia(portraitId, "art") || `./assets/${portraitId}-card.png`,
        "card",
      );
      portraitBox.dataset.kind = people[portraitId] ? "avatar" : "scene";
      if (people[portraitId]) frameFigure(image);
      portraitBox.append(image);
    }
  }
  const text = spoken ? scene.line.text : "";
  const speaker =
    scene.line?.entityId || scene.line?.actorId || scene.locationId;
  const spokenLines = scene.lines.filter((entry) =>
    isSceneText(entry, Boolean(sharedSession)),
  );
  const at = spokenLines.findIndex(
    (entry) => entry.index === scene.line?.index,
  );
  nextSceneSeq =
    at >= 0 && at < spokenLines.length - 1 ? spokenLines[at + 1].seq : null;
  if (exchange.active) nextSceneSeq = exchange.hasNext ? nextSceneSeq : null;
  // Keep failures visible even when this scene has no earlier words.
  const hasSpeech = Boolean(
    text || storyStatus !== "ready" || exchange.preparing,
  );
  document.querySelector(".dialogue").hidden =
    !hasSpeech && !movement && !sharedSession?.state.queue?.length;
  $("speech-row").hidden = !hasSpeech;
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
    completedSpokenLine = null;
    speechSounds.stop();
    characterSpeech.clear({
      keepPrefetch: Boolean(localRuntime() && exchange.preparing),
    });
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
      characterSpeech.stop();
      syncSpeechPlayback();
      finishSpokenLine();
      exchange.advance();
      return;
    }
    if (nextSceneSeq !== null) lineSeq = nextSceneSeq;
    else replay++;
    // Reading through the latest shared line rejoins the room's live clock.
    reviewing = !sharedSession || lineSeq !== spokenLines.at(-1)?.seq;
    renderScene();
  };
  $("dialogue-advance").onclick = advance;
  $("dialogue-advance").onkeydown = (event) => {
    const amount = {
      ArrowDown: 28,
      ArrowUp: -28,
      PageDown: speechHeight,
      PageUp: -speechHeight,
    }[event.key];
    if (amount !== undefined) {
      event.preventDefault();
      $("dialogue-text").scrollTop += amount;
    } else if (["Home", "End"].includes(event.key)) {
      event.preventDefault();
      $("dialogue-text").scrollTop =
        event.key === "Home" ? 0 : $("dialogue-text").scrollHeight;
    }
  };
  $("next-line").onclick = advance;
  const liveButton = $("live-line");
  liveButton.hidden = !sharedSession;
  if (sharedSession) {
    const actor = sharedNextActor(
      sharedSession.state,
      sharedSession.now(),
      scene.locationId,
    );
    liveButton.dataset.live = String(!reviewing);
    liveButton.title = `Return to live dialogue · ${nameOf(actor)}`;
    liveButton.setAttribute("aria-label", liveButton.title);
    if (liveButton.dataset.actor !== actor) {
      liveButton.dataset.actor = actor;
      liveButton.replaceChildren(sharedQueuePortrait(actor));
    }
    const live = sharedLiveLine(
      sharedSession.state,
      sharedSession.now(),
      scene.locationId,
    );
    const matchesLive =
      !live ||
      (live.seq
        ? scene.line?.seq === live.seq
        : scene.line?.text === live.text &&
          scene.line?.speaker === live.speaker);
    const mergedPortrait = Boolean(
      sharedSession.state.queue?.some((entry) => entry.actor === actor),
    );
    liveButton.hidden = mergedPortrait;
    liveButton.dataset.returnLive = "true";
    liveButton.onclick = returnToLive;
    renderSharedQueue(sharedSession, sharedQueuePortrait, {
      liveActor: mergedPortrait ? actor : null,
      needsLive: reviewing || !matchesLive,
      onLive: returnToLive,
    });
  }
}
let renderedLog = [];
function renderLog() {
  const box = $("messages");
  const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  // Shared rooms include generated room details in their conversation record.
  const conversation = world.log.filter(
    (entry) =>
      isSceneText(entry, Boolean(sharedSession)) &&
      entry.generated === true &&
      (!sharedSession ||
        entry.locationId === world.actors[currentActor(world)].place),
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
  renderPlayers();
  music.setStarted(musicHasStarted());
  // While the travel veil comes down, the old place stays drawn.
  if (covering) return;
  music.setRoom(world.actors[currentActor(world)].place);
  const focused = document.activeElement?.dataset.card,
    scroll = $("hand").scrollLeft;
  $("hand").dataset.presentedRevision = String(world.revision);
  $("place-title").textContent = nameOf(
    world.actors[currentActor(world)].place,
  );
  if (rowCollapsed) expandedHolders.clear();
  else
    for (const id of selected) {
      if (people[id] || places[id]) expandedHolders.add(id);
    }
  const handCards = availableCards(world);
  // Published speech can unlock cards and plays during the current turn.
  const handState = JSON.stringify([
    handCards,
    legalActions(world).map((action) => action.key),
  ]);
  const handKey = JSON.stringify([
    world.revision,
    handState,
    selected,
    [...expandedHolders],
    [...fresh],
    saveBlocked,
    rowCollapsed,
  ]);
  if (handKey !== renderedHand) {
    const sameWorld =
        renderedHand &&
        renderedHandRevision === world.revision &&
        renderedHandState === handState,
      samePlace =
        renderedHand &&
        renderedHandPlace === world.actors[currentActor(world)].place,
      arriving = renderedHandPlace !== null && !samePlace,
      animate = samePlace && !reducedMotion.matches,
      before = new Map();
    if (animate)
      for (const frame of $("hand").children)
        if (!frame.hidden) {
          const rect = frame.getBoundingClientRect();
          before.set(frame.querySelector(".card").dataset.card, {
            left: rect.left,
            top: rect.top,
            nameBottom: getComputedStyle(frame.querySelector(".name")).bottom,
          });
        }
    for (const motion of handMotions.values()) motion.cancel();
    handMotions.clear();
    renderedHand = handKey;
    renderedHandRevision = world.revision;
    renderedHandPlace = world.actors[currentActor(world)].place;
    renderedHandState = handState;
    if (sameWorld)
      for (const frame of $("hand").children) updateCardSelection(frame);
    else $("hand").replaceChildren(...handCards.map(card));
    $("hand").scrollLeft = samePlace ? scroll : 0;
    renderActions(animate);
    if (arriving) revealHandCard(renderedHandPlace, true, true);
    if (animate)
      for (const frame of $("hand").children) {
        if (frame.hidden) continue;
        const id = frame.querySelector(".card").dataset.card,
          previous = before.get(id) || before.get(frame.dataset.holder);
        if (!previous) continue;
        const next = frame.getBoundingClientRect(),
          dx = previous.left - next.left,
          dy = previous.top - next.top;
        if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1 || !before.has(id))
          moveHandPart(`frame:${id}`, frame, {
            translate: [`${dx}px ${dy}px`, "0 0"],
            opacity: [before.has(id) ? 1 : 0.3, 1],
          });
        const name = frame.querySelector(".name"),
          nameBottom = getComputedStyle(name).bottom;
        if (before.has(id) && previous.nameBottom !== nameBottom)
          moveHandPart(`name:${id}`, name, {
            bottom: [previous.nameBottom, nameBottom],
          });
      }
  }
  renderScene();
  renderLog();
  updateCardCooldown();
  if (focused) {
    const frame = $("hand")
      .querySelector(`[data-card="${focused}"]`)
      ?.closest(".card-frame");
    const focusId = frame?.hidden ? frame.dataset.holder : focused;
    $("hand")
      .querySelector(`[data-card="${focusId}"]`)
      ?.focus({ preventScroll: true });
  }
}
function revealHandCard(id, alignStart = false, instant = false) {
  const hand = $("hand"),
    frame = hand.querySelector(`[data-card="${id}"]`)?.closest(".card-frame");
  if (!frame || frame.hidden) return;
  const left = frame.offsetLeft - hand.offsetLeft,
    right = left + frame.offsetWidth,
    visibleLeft = hand.scrollLeft + 16,
    visibleRight = hand.scrollLeft + hand.clientWidth - 16;
  const target =
    alignStart || left < visibleLeft
      ? left - 16
      : right > visibleRight
        ? right - hand.clientWidth + 16
        : hand.scrollLeft;
  hand.scrollTo({
    left: target,
    behavior: instant || reducedMotion.matches ? "instant" : "smooth",
  });
}
new ResizeObserver(([entry]) => {
  document.documentElement.style.setProperty(
    "--dock-height",
    `${entry.target.getBoundingClientRect().height}px`,
  );
}).observe(document.querySelector(".play-dock"));
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
  if (
    e.key === "Tab" &&
    !e.shiftKey &&
    e.target.dataset.card &&
    selected.length
  ) {
    const action = $("card-actions").querySelector("button:not(:disabled)");
    if (action) {
      e.preventDefault();
      action.focus();
      return;
    }
  }
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const cards = [
      ...$("hand").querySelectorAll(".card-frame:not([hidden]) .card"),
    ],
    at = cards.indexOf(document.activeElement),
    next = cards[at + (e.key === "ArrowRight" ? 1 : -1)];
  if (at < 0 || !next) return;
  e.preventDefault();
  next.focus({ preventScroll: true });
  revealHandCard(next.dataset.card);
});
$("card-actions").addEventListener("keydown", (e) => {
  if (
    e.key === "Tab" &&
    e.shiftKey &&
    e.target === $("card-actions").firstElementChild
  ) {
    const card = $("hand").querySelector(`[data-card="${selected.at(-1)}"]`);
    if (card) {
      e.preventDefault();
      card.focus();
    }
  }
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
  if (
    e.key === "Escape" &&
    !document.querySelector("dialog[open], .world-menu:popover-open") &&
    (selected.length || expandedHolders.size)
  ) {
    playQueue.clear();
    selected = [];
    expandedHolders.clear();
    rowCollapsed = false;
    render();
  }
});
// A click outside the row folds it. A held item stays raised and is still
// held when the row opens again; Escape or a second tap lowers it.
document.addEventListener("click", (e) => {
  if (rowCollapsed) {
    if (e.target instanceof Element && e.target.closest(".play-dock")) {
      rowCollapsed = false;
      render();
    }
    return;
  }
  if (
    (selected.length || expandedHolders.size) &&
    !e
      .composedPath()
      .some(
        (element) =>
          element instanceof Element &&
          element.matches(
            ".play-dock, .card-frame, dialog, .topbar, .dialogue, .world-menu",
          ),
      )
  ) {
    playQueue.clear();
    if (selectedHandItem(world, selected)) rowCollapsed = true;
    else selected = [];
    expandedHolders.clear();
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
            .filter(
              (entry) =>
                isSceneText(entry, Boolean(sharedSession)) &&
                entry.generated === true,
            )
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
  playQueue.clear();
  // Archive the outgoing save: starting fresh must be reversible, because
  // a confirm click is not enough consent to destroy a whole run.
  try {
    const previous = localStorage.getItem(SAVE_KEY);
    if (previous) localStorage.setItem(`${SAVE_KEY}.bak`, previous);
    const linked = localStorage.getItem(`${SAVE_KEY}.shared`);
    if (linked) localStorage.setItem(`${SAVE_KEY}.bak.shared`, linked);
    localStorage.removeItem(`${SAVE_KEY}.shared`);
    $("continue-shared-world")?.remove();
  } catch {}
  cancelTravel();
  narrator.invalidate();
  exchange.cancel();
  reveal.cancel();
  speechSounds.stop();
  world = enableMotives(createLandingWorld(startingPack), {
    questPrograms: true,
    personalQuests: true,
  });
  loadSeen(true);
  completedSpeech.clear();
  reviewing = false;
  renderedHand = "";
  replay = 0;
  lineSeq = null;
  selected = [];
  expandedHolders.clear();
  rowCollapsed = false;
  saveBlocked = false;
  notice("");
  save();
  $("reset-dialog").close();
  resumeScene();
};
window.addEventListener("storage", (event) => {
  if (sharedSession || event.key !== SAVE_KEY || !event.newValue) return;
  playQueue.clear();
  cancelTravel();
  narrator.invalidate();
  exchange.cancel();
  reveal.cancel();
  speechKey = null;
  speechSounds.stop();
  try {
    world = enableMotives(decodeSave(event.newValue), {
      questPrograms: true,
      personalQuests: true,
    });
    loadSeen();
    renderedHand = "";
    lineSeq = null;
    selected = [];
    expandedHolders.clear();
    rowCollapsed = false;
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
      !entry.fallback &&
      entry.kind === "dialogue" &&
      entry.turn === world.turn &&
      entry.locationId === world.actors[currentActor(world)].place,
  );
}
function openingWordsDue() {
  return Boolean(
    !saveBlocked &&
      !sharedSession &&
      world.opening &&
      world.turn === 0 &&
      !hasCurrentWords(),
  );
}
// The authored opening line is shown only when the model gives no first line.
// It is marked as a fallback, so a retry or reload still asks the model.
function dropOpeningFallback() {
  if (!world.log.some((entry) => entry.fallback && entry.turn === world.turn))
    return;
  world.log = world.log.filter(
    (entry) => !(entry.fallback && entry.turn === world.turn),
  );
  save();
}
function showOpeningFallback() {
  if (!openingWordsDue()) return;
  dropOpeningFallback();
  addLog(
    world,
    "Vale",
    world.opening.version === 2
      ? "The water is dark. I'll light the lamp."
      : "It's cold up here. I'll light the lamp.",
    {
      actorId: currentActor(world),
      entityId: currentActor(world),
      kind: "dialogue",
      generated: true,
      fallback: true,
    },
  );
  save();
  lineSeq = null;
  exchange.begin();
  render();
  exchange.load([world.log.at(-1)]);
}
function resumeScene() {
  if (sharedSession) {
    render();
    syncSharedLine();
    return;
  }
  if (openingWordsDue()) {
    // A new game asks the dialogue model for Vale's first line.
    dropOpeningFallback();
    lineSeq = null;
    storyStatus = "pending";
    exchange.begin();
    render();
    narrator.changed();
    return;
  }
  if (!saveBlocked && hasCurrentWords()) {
    const line = currentScene(world).line;
    lineSeq = null;
    exchange.begin();
    render();
    exchange.load(line ? [line] : []);
  } else render();
}
let sharedSending = false;
let sharedLineKey = "";
let sharedWorldKey = "";
let sharedNudgeKey = "";
function sharedWorld(value) {
  return {
    ...value.world,
    playerActorId: value.actor,
    controlledActors: humanAvatars
      .filter((_, index) => value.claimed?.[index])
      .map((avatar) => avatar.id),
    presentActors: humanAvatars
      .filter((_, index) => value.present?.[index])
      .map((avatar) => avatar.id),
  };
}
async function submitSharedPlay(action) {
  if (
    sharedSending ||
    sharedSession.state.queue?.some(
      (entry) => entry.actor === currentActor(world),
    )
  )
    return;
  const current = legalActions(world).find((entry) => entry.key === action.key);
  if (!current) {
    notice("The table changed. Choose a current play.");
    render();
    return;
  }
  const selection = JSON.stringify(selected);
  const heldBefore = heldSelection();
  sharedPlayback.reset();
  sharedSending = true;
  renderActions();
  try {
    await sharedSession.play(current);
    lastPlayAt = performance.now();
    if (!playQueue.pending && JSON.stringify(selected) === selection) {
      keepHeldSelection(heldBefore, current);
      reviewing = false;
    }
    if (!playQueue.pending) notice("");
  } catch (error) {
    notice(error.message);
  } finally {
    sharedSending = false;
    renderedHand = "";
    render();
  }
}
function syncSharedLine() {
  renderPlayers();
  if (!sharedSession || reviewing || covering) return;
  const room = world.actors[currentActor(world)].place;
  const playbackTime = sharedPlayback.now(
    sharedSession.state,
    sharedSession.now(),
    room,
    document.hidden ||
      (reveal.complete && characterSpeech.busy) ||
      Boolean(document.querySelector("dialog[open], .world-menu:popover-open")),
  );
  const live = sharedLiveLine(sharedSession.state, playbackTime, room);
  if (!live) return;
  // A long spoken line can outlast the room's normal reading interval.
  if (
    characterSpeech.busy &&
    (live.seq
      ? live.seq !== shownSceneLine?.seq
      : live.text !== shownSceneLine?.text)
  ) {
    sharedPlayback.now(sharedSession.state, sharedSession.now(), room, true);
    return;
  }
  const entry = world.log.findLast(
    (entry) =>
      entry.generated &&
      entry.locationId === room &&
      (live.seq
        ? entry.seq === live.seq
        : entry.text === live.text && entry.speaker === live.speaker),
  );
  // A reader can advance ahead of the clock. Keep that line until it catches up.
  if (!entry || (lineSeq !== null && entry.seq < lineSeq)) return;
  const key = `${room}:${entry.seq}`;
  if (key === sharedLineKey) return;
  sharedLineKey = key;
  lineSeq = entry.seq;
  storyStatus = "ready";
  renderScene();
}
function adoptShared(value) {
  if (!value.actor || !value.world?.actors?.[value.actor]) {
    location.reload();
    return;
  }
  const key = JSON.stringify([value.world, value.present, value.claimed]);
  if (key !== sharedWorldKey) {
    const from = world.actors[currentActor(world)].place;
    const next = sharedWorld(value);
    const alreadyOpen = Boolean(sharedWorldKey);
    world = next;
    sharedWorldKey = key;
    selectCards(selected.filter((id) => availableCards(world).includes(id)));
    selectionRevision = world.revision;
    renderedHand = "";
    pendingSpeaker = null;
    cardsCooling = false;
    storyStatus = value.queue?.some((entry) => entry.status === "working")
      ? "pending"
      : "ready";
    if (world.actors[currentActor(world)].place !== from) {
      cancelTravel();
      reviewing = false;
      sharedLineKey = "";
      lineSeq = null;
      travel(world.actors[currentActor(world)].place, render, () => {
        render();
        syncSharedLine();
      });
    } else render();
    if (alreadyOpen) {
      queueDiscoveries();
    }
  } else {
    renderActions();
    renderScene();
  }
  if (value.notice) notice(value.notice);
  const nudge = value.nudge
    ? `${value.nudge}:${Math.floor(value.now / 10000)}`
    : "";
  if (nudge && nudge !== sharedNudgeKey)
    notice(`${nameOf(value.nudge)} would like your attention.`);
  sharedNudgeKey = nudge;
  syncSharedLine();
  queueMicrotask(() => playQueue.flush());
}
installSharedControls({
  session: sharedSession,
  saveSlot: SAVE_KEY,
  getSave: () => {
    if (saveBlocked) throw new Error("Open a valid saved game before sharing.");
    return encodeSave(world);
  },
  notice,
});
installToolbar({ session: sharedSession, getWorld: () => world });
if (localRuntime()) {
  for (const id of ["owned-worlds-button", "shared-worlds-button"]) {
    const button = $(id);
    if (button) button.hidden = true;
  }
  const hint = document.querySelector(".players-hint");
  if (hint) hint.hidden = true;
}
installSceneVideo({
  getWorld: () => world,
  getScene: () => videoScene || currentScene(world),
});
if (sharedSession) {
  world = sharedWorld(sharedSession.state);
  sharedSession.subscribe(adoptShared, (message, recoveredFrom) => {
    if (!recoveredFrom || $("notice").textContent === recoveredFrom)
      notice(message);
  });
  adoptShared(sharedSession.state);
  setInterval(syncSharedLine, 200);
}
resumeScene();
