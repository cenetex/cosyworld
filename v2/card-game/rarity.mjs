export { levelOf as cardLevel } from "./want.mjs";

// Signal's canonical palette: cenetex/signal@815ad69/shared/mining.h.
// Fixed level bands keep a card's colour independent of population or discovery.
const tiers = [
  [0, "Common", "#c8dce6"],
  [10, "Uncommon", "#8cdcff"],
  [20, "Rare", "#be82ff"],
  [30, "Epic", "#ffc85a"],
  [50, "Legendary", "#fff082"],
].map(([minLevel, label, color]) => ({
  id: label.toLowerCase(),
  label,
  color,
  minLevel,
}));

export const levelTier = (level) =>
  tiers.findLast((tier) => level >= tier.minLevel) || tiers[0];
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
