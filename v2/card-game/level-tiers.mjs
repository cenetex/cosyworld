// The level tiers, shared by the card edge colours and the rules. Avatars in
// one tier are equally matched; only a higher tier is stronger.
// The first five tiers use Signal's palette: cenetex/signal@815ad69/shared/mining.h.
// Fixed level bands keep a card's colour independent of population or discovery.
export const LEVEL_CAP = 21;
export const tiers = [
  [0, 0, 1, "Common", "#c8dce6"],
  [6, 10, 2, "Uncommon", "#8cdcff"],
  [11, 20, 2.5, "Rare", "#be82ff"],
  [15, 30, 5, "Epic", "#ffc85a"],
  [19, 50, 25, "Legendary", "#fff082"],
  [21, 100, 1, "Mythic", "#ff9ce6"],
].map(([minLevel, minRank, per, label, color], rank) => ({
  id: label.toLowerCase(),
  label,
  color,
  minLevel,
  minRank,
  per,
  rank,
}));

export const levelTier = (level) =>
  tiers.findLast((tier) => level >= tier.minLevel) || tiers[0];

const topOf = (tier) => (tiers[tier.rank + 1]?.minLevel ?? LEVEL_CAP + 1) - 1;
export function trackLevel(rank) {
  const tier = tiers.findLast((t) => rank >= t.minRank) || tiers[0];
  return Math.min(
    topOf(tier),
    tier.minLevel + Math.floor(Math.max(0, rank - tier.minRank) / tier.per),
  );
}
export function rankOf(level) {
  const capped = Math.min(LEVEL_CAP, Math.max(0, level)),
    tier = levelTier(capped);
  return tier.minRank + Math.ceil((capped - tier.minLevel) * tier.per);
}
