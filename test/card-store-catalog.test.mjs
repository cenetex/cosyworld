import { afterEach, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import data from "./fixtures/card-store-catalog.json" with { type: "json" };
import {
  catalogEntry,
  readCatalog,
  refreshRatings,
  validateCatalog,
  writeRatings,
} from "../v2/scripts/card-store-catalog.mjs";

const fixture = () => structuredClone(data);
const now = () => new Date("2026-11-08T03:00:00.000Z");
const response = (extra = {}) =>
  Response.json({
    full_name: "example/pack",
    stargazers_count: 9,
    forks_count: 4,
    ...extra,
  });
const roots = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => fs.rmSync(root, { recursive: true, force: true })),
);
const disk = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cosy-catalog-"));
  roots.push(root);
  const file = path.join(root, "catalog.json");
  fs.writeFileSync(file, JSON.stringify(fixture()));
  return file;
};
it("validates offline and keys metadata by exact id plus repository", () => {
  expect(readCatalog().catalog.schemaVersion).toBe(1);
  const catalog = fixture(),
    entry = catalog.packs[0];
  catalog.packs.push({
    ...structuredClone(entry),
    source: { repo: "other/pack" },
  });
  expect(catalogEntry(catalog, "sample", "example/pack")).toBe(entry);
  expect(catalogEntry(catalog, "sample", "Example/pack")).toBe(null);
  expect(catalogEntry(catalog, "missing", "example/pack")).toBe(null);
  catalog.packs.push(entry);
  expect(() => validateCatalog(catalog)).toThrow(/Duplicate/);
});
it.each([
  ["source.repo", ["example/pack"]],
  ["source.repo", "https://evil.invalid/pack"],
  ["source.commit", "1".repeat(40)],
  ["mounted", true],
  ["description", "x".repeat(1201)],
  ["name", "hidden\u0000name"],
  ["tags", ["quiet", "quiet"]],
  ["rating.stars", "9"],
  ["rating.updated", "2026-02-30"],
  ["reviews", Array(9).fill({})],
])("rejects malformed or authority-bearing %s", (field, value) => {
  const catalog = fixture(),
    keys = field.split(".");
  const object = keys.slice(0, -1).reduce((v, k) => v[k], catalog.packs[0]);
  object[keys.at(-1)] = value;
  expect(() => validateCatalog(catalog)).toThrow();
});
it.each([null, data.packs[0].rating])(
  "refreshes only signals from rating %j",
  async (rating) => {
    const catalog = fixture(),
      expected = fixture();
    catalog.packs[0].rating = expected.packs[0].rating = rating;
    const original = structuredClone(catalog);
    const result = await refreshRatings(catalog, {
      now,
      fetcher: async (url, options) => {
        expect(url).toBe("https://api.github.com/repos/example/pack");
        expect(options.redirect).toBe("error");
        expect(options.signal).toBeInstanceOf(AbortSignal);
        return response({ description: "Remote replacement", mounted: true });
      },
    });
    expected.packs[0].rating = {
      ...rating,
      source: "github",
      stars: 9,
      forks: 4,
      updated: now().toISOString(),
    };
    expect(result).toEqual({ catalog: expected, failures: [] });
    expect(catalog).toEqual(original);
  },
);
it.each([
  async () => {
    throw new Error("network down");
  },
  async () => new Response("rate limited", { status: 403 }),
  async () => response({ full_name: "other/pack" }),
  async () => response({ forks_count: -1 }),
  async () => response({ stargazers_count: [9] }),
  async () => new Response(" ".repeat(256 * 1024 + 1)),
])("retains ratings after a failed refresh %#", async (fetcher) => {
  const result = await refreshRatings(data, { now, fetcher });
  expect(result.catalog).toEqual(data);
  expect(result.failures).toHaveLength(1);
});
it("writes only ratings and refuses editorial changes or concurrent edits", async () => {
  const file = disk(),
    { bytes, catalog } = readCatalog(file);
  const sentinel = path.join(path.dirname(file), "store.json");
  fs.writeFileSync(sentinel, "Admission is separate.\n");
  const { catalog: next } = await refreshRatings(catalog, {
    now,
    fetcher: async () => response(),
  });
  const changed = structuredClone(next);
  changed.packs[0].rating.note = "Changed note";
  expect(() => writeRatings(file, bytes, changed)).toThrow(
    /signal fields only/,
  );
  writeRatings(file, bytes, next);
  expect(readCatalog(file).catalog).toEqual(next);
  expect(fs.readFileSync(sentinel, "utf8")).toBe("Admission is separate.\n");
  expect(() => writeRatings(file, bytes, next)).toThrow(
    /changed during refresh/,
  );
});
it("bounds catalog input and rejects a symlink", () => {
  const file = disk();
  fs.writeFileSync(file, " ".repeat(1024 * 1024 + 1));
  expect(() => readCatalog(file)).toThrow(/1 MiB/);
  const link = file + ".link";
  fs.symlinkSync(file, link);
  expect(() => readCatalog(link)).toThrow(/regular file/);
});
