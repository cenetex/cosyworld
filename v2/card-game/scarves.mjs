// Cosmetic upgrades on a traveler's portrait (#1873). The rules record each
// one-way upgrade in the traveler's `upgrades` set; this module only paints
// it, and keeps the local passkey's set between local worlds. RATi's scarf is
// the first: she sews each traveler's scarf as `forest-scarf-<traveler id>`.
import { humanAvatar, humanAvatarIds } from "./human-cast.mjs";

export const scarfItemId = (actor) => `forest-scarf-${actor}`;

// A world from before upgrades shows the scarf only while its traveler holds
// their own scarf: each scarf portrait paints that traveler's colour.
export const holdsScarf = (world, actor) =>
  Boolean(actor) && world?.items?.[scarfItemId(actor)]?.holder === actor;

export const scarfPortrait = (actor) =>
  `assets/shared/characters/${actor}-scarf.png`;

// The portrait each cosmetic upgrade paints, in order of preference.
const PORTRAITS = { scarf: scarfPortrait };

export const upgradesOf = (world, actor) =>
  world?.actors?.[actor]?.upgrades || [];

// The relative image path for a shared traveler, or null for anyone else.
export function avatarImage(world, actor) {
  const avatar = humanAvatar(actor);
  if (!avatar) return null;
  const has = upgradesOf(world, actor);
  const upgrade = Object.keys(PORTRAITS).find((id) => has.includes(id));
  if (upgrade) return PORTRAITS[upgrade](actor);
  return holdsScarf(world, actor) ? scarfPortrait(actor) : avatar.image;
}

// Signed-out play is its own passkey. Its upgrades live in this browser and
// never reach a shared world, which reads the signed-in passkey's set.
export const LOCAL_UPGRADES_KEY = "cosyworld.local.upgrades";
function readLocal(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(LOCAL_UPGRADES_KEY) || "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}
const merged = (...sets) =>
  [...new Set(sets.flat().filter((u) => typeof u === "string"))].sort();

// Keep every upgrade a local world's travelers have earned.
export function rememberLocalUpgrades(
  world,
  storage = globalThis.localStorage,
) {
  const saved = readLocal(storage);
  let changed = false;
  for (const id of humanAvatarIds) {
    const before = Array.isArray(saved[id]) ? saved[id] : [];
    const next = merged(before, upgradesOf(world, id));
    if (next.length !== before.length) {
      saved[id] = next;
      changed = true;
    }
  }
  try {
    if (changed) storage?.setItem(LOCAL_UPGRADES_KEY, JSON.stringify(saved));
  } catch {
    /* The upgrade stays in this world's save. */
  }
}

// A local world's travelers wear the local passkey's upgrades.
export function wearLocalUpgrades(world, storage = globalThis.localStorage) {
  const saved = readLocal(storage);
  for (const id of humanAvatarIds) {
    const actor = world?.actors?.[id];
    if (!actor || !Array.isArray(saved[id]) || !saved[id].length) continue;
    actor.upgrades = merged(actor.upgrades || [], saved[id]);
  }
  return world;
}
