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
import { avatarImage } from "./scarves.mjs";

// ☰ is one accordion of the passkey's world slots, then + New world and the
// deck of avatars in no world (v2/docs/card-table/avatar-menu.md, #1877).
// Each avatar shows once. Tap one of yours and the places it can go light
// up; tap one of those to move it there.
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

// A world's eight seats: yours is marked, other humans are held, and an
// unheld seat is the resident who lives there (#1846, #1866). A seat is in
// colour only while a person is online in it (owner, 2026-11-01). The seat
// this passkey is bound to but has stepped away from is free for it, so it
// shows as a resident too. The owner may free any held seat but their own.
function seatsOf(
  held,
  mine,
  { owner = false, online = [], holders = [] },
  away = null,
) {
  return byInitial(
    humanAvatars.map((avatar, index) => {
      const self = avatar.id === mine;
      const human = !self && avatar.id !== away && held[index] === 1;
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

// The slots this passkey shows now. Signed in: its own shared worlds (at most
// eight), a friend's world only while one of its avatars sits there, and the
// world a friend's link opened. Signed out: one local world per avatar. The
// world being played comes first. Avatars in no slot are the deck.
export function worldSlots({ shared, rows = [], here, invite = null, local }) {
  const slots = [];
  const sharedSlot = (row, held = row.held || [], from = row) => ({
    key: row.id,
    shared: row.id,
    name: worldName(row.seed) || "",
    owner: Boolean(row.owner),
    mine: row.actor || null,
    row,
    seats: seatsOf(held, row.actor, from, row.actor ? null : row.bound),
  });
  if (shared) {
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
  } else
    for (const avatar of byInitial(humanAvatars)) {
      const name = avatar.id === here.actor ? null : local(avatar.id);
      if (name !== null)
        slots.push({
          key: `local:${avatar.id}`,
          local: true,
          name,
          mine: avatar.id,
        });
    }
  const at = slots.findIndex(
    (slot) => here.place.shared && slot.shared === here.place.shared,
  );
  const found = at < 0 ? null : slots.splice(at, 1)[0];
  slots.unshift(
    here.place.shared
      ? {
          key: here.place.shared,
          shared: here.place.shared,
          row: { actor: here.actor },
          ...found,
          name: here.place.name,
          owner: Boolean(here.state?.owner),
          mine: here.actor,
          seats: worldSeats(here.state),
          current: true,
        }
      : {
          key: `local:${here.actor}`,
          local: true,
          name: here.place.name,
          mine: here.actor,
          current: true,
        },
  );
  for (const slot of slots) slot.seats ??= seatsOf([], slot.mine, {});
  // The player is online in the world being played.
  for (const seat of slots[0].seats)
    if (seat.kind === "you") seat.online = true;
  const placed = new Set(slots.map((slot) => slot.mine));
  const deck = byInitial(humanAvatars).filter((a) => !placed.has(a.id));
  const used = slots.filter((slot) => (shared ? slot.owner : slot.local));
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
  // Panels persist across redraws, so opening or folding one animates.
  let panels = new Map();
  const phone = matchMedia("(max-width: 700px)");
  let rows = [],
    shared = Boolean(session),
    invite = null,
    // The tapped seat: { id, slot }, where slot is null for the deck.
    chosen = null,
    opened = new Set(),
    // A tap on an avatar folds the worlds it cannot go to, once.
    refold = false,
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
  // Moving out of a local world loses it, so that asks with a second tap.
  async function go(button, avatar, from, run) {
    if (from?.local && button.dataset.armed !== "true") {
      button.dataset.armed = "true";
      status.textContent = leaveNote(avatar, from);
      return;
    }
    await run();
  }
  function target(label, avatar, from, run, id) {
    const button = act(label, () => go(button, avatar, from, run), id);
    button.classList.add("slot-target");
    return button;
  }
  // The deck's grey copy of the tapped avatar moves it there.
  function toDeck(face, avatar, from) {
    face.disabled = false;
    face.classList.add("slot-target");
    face.setAttribute("aria-label", `Move ${avatar.name} to your deck`);
    face.onclick = async () => {
      face.disabled = true;
      try {
        await go(face, avatar, from, async () => {
          await leave(avatar.id, from);
          if (from.current) return leaveHere();
          chosen = null;
          await load();
        });
      } catch (error) {
        status.textContent = error.message;
      } finally {
        face.disabled = false;
      }
    };
  }
  const toWorld = (avatar, from, slot) =>
    target(`Move ${avatar.name} here`, avatar, from, async () => {
      await command(slot.shared, { op: "claim", avatar: avatar.id });
      if (from?.local) await leave(avatar.id, from);
      stored(INVITE_KEY, null);
      location.href = sharedLink(slot.shared);
    });
  async function create(avatar, from) {
    if (!avatar) {
      status.textContent = "Tap one of your avatars first.";
      return;
    }
    if (!shared) {
      // The world being played starts over through the table's own reset.
      if (from?.current) return $("new-game").click();
      if (from) await leave(avatar.id, from);
      location.href = localLink(avatar.id);
      return;
    }
    const made = await request("/card-game/shared/worlds", {
      avatar: avatar.id,
    });
    if (from?.local) await leave(avatar.id, from);
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
  // Release or Delete world for yours, the owner's Free for another's.
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
    if (slot.shared)
      bar.append(
        twoTap(
          "Release",
          `Release ${seat.name} from ${name}?`,
          `${seat.name} keeps their level. Their things and quests stay in ${name}, and anyone may take ${seat.name} there.`,
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
  function seatButton(slotKey, seat, world) {
    const item = el("li", "slot-seat");
    item.dataset.avatar = seat.id;
    item.dataset.kind = seat.kind;
    const face = el("button", "seat-face");
    face.type = "button";
    face.dataset.keepMenu = "true";
    if (world && seat.kind === "you") face.id = "avatar-move";
    const picked = chosen?.id === seat.id && chosen.slot === slotKey;
    face.setAttribute("aria-pressed", String(picked));
    face.setAttribute(
      "aria-label",
      [seat.name, seat.holder, seat.level && `Level ${seat.level}`]
        .filter(Boolean)
        .join(" · "),
    );
    const image =
      (world && avatarImage(world, seat.id)) ||
      humanAvatars.find((a) => a.id === seat.id).image;
    const portrait = el("img");
    portrait.src = imageUrl(`/card-game/${image}`, "card");
    portrait.alt = "";
    face.append(portrait, el("span", "seat-name", seat.name));
    // Colour is presence: someone online in a world's seat, or your avatar
    // in the deck. Every other seat is grey.
    item.dataset.lit = String(Boolean(seat.online) || seat.kind === "deck");
    // A resident lives there on its own, and an avatar elsewhere is tapped
    // where it is; neither has anything to tap here.
    face.disabled = seat.kind === "resident" || seat.kind === "away";
    face.onclick = () => {
      chosen = picked ? null : { id: seat.id, slot: slotKey };
      refold = Boolean(chosen);
      status.textContent = "";
      render();
    };
    item.append(face);
    return item;
  }
  function render() {
    const view = worldSlots({
      shared,
      rows,
      here: here(),
      invite,
      local: localWorldName,
    });
    const from = view.slots.find((slot) => slot.key === chosen?.slot) || null;
    const avatar = humanAvatars.find((a) => a.id === chosen?.id);
    const mine =
      avatar && (from ? from.mine === avatar.id : view.deck.includes(avatar));
    const targets = mine
      ? targetsFor(avatar, from, view, shared)
      : { deck: false, worlds: [], create: false };
    // Tapping an avatar opens the places it can go and folds the worlds it
    // cannot. Nothing else folds a panel; on a phone only one world is open.
    if (refold && mine) {
      const keep = new Set(targets.worlds);
      if (from) keep.add(from.key);
      if (targets.deck || !from) keep.add("deck");
      for (const slot of view.slots)
        if (!phone.matches && !keep.has(slot.key)) opened.delete(slot.key);
      for (const key of keep)
        if (!phone.matches || key === "deck") opened.add(key);
    }
    refold = false;
    // Presence ticks redraw only when something shown has changed.
    const key = JSON.stringify([view, chosen, [...opened], phone.matches]);
    if (key === drawn) return;
    drawn = key;
    const last = panels;
    panels = new Map();
    // One panel per world, and the deck in the same form.
    const panel = (key, name, letters, label) => {
      const details = last.get(key) || el("details", "world-slot");
      panels.set(key, details);
      details.dataset.slot = key;
      details.removeAttribute("data-target");
      // On a phone only one world is open at a time.
      details.name = phone.matches && key !== "deck" ? "world-slot" : "";
      details.open = opened.has(key);
      details.ontoggle = () => {
        if (details.open) opened.add(key);
        else opened.delete(key);
      };
      const summary = el("summary");
      summary.append(el("strong", "", name));
      if (label) summary.append(el("small", "", label));
      const strip = el("span", "slot-letters");
      strip.setAttribute("aria-hidden", "true");
      for (const seat of letters)
        strip.append(
          el(
            "span",
            seat.online || seat.kind === "deck" ? "letter-lit" : "",
            seat.name[0],
          ),
        );
      summary.append(strip);
      details.replaceChildren(summary);
      return details;
    };
    const nodes = [];
    for (const slot of view.slots) {
      const label = slot.local
        ? "on this device"
        : slot.invite
          ? "invited"
          : !slot.owner && "a friend's world";
      const details = panel(
        slot.key,
        slot.name || "A world",
        slot.seats,
        label,
      );
      details.dataset.current = String(Boolean(slot.current));
      if (targets.worlds.includes(slot.key)) {
        details.dataset.target = "true";
        details.firstChild.append(toWorld(avatar, from, slot));
      }
      const world = slot.current ? session?.state.world || getWorld() : null;
      const seats = el("ul", "slot-seats");
      seats.append(...slot.seats.map((s) => seatButton(slot.key, s, world)));
      details.append(seats);
      const seat =
        chosen?.slot === slot.key &&
        slot.seats.find((s) => s.id === chosen.id && s.kind !== "resident");
      if (seat) details.append(seatActions(slot, seat));
      nodes.push(details);
    }
    if (view.canCreate || !shared) {
      const fresh = act(
        "+ New world",
        () => create(mine ? avatar : view.deck[0], mine ? from : null),
        "avatar-new-world",
      );
      fresh.classList.add("slot-new");
      if (targets.create) fresh.dataset.target = "true";
      nodes.push(fresh);
    }
    if (view.deck.length || targets.deck) {
      // The deck shows the whole cast like a world: avatars in no world in
      // colour, the rest grey, and the tapped one's grey copy a target.
      const seats = byInitial(humanAvatars).map((a) => ({
        id: a.id,
        name: a.name,
        kind: view.deck.includes(a) ? "deck" : "away",
      }));
      const deck = panel("deck", "Your deck", seats);
      deck.classList.add("avatar-deck");
      if (targets.deck) deck.dataset.target = "true";
      const list = el("ul", "slot-seats");
      for (const seat of seats) {
        const item = seatButton(null, seat);
        if (targets.deck && seat.id === avatar.id)
          toDeck(item.firstChild, avatar, from);
        list.append(item);
      }
      deck.append(list);
      nodes.push(deck);
    }
    // Panels that stay are not re-inserted, so their transitions run.
    nodes.forEach((node, i) => {
      if (box.children[i] !== node)
        box.insertBefore(node, box.children[i] || null);
    });
    while (box.children.length > nodes.length) box.lastChild.remove();
    if (mine && !status.textContent)
      status.textContent = `Tap where ${avatar.name} goes.`;
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
    opened = new Set([now.place.shared || `local:${now.actor}`, "deck"]);
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
      status.textContent = "Tap one of your avatars to bring it here.";
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
