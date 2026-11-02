import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { sharedContentInput } from "../v2/scripts/shared-content-input.mjs";

// Every module in the shared rules bundle is replayed forever. A new import
// into this graph is an engine change; see
// docs/design/pack-content-outside-the-engine.md. Presentation and dialogue
// modules (scene, narrative, daylight) live in the narrator bundle, and pack
// content arrives per request from content.json (#1548).
const RULES = [
  "avatar-reset.mjs",
  "adaptive-learning.mjs",
  "boardyai.mjs",
  "expression.mjs",
  "hidden-avatar.mjs",
  "human-cast.mjs",
  "knowledge.mjs",
  "learning.mjs",
  "legacy-saves.mjs",
  "level-tiers.mjs",
  "life.mjs",
  "memory.mjs",
  "motives.mjs",
  "pack-journeys.mjs",
  "pack-recital.mjs",
  "pack-registry.mjs",
  "pack-rules.mjs",
  "pack-schema.mjs",
  "pack-sections.mjs",
  "pack-specials.mjs",
  "pack-transport.mjs",
  "reflections.mjs",
  "roaming-routes.mjs",
  "scene-cast.mjs",
  "shared-rules.mjs",
  "shared-world-entry.mjs",
  "shared-world.mjs",
  "want-talk.mjs",
  "want.mjs",
  "weather.mjs",
  "world.mjs",
];

it("keeps the shared rules bundle to its reviewed modules and no content", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const result = await build({
    absWorkingDir: root,
    plugins: [sharedContentInput(root)],
    entryPoints: ["v2/card-game/shared-world-entry.mjs"],
    bundle: true,
    write: false,
    metafile: true,
    platform: "neutral",
    format: "iife",
    target: "es2022",
  });
  const inputs = Object.keys(result.metafile.inputs);
  // Every content import is read from the host's content revision.
  const content = JSON.parse(
    readFileSync(
      new URL(
        "../v2/orchestrator-rust/src/card_shared/content.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const injected = inputs
    .filter((path) => path.startsWith("card-content:"))
    .map((path) => path.slice("card-content:".length));
  expect(injected.length).toBeGreaterThan(0);
  expect(injected.sort()).toEqual(Object.keys(content.files));
  // So art, poses and pack text never reach the rules bundle's bytes.
  const text = result.outputFiles[0].text;
  const prose = [];
  const collect = (value) => {
    if (typeof value === "string" && value.length > 80) prose.push(value);
    else if (value && typeof value === "object")
      Object.values(value).forEach(collect);
  };
  collect(content.files);
  expect(prose.length).toBeGreaterThan(100);
  expect(prose.filter((line) => text.includes(line))).toEqual([]);
  const modules = inputs
    .filter((path) => !path.startsWith("card-content:"))
    .map((path) => path.replace(/^v2\/card-game\//u, ""))
    .sort();
  const allowed = new Set(RULES);
  expect(
    modules.filter((path) => !allowed.has(path)),
    "New shared engine imports. Keep presentation and content out of the " +
      "rules bundle, or add the module here with the engine label.",
  ).toEqual([]);
  // A module that left the bundle should leave this list too.
  expect([...allowed].filter((path) => !modules.includes(path))).toEqual([]);
});
