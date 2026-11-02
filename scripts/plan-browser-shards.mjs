#!/usr/bin/env node
// Pack the full suite's browser checks into even runner shards, longest
// first, from the measured seconds in scripts/browser-shards.json. Prints a
// GitHub Actions matrix: {"include":[{"shard":"1/9","checks":"a b"},...]}.
// Usage: node scripts/plan-browser-shards.mjs
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = new URL("../", import.meta.url);
const CONFIG = fileURLToPath(new URL("./browser-shards.json", import.meta.url));

// Name the file a check runs.
export function checkSource(check) {
  const journey = check.match(/^((?:smoke|check)-[\w-]+)(?:@(\d+))?$/);
  if (!journey) throw new Error(`Unknown browser check: ${check}`);
  return { script: `v2/scripts/${journey[1]}.mjs`, width: journey[2] };
}

// Greedy longest-first packing into the fewest shards that keep each one at
// or under the target (a single check longer than the target gets its own).
export function planShards({ targetSeconds, checks }) {
  const sorted = Object.entries(checks).sort(
    ([a, x], [b, y]) => y - x || a.localeCompare(b),
  );
  const total = sorted.reduce((sum, [, seconds]) => sum + seconds, 0);
  for (let count = Math.ceil(total / targetSeconds); ; count += 1) {
    const shards = Array.from({ length: count }, () => ({
      seconds: 0,
      checks: [],
    }));
    for (const [check, seconds] of sorted) {
      const lightest = shards.reduce((a, b) => (b.seconds < a.seconds ? b : a));
      lightest.checks.push(check);
      lightest.seconds += seconds;
    }
    const fits = shards.every(
      (shard) => shard.seconds <= targetSeconds || shard.checks.length === 1,
    );
    if (fits || count >= sorted.length) return shards;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const config = JSON.parse(readFileSync(CONFIG, "utf8"));
  for (const check of Object.keys(config.checks)) {
    const { script } = checkSource(check);
    if (script && !existsSync(new URL(script, ROOT)))
      throw new Error(`${check} has no ${script}`);
  }
  const shards = planShards(config);
  for (const [index, shard] of shards.entries())
    console.error(
      `shard ${index + 1}: ${shard.seconds}s ${shard.checks.join(" ")}`,
    );
  const include = shards.map((shard, index) => ({
    shard: `${index + 1}/${shards.length}`,
    checks: shard.checks.join(" "),
  }));
  console.log(JSON.stringify({ include }));
}
