// Warn when a pull request changes the shared rules engine without the
// `engine` label and a design note. Bundle membership comes from walking the
// static imports of the shared entry, so no build is needed.
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const ENTRY = "v2/card-game/shared-world-entry.mjs";
export const WIRING = [
  "v2/orchestrator-rust/src/card_shared/engine.rs",
  "v2/orchestrator-rust/src/card_shared/full_world.rs",
  "test/card-released-rules.test.mjs",
  "v2/scripts/build-card-shared-engine.mjs",
];
const BUNDLE = /^v2\/orchestrator-rust\/src\/card_shared\/engine-v\d+\.js$/;
const SPECIFIER =
  /(?:\bimport\s*(?:[\w*{}\s,$]+?\s*from\s*)?|\bexport\s*[\w*{}\s,$]*?\s*from\s*|\bimport\s*\(\s*)["']([^"']+)["']/g;

/** Relative static (and literal dynamic) import specifiers in `source`. */
export function importSpecifiers(source) {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
  return [...code.matchAll(SPECIFIER)]
    .map((match) => match[1])
    .filter((spec) => spec.startsWith("."));
}

/** Repo-relative files reachable from `entry`, sorted. */
export function bundleModules(entry = ENTRY, base = root) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (!/\.m?js$/.test(file)) return;
    const absolute = join(base, file);
    for (const spec of importSpecifiers(readFileSync(absolute, "utf8"))) {
      const target = relative(base, resolve(dirname(absolute), spec));
      if (existsSync(join(base, target))) visit(target);
    }
  };
  visit(entry);
  return [...seen].sort();
}

/** Classify changed files against the engine policy. */
export function engineGate({ changed, labels, modules }) {
  const members = new Set(modules);
  const engine = changed.filter(
    (file) => BUNDLE.test(file) || WIRING.includes(file) || members.has(file),
  );
  const labelled = labels.includes("engine");
  const designNote = changed.some((file) => /^docs\/design\/.+/.test(file));
  return {
    engine,
    labelled,
    designNote,
    warn: engine.length > 0 && !(labelled && designNote),
  };
}

export function summary(result, modules) {
  const lines = ["## Shared rules engine gate", ""];
  if (!result.engine.length)
    lines.push("This PR does not touch the shared rules engine.");
  else {
    lines.push(
      result.warn
        ? "**Warning:** this PR changes the shared rules engine without " +
            [
              !result.labelled && "the `engine` label",
              !result.designNote && "a design note under `docs/design/`",
            ]
              .filter(Boolean)
              .join(" or ") +
            "."
        : "This PR changes the shared rules engine with the `engine` label and a design note.",
      "",
      "Engine changes mint a new released rules bundle that journal replay keeps forever. " +
        "Make them deliberate and batch them into an engine release; prefer pack data for features. " +
        "This check only warns for now (#1549).",
      "",
      "Engine files changed:",
      ...result.engine.map((file) => `- \`${file}\``),
    );
  }
  lines.push(
    "",
    `<details><summary>Shared bundle modules (${modules.length}, from \`${ENTRY}\`)</summary>`,
    "",
    ...modules.map((file) => `- \`${file}\``),
    "",
    "</details>",
    "",
  );
  return lines.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const modules = bundleModules();
  if (process.argv.includes("--list")) {
    console.log(modules.join("\n"));
    process.exit(0);
  }
  const listFile = process.argv[2];
  const changed = listFile
    ? readFileSync(listFile, "utf8").split("\n").filter(Boolean)
    : [];
  const labels = JSON.parse(process.env.PR_LABELS || "[]");
  const result = engineGate({ changed, labels, modules });
  const text = summary(result, modules);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  else console.log(text);
  if (result.warn)
    console.log(
      "::warning title=Shared rules engine change::Add the `engine` label and a design note under docs/design/. Engine changes are deliberate and batched; prefer pack data. See .github/AGENT.md.",
    );
}
