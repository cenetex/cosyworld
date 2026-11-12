import { carryLocalProgress } from "./legacy-saves.mjs";

// A new local game starts at level 1: a retired browser save lends it only
// its cosmetic upgrades, never experience or level (alpha saves may be
// dropped). The shared-world claim keeps its own path.
export function carryUpgrades(world, old) {
  const actors = Object.fromEntries(
    Object.entries(old?.actors || {}).map(([id, actor]) => [
      id,
      { upgrades: actor?.upgrades },
    ]),
  );
  return carryLocalProgress(world, { actors });
}
