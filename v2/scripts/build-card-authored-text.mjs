// Collect the authored text a browser scene may quote: every string and
// template literal in the modules that build a scene (narrative.mjs and its
// imports), and every string in the JSON content they read. The story
// service accepts a scene's rules-built sentences only when they are made
// of these pieces (card_narrative/authored.rs). Rebuild after changing any
// of those modules or packs; `--check` fails when the output is stale.
import { build } from "esbuild";
import * as acorn from "acorn";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = new URL(
  "../orchestrator-rust/src/card_narrative/authored-text.json",
  import.meta.url,
);
const { metafile } = await build({
  absWorkingDir: root,
  entryPoints: ["v2/card-game/narrative.mjs"],
  bundle: true,
  write: false,
  metafile: true,
  platform: "neutral",
  format: "esm",
  logLevel: "silent",
});
const inputs = Object.keys(metafile.inputs).sort();
const templates = new Map();
const literals = new Set();
const names = new Set();
const template = (parts) => templates.set(JSON.stringify(parts), parts);

function walk(node, visit) {
  if (!node || typeof node.type !== "string") return;
  visit(node);
  for (const value of Object.values(node))
    for (const child of Array.isArray(value) ? value : [value])
      if (child && typeof child.type === "string") walk(child, visit);
}

// Pack text such as "{actor} spoiled Pip's light." is a template too.
function strings(value, key) {
  if (typeof value === "string") {
    literals.add(value);
    if (key === "name") names.add(value);
    const parts = value.split(/\{[A-Za-z]+\}/u);
    if (parts.length > 1) template(parts);
  } else if (Array.isArray(value)) value.forEach((v) => strings(v, key));
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) strings(v, k);
}

for (const input of inputs) {
  const source = await readFile(root + input, "utf8");
  if (input.endsWith(".json")) {
    strings(JSON.parse(source));
    continue;
  }
  const ast = acorn.parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
  });
  walk(ast, (node) => {
    if (node.type === "TemplateLiteral") {
      const parts = node.quasis.map((q) => q.value.cooked ?? "");
      if (parts.length === 1) literals.add(parts[0]);
      else template(parts);
    } else if (node.type === "Literal" && typeof node.value === "string")
      literals.add(node.value);
  });
}

const sorted = (values) => [...values].sort();
const text = `${JSON.stringify(
  {
    generated: "node v2/scripts/build-card-authored-text.mjs",
    sources: inputs,
    names: sorted(names),
    literals: sorted(literals),
    templates: [...templates.keys()].sort().map((key) => templates.get(key)),
  },
  null,
  0,
)}\n`;
if (process.argv.includes("--check")) {
  if ((await readFile(output, "utf8").catch(() => "")) !== text)
    throw new Error(
      "Rebuild the authored text with node v2/scripts/build-card-authored-text.mjs.",
    );
} else await writeFile(output, text);
