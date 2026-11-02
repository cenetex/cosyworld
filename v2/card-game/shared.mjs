import { imageUrl } from "./images.mjs";
import { request, passkey, WORLD_UPDATE } from "./shared-auth.mjs";
import { createSharedSync } from "./shared-sync.mjs";
import roster from "./shared-cast.json" with { type: "json" };
import { worldNameOf } from "./world-name.mjs";
import { INVITE_KEY, PLAYING_KEY } from "./avatar-world.mjs";

export const humanAvatars = roster.avatars;
const avatarName = (id) => humanAvatars.find((a) => a.id === id)?.name || id;
const $ = (id) => document.getElementById(id);
let modal;
// The table's status line, for errors outside the shared-world dialog.
let tableNotice = () => {};
function ensureSharedStyle() {
  if (document.getElementById("shared-table-style")) return;
  const style = document.createElement("link");
  style.id = "shared-table-style";
  style.rel = "stylesheet";
  style.href = "/card-game/shared.css";
  document.head.append(style);
}
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function button(text, action) {
  const element = node("button", text);
  element.type = "button";
  element.onclick = async () => {
    element.disabled = true;
    try {
      await action();
    } catch (error) {
      showError(error);
    } finally {
      element.disabled = false;
    }
  };
  return element;
}
function errorText(error) {
  return error.name === "NotAllowedError"
    ? "The passkey step was closed. You can try again."
    : error.message;
}
function showError(error) {
  if (!modal?.open) return tableNotice(errorText(error));
  $("shared-error").hidden = false;
  $("shared-error").textContent = errorText(error);
}
// A shared world belongs to everyone in it, so no one starts it over. A
// rules refusal to load it means the world waits for an update.
const PAUSED = "The world is taking a moment. Everything in it is kept.";
export function sharedError(error) {
  return /fresh start|New game/.test(error?.message || "")
    ? new Error(WORLD_UPDATE, { cause: error })
    : error;
}
function openFailure(error) {
  return ["TypeError", "TimeoutError", "AbortError"].includes(error?.name) ||
    !error?.message
    ? PAUSED
    : errorText(error);
}
function panel(title, description, closable = true) {
  if (!modal) {
    ensureSharedStyle();
    modal = node("dialog", undefined, "shared-lobby");
    modal.id = "shared-lobby";
    document.body.append(modal);
    modal.addEventListener("close", () =>
      document.dispatchEvent(new Event("shared-dialog-change")),
    );
  }
  modal.replaceChildren();
  modal.oncancel = (event) => {
    if (!closable) event.preventDefault();
  };
  const heading = node("div", undefined, "modal-heading");
  heading.append(node("h2", title));
  if (closable) heading.append(button("Close", () => modal.close()));
  modal.append(heading, node("p", description));
  const error = node("p");
  error.id = "shared-error";
  error.setAttribute("role", "status");
  modal.append(error);
  document.body.inert = false;
  if (!modal.open) modal.showModal();
  document.dispatchEvent(new Event("shared-dialog-change"));
  return modal;
}
async function authenticate(next, closable) {
  const account = await request("/auth/account");
  if (account.authenticated) return next();
  const box = panel(
    "Join the reflected shore",
    "A passkey keeps your avatar and your worlds together.",
    closable,
  );
  for (const [label, register] of [
    ["Continue with a passkey", false],
    ["Create a passkey", true],
  ])
    box.append(
      button(label, async () => {
        await passkey(register);
        await next();
      }),
    );
}
export function worldLink(id) {
  const url = new URL("/", location.origin);
  url.searchParams.set("world", id);
  return url.href;
}
async function showLink(id, name = null) {
  const box = panel(
    name ? `Invite to ${name}` : "Invite someone",
    "This link opens this world, with its places, people, belongings, and progress.",
  );
  const field = node("input");
  field.id = "invite-url";
  field.readOnly = true;
  field.value = worldLink(id);
  field.setAttribute("aria-label", "World link");
  box.append(
    field,
    button("Copy link", async () => {
      await navigator.clipboard.writeText(field.value);
      $("shared-error").textContent = "World link copied.";
    }),
  );
}
export async function connectSharedWorld(id) {
  ensureSharedStyle();
  const worldRequest = createSharedSync((command, headers) =>
    request(
      `/card-game/shared/worlds/${id}${command === undefined ? "" : "/command"}`,
      command,
      headers,
    ).catch((error) => {
      throw sharedError(error);
    }),
  );
  let value;
  const initial = await new Promise((resolve) => {
    const enter = async () => {
      value = await worldRequest();
      // A friend's link opens ☰ on the player's own table, with this
      // world's seats to bring an avatar to (avatar-menu.mjs, #1877).
      if (!value.actor) {
        try {
          sessionStorage.setItem(INVITE_KEY, id);
          const playing = JSON.parse(localStorage.getItem(PLAYING_KEY));
          if (playing?.world === id) localStorage.removeItem(PLAYING_KEY);
        } catch {}
        return location.replace("/");
      }
      // A full room waits at the table (renderSharedQueue).
      value = await worldRequest({ op: "enter" });
      modal?.close();
      resolve(value);
    };
    // One message: why the world did not open, and that it is kept. A
    // failed retry redraws the card instead of repeating the message below.
    const failed = (error) => {
      // A world nobody is in any more has closed (full_retire.rs): the bare
      // address stops resuming it, and nothing is worth trying again.
      if (/has closed/.test(error?.message || "")) {
        try {
          const playing = JSON.parse(localStorage.getItem(PLAYING_KEY));
          if (playing?.world === id) localStorage.removeItem(PLAYING_KEY);
        } catch {}
        return panel("Open this world", error.message, false).append(
          button("Back to your table", () => location.replace("/")),
        );
      }
      panel("Open this world", openFailure(error), false).append(
        button("Try again", () => authenticate(enter, false).catch(failed)),
      );
    };
    authenticate(enter, false).catch(failed);
  });
  let state = initial,
    listener = () => {},
    report = () => {},
    inFlight = false,
    stopped = false,
    connectionError = null,
    playError = null;
  let lastSynced = Date.now();
  let offset = initial.now - Date.now(),
    heartbeat = Date.now();
  const adopt = (next) => {
    if (next === state) return state;
    if (next.now < state.now || next.world?.revision < state.world?.revision)
      return state;
    lastSynced = Date.now();
    state = next;
    offset = next.now - Date.now();
    listener(next);
    if (
      playError?.key &&
      (next.queue?.some((entry) => entry.id === playError.key) ||
        next.history?.some((entry) => entry.play === playError.key))
    ) {
      report("", playError.message);
      playError = null;
    }
    return next;
  };
  const command = async (body) => adopt(await worldRequest(body));
  const sync = async () => {
    if (inFlight || stopped) return;
    inFlight = true;
    try {
      if (Date.now() - heartbeat >= 15000) {
        await command({ op: "heartbeat" });
        heartbeat = Date.now();
      } else adopt(await worldRequest());
      if (connectionError) {
        report(playError?.message || "", connectionError);
        connectionError = null;
      }
    } catch (error) {
      connectionError = error.message;
      report(connectionError);
    } finally {
      inFlight = false;
    }
  };
  let timer = setInterval(sync, 1000);
  window.addEventListener("pagehide", () => {
    stopped = true;
    clearInterval(timer);
  });
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    stopped = false;
    heartbeat = 0;
    timer = setInterval(sync, 1000);
    void sync();
  });
  return {
    id,
    get state() {
      return state;
    },
    get connectionError() {
      return connectionError;
    },
    get lastSynced() {
      return lastSynced;
    },
    now: () => Date.now() + offset,
    subscribe(fn, onError) {
      listener = fn;
      report = onError;
    },
    command,
    sync,
    showLink: () => showLink(id),
    async play(action, key = crypto.randomUUID()) {
      playError = null;
      try {
        return await command({ op: "play", key, action });
      } catch (error) {
        if (["TypeError", "TimeoutError", "AbortError"].includes(error.name)) {
          const message =
            "The connection paused. Check the table, then try again.";
          playError = { key, message };
          throw new Error(message, { cause: error });
        }
        playError = { key: null, message: error.message };
        throw error;
      }
    },
  };
}
export function installSharedControls({
  session,
  saveSlot,
  getSave,
  getWorld = () => null,
  notice,
}) {
  tableNotice = notice;
  ensureSharedStyle();
  const share = button("Share", async () => {
    if (session) return showLink(session.id, worldNameOf(session.state.world));
    const name = worldNameOf(getWorld());
    await authenticate(async () => {
      const box = panel(
        name ? `Share ${name}` : "Share this world",
        "Friends will join this exact world. Its places, people, belongings, quests, and progress stay together.",
      );
      box.append(
        button("Share this world", async () => {
          const save = getSave();
          const created = await request("/card-game/shared/worlds", {
            save,
            avatar: getWorld()?.playerActorId || "vale",
            move: true,
          });
          // The avatar's local world moved online; keep it as a backup.
          try {
            if (saveSlot) {
              localStorage.setItem(`${saveSlot}.bak`, save);
              localStorage.removeItem(saveSlot);
            }
          } catch {}
          location.href = worldLink(created.id);
        }),
      );
    }, true);
  });
  share.id = "shared-worlds-button";
  document.querySelector(".top-actions").prepend(share);
  if (!session) return;
  const queue = node("ol", undefined, "shared-play-queue");
  queue.id = "shared-queue";
  queue.setAttribute("aria-label", "Plays at the table");
  const portraits = node("div", undefined, "shared-portraits");
  portraits.append(queue);
  document.querySelector(".dialogue").append(portraits);
  const roomStatus = node("div", undefined, "shared-room-status");
  roomStatus.id = "shared-room-status";
  roomStatus.hidden = true;
  document.querySelector(".play-dock").prepend(roomStatus);
  $("new-game").hidden = true;
  $("menu-dialog").append(
    button("Add a passkey", async () => {
      await passkey(true);
      notice("Your extra passkey is ready.");
    }),
    button("Sign out", async () => {
      await session.command({ op: "leave" });
      await request("/auth/logout", {});
      location.href = "/";
    }),
  );
}
let renderedQueue = "";
export function renderSharedQueue(
  session,
  portraitFor,
  {
    liveActor = null,
    needsLive = false,
    onLive = null,
    onWithdraw = (key) => session.command({ op: "cancel", key }),
  } = {},
) {
  const { state } = session;
  const queue = $("shared-queue");
  if (!queue) return;
  const key = JSON.stringify([
    state.actor,
    state.present,
    state.queue,
    liveActor,
    needsLive,
  ]);
  if (key === renderedQueue) return;
  renderedQueue = key;
  queue.replaceChildren();
  const roomStatus = $("shared-room-status");
  roomStatus.replaceChildren();
  roomStatus.hidden = hasSharedPlace(state);
  if (!hasSharedPlace(state)) {
    const waiting = node(
      "span",
      "Your room is full. Your avatar and belongings are saved.",
    );
    waiting.append(
      button("Check for a place", () => session.command({ op: "enter" })),
    );
    roomStatus.append(waiting);
  }
  const entries = state.queue || [];
  const liveEntry = entries.find((entry) => entry.actor === liveActor);
  const ordered = liveEntry
    ? [liveEntry, ...entries.filter((entry) => entry.id !== liveEntry.id)]
    : entries;
  for (const entry of ordered) {
    const canWithdraw =
      entry.actor === state.actor && entry.status === "waiting";
    const returnsLive = entry.actor === liveActor && needsLive && onLive;
    // Other players' plays are private until they resolve: name the player
    // and what the table is doing with it, never the play itself.
    const label = `${avatarName(entry.actor)} is ${entry.status === "waiting" ? "thinking" : entry.status === "working" ? "playing" : "reading"}…`;
    const face = returnsLive
      ? button("", onLive)
      : canWithdraw
        ? button("", () => onWithdraw(entry.id))
        : node("span");
    face.className = "shared-play-avatar";
    face.dataset.actor = entry.actor;
    face.dataset.status = entry.status;
    face.title = returnsLive
      ? "Return to live dialogue · " + avatarName(entry.actor)
      : canWithdraw
        ? label + " · Withdraw your play"
        : label;
    face.setAttribute("aria-label", face.title);
    if (returnsLive) {
      face.dataset.returnLive = "true";
      face.dataset.live = "false";
    }
    if (!canWithdraw && !returnsLive) face.setAttribute("role", "img");
    face.append(portraitFor(entry.actor));
    const row = node("li");
    row.append(face);
    queue.append(row);
  }
}
const sharedLineDuration = (line) =>
  Math.min(9000, Math.max(3500, line.text.length * 45 + 1500));
