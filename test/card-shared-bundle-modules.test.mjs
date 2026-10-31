import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

// Every module in the shared rules bundle is replayed forever. A new import
// into this graph is an engine change; see
// docs/design/pack-content-outside-the-engine.md. Presentation modules and
// content are leaving it (#1548), so this list should only shrink.
const PENDING_REMOVAL = {
  // Content: becomes a per-request input with a content-addressed hash.
  content: [
    "boardyai.json",
    "emoji-symbols.json",
    "entity-profiles.json",
    "forest.json",
    "packs.json",
    "shared-cast.json",
    "weather.json",
  ],
  // Presentation and dialogue: move to the narrator bundle.
  presentation: [
    "daylight.mjs",
    "narrative.mjs",
    "scarves.mjs",
    "scene.mjs",
    "want-talk.mjs",
  ],
};
const RULES = [
  "adaptive-learning.mjs",
  "boardyai.mjs",
  "expression.mjs",
  "human-cast.mjs",
  "knowledge.mjs",
  "learning.mjs",
  "legacy-saves.mjs",
  "life.mjs",
  "memory.mjs",
  "motives.mjs",
  "pack-journeys.mjs",
  "pack-recital.mjs",
  "pack-registry.mjs",
  "pack-rules.mjs",
  "pack-schema.mjs",
  "pack-sections.mjs",
  "pack-transport.mjs",
  "roaming-routes.mjs",
  "shared-rules.mjs",
  "shared-world-entry.mjs",
  "shared-world.mjs",
  "want.mjs",
  "weather.mjs",
  "world.mjs",
];

it("keeps the shared rules bundle to its reviewed modules", async () => {
  const result = await build({
    absWorkingDir: fileURLToPath(new URL("../", import.meta.url)),
    entryPoints: ["v2/card-game/shared-world-entry.mjs"],
    bundle: true,
    write: false,
    metafile: true,
    platform: "neutral",
    format: "iife",
    target: "es2022",
  });
  const modules = Object.keys(result.metafile.inputs)
    .map((path) => path.replace(/^v2\/card-game\//u, ""))
    .sort();
  const allowed = new Set([...RULES, ...Object.values(PENDING_REMOVAL).flat()]);
  expect(
    modules.filter((path) => !allowed.has(path)),
    "New shared engine imports. Keep presentation and content out of the " +
      "rules bundle, or add the module here with the engine label.",
  ).toEqual([]);
  // A module that left the bundle should leave this list too.
  expect([...allowed].filter((path) => !modules.includes(path))).toEqual([]);
});
