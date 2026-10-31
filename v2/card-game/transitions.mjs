import variants from "./image-variants.json" with { type: "json" };

// Presentation-only scene transitions. They read what the renderer already
// drew from the committed world and never touch rules, saves or the journal,
// so local and shared play look the same.

// A painting that changes while the place stays fades out over the new one:
// slowly as night falls or lifts, briefly for anything else (a lamp, a crossing
// opening). Travel keeps its veil and cuts. A card that joins the hand where
// the player stays (the ship docking) fades in.
export const CARD_ARRIVE_MS = 700;
export const CROSSFADE_MS = 4000;
export const CHANGE_FADE_MS = 900;

const fading = new WeakMap();
export function crossfadeImage(img, source, { duration = CROSSFADE_MS } = {}) {
  if (img.getAttribute("src") === source) return;
  const shown = img.getAttribute("src") && img.complete && img.naturalWidth;
  if (!duration || !shown) {
    img.src = source;
    return;
  }
  fading.get(img)?.remove();
  const ghost = img.cloneNode(false);
  const style = getComputedStyle(img);
  ghost.removeAttribute("id");
  ghost.alt = "";
  ghost.setAttribute("aria-hidden", "true");
  ghost.classList.add("backdrop-fading");
  // The old painting keeps the place's own framing and tone while it fades.
  ghost.style.filter = style.filter;
  ghost.style.objectPosition = style.objectPosition;
  ghost.style.pointerEvents = "none";
  img.after(ghost);
  fading.set(img, ghost);
  img.src = source;
  img
    .decode()
    .catch(() => {})
    .then(() => {
      if (!ghost.isConnected) return;
      return ghost.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration,
        easing: "ease-in-out",
        fill: "forwards",
      }).finished;
    })
    .catch(() => {})
    .finally(() => {
      ghost.remove();
      if (fading.get(img) === ghost) fading.delete(img);
    });
}

// A painted layer that comes and goes where the player stays (the ship
// drawing up at Black Pond) fades instead of jumping. It never takes clicks.
const showing = new WeakMap();
export function fadeLayer(el, show, { duration = CHANGE_FADE_MS } = {}) {
  const shown = showing.get(el) ?? !el.hidden;
  if (shown === show) return;
  showing.set(el, show);
  for (const motion of el.getAnimations()) motion.cancel();
  el.style.opacity = "";
  if (!duration) {
    el.hidden = !show;
    return;
  }
  el.hidden = false;
  const ready = show ? el.decode().catch(() => {}) : Promise.resolve();
  if (show) el.style.opacity = "0";
  ready.then(() => {
    if (showing.get(el) !== show) return;
    el.style.opacity = "";
    const fade = el.animate(
      { opacity: show ? [0, 1] : [1, 0] },
      { duration, easing: "ease-in-out", fill: "forwards" },
    );
    fade.finished
      .then(() => {
        if (!show) el.hidden = true;
        fade.cancel();
      })
      .catch(() => {});
  });
}

