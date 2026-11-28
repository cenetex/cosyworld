import { accountRevision } from "./account-revision.mjs";
import { accountStorage } from "./account-reset-storage.mjs";
import { ELYSIUM_MODEL_IDS, elysiumNameIndex, elysiumTalk, isLegacyElysiumLine, legacyElysiumName, validElysiumName } from "./elysium-models.mjs";
import { currentActor } from "./human-cast.mjs";
import { imageUrl } from "./images.mjs";
import { localRuntime } from "./local-service.mjs";
import { packPeople } from "./pack-registry.mjs";
import { hasSignedLocalIntroduction } from "./signed-words.mjs";
import { isCoordinateResident } from "./world/elysium-coordinates.mjs";

const resident = "elysium-resident";
const spiral = "elysium-gold-spiral";
export const UNNAMED_ELYSIUM_RESIDENT = "???";
const earlyRetryDelays = [1500, 3500, 8000, 16000];
const nameRetryDelays = [...earlyRetryDelays, ...Array(5).fill(30000), 135000];
// Allow for the five-minute cooldown and up to 172 seconds to draw again.
const portraitRetryDelays = [...earlyRetryDelays, ...Array(16).fill(30000)];
const maxPortraitBytes = 8 * 1024 * 1024;
const normalName = (name) => name.trim().replace(/ +/gu, " ");
const introductionName = (line) => Object.hasOwn(line, "elysiumName")
  ? line.elysiumName : legacyElysiumName(line.text);

function coordinateTalkAt(world, actor, id) {
  const home = packPeople[id].home;
  return world.conversations?.find(({ actors }) => actors.includes(actor) && actors.includes(id))?.seq ??
    world.log?.find((entry) => !entry.generated && entry.kind === "action" &&
      entry.verb === "talk" && entry.actorId === actor && entry.targetId === id &&
      entry.locationId === home && entry.fromLocationId === home)?.seq;
}

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

function createResource(send, read, changed, {
  revoke, forget = () => {}, delays, redrawStatus, pendingStatus,
}) {
  let value = null,
    checkedRevision = null,
    note = "",
    request = null;

  function setNote(text, notify = true) {
    if (!redrawStatus || note === text) return;
    note = text;
    if (notify) queueMicrotask(redrawStatus);
  }

  function stop() {
    clearTimeout(request?.timer);
    request?.controller.abort();
    request = null;
  }

  function clear() {
    stop();
    checkedRevision = null;
    setNote("", false);
    if (value === null) return;
    forget(value);
    value = null;
    changed(false);
  }

  async function probe(active, attempt) {
    let source, waiting = false;
    try {
      const response = await send({
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers: accountRevision.headers(),
        signal: AbortSignal.any([
          active.controller.signal,
          AbortSignal.timeout(10000),
        ]),
      }, active.data);
      if (request !== active) return;
      if ([401, 403, 409].includes(response.status)) {
        stop();
        if (revoke) revoke();
        else setNote("Portrait unavailable.");
        return;
      }
      waiting = response.status === pendingStatus &&
        response.headers?.get("X-Cosyworld-Portrait-Status") !== "retrying";
      if (response.ok) source = await read(response);
    } catch {
      // Keep the authored art or anonymous title during a provider delay.
    }
    if (request !== active) return;
    if (source) {
      value = source;
      request = null;
      setNote("", false);
      changed(true);
      return;
    }
    if (attempt === delays.length) {
      request = null;
      setNote("Portrait unavailable.");
    } else {
      setNote(waiting ? "Portrait pending." : "Retrying portrait.");
      active.timer = setTimeout(
        () => void probe(active, attempt + 1),
        delays[attempt],
      );
    }
  }

  return {
    get value() {
      return value;
    },
    get note() {
      return note;
    },
    clear,
    observe(earned, available, revision, data) {
      if (!earned) clear();
      else if (!available) {
        stop();
        checkedRevision = null;
        setNote("", false);
      } else if (!value && !request && checkedRevision !== revision) {
        checkedRevision = revision;
        request = { controller: new AbortController(), timer: null, data };
        setNote("Portrait pending.");
        void probe(request, 0);
      }
    },
  };
}

