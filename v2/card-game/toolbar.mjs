import { installInnerLife } from "./inner-life.mjs";
import { imageUrl } from "./images.mjs";
import { currentActor, humanAvatar, humanAvatars } from "./human-cast.mjs";
import { avatarImage } from "./scarves.mjs";
import { levelOf } from "./want.mjs";
import { worldNameOf } from "./world-name.mjs";
import { installAvatarMenu } from "./avatar-menu.mjs";

const icons = {
  worlds:
    '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c5 5 5 11 0 16-5-5-5-11 0-16Z"/>',
  share: '<path d="M12 15V3m-4 4 4-4 4 4M5 12v8h14v-8"/>',
  conversation:
    '<path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 13h6"/>',
  players:
    '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2"/>',
  menu: '<path d="M5 6h14M5 12h14M5 18h14"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="#141b22"/><circle cx="15" cy="17" r="3" fill="#141b22"/>',
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function decorate(button, icon, label) {
  const mark = element("span", "toolbar-icon");
  mark.setAttribute("aria-hidden", "true");
  mark.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${icons[icon]}</svg>`;
  button.replaceChildren(mark, element("span", "toolbar-label", label));
  button.setAttribute("aria-label", label);
  button.title = label;
  button.type = "button";
}

export function onlinePlayers(state) {
  return humanAvatars
    .flatMap((avatar, index) => {
      if (state?.present?.[index] !== 1 || state?.claimed?.[index] !== 1)
        return [];
      return [
        {
          id: avatar.id,
          name: avatar.name,
          image: avatarImage(state.world, avatar.id),
          level: levelOf(state.world, avatar.id),
          self: avatar.id === state.actor,
        },
      ];
    })
    .sort(
      (a, b) => Number(b.self) - Number(a.self) || a.name.localeCompare(b.name),
    );
}

// In local play the one player is the avatar this world belongs to.
export function localPlayer(world) {
  const id = currentActor(world);
  const avatar = humanAvatar(id) || humanAvatars[0];
  return {
    id: avatar.id,
    name: avatar.name,
    image: avatarImage(world, avatar.id),
    level: levelOf(world, avatar.id),
    self: true,
  };
}

let refresh = () => {};
export function renderPlayers() {
  refresh();
}

export function installToolbar({
  session,
  getWorld,
  allowShared = () => true,
}) {
  const toolbar = document.querySelector(".top-actions");
  toolbar.setAttribute("role", "group");
  toolbar.setAttribute("aria-label", "World controls");
  const menuButton = element("button", "world-menu-toggle");
  menuButton.id = "toolbar-menu-button";
  decorate(menuButton, "menu", "Menu");
  const menu = element("nav", "world-menu");
  menu.id = "world-menu";
  menu.setAttribute("popover", "auto");
  menu.setAttribute("aria-label", "Menu");
  menuButton.setAttribute("popovertarget", menu.id);
  menuButton.setAttribute("aria-controls", menu.id);
  menuButton.setAttribute("aria-expanded", "false");
  menu.addEventListener("toggle", () => {
    menuButton.setAttribute(
      "aria-expanded",
      String(menu.matches(":popover-open")),
    );
    document.dispatchEvent(new Event("shared-dialog-change"));
  });
  menu.addEventListener(
    "click",
    (event) => {
      const target = event.target.closest("button");
      if (!target || target.dataset.keepMenu) return;
      menu.hidePopover();
      menuButton.focus();
    },
    true,
  );
  const tools = element("div", "menu-tools");
  menu.append(tools);
  for (const [id, icon, label] of [
    ["history-button", "conversation", "Memory"],
    ["shared-worlds-button", "share", "Invite"],
    ["menu-button", "settings", "Settings"],
  ]) {
    const button = document.getElementById(id);
    decorate(button, icon, label);
    tools.append(button);
  }
  installInnerLife(tools, getWorld);
  tools.append(
    tools.querySelector("#shared-worlds-button"),
    tools.querySelector("#menu-button"),
  );
  installAvatarMenu({ menu, session, getWorld, allowShared });
  document.body.append(menu);
  toolbar.append(menuButton);

  const toggle = element("button", "players-button");
  toggle.id = "players-button";
  decorate(toggle, "players", "Players");
  const count = element("span", "player-count");
  count.setAttribute("aria-hidden", "true");
  toggle.append(count);
  toggle.setAttribute("aria-haspopup", "dialog");
  toggle.setAttribute("aria-controls", "players-dialog");
  toggle.setAttribute("aria-expanded", "false");
  toolbar.append(toggle);

  const dialog = element("dialog", "players-dialog");
  dialog.id = "players-dialog";
  dialog.setAttribute("aria-labelledby", "players-title");
  dialog.setAttribute("aria-describedby", "players-summary");
  const heading = element("div", "modal-heading");
  const title = element("h2", "", "Players in this world");
  title.id = "players-title";
  const close = element("button", "players-close", "Close");
  close.type = "button";
  close.onclick = () => dialog.close();
  heading.append(title, close);
  const summary = element("p", "players-summary");
  summary.id = "players-summary";
  summary.setAttribute("role", "status");
  const list = element("ul", "players-list");
  list.setAttribute("aria-label", "Online players");
  const hint = element(
    "p",
    "players-hint",
    session
      ? "These players are connected to this world."
      : "Share this world to invite friends.",
  );
  dialog.append(heading, summary, list, hint);
  document.body.append(dialog);
  const changed = () => {
    toggle.setAttribute("aria-expanded", String(dialog.open));
    document.dispatchEvent(new Event("shared-dialog-change"));
  };
  toggle.onclick = () => {
    refresh();
    dialog.showModal();
    changed();
  };
  dialog.addEventListener("close", changed);
  let previous = "";
  refresh = () => {
    const reconnecting =
      session &&
      (session.connectionError || Date.now() - session.lastSynced > 20000);
    const local = getWorld();
    const players = session
      ? onlinePlayers(session.state)
      : [localPlayer(local)];
    const name = worldNameOf(session ? session.state.world : local);
    const key = JSON.stringify([Boolean(reconnecting), players, name]);
    if (key === previous) return;
    previous = key;
    count.textContent = reconnecting ? "…" : String(players.length);
    toggle.dataset.online = String(
      Boolean(session && !reconnecting && players.length),
    );
    toggle.setAttribute(
      "aria-label",
      reconnecting
        ? "Players, reconnecting"
        : session
          ? `Players, ${players.length} online in this world`
          : "Players, local world",
    );
    summary.textContent = reconnecting
      ? "Reconnecting… The player list will refresh when the connection returns."
      : session
        ? `${players.length} ${players.length === 1 ? "player" : "players"} online · ${name || "This world"}`
        : `Local play · ${name || "Your world"}`;
    list.replaceChildren();
    if (reconnecting) return;
    for (const player of players) {
      const row = element("li", "player-row");
      const portrait = element("img", "player-portrait");
      portrait.decoding = "async";
      portrait.loading = "lazy";
      portrait.src = imageUrl(`/card-game/${player.image}`, "card");
      portrait.alt = "";
      const copy = element("div", "player-copy");
      const name = element("strong", "player-name", player.name);
      if (player.self) name.append(element("span", "player-you", "You"));
      const details = element("span", "player-details");
      details.append(element("span", "player-level", `Level ${player.level}`));
      copy.append(name, details);
      row.append(portrait, copy);
      list.append(row);
    }
  };
  refresh();
}
