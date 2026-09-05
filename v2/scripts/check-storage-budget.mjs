#!/usr/bin/env node
// Fails when a deployment's event store or generated art passes its committed
// budget. The volume headroom check answers "is the disk nearly full"; this
// answers "which store is filling it", early enough to choose a response.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const budgetsPath = resolve(here, "storage-budgets.json");
const MB = 1024 * 1024;

const requested = process.argv[2] || "";
const { targets } = JSON.parse(await readFile(budgetsPath, "utf8"));
const selected = requested
  ? targets.filter((target) => target.label === requested || target.group === requested || target.base_url === requested)
  : targets;

if (!selected.length) {
  console.error(`No storage budget is declared for "${requested}" in ${budgetsPath}.`);
  process.exit(2);
}

const megabytes = (bytes) => (Number(bytes || 0) / MB).toFixed(1);
let failed = false;

for (const target of selected) {
  const metaUrl = new URL("/meta", target.base_url).toString();
  let meta;
  try {
    const response = await fetch(metaUrl, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    meta = await response.json();
  } catch (error) {
    console.error(`${target.label}: could not read ${metaUrl} — ${error.message}`);
    failed = true;
    continue;
  }

  const persistence = meta.persistence || {};
  const checks = [
    ["event store", persistence.event_store_bytes, target.event_store_mb],
    ["generated art", persistence.generated_asset_bytes, target.generated_asset_mb],
  ];

  for (const [name, bytes, budgetMb] of checks) {
    if (bytes === undefined || bytes === null) {
      console.log(`${target.label}: ${name} size is not reported by this build; skipping.`);
      continue;
    }
    const used = megabytes(bytes);
    if (Number(bytes) > budgetMb * MB) {
      console.error(
        `::error::${target.label} ${name} at ${used} MB exceeds its ${budgetMb} MB budget — ` +
          `free space, add retention, or raise the budget in v2/scripts/storage-budgets.json.`,
      );
      failed = true;
    } else {
      console.log(`${target.label}: ${name} ${used} MB of ${budgetMb} MB budget.`);
    }
  }

  // A store that reports "none" can never return a freed page, so every burst
  // it takes is permanent until someone runs a full VACUUM in a window.
  if (persistence.event_store_auto_vacuum === "none") {
    console.log(
      `::warning::${target.label} event store has auto_vacuum=none, so compaction cannot ` +
        `return space. One full VACUUM in a maintenance window converts it.`,
    );
  }
}

process.exit(failed ? 1 : 0);
