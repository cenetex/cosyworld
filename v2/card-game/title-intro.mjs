import acknowledgement from "./acknowledgement.json" with { type: "json" };
import landings from "./pack-landings.json" with { type: "json" };
import { PLAYING_KEY, SAVE_BASE } from "./avatar-world.mjs";
import { imageUrl } from "./images.mjs";
import { count } from "./metrics.mjs";
import { revealCard } from "./card-reveal.mjs";
import { LOGOS, logoSite, showToolbarLogo, worldLogo } from "./title-logo.mjs";
import { createTitleSong } from "./title-song.mjs";
import {
  createRevealPainter,
  createTextReveal,
  letterDelay,
  letterSpans,
  splitLetters,
} from "./dialogue.mjs";

// The Lonely Forest title opens every new world: black, the land
// acknowledgement (acknowledgement.json), the world's logo (title-logo.mjs)
// with its song, a face-down card that turns to the avatar, then the table. A reload or a return to a world never replays it.
// The key holds the id of a shared world just created or joined whose title
// is still due.
export const INTRO_KEY = "cosyworld.title-intro";
export const TITLES = LOGOS.map((logo) => logo.src);
const BLACK_MS = 350,
  LOAD_LIMIT_MS = 2500;
// Left alone, the face-down card glows faintly (style.css) after idleGlowMs,
// then "tap to reveal" shows under it at hintMs. A tap, a key or a pointer
// over the card starts the wait again.
export const REVEAL_HINT = { idleGlowMs: 3000, hintMs: 6000 };
// Leaving: the turned face holds, the song fades as the title goes to black,
// black holds a breath, then slowly opens on the world's scene. Escape is the
// short way; reduced motion cuts to black and crossfades quickly.
export const WAKE_FADE = {
  turn: {
    holdMs: 700,
    songSeconds: 1.8,
    blackMs: 900,
    darkMs: 300,
    sceneMs: 2500,
  },
  skip: { songSeconds: 1, blackMs: 250, darkMs: 100, sceneMs: 800 },
  reduced: { blackMs: 0, darkMs: 300, sceneMs: 300 },
};

