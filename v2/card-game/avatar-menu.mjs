import { imageUrl } from "./images.mjs";
import { humanAvatars, currentActor } from "./human-cast.mjs";
import { request } from "./shared-auth.mjs";
import { worldName, worldNameOf } from "./world-name.mjs";
import {
  archiveLocal,
  deleteLocal,
  localWorldName,
  INVITE_KEY,
  PLAYING_KEY,
} from "./avatar-world.mjs";
import { levelOf } from "./want.mjs";
import { nameOf } from "./world.mjs";
import { avatarImage } from "./scarves.mjs";

// ☰ is one accordion of the passkey's world slots, then + New world and the
// tapped seat's stats (v2/docs/card-table/avatar-menu.md, #1877). Each
// world shows the whole cast. Tap a grey seat whose avatar may go there
// twice to move it there.
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
  button.dataset.keepMenu = "true";
  if (id) button.id = id;
  button.onclick = async (event) => {
    // A target sits in a slot's summary; tapping it must not fold the slot.
    event.preventDefault();
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
// Avatars show in initial order, R·A·T·V·M·I·C·S (#1846). Seat indices and
// ids keep the cast's own order.
export const byInitial = (avatars) =>
  [...avatars].sort(
    (a, b) => "RATVMICS".indexOf(a.name[0]) - "RATVMICS".indexOf(b.name[0]),
  );
const localLink = (id) => `/?avatar=${id}`;
const sharedLink = (id) => `/?world=${encodeURIComponent(id)}`;
// Leaving the world being played opens ☰ on the next page.
const MENU_KEY = "cosyworld.menu";
function stored(key, value) {
  try {
    if (value === undefined) return sessionStorage.getItem(key);
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {}
  return null;
}

// What leaving a world costs. A local world left or replaced is gone for
// good, with the avatar's level and quest there (#1825). Leaving a shared
// world takes the avatar's level along and frees its seat there (#1846).
export function leaveNote(avatar, place) {
  const name = place?.name || "This world";
  if (!place) return "";
  return place.local
    ? `${name} will be lost, with ${avatar.name}'s level and quest there. There is no way back to it.`
    : `${avatar.name}'s level goes with ${avatar.name}. ${avatar.name}'s things and quests stay in ${name}, and the seat there opens for someone else.`;
}

// A shared world this avatar can go to: one this person holds no avatar in,
// where the avatar is the one bound to them there, or a free one has room
// (#1825: a passkey keeps the avatar it took in a world).
export const joinable = (row, avatar) =>
  !row.actor && (row.bound ? row.bound === avatar.id : !row.full);

// A world's eight seats, as on the board: yours is marked, other humans are
// held, a seat in colour only while online (owner, 2026-11-01), and an
// unheld seat the resident who lives there (#1846, #1866). The owner may
// free any held seat but their own.
function seatsOf(held, mine, { owner = false, online = [], holders = [] }) {
  return byInitial(
    humanAvatars.map((avatar, index) => {
      const self = avatar.id === mine;
      const human = !self && held[index] === 1;
      return {
        id: avatar.id,
        name: avatar.name,
        kind: self ? "you" : human ? "human" : "resident",
        online: (self || human) && online[index] === 1,
        holder: self ? "You" : human ? holders[index] || "Someone" : "",
        free: Boolean(owner) && human,
      };
    }),
  );
}
// The shared world being played, from its snapshot.
export function worldSeats(state) {
  if (!state?.actor) return [];
  const flags = (test) => humanAvatars.map((_, i) => (test(i) ? 1 : 0));
  const held = flags((i) => state.bound?.[i] === 1 || state.claimed?.[i] === 1);
  const online = flags(
    (i) => state.present?.[i] === 1 && state.claimed?.[i] === 1,
  );
  return seatsOf(held, state.actor, { ...state, online }).map((seat) => ({
    ...seat,
    level: levelOf(state.world, seat.id),
  }));
}

// The slots this passkey shows now: its own shared worlds (at most eight), a
// friend's world only while one of its avatars sits there, and the world a
// friend's link opened, with the world being played first. Avatars in no
// slot are the deck. Signed out there are no slots: the player plays Vale
// in this browser, and that local save is its own passkey, never a slot
// (#1892, #1846).
export function worldSlots({ shared, rows = [], here, invite = null }) {
  if (!shared) return { slots: [], deck: [], canCreate: false };
  const slots = [];
  const sharedSlot = (row, held = row.held || [], from = row) => ({
    key: row.id,
    shared: row.id,
    name: worldName(row.seed) || "",
    owner: Boolean(row.owner),
    mine: row.actor || null,
    row,
    // The seat this passkey stepped away from is free for it.
    seats: seatsOf(
      held.map((h, i) => (row.actor || humanAvatars[i].id !== row.bound) && h),
      row.actor,
      from,
    ),
  });
  const owned = rows.filter((row) => row.owner).slice(0, 8);
  const seated = rows.filter((row) => row.actor && !owned.includes(row));
  slots.push(...[...owned, ...seated].map((row) => sharedSlot(row)));
  if (invite && !slots.some((slot) => slot.shared === invite.id)) {
    // The seat this passkey keeps there waits for its return (#1825).
    const held = humanAvatars.map((a, i) =>
      a.id !== invite.mine && (invite.claimed?.[i] || invite.bound?.[i])
        ? 1
        : 0,
    );
    const row = { ...invite, actor: null, bound: invite.mine || null };
    row.full = held.every(Boolean);
    slots.push({ ...sharedSlot(row, held, invite), invite: true });
  }
  if (here.place.shared) {
    const at = slots.findIndex((slot) => slot.shared === here.place.shared);
    const found = at < 0 ? null : slots.splice(at, 1)[0];
    slots.unshift({
      key: here.place.shared,
      shared: here.place.shared,
      row: { actor: here.actor },
      ...found,
      name: here.place.name,
      owner: Boolean(here.state?.owner),
      mine: here.actor,
      seats: worldSeats(here.state),
      current: true,
    });
  }
  // The player is online in the world being played.
  if (slots[0]?.current)
    for (const seat of slots[0].seats)
      if (seat.kind === "you") seat.online = true;
  const placed = new Set(slots.map((slot) => slot.mine));
  const deck = byInitial(humanAvatars).filter((a) => !placed.has(a.id));
  const used = slots.filter((slot) => slot.owner);
  return { slots, deck, canCreate: used.length < 8 };
}

// Where one of your avatars can go from `from`, its slot or null for the
// deck: the deck, another slot whose seat for it is free and that holds
// none of your avatars, and + New world while a slot is free.
export function targetsFor(avatar, from, { slots, canCreate }, shared) {
  return {
    deck: Boolean(from),
    worlds: slots
      .filter(
        (slot) =>
          slot !== from &&
          slot.shared &&
          !slot.mine &&
          joinable(slot.row, avatar) &&
          slot.seats.find((seat) => seat.id === avatar.id).kind === "resident",
      )
      .map((slot) => slot.key),
    // Locally each avatar has its own slot, so a local avatar always can.
    create: shared ? canCreate : true,
  };
}

// Where Delete world leaves the player (#1793, owner bug 2026-11-01): the
// world being played gives way to a fresh one for the same avatar, as New
// game does, never another avatar's world, which may be a shared world that
// does not open. Deleting another world stays in the menu.
export const afterDelete = (avatar, current) =>
  current ? localLink(avatar.id) : null;

export function installAvatarMenu({
  menu,
  session,
  getWorld,
  allowShared,
  stopSaving = () => {},
}) {
  const box = el("div", "world-slots");
  box.setAttribute("aria-label", "Your worlds");
  const status = el("p", "avatar-status");
  status.id = "avatar-status";
  status.setAttribute("role", "status");
  menu.prepend(box, status);
  const phone = matchMedia("(max-width: 700px)");
  let rows = [],
    shared = Boolean(session),
    invite = null,
    // The tapped seat: { id, slot, away }, away after a second tap on yours.
    chosen = null,
    opened = new Set(),
    drawn = "";
  const here = () => {
    const world = getWorld();
    const actor = session ? session.state.actor : currentActor(world);
    const name = worldNameOf(session ? session.state.world : world) || "";
    return {
      actor,
      state: session?.state,
      place: session ? { shared: session.id, name } : { local: true, name },
    };
  };
  const command = (worldId, body) =>
    request(`/card-game/shared/worlds/${worldId}/command`, body);
  // After the world being played lets its avatar go, the bare address opens
  // with ☰, and the player picks what comes next.
  const leaveHere = () => {
    stopSaving();
    try {
      localStorage.removeItem(PLAYING_KEY);
    } catch {}
    stored(MENU_KEY, "1");
    location.href = "/";
  };
  const leave = async (id, from) => {
    if (from.current) stopSaving();
    if (from.shared) await command(from.shared, { op: "release" });
    else archiveLocal(id);
  };
  const redraw = () => {
    drawn = "";
    render();
  };
  const toWorld = async (avatar, from, slot) => {
    await command(slot.shared, { op: "claim", avatar: avatar.id });
    if (from?.local) await leave(avatar.id, from);
    stored(INVITE_KEY, null);
    location.href = sharedLink(slot.shared);
  };
  async function create(avatar) {
    if (!shared) {
      location.href = localLink(avatar.id);
      return;
    }
    const made = await request("/card-game/shared/worlds", {
      avatar: avatar.id,
    });
    location.href = sharedLink(made.id);
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
    return button;
  }
  // The tapped seat's actions, under its world's line of seats: Play and
  // Release or Delete world for yours, and Step away after a second tap on
  // it; the owner's Free for another's.
  function seatActions(slot, seat) {
    const name = slot.name || "this world";
    const bar = el("div", "avatar-actions");
    const level = seat.level ? ` · Level ${seat.level}` : "";
    bar.append(
      el("small", "seat-note", `${seat.name} · ${seat.holder}${level}`),
    );
    if (seat.kind === "human") {
      if (slot.owner)
        bar.append(
          twoTap(
            `Free ${seat.name}`,
            `Free ${seat.name}?`,
            `Free ${seat.name}: removes ${seat.holder}'s hold and resets ${seat.name}.`,
            async () => {
              await command(slot.shared, { op: "reset", avatar: seat.id });
              location.reload();
            },
          ),
        );
      return bar;
    }
    if (!slot.current)
      bar.append(
        act("Play", () => {
          location.href = slot.shared
            ? sharedLink(slot.shared)
            : localLink(seat.id);
        }),
      );
    // Step away frees the seat and keeps the avatar's level and binding, so
    // it is in no world until + New world or a move (was Move to your deck).
    if (chosen?.away)
      bar.append(
        act(
          "Step away",
          async () => {
            await leave(seat.id, slot);
            if (slot.current) return leaveHere();
            chosen = null;
            await load();
          },
          "avatar-step-away",
        ),
      );
    if (slot.shared)
      bar.append(
        twoTap(
          "Release · start over",
          `Release ${seat.name} and start over?`,
          `${seat.name} starts over at level 1. Their things and quests stay in ${name}, and anyone may take ${seat.name} there.`,
          async () => {
            await command(slot.shared, { op: "reset", avatar: seat.id });
            if (slot.current) return leaveHere();
            chosen = null;
            await load();
          },
        ),
      );
    else
      bar.append(
        twoTap("Delete world", `Delete ${name} and its progress?`, "", () => {
          // The world being played stops saving first, so nothing writes it
          // back before the page leaves.
          if (slot.current) stopSaving();
          deleteLocal(seat.id);
          const next = afterDelete(seat, slot.current);
          if (next) return location.replace(next);
          chosen = null;
          redraw();
          status.textContent = `${slot.name || "The world"} is gone.`;
        }),
      );
    return bar;
  }
  function seatButton(slot, seat, world, view) {
    const item = el("li", "slot-seat");
    item.dataset.avatar = seat.id;
    item.dataset.kind = seat.kind;
    const face = el("button", "seat-face");
    face.type = "button";
    face.dataset.keepMenu = "true";
    if (world && seat.kind === "you") face.id = "avatar-move";
    const picked = chosen?.id === seat.id && chosen.slot === slot.key;
    face.setAttribute("aria-pressed", String(picked));
    face.setAttribute(
      "aria-label",
      [seat.name, seat.holder, seat.level && `Level ${seat.level}`]
        .filter(Boolean)
        .join(" · "),
    );
    // A grey seat whose avatar may come here: a second tap brings it.
    const avatar = humanAvatars.find((a) => a.id === seat.id);
    const from = view.slots.find((s) => s.mine === seat.id) || null;
    const move =
      seat.kind === "resident" &&
      targetsFor(avatar, from, view, shared).worlds.includes(slot.key);
    if (move) face.classList.add("slot-target");
    const image =
      (world && avatarImage(world, seat.id)) ||
      humanAvatars.find((a) => a.id === seat.id).image;
    const portrait = el("img");
    portrait.src = imageUrl(`/card-game/${image}`, "card");
    portrait.alt = "";
    face.append(portrait, el("span", "seat-name", seat.name));
    // Colour is presence: someone online in the seat. Every other is grey.
    item.dataset.lit = String(Boolean(seat.online));
    // A tap selects the seat: its stats show below, and your seat its
    // actions; a second tap on yours offers Step away. Leaving a local world
    // says what is lost before the second tap.
    face.onclick = async () => {
      if (!picked || !move) {
        const away = picked && seat.kind === "you";
        chosen = { id: seat.id, slot: slot.key, away };
        status.textContent = away
          ? leaveNote(avatar, slot)
          : !move
            ? ""
            : from?.local
              ? leaveNote(avatar, from)
              : `Tap ${avatar.name} again to bring ${avatar.name} here.`;
        return render();
      }
      face.disabled = true;
      try {
        await toWorld(avatar, from, slot);
      } catch (error) {
        status.textContent = error.message;
      } finally {
        face.disabled = false;
      }
    };
    item.append(face);
    return item;
  }
  // The selected seat's stats, from what this page knows: level and what it
  // holds in the world being played, and who has it (#1891).
  function stats(view, { id, slot: key }) {
    const slot = view.slots.find((s) => s.key === key) || view.slots[0];
    const seat = slot.seats.find((s) => s.id === id);
    const world = slot.current ? session?.state.world || getWorld() : null;
    const home = view.slots.find((s) => s.mine === id);
    const where = home ? `in ${home.name || "a world"}` : "in no world";
    const level = seat.level || (world && levelOf(world, id));
    const held =
      world &&
      Object.keys(world.items).filter((i) => world.items[i].holder === id);
    const box = el("div", "avatar-stats");
    box.append(
      el("strong", "", `${seat.name}${level ? ` · Level ${level}` : ""}`),
      el(
        "small",
        "",
        seat.kind === "human"
          ? `Played by ${seat.holder} · ${seat.online ? "online" : "offline"}`
          : seat.kind === "you"
            ? `Yours · ${seat.online ? "online" : "offline"}`
            : `Lives here on their own · your ${seat.name} is ${where}`,
      ),
    );
    if (held?.length)
      box.append(el("small", "", `Holds ${held.map(nameOf).join(", ")}`));
    return box;
  }
  function render() {
    // Signed out, ☰ has no world UI at all (#1892).
    box.hidden = !shared;
    const view = worldSlots({
      shared,
      rows,
      here: here(),
      invite,
      local: localWorldName,
    });
    // Presence ticks redraw only when something shown has changed.
    const key = JSON.stringify([view, chosen, [...opened], phone.matches]);
    if (key === drawn) return;
    drawn = key;
    box.replaceChildren();
    for (const slot of view.slots) {
      const details = el("details", "world-slot");
      details.dataset.slot = slot.key;
      details.dataset.current = String(Boolean(slot.current));
      // On a phone only one world is open at a time.
      if (phone.matches) details.name = "world-slot";
      details.open = opened.has(slot.key);
      details.ontoggle = () => {
        if (details.open) opened.add(slot.key);
        else opened.delete(slot.key);
      };
      const summary = el("summary");
      const label = slot.local
        ? "on this device"
        : slot.invite
          ? "invited"
          : !slot.owner && "a friend's world";
      summary.append(el("strong", "", slot.name || "A world"));
      if (label) summary.append(el("small", "", label));
      const letters = el("span", "slot-letters");
      letters.setAttribute("aria-hidden", "true");
      for (const seat of slot.seats)
        letters.append(el("span", seat.online ? "lit" : "", seat.name[0]));
      summary.append(letters);
      const world = slot.current ? session?.state.world || getWorld() : null;
      const seats = el("ul", "slot-seats");
      seats.append(...slot.seats.map((s) => seatButton(slot, s, world, view)));
      details.append(summary, seats);
      const seat =
        chosen?.slot === slot.key &&
        slot.seats.find((s) => s.id === chosen.id && s.kind !== "resident");
      if (seat) details.append(seatActions(slot, seat));
      box.append(details);
    }
    if (view.deck.length && (view.canCreate || !shared)) {
      const fresh = act(
        "+ New world",
        () => create(view.deck[0]),
        "avatar-new-world",
      );
      fresh.classList.add("slot-new");
      box.append(fresh);
    }
    box.append(
      stats(view, chosen || { id: here().actor, slot: view.slots[0].key }),
    );
  }
  menu.addEventListener("toggle", () => {
    if (!menu.matches(":popover-open")) {
      // A friend's world shows once, until ☰ closes or an avatar goes there.
      if (invite) stored(INVITE_KEY, null);
      invite = null;
      return;
    }
    const now = here();
    chosen = null;
    opened = new Set([now.place.shared || `local:${now.actor}`]);
    status.textContent = "";
    redraw();
    load(stored(INVITE_KEY));
  });
  // Signed in, the slots are the account's shared worlds. Without the
  // server the menu keeps what it has.
  async function load(inviteId) {
    try {
      if (!allowShared()) return;
      const account = await request("/auth/account");
      shared = Boolean(session || account.authenticated);
      if (!shared) return;
      rows = (await request("/card-game/shared/worlds")).worlds;
      if (!inviteId) return;
      const view = await request(`/card-game/shared/worlds/${inviteId}`);
      invite = { ...view, id: inviteId };
      opened.add(inviteId);
      status.textContent = "Tap an avatar there to bring it in.";
    } catch {
    } finally {
      redraw();
    }
  }
  if (stored(INVITE_KEY) || stored(MENU_KEY)) {
    stored(MENU_KEY, null);
    setTimeout(() => menu.showPopover(), 0);
  }
  return () => {
    if (menu.matches(":popover-open")) render();
  };
}
