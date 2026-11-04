#!/usr/bin/env node
// Fail on card-table UI the owner has not approved in ui-inventory.json or
// ui-styles.json (see their "about"). --styles rewrites ui-styles.json.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const UI_DIR = "v2/card-game";
export const INVENTORY = `${UI_DIR}/ui-inventory.json`;
export const STYLES = `${UI_DIR}/ui-styles.json`;
const NAME = /^-?[A-Za-z_][\w-]*/;

const lineAt = (text, offset) => text.slice(0, offset).split("\n").length;
const blank = (match) => match.replace(/[^\n]/g, " ");

// Names in a class/id attribute value; `${x}` parts become `*`.
const tokens = (value) =>
  value
    .replace(/\$\{[^}]*\}/g, "*")
    .split(/\s+/)
    .filter((t) => /^[\w-][\w*-]*$/.test(t));

// Classes and ids in one selector list. `qualified` is true once the current
// compound holds a class, id, html, body or :root, so later classes in that
// compound are modifiers.
function scanSelector(text, base, out, initial = false) {
  let qualified = initial;
  let previous = "";
  for (let i = 0; i < text.length; ) {
    const c = text[i];
    if (/\s/.test(c)) {
      while (/\s/.test(text[i] ?? "")) i += 1;
      if (!/[,>+~)]/.test(text[i] ?? ",") && !/[,>+~(]/.test(previous))
        qualified = false;
      continue;
    }
    previous = c;
    if (c === ",") qualified = initial;
    if (/[>+~]/.test(c)) qualified = false;
    if (c === "." || c === "#") {
      const name = NAME.exec(text.slice(i + 1))?.[0];
      if (name) {
        const kind = { ".": "classes", "#": "ids" }[c];
        out.push({ kind, name, offset: base + i, modifier: qualified });
        qualified = true;
        i += 1 + name.length;
        continue;
      }
    }
    if (c === "[") {
      i = text.indexOf("]", i) + 1 || text.length;
      continue;
    }
    if (c === ":") {
      const pseudo = /^:{1,2}[\w-]+/.exec(text.slice(i))?.[0] ?? ":";
      i += pseudo.length;
      if (pseudo === ":root") qualified = true;
      if (text[i] === "(") {
        let [depth, end] = [1, i + 1];
        for (; end < text.length && depth; end += 1)
          depth += { "(": 1, ")": -1 }[text[end]] ?? 0;
        const inner = pseudo === ":has" ? false : qualified;
        scanSelector(text.slice(i + 1, end - 1), base + i + 1, out, inner);
        i = end;
      }
      previous = ")";
      continue;
    }
    if (/[A-Za-z*]/.test(c)) {
      const word = /^[\w*-]+/.exec(text.slice(i))[0];
      if (word === "html" || word === "body") qualified = true;
      i += word.length;
      continue;
    }
    i += 1;
  }
}

const squash = (t) =>
  t
    .replace(/\s+/g, " ")
    .replace(/\s*([>+~,])\s*|(\()\s+|\s+(\))/g, "$1$2$3")
    .trim();
const unquote = (t) => t.replace(/"[^"]*"|'[^']*'/g, blank);

// Style rules (not at-rules or keyframes) with their at-rule context.
function cssRules(source) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, blank);
  const rules = [];
  const open = [];
  let start = 0;
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i += 1;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "{")
      open.push({ raw: text.slice(start, i), at: start, body: i + 1 });
    if (!quote && "{};".includes(c)) start = i + 1;
    const rule = !quote && c === "}" && open.pop();
    const outer = rule ? open.map((o) => squash(o.raw)) : [];
    const keyframes = /^@keyframes/m.test(outer.join("\n"));
    if (rule && !keyframes && !squash(rule.raw).startsWith("@"))
      rules.push({ ...rule, outer, decls: text.slice(rule.body, i), text });
  }
  return rules;
}

export function scanCss(source) {
  const found = [];
  const rules = cssRules(source);
  for (const { raw, at } of rules) scanSelector(unquote(raw), at, found);
  const names = found.filter((f) => !f.modifier);
  for (const f of names) f.line = lineAt(source, f.offset);
  return { names, elements: [] };
}

