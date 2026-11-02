import { levelOf } from "./want.mjs";
import { things } from "./world.mjs";
import { levelTier, tiers } from "./level-tiers.mjs";

// An item keeps the level its pack or the hub authors (startLevel, as for
// avatars); items do not gain levels yet (#1583). Everyone else shows the
// level their experience gives.
export const itemLevel = (id) => things[id]?.startLevel || 1;
export const cardLevel = (world, id) =>
  Object.hasOwn(things, id) ? itemLevel(id) : levelOf(world, id);

export { levelTier };
export const rarityColor = (level) => levelTier(level).color;
// A quest's tier by its F(n) step count: 1, 2-3, 5, 8, then 13 and more.
export const stepTier = (steps) =>
  tiers[steps >= 13 ? 4 : steps >= 8 ? 3 : steps >= 5 ? 2 : steps >= 2 ? 1 : 0];

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
