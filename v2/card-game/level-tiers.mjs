// The level tiers, shared by the card edge colours and the rules. Avatars in
// one tier are equally matched; only a higher tier is stronger.
// The first five tiers use Signal's palette: cenetex/signal@815ad69/shared/mining.h.
// Fixed level bands keep a card's colour independent of population or discovery.
export const tiers = [
  [0, "Common", "#c8dce6"],
  [10, "Uncommon", "#8cdcff"],
  [20, "Rare", "#be82ff"],
  [30, "Epic", "#ffc85a"],
  [50, "Legendary", "#fff082"],
  [100, "Mythic", "#ff9ce6"],
].map(([minLevel, label, color], rank) => ({
  id: label.toLowerCase(),
  label,
  color,
  minLevel,
  rank,
}));

export const levelTier = (level) =>
  tiers.findLast((tier) => level >= tier.minLevel) || tiers[0];