// A reply speaker whose words did not come is listed under `silent` on the
// scene record. The table shows "…" for them after the spoken lines; these
// lines are read on the scene clock but never voiced or saved.
export const SHARED_SILENT_TEXT = "…";
function withSilence(scene) {
  const last = scene.lines.at(-1);
  if (!Array.isArray(scene.silent) || !Number.isFinite(last?.seq)) return scene;
  const quiet = [...new Set(scene.silent)].filter(
    (id) =>
      typeof id === "string" &&
      id.length <= 80 &&
      !scene.lines.some((line) => (line.actorId || line.entityId) === id),
  );
  if (!quiet.length) return scene;
  return {
    ...scene,
    lines: [
      ...scene.lines,
      ...quiet.slice(0, 2).map((id, index) => ({
        seq: last.seq + (index + 1) / 10,
        turn: last.turn,
        text: SHARED_SILENT_TEXT,
        kind: "dialogue",
        actorId: id,
        entityId: id,
        generated: true,
        silent: true,
        locationId: last.locationId ?? scene.room,
      })),
    ],
  };
}
const roomScenes = (state, room) =>
  (state.history || [])
    .filter((entry) => entry.room === room && entry.lines?.length)
    .map(withSilence)
    .toSorted((a, b) => a.starts_at - b.starts_at);
