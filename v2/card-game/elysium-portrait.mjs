import { accountRevision } from "./account-revision.mjs";
import { ELYSIUM_MODEL_IDS } from "./elysium-models.mjs";
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

async function readPortrait(response) {
  if (response.headers.get("content-type") !== "image/png") return null;
  const blob = await response.blob();
  return blob.size > 0 && blob.size <= maxPortraitBytes
    ? decodedPortrait(blob)
    : null;
}

async function readName(response) {
  const { name } = await response.json();
  const title = typeof name === "string" && name.trim();
  return title && title.length <= 80 ? title : null;
}

function clearImage(id, source) {
  const fallback = `./${packPeople[id].portrait}`;
  for (const image of document.images)
    if (image.getAttribute("src") === source)
      image.src = imageUrl(
        fallback,
        image.closest("#stage") ? "stage" : "card",
      );
}

function createResource(endpoint, read, changed, revoke, forget = () => {}) {
  let value = null,
    checkedRevision = null,
    request = null;

  function stop() {
    clearTimeout(request?.timer);
    request?.controller.abort();
    request = null;
  }

  function clear() {
    stop();
    checkedRevision = null;
    if (value === null) return;
    forget(value);
    value = null;
    changed(false);
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
      if (response.ok) source = await read(response);
    } catch {
      // Keep the authored art or anonymous title during a provider delay.
    }
    if (request !== active) return;
    if (source) {
      value = source;
      request = null;
      changed(true);
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
    get value() {
      return value;
    },
    clear,
    observe(earned, nearby, revision) {
      if (!earned) clear();
      else if (!nearby) {
        stop();
        checkedRevision = null;
      } else if (!value && !request && checkedRevision !== revision) {
        checkedRevision = revision;
        request = { controller: new AbortController(), timer: null };
        void probe(request, 0);
      }
    },
  };
}

export function createElysiumPortrait(worldId, redraw) {
  const prefix =
    worldId && `/card-game/shared/worlds/${encodeURIComponent(worldId)}`;
  const cast = new Map();
  let key = 0,
    started = false,
    suspended = false,
    authorized = true;

  function changed(refresh) {
    key++;
    if (refresh) redraw();
  }

  function clear() {
    const before = key;
    for (const { name, portrait } of cast.values()) {
      name?.clear();
      portrait.clear();
    }
    if (before !== key) redraw();
  }

  function revoke() {
    authorized = false;
    clear();
  }

  if (prefix) {
    for (const id of [resident, ...ELYSIUM_MODEL_IDS]) {
      if (!packPeople[id]) continue;
      const legacy = id === resident;
      const suffix = legacy ? "" : `/${encodeURIComponent(id)}`;
      const alias = packPeople[id].name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      cast.set(id, {
        seenTalk: false,
        waiting: false,
        alias: new RegExp(`\\b(?:the )?${alias}\\b`, "gi"),
        name: legacy
          ? null
          : createResource(
              `${prefix}/elysium-identity${suffix}`,
              readName,
              changed,
              revoke,
            ),
        portrait: createResource(
          `${prefix}/elysium-portrait${suffix}`,
          readPortrait,
          changed,
          revoke,
          (source) => clearImage(id, source),
        ),
      });
    }
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

  function text(value) {
    if (typeof value !== "string") return value;
    for (const { alias, name } of cast.values())
      if (name?.value) value = value.replace(alias, () => name.value);
    return value;
  }

  return {
    get key() {
      return key;
    },
    revoke,
    name: (id) => cast.get(id)?.name?.value,
    source: (id, sleeping) => (sleeping ? null : cast.get(id)?.portrait.value),
    text,
    reader: (read) => (value) => text(read(value)),
    observe(world, actor, line) {
      const active = authorized && !suspended;
      const here = world.actors[actor]?.place;
      for (const [id, view] of cast) {
        const nearby = Boolean(here && world.actors[id]?.place === here);
        const { scatteredAt, returnedAt } = world.elysiumEncounters?.[id] || {};
        // A new in-room introduction waits for its reply. A reload can use the saved Talk.
        if (scatteredAt && !view.seenTalk) view.waiting = started && nearby;
        if (!nearby || (line?.actorId === id && line.seq > scatteredAt))
          view.waiting = false;
        view.seenTalk = Boolean(scatteredAt);
        const ready =
          id === resident ? world.opened?.[spiral]?.length : returnedAt;
        view.name?.observe(
          active && scatteredAt && !view.waiting,
          nearby,
          world.revision,
        );
        view.portrait.observe(active && ready, nearby, world.revision);
      }
      started = true;
    },
  };
}
