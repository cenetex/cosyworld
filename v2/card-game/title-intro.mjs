import landings from "./pack-landings.json" with { type: "json" };
import { PLAYING_KEY, SAVE_BASE } from "./avatar-world.mjs";
import { imageUrl } from "./images.mjs";
import { LOGOS, logoSite, showToolbarLogo, worldLogo } from "./title-logo.mjs";
import { createTitleSong } from "./title-song.mjs";

// The Lonely Forest title opens every new world: black, the world's logo
// (title-logo.mjs), its song and Wake button, then the table. A reload or a return to a world never replays it.
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

// The Wake button names the avatar this world opens with. The table boots
// under the title and names it here once the world is known.
let wakeName = "",
  wakeButton = null;
export const wakeLabel = (name) => (name ? `Wake ${name}` : "Wake up");
export function nameTitleWaker(name) {
  wakeName = typeof name === "string" ? name.trim() : "";
  if (wakeButton) wakeButton.textContent = wakeLabel(wakeName);
}

// No room music plays under the title, nor until its song has faded out:
// app.mjs waits for this promise (null when no title is up).
let musicHold = null;
export const titleMusicHold = () => musicHold;

// The overlay sits outside the inert body and over the table, which boots
// and asks for Vale's opening line underneath it. The logo waits, silent, for
// the first tap or key: that gesture starts the title song (title-song.mjs),
// lifts the logo and shows the Wake button. Wake fades the song and enters;
// Escape skips straight in. Resolves when the overlay is gone.
export function playTitleIntro({
  logo = LOGOS[0],
  storage = globalThis.localStorage,
  song = createTitleSong({ storage }),
} = {}) {
  try {
    storage.removeItem(INTRO_KEY);
  } catch {}
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const layer = document.createElement("div");
  layer.className = "title-intro";
  layer.dataset.phase = "black";
  layer.setAttribute("role", "img");
  layer.setAttribute("aria-label", logo.name);
  const image = document.createElement("img");
  image.alt = "";
  image.decoding = "async";
  const source = logo.src;
  layer.dataset.title = source;
  layer.append(image);
  document.documentElement.append(layer);

  let woken = false,
    leaving = false,
    songDone = Promise.resolve(),
    leave;
  const left = new Promise((resolve) => (leave = resolve));
  const finish = () => {
    if (leaving) return;
    leaving = true;
    songDone = song.stop(1);
    leave();
  };
  const button = document.createElement("button");
  button.type = "button";
  button.className = "title-wake";
  button.addEventListener("click", finish);
  // The first gesture on the title: the song, the lifted logo, Wake.
  const wake = () => {
    if (woken || leaving) return;
    woken = true;
    song.start();
    layer.dataset.phase = "wake";
    layer.removeAttribute("role");
    layer.setAttribute("role", "dialog");
    layer.setAttribute("aria-modal", "true");
    image.alt = logo.name;
    image.getAnimations().forEach((animation) => animation.finish());
    image.animate(
      [
        { opacity: 1, transform: "none" },
        { opacity: 1, transform: "translateY(-14dvh) scale(0.8)" },
      ],
      { duration: reduced ? 0 : 900, easing: "ease", fill: "both" },
    );
    wakeButton = button;
    button.textContent = wakeLabel(wakeName);
    layer.append(button);
    button.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: reduced ? 250 : 600,
      delay: reduced ? 0 : 300,
      easing: "ease",
      fill: "both",
    });
    button.focus({ preventScroll: true });
  };
  const onPointer = (event) => {
    if (event.target !== button) wake();
  };
  const onKey = (event) => {
    if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      finish();
      return;
    }
    // Enter and Space press the focused Wake button themselves.
    if (woken && event.target === button && [" ", "Enter"].includes(event.key))
      return;
    event.preventDefault();
    if (woken) button.focus({ preventScroll: true });
    else wake();
  };
  layer.addEventListener("pointerdown", onPointer);
  // Keep focus on Wake rather than the tapped title.
  layer.addEventListener("mousedown", (event) => {
    if (event.target !== button) event.preventDefault();
  });
  window.addEventListener("keydown", onKey, true);
  const step = (promise) => Promise.race([promise, left]);

  const loaded = new Promise((resolve) => {
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    setTimeout(() => resolve(false), LOAD_LIMIT_MS);
  });
  image.src = imageUrl(source);

  const shown = (async () => {
    const [ok] = await Promise.all([step(loaded), step(wait(BLACK_MS))]);
    if (ok && !leaving) {
      if (!woken) layer.dataset.phase = "title";
      await step(
        image.animate(
          reduced || woken
            ? [{ opacity: 0 }, { opacity: 1 }]
            : [
                { opacity: 0, transform: "scale(0.97)" },
                { opacity: 1, transform: "scale(1)" },
              ],
          { duration: reduced ? 250 : 900, easing: "ease", fill: "both" },
        ).finished,
      ).catch(() => {});
      // The logo holds until the player wakes their avatar or skips.
      await left;
    } else finish();
    const quick = reduced || !ok;
    layer.dataset.phase = "out";
    window.removeEventListener("keydown", onKey, true);
    await layer
      .animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: quick ? 250 : 900,
        easing: "ease",
        fill: "both",
      })
      .finished.catch(() => {});
    layer.remove();
    if (wakeButton === button) wakeButton = null;
  })();
  const hold = shown.then(() => songDone);
  musicHold = hold;
  hold.then(() => {
    if (musicHold === hold) musicHold = null;
  });
  return shown;
}
