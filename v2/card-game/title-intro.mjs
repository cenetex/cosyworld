import acknowledgement from "./acknowledgement.json" with { type: "json" };
import landings from "./pack-landings.json" with { type: "json" };
import { PLAYING_KEY, SAVE_BASE } from "./avatar-world.mjs";
import { imageUrl } from "./images.mjs";
import { count } from "./metrics.mjs";
import { revealCard } from "./card-reveal.mjs";
import { LOGOS, logoSite, showToolbarLogo, worldLogo } from "./title-logo.mjs";
import { createTitleSong } from "./title-song.mjs";
import { splitLetters } from "./dialogue.mjs";

// The Lonely Forest title opens every new world: black, the land
// acknowledgement (acknowledgement.json), the world's logo (title-logo.mjs)
// with its song, a face-down card that turns to the avatar, then the table. A reload or a return to a world never replays it.
// The key holds the id of a shared world just created or joined whose title
// is still due.
export const INTRO_KEY = "cosyworld.title-intro";
export const TITLES = LOGOS.map((logo) => logo.src);
const BLACK_MS = 350,
  LOAD_LIMIT_MS = 2500;

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
  const anchor = element("a", "", typeof text === "string" ? text : "");
  if (typeof text !== "string") anchor.append(text);
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noopener";
  return anchor;
};
// The acknowledgement arrives like streamed text: each letter fades in over
// `fade` ms, `letter` ms after the one before, with a breath after
// punctuation and between paragraphs, and a longer one before a short line
// so it lands. The whole is about 7 seconds; the credit and the cue follow.
// Every letter is in place from the start (transparent), so nothing
// reflows, and CSS runs the clock: no timer per letter.
export const STREAM = {
  letter: 9,
  stop: 130,
  pause: 50,
  paragraph: 500,
  short: 350,
  fade: 180,
};
const SHORT_LINE = 40;
const breath = (letter) =>
  /[.!?…]/u.test(letter)
    ? STREAM.stop
    : /[,;:—]/u.test(letter)
      ? STREAM.pause
      : 0;
// Real text from acknowledgement.json, set like a film's opening card.
function acknowledgementPanel() {
  let clock = 0;
  const streamed = (words) => {
    const part = document.createDocumentFragment();
    const letters = splitLetters(words);
    letters.forEach((letter, i) => {
      if (/^\s+$/u.test(letter)) part.append(letter);
      else {
        const span = element("span", "title-ack-ch", letter);
        span.style.animationDelay = `${Math.round(clock)}ms`;
        part.append(span);
      }
      clock += STREAM.letter + (i < letters.length - 1 ? breath(letter) : 0);
    });
    return part;
  };
  const panel = element("section", "title-ack");
  const text = element("div", "title-ack-text");
  text.tabIndex = 0;
  text.setAttribute("role", "region");
  text.setAttribute("aria-label", acknowledgement.title);
  acknowledgement.paragraphs.forEach(({ text: words, links = {}, note }, i) => {
    if (i)
      clock +=
        STREAM.paragraph + (words.length < SHORT_LINE ? STREAM.short : 0);
    const paragraph = element("p", note ? "title-ack-note" : "");
    const phrases = Object.keys(links);
    const split = phrases.length
      ? new RegExp(
          `(${phrases.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
        )
      : null;
    for (const part of split ? words.split(split) : [words])
      paragraph.append(
        links[part] ? link(streamed(part), links[part]) : streamed(part),
      );
    text.append(paragraph);
  });
  text.append(element("p", "title-credit", acknowledgement.credit));
  // A quiet line, still a real button for focus and Enter or Space.
  const tap = matchMedia("(pointer: coarse)").matches;
  const next = element(
    "button",
    "title-continue",
    `${tap ? "tap" : "click"} to continue`,
  );
  next.type = "button";
  panel.append(text, next);
  const streamMs = Math.round(clock + STREAM.fade);
  panel.style.setProperty("--stream-end", `${streamMs}ms`);
  return { panel, next, streamMs };
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
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const layer = element("div", "title-intro");
  layer.dataset.phase = "black";
  layer.tabIndex = -1;
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-label", logo.name);
  const { panel, next, streamMs } = acknowledgementPanel();
  // The first gesture during the stream shows it whole (and starts the
  // song, as browsers ask); the next one continues.
  let streamUntil = 0;
  const streaming = () =>
    "stream" in panel.dataset && performance.now() < streamUntil;
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
    leave;
  const left = new Promise((resolve) => (leave = resolve));
  const race = (promise) => Promise.race([promise, left]);
  // Waking lets the song ring on as the table shows; Escape fades it fast.
  const finish = (fadeSeconds = 3) => {
    if (leaving) return;
    leaving = true;
    songDone = song.stop(fadeSeconds);
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
  const row = element("div", "title-reveal");
  row.append(frame, link("Privacy", "/privacy"));
  row.lastChild.className = "title-privacy";

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
    await race(wait(800));
    finish();
  };
  card.addEventListener("click", turn);
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
    if (phase === "ack" && streaming()) {
      song.start();
      delete panel.dataset.stream;
      return;
    }
    return phase === "ack" ? showTitle() : showWake();
  };
  next.addEventListener("click", advance);
  layer.addEventListener("click", (event) => {
    if (!event.target.closest?.("a, button")) advance();
  });
  // A pointer hides the card's focus ring; the keyboard brings it back.
  layer.addEventListener("pointerdown", () => (layer.dataset.pointer = "true"));
  // Keep focus on the step's button rather than the tapped title.
  layer.addEventListener("mousedown", (event) => {
    if (!event.target.closest?.("a, button, .title-ack-text"))
      event.preventDefault();
  });
  const onKey = (event) => {
    if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
    event.stopPropagation();
    delete layer.dataset.pointer;
    if (event.key === "Escape") {
      event.preventDefault();
      if (!leaving) count("intro.skip");
      finish(1);
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
      // Visible by default; the stream is a CSS enhancement (style.css).
      if (!reduced) {
        panel.dataset.stream = "";
        streamUntil = performance.now() + streamMs + 600;
      }
      layer.append(panel);
      // No ring until the keyboard moves; Tab shows it.
      next.focus({ preventScroll: true, focusVisible: false });
    }
    await left;
    layer.dataset.phase = "out";
    window.removeEventListener("keydown", onKey, true);
    await layer
      .animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: reduced ? 250 : 900,
        easing: "ease",
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
