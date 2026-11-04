#!/usr/bin/env node
// Choose the browser smokes for the fast check from the changed paths, using
// scripts/fast-smokes.json. Prints a JSON array of script names.
// Usage: node scripts/select-fast-smokes.mjs changed-files.txt
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const CONFIG = fileURLToPath(new URL("./fast-smokes.json", import.meta.url));
const SHARDS = fileURLToPath(new URL("./browser-shards.json", import.meta.url));

// Every change runs the core smokes, then up to max smokes chosen by changed
// path; a core smoke a path also selects runs once and takes no slot. A
// journey the full suite splits by width (scripts/browser-shards.json) runs
// one width per job here too, so each fits the job's time limit.
export function selectSmokes(changed, config, shardChecks = {}) {
  const rust = new Set(config.needsRust);
  const runs = (smoke) => {
    const widths = Object.keys(shardChecks).filter((check) =>
      check.startsWith(`${smoke}@`),
    );
    return rust.has(smoke) ? [] : widths.length ? widths : [smoke];
  };
  const core = [...new Set(config.core.flatMap(runs))];
  const picked = [];
  const add = (smoke) => {
    for (const run of runs(smoke))
      if (!core.includes(run) && !picked.includes(run)) picked.push(run);
  };
  for (const file of changed) {
    const own = file.match(
      /^v2\/scripts\/((?:smoke-card|smoke-shared|check-card)-[\w-]+)\.mjs$/,
    );
    if (own) add(own[1]);
  }
  for (const rule of config.rules) {
    const pattern = new RegExp(rule.paths);
    if (changed.some((file) => pattern.test(file))) rule.smokes.forEach(add);
  }
  return [...core, ...picked.slice(0, config.max)];
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const changed = readFileSync(process.argv[2], "utf8")
    .split("\n")
    .filter(
      (file) => file && (!file.startsWith("v2/scripts/") || existsSync(file)), // deleted smokes
    );
  const config = JSON.parse(readFileSync(CONFIG, "utf8"));
  const { checks } = JSON.parse(readFileSync(SHARDS, "utf8"));
  console.log(JSON.stringify(selectSmokes(changed, config, checks)));
}
