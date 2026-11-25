import { humanAvatars } from "./human-cast.mjs";
import { avatarImage } from "./scarves.mjs";
import { imageUrl } from "./images.mjs";
import { levelOf } from "./want.mjs";
import { installAvatarMenu } from "./avatar-menu.mjs";

const icons = {
  share: '<path d="M12 15V3m-4 4 4-4 4 4M5 12v8h14v-8"/>',
  character:
    '<circle cx="12" cy="7" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3M4 3v18M20 3v18"/>',
  menu: '<path d="M5 6h14M5 12h14M5 18h14"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="#141b22"/><circle cx="15" cy="17" r="3" fill="#141b22"/>',
  discord:
    '<path d="M9 5.5a14 14 0 0 0-4.5 1.6C2.6 10.2 2 13.3 2.2 16.4A15 15 0 0 0 7 18.8l1.2-2M15 5.5a14 14 0 0 1 4.5 1.6c1.9 3.1 2.5 6.2 2.3 9.3a15 15 0 0 1-4.8 2.4l-1.2-2"/><path d="M7 16.2c3.3 1.4 6.7 1.4 10 0M7.5 7.5c3-1 6-1 9 0"/><circle cx="9" cy="12.5" r="1.2"/><circle cx="15" cy="12.5" r="1.2"/>',
  x: '<path d="M4 4h4.5L20 20h-4.5Z"/><path d="M20 4l-6.8 7.6M4 20l6.8-7.6"/>',
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function decorate(button, icon, label, name = label) {
  const mark = element("span", "toolbar-icon");
  mark.setAttribute("aria-hidden", "true");
  mark.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${icons[icon]}</svg>`;
  button.replaceChildren(mark, element("span", "toolbar-label", label));
  button.setAttribute("aria-label", name);
  button.title = name;
  if (button.tagName === "BUTTON") button.type = "button";
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

let refresh = () => {};
export function renderPlayers() {
  refresh();
}

export function installToolbar({
  session,
  getWorld,
  allowShared = () => true,
  stopSaving,
  actionBeat,
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
  menuButton.addEventListener("click", () => {
    // Keep the native popover target and its existing controls available
    // if it was detached while the toolbar button stayed in place.
    if (!menu.isConnected) document.body.append(menu);
  });
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
    ["history-button", "character", "Character"],
    ["shared-worlds-button", "share", "Invite"],
    ["menu-button", "settings", "Settings"],
  ]) {
    const button = document.getElementById(id);
    decorate(button, icon, label);
    tools.append(button);
  }
  const seats = installAvatarMenu({
    menu,
    session,
    getWorld,
    allowShared,
    stopSaving,
    actionBeat,
  });
  document.body.append(menu);
  for (const [icon, label, name, href] of [
    ["discord", "Discord", "Discord", "https://discord.gg/Qd4ztZYvmD"],
    ["x", "X", "X, @lonelyforestAi", "https://x.com/lonelyforestAi"],
  ]) {
    const link = element("a");
    decorate(link, icon, label, name);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    toolbar.append(link);
  }
  toolbar.append(menuButton);

  // The one toolbar button opens ☰; its face shows the friends online in
  // this world now, not yourself (owner, 2026-11-01).
  const friends = element("span", "friend-chips");
  friends.setAttribute("aria-hidden", "true");
  menuButton.append(friends);
  let previous = "";
  refresh = () => {
    const reconnecting =
      session &&
      (session.connectionError || Date.now() - session.lastSynced > 20000);
    const online = session
      ? onlinePlayers(session.state).filter((player) => !player.self)
      : [];
    const key = JSON.stringify([Boolean(reconnecting), online]);
    if (key === previous) return;
    previous = key;
    friends.replaceChildren(
      ...online.slice(0, 3).map((friend) => {
        const face = element("img");
        face.src = imageUrl(`/card-game/${friend.image}`, "card");
        face.alt = "";
        const chip = element("i");
        chip.append(face);
        return chip;
      }),
    );
    if (reconnecting || online.length > 3)
      friends.append(
        element("span", "", reconnecting ? "…" : `+${online.length - 3}`),
      );
    const count = online.length === 1 ? "1 friend" : `${online.length} friends`;
    menuButton.setAttribute(
      "aria-label",
      reconnecting
        ? "Menu, reconnecting"
        : online.length
          ? `Menu, ${count} online`
          : "Menu",
    );
    seats();
  };
  refresh();
}
