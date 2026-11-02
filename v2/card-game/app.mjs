import { imageUrl } from "./images.mjs";
import { cardLevel, levelTier, romanLevel } from "./rarity.mjs";
import { arriveCard, finishReveal, revealCard } from "./card-reveal.mjs";
import { glowCard, levelUpCard, transformPortrait } from "./card-level-up.mjs";
import { crossedPortraitTier } from "./rarity-portraits.mjs";
import {
  isQuestId,
  metQuests,
  questCards,
  questCaption,
  questHand,
  questId,
  questNear,
  questTier,
  questVerb,
} from "./quest-card.mjs";
import { questScreen } from "./quest-screen.mjs";
import {
  landingPack,
  createLandingWorld,
  newRunSeed,
} from "./pack-landing.mjs";
import { flipStagePortrait, portraitFraming } from "./portrait-facing.mjs";
import { installSceneVideo } from "./scene-video.mjs";
import { locationWeather } from "./weather.mjs";
import { DAYLIGHT_TURNS, isNight, locationDaylight } from "./daylight.mjs";
import { renderWeather } from "./weather-view.mjs";
import {
  CHANGE_FADE_MS,
  CARD_ARRIVE_MS,
  CROSSFADE_MS,
  crossfadeImage,
  fadeLayer,
  hauntScene,
  installScaresToggle,
} from "./transitions.mjs";
import { installToolbar, renderPlayers } from "./toolbar.mjs";
import { combatBeats, lastSeq, theName } from "./combat-beats.mjs";
import {
  beatSummary,
  memoryVisits,
  sceneBeats,
  withPending,
} from "./beats.mjs";
import {
  createCombatView,
  installCombatSpeed,
  renderStandingResolve,
} from "./combat-view.mjs";
import { expressionLabel, expressionOf } from "./expression.mjs";
import {
  connectSharedWorld,
  createSharedPlaybackClock,
  installSharedControls,
  renderSharedQueue,
  sharedLiveLine,
  sharedNextActor,
  sharedSilentLines,
  sharedSpeechState,
  hasSharedPlace,
  humanAvatars,
} from "./shared.mjs";
import { enableMotives } from "./motives.mjs";
import { seatActors } from "./human-cast.mjs";
import { PLAYING_KEY, SAVE_BASE } from "./avatar-world.mjs";
import { createNarrator, requestNarrative, silentLines } from "./narrative.mjs";
import { rememberLocalUpgrades, wearLocalUpgrades } from "./scarves.mjs";
import {
  forgetCovered,
  forgetUnfound,
  markWaking,
} from "./speech-knowledge.mjs";
import { packMedia } from "./pack-registry.mjs";
import { createRoomMusic } from "./music.mjs";
import { createHum } from "./hum.mjs";
import { createSfx } from "./sfx.mjs";
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
  covered,
  itemPlace,
  rootHolder,
  play,
  encodeSave,
  decodeSave,
  legalActions,
  seedRun,
  exits as placeExits,
} from "./world.mjs";
import { packPlaces, packOf } from "./pack-registry.mjs";
import { variantOf } from "./pack-rules.mjs";
import {
  currentScene,
  isSceneText,
  sceneCast,
  nextSpeaker,
  sceneStaging,
  selectedHandItem,
  portrait,
  backdrop,
  locationOverlay,
  locationVariant,
  stageOf,
  travelCard,
  lampLitHere,
} from "./scene.mjs";
import {
  availableCards,
  cardType,
  cardPlay,
  playLabel,
  playProgress,
  playText,
  cardActions,
  cardObservation,
} from "./cards.mjs";
// A person's want reaches the player through Talk context (want-talk.mjs).
// The hand holds people, items and places, and the player's quest cards.
const $ = (id) => document.getElementById(id);
const tableName = new URLSearchParams(window.location.search).get("table");
const startingPack = landingPack(window.location.href);
const sharedWorldId = new URLSearchParams(location.search).get("world");
const sharedSession = sharedWorldId
  ? await connectSharedWorld(sharedWorldId)
  : null;
const sharedPlayback = createSharedPlaybackClock();
const SAVE_KEY = sharedSession
  ? `${SAVE_BASE}.shared.${sharedWorldId}.${sharedSession.state.actor}`
  : tableName && /^[a-z0-9-]{1,40}$/i.test(tableName)
    ? `${SAVE_BASE}.${tableName}`
    : startingPack
      ? `${SAVE_BASE}.pack.${startingPack.id}`
      : SAVE_BASE;
// A new local world: Vale wakes in the attic, the only avatar played locally
// (#1892). Its travelers wear the local passkey's cosmetic upgrades (#1873).
const freshWorld = () =>
  wearLocalUpgrades(enableMotives(createLandingWorld(startingPack)));
