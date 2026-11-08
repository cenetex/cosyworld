import { renderCardDescriptor } from "./card-descriptor.mjs";
import {
  nameTitleWaker,
  onTitleWake,
  playNewWorldIntro,
  playTitleIntro,
  titleMusicHold,
  voiceTitle,
} from "./title-intro.mjs";
import { count, lineCounter, playCounter, startMetrics } from "./metrics.mjs";
import { imageUrl } from "./images.mjs";
import coreLocations from "./assets/staging/core.json" with { type: "json" };
import greekLocations from "./assets/staging/greek.json" with { type: "json" };
import worldLocations from "./assets/staging/worlds.json" with { type: "json" };
import { createPreferredLocationsView } from "./preferred-locations-view.mjs";
import { cardLevel, levelTier, romanLevel } from "./rarity.mjs";
import { finishCardReveal, revealCard } from "./card-reveal.mjs";
import { setCardLabel } from "./card-label.mjs";
import { showActionBeatNote } from "./action-beat-note.mjs";
import {
  fadeGhost,
  fixedGhost,
  ghostOf,
  pinGhost,
  releaseGhost,
  releaseGhosts,
} from "./card-ghost.mjs";
import {
  EXIT_MAX,
  EXIT_MS,
  cardOf,
  dropCards,
  foldCards,
  leavingFrames,
} from "./card-exit.mjs";
import { keepFrames, morphFrame } from "./card-keep.mjs";
import {
  SWAP_REDUCED_MS,
  fadeFaces,
  nearestFirst,
  swapTiming,
} from "./card-swap.mjs";
import {
  ENTRY_STAGGER_MS,
  QUEST_DOWN_MS,
  createCardEntries,
  createQuestEntries,
  entryDelays,
  questEntryKey,
  riseIn,
} from "./card-entry.mjs";
import {
  LOCKED_BACK,
  CLOSED_BOX,
  LOCKED_BOX,
  createLockedBoxes,
  isLockedBox,
  lockedQuest,
} from "./locked-box.mjs";
import { fadeInRevealed, revealedStage } from "./stage-reveal.mjs";
import { OPENING_REVEAL, openingStep } from "./opening.mjs";
import {
  actionTapVerb,
  phase,
  refusalLabel,
  refusalSentence,
  revealedBeat,
  tapPrompt,
  THINKING_GRACE_MS,
} from "./presentation.mjs";
import { glowCard, levelUpCard, transformPortrait } from "./card-level-up.mjs";
import { crossedPortraitTier } from "./rarity-portraits.mjs";
import {
  isQuestId,
  metQuests,
  questCards,
  questRewardCards,
  questVisible,
  questCaption,
  questBox,
  questGround,
  questHand,
  questId,
  questNear,
  questTier,
  questVerb,
} from "./quest-card.mjs";
import { NOT_FOUND, questStep } from "./quest-step.mjs";
import { actionScene, questScreen } from "./quest-screen.mjs";
import { createLandingWorld, newRunSeed } from "./pack-landing.mjs";
import { beginPipJourney, createPipWorld } from "./pip-landing.mjs";
import { flipStagePortrait, portraitFraming } from "./portrait-facing.mjs";
import { locationWeather } from "./weather.mjs";
import { DAYLIGHT_TURNS, isNight, locationDaylight } from "./daylight.mjs";
import { renderWeather } from "./weather-view.mjs";
import { renderStageLight } from "./stage-light-view.mjs";
import {
  UNPAINTED_NIGHT_TINT,
  gradeStrength,
  placeLight,
} from "./stage-light.mjs";
import { createSleepView } from "./sleep-view.mjs";
import { DREAMING_LABEL, DREAM_TIER, withDream } from "./dream-card.mjs";
import { paintGlimpse } from "./glimpse-card.mjs";
import {
  CHANGE_FADE_MS,
  CROSSFADE_MS,
  crossfadeImage,
  fadeLayer,
  hauntScene,
  installScaresToggle,
} from "./transitions.mjs";
import { installSettingsCards } from "./settings-screen.mjs";
import { leavePage } from "./page-fade.mjs";
import { settle } from "./figure-settle.mjs";
import { groupOn, packToggleBlock } from "./pack-toggle.mjs";
import { installToolbar, renderPlayers } from "./toolbar.mjs";
import { showWorldTier } from "./world-level.mjs";
import { worldLogoKey } from "./title-logo.mjs";
import { innerLifeChain, innerLifeSection } from "./inner-life.mjs";
import { combatBeats, lastSeq, theName } from "./combat-beats.mjs";
import {
  beatSummary,
  memoryVisits,
  plainWaitEntry,
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
  installSharedControls,
  renderRoomStatus,
  sharedReadingLine,
  sharedNextLine,
  sharedSilentLines,
  sharedSpeechState,
  sharedVoiceReference,
  hasSharedPlace,
  humanAvatars,
} from "./shared.mjs";
import { enableMotives } from "./motives.mjs";
import { seatActors } from "./human-cast.mjs";
import { PLAYING_KEY } from "./avatar-world.mjs";
import { openTableSession } from "./table-session.mjs";
import { createNarrator, requestNarrative, silentLines } from "./narrative.mjs";
import { signedRequest } from "./signed-words.mjs";
import { rememberLocalUpgrades, wearLocalUpgrades } from "./scarves.mjs";
import { coveredText, coveredTextReader, markWaking } from "./speech-knowledge.mjs";
import { packMedia } from "./pack-registry.mjs";
import { createRoomMusic, openingRevealed } from "./music.mjs";
import {
  CUE_TRACKS,
  HUSH,
  battleMusicDue,
  funeralMusicDue,
  locationMusicCue,
  createMusicCues,
} from "./music-cues.mjs";
import { createHum } from "./hum.mjs";
import { createSfx } from "./sfx.mjs";
import { recedeBackdrop } from "./combat-backdrop.mjs";
import { createCharacterSpeech } from "./character-speech.mjs";
import { localRuntime } from "./local-service.mjs";
import { hostedVoices } from "./hosted-voices.mjs";
import { createLocalBackups, installBackupControls } from "./local-saves.mjs";
import {
  createTextReveal,
  createRevealPainter,
  letterSpans,
  splitLetters,
  createSpeechSounds,
  createExchange,
  createPlayQueue,
  afterDeadline,
  waitForScene,
} from "./dialogue.mjs";
import { dropCost } from "./want.mjs";
import { nameLetters, namedText } from "./card-names.mjs";
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
import { packOf } from "./pack-registry.mjs";
import { variantOf } from "./pack-rules.mjs";
import { hiddenFor, unlockedSince } from "./unlock-view.mjs";
import {
  currentScene,
  isSceneText,
  sceneCast,
  nextSpeaker,
  sceneStaging,
  selectedHandItem,
  portrait,
  placeCardArt,
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
  playText,
  restPlays,
  cardActions,
  cardObservation,
  TOO_MANY_ITEMS,
  sealedReason,
  asleepReason,
} from "./cards.mjs";
// A person's want reaches the player through Talk context (want-talk.mjs).
// The hand holds people, items and places, and the player's quest cards.
const $ = (id) => document.getElementById(id);
const {
  tableName,
  startingPack,
  startingPip,
  sharedWorldId,
  sharedSession,
  saveKey: SAVE_KEY,
} = await openTableSession(window.location.href);
// A new local world: Vale wakes in the attic, the only avatar played locally
// (#1892). Its travelers wear the local passkey's cosmetic upgrades (#1873).
const freshWorld = () =>
  wearLocalUpgrades(
    enableMotives(startingPip ? createPipWorld() : createLandingWorld(startingPack)),
  );
let world = sharedSession
    ? { ...sharedSession.state.world, playerActorId: sharedSession.state.actor }
    : freshWorld(),
  selected = [],
  expandedHolders = new Set(),
  saveBlocked = false,
  pipLeaving = false,
  pipTransition = 0,
  pipTimer = null,
  lineSeq = null,
  selectionRevision = 0,
  dragging = [],
  // The hand rests folded until a card is touched. Only a click outside
  // the card area or Escape folds it again, and clears the choice; a play,
  // changing the selection and deselecting never do.
  rowCollapsed = true;
