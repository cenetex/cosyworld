import { accountRevision } from "./account-revision.mjs";
import { imageUrl } from "./images.mjs";
import { packPeople } from "./pack-registry.mjs";

const resident = "elysium-resident";
const spiral = "elysium-gold-spiral";
// A final probe follows the server's five-minute generation retry cooldown.
const retryDelays = [
  1500, 3500, 8000, 16000, 30000, 30000, 30000, 30000, 30000, 135000,
];
const maxPortraitBytes = 8 * 1024 * 1024;

async function decodedPortrait(blob) {
  const reader = new FileReader();
  const source = await new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  const image = new Image();
  image.src = source;
  await image.decode();
  return source;
}

export function createElysiumPortrait(worldId, redraw) {
  const endpoint =
    worldId &&
    `/card-game/shared/worlds/${encodeURIComponent(worldId)}/elysium-portrait`;
  let portrait = null,
    checkedRevision = null,
    request = null;
  let suspended = false,
    authorized = true;

  function stop() {
    clearTimeout(request?.timer);
    request?.controller.abort();
    request = null;
  }

  function forget() {
    if (portrait === null) return false;
    const fallback = `./${packPeople[resident].portrait}`;
    for (const image of document.images)
      if (image.getAttribute("src") === portrait)
        image.src = imageUrl(
          fallback,
          image.closest("#stage") ? "stage" : "card",
        );
    portrait = null;
    return true;
  }

  function clear() {
    stop();
    checkedRevision = null;
    if (forget()) redraw();
  }

  function revoke() {
    authorized = false;
    clear();
  }

  if (endpoint) {
    window.addEventListener("pagehide", () => {
      suspended = true;
      clear();
    });
    window.addEventListener("pageshow", (event) => {
      if (!event.persisted) return;
      suspended = false;
      redraw();
    });
  }

  async function probe(active, attempt) {
    let source;
    try {
      const response = await fetch(endpoint, {
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers: accountRevision.headers(),
        signal: AbortSignal.any([
          active.controller.signal,
          AbortSignal.timeout(10000),
        ]),
      });
      if (request !== active) return;
      if ([401, 403, 409].includes(response.status)) {
        revoke();
        return;
      }
      if (response.ok && response.headers.get("content-type") === "image/png") {
        const blob = await response.blob();
        if (blob.size > 0 && blob.size <= maxPortraitBytes)
          source = await decodedPortrait(blob);
      }
    } catch {
      // The authored portrait remains while the generated image is unavailable.
    }
    if (request !== active) return;
    if (source) {
      portrait = source;
      request = null;
      redraw();
      return;
    }
    if (attempt === retryDelays.length) request = null;
    else
      active.timer = setTimeout(
        () => void probe(active, attempt + 1),
        retryDelays[attempt],
      );
  }

  return {
    get ready() {
      return portrait !== null;
    },
    revoke,
    source: (id, sleeping) => (id === resident && !sleeping ? portrait : null),
    observe(world, actor) {
      if (!endpoint) return;
      const opened = world.opened?.[spiral];
      const earned =
        authorized && !suspended && Array.isArray(opened) && opened.length > 0;
      const here = world.actors[actor]?.place;
      if (!earned) forget();
      if (!earned || !here || world.actors[resident]?.place !== here) {
        stop();
        checkedRevision = null;
        return;
      }
      if (portrait || request || checkedRevision === world.revision) return;
      checkedRevision = world.revision;
      request = { controller: new AbortController(), timer: null };
      void probe(request, 0);
    },
  };
}
