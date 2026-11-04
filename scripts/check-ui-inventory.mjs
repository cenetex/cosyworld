#!/usr/bin/env node
// Fail on card-table UI the owner has not approved in ui-inventory.json (see
// its "about"). State, text and colour variants pass. --prune drops stale.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const UI_DIR = "v2/card-game";
export const INVENTORY = `${UI_DIR}/ui-inventory.json`;
const NAME = /^-?[A-Za-z_][\w-]*/;

const lineAt = (text, offset) => text.slice(0, offset).split("\n").length;
const blank = (match) => match.replace(/[^\n]/g, " ");

// Names in a class/id attribute value; `${x}` parts become `*`.
function tokens(value) {
  return value
    .replace(/\$\{[^}]*\}/g, "*")
    .split(/\s+/)
    .filter((t) => t && t !== "*" && /^[\w*-]+$/.test(t));
}

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
        const kind = c === "." ? "classes" : "ids";
        out.push({ kind, name, offset: base + i, modifier: qualified });
        qualified = true;
        i += 1 + name.length;
        continue;
      }
    }
    if (c === "[") {
      const end = text.indexOf("]", i);
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    if (c === ":") {
      const pseudo = /^:{1,2}[\w-]+/.exec(text.slice(i))?.[0] ?? ":";
      i += pseudo.length;
      if (pseudo === ":root") qualified = true;
      if (text[i] === "(") {
        let depth = 1;
        let end = i + 1;
        for (; end < text.length && depth; end += 1)
          depth += text[end] === "(" ? 1 : text[end] === ")" ? -1 : 0;
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

export function scanCss(source) {
  const text = source.replace(
    /\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g,
    blank,
  );
  const found = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "{" && !text.slice(start, i).trim().startsWith("@"))
      scanSelector(text.slice(start, i), start, found);
    if ("{};".includes(text[i])) start = i + 1;
  }
  const names = found.filter((f) => !f.modifier);
  for (const f of names) f.line = lineAt(text, f.offset);
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

// The argument at `index` of the call whose "(" is at `open`.
function argument(text, open, index) {
  const args = [];
  let depth = 0;
  let quote = null;
  let start = open + 1;
  for (let i = open + 1; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i += 1;
      else if (c === quote) quote = null;
    } else if ("\"'`".includes(c)) quote = c;
    else if ("([{".includes(c)) depth += 1;
    else if (")]}".includes(c) && depth) depth -= 1;
    else if ((c === "," || c === ")") && !depth) {
      args.push(text.slice(start, i).trim());
      start = i + 1;
      if (c === ")") break;
    }
  }
  return args[index] ?? "";
}

const literal = (arg) => /^(["'`])([^]*)\1$/.exec(arg)?.[2];
const STRING = String.raw`(["'\x60])((?:\\.|(?!\1)[^\\])*)\1`;

export function scanJs(text) {
  const names = [];
  const elements = [];
  const add = (kind, value, offset) => {
    for (const name of tokens(value))
      names.push({ kind, name, line: lineAt(text, offset) });
  };
  for (const [kind, lead] of [
    ["classes", "\\bclassName\\s*[=:]"],
    ["ids", "\\.id\\s*="],
  ])
    for (const m of text.matchAll(new RegExp(`${lead}\\s*${STRING}`, "g")))
      add(kind, m[2], m.index);
  for (const m of text.matchAll(/\b(class|id)=\\?["']([^"'\\]*)/g))
    add(m[1] === "id" ? "ids" : "classes", m[2], m.index);
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
      const open = m.index + m[0].length - 1;
      const value = cls >= 0 && literal(argument(text, open, cls));
      if (value) add("classes", value, m.index);
    }
  }
  return { names, elements: elements.sort((a, b) => a - b) };
}

// The UI files: the table's page, its stylesheets and its modules.
export function uiFiles(root = ROOT) {
  return readdirSync(path.join(root, UI_DIR))
    .filter((f) => f === "index.html" || /\.(css|mjs)$/.test(f))
    .sort()
    .map((f) => `${UI_DIR}/${f}`);
}

const scanners = { css: scanCss, html: scanHtml, mjs: scanJs };

// { classes: Map name -> "file:line", ids: Map, elements: { file: [lines] } }
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

// `added(file)` returns the line numbers added on this branch, when known.
export function compare(tree, inventory, added = () => null) {
  const errors = [];
  const notes = [];
  for (const kind of ["classes", "ids"]) {
    const approved = new Set(inventory[kind]);
    const label = kind === "ids" ? "id" : "class";
    for (const [name, where] of tree[kind])
      if (!approved.has(name))
        errors.push(
          `New UI element ${label} "${name}" in ${where} is not in the approved UI inventory.`,
        );
    const stale = inventory[kind].filter((name) => !tree[kind].has(name));
    if (stale.length) notes.push(`No longer used ${kind}: ${stale.join(", ")}`);
  }
  const files = { ...inventory.elements, ...tree.elements };
  for (const file of Object.keys(files).sort()) {
    const lines = tree.elements[file] ?? [];
    const approved = inventory.elements[file] ?? 0;
    if (lines.length > approved) {
      const fresh = added(file);
      const where = fresh ? lines.filter((l) => fresh.has(l)) : [];
      const at = (where.length ? where : lines).map((l) => `${file}:${l}`);
      const shown = at.slice(0, 8).join(", ") + (at.length > 8 ? ", ..." : "");
      errors.push(
        `New UI element in ${file}: it creates ${lines.length} elements and the approved UI inventory allows ${approved}. See ${shown}.`,
      );
    } else if (lines.length < approved)
      notes.push(`${file} creates ${lines.length} elements, not ${approved}`);
  }
  if (errors.length) errors.push(RULE);
  if (notes.length) notes.push("Drop them with `npm run check:ui -- --prune`.");
  return { ok: !errors.length, errors, notes };
}

// Removes stale entries and lowers counts; never approves anything new.
export function prune(tree, inventory) {
  const current = inventoryOf(tree);
  const elements = {};
  for (const [file, count] of Object.entries(inventory.elements))
    if (current.elements[file])
      elements[file] = Math.min(count, current.elements[file]);
  return {
    ...inventory,
    classes: inventory.classes.filter((name) => tree.classes.has(name)),
    ids: inventory.ids.filter((name) => tree.ids.has(name)),
    elements,
  };
}

// Lines added since the merge base with origin/main, working tree included.
function addedLines() {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  return (file) => {
    try {
      const from = git("merge-base", "origin/main", "HEAD").trim();
      const diff = git("diff", "-U0", "--no-color", from, "--", file);
      const lines = new Set();
      for (const m of diff.matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm))
        for (let i = 0; i < Number(m[2] ?? 1); i += 1)
          lines.add(Number(m[1]) + i);
      return lines;
    } catch {
      return null;
    }
  };
}

function main(args) {
  const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
  const inventory = JSON.parse(read(INVENTORY));
  const tree = scanTree(uiFiles(), read);
  if (args.includes("--prune")) {
    const next = JSON.stringify(prune(tree, inventory), null, 2);
    writeFileSync(path.join(ROOT, INVENTORY), `${next}\n`);
    console.log(`[ui-inventory] pruned ${INVENTORY}`);
    return;
  }
  const result = compare(tree, inventory, addedLines());
  for (const note of result.notes) console.log(`[ui-inventory] note: ${note}`);
  for (const error of result.errors) console.error(`[ui-inventory] ${error}`);
  const { classes, ids } = inventory;
  if (result.ok)
    console.log(
      `[ui-inventory] ok: ${classes.length} classes, ${ids.length} ids`,
    );
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2));
