import { imageUrl } from "./images.mjs";
import { humanAvatars, currentActor } from "./human-cast.mjs";
import { request } from "./shared-auth.mjs";
import { worldName, worldNameOf } from "./world-name.mjs";
import { archiveLocal, deleteLocal, localWorldName } from "./avatar-world.mjs";
import { levelOf } from "./want.mjs";
import { avatarImage } from "./scarves.mjs";

// ☰ lists the player's eight avatars and where each is now
// (v2/docs/card-table/avatar-menu.md): Play, Send to…, Step away, Delete
// world (local) or Release (shared), New world, Join. In a shared world the
// Table above it shows who holds each of the world's avatars.
const $ = (id) => document.getElementById(id);
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function act(label, run, id) {
  const button = el("button", "avatar-act", label);
  button.type = "button";
  if (id) button.id = id;
  button.onclick = async () => {
    button.disabled = true;
    try {
      await run();
    } catch (error) {
      const status = $("avatar-status");
      if (status) status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
  return button;
}
const localLink = (id) => `/?avatar=${id}`;
const sharedLink = (id) => `/?world=${encodeURIComponent(id)}`;

// The account's shared worlds: the newest row per avatar is where it is.
async function sharedRows() {
  const account = await request("/auth/account");
  if (!account.authenticated) return [];
  return (await request("/card-game/shared/worlds")).worlds;
}
export function placesOf(rows, here) {
  const places = {};
  for (const avatar of humanAvatars) {
    const row = rows.find((r) => r.actor === avatar.id);
    const local = localWorldName(avatar.id);
    places[avatar.id] = row
      ? { shared: row.id, name: worldName(row.seed) || "" }
      : local !== null
        ? { local: true, name: local }
        : null;
  }
  if (here.place) places[here.actor] = here.place;
  return places;
}

// What leaving a world costs. A local world left or replaced is gone for
// good, with the avatar's level and quest there (#1825); a shared world keeps
// the avatar's things for its return.
export function leaveNote(avatar, place) {
  const name = place?.name || "This world";
  if (!place) return "";
  return place.local
    ? `${name} will be lost, with ${avatar.name}'s level and quest there. There is no way back to it.`
    : `${name} keeps ${avatar.name}'s things.`;
}

// A shared world this avatar can go to: one this person holds no avatar in,
// where the avatar is the one bound to them there, or a free one has room
// (#1825: a passkey keeps the avatar it took in a world).
export const joinable = (row, avatar) =>
  !row.actor && (row.bound ? row.bound === avatar.id : !row.full);

// The Table: this shared world's eight avatars as seats. Yours is in colour;
// another person's is grey with their holder name, and a green dot while
// they are here; an open seat is a card back. The owner may free any seat
// but their own.
export function worldSeats(state) {
  if (!state?.actor) return [];
  return humanAvatars.map((avatar, index) => {
    const self = avatar.id === state.actor;
    const held = state.bound?.[index] === 1 || state.claimed?.[index] === 1;
    const online = state.present?.[index] === 1 && state.claimed?.[index] === 1;
    const kind = self ? "you" : !held ? "open" : online ? "human" : "away";
    return {
      id: avatar.id,
      name: avatar.name,
      kind,
      holder: self ? "You" : held ? state.holders?.[index] || "Someone" : "",
      level: levelOf(state.world, avatar.id),
      free: Boolean(state.owner) && held && !self,
    };
  });
}

export function installAvatarMenu({ menu, session, getWorld, allowShared }) {
  const list = el("ul", "avatar-list");
  list.setAttribute("aria-label", "Your avatars");
  const status = el("p", "avatar-status");
  status.id = "avatar-status";
  status.setAttribute("role", "status");
  const seatList = el("ul", "table-seats");
  seatList.setAttribute("aria-label", "Avatars in this world");
  menu.prepend(seatList, list, status);
  const dialog = el("dialog", "avatar-dialog");
  dialog.id = "avatar-dialog";
  document.body.append(dialog);
  let rows = [];
  let open = null;
  const ask = (title, note, choices) => {
    menu.hidePopover();
    const close = act("Close", () => dialog.close());
    const heading = el("div", "modal-heading");
    heading.append(el("h2", "", title), close);
    dialog.replaceChildren(heading, el("p", "avatar-note", note), ...choices);
    dialog.showModal();
  };
  const here = () => {
    const world = getWorld();
    const actor = session ? session.state.actor : currentActor(world);
    const name = worldNameOf(session ? session.state.world : world) || "";
    return {
      actor,
      place: session ? { shared: session.id, name } : { local: true, name },
    };
  };
  const release = (worldId) =>
    request(`/card-game/shared/worlds/${worldId}/command`, { op: "release" });
  // Leave: a shared claim is released; a local save is kept as a backup.
  async function leave(id, place) {
    if (place.shared) await release(place.shared);
    else archiveLocal(id);
  }
  function move(avatar, place) {
    const current = here().actor === avatar.id;
    const targets = rows.filter(
      (row) => joinable(row, avatar) && row.id !== place?.shared,
    );
    // The current local world's New world is the table's own reset.
    const fresh = act(
      "New world",
      async () => {
        if (current && place?.local) {
          dialog.close();
          return $("new-game").click();
        }
        if (place) await leave(avatar.id, place);
        location.href = localLink(avatar.id);
      },
      "avatar-new-world",
    );
    ask(`Send ${avatar.name} to…`, leaveNote(avatar, place), [
      ...targets.map((row) =>
        act(worldName(row.seed) || "A world", async () => {
          await request(`/card-game/shared/worlds/${row.id}/command`, {
            op: "claim",
            avatar: avatar.id,
            move: true,
          });
          archiveLocal(avatar.id);
          location.href = sharedLink(row.id);
        }),
      ),
      fresh,
    ]);
  }
  function actions(avatar, place, current, places) {
    if (!place)
      return [
        act("New world", () => (location.href = localLink(avatar.id))),
        ...(rows.some((row) => joinable(row, avatar))
          ? [act("Join", () => move(avatar, null))]
          : []),
      ];
    return [
      ...(current
        ? []
        : [
            act("Play", () => {
              location.href = place.shared
                ? sharedLink(place.shared)
                : localLink(avatar.id);
            }),
          ]),
      act("Send to…", () => move(avatar, place), current ? "avatar-move" : ""),
      act("Step away", () =>
        ask(
          `Step away from ${place.name || "this world"}?`,
          place.local
            ? leaveNote(avatar, place)
            : `${avatar.name} stays yours there, with ${avatar.name}'s things.`,
          [
            act("Step away", async () => {
              await leave(avatar.id, place);
              if (!current) return location.reload();
              goOn(avatar, places, "vale");
            }),
          ],
        ),
      ),
      // The server has no world delete; a shared world offers Release.
      place.local
        ? remove(avatar, place, current, places)
        : giveUp(avatar, place, current, places),
    ];
  }
  // Go on as another avatar that is somewhere, or start `fallback` afresh.
  function goOn(avatar, places, fallback) {
    const next = humanAvatars.find((a) => a.id !== avatar.id && places[a.id]);
    const there = next && places[next.id];
    location.href = there?.shared
      ? sharedLink(there.shared)
      : localLink(next?.id || fallback);
  }
  // Delete world asks with a second tap on the same, now red, button.
  function remove(avatar, place, current, places) {
    const button = act("Delete world", () => {
      if (button.dataset.armed !== "true") {
        button.dataset.armed = "true";
        button.textContent = `Delete ${place.name || "this world"} and its progress?`;
        return;
      }
      deleteLocal(avatar.id);
      if (current) return goOn(avatar, places, avatar.id);
      status.textContent = `${place.name || "The world"} is gone.`;
      render();
    });
    button.classList.add("avatar-delete");
    button.dataset.keepMenu = "true";
    return button;
  }
  // A red button that asks with a second tap, then runs.
  function twoTap(label, armed, note, run) {
    const button = act(label, async () => {
      if (button.dataset.armed !== "true") {
        button.dataset.armed = "true";
        button.textContent = armed;
        status.textContent = note;
        return;
      }
      await run();
    });
    button.classList.add("avatar-delete");
    button.dataset.keepMenu = "true";
    return button;
  }
  const reset = (worldId, avatar) =>
    request(`/card-game/shared/worlds/${worldId}/command`, {
      op: "reset",
      avatar,
    });
  // Release: the holder gives up their avatar in a shared world. It starts
  // over, and its place there is free for anyone (#1825).
  function giveUp(avatar, place, current, places) {
    const name = place.name || "this world";
    return twoTap(
      "Release",
      `Release ${avatar.name} from ${name}?`,
      `${avatar.name}'s level and things in ${name} are lost, and anyone may take ${avatar.name} there.`,
      async () => {
        await reset(place.shared, avatar.id);
        if (current) goOn(avatar, places, avatar.id);
        else location.reload();
      },
    );
  }
  // The owner frees an avatar someone holds: their hold ends and it starts
  // over as a fresh starter, free for anyone.
  function seat(row) {
    const item = el("li", "table-seat");
    item.dataset.avatar = row.id;
    item.dataset.kind = row.kind;
    const card = el("div", "table-card");
    if (row.kind !== "open") {
      const portrait = el("img");
      portrait.src = imageUrl(
        `/card-game/${avatarImage(session.state.world, row.id)}`,
        "card",
      );
      portrait.alt = "";
      card.append(portrait);
    }
    if (row.kind === "human" || row.kind === "you") {
      const dot = el("span", "table-online");
      dot.setAttribute("aria-label", "here now");
      card.append(dot);
    }
    const strip = el("span", "table-strip");
    strip.append(
      el("strong", "", row.name),
      el(
        "small",
        "",
        row.kind === "open"
          ? "open seat"
          : `${row.holder} · Level ${row.level}`,
      ),
    );
    card.append(strip);
    item.append(card);
    if (row.free)
      item.append(
        twoTap(
          `Free ${row.name}`,
          `Free ${row.name}?`,
          `Free ${row.name}: removes ${row.holder}'s hold and resets ${row.name}.`,
          async () => {
            await reset(session.id, row.id);
            location.reload();
          },
        ),
      );
    return item;
  }
  let seatKey = "";
  function renderSeats() {
    const rows = session ? worldSeats(session.state) : [];
    const key = JSON.stringify(rows);
    if (key === seatKey) return;
    seatKey = key;
    seatList.replaceChildren();
    if (!rows.length) return;
    const heading = el("li", "avatar-seats-heading");
    const here = rows.filter((r) => r.kind === "human" || r.kind === "you");
    const open = rows.filter((r) => r.kind === "open").length;
    heading.append(
      el("strong", "", worldNameOf(session.state.world) || "This world"),
      el(
        "small",
        "",
        `${here.length} ${here.length === 1 ? "human" : "humans"} here now · ${open} of 8 seats free`,
      ),
    );
    seatList.append(heading, ...rows.map(seat));
  }
  function render() {
    const now = here();
    const places = placesOf(rows, now);
    list.replaceChildren();
    for (const avatar of humanAvatars) {
      const place = places[avatar.id];
      const current = avatar.id === now.actor;
      const row = el("li", "avatar-row");
      row.dataset.avatar = avatar.id;
      row.dataset.here = String(current);
      const face = el("button", "avatar-face");
      face.type = "button";
      face.dataset.keepMenu = "true";
      face.setAttribute("aria-expanded", String(open === avatar.id));
      const portrait = el("img");
      portrait.src = imageUrl(`/card-game/${avatar.image}`, "card");
      portrait.alt = "";
      const where = el("small");
      if (place) {
        where.append("in ", el("em", "", place.name || "a world"));
      } else where.textContent = "not in a world";
      const copy = el("span");
      copy.append(el("strong", "", avatar.name), where);
      face.append(portrait, copy);
      if (current) face.append(el("span", "avatar-here", "here"));
      face.onclick = () => {
        open = open === avatar.id ? null : avatar.id;
        render();
      };
      row.append(face);
      if (open === avatar.id) {
        const bar = el("div", "avatar-actions");
        bar.append(...actions(avatar, place, current, places));
        row.append(bar);
      }
      list.append(row);
    }
    seatKey = "";
    renderSeats();
  }
  menu.addEventListener("toggle", () => {
    if (!menu.matches(":popover-open")) return;
    open = here().actor;
    status.textContent = "";
    render();
    if (allowShared())
      sharedRows()
        .then((value) => {
          rows = value;
          render();
        })
        .catch(() => {});
  });
  // Presence changes while ☰ is open refresh who is here.
  return () => {
    if (menu.matches(":popover-open")) renderSeats();
  };
}
