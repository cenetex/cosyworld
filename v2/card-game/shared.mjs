import { request, passkey } from "./shared-auth.mjs";
const roster = await fetch("/card-game/shared-cast.json").then((r) => r.json());
const avatars = roster.avatars;
const places = [roster.hub, ...avatars.map((a) => a.home)];
const colours = [
  "#17191c",
  "#c62836",
  "#d46c20",
  "#ddbb35",
  "#3a864d",
  "#3062c9",
  "#43408b",
  "#a168bb",
];
const params = new URLSearchParams(location.search);
let worldId = params.get("world"),
  state = null,
  identity = null,
  selection = [],
  openItems = new Set(),
  historyMode = false;
let lastNotice = "";
let busy = false,
  stopped = false,
  syncing = false,
  renderKey = "",
  clockOffset = 0,
  lastHeartbeat = 0,
  sceneKey = "";
const style = document.createElement("link");
style.rel = "stylesheet";
style.href = "/card-game/shared.css";
document.head.append(style);
document.body.classList.add("shared-table");
document.body.innerHTML = `<header class="shared-top"><a class="shared-brand" href="/">COSYWORLD <span>The reflected shore</span></a><nav aria-label="World controls"><button id="worlds">Worlds</button><button id="share">Share</button><button id="conversation">Conversation</button><button id="account">Menu</button></nav></header>
<p id="shared-notice" role="status" hidden></p>
<main id="shared-main"><section id="shared-lobby" aria-label="Choose a world"></section><section id="shared-scene" aria-label="Current scene" hidden><div id="shared-backdrop"></div><h1 id="shared-place"></h1><div id="shared-cast" aria-label="People here"></div><section class="shared-dialogue" aria-label="Shared conversation"><strong id="shared-speaker"></strong><p id="shared-line" aria-live="polite"></p><button id="return-live" hidden>Return to live</button></section><div id="shared-queue" aria-label="Plays at the table"></div><section class="shared-dock" aria-label="Card hand"><div id="shared-hand" aria-label="Playable cards"></div><div id="shared-actions" aria-label="Selected card actions"></div></section></section></main>
<dialog id="shared-history"><div class="shared-heading"><h2>Conversation</h2><button data-close="shared-history">Close</button></div><div id="shared-messages"></div></dialog>
<dialog id="shared-menu"><div class="shared-heading"><h2>Your place at the table</h2><button data-close="shared-menu">Close</button></div><p>Choose one or two cards, then play an action. Each person can have one play at the table. Rooms hold four people.</p><p>An item at Black pond reveals its place. Carry it with you, give it to someone, or leave it on the shore.</p><button id="add-passkey">Add a passkey</button><button id="leave-world">Leave this room</button><button id="release-avatar">Release this avatar</button><button id="sign-out">Sign out</button></dialog>
<dialog id="shared-release"><h2>Release your avatar?</h2><p>Their belongings will stay in their current room. Someone else can then claim this avatar.</p><button data-close="shared-release">Keep my avatar</button><button id="confirm-release">Release avatar</button></dialog>
<dialog id="shared-link"><h2>Invite someone</h2><label for="invite-url">World link</label><input id="invite-url" readonly><button data-close="shared-link">Close</button></dialog>`;
const el = (id) => document.getElementById(id);
function node(tag, text, className) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (className) n.className = className;
  return n;
}
function button(text, action, disabled = false) {
  const b = node("button", text);
  b.type = "button";
  b.disabled = disabled;
  b.onclick = () => guard(action);
  return b;
}
function notice(text) {
  el("shared-notice").textContent = text;
  el("shared-notice").hidden = !text;
}
async function guard(action) {
  if (busy) return;
  busy = true;
  try {
    notice("");
    await action();
  } catch (e) {
    notice(
      e.name === "NotAllowedError"
        ? "The passkey step was closed. You can try again."
        : e.message,
    );
  } finally {
    busy = false;
  }
}
function portrait(index) {
  const box = node("span", undefined, "shared-portrait");
  const img = node("img");
  img.src = `/card-game/${avatars[index].image}`;
  img.alt = "";
  img.decoding = "async";
  box.append(img);
  return box;
}
function setWorld(id) {
  worldId = id;
  const u = new URL(location.href);
  u.search = "";
  u.searchParams.set("shared", "1");
  if (id) u.searchParams.set("world", id);
  history.replaceState(null, "", u);
  state = null;
  renderKey = "";
  selection = [];
  openItems.clear();
  lastHeartbeat = 0;
}
async function command(body) {
  const value = await request(
    `/card-game/shared/worlds/${worldId}/command`,
    body,
  );
  adopt(value);
  return value;
}
function adopt(value) {
  state = value;
  clockOffset = value.now - Date.now();
  render();
}
async function login(register) {
  identity = await passkey(register);
  await load();
}
async function load() {
  identity = await request("/auth/account");
  if (!identity.authenticated) {
    renderLogin();
    return;
  }
  if (worldId) {
    adopt(await request(`/card-game/shared/worlds/${worldId}`));
    if (state.actor !== null) {
      await command({ op: "enter" });
      lastHeartbeat = Date.now();
    }
  } else await renderWorlds();
}
function baseLobby() {
  el("shared-lobby").hidden = false;
  el("shared-scene").hidden = true;
  el("share").hidden = !worldId;
  el("conversation").hidden = true;
  el("shared-lobby").replaceChildren();
  return el("shared-lobby");
}
function renderLogin() {
  const lobby = baseLobby();
  lobby.append(
    node("p", "A place for eight people", "shared-kicker"),
    node("h1", "Meet at the reflected shore"),
    node(
      "p",
      "Choose a character. Bring their item to Black pond. See which paths appear.",
    ),
  );
  const actions = node("div", undefined, "shared-entry-actions");
  actions.append(
    button("Continue with a passkey", () => login(false)),
    button("Create a passkey", () => login(true)),
  );
  lobby.append(actions);
  const grid = node("div", undefined, "shared-picker");
  for (let i = 0; i < 8; i++) {
    const card = node("div", undefined, "shared-choice");
    card.append(
      portrait(i),
      node("strong", avatars[i].name),
      node("span", avatars[i].title),
    );
    grid.append(card);
  }
  lobby.append(grid);
}
async function renderWorlds() {
  const list = await request("/card-game/shared/worlds");
  const lobby = baseLobby();
  lobby.append(
    node("p", "Your worlds", "shared-kicker"),
    node("h1", "Choose a shore"),
    node(
      "p",
      "Each world has eight avatars. Your passkey remembers your place.",
    ),
  );
  const worlds = node("div", undefined, "shared-world-list");
  for (const w of list.worlds) {
    worlds.append(
      button(
        w.actor === null
          ? `The reflected shore · ${8 - w.claimed} avatars available`
          : `Continue as ${avatars[w.actor].name}`,
        async () => {
          setWorld(w.id);
          await load();
        },
      ),
    );
  }
  lobby.append(worlds);
  lobby.append(
    button("Create a shared world", async () => {
      const result = await request("/card-game/shared/worlds", {});
      setWorld(result.id);
      await load();
    }),
  );
}
function renderPicker() {
  const lobby = baseLobby();
  lobby.append(
    node("p", "The reflected shore", "shared-kicker"),
    node("h1", "Choose your avatar"),
    node("p", "Your character and belongings will stay saved in this world."),
  );
  const grid = node("div", undefined, "shared-picker");
  for (let i = 0; i < 8; i++) {
    const claimed = Boolean(state.claimed[i]);
    const b = button(
      "",
      async () => {
        await command({ op: "claim", avatar: i });
        lastHeartbeat = Date.now();
      },
      claimed,
    );
    b.className = "shared-choice";
    b.style.setProperty("--avatar-colour", colours[i]);
    b.append(
      portrait(i),
      node("strong", avatars[i].name),
      node("span", avatars[i].title),
      node("small", claimed ? "Claimed" : avatars[i].pleasure),
    );
    grid.append(b);
  }
  lobby.append(grid);
}
function render() {
  if (state.actor === null) {
    renderPicker();
    return;
  }
  const a = state.actor,
    w = state.world,
    p = w.places[a];
  if (!w.present[a]) {
    const lobby = baseLobby();
    lobby.append(
      node("h1", `${avatars[a].name} is waiting`),
      node(
        "p",
        `${places[p].name} has four visitors. Your place will open when someone leaves.`,
      ),
      button("Check for a place", () => command({ op: "enter" })),
    );
    return;
  }
  el("shared-lobby").hidden = true;
  el("shared-scene").hidden = false;
  el("conversation").hidden = false;
  el("share").hidden = false;
  const key = JSON.stringify([
    w,
    state.exits,
    state.queue,
    selection,
    [...openItems],
  ]);
  if (key !== renderKey) {
    renderKey = key;
    el("shared-place").textContent = places[p].name;
    const backdrop = el("shared-backdrop");
    backdrop.style.backgroundImage = `url('/card-game/${places[p].image}')`;
    const cast = el("shared-cast");
    cast.replaceChildren();
    for (let i = 0; i < 8; i++)
      if (w.present[i]) {
        const person = node("div", undefined, "shared-person");
        person.append(
          portrait(i),
          node("span", avatars[i].name + (i === a ? " · you" : "")),
        );
        cast.append(person);
      }
    renderHand();
    renderQueue();
  }
  if (state.notice && state.notice !== lastNotice) {
    lastNotice = state.notice;
    notice(state.notice);
  }
  const nudge = state.nudge;
  if (nudge !== null && nudge !== undefined)
    notice(`${avatars[nudge].name} would like your attention.`);
  liveLine();
}
function select(type, index) {
  const id = `${type}:${index}`;
  if (selection.includes(id)) selection = selection.filter((v) => v !== id);
  else selection = [...selection.slice(-1), id];
  if (type === "avatar") openItems.add(index);
  renderKey = "";
  render();
}
function card(type, index) {
  const a = state.actor,
    w = state.world;
  const name =
    type === "avatar"
      ? avatars[index].name
      : type === "item"
        ? avatars[index].item.name
        : places[index].name;
  const b = button("", () => select(type, index));
  b.className = `shared-card shared-${type}`;
  b.setAttribute(
    "aria-pressed",
    String(selection.includes(`${type}:${index}`)),
  );
  b.setAttribute("aria-label", `${name}, ${type}`);
  if (type === "avatar") b.append(portrait(index));
  else if (type === "item") {
    const art = node("img", undefined, "shared-object-art");
    art.src = `/card-game/${avatars[index].item.image}`;
    art.alt = "";
    art.decoding = "async";
    b.append(art);
  } else {
    const art = node("span", undefined, "shared-place-art");
    art.style.backgroundImage = `url('/card-game/${places[index].image}')`;
    b.append(art);
  }
  b.append(node("span", name, "shared-card-name"));
  if (type === "location" && w.places[a] === 0 && index !== 0) {
    b.append(node("span", places[index].entrance.name, "shared-entrance-name"));
    b.title = places[index].entrance.text;
  }
  if (type === "avatar" && index === a) b.dataset.you = "true";
  if (type === "location" && index === w.places[a])
    b.setAttribute("aria-label", `${name}, current place`);
  return b;
}
function renderHand() {
  const w = state.world,
    a = state.actor,
    p = w.places[a],
    hand = el("shared-hand");
  const focus = document.activeElement?.getAttribute("aria-label");
  hand.replaceChildren();
  const visible = [];
  const add = (type, i) => {
    visible.push(`${type}:${i}`);
    hand.append(card(type, i));
  };
  add("location", p);
  for (let i = 0; i < 8; i++) if (w.holders[i] === 8 + p) add("item", i);
  for (let i = 0; i < 8; i++)
    if (w.present[i]) {
      add("avatar", i);
      if (i === a || openItems.has(i))
        for (let j = 0; j < 8; j++) if (w.holders[j] === i) add("item", j);
    }
  for (const p of state.exits) add("location", p);
  selection = selection.filter((s) => visible.includes(s));
  if (focus)
    for (const b of hand.children)
      if (b.getAttribute("aria-label") === focus)
        b.focus({ preventScroll: true });
  renderActions();
}
function renderActions() {
  const actions = el("shared-actions");
  actions.replaceChildren();
  const w = state.world,
    a = state.actor,
    p = w.places[a];
  const chosen = selection.map((s) => {
    const [t, i] = s.split(":");
    return { type: t, index: Number(i) };
  });
  const item = chosen.find((c) => c.type === "item")?.index,
    person = chosen.find((c) => c.type === "avatar" && c.index !== a)?.index,
    destination = chosen.find(
      (c) => c.type === "location" && c.index !== p,
    )?.index;
  const pending = state.queue.some((q) => q.actor === a);
  const play = (label, kind, i = -1, t = -1) =>
    actions.append(
      button(
        label,
        async () => {
          const key = crypto.randomUUID();
          await command({ op: "play", key, kind, item: i, target: t });
          selection = [];
          renderKey = "";
          render();
        },
        pending,
      ),
    );
  if (
    destination !== undefined &&
    state.exits.includes(destination) &&
    item === undefined &&
    person === undefined
  ) {
    if (p === 0)
      actions.append(
        node("span", places[destination].entrance.text, "shared-help"),
      );
    play("Travel", 5, -1, destination);
  } else if (item !== undefined) {
    if (w.holders[item] === a) {
      if (person !== undefined) play("Give", 8, item, person);
      else {
        play(avatars[item].item.verb, 9, item);
        play("Put down", 7, item);
      }
    } else if (w.holders[item] === 8 + p) {
      play("Pick up", 6, item);
      play(avatars[item].item.verb, 9, item);
    }
  } else if (person !== undefined) {
    play("Talk", 10, -1, person);
    actions.append(
      button("Nudge", () => command({ op: "nudge", target: person })),
    );
  } else if (chosen.length) play("Take a moment", 11);
  else
    actions.append(
      node("span", "Select cards, then play an action.", "shared-help"),
    );
  if (pending)
    actions.append(node("span", "Your play is at the table.", "shared-help"));
}
function renderQueue() {
  const q = el("shared-queue");
  q.replaceChildren();
  for (const entry of state.queue) {
    const n = node(
      "span",
      `${avatars[entry.actor].name} · ${entry.status === "waiting" ? "next" : entry.status === "working" ? "playing" : "reading"}`,
    );
    if (entry.actor === state.actor && entry.status === "waiting")
      n.append(
        button("Withdraw", () => command({ op: "cancel", key: entry.id })),
      );
    q.append(n);
  }
}
function liveLine() {
  if (!state?.world || historyMode) return;
  const scene = state.history?.[0];
  let speaker = "",
    text = scene?.action || places[state.world.places[state.actor]].text;
  if (scene?.lines?.length) {
    let elapsed = Date.now() + clockOffset - scene.starts_at;
    let line = scene.lines.at(-1);
    for (const candidate of scene.lines) {
      line = candidate;
      elapsed -= Math.min(
        9000,
        Math.max(3500, candidate.text.length * 45 + 1500),
      );
      if (elapsed < 0) break;
    }
    speaker = line.speaker;
    text = line.text;
  }
  const key = JSON.stringify([speaker, text]);
  if (key !== sceneKey) {
    sceneKey = key;
    el("shared-speaker").textContent = speaker;
    el("shared-line").textContent = text;
  }
  if (scene?.error && scene.play !== el("shared-line").dataset.errorPlay) {
    el("shared-line").dataset.errorPlay = scene.play;
    notice(scene.error);
  }
}
function historyPanel() {
  historyMode = true;
  el("return-live").hidden = false;
  const pane = el("shared-messages");
  pane.replaceChildren();
  for (const scene of [...(state?.history || [])].reverse()) {
    pane.append(node("p", scene.action, "shared-result"));
    for (const line of scene.lines || []) {
      const row = node("p");
      row.append(
        node("strong", line.speaker + ": "),
        document.createTextNode(line.text),
      );
      pane.append(row);
    }
  }
  el("shared-history").showModal();
}
async function sync() {
  if (syncing || busy || stopped || !identity?.authenticated || !worldId)
    return;
  syncing = true;
  try {
    if (state?.actor != null && Date.now() - lastHeartbeat > 15_000) {
      await command({ op: "heartbeat" });
      lastHeartbeat = Date.now();
    } else adopt(await request(`/card-game/shared/worlds/${worldId}`));
  } catch (e) {
    notice(e.message);
  } finally {
    syncing = false;
  }
}
el("worlds").onclick = () =>
  guard(async () => {
    if (state?.actor != null && state?.actor !== undefined)
      await command({ op: "leave" });
    setWorld(null);
    await renderWorlds();
  });
