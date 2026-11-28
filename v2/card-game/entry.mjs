import { accountStorage as storage } from "./account-reset-storage.mjs";
import { PLAYING_KEY } from "./avatar-world.mjs";
import { setupLocalService } from "./local-service.mjs";
import { showBuildInfo } from "./build-info.mjs";
import { arrivePage } from "./page-fade.mjs";
import { membersLock, request } from "./shared-auth.mjs";
import { playTitleIntro, titleIntroWanted } from "./title-intro.mjs";
import { logoSite, showToolbarLogo, worldLogo } from "./title-logo.mjs";
import { pipEntry } from "./pip-landing.mjs";
const page = {
  href: location.href,
  local: !!document.querySelector('meta[name="cosy-local-app"]'),
};
const authoring = /^\/make\/?$/u.test(location.pathname);
const startup = new AbortController();
let redirecting = false;
try {
  const hasSiteLogo = !authoring && logoSite(page);
  if (!hasSiteLogo) {
    const wordmark = document.querySelector(".brand strong");
    if (wordmark) wordmark.textContent = "COSYWORLD";
  }
  const local = await setupLocalService();
  // Capture identity before either surface starts work, including the maker.
  // A missing account route is permanent for this page. Other errors can retry.
  const account =
    !local &&
    (await request("/auth/account").catch((error) =>
      error.status === 404 ? null : undefined,
    ));
  // A members-only test server shows its sign-in lock instead of the table.
  const locked =
    !authoring && !local && account !== null && (await membersLock(account));
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
    if (!authoring && !local && !params.size && !pipEntry(location.href))
      resume = JSON.parse(storage.getItem(PLAYING_KEY) || "null");
  } catch {}
  if (locked) {
    // The lock stays until a known passkey signs in and the page reloads.
    arrivePage();
  } else if (resume?.world) {
    location.replace(`/?world=${encodeURIComponent(resume.world)}`);
    redirecting = true;
  } else {
    if (hasSiteLogo) {
      const intro = titleIntroWanted({
        ...page,
        storage,
        webdriver: navigator.webdriver,
      });
      const logo = worldLogo({ href: page.href, storage, fresh: intro });
      showToolbarLogo(logo);
      if (intro) playTitleIntro({ storage, logo, signal: startup.signal });
    }
    // Keep a navigation's arrival fade for the document that opens the table.
    arrivePage();
    if (authoring) await import("./authoring-entry.mjs");
    else await import("./app.mjs");
    const toolbar = document.querySelector(".top-actions");
    if (toolbar) toolbar.hidden = false;
  }
} catch (error) {
  // A failed module cannot safely be evaluated again in this document.
  // Retry reloads the page, preserving its URL and saved world.
  startup.abort();
  console.error("Could not open the table", error);
  const row = document.getElementById("speech-row");
  const retry = document.getElementById("dialogue-advance");
  if (row && retry) {
    for (const button of document.querySelectorAll("button"))
      button.disabled = true;
    document.getElementById("speaker").textContent =
      "The table could not open.";
    document.getElementById("dialogue-text").textContent = "Try again";
    row.hidden = retry.hidden = false;
    if (row.parentElement) row.parentElement.hidden = false;
    retry.disabled = false;
    retry.setAttribute("aria-label", "Try again");
    retry.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        retry.disabled = true;
        location.reload();
      },
      { capture: true, once: true },
    );
  }
} finally {
  // The Pip box keeps the table inert until it is opened (title-intro.mjs).
  document.body.inert = redirecting || Boolean(document.querySelector('.title-intro[data-held="true"]'));
}
if (!redirecting) showBuildInfo();
