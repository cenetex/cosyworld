import { levelOf } from "./want.mjs";
import { things } from "./world.mjs";
import { levelTier } from "./level-tiers.mjs";
import { humanAvatarIds } from "./human-cast.mjs";

export const itemLevel = (id) => things[id]?.startLevel || 1;
export const cardLevel = (world, id) =>
  Object.hasOwn(things, id) ? itemLevel(id) : levelOf(world, id);

export { levelTier };
export const rarityColor = (level) => levelTier(level).color;

const numerals = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];
export function romanLevel(level) {
  if (!Number.isSafeInteger(level) || level < 0) return "";
  if (level === 0) return "N";
  return numerals
    .map(([value, glyph]) => {
      const count = Math.floor(level / value);
      level %= value;
      return glyph.repeat(count);
    })
    .join("");
}
export const blankLevel = (id, level) =>
  level === 0 && humanAvatarIds.includes(id);
export const shownLevel = (id, level) =>
  blankLevel(id, level) ? "" : romanLevel(level);
