#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./check-change-budget.mjs";

const STYLES = {
  slash: { line: ["//"], open: "/*", close: "*/" },
  css: { line: [], open: "/*", close: "*/" },
  html: { line: [], open: "<!--", close: "-->" },
  hash: { line: ["#"], open: null, close: null },
};

const EXTENSIONS = {
  ".mjs": "slash",
  ".js": "slash",
  ".cjs": "slash",
  ".rs": "slash",
  ".c": "slash",
  ".h": "slash",
  ".css": "css",
  ".html": "html",
  ".sh": "hash",
  ".yml": "hash",
  ".yaml": "hash",
};

const DIRECTIVE =
  /^#!|eslint-|@ts-|prettier-ignore|@__PURE__|@vitest-environment|\b(?:c8|v8|istanbul) ignore\b|SPDX-License-Identifier|copyright|licen[sc]e/iu;

export function styleOf(file) {
  return EXTENSIONS[path.posix.extname(file).toLowerCase()] ?? null;
}

export function isCounted(file, excluded = []) {
  if (!styleOf(file)) return false;
  if (file.split("/").includes("node_modules")) return false;
  return !excluded.some((glob) => path.posix.matchesGlob(file, glob));
}

export function countComments(text, style) {
  const { line, open, close } = STYLES[style];
  let count = 0;
  let inside = false;
  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    let comment = inside;
    if (inside) {
      if (trimmed.includes(close)) inside = false;
    } else if (open && trimmed.startsWith(open)) {
      comment = true;
      inside = !trimmed.slice(open.length).includes(close);
    } else if (line.some((mark) => trimmed.startsWith(mark))) {
      comment = true;
    }
    if (comment && !DIRECTIVE.test(trimmed)) count += 1;
  }
  return count;
}

export function evaluate(base, head) {
  const ok = base === 0 ? head === 0 : head < base;
  const lines = [
    `[comment-ratchet] base ${base}, head ${head}, difference ${head - base}`,
  ];
  if (!ok)
    lines.push(
      base === 0
        ? "[comment-ratchet] The base has no comment lines, so the head must have none."
        : "[comment-ratchet] The head must have fewer comment lines than the base. Remove at least one more than you add.",
    );
  return { ok, lines };
}

function git(cwd, args, input) {
  return execFileSync("git", args, {
    cwd,
    input,
    maxBuffer: 1 << 30,
  });
}

export function listBlobs(cwd, rev, excluded) {
  return git(cwd, ["ls-tree", "-r", "-z", rev])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const [meta, file] = entry.split("\t");
      const [, type, sha] = meta.split(" ");
      return { type, sha, file };
    })
    .filter(({ type, file }) => type === "blob" && isCounted(file, excluded));
}

export function readBlobs(cwd, shas) {
  const texts = new Map();
  if (!shas.length) return texts;
  const out = git(cwd, ["cat-file", "--batch"], `${shas.join("\n")}\n`);
  let at = 0;
  for (const sha of shas) {
    const end = out.indexOf(10, at);
    const size = Number(out.subarray(at, end).toString("utf8").split(" ")[2]);
    texts.set(sha, out.subarray(end + 1, end + 1 + size).toString("utf8"));
    at = end + 1 + size + 1;
  }
  return texts;
}

export function countRevisions(cwd, revs, excluded) {
  const trees = revs.map((rev) => listBlobs(cwd, rev, excluded));
  const shas = [...new Set(trees.flat().map(({ sha }) => sha))];
  const texts = readBlobs(cwd, shas);
  return trees.map((tree) =>
    tree.reduce(
      (sum, { sha, file }) =>
        sum + countComments(texts.get(sha), styleOf(file)),
      0,
    ),
  );
}

export function check({ cwd, base, head, excluded }) {
  const mergeBase = git(cwd, ["merge-base", base, head])
    .toString("utf8")
    .trim();
  const [baseCount, headCount] = countRevisions(
    cwd,
    [mergeBase, head],
    excluded,
  );
  return { mergeBase, baseCount, headCount, ...evaluate(baseCount, headCount) };
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function main(args) {
  const { generated, lockfiles } = loadConfig().excluded;
  const excluded = [...generated.paths, ...lockfiles.paths];
  const cwd = process.cwd();
  const head = option(args, "--head", "HEAD");
  if (args.includes("--count")) {
    console.log(countRevisions(cwd, [head], excluded)[0]);
    return;
  }
  const result = check({
    cwd,
    base: option(args, "--base", "origin/main"),
    head,
    excluded,
  });
  console.log(`[comment-ratchet] merge base ${result.mergeBase}`);
  for (const line of result.lines)
    (result.ok ? console.log : console.error)(line);
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2));
