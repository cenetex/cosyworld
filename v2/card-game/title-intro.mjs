import { accountStorage as localStorage } from "./account-reset-storage.mjs";
import acknowledgement from "./acknowledgement.json" with { type: "json" };
import landings from "./pack-landings.json" with { type: "json" };
import { PLAYING_KEY, SAVE_BASE } from "./avatar-world.mjs";
import { imageUrl } from "./images.mjs";
import { count } from "./metrics.mjs";
import { revealCard } from "./card-reveal.mjs";
import { ghostOf, releaseGhost } from "./card-ghost.mjs";
import { tiers } from "./level-tiers.mjs";
import {
  LOGOS,
  logoSite,
  showToolbarLogo,
  transparentLogo,
  worldLogo,
} from "./title-logo.mjs";
import { createTitleSong } from "./title-song.mjs";
import { pipEntry } from "./pip-landing.mjs";
import {
  createRevealPainter,
  createTextReveal,
  letterDelay,
  letterSpans,
  splitLetters,
} from "./dialogue.mjs";

// The Lonely Forest title opens every new world: black, the land
// acknowledgement (acknowledgement.json), the world's logo (title-logo.mjs)
// with its song, then the box deals covered cards into the hand. The avatar
// reveals and bounces only after landing. Returning worlds never replay it.
// The key holds the id of a shared world just created or joined whose title
// is still due.
export const INTRO_KEY = "cosyworld.title-intro";
export const TITLES = LOGOS.map((logo) => logo.src);
const BLACK_MS = 350,
  LOAD_LIMIT_MS = 2500;
// Left alone, the face-down card glows faintly (style.css) after idleGlowMs,
// then short invitations whisper around it at hintMs. A tap, a key or a pointer
// over the card starts the wait again.
export const REVEAL_HINT = { idleGlowMs: 3000, hintMs: 6000 };
export const BOX_WHISPERS = [
  ["open it", "take it"],
  ["look inside", "come closer"],
  ["it waits", "just a little"],
  ["something stirs", "it knows your name"],
  ["it remembers you", "you left this here"],
  ["it dreamed of you", "you are already inside"],
];
export function whisperLine(tier, previous = "", random = Math.random()) {
  const choices = BOX_WHISPERS[tier.rank].filter((line) => line !== previous);
  return choices[Math.floor(random * choices.length)];
}
// Visual whispers may show every tier; Legendary and Mythic share 1% of draws.
export function whisperTier(random = Math.random()) {
  let draw = random * 100;
  return (
    tiers.find(({ rank }) => (draw -= [64, 24, 8, 3, 0.8, 0.2][rank]) < 0) ||
    tiers.at(-1)
  );
}
// Leaving: the turned face holds, the song fades as the title goes to black,
// black holds a breath, then slowly opens on the world's scene. Escape is the
// short way; reduced motion cuts to black and crossfades quickly.
export const WAKE_FADE = {
  turn: {
    holdMs: 700,
    songSeconds: 4,
    blackMs: 900,
    darkMs: 300,
    sceneMs: 2500,
  },
  skip: { songSeconds: 2, blackMs: 250, darkMs: 100, sceneMs: 800 },
  reduced: { blackMs: 0, darkMs: 300, sceneMs: 300 },
};

export const OPENING_DEAL = {
  logoMs: 350,
  flightMs: 1300,
  staggerMs: 55,
  landMs: 520,
};

