// Moving to another world, seat or table loads a new page. Instead of a cut,
// the page fades to black first, and the next page opens on that black and
// lifts it while its hand is dealt (card-entry.mjs). Opacity only, so
// reduced motion keeps it, shorter. Presentation only.
const KEY = "cosyworld.page-fade";
export const PAGE_FADE_MS = 320;
const reduced = () =>
  globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const duration = () => (reduced() ? PAGE_FADE_MS / 2 : PAGE_FADE_MS);

function veil(opacity) {
  const black = document.createElement("div");
  black.className = "page-fade";
  black.setAttribute("aria-hidden", "true");
  Object.assign(black.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    background: "#000",
    pointerEvents: "none",
    opacity: String(opacity),
  });
  document.body.append(black);
  return black;
}

// Fades to black, then runs `go` (a navigation or reload). The next page
// lifts the black.
export async function leavePage(go) {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {}
  const black = veil(0);
  await black
    .animate({ opacity: [0, 1] }, { duration: duration(), fill: "forwards" })
    .finished.catch(() => {});
  go();
}

// On a page opened by leavePage: the black lifts as the table comes in.
export function arrivePage() {
  try {
    if (!sessionStorage.getItem(KEY)) return null;
    sessionStorage.removeItem(KEY);
  } catch {
    return null;
  }
  const black = veil(1);
  const lift = black.animate(
    { opacity: [1, 0] },
    { duration: duration() * 1.5, fill: "forwards" },
  );
  lift.finished.then(
    () => black.remove(),
    () => black.remove(),
  );
  return lift;
}