export function scanHtml(source) {
  const text = source.replace(/<!--[\s\S]*?-->/g, blank);
  const body = Math.max(0, text.search(/<body[\s>]/));
  const names = [];
  const elements = [];
  for (const tag of text.matchAll(/<([a-zA-Z][\w-]*)([^>]*)>/g)) {
    const line = lineAt(text, tag.index);
    if (tag.index >= body) elements.push(line);
    for (const attr of tag[2].matchAll(/\b(class|id)\s*=\s*"([^"]*)"/g))
      for (const name of tokens(attr[2]))
        names.push({ kind: attr[1] === "id" ? "ids" : "classes", name, line });
  }
  return { names, elements };
}

const literal = (n) =>
  String.raw`\((?:[^,()]*(?:\([^()]*\))?[^,()]*,){${n}}\s*(["'\x60])([^"'\x60]*)\1`;
const STRING = String.raw`(?<q>["'\x60])((?:\\.|(?!\k<q>)[^\\])*)\k<q>`;

export function scanJs(text) {
  const names = [];
  const elements = [];
  const add = (kind, value, offset) => {
    for (const name of tokens(value))
      names.push({ kind, name, line: lineAt(text, offset) });
  };
  const kinds = String.raw`(?:\b(className)\s*[=:]|\.(id)\s*=|\b(class|id)=\\?(?=["']))\s*`;
  for (const m of text.matchAll(new RegExp(kinds + STRING, "g")))
    add(m[2] || m[3] === "id" ? "ids" : "classes", m[5], m.index);
  // Module-local helpers that wrap createElement(tag).
  const helpers = new Map();
  const definition =
    /(?:function\s+([\w$]+)\s*\(([^)]*)\)|(?:const|let)\s+([\w$]+)\s*=\s*\(([^)]*)\)\s*=>)/g;
  for (const m of text.matchAll(definition)) {
    const params = (m[2] ?? m[4]).split(",").map((p) => p.split("=")[0].trim());
    const body = text.slice(m.index, m.index + m[0].length + 160);
    if (params[0] && body.includes(`createElement(${params[0]})`))
      helpers.set(m[1] ?? m[3], [m.index, params.indexOf("className")]);
  }
  const sites =
    /createElement(?:NS)?\(|\.innerHTML\s*=(?!=)|insertAdjacentHTML\(/g;
  for (const m of text.matchAll(sites)) elements.push(lineAt(text, m.index));
  for (const [name, [at, cls]] of helpers) {
    const escaped = name.replace(/\$/g, "\\$");
    const call = new RegExp(String.raw`(?<![.\w$])${escaped}\(`, "g");
    for (const m of text.matchAll(call)) {
      if (m.index >= at && m.index < at + 80) continue;
      elements.push(lineAt(text, m.index));
      const arg = cls >= 0 && new RegExp(literal(cls), "y");
      if (arg) arg.lastIndex = m.index + name.length;
      const value = arg && arg.exec(text)?.[2];
      if (value) add("classes", value, m.index);
    }
  }
  return { names, elements: elements.sort((a, b) => a - b) };
}

const surface = (patterns) =>
  new RegExp(
    `(?<![\\w-])(?:${patterns.join("|").replace(/[.*]/g, (c) => (c === "." ? "\\." : "[\\w-]*"))})(?![\\w-])`,
  );

const declarations = (text) =>
  text
    .split(/;(?![^(]*\))/)
    .map((d) => squash(d).replace(/\s*:\s*/, ": "))
    .filter(Boolean);
const references = (text) =>
  [...unquote(text).matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);

// Core rules and every CSS variable they use, including chains and overrides
// in other files. Keep unrelated declarations outside core selectors separate.
function collectStyles(entries, patterns, rules = new Map()) {
  const targets = surface(patterns);
  const variables = new Set();
  const records = entries.flatMap(([file, source]) =>
    cssRules(source).map((r) => {
      const core = targets.test(unquote(r.raw));
      const decls = declarations(r.decls);
      if (core) for (const name of references(r.decls)) variables.add(name);
      return { ...r, file, core, decls };
    }),
  );
  const property = (decl) => /^(--[\w-]+):/.exec(decl)?.[1];
  let size;
  do {
    size = variables.size;
    for (const { decls } of records)
      for (const decl of decls)
        if (variables.has(property(decl)))
          for (const name of references(decl)) variables.add(name);
  } while (size !== variables.size);
  for (const { raw, at, outer, decls, text, file, core } of records) {
    const sorted = decls
      .filter((d) => core || variables.has(property(d)))
      .sort();
    if (!sorted.length) continue;
    const key = `${[...outer, squash(raw)].join(" | ")} { ${sorted.join("; ")} }`;
    rules.set(key, `${file}:${lineAt(text, at + raw.search(/\S/))}`);
  }
  return rules;
}

export function styleRules(file, source, patterns, rules = new Map()) {
  return collectStyles([[file, source]], patterns, rules);
}

export function styleTree(files, read, patterns) {
  return collectStyles(
    files.filter((f) => f.endsWith(".css")).map((f) => [f, read(f)]),
    patterns,
  );
}

export function compareStyles(rules, snapshot) {
  const approved = new Set(snapshot.rules);
  const errors = [...rules]
    .filter(([key]) => !approved.has(key))
    .map(([key, where]) => `New or changed core UI style in ${where}: ${key}`);
  for (const key of snapshot.rules)
    if (!rules.has(key))
      errors.push(`Core UI style removed or changed: ${key}`);
  if (errors.length)
    errors.push(
      "Core surfaces (the context button, dialogue bar, cards and hand) are restyled only with the owner's approval. If approved, run `npm run check:ui -- --styles` and have the owner review v2/card-game/ui-styles.json.",
    );
  return errors;
}

export function uiFiles(root = ROOT) {
  return readdirSync(path.join(root, UI_DIR))
    .filter((f) => f === "index.html" || /\.(css|mjs)$/.test(f))
    .sort()
    .map((f) => `${UI_DIR}/${f}`);
}

const scanners = { css: scanCss, html: scanHtml, mjs: scanJs };

export function scanTree(files, read) {
  const tree = { classes: new Map(), ids: new Map(), elements: {} };
  for (const file of files) {
    const { names, elements } = scanners[file.split(".").pop()](read(file));
    for (const { kind, name, line } of names)
      if (!tree[kind].has(name)) tree[kind].set(name, `${file}:${line}`);
    if (elements.length) tree.elements[file] = elements;
  }
  return tree;
}

export const inventoryOf = (tree) => ({
  classes: [...tree.classes.keys()].sort(),
  ids: [...tree.ids.keys()].sort(),
  elements: Object.fromEntries(
    Object.entries(tree.elements).map(([file, l]) => [file, l.length]),
  ),
});

const RULE =
  "All UI must go through existing systems (see AGENTS.md). If the owner approved it, add it to v2/card-game/ui-inventory.json in a PR the owner reviews.";

export function compare(tree, inventory) {
  const errors = [];
  const notes = [];
  for (const kind of ["classes", "ids"]) {
    const approved = new Set(inventory[kind]);
    for (const [name, where] of tree[kind])
      if (!approved.has(name))
        errors.push(
          `New UI element ${kind === "ids" ? "id" : "class"} "${name}" in ${where} is not in the approved UI inventory.`,
        );
    const stale = inventory[kind].filter((name) => !tree[kind].has(name));
    if (stale.length) notes.push(`No longer used ${kind}: ${stale.join(", ")}`);
  }
  const files = { ...inventory.elements, ...tree.elements };
  for (const file of Object.keys(files).sort()) {
    const lines = tree.elements[file] ?? [];
    const approved = inventory.elements[file] ?? 0;
    if (lines.length > approved)
      errors.push(
        `New UI element in ${file}: it creates ${lines.length} elements and the approved UI inventory allows ${approved} (see \`git diff origin/main -- ${file}\`).`,
      );
    else if (lines.length < approved)
      notes.push(`${file} creates ${lines.length} elements, not ${approved}`);
  }
  if (errors.length) errors.push(RULE);
  if (notes.length) notes.push(`Delete them from ${INVENTORY}.`);
  return { ok: !errors.length, errors, notes };
}

function main(args) {
  const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
  const inventory = JSON.parse(read(INVENTORY));
  const snapshot = JSON.parse(read(STYLES));
  const files = uiFiles();
  const rules = styleTree(files, read, snapshot.surfaces);
  if (args.includes("--styles")) {
    const next = { ...snapshot, rules: [...rules.keys()].sort() };
    const json = JSON.stringify(next, null, 2);
    writeFileSync(path.join(ROOT, STYLES), `${json}\n`);
    return console.log(`[ui-inventory] wrote ${STYLES}`);
  }
  const result = compare(scanTree(files, read), inventory);
  result.errors.push(...compareStyles(rules, snapshot));
  for (const note of result.notes) console.log(`[ui-inventory] note: ${note}`);
  for (const error of result.errors) console.error(`[ui-inventory] ${error}`);
  if (!result.errors.length)
    console.log(`[ui-inventory] ok, ${rules.size} core styles`);
  process.exitCode = result.errors.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2));
