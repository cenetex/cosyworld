// Assemble the pack content the shared rules read into one revision for the
// Rust host. Every JSON module the rules bundle imports belongs to it. Rust
// hashes these exact bytes; see docs/design/pack-content-outside-the-engine.md.
import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const output = new URL(
  "../orchestrator-rust/src/card_shared/content.json",
  import.meta.url,
);
const { metafile } = await build({
  absWorkingDir: root,
  entryPoints: ["v2/card-game/shared-world-entry.mjs"],
  bundle: true,
  write: false,
  metafile: true,
  platform: "neutral",
  format: "iife",
});
const files = {};
for (const path of Object.keys(metafile.inputs)
  .filter((path) => path.endsWith(".json"))
  .sort())
  files[path] = JSON.parse(await readFile(new URL(path, `file://${root}`)));
const text = `${JSON.stringify({ schema: 1, files })}\n`;
if (process.argv.includes("--check")) {
  if ((await readFile(output, "utf8").catch(() => "")) !== text)
    throw new Error(
      "Rebuild the shared pack content with node v2/scripts/build-card-shared-content.mjs.",
    );
} else await writeFile(output, text);
