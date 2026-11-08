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
// Approved resident sleep art is registered by actor id. Aliases can point
// to the same asset without changing the world-life rules or base portrait.
const residentSleepPortraits = {
  "greek-antigone": "assets/sleep/residents/greek-antigone-sleeping.png",
  "greek-baker": "assets/sleep/greek-baker-sleeping.png",
};
export const sleepPortraitAssets = [
  ...[...travelers].flatMap((id) =>
    ["", "-scarf"].map(
      (wardrobe) => `assets/shared/characters/${id}-sleeping${wardrobe}.webp`,
    ),
  ),
  ...Object.values(residentSleepPortraits),
  ...["moth", "keeper"].map((id) => `assets/sleep/${id}-sleeping.webp`),
];

export function sleepingPortrait(world, id) {
  if (!world?.actors?.[id]?.sleeping) return null;
  if (travelers.has(id)) {
    const scarf = avatarImage(world, id) === scarfPortrait(id);
    return `assets/shared/characters/${id}-sleeping${scarf ? "-scarf" : ""}.webp`;
  }
  if (residentSleepPortraits[id]) return residentSleepPortraits[id];
  return ["moth", "keeper"].includes(id)
    ? `assets/sleep/${id}-sleeping.webp`
    : null;
}
