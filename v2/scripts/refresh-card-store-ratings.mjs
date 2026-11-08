// Explicit maintenance only; this command is never part of a build.
import assert from "node:assert/strict";
import {
  CATALOG_FILE,
  readCatalog,
  refreshRatings,
  writeRatings,
} from "./card-store-catalog.mjs";

assert(
  process.argv.length === 2,
  "Usage: node v2/scripts/refresh-card-store-ratings.mjs",
);
const { bytes, catalog } = readCatalog();
const result = await refreshRatings(catalog);
if (JSON.stringify(result.catalog) !== JSON.stringify(catalog))
  writeRatings(CATALOG_FILE, bytes, result.catalog);
for (const failure of result.failures)
  console.error(
    `${failure.id} (${failure.repo}): ${failure.error}; previous rating retained.`,
  );
console.log(
  `Ratings refreshed: ${catalog.packs.length - result.failures.length}; failed: ${result.failures.length}.`,
);
if (result.failures.length) process.exitCode = 1;
