import { createWorld } from "./world.mjs";
import { humanAvatar, humanAvatars } from "./human-cast.mjs";
import { worldName } from "./world-name.mjs";

// A player owns one of each avatar; each is in one world or none
// (v2/docs/card-table/avatar-menu.md). Vale keeps the original save slot.
export const SAVE_BASE = "cosyworld.reflected-shore.v1";
export const PLAYING_KEY = "cosyworld.playing";
export const avatarSlot = (id, base = SAVE_BASE) =>
  id === "vale" ? base : `${base}.avatar.${id}`;
export const otherAvatar = (id) =>
  id !== "vale" && humanAvatar(id) ? id : null;

// Another avatar's local world starts at its own home, as in shared play:
// every unclaimed home item rests on its home floor. Vale's lamp stays lit
// in the attic, on the floor, where the player can find it (#1799).
const ATTIC_OPENING =
  "Vale stands alone in Mirror attic beside a lit lamp on the floor. Its light fills the room; the tall mirror shows only the attic.";
export function createAvatarWorld(actor, seed) {
  const world = createWorld({ opening: true, seed });
  for (const avatar of humanAvatars) {
    const item = world.items[avatar.item?.id];
    if (avatar.id !== "vale" && item?.holder === avatar.id)
      item.holder = avatar.home.id;
  }
  const lamp = world.items.lamp;
  if (actor !== "vale" && lamp.holder === "vale") {
    lamp.holder = world.actors.vale.place;
    const opening = world.log[0];
    for (const shown of opening.items || [])
      if (shown.id === "lamp") shown.holder = lamp.holder;
    const told = `${opening.speaker}: ${opening.text}`.slice(0, 650);
    opening.text = ATTIC_OPENING;
    for (const memory of Object.values(world.memories))
      for (const event of memory.events)
        if (event.seq === opening.seq && event.text === told)
          event.text = `${opening.speaker}: ${ATTIC_OPENING}`;
  }
  world.sharedVersion = 1;
  world.playerActorId = actor;
  world.controlledActors = [actor];
  world.presentActors = [actor];
  return world;
}

// The name of the local world in an avatar's slot, without loading it.
export function localWorldName(id, storage = globalThis.localStorage) {
  try {
    const text = storage.getItem(avatarSlot(id));
    return text ? worldName(JSON.parse(text).run?.seed) || "" : null;
  } catch {
    return null;
  }
}

// Leaving a local world keeps it as the slot's backup, as New game does.
export function archiveLocal(id, storage = globalThis.localStorage) {
  const slot = avatarSlot(id);
  const save = storage.getItem(slot);
  if (save) storage.setItem(`${slot}.bak`, save);
  storage.removeItem(slot);
}

// Delete world: the avatar's local save and its backup are gone.
export function deleteLocal(id, storage = globalThis.localStorage) {
  const slot = avatarSlot(id);
  storage.removeItem(slot);
  storage.removeItem(`${slot}.bak`);
}
