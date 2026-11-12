import { accountStorage as localStorage, accountSessionStorage as sessionStorage } from "./account-reset-storage.mjs";
import { imageUrl } from "./images.mjs";
import { humanAvatars, currentActor } from "./human-cast.mjs";
import { leavePage } from "./page-fade.mjs";
import { request } from "./shared-auth.mjs";
import { worldName, worldNameOf } from "./world-name.mjs";
import { INVITE_KEY, PLAYING_KEY } from "./avatar-world.mjs";
import { queueTitleIntro } from "./title-intro.mjs";
import { levelOf } from "./want.mjs";
import { nameOf } from "./world.mjs";
import { avatarImage } from "./scarves.mjs";
import { levelTier, romanLevel } from "./rarity.mjs";
import { cachedWorldTier, tintByTier, worldLevel } from "./world-level.mjs";

// ☰ lists the passkey's worlds, each with the avatars that have entered it
// and "+" for an open seat, then + New world. A chosen avatar and its
// action are a beat in front of the dialogue
// (v2/docs/card-table/avatar-menu.md, #1877).
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
  button.onclick = guard(run);
  return button;
}
// A seat's action runs once at a time; a failure reads on ☰'s status line.
function guard(run) {
  return async (event) => {
    // A target sits in a slot's summary; tapping it must not fold the slot.
    event.preventDefault();
    const button = event.currentTarget;
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
}
const face = (path) => imageUrl(`/card-game/${path}`, "card");
// Avatars show in initial order, R·A·T·V·M·I·C·S (#1846). Seat indices and
// ids keep the cast's own order.
export const byInitial = (avatars) =>
  [...avatars].sort(
    (a, b) => "RATVMICS".indexOf(a.name[0]) - "RATVMICS".indexOf(b.name[0]),
  );
const sharedLink = (id) => `/?world=${encodeURIComponent(id)}`;
// Leaving the world being played opens ☰ on the next page. Switching to an
// avatar in another world stores its id instead, so ☰ opens there with it
// chosen.
const MENU_KEY = "cosyworld.menu";
function stored(key, value) {
  try {
    if (value === undefined) return sessionStorage.getItem(key);
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {}
  return null;
}

// The chosen avatar's second line: where it is now. Another person's seat
// names who holds it first.
export function seatLine(seat, slot) {
  const where = slot ? `Exploring ${slot.name || "a world"}` : "In no world";
  return seat.kind === "human" ? `${seat.holder} · ${where}` : where;
}

// A shared world your avatars can go to: one you have played, where the
// avatar you had stays as a resident (owner, 2026-11-03), or one with room.
export const joinable = (row) => Boolean(row.actor || row.bound) || !row.full;

// A world's eight seats, as on the board: yours is marked, other humans are
// held, a seat in colour only while online (owner, 2026-11-01), and an
// unheld seat the resident who lives there (#1846, #1866). The owner may
// free any held seat but their own. The world list says who is online in
// each world and each avatar's level there (`online`, `actors`).
function seatsOf(
  held,
  mine,
  { owner = false, online = [], holders = [], actors = null },
) {
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
        level: actors?.[avatar.id] ? levelOf({ actors }, avatar.id) : 0,
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
// (#1892, #1846). A world nobody is in any more has closed on the server and
// is not listed (full_retire.rs). An avatar this passkey has not found yet
// (`unlocked`, from the world list) is `locked`: a card back, in no deck
// (#1936). Once nobody is left to find, a new world hides nobody.
export function worldSlots({
  shared,
  rows = [],
  here,
  invite = null,
  unlocked = null,
}) {
  if (!shared) return { slots: [], deck: [], locked: [], canCreate: false };
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
  const found = (a) => !unlocked || unlocked.includes(a.id);
  const cast = byInitial(humanAvatars);
  const deck = cast.filter((a) => !placed.has(a.id) && found(a));
  const locked = cast.filter((a) => !found(a));
  const used = slots.filter((slot) => slot.owner);
  return {
    slots,
    deck,
    locked,
    canCreate: used.length < 8,
  };
}

// Where one of your found avatars can go from `from`, its slot or null for
// the deck: the deck, another slot whose seat for it is free, and + New
// world while a slot is free. In a slot with another of yours, that one
// stays there as a resident (owner, 2026-11-03).
export function targetsFor(avatar, from, { slots, canCreate, locked = [] }) {
  if (locked.some((a) => a.id === avatar.id))
    return { deck: false, worlds: [], create: false };
  return {
    deck: Boolean(from),
    worlds: slots
      .filter(
        (slot) =>
          slot !== from &&
          slot.shared &&
          joinable(slot.row) &&
          slot.seats.find((seat) => seat.id === avatar.id).kind === "resident",
      )
      .map((slot) => slot.key),
    create: canCreate,
  };
}

export function installAvatarMenu({
  menu,
  session,
  getWorld,
  allowShared,
  stopSaving = () => {},
  actionBeat = { show() {}, clear() {} },
}) {
  const box = el("div", "world-slots");
  box.setAttribute("aria-label", "Your worlds");
  const status = el("p", "avatar-status");
  status.id = "avatar-status";
  status.setAttribute("role", "status");
  menu.prepend(box, status);
  let rows = [],
    unlocked = null,
    shared = Boolean(session),
    invite = null,
    // The card's avatar: a tapped seat { id, slot }, or one "+" offers
    // { id, to, first }.
    chosen = null,
    // A second tap on someone else's chosen portrait arms it, so the owner
    // may free it. A tap anywhere else disarms.
    armed = false,
    // What a seat action did, said when ☰ next opens.
    result = "",
    drawn = "",
    // The beat ☰ shows; Settings borrows the same place.
    beat = null,
    // The avatar a switch from another world chose, or "1" after Leave.
    arrived = stored(MENU_KEY);
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
    leavePage(() => (location.href = "/"));
  };
  const leave = async (from) => {
    if (from.current) stopSaving();
    await command(from.shared, { op: "release" });
  };
  const redraw = () => {
    drawn = "";
    render();
  };
  const toWorld = async (avatar, from, slot) => {
    await command(slot.shared, { op: "claim", avatar: avatar.id });
    stored(INVITE_KEY, null);
    queueTitleIntro(slot.shared);
    await leavePage(() => (location.href = sharedLink(slot.shared)));
  };
  // A new world hides the next avatar this passkey has not found.
  async function create(avatar) {
    const made = await request("/card-game/shared/worlds", {
      avatar: avatar.id,
    });
    queueTitleIntro(made.id);
    await leavePage(() => (location.href = sharedLink(made.id)));
  }
  // The chosen seat's action: Leave for yours, the owner's Free for
  // another's once armed, or Nudge for a player in the same room.
  function seatAction(slot, seat) {
    if (seat.kind === "human") {
      if (!slot.owner || !armed) {
        const state = session?.state;
        const actors = state?.world?.actors;
        if (
          !slot.current ||
          !seat.online ||
          !actors ||
          actors[seat.id]?.place !== actors[state.actor]?.place
        )
          return {};
        return {
          buttons: [
            {
              label: "Nudge",
              run: guard(() =>
                session.command({ op: "nudge", target: seat.id }),
              ),
            },
          ],
        };
      }
      const free = async () => {
        await command(slot.shared, { op: "reset", avatar: seat.id });
        await leavePage(() => location.reload());
      };
      return {
        note: `Removes ${seat.holder}'s hold and resets ${seat.name}.`,
        buttons: [{ label: "Free", id: "avatar-free", run: guard(free) }],
      };
    }
    if (seat.kind !== "you") return {};
    // Leave frees the seat and keeps the avatar's level and binding, so it
    // is in no world until + New world or a move.
    const leaveSeat = async () => {
      await leave(slot);
      if (slot.current) return leaveHere();
      // The tap outside closed ☰; it opens again to say so.
      result = `${seat.name} left ${slot.name || "the world"}.`;
      menu.showPopover();
    };
    return {
      message: `${seat.name} leaves ${slot.name || "the world"}`,
      buttons: [{ label: "Leave", id: "avatar-leave", run: guard(leaveSeat) }],
    };
  }
  function seatButton(slot, seat, world, shown) {
    const item = el("li", "slot-seat");
    item.dataset.avatar = seat.id;
    item.dataset.kind = seat.kind;
    const face = el("button", "seat-face");
    face.type = "button";
    face.dataset.keepMenu = "true";
    if (world && seat.kind === "you") face.id = "avatar-move";
    const picked = chosen?.id === seat.id && chosen.slot === slot.key;
    face.setAttribute("aria-pressed", String(picked));
    if (picked && armed) face.dataset.armed = "true";
    face.setAttribute("aria-label", `${seat.name} · ${seat.holder}`);
    const image =
      (world && avatarImage(world, seat.id)) ||
      humanAvatars.find((a) => a.id === seat.id).image;
    const portrait = el("img");
    portrait.src = imageUrl(`/card-game/${image}`, "card");
    portrait.alt = "";
    face.append(portrait);
    // Colour is presence: someone online in the seat. Every other is grey.
    item.dataset.lit = String(Boolean(seat.online));
    // One tap on one of yours in another world switches to it: the page
    // goes there and ☰ opens with it chosen (owner, 2026-11-01). Any other
    // tap chooses (it glows); a second tap on another's arms it.
    face.onclick = () => tapSeat(slot, seat, picked);
    item.append(face);
    return item;
  }
  function tapSeat(slot, seat, picked = false) {
    if (seat.kind === "you" && !slot.current) {
      stored(INVITE_KEY, null);
      stored(MENU_KEY, seat.id);
      leavePage(() => (location.href = sharedLink(slot.shared)));
      return;
    }
    armed = picked && seat.kind === "human";
    chosen = { id: seat.id, slot: slot.key };
    status.textContent = "";
    render();
  }
  // Your avatars under the worlds (owner, 2026-11-02): each one found,
  // face up in R·A·T·V·M·I·C·S order, in colour while free for + New world
  // and grey while in a world, then a card back for each still to find
  // (#1936), with no hint of where they are. A tap on a free one chooses it
  // for + New world; on a placed one it acts as its seat's portrait.
  function castRow(view) {
    const row = el("ul", "slot-seats slot-cast");
    const found = byInitial(humanAvatars).filter(
      (a) => !view.locked.includes(a),
    );
    row.setAttribute(
      "aria-label",
      view.locked.length
        ? `Your avatars, ${view.locked.length} still to find`
        : "Your avatars",
    );
    for (const avatar of found) {
      const slot = view.slots.find((s) => s.mine === avatar.id);
      const item = el("li", "slot-seat");
      item.dataset.avatar = avatar.id;
      item.dataset.lit = String(!slot);
      const button = el("button", "seat-face");
      button.type = "button";
      button.dataset.keepMenu = "true";
      button.setAttribute(
        "aria-label",
        slot
          ? `${avatar.name}, in ${slot.name || "a world"}`
          : `${avatar.name}, free`,
      );
      button.setAttribute(
        "aria-pressed",
        String(!slot && chosen?.id === avatar.id && !chosen.slot),
      );
      const img = el("img");
      img.src = face(avatar.image);
      img.alt = "";
      button.append(img);
      button.onclick = () => {
        if (slot)
          return tapSeat(
            slot,
            slot.seats.find((s) => s.id === avatar.id),
          );
        chosen = { id: avatar.id, slot: null };
        armed = false;
        status.textContent = "";
        render();
      };
      item.append(button);
      row.append(item);
    }
    for (const back of view.locked.map(() => el("li", "slot-seat slot-back"))) {
      const img = el("img");
      img.src = face("assets/card-back.webp");
      img.alt = "";
      back.append(img);
      row.append(back);
    }
    return row;
  }
  // "+" for an open seat. Each tap offers on the card the next of your
  // avatars that may come here: the shown one, then the one being played,
  // first. With none it is dim.
  function openSeat(slot, view, shown) {
    const first = chosen?.to ? chosen.first : shown?.id;
    const rank = (a) => [first, here().actor].indexOf(a.id) >>> 0;
    const can = byInitial(humanAvatars)
      .sort((a, b) => rank(a) - rank(b))
      .filter((avatar) => {
        const from = view.slots.find((s) => s.mine === avatar.id) || null;
        return targetsFor(avatar, from, view).worlds.includes(slot.key);
      });
    const item = el("li", "slot-seat slot-open");
    const open = el("button", "seat-face seat-open", "+");
    open.type = "button";
    open.dataset.keepMenu = "true";
    open.disabled = !can.length;
    open.setAttribute("aria-label", "Open seat");
    open.onclick = () => {
      const at = chosen?.to === slot.key ? can.indexOf(chosen.avatar) : -1;
      const avatar = can[(at + 1) % can.length];
      chosen = { id: avatar.id, avatar, to: slot.key, first };
      armed = false;
      status.textContent = "";
      render();
    };
    item.append(open);
    return item;
  }
  // The chosen avatar, as a beat in front of the dialogue (owner,
  // 2026-11-01: ☰ has no profile card). It stands as on the quest card,
  // in the place it is in here, with its level and tier; two lines give its
  // name and where it is; then its seat's action, or Bring to the world a
  // "+" offers it in.
  function chosenBeat(view, { id, slot: key, to }) {
    const home = view.slots.find((s) => s.mine === id);
    const slot = to ? home : view.slots.find((s) => s.key === key);
    const avatar = humanAvatars.find((a) => a.id === id);
    const seat = slot?.seats.find((s) => s.id === id) || {
      ...avatar,
      kind: "you",
    };
    const world = slot?.current ? session?.state.world || getWorld() : null;
    const level = seat.level || (world ? levelOf(world, id) : 0);
    const card = {
      src: face((world && avatarImage(world, id)) || avatar.image),
      level: level ? romanLevel(level) : "",
      color: levelTier(level).color,
      lit: Boolean(seat.online),
      ground: world?.actors?.[id]?.place || null,
    };
    const bring = (target) => ({
      label: `Bring to ${target.name || "this world"}`,
      id: "avatar-bring",
      run: guard(() => toWorld(avatar, home, target)),
    });
    const target = to && view.slots.find((s) => s.key === to);
    const action = target
      ? { buttons: [bring(target)] }
      : slot
        ? seatAction(slot, seat)
        : freeSeatHint(avatar, view);
    return {
      avatar: id,
      cards: [card],
      name: seat.name,
      info: seatLine(seat, slot),
      buttons: [],
      ...action,
    };
  }
  function freeSeatHint(avatar, view) {
    if (targetsFor(avatar, null, view).worlds.length)
      return { note: "Choose an open seat to bring this avatar." };
    const shared = view.slots.filter((s) => s.shared);
    return {
      note: !shared.length
        ? "No world yet"
        : shared.length === 1
          ? `Taken in ${shared[0].name || "your world"}`
          : "Taken in every world",
    };
  }
  function render() {
    // Signed out, ☰ has no world UI at all (#1892).
    box.hidden = !shared;
    const restart = $("new-game");
    if (restart) restart.hidden = Boolean(session);
    if (!shared) return;
    const view = worldSlots({
      shared,
      rows,
      here: here(),
      invite,
      unlocked,
    });
    // With nothing tapped, the card is the avatar being played, else the
    // first of yours in a world.
    const mine =
      view.slots.find((s) => s.current) || view.slots.find((s) => s.mine);
    const shown = chosen || (mine && { id: mine.mine, slot: mine.key });
    // Presence ticks redraw only when something shown has changed; choosing
    // the avatar already shown by default is a change.
    const key = JSON.stringify([view, shown, Boolean(chosen), armed]);
    if (key === drawn) return;
    drawn = key;
    box.replaceChildren();
    // A world: its name, a portrait per avatar that has entered it, in
    // colour while online, then "+" while a seat is open (owner, 2026-11-01).
    for (const slot of view.slots) {
      const row = el("section", "world-slot");
      row.dataset.slot = slot.key;
      row.dataset.current = String(Boolean(slot.current));
      const title = el("strong", "slot-name", slot.name || "A world");
      if (slot.invite || !slot.owner) {
        const mark = el("span", "slot-mark", slot.invite ? "✉" : "♥");
        mark.title = slot.invite ? "Invited" : "A friend's world";
        mark.setAttribute("aria-label", mark.title);
        title.append(mark);
      }
      const world = slot.current ? session?.state.world || getWorld() : null;
      // Its edge is the world's tier, as a card's rarity edge: the one
      // played now from its state, another as it was when last opened.
      tintByTier(
        row,
        world ? worldLevel(world).tier : cachedWorldTier(`world:${slot.key}`),
      );
      const seats = el("ul", "slot-seats");
      for (const seat of slot.seats)
        if (seat.kind !== "resident")
          seats.append(seatButton(slot, seat, world, shown));
      if (slot.seats.some((seat) => seat.kind === "resident"))
        seats.append(openSeat(slot, view, shown));
      row.append(title, seats);
      box.append(row);
    }
    // A new world hides the next avatar, for the card's avatar when it is in
    // no world, else the first in no world.
    const avatar =
      view.deck.find((a) => a.id === shown?.id) || view.deck[0] || null;
    const fresh =
      avatar && view.canCreate
        ? act("+ New world", () => create(avatar), "avatar-new-world")
        : null;
    if (fresh) {
      fresh.classList.add("slot-new");
      box.append(fresh);
    }
    box.append(castRow(view));
    if (chosen) actionBeat.show((beat = chosenBeat(view, chosen)));
    else if (beat) actionBeat.clear(beat);
  }
  // A tap anywhere but a portrait disarms.
  menu.addEventListener("click", (event) => {
    if (!armed || event.target.closest(".seat-face")) return;
    armed = false;
    render();
  });
  // beforetoggle is synchronous, unlike coalesced toggle notifications.
  // A close/reopen must retire the old load even before its next microtask.
  let loadGeneration = 0;
  menu.addEventListener("beforetoggle", () => loadGeneration++);
  menu.addEventListener("toggle", () => {
    if (!menu.matches(":popover-open")) {
      // The seat's beat leaves with ☰, after a tap on its button has run.
      const closedBeat = beat;
      beat = null;
      setTimeout(() => closedBeat && actionBeat.clear(closedBeat), 0);
      // A friend's world shows once, until ☰ closes or an avatar goes there.
      if (invite) stored(INVITE_KEY, null);
      invite = null;
      return;
    }
    // Arriving from a switch, the avatar now played is chosen.
    chosen =
      arrived && session && arrived === here().actor
        ? { id: arrived, slot: session.id }
        : null;
    arrived = null;
    armed = false;
    status.textContent = result;
    result = "";
    redraw();
    load(stored(INVITE_KEY));
  });
  // Signed in, the slots are the account's shared worlds. Without the
  // server the menu keeps what it has.
  async function load(inviteId) {
    const generation = ++loadGeneration;
    const current = () =>
      generation === loadGeneration && menu.matches(":popover-open");
    try {
      if (!allowShared()) return;
      const account = await request("/auth/account");
      if (!current()) return;
      shared = Boolean(session || account.authenticated);
      if (!shared) return;
      const list = await request("/card-game/shared/worlds");
      if (!current()) return;
      rows = list.worlds;
      unlocked = Array.isArray(list.unlocked) ? list.unlocked : null;
      if (!inviteId) return;
      const view = await request(`/card-game/shared/worlds/${inviteId}`);
      if (!current()) return;
      invite = { ...view, id: inviteId };
      status.textContent = "Tap + there to bring an avatar in.";
    } catch (error) {
      // A link to a world nobody is in any more says it has closed.
      if (current() && inviteId && /closed/.test(error?.message)) {
        stored(INVITE_KEY, null);
        status.textContent = error.message;
      }
    } finally {
      if (current()) redraw();
    }
  }
  if (stored(INVITE_KEY) || arrived) {
    stored(MENU_KEY, null);
    setTimeout(() => menu.showPopover(), 0);
  }
  return () => {
    if (menu.matches(":popover-open")) render();
  };
}