// Only on Lonely Forest: no other site's landing, not the local CosyWorld
// app, no table or pack link. Automated browsers need `intro=1`.
export function titleIntroAllowed({ href, local, webdriver }) {
  if (local) return false;
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
export function queueTitleIntro(world, storage = globalThis.localStorage) {
  try {
    storage.setItem(INTRO_KEY, world);
  } catch {}
}

// New game on the local table picks its own logo and plays the title at once.
export function playNewWorldIntro() {
  const context = pageContext();
  let storage = null;
  try {
    storage = localStorage;
  } catch {}
  if (!logoSite(context)) return;
  const logo = worldLogo({ href: context.href, storage, fresh: true });
  showToolbarLogo(logo);
  // The New game click is long past: the title still waits for its own tap.
  if (titleIntroAllowed(context))
    playTitleIntro({ storage: null, logo, song: createTitleSong({ storage }) });
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
// it, a spaced dash too; the larger breath wins). Each line is set as
// written, wrapping under a hanging indent on a narrow screen. About 18
// seconds; a tap shows the rest, and the cue follows.
export const STANZA_MS = 650;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Where each pause falls: its line, the word's span in it, and the offset
// its breath follows.
export function acknowledgementPauses({ stanzas, pauses = [] }) {
  const lines = stanzas.flat();
  return pauses.flatMap(({ word, occurrence = 1, pauseMs }) => {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${escape(word)}(?![\\p{L}\\p{N}])(?:[.,;:!?…—]|\\s—)*`,
      "gu",
    );
    let seen = 0;
    for (const [line, text] of lines.entries())
      for (const { index, 0: match } of text.matchAll(pattern))
        if (++seen === occurrence)
          return [
            {
              word,
              pauseMs,
              line,
              start: index,
              end: index + word.length,
              hold: index + match.length,
            },
          ];
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
  return lines.flatMap((text, line) => {
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
}
// Real text from acknowledgement.json, set like a film's opening card.
function acknowledgementPanel() {
  const glyphs = [];
  const streamed = (words) => {
    const part = document.createDocumentFragment();
    part.append(...letterSpans(words));
    glyphs.push(...part.children);
    return part;
  };
  const panel = element("section", "title-ack");
  const text = element("div", "title-ack-text");
  text.tabIndex = 0;
  text.setAttribute("role", "region");
  text.setAttribute("aria-label", acknowledgement.title);
  for (const stanza of acknowledgement.stanzas) {
    const paragraph = element("p");
    for (const words of stanza) {
      const row = element("span", "title-ack-line");
      row.append(streamed(words));
      paragraph.append(row);
    }
    text.append(paragraph);
  }
  // A quiet line, still a real button for focus and Enter or Space.
  const tap = matchMedia("(pointer: coarse)").matches;
  const next = element(
    "button",
    "title-continue",
    `${tap ? "tap" : "click"} to continue`,
  );
  next.type = "button";
  panel.append(text, next);
  const delays = acknowledgementDelays(acknowledgement);
  const painter = createRevealPainter(text);
  const reveal = createTextReveal({
    delay: (letter, i) => delays[i],
    frame: (value) => {
      painter.paint(value);
      if (!value.complete || !("stream" in panel.dataset)) return;
      delete panel.dataset.stream;
      panel.dataset.written = "";
    },
  });
  // Visible by default: the cue waits only while the words write in.
  const write = (instant) => {
    if (!instant) panel.dataset.stream = "";
    painter.start(glyphs);
    const words = acknowledgement.stanzas.flat().join("");
    reveal.show("acknowledgement", words, null, { instant });
  };
  return { panel, next, reveal, write };
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
export function playTitleIntro({
  logo = LOGOS[0],
  storage = globalThis.localStorage,
  song = createTitleSong({ storage }),
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
  const { panel, next, reveal: words, write } = acknowledgementPanel();
  // The first gesture while it writes shows it whole (and starts the song,
  // as browsers ask); the next one continues. A hidden tab holds the pen.
  const hidden = () => words.pause(document.hidden);
  document.addEventListener("visibilitychange", hidden);
  const image = element("img");
  image.alt = "";
  image.decoding = "async";
  const source = logo.src;
  layer.dataset.title = source;
  layer.append(image);
  document.documentElement.append(layer);

  let phase = "black",
    leaving = false,
    songDone = Promise.resolve(),
    fades = WAKE_FADE.turn,
    leave;
  const left = new Promise((resolve) => (leave = resolve));
  const race = (promise) => Promise.race([promise, left]);
  // The song fades as the title goes to black; Escape takes the short way.
  const finish = (way = "turn") => {
    if (leaving) return;
    leaving = true;
    idle(false);
    words.cancel();
    document.removeEventListener("visibilitychange", hidden);
    fades = { ...WAKE_FADE[way], ...(reduced && WAKE_FADE.reduced) };
    songDone = song.stop(fades.songSeconds);
    wake();
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
  card.dataset.card = "title-traveller";
  card.setAttribute("aria-label", "Reveal your traveller");
  const back = element("img", "card-back");
  back.alt = "";
  back.src = imageUrl("./assets/card-back.webp", "card");
  card.append(back);
  const frame = element("div", "card-frame title-card");
  frame.append(card);
  // The way to turn it, under the card (never on it). The card's own name
  // says it to screen readers, so this line is hidden from them.
  const tap = matchMedia("(pointer: coarse)").matches;
  const hint = element("p", "title-hint", `${tap ? "tap" : "click"} to reveal`);
  hint.setAttribute("aria-hidden", "true");
  const row = element("div", "title-reveal");
  row.append(frame, hint, link("Privacy", "/privacy"));
  row.lastChild.className = "title-privacy";
  let idleTimers = [];
  const idle = (again = true) => {
    idleTimers.forEach(clearTimeout);
    delete row.dataset.idle;
    if (!again || phase !== "card" || leaving) return;
    const { idleGlowMs, hintMs } = REVEAL_HINT;
    idleTimers = [
      setTimeout(() => (row.dataset.idle = "glow"), idleGlowMs),
      setTimeout(() => (row.dataset.idle = "hint"), hintMs),
    ];
  };

  const loaded = new Promise((resolve) => {
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    setTimeout(() => resolve(false), LOAD_LIMIT_MS);
  });
  image.src = imageUrl(source);

  // The face is the avatar's card from the hand, as the table drew it. The
  // revealed card holds a moment, so the player sees who wakes, then enters.
  const turn = async () => {
    if (phase !== "card" || leaving) return;
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
    image.getAnimations().forEach((animation) => animation.finish());
    image.animate(
      [{ transform: "none" }, { transform: "translateY(-14dvh) scale(0.8)" }],
      {
        duration: reduced ? 0 : 900,
        easing: "ease",
        fill: "both",
      },
    );
    layer.append(row);
    fade(row, reduced ? 250 : 600, reduced ? 0 : 300);
    card.focus({ preventScroll: true });
    idle();
  };
  // The acknowledgement's gesture: the logo and the song.
  const showTitle = async () => {
    if (phase !== "ack" || leaving) return;
    phase = layer.dataset.phase = "title";
    song.start();
    layer.focus({ preventScroll: true });
    panel
      .animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: reduced ? 0 : 400,
        fill: "both",
      })
      .finished.then(
        () => panel.remove(),
        () => {},
      );
    if (!(await race(loaded)) || leaving) return showWake();
    image.alt = logo.name;
    await race(
      image
        .animate(
          reduced || phase !== "title"
            ? [{ opacity: 0 }, { opacity: 1 }]
            : [
                { opacity: 0, transform: "scale(0.97)" },
                { opacity: 1, transform: "scale(1)" },
              ],
          {
            duration: reduced ? 250 : 900,
            easing: "ease",
            fill: "both",
          },
        )
        .finished.catch(() => {}),
    );
    await race(wait(reduced ? 600 : 1200));
    showWake();
  };
  const advance = () => {
    if (phase === "ack" && !words.complete) {
      song.start();
      words.finish();
      return;
    }
    return phase === "ack" ? showTitle() : showWake();
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
    delete layer.dataset.pointer;
    idle();
    if (event.key === "Escape") {
      event.preventDefault();
      if (!leaving) count("intro.skip");
      finish("skip");
      return;
    }
    // Tab moves between the step's links and button; Enter and Space press
    // them; the arrows scroll the acknowledgement.
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

  const shown = (async () => {
    // The font is settled before the stream starts, so no letter swaps.
    await race(
      Promise.all([
        wait(BLACK_MS),
        Promise.race([document.fonts?.ready, wait(LOAD_LIMIT_MS)]),
      ]),
    );
    if (!leaving) {
      phase = layer.dataset.phase = "ack";
      layer.append(panel);
      write(reduced);
      // No ring until the keyboard moves; Tab shows it.
      next.focus({ preventScroll: true, focusVisible: false });
    }
    await left;
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
  const hold = shown.then(() => songDone);
  musicHold = hold;
  hold.then(() => {
    if (musicHold === hold) musicHold = null;
  });
  return shown;
}
