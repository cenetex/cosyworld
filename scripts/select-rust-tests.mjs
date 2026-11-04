#!/usr/bin/env node
// Choose the fast check's Rust test filters from the changed paths, using the
// `rust` section of scripts/fast-smokes.json. Prints the filters on one line;
// an empty line means no Rust input changed. `--inputs` lists the inputs.
// Usage: node scripts/select-rust-tests.mjs (changed-files.txt | --inputs)
//
// The inputs come from the crate itself: every quoted relative path in its
// sources (include_str!, include_bytes!, files the tests read, modules they
// import through Node) that names a real file or directory, owned by the
// module that names it. A filter is that module's test path, read from the
// `mod` tree, since #[path] renames files (src/card_narrative.rs is
// routes::card_game::narrative).
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const CRATE = "v2/orchestrator-rust";
const SRC = `${CRATE}/src`;
const read = (file) => readFileSync(join(REPO, file), "utf8");
const exists = (file) => existsSync(join(REPO, file));

// Maps each source file to its module path, from main.rs and lib.rs. rustfmt
// indents an inline module's items four spaces, so indentation gives the
// inline module stack. A file loaded through #[path], or named main.rs or
// mod.rs, owns its own directory, as in rustc; any other file owns a
// directory named after it.
export function moduleTree() {
  const modules = new Map();
  const visit = (file, path, ownsDir) => {
    if (modules.has(file) || !exists(file)) return;
    modules.set(file, path);
    const dir = ownsDir ? posix.dirname(file) : file.replace(/\.rs$/, "");
    const stack = [];
    let attrPath = null;
    for (const line of read(file).split("\n")) {
      while (stack.length && line === `${" ".repeat(stack.at(-1).indent)}}`)
        stack.pop();
      const attr = line.match(/^\s*#\[path\s*=\s*"([^"]+)"\]/);
      const decl = line.match(
        /^( *)(?:pub(?:\([^)]*\))?\s+)?mod\s+(?:r#)?(\w+)\s*(;|\{)\s*$/,
      );
      if (attr) attrPath = attr[1];
      else if (decl?.[3] === "{")
        stack.push({ indent: decl[1].length, name: decl[2] });
      else if (decl) {
        const inline = stack.map((m) => m.name);
        const child = [...path, ...inline, decl[2]];
        const base = posix.join(dir, ...inline);
        const flat = posix.join(base, `${decl[2]}.rs`);
        if (attrPath)
          visit(
            posix.join(inline.length ? base : posix.dirname(file), attrPath),
            child,
            true,
          );
        else if (exists(flat)) visit(flat, child, false);
        else visit(posix.join(base, decl[2], "mod.rs"), child, true);
      }
      if (!/^\s*(#\[|\/\/)/.test(line)) attrPath = null;
    }
  };
  visit(`${SRC}/main.rs`, [], true);
  visit(`${SRC}/lib.rs`, [], true);
  return modules;
}

// Repo paths each source file names, resolved from the file, the crate, or
// the repository root, keeping data files and directories outside the crate.
// Every user of the AI model crate reads it too.
export function rustInputs(modules) {
  const inputs = new Map();
  const use = (key, file) =>
    inputs.set(key, (inputs.get(key) ?? new Set()).add(file));
  const literal = /["']((?:\.{1,2}\/|src\/|v2\/|test\/)[\w@./-]*[\w-])["']/g;
  for (const file of modules.keys()) {
    const text = read(file);
    if (/\bcosyworld_ai_model\b/.test(text)) use("v2/ai-model-rust/", file);
    for (const [, ref] of text.matchAll(literal)) {
      const target = [posix.dirname(file), CRATE, "."]
        .map((base) => posix.normalize(posix.join(base, ref)))
        .find((path) => !path.startsWith("..") && exists(path));
      if (!target) continue;
      if (!statSync(join(REPO, target)).isDirectory()) {
        if (!target.endsWith(".rs")) use(target, file);
      } else if (!`${CRATE}/`.startsWith(target) && !target.startsWith(CRATE)) {
        use(`${target}/`, file); // never a directory holding the crate
      }
    }
  }
  return inputs;
}

// A module's libtest filter, or null for a crate root (the default covers it).
const filterOf = (modules, file) =>
  modules.get(file)?.length ? `${modules.get(file).join("::")}::` : null;

// A file under src/ belongs to its own module or, for data beside the
// sources (a rules bundle, a JSON table), to its directory's module.
const ownerOf = (modules, file) => {
  for (let dir = file; dir.startsWith(SRC); dir = posix.dirname(dir))
    for (const owner of [dir, `${dir}.rs`, `${dir}/mod.rs`])
      if (modules.has(owner)) return owner;
  return null;
};

export function selectRustTests(changed, config, tree = {}) {
  const { rust } = config;
  const modules = tree.modules ?? moduleTree();
  const inputs = tree.inputs ?? rustInputs(modules);
  const picked = new Set();
  let fallback = false;
  const add = (file) => {
    const filter = filterOf(modules, file);
    if (filter) picked.add(filter);
    else fallback = true;
  };
  for (const file of changed) {
    const owners = file.startsWith(`${SRC}/`) ? [ownerOf(modules, file)] : [];
    for (const [input, users] of inputs)
      if (!rust.ignoreInputs.includes(input))
        if (input.endsWith("/") ? file.startsWith(input) : file === input)
          owners.push(...users);
    for (const rule of rust.rules)
      if (new RegExp(rule.paths).test(file))
        owners.push(...rule.modules.map((m) => `${SRC}/${m}`));
    owners.forEach(add);
    if (!owners.length && new RegExp(rust.paths).test(file)) fallback = true;
  }
  if (fallback) rust.default.forEach((m) => add(`${SRC}/${m}`));
  // A parent module's filter already runs its children's tests.
  const kept = [...picked].filter(
    (f) => ![...picked].some((g) => g !== f && f.startsWith(g)),
  );
  if (kept.length > rust.max)
    process.stderr.write(`Not run here: ${kept.slice(rust.max).join(" ")}\n`);
  return kept.slice(0, rust.max);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv[2] === "--inputs") {
    const modules = moduleTree();
    for (const [input, users] of rustInputs(modules)) {
      const filters = [...users].map((f) => filterOf(modules, f) ?? "(root)");
      console.log(input, [...new Set(filters)].join(" "));
    }
  } else {
    const list = readFileSync(process.argv[2], "utf8");
    const changed = list.split("\n").filter(Boolean);
    const config = JSON.parse(read("scripts/fast-smokes.json"));
    console.log(selectRustTests(changed, config).join(" "));
  }
}
