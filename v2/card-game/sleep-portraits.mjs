// Sleeping is committed state, never inferred from a Wait or the clock.
import { avatarImage, scarfPortrait } from "./scarves.mjs";

const travelers = new Set([
  "vale",
  "mara",
  "ash",
  "nell",
  "tavi",
  "rue",
  "orin",
  "ada",
]);
export const sleepPortraitAssets = [
  ...[...travelers].flatMap((id) =>
    ["", "-scarf"].map(
      (wardrobe) => `assets/shared/characters/${id}-sleeping${wardrobe}.webp`,
    ),
  ),
  ...["moth", "keeper"].map((id) => `assets/sleep/${id}-sleeping.webp`),
];

export function sleepingPortrait(world, id) {
  if (!world?.actors?.[id]?.sleeping) return null;
  if (travelers.has(id)) {
    const scarf = avatarImage(world, id) === scarfPortrait(id);
    return `assets/shared/characters/${id}-sleeping${scarf ? "-scarf" : ""}.webp`;
  }
  return ["moth", "keeper"].includes(id)
    ? `assets/sleep/${id}-sleeping.webp`
    : null;
}