// The "…" lines of this room's saved scenes, for the stage and Conversation.
export const sharedSilentLines = (state, room) =>
  roomScenes(state, room).flatMap((scene) =>
    scene.lines.filter((line) => line.silent),
  );
const sceneIdentity = (scene) => `${scene.starts_at}:${scene.play || ""}`;

// Each viewer reads incoming scenes in order, including scenes received together.
export function createSharedPlaybackClock() {
  let sceneKey = null,
    roomKey = null,
    awaitingFirst = false,
    delay = 0,
    pausedAt = null;
  const reset = () => {
    sceneKey = null;
    roomKey = null;
    awaitingFirst = false;
    delay = 0;
    pausedAt = null;
  };
  return {
    reset,
    now(state, now, room, paused) {
      if (room !== roomKey) {
        reset();
        roomKey = room;
      }
      const scenes = roomScenes(state, room);
      let index = scenes.findIndex(
        (scene) => sceneIdentity(scene) === sceneKey,
      );
      if (index < 0 && scenes.length) {
        index = awaitingFirst ? 0 : scenes.length - 1;
        sceneKey = sceneIdentity(scenes[index]);
        delay =
          awaitingFirst && !paused
            ? Math.max(0, now - scenes[index].starts_at)
            : 0;
        awaitingFirst = false;
        if (pausedAt !== null)
          pausedAt = Math.max(pausedAt, scenes[index].starts_at);
      }
      if (!scenes.length && sceneKey === null) awaitingFirst = true;
      if (paused) pausedAt ??= now;
      else if (pausedAt !== null) {
        delay += Math.max(0, now - pausedAt);
        pausedAt = null;
      }
      let readingTime = (pausedAt ?? now) - delay;
      const scene = scenes[index];
      const next = scenes[index + 1];
      if (
        !paused &&
        scene &&
        next &&
        now >= next.starts_at &&
        readingTime >=
          scene.starts_at +
            scene.lines.reduce((sum, line) => sum + sharedLineDuration(line), 0)
      ) {
        sceneKey = sceneIdentity(next);
        // A late update can contain several scenes. Give each its reading time.
        delay = Math.max(0, now - next.starts_at);
        readingTime = now - delay;
      }
      return readingTime;
    },
  };
}

