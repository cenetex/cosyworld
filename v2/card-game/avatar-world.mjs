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
// every unclaimed home item rests on its home floor.
export function createAvatarWorld(actor, seed) {
  const world = createWorld({ opening: true, seed });
  for (const avatar of humanAvatars) {
    const item = world.items[avatar.item?.id];
    if (avatar.id !== "vale" && item?.holder === avatar.id)
      item.holder = avatar.home.id;
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
