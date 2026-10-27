import { request, passkey } from "./shared-auth.mjs";
import roster from "./shared-cast.json" with { type: "json" };

export const humanAvatars = roster.avatars;
const avatarName = (id) => humanAvatars.find((a) => a.id === id)?.name || id;
const $ = (id) => document.getElementById(id);
let modal;
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
function showError(error) {
  const target = modal?.open ? $("shared-error") : $("notice");
  if (!target) return;
  target.hidden = false;
  target.textContent =
    error.name === "NotAllowedError"
      ? "The passkey step was closed. You can try again."
      : error.message;
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
async function showLink(id, offerContinue = false) {
  const box = panel(
    "Invite someone",
    "This link opens this world, with its places, people, belongings, and progress.",
  );
  if (offerContinue)
    box.append(
      button("Continue shared world", () => {
        location.href = worldLink(id);
      }),
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
export async function openWorlds() {
  try {
    await authenticate(async () => {
      const result = await request("/card-game/shared/worlds");
      const box = panel(
        "Your worlds",
        "Continue with your saved avatar, or open a friend's world link.",
        false,
      );
      for (const entry of result.worlds)
        box.append(
          button(
            entry.actor
              ? `Continue as ${avatarName(entry.actor)}`
              : `The reflected shore · ${8 - entry.claimed} avatars available`,
            () => {
              location.href = worldLink(entry.id);
            },
          ),
        );
      box.append(
        button("Return to my game", () => {
          location.href = "/";
        }),
        button("Sign out", async () => {
          await request("/auth/logout", {});
          location.reload();
        }),
      );
    }, false);
  } catch (error) {
    const box = panel(
      "Open your worlds",
      "Your worlds are saved. Try again when the connection is ready.",
      false,
    );
    box.append(
      button("Try again", openWorlds),
      button("Return to my game", () => {
        location.href = "/";
      }),
    );
    showError(error);
  }
}
export async function connectSharedWorld(id) {
  ensureSharedStyle();
  let value;
  const initial = await new Promise((resolve) => {
    const enter = async () => {
      value = await request(`/card-game/shared/worlds/${id}`);
      if (!value.actor) return choose();
      value = await request(`/card-game/shared/worlds/${id}/command`, {
        op: "enter",
      });
      const index = humanAvatars.findIndex((a) => a.id === value.actor);
      if (value.present && !value.present[index]) {
        const box = panel(
          "A place will open shortly",
          "Your room has four people. Your avatar and belongings are saved.",
          false,
        );
        box.append(
          button("Check for a place", enter),
          button("Release this avatar", () => {
            const confirmation = panel(
              "Release your avatar?",
              "Their belongings and story will stay in this world. Someone else can then claim this avatar.",
              false,
            );
            confirmation.append(
              button("Keep my avatar", enter),
              button("Release avatar", async () => {
                await request(`/card-game/shared/worlds/${id}/command`, {
                  op: "release",
                });
                await enter();
              }),
            );
          }),
          button("Your worlds", () => {
            location.href = "/?shared=1";
          }),
        );
        return;
      }
      modal?.close();
      resolve(value);
    };
    const choose = () => {
      const box = panel(
        "Choose your avatar",
        "Join this world's story. Each person has one avatar here.",
        false,
      );
      const picker = node("div", undefined, "shared-picker");
      humanAvatars.forEach((avatar, index) => {
        const card = button("", async () => {
          try {
            await request(`/card-game/shared/worlds/${id}/command`, {
              op: "claim",
              avatar: avatar.id,
            });
            await enter();
          } catch (error) {
            value = await request(`/card-game/shared/worlds/${id}`);
            if (value.actor) return enter();
            choose();
            showError(error);
          }
        });
        card.className = "shared-choice";
        card.disabled = Boolean(value.claimed[index]);
        card.dataset.avatar = avatar.id;
        const image = node("img");
        image.src = `/card-game/${avatar.image}`;
        image.alt = "";
        card.append(
          image,
          node("strong", avatar.name),
          node("span", avatar.title),
          node("small", card.disabled ? "Claimed" : avatar.pleasure),
        );
        picker.append(card);
      });
      box.append(
        picker,
        button("Refresh avatars", enter),
        button("Your worlds", () => {
          location.href = "/?shared=1";
        }),
      );
    };
    authenticate(enter, false).catch((error) => {
      panel(
        "Open this world",
        "The world is taking a moment. Your saved game is safe.",
        false,
      ).append(button("Try again", () => authenticate(enter, false)));
      showError(error);
    });
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
  const command = async (body) =>
    adopt(await request(`/card-game/shared/worlds/${id}/command`, body));
  const sync = async () => {
    if (inFlight || stopped) return;
    inFlight = true;
    try {
      if (Date.now() - heartbeat >= 15000) {
        await command({ op: "heartbeat" });
        heartbeat = Date.now();
      } else adopt(await request(`/card-game/shared/worlds/${id}`));
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
    async play(action) {
      const key = crypto.randomUUID();
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
export function installSharedControls({ session, saveSlot, getSave, notice }) {
  ensureSharedStyle();
  const linkedWorld = () => {
    try {
      return saveSlot ? localStorage.getItem(`${saveSlot}.shared`) : null;
    } catch {
      return null;
    }
  };
  const share = button("Share", async () => {
    if (session) return showLink(session.id);
    const linked = linkedWorld();
    if (linked) return showLink(linked, true);
    await authenticate(async () => {
      const box = panel(
        "Share this world",
        "Friends will join this exact world. Its places, people, belongings, quests, and progress stay together. You will continue as Vale.",
      );
      box.append(
        button("Share this world", async () => {
          const created = await request("/card-game/shared/worlds", {
            save: getSave(),
          });
          try {
            if (saveSlot)
              localStorage.setItem(`${saveSlot}.shared`, created.id);
          } catch {}
          location.href = worldLink(created.id);
        }),
      );
    }, true);
  });
  share.id = "shared-worlds-button";
  document.querySelector(".top-actions").prepend(share);
  const worlds = button("Worlds", async () => {
    if (session) await session.command({ op: "leave" });
    location.href = "/?shared=1";
  });
  worlds.id = "owned-worlds-button";
  document.querySelector(".top-actions").prepend(worlds);
  if (!session) {
    if (linkedWorld()) {
      const resume = button("Continue shared world", () => {
        location.href = worldLink(linkedWorld());
      });
      resume.id = "continue-shared-world";
      resume.className = "shared-resume";
      document.querySelector(".play-dock").prepend(resume);
    }
    return;
  }
  const queue = node("ol", undefined, "shared-play-queue");
  queue.id = "shared-queue";
  queue.setAttribute("aria-label", "Plays at the table");
  const portraits = node("div", undefined, "shared-portraits");
  portraits.append($("live-line"), queue);
  document.querySelector(".dialogue").append(portraits);
  const roomStatus = node("div", undefined, "shared-room-status");
  roomStatus.id = "shared-room-status";
  roomStatus.hidden = true;
  document.querySelector(".play-dock").prepend(roomStatus);
  $("new-game").hidden = true;
  const saveCopy = [...$("menu-dialog").querySelectorAll("p")].find((p) =>
    p.textContent.includes("Your game saves"),
  );
  if (saveCopy)
    saveCopy.textContent =
      "This shared world saves for everyone. Your passkey keeps your place.";
  $("menu-dialog").append(
    button("Add a passkey", async () => {
      await passkey(true);
      notice("Your extra passkey is ready.");
    }),
    button("Leave this room", async () => {
      await session.command({ op: "leave" });
      location.href = "/?shared=1";
    }),
    button("Release this avatar", () => {
      $("menu-dialog").close();
      const box = panel(
        "Release your avatar?",
        "Their belongings and story will stay in this world. Someone else can then claim this avatar.",
      );
      box.append(
        button("Keep my avatar", () => modal.close()),
        button("Release avatar", () => session.command({ op: "release" })),
      );
    }),
    button("Sign out", async () => {
      await session.command({ op: "leave" });
      await request("/auth/logout", {});
      location.href = "/?shared=1";
    }),
  );
}
let renderedQueue = "";
export function renderSharedQueue(
  session,
  portraitFor,
  { liveActor = null, needsLive = false, onLive = null } = {},
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
    const label = `${avatarName(entry.actor)} · ${entry.status === "waiting" ? "next" : entry.status === "working" ? "playing" : "reading"}`;
    const face = returnsLive
      ? button("", onLive)
      : canWithdraw
        ? button("", () => session.command({ op: "cancel", key: entry.id }))
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
const roomScenes = (state, room) =>
  (state.history || [])
    .filter((entry) => entry.room === room && entry.lines?.length)
    .toSorted((a, b) => a.starts_at - b.starts_at);
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