export function sharedLiveLine(state, now, room) {
  const scenes = roomScenes(state, room);
  const scene = scenes.findLast((entry) => entry.starts_at <= now) || scenes[0];
  if (!scene) return null;
  let elapsed = now - scene.starts_at;
  for (const line of scene.lines) {
    elapsed -= sharedLineDuration(line);
    if (elapsed < 0) return line;
  }
  return scene.lines.at(-1);
}

export function sharedNextActor(state, now, room) {
  const queued =
    state.queue?.find((entry) => entry.status === "waiting") ||
    state.queue?.find((entry) => entry.status === "working");
  if (queued) return queued.actor;
  const scene = state.history?.find(
    (entry) => entry.room === room && entry.lines?.length,
  );
  const live = sharedLiveLine(state, now, room);
  const next = scene?.lines
    .slice(scene.lines.indexOf(live) + 1)
    .find((line) => line.actorId);
  return next?.actorId || live?.actorId || scene?.actor || state.actor;
}

export function sharedSpeechState(state, room) {
  const working = state.queue?.some((entry) => entry.status === "working");
  if (working) return { status: "pending", retryKey: null };
  const scene = state.history?.find((entry) => entry.room === room);
  if (!scene?.error) return { status: "ready", retryKey: null };
  const retryKey =
    scene.actor === state.actor &&
    scene.turn === state.world?.turn &&
    !state.queue?.length
      ? scene.play
      : null;
  return { status: "retry", retryKey };
}

export function hasSharedPlace(state) {
  const index = humanAvatars.findIndex((avatar) => avatar.id === state.actor);
  return index >= 0 && Boolean(state.present?.[index]);
}