export function createElysiumPortrait(worldId, redraw, saveKey, storage = accountStorage) {
  const prefix =
    worldId && `/card-game/shared/worlds/${encodeURIComponent(worldId)}`;
  const personalKey = !prefix && saveKey && `${saveKey}.elysium-names`;
  const personalPortraits = personalKey && !localRuntime();
  const cast = new Map();
  let key = 0,
    started = false,
    suspended = false,
    authorized = true,
    personalWorld = null,
    personalSeed,
    personalNames = {};

  function changed(refresh) {
    key++;
    if (refresh) redraw();
  }

  function clear() {
    const before = key;
    for (const { name, portrait } of cast.values()) {
      name?.clear();
      portrait?.clear();
    }
    if (before !== key) redraw();
  }

  function revoke() {
    authorized = false;
    clear();
  }

  const coordinates = Object.keys(packPeople).filter(isCoordinateResident);
  for (const id of [resident, ...ELYSIUM_MODEL_IDS, ...coordinates]) {
    if (!packPeople[id]) continue;
    const legacy = id === resident;
    const coordinate = isCoordinateResident(id);
    const suffix = legacy ? "" : `/${encodeURIComponent(id)}`;
    const alias = packPeople[id].name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const requestPortrait = coordinate ? null : prefix
      ? (init) => fetch(`${prefix}/elysium-portrait${suffix}`, init)
      : personalPortraits && !legacy
        ? (init, receipt) => fetch(`/card-game/elysium-portrait${suffix}`, {
            ...init,
            method: "POST",
            headers: { ...init.headers, "Content-Type": "application/json" },
            body: JSON.stringify(receipt),
          })
        : null;
    cast.set(id, {
      coordinate,
      seenTalk: false,
      waiting: false,
      alias: legacy ? null : new RegExp(`\\b(?:the )?${alias}\\b`, "gi"),
      name: prefix && !legacy
        ? createResource(
            (init) => fetch(`${prefix}/elysium-identity${suffix}`, init),
            readName,
            changed,
            { revoke, delays: nameRetryDelays },
          )
        : null,
      portrait: requestPortrait
        ? createResource(
            requestPortrait,
            readPortrait,
            changed,
            {
              revoke: prefix ? revoke : null,
              forget: (source) => clearImage(id, source),
              delays: portraitRetryDelays,
              redrawStatus: redraw,
              pendingStatus: prefix ? 404 : 202,
            },
          )
        : null,
    });
  }
  if (typeof window !== "undefined" && (prefix || personalPortraits)) {
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

  function sync(world) {
    if (!personalKey) return;
    const seed = world.run?.seed;
    const newRun = personalSeed !== seed;
    if (newRun) {
      personalSeed = seed;
      personalNames = {};
      try {
        const saved = JSON.parse(storage.getItem(personalKey));
        if (saved?.seed === seed && saved.names &&
          typeof saved.names === "object" && !Array.isArray(saved.names)) personalNames = saved.names;
      } catch { /* A blocked store only lasts for this page. */ }
      changed(false);
    }
    if (personalPortraits) {
      for (const id of ELYSIUM_MODEL_IDS) {
        const view = cast.get(id);
        if (!view?.portrait) continue;
        const { scatteredAt, talkedAt = scatteredAt, returnedAt, returnedBy } =
          world.elysiumEncounters?.[id] || {};
        const receipt = returnedAt
          ? { scatteredAt, talkedAt, returnedAt, returnedBy }
          : null;
        const receiptKey = receipt && JSON.stringify(receipt);
        if (newRun || receiptKey !== view.receiptKey) {
          view.portrait.clear();
          view.receiptKey = receiptKey;
          view.receipt = receipt;
        }
      }
    }
    personalWorld = world;
  }

  function personalName(id) {
    if (!personalWorld) return null;
    const saved = personalNames[id];
    if (!saved) return null;
    const { scatteredAt, talkedAt = scatteredAt } = personalWorld.elysiumEncounters?.[id] || {};
    const firstTalk = cast.get(id)?.coordinate
      ? coordinateTalkAt(personalWorld, currentActor(personalWorld), id)
      : talkedAt;
    return firstTalk && saved.talkedAt === firstTalk && saved.seq > firstTalk &&
      saved.seq <= personalWorld.eventSeq && validElysiumName(saved.name) ? saved.name : null;
  }

  function learn(world, actor, line, title, talkedAt) {
    if (!hasSignedLocalIntroduction(line, world.revision, storage) ||
      !elysiumTalk(world, actor, line.actorId, line.locationId, line.turn, line.seq)) return;
    personalNames[line.actorId] = { name: normalName(title), talkedAt, seq: line.seq };
    try {
      storage.setItem(personalKey, JSON.stringify({ seed: world.run.seed, names: personalNames }));
    } catch { /* The revealed name is still available on this page. */ }
    changed(false);
    queueMicrotask(redraw);
  }

  function name(id) {
    const view = cast.get(id);
    return view?.alias ? view.name?.value ?? personalName(id) ?? UNNAMED_ELYSIUM_RESIDENT : null;
  }

  function text(value) {
    if (typeof value !== "string") return value;
    for (const [id, { alias }] of cast)
      if (alias) value = value.replace(alias, () => name(id));
    return value;
  }

  function reader(read, covered = () => true) {
    const caption = (value, line) => text(read(value, line));
    return (value, line) => {
      if (line?.text === value && isLegacyElysiumLine(line)) return "";
      const view = cast.get(line?.actorId);
      if (line?.generated && !line.silent && line.kind === "dialogue" &&
        line.text === value && view?.alias) {
        const title = view.coordinate ? line.elysiumName : introductionName(line);
        const index = elysiumNameIndex(value, title);
        if (index >= 0 && !covered(line.actorId)) {
          const deliveredByGame = prefix
            ? authorized && !suspended
            : personalName(line.actorId) === normalName(title) ||
              hasSignedLocalIntroduction(line, personalWorld?.revision, storage);
          if (deliveredByGame)
            return caption(value.slice(0, index)) + title + caption(value.slice(index + title.length));
        }
      }
      return caption(value, line);
    };
  }

  return {
    get key() {
      return key;
    },
    revoke,
    sync,
    name,
    ready(world) {
      if (!personalPortraits || !authorized || suspended) return [];
      sync(world);
      const ready = [];
      for (const resident of ELYSIUM_MODEL_IDS) {
        const view = cast.get(resident);
        const returnedAt = view?.receipt?.returnedAt;
        if (returnedAt && view.portrait.value &&
          world.elysiumEncounters[resident].portraitReady !== true)
          ready.push({ resident, returnedAt });
      }
      return ready;
    },
    withIntroduction(context) {
      const card = context.outcome?.card;
      return card?.kind === "talk" && personalName(card.target)
        ? { ...context, elysiumIntroduced: card.target }
        : context;
    },
    source: (id, sleeping) => (sleeping ? null : cast.get(id)?.portrait?.value),
    note: (id) => cast.get(id)?.portrait?.note || "",
    text,
    reader,
    observe(world, actor, line) {
      sync(world);
      const active = authorized && !suspended;
      const viewer = world.actors[actor];
      const here = viewer?.place;
      for (const [id, view] of cast) {
        const nearby = Boolean(here && world.actors[id]?.place === here);
        const { scatteredAt, talkedAt: tokenTalk = scatteredAt, returnedAt, portraitReady } =
          world.elysiumEncounters?.[id] || {};
        const talkedAt = view.coordinate ? coordinateTalkAt(world, actor, id) : tokenTalk;
        if (talkedAt && !view.seenTalk) view.waiting = started && nearby;
        // Recover a saved introduction after an interrupted read. A newly
        // streamed coordinate reply still waits for its visible line.
        const recover = view.coordinate
          ? !started && personalKey && !personalName(id)
          : view.waiting || (personalKey && !personalName(id));
        const saved = active && nearby && talkedAt && line?.actorId !== id &&
          recover && world.log?.findLast((entry) =>
            entry.actorId === id && entry.seq > talkedAt && entry.turn === world.turn &&
            entry.locationId === here && (view.coordinate
              ? validElysiumName(entry.elysiumName) : legacyElysiumName(entry.text)));
        const spoken = saved || line;
        if (talkedAt && spoken?.actorId === id && spoken.generated && spoken.seq > talkedAt) {
          const typed = Object.hasOwn(spoken, "elysiumName");
          const raw = typed && spoken.silent ? world.log?.find((entry) =>
            entry.seq === spoken.seq && entry.actorId === id) : spoken;
          const title = raw?.generated && raw.kind === "dialogue" && !raw.silent &&
            (view.coordinate ? raw.elysiumName : introductionName(raw));
          // The chosen name belongs to the completed reply even if its words omit it.
          const named = validElysiumName(title);
          if (personalKey && world.run && active && nearby && named && spoken.locationId === here &&
            spoken.turn === world.turn && !personalName(id)) learn(world, actor, raw, title, talkedAt);
          if (view.coordinate ? raw?.kind === "dialogue" && !raw.silent
            : typed ? named : !spoken.silent) view.waiting = false;
        }
        if (!talkedAt) view.waiting = false;
        view.seenTalk = Boolean(talkedAt);
        const ready =
          id === resident ? world.opened?.[spiral]?.length : returnedAt;
        view.name?.observe(
          active && talkedAt && !view.waiting,
          view.coordinate || nearby || viewer?.talked?.includes(id) ||
            viewer?.visited?.includes(packPeople[id].place),
          world.revision,
        );
        const available = nearby || Boolean(view.receipt && !portraitReady);
        view.portrait?.observe(active && ready, available, world.revision, view.receipt);
      }
      started = true;
    },
  };
}
