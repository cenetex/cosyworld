import { setupLocalService } from "./local-service.mjs";
import { showBuildInfo } from "./build-info.mjs";
import { arrivePage } from "./page-fade.mjs";
import { membersLock } from "./shared-auth.mjs";
import { playTitleIntro, titleIntroWanted } from "./title-intro.mjs";
import { logoSite, showToolbarLogo, worldLogo } from "./title-logo.mjs";
// A new world opens with the Lonely Forest title over the booting table; the
// same logo stands in the toolbar for as long as that world is played.
let storage = null;
try {
  storage = localStorage;
} catch {}
const page = {
  href: location.href,
  local: !!document.querySelector('meta[name="cosy-local-app"]'),
};
const authoring = /^\/make\/?$/u.test(location.pathname);
const introWanted =
  !authoring &&
  titleIntroWanted({
    ...page,
    storage,
    webdriver: navigator.webdriver,
  });
if (!authoring && logoSite(page)) {
  // A bare address with no save is a new world: it never repeats the last logo.
  const logo = worldLogo({ href: page.href, storage, fresh: introWanted });
  showToolbarLogo(logo);
  if (introWanted) playTitleIntro({ storage, logo });
}
// A page another world or seat led to opens on its black and lifts it.
arrivePage();
const local = await setupLocalService();
// A members-only test server shows its sign-in lock instead of the table.
const locked = !authoring && !local && (await membersLock());
const params = new URLSearchParams(location.search);
// The old "Your worlds" address (`?shared=1`) is ☰ now (#1877).
if (!authoring && (params.has("shared") || (local && params.has("world")))) {
  params.delete("shared");
  if (local) params.delete("world");
  history.replaceState(null, "", `${location.pathname}?${params}`);
}
// The bare address resumes the shared world played last; otherwise it is
// Vale's local table (avatar-world.mjs, #1892).
let resume = null;
try {
  if (!authoring && !local && !params.size)
    resume = JSON.parse(localStorage.getItem("cosyworld.playing") || "null");
} catch {}
if (locked) {
  // The lock stays until a known passkey signs in and the page reloads.
} else if (authoring) await import("./authoring-entry.mjs");
else if (resume?.world)
  location.replace(`/?world=${encodeURIComponent(resume.world)}`);
else await import("./app.mjs");
document.body.inert = false;
showBuildInfo();
