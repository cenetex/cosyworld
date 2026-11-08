// Advisory data has no import into the store gate, compiler or runtime.
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CATALOG_FILE = fileURLToPath(
  new URL("../worldpacks/catalog.json", import.meta.url),
);
const LIMIT = 1024 * 1024;
const ENTRY_FIELDS =
  "id name author description tags source rating reviews".split(" ");
const shape = (value, required, optional = []) => {
  assert(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(
    Object.keys(value)
      .filter((key) => !optional.includes(key))
      .sort(),
    required.toSorted(),
    "Unexpected catalog fields",
  );
};
const list = (value, max) =>
  assert(
    Array.isArray(value) && value.length <= max,
    "Catalog list exceeds its limit",
  );
const text = (value, max) =>
  assert(
    typeof value === "string" &&
      value.trim() &&
      value.length <= max &&
      !/[\u0000-\u001f\u007f]/u.test(value),
    "Invalid catalog text",
  );
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const dated = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}\.\d{3}Z)?$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, value.length) === value;

export function validateCatalog(catalog) {
  shape(catalog, ["schemaVersion", "description", "packs"]);
  text(catalog.description, 600);
  assert.equal(catalog.schemaVersion, 1, "Invalid catalog version");
  list(catalog.packs, 32);
  const seen = new Set();
  for (const entry of catalog.packs) {
    shape(entry, ENTRY_FIELDS);
    shape(entry.source, ["repo"]);
    text(entry.id, 64);
    assert(
      /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(entry.id),
      "Invalid catalog id",
    );
    text(entry.source.repo, 201);
    assert(
      /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(
        entry.source.repo,
      ),
      "Invalid catalog repository",
    );
    const key = JSON.stringify([entry.id, entry.source.repo]);
    assert(!seen.has(key), "Duplicate catalog identity");
    seen.add(key);
    text(entry.name, 120);
    text(entry.author, 160);
    text(entry.description, 1200);
    list(entry.tags, 12);
    assert(
      entry.tags.every(
        (tag) =>
          typeof tag === "string" &&
          tag.length <= 32 &&
          /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag),
      ) && new Set(entry.tags).size === entry.tags.length,
      "Invalid catalog tags",
    );
    list(entry.reviews, 8);
    for (const review of entry.reviews) {
      shape(review, ["author", "note", "updated"]);
      text(review.author, 160);
      text(review.note, 1200);
      assert(dated(review.updated), "Invalid review date");
    }
    if (entry.rating !== null) {
      shape(entry.rating, ["source", "stars", "forks", "updated"], ["note"]);
      assert(
        entry.rating.source === "github" &&
          count(entry.rating.stars) &&
          count(entry.rating.forks) &&
          dated(entry.rating.updated),
        "Invalid GitHub rating",
      );
      if (entry.rating.note !== undefined) text(entry.rating.note, 600);
    }
  }
  return catalog;
}

export function catalogEntry(catalog, id, repo) {
  return (
    validateCatalog(catalog).packs.find(
      (entry) => entry.id === id && entry.source.repo === repo,
    ) ?? null
  );
}
export function readCatalog(file = CATALOG_FILE) {
  const stat = fs.lstatSync(file);
  assert(
    stat.isFile() && stat.size <= LIMIT,
    "Catalog must be a regular file under 1 MiB",
  );
  const bytes = fs.readFileSync(file);
  assert(bytes.length <= LIMIT, "Catalog exceeds 1 MiB");
  return { bytes, catalog: validateCatalog(JSON.parse(bytes)) };
}
async function signals(response, repo) {
  assert(response.ok, `GitHub request failed (${response.status})`);
  let length = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    assert(length <= 256 * 1024, "GitHub response exceeds 256 KiB");
    chunks.push(chunk);
  }
  const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  assert(
    data.full_name === repo &&
      count(data.stargazers_count) &&
      count(data.forks_count),
    "GitHub repository or counters differ from the request",
  );
  return { stars: data.stargazers_count, forks: data.forks_count };
}
export async function refreshRatings(
  catalog,
  { fetcher = globalThis.fetch, now = () => new Date() } = {},
) {
  const next = structuredClone(validateCatalog(catalog));
  const failures = [];
  for (const entry of next.packs) {
    const repo = entry.source.repo;
    try {
      const response = await fetcher(`https://api.github.com/repos/${repo}`, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "cosyworld-catalog-refresh",
        },
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      const counters = await signals(response, repo);
      entry.rating = {
        ...entry.rating,
        source: "github",
        ...counters,
        updated: now().toISOString(),
      };
    } catch (error) {
      failures.push({
        id: entry.id,
        repo,
        error: String(error?.message ?? error).slice(0, 200),
      });
    }
  }
  return { catalog: validateCatalog(next), failures };
}
const editorial = ({ packs, ...rest }) => ({
  ...rest,
  packs: packs.map(({ rating, ...entry }) => ({
    ...entry,
    ratingNote: rating?.note ?? null,
  })),
});
export function writeRatings(file, before, next) {
  validateCatalog(next);
  assert.deepEqual(
    editorial(next),
    editorial(validateCatalog(JSON.parse(before))),
    "Refresh may change GitHub signal fields only",
  );
  assert(
    readCatalog(file).bytes.equals(before),
    "Catalog changed during refresh; retry",
  );
  const bytes = Buffer.from(JSON.stringify(next, null, 2) + "\n");
  assert(bytes.length <= LIMIT, "Catalog exceeds 1 MiB");
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes, { flag: "wx", mode: 0o644 });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  assert(
    process.argv.length === 2,
    "Usage: node v2/scripts/card-store-catalog.mjs",
  );
  console.log(
    `Advisory catalog verified: ${readCatalog().catalog.packs.length} entries.`,
  );
}
