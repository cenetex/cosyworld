import { imageUrl } from "./images.mjs";
import { request, passkey, WORLD_UPDATE } from "./shared-auth.mjs";
import { passkeyNotice } from "./privacy.mjs";
import { createSharedSync } from "./shared-sync.mjs";
import roster from "./shared-cast.json" with { type: "json" };
import { worldNameOf } from "./world-name.mjs";
import { signedEnvelopes } from "./signed-words.mjs";
import { INVITE_KEY, PLAYING_KEY } from "./avatar-world.mjs";

export const humanAvatars = roster.avatars;
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
// A release swap briefly runs rules older than the world's (docs/release.md).
// The world waits, unchanged, and opens itself when the newer build is back.
export const UPDATING = "Updating — back in a moment";
export const updatingDelay = (attempt) => Math.min(2000 * 2 ** attempt, 30000);
// The panel's words cross into new ones, and an opened world fades the
// panel out over its table, which it stops holding at once.
const PANEL_FADE_MS = 200;
function fadePanelOut() {
  if (!modal?.open) return;
  modal.close();
  if (!modal.animate) return;
  modal.show();
  modal.animate({ opacity: [1, 0] }, { duration: PANEL_FADE_MS }).finished.then(
    () => modal.open && modal.close(),
    () => {},
  );
}
function panel(title, description, closable = true) {
  // A panel fading out comes back whole, holding the page again.
  for (const fade of modal?.getAnimations?.() ?? []) fade.cancel();
  if (modal?.open && !modal.matches(":modal")) modal.close();
  const crossing = Boolean(modal?.open && modal.children.length);
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
  // Its new words, and what the caller adds, come in over the old ones.
  if (crossing && modal.animate)
    queueMicrotask(() => {
      for (const part of modal.children)
        part.animate({ opacity: [0, 1] }, { duration: PANEL_FADE_MS });
    });
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
  // The notice comes before the buttons, so it is read before a passkey is made.
  box.append(passkeyNotice());
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
      // A full room waits at the table (renderRoomStatus).
      value = await worldRequest({ op: "enter" });
      fadePanelOut();
      resolve(value);
    };
    // One message: why the world did not open, and that it is kept. A
    // failed retry redraws the card instead of repeating the message below.
    let waits = 0;
    const failed = (error) => {
      // The reason is the action's label; it retries on its own.
      if (error?.code === "updating") {
        const wait = node("button", UPDATING);
        wait.type = "button";
        wait.disabled = true;
        panel("Open this world", "Everything in it is kept.", false).append(
          wait,
        );
        return setTimeout(
          () => authenticate(enter, false).catch(failed),
          updatingDelay(waits++),
        );
      }
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
    async play(action, key = crypto.randomUUID(), revealed = undefined) {
      playError = null;
      try {
        return await command({ op: "play", key, action, revealed });
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
            signed: signedEnvelopes(),
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
// A full room waits at the table, with a way to check again. Waiting plays
// have no chips (owner, 2026-11-01): the action beat holds your own.
let renderedRoom = "";
export function renderRoomStatus(session) {
  const { state } = session;
  const roomStatus = $("shared-room-status");
  if (!roomStatus) return;
  const key = JSON.stringify([state.actor, state.present]);
  if (key === renderedRoom) return;
  renderedRoom = key;
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
}
const sharedLineDuration = (line) =>
  Math.min(9000, Math.max(3500, line.text.length * 45 + 1500));
// A reply speaker whose words did not come is listed under `silent` on the
// scene record. The table shows "…" for them after the spoken lines; these
// lines are read on the scene clock but never voiced or saved. Words that
// failed are the same silence: a scene with no lines follows its play's last
// event (`after`), and an older failed record without `silent` shows "…" for
// the player who played it. A line arrives whole or is "…", never a failure.
export const SHARED_SILENT_TEXT = "…";
function withSilence(scene) {
  const lines = scene.lines || [];
  const last = lines.at(-1) ?? {
    seq: scene.after,
    turn: scene.turn ?? null,
    locationId: scene.room,
  };
  const silent =
    Array.isArray(scene.silent) || !scene.error || lines.length
      ? scene.silent
      : [scene.actor];
  if (!Array.isArray(silent) || !Number.isFinite(last?.seq))
    return { ...scene, lines };
  const quiet = [...new Set(silent)].filter(
    (id) =>
      typeof id === "string" &&
      id.length <= 80 &&
      !lines.some((line) => (line.actorId || line.entityId) === id),
  );
  if (!quiet.length) return { ...scene, lines };
  return {
    ...scene,
    lines: [
      ...lines,
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
    .filter((entry) => entry.room === room)
    .map(withSilence)
    .filter((entry) => entry.lines.length)
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

export function sharedNextLine(state, room, seq) {
  const earliest = state.world?.log?.[0]?.seq ?? 0;
  return roomScenes(state, room)
    .flatMap((scene) => scene.lines)
    .find((line) => line.seq > seq && line.seq >= earliest);
}

// Select a saved scene's line; imported local log entries have no such record.
export function sharedVoiceReference(state, line) {
  if (!Number.isInteger(line?.seq) || line.silent) return;
  for (const scene of state?.history || []) {
    const index = scene.lines?.findIndex((entry) => entry.seq === line.seq);
    if (scene.play && index >= 0) return { play: scene.play, line: index };
  }
}

// Words on the way, or the room's scene as it stands. Words that failed are
// already "…" in that scene, so nothing waits on them and nothing retries.
export function sharedSpeechState(state) {
  const working = state.queue?.some(
    (entry) =>
      entry.status === "working" ||
      (entry.opening &&
        entry.actor === state.actor &&
        entry.status === "retry"),
  );
  return { status: working ? "pending" : "ready" };
}

export function hasSharedPlace(state) {
  const index = humanAvatars.findIndex((avatar) => avatar.id === state.actor);
  return index >= 0 && Boolean(state.present?.[index]);
}
