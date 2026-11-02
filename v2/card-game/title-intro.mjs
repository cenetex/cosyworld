import landings from "./pack-landings.json" with { type: "json" };
import { PLAYING_KEY, SAVE_BASE } from "./avatar-world.mjs";
import { imageUrl } from "./images.mjs";

// The Lonely Forest title opens every new world: black, one of the two
// wordmarks, then the table. A reload or a return to a world never replays it.
// The key holds the id of a shared world just created or joined whose title
// is still due.
export const INTRO_KEY = "cosyworld.title-intro";
export const TITLES = [
  "assets/title/lonely-forest-1.webp",
  "assets/title/lonely-forest-2.webp",
];
const BLACK_MS = 350,
  HOLD_MS = 3500,
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

// New game on the local table plays the title at once.
export function playNewWorldIntro() {
  if (titleIntroAllowed(pageContext())) playTitleIntro({ storage: null });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The overlay sits outside the inert body and over the table, which boots
// and asks for Vale's opening line underneath it. Resolves when it is gone.
export function playTitleIntro({
  random = Math.random,
  storage = globalThis.localStorage,
} = {}) {
  try {
    storage.removeItem(INTRO_KEY);
  } catch {}
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const layer = document.createElement("div");
  layer.className = "title-intro";
  layer.dataset.phase = "black";
  layer.setAttribute("role", "img");
  layer.setAttribute("aria-label", "Lonely Forest");
  const image = document.createElement("img");
  image.alt = "";
  image.decoding = "async";
  const source = TITLES[Math.floor(random() * TITLES.length) % TITLES.length];
  layer.dataset.title = source;
  layer.append(image);
  document.documentElement.append(layer);

  let skipped = false,
    skip;
  const skipping = new Promise((resolve) => (skip = resolve));
  const onSkip = (event) => {
    if (event.type === "keydown") {
      event.preventDefault();
      event.stopPropagation();
    }
    skipped = true;
    skip();
  };
  layer.addEventListener("pointerdown", onSkip);
  window.addEventListener("keydown", onSkip, true);
  // Either the step finishes or the player skips the rest.
  const step = (promise) => Promise.race([promise, skipping]);
  const fade = (target, keyframes, ms) =>
    step(
      target.animate(keyframes, { duration: ms, easing: "ease", fill: "both" })
        .finished,
    ).catch(() => {});

  const loaded = new Promise((resolve) => {
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    setTimeout(() => resolve(false), LOAD_LIMIT_MS);
  });
  image.src = imageUrl(source);

  return (async () => {
    const [ok] = await Promise.all([step(loaded), step(wait(BLACK_MS))]);
    const shown = ok && !skipped;
    if (shown) {
      layer.dataset.phase = "title";
      await fade(
        image,
        reduced
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, transform: "scale(0.97)" },
              { opacity: 1, transform: "scale(1)" },
            ],
        reduced ? 250 : 900,
      );
      if (!skipped) await step(wait(HOLD_MS));
    }
    layer.dataset.phase = "out";
    window.removeEventListener("keydown", onSkip, true);
    await layer
      .animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: skipped || reduced || !shown ? 250 : 900,
        easing: "ease",
        fill: "both",
      })
      .finished.catch(() => {});
    layer.remove();
  })();
}
