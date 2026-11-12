#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPackGraph, nameLookup } from "./lib/level-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "docs/maps";

const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));

export function buildAll() {
  const table = read("v2/card-game/packs.json");
  const nameOf = nameLookup(table.packs, read("v2/card-game/forest.json"));
  const files = {};
  for (const pack of table.packs) {
    const graph = buildPackGraph(pack, table.hub, nameOf);
    files[`${OUT}/${graph.pack}.graph.json`] = `${JSON.stringify(graph, null, 2)}\n`;
  }
  return files;
}

function staleFiles(files) {
  const dir = path.join(root, OUT);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((name) => `${OUT}/${name}`)
    .filter((file) => !(file in files));
}

function main(argv) {
  const files = buildAll();
  const stale = staleFiles(files);
  if (argv.includes("--check")) {
    const wrong = Object.entries(files)
      .filter(([file, text]) => !fs.existsSync(path.join(root, file)) || fs.readFileSync(path.join(root, file), "utf8") !== text)
      .map(([file]) => file)
      .concat(stale);
    if (wrong.length) {
      console.error(`Level graphs are stale: ${wrong.join(", ")}. Run npm run regen.`);
      process.exitCode = 1;
      return;
    }
    console.log(`Level graphs are current: ${Object.keys(files).length} files.`);
    return;
  }
  fs.mkdirSync(path.join(root, OUT), { recursive: true });
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(root, file), text);
  for (const file of stale) fs.rmSync(path.join(root, file));
  console.log(`Wrote ${Object.keys(files).length} level graph files to ${OUT}/.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
