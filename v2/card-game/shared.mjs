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
    stopped = false;
  let offset = initial.now - Date.now(),
    heartbeat = Date.now();
  const adopt = (next) => {
    if (next.now < state.now) return state;
    state = next;
    offset = next.now - Date.now();
    listener(next);
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
    } catch (error) {
      report(error.message);
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
    now: () => Date.now() + offset,
    subscribe(fn, onError) {
      listener = fn;
      report = onError;
    },
    command,
    sync,
    showLink: () => showLink(id),
    play: (action) => command({ op: "play", key: crypto.randomUUID(), action }),
  };
}
export function installSharedControls({
  session,
  saveSlot,
  getSave,
  notice,
  onLive,
}) {
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
  const queue = node("div", undefined, "shared-play-queue");
  queue.id = "shared-queue";
  queue.setAttribute("aria-label", "Plays at the table");
  document.querySelector(".play-dock").prepend(queue);
  const live = button("Return to live", onLive);
  live.id = "return-live";
  live.hidden = true;
  document.querySelector(".dialogue-heading").append(live);
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
export function renderSharedQueue(session) {
  const { state } = session;
  const queue = $("shared-queue");
  if (!queue) return;
  queue.replaceChildren();
  for (const entry of state.queue || []) {
    const row = node(
      "span",
      `${avatarName(entry.actor)} · ${entry.status === "waiting" ? "next" : entry.status === "working" ? "playing" : "reading"}`,
    );
    if (entry.actor === state.actor && entry.status === "waiting")
      row.append(
        button("Withdraw", () =>
          session.command({ op: "cancel", key: entry.id }),
        ),
      );
    queue.append(row);
  }
}
export function sharedLiveLine(state, now, room) {
  const scene = (state.history || []).find(
    (entry) => entry.room === room && entry.lines?.length,
  );
  if (!scene) return null;
  let elapsed = now - scene.starts_at;
  for (const line of scene.lines) {
    elapsed -= Math.min(9000, Math.max(3500, line.text.length * 45 + 1500));
    if (elapsed < 0) return line;
  }
  return scene.lines.at(-1);
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
