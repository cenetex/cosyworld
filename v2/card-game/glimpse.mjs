import { LEVEL_CAP } from "./level-tiers.mjs";
import { isArcanum } from "./world/arcana-record.mjs";

export const GLIMPSE_KINDS = ["arcanum"];

export function validGlimpse(g) {
  return Boolean(
    g &&
      typeof g === "object" &&
      !Array.isArray(g) &&
      Object.keys(g).length === 4 &&
      Number.isSafeInteger(g.level) &&
      g.level >= 0 &&
      g.level <= LEVEL_CAP &&
      GLIMPSE_KINDS.includes(g.kind) &&
      isArcanum(g.id) &&
      typeof g.at === "string" &&
      g.at.length > 0 &&
      g.at.length <= 120,
  );
}