// Deal the opening's real cards visually, without moving their DOM nodes or
// changing custody. The title owns these inert copies until its fade finishes.
export function openingDealFrames(
  origin,
  target,
  index,
  total,
  rotation = "0deg",
) {
  const x = origin.left + origin.width / 2 - target.left - target.width / 2;
  const y = origin.top + origin.height / 2 - target.top - target.height / 2;
  const at = index - (total - 1) / 2;
  return [
    {
      transform: `translate(${x}px, ${y}px) scale(${origin.width / target.width}, ${origin.height / target.height})`,
      opacity: 1,
    },
    {
      transform: `translate(${x + at * Math.min(28, origin.width / total)}px, ${y - 24}px) rotate(${at * 4}deg) scale(0.9)`,
      opacity: 1,
      offset: 0.3,
    },
    { transform: `rotate(${rotation})`, opacity: 1 },
  ];
}
async function dealOpeningHand(layer, origin) {
  const hand = document.getElementById("hand");
  if (!hand || !origin?.width)
    return { finished: Promise.resolve(), finish() {}, clear() {} };
  const bounds = hand.getBoundingClientRect();
  const cards = [...hand.querySelectorAll(":scope > .card-frame")].filter(
    (node) => {
      const box = node.getBoundingClientRect();
      return (
        box.width &&
        box.height &&
        box.right > bounds.left &&
        box.left < bounds.right
      );
    },
  );
  const deals = await Promise.all(
    cards.map(async (node, index) => {
      const bounds = node.getBoundingClientRect();
      const box = {
        left: bounds.left + (bounds.width - node.offsetWidth) / 2,
        top: bounds.top + (bounds.height - node.offsetHeight) / 2,
        width: node.offsetWidth,
        height: node.offsetHeight,
      };
      const rotation = getComputedStyle(node).rotate;
      const copy = ghostOf(node);
      const images = [...copy.querySelectorAll("img")];
      for (const image of images) image.loading = "eager";
      // Never fly an empty portrait while the copied image decodes. A failed
      // or slow image keeps its normal table reveal instead of delaying entry.
      const ready = await Promise.race([
        Promise.all(
          images.map((image) =>
            image.decode().then(
              () => true,
              () => false,
            ),
          ),
        ).then((results) => results.every(Boolean)),
        wait(400).then(() => false),
      ]);
      if (!ready) {
        releaseGhost(copy);
        return null;
      }
      Object.assign(copy.style, {
        position: "fixed",
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
        margin: "0",
        pointerEvents: "none",
        rotate: "none",
        transformOrigin: "50% 50%",
      });
      copy.style.setProperty("--card-height", `${box.height}px`);
      return { copy, box, index, rotation };
    }),
  );
  const motions = [];
  for (const deal of deals.filter(Boolean)) {
    const { copy, box, index, rotation } = deal;
    layer.append(copy);
    motions.push(
      copy.animate(
        openingDealFrames(
          origin,
          box,
          index,
          cards.length,
          rotation === "none" ? "0deg" : rotation,
        ),
        {
          duration: OPENING_DEAL.flightMs,
          delay: index * OPENING_DEAL.staggerMs,
          fill: "both",
          easing: "cubic-bezier(.2,.7,.25,1)",
        },
      ),
    );
  }
  return {
    finished: Promise.all(
      motions.map((motion) => motion.finished.catch(() => {})),
    ),
    finish: () => motions.forEach((motion) => motion.finish()),
    clear: () => deals.forEach((deal) => releaseGhost(deal?.copy)),
  };
}

// Only on Lonely Forest: no other site's landing, not the local CosyWorld
// app, no table or pack link. Automated browsers need `intro=1`.
export function titleIntroAllowed({ href, local, webdriver }) {
  if (local || pipEntry(href)) return false;
  const url = new URL(href);
  const forced = url.searchParams.get("intro") === "1";
  if ([...url.searchParams.keys()].some((k) => k !== "intro" && k !== "world"))
    return false;
  if (webdriver && !forced) return false;
  return !landings[url.hostname];
}
const pageContext = () => ({
  href: location.href,
  local: !!document.querySelector('meta[name="cosy-local-app"]'),
  webdriver: navigator.webdriver,
});

// On load: the bare address with no save and no world played before starts
// a new local world; a shared world shows it once, right after this browser
// created or joined it. Storage that cannot be read shows the bare one.
export function titleIntroWanted({ href, storage, local, webdriver }) {
  if (!titleIntroAllowed({ href, local, webdriver })) return false;
  const world = new URL(href).searchParams.get("world");
  try {
    if (world) return storage.getItem(INTRO_KEY) === world;
    return [SAVE_BASE, PLAYING_KEY].every((k) => storage.getItem(k) === null);
  } catch {
    return !world;
  }
}

// Creating or joining a shared world queues its title for the next page.
export function queueTitleIntro(world, storage = localStorage) {
  try {
    storage.setItem(INTRO_KEY, world);
  } catch {}
}

