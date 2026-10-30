// Presentation only: a traveler wears their scarf portrait while they hold
// their own scarf item. Keep this out of the rules so released bundles stay
// stable. RATi sews each traveler's scarf as `forest-scarf-<traveler id>`.
import { humanAvatar } from "./human-cast.mjs";

export const scarfItemId = (actor) => `forest-scarf-${actor}`;

// Only the traveler's own scarf counts: each scarf portrait paints that
// traveler's colour, so carrying someone else's scarf keeps the plain art.
export const holdsScarf = (world, actor) =>
  Boolean(actor) && world?.items?.[scarfItemId(actor)]?.holder === actor;

export const scarfPortrait = (actor) =>
  `assets/shared/characters/${actor}-scarf.png`;

// The relative image path for a shared traveler, or null for anyone else.
export function avatarImage(world, actor) {
  const avatar = humanAvatar(actor);
  if (!avatar) return null;
  return holdsScarf(world, actor) ? scarfPortrait(actor) : avatar.image;
}
