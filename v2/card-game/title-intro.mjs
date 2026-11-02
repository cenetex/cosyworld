import landings from "./pack-landings.json" with { type: "json" };
import { PLAYING_KEY, SAVE_BASE } from "./avatar-world.mjs";
import { imageUrl } from "./images.mjs";

// The Lonely Forest title plays once, the first time a browser opens the
// bare table address: black, one of the two wordmarks, then Vale's attic.
export const INTRO_KEY = "cosyworld.title-intro";
export const TITLES = [
  "assets/title/lonely-forest-1.webp",
  "assets/title/lonely-forest-2.webp",
];
const BLACK_MS = 350,
  HOLD_MS = 2000,
  LOAD_LIMIT_MS = 2500;

// Only a new arrival at the Lonely Forest root: no save, no world played
// before, no shared-world, table or pack link, no other site's landing and
// not the local CosyWorld app. Automated browsers skip it unless `?intro=1`
// asks for it. Storage that cannot be read shows it once per load.
export function titleIntroWanted({ href, storage, local, webdriver }) {
  if (local) return false;
  const url = new URL(href);
  const params = [...url.searchParams];
  const forced =
    params.length === 1 && params[0][0] === "intro" && params[0][1] === "1";
  if (params.length && !forced) return false;
  if (webdriver && !forced) return false;
  if (landings[url.hostname]) return false;
  try {
    return [SAVE_BASE, PLAYING_KEY, INTRO_KEY].every(
      (key) => storage.getItem(key) === null,
    );
  } catch {
    return true;
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The overlay sits outside the inert body and over the table, which boots
// and asks for Vale's opening line underneath it. Resolves when it is gone.
export function playTitleIntro({
  random = Math.random,
  storage = globalThis.localStorage,
} = {}) {
  try {
    storage.setItem(INTRO_KEY, "seen");
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
