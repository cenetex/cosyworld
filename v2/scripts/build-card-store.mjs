// Build the worldpack store: verify, validate and admit third-party packs.
//
//   node v2/scripts/build-card-store.mjs           # verify + admit store packs
//   node v2/scripts/build-card-store.mjs --check   # fail if anything drifts
//   node v2/scripts/build-card-store.mjs --refresh-ratings  # also refresh GitHub signals
//
// A worldpack lives in its own repository (the source of truth). Publishing
// it to the store is a PR that vendors a copy under v2/worldpacks/<id>/ and
// pins the source commit plus a content hash. This script is the gate:
//  1. the vendored copy must hash to the pin (nothing edits a pack in place),
//  2. the pack must pass the full card-table validator,
//  3. admitted packs are materialized (assets copied to card-game/assets/)
//     and listed in v2/worldpacks/vendor-manifest.json for the worldpack build.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  packProblems,
} from "../card-game/pack-schema.mjs";

const v2 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storeDir = path.join(v2, "worldpacks");
const storeFile = path.join(storeDir, "store.json");
const manifestFile = path.join(storeDir, "vendor-manifest.json");
const check = process.argv.includes("--check");
const refreshRatings = process.argv.includes("--refresh-ratings");

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const sha256 = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");

// Content hash: every payload file of the pack, sorted by path, hashed as
// "<path>\n<size>\n<sha256 of bytes>\n". Deterministic across platforms.
function hashPack(dir) {
  const files = [];
  const walk = (rel) => {
    for (const name of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const next = rel ? `${rel}/${name.name}` : name.name;
      if (name.isDirectory()) walk(next);
      else files.push(next);
    }
  };
  walk("");
  const h = crypto.createHash("sha256");
  for (const rel of files) {
    const bytes = fs.readFileSync(path.join(dir, rel));
    h.update(`${rel}\n${bytes.length}\n${sha256(bytes)}\n`);
  }
  return h.digest("hex");
}

const problems = [];
const admitted = [];

if (
  !fs.existsSync(storeFile) ||
  read(storeFile)?.schemaVersion !== 1 ||
  !Array.isArray(read(storeFile).packs)
) {
  console.error("v2/worldpacks/store.json needs schemaVersion 1 and a packs list.");
  process.exit(1);
}
const store = read(storeFile);
const hub = JSON.parse(fs.readFileSync(path.join(v2, "worlds/card-table.json"), "utf8")).hub;
const seen = new Set();

for (const entry of store.packs) {
  const id = entry.id;
  if (!/^[a-z0-9-]+$/.test(id) || seen.has(id)) {
    problems.push(`${id}: store entry needs a distinct lowercase-hyphen id`);
    continue;
  }
  seen.add(id);
  const dir = path.join(storeDir, id);
  const worldFile = path.join(dir, "card-world.json");
  const bridgeFile = path.join(dir, "card-bridge.json");
  if (!fs.existsSync(worldFile) || !fs.existsSync(bridgeFile)) {
    problems.push(`${id}: vendored copy needs card-world.json and card-bridge.json`);
    continue;
  }
  // 1. The pin must match the vendored bytes.
  if (entry.pinned?.sha256 === undefined) {
    problems.push(`${id}: store entry needs a pinned sha256`);
    continue;
  }
  const actual = hashPack(dir);
  if (actual !== entry.pinned.sha256) {
    problems.push(
      `${id}: vendored copy does not match the pin (${actual} != ${entry.pinned.sha256}). Re-pin or re-vendor.`,
    );
    continue;
  }
  // 2. The pack must validate against the hub like any in-tree pack.
  const source = JSON.parse(fs.readFileSync(worldFile, "utf8"));
  const bridge = JSON.parse(fs.readFileSync(bridgeFile, "utf8"));
  if (source.id !== id) {
    problems.push(`${id}: card-world.json id must match the store entry`);
    continue;
  }
  if (bridge.schemaVersion !== 1 || bridge.pack !== id) {
    problems.push(`${id}: bridge needs schemaVersion 1 and pack "${id}"`);
    continue;
  }
  const { schemaVersion: _s, pack: _p, id: bridgeId, description, ...joins } = bridge;
  const pack = {
    ...source,
    bridge: { id: bridgeId, description },
    ...joins,
  };
  problems.push(...packProblems(pack, hub, []).map((p) => p));
  if (problems.length) continue;

  // 3. Materialize: copy art into card-game/assets/<id>/ so the image,
  //    assets and shared builds treat it like in-tree art.
  if (!check) {
    const artFrom = path.join(dir, "assets");
    if (fs.existsSync(artFrom)) {
      const artTo = path.join(v2, "card-game", "assets", id);
      fs.mkdirSync(artTo, { recursive: true });
      for (const name of fs.readdirSync(artFrom))
        fs.copyFileSync(path.join(artFrom, name), path.join(artTo, name));
    }
  }
  admitted.push({
    id,
    revision: entry.pinned.revision,
    source: entry.source,
    pinned: entry.pinned,
    dir: `worldpacks/${id}`,
  });
}

if (problems.length) {
  console.error(`Worldpack store is invalid:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}

if (refreshRatings) {
  for (const entry of store.packs) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${entry.source.repo}`,
        { headers: { Accept: "application/vnd.github+json", "User-Agent": "cosyworld-store-build" } },
      );
      if (res.ok) {
        const repo = await res.json();
        entry.rating = {
          ...entry.rating,
          source: "github",
          stars: repo.stargazers_count ?? entry.rating?.stars ?? 0,
          forks: repo.forks_count ?? entry.rating?.forks ?? 0,
          updated: new Date().toISOString().slice(0, 10),
        };
      }
    } catch {
      // Ratings are advisory: a failed fetch never blocks the build.
    }
  }
  if (!check) fs.writeFileSync(storeFile, `${JSON.stringify(store, null, 2)}\n`);
}

if (!check) {
  fs.writeFileSync(manifestFile, `${JSON.stringify({ schemaVersion: 1, packs: admitted }, null, 2)}\n`);
}

console.log(
  `Worldpack store ${check ? "verified" : "admitted"}: ${admitted.map((p) => p.id).join(", ") || "(empty)"}.`,
);
