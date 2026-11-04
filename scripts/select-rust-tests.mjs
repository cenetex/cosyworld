#!/usr/bin/env node
// Choose the fast check's Rust test filters from the changed paths, using the
// `rust` section of scripts/fast-smokes.json. Prints the filters, one line,
// space separated; an empty line means no Rust input changed.
// Usage: node scripts/select-rust-tests.mjs changed-files.txt
//        node scripts/select-rust-tests.mjs --inputs   (list the inputs)
//
// The inputs come from the crate itself. Every quoted relative path in its
// sources (include_str!, include_bytes!, files and directories the tests read,
// modules a test imports through Node) that names a real file or directory is
// a Rust input, owned by the module that names it. A filter is that module's
// test path, read from the crate's `mod` tree, since #[path] mounts files
// under other names (src/card_narrative.rs is routes::card_game::narrative).
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const CONFIG = join(REPO, "scripts/fast-smokes.json");
const CRATE = "v2/orchestrator-rust";
const SRC = `${CRATE}/src`;

const read = (repo, file) => readFileSync(join(repo, file), "utf8");
const exists = (repo, file) => existsSync(join(repo, file));

// Maps each source file (repo-relative) to its module path, following `mod`
// declarations from main.rs and lib.rs. rustfmt indents an inline module's items by four
// spaces, so the inline module stack is read from indentation. A file loaded
// through #[path] (or named main.rs or mod.rs) owns its directory, as rustc
// does; any other file owns a directory named after it.
export function moduleTree(repo = REPO) {
  const modules = new Map();
  const visit = (file, path, ownsDir) => {
    if (modules.has(file) || !exists(repo, file)) return;
    modules.set(file, path);
    const dir = ownsDir ? posix.dirname(file) : file.replace(/\.rs$/, "");
    const stack = [];
    let attrPath = null;
    for (const line of read(repo, file).split("\n")) {
      const indent = line.match(/^ */)[0].length;
      while (stack.length && line === `${" ".repeat(stack.at(-1).indent)}}`)
        stack.pop();
      const attr = line.match(/^\s*#\[path\s*=\s*"([^"]+)"\]/);
      if (attr) {
        attrPath = attr[1];
        continue;
      }
      const decl = line.match(
        /^(\s*)(?:pub(?:\([^)]*\))?\s+)?mod\s+(?:r#)?(\w+)\s*(;|\{)\s*$/,
      );
      if (decl) {
        const name = decl[2];
        const inline = stack.map((m) => m.name);
        const childPath = [...path, ...inline, name];
        if (decl[3] === "{") {
          stack.push({ indent, name });
        } else if (attrPath) {
          const base = inline.length
            ? posix.join(dir, ...inline)
            : posix.dirname(file);
          visit(posix.join(base, attrPath), childPath, true);
        } else {
          const base = posix.join(dir, ...inline);
          const flat = posix.join(base, `${name}.rs`);
          if (exists(repo, flat)) visit(flat, childPath, false);
          else visit(posix.join(base, name, "mod.rs"), childPath, true);
        }
      }
      if (!/^\s*(#\[|\/\/)/.test(line)) attrPath = null;
    }
  };
  // The binary and the library each root a module tree.
  visit(`${SRC}/main.rs`, [], true);
  visit(`${SRC}/lib.rs`, [], true);
  return modules;
}

// Repo-relative inputs named by each source file: quoted relative paths that
// resolve, from the file, the crate, or the repository root, to a real data
// file or a directory outside the crate. Every user of the AI model crate
// reads it too.
export function rustInputs(modules, repo = REPO) {
  const inputs = new Map();
  const use = (key, file) => {
    if (!inputs.has(key)) inputs.set(key, new Set());
    inputs.get(key).add(file);
  };
  const literal = /["']((?:\.{1,2}\/|src\/|v2\/|test\/)[\w@.\/-]*[\w-])["']/g;
  for (const file of modules.keys()) {
    const text = read(repo, file);
    if (/\bcosyworld_ai_model\b/.test(text)) use("v2/ai-model-rust/", file);
    for (const [, ref] of text.matchAll(literal)) {
      for (const base of [posix.dirname(file), CRATE, "."]) {
        const target = posix.normalize(posix.join(base, ref));
        if (target.startsWith("..") || !exists(repo, target)) continue;
        if (statSync(join(repo, target)).isDirectory()) {
          // A directory that holds the crate would select every change.
          const key = `${target}/`;
          if (!`${CRATE}/`.startsWith(key) && !key.startsWith(`${CRATE}/`))
            use(key, file);
        } else if (!target.endsWith(".rs")) {
          use(target, file);
        }
        break;
      }
    }
  }
  return inputs;
}

// The libtest filter for a source file: its module path, or null for the
// crate root, whose tests only the default covers.
const filterOf = (modules, file) => {
  const path = modules.get(file);
  return path && path.length ? `${path.join("::")}::` : null;
};

// The module that owns a file under src/: the .rs file itself, or for data
// beside the sources (a rules bundle, a JSON table), its directory's module.
const ownerOf = (modules, file) => {
  if (modules.has(file)) return file;
  for (
    let dir = posix.dirname(file);
    dir.startsWith(SRC);
    dir = posix.dirname(dir)
  ) {
    for (const owner of [`${dir}.rs`, `${dir}/mod.rs`])
      if (modules.has(owner)) return owner;
  }
  return null;
};

export function selectRustTests(changed, config, tree = {}) {
  const { rust } = config;
  const modules = tree.modules ?? moduleTree();
  const inputs = tree.inputs ?? rustInputs(modules);
  const crate = new RegExp(rust.paths);
  const picked = [];
  let fallback = false;
  const add = (file) => {
    const filter = filterOf(modules, file);
    if (!filter) fallback = true;
    else if (!picked.includes(filter)) picked.push(filter);
  };
  for (const file of changed) {
    let matched = false;
    if (file.startsWith(`${SRC}/`)) {
      const owner = ownerOf(modules, file);
      if (owner) add(owner);
      else fallback = true;
      matched = true;
    }
    for (const [input, users] of inputs) {
      if (rust.ignoreInputs.includes(input)) continue;
      if (input.endsWith("/") ? file.startsWith(input) : file === input) {
        users.forEach(add);
        matched = true;
      }
    }
    for (const rule of rust.rules) {
      if (new RegExp(rule.paths).test(file)) {
        rule.modules.forEach((m) => add(`${SRC}/${m}`));
        matched = true;
      }
    }
    if (!matched && crate.test(file)) fallback = true;
  }
  if (fallback) rust.default.forEach((m) => add(`${SRC}/${m}`));
  // A parent module's filter already runs its children's tests.
  const kept = picked.filter(
    (f) => !picked.some((g) => g !== f && f.startsWith(g)),
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
    // Lists every derived input with the filters it selects.
    const modules = moduleTree();
    for (const [input, users] of rustInputs(modules)) {
      const filters = [...users].map((f) => filterOf(modules, f) ?? "(root)");
      console.log(input, [...new Set(filters)].join(" "));
    }
  } else {
    const changed = readFileSync(process.argv[2], "utf8")
      .split("\n")
      .filter(Boolean);
    const config = JSON.parse(readFileSync(CONFIG, "utf8"));
    console.log(selectRustTests(changed, config).join(" "));
  }
}