let world = sharedSession
    ? { ...sharedSession.state.world, playerActorId: sharedSession.state.actor }
    : freshWorld(),
  selected = [],
  expandedHolders = new Set(),
  saveBlocked = false,
  lineSeq = null,
  selectionRevision = 0,
  dragging = [],
  // The hand rests folded until a card is touched. Only a click outside
  // the card area or Escape folds it again; a play, changing the selection
  // and deselecting never do. A held item stays raised.
  rowCollapsed = true,
  // A click off the hand folds it with its selection and chosen play intact;
  // the next tap on the hand only raises it again.
  foldedChoice = false;
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
// Beat captions keep their glyph as data; the table draws each one as line
// art in the toolbar's style so no glyph falls back to a colour emoji.
const beatIcons = {
  "➜": '<path d="M4 12h15M13 6l6 6-6 6"/>',
  "⚔": '<path d="M4 4l11 11M13 17l4-4M15 15l4 4M20 4 9 15M11 17l-4-4M9 15l-4 4"/>',
  "↳": '<path d="M7 4v8a3 3 0 0 0 3 3h9M15 11l4 4-4 4"/>',
  "⇄": '<path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4"/>',
  "✦": '<path d="M12 3c.8 5 2 6.2 7 9-5 2.8-6.2 4-7 9-.8-5-2-6.2-7-9 5-2.8 6.2-4 7-9Z"/>',
  "✋": '<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4.5a1.5 1.5 0 0 1 3 0v6M14 10.5V6a1.5 1.5 0 0 1 3 0v5M17 11V9a1.5 1.5 0 0 1 3 0v5a7 7 0 0 1-7 7h-.8a6 6 0 0 1-4.7-2.3l-3-3.9a1.6 1.6 0 0 1 2.4-2L8 15"/>',
  "◌": '<path d="M9 21v-9h6v9M7 21h10M12 12V9M12 7c-1.5-1.3 1.5-2.4 0-4"/>',
  "♪": '<path d="M5 17h14l-2-3v-4a5 5 0 0 0-10 0v4zM10 19.5a2 2 0 0 0 4 0"/>',
  "⛽": '<path d="M12 3c-1.6 2.2-2.5 3.5-2.5 4.7a2.5 2.5 0 0 0 5 0C14.5 6.5 13.6 5.2 12 3ZM4 14h16l-2.5 6h-11ZM9 14a3 3 0 0 1 6 0"/>',
};
function beatIcon(glyph) {
  const holder = node("span", undefined, "beat-icon");
  holder.setAttribute("aria-hidden", "true");
  if (beatIcons[glyph])
    holder.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${beatIcons[glyph]}</svg>`;
  else holder.textContent = glyph;
  return holder;
}
function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
// Nothing floats over the stage. A failure the player must see (a refused
// play, an unsaved world, a lost connection, a nudge) reads on the action
// bar's status line above the hand; a pending play reads on its own button.
function notice(text, playStatus = "") {
  // Saved speech failures use the small dialogue retry control.
  if (/^(The|Your) play is saved\./.test(text)) return;
  const line = $("play-status");
  line.textContent = text;
  line.hidden = !text;
  line.dataset.playStatus = text ? playStatus : "";
  const panel = document.querySelector(".action-panel");
  if (text) panel.hidden = false;
  else panel.hidden = !$("card-actions").children.length;
}
const localBackups =
  localRuntime()?.backups && !sharedSession
    ? createLocalBackups({
        slot: SAVE_KEY,
        validate: decodeSave,
        onError: notice,
      })
    : null;
// A table with no saved world, or a new visitor to a shared world, starts with
// its opening cards covered.
let openingTable = true;
// In-app browsers and WebViews can block storage outright. The table then
// plays a fresh world in this tab instead of refusing every card.
let storageBlocked = false;
try {
  await localBackups?.restore();
  let saved = null;
  try {
    saved = sharedSession ? null : localStorage.getItem(SAVE_KEY);
  } catch {
    storageBlocked = true;
  }
  if (saved) {
    openingTable = false;
    // A save from before run seeds takes one once, as a shared world does.
    world = wearLocalUpgrades(
      enableMotives(seedRun(decodeSave(saved), newRunSeed())),
    );
  }
} catch (error) {
  openingTable = false;
  saveBlocked = true;
  notice(error.message + " Use New game to start again.");
}
const UNSAVED_NOTICE =
  "This browser could not save the world. Keep this tab open to keep playing.";
if (storageBlocked) notice(UNSAVED_NOTICE);
const SEEN_KEY = `${SAVE_KEY}.seen`;
// The revision whose words failed, so a reload keeps Retry instead of a blank
// or hidden dialogue panel.
const WORDS_FAILED_KEY = `${SAVE_KEY}.words-failed`;
function rememberWordsFailed(revision) {
  if (sharedSession) return;
  try {
    if (revision === null) localStorage.removeItem(WORDS_FAILED_KEY);
    else localStorage.setItem(WORDS_FAILED_KEY, String(revision));
  } catch {
    /* Retry still works in this tab. */
  }
}
function wordsFailedOnLoad() {
  try {
    return localStorage.getItem(WORDS_FAILED_KEY) === String(world.revision);
  } catch {
    return false;
  }
}
let encountered = new Set(),
  discoveryDone = Promise.resolve();
const fresh = new Set();
// The level each card last showed, so a rise plays on the card itself.
const shownLevels = new Map();
const shownStageLevels = new Map();
const coveredCards = new Set();
let openingHeld = false;
// The quest stack on show, top first, and whether it is fanned open. A met
// quest stays, sealed, until its player clears it (sealedQuests, newest
// first; questSeq is the last event read for them); a first quest arrives
// glowing (questFresh); questPick is the stack card chosen in the open fan.
// All are this browser's only: the rules have already removed a met quest.
let shownQuests = [],
  sealedQuests = [],
  questSeq = null,
  questPick = 0,
  questOpen = false,
  questFresh = false;
// The folded card behind the avatar shows the top quest.
const foldQuest = () => shownQuests[0] ?? sealedQuests[0] ?? null;
const questEntries = () => [
  ...sealedQuests.map((quest, i) => ({
    id: questId(i, true),
    quest,
    met: true,
  })),
  ...shownQuests.map((quest, i) => ({ id: questId(i), quest, met: false })),
];
const questEntry = (id) => questEntries().find((entry) => entry.id === id);
// Card art: a pack's own art, a hub item's authored art, or the forest card.
const cardArt = (id) =>
  packMedia(id, "art") ||
  (things[id]?.art ? `./${things[id].art}` : `./assets/${id}-card.png`);
// A place's authored art is its outside view; aboard or inside, its card
// shows the scene there, so the ship's card follows its voyage and the hour.
const placeCardArt = (id) =>
  packPlaces[id]?.art && world.actors[currentActor(world)]?.place !== id
    ? packMedia(id, "art")
    : backdrop(id, world);
const cardIsCovered = (id) => !encountered.has(id) || coveredCards.has(id);
// The screen names a card only once its player has uncovered it (#1575).
const knownName = (id, unknown = "…") =>
  coveredCards.has(id) ? unknown : nameOf(id);
// An avatar wakes knowing nothing: it speaks once its player has uncovered
// both its own card and the place it stands in.
const selfKnown = () =>
  !coveredCards.has(currentActor(world)) &&
  !coveredCards.has(world.actors[currentActor(world)].place);
function rememberCards() {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...encountered]));
    localStorage.setItem(
      `${SEEN_KEY}.covered`,
      JSON.stringify([...coveredCards]),
    );
  } catch {}
}
function loadSeen(reset = false) {
  let saved = [],
    opening = reset;
  coveredCards.clear();
  let stored = null;
  try {
    stored = reset ? null : localStorage.getItem(SEEN_KEY);
  } catch {}
  opening ||= openingTable && stored === null;
  try {
    saved = JSON.parse(stored || "[]");
    const covered = reset
      ? []
      : JSON.parse(localStorage.getItem(`${SEEN_KEY}.covered`) || "[]");
    for (const id of Array.isArray(covered) ? covered : [])
      if (people[id] || things[id] || places[id]) coveredCards.add(id);
  } catch {}
  encountered = new Set([
    ...(Array.isArray(saved)
      ? saved.filter((id) => people[id] || things[id] || places[id])
      : []),
    ...availableCards(world),
  ]);
  // The opening hand starts covered, like any newly met card; a known table
  // keeps the cards its player has already uncovered.
  if (opening) for (const id of availableCards(world)) coveredCards.add(id);
  fresh.clear();
  shownLevels.clear();
  shownStageLevels.clear();
  shownQuests = [];
  sealedQuests = [];
  questSeq = null;
  questPick = 0;
  questFresh = false;
  rememberCards();
}
loadSeen();
function save() {
  if (saveBlocked || sharedSession || storageBlocked) return;
  try {
    const encoded = encodeSave(world);
    localStorage.setItem(SAVE_KEY, encoded);
    rememberLocalUpgrades(world);
    void localBackups?.queue(encoded);
  } catch {
    notice(UNSAVED_NOTICE);
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
  cardsCooling = false,
  reviewing = false,
  // The beat stepped back to while reviewing, by beat key.
  reviewBeat = null,
  announcedBeat = null,
  frontCaptions = [],
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
// Speakers whose words did not come this turn show "…"; never saved or voiced.
let silence = { turn: -1, lines: [] };
function shownWorld() {
  const lines = sharedSession
    ? sharedSilentLines(
        sharedSession.state,
        world.actors[currentActor(world)].place,
      )
        .filter((line) => world.log.some((entry) => entry.seq < line.seq))
        .map((line) => ({ ...line, speaker: nameOf(line.actorId) }))
    : silence.turn === world.turn
      ? silence.lines
      : [];
  if (!lines.length) return world;
  // Each "…" follows its own scene's words in the log.
  const log = [...world.log];
  for (const line of lines)
    log.splice(log.findLastIndex((entry) => entry.seq < line.seq) + 1, 0, line);
  return { ...world, log };
}
async function prepareStage() {
  await travelShown;
  await waitForScene(
    [
      ...[
        $("backdrop"),
        ...$("stage").querySelectorAll(".stage-figure, #cast img"),
      ].map((image) => image.decode()),
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
    Boolean(sharedSession && !hasSharedPlace(sharedSession.state))
  );
}
// The player's latest shared play, from sending until the table settles it.
let sharedPlay = null;
let sharedSending = false;
let sharedRefusal = null;
let sharedNoticeSeen;
function ownSharedEntry() {
  return sharedSession?.state.queue?.find(
    (entry) => entry.actor === currentActor(world),
  );
}
// The button of a chosen, unresolved play reads as what the avatar is
// doing: "Waiting…".
function progressLabel(action) {
  const verb = playProgress(action);
  return `${verb[0].toUpperCase()}${verb.slice(1)}…`;
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
  changed: () => {
    // Refresh progress labels even when the hand's render key is unchanged.
    const handBefore = renderedHand;
    render();
    if (renderedHand === handBefore) renderActions();
  },
});
// Strikes and journeys have the screen. The hand is locked through them but
// stays exactly where the player left it: only the player lowers it. The
// dialogue steps aside, so the fighters stay in view, and returns for the
// speech that follows.
function syncHandDrop() {
  const dock = document.querySelector(".play-dock"),
    dialogue = document.querySelector(".dialogue");
  dock.dataset.covered = String(covering);
  dock.inert = covering;
  dialogue.dataset.dropped = String(covering);
  dialogue.inert = covering;
}
function updateCardCooldown() {
  syncHandDrop();
  $("hand").dataset.cooling = String(cardsCooling);
  $("hand").setAttribute("aria-busy", String(selectionBlocked()));
  $("card-actions").setAttribute("aria-busy", String(selectionBlocked()));
  for (const button of document.querySelectorAll(
    "#hand button, #card-actions button",
  )) {
    button.disabled = selectionBlocked();
    if (button.dataset.card)
      button.draggable =
        !button.disabled && !cardIsCovered(button.dataset.card);
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
    reviewBeat = null;
    lineSeq = line.seq;
    // The stack brings the new beat in front as it renders.
    renderScene();
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
    // The finished beat recedes behind the next one instead of fading out.
    return waitForScene([...exits.values()]).then(() => {
      if (version !== trip || !exchange.active || !next) return;
    });
  },
  busy: (value) => {
    clearTimeout(handTimer);
    cardsCooling = value;
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
// Wide screens rest the hand as a small deck beside the dialogue; raising it
// slides both into the phone layering. Keep in step with style.css.
const wideLayout = matchMedia(
    "(min-width: 1100px) and (min-aspect-ratio: 3/2)",
  ),
  LAYOUT_MS = 280;
// The dialogue lies over the hand's foot on phones and tablets, and on wide
// screens once the hand is raised (style.css). With no beat yet the hand
// leaves no dialogue-shaped hole: its cards show whole.
function syncLayering() {
  document.body.dataset.dialogueOver = String(
    !document.querySelector(".dialogue").hidden &&
      (!wideLayout.matches || document.body.dataset.handExpanded === "true"),
  );
}
wideLayout.addEventListener("change", syncLayering);
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
  const forward = reviewing || Boolean(exchange.current);
  $("dialogue-advance").dataset.revealing = String(!complete);
  $("dialogue-advance").setAttribute(
    "aria-label",
    complete
      ? reviewing
        ? "Step forward to a later beat"
        : exchange.current
          ? "Continue to the next beat"
          : "The latest beat"
      : "Reveal the full line",
  );
  $("speech-hint").textContent = complete
    ? forward
      ? "Continue"
      : ""
    : "Tap to reveal";
}
const reveal = createTextReveal({
  reduced: () => reducedMotion.matches,
  sound: (...args) => {
    if (
      !document.hidden &&
      !shownSceneLine?.silent &&
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
      if (shownSceneLine?.silent) characterSpeech.clear();
      else characterSpeech.show(value.key, value.speaker, value.text);
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
    // Only the newest beat is announced, never one stepped back to.
    if (value.complete && !reviewing && announcedBeat !== value.key) {
      announcedBeat = value.key;
      $("speech-announcement").textContent = [
        expressionLabel(
          { ...people[value.speaker], name: nameOf(value.speaker) },
          value.text,
        ),
        ...frontCaptions,
      ].join(" ");
    }
    if (value.complete) {
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
  const paused = syncSpeechPlayback();
  for (const animation of [
    ...$("cast").getAnimations({ subtree: true }),
    ...$("speech-row").getAnimations(),
  ]) {
    if (paused) animation.pause();
    else if (animation.playState === "paused") animation.play();
  }
  if (paused) speechSounds.stop();
  else queueMicrotask(() => playQueue.flush());
}
document.addEventListener("visibilitychange", pauseSpeech);
document.addEventListener("shared-dialog-change", pauseSpeech);
function unlockSpeech() {
  speechSounds.unlock();
  characterSpeech.unlock();
}
// A touch grants audio permission on pointerup, not pointerdown, so Android
// and iOS would otherwise stay silent until a second tap.
for (const type of ["pointerdown", "pointerup"])
  document.addEventListener(type, unlockSpeech, { capture: true });
document.addEventListener("keydown", unlockSpeech, {
  capture: true,
});
function updateSoundButton() {
  $("speech-sound").textContent = `Voices: ${soundEnabled ? "on" : "off"}`;
  $("speech-sound").setAttribute("aria-pressed", String(soundEnabled));
}
installScaresToggle($("scares-toggle"));
installCombatSpeed($("combat-speed"));
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
// The island's drone follows the same switch and volume as the music.
const hum = createHum();
hum.setEnabled(musicEnabled);
hum.setVolume(musicVolume);
hum.setHidden(document.hidden);
hum.setStarted(musicHasStarted());
// The bell and later world effects use the same switch and volume.
const sfx = createSfx();
sfx.setEnabled(musicEnabled);
sfx.setVolume(musicVolume);
sfx.setHidden(document.hidden);
function ringHeard() {
  const place = world.actors[currentActor(world)].place;
  sfx.watch(world.log, place, placeExits(world, place));
}
function humRoom() {
  const place = world.actors[currentActor(world)].place;
  // The saved world clock, so unlit places such as the thicket darken too.
  hum.setRoom(place, {
    night: Math.floor((world.turn || 0) / DAYLIGHT_TURNS) % 2 === 1,
  });
}
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
  hum.setEnabled(musicEnabled);
  sfx.setEnabled(musicEnabled);
  if (musicEnabled) music.unlock();
  saveMusicSettings();
};
$("music-volume").oninput = (event) => {
  musicVolume = Number(event.target.value) / 100;
  music.setVolume(musicVolume);
  hum.setVolume(musicVolume);
  sfx.setVolume(musicVolume);
  saveMusicSettings();
};
const unlockAudio = () => {
  music.unlock();
  hum.unlock();
  sfx.unlock();
};
for (const type of ["pointerdown", "pointerup"])
  document.addEventListener(type, unlockAudio, { capture: true });
document.addEventListener("keydown", unlockAudio, { capture: true });
document.addEventListener("visibilitychange", () => {
  music.setHidden(document.hidden);
  hum.setHidden(document.hidden);
  sfx.setHidden(document.hidden);
});
window.addEventListener("pagehide", () => {
  music.setHidden(true);
  hum.setHidden(true);
  sfx.setHidden(true);
});
window.addEventListener("pageshow", () => {
  music.setHidden(document.hidden);
  hum.setHidden(document.hidden);
  sfx.setHidden(document.hidden);
});
const narrator = createNarrator({
  getWorld: () => world,
  early: Boolean(localRuntime()),
  limit: (context) => {
    const covered = (id) => coveredCards.has(id);
    // A quest target whose card this player never uncovered stays unnamed.
    const unseen = forgetUnfound(world, context, cardIsCovered);
    return markWaking(world, forgetCovered(world, unseen, covered), covered);
  },
  request: localRuntime()
    ? (context, signal, progress) =>
        requestNarrative(context, signal, progress, "/card-game/text", true)
    : undefined,
  reflect: localRuntime()
    ? (context, signal) =>
        requestNarrative(context, signal, () => {}, "/card-game/reflections")
    : null,
  started: (context) => {
    if (localRuntime()) characterSpeech.clear();
    // A speaker who left this turn speaks at the destination, not here.
    sceneSpeakers = context.speakers.filter(
      (id) => world.actors[id]?.place === context.location,
    );
    shownSpeakers = [];
    silence = { turn: -1, lines: [] };
    awaitingNext = false;
    pendingSpeaker = nextSpeaker(world, { speakers: sceneSpeakers });
    renderScene();
  },
  apply: (next, { pending = false, reflection = false, silent = [] } = {}) => {
    world = next;
    save();
    if (reflection) {
      render();
      return;
    }
    storyStatus = pending ? "pending" : "ready";
    if (!pending) {
      rememberWordsFailed(null);
      silence = { turn: world.turn, lines: silentLines(world, silent) };
    }
    const lines = shownWorld().log.filter(
      (entry) =>
        entry.generated &&
        entry.kind === "dialogue" &&
        entry.turn === world.turn &&
        entry.locationId === world.actors[currentActor(world)].place,
    );
    const voiced = lines.filter((entry) => !entry.silent);
    if (localRuntime() && voiced.length) {
      const line =
        voiced.find((entry) => entry.seq !== exchange.current?.seq) ||
        voiced[0];
      characterSpeech.prefetch(line.actorId, line.text);
    }
    exchange.load(lines, { pending });
    render();
  },
  status: (value) => {
    storyStatus = value;
    if (value === "pending" && !exchange.active) exchange.begin();
    if (value === "retry") {
      rememberWordsFailed(world.revision);
      exchange.cancel();
      showOpeningSilence();
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
  // A standoff locks the room and takes the held things out of the hand
  // (#1775), so a raised item leaves the selection with its card.
  const shown = availableCards(world);
  const held = (
    received
      ? [received]
      : before.held.filter((id) => selectedHandItem(world, [id]))
  ).filter((id) => shown.includes(id));
  const keepActor = held.length > 0 && selected.includes(actor);
  const expanded = keepActor && expandedHolders.has(actor);
  selected = keepActor ? [actor, ...held] : held;
  expandedHolders.clear();
  if (expanded) expandedHolders.add(actor);
}
// The places you can go from here stack face down behind the current place,
// as held things stack behind their holder; opening the stack fans them out.
const placeHere = () => world.actors[currentActor(world)].place;
const stackedPlace = (id) => Boolean(places[id]) && id !== placeHere();
function stackPlaces(cards) {
  const here = placeHere(),
    hand = cards.filter((id) => !stackedPlace(id));
  let at = hand.indexOf(here) + 1;
  while (
    at > 0 &&
    at < hand.length &&
    things[hand[at]] &&
    rootHolder(world, hand[at]) === here
  )
    at++;
  hand.splice(at || hand.length, 0, ...cards.filter(stackedPlace));
  return hand;
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
      !cards.some((card) => things[card] && rootHolder(world, card) === id) &&
      !(id === placeHere() && cards.some(stackedPlace))
    )
      expandedHolders.delete(id);
  selected = cards;
}
function choose(id) {
  if (finishReveal(id) || selectionBlocked()) return;
  if (cardIsCovered(id)) {
    encountered.add(id);
    coveredCards.delete(id);
    rememberCards();
    render();
    const shown = $("hand").querySelector(`.card[data-card="${id}"]`);
    if (shown) void revealCard(shown);
    $("discovery-announcement").textContent = `New card: ${nameOf(id)}.`;
    if (openingHeld && openingWordsDue() && selfKnown()) resumeScene();
    if (sharedSession) syncSharedLine();
    return;
  }
  if (rowCollapsed && foldedChoice && selected.length) {
    foldedChoice = false;
    rowCollapsed = false;
    render();
    return;
  }
  foldedChoice = false;
  playQueue.clear();
  lastPlayAt = -Infinity;
  fresh.delete(id);
  questOpen = false;
  // Any tap opens a folded row again; the held item is still raised.
  rowCollapsed = false;
  if (places[id] && expandedHolders.has(id)) {
    expandedHolders.delete(id);
    selectCards(
      selected.filter(
        (cardId) =>
          cardId !== id &&
          !(id === placeHere() && stackedPlace(cardId)) &&
          (!things[cardId] || rootHolder(world, cardId) !== id),
      ),
    );
  } else {
    const holder = things[id] ? rootHolder(world, id) : null;
    if (places[holder])
      selected = selected.filter((cardId) => cardId !== holder);
    // No play takes two places, so a new place replaces the chosen one and
    // keeps its partner: Pip + Station, then Pond, invites Pip to the Pond.
    if (places[id] && !selected.includes(id))
      selected = selected.filter((cardId) => !places[cardId]);
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
  // The drone falls silent just before a discovery is revealed.
  if (action.choiceId) hum.hush();
  if (playQueue.pending?.action.key === action.key) {
    // Shared plays cancel through their own visible control.
    if (!sharedSession) playQueue.clear();
  } else {
    // A play leaves the hand where it is: raised stays raised.
    playQueue.submit(action, revision);
  }
}
function performAction(action, revision) {
  if (saveBlocked || sharedSession) return;
  const result = play(world, action, revision);
  if (!result.ok) {
    notice(result.error);
    render();
    return;
  }
  // Choosing a quest passes no turn and leaves the scene and its speech be.
  if (action.kind === "focus") {
    world = result.state;
    save();
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
  const beats = combatBeats(world, result.state, {
    viewer: currentActor(world),
    place: from,
  });
  world = result.state;
  music.setRoom(
    world.actors[currentActor(world)].place,
    locationDaylight(world, world.actors[currentActor(world)].place)?.phase ||
      "day",
  );
  music.setStarted(musicHasStarted());
  music.unlock();
  hum.setStarted(musicHasStarted());
  humRoom();
  hum.unlock();
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
  const land = (done = () => {}) => {
    const place = world.actors[currentActor(world)].place;
    if (place !== from)
      travel(
        place,
        render,
        () => {
          render();
          done();
        },
        beats.some((beat) => beat.kind === "defeat" && beat.viewerLost)
          ? "You come to at"
          : undefined,
      );
    else {
      render();
      done();
    }
    queueDiscoveries();
  };
  if (beats.length) presentCombat(beats, land);
  else land();
  narrator.changed(action);
  restoreHandFocus();
}
// A play leaves keyboard focus with the hand, never in the dialogue stack.
function restoreHandFocus() {
  const active = document.activeElement;
  if (
    active &&
    active !== document.body &&
    active.isConnected &&
    !active.disabled &&
    !$("card-actions").contains(active)
  )
    return;
  const card =
    $("hand").querySelector(
      `.card-frame:not([hidden]) [data-card="${selected.at(-1)}"]`,
    ) || $("hand").querySelector(".card-frame:not([hidden]) .card");
  card?.focus({ preventScroll: true });
}

// Standoff beats play over the scene the player saw before the play. The new
// world is drawn only after the last beat (and any defeat card) is done.
let combatView = null,
  combatRun = 0,
  combatRelease = null;
const combatHeld = new Set();
function combatStage() {
  return (combatView ??= createCombatView({
    stage: $("stage"),
    caption: $("combat-caption"),
    announce: $("combat-announcement"),
    dialog: $("defeat-dialog"),
    reducedMotion,
    revealLine: (seq) => {
      if (combatHeld.delete(seq)) renderLog();
    },
  }));
}
function endCombat() {
  combatRun++;
  combatView?.cleanup();
  combatHeld.clear();
  const release = combatRelease;
  combatRelease = null;
  release?.();
}
async function presentCombat(beats, land) {
  const mine = ++combatRun;
  const view = combatStage();
  for (const beat of beats) combatHeld.add(beat.seq);
  covering = true;
  travelShown = new Promise((resolve) => {
    combatRelease = resolve;
  });
  updateCardCooldown();
  await view.play(beats);
  if (mine !== combatRun) return;
  const defeat = beats.find(
    (beat) => beat.kind === "defeat" && beat.viewerLost,
  );
  if (defeat) await view.defeat(defeat);
  if (mine !== combatRun) return;
  await view.release();
  if (mine !== combatRun) return;
  const release = combatRelease;
  combatRelease = null;
  combatView.cleanup();
  combatHeld.clear();
  covering = false;
  renderLog();
  land(release);
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
  endCombat();
  trip++;
  covering = false;
  syncHandDrop();
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
    if (figure.dataset.removing) dropFigure(figure);
  }
  exits.clear();
  renderedCast = "";
  for (const animation of $("speech-row").getAnimations()) animation.cancel();
}
// Cards met at the new place are unveiled once the veil has fully lifted.
async function travel(place, arrive, landed, kicker = "Travelling to") {
  const veil = $("travel");
  $("travel-kicker").textContent = kicker;
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
  syncHandDrop();
  veil.classList.add("travelling");
  // The browser may start a CSS transition on a later frame. Wait for its
  // completion so each scene change stays covered at every rendering speed.
  await Promise.allSettled(veil.getAnimations().map((a) => a.finished));
  if (mine !== trip) return;
  covering = false;
  arrive();
  const images = [
    $("backdrop"),
    ...$("stage").querySelectorAll(".stage-figure, #cast img"),
  ];
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

function showItemView(id) {
  const dialog = $("item-view"),
    image = $("item-view-image");
  dialog.dataset.zoomed = "false";
  $("item-view-zoom").textContent = "Enlarge";
  dialog.setAttribute("aria-label", nameOf(id));
  image.src = `./${things[id].view}`;
  image.alt = nameOf(id);
  dialog.showModal();
  pauseSpeech();
}
$("item-view").addEventListener("click", (event) => {
  const dialog = $("item-view"),
    image = $("item-view-image");
  if (![image, $("item-view-zoom")].includes(event.target))
    return dialog.close();
  const zoomed = dialog.dataset.zoomed !== "true",
    { width, height } = image.getBoundingClientRect(),
    offsetX = event.target === image ? event.offsetX : width / 2,
    offsetY = event.target === image ? event.offsetY : height / 2;
  dialog.dataset.zoomed = String(zoomed);
  $("item-view-zoom").textContent = zoomed ? "Fit" : "Enlarge";
  if (zoomed)
    dialog.scrollTo(
      (offsetX / width) * image.offsetWidth - dialog.clientWidth / 2,
      (offsetY / height) * image.offsetHeight - dialog.clientHeight / 2,
    );
});
function queueDiscoveries() {
  const version = trip;
  discoveryDone = discoveryDone
    .catch(() => {})
    .then(() => {
      if (version !== trip || saveBlocked) return;
      const found = availableCards(world).filter((id) => !encountered.has(id));
      if (!found.length) return;
      for (const id of found) {
        encountered.add(id);
        coveredCards.add(id);
        fresh.add(id);
      }
      rememberCards();
      render();
      for (const id of found) {
        const shown = $("hand").querySelector(`.card[data-card="${id}"]`);
        if (shown && !shown.closest(".card-frame").hidden)
          void arriveCard(shown);
      }
    });
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
  panel.hidden = !actions.length && $("play-status").hidden;
  // A folded row lies low even with a choice in it.
  document.querySelector(".play-dock").dataset.selected = String(
    selected.length > 0 && !rowCollapsed,
  );
  document.body.dataset.handExpanded = String(
    dragging.length > 0 || !rowCollapsed,
  );
  syncLayering();
  const revision = world.revision;
  const nudgeTarget =
    sharedSession &&
    selected.find(
      (id) => id !== currentActor(world) && world.presentActors?.includes(id),
    );
  row.replaceChildren(
    ...actions.map((action, index) => {
      const sent =
        sharedSession &&
        ["sending", "sent", "playing"].includes(sharedPlay?.state) &&
        sharedPlay.actionKey === action.key;
      const queued = playQueue.pending?.action.key === action.key;
      const button = node(
        "button",
        queued || sent ? progressLabel(action) : playLabel(action),
        index === 0 ? "card-primary" : "card-action",
      );
      button.type = "button";
      button.dataset.action = action.kind;
      button.dataset.queued = String(queued);
      if (sent && !queued) button.dataset.sent = sharedPlay.state;
      button.title =
        queued && !sharedSession ? "Cancel this play" : playText(action);
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
  const withdrawable = ownSharedEntry();
  if (
    sharedSession &&
    (playQueue.pending ||
      (withdrawable && ["waiting", "retry"].includes(withdrawable.status)))
  ) {
    const cancel = node("button", "Cancel play", "card-action");
    cancel.type = "button";
    cancel.dataset.cancelPlay = "true";
    cancel.title = "Withdraw your play";
    cancel.onclick = () =>
      playQueue.pending
        ? playQueue.clear()
        : withdrawSharedPlay(withdrawable.id);
    row.append(cancel);
    panel.hidden = false;
  }
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
  // The top quest, chosen in the open fan, can be dropped (a level quest
  // costs half the experience). Choosing a card beneath brings it to the top.
  const picked = questOpen ? shownQuests[questPick] : null;
  for (const action of picked?.index === 0
    ? legalActions(world).filter(
        (a) => a.kind === "drop" && !a.item && a.quest === 0,
      )
    : []) {
    const button = node("button", playLabel(action), "card-action");
    button.type = "button";
    button.dataset.dropQuest = String(picked.index);
    button.title = picked.level
      ? "Give up this level quest; it costs half your experience"
      : "Give up this quest";
    button.disabled = selectionBlocked();
    button.onclick = () => {
      questOpen = false;
      questPick = 0;
      commitAction(action, revision);
    };
    row.append(button);
    panel.hidden = false;
  }
  // An item with its own view offers a client-only Look; it plays nothing.
  const viewed = selected.length === 1 && selected[0];
  if (viewed && things[viewed]?.view && !cardIsCovered(viewed)) {
    const look = node("button", "Look", "card-action");
    look.type = "button";
    look.dataset.look = viewed;
    look.title = `Look at ${theName(viewed)} up close`;
    look.onclick = () => showItemView(viewed);
    row.append(look);
    panel.hidden = false;
  }
  if (animate) {
    const toHeight = panel.getBoundingClientRect().height;
    if (Math.abs(fromHeight - toHeight) > 1) {
      panel.hidden = false;
      // The row grows with the hand's 220 ms move and fades in as it opens.
      const motion = panel.animate(
        {
          height: [`${fromHeight}px`, `${toHeight}px`],
          opacity: [fromHeight < 1 ? 0 : 1, 1],
        },
        { duration: 220, easing: "ease-out" },
      );
      actionPanelMotion = motion;
      motion.finished
        .then(() => {
          if (actionPanelMotion !== motion) return;
          actionPanelMotion = null;
          panel.hidden = !row.children.length && $("play-status").hidden;
        })
        .catch(() => {});
    }
  }
  $("play-readout").textContent = selected.length
    ? `${selectionName}. ${actions.map(playLabel).join(". ") || hint}`
    : questOpen && (shownQuests[questPick] || sealedQuests[0])
      ? questCaption(
          shownQuests[questPick] || sealedQuests[0],
          questCovered(shownQuests[questPick] || sealedQuests[0]),
        )
      : "";
}
function updateCardSelection(frame) {
  if (frame.dataset.want) {
    const entry = questEntry(frame.dataset.questId);
    if (entry) frame.replaceWith(questFrame(entry));
    return;
  }
  const fold = frame.querySelector(":scope > .quest-fold");
  if (fold) syncQuestFold(fold);
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
        : [],
    stack =
      id === placeHere() ? availableCards(world).filter(stackedPlace) : [];
  frame.dataset.raised = String(raised);
  button.setAttribute("aria-pressed", String(raised));
  button.dataset.selected = String(selected.includes(id));
  button.classList.toggle("new", fresh.has(id));
  if (frame.dataset.holder)
    frame.hidden = places[frame.dataset.holder]
      ? !expandedHolders.has(frame.dataset.holder)
      : !raised && !expandedHolders.has(frame.dataset.holder);
  if (held.length || stack.length) {
    frame.dataset.expanded = String(expandedHolders.has(id));
    button.setAttribute("aria-expanded", String(expandedHolders.has(id)));
  }
  button.querySelector(".sr-only").textContent =
    cardObservation(world, id) +
    (label ? ` ${label}.` : "") +
    (held.length
      ? ` ${places[id] ? "Contains" : "Carries"} ${held.map(nameOf).join(", ")}. Select to show these cards.`
      : "") +
    stackLabel(stack);
}
const handMotions = new Map();
function moveHandPart(key, element, frames, duration = 220) {
  const motion = element.animate(frames, { duration, easing: "ease-out" });
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
  const level = cardLevel(world, id),
    tier = levelTier(level);
  el.dataset.level = String(level);
  el.dataset.tier = tier.id;
  el.dataset.selected = String(selected.includes(id));
  el.style.setProperty("--tier-color", tier.color);
  el.type = "button";
  el.classList.toggle("new", fresh.has(id));
  el.dataset.card = id;
  el.disabled = selectionBlocked();
  el.setAttribute("aria-pressed", String(raised));
  el.setAttribute(
    "aria-label",
    `${def.name}, ${type}, ${tier.label}, level ${level}`,
  );
  el.setAttribute("aria-describedby", `card-detail-${id}`);
  const graphic = node("span", undefined, "art");
  const img = node("img");
  img.decoding = "async";
  img.fetchPriority = "low";
  img.src = imageUrl(
    type === "item"
      ? cardArt(id)
      : type === "avatar"
        ? portrait(id, null, world)
        : crossingFace?.art || placeCardArt(id),
    "card",
  );
  img.alt = "";
  img.draggable = false;
  if (crossingFace?.focus)
    img.style.objectPosition = `${crossingFace.focus.x}% ${crossingFace.focus.y}%`;
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
      cloth.src = imageUrl(cardArt(covering), "card");
      cloth.alt = "";
      graphic.append(cloth);
    }
  }
  const label = playLabel(chosen?.action);
  const observation = node("span", cardObservation(world, id), "sr-only");
  observation.id = `card-detail-${id}`;
  if (raised && label) observation.textContent += ` ${label}.`;
  const hidden = cardIsCovered(id);
  if (hidden) observation.textContent = "";
  el.append(graphic, node("span", hidden ? "" : def.name, "name"), observation);
  // One faint numeral shows a selected person's or thing's level. Places
  // have no level of their own, so they carry none.
  if (type !== "location") {
    const numeral = node("span", romanLevel(level), "card-level");
    numeral.setAttribute("aria-hidden", "true");
    el.append(numeral);
  }
  el.addEventListener("click", () => choose(id));
  el.draggable = !el.disabled && !cardIsCovered(id);
  el.addEventListener("dragstart", (e) => {
    if (selectionBlocked() || cardIsCovered(id)) {
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
    if (
      !selectionBlocked() &&
      !cardIsCovered(id) &&
      dragging.length &&
      !dragging.includes(id)
    ) {
      playQueue.clear();
      rowCollapsed = false;
      selectCards(places[dragging[0]] && places[id] ? [id] : [dragging[0], id]);
      selectionRevision = world.revision;
      render();
    }
    dragging = [];
    $("stage").classList.remove("ready", "drag-over");
  });
  const frame = node("div", undefined, "card-frame");
  frame.dataset.raised = String(raised);
  frame.append(el);
  const holder = things[id]
    ? rootHolder(world, id)
    : stackedPlace(id)
      ? placeHere()
      : null;
  if (stackedPlace(id)) {
    frame.dataset.holder = holder;
    frame.hidden = !expandedHolders.has(holder);
  } else if (people[holder] || places[holder]) {
    frame.dataset.holder = holder;
    frame.hidden = places[holder]
      ? !expandedHolders.has(holder)
      : !raised && !expandedHolders.has(holder);
    el.setAttribute(
      "aria-label",
      `${def.name}, ${places[holder] ? "at" : "carried by"} ${knownName(holder, "someone")}, ${tier.label}, level ${level}`,
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
      const named = held.filter((item) => !cardIsCovered(item)).map(nameOf);
      if (named.length < held.length)
        named.push(`${held.length - named.length} covered`);
      if (!hidden)
        observation.textContent += ` ${places[id] ? "Contains" : "Carries"} ${named.join(", ")}. Select to show these cards.`;
      // One carried thing peeks out behind its holder; the rest wait in
      // the opened stack.
      for (const item of held.slice(0, 1)) {
        const preview = node("img", undefined, "held-preview");
        preview.decoding = "async";
        preview.src = imageUrl(
          cardIsCovered(item) ? "./assets/card-back.webp" : cardArt(item),
          "card",
        );
        preview.alt = "";
        preview.draggable = false;
        frame.prepend(preview);
      }
    }
  }
  const stack =
    id === placeHere() ? availableCards(world).filter(stackedPlace) : [];
  if (stack.length) {
    frame.dataset.places = String(stack.length);
    frame.dataset.expanded = String(expandedHolders.has(id));
    el.setAttribute("aria-expanded", String(expandedHolders.has(id)));
    if (!hidden) observation.textContent += stackLabel(stack);
    // Face-down cards: how many ways on, not where they lead.
    for (let i = Math.min(stack.length, 3); i > 0; i--) {
      const edge = node("span", undefined, "place-edge");
      edge.style.setProperty("--i", String(i));
      edge.style.setProperty("--card-back", cardBackImage());
      frame.prepend(edge);
    }
  }
  if (foldQuest()?.actor === id) frame.prepend(questFold(foldQuest()));
  el.dataset.unrevealed = String(cardIsCovered(id));
  const back = node("img", undefined, "card-back");
  back.src = imageUrl("./assets/card-back.webp", "card");
  back.alt = "";
  back.draggable = false;
  el.append(back);
  if (cardIsCovered(id)) {
    el.setAttribute("aria-label", `Uncover new ${type} card, ${tier.label}`);
    el.removeAttribute("aria-describedby");
  }
  return frame;
}
// Face-down layers in a stack (the ways on, the folded quest and its steps
// to come) show the carved card back.
const cardBackImage = () =>
  `url("${imageUrl("./assets/card-back.webp", "card")}")`;
const stackLabel = (stack) =>
  stack.length
    ? ` ${stack.length} ${stack.length === 1 ? "way" : "ways"} on. Select to show ${stack.length === 1 ? "it" : "them"}.`
    : "";
// The quest card: a small screen showing the player doing the quest's verb
// with its target, with only the verb, the level and the tier colour as
// words. It glows while the target is near and plays nothing.
const questCovered = (quest) => !quest.target || cardIsCovered(quest.target);
const questArt = {
  url: (src) => imageUrl(src, "card"),
  portrait: (id) => portrait(id, null, world),
  thing: (id) => cardArt(id),
  place: (id) =>
    packPlaces[id]?.art && world.actors[currentActor(world)]?.place !== id
      ? packMedia(id, "art")
      : backdrop(id, world),
};
function questFrame({ id, quest, met }) {
  const picked = !met && questOpen && quest.index === questPick;
  const hidden = questCovered(quest),
    tier = questTier(quest),
    verb = questVerb(world, quest, hidden),
    near = !hidden && questNear(world, quest),
    here = world.actors[quest.actor].place;
  const el = node("button", undefined, "card want-card");
  el.type = "button";
  el.dataset.want = quest.kind;
  el.dataset.tier = tier.id;
  el.dataset.near = String(near);
  el.style.setProperty("--tier-color", tier.color);
  el.disabled = selectionBlocked();
  el.dataset.questId = id;
  el.dataset.picked = String(picked);
  el.setAttribute("aria-pressed", String(picked));
  el.setAttribute(
    "aria-label",
    met
      ? `Quest met: ${questCaption(quest, hidden)}. Select to clear it.`
      : `Quest${quest.index ? ` ${quest.index + 1}` : ""}: ${questCaption(quest, hidden)}${near ? ", near" : ""}`,
  );
  if (met) {
    el.dataset.met = "true";
    el.append(node("span", "✓", "quest-seal"));
  }
  const head = node("span", undefined, "quest-head");
  head.append(
    node("span", verb, "quest-verb"),
    node("span", quest.level ? romanLevel(quest.level) : "", "quest-level"),
  );
  const target = quest.target,
    targetPlace =
      quest.kind === "item"
        ? itemPlace(world, target)
        : world.actors[target]?.place;
  el.append(
    questScreen(
      {
        verb,
        actor: quest.actor,
        kind: quest.kind,
        target,
        covered: hidden,
        here: !hidden && targetPlace === here ? here : null,
      },
      questArt,
    ),
    head,
  );
  // A met quest clears; in the open fan choosing another quest brings it to
  // the top, and choosing the chosen one folds the fan again.
  el.addEventListener("click", () => {
    if (met) return clearQuest(el, quest);
    if (questOpen && quest.index !== questPick) return pickQuest(quest);
    if (!questOpen) questPick = quest.index;
    toggleQuest();
  });
  const frame = node("div", undefined, "card-frame want-frame");
  frame.dataset.want = quest.kind;
  frame.dataset.questId = id;
  frame.dataset.raised = String(questOpen && (met || picked));
  // It folds behind the player's avatar until that stack or the quest opens.
  frame.dataset.holder = quest.actor;
  frame.hidden = !questOpen && !expandedHolders.has(quest.actor);
  // Steps still to come lie face down behind the card, as a stack.
  for (let i = Math.min(quest.left - 1, 3); i > 0; i--) {
    const edge = node("span", undefined, "quest-edge");
    edge.style.setProperty("--i", String(i));
    edge.style.setProperty("--tier-color", tier.color);
    edge.style.setProperty("--card-back", cardBackImage());
    frame.append(edge);
  }
  frame.append(el);
  return frame;
}
// Choosing a quest beneath the top plays the rules' focus, which takes no
// turn; the fan stays open on it while the play settles.
function pickQuest(quest) {
  if (selectionBlocked()) return;
  const focus = legalActions(world).find(
    (a) => a.kind === "focus" && a.quest === quest.index,
  );
  questPick = quest.index;
  if (focus) playQueue.submit(focus, world.revision);
  render();
}
function toggleQuest() {
  if (selectionBlocked()) return;
  if (rowCollapsed && foldedChoice && selected.length) {
    foldedChoice = false;
    rowCollapsed = false;
    render();
    return;
  }
  playQueue.clear();
  questOpen = !questOpen;
  if (!questOpen) questPick = 0;
  questFresh = false;
  selected = [];
  expandedHolders.clear();
  rowCollapsed = false;
  render();
}
// The quest shows when the avatar's stack or the quest itself is open.
const questShown = (quest) =>
  Boolean(quest) && (questOpen || expandedHolders.has(quest.actor));
// The folded quest is a card in the avatar's stack: the world's card back
// with a glowing line in its tier colour. The line pulses while a first
// quest is new or a met quest waits to be cleared and holds a steady halo
// while it is near. Once the quest card shows, the fold hides and the card
// glows instead.
function syncQuestFold(fold) {
  const quest = foldQuest();
  fold.hidden = questShown(quest);
  fold.dataset.glow =
    sealedQuests.length || questFresh
      ? "invite"
      : !questCovered(quest) && questNear(world, quest)
        ? "near"
        : "none";
}
function questFold(quest) {
  const fold = node("button", undefined, "quest-fold");
  fold.type = "button";
  fold.style.setProperty("--tier-color", questTier(quest).color);
  fold.style.setProperty("--card-back", cardBackImage());
  syncQuestFold(fold);
  const count = shownQuests.length + sealedQuests.length;
  fold.dataset.count = String(count);
  fold.setAttribute(
    "aria-label",
    sealedQuests.length
      ? "Quest met: open it"
      : count > 1
        ? `${count} quests: open them`
        : "Quest",
  );
  fold.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleQuest();
  });
  return fold;
}
// Clearing a met quest shows the experience it brought rising from the card
// and glows the avatar when it ends a level quest. The rules granted that
// experience, one point, when the quest was met.
function clearQuest(button, quest) {
  if (selectionBlocked()) return;
  const color = button.style.getPropertyValue("--tier-color"),
    box = button.getBoundingClientRect(),
    gain = node("span", "+1 XP", "quest-xp");
  gain.style.setProperty("--tier-color", color);
  gain.style.left = `${box.left + box.width / 2}px`;
  gain.style.top = `${box.top + box.height / 4}px`;
  document.body.append(gain);
  const rise = gain.animate(
    reducedMotion.matches
      ? [{ opacity: 1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }]
      : [
          { opacity: 0, translate: "-50% 0" },
          { opacity: 1, translate: "-50% -16px", offset: 0.3 },
          { opacity: 0, translate: "-50% -44px" },
        ],
    { duration: 1100, easing: "ease-out" },
  );
  rise.finished.catch(() => {}).then(() => gain.remove());
  sealedQuests = sealedQuests.filter((q) => q !== quest);
  if (!sealedQuests.length) questOpen = false;
  render();
  const avatar = $("hand").querySelector(`.card[data-card="${quest.actor}"]`);
  if (quest.level && quest.left <= 1 && avatar) void glowCard(avatar, color);
}
// The stage frames each painting with its measured shape, so a resident
// anchored to it stands on the same spot at every screen size.
$("backdrop").addEventListener("load", (event) => {
  const { naturalWidth: width, naturalHeight: height } = event.target;
  if (width && height)
    $("stage").style.setProperty("--art-ratio", String(width / height));
});
// One stage draws every place. Its data only moves the painting's focus,
// warms a dim place, and anchors a resident to the painting itself.
function renderStage(locationId) {
  const pack = packOf(locationId);
  const stage = stageOf(world, locationId);
  // A place painted in its own light or dark (state backdrops) dims only in
  // the darkest phase of the saved clock, so its paintings aren't darkened twice.
  const lamp =
    (!places[locationId]?.backdrops || isNight(world)) && stage.lamp
      ? stage.lamp
      : null;
  const view = $("stage");
  document.body.dataset.world = pack?.id || "shore";
  document.body.dataset.place = locationId;
  document.body.dataset.dim = String(Boolean(lamp));
  document.body.dataset.lamplit = String(lampLitHere(world, locationId));
  // A world's name waits, like the place's, for its card to be uncovered.
  const worldName = coveredCards.has(locationId)
    ? null
    : pack?.name || "The reflected shore";
  document.querySelector(".brand span").textContent = worldName || "…";
  document.title = worldName ? `CosyWorld · ${worldName}` : "CosyWorld";
  const fraction = (value, fallback) => String((value ?? fallback) / 100);
  view.style.setProperty("--focus-x", fraction(stage.focus?.x, 50));
  view.style.setProperty("--focus-y", fraction(stage.focus?.y, 50));
  view.style.setProperty("--lamp-x", `${lamp?.x ?? 50}%`);
  view.style.setProperty("--lamp-y", `${lamp?.y ?? 50}%`);
  const sprite = stage.sprite;
  for (const [name, value] of [
    ["--figure-left", sprite && sprite.left - sprite.width / 2],
    ["--figure-right", sprite && sprite.left + sprite.width / 2],
    ["--figure-top", sprite?.top],
    ["--figure-width", sprite?.width],
  ])
    if (sprite) view.style.setProperty(name, fraction(value, 0));
    else view.style.removeProperty(name);
  const figures = $("stage-figures");
  let figure = figures.querySelector(".stage-figure");
  if (!stage.resident) {
    figure?.remove();
    return;
  }
  if (figure?.dataset.resident !== stage.resident) {
    figure?.remove();
    figure = node("img", undefined, "stage-figure");
    figure.dataset.resident = stage.resident;
    figure.decoding = "async";
    figure.fetchPriority = "high";
    figures.append(figure);
  }
  figure.style.setProperty("--sprite-left", `${sprite.left}%`);
  figure.style.setProperty("--sprite-top", `${sprite.top}%`);
  figure.style.setProperty("--sprite-width", `${sprite.width}%`);
  const mood = variantOf(world, stage.resident);
  const source = imageUrl(portrait(stage.resident, null, world));
  if (figure.getAttribute("src") !== source) figure.src = source;
  figure.dataset.state = mood?.name || "present";
  figure.alt = coveredCards.has(stage.resident)
    ? "Someone"
    : mood?.alt || nameOf(stage.resident);
}
function dropFigure(figure) {
  figure.remove();
  releaseImages(figure);
}
function leaveFigure(figure, remove = false) {
  if (exits.has(figure)) return;
  if (remove) figure.dataset.removing = "true";
  figure.setAttribute("aria-hidden", "true");
  if (reducedMotion.matches || $("travel").classList.contains("travelling")) {
    if (remove) dropFigure(figure);
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
      if (remove) dropFigure(figure);
      animation.cancel();
      exits.delete(figure);
    });
  exits.set(figure, task);
}
function returnToLive() {
  sharedPlayback.reset();
  reviewing = false;
  reviewBeat = null;
  lineSeq = null;
  sharedLineKey = "";
  syncSharedLine();
  renderScene();
  if (!$("dialogue-advance").hidden) $("dialogue-advance").focus();
}
const litCarried = (actor) =>
  Object.keys(world.items).find(
    (id) => world.items[id].lit && rootHolder(world, id) === actor,
  ) || null;
function renderHeldItem(figure, actor, itemId) {
  let preview = figure.querySelector(".portrait-held-item");
  figure.setAttribute(
    "aria-label",
    itemId
      ? `${knownName(actor.id, "Someone")} holds ${knownName(itemId, "a covered card")}`
      : knownName(actor.id, "Someone"),
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
      image.src = imageUrl(cardArt(id), "card");
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

// Things lying here stand on the painted floor behind the cast as cutouts of
// the hand card art. They are scenery only; the hand cards remain the way to
// play them.
function renderFloorItems(items) {
  const floor = $("floor-items");
  const existing = new Map(
    [...floor.children].map((el) => [el.dataset.item, el]),
  );
  floor.dataset.count = String(items.length);
  floor.replaceChildren(
    ...items.map(({ id, cover, lit, ringing, spots }) => {
      let prop = existing.get(id);
      if (!prop) {
        prop = node("span", undefined, "floor-item");
        prop.dataset.item = id;
      }
      const key = JSON.stringify([id, cover]);
      if (prop.dataset.key !== key) {
        prop.dataset.key = key;
        prop.replaceChildren(
          ...[id, cover].filter(Boolean).map((art, index) => {
            const image = node("img", undefined, index ? "object-cover" : "");
            image.decoding = "async";
            image.src = imageUrl(cardArt(art), "card");
            image.alt = "";
            image.draggable = false;
            return image;
          }),
        );
      }
      for (const [layout, spot] of Object.entries(spots)) {
        prop.dataset[layout] = String(Boolean(spot));
        if (!spot) continue;
        prop.style.setProperty(`--${layout}-x`, `${spot.x}%`);
        prop.style.setProperty(`--${layout}-lift`, String(spot.lift));
      }
      prop.dataset.lit = lit === undefined ? "" : String(lit);
      prop.dataset.covered = String(Boolean(cover));
      prop.dataset.ringing = String(Boolean(ringing));
      return prop;
    }),
  );
}

function renderScene() {
  // Every path to this renderer keeps the source visible until the veil covers it.
  if (covering) return;
  const view = shownWorld();
  const scene = currentScene(view, null, {
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
  // Night falling or weather turning where the player stays fades in.
  const stayed = img.dataset.place === scene.locationId;
  const phase = scene.daylight?.phase || "day";
  const nightfall = stayed && img.dataset.phase !== phase;
  img.dataset.place = scene.locationId;
  img.dataset.phase = phase;
  img.dataset.source = scene.background;
  $("stage").dataset.settled = String(stayed);
  crossfadeImage(img, background, {
    duration:
      !stayed || reducedMotion.matches
        ? 0
        : nightfall
          ? CROSSFADE_MS
          : CHANGE_FADE_MS,
  });
  img.alt = coveredCards.has(scene.locationId)
    ? ""
    : stageOf(world, scene.locationId).alt ||
      placeText(world, scene.locationId);
  if (scene.weather) img.alt += ` Weather: ${scene.weather.condition}.`;
  if (scene.daylight) img.alt += ` ${scene.daylight.description}`;
  img.dataset.locationVariant = scene.variant;
  $("stage").dataset.timeOfDay = scene.daylight?.phase || "day";
  renderWeather($("stage"), scene.weather, { ease: stayed });
  let overlay = $("location-overlay");
  if (scene.overlay && !overlay) {
    overlay = node("img", undefined, "backdrop location-overlay");
    overlay.id = "location-overlay";
    overlay.hidden = true;
    overlay.style.pointerEvents = "none";
    img.after(overlay);
  }
  if (overlay) {
    const overlaySource = imageUrl(scene.overlay);
    if (scene.overlay && overlay.getAttribute("src") !== overlaySource)
      overlay.src = overlaySource;
    fadeLayer(overlay, Boolean(scene.overlay), {
      duration: !stayed || reducedMotion.matches ? 0 : CHANGE_FADE_MS,
    });
    overlay.alt = scene.overlay ? placeText(world, scene.locationId) : "";
  }
  const staging = sceneStaging(view, {
    through: view.log.length - 1,
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
    const previous = image.getAttribute("src"),
      from = shownStageLevels.get(id);
    const level = cardLevel(view, id);
    shownStageLevels.set(id, level);
    image.decoding = "async";
    image.fetchPriority = "high";
    if (image.getAttribute("src") !== source) image.src = source;
    if (!reviewing && crossedPortraitTier(id, from, level))
      void transformPortrait(image, previous, {
        reduced: reducedMotion.matches,
      });
    image.dataset.source = actor.cutout;
    image.dataset.flip = String(flipStagePortrait(actor.cutout, actor.facing));
    figure.dataset.flip = image.dataset.flip;
    // A raised hand card shows in the player's hand; otherwise a figure
    // carrying a lit light holds it up, as Vale wakes holding the lamp.
    renderHeldItem(
      figure,
      actor,
      (id === currentActor(world) && handItem) || litCarried(id),
    );
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
  hauntScene($("stage"), scene.locationId, {
    reduced: reducedMotion.matches,
    url: (source) => imageUrl(source),
  });
  renderStandingResolve($("cast"), world, scene.locationId);
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
  const shared = Boolean(sharedSession);
  const viewer = currentActor(world);
  const sharedLive = sharedSession
    ? sharedLiveLine(sharedSession.state, sharedSession.now(), scene.locationId)
    : null;
  // Speech the exchange or the room's reading clock has not reached stays
  // unseen; a beat arrives in front when its line is shown.
  const liveThrough = sharedSession
    ? reviewing
      ? (sharedLive?.seq ?? Infinity)
      : (lineSeq ?? Infinity)
    : exchange.active
      ? (exchange.current?.seq ?? -Infinity)
      : Infinity;
  const hiddenSpeech = (line) =>
    line.seq > liveThrough && (shared || line.turn === world.turn);
  // Queued shared plays commit before their words. While the room clock still
  // has lines to read, later turns' actions wait for their own scene.
  const shownTurn = sharedSession
    ? view.log.find((entry) => entry.seq === liveThrough)?.turn
    : undefined;
  const moreToRead =
    shownTurn !== undefined &&
    view.log.some(
      (entry) =>
        entry.generated &&
        entry.seq > liveThrough &&
        entry.locationId === scene.locationId,
    );
  const hiddenAction = (entry) => moreToRead && entry.turn > shownTurn;
  const wordsFailed = storyStatus === "retry";
  const waiting = sharedSession
    ? sharedSpeech.status === "pending" &&
      !(
        scene.line &&
        scene.line.turn === world.turn &&
        scene.line.seq <= liveThrough
      )
    : Boolean(
        exchange.preparing ||
          awaitingNext ||
          (storyStatus === "pending" && !exchange.current),
      );
  const stack = withPending(
    sceneBeats(view, {
      viewer,
      shared,
      held: combatHeld,
      hiddenSpeech,
      hiddenAction,
    }),
    { speakerId: waiting ? waitingSpeaker || "" : null, turn: world.turn },
  );
  const beats = stack.beats;
  const pendingCard =
    stack.pending ||
    (waiting
      ? {
          key: `p:${world.turn}:`,
          speakerId: null,
          line: null,
          actions: [],
          pending: true,
        }
      : null);
  const liveIndex = pendingCard ? beats.length : beats.length - 1;
  let frontIndex = -1;
  if (reviewing) {
    frontIndex = beats.findIndex((beat) => beat.key === reviewBeat);
    if (frontIndex < 0 && lineSeq !== null)
      frontIndex = beats.findIndex((beat) => beat.line?.seq === lineSeq);
  }
  if (frontIndex < 0) frontIndex = liveIndex;
  const front =
    frontIndex === beats.length ? pendingCard : beats[frontIndex] || null;
  const behind = frontIndex > 0 ? beats[frontIndex - 1] : null;
  const behindLive = reviewing && frontIndex < liveIndex;
  stackView = { beats, frontIndex, liveIndex, pending: pendingCard };
  // A new front beat moves the stack: forward when it is later, back when
  // earlier. Measured before the cards change.
  const frontKey = front?.key ?? null;
  let direction = null;
  if (frontKey !== stackRendered.key) {
    const was = beats.findIndex((beat) => beat.key === stackRendered.key);
    const settled =
      stackRendered.key?.startsWith("p:") &&
      front?.speakerId === stackRendered.speaker;
    direction =
      stackRendered.place !== scene.locationId || !stackRendered.key
        ? "arrive"
        : settled
          ? "settle"
          : was < 0 || was < frontIndex
            ? "forward"
            : "back";
  }
  // The leaving cards are copies, so the real cards can change at once.
  for (const old of document.querySelectorAll(".beat-ghost")) old.remove();
  const stepping = direction === "forward" || direction === "back";
  const ghost = {
    behind:
      (direction === "forward" || (stepping && reducedMotion.matches)) &&
      !$("beat-behind").hidden
        ? stackGhost($("beat-behind"))
        : null,
    front: stepping && !$("speech-row").hidden ? frontGhost(direction) : null,
  };
  stackRendered = {
    key: frontKey,
    speaker: front?.speakerId ?? null,
    place: scene.locationId,
  };
  const line = front?.line || null;
  shownSceneLine = line;
  const text = line ? line.text : "";
  $("speaker").textContent = front
    ? line?.speaker || (front.speakerId ? nameOf(front.speakerId) : "")
    : "";
  const canRetryWords = !sharedSession || Boolean(sharedSpeech.retryKey);
  $("story-status").hidden =
    behindLive ||
    wordsFailed ||
    (storyStatus === "ready" && !exchange.preparing);
  $("story-status").setAttribute("aria-label", "Thinking about this scene");
  $("speech-row").setAttribute("aria-busy", String(!$("story-status").hidden));
  const retryWords = $("story-retry");
  retryWords.hidden = !wordsFailed || behindLive;
  retryWords.disabled = storyRetrying || !canRetryWords;
  retryWords.title = canRetryWords ? "Retry dialogue" : "Waiting for dialogue";
  retryWords.setAttribute("aria-label", retryWords.title);
  const portraitId = front?.speakerId || null;
  const portraitBox = $("speaker-portrait");
  // Key on the resolved art too, so a scarf given or taken repaints it.
  const portraitSource = beatPortrait(portraitId);
  if (
    portraitBox.dataset.entity !== (portraitId || "") ||
    portraitBox.dataset.source !== portraitSource
  ) {
    portraitBox.dataset.entity = portraitId || "";
    portraitBox.dataset.source = portraitSource;
    releaseImages(portraitBox);
    portraitBox.replaceChildren();
    if (portraitId) {
      const image = node("img");
      image.alt = "";
      image.decoding = "async";
      image.src = portraitSource;
      portraitBox.dataset.kind = people[portraitId] ? "avatar" : "scene";
      if (people[portraitId]) frameFigure(image);
      portraitBox.append(image);
    }
  }
  frontCaptions = (front?.actions || []).map((action) => action.text);
  const captions = $("beat-captions");
  const captionKey = JSON.stringify(front?.actions || []);
  if (captions.dataset.key !== captionKey) {
    captions.dataset.key = captionKey;
    captions.replaceChildren(
      ...(front?.actions || []).map((action) => {
        const item = node("span", undefined, "beat-caption");
        item.dataset.kind = action.kind;
        item.append(beatIcon(action.icon), node("span", action.text));
        return item;
      }),
    );
  }
  captions.hidden = !front?.actions.length;
  const showFront = Boolean(front) || wordsFailed;
  document.querySelector(".dialogue").hidden =
    !showFront && !sharedSession?.state.queue?.length;
  syncLayering();
  document.querySelector(".dialogue").dataset.behind = String(Boolean(behind));
  $("speech-row").hidden = !showFront;
  $("speech-row").dataset.beat = front?.line
    ? front.silent
      ? "silent"
      : "speech"
    : front?.pending
      ? "pending"
      : "action";
  $("dialogue-text").hidden = !text;
  $("dialogue-advance").hidden = !text && !front?.actions.length;
  $("speech-hint").hidden = true;
  if (text) {
    const speaker = line.entityId || line.actorId || scene.locationId;
    const key = JSON.stringify([line.seq, speaker, text]);
    // A local line from an earlier turn that is still the latest beat was
    // already read; it stays whole instead of being written again.
    reveal.show(key, text, speaker, {
      instant:
        completedSpeech.has(key) ||
        (!sharedSession && !reviewing && line.turn !== world.turn),
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
    // An action beat is announced when it arrives live.
    const announce =
      !reviewing && front && !front.pending && front.actions.length
        ? `${nameOf(front.speakerId)}: ${frontCaptions.join(" ")}`
        : "";
    if (announce && announcedBeat !== front.key) {
      announcedBeat = front.key;
      $("speech-announcement").textContent = announce;
    } else if (!announce) $("speech-announcement").textContent = "";
  }
  updateSpeechControls(reveal.complete);
  // The card behind is one earlier beat: tap it to step back in time.
  const behindButton = $("beat-behind");
  behindButton.hidden = !behind;
  if (behind) {
    const summary = beatSummary(behind);
    const behindKey = JSON.stringify([
      behind.key,
      summary.text,
      behind.speakerId,
    ]);
    if (behindButton.dataset.key !== behindKey) {
      behindButton.dataset.key = behindKey;
      fillPortrait(
        behindButton.querySelector(".beat-behind-portrait"),
        behind.speakerId,
      );
      const words = behindButton.querySelector(".beat-behind-text");
      const first = behind.actions[0];
      const caption = node("span", undefined, "beat-behind-caption");
      if (first) caption.append(beatIcon(first.icon), first.text);
      words.replaceChildren(
        node("strong", summary.speaker),
        ...(summary.speech
          ? [node("span", summary.speech, "beat-behind-speech")]
          : []),
        ...(first ? [caption] : []),
      );
      behindButton.dataset.beat = behind.line ? "speech" : "action";
    }
    behindButton.setAttribute(
      "aria-label",
      `Step back to ${summary.speaker}: ${summary.speech || behind.actions[0]?.text || ""}`,
    );
  }
  // One live control, only while behind live, counting the newer beats.
  const newer = Math.max(0, liveIndex - frontIndex);
  const liveButton = $("live-line");
  liveButton.hidden = !behindLive;
  liveButton.dataset.live = String(!behindLive);
  liveButton.querySelector(".beat-live-count").textContent = newer
    ? ` · ${newer}`
    : "";
  liveButton.title = newer
    ? `Return to live dialogue · ${newer} newer`
    : "Return to live dialogue";
  liveButton.setAttribute("aria-label", liveButton.title);
  liveButton.onclick = returnToLive;
  if (sharedSession) {
    // The queue lists whoever plays next first.
    const nextActor = sharedNextActor(
      sharedSession.state,
      sharedSession.now(),
      scene.locationId,
    );
    renderSharedQueue(sharedSession, sharedQueuePortrait, {
      liveActor: sharedSession.state.queue?.some(
        (entry) => entry.actor === nextActor,
      )
        ? nextActor
        : null,
      onWithdraw: withdrawSharedPlay,
    });
  }
  animateStack(direction, ghost);
}
// The art for a beat's speaker: a person, a place, or an item.
// Dropping the address lets the browser free the decoded picture now rather
// than whenever the node is collected.
function releaseImages(root) {
  if (!root) return;
  for (const image of root.querySelectorAll("img"))
    image.removeAttribute("src");
}
function fillPortrait(face, id) {
  releaseImages(face);
  face.replaceChildren();
  const source = beatPortrait(id);
  if (!source) return;
  const image = node("img");
  image.alt = "";
  image.decoding = "async";
  image.src = source;
  face.dataset.kind = people[id] ? "avatar" : "scene";
  if (people[id]) frameFigure(image);
  face.append(image);
}
function beatPortrait(id) {
  if (!id) return "";
  return imageUrl(
    people[id]
      ? portrait(id, null, world)
      : places[id]
        ? backdrop(id, world)
        : cardArt(id),
    "card",
  );
}
let stackView = { beats: [], frontIndex: -1, liveIndex: -1, pending: null };
let stackRendered = { key: null, speaker: null, place: null };
// The leaving card fades faster than the new one arrives, so their words
// barely overlap.
const STACK_MS = 300,
  STACK_LEAVE_MS = 200,
  STACK_FADE_MS = 160;
// A leaving card is an inert copy that never takes pointer hits.
function ghostOf(card) {
  const ghost = card.cloneNode(true);
  for (const part of [ghost, ...ghost.querySelectorAll("[id], [aria-live]")]) {
    part.removeAttribute("id");
    part.removeAttribute("aria-live");
  }
  ghost.classList.add("beat-ghost");
  delete ghost.dataset.motion;
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  for (const image of ghost.querySelectorAll("img")) image.decoding = "sync";
  return ghost;
}
function stackGhost(card) {
  const ghost = ghostOf(card);
  card.after(ghost);
  return ghost;
}
// The old front card keeps its exact box, so its words do not reflow. Going
// forward it settles behind the new card; going back, or crossfading for
// reduced motion, it leaves over it.
function frontGhost(direction) {
  const under = direction === "forward" && !reducedMotion.matches;
  return pinnedGhost($("speech-row"), under ? "1" : "3");
}
// A copy pinned to the card's box, with the look the card had.
function pinnedGhost(card, zIndex) {
  const ghost = ghostOf(card);
  // The card's styles hang on its ids, which the copy cannot share, so the
  // copy keeps the look it had.
  const copies = [ghost, ...ghost.querySelectorAll("*")];
  [card, ...card.querySelectorAll("*")].forEach((part, index) => {
    const look = getComputedStyle(part);
    for (const name of look)
      if (!/^(animation|transition|pointer-events)/.test(name))
        copies[index].style.setProperty(name, look.getPropertyValue(name));
  });
  Object.assign(ghost.style, {
    position: "absolute",
    margin: "0",
    left: `${card.offsetLeft}px`,
    top: `${card.offsetTop}px`,
    width: `${card.offsetWidth}px`,
    height: `${card.offsetHeight}px`,
    zIndex,
  });
  // After the card, so lookups by class still find the real one first.
  card.after(ghost);
  return ghost;
}
// Cards move in depth with transform and opacity; reduced motion crossfades.
// The front and behind cards are hit-tested buttons, so their motion is a CSS
// animation named by data-motion rather than element.animate(): after a modal
// dialog closes, Chromium can resolve a Web Animation's target from a style
// cached while the page was inert, and the card stops taking clicks.
function playMotion(card, motion) {
  delete card.dataset.motion;
  if (!motion) return;
  void card.offsetWidth;
  card.dataset.motion = motion;
}
for (const id of ["speech-row", "beat-behind"]) {
  const card = $(id),
    settle = (event) => {
      if (event.target === card) delete card.dataset.motion;
    };
  card.addEventListener("animationend", settle);
  card.addEventListener("animationcancel", settle);
}
// A ghost rests invisible, so it never shows again after its fade ends.
function fadeGhost(ghost, to, duration) {
  if (!ghost) return;
  const from = getComputedStyle(ghost).opacity;
  ghost.style.opacity = "0";
  const done = () => {
    ghost.remove();
    releaseImages(ghost);
  };
  ghost
    .animate([{ opacity: from }, { opacity: 0, ...to }], {
      duration,
      easing: "cubic-bezier(.22,.61,.36,1)",
    })
    .finished.then(done, done);
}
function animateStack(direction, ghost) {
  const front = $("speech-row"),
    behind = $("beat-behind");
  if (!direction || front.hidden) {
    for (const copy of [ghost.front, ghost.behind]) {
      copy?.remove();
      releaseImages(copy);
    }
    return;
  }
  const showBehind = !behind.hidden;
  // Reduced motion turns off CSS animation, so the old cards' copies fade
  // out over the new ones instead.
  if (reducedMotion.matches) {
    fadeGhost(ghost.front, {}, STACK_FADE_MS);
    fadeGhost(ghost.behind, {}, STACK_FADE_MS);
    return;
  }
  if (direction === "arrive" || direction === "settle") {
    if (direction === "arrive") {
      playMotion(front, "fade");
      if (showBehind) playMotion(behind, "fade");
    }
    return;
  }
  // The behind slot is the front card raised by the peek and scaled down;
  // the card before it waits one step deeper, the next one just in front.
  const stack = getComputedStyle(front.closest(".beat-stack"));
  const peek = parseFloat(stack.getPropertyValue("--beat-peek")) || 30;
  const scale =
    parseFloat(stack.getPropertyValue("--beat-behind-scale")) || 0.94;
  const slot = `translateY(-${peek}px) scale(${scale})`;
  const deeper = `translateY(-${peek * 2}px) scale(${scale * scale})`;
  const nearer = "translateY(8px) scale(1.015)";
  if (direction === "forward") {
    // The new beat fades in front; the old front settles into the slot.
    playMotion(front, "arrive");
    if (showBehind) playMotion(behind, "recede");
    fadeGhost(ghost.front, { transform: slot }, STACK_LEAVE_MS);
    fadeGhost(ghost.behind, { transform: deeper }, STACK_MS);
    return;
  }
  // Back in time: the card behind comes forward; an older one appears behind.
  playMotion(front, "return");
  if (showBehind) playMotion(behind, "emerge");
  fadeGhost(ghost.front, { transform: nearer }, STACK_LEAVE_MS);
}
function stepBack() {
  const beat = stackView.beats[stackView.frontIndex - 1];
  if (!beat) return false;
  reviewing = true;
  reviewBeat = beat.key;
  if (beat.line) lineSeq = beat.line.seq;
  renderScene();
  return true;
}
function stepForward() {
  if (!reviewing || stackView.frontIndex >= stackView.liveIndex) return false;
  const next = stackView.frontIndex + 1;
  if (next >= stackView.liveIndex) {
    returnToLive();
    return true;
  }
  const beat = stackView.beats[next];
  reviewBeat = beat.key;
  if (beat.line) lineSeq = beat.line.seq;
  renderScene();
  return true;
}
// Tap the front card: finish the line, step toward live, or move the
// exchange on to its next speaker.
function advanceFront() {
  if (!$("dialogue-text").hidden && !reveal.complete) {
    reveal.finish();
    speechSounds.stop();
    return;
  }
  if (stepForward()) return;
  if (exchange.current) {
    characterSpeech.stop();
    syncSpeechPlayback();
    finishSpokenLine();
    exchange.advance();
  }
}
$("dialogue-advance").onclick = advanceFront;
$("beat-behind").onclick = () => {
  stepBack();
};
$("dialogue-advance").addEventListener("keydown", (event) => {
  const amount = {
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
});
// ↑ steps back in time and ↓ toward live, from the stack or the open scene.
document.addEventListener("keydown", (event) => {
  if (
    !["ArrowUp", "ArrowDown"].includes(event.key) ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    document.querySelector("dialog[open], .world-menu:popover-open")
  )
    return;
  const target = event.target;
  if (target !== document.body && !target.closest?.(".dialogue")) return;
  // A long line scrolls first, then the arrows step through the beats.
  const words = $("dialogue-text");
  if (target === $("dialogue-advance") && !words.hidden) {
    const room =
      event.key === "ArrowUp"
        ? words.scrollTop > 0
        : words.scrollTop + words.clientHeight < words.scrollHeight - 1;
    if (room) {
      event.preventDefault();
      words.scrollTop += event.key === "ArrowUp" ? -28 : 28;
      return;
    }
  }
  const moved = event.key === "ArrowUp" ? stepBack() : stepForward();
  if (moved) event.preventDefault();
});
{
  const stackBox = document.querySelector(".dialogue");
  let wheelAt = 0;
  stackBox.addEventListener(
    "wheel",
    (event) => {
      if (Math.abs(event.deltaY) < 4) return;
      const words = $("dialogue-text");
      const scrolls =
        words.contains(event.target) &&
        (event.deltaY < 0
          ? words.scrollTop > 0
          : words.scrollTop + words.clientHeight < words.scrollHeight - 1);
      if (scrolls) return;
      event.preventDefault();
      if (performance.now() - wheelAt < STACK_MS + 100) return;
      wheelAt = performance.now();
      if (event.deltaY < 0) stepBack();
      else stepForward();
    },
    { passive: false },
  );
  // Swipe down brings the earlier card forward; swipe up steps toward live.
  let touch = null;
  stackBox.addEventListener(
    "touchstart",
    (event) => {
      const point = event.touches[0];
      touch = point ? { x: point.clientX, y: point.clientY } : null;
    },
    { passive: true },
  );
  stackBox.addEventListener("touchend", (event) => {
    const point = event.changedTouches[0];
    if (!touch || !point) return;
    const dx = point.clientX - touch.x,
      dy = point.clientY - touch.y;
    touch = null;
    if (Math.abs(dy) < 32 || Math.abs(dy) < Math.abs(dx)) return;
    const moved = dy > 0 ? stepBack() : stepForward();
    if (moved && event.cancelable) event.preventDefault();
  });
}
let renderedMemory = "";
// Memory is opened on purpose: every remembered visit, newest first, as the
// same beats the stack shows. Closed, it holds no portraits at all.
function renderLog(open = $("history-dialog").open) {
  const box = $("messages");
  if (!open) {
    releaseImages(box);
    box.replaceChildren();
    renderedMemory = "";
    return;
  }
  const visits = memoryVisits(shownWorld(), {
    viewer: currentActor(world),
    shared: Boolean(sharedSession),
    held: combatHeld,
  });
  const key = JSON.stringify(
    visits.map((visit) => [
      visit.key,
      visit.placeId,
      visit.beats.map((beat) => [
        beat.key,
        beat.line?.text,
        beat.actions.map((action) => action.text),
      ]),
    ]),
  );
  if (key === renderedMemory) return;
  renderedMemory = key;
  box.replaceChildren(
    ...visits.map((visit) => {
      const section = node("section", undefined, "memory-visit");
      section.append(node("h3", nameOf(visit.placeId), "memory-place"));
      const list = node("ol", undefined, "memory-beats");
      for (const beat of visit.beats) {
        const item = node("li", undefined, "message memory-beat");
        item.dataset.beat = beat.line
          ? beat.silent
            ? "silent"
            : "speech"
          : "action";
        const face = node("span", undefined, "memory-portrait");
        face.setAttribute("aria-hidden", "true");
        const source = beatPortrait(beat.speakerId);
        if (source) {
          const image = node("img");
          image.alt = "";
          image.loading = "lazy";
          image.src = source;
          face.dataset.kind = people[beat.speakerId] ? "avatar" : "scene";
          if (people[beat.speakerId]) frameFigure(image);
          face.append(image);
        }
        const body = node("div", undefined, "memory-body");
        body.append(
          node("div", beat.line?.speaker || nameOf(beat.speakerId), "speaker"),
        );
        if (beat.line) body.append(node("p", beat.line.text));
        for (const action of beat.actions) {
          const caption = node("p", undefined, "beat-caption");
          caption.dataset.kind = action.kind;
          caption.append(beatIcon(action.icon), node("span", action.text));
          body.append(caption);
        }
        item.append(face, body);
        list.append(item);
      }
      section.append(list);
      return section;
    }),
  );
}

function render() {
  renderPlayers();
  music.setStarted(musicHasStarted());
  hum.setStarted(musicHasStarted());
  ringHeard();
  // While the travel veil comes down, the old place stays drawn.
  if (covering) return;
  music.setRoom(
    world.actors[currentActor(world)].place,
    locationDaylight(world, world.actors[currentActor(world)].place)?.phase ||
      "day",
  );
  humRoom();
  const focused = document.activeElement?.dataset.card,
    scroll = $("hand").scrollLeft;
  $("hand").dataset.presentedRevision = String(world.revision);
  $("place-title").textContent = knownName(
    world.actors[currentActor(world)].place,
  );
  if (rowCollapsed) expandedHolders.clear();
  else
    for (const id of selected) {
      if (people[id] || places[id]) expandedHolders.add(id);
    }
  // The quests the rules met since the last look stay, sealed, until cleared.
  const liveQuests = questCards(world);
  if (questSeq !== null && world.eventSeq > questSeq)
    sealedQuests = [
      ...metQuests(shownQuests, world, questSeq),
      ...sealedQuests,
    ];
  questSeq = world.eventSeq;
  // A quest where there was none, such as the first at the pond, is new.
  if (!shownQuests.length && liveQuests.length && renderedHand)
    questFresh = true;
  // The chosen quest stays chosen as the stack reorders around it.
  const pickedKey = shownQuests[questPick]?.key;
  shownQuests = liveQuests;
  questPick = Math.max(
    0,
    shownQuests.findIndex((q) => q.key === pickedKey),
  );
  // A new quest stops glowing once its card has been seen.
  if (questShown(foldQuest())) questFresh = false;
  const handCards = questHand(
    stackPlaces(availableCards(world)),
    world,
    questEntries().map((entry) => entry.id),
  );
  // Published speech can unlock cards and plays during the current turn.
  const handState = JSON.stringify([
    handCards,
    [...coveredCards],
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
    shownQuests.map((q) => q.key),
    sealedQuests.map((q) => q.key),
    questPick,
    questOpen,
    questFresh,
  ]);
  if (handKey !== renderedHand) {
    const sameWorld =
        renderedHand &&
        renderedHandRevision === world.revision &&
        renderedHandState === handState,
      // A redraw from a shared update or another tab is no arrival: the
      // hand keeps its scroll unless the player's avatar changed place.
      stayed = renderedHandPlace === world.actors[currentActor(world)].place,
      samePlace = renderedHand && stayed,
      arriving = renderedHandPlace !== null && !stayed,
      animate = samePlace && !reducedMotion.matches,
      before = new Map();
    if (animate)
      for (const frame of $("hand").children)
        if (!frame.hidden) {
          const rect = frame.getBoundingClientRect(),
            name = frame.querySelector(".name"); // the quest card has none
          before.set(
            frame.querySelector(".card").dataset.card ?? frame.dataset.questId,
            {
              left: rect.left,
              top: rect.top,
              nameBottom: name && getComputedStyle(name).bottom,
            },
          );
        }
    for (const motion of handMotions.values()) motion.cancel();
    handMotions.clear();
    const wasExpanded = document.body.dataset.handExpanded;
    renderedHand = handKey;
    renderedHandRevision = world.revision;
    renderedHandPlace = world.actors[currentActor(world)].place;
    renderedHandState = handState;
    if (sameWorld)
      for (const frame of $("hand").children) updateCardSelection(frame);
    else
      $("hand").replaceChildren(
        ...handCards.map((id) =>
          isQuestId(id) ? questFrame(questEntry(id)) : card(id),
        ),
      );
    // Lean the new row before measuring it, so each card moves from where
    // it was to its fanned place.
    fanHand();
    $("hand").scrollLeft = stayed ? scroll : 0;
    renderActions(animate);
    // On wide screens raising or lowering the hand is one motion: the deck
    // grows from its corner into the row while the dialogue slides from
    // beside it to the middle (style.css). Reduced motion crossfades.
    const reshaped =
      wideLayout.matches &&
      wasExpanded !== undefined &&
      wasExpanded !== document.body.dataset.handExpanded;
    if (reshaped && reducedMotion.matches)
      for (const part of [".play-dock", ".dialogue"])
        document
          .querySelector(part)
          .animate({ opacity: [0, 1] }, { duration: LAYOUT_MS });
    if (!sameWorld) playLevelUps();
    if (arriving) revealHandCard(renderedHandPlace, true, true);
    if (animate)
      for (const frame of $("hand").children) {
        if (frame.hidden) continue;
        const id =
            frame.querySelector(".card").dataset.card ?? frame.dataset.questId,
          previous = before.get(id) || before.get(frame.dataset.holder);
        if (!previous) {
          // A card that joins the hand here (the ship docking) fades in.
          if (before.size)
            moveHandPart(
              `frame:${id}`,
              frame,
              { opacity: [0, 1] },
              CARD_ARRIVE_MS,
            );
          continue;
        }
        const next = frame.getBoundingClientRect(),
          dx = previous.left - next.left,
          dy = previous.top - next.top;
        if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1 || !before.has(id))
          moveHandPart(
            `frame:${id}`,
            frame,
            {
              translate: [`${dx}px ${dy}px`, "0 0"],
              opacity: [before.has(id) ? 1 : 0.3, 1],
            },
            reshaped ? LAYOUT_MS : undefined,
          );
        const name = frame.querySelector(".name"),
          nameBottom = name && getComputedStyle(name).bottom;
        if (name && before.has(id) && previous.nameBottom !== nameBottom)
          moveHandPart(
            `name:${id}`,
            name,
            { bottom: [previous.nameBottom, nameBottom] },
            reshaped ? LAYOUT_MS : undefined,
          );
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
  updateHandEdges();
}
function playLevelUps() {
  for (const button of $("hand").querySelectorAll(".card[data-card]")) {
    const id = button.dataset.card,
      level = Number(button.dataset.level),
      from = shownLevels.get(id);
    shownLevels.set(id, level);
    if (
      from < level &&
      !cardIsCovered(id) &&
      !button.closest(".card-frame").hidden
    )
      void levelUpCard(button, from, {
        frame: frameFigure,
        previousPortrait: crossedPortraitTier(id, from, level)
          ? imageUrl(portrait(id), "card")
          : null,
      });
  }
}
function revealHandCard(id, alignStart = false, instant = false) {
  const hand = $("hand"),
    frame = hand.querySelector(`[data-card="${id}"]`)?.closest(".card-frame");
  if (!frame || frame.hidden) return;
  const left = frame.offsetLeft - hand.offsetLeft,
    right = left + frame.offsetWidth,
    // Keep the revealed card clear of the faded edges.
    margin = Math.max(
      16,
      parseFloat(getComputedStyle(hand).getPropertyValue("--hand-fade")) || 0,
    ),
    visibleLeft = hand.scrollLeft + margin,
    visibleRight = hand.scrollLeft + hand.clientWidth - margin;
  const target =
    alignStart || left < visibleLeft
      ? left - margin
      : right > visibleRight
        ? right - hand.clientWidth + margin
        : hand.scrollLeft;
  hand.scrollTo({
    left: target,
    behavior: instant || reducedMotion.matches ? "instant" : "smooth",
  });
}
// The fan: each shown card leans by its distance from the row's middle.
function fanHand() {
  const shown = [...$("hand").children].filter((frame) => !frame.hidden);
  shown.forEach((frame, i) =>
    frame.style.setProperty("--fan-at", String(i - (shown.length - 1) / 2)),
  );
}
// Fade only the hand's edges that hide more cards.
function updateHandEdges() {
  fanHand();
  const hand = $("hand"),
    overflow = hand.scrollWidth > hand.clientWidth + 2,
    first = hand.querySelector(".card-frame:not([hidden])");
  // Scroll snapping rests the first card at its padded start, not at zero.
  const start = first
    ? first.offsetLeft -
      hand.offsetLeft -
      (parseFloat(getComputedStyle(hand).scrollPaddingLeft) || 0)
    : 0;
  const fade = [
    overflow && hand.scrollLeft > Math.max(0, start) + 1 && "start",
    overflow &&
      hand.scrollLeft + hand.clientWidth < hand.scrollWidth - 2 &&
      "end",
  ].filter(Boolean);
  if (fade.length) hand.dataset.fade = fade.join(" ");
  else delete hand.dataset.fade;
}
$("hand").addEventListener("scroll", updateHandEdges, { passive: true });
new ResizeObserver(updateHandEdges).observe($("hand"));
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
    // Pinch zoom passes through; line and page wheels scroll by their unit.
    if (hand.scrollWidth <= hand.clientWidth + 1 || e.ctrlKey) return;
    e.preventDefault();
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    hand.scrollLeft +=
      delta *
      (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? hand.clientWidth : 1);
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
// The dialogue lies over the stage's foot, outside it, so it takes drops too.
for (const zone of [$("stage"), document.querySelector(".dialogue")]) {
  zone.addEventListener("dragover", (e) => {
    if (dragging.length) {
      e.preventDefault();
      $("stage").classList.add("drag-over");
    }
  });
  zone.addEventListener("dragleave", (e) => {
    if (!zone.contains(e.relatedTarget))
      $("stage").classList.remove("drag-over");
  });
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    const cards = [...dragging];
    dragging = [];
    $("stage").classList.remove("ready", "drag-over");
    if (cards.length) commit(cards, selectionRevision);
  });
}
document.addEventListener("keydown", (e) => {
  if (
    e.key === "Escape" &&
    !document.querySelector("dialog[open], .world-menu:popover-open") &&
    (selected.length || expandedHolders.size || !rowCollapsed || questOpen)
  ) {
    playQueue.clear();
    selected = [];
    questOpen = false;
    expandedHolders.clear();
    foldedChoice = false;
    rowCollapsed = true;
    render();
  }
});
// A click outside the cards and the dialogue folds the row and keeps the
// selection and any chosen play; the next tap on the hand raises it as it
// was. Escape clears. A tap on the dialogue steps its beat and leaves the
// hand be, as do the toolbar, dialogs and buttons. Nothing else moves it.
document.addEventListener("click", (e) => {
  const path = e.composedPath(),
    within = (selector) =>
      path.some(
        (element) => element instanceof Element && element.matches(selector),
      );
  if (rowCollapsed) {
    // A folded row with a held item opens from any dock click; a resting
    // hand opens from a card. A play leaves the row as it is, so its own
    // button must not reopen it.
    if (selected.length && within(".play-dock") && !within("#card-actions")) {
      foldedChoice = false;
      rowCollapsed = false;
      render();
    }
    return;
  }
  if (
    within(".play-dock, .card-frame, dialog, .topbar, .dialogue, .world-menu")
  )
    return;
  foldHand();
});
function foldHand() {
  foldedChoice = selected.length > 0;
  questOpen = false;
  rowCollapsed = true;
  expandedHolders.clear();
  render();
}
$("history-button").onclick = () => {
  renderLog(true);
  $("history-dialog").showModal();
  pauseSpeech();
  // The newest visit is first; the past is further down.
  $("messages").scrollTop = 0;
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
$("history-dialog").addEventListener("close", () => renderLog(false));
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
  } catch {}
  cancelTravel();
  narrator.invalidate();
  exchange.cancel();
  reveal.cancel();
  speechSounds.stop();
  world = freshWorld();
  loadSeen(true);
  completedSpeech.clear();
  reviewing = false;
  reviewBeat = null;
  renderedHand = "";
  // A new game starts its hand from the left.
  renderedHandPlace = null;
  lineSeq = null;
  selected = [];
  expandedHolders.clear();
  rowCollapsed = true;
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
    world = enableMotives(decodeSave(event.newValue));
    loadSeen();
    renderedHand = "";
    lineSeq = null;
    // Another tab's play is not this player's: the hand stays as it was,
    // less any card that has left the table.
    selectCards(selected.filter((id) => availableCards(world).includes(id)));
    saveBlocked = false;
    notice("The world was updated in another tab.");
    resumeScene({ otherTab: true });
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
// No line is scripted for a waking avatar (#1600): when the model gives no
// first words, the silent beat "…" shows, and Retry or a reload asks again.
function showOpeningSilence() {
  if (!openingWordsDue()) return;
  silence = {
    turn: world.turn,
    lines: silentLines(world, [currentActor(world)]),
  };
  lineSeq = null;
  exchange.begin();
  render();
  exchange.load(silence.lines);
}
// A save written by another tab never starts a request here: that tab asks.
function resumeScene({ otherTab = false } = {}) {
  if (sharedSession) {
    render();
    syncSharedLine();
    return;
  }
  openingHeld = openingWordsDue() && !selfKnown();
  if (openingHeld) {
    // Vale's first line waits until his player uncovers him and his place.
    storyStatus = "ready";
    save();
    render();
    return;
  }
  if (openingWordsDue() && !otherTab && !wordsFailedOnLoad()) {
    // A new game asks the dialogue model for Vale's first line. A reload
    // after it failed offers Retry instead of asking again.
    lineSeq = null;
    storyStatus = "pending";
    exchange.begin();
    render();
    narrator.changed();
    return;
  }
  if (!saveBlocked && !hasCurrentWords() && wordsFailedOnLoad()) {
    // This turn's words failed before the reload: offer Retry again.
    const played = world.log.findLast(
      (entry) =>
        entry.turn === world.turn &&
        entry.kind === "action" &&
        entry.actorId === currentActor(world),
    );
    narrator.resume(
      played ? { item: played.itemId, target: played.targetId } : null,
    );
    lineSeq = null;
    storyStatus = "retry";
    render();
    showOpeningSilence();
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
// Until it resolves, the player's own play reads on its button as what their
// avatar is doing. Only a refusal or an unconfirmed send needs words.
const refusalText = ({ label }, reason) => `Not played: ${label}. ${reason}`;
function showSharedPlay(state, reason = "") {
  if (!sharedPlay) return;
  const play = sharedPlay;
  sharedPlay.state = state;
  if (state === "played" || state === "rejected") sharedPlay = null;
  if (state === "sending") sharedRefusal = null;
  const shown = $("play-status").dataset.playStatus;
  if (state === "rejected") {
    sharedRefusal = { reason, text: refusalText(play, reason) };
    notice(sharedRefusal.text, state);
  } else if (state === "uncertain") notice(reason, state);
  else if (["rejected", "uncertain"].includes(shown)) notice("");
  renderActions();
}
// Follow the play's key through the room queue into the committed history.
// The server reports a refusal as a new notice for this player.
function trackSharedPlay(value) {
  if (!sharedPlay || sharedPlay.state === "sending") return false;
  const { key, state } = sharedPlay;
  const entry = value.queue?.find((item) => item.id === key);
  const refusal = value.notice || "";
  if (entry) {
    const next = ["waiting", "retry"].includes(entry.status)
      ? "sent"
      : "playing";
    if (next !== state) showSharedPlay(next);
  } else if (value.history?.some((scene) => scene.play === key))
    showSharedPlay("played");
  else if (state === "uncertain") return false;
  else if (refusal && refusal !== sharedPlay.notice) {
    showSharedPlay("rejected", refusal);
    return true;
  } else showSharedPlay("played");
  return false;
}
function withdrawSharedPlay(key) {
  if (sharedPlay?.key === key) sharedPlay = null;
  return sharedSession
    .command({ op: "cancel", key })
    .catch((error) => notice(error.message));
}
let sharedLineKey = "";
let sharedWorldKey = "";
let sharedNudgeKey = "";
function sharedWorld(value) {
  const seated = (flags) =>
    humanAvatars.filter((_, index) => flags?.[index]).map((a) => a.id);
  return seatActors(
    { ...value.world, playerActorId: value.actor },
    seated(value.claimed),
    seated(value.present),
  );
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
  sharedPlay = {
    key: crypto.randomUUID(),
    actionKey: current.key,
    label: playLabel(current),
    notice: sharedSession.state.notice || "",
  };
  showSharedPlay("sending");
  try {
    await sharedSession.play(current, sharedPlay.key);
    lastPlayAt = performance.now();
    if (!playQueue.pending && JSON.stringify(selected) === selection) {
      keepHeldSelection(heldBefore, current);
      reviewing = false;
      reviewBeat = null;
    }
    if (sharedPlay) {
      sharedPlay.state = "accepted";
      trackSharedPlay(sharedSession.state);
    }
  } catch (error) {
    if (error.cause) showSharedPlay("uncertain", error.message);
    else showSharedPlay("rejected", error.message);
  } finally {
    sharedSending = false;
    renderedHand = "";
    render();
    restoreHandFocus();
  }
}
function syncSharedLine() {
  renderPlayers();
  if (!sharedSession || reviewing || covering) return;
  // A viewer hears the room once they have uncovered themselves and it.
  if (!selfKnown()) return;
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
  const entry = shownWorld().log.findLast(
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
    // A table that is already open shows the standoff beats it receives.
    const beats =
      alreadyOpen && !combatRelease && next.turn > world.turn
        ? combatBeats(world, next, {
            viewer: currentActor(world),
            place: from,
            sinceSeq: lastSeq(world),
          })
        : [];
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
    const moved = world.actors[currentActor(world)].place !== from;
    if (moved) {
      cancelTravel();
      reviewing = false;
      sharedLineKey = "";
      lineSeq = null;
    }
    const land = (done = () => {}) => {
      if (moved)
        travel(
          world.actors[currentActor(world)].place,
          render,
          () => {
            render();
            syncSharedLine();
            done();
          },
          beats.some((beat) => beat.kind === "defeat" && beat.viewerLost)
            ? "You come to at"
            : undefined,
        );
      else {
        render();
        done();
      }
    };
    if (beats.length) presentCombat(beats, land);
    else if (!combatRelease) land();
    if (alreadyOpen) {
      queueDiscoveries();
    }
  } else {
    renderActions();
    renderScene();
  }
  // A refusal shows once. A reload retires the one already on the table.
  const refused = trackSharedPlay(value);
  const serverNotice = value.notice || "";
  if (sharedNoticeSeen !== undefined && serverNotice !== sharedNoticeSeen) {
    if (serverNotice && !refused) notice(serverNotice);
  }
  sharedNoticeSeen = serverNotice;
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
  getWorld: () => world,
  notice,
});
installToolbar({
  session: sharedSession,
  getWorld: () => world,
  allowShared: () => !localRuntime(),
  // Leaving the world being played: nothing saves it again.
  stopSaving: () => {
    saveBlocked = true;
    playQueue.clear();
  },
});
// The root page resumes whichever avatar was played last.
if (!tableName && !startingPack)
  try {
    localStorage.setItem(
      PLAYING_KEY,
      JSON.stringify(
        sharedSession
          ? { avatar: sharedSession.state.actor, world: sharedWorldId }
          : { avatar: "vale" },
      ),
    );
  } catch {}
if (localRuntime()) {
  for (const id of ["owned-worlds-button", "shared-worlds-button"]) {
    const button = $(id);
    if (button) button.hidden = true;
  }
}
installSceneVideo({
  getWorld: () => world,
  getScene: () => videoScene || currentScene(world),
});
if (sharedSession) {
  world = sharedWorld(sharedSession.state);
  sharedSession.subscribe(adoptShared, (message, recoveredFrom) => {
    if (!recoveredFrom || $("play-status").textContent === recoveredFrom) {
      // A recovered connection restores a refusal with its play name.
      if (message && message === sharedRefusal?.reason)
        notice(sharedRefusal.text, "rejected");
      else notice(message);
    }
  });
  adoptShared(sharedSession.state);
  setInterval(syncSharedLine, 200);
}
resumeScene();
