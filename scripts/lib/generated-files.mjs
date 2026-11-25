// The one list of committed outputs that `npm run regen` rebuilds and
// `npm run land` never merges by hand. No side effects, so any script can
// import it.
export const RULES_DIR = "v2/orchestrator-rust/src/card_shared";

export const GENERATED_FILES = [
  `${RULES_DIR}/narrator.js`,
  `${RULES_DIR}/content.json`,
  "v2/card-game/world-history.json",
  "v2/orchestrator-rust/src/card_narrative/authored-text.json",
  "test/journeys/checkpoints.json",
  "v2/card-game/packs.json",
  "v2/card-game/media-manifest.json",
  "v2/card-game/image-variants.json",
  "v2/card-game/music-streams.json",
  "v2/card-game/assets/music/radio-catalog.json",
];

// Shared rules version wiring, which v2/scripts/next-shared-rules.mjs
// restores from the base.
export const RULES_WIRING = [
  `${RULES_DIR}/engine.rs`,
  "test/card-released-rules.test.mjs",
  "v2/scripts/build-card-shared-engine.mjs",
  `${RULES_DIR}/rules.json`,
];

export const isLevelMap = (file) =>
  /^docs\/maps\/[^/]+\.graph\.json$/u.test(file);
export const isRulesBundle = (file) =>
  /^v2\/orchestrator-rust\/src\/card_shared\/engine-v\d+\.js$/u.test(file);

// Version lines, bundle paths and pinned hashes are wiring; the rest is work.
export const isWiringLine = (line) =>
  /VERSION|SOURCE|engine-v\d+\.js|^\s*"?\d+"?: "[0-9a-f]{64}",?$|^[{}]$|^\/\/ Rules /u.test(
    line,
  );

export function realWiringChanges(diff) {
  return diff
    .split("\n")
    .filter((line) => /^[+-](?![+-])/u.test(line))
    .map((line) => line.slice(1).trim())
    .filter((line) => line && !isWiringLine(line));
}

export function classify(file) {
  if (GENERATED_FILES.includes(file) || isRulesBundle(file) || isLevelMap(file))
    return "generated";
  if (RULES_WIRING.includes(file)) return "wiring";
  return "other";
}