// Halloween: on some entries to a place, one figure or the painting itself is
// briefly something else. Change the window here; months count from 1.
export const HALLOWEEN_DAYS = ["10-31"];
// Each image has its own uncanny copy beside it: swede-seated.webp shows
// swede-seated-uncanny.webp, riverbank.webp shows riverbank-uncanny.webp. An
// image without a published copy never flickers, so art can arrive later
// without code changes.
export function uncannyVariant(source, published = variants.images) {
  const path = String(source || "").replace(/^\.?\//, "");
  const match = /^(assets\/.+?)(?:-uncanny)?\.(?:webp|png|jpg)$/.exec(path);
  const candidate = match && `${match[1]}-uncanny.webp`;
  return candidate && candidate !== path && published[candidate]
    ? candidate
    : null;
}
// One cut of at most 150 ms per entry, and none for 30 s after, stays far
// below three flashes a second (WCAG 2.3.1). The copy keeps the original's
// box and light filter, so nothing moves and the scene does not brighten.
export const FLASH_MS = 140;
export const QUIET_MS = 30_000;
export const FLASH_CHANCE = 0.4;
const SCARES_KEY = "cosyworld.scares";

export function isHalloween(
  date = new Date(),
  search = globalThis.location?.search,
) {
  const forced = new URLSearchParams(search || "").get("halloween");
  if (forced === "1" || forced === "0") return forced === "1";
  return HALLOWEEN_DAYS.includes(`${date.getMonth() + 1}-${date.getDate()}`);
}

export function scaresEnabled() {
  try {
    return localStorage.getItem(SCARES_KEY) !== "off";
  } catch {
    return true;
  }
}

// The settings button turns flashes and scares off for this browser.
export function installScaresToggle(button) {
  if (!button) return;
  const show = () => {
    const on = scaresEnabled();
    button.textContent = `Flashes and scares: ${on ? "on" : "off"}`;
    button.setAttribute("aria-pressed", String(on));
  };
  button.onclick = () => {
    try {
      localStorage.setItem(SCARES_KEY, scaresEnabled() ? "off" : "on");
    } catch {}
    show();
  };
  show();
}

// Decides one entry: which single image, if any, flickers. Sprites and the
// backdrop are candidates together, so they never cut at the same moment.
// Pure, so the gates are tested without a browser.
export function apparitionFor({
  sources = [],
  published = variants.images,
  entered,
  halloween,
  reduced,
  scares = true,
  now,
  last = -Infinity,
  random = Math.random,
}) {
  if (!entered || !halloween || reduced || !scares) return null;
  if (now - last < QUIET_MS) return null;
  const choices = sources
    .map((source, index) => ({
      index,
      variant: uncannyVariant(source, published),
    }))
    .filter(({ variant }) => variant);
  if (!choices.length || random() >= FLASH_CHANCE) return null;
  return choices[Math.floor(random() * choices.length) % choices.length];
}

const haunt = { place: null, last: -Infinity, timer: 0, ghost: null };

// The visible images on the stage that name their source: the painting and
// each figure.
function stageImages(stage) {
  return [
    ...(stage?.querySelectorAll("img[data-source]:not(.apparition)") || []),
  ].filter(
    (img) =>
      img.isConnected &&
      !img.closest("[hidden]") &&
      img.getClientRects().length,
  );
}

// Called after the scene is drawn. The uncanny copy is stacked on its image
// with the same classes and filter, and decodes before it is shown.
export function hauntScene(stage, place, { reduced, url = (s) => s }) {
  const entered = place !== haunt.place;
  haunt.place = place;
  if (!entered) return;
  clearTimeout(haunt.timer);
  haunt.ghost?.remove();
  haunt.ghost = null;
  const images = stageImages(stage);
  const choice = apparitionFor({
    sources: images.map((img) => img.dataset.source),
    entered,
    halloween: isHalloween(),
    reduced,
    scares: scaresEnabled(),
    now: performance.now(),
    last: haunt.last,
  });
  if (!choice) return;
  const original = images[choice.index];
  const ghost = original.cloneNode(false);
  const style = getComputedStyle(original);
  ghost.removeAttribute("id");
  ghost.removeAttribute("data-source");
  ghost.alt = "";
  ghost.setAttribute("aria-hidden", "true");
  ghost.classList.add("apparition");
  ghost.style.filter = style.filter;
  ghost.style.objectPosition = style.objectPosition;
  // A cast portrait sits in flow; its copy covers the same box.
  if (style.position === "static")
    Object.assign(ghost.style, { position: "absolute", inset: "0" });
  ghost.src = url(choice.variant);
  original.after(ghost);
  haunt.ghost = ghost;
  const settle = 900 + Math.random() * 1600;
  haunt.timer = setTimeout(async () => {
    try {
      await Promise.all([ghost.decode(), original.decode()]);
      // Wait for the travel veil to lift so the cut is seen, not wasted.
      for (let wait = 0; document.querySelector("#travel.travelling"); wait++) {
        if (wait > 30) throw new Error("still travelling");
        await new Promise((done) => setTimeout(done, 200));
      }
    } catch {
      ghost.remove();
      return;
    }
    if (
      !ghost.isConnected ||
      !original.isConnected ||
      document.hidden ||
      haunt.place !== place ||
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !scaresEnabled()
    ) {
      ghost.remove();
      return;
    }
    haunt.last = performance.now();
    ghost.style.filter = getComputedStyle(original).filter;
    ghost.dataset.flip = original.dataset.flip || "";
    ghost.dataset.showing = "true";
    setTimeout(() => {
      ghost.remove();
      if (haunt.ghost === ghost) haunt.ghost = null;
    }, FLASH_MS);
  }, settle);
}

// Weather turning while the player stays (a storm arriving, mist lifting,
// night falling) eases the stage shader's numbers instead of snapping.
export const WEATHER_EASE_MS = 6000;
export function blendUniforms(from, to, t) {
  if (!from || t >= 1) return to;
  const k = t <= 0 ? 0 : t * t * (3 - 2 * t);
  const mix = (a, b) => a + (b - a) * k;
  return Object.fromEntries(
    Object.entries(to).map(([key, value]) => [
      key,
      Array.isArray(value)
        ? value.map((v, i) => mix(from[key]?.[i] ?? v, v))
        : typeof value === "number"
          ? mix(from[key] ?? value, value)
          : value,
    ]),
  );
}