// Name the save slot: table saves are keyed off the URL param, so a player
// landing through a different link silently lands in a different slot.
{
  const slotLabel = $("table-slot");
  if (slotLabel && tableName) {
    slotLabel.hidden = false;
    slotLabel.textContent = `Saving as table "${tableName}". Without the ?table= parameter this menu shows a different saved game.`;
  }
  if (slotLabel && startingPip) {
    slotLabel.hidden = false;
    slotLabel.textContent = "Your visit with Pip is saved at lonelyforest.com/pip.";
  }
}
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
  "⌛": '<path d="M7 3h10M7 21h10M8 3c0 6 8 5 8 9s-8 3-8 9M16 3c0 6-8 5-8 9s8 3 8 9"/>',
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
// The action beat's state is declared before notice(), which can run at boot
// (a refused save, blocked storage) before the rest of the table exists.
let borrowedBeat = null;
// A play that commits rests the action beat, so the reply comes to the
// front, until the player chooses or raises the hand again.
let restedChoice = null;
// What the dialogue box shows now (presentation.mjs).
let shownPhase = null;
// Since when only committed plays' words have kept the Thinking card.
let thinkingSince = null;
let thinkingGrace = null;
// Nothing floats over the stage. A failure the player must see (a refused
// play, an unsaved world, a lost connection, a nudge) reads on the action
// beat's status line; a pending play reads on its own button.
function notice(text, playStatus = "") {
  // Saved speech failures use the small dialogue retry control.
  if (/^(The|Your) play is saved\./.test(text)) return;
  const line = $("play-status");
  line.textContent = text;
  line.hidden = !text;
  line.dataset.playStatus = text ? playStatus : "";
  syncActionBeat();
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
// Keep the revision whose words were still on the way, or that fell silent:
// a reload asks again only for words it interrupted. Words that failed stay
// "…" and are never asked again (#1642). A completed reply clears the marker.
const WORDS_MARKER_KEY = `${SAVE_KEY}.words-failed`;
const READING_KEY = `${SAVE_KEY}.reading`;
function readingPosition() {
  try {
    const saved = JSON.parse(localStorage.getItem(READING_KEY));
    if (saved?.actor === currentActor(world) && saved.seed === world.run?.seed &&
        saved.room === world.actors[currentActor(world)].place && Number.isFinite(saved.seq) && saved.seq >= 0)
      return saved;
  } catch {}
  return null;
}
function rememberReading(line) {
  try {
    localStorage.setItem(READING_KEY, JSON.stringify({ room: line.locationId,
      actor: currentActor(world), seq: line.seq, seed: world.run?.seed }));
  } catch {}
}
function rememberWords(revision, pending = false) {
  if (sharedSession) return;
  try {
    if (revision === null) localStorage.removeItem(WORDS_MARKER_KEY);
    else
      localStorage.setItem(
        WORDS_MARKER_KEY,
        `${revision}${pending ? ":pending" : ""}`,
      );
  } catch {
    /* This tab still plays; a reload shows the caption alone. */
  }
}
// "silent", "pending" or null for the current revision.
function wordsOnLoad() {
  try {
    const [revision, pending] = (
      localStorage.getItem(WORDS_MARKER_KEY) || ""
    ).split(":");
    if (revision !== String(world.revision)) return null;
    return pending ? "pending" : "silent";
  } catch {
    return null;
  }
}
let encountered = new Set(),
  discoveryDone = Promise.resolve();
// Cards just revealed whose figure or item has yet to fade into the scene.
const stageReveals = new Set();
const fresh = new Set();
// The level each card last showed, so a rise plays on the card itself.
const shownLevels = new Map();
const shownStageLevels = new Map();
const coveredCards = new Set();
let openingHeld = false;
// The quest stack on show, top first, and whether it is fanned open. A met
// quest stays checked until its saved reward is collected (sealedQuests,
// newest first). A first quest glows; questPick chooses the open fan card.
// questSeq also supports shared hosts finishing their rules109 update.
let shownQuests = [],
  sealedQuests = [],
  questSeq = null,
  questPick = 0,
  questOpen = false,
  questFresh = false,
  // The avatar's fanned stack, "items" or "quests" (#2256).
  avatarFan = null,
  // The place whose ways on are fanned at the row's right end (#2272).
  waysOpen = null;
// The folded card behind the avatar shows the top quest.
const questClaims = new Map();
const foldQuest = () => shownQuests.find((quest) => questVisible(world, quest)) ?? sealedQuests[0] ?? null;
const questEntries = () => [
  ...sealedQuests.map((quest, i) => ({
    id: questId(i, true),
    quest,
    met: true,
  })),
  ...shownQuests.filter((quest) => questVisible(world, quest))
    .map((quest) => ({ id: questId(quest.index), quest, met: false })),
];
const questEntry = (id) => questEntries().find((entry) => entry.id === id);
// Card art: a pack's own art, a hub item's authored art, or the forest card.
const cardArt = (id) =>
  packMedia(id, "art") ||
  (things[id]?.art ? `./${things[id].art}` : `./assets/${id}-card.png`);
// A place card shows that place as you would find it there: the same
// painting the action beat shows, so a destination card shows where you are
// going (the ship's deck from its berth), lit for the hour and weather.
const placeArt = (id) => placeCardArt(world, id);
const pipPrelude = () => startingPip && !world.opening;
const cardIsCovered = (id) => pipPrelude()
  ? id !== "moth" && !(world.actors.vale.want?.story && id === "lamp")
  : !encountered.has(id) || coveredCards.has(id);
const cardIsClosed = (id) => cardIsCovered(id) || isLockedBox(world, id);
const CARD_BACK = "./assets/card-back.webp";
const cardBack = (id) => isLockedBox(world, id) ? LOCKED_BACK : CARD_BACK;
const visibleText = (text) => coveredText(world, text, cardIsClosed);
// The scene's uncovered cards, so text writes their names in their card's
// colour (card-names.mjs).
const cardColours = (ids) =>
  ids.map((id) => ({
    id,
    name: nameOf(id),
    person: Boolean(people[id]),
    color: levelTier(cardLevel(world, id)).color,
  }));
const sceneCards = () =>
  cardColours(availableCards(world).filter((id) => !cardIsClosed(id)));
const namedSpan = (text) => {
  const span = document.createElement("span");
  span.append(...namedText(text, sceneCards()));
  return span;
};
// The screen names a card only once its player has uncovered it (#1575),
// and the world's hidden avatar only once this avatar has met it (#1936).
const knownName = (id, unknown = "…") =>
  cardIsClosed(id) || hiddenFor(world, currentActor(world))?.id === id
    ? unknown
    : nameOf(id);
// The waking avatar speaks as soon as its own card is known. Its covered
// surroundings stay unnamed in the waking request.
const avatarKnown = () => !coveredCards.has(currentActor(world));
// A shared viewer follows the room once their avatar and place are known.
const selfKnown = () =>
  avatarKnown() && !coveredCards.has(world.actors[currentActor(world)].place);
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
  if (startingPip) {
    encountered.add("moth");
    coveredCards.delete("moth");
  }
  if (pipPrelude() && !saveBlocked) {
    selected = ["moth"];
    rowCollapsed = false;
  }
  fresh.clear();
  shownLevels.clear();
  shownStageLevels.clear();
  shownQuests = [];
  sealedQuests = [];
  questClaims.clear();
  questSeq = null;
  questPick = 0;
  questFresh = false;
  rememberCards();
}
loadSeen();
function save() {
  if (saveBlocked || sharedSession || storageBlocked) return false;
  try {
    const encoded = encodeSave(world);
    localStorage.setItem(SAVE_KEY, encoded);
    rememberLocalUpgrades(world);
    void localBackups?.queue(encoded);
    return true;
  } catch {
    count("error.storage");
    notice(UNSAVED_NOTICE);
    return false;
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
// Effect captions being written onto a card (inscribe()), with their pens.
const inscribing = new Map();
const seenCaptions = new Set();
let shownCaptions = { key: null, count: 0 };
// Each shared reader keeps their own place in the room’s dialogue.
let sharedLineSeq = null;
let sharedAdvanceRequested = false;
let sharedLineStart = null;
let storyStatus = "ready",
  renderedCast = "",
  renderedHand = "",
  renderedHandRevision = null,
  renderedHandPlace = null,
  renderedHandState = null,
  speechKey = null,
  speechGlyphs = [],
  shownLetters = 0,
  glyphLines = [],
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
  sceneSpeakers = [];
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
    saveBlocked || pipLeaving ||
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
// A local play's words still coming for the play before. The rules have
// run, so a choice comes forward after the grace, but a next play waits
// behind those words: the late line types into its own beat first, as the
// shared table's seat makes it do, and the next scene is asked after it.
const localWordsPending = () => !sharedSession && storyStatus === "pending";
const playQueue = createPlayQueue({
  ready: (action) =>
    !cardsCooling &&
    performance.now() >= swapEnd &&
    (action.kind === "focus" || (!localWordsPending() && !exchange.current)) &&
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
    // Choosing a quest takes no turn and brings no reply, so its beat stays
    // awake: the chosen quest's next step and Discard are still offered.
    if (action.kind !== "focus") restedChoice = choiceKey();
    count(playCounter(action));
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
    // A blocked reason (a Take refused for space) never plays.
    const claim = questClaims.get(button.dataset.questKey);
    button.disabled = selectionBlocked() || Boolean(button.dataset.blocked) ||
      Boolean(claim && !claim.uncertain);
    if (button.dataset.card)
      button.draggable =
        !button.disabled && !cardIsCovered(button.dataset.card);
  }
  if (playQueue.pending) queueMicrotask(() => playQueue.flush());
}
const exchange = createExchange({
  holdLast: () => queuedChoice,
  prepare: prepareScene,
  show: (line) => {
    pendingSpeaker = null;
    const speakerId = line.entityId || line.actorId;
    // An unrevealed person who speaks is revealed with the line, there at
    // once so the words never wait on a fade.
    if (people[speakerId] && cardIsCovered(speakerId))
      uncover(speakerId, { fade: false });
    lineSeq = line.seq;
    rememberReading(line);
    // The stack brings the new beat in front as it renders. A player who
    // stepped back stays there: the line raises the live count and types
    // when they return (#2017).
    renderScene();
  },
  // Let a departing speaker finish moving before their reply steps back.
  transition: () =>
    reducedMotion.matches ? undefined : waitForScene([...exits.values()]),
  busy: (value) => {
    clearTimeout(handTimer);
    cardsCooling = value;
    updateCardCooldown();
    if (value && storyStatus === "pending")
      handTimer = setTimeout(releaseHand, HAND_WAIT);
    // A failed request releases the hand as well.
    if (!value) {
      queuedChoice = false;
      pendingSpeaker = null;
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
voiceTitle(speechSounds);
// Since when this play's Thinking card has waited for words (#2016): its
// outcome is counted once, as a latency bucket, silence or a failure.
let thinkingStartedAt = null;
function lineHeard(spoken) {
  if (thinkingStartedAt === null) return;
  count(
    spoken === null
      ? "voice.failed"
      : spoken
        ? lineCounter(performance.now() - thinkingStartedAt)
        : "voice.silent",
  );
  thinkingStartedAt = null;
}
let completedSpokenLine = null;
function finishSpokenLine() {
  const line = completedSpokenLine;
  if (
    line &&
    line.key === speechKey &&
    line.seq === shownSceneLine?.seq &&
    !characterSpeech.busy
  )
    exchange.revealed(line.seq);
}
const characterSpeech = createCharacterSpeech({
  changed: ({ state, message }) => {
    $("speech-row").dataset.voice = state;
    $("voice-retry").hidden = state !== "error";
    $("voice-status").textContent =
      state === "connect"
        ? "Sign in with your passkey to hear character voices."
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
// Hosted voices are free to a signed-in passkey.
let signedInSeen;
hostedVoices().subscribe(({ signed_in }) => {
  if (signedInSeen !== undefined && signed_in !== signedInSeen)
    characterSpeech.connectionChanged();
  signedInSeen = signed_in;
});
if (!localRuntime()) void hostedVoices().refresh();
let soundEnabled = true;
try {
  soundEnabled = localStorage.getItem("cosyworld.dialogue.sound") !== "off";
} catch {}
speechSounds.setEnabled(soundEnabled);
characterSpeech.setEnabled(soundEnabled);
function measureSpeech() {
  const text = $("dialogue-text");
  glyphLines = speechGlyphs.map((glyph) => [
    glyph.offsetTop,
    glyph.offsetTop + glyph.offsetHeight,
  ]);
  speechHeight = text.clientHeight;
  speechScrollTarget = text.scrollTop;
}
new ResizeObserver(measureSpeech).observe($("dialogue-text"));
function replyPending() {
  return sharedSession
    ? Boolean(shownSceneLine && storyStatus === "pending" &&
        !sharedNextLine(sharedSession.state, shownSceneLine.locationId, shownSceneLine.seq))
    : exchange.waiting;
}
function updateSpeechControls(complete) {
  complete &&= inscribing.size === 0;
  const waiting = !reviewing && replyPending();
  const { frontIndex, liveIndex, pending } = stackView;
  const own = frontIndex === liveIndex && pending?.own;
  const cancel = own?.cancel && (thinkingArmed ? "Confirm" : own.committed ? "Stop waiting" : "Cancel");
  const sharedForward = sharedSession && shownSceneLine && !sharedAdvanceRequested &&
    (ownPlayInFlight() || sharedNextLine(sharedSession.state, shownSceneLine.locationId, shownSceneLine.seq));
  const forward = (reviewing && (frontIndex < liveIndex || choiceInStack())) ||
    exchange.hasNext || sharedForward || queuedChoice;
  const label = reviewing ? "Step forward to a later beat" : "Continue to the next beat";
  const dreamTap = sleepView.dreamTap;
  const cue = dreamTap !== null
    ? tapPrompt(dreamTap, dreamTap !== "Finish", dreamTap === "Continue" ? "Continue the dream" : dreamTap || "Dream")
    : cancel
      ? tapPrompt(cancel, true, cancel === "Cancel" ? "Cancel play" : cancel)
      : tapPrompt(forward && !waiting ? "Continue" : "", complete, forward ? label : "The latest beat");
  const button = $("dialogue-advance"), hint = $("speech-hint");
  button.dataset.revealing = String(dreamTap === null ? !complete && !cancel : dreamTap === "Finish");
  const waitingLine = dreamTap === null && complete && waiting && !cancel;
  if (dreamTap === "") button.setAttribute("aria-disabled", "true");
  else button.removeAttribute("aria-disabled");
  button.setAttribute("aria-label", waitingLine ? "Thinking about the next reply" : cue.label);
  hint.textContent = waitingLine ? "Thinking…" : cue.hint;
  hint.hidden = button.hidden || !hint.textContent;
}
const speechPainter = createRevealPainter($("dialogue-text"), { rest: true });
// A wake plays on the table: dusk or dawn through a held black, and a level
// quest's dream before it (sleep-view.mjs).
const sleepView = createSleepView({
  stage: $("stage"),
  speechRow: $("speech-row"),
  hand: $("hand"),
  reducedMotion,
  render: () => render(),
  finishReveal: () => {
    if (reveal.complete) return;
    reveal.finish();
    speechSounds.stop();
  },
  dealQuests: () => showQuests(false),
  showWake({ id, seq, woke, dream }) {
    // Give the explicit Wake result its own tap before the reply.
    if (reviewing || dream || woke !== "chose") return;
    const waited = world.log.some(
      (entry) =>
        entry.seq > seq && entry.actorId === id && plainWaitEntry(entry),
    );
    if (!waited) return;
    reviewing = true;
    reviewBeat = `a:${seq}`;
    syncSpeechPlayback();
  },
});
let actionMessage;
const actionReveal = createTextReveal({
  reduced: () => reducedMotion.matches,
  frame(value) {
    actionMessage.frame = value;
    actionMessage.painter.paint(value);
    const button = document.querySelector(
      '#action-beat[data-card-tap] #card-actions button[data-tap-verb]',
    );
    if (button) paintActionTap(button, value.complete);
  },
});
function writeActionMessage(root, text, key, name) {
  if (!text) {
    actionReveal.cancel();
    actionMessage = null;
    delete root.dataset.revealing;
    root.textContent = "";
    return;
  }
  const frame = actionMessage?.frame;
  if (actionMessage?.root === root && frame?.key === key) return;
  const glyphs = letterSpans(text);
  root.replaceChildren(...glyphs);
  if (text.startsWith(`${name} `)) {
    const speaker = node("strong");
    root.prepend(speaker);
    speaker.append(...glyphs.slice(0, splitLetters(name).length));
  }
  const painter = createRevealPainter(root);
  painter.start(glyphs);
  actionMessage = { root, painter, frame };
  if (frame?.key === key) painter.paint(frame);
  else actionReveal.show(key, text, currentActor(world));
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
      else
        characterSpeech.show(
          value.key,
          value.speaker,
          value.text,
          sharedVoiceReference(sharedSession?.state, shownSceneLine),
        );
      speechGlyphs = letterSpans(value.text);
      text.replaceChildren(...speechGlyphs);
      nameLetters(speechGlyphs, value.text, sceneCards());
      speechPainter.start(speechGlyphs);
      measureSpeech();
      $("speech-announcement").textContent = "";
    }
    speechPainter.paint(value);
    shownLetters = value.shown;
    if (speechComplete !== value.complete) {
      speechComplete = value.complete;
      updateSpeechControls(value.complete);
      // A read line lets a play in flight show its Thinking card.
      queueMicrotask(() =>
        value.complete && ownPlayInFlight() ? renderScene() : syncPhase(),
      );
    }
    // Layout is measured once per line or resize, then reused for each
    // letter. A line that outgrows the box turns a page: the new line starts
    // at the top, and the words being read never slide.
    const [top, bottom] = glyphLines[Math.max(0, shownLetters - 1)] || [0, 0];
    if (!value.complete && bottom > speechScrollTarget + speechHeight) {
      speechScrollTarget = top;
      text.scrollTop = top;
    }
    // Only the newest beat is announced, never one stepped back to.
    if (value.complete && !reviewing && announcedBeat !== value.key) {
      announcedBeat = value.key;
      $("speech-announcement").textContent = [
        expressionLabel(
          { ...people[value.speaker], name: visibleText(nameOf(value.speaker)) },
          value.text,
        ),
        ...frontCaptions,
      ].join(" ");
    }
    if (value.complete) {
      updateSpeechControls(true);
      completedSpeech.add(value.key);
      sleepView.revealed(value.key);
      if (completedSpeech.size > 100)
        completedSpeech.delete(completedSpeech.values().next().value);
      completedSpokenLine = { ...value, seq: shownSceneLine?.seq };
      queueMicrotask(() => {
        finishSpokenLine();
        playQueue.flush();
      });
    }
  },
});
reducedMotion.addEventListener("change", () => {
  if (reducedMotion.matches) {
    actionReveal.finish();
    reveal.finish();
    finishInscribing();
    speechSounds.stop();
    for (const motion of handMotions.values()) motion.finish();
  }
});
function syncSpeechPlayback() {
  const paused =
    document.hidden ||
    Boolean(document.querySelector("dialog[open], .world-menu:popover-open"));
  reveal.pause(paused);
  characterSpeech.pause(paused);
  exchange.pause(paused || reviewing || characterSpeech.busy);
  return paused;
}
function syncActionReveal() {
  const menu = Boolean(document.querySelector(".world-menu:popover-open"));
  // The Leave message stays in front while its menu is open.
  const inFront = menu && borrowedBeat?.message;
  actionReveal.pause(
    document.hidden ||
      Boolean(document.querySelector("dialog[open]")) ||
      (!inFront && (reviewing || menu)),
  );
}
function pauseSpeech() {
  const paused = syncSpeechPlayback();
  syncActionReveal();
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
  sfx.setVoices(soundEnabled);
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
let musicEnabled = true,
  musicVolume = 0.3;
function musicPlayed() {
  return sharedSession
    ? sharedSession.state.music_started === true
    : world.turn > 0;
}
// The opening attic stays silent until the lamp goes out and its mirror
// first shows the Black pond. This world's id is remembered at that moment,
// so the music keeps playing after a reload even if the lamp is lit again.
const MUSIC_REVEAL_KEY = "cosyworld.music-revealed";
const musicWorldId = () =>
  sharedSession
    ? `shared:${sharedWorldId}:${sharedSession.state.actor}`
    : `local:${SAVE_KEY}:${world.run?.seed ?? ""}`;
let revealedWorld = null;
try {
  revealedWorld = localStorage.getItem(MUSIC_REVEAL_KEY);
} catch {}
function musicRevealed() {
  if (revealedWorld === musicWorldId()) return true;
  if (!openingRevealed(world, currentActor(world))) return false;
  revealedWorld = musicWorldId();
  try {
    localStorage.setItem(MUSIC_REVEAL_KEY, revealedWorld);
  } catch {}
  return true;
}
// No room music under the new-world title or while its song fades: the
// title's own gesture would otherwise start it beneath the song. Then the
// rules above apply.
let titleHolding = false;
function holdMusicForTitle() {
  const hold = titleMusicHold();
  if (!hold) return;
  titleHolding = true;
  hold.then(() => {
    if (titleMusicHold()) return;
    titleHolding = false;
    music.setStarted(musicHasStarted());
    hum.setStarted(musicHasStarted());
  });
}
holdMusicForTitle();
function musicHasStarted() {
  return !titleHolding && musicPlayed() && musicRevealed();
}
try {
  const saved = JSON.parse(localStorage.getItem("cosyworld.room-music"));
  if (typeof saved?.enabled === "boolean") musicEnabled = saved.enabled;
  if (Number.isFinite(saved?.volume))
    musicVolume = Math.max(0, Math.min(1, saved.volume));
} catch {}
const music = createRoomMusic({
  audio: $("room-music"),
  cues: createMusicCues(),
  changed: ({ enabled, started, title, playing, failed }) => {
    $("music-toggle").textContent = `Music: ${enabled ? "on" : "off"}`;
    $("music-toggle").setAttribute("aria-pressed", String(enabled));
    $("music-status").textContent = !enabled
      ? "Music paused"
      : !started
        ? musicPlayed()
          ? "Music waits for the dark."
          : "Play your first card to start music."
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
// The battle song plays while the player's room holds an open battle. While a
// fight's beats play, and from a loss screen until the player's next move,
// presentCombat sets the cue instead.
let combatCue = false,
  lossCue = false;
function syncMusicCue() {
  if (!combatCue && !lossCue)
    music.cue(
      battleMusicDue(world, currentActor(world))
        ? "battle"
        : funeralMusicDue(world, currentActor(world))
          ? "funeral"
          : locationMusicCue(world, currentActor(world)),
      `${musicWorldId()}:${currentActor(world)}`,
    );
}
// The island's drone follows the same switch and volume as the music.
const hum = createHum();
hum.setEnabled(musicEnabled);
hum.setVolume(musicVolume);
hum.setHidden(document.hidden);
hum.setStarted(musicHasStarted());
// The bell and later world effects use the same switch and volume.
const sfx = createSfx();
sfx.setEnabled(musicEnabled);
sfx.setVoices(soundEnabled);
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
// Settings fades the scene's sound out and holds the song's place
// (settings-screen.mjs); a hidden tab silences it too.
function hideAudio() {
  const quiet = $("settings-screen").open;
  music.setHidden(document.hidden);
  music.setQuiet(quiet);
  hum.setHidden(document.hidden || quiet);
  sfx.setHidden(document.hidden || quiet);
}
document.addEventListener("visibilitychange", hideAudio);
document.addEventListener("shared-dialog-change", hideAudio);
window.addEventListener("pagehide", () => {
  music.setHidden(true);
  hum.setHidden(true);
  sfx.setHidden(true);
});
window.addEventListener("pageshow", hideAudio);
const narrator = createNarrator({
  getWorld: () => world,
  isCovered: cardIsCovered,
  early: Boolean(localRuntime()),
  limit: (context) => markWaking(world, context, (id) => coveredCards.has(id)),
  // Remembered words go back with the envelopes the service signed them with.
  request: signedRequest(
    localRuntime()
      ? (context, signal, progress) =>
          requestNarrative(context, signal, progress, "/card-game/text", true)
      : requestNarrative,
  ),
  // Thoughts, persona and dreams come after the line, so they never delay it.
  // A level quest's dream waits on it (sleep-view.mjs).
  reflect: sleepView.reflect(
    signedRequest((context, signal) =>
      requestNarrative(context, signal, () => {}, "/card-game/reflections"),
    ),
  ),
  // A silent play ends its exchange at once; the beat is its caption.
  silent: () => {
    lineHeard(false);
    exchange.cancel();
  },
  started: (context) => {
    if (localRuntime()) characterSpeech.clear();
    // A speaker who left this turn speaks at the destination, not here.
    sceneSpeakers = context.speakers.filter(
      (id) => world.actors[id]?.place === context.location,
    );
    silence = { turn: -1, lines: [] };
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
      lineHeard(true);
      // A good reply can still leave one speaker "…": each counts (#2016).
      silent.forEach(() => count("voice.speaker_silent"));
      rememberWords(null);
      silence = { turn: world.turn, lines: silentLines(world, silent) };
    }
    loadTurnLines({ pending });
  },
  status: (value, error) => {
    sleepView.words(value);
    // Words that failed are this scene's silence: each speaker due shows
    // "…", like a line that came, and play goes on. There is no failed state.
    storyStatus = value === "failed" ? "ready" : value;
    // Words that came, or failed, free a play waiting behind them.
    if (value !== "pending" && playQueue.pending)
      queueMicrotask(() => playQueue.flush());
    if (value === "pending") rememberWords(world.revision, true);
    if (value === "pending" && !exchange.active) exchange.begin();
    if (value === "failed") {
      if (error?.code === "mismatch") count("voice.mismatch");
      lineHeard(null);
      rememberWords(world.revision);
      showFailedSilence();
      return;
    }
    renderScene();
  },
});
// This turn's lines at the player's place, spoken and "…", into the exchange.
function loadTurnLines({ pending = false } = {}) {
  const lines = shownWorld().log.filter(
    (entry) =>
      entry.generated &&
      isSceneText(entry) &&
      entry.turn === world.turn &&
      entry.locationId === world.actors[currentActor(world)].place &&
      // The dreamer says nothing on waking: the dream is the beat.
      !sleepView.hidesLine(entry),
  );
  const voiced = lines.filter(
    (entry) => !entry.silent && visibleText(entry.text) === entry.text,
  );
  if (localRuntime() && voiced.length) {
    const line =
      voiced.find((entry) => entry.seq !== exchange.current?.seq) || voiced[0];
    characterSpeech.prefetch(line.actorId, line.text);
  }
  exchange.load(lines, { pending });
  render();
}
// A request that failed: every avatar due to speak here says "…". A line
// arrives whole or not at all, so no beat mixes a failure with words.
function showFailedSilence() {
  const place = world.actors[currentActor(world)].place;
  const quiet = sceneSpeakers.filter(
    (id) => people[id] && world.actors[id]?.place === place,
  );
  silence = {
    turn: world.turn,
    lines: silentLines(
      world,
      quiet.length || !openingWordsDue() ? quiet : [currentActor(world)],
    ),
  };
  if (!exchange.active) exchange.begin();
  loadTurnLines();
}
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
// A thing the player's own play just put in their hands, until the hand's
// next redraw brings its card into view.
let receivedCard = null;
function keepHeldSelection(before, action = null) {
  const actor = currentActor(world);
  const arrived = handItems().filter((id) => !before.hands.includes(id));
  const received =
    [action?.receive, action?.item].find((id) => arrived.includes(id)) ||
    arrived.at(-1);
  receivedCard = received ?? null;
  // A standoff locks the room and takes the held things out of the hand
  // (#1775), so a raised item leaves the selection with its card.
  const shown = availableCards(world);
  const held = (
    received
      ? [received]
      : before.held.filter((id) => selectedHandItem(world, [id]))
  ).filter((id) => shown.includes(id));
  const keepActor = held.length > 0 && selected.includes(actor);
  // The avatar's open stacks stay open after a deed, including a last gift.
  const expanded = expandedHolders.has(actor);
  selected = keepActor ? [actor, ...held] : held;
  expandedHolders.clear();
  if (expanded) expandedHolders.add(actor);
  // A received card keeps the completed play's beat at rest until a new tap.
  if (restedChoice !== null) restedChoice = choiceKey();
}
// The current place and its items sit on the left. The way back sits just
// before them, and the other ways on stack at the row's right end.
const placeHere = () => world.actors[currentActor(world)].place;
const stackedPlace = (id) => Boolean(places[id]) && id !== placeHere();
const MOVES = ["move", "retreat", "sent-home"];
// Display only: the player's latest arrival, from the log or, once trimmed,
// the world's kept arrival, while it was here and still leads back.
function cameFrom() {
  const here = placeHere(),
    last =
      world.log.findLast(
        (e) =>
          !e.generated &&
          e.actorId === currentActor(world) &&
          e.fromLocationId &&
          e.fromLocationId !== e.locationId &&
          (MOVES.includes(e.verb) || (e.verb === "accompany" && e.accepted)),
      ) ?? world.arrival,
    from = last?.locationId === here ? last.fromLocationId : null;
  return from && availableCards(world).includes(from) ? from : null;
}
const atHere = (id) =>
  id === placeHere() ||
  Boolean(things[id] && rootHolder(world, id) === placeHere());
function stackPlaces(cards) {
  const back = cameFrom(),
    local = cards.filter(atHere);
  return [
    ...(back ? [back] : []),
    ...local,
    ...cards.filter((id) => !local.includes(id) && !stackedPlace(id)),
    ...cards.filter((id) => stackedPlace(id) && id !== back),
  ];
}
// The ways on: the first face up, the rest face down behind it until its
// tap fans them, as the avatar's stacks do; one alone is chosen at once.
function wayStack(id) {
  if (!stackedPlace(id)) return null;
  const back = cameFrom();
  if (id === back) return null;
  const ways = availableCards(world).filter(
      (place) => stackedPlace(place) && place !== back,
    ),
    open = waysOpen === placeHere(),
    top = ways[0] === id;
  return {
    open,
    top,
    under: top && !open ? ways.length - 1 : 0,
    shown: open || top || selected.includes(id),
  };
}
// The avatar's things and quests lie in two stacks beside it, as the ways
// on lie behind the current place (#2256); an empty stack is left out.
function avatarStack(id) {
  const actor = currentActor(world),
    kind = isQuestId(id)
      ? "quests"
      : things[id] && rootHolder(world, id) === actor
        ? "items"
        : null;
  if (!kind) return null;
  const picked = (entryId) =>
      questOpen &&
      entryId === questId(questPick) &&
      Boolean(shownQuests.length),
    chosen = kind === "items" ? selected.includes(id) : picked(id),
    rest = (
      kind === "items"
        ? availableCards(world).filter(
            (item) => things[item] && rootHolder(world, item) === actor,
          )
        : questEntries().map((entry) => entry.id)
    ).filter(
      (card) => !(kind === "items" ? selected.includes(card) : picked(card)),
    ),
    open = avatarFan === kind,
    top = rest[0] === id;
  return {
    kind,
    chosen,
    open,
    top,
    // The cards still folded under the top one; one alone hides none.
    under: top && !open ? rest.length - 1 : 0,
    shown: expandedHolders.has(actor) ? chosen || open || top : chosen,
  };
}
function syncAvatarStack(frame, id) {
  const part = avatarStack(id) ?? wayStack(id);
  if (!part) return;
  frame.hidden = !part.shown;
  frame
    .querySelectorAll(":scope > .place-edge")
    .forEach((edge) => edge.remove());
  const button = frame.querySelector(".card");
  if (part.top && (part.open || part.under)) {
    frame.dataset.expanded = String(part.open);
    button.setAttribute("aria-expanded", String(part.open));
  } else {
    delete frame.dataset.expanded;
    button.removeAttribute("aria-expanded");
  }
  stackEdges(frame, part.under);
}
// Face-down cards behind a stack's top card, up to three.
function stackEdges(frame, count) {
  for (let i = Math.min(count, 3); i > 0; i--) {
    const edge = node("span", undefined, "place-edge");
    edge.style.setProperty("--i", String(i));
    edge.style.setProperty("--card-back", cardBackImage());
    frame.prepend(edge);
  }
}
// A chosen thing moves left, to the front of the avatar's items; a chosen
// quest moves to the front of its quests (pickedFirst). The avatar's group
// is always avatar, items, then quests.
function chosenFirst(cards) {
  const actor = currentActor(world);
  if (!expandedHolders.has(actor)) return cards;
  const chosen = cards.filter(
      (id) => !isQuestId(id) && avatarStack(id)?.chosen,
    ),
    hand = cards.filter((id) => !chosen.includes(id));
  hand.splice(hand.indexOf(actor) + 1, 0, ...chosen);
  return hand;
}
function pickedFirst(ids) {
  const id = questId(questPick);
  if (!questOpen || !shownQuests.length || !ids.includes(id)) return ids;
  return [id, ...ids.filter((other) => other !== id)];
}
// The cards of the player's last committed Wait and the table's revision
// after it: the same cards chosen again offer Sleep.
let lastWait = null;
function rememberWait(action, key) {
  lastWait =
    action.kind === "wait" && !action.sleep
      ? { key, revision: world.revision }
      : null;
}
function selectCards(cards, { keepOpen = false } = {}) {
  for (const id of selected)
    if (people[id] && !cards.includes(id)) expandedHolders.delete(id);
  // A place stays open, and raised, only while it is chosen or holds a
  // chosen thing. Tapping a chosen card again only lowers that card, so the
  // stack it lies in stays fanned (#2247).
  for (const id of expandedHolders)
    if (
      !keepOpen &&
      places[id] &&
      !cards.includes(id) &&
      !cards.some((card) => things[card] && rootHolder(world, card) === id)
    )
      expandedHolders.delete(id);
  selected = cards;
  // Choosing other cards after a Wait brings back the plain Wait.
  if (lastWait && cards.join("+") !== lastWait.key) lastWait = null;
}
// Uncovering a card names it, remembers it, and lets a held first line
// begin once the avatar is known. The new-world title's
// turn has already shown the avatar's face, so it uncovers that card without
// a second flip.
function uncover(id, { flip = true, lid = null, fade = true } = {}) {
  if (!cardIsCovered(id)) return;
  const was = opening()?.step;
  encountered.add(id);
  coveredCards.delete(id);
  rememberCards();
  // Its figure or item fades into the scene (stage-reveal.mjs).
  if (fade) stageReveals.add(id);
  // The opening's last card down raises its first play, Put out (opening.mjs).
  const step = opening();
  if (was === "reveal" && step?.step === "play" && step.choice.length) {
    selectCards(step.choice);
    rowCollapsed = false;
  }
  render();
  const shown = $("hand").querySelector(`.card[data-card="${id}"]`);
  if (shown && flip) void revealCard(openingLid(shown, lid));
  $("discovery-announcement").textContent = `New card: ${nameOf(id)}.`;
  if (openingHeld && openingWordsDue() && avatarKnown()) resumeScene();
  if (sharedSession) syncSharedLine();
}
// A new local world's opening, while it lasts (opening.mjs).
function opening() {
  if (sharedSession) return null;
  return openingStep(world, currentActor(world), cardIsCovered);
}
function sharingMeal(cards) {
  return cards.length === 3 && cardPlay(world, cards).action?.kind === "eat";
}
function choose(id) {
  if (finishCardReveal(id) || selectionBlocked()) return;
  if (reviewing) returnToLive();
  queueChoice();
  if (things[id] && selected.includes(id) && restedChoice === choiceKey()) {
    restedChoice = null;
    rowCollapsed = false;
    render();
    return;
  }
  // A locked box is chosen, not uncovered: it opens with its quest.
  if (cardIsCovered(id) && !isLockedBox(world, id)) {
    uncover(id);
    return;
  }
  playQueue.clear();
  lastPlayAt = -Infinity;
  fresh.delete(id);
  const questPicked = questOpen;
  questOpen = false;
  // Any tap opens a folded row again; the held item is still raised.
  rowCollapsed = false;
  // Any tap but one on the ways on folds them: one fan at a time.
  const way = wayStack(id);
  if (!way) waysOpen = null;
  // While the avatar's stacks show, tapping it folds them back, then lowers
  // it; tapping a stack's top card fans it and chooses that card, so the
  // first tap also shows its full details in the descriptor.
  const actor = currentActor(world),
    part = expandedHolders.has(actor) ? avatarStack(id) : null;
  const withCard = [...selected, id];
  if (selected.length === 3 && selected.includes(id))
    selectCards(
      selected.filter((cardId) => cardId !== id),
      { keepOpen: true },
    );
  else if (sharingMeal(withCard)) selectCards(withCard, { keepOpen: true });
  else if (id === actor && expandedHolders.has(actor)) {
    const settled = !avatarFan && !questPicked && selected.join("+") === actor;
    avatarFan = null;
    if (settled) expandedHolders.delete(actor);
    selectCards(settled ? [] : [actor], { keepOpen: true });
  } else if (way?.under) {
    // Fanning the ways on folds the avatar's fan and the place's stack.
    const back = cameFrom();
    waysOpen = placeHere();
    avatarFan = null;
    selectCards(
      selected.filter((cardId) => cardId !== back && !atHere(cardId)),
    );
  } else if (part) {
    if (part.under) avatarFan = part.kind;
    // A thing chosen takes the avatar's place in the choice, so it pairs
    // with another card as it did; tapped again, it is only lowered.
    const others = selected.filter((cardId) => cardId !== actor);
    selectCards(
      part.chosen
        ? selected.filter((cardId) => cardId !== id)
        : others.length >= 2
          ? [selectedHandItem(world, others), id].filter(Boolean)
          : [...others, id],
      { keepOpen: true },
    );
    expandedHolders.add(actor);
  } else if (id === placeHere() && expandedHolders.has(id)) {
    expandedHolders.delete(id);
    selectCards(selected.filter((cardId) => !atHere(cardId)));
  } else {
    const holder = things[id] ? rootHolder(world, id) : null;
    if (places[holder])
      selected = selected.filter((cardId) => cardId !== holder);
    // No play takes two places, so a new place replaces the chosen one and
    // keeps its partner: Pip + Station, then Pond, invites Pip to the Pond.
    if (places[id] && !selected.includes(id))
      selected = selected.filter((cardId) => !places[cardId]);
    const lowering = selected.includes(id);
    selectCards(
      lowering
        ? selected.filter((cardId) => cardId !== id)
        : selected.length >= 2
          ? selected.includes(holder)
            ? selected.map((cardId) => (cardId === holder ? id : cardId))
            : selectedHandItem(world, selected)
              ? [selectedHandItem(world, selected), id]
              : [id]
          : [...selected, id],
      { keepOpen: lowering },
    );
  }
  selectionRevision = world.revision;
  render();
  const hand = $("hand");
  hand.querySelector(`[data-card="${id}"]`)?.focus({ preventScroll: true });
  const firstItem =
    id === placeHere()
      ? hand.querySelector(`.card-frame[data-holder="${id}"]:not([hidden])`)
      : null;
  revealHandCard(id, { nextFrame: firstItem });
}
function dragPlay(cards) {
  const { action } = cardPlay(world, cards);
  if (!action) return null;
  return restPlays(
    world,
    [action],
    lastWait?.key === cards.join("+") && lastWait.revision === world.revision,
    cards,
  )[0];
}
function commit(cards, revision) {
  if (selectionBlocked()) return;
  const action = dragPlay(cards);
  if (!action) {
    $("play-readout").textContent = "That cannot be used here.";
    return;
  }
  commitAction(action, revision);
}
function commitAction(action, revision, renderedAt = -Infinity) {
  if (selectionBlocked()) return;
  if (renderedAt >= lastPlayAt && performance.now() - lastPlayAt < SETTLE_MS)
    return;
  // The drone falls silent just before a discovery is revealed.
  if (action.choiceId) hum.hush();
  // The same play chosen again keeps it; its Thinking card cancels it.
  if (playQueue.pending?.action.key === action.key) return;
  // A play leaves the hand where it is: raised stays raised. Its beat rests
  // at once; the Thinking card stands for it until its scene.
  if (action.kind !== "focus") restedChoice = choiceKey();
  // A new play earns its own grace before the hand returns.
  thinkingSince = null;
  playQueue.submit(action, revision);
}
function performAction(action, revision) {
  if (saveBlocked || sharedSession) return;
  if (pipPrelude() && action.kind === "talk" && action.target === "moth") {
    const next = beginPipJourney(world.run?.seed);
    world.actors.vale.want = structuredClone(next.actors.vale.want);
    save();
    pipLeaving = true;
    const transition = ++pipTransition;
    selected = [];
    restedChoice = null;
    render();
    pipTimer = setTimeout(() => {
      if (transition !== pipTransition) return;
      void leavePage(() => {
        if (transition === pipTransition) resetTable(next);
      }, { ms: 1600, remember: false });
    }, 1800);
    return;
  }
  const result = play(world, action, revision);
  if (!result.ok) {
    count("error.rules_reject");
    notice(result.error);
    render();
    return;
  }
  // Choosing a quest passes no turn and leaves the scene and its speech be.
  if (action.kind === "focus" || action.kind === "pack") {
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
  thinkingStartedAt = performance.now();
  const from = world.actors[currentActor(world)].place;
  const heldBefore = heldSelection();
  const beats = combatBeats(world, result.state, {
    viewer: currentActor(world),
    place: from,
  });
  world = result.state;
  rememberWait(action, selected.join("+"));
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
        beats.some((beat) => beat.kind === "defeat" && beat.viewerLost),
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
// world is drawn only after the last beat (and any loss screen) is done.
let combatView = null,
  combatRun = 0,
  combatRelease = null;
const combatHeld = new Set();
function combatStage() {
  return (combatView ??= createCombatView({
    stage: $("stage"),
    caption: $("combat-caption"),
    announce: $("combat-announcement"),
    veil: $("travel"),
    // The loss screen's full-art cards: the hand's card faces, inert.
    cardColours,
    cardFace: (id) => {
      const face = card(id).querySelector(".card").cloneNode(true);
      face.disabled = false;
      face.dataset.selected = "false";
      return face;
    },
    reducedMotion,
    revealLine: (seq) => {
      if (combatHeld.delete(seq)) renderLog();
    },
    sound: (name, seed) => name && sfx.fight(name, seed),
  }));
}
function endCombat() {
  combatRun++;
  delete document.body.dataset.handAway;
  combatCue = false;
  if (lossCue) {
    lossCue = false;
    syncMusicCue();
  }
  combatView?.cleanup();
  $("travel").classList.remove("fainting");
  combatHeld.clear();
  const release = combatRelease;
  combatRelease = null;
  release?.();
}
async function presentCombat(beats, land) {
  if (beats.some((beat) => beat.kind === "defeat" && beat.viewerLost))
    count("defeat");
  const mine = ++combatRun;
  const view = combatStage();
  for (const beat of beats) combatHeld.add(beat.seq);
  combatCue = true;
  music.cue("battle");
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
  if (defeat) {
    // The hand stays away until the new place's hand is dealt (render).
    document.body.dataset.handAway = "true";
    // The loss screen's song comes in on the black after three beats of
    // silence (music-cues.mjs). Leaving the loss screen fades it out fully
    // before the lift onto the next scene and its room song.
    lossCue = true;
    music.cue("battle-loss");
    await view.defeat(defeat);
    if (mine !== combatRun) return;
    music.cue(HUSH);
    if (music.cueSounding)
      await new Promise((done) =>
        setTimeout(done, CUE_TRACKS["battle-loss"].fadeOut * 1000),
      );
    lossCue = false;
  }
  if (mine !== combatRun) return;
  await view.release();
  if (mine !== combatRun) return;
  const release = combatRelease;
  combatRelease = null;
  combatView.cleanup();
  combatHeld.clear();
  covering = false;
  combatCue = false;
  renderLog();
  // The black lifts slowly onto wherever the rules put the player; the
  // travel veil (already down) takes over from it.
  $("travel").classList.toggle("waking", Boolean(defeat));
  land(release);
  $("travel").classList.remove("fainting");
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
  swapFrom = null;
  covering = false;
  syncHandDrop();
  revealTravel();
  travelShown = Promise.resolve();
  $("travel").classList.remove("travelling");
  // Figures mid-entrance or mid-farewell settle rather than cut
  // (figure-settle.mjs); one leaving the stage fades out, then goes.
  const reduced = reducedMotion.matches;
  for (const figure of $("cast").children) {
    const hidden = figure.classList.contains("entering"),
      body = figure.querySelector(".portrait-body");
    figure.classList.remove("entering");
    if (hidden || body.getAnimations().length)
      settle(body, { hidden, reduced });
  }
  entrances.clear();
  for (const figure of exits.keys()) {
    const leaving = Boolean(figure.dataset.removing);
    if (leaving) figure.dataset.settling = "true";
    settle(figure, { leaving, reduced }).finished.then(
      () => {
        if (leaving && figure.dataset.settling) dropFigure(figure);
      },
      () => {},
    );
  }
  exits.clear();
  renderedCast = "";
  for (const animation of $("speech-row").getAnimations()) animation.cancel();
}
// Cards met at the new place are unveiled once the veil has fully lifted.
// After a loss the veil is already black and lifts slowly, wordless: the
// loss screen said where the player comes to.
async function travel(place, arrive, landed, lost = false) {
  count("travel");
  const veil = $("travel");
  veil.classList.toggle("waking", lost);
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
  departHand();
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
// Compose the avatar and selected cards over the scene, as quest cards do.
function showBeatCards(
  ids, here, verb, recipe = false, actionView = null, asScene = true,
) {
  const cards = document.querySelector(".action-beat-cards"),
    key = JSON.stringify([
      recipe,
      here,
      verb,
      ids,
      ids.map(beatPortrait),
      actionView,
      asScene,
    ]);
  if (cards.dataset.cards === key) return;
  cards.dataset.cards = key;
  releaseImages(cards);
  if (actionView) {
    cards.replaceChildren(questScreen(actionView, questArt, asScene));
    return;
  }
  if (recipe) {
    const scene = questScreen(
      {
        kind: "item",
        actor: ids.at(-2),
        here: ids.at(-1),
        target: ids[0],
        items: ids.slice(0, -2),
      },
      questArt,
    );
    scene.dataset.recipe = "true";
    cards.replaceChildren(scene);
    return;
  }
  const [actor, ...others] = ids;
  const items = others.filter((id) => things[id]);
  const other = others.find((id) => people[id]);
  const target = items[0] || other || others.find((id) => places[id]) || here;
  const kind = items.length ? "item" : other ? "person" : "place";
  const to = items.length ? other : null;
  if (!actor) return cards.replaceChildren();
  cards.replaceChildren(
    questScreen({ actor, kind, target, here, verb, items, to }, questArt),
  );
}
// Another part of the table, such as the ☰ menu, can borrow the action
// beat: { avatar, cards: [{ src, level, color, lit, ground }], name, info,
// message, note, edit?: { key, label, value, onInput }, buttons: [{ label, id, run }] }.
// The name and its info line read in
// the middle, then the note; the buttons sit on the right, and a beat may
// have none. It replaces the play's beat until cleared. `borrowedBeat` is
// declared before notice(), which a refused save calls during boot.
export function showActionBeat(beat) {
  borrowedBeat = beat;
  if (keptBorrowedBeat) keptBorrowedBeat = beat;
  renderActions();
}
let keptBorrowedBeat = null;
export function clearActionBeat(beat) {
  if (beat && beat === keptBorrowedBeat) return;
  if (!borrowedBeat || (beat && borrowedBeat !== beat)) return;
  borrowedBeat = null;
  keptBorrowedBeat = null;
  syncActionReveal();
  renderActions();
}
// The menu light-dismisses on a card tap. Keep its chosen message for the
// second tap; another card or Back returns to the table.
$("action-beat").addEventListener("pointerdown", () => {
  if (borrowedBeat?.avatar) keptBorrowedBeat = borrowedBeat;
});
document.addEventListener(
  "click",
  (event) => {
    if (!keptBorrowedBeat || event.target.closest("#action-beat")) return;
    clearActionBeat();
    if (event.target.closest(".dialogue")) event.stopPropagation();
  },
  true,
);
document.addEventListener(
  "keydown",
  (event) => {
    if (!keptBorrowedBeat || !["Escape", "ArrowUp"].includes(event.key)) return;
    clearActionBeat();
    event.preventDefault();
    event.stopPropagation();
  },
  true,
);
function showBorrowedBeat() {
  const combined =
    borrowedBeat.avatar &&
    !borrowedBeat.edit &&
    borrowedBeat.buttons.length === 1;
  renderCardDescriptor(borrowedBeat, {
    placeArt,
    showNote: showActionBeatNote,
    showMessage: combined
      ? (root) =>
          writeActionMessage(
            root,
            borrowedBeat.message ??
              [borrowedBeat.name, borrowedBeat.info].filter(Boolean).join(" · "),
            JSON.stringify(borrowedBeat),
            borrowedBeat.name,
          )
      : undefined,
  });
  if (combined) cardTapHint($("card-actions").firstElementChild);
  else {
    actionReveal.cancel();
    actionMessage = null;
  }
  syncActionReveal();
  syncActionBeat();
}
function paintActionTap(button, complete) {
  const cue = tapPrompt(button.dataset.tapVerb, complete, button.dataset.tapName);
  const revealing = String(!complete);
  if (button.dataset.revealing !== revealing) button.dataset.revealing = revealing;
  if (button.dataset.tapHint !== cue.hint) button.dataset.tapHint = cue.hint;
  if (button.getAttribute("aria-label") !== cue.label)
    button.setAttribute("aria-label", cue.label);
  if ($("action-beat").dataset.cardTap === "hint" && button.textContent !== cue.hint)
    button.textContent = cue.hint;
}
function nameActionTap(button, verb, label = button.textContent) {
  if (button.disabled) return;
  button.dataset.tapVerb = verb;
  button.dataset.tapName = label;
  paintActionTap(button, actionReveal.complete);
}
function cardTapHint(button, verb = actionTapVerb(null, button.textContent), label) {
  $("action-beat").dataset.cardTap = "hint";
  nameActionTap(button, verb, label);
}

const choiceKey = () => `${selected.join("+")}:${rowCollapsed}`;
let queuedChoice = false;
function queueChoice() {
  queuedChoice ||= Boolean(shownSceneLine && (
    !reveal.complete || exchange.current || replyPending() ||
    (sharedSession && sharedNextLine(sharedSession.state, shownSceneLine.locationId, shownSceneLine.seq))
  ));
}
function lingeringWords(inFlight) {
  // A play still queued, sending or waiting at the table can be withdrawn;
  // its Thinking card stands until the rules take it.
  const committed =
    inFlight &&
    !playQueue.pending &&
    !sharedSending &&
    !["sending", "accepted"].includes(sharedPlay?.state) &&
    ownSharedEntry()?.status !== "waiting";
  if (!committed) {
    thinkingSince = null;
    clearTimeout(thinkingGrace);
    return false;
  }
  if (thinkingSince === null) {
    thinkingSince = performance.now();
    clearTimeout(thinkingGrace);
    thinkingGrace = setTimeout(syncPhase, THINKING_GRACE_MS);
  }
  return performance.now() - thinkingSince >= THINKING_GRACE_MS;
}
function presentPhase() {
  if (restedChoice !== choiceKey()) restedChoice = null;
  if (queuedChoice && (rowCollapsed || (!selected.length && !questOpen) || restedChoice !== null)) {
    queuedChoice = false;
    queueMicrotask(() => exchange.settleLast());
  }
  const inFlight = Boolean(stackView.pending) || Boolean(ownPlayInFlight());
  return phase({
    reviewing: reviewing && stackView.frontIndex < stackView.liveIndex,
    revealing: queuedChoice || !reveal.complete || exchange.hasNext || inscribing.size > 0,
    inFlight,
    lingering: lingeringWords(inFlight),
    raised: !rowCollapsed,
    chosen: selected.length > 0 || questOpen,
    rested: restedChoice !== null,
  });
}
function syncPhase() {
  if (reviewing && abandonQuest) {
    abandonQuest = null;
    renderActions();
  }
  syncActionReveal();
  if (presentPhase() !== shownPhase) renderActions();
  else syncActionBeat();
}
// The server's reason for refusing this play, while its cards stay chosen
// and the world has not moved on.
const refusedPlay = (action) =>
  sharedRefusal?.key === action.key ? sharedRefusal.reason : "";
let abandonQuest = null;
function cancelAbandon() {
  abandonQuest = null;
  renderActions();
  $("card-actions").querySelector("[data-drop-quest]")?.focus();
}
function renderActions() {
  if (questOpen && !questVisible(world, shownQuests[questPick])) questOpen = false;
  const row = $("card-actions"),
    panel = $("action-beat");
  panel.removeAttribute("data-card-tap");
  if (
    sharedRefusal &&
    (sharedRefusal.choice !== selected.join("+") ||
      sharedRefusal.revision !== world.revision)
  )
    sharedRefusal = null;
  shownPhase = presentPhase();
  const rested = shownPhase !== "choosing";
  const { actions: offered, hint } = cardActions(world, selected);
  const ready = restPlays(
    world,
    offered,
    lastWait?.key === selected.join("+") &&
      lastWait.revision === world.revision,
    selected,
  );
  // A chosen play leaves the beat: the Thinking card stands for it, and its
  // reply types into the full-size front card.
  // While the opening has a card down, the button only reveals the next.
  const quiet = !rested && opening()?.step === "reveal";
  const closed = selected.some(cardIsClosed);
  const actions = rested || quiet || closed ? [] : ready;
  const clientText = quiet
    ? "Turn over the next card."
    : !rested &&
        selected.length === 1 &&
        things[selected[0]]?.view &&
        !cardIsClosed(selected[0])
      ? `Look at ${theName(selected[0])} up close.`
      : "";
  const selectionName = selected.map((id) => cardIsClosed(id) ? "Closed box" : nameOf(id)).join(" + ");
  $("selection-name").textContent = selected.length
    ? selectionName
    : "Card actions";
  // The beat shows the cards being played and says what the play will do.
  const heading = document.querySelector(".action-beat-heading"),
    actor = currentActor(world),
    name = nameOf(actor),
    // The quest chosen in the open fan names itself, as a play does.
    questShown =
      !selected.length && questOpen && !rested ? shownQuests[questPick] : null,
    lockShown =
      !rested && closed
        ? (selected.length === 1 && isLockedBox(world, selected[0])
            ? lockedQuest(world, selected[0], known)
            : null) || {
            text: selected.some((id) => isLockedBox(world, id))
              ? LOCKED_BOX
              : CLOSED_BOX,
            cards: [],
          }
        : null,
    // Rule texts can double a name's article ("the The Burial Decree").
    sentence = lockShown
      ? lockShown.text
      : questShown
        ? shownQuestCaption(questShown, false)
        : (
            (actions[0] && playText(actions[0])) ||
            clientText
          ).replace(
            /\b(the|an?) (?:the|an?) /giu,
            "$1 ",
          );
  heading.hidden = !sentence;
  // Who acts, then what it acts on: the chosen cards, or the place it
  // waits in.
  const others = selected.filter((id) => id !== actor);
  const here = world.actors[actor].place;
  const involved = lockShown
    ? []
    : questShown
      ? [actor, questShown.target].filter((id) => id && !cardIsCovered(id))
      : sentence
        ? [actor, ...(others.length ? others : [here])]
        : [];
  showBeatCards(
    involved,
    here,
    playLabel(actions[0], world),
    lockShown?.recipe,
    lockShown
      ? { kind: "place", target: selected.find(cardIsClosed), covered: true }
      : questShown
        ? questView(questShown)
        : actions[0]
          ? actionScene(
            {
              actorId: actor,
              verb: actions[0].kind,
              itemId: actions[0].item,
              targetId: actions[0].target,
              receiveId: actions[0].receive,
              locationId: actions[0].kind === "move" ? actions[0].target : here,
            },
              known,
            )
          : null,
    !lockShown,
  );
  // A quest keeps its own tier; other plays take the rarest selected card.
  const rarest = questShown
    ? questTier(questShown, world, known)
    : involved
        .map((id) => levelTier(cardLevel(world, id)))
        .reduce((top, tier) => (tier.rank > top.rank ? tier : top), levelTier(0));
  $("action-beat").dataset.tier = rarest.id;
  $("action-beat").style.setProperty("--tier-color", rarest.color);
  // A folded row lies low even with a choice in it.
  document.querySelector(".play-dock").dataset.selected = String(
    selected.length > 0 && !rowCollapsed,
  );
  // Settings' hand of cards stands raised (settings-cards.mjs).
  document.body.dataset.handExpanded = String(
    dragging.length > 0 || !rowCollapsed || $("settings-screen").open,
  );
  syncLayering();
  if (borrowedBeat) {
    return showBorrowedBeat();
  }
  const revision = world.revision;
  row.replaceChildren(
    ...actions.map((action, index) => {
      const refused = refusedPlay(action);
      const button = node(
        "button",
        refused ? refusalLabel(refused) : playLabel(action, world),
        index === 0 ? "card-primary" : "card-action",
      );
      button.type = "button";
      button.dataset.action = action.kind;
      // Discarding a quest is destructive: the usual button, red words.
      if (action.kind === "drop" && !action.item)
        button.dataset.destructive = "";
      button.title = refused || playText(action);
      button.disabled = Boolean(refused) || selectionBlocked();
      if (refused) button.dataset.blocked = "refused";
      if (action.choiceId) {
        button.dataset.choice = action.choiceId;
        button.dataset.pack = action.packId;
      }
      const renderedAt = performance.now();
      button.onclick = () => commitAction(action, revision, renderedAt);
      return button;
    }),
  );
  if (quiet) {
    const reveal = node("button", OPENING_REVEAL, "card-primary");
    reveal.type = "button";
    reveal.dataset.quiet = "true";
    reveal.disabled = selectionBlocked();
    reveal.onclick = () => uncover(opening()?.next);
    row.append(reveal);
  }
  // The top quest, chosen in the open fan, offers its next step (a play the
  // rules already offer, or why there is none) and Discard (a level quest
  // costs experience, named on its button). Choosing a card beneath brings
  // it to the top.
  const picked = questOpen && !rested ? shownQuests[questPick] : null;
  const legal = picked?.index === 0 ? legalActions(world) : [];
  const progress =
    picked?.index === 0 &&
    questStep(world, picked, questCovered(picked), legal);
  const next =
    progress?.action &&
    ["item", "target", "receive", "destination"].some(
      (key) => progress.action[key] && cardIsCovered(progress.action[key]),
    )
      ? { reason: NOT_FOUND }
      : progress;
  const steps = next?.rest
    ? restPlays(
        world,
        legal.filter((a) => a.kind === "wait" && !a.sleep && !a.guards),
        lastWait?.key === selected.join("+") &&
          lastWait.revision === world.revision,
      )
    : next?.action
      ? [next.action]
      : [];
  const step = steps[0];
  const drop =
    !step && legal.find((a) => a.kind === "drop" && !a.item && a.quest === 0);
  const confirmKey = drop ? `${revision}:${picked.key}` : null;
  if (abandonQuest !== confirmKey) abandonQuest = null;
  const dropLabel = drop && playLabel(drop, world);
  const questButtons = abandonQuest
    ? [{ action: drop, label: "Confirm?" }]
    : step
      ? [
          {
            action: step,
            label: shownQuestCaption(picked, false),
          },
        ]
      : drop
        ? [{ action: drop, label: dropLabel }]
        : [];
  for (const { action, label } of questButtons) {
    const discard = action?.kind === "drop" && !action.item,
      button = node(
        "button",
        label,
        action && !discard ? "card-primary" : "card-action",
      );
    button.type = "button";
    if (discard) {
      button.dataset.dropQuest = String(picked.index);
      button.dataset.destructive = "";
    } else button.dataset.questStep = "";
    if (!discard) button.dataset.action = action.kind;
    button.title = discard ? "Discard this quest" : shownQuestCaption(picked, false);
    button.disabled = selectionBlocked();
    button.onclick = () => {
      if (discard && !abandonQuest) {
        abandonQuest = confirmKey;
        renderActions();
        row.lastElementChild?.focus();
        return;
      }
      abandonQuest = null;
      questOpen = false;
      questPick = 0;
      commitAction(action, revision);
    };
    row.append(button);
  }
  // An item with its own view offers a client-only Look; it plays nothing.
  const viewed = selected.length === 1 && selected[0];
  if (
    !rested &&
    !row.children.length &&
    viewed &&
    things[viewed]?.view &&
    !cardIsCovered(viewed) &&
    !sealedReason(world, viewed) &&
    !asleepReason(world, selected) &&
    hint !== TOO_MANY_ITEMS
  ) {
    const look = node("button", "Look", "card-action");
    look.type = "button";
    look.dataset.look = viewed;
    look.title = `Look at ${theName(viewed)} up close`;
    look.onclick = () => showItemView(viewed);
    row.append(look);
  }
  // The context button keeps a closed box's contents concealed.
  const sealed = !rested && closed;
  if (sealed) {
    const why = node("button", "Locked", "card-action");
    why.type = "button";
    why.disabled = true;
    why.dataset.blocked = "gate";
    why.title = lockShown.text;
    why.setAttribute("aria-label", `Locked. ${lockShown.text}`);
    row.append(why);
    // The same descriptor and small corner cue as Continue, without a play.
    cardTapHint(why, "Locked");
  }
  // An Ask, Trade or Invite of a sleeping resident says so (rules 100).
  const asleep = !sealed && !rested && !actions.length && asleepReason(world, selected);
  if (asleep) {
    const blocked = node("button", asleep, "card-primary");
    blocked.type = "button";
    blocked.disabled = true;
    blocked.dataset.blocked = "asleep";
    blocked.title = asleep;
    row.append(blocked);
  }
  // A Take refused for space says why in the context button (#2018). It
  // plays nothing; the cards stay as they are.
  const crowded =
    !sealed && !rested && hint === TOO_MANY_ITEMS && selected.find((id) => things[id]);
  if (crowded) {
    const reason = `You have too many items to take ${theName(crowded).toLowerCase()}`;
    const blocked = node("button", reason, "card-primary");
    blocked.type = "button";
    blocked.disabled = true;
    blocked.dataset.blocked = "carry";
    blocked.title = reason;
    row.append(blocked);
  }
  let message = heading.lastElementChild;
  const only = actions.length === 1 ? actions[0] : null;
  if (
    sentence &&
    row.childElementCount === 1 &&
    !row.firstElementChild.disabled &&
    (only || quiet || row.firstElementChild.dataset.look)
  ) {
    const button = row.firstElementChild;
    panel.setAttribute("data-card-tap", "");
    if (only?.kind === "wait" && !only.label && !only.guards)
      button.dataset.waitSentence = "";
    nameActionTap(
      button,
      quiet ? "Uncover" : actionTapVerb(only, button.textContent),
      only?.label === "Wake" ? sentence : button.textContent,
    );
    message = button;
    heading.hidden = true;
  } else if (questShown && row.childElementCount === 1) {
    const label = step && playLabel(step, world);
    cardTapHint(
      row.firstElementChild,
      abandonQuest ? "Confirm" : drop ? "Discard" : actionTapVerb(step, label || "Continue"),
      label || undefined,
    );
  }
  const note = document.querySelector(".action-beat-note");
  let noteText = visibleText(next?.reason === NOT_FOUND ? "" : next?.reason || "");
  if (abandonQuest) {
    panel.dataset.tier = "danger";
    panel.style.setProperty("--tier-color", "var(--danger)");
    noteText = `${shownQuestCaption(picked, false)}. Cost ${dropCost(world, actor, picked.index)} XP.`;
  }
  showActionBeatNote(note, { note: noteText });
  const text = abandonQuest ? "Discard this quest?" : sentence;
  writeActionMessage(
    message,
    text,
    JSON.stringify([choiceKey(), picked?.key, text]),
    name,
  );
  // A disabled status cannot receive the tap that finishes typed words.
  if (sealed) actionReveal.finish();
  delete $("action-beat").dataset.avatar;
  // A refused play whose cards are no longer chosen says so on the status
  // line, briefly, as its button would.
  const aside =
    sharedRefusal && !actions.some((a) => a.key === sharedRefusal.key);
  if (aside)
    notice(
      `Not played: ${sharedRefusal.label}. ${refusalSentence(sharedRefusal.reason)}`,
      "rejected",
    );
  else if ($("play-status").dataset.playStatus === "rejected") notice("");
  syncActionBeat();
  // A refused play reads its reason to a screen reader, as its button shows.
  const readout = (a) =>
    refusedPlay(a)
      ? `Not played: ${playLabel(a)}. ${refusedPlay(a)}`
      : playLabel(a);
  $("play-readout").textContent = selected.length
    ? `${selectionName}. ${lockShown?.text || actions.map(readout).join(". ") || hint}`
    : questOpen && (shownQuests[questPick] || sealedQuests[0])
      ? shownQuestCaption(shownQuests[questPick] || sealedQuests[0], false)
      : "";
}
$("action-beat").addEventListener(
  "click",
  (event) => {
    const button = event.target.closest("button");
    if (
      !actionMessage ||
      (button && !event.currentTarget.hasAttribute("data-card-tap"))
    )
      return;
    if (!actionReveal.complete) {
      event.stopPropagation();
      actionReveal.finish();
      return;
    }
    if (!button && event.currentTarget.hasAttribute("data-card-tap"))
      $("card-actions").querySelector("button:enabled")?.click();
  },
  true,
);
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
        : [];
  frame.dataset.raised = String(raised);
  button.setAttribute("aria-pressed", String(raised));
  button.dataset.selected = String(selected.includes(id));
  button.classList.toggle("new", !cardIsClosed(id) && fresh.has(id));
  if (frame.dataset.holder)
    frame.hidden = places[frame.dataset.holder]
      ? !expandedHolders.has(frame.dataset.holder)
      : !raised && !expandedHolders.has(frame.dataset.holder);
  if (held.length) {
    frame.dataset.expanded = String(expandedHolders.has(id));
    button.setAttribute("aria-expanded", String(expandedHolders.has(id)));
  }
  syncAvatarStack(frame, id);
  if (cardIsClosed(id)) return;
  button.querySelector(".sr-only").textContent =
    cardObservation(world, id) +
    (label ? ` ${label}.` : "") +
    (held.length
      ? ` ${places[id] ? "Contains" : "Carries"} ${held.map((item) => cardIsClosed(item) ? "covered" : nameOf(item)).join(", ")}. Select to show these cards.`
      : "");
}
const handMotions = new Map();
// Cards new to the hand rise in, and quests are dealt face down
// (card-entry.mjs).
const handEntries = createCardEntries(),
  questsInView = createQuestEntries(),
  lockedBoxes = createLockedBoxes();
// Quests turned face up at least once: only these show their parts' tier
// while folded.
const revealedQuests = new Set();
// A box whose quest is done turns over once, the next time it is in view. A
// box never uncovered opens as a newly found card does, with its name.
function openLockedBoxes() {
  const buttons = [...$("hand").children]
    .filter((frame) => !frame.dataset.want)
    .map((frame) => frame.querySelector(".card"));
  const opening = lockedBoxes.draw(
    buttons
      .filter((button) => !button.parentElement.hidden)
      .map((button) => button.dataset.card),
    buttons
      .filter((button) => isLockedBox(world, button.dataset.card))
      .map((button) => button.dataset.card),
  );
  const lid = imageUrl(LOCKED_BACK, "card");
  for (const id of opening) {
    const button = buttons.find((b) => b.dataset.card === id);
    if (cardIsCovered(id)) {
      // Face down for a moment, under the locked lid, until it is named.
      openingLid(button, lid);
      setTimeout(() => uncover(id, { lid }));
    } else void revealCard(openingLid(button, lid));
  }
}
// The lid that lifts is the one the card lay under (card-reveal.mjs).
function openingLid(button, lid) {
  const back = lid && button.querySelector(".card-back");
  if (back) back.src = lid;
  return button;
}
const entryKey = (frame) =>
  `${frame.querySelector(".card").dataset.card}@${frame.dataset.holder ?? ""}`;
// Cards leaving the hand fall as ghosts over it (card-exit.mjs). A world
// loaded in its place (another tab's save) shows none.
let quietExits = false;
// A scene change (a new place, the light here going out or coming on) swaps
// the hand in beats (card-swap.mjs). Travel starts it at the tap: the cards
// left behind fall as the veil comes down, and the rest of the swap plays
// when the hand redraws under it. Plays wait until it ends.
let renderedScene = null,
  swapFrom = null,
  swapEnd = 0;
function departHand() {
  if (document.body.dataset.handAway) return;
  const row = [...$("hand").children],
    staying = new Set(availableCards(world)),
    leaving = row.filter(
      (frame) =>
        !frame.hidden &&
        frame.querySelector(".card[data-card]") &&
        !staying.has(cardOf(frame)),
    ),
    { exits } = swapTiming(leaving.length);
  swapFrom = {
    at: performance.now(),
    left: leaving.length,
    fallen: leaving.length ? exits.at(-1) + EXIT_MS : 0,
  };
  dropCards(
    nearestFirst(leaving, row, currentActor(world)),
    handExits(),
    exits,
  );
  for (const frame of leaving) {
    frame.dataset.gone = "true";
    frame.style.visibility = "hidden";
  }
}
// The key a hand card's motion is tracked by: its card, or its quest.
function motionKey(frame) {
  const card = frame.querySelector(".card");
  if (card.dataset.card || !frame.dataset.questId) return card.dataset.card;
  return `${frame.dataset.questId.split(":")[0]}:${card.dataset.questEntry}`;
}
// Deals the shown hand afresh, 70 ms apart; reduced motion fades it in.
function dealHand() {
  const row = [...$("hand").children].filter((f) => !f.hidden);
  if (reducedMotion.matches)
    $("hand").animate({ opacity: [0, 1] }, { duration: SWAP_REDUCED_MS });
  else entryDelays(row.length).forEach((delay, i) => riseIn(row[i], { delay }));
}
function handExits() {
  let layer = $("hand").parentElement.querySelector(":scope > .card-exits");
  if (!layer) {
    layer = node("div", undefined, "card-exits");
    layer.setAttribute("aria-hidden", "true");
    $("hand").after(layer);
  }
  return layer;
}
// Each quest newly dealt lies face down until it is seen, then turns a beat
// later; the next turns a little after. Once turned it stays face up while
// it stays in the hand, folded or fanned. A tap still plays it at once.
function showQuests(opening) {
  const cards = [...$("hand").querySelectorAll(".want-card")],
    // A quest a dream deals stays face down until the dream is done.
    seen = (card) =>
      !card.closest(".want-frame").hidden &&
      !sleepView.holdsQuest(card.dataset.questEntry);
  questsInView
    .show(
      cards.map((card) => card.dataset.questEntry),
      cards.filter(seen).map((card) => card.dataset.questEntry),
      { opening },
    )
    .forEach((key, i) =>
      setTimeout(
        () => turnQuest(key),
        QUEST_DOWN_MS + i * 2 * ENTRY_STAGGER_MS,
      ),
    );
  for (const card of cards) {
    if (card.dataset.met === "true") questsInView.turned(card.dataset.questEntry);
    const down = questsInView.down(card.dataset.questEntry);
    setQuestClosed(card, down);
    if (!down && seen(card)) revealedQuests.add(card.dataset.questEntry);
  }
}
function setQuestClosed(card, closed) {
  card.dataset.unrevealed = String(closed);
  card.dataset.locked = "false";
  const entry = questEntry(card.dataset.questId);
  if (entry) {
    card.dataset.near = String(!closed && questNear(world, entry.quest));
    card.setAttribute("aria-label", closed ? "Face-down quest" : questLabel(entry.quest, entry.met, card.dataset.near === "true"));
  }
}
function turnQuest(key) {
  const card = [
    ...$("hand").querySelectorAll(".want-frame:not([hidden]) > .want-card"),
  ].find((el) => el.dataset.questEntry === key);
  // Folded away before its turn, it turns when it is next seen.
  if (!card) return questsInView.unseen(key);
  if (!questsInView.turned(key)) return;
  revealedQuests.add(key);
  setQuestClosed(card, false);
  void revealCard(card);
}
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
    def = crossingFace ? { ...base, name: crossingFace.name } : base,
    // A card locked behind a quest is a carved wooden box (locked-box.mjs).
    locked = isLockedBox(world, id),
    hidden = cardIsCovered(id) || locked;
  const raised =
    selected.includes(id) || Boolean(places[id] && expandedHolders.has(id));
  const chosen = raised ? cardPlay(world, selected) : null;
  const el = node("button", undefined, `card ${type}`);
  const level = hidden ? 1 : cardLevel(world, id),
    tier = levelTier(level);
  el.dataset.level = String(level);
  el.dataset.tier = tier.id;
  el.dataset.selected = String(selected.includes(id));
  el.style.setProperty("--tier-color", tier.color);
  el.type = "button";
  el.classList.toggle("new", !hidden && fresh.has(id));
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
        : placeArt(id),
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
      cloth.src = imageUrl(cardArt(covering), "card");
      cloth.alt = "";
      graphic.append(cloth);
    }
  }
  const label = playLabel(chosen?.action);
  const observation = node("span", cardObservation(world, id), "sr-only");
  observation.id = `card-detail-${id}`;
  if (raised && label) observation.textContent += ` ${label}.`;
  if (hidden) observation.textContent = "";
  // Every closed lid stays nameless until it opens.
  el.append(
    graphic,
    setCardLabel(
      node("span", undefined, "name"),
      hidden ? "" : def.name,
    ),
    observation,
  );
  // One faint numeral shows a selected person's or thing's level. Places
  // have no level of their own, so they carry none.
  if (type !== "location") {
    const numeral = node("span", romanLevel(level), "card-level");
    numeral.setAttribute("aria-hidden", "true");
    el.append(numeral);
  }
  el.addEventListener("click", () => choose(id));
  el.draggable = !el.disabled && !hidden;
  el.addEventListener("dragstart", (e) => {
    if (selectionBlocked() || cardIsClosed(id)) {
      e.preventDefault();
      return;
    }
    dragging = selected.includes(id) ? [...selected] : [id];
    renderActions();
    selectionRevision = world.revision;
    e.dataTransfer.setData("text/plain", JSON.stringify(dragging));
    e.dataTransfer.effectAllowed = "move";
    $("stage").dataset.play = playLabel(dragPlay(dragging)) || "";
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
      !cardIsClosed(id) &&
      dragging.length &&
      !dragging.includes(id)
    ) {
      playQueue.clear();
      rowCollapsed = false;
      const withCard = [...dragging, id];
      selectCards(
        sharingMeal(withCard)
          ? withCard
          : places[dragging[0]] && places[id]
            ? [id]
            : [dragging[0], id],
      );
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
      `${def.name}, ${places[holder] ? "at" : "carried by"} ${knownName(holder, "someone")}, ${tier.label}, level ${level}`,
    );
  }
  if (people[id] || places[id]) {
    const held = availableCards(world).filter(
      (item) => things[item] && rootHolder(world, item) === id,
    );
    if (held.length && !hidden) {
      frame.dataset.inventory = String(held.length);
      frame.dataset.expanded = String(expandedHolders.has(id));
      el.setAttribute("aria-expanded", String(expandedHolders.has(id)));
      const named = held.filter((item) => !cardIsClosed(item)).map(nameOf);
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
          cardIsClosed(item) ? cardBack(item) : cardArt(item),
          "card",
        );
        preview.alt = "";
        preview.draggable = false;
        frame.prepend(preview);
      }
    }
  }
  syncAvatarStack(frame, id);
  if (!hidden && foldQuest()?.actor === id) frame.prepend(questFold(foldQuest()));
  // A real lock takes priority over discovery.
  el.dataset.locked = String(locked);
  el.dataset.unrevealed = String(cardIsCovered(id) && !locked);
  const back = node("img", undefined, "card-back");
  back.src = imageUrl(cardBack(id), "card");
  back.alt = "";
  back.draggable = false;
  el.append(back);
  if (hidden) {
    el.setAttribute("aria-label", locked ? "Locked box" : "Face-down card. Tap to reveal.");
    el.removeAttribute("aria-describedby");
  }
  return frame;
}
// Face-down layers in a stack (the ways on, the folded quest and its steps
// to come) show the carved card back.
const cardBackImage = () =>
  `url("${imageUrl(CARD_BACK, "card")}")`;
// The quest card: a small screen showing the player doing the quest's verb
// with its target, with only the verb, the level and the tier colour as
// words. It glows while the target is near. The card itself plays nothing:
// chosen on top, the context button offers its next step and Discard
// (quest-step.mjs).
const questCovered = (quest) =>
  quest.receiptId === undefined && (!quest.target || cardIsClosed(quest.target));
const known = (id) => !cardIsClosed(id);
function shownQuestCaption(quest, includeLevel = true) {
  const hidden = questCovered(quest);
  const shown = includeLevel ? quest : { ...quest, level: null };
  return questCaption(shown, hidden, questVerb(world, quest, hidden), known);
}
const questArt = {
  url: (src) => imageUrl(src, "card"),
  portrait: (id) => portrait(id, null, world),
  thing: (id) => cardArt(id),
  place: placeArt,
  back: cardBack,
};
function questView(quest) {
  const covered = questCovered(quest);
  return {
    verb: questVerb(world, quest, covered),
    actor: quest.actor,
    kind: quest.kind,
    target: quest.target,
    covered,
    here: questGround(world, quest, covered, known),
    hereCovered: Boolean(quest.step?.at && !known(quest.step.at)),
    to: quest.step?.to,
    toCovered: Boolean(quest.step?.to && !known(quest.step.to)),
    atCovered: questBox(quest, known),
    at: quest.step?.at,
  };
}
const levelUpTitle = (quest, met) => quest.level && (!met || quest.earnedLevel);
const questLabel = (quest, met, near) => {
  const caption = levelUpTitle(quest, met)
    ? `Level Up ${romanLevel(quest.level)}: ${shownQuestCaption(quest, false)}`
    : shownQuestCaption(quest);
  return met
    ? `Quest met: ${caption}. Select to collect its reward.`
    : `Quest${quest.index ? ` ${quest.index + 1}` : ""}: ${caption}${near ? ", near" : ""}`;
};
function questFrame({ id, quest, met }) {
  const picked = !met && questOpen && quest.index === questPick;
  const hidden = questCovered(quest),
    tier = questTier(quest, world, known),
    verb = questVerb(world, quest, hidden),
    near = !hidden && questNear(world, quest),
    here = world.actors[quest.actor].place;
  const el = node("button", undefined, "card want-card");
  el.type = "button";
  el.dataset.want = quest.kind;
  el.dataset.tier = tier.id;
  el.dataset.near = String(near);
  el.style.setProperty("--tier-color", tier.color);
  const claim = questClaims.get(quest.key);
  el.disabled = selectionBlocked() || Boolean(claim && !claim.uncertain);
  el.dataset.questId = id;
  el.dataset.questKey = quest.key;
  el.dataset.questEntry = questEntryKey(quest);
  el.dataset.unrevealed = String(questsInView.down(questEntryKey(quest)));
  el.dataset.picked = String(picked);
  el.setAttribute("aria-pressed", String(picked));
  el.setAttribute(
    "aria-label",
    questLabel(quest, met, near),  );
  if (met) {
    el.dataset.met = "true";
    el.append(node("span", "✓", "quest-seal"));
  }
  const head = node("span", undefined, "quest-head");
  // A level quest keeps its title through each step. A checked step names
  // its deed; the final receipt names the level ready to claim.
  head.append(
    setCardLabel(node("span", undefined, "quest-verb"), levelUpTitle(quest, met) ? "Level Up" : verb),
    node("span", quest.level ? romanLevel(quest.level) : "", "quest-level"),
  );
  el.append(
    // Face down, it shows the carved lid until it turns.
    Object.assign(node("img", undefined, "card-back"), {
      src: imageUrl(CARD_BACK, "card"),
      alt: "",
      draggable: false,
    }),
    questScreen(
      quest.art ? { ...questView(quest), actor: null } : questView(quest),
      quest.art ? { ...questArt, place: () => quest.art } : questArt,
    ),
    head,
  );
  // A quest's first tap shows its details and fans the stack. A checked
  // card clears on its first tap; tapping a chosen quest lowers it.
  el.addEventListener("click", () => {
    if (selectionBlocked()) return;
    if (picked) questOpen = false;
    else if (met) return clearQuest(el, quest);
    else return pickQuest(quest);
    render();
  });
  const frame = node("div", undefined, "card-frame want-frame");
  frame.dataset.want = quest.kind;
  frame.dataset.questId = id;
  frame.dataset.raised = String(picked);
  // It folds behind the player's avatar until that avatar's stacks show.
  frame.dataset.holder = quest.actor;
  // Steps still to come lie face down behind the card, as a stack.
  for (let i = Math.min(quest.left - 1, 3); i > 0; i--) {
    const edge = node("span", undefined, "quest-edge");
    edge.style.setProperty("--i", String(i));
    edge.style.setProperty("--tier-color", tier.color);
    edge.style.setProperty("--card-back", cardBackImage());
    frame.append(edge);
  }
  frame.append(el);
  syncAvatarStack(frame, id);
  return frame;
}
// Choosing a quest beneath the top plays the rules' focus, which takes no
// turn; the fan stays open on it while the play settles.
function pickQuest(quest) {
  if (selectionBlocked()) return;
  if (reviewing) returnToLive();
  queueChoice();
  const focus = legalActions(world).find(
    (a) => a.kind === "focus" && a.quest === quest.index,
  );
  questPick = quest.index;
  // The chosen quest is the choice alone, beside its avatar's stacks.
  questOpen = true;
  selected = [];
  avatarFan = "quests";
  expandedHolders.add(currentActor(world));
  rowCollapsed = false;
  if (focus) playQueue.submit(focus, world.revision);
  render();
}
// The fold opens the first quest's details with its stack fanned beside it.
function toggleQuest() {
  if (selectionBlocked()) return;
  playQueue.clear();
  questOpen = false;
  questFresh = false;
  const first = questEntries()[0];
  if (first && !first.met) return pickQuest(first.quest);
  avatarFan = "quests";
  selectCards([currentActor(world)]);
  rowCollapsed = false;
  render();
}
// The quest shows when the avatar's stacks show.
const questShown = (quest) =>
  Boolean(quest) && expandedHolders.has(quest.actor);
// The folded quest is a card in the avatar's stack: the world's card back
// with a glowing line in its tier colour. The line pulses while a first
// quest is new or a met quest waits to be cleared and holds a steady halo
// while it is near. Once the quest card shows, the fold hides and the card
// glows instead.
function syncQuestFold(fold) {
  const quest = foldQuest();
  fold.hidden = questShown(quest);
  fold.style.setProperty(
    "--tier-color",
    (revealedQuests.has(questEntryKey(quest))
      ? questTier(quest, world, known)
      : questTier(quest)
    ).color,
  );
  fold.dataset.glow =
    sealedQuests.length || questFresh
      ? "invite"
      : !questCovered(quest) && questNear(world, quest)
        ? "near"
        : "none";
  const count = questEntries().length;
  const summary = [
    shownQuests.length && `${shownQuests.length} active quest${shownQuests.length === 1 ? "" : "s"}`,
    sealedQuests.length && `${sealedQuests.length} reward${sealedQuests.length === 1 ? "" : "s"} to claim`,
  ].filter(Boolean).join(", ");
  const caption = shownQuestCaption(sealedQuests[0] || quest);
  fold.dataset.count = String(count);
  fold.setAttribute(
    "aria-label",
    `${summary}: ${caption}. Open ${count > 1 ? "them" : "it"}.`,
  );
}
function questFold(quest) {
  const fold = node("button", undefined, "quest-fold");
  fold.type = "button";
  fold.style.setProperty("--card-back", cardBackImage());
  syncQuestFold(fold);
  fold.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleQuest();
  });
  return fold;
}
// The checked card stays until the saved world acknowledges its claim.
async function clearQuest(button, quest) {
  const pending = questClaims.get(quest.key);
  if (selectionBlocked() || (pending && !pending.uncertain)) return;
  const reward = pending || { quest, color: button.style.getPropertyValue("--tier-color"),
    box: button.getBoundingClientRect(), key: crypto.randomUUID() };
  questOpen = false;
  if (quest.receiptId === undefined) {
    sealedQuests = sealedQuests.filter((q) => q !== quest);
    render();
    return showQuestReward(reward);
  }
  const action = legalActions(world).find((a) =>
    a.kind === "claim" && a.actor === quest.actor && a.receipt === quest.receiptId);
  if (!action) return;
  reward.uncertain = false;
  questClaims.set(quest.key, reward);
  avatarFan = "quests";
  expandedHolders.add(quest.actor);
  rowCollapsed = false;
  renderedHand = "";
  render();
  try {
    while ((localWordsPending() || sleepView.active) && questClaims.get(quest.key) === reward)
      await new Promise((resolve) => setTimeout(resolve, 50));
    if (questClaims.get(quest.key) !== reward) return;
    if (sharedSession) await sharedSession.play(action, reward.key);
    else {
      const result = play(world, action, world.revision);
      if (!result.ok) throw new Error(result.error);
      const before = world;
      world = result.state;
      if (!save()) {
        world = before;
        throw new Error(UNSAVED_NOTICE);
      }
    }
    reward.accepted = true;
    notice("");
  } catch (error) {
    if (error.cause) reward.uncertain = true;
    else questClaims.delete(quest.key);
    notice(error.message);
  } finally {
    renderedHand = "";
    render();
  }
}
function showQuestReward({ quest, color, box }) {
  const gain = node("span", `+${quest.earnedXp} XP`, "quest-xp");
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
  count("quest.met");
  const avatar = $("hand").querySelector(`.card[data-card="${quest.actor}"]`);
  const level = quest.receiptId === undefined
    ? quest.level && quest.left <= 1 : quest.earnedLevel;
  if (level && avatar) void glowCard(avatar, color);
}
const showPreferredLocations = createPreferredLocationsView(
  $("stage"),
  $("stage-figures"),
  $("cast"),
);
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
  const brandName = document.querySelector(".brand span");
  brandName.textContent = worldName || "…";
  brandName.toggleAttribute("data-covered", !worldName);
  document.title = worldName ? `CosyWorld · ${worldName}` : "CosyWorld";
  const fraction = (value, fallback) => String((value ?? fallback) / 100);
  view.style.setProperty("--focus-x", fraction(stage.focus?.x, 50));
  view.style.setProperty("--focus-y", fraction(stage.focus?.y, 50));
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
  if (!stage.resident || cardIsCovered(stage.resident)) {
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
  // An image let go after it left the page is never freed (card-ghost.mjs).
  releaseImages(figure);
  figure.remove();
}
function leaveFigure(figure, remove = false) {
  if (exits.has(figure) || figure.dataset.settling) return;
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
  reviewing = false;
  reviewBeat = null;
  lineSeq = sharedSession ? sharedLineSeq : (exchange.current?.seq ?? null);
  syncSpeechPlayback();
  syncSharedLine();
  renderScene();
  if (!$("dialogue-advance").hidden) $("dialogue-advance").focus();
}
const litCarried = (actor) =>
  Object.keys(world.items).find(
    (id) =>
      world.items[id].lit &&
      rootHolder(world, id) === actor &&
      !cardIsCovered(id),
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
        if (stageReveals.delete(id))
          fadeInRevealed(prop, { reduced: reducedMotion.matches });
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
  const visibleText = coveredTextReader(world, cardIsCovered);
  sleepView.observe(world, currentActor(world));
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
  scene.slots = revealedStage({ cast: sceneCast(world) }, cardIsCovered).cast;
  // A place still face down is black behind whoever is revealed.
  $("stage").dataset.placeCovered = String(cardIsCovered(scene.locationId));
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
  // A wake fades on the old light and cuts to the new one under the black.
  const sleepLight = sleepView.light(view.turn);
  if (!sleepLight.hold)
    crossfadeImage(img, background, {
      duration:
        !stayed || sleepLight.cut || reducedMotion.matches
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
  // A painted night already carries its own dark; stage-light.json gives a
  // place its own share and lights, such as the attic's lamp. A place with
  // no night painting takes the full night grade, cooled.
  const authored = placeLight(scene.locationId);
  renderStageLight($("stage"), {
    turn: sleepLight.turn,
    strength: gradeStrength({
      grade: authored.grade,
      painted: Boolean(scene.daylight),
      night: isNight({ turn: sleepLight.turn }),
    }),
    tint: scene.daylight ? null : UNPAINTED_NIGHT_TINT,
    pools: (authored.lights || []).map((pool) => ({
      ...pool,
      on: !pool.item || lampLitHere(view, scene.locationId),
    })),
    sky: authored,
    ease: stayed && !sleepLight.cut,
  });
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
    preferredCatalog: {
      ...coreLocations.places,
      ...greekLocations.places,
      ...worldLocations.places,
    },
  });
  renderFloorItems(revealedStage(staging, cardIsCovered).floorItems);
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
        if (stageReveals.delete(id))
          fadeInRevealed(figure, { reduced: reducedMotion.matches });
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
    const sleeping = actor.pose === "sleep";
    const figure = $("cast").children[index];
    if (
      figure.dataset.removing ||
      (exits.has(figure) && actor.presence !== "departed")
    ) {
      // A returning actor keeps this figure after its earlier farewell.
      exits.delete(figure);
      delete figure.dataset.removing;
      delete figure.dataset.settling;
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
      sleeping
        ? null
        : (id === currentActor(world) && handItem) || litCarried(id),
    );
    figure.classList.toggle(
      "active",
      !sleeping && scene.activeSpeaker === id && !resolvedBeat,
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
  showPreferredLocations(staging.actors);
  // A reveal off stage (a place card, someone elsewhere) fades nothing later.
  stageReveals.clear();
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
  // Only show shared lines this reader has reached.
  const liveThrough = sharedSession
    ? (sharedLineSeq ?? sharedLineStart ?? -Infinity)
    : exchange.active
      ? (exchange.current?.seq ?? -Infinity)
      : Infinity;
  const hiddenSpeech = (line) =>
    sleepView.hidesLine(line) ||
    (line.seq > liveThrough && (shared || line.turn === world.turn));
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
  const hiddenAction = (entry) =>
    (moreToRead && entry.turn > shownTurn) ||
    // A zero-turn change joins the stack after the reply being read.
    // Its caption must leave that reply's Continue control in front.
    (!sharedSession && exchange.current && entry.seq > liveThrough);
  const waiting = sharedSession
    ? sharedSpeech.status === "pending" && sharedLineSeq === null
    : Boolean(
        exchange.preparing || (storyStatus === "pending" && !exchange.current),
      );
  const scened = sceneBeats(view, {
    viewer,
    shared,
    held: combatHeld,
    hiddenSpeech,
    hiddenAction,
  });
  // Every play in flight is one Thinking card, once the lines before it
  // are read: a line being written stays in front.
  const last = scened.findLast((beat) => beat.line)?.line;
  const lineFirst = sharedSession
    ? moreToRead || (last?.seq === sharedLineSeq && !sharedAdvanceRequested)
    : Boolean(exchange.current) && (!exchange.read || exchange.hasNext);
  const own = ownPlayInFlight();
  const stack = withPending(scened, {
    // A committed local play waits through its own exchange.
    speakerId:
      waiting || (own && !lineFirst && (sharedSession || !own.committed))
        ? waitingSpeaker || viewer
        : null,
    turn: world.turn,
  });
  // A level quest's dream is a beat after the wake, in front while it plays.
  const dreaming = sleepView.dream();
  const dreamt = withDream(stack.beats, dreaming?.beat, {
    front: dreaming?.front,
  });
  const beats = dreamt.beats.map((beat) => revealedBeat(beat, visibleText));
  const pendingCard = !dreaming?.front &&
    stack.pending && {
      ...revealedBeat(stack.pending, visibleText),
      // Its two taps cancel the player's own play.
      own: stack.pending.speakerId === viewer || !sharedSession ? own : null,
    };
  const liveIndex = pendingCard ? beats.length : beats.length - 1;
  let frontIndex = -1;
  if (reviewing) {
    frontIndex = beats.findIndex((beat) => beat.key === reviewBeat);
    if (frontIndex < 0 && lineSeq !== null)
      frontIndex = beats.findIndex((beat) => beat.line?.seq === lineSeq);
  }
  if (frontIndex < 0) frontIndex = dreamt.front >= 0 ? dreamt.front : liveIndex;
  const front =
    frontIndex === beats.length ? pendingCard : beats[frontIndex] || null;
  const behind = frontIndex > 0 ? beats[frontIndex - 1] : null;
  const behindLive = reviewing && (frontIndex < liveIndex || choiceInStack());
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
  releaseGhosts($("speech-row").parentElement);
  const stepping = direction === "forward" || direction === "back";
  const ghost = {
    behind:
      (direction === "forward" || (stepping && reducedMotion.matches)) &&
      !$("beat-behind").hidden
        ? stackGhost($("beat-behind"))
        : null,
    front: stepping && !$("speech-row").hidden ? frontGhost(direction) : null,
  };
  // The stack clearing fades out over 200 ms: the whole panel when nothing
  // else stays in it, else the front card.
  if (!front && !$("speech-row").hidden)
    fadeGhost(
      fixedGhost(
        document.querySelector(".action-panel").hidden
          ? document.querySelector(".dialogue")
          : $("speech-row"),
      ),
      {},
      STACK_CLEAR_MS,
    );
  stackRendered = {
    key: frontKey,
    speaker: front?.speakerId ?? null,
    place: scene.locationId,
  };
  const line = front?.line || null;
  shownSceneLine = line;
  const text = line ? line.text : "";
  $("speaker").textContent = visibleText(
    front
      ? line?.speaker || front.label ||
        (front.speakerId ? nameOf(front.speakerId) : "")
      : "",
  );
  const ownFront = behindLive ? null : front?.own || null;
  if (!ownFront?.cancel) disarmThinking(false);
  // The Thinking chip belongs to the Thinking card, never to a line.
  $("story-status").hidden = !front?.pending || behindLive;
  // A dream being written is the same card, "Dreaming…" (dream-card.mjs).
  $("story-status").lastElementChild.textContent = front?.dream
    ? DREAMING_LABEL
    : "Thinking…";
  $("story-status").dataset.armed = String(
    front?.dream ? front.armed : thinkingArmed,
  );
  $("story-status").setAttribute(
    "aria-label",
    front?.dream ? "Dreaming" : "Thinking about this scene",
  );
  $("speech-row").setAttribute("aria-busy", String(!$("story-status").hidden));
  const ownAction =
    front &&
    !front.line &&
    !front.pending &&
    !front.dream &&
    front.actions.some((action) => action.seq === front.anchor) &&
    view.log.find(
      (entry) =>
        entry.seq === front.anchor &&
        entry.kind === "action" &&
        entry.actorId === front.speakerId,
    );
  const hiddenActor = ownAction && hiddenFor(world, viewer)?.id;
  const actionView =
    ownAction &&
    actionScene(
      ownAction,
      (id) =>
        id !== hiddenActor &&
        !cardIsCovered(id) &&
        !(things[id] && covered(world, id)),
    );
  const portraitId = (ownAction ? actionView?.actor : front?.speakerId) || null;
  const portraitBox = $("speaker-portrait");
  // Key on the resolved art too, so a changed pose, scarf or backdrop repaints.
  const portraitSource = beatPortrait(portraitId);
  const portraitKey = JSON.stringify([
    portraitSource,
    actionView,
    actionView?.here && placeArt(actionView.here),
    actionView && beatPortrait(actionView.to || actionView.target),
  ]);
  if (
    portraitBox.dataset.entity !== (portraitId || "") ||
    portraitBox.dataset.source !== portraitKey
  ) {
    portraitBox.dataset.entity = portraitId || "";
    portraitBox.dataset.source = portraitKey;
    releaseImages(portraitBox);
    portraitBox.replaceChildren();
    if (actionView) {
      portraitBox.dataset.kind = "action";
      portraitBox.append(questScreen(actionView, questArt));
    } else if (portraitId) {
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
  const captionKey = JSON.stringify([front?.key, front?.actions || []]);
  // Effects added to the same card are inscribed onto it, even when a
  // Thinking card stood in front for a moment.
  const kept =
    shownCaptions.key === front?.key ? shownCaptions.count : Infinity;
  if (front && !front.pending)
    shownCaptions = { key: front.key, count: front.actions.length };
  if (captions.dataset.key !== captionKey) {
    captions.dataset.key = captionKey;
    for (const item of captions.children) finishInscribing(item);
    captions.replaceChildren(
      ...(front?.actions || []).map((action, index) => {
        const item = node("span", undefined, "beat-caption");
        item.dataset.kind = action.kind;
        item.toggleAttribute(
          "data-primary",
          !front.line &&
            !front.pending &&
            !front.dream &&
            action.seq === front.anchor,
        );
        item.toggleAttribute(
          "data-named",
          action.text.startsWith(`${nameOf(front.speakerId)} `),
        );
        item.append(beatIcon(action.icon), namedSpan(action.text));
        const key = JSON.stringify([action.seq, action.text]);
        if (
          index >= kept ||
          (!text && !front.pending && !reviewing && !seenCaptions.has(key))
        )
          inscribe(item, action.text);
        seenCaptions.add(key);
        return item;
      }),
    );
    while (seenCaptions.size > 200)
      seenCaptions.delete(seenCaptions.values().next().value);
  }
  captions.hidden = !front?.actions.length;
  const showFront = Boolean(front);
  document.querySelector(".dialogue").dataset.behind = String(Boolean(behind));
  $("speech-row").hidden = !showFront;
  syncDialogueShown();
  if (front?.dream)
    $("speech-row").style.setProperty("--tier-color", DREAM_TIER.color);
  else $("speech-row").style.removeProperty("--tier-color");
  paintGlimpse($("speech-row").parentElement, front?.companion ?? null, {
    artOf: beatPortrait,
    nameOf: (id) => visibleText(nameOf(id)),
    icon: beatIcon,
  });
  $("speech-row").dataset.beat = front?.dream
    ? "dream"
    : front?.line
      ? front.silent
        ? "silent"
        : "speech"
      : front?.pending
        ? "pending"
        : "action";
  $("dialogue-text").hidden = !text;
  $("dialogue-advance").hidden =
    !text && !front?.actions.length && !ownFront?.cancel && !sleepView.dreamTap;
  $("speech-hint").hidden = true;
  if (text) {
    const speaker = line.entityId || line.actorId || scene.locationId;
    const key = lineKey(line, scene.locationId);
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
        ? `${visibleText(nameOf(front.speakerId))}: ${frontCaptions.join(" ")}`
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
  // A hidden card runs no animation, so its motion would never end.
  if (!behind) delete behindButton.dataset.motion;
  if (behind) {
    const summary = beatSummary(behind);
    summary.speaker = visibleText(summary.speaker);
    const behindKey = JSON.stringify([
      behind.key,
      summary.text,
      summary.speaker,
      behind.speakerId,
      beatPortrait(behind.speakerId),
    ]);
    if (behindButton.dataset.key !== behindKey) {
      behindButton.dataset.key = behindKey;
      fillPortrait(
        behindButton.querySelector(".beat-behind-portrait"),
        behind.speakerId,
      );
      const words = behindButton.querySelector(".beat-behind-text");
      const first = behind.actions.at(-1);
      const caption = node("span", undefined, "beat-behind-caption");
      if (first) caption.append(beatIcon(first.icon), namedSpan(first.text));
      if (first && behindButton.dataset.beatKey === behind.key)
        inscribe(caption, first.text);
      behindButton.dataset.beatKey = behind.key;
      words.replaceChildren(
        node("strong", summary.speaker),
        ...(summary.speech
          ? [
              Object.assign(namedSpan(summary.speech), {
                className: "beat-behind-speech",
              }),
            ]
          : []),
        ...(first ? [caption] : []),
      );
      behindButton.dataset.beat = behind.line ? "speech" : "action";
    }
    behindButton.setAttribute(
      "aria-label",
      `Step back to ${summary.speaker}: ${summary.speech || behind.actions.at(-1)?.text || ""}`,
    );
  }
  if (sharedSession) renderRoomStatus(sharedSession);
  animateStack(direction, ghost);
  syncPhase();
}
// The main action uses the dialogue's pace. Added effects write in 300 to
// 900 ms. A tap finishes the card; reduced motion shows it at once.
function inscribe(item, text) {
  if (reducedMotion.matches) return;
  const words = node("span"),
    glyphs = letterSpans(text);
  words.append(...glyphs);
  nameLetters(glyphs, text, sceneCards());
  item.lastChild.replaceWith(words);
  const beat = Math.min(900, Math.max(300, text.length * 20)) / glyphs.length;
  const painter = createRevealPainter(words, { caret: false });
  const pen = createTextReveal({
    delay: item.hasAttribute("data-primary") ? undefined : () => beat,
    frame(value) {
      painter.paint(value);
      if (!value.complete || !inscribing.has(item)) return;
      item.classList.remove("inscribe");
      inscribing.delete(item);
      updateSpeechControls(reveal.complete);
      syncPhase();
    },
  });
  item.classList.add("inscribe");
  inscribing.set(item, pen);
  painter.start(glyphs);
  pen.show(text, text, null);
  queueMicrotask(syncPhase);
}
function finishInscribing(only) {
  for (const item of only ? [only] : [...inscribing.keys()])
    inscribing.get(item)?.finish();
}
// A line's reveal key, so a line read once stays whole.
const lineKey = (line, place) =>
  JSON.stringify([line.seq, line.entityId || line.actorId || place, line.text]);
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
  if (!id || cardIsCovered(id) || (things[id] && covered(world, id))) return "";
  return imageUrl(
    people[id]
      ? portrait(id, null, world)
      : places[id]
        ? placeArt(id)
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
  STACK_FADE_MS = 160,
  STACK_NEARER = "translateY(8px) scale(1.015)";
// A leaving card is an inert copy (card-ghost.mjs).
function stackGhost(card) {
  const ghost = ghostOf(card);
  card.after(ghost);
  return ghost;
}
// The old front card keeps its exact box, so its words do not reflow. Going
// forward it settles behind the new card; going back, or crossfading for
// reduced motion, it leaves over it.
const STACK_CLEAR_MS = 200;
function frontGhost(direction) {
  const under = direction === "forward" && !reducedMotion.matches;
  return pinGhost($("speech-row"), under ? "1" : "3");
}
// Cards move in depth with transform and opacity; reduced motion crossfades.
// The front and behind cards are hit-tested buttons, so their motion is a CSS
// animation named by data-motion rather than element.animate(): after a modal
// dialog closes, Chromium can resolve a Web Animation's target from a style
// cached while the page was inert, and the card stops taking clicks.
function playMotion(card, motion) {
  delete card.dataset.motion;
  if (!motion) return;
  // Restyling the card ends the old motion; no layout is needed for that.
  void getComputedStyle(card).animationName;
  card.dataset.motion = motion;
}
for (const id of ["speech-row", "beat-behind", "action-beat"]) {
  const card = $(id),
    settle = (event) => {
      if (event.target === card) delete card.dataset.motion;
    };
  card.addEventListener("animationend", settle);
  card.addEventListener("animationcancel", settle);
}
// A ready or pending play, or words the player must see, are a beat in
// front of the dialogue. The spoken beat settles behind it and comes back
// forward when it leaves; reduced motion crossfades. The hand never moves.
function syncDialogueShown() {
  document.querySelector(".dialogue").hidden =
    $("speech-row").hidden && document.querySelector(".action-panel").hidden;
  syncLayering();
}
function choiceInStack() {
  return (
    !borrowedBeat &&
    shownPhase === "choosing" &&
    ($("card-actions").childElementCount > 0 ||
      !document.querySelector(".action-beat-heading").hidden)
  );
}
function choiceInFront() {
  return choiceInStack() && !reviewing && !$("action-beat").hidden;
}
function syncLiveBeat() {
  const { liveIndex, frontIndex } = stackView;
  // One live control, only while behind live, counting the newer beats.
  const newer = Math.max(0, liveIndex + Number(choiceInStack()) - frontIndex);
  const liveButton = $("live-line");
  liveButton.hidden = !reviewing || !newer;
  liveButton.dataset.live = String(liveButton.hidden);
  liveButton.querySelector(".beat-live-count").textContent = newer
    ? ` · ${newer}`
    : "";
  liveButton.title = newer
    ? `Return to live dialogue · ${newer} newer`
    : "Return to live dialogue";
  liveButton.setAttribute("aria-label", liveButton.title);
}
function showLiveChoice() {
  returnToLive();
  renderActions();
  if (choiceInStack())
    $("card-actions").querySelector("button:enabled")?.focus();
}
$("live-line").onclick = showLiveChoice;
document.querySelector(".dialogue").addEventListener(
  "click",
  (event) => {
    if (!event.target.closest("#speech-row")) return;
    if (sleepView.dreamTap !== null) {
      event.stopPropagation();
      if (sleepView.dreamTap) sleepView.tap();
      return;
    }
    if (!choiceInFront()) return;
    event.stopPropagation();
    stepBack();
  },
  true,
);
// A tall action can reach above the stack's fixed box. Keep the previous
// card one peek above the action's actual top so it can still take taps.
function placePreviousBeat() {
  const panel = $("action-beat"),
    front = $("speech-row");
  front.style.removeProperty("--beat-slot");
  if (panel.hidden || front.hidden) return;
  const overlap = front.offsetTop - panel.offsetTop;
  if (overlap > 0)
    front.style.setProperty(
      "--beat-slot",
      `translateY(calc(-1 * var(--beat-peek) - ${overlap}px)) scale(var(--beat-behind-scale))`,
    );
}
new ResizeObserver(placePreviousBeat).observe($("action-beat"));
let dialogueResizeFrame = 0,
  dialogueSize = 0;
new ResizeObserver(([entry]) => {
  dialogueSize = entry.contentRect.height;
  if (dialogueResizeFrame) return;
  // Let this measurement finish before it changes the hand and dock sizes.
  dialogueResizeFrame = requestAnimationFrame(() => {
    dialogueResizeFrame = 0;
    setStyle(document.body.style, "--dialogue-size", `${dialogueSize}px`);
  });
}).observe(document.querySelector(".dialogue"));
function syncActionBeat() {
  const panel = document.querySelector(".action-panel"),
    front = $("speech-row"),
    show =
      Boolean(borrowedBeat) ||
      ((choiceInStack() || $("card-actions").childElementCount > 0) &&
        !reviewing) ||
      (!$("play-status").hidden && shownPhase !== "revealing");
  // A notice before the first render (storage refused) only shows the beat.
  const drawn = Boolean(document.body.dataset.handExpanded);
  if (drawn) {
    syncLiveBeat();
    if (show && choiceInStack())
      $("dialogue-advance").setAttribute("aria-label", "Step back in dialogue");
    else if (!panel.hidden) updateSpeechControls(reveal.complete);
  }
  if (panel.hidden !== show) return;
  if (!drawn) {
    panel.hidden = !show;
    panel.parentElement.dataset.action = String(show);
    panel.parentElement.hidden &&= !show;
    return;
  }
  const still = reducedMotion.matches,
    moves = panel.parentElement.dataset.dropped !== "true";
  const ghost =
    moves && (show ? still && !front.hidden && front : panel)
      ? pinGhost(show ? front : panel, "4")
      : null;
  if (ghost && !show) {
    // The stack keeps its foot as it shrinks, and the leaving copy must
    // not hold the spoken beat behind it.
    ghost.style.top = "auto";
    ghost.style.bottom = `${panel.parentElement.clientHeight - panel.offsetTop - panel.offsetHeight}px`;
    ghost.classList.remove("action-panel");
  }
  panel.hidden = !show;
  panel.parentElement.dataset.action = String(show);
  syncDialogueShown();
  placePreviousBeat();
  if (!moves) return;
  if (still) return fadeGhost(ghost, {}, STACK_FADE_MS);
  playMotion(panel, show ? "arrive" : null);
  if (!front.hidden) playMotion(front, show ? "settle" : "return");
  // A play folds into the stream: once this render has drawn the beat it
  // became, the box eases down onto that front card as it fades. A cancelled
  // play just leaves.
  if (!show && restedChoice !== null) queueMicrotask(() => foldGhost(ghost));
  else fadeGhost(ghost, { transform: STACK_NEARER }, STACK_LEAVE_MS);
}
function foldGhost(ghost) {
  const front = $("speech-row");
  if (front.hidden)
    return fadeGhost(ghost, { transform: STACK_NEARER }, STACK_LEAVE_MS);
  const from = ghost.getBoundingClientRect(),
    to = front.getBoundingClientRect();
  ghost.style.transformOrigin = "0 0";
  fadeGhost(
    ghost,
    {
      transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`,
    },
    STACK_MS,
  );
}
function animateStack(direction, ghost) {
  const front = $("speech-row"),
    behind = $("beat-behind");
  if (!direction || front.hidden) {
    releaseGhost(ghost.front);
    releaseGhost(ghost.behind);
    return;
  }
  const showBehind = !behind.hidden;
  // Reduced motion turns off CSS animation, so the old cards' copies fade
  // out over the new ones instead. Behind the action beat the one dimmed
  // line crossfades as it steps.
  const behindAction = front.parentElement.dataset.action === "true";
  if (behindAction && !reducedMotion.matches) playMotion(front, "fade");
  if (reducedMotion.matches || behindAction) {
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
  const nearer = STACK_NEARER;
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
  finishInscribing();
  const { beats, frontIndex } = stackView;
  const beat =
    beats[Math.min(beats.length - 1, frontIndex - Number(!choiceInFront()))];
  if (!beat) return false;
  count("scrollback.open");
  reviewing = true;
  syncSpeechPlayback();
  reviewBeat = beat.key;
  if (beat.line) lineSeq = beat.line.seq;
  renderScene();
  return true;
}
function stepForward() {
  if (!reviewing) return false;
  const next = stackView.frontIndex + 1;
  if (
    next > stackView.liveIndex ||
    (next === stackView.liveIndex &&
      (!choiceInStack() || !stackView.beats[next]))
  ) {
    showLiveChoice();
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
    count("line.finish_early");
    reveal.finish();
    speechSounds.stop();
    return;
  }
  if (stepForward()) return;
  if (exchange.current || (sharedSession && shownSceneLine)) {
    if (replyPending() || sharedAdvanceRequested) return;
    count("line.skip");
    characterSpeech.stop();
    syncSpeechPlayback();
    finishSpokenLine();
    if (sharedSession) {
      if (!sharedNextLine(sharedSession.state, shownSceneLine.locationId, shownSceneLine.seq))
        queuedChoice = false;
      sharedAdvanceRequested = true;
      syncSharedLine();
      renderActions();
    } else exchange.advance();
    updateSpeechControls(reveal.complete);
  }
}
$("speech-row").addEventListener(
  "click",
  (event) => {
    const { pending, frontIndex, liveIndex } = stackView;
    if (!pending?.own || frontIndex !== liveIndex) return;
    event.stopPropagation();
    tapThinking();
  },
  true,
);
document.addEventListener(
  "pointerdown",
  (event) => {
    if (thinkingArmed && !event.target.closest?.("#speech-row"))
      disarmThinking();
  },
  true,
);
$("beat-behind").onclick = stepBack;
// The portrait, name and words share the same advance control.
$("speech-row").addEventListener(
  "click",
  (event) => {
    if (inscribing.size) {
      event.stopPropagation();
      return finishInscribing();
    }
    if (event.target.closest("#voice-retry")) return;
    advanceFront();
  },
  true,
);
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
  // A chosen hand card or the action beat's buttons step the stack too.
  if (target !== document.body && !target.closest?.(".dialogue, #hand")) return;
  const moved = event.key === "ArrowUp" ? stepBack() : stepForward();
  if (moved) event.preventDefault();
});
{
  const stackBox = document.querySelector(".dialogue");
  let wheelAt = 0;
  stackBox.addEventListener(
    "wheel",
    (event) => {
      // A sideways scroll of the hand never steps the stack.
      if (Math.abs(event.deltaY) < 4) return;
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
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
// Memory is opened on purpose: the avatar's inner life (I'm, I'm becoming,
// I dream), then every remembered visit, newest first, as the same beats the
// stack shows. Closed, it holds no portraits at all.
function renderLog(open = $("history-dialog").open) {
  const box = $("messages");
  if (!open) {
    releaseImages(box);
    box.replaceChildren();
    renderedMemory = "";
    return;
  }
  const visibleText = coveredTextReader(world, cardIsCovered);
  const visits = memoryVisits(shownWorld(), {
    viewer: currentActor(world),
    shared: Boolean(sharedSession),
    held: combatHeld,
  }).map((visit) => ({
    ...visit,
    beats: visit.beats.map((beat) => revealedBeat(beat, visibleText)),
  }));
  const chain = innerLifeChain(world);
  const inner = {
    ...chain,
    im: visibleText(chain.im),
    becoming: chain.becoming.map(visibleText),
    dreams: chain.dreams.map(visibleText),
  };
  const key = JSON.stringify([
    inner,
    ...visits.map((visit) => [
      visit.key,
      visibleText(nameOf(visit.placeId)),
      visit.beats.map((beat) => [
        beat.key,
        beat.line?.text,
        beat.actions.map((action) => action.text),
      ]),
    ]),
  ]);
  if (key === renderedMemory) return;
  renderedMemory = key;
  box.replaceChildren(
    innerLifeSection(inner),
    ...visits.map((visit) => {
      const section = node("section", undefined, "memory-visit");
      section.append(
        node("h3", visibleText(nameOf(visit.placeId)), "memory-place"),
      );
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
          node(
            "div",
            visibleText(beat.line?.speaker || nameOf(beat.speakerId)),
            "speaker",
          ),
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

// A card responds to a moved pointer. A new deal clears that hover so a
// resting mouse leaves the newly centred hand settled.
const hoverCard = (event) => {
  if (event.pointerType !== "mouse") return;
  for (const card of document.querySelectorAll('.card[data-hovered="true"]'))
    delete card.dataset.hovered;
  const card = event.target.closest(".card");
  if (card) card.dataset.hovered = "true";
};
for (const id of ["hand", "settings-hand"]) {
  $(id)?.addEventListener("pointermove", hoverCard);
  $(id)?.addEventListener("pointerleave", () => {
    for (const card of $(id).querySelectorAll('.card[data-hovered="true"]'))
      delete card.dataset.hovered;
  });
}
function render() {
  if (questOpen && !questVisible(world, shownQuests[questPick])) questOpen = false;
  for (const card of document.querySelectorAll('.card[data-hovered="true"]'))
    delete card.dataset.hovered;
  showWorldTier(world, worldLogoKey(location.href));
  renderPlayers();
  music.setStarted(musicHasStarted());
  syncMusicCue();
  // An open standoff in the player's room holds the painting back too.
  recedeBackdrop(
    $("stage"),
    "standoff",
    battleMusicDue(world, currentActor(world)),
    { instant: covering },
  );
  hum.setStarted(musicHasStarted());
  ringHeard();
  // While the travel veil comes down, the old place stays drawn.
  if (covering) return;
  sleepView.observe(world, currentActor(world));
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
      if (people[id] || id === placeHere()) expandedHolders.add(id);
    }
  if (rowCollapsed || waysOpen !== placeHere()) waysOpen = null;
  // Folding the avatar's stacks folds its fan and lowers a chosen quest.
  if (!expandedHolders.has(currentActor(world))) {
    avatarFan = null;
    questOpen = false;
  }
  // The quests the rules met since the last look stay, sealed, until cleared.
  const liveQuests = questCards(world);
  const dealtQuest = liveQuests.find(
    (quest) => questVisible(world, quest) && !shownQuests.some((shown) => shown.key === quest.key),
  );
  const legacy = sharedSession &&
    Number(sharedSession.state.version?.split("/")[1]) < 109;
  const receipts = questRewardCards(world);
  const met = legacy
    ? questSeq !== null && world.eventSeq > questSeq
      ? metQuests(shownQuests, world, questSeq) : []
    : receipts.filter((q) => !sealedQuests.some((shown) => shown.key === q.key));
  sealedQuests = legacy ? [...met, ...sealedQuests] : receipts;
  for (const [key, reward] of questClaims) {
    if (reward.quest.actor !== currentActor(world)) {
      questClaims.delete(key);
      continue;
    }
    if (sharedSession?.state.queue?.some((q) => q.id === reward.key)) {
      reward.accepted = true;
      reward.uncertain = false;
    }
    if (!receipts.some((q) => q.key === key)) {
      questClaims.delete(key);
      queueMicrotask(() => showQuestReward(reward));
    } else if (reward.accepted && !sharedSession?.state.queue?.some((q) => q.id === reward.key)) {
      questClaims.delete(key);
    }
  }
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
  const handCards = chosenFirst(
    questHand(
      pipPrelude() ? ["moth"] : stackPlaces(availableCards(world)),
      world,
      pickedFirst(questEntries().map((entry) => entry.id)),
    ),
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
    avatarFan,
    waysOpen,
  ]);
  if (handKey !== renderedHand) {
    // The hand a page or a new game opens on is already dealt.
    // A hand away after a loss lets the old cards go unseen.
    if (document.body.dataset.handAway) quietExits = true;
    const opening = renderedHandPlace === null;
    const sameWorld =
        renderedHand &&
        renderedHandRevision === world.revision &&
        renderedHandState === handState,
      // A redraw from a shared update or another tab is no arrival: the
      // hand keeps its scroll unless the player's avatar changed place,
      // and its cards still slide to their new places.
      stayed = renderedHandPlace === world.actors[currentActor(world)].place,
      samePlace = stayed,
      arriving = renderedHandPlace !== null && !stayed,
      here = world.actors[currentActor(world)].place,
      scene = `${here}:${lampLitHere(world, here)}`,
      sceneChanged = !opening && !quietExits && renderedScene !== scene,
      swapping = sceneChanged && !reducedMotion.matches,
      animate = (samePlace || swapping) && !reducedMotion.matches,
      exits = !opening && !quietExits && !reducedMotion.matches,
      before = new Map(),
      swap = swapping
        ? (swapFrom ?? { at: performance.now(), left: 0, fallen: 0 })
        : null;
    quietExits = false;
    renderedScene = scene;
    swapFrom = null;
    // Quest frames are keyed by their quest, not their place in the
    // stack, so a reorder moves each from its own last spot (#2295).
    const dealtBefore = new Set();
    let questBefore = null;
    if (animate)
      for (const frame of $("hand").children) {
        const key = motionKey(frame);
        if (frame.dataset.want) dealtBefore.add(key);
        if (frame.hidden) continue;
        const rect = frame.getBoundingClientRect(),
          at = { left: rect.left, top: rect.top };
        if (frame.dataset.want) questBefore = at;
        before.set(key, at);
      }
    for (const motion of handMotions.values()) motion.cancel();
    handMotions.clear();
    const wasExpanded = document.body.dataset.handExpanded;
    renderedHand = handKey;
    renderedHandRevision = world.revision;
    renderedHandPlace = world.actors[currentActor(world)].place;
    renderedHandState = handState;
    if (sameWorld) {
      const shown = [...$("hand").children].filter((frame) => !frame.hidden);
      for (const frame of $("hand").children) updateCardSelection(frame);
      // A stack folding shows its cards folding away (card-exit.mjs).
      foldCards(
        shown.filter((frame) => frame.hidden && frame.isConnected),
        handExits(),
        reducedMotion.matches,
      );
    } else {
      // A card still in the hand keeps its node (card-keep.mjs).
      const row = [...$("hand").children],
        { frames, changed, faces } = keepFrames(
          row,
          handCards.map((id) =>
            isQuestId(id) ? questFrame(questEntry(id)) : card(id),
          ),
        ),
        leaving = exits
          ? leavingFrames(
              row.filter((frame) => !frame.dataset.gone),
              frames,
            )
          : [];
      // A card gone from view falls from where it lay, while the hand
      // redraws at once; a reveal keeps its card, so it never falls.
      if (swap) {
        const since = performance.now() - swap.at,
          { exits: steps, faceAt } = swapTiming(swap.left + leaving.length),
          wait = (ms) => Math.max(0, ms - since),
          late = steps.slice(swap.left).map(wait);
        dropCards(
          nearestFirst(leaving, row, currentActor(world)),
          handExits(),
          late,
        );
        // Exits the redraw starts late end late; entries wait for them.
        if (late.length)
          swap.fallen = Math.max(swap.fallen, since + late.at(-1) + EXIT_MS);
        // A face changed with the light fades; one that moves just moves.
        if (stayed && faces.length) fadeFaces(faces, handExits(), wait(faceAt));
      } else if (leaving.length) dropCards(leaving, handExits());
      for (const [was, now] of changed) morphFrame(was, now);
      $("hand").replaceChildren(...frames);
      if (swap) swap.left += leaving.length;
    }
    // Lean the new row before measuring it, so each card moves from where
    // it was to its fanned place.
    fanHand();
    $("hand").scrollLeft = stayed ? scroll : 0;
    // A thing taken or received by the player's own play is in their hand
    // at once: the row keeps its scroll, so the card would land out of view
    // beside its new holder. Scrolled now, before the row's moves are
    // measured, it slides from where it lay into view.
    if (receivedCard) {
      revealHandCard(receivedCard, { instant: true });
      receivedCard = null;
    }
    renderActions();
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
    if (arriving) revealHandCard(renderedHandPlace, { instant: true });
    // A scene change's new cards rise after the old ones fall and a beat.
    const entering = (count) => {
      const timing = swapTiming(swap.left, count, swap.fallen);
      swapEnd = swap.at + timing.end;
      afterDeadline(
        () => swapEnd,
        () => playQueue.flush(),
      );
      return Math.max(0, swap.at + timing.entryAt - performance.now());
    };
    if (sceneChanged && reducedMotion.matches)
      $("hand").animate({ opacity: [0, 1] }, { duration: SWAP_REDUCED_MS });
    // A card new to the view rises in; one seen moving keeps that move.
    const rising = handEntries.draw(
      [...$("hand").children]
        .filter((frame) => !frame.dataset.want)
        .map((frame) => ({
          key: entryKey(frame),
          element: frame,
          still:
            frame.hidden ||
            before.has(frame.querySelector(".card").dataset.card),
        })),
      // The hand a page, a resumed save or a new game opens on is dealt.
      { reduced: reducedMotion.matches, after: swap ? entering : 0 },
    );
    showQuests(opening);
    // A new quest rises where the player can see its slot in the hand.
    if (met.length) revealHandCard(questId(0, true), { instant: true });
    else if (dealtQuest && !opening)
      revealHandCard(`quest:${dealtQuest.index}`, { instant: true });
    openLockedBoxes();
    // Every new place is measured before any card starts moving, so the
    // row is laid out once rather than once per card.
    const moves = [];
    if (animate)
      for (const frame of $("hand").children) {
        if (frame.hidden) continue;
        const id = motionKey(frame);
        // A quest newly dealt rises in its own slot. One shown as its
        // stack fans comes from the last quest in view, or, when the
        // holder's stack opens, from behind the holder.
        if (frame.dataset.want && !before.has(id) && !dealtBefore.has(id)) {
          riseIn(frame);
          continue;
        }
        const previous =
          before.get(id) ||
          (frame.dataset.want && questBefore) ||
          before.get(frame.dataset.holder);
        if (!previous || (!frame.dataset.want && rising.has(entryKey(frame))))
          continue;
        moves.push({
          id,
          frame,
          previous,
          next: frame.getBoundingClientRect(),
        });
      }
    // A card's name label sits at its top (card-label.mjs), so it moves
    // with its card and never slides on its own.
    for (const { id, frame, previous, next } of moves) {
      const dx = previous.left - next.left,
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
    }
  }
  // After a loss the new hand is dealt in as the black lifts; the old one
  // never shows again.
  if (document.body.dataset.handAway && !covering) {
    delete document.body.dataset.handAway;
    dealHand();
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
function revealHandCard(id, { instant = false, nextFrame = null } = {}) {
  const hand = $("hand"),
    frame = hand
      .querySelector(`[data-card="${id}"], [data-quest-id="${id}"]`)
      ?.closest(".card-frame");
  if (!frame || frame.hidden) return;
  const last = nextFrame ?? frame,
    left = frame.offsetLeft - hand.offsetLeft,
    right = last.offsetLeft - hand.offsetLeft + last.offsetWidth,
    // Keep the revealed card clear of the faded edges.
    margin = Math.max(
      16,
      parseFloat(getComputedStyle(hand).getPropertyValue("--hand-fade")) || 0,
    ),
    visibleLeft = hand.scrollLeft + margin,
    visibleRight = hand.scrollLeft + hand.clientWidth - margin;
  const target =
    left < visibleLeft
      ? left - margin
      : right > visibleRight
        ? right - hand.clientWidth + margin
        : hand.scrollLeft;
  hand.scrollTo({
    // Keep the place in view when its first item cannot fully fit beside it.
    left: nextFrame ? Math.min(target, left - margin) : target,
    behavior: instant || reducedMotion.matches ? "instant" : "smooth",
  });
}
// The fan: each shown card leans by its distance from the row's middle.
function fanHand() {
  const shown = [...$("hand").children].filter((frame) => !frame.hidden);
  shown.forEach((frame, i) =>
    setStyle(frame.style, "--fan-at", String(i - (shown.length - 1) / 2)),
  );
}
// A style set only when it changes, so an unchanged hand needs no new layout.
function setStyle(style, name, value) {
  if (value === null) {
    if (style.getPropertyValue(name)) style.removeProperty(name);
  } else if (style.getPropertyValue(name) !== value)
    style.setProperty(name, value);
}
// A resting hand on a wide screen is as wide as its fanned cards, so none
// is cut at the screen edge (#2017). Past the dialogue's room the cards
// overlap more instead of spilling off it.
function fitRestingHand() {
  const root = document.documentElement.style;
  const shown = [...$("hand").children].filter((frame) => !frame.hidden);
  if (!wideLayout.matches || !shown.length) {
    setStyle(root, "--resting-hand-fit", null);
    setStyle(root, "--resting-fan-overlap", null);
    return;
  }
  const hand = getComputedStyle($("hand")),
    padding = parseFloat(hand.paddingLeft) + parseFloat(hand.paddingRight),
    cards = shown.reduce((sum, frame) => sum + frame.offsetWidth, 0),
    gaps = shown.length - 1,
    overlap = shown[0].offsetHeight * 0.14,
    room = Math.max(innerWidth - 540, shown[0].offsetWidth * 2),
    natural = cards - gaps * overlap + padding + 14,
    width = Math.min(natural, room);
  setStyle(root, "--resting-hand-fit", `${Math.ceil(width)}px`);
  setStyle(
    root,
    "--resting-fan-overlap",
    natural > room && gaps ? `${overlap + (natural - room) / gaps}px` : null,
  );
}
// Fade only the hand's edges that hide more cards.
function updateHandEdges() {
  fanHand();
  fitRestingHand();
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
  if (!fade.length) delete hand.dataset.fade;
  else if (hand.dataset.fade !== fade.join(" "))
    hand.dataset.fade = fade.join(" ");
}
$("hand").addEventListener("scroll", updateHandEdges, { passive: true });
let handResizeFrame = 0;
new ResizeObserver(() => {
  if (handResizeFrame) return;
  // Fitting the fan changes this hand's width; let its measurement finish.
  handResizeFrame = requestAnimationFrame(() => {
    handResizeFrame = 0;
    updateHandEdges();
  });
}).observe($("hand"));
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
    abandonQuest &&
    !$("action-beat").hidden &&
    !document.querySelector("dialog[open], .world-menu:popover-open")
  ) {
    cancelAbandon();
    return;
  }
  if (e.key === "Escape" && thinkingArmed) {
    disarmThinking();
    return;
  }
  if (
    e.key === "Escape" &&
    !document.querySelector("dialog[open], .world-menu:popover-open") &&
    (selected.length || expandedHolders.size || !rowCollapsed || questOpen)
  ) {
    playQueue.clear();
    selected = [];
    questOpen = false;
    expandedHolders.clear();
    rowCollapsed = true;
    render();
  }
});
// A click outside the cards and the dialogue folds the row and clears the
// choice, as Escape does: the action panel fades and the full dialogue card
// is back. A tap on the dialogue steps its beat and leaves the
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
      rowCollapsed = false;
      render();
    }
    return;
  }
  // A play rests its beat; a tap on the raised hand's empty space brings
  // the held cards' next plays back without changing the choice.
  if (restedChoice && within(".play-dock") && !within(".card-frame")) {
    restedChoice = null;
    renderActions();
  }
  if (
    within(".play-dock, .card-frame, dialog, .topbar, .dialogue, .world-menu")
  )
    return;
  foldHand();
});
function foldHand() {
  selected = [];
  questOpen = false;
  rowCollapsed = true;
  expandedHolders.clear();
  render();
}
$("history-button").onclick = () => {
  count("scrollback.open");
  renderLog(true);
  $("history-dialog").showModal();
  pauseSpeech();
  // The newest visit is first; the past is further down.
  $("messages").scrollTop = 0;
};
startMetrics($("metrics-toggle"));
$("menu-button").onclick = () => settingsCards.open();
document
  .querySelectorAll("[data-close]")
  .forEach(
    (button) => (button.onclick = () => $(button.dataset.close).close()),
  );
document
  .querySelectorAll("dialog")
  .forEach((dialog) => dialog.addEventListener("close", pauseSpeech));
$("history-dialog").addEventListener("close", () => renderLog(false));
$("new-game").onclick = () => {
  $("menu-dialog").close();
  $("reset-dialog").showModal();
  pauseSpeech();
};
$("cancel-reset").onclick = () => $("reset-dialog").close();
function cancelPipTransition() {
  pipTransition++;
  clearTimeout(pipTimer);
  pipLeaving = false;
}
$("confirm-reset").onclick = () => resetTable();
function resetTable(next = freshWorld()) {
  cancelPipTransition();
  playQueue.clear();
  releaseGhosts();
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
  world = next;
  rememberWords(null);
  loadSeen(true);
  completedSpeech.clear();
  seenCaptions.clear();
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
  if (startingPip) loadSeen(true);
  notice("");
  save();
  $("reset-dialog").close();
  playNewWorldIntro({ arrival: startingPip && Boolean(world.opening) });
  holdMusicForTitle();
  nameTitleWaker(nameOf(currentActor(world)), currentActor(world));
  resumeScene();
}
window.addEventListener("storage", (event) => {
  if (sharedSession || event.key !== SAVE_KEY || !event.newValue) return;
  cancelPipTransition();
  playQueue.clear();
  releaseGhosts();
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
    quietExits = true;
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
      isSceneText(entry) &&
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
// first words, the silent beat "…" shows, and stays "…" after a reload.
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
  openingHeld = openingWordsDue() && !avatarKnown();
  if (openingHeld) {
    // Vale's first line starts with his own reveal, while the room is dark.
    storyStatus = "ready";
    save();
    render();
    return;
  }
  const words = wordsOnLoad();
  if (openingWordsDue() && !otherTab && words !== "silent") {
    // A new game asks the dialogue model for Vale's first line, and a reload
    // that interrupted it asks again. Words that failed stay "…".
    lineSeq = null;
    storyStatus = "pending";
    exchange.begin();
    render();
    narrator.changed();
    return;
  }
  if (!saveBlocked && !hasCurrentWords() && words === "pending" && !otherTab) {
    // This turn's words were on the way before the reload: ask again,
    // quietly, under the Thinking card. Another tab that is asking keeps
    // its request; this one shows the caption alone.
    const played = world.log.findLast(
      (entry) =>
        entry.turn === world.turn &&
        entry.kind === "action" &&
        entry.actorId === currentActor(world),
    );
    lineSeq = null;
    render();
    narrator.changed(
      played ? { item: played.itemId, target: played.targetId } : null,
    );
    return;
  }
  if (words === "silent" && openingWordsDue()) {
    // Vale's first words failed before the reload: he stays "…".
    render();
    showOpeningSilence();
    return;
  }
  if (!saveBlocked && hasCurrentWords()) {
    const saved = readingPosition();
    const lines = shownWorld().log.filter((entry) => entry.generated &&
      isSceneText(entry) && entry.turn === world.turn &&
      entry.locationId === world.actors[currentActor(world)].place && !sleepView.hidesLine(entry));
    const index = saved ? lines.findIndex((entry) => entry.seq >= saved.seq) : -1;
    const remaining = index >= 0 ? lines.slice(index) : [];
    const line = remaining[0] || lines.at(-1);
    // A line read, or begun, before the reload shows whole.
    if (line) completedSpeech.add(lineKey(line, line.locationId));
    lineSeq = null;
    exchange.begin();
    render();
    exchange.load(remaining.length ? remaining : line ? [line] : []);
  } else render();
}
// Until it resolves, the player's own play reads on its button as what their
// avatar is doing. Only a refusal or an unconfirmed send needs words. A
// refusal is its play's button label (refusalLabel) until the selection or
// the world changes.
function showSharedPlay(state, reason = "") {
  if (!sharedPlay) return;
  const play = sharedPlay,
    was = play.state;
  sharedPlay.state = state;
  if (state === "played" || state === "rejected") sharedPlay = null;
  if (state === "sending") sharedRefusal = null;
  // A play the server did not take wakes its rested beat: a refused one
  // says why there, and choosing its cards again offers it again.
  if (["rejected", "uncertain"].includes(state)) restedChoice = null;
  if (
    ["playing", "played"].includes(state) &&
    !["playing", "played"].includes(was)
  )
    rememberWait(play.action, play.choice);
  const shown = $("play-status").dataset.playStatus;
  if (state === "rejected")
    sharedRefusal = {
      reason,
      key: play.action.key,
      label: play.label,
      choice: selected.join("+"),
      revision: world.revision,
    };
  if (state === "uncertain") notice(reason, state);
  else if (shown === "uncertain") notice("");
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
// The player's own play before its scene: queued here, or waiting or
// resuming at the shared table. Only a queued or waiting play can be
// withdrawn; a resuming one is committed, so cancelling only stops waiting
// for its line.
function ownPlayInFlight() {
  const queued = playQueue.pending;
  if (queued && queued.action.kind !== "focus")
    return {
      cancel: () => {
        playQueue.clear();
        restedChoice = null;
      },
    };
  // A committed local play stays saved: cancel only stops waiting for words.
  if (!sharedSession)
    return storyStatus === "pending"
      ? { committed: true, cancel: stopWaiting }
      : null;
  const entry = ownSharedEntry();
  if (entry?.status === "waiting")
    return {
      cancel: () => {
        restedChoice = null;
        void withdrawSharedPlay(entry.id);
      },
    };
  if (entry?.status === "retry")
    return {
      committed: true,
      cancel: () => void withdrawSharedPlay(entry.id),
    };
  // Sent but not yet at the table: nothing to withdraw yet.
  if (sharedSending || ["sending", "accepted"].includes(sharedPlay?.state))
    return { cancel: null };
  return null;
}
function stopWaiting() {
  narrator.invalidate();
  exchange.cancel();
  storyStatus = "ready";
  rememberWords(null);
}
// The Thinking card cancels in two taps: the first asks, the second
// cancels. A pause, Escape or a tap elsewhere puts it back.
const THINKING_CONFIRM_MS = 3000;
let thinkingArmed = false,
  thinkingTimer = null;
function disarmThinking(rerender = true) {
  clearTimeout(thinkingTimer);
  if (!thinkingArmed) return;
  thinkingArmed = false;
  if (rerender) renderScene();
}
function tapThinking() {
  const own = stackView.pending?.own;
  if (!own?.cancel) return;
  if (!thinkingArmed) {
    thinkingArmed = true;
    thinkingTimer = setTimeout(disarmThinking, THINKING_CONFIRM_MS);
    renderScene();
    return;
  }
  disarmThinking(false);
  own.cancel();
  render();
}
function withdrawSharedPlay(key) {
  if (sharedPlay?.key === key) sharedPlay = null;
  return sharedSession
    .command({ op: "cancel", key })
    .catch((error) => notice(error.message));
}
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
  if (
    !sharedNextLine(
      sharedSession.state,
      world.actors[currentActor(world)].place,
      sharedLineSeq,
    )
  )
    sharedAdvanceRequested = true;
  sharedSending = true;
  sharedPlay = {
    key: crypto.randomUUID(),
    action: current,
    choice: selected.join("+"),
    label: playLabel(action, world),
    notice: sharedSession.state.notice || "",
  };
  showSharedPlay("sending");
  try {
    const hidden = hiddenFor(world, currentActor(world))?.id;
    await sharedSession.play(
      current,
      sharedPlay.key,
      [...encountered].filter((id) => !cardIsCovered(id) && id !== hidden),
    );
    lastPlayAt = performance.now();
    if (!playQueue.pending && JSON.stringify(selected) === selection) {
      keepHeldSelection(heldBefore, current);
      reviewing = false;
      reviewBeat = null;
      lineSeq = sharedLineSeq;
    }
    if (sharedPlay) {
      sharedPlay.state = "accepted";
      trackSharedPlay(sharedSession.state);
    }
  } catch (error) {
    count(error.cause ? "error.network" : "error.rules_reject");
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
  if (!avatarKnown()) return;
  const room = world.actors[currentActor(world)].place;
  // The avatar's waking scene can speak while its surroundings stay covered.
  // Other room scenes wait for that viewer's place reveal.
  const state = selfKnown()
    ? sharedSession.state
    : {
        ...sharedSession.state,
        history: (sharedSession.state.history || []).filter(
          (scene) => scene.opening && scene.actor === currentActor(world),
        ),
      };
  if (
    document.hidden ||
    document.querySelector("dialog[open], .world-menu:popover-open")
  )
    return;
  if (sharedLineSeq !== null && !sharedAdvanceRequested) return;
  const after = sharedLineSeq ?? sharedLineStart;
  const live =
    after === null
      ? sharedReadingLine(state, room, readingPosition())
      : sharedNextLine(state, room, after);
  if (!live && !selfKnown()) return;
  sharedLineStart ??= -Infinity;
  if (!live && after !== null) return;
  const entry = shownWorld().log.findLast(
    (entry) =>
      entry.generated &&
      entry.locationId === room &&
      (live?.seq
        ? entry.seq === live.seq
        : live
          ? entry.text === live.text && entry.speaker === live.speaker
          : entry.kind === "dialogue"),
  );
  if (!entry) return;
  // A line that was already in the room on open shows whole.
  if (after === null) completedSpeech.add(lineKey(entry, room));
  sharedLineSeq = entry.seq;
  sharedAdvanceRequested = false;
  rememberReading(entry);
  lineSeq = entry.seq;
  storyStatus = "ready";
  renderScene();
}
function adoptShared(value) {
  if (!value.actor || !value.world?.actors?.[value.actor]) {
    leavePage(() => location.reload());
    return;
  }
  const key = JSON.stringify([value.world, value.present, value.claimed]);
  if (key !== sharedWorldKey) {
    const previousActor = currentActor(world);
    const from = world.actors[previousActor].place;
    const before = lastSeq(world);
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
    // The Talk that met the hidden avatar unlocks it: a beat says so.
    const found =
      alreadyOpen && unlockedSince(next, value.actor, lastSeq(world));
    world = next;
    sharedWorldKey = key;
    if (found)
      showActionBeat({
        cards: [{ src: `./${found.image}` }],
        name: `${found.name} remembers you`,
        note: `${found.name}'s own world is in ☰ now.`,
        buttons: [
          { label: "OK", id: "unlock-ok", run: () => clearActionBeat() },
        ],
      });
    selectCards(selected.filter((id) => availableCards(world).includes(id)));
    selectionRevision = world.revision;
    renderedHand = "";
    pendingSpeaker = null;
    cardsCooling = false;
    storyStatus = value.queue?.some((entry) => entry.status === "working")
      ? "pending"
      : "ready";
    const moved = world.actors[currentActor(world)].place !== from;
    if (moved || value.actor !== previousActor) queuedChoice = false;
    if (moved) {
      cancelTravel();
      reviewing = false;
      sharedLineSeq = null;
      sharedLineStart = before;
      sharedAdvanceRequested = false;
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
          beats.some((beat) => beat.kind === "defeat" && beat.viewerLost),
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
  } else if (questClaims.size) {
    renderedHand = "";
    render();
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
  // ☰'s seat actions are a beat in front of the dialogue.
  actionBeat: { show: showActionBeat, clear: clearActionBeat },
});
const settingsCards = installSettingsCards({
  actionBeat: { show: showActionBeat, clear: clearActionBeat },
  // The play hand gives way to the settings and comes back dealt.
  playHand: {
    leave() {
      const row = [...$("hand").children].filter((f) => !f.hidden),
        leaving = nearestFirst(row, row, currentActor(world)).slice(
          0,
          EXIT_MAX,
        );
      if (reducedMotion.matches || !row.length) return 0;
      const { exits, entryAt } = swapTiming(leaving.length, 1);
      dropCards(leaving, handExits(), exits);
      return entryAt;
    },
    back: dealHand,
  },
  // Switching a pack is a play that passes no turn (pack-toggle.mjs).
  packs: {
    on: (id) => groupOn(world, id),
    block: (id) => packToggleBlock(world, id, currentActor(world)),
    play: (pack, enable) =>
      performAction({ kind: "pack", pack, enable }, world.revision),
  },
});
// The root page resumes whichever avatar was played last.
if (!tableName && !startingPack && !startingPip)
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
if (sharedSession) {
  world = sharedWorld(sharedSession.state);
  sharedSession.subscribe(adoptShared, (message, recoveredFrom) => {
    if (!recoveredFrom || $("play-status").textContent === recoveredFrom) {
      // A refusal stays on its play's button (renderActions).
      notice(message === sharedRefusal?.reason ? "" : message);
      if (message && message === sharedRefusal?.reason) renderActions();
    }
  });
  adoptShared(sharedSession.state);
  setInterval(syncSharedLine, 200);
}
// The title's Wake button names the avatar this world opens with.
nameTitleWaker(pipPrelude() ? "Pip" : nameOf(currentActor(world)), pipPrelude() ? "moth" : currentActor(world));
if (startingPip && openingTable) save();
resumeScene();
// The title's turn (or Escape past it) is this avatar's reveal.
onTitleWake(() => uncover(pipPrelude() ? "moth" : currentActor(world), { flip: false }));
if (pipPrelude() && world.actors.vale.want?.story)
  performAction({ kind: "talk", target: "moth" }, world.revision);
else if (pipPrelude() && openingTable) {
  playTitleIntro({ cardOnly: true, storage: null });
  holdMusicForTitle();
}
