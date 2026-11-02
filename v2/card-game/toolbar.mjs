import { installInnerLife } from "./inner-life.mjs";
import { humanAvatars } from "./human-cast.mjs";
import { avatarImage } from "./scarves.mjs";
import { imageUrl } from "./images.mjs";
import { levelOf } from "./want.mjs";
import { installAvatarMenu } from "./avatar-menu.mjs";

const icons = {
  share: '<path d="M12 15V3m-4 4 4-4 4 4M5 12v8h14v-8"/>',
  conversation:
    '<path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 13h6"/>',
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

let refresh = () => {};
export function renderPlayers() {
  refresh();
}

export function installToolbar({
  session,
  getWorld,
  allowShared = () => true,
  stopSaving,
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
  const seats = installAvatarMenu({
    menu,
    session,
    getWorld,
    allowShared,
    stopSaving,
  });
  document.body.append(menu);
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