// New game on the local table picks its own logo and plays the title at once.
export function playNewWorldIntro({ arrival = false } = {}) {
  const context = pageContext();
  let storage = null;
  try {
    storage = localStorage;
  } catch {}
  if (!logoSite(context)) return;
  const logo = worldLogo({ href: context.href, storage, fresh: true });
  showToolbarLogo(logo);
  // The New game click is long past: the title still waits for its own tap.
  if (titleIntroAllowed(context) || (arrival && pipEntry(context.href)))
    playTitleIntro({
      storage: null,
      logo,
      song: createTitleSong({ storage }),
      boxOpened: arrival,
    });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The face-down card turns to the avatar this world opens with. The table
// boots under the title and names it here once the world is known.
let wakeName = "",
  wakeId = "";
export function nameTitleWaker(name, id = "") {
  wakeName = typeof name === "string" ? name.trim() : "";
  wakeId = id;
}

// The title's card is the avatar's own card: turning it, or Escape past it,
// uncovers that card in the hand, so the table never asks to reveal it twice.
// The table boots under the title and may register after the title leaves,
// so a wake that came first is kept for it.
let woken = false,
  onWake = null;
export function onTitleWake(callback) {
  onWake = callback;
  if (woken) wake();
}
function wake() {
  woken = !onWake;
  onWake?.();
}

// No room music plays under the title, nor until its song has faded out:
// app.mjs waits for this promise (null when no title is up).
let musicHold = null;
export const titleMusicHold = () => musicHold;

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};
const link = (text, href) => {
  const anchor = element("a", "", text);
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noopener";
  return anchor;
};
// The acknowledgement writes in like dialogue, with the same reveal
// (dialogue.mjs): one steady letter beat, the same rests after punctuation,
// a longer breath between stanzas, and a breath after its weighty words
// (`pauses` in acknowledgement.json: the word, which time it appears,
// counting from 1, and the ms to hold after it and any punctuation touching
// it, a spaced dash too; the larger breath wins; one long silence falls
// before "Before you sits"). Each line is set as written, wrapping under a
// hanging indent on a narrow screen.
export const STANZA_MS = 650;
export const STEP_GUARD_MS = 250;
export function acknowledgementStep({ complete, quick, sinceStepMs }) {
  if (complete) return sinceStepMs < STEP_GUARD_MS ? "wait" : "continue";
  return quick ? "finish" : "quicken";
}
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Where each pause falls: its line, the span that lights (a held word's
// phrase on its line, from `phrases`, else the word), the offset its breath
// follows, and how many letters of the whole run are written once that span is.
export function acknowledgementPauses({ stanzas, pauses = [], phrases = {} }) {
  const lines = stanzas.flat();
  const before = lines.map(
    (_, line) => splitLetters(lines.slice(0, line).join("")).length,
  );
  return pauses.flatMap(({ word, occurrence = 1, pauseMs, tier }) => {
    const phrase = tier && phrases[word];
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${escape(word)}(?![\\p{L}\\p{N}])(?:[.,;:!?…—]|\\s—)*`,
      "gu",
    );
    let seen = 0;
    for (const [line, text] of lines.entries())
      for (const { index, 0: match } of text.matchAll(pattern)) {
        if (++seen !== occurrence) continue;
        let start = index,
          end = index + word.length;
        for (let at = text.indexOf(phrase); phrase && at >= 0; ) {
          if (at <= start && at + phrase.length >= end) {
            [start, end] = [at, at + phrase.length];
            break;
          }
          at = text.indexOf(phrase, at + 1);
        }
        return [
          {
            word,
            phrase: text.slice(start, end),
            tier,
            pauseMs,
            line,
            start,
            end,
            hold: index + match.length,
            written: before[line] + splitLetters(text.slice(0, end)).length,
          },
        ];
      }
    return [];
  });
}
// The ms after each letter of the lines, read as one run.
export function acknowledgementDelays(acknowledgement) {
  const lines = acknowledgement.stanzas.flat();
  const holds = lines.map(() => new Map());
  for (const { line, hold, pauseMs } of acknowledgementPauses(acknowledgement))
    holds[line].set(hold, pauseMs);
  const stanzaEnds = new Set();
  let last = -1;
  for (const stanza of acknowledgement.stanzas.slice(0, -1))
    stanzaEnds.add((last += stanza.length));
  const delays = lines.flatMap((text, line) => {
    let offset = 0;
    const letters = splitLetters(text);
    return letters.map((letter, i) => {
      offset += letter.length;
      const end = i === letters.length - 1 && stanzaEnds.has(line);
      return Math.max(
        letterDelay(letter),
        holds[line].get(offset) ?? 0,
        end ? STANZA_MS : 0,
      );
    });
  });
  return delays;
}
// The single words that light, set by set (`highlights`), in reading order,
// one every wordStepMs after settleMs. A set is due once `due` letters are
// written: the next stanza's first letter, or its own stanza's last when no
// stanza follows or the set names its own settleMs. Only the named occurrence
// of a word lights.
export function acknowledgementHighlights(acknowledgement) {
  const { stanzas, highlights = [], wordStepMs } = acknowledgement;
  let written = 0;
  const ends = stanzas.map((s) => (written += splitLetters(s.join("")).length));
  return highlights.flatMap(({ stanza, tier, words, settleMs }, set) => {
    const settle = settleMs ?? acknowledgement.settleMs;
    const end = ends[stanza - 1];
    const overlap = settleMs === undefined && stanza < stanzas.length;
    return acknowledgementPauses({ stanzas, pauses: words }).map((word, i) => {
      const atMs = settle + i * wordStepMs;
      return {
        ...word,
        tier,
        set,
        written: end,
        due: end + (overlap ? 1 : 0),
        atMs,
      };
    });
  });
}
export function acknowledgementGlows(acknowledgement) {
  const pauses = acknowledgementHighlights(acknowledgement);
  return (shown, done) => pauses.map(({ due }) => done || shown >= due);
}
// The title's letters blip in the dialogue's own voice (createSpeechSounds in
// dialogue.mjs). The table registers its sounds when it boots, so the title
// shares their Voices setting and the audio the player's gesture unlocked:
// a new world from the menu hears them from the first letter, a first visit
// once a gesture unlocks audio.
let voice = null;
export function voiceTitle(sounds) {
  voice = sounds;
}
// Real text from acknowledgement.json, set like a film's opening card. Each
// highlighted word takes on its set's rarity tier colour and weight in the
// pause after its stanza, and keeps them; it stays plain text, announced
// nowhere.
function acknowledgementPanel() {
  const glyphs = [];
  const streamed = (text) => {
    const letters = letterSpans(text);
    glyphs.push(...letters);
    return letters;
  };
  const inline = (children, className) => {
    const span = element("span", className);
    span.append(...children);
    return span;
  };
  const panel = element("section", "title-ack");
  const text = element("div", "title-ack-text");
  text.tabIndex = 0;
  text.setAttribute("role", "region");
  text.setAttribute("aria-label", acknowledgement.title);
  const pauses = acknowledgementHighlights(acknowledgement);
  const glowing = acknowledgementGlows(acknowledgement);
  const glows = [],
    lighting = new Map();
  const fadeGroups = tiers.map(() => []);
  let shown = 0,
    total = 0,
    stepAt = -Infinity,
    lastSound = -Infinity;
  const stanzaEnds = acknowledgement.stanzas.map(
    (stanza) => (total += splitLetters(stanza.join("")).length),
  );
  text.style.setProperty("--glow-in", `${acknowledgement.glowInMs}ms`);
  let at = 0;
  for (const stanza of acknowledgement.stanzas) {
    const paragraph = element("p");
    for (const words of stanza) {
      const row = element("span", "title-ack-line");
      const together = acknowledgement.fadeTogether.includes(words);
      const highlights = pauses.filter(({ line }) => line === at);
      // Keep punctuation with its word as it fades, including a spaced dash.
      const line = words.replace(/ (?=—)/gu, "\u00a0");
      for (const { 0: part, index } of line.matchAll(/[^ ]+| +/gu)) {
        if (part.startsWith(" ")) {
          row.append(...streamed(part));
          continue;
        }
        const end = index + part.length;
        const highlight = highlights.find(
          ({ start }) => start >= index && start < end,
        );
        let rarity = tiers[0];
        let letters;
        if (highlight) {
          const { start, end: last, tier } = highlight;
          const prefix = streamed(line.slice(index, start));
          const glow = inline(
            streamed(line.slice(start, last)),
            "title-ack-glow",
          );
          rarity = tiers.find(({ id }) => id === tier) || tiers[0];
          glow.dataset.tier = tier;
          glow.style.setProperty("--tier-color", rarity.color);
          glows[pauses.indexOf(highlight)] = glow;
          letters = [...prefix, glow, ...streamed(line.slice(last, end))];
        } else letters = streamed(part);
        const word = inline(letters);
        const lingering = acknowledgement.linger.includes(
          part.replace(/[^\p{L}\p{N}]/gu, ""),
        );
        if (!together) fadeGroups[lingering ? 3 : rarity.rank].push(word);
        row.append(word);
      }
      if (together) fadeGroups[4].push(row);
      paragraph.append(row);
      at++;
    }
    text.append(paragraph);
  }
  // A quiet line, still a real button for focus and Enter or Space.
  const tap = matchMedia("(pointer: coarse)").matches;
  const next = element(
    "button",
    "title-continue",
    `${tap ? "tap" : "click"} to read faster`,
  );
  next.type = "button";
  next.setAttribute("aria-label", "Speed up this section");
  panel.append(text, next);
  // At a large text size the poem outgrows its panel. While it writes, the
  // panel scrolls on as the pen reaches its foot, so the newest words stay
  // in view, until the reader scrolls it themselves.
  let following = true,
    target = 0;
  const unfollow = () => (following = false);
  text.addEventListener("wheel", unfollow, { passive: true });
  text.addEventListener("pointerdown", unfollow);
  const follow = ({ shown, complete, instant }) => {
    const pen = glyphs[shown - 1];
    if (!following || complete || instant || !pen) return;
    const below =
      pen.getBoundingClientRect().bottom - text.getBoundingClientRect().bottom;
    if (below <= 0 || text.scrollTop + below <= target + 1) return;
    target = text.scrollTop + below;
    text.scrollTo({ top: target, behavior: "smooth" });
  };
  // A set with a word scrolled out of view (at a large text size) lights
  // the rest at once; the pause still holds.
  const outOfView = (glow) => {
    const box = glow.getBoundingClientRect(),
      view = text.getBoundingClientRect();
    return box.bottom <= view.top || box.top >= view.bottom;
  };
  const lightSet = (i) => {
    const set = glows.filter((_, j) => pauses[j].set === pauses[i].set);
    for (const glow of set.some(outOfView) ? set : [glows[i]])
      if (!("lit" in glow.dataset)) glow.dataset.lit = "";
  };
  const delays = acknowledgementDelays(acknowledgement);
  const painter = createRevealPainter(text);
  const reveal = createTextReveal({
    delay: (letter, i) => delays[i],
    // As in dialogue: a blip on every other letter, none on a rest, none
    // under reduced motion or in a hidden tab, the narrator's neutral voice.
    reduced: () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    sound: (speaker, letter, index) => {
      const time = performance.now();
      if (!document.hidden && time - lastSound >= 45) {
        voice?.syllable(speaker, letter, index);
        lastSound = time;
      }
    },
    frame: (value) => {
      shown = value.shown;
      painter.paint(value);
      follow(value);
      const lit = glowing(value.shown, value.complete);
      glows.forEach((glow, i) => {
        const pending = lighting.get(glow);
        if (!lit[i] || value.instant) {
          clearTimeout(pending);
          lighting.delete(glow);
          if (lit[i]) glow.dataset.lit = "";
          else delete glow.dataset.lit;
        } else if (!pending && !("lit" in glow.dataset))
          lighting.set(
            glow,
            setTimeout(() => lightSet(i), pauses[i].atMs),
          );
      });
      if (!value.complete) return;
      next.textContent = `${tap ? "tap" : "click"} to continue`;
      next.setAttribute("aria-label", "Continue to the title");
      delete panel.dataset.stream;
      panel.dataset.written = "";
    },
  });
  // The hand cue stays available as the words write.
  const write = (instant) => {
    if (!instant) panel.dataset.stream = "";
    painter.start(glyphs);
    const words = acknowledgement.stanzas.flat().join("");
    reveal.show("acknowledgement", words, null, { instant });
  };
  const quickenStanza = () => {
    following = true;
    target = text.scrollTop;
    reveal.accelerate(stanzaEnds.find((end) => end >= shown));
  };
  const press = () => {
    const step = acknowledgementStep({
      complete: reveal.complete,
      quick: reveal.quick,
      sinceStepMs: performance.now() - stepAt,
    });
    if (step === "wait" || step === "continue") return step === "continue";
    stepAt = performance.now();
    if (step === "finish") reveal.finish();
    else quickenStanza();
    return false;
  };
  const fadeOut = (reduced) => {
    const fade = (node, delay, duration) =>
      node.animate([{ opacity: 0 }], {
        duration,
        delay,
        easing: "ease-in-out",
        fill: "forwards",
      }).finished;
    // Sweep the plain words in reading order, then leave more time for each tier.
    const fades = reduced
      ? [fade(panel, 0, 250)]
      : fadeGroups.flatMap((words, rank) => {
          const start = rank ? 1800 + (rank - 1) * 160 : 200;
          const step = rank ? 50 : 20;
          return words.map((word, index) =>
            fade(word, start + index * step, rank ? 360 : 300),
          );
        });
    Promise.all([fade(next, 0, 200), ...fades]).then(
      () => panel.remove(),
      () => {},
    );
  };
  return { panel, next, reveal, write, unfollow, fadeOut, press };
}

const SCROLL_KEYS = [
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
];

// The overlay sits outside the inert body and over the table, which boots
// underneath it. The land acknowledgement shows first, silent. Its tap, click
// or key (the gesture browsers ask for before sound) brings the logo and the
// title song (title-song.mjs); the logo lifts over one face-down card and a
// Privacy link. The card turns to the avatar (card-reveal.mjs), then the song
// fades and the table shows. Escape skips straight in at any step.
// Resolves when the overlay is gone.
// A box the visitor has already opened (the Pip arrival) is not shown again:
// `boxOpened` goes from the logo straight to the deal.
export function playTitleIntro({
  logo = LOGOS[0],
  storage = localStorage,
  song = createTitleSong({ storage }),
  cardOnly = false,
  boxOpened = false,
  signal,
} = {}) {
  try {
    storage.removeItem(INTRO_KEY);
  } catch {}
  woken = false;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const layer = element("div", "title-intro");
  layer.dataset.phase = "black";
  layer.tabIndex = -1;
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-label", logo.name);
  const {
    panel,
    next,
    reveal: words,
    write,
    unfollow,
    fadeOut,
    press,
  } = acknowledgementPanel();
  const hidden = () => words.pause(document.hidden);
  document.addEventListener("visibilitychange", hidden);
  const image = element("img");
  if (reduced) image.style.transform = "translateY(-14dvh) scale(0.8)";
  image.alt = "";
  image.decoding = "async";
  const source = logo.src;
  layer.dataset.title = source;
  layer.append(image);
  document.documentElement.append(layer);

  let phase = "black",
    leaving = false,
    hurriedTitle = false,
    songDone = Promise.resolve(),
    fades = WAKE_FADE.turn,
    leave,
    hurry,
    dealOrigin = null,
    flight = null,
    skipFlight = false;
  const left = new Promise((resolve) => (leave = resolve));
  const hurried = new Promise((resolve) => (hurry = resolve));
  const race = (promise) => Promise.race([promise, left]);
  // The song fades as the title goes to black; Escape takes the short way.
  const finish = (way = "turn") => {
    if (leaving) return;
    leaving = true;
    if (way === "turn" && !cardOnly) dealOrigin = card.getBoundingClientRect();
    idle(false);
    words.cancel();
    voice?.stop();
    document.removeEventListener("visibilitychange", hidden);
    fades = { ...WAKE_FADE[way], ...(reduced && WAKE_FADE.reduced) };
    songDone = song.stop(fades.songSeconds);
    if (!dealOrigin) wake();
    leave();
  };
  const fade = (node, duration, delay = 0) =>
    node.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration,
      delay,
      easing: "ease",
      fill: "both",
    });
  // The game's own face-down card, as in ☰; its reveal is the way in.
  const card = element("button", "card avatar");
  card.type = "button";
  card.dataset.unrevealed = "true";
  card.dataset.locked = "false";
  card.dataset.card = "title-traveller";
  // The acknowledgement asks "Will you take it?"; the card back is the box.
  card.setAttribute("aria-label", "Open the box");
  const back = element("img", "card-back");
  back.alt = "";
  back.src = imageUrl("./assets/card-back.webp", "card");
  card.append(back);
  const frame = element("div", "card-frame title-card");
  frame.append(card);
  // A quiet invitation around the box. Its button carries the accessible name.
  const hint = element("p", "title-hint", "open it");
  hint.setAttribute("aria-hidden", "true");
  const row = element("div", "title-reveal");
  row.append(frame, hint);
  const privacy = link("Privacy", "/privacy");
  privacy.className = "title-privacy";
  let idleTimers = [],
    whisper = null,
    lastWhisper = "",
    place = 0;
  const invite = () => {
    if (phase !== "card" || leaving || row.dataset.idle !== "hint") return;
    whisper?.cancel();
    const tier = reduced ? tiers[0] : whisperTier();
    hint.textContent = reduced
      ? BOX_WHISPERS[0][0]
      : whisperLine(tier, lastWhisper);
    lastWhisper = hint.textContent;
    hint.dataset.tier = tier.id;
    const box = card.getBoundingClientRect(),
      crest = image.getBoundingClientRect(),
      origin = row.getBoundingClientRect(),
      foot = cardOnly
        ? innerHeight - 16
        : privacy.getBoundingClientRect().top - 8;
    const w = hint.offsetWidth,
      h = hint.offsetHeight;
    const below = [box.left + (box.width - w) / 2, box.bottom + 12];
    const above = [below[0], box.top - h - 12];
    const places = reduced
      ? [below]
      : [
          box.left >= w + 32
            ? [box.left - w - 16, box.top + box.height * 0.2]
            : above,
          innerWidth - box.right >= w + 32
            ? [box.right + 16, box.top + box.height * 0.6]
            : below,
          below,
        ];
    const first = place++ % places.length;
    const candidates = [
      ...places.slice(first),
      ...places.slice(0, first),
      above,
      [below[0], crest.top - h - 12],
    ].map(([x, y]) => [
      Math.max(16, Math.min(innerWidth - w - 16, x)),
      Math.max(16, Math.min(foot - h, y)),
    ]);
    const [x, y] =
      candidates.find(([x, y]) =>
        (cardOnly ? [box] : [box, crest]).every(
          (part) =>
            y + h <= part.top - 8 ||
            y >= part.bottom + 8 ||
            x + w <= part.left - 8 ||
            x >= part.right + 8,
        ),
      ) || candidates[0];
    Object.assign(hint.style, {
      left: `${x - origin.left}px`,
      top: `${y - origin.top}px`,
      color: tier.color,
    });
    if (!reduced) {
      whisper = hint.animate(
        [0, 0.3, 0.55, 0.9, 1].map((offset, step) => ({
          offset,
          opacity: step === 1 || step === 2 ? 0.5 : 0,
          easing: "ease-in-out",
        })),
        { duration: 5000, fill: "both" },
      );
      void whisper.finished.then(invite, () => {});
    }
  };
  const idle = (again = true) => {
    idleTimers.forEach(clearTimeout);
    whisper?.cancel();
    place = 0;
    delete row.dataset.idle;
    if (!again || phase !== "card" || leaving) return;
    const { idleGlowMs, hintMs } = REVEAL_HINT;
    idleTimers = [
      setTimeout(() => (row.dataset.idle = "glow"), idleGlowMs),
      setTimeout(() => {
        row.dataset.idle = "hint";
        invite();
      }, hintMs),
    ];
  };
  window.addEventListener("resize", idle);
  void left.then(() => window.removeEventListener("resize", idle));

  const loaded = new Promise((resolve) => {
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    setTimeout(() => resolve(false), LOAD_LIMIT_MS);
  });
  if (!cardOnly) image.src = imageUrl(transparentLogo(source));
  else image.hidden = true;

  // The face is the avatar's card from the hand, as the table drew it. The
  // revealed card holds a moment, so the player sees who wakes, then enters.
  const turn = async () => {
    if (phase !== "card" || leaving) return;
    if (!cardOnly) {
      count("intro.wake");
      finish();
      return;
    }
    phase = layer.dataset.phase = "revealed";
    idle(false);
    count("intro.wake");
    const face =
      wakeId &&
      document.querySelector(`#hand .card[data-card="${CSS.escape(wakeId)}"]`);
    if (face) {
      card.style.cssText = face.style.cssText;
      card.dataset.tier = face.dataset.tier;
      const art = face.querySelector(":scope > .art");
      if (art) card.prepend(art.cloneNode(true));
    }
    back.before(element("span", "name", wakeName));
    // The face and the lid paint on the turn's first frame, not a blank one.
    const decoded = [back, ...card.querySelectorAll(".art img")].map((img) =>
      img.decode().catch(() => {}),
    );
    await race(Promise.race([Promise.all(decoded), wait(400)]));
    if (leaving) return;
    card.dataset.unrevealed = "false";
    card.dataset.locked = "false";
    card.setAttribute("aria-label", wakeName || "Your traveller");
    if (!reduced) await race(revealCard(card));
    await race(wait(WAKE_FADE.turn.holdMs));
    finish();
  };
  card.addEventListener("click", turn);
  hint.addEventListener("click", turn);
  card.addEventListener("pointermove", () => idle());
  // The logo lifts over the card, with the Privacy page under it.
  const showWake = () => {
    if (phase !== "title" || leaving) return;
    phase = layer.dataset.phase = "card";
    panel.remove();
    image.getAnimations().forEach((animation) => animation.finish());
    if (!cardOnly)
      image.animate(
        [{ transform: "none" }, { transform: "translateY(-14dvh) scale(0.8)" }],
        {
          duration: reduced ? 0 : 900,
          easing: "ease",
          fill: "both",
        },
      );
    layer.append(row);
    if (boxOpened) {
      // The deal still starts from where the box would stand, unseen.
      row.style.opacity = "0";
      finish();
      return;
    }
    if (!cardOnly) layer.append(privacy);
    fade(row, reduced ? 250 : 600, reduced ? 0 : 300);
    card.focus({ preventScroll: true });
    idle();
  };
  // The acknowledgement's gesture: the logo and the song.
  const showTitle = async () => {
    if (phase !== "ack" || leaving) return;
    phase = layer.dataset.phase = "title";
    voice?.stop();
    song.start();
    layer.focus({ preventScroll: true });
    panel.inert = true;
    if (!(await race(loaded)) || leaving) return showWake();
    const crossfade = !reduced && phase === "title";
    if (phase === "title") fadeOut(reduced);
    image.alt = logo.name;
    const appearance = image.animate(
      crossfade
        ? [
            { opacity: 0, transform: "scale(0.97)", easing: "ease-in-out" },
            {
              opacity: 0.1,
              transform: "scale(0.98)",
              offset: 2000 / 2950,
              easing: "ease-in-out",
            },
            { opacity: 1, transform: "scale(1)" },
          ]
        : [{ opacity: 0 }, { opacity: 1 }],
      {
        duration: reduced ? 250 : 2950,
        easing: crossfade ? "linear" : "ease",
        fill: "both",
      },
    );
    if (hurriedTitle) quickenTitle();
    await race(appearance.finished.catch(() => {}));
    await race(
      Promise.race([wait(reduced ? 600 : 750), hurried.then(() => wait(150))]),
    );
    showWake();
  };
  const quickenTitle = () => {
    hurriedTitle = true;
    hurry();
    for (const animation of layer.getAnimations({ subtree: true }))
      animation.updatePlaybackRate(reduced ? 1 : 3);
  };
  const advance = () => {
    if (phase === "ack") {
      if (!words.complete) voice?.unlock();
      return press() ? showTitle() : undefined;
    }
    return phase === "title" ? quickenTitle() : undefined;
  };
  next.addEventListener("click", advance);
  layer.addEventListener("click", (event) => {
    if (!event.target.closest?.("a, button")) advance();
  });
  // A pointer hides the card's focus ring; the keyboard brings it back.
  layer.addEventListener("pointerdown", (event) => {
    layer.dataset.pointer = "true";
    if (event.target !== hint) idle();
  });
  // Keep focus on the step's button rather than the tapped title.
  layer.addEventListener("mousedown", (event) => {
    if (!event.target.closest?.("a, button, .title-ack-text"))
      event.preventDefault();
  });
  const onKey = (event) => {
    if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
    event.stopPropagation();
    if (
      event.repeat &&
      event.key !== "Tab" &&
      !SCROLL_KEYS.includes(event.key)
    ) {
      event.preventDefault();
      return;
    }
    // The table's own unlock never hears this key; a scroll key lets the
    // letters' blips start while the poem still writes.
    voice?.unlock();
    delete layer.dataset.pointer;
    idle();
    if (event.key === "Escape") {
      event.preventDefault();
      if (leaving) {
        skipFlight = true;
        flight?.finish();
      } else {
        count("intro.skip");
        finish("skip");
      }
      return;
    }
    // Tab moves between the step's links and button; Enter and Space press
    // them; the arrows scroll the acknowledgement.
    if (phase === "ack" && SCROLL_KEYS.includes(event.key)) unfollow();
    if (
      event.key === "Tab" ||
      (phase === "ack" && SCROLL_KEYS.includes(event.key))
    )
      return;
    if (
      event.target.closest?.(".title-intro a, .title-intro button") &&
      [" ", "Enter"].includes(event.key)
    )
      return;
    event.preventDefault();
    if (phase === "card") card.focus({ preventScroll: true });
    else if (phase === "ack" || phase === "title") advance();
  };
  window.addEventListener("keydown", onKey, true);
  // Startup owns this title. A failed boot must release its keyboard, song
  // and overlay without waking a partially initialized table.
  const abort = () => {
    leaving = true;
    skipFlight = true;
    idle(false);
    words.cancel();
    voice?.stop();
    songDone = song.stop(0);
    flight?.finish();
    flight?.clear();
    document.removeEventListener("visibilitychange", hidden);
    window.removeEventListener("resize", idle);
    window.removeEventListener("keydown", onKey, true);
    layer.remove();
    leave();
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();

  const shown = (async () => {
    // The font is settled before the stream starts, so no letter swaps.
    await race(
      Promise.all([
        wait(BLACK_MS),
        Promise.race([document.fonts?.ready, wait(LOAD_LIMIT_MS)]),
      ]),
    );
    if (!leaving && cardOnly) {
      phase = "title";
      showWake();
    } else if (!leaving) {
      phase = layer.dataset.phase = "ack";
      layer.append(panel);
      write(reduced);
      // No ring until the keyboard moves; Tab shows it.
      next.focus({ preventScroll: true, focusVisible: false });
    }
    await left;
    if (signal?.aborted) return;
    if (dealOrigin) {
      const hand = document.getElementById("hand");
      const visibility = hand?.style.visibility ?? "";
      if (hand) hand.style.visibility = "hidden";
      try {
        phase = layer.dataset.phase = "logo-out";
        hint.hidden = true;
        privacy.hidden = true;
        await image
          .animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: reduced || skipFlight ? 0 : OPENING_DEAL.logoMs,
            fill: "forwards",
          })
          .finished.catch(() => {});
        if (!reduced && !skipFlight) {
          flight = await dealOpeningHand(layer, dealOrigin);
          // Replace the still-visible box only when the covered cards exist.
          row.hidden = true;
          phase = layer.dataset.phase = "dealing";
          layer.animate(
            [{ backgroundColor: "#000" }, { backgroundColor: "transparent" }],
            {
              duration: OPENING_DEAL.flightMs,
              fill: "forwards",
            },
          );
          if (skipFlight) flight.finish();
          await flight.finished;
        }
        flight?.clear();
        if (hand) hand.style.visibility = visibility;
        // The actual avatar is first uncovered here, in its final hand slot.
        if (signal?.aborted) return;
        wake();
        phase = layer.dataset.phase = "landed";
        layer.remove();
        window.removeEventListener("keydown", onKey, true);
        const avatar =
          wakeId &&
          document.querySelector(
            `#hand .card[data-card="${CSS.escape(wakeId)}"]`,
          );
        avatar?.focus({ preventScroll: true });
        if (avatar && !skipFlight) {
          const motion = avatar.animate(
            reduced
              ? [
                  { filter: "brightness(1)" },
                  { filter: "brightness(1.35)" },
                  { filter: "brightness(1)" },
                ]
              : [
                  { translate: "0 0" },
                  { translate: "0 -14px", offset: 0.4 },
                  { translate: "0 0" },
                ],
            { duration: OPENING_DEAL.landMs, easing: "ease-out" },
          );
          await motion.finished.catch(() => {});
        }
      } finally {
        flight?.clear();
        if (hand) hand.style.visibility = visibility;
        layer.remove();
        window.removeEventListener("keydown", onKey, true);
      }
      return;
    }
    window.removeEventListener("keydown", onKey, true);
    // To black, a breath of it, then the scene slowly comes up.
    const { blackMs, darkMs, sceneMs } = fades;
    phase = layer.dataset.phase = "dark";
    const dark = element("div", "title-dark");
    layer.append(dark);
    await fade(dark, blackMs).finished.catch(() => {});
    await wait(darkMs);
    layer.dataset.phase = "out";
    await layer
      .animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: sceneMs,
        easing: "ease-out",
        fill: "both",
      })
      .finished.catch(() => {});
    layer.remove();
  })();
  shown.then(() => signal?.removeEventListener("abort", abort));
  // The Pip box is the whole page until it is opened: the table behind it is
  // out of reach of keys and assistive technology, and takes focus after.
  if (cardOnly) {
    layer.dataset.held = "true";
    document.body.inert = true;
    const release = () => {
      document.body.inert = false;
      if (wakeId)
        document
          .querySelector(`#hand .card[data-card="${CSS.escape(wakeId)}"]`)
          ?.focus({ preventScroll: true });
    };
    shown.then(release, release);
  }
  const hold = shown.then(() => songDone);
  musicHold = hold;
  hold.then(() => {
    if (musicHold === hold) musicHold = null;
  });
  return shown;
}
