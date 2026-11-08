import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { fetchGitSource } from "./card-store-fetch.mjs";
import { installSnapshot } from "./card-store-install.mjs";
import { verifyStore } from "./card-store.mjs";
const [repo, commit, ...extra] = process.argv.slice(2);
assert(
  repo && commit && !extra.length,
  "Usage: node v2/scripts/import-card-store.mjs owner/repo exact-commit",
);
const v2 = fileURLToPath(new URL("../", import.meta.url));
verifyStore(v2);
const source = { repo, commit };
const entry = installSnapshot(v2, source, fetchGitSource(source));
console.log(
  `Imported ${entry.id} at ${source.commit}; mounted=false. Review before admission.`,
);
