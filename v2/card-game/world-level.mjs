import { humanAvatarIds } from "./human-cast.mjs";
import { levelTier, tiers } from "./level-tiers.mjs";
import { conditionsMet, packDefinitions } from "./pack-registry.mjs";
import { levelFor, levelOf, startXp } from "./want.mjs";

// A world levels up as it grows (owner, 2026-11-04): its level is
// presentation, read in the browser from state the rules already keep, and
// nothing new is stored or journaled. Each point only ever rises: a level a
// resident gained (residents never lose one), and a way opened (a latched
// gate route, an opened section, a discovered crossing). Players are left
// out: a shared world's players carry levels in from other worlds and a seat
// reset lowers them. Shared and local play read the same projected world.
export function worldPoints(world) {
  let points = 0;
  for (const id of Object.keys(world?.actors || {}))
    if (!humanAvatarIds.includes(id))
      points += Math.max(0, levelOf(world, id) - levelFor(startXp(id)));
  points += world?.openedRoutes?.length || 0;
  for (const pack of packDefinitions)
    for (const section of pack.sections || [])
      if (
        section.requires?.length &&
        conditionsMet(world, pack.id, section.requires)
      )
        points++;
  for (const crossing of Object.values(world?.crossings || {}))
    if (crossing?.discovered) points++;
  return points;
}

// Level 1 plus its points, coloured by the game's level tiers.
export function worldLevel(world) {
  const level = 1 + worldPoints(world);
  return { level, tier: levelTier(level) };
}

// The browser remembers each world's tier by its logo key (title-logo.mjs),
// so ☰ can colour a world it is not playing now, until that one is opened
// again.
export const TIER_KEY = "cosyworld.world-tier";
const REMEMBERED = 40;
// Blocked storage throws even on reading `localStorage`.
function browserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}
function read(storage) {
  try {
    return JSON.parse(storage?.getItem(TIER_KEY) || "{}") || {};
  } catch {
    return {};
  }
}
export function cachedWorldTier(key, storage = browserStorage()) {
  const id = read(storage)[key];
  return tiers.find((tier) => tier.id === id) || tiers[0];
}
export function rememberWorldTier(key, tier, storage = browserStorage()) {
  const memory = read(storage);
  if (memory[key] === tier.id) return;
  delete memory[key];
  memory[key] = tier.id;
  const keys = Object.keys(memory);
  for (const old of keys.slice(0, Math.max(0, keys.length - REMEMBERED)))
    delete memory[old];
  try {
    storage?.setItem(TIER_KEY, JSON.stringify(memory));
  } catch {}
}

// Colours an element by a world tier, as a card's rarity edge. Common keeps
// today's neutral look, so the first colour (Uncommon) is noticed.
export function tintByTier(node, tier) {
  if (tier.rank) {
    node.dataset.worldTier = tier.id;
    node.style.setProperty("--world-tier", tier.color);
  } else {
    delete node.dataset.worldTier;
    node.style.removeProperty("--world-tier");
  }
}

// The world being played: the page's logos glow in its tier (style.css),
// and the tier is remembered for ☰.
let shown = "";
export function showWorldTier(world, key, root = document.documentElement) {
  const { tier } = worldLevel(world);
  if (shown === `${key} ${tier.id}`) return tier;
  shown = `${key} ${tier.id}`;
  tintByTier(root, tier);
  rememberWorldTier(key, tier);
  return tier;
}