el("share").onclick = () =>
  guard(async () => {
    if (!worldId) return;
    const url = new URL(location.origin + "/");
    url.searchParams.set("world", worldId);
    try {
      await navigator.clipboard.writeText(url.href);
      notice("World link copied.");
    } catch {
      el("invite-url").value = url.href;
      el("shared-link").showModal();
      el("invite-url").select();
    }
  });
el("conversation").onclick = historyPanel;
el("return-live").onclick = () => {
  historyMode = false;
  el("return-live").hidden = true;
  liveLine();
};
el("account").onclick = () => el("shared-menu").showModal();
el("add-passkey").onclick = () =>
  guard(async () => {
    await passkey(true);
    notice("Your extra passkey is ready.");
  });
el("leave-world").onclick = () =>
  guard(async () => {
    el("shared-menu").close();
    if (state?.actor != null) await command({ op: "leave" });
    setWorld(null);
    await renderWorlds();
  });
el("release-avatar").onclick = () => {
  el("shared-menu").close();
  if (state?.actor != null && state?.actor !== undefined)
    el("shared-release").showModal();
};
el("confirm-release").onclick = () =>
  guard(async () => {
    await command({ op: "release" });
    el("shared-release").close();
  });
el("sign-out").onclick = () =>
  guard(async () => {
    if (state?.actor != null && state?.actor !== undefined)
      await command({ op: "leave" });
    await request("/auth/logout", {});
    el("shared-menu").close();
    state = null;
    identity = null;
    renderLogin();
  });
for (const close of document.querySelectorAll("[data-close]"))
  close.onclick = () => el(close.dataset.close).close();
el("shared-history").addEventListener("close", () => {
  historyMode = false;
  el("return-live").hidden = true;
  liveLine();
});
window.addEventListener("pagehide", () => {
  stopped = true;
});
window.addEventListener("pageshow", () => {
  stopped = false;
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    selection = [];
    renderKey = "";
    if (state?.world) render();
  }
});
setInterval(sync, 1500);
setInterval(liveLine, 250);
await guard(load);
